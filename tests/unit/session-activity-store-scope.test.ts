import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySessionActivitySnapshot } from '@shared/types/session-activity';
import type { SessionActivitySnapshot } from '@shared/types/session-activity';
import type { SessionEffectivePolicy } from '@shared/types/session-effective-policy';

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  runtimeHandler: null as null | ((payload: unknown) => void),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    sessionActivity: { snapshot: mocks.snapshot },
    git: { status: vi.fn(async () => ({ success: false })) },
  },
}));

vi.mock('@/lib/host-events', () => {
  const subscribe = (name: 'runtime') => (handler: (payload: unknown) => void) => {
    if (name === 'runtime') mocks.runtimeHandler = handler;
    return vi.fn();
  };
  const noopSubscribe = vi.fn(() => vi.fn());
  return {
    hostEvents: {
      onChatRuntimeEvent: subscribe('runtime'),
      onChatQueueStatus: noopSubscribe,
      onSubagentLifecycle: noopSubscribe,
      onTaskLoopLifecycle: noopSubscribe,
      onMissionControlLifecycle: noopSubscribe,
      onClawGraphLifecycle: noopSubscribe,
      onTerminalRegistered: noopSubscribe,
      onTerminalStatusChanged: noopSubscribe,
      onTerminalExit: noopSubscribe,
    },
  };
});

import {
  disposeSessionActivitySubscriptions,
  useSessionActivityStore,
} from '@/stores/session-activity';

const SESSION_KEY = 'agent:main:shared';

function policy(workspaceId: string, runtime = 'openclaw', grantState: 'active' | 'revoked' = 'active'): SessionEffectivePolicy {
  const configured = { runtime, kind: runtime === 'openclaw' ? 'openclaw' as const : 'native' as const, ownsNativeCompaction: runtime !== 'openclaw', provider: 'openai', model: 'gpt-5.5' };
  return {
    schemaVersion: 'SessionEffectivePolicy/v1',
    generatedAt: new Date(1_000).toISOString(),
    scope: { workspaceId, sessionKey: SESSION_KEY, agentId: 'main', sessionId: 'session-1', runId: null },
    generation: { state: 'missing', runtimeGeneration: null, capabilityProfileGeneration: null, observedAt: null, reason: 'no-current-run-capability-profile' },
    backend: {
      configured: { value: configured, status: 'configured', source: 'session.runtime', reason: null },
      effective: { value: null, status: 'unverified', source: 'runtime-effective-capability.observation', reason: 'no-current-run-capability-profile' },
    },
    model: {
      configured: { value: { provider: 'openai', model: 'gpt-5.5', effort: 'high' }, status: 'configured', source: 'session.model', reason: null },
      effective: { value: null, status: 'unverified', source: 'runtime-effective-capability.observation', reason: 'no-current-run-capability-profile' },
    },
    grants: {
      configured: { value: null, status: 'unverified', source: 'runtime', reason: null },
      effective: {
        value: { total: 1, allowed: grantState === 'active' ? 1 : 0, requiresApproval: 0, denied: grantState === 'revoked' ? 1 : 0, unknown: 0, actions: [{ actionId: 'exec', authorization: grantState === 'active' ? 'allowed' : 'denied', grantState }] },
        status: 'effective',
        source: 'runtime-effective-capability.observation',
        reason: null,
      },
    },
    context: {
      configured: { value: { contextTokens: 160_000, contextPressure: null }, status: 'configured', source: 'config', reason: null },
      effective: { value: null, status: 'unverified', source: 'session', reason: 'no fresh context-budget observation for the current generation' },
    },
    queue: {
      configured: { value: { mode: 'followup', cap: 2, drop: 'old', debounceMs: null, queuedCount: 0 }, status: 'configured', source: 'session.entry.queue', reason: null },
      effective: { value: { mode: 'followup', cap: 2, drop: 'old', debounceMs: null, queuedCount: 0 }, status: 'effective', source: 'session.entry.queue', reason: null },
    },
    resources: {
      configured: { value: { maxConcurrentRuns: 2, maxConcurrentSubagents: 4, maxSpawnDepth: 2, maxChildrenPerAgent: 8, maxProcesses: null, maxRssMb: null, maxBackgroundTerminals: null, maxWorktrees: null, idleTtlMs: null, keepOnLeave: null }, status: 'configured', source: 'agents.defaults', reason: null },
      effective: { value: null, status: 'unverified', source: 'runtime.resource-owner', reason: 'current scheduler admission was not read by this snapshot' },
    },
    schedule: {
      configured: { value: { cronEnabled: false, cronMaxConcurrentRuns: null, sessionRetention: null }, status: 'configured', source: 'cron configuration', reason: null },
      effective: { value: null, status: 'unverified', source: 'cron.owner', reason: 'current schedule state is not part of this read' },
    },
    compatibility: [],
    sources: ['session.entry', 'runtime-effective-capability.observation'],
  };
}

function snapshotWithPolicy(workspaceId: string, nextPolicy = policy(workspaceId)): SessionActivitySnapshot {
  const snapshot = createEmptySessionActivitySnapshot(SESSION_KEY, 50);
  snapshot.policy = nextPolicy;
  snapshot.backgroundRead = { state: 'known', readAt: 50, failedAt: null };
  snapshot.session.updatedAt = 10;
  return snapshot;
}

function success(snapshot: SessionActivitySnapshot) {
  return { success: true, snapshot, runtimeAvailable: true };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('session activity request and workspace scope', () => {
  beforeEach(() => {
    disposeSessionActivitySubscriptions();
    useSessionActivityStore.setState({ snapshots: {}, initialized: false });
    mocks.snapshot.mockReset();
    mocks.runtimeHandler = null;
  });

  it('does not let an older request overwrite the newest backend policy', async () => {
    const first = deferred<ReturnType<typeof success>>();
    const second = deferred<ReturnType<typeof success>>();
    mocks.snapshot
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const firstLoad = useSessionActivityStore.getState().load({ workspaceId: 'workspace-a', sessionKey: SESSION_KEY });
    const secondLoad = useSessionActivityStore.getState().load({ workspaceId: 'workspace-a', sessionKey: SESSION_KEY });

    second.resolve(success(snapshotWithPolicy('workspace-a', policy('workspace-a', 'openclaw'))));
    await secondLoad;
    first.resolve(success(snapshotWithPolicy('workspace-a', policy('workspace-a', 'codex'))));
    await firstLoad;

    expect(useSessionActivityStore.getState().snapshots[SESSION_KEY].policy?.backend.configured.value?.runtime).toBe('openclaw');
  });

  it('drops same-key rows immediately when the workspace scope changes', async () => {
    mocks.snapshot.mockResolvedValueOnce(success(snapshotWithPolicy('workspace-a')));
    await useSessionActivityStore.getState().load({ workspaceId: 'workspace-a', sessionKey: SESSION_KEY });

    const next = deferred<ReturnType<typeof success>>();
    mocks.snapshot.mockReturnValueOnce(next.promise);
    const nextLoad = useSessionActivityStore.getState().load({ workspaceId: 'workspace-b', sessionKey: SESSION_KEY });

    expect(useSessionActivityStore.getState().snapshots[SESSION_KEY].policy).toBeUndefined();
    next.resolve(success(snapshotWithPolicy('workspace-b')));
    await nextLoad;
    expect(useSessionActivityStore.getState().snapshots[SESSION_KEY].policy?.scope.workspaceId).toBe('workspace-b');
  });

  it('rejects a response carrying another workspace policy', async () => {
    mocks.snapshot.mockResolvedValueOnce(success(snapshotWithPolicy('workspace-b')));

    const result = await useSessionActivityStore.getState().load({ workspaceId: 'workspace-a', sessionKey: SESSION_KEY });

    expect(result.policy).toBeUndefined();
    expect(result.backgroundRead.failedAt).not.toBeNull();
  });

  it('refreshes policy after an approval or authorization event', async () => {
    mocks.snapshot
      .mockResolvedValueOnce(success(snapshotWithPolicy('workspace-a', policy('workspace-a', 'openclaw', 'active'))))
      .mockResolvedValueOnce(success(snapshotWithPolicy('workspace-a', policy('workspace-a', 'openclaw', 'revoked'))));

    await useSessionActivityStore.getState().load({ workspaceId: 'workspace-a', sessionKey: SESSION_KEY });
    expect(useSessionActivityStore.getState().snapshots[SESSION_KEY].policy?.grants.effective.value?.allowed).toBe(1);

    mocks.runtimeHandler?.({ type: 'approval.updated', sessionKey: SESSION_KEY, status: 'approved', ts: 100 });

    await vi.waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => {
      expect(useSessionActivityStore.getState().snapshots[SESSION_KEY].policy?.grants.effective.value?.denied).toBe(1);
    });
  });
});
