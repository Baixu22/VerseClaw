// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveCronCoordinatorStatus: vi.fn(),
  registerTimer: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  resolveAgentIdFromChannel: vi.fn(async () => 'main'),
  resolveAccountIdFromSessionHistory: vi.fn(async () => null),
}));

vi.mock('../../electron/services/cron-api', () => ({
  resolveCronCoordinatorStatus: (...args: unknown[]) => mocks.resolveCronCoordinatorStatus(...args),
}));
vi.mock('../../shared/resources', () => ({
  getTimerAligner: () => ({ register: mocks.registerTimer }),
}));
vi.mock('../../electron/utils/logger', () => ({
  logger: { info: mocks.loggerInfo, warn: mocks.loggerWarn },
}));
vi.mock('../../electron/utils/agent-config', () => ({
  resolveAgentIdFromChannel: mocks.resolveAgentIdFromChannel,
}));
vi.mock('../../electron/utils/session-util', () => ({
  resolveAccountIdFromSessionHistory: mocks.resolveAccountIdFromSessionHistory,
}));

import {
  evaluateCronCoordinatorScope as evaluateSharedScope,
  normalizeCronCoordinatorScope as normalizeSharedScope,
} from '@shared/long-session-followup-scope';
import {
  CRON_COORDINATOR_SCOPE_SCHEMA as RUNTIME_SCOPE_SCHEMA,
  evaluateCronCoordinatorScope as evaluateRuntimeScope,
} from '../../openclaw_runtime/src/cron/coordinator-scope';
import { goalWakeEnabled, durableHelperEnabled } from '../../openclaw_runtime/src/agents/goal-wake-config';
import {
  getCronCoordinatorReconciliationStats,
  reconcileCronCoordinatorScopes,
} from '../../electron/services/cron-maintenance';

const NOW = Date.parse('2026-10-24T02:00:00.000Z');

function scope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: RUNTIME_SCOPE_SCHEMA,
    workspaceId: 'workspace-a',
    coordinatorSessionKey: 'agent:architect:long-session',
    expectedSessionId: 'session-generation-1',
    taskRef: { kind: 'task-ledger', nodeId: 'task-1' },
    intent: 'follow-up',
    expiresAtMs: NOW + 60 * 60 * 1000,
    notificationPolicy: 'silent-unless-result',
    ...overrides,
  };
}

function gatewayManagerWith(jobs: unknown[]) {
  return {
    getStatus: () => ({ state: 'running' }),
    rpc: vi.fn(async (method: string, params?: unknown) => {
      if (method === 'cron.list') return { jobs };
      return { ok: true, params };
    }),
  };
}

beforeEach(() => {
  mocks.resolveCronCoordinatorStatus.mockReset();
  mocks.registerTimer.mockReset();
  mocks.registerTimer.mockImplementation(() => () => {});
  mocks.loggerInfo.mockReset();
  mocks.loggerWarn.mockReset();
});

describe('E1 coordinator scope fence', () => {
  const matrix: Array<{
    name: string;
    input: Parameters<typeof evaluateSharedScope>[0];
    expectedState: string;
    expectedAllowed: boolean;
  }> = [
    {
      name: 'unbound job is untouched',
      input: { scope: undefined, nowMs: NOW, liveSessionId: 'session-generation-1' },
      expectedState: 'unbound',
      expectedAllowed: true,
    },
    {
      name: 'malformed scope fails closed',
      input: { scope: { workspaceId: '' }, nowMs: NOW, liveSessionId: 'session-generation-1' },
      expectedState: 'malformed',
      expectedAllowed: false,
    },
    {
      name: 'expired follow-up is refused',
      input: { scope: scope({ expiresAtMs: NOW - 1 }), nowMs: NOW, liveSessionId: 'session-generation-1' },
      expectedState: 'expired',
      expectedAllowed: false,
    },
    {
      name: 'archived or deleted coordinator session is refused',
      input: { scope: scope(), nowMs: NOW, liveSessionId: null },
      expectedState: 'session-missing',
      expectedAllowed: false,
    },
    {
      name: 'reset generation is refused',
      input: { scope: scope(), nowMs: NOW, liveSessionId: 'session-generation-2' },
      expectedState: 'generation-mismatch',
      expectedAllowed: false,
    },
    {
      name: 'invalidated binding is refused',
      input: { scope: scope(), nowMs: NOW, liveSessionId: 'session-generation-1', bindingState: 'invalidated' },
      expectedState: 'unverifiable',
      expectedAllowed: false,
    },
    {
      name: 'unresolvable generation fails closed',
      input: { scope: scope(), nowMs: NOW, liveSessionId: undefined },
      expectedState: 'unverifiable',
      expectedAllowed: false,
    },
    {
      name: 'current generation is allowed',
      input: { scope: scope(), nowMs: NOW, liveSessionId: 'session-generation-1', bindingState: 'active' },
      expectedState: 'allowed',
      expectedAllowed: true,
    },
  ];

  it.each(matrix)('$name — runtime and Main agree', ({ input, expectedState, expectedAllowed }) => {
    const runtime = evaluateRuntimeScope(input);
    const main = evaluateSharedScope(input);
    expect(runtime.state).toBe(expectedState);
    expect(main.state).toBe(expectedState);
    expect(runtime.allowed).toBe(expectedAllowed);
    expect(main.allowed).toBe(expectedAllowed);
    expect({ ...runtime }).toEqual({ ...main });
  });

  it('normalizes a scope identically in both implementations', () => {
    expect(normalizeSharedScope(scope())).toEqual(scope());
    expect(normalizeSharedScope({ intent: 'nonsense' })).toBeNull();
    expect(normalizeSharedScope(undefined)).toBeUndefined();
  });

  it('keeps the goal-wake and durable-helper mechanisms frozen default-off', () => {
    expect(goalWakeEnabled(undefined)).toBe(false);
    expect(goalWakeEnabled({} as never)).toBe(false);
    expect(durableHelperEnabled(undefined)).toBe(false);
    expect(durableHelperEnabled({} as never)).toBe(false);
  });
});

describe('E1 pause / cancel / stop semantics', () => {
  it('suppresses a stale follow-up by disabling it, never by cancelling or stopping a run', async () => {
    const job = {
      id: 'job-stale',
      name: 'stale follow-up',
      enabled: true,
      coordinator: scope(),
      sessionTarget: 'isolated',
      payload: { kind: 'agentTurn' },
    };
    mocks.resolveCronCoordinatorStatus.mockResolvedValue({
      state: 'generation-mismatch',
      reason: 'coordinator session generation rotated after the follow-up was authorized',
      checkedAt: '2026-10-24T02:00:00.000Z',
      expectedSessionId: 'session-generation-1',
      observedSessionId: 'session-generation-2',
    });
    const gateway = gatewayManagerWith([job]);

    await reconcileCronCoordinatorScopes(gateway as never);

    const calls = gateway.rpc.mock.calls.map(([method]) => method);
    expect(calls).toContain('cron.list');
    expect(calls).toContain('cron.update');
    expect(calls).not.toContain('cron.remove');
    expect(calls).not.toContain('cron.run');
    const update = gateway.rpc.mock.calls.find(([method]) => method === 'cron.update');
    expect(update?.[1]).toEqual({ id: 'job-stale', patch: { enabled: false } });

    const stats = getCronCoordinatorReconciliationStats();
    expect(stats.checked).toBeGreaterThan(0);
    expect(stats.suppressed).toBe(1);
    const receipt = stats.receipts.at(-1);
    expect(receipt).toMatchObject({
      jobId: 'job-stale',
      state: 'generation-mismatch',
      suppressed: true,
      alreadyDisabled: false,
      expectedSessionId: 'session-generation-1',
      observedSessionId: 'session-generation-2',
    });
  });

  it('is idempotent across restart/duplicate ticks and leaves current follow-ups alone', async () => {
    const stale = {
      id: 'job-stale',
      name: 'stale follow-up',
      enabled: false,
      coordinator: scope(),
      payload: { kind: 'agentTurn' },
    };
    const current = {
      id: 'job-current',
      name: 'current follow-up',
      enabled: true,
      coordinator: scope({ workspaceId: 'workspace-b' }),
      payload: { kind: 'agentTurn' },
    };
    mocks.resolveCronCoordinatorStatus.mockImplementation(async (_gateway: unknown, rawScope: unknown) =>
      (rawScope as { workspaceId?: string })?.workspaceId === 'workspace-b'
        ? {
            state: 'allowed',
            reason: 'coordinator scope is current, unexpired and generation-matched',
            checkedAt: '2026-10-24T02:00:00.000Z',
          }
        : {
            state: 'session-missing',
            reason: 'coordinator session is archived, deleted or otherwise absent',
            checkedAt: '2026-10-24T02:00:00.000Z',
            observedSessionId: null,
          },
    );
    const gateway = gatewayManagerWith([stale, current]);

    await reconcileCronCoordinatorScopes(gateway as never);
    await reconcileCronCoordinatorScopes(gateway as never);

    const updates = gateway.rpc.mock.calls.filter(([method]) => method === 'cron.update');
    expect(updates).toEqual([]);
    expect(gateway.rpc.mock.calls.some(([method]) => method === 'cron.remove')).toBe(false);
    const stats = getCronCoordinatorReconciliationStats();
    expect(stats.alreadyDisabled).toBeGreaterThanOrEqual(2);
    expect(stats.allowed).toBeGreaterThanOrEqual(2);
  });
});