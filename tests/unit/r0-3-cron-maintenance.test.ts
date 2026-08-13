// @vitest-environment node
// R0-3: the periodic cron repair loop must be disposable, unref'd, and
// expose failure counts through the diagnostics stats surface.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveAgentIdFromChannel: vi.fn(),
  resolveAccountIdFromSessionHistory: vi.fn(),
}));

vi.mock('@electron/utils/agent-config', () => ({
  resolveAgentIdFromChannel: mocks.resolveAgentIdFromChannel,
}));

vi.mock('@electron/utils/session-util', () => ({
  resolveAccountIdFromSessionHistory: mocks.resolveAccountIdFromSessionHistory,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeGateway(rpcImpl: (method: string) => Promise<unknown>) {
  return {
    getStatus: () => ({ state: 'running' as const }),
    rpc: vi.fn(rpcImpl),
  };
}

const repairableJob = {
  id: 'cron-1',
  name: 'Daily check-in',
  sessionTarget: 'isolated',
  payload: { kind: 'agentTurn' },
  delivery: { mode: 'announce', channel: 'discord' },
};

describe('R0-3 cron maintenance loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.resolveAgentIdFromChannel.mockResolvedValue('agent-resolved');
    mocks.resolveAccountIdFromSessionHistory.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('repairs jobs and counts applied repairs', async () => {
    const { startCronAgentRepair, disposeCronMaintenance, getCronRepairStats } = await import('@electron/services/cron-maintenance');
    const gateway = makeGateway(async (method) => {
      if (method === 'cron.list') return { jobs: [repairableJob] };
      if (method === 'cron.update') return { ok: true };
      throw new Error('unexpected rpc: ' + method);
    });

    startCronAgentRepair(gateway as never);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const stats = getCronRepairStats();
    expect(stats.repairsAttempted).toBe(1);
    expect(stats.repairsApplied).toBe(1);
    expect(stats.failures).toBe(0);
    expect(gateway.rpc).toHaveBeenCalledWith('cron.update', { id: 'cron-1', patch: { agentId: 'agent-resolved' } });
    disposeCronMaintenance();
  });

  it('counts failures and exposes them through the stats getter', async () => {
    const { startCronAgentRepair, disposeCronMaintenance, getCronRepairStats } = await import('@electron/services/cron-maintenance');
    const gateway = makeGateway(async () => {
      throw new Error('gateway down');
    });

    startCronAgentRepair(gateway as never);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const stats = getCronRepairStats();
    expect(stats.failures).toBe(1);
    expect(stats.lastError).toContain('gateway down');
    expect(stats.lastRunAt).not.toBeNull();
    disposeCronMaintenance();
  });

  it('stops ticking after dispose', async () => {
    const { startCronAgentRepair, disposeCronMaintenance } = await import('@electron/services/cron-maintenance');
    const gateway = makeGateway(async (method) => {
      if (method === 'cron.list') return { jobs: [] };
      throw new Error('unexpected rpc: ' + method);
    });

    startCronAgentRepair(gateway as never);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    disposeCronMaintenance();
    const callCountAfterFirst = gateway.rpc.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(gateway.rpc.mock.calls.length).toBe(callCountAfterFirst);
  });
});
