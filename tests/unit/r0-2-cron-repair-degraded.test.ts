// @vitest-environment node
// R0-2: cron auto-repair must gate local state on RPC success and mark
// failures with repairDegraded instead of showing a fake success.

import { describe, expect, it, vi } from 'vitest';
import { createCronApi } from '@electron/services/cron-api';
import { resolveAgentIdFromChannel } from '@electron/utils/agent-config';
import { resolveAccountIdFromSessionHistory } from '@electron/utils/session-util';

vi.mock('@electron/utils/agent-config', () => ({
  resolveAgentIdFromChannel: vi.fn(),
}));

vi.mock('@electron/utils/session-util', () => ({
  resolveAccountIdFromSessionHistory: vi.fn(),
}));

function makeGatewayJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cron-job-1',
    name: 'Check-in',
    enabled: true,
    createdAtMs: 1_800_000_000_000,
    updatedAtMs: 1_800_000_000_000,
    schedule: { kind: 'cron', expr: '0 9 * * *' },
    payload: { kind: 'agentTurn', message: 'Check in' },
    delivery: { mode: 'none' },
    sessionTarget: 'isolated',
    wakeMode: 'next-heartbeat',
    state: {},
    ...overrides,
  };
}

describe('R0-2 cron repair fail-closed', () => {
  it('keeps lastError and marks repairDegraded when the delivery repair RPC fails', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'cron.list') {
        return {
          jobs: [makeGatewayJob({
            id: 'job-bad-delivery',
            delivery: { mode: 'announce' },
            state: { lastRunAtMs: 1_800_000_000_000, lastStatus: 'failed', lastError: 'Channel is required' },
          })],
        };
      }
      if (method === 'cron.update') {
        throw new Error('gateway rejected cron.update');
      }
      throw new Error('unexpected rpc: ' + method);
    });
    const api = createCronApi({ gatewayManager: { rpc } as never });

    const jobs = await api.list();
    const job = jobs.find((entry) => entry.id === 'job-bad-delivery');
    expect(job).toBeDefined();
    // Note: the display layer normalizes channel-less announce to mode:'none',
    // so the honest failure signals are the preserved lastError and the
    // repairDegraded flag rather than the delivery mode.
    expect(job!.lastRun?.error).toBe('Channel is required'); // preserved, visible
    expect(job!.lastRun?.success).toBe(false);
    expect(job!.repairDegraded).toBe(true);
  });

  it('applies the local repair only after the delivery RPC succeeds', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'cron.list') {
        return {
          jobs: [makeGatewayJob({
            id: 'job-fixable',
            delivery: { mode: 'announce' },
            state: { lastRunAtMs: 1_800_000_000_000, lastStatus: 'failed', lastError: 'Channel is required' },
          })],
        };
      }
      if (method === 'cron.update') {
        return { ok: true };
      }
      throw new Error('unexpected rpc: ' + method);
    });
    const api = createCronApi({ gatewayManager: { rpc } as never });

    const jobs = await api.list();
    const job = jobs.find((entry) => entry.id === 'job-fixable');
    expect(job!.delivery?.mode).toBe('none');
    expect(job!.lastRun?.error).toBeUndefined();
    expect(job!.lastRun?.success).toBe(true);
    expect(job!.repairDegraded).toBeUndefined();

    const updateCall = rpc.mock.calls.find(([method]) => method === 'cron.update');
    expect((updateCall as any)?.[1]).toEqual({ id: 'job-fixable', patch: { delivery: { mode: 'none' } } });
  });

  it('applies the agentId repair on RPC success', async () => {
    vi.mocked(resolveAgentIdFromChannel).mockResolvedValue('agent-resolved');
    vi.mocked(resolveAccountIdFromSessionHistory).mockResolvedValue(null);
    const rpc = vi.fn(async (method: string) => {
      if (method === 'cron.list') {
        return {
          jobs: [makeGatewayJob({
            id: 'job-agent-repair',
            delivery: { mode: 'announce', channel: 'discord' },
          })],
        };
      }
      if (method === 'cron.update') {
        return { ok: true };
      }
      throw new Error('unexpected rpc: ' + method);
    });
    const api = createCronApi({ gatewayManager: { rpc } as never });

    const jobs = await api.list();
    const job = jobs.find((entry) => entry.id === 'job-agent-repair');
    expect(job!.agentId).toBe('agent-resolved');
    expect(job!.repairDegraded).toBeUndefined();
  });

  it('marks repairDegraded and keeps the fallback agentId when the agentId repair RPC fails', async () => {
    vi.mocked(resolveAgentIdFromChannel).mockResolvedValue('agent-resolved');
    vi.mocked(resolveAccountIdFromSessionHistory).mockResolvedValue(null);
    const rpc = vi.fn(async (method: string) => {
      if (method === 'cron.list') {
        return {
          jobs: [makeGatewayJob({
            id: 'job-agent-repair-fail',
            delivery: { mode: 'announce', channel: 'discord' },
          })],
        };
      }
      if (method === 'cron.update') {
        throw new Error('gateway rejected cron.update');
      }
      throw new Error('unexpected rpc: ' + method);
    });
    const api = createCronApi({ gatewayManager: { rpc } as never });

    const jobs = await api.list();
    const job = jobs.find((entry) => entry.id === 'job-agent-repair-fail');
    expect(job!.agentId).toBe('main'); // repair did NOT take effect
    expect(job!.repairDegraded).toBe(true);
  });
});
