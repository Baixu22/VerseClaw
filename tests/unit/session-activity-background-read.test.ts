/**
 * #121 — "the background read failed" must be distinguishable from "there is
 * genuinely no background activity", end to end.
 *
 * The two halves pinned here:
 *   1. the Main service derives the read state from everything it can actually
 *      observe (`electron/services/session-activity-api.ts`) — an RPC that timed
 *      out, an owner read that threw, and an envelope without the projection are
 *      all "unknown", while a successful empty projection stays "known";
 *   2. the renderer store (`src/stores/session-activity.ts`) keeps the facts
 *      that are already on screen, marks the failed read, and returns to
 *      `known` after a successful re-read.
 *
 * The main-run state stays separate from this throughout: `session` describes
 * the run, `backgroundRead` describes whether the background facts were read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backgroundReadFailed,
  classifySessionActivity,
  createEmptySessionActivitySnapshot,
} from '@shared/types/session-activity';
import type { SessionActivitySnapshot } from '@shared/types/session-activity';

const { sessionActivitySnapshotMock } = vi.hoisted(() => ({
  sessionActivitySnapshotMock: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    sessionActivity: { snapshot: (...args: unknown[]) => sessionActivitySnapshotMock(...args) },
    git: { status: vi.fn(async () => ({ success: false })) },
  },
}));

/* The Main service composes git and the task ledger beside the background read;
 * both are irrelevant here and must not reach the real machine. */
vi.mock('@electron/services/git-api', () => ({
  createGitApi: () => ({ status: async () => ({ success: false }) }),
}));
vi.mock('@electron/services/task-ledger-api', () => ({
  createTaskLedgerApi: () => ({ snapshot: async () => ({ success: false }) }),
}));

import { createSessionActivityApi } from '@electron/services/session-activity-api';
import {
  disposeSessionActivitySubscriptions,
  useSessionActivityStore,
} from '@/stores/session-activity';

const SESSION_KEY = 'agent:main:main';

function runtimeSnapshot(
  overrides: Partial<SessionActivitySnapshot> & { ownerRead?: 'known' | 'unknown' } = {},
): Partial<SessionActivitySnapshot> & { ownerRead?: 'known' | 'unknown' } {
  return {
    session: {
      sessionKey: SESSION_KEY,
      runId: null,
      status: 'idle',
      startedAt: null,
      endedAt: null,
      error: null,
      updatedAt: 1,
    },
    tasks: [],
    subagents: [],
    goals: [],
    processes: [],
    lineage: [],
    continuity: { queueCount: 0, checkpoint: false, blockedReason: null },
    availability: { git: false, tasks: true, subagents: true, terminals: false, continuity: true },
    /* The gateway reports what it could observe about the DB-backed owner read;
     * a response without it is treated as unknown by Main, so a successful
     * fixture must carry it explicitly. */
    ownerRead: 'known',
    capturedAt: 4_242,
    ...overrides,
  };
}

function apiWithRpc(rpc: (method: string, params: unknown) => Promise<unknown>) {
  const dependencies = {
    gatewayManager: { rpc },
    terminalManager: { list: () => [] },
  } as unknown as Parameters<typeof createSessionActivityApi>[0];
  return createSessionActivityApi(dependencies);
}

type MainCase = {
  name: string;
  rpc: () => Promise<unknown>;
  state: 'known' | 'unknown';
  failed: boolean;
  runtimeAvailable: boolean;
};

const MAIN_CASES: MainCase[] = [
  {
    name: 'an RPC timeout is unknown, never an empty session',
    rpc: async () => {
      throw new Error('gateway RPC timed out after 15000ms');
    },
    state: 'unknown',
    failed: true,
    runtimeAvailable: false,
  },
  {
    name: 'an owner read exception is unknown, never an empty session',
    rpc: async () => {
      throw new Error('owner state database unavailable');
    },
    state: 'unknown',
    failed: true,
    runtimeAvailable: false,
  },
  {
    name: 'a response without the owner projection is unknown',
    rpc: async () => ({
      snapshot: {
        session: { sessionKey: SESSION_KEY, status: 'idle', updatedAt: 1 },
        tasks: [],
        subagents: [],
        capturedAt: 9,
      },
    }),
    state: 'unknown',
    failed: true,
    runtimeAvailable: false,
  },
  {
    name: 'an envelope without a snapshot is unknown',
    rpc: async () => ({}),
    state: 'unknown',
    failed: true,
    runtimeAvailable: false,
  },
  {
    name: 'a gateway without the method stays unknown without a failure mark',
    rpc: async () => {
      throw new Error('unknown method session.activitySnapshot');
    },
    state: 'unknown',
    failed: false,
    runtimeAvailable: false,
  },
  {
    name: 'a projection whose goal-wake owner read failed is unknown',
    rpc: async () => ({ snapshot: runtimeSnapshot({ ownerRead: 'unknown' }) }),
    state: 'unknown',
    failed: true,
    runtimeAvailable: false,
  },
  {
    name: 'a projection that omits the owner-read state is unknown, not a successful empty read',
    rpc: async () => {
      const snapshot = runtimeSnapshot();
      delete (snapshot as { ownerRead?: 'known' | 'unknown' }).ownerRead;
      return { snapshot };
    },
    state: 'unknown',
    failed: false,
    runtimeAvailable: false,
  },
  {
    name: 'a successful empty read is known',
    rpc: async () => ({ snapshot: runtimeSnapshot() }),
    state: 'known',
    failed: false,
    runtimeAvailable: true,
  },
  {
    name: 'a finished main run with live background work stays known',
    rpc: async () => ({
      snapshot: runtimeSnapshot({
        session: {
          sessionKey: SESSION_KEY,
          runId: 'run-1',
          status: 'completed',
          startedAt: 100,
          endedAt: 1_000,
          error: null,
          updatedAt: 1_000,
        },
        subagents: [
          {
            id: 'child-1',
            role: 'explorer',
            status: 'started',
            childSessionKey: 'agent:explorer:child-1',
            updatedAt: 900,
            source: 'snapshot',
          },
        ],
        processes: [
          { id: 'proc-1', kind: 'bash', label: 'Process proc-1', status: 'running', updatedAt: 900 },
        ],
        goals: [{ id: 'goal-1', kind: 'flow', label: 'Goal wait goal-1', status: 'waiting', updatedAt: 900 }],
      }),
    }),
    state: 'known',
    failed: false,
    runtimeAvailable: true,
  },
];

describe('session activity background read (Main service)', () => {
  it.each(MAIN_CASES)('$name', async (testCase) => {
    const result = await apiWithRpc(testCase.rpc).snapshot({ sessionKey: SESSION_KEY });

    expect(result.snapshot.backgroundRead.state).toBe(testCase.state);
    expect(backgroundReadFailed(result.snapshot.backgroundRead)).toBe(testCase.failed);
    expect(result.runtimeAvailable).toBe(testCase.runtimeAvailable);
  });

  it('keeps a successful empty read as a fact: known, dated, and warning-free', async () => {
    const result = await apiWithRpc(async () => ({ snapshot: runtimeSnapshot() }))
      .snapshot({ sessionKey: SESSION_KEY });

    expect(result.snapshot.backgroundRead).toEqual({ state: 'known', readAt: 4_242, failedAt: null });
    expect(result.snapshot.goals).toEqual([]);
    expect(result.snapshot.processes).toEqual([]);
    expect(result.snapshot.lineage).toEqual([]);
    /* The normal empty state must not raise the unknown warning. */
    expect(backgroundReadFailed(result.snapshot.backgroundRead)).toBe(false);
  });

  it('keeps background activity after the main run ended', async () => {
    const liveCase = MAIN_CASES[MAIN_CASES.length - 1];
    const result = await apiWithRpc(liveCase.rpc).snapshot({ sessionKey: SESSION_KEY });

    expect(result.snapshot.session.status).toBe('completed');
    expect(result.snapshot.subagents.map((agent) => agent.id)).toEqual(['child-1']);
    expect(result.snapshot.processes.map((process) => process.id)).toEqual(['proc-1']);
    expect(result.snapshot.goals.map((goal) => goal.id)).toEqual(['goal-1']);
    /* Live background work must still reach the panel after the run closed. */
    expect(classifySessionActivity(result.snapshot)).not.toBe('none');
  });
  it('forwards the canonical workspace id into the runtime policy read', async () => {
    const rpc = vi.fn(async () => ({ snapshot: runtimeSnapshot() }));
    await apiWithRpc(rpc).snapshot({ workspaceId: 'workspace-a', sessionKey: SESSION_KEY });
    expect(rpc).toHaveBeenCalledWith('session.activitySnapshot', {
      sessionKey: SESSION_KEY,
      workspaceId: 'workspace-a',
    });
  });
});

describe('session activity background read (renderer store)', () => {
  beforeEach(() => {
    disposeSessionActivitySubscriptions();
    useSessionActivityStore.setState({ snapshots: {}, initialized: false });
    sessionActivitySnapshotMock.mockReset();
  });

  function liveSnapshot(readAt: number): SessionActivitySnapshot {
    const snapshot = createEmptySessionActivitySnapshot(SESSION_KEY);
    snapshot.session = { ...snapshot.session, runId: 'run-1', status: 'completed', endedAt: 1_000, updatedAt: 1_000 };
    snapshot.subagents = [
      {
        id: 'child-1',
        role: 'explorer',
        status: 'started',
        childSessionKey: 'agent:explorer:child-1',
        updatedAt: 900,
        source: 'snapshot',
      },
    ];
    snapshot.processes = [
      { id: 'proc-1', kind: 'bash', label: 'Process proc-1', status: 'running', updatedAt: 900 },
    ];
    snapshot.capturedAt = readAt;
    snapshot.backgroundRead = { state: 'known', readAt, failedAt: null };
    return snapshot;
  }

  it('does not present a failed first read as a successful empty read', async () => {
    sessionActivitySnapshotMock.mockRejectedValue(new Error('host bridge unavailable'));

    const snapshot = await useSessionActivityStore.getState().load({ sessionKey: SESSION_KEY });

    expect(snapshot.backgroundRead.state).toBe('unknown');
    expect(snapshot.backgroundRead.readAt).toBeNull();
    expect(backgroundReadFailed(snapshot.backgroundRead)).toBe(true);
    expect(classifySessionActivity(snapshot)).toBe('attention');
  });

  it('retains live background facts when a re-read fails and marks them stale', async () => {
    sessionActivitySnapshotMock.mockResolvedValueOnce({
      success: true,
      runtimeAvailable: true,
      snapshot: liveSnapshot(5_000),
    });
    const first = await useSessionActivityStore.getState().load({ sessionKey: SESSION_KEY });
    expect(first.backgroundRead).toEqual({ state: 'known', readAt: 5_000, failedAt: null });

    sessionActivitySnapshotMock.mockRejectedValueOnce(new Error('gateway RPC timed out'));
    const failed = await useSessionActivityStore.getState().load({ sessionKey: SESSION_KEY });

    /* The read failed ... */
    expect(failed.backgroundRead.state).toBe('unknown');
    expect(backgroundReadFailed(failed.backgroundRead)).toBe(true);
    /* ... but the facts stay, dated at the last success so they read as stale. */
    expect(failed.backgroundRead.readAt).toBe(5_000);
    expect(failed.subagents.map((agent) => agent.id)).toEqual(['child-1']);
    expect(failed.processes.map((process) => process.id)).toEqual(['proc-1']);
    expect(failed.session.status).toBe('completed');
  });

  it('marks a host-reported unknown read without inventing a failure for an unsupported host', async () => {
    sessionActivitySnapshotMock.mockResolvedValueOnce({
      success: true,
      runtimeAvailable: true,
      snapshot: liveSnapshot(5_000),
    });
    await useSessionActivityStore.getState().load({ sessionKey: SESSION_KEY });

    const unsupported = { ...liveSnapshot(0), backgroundRead: { state: 'unknown' as const, readAt: null, failedAt: null } };
    sessionActivitySnapshotMock.mockResolvedValueOnce({ success: true, runtimeAvailable: false, snapshot: unsupported });
    const result = await useSessionActivityStore.getState().load({ sessionKey: SESSION_KEY });

    expect(result.backgroundRead).toEqual({ state: 'unknown', readAt: 5_000, failedAt: null });
    expect(backgroundReadFailed(result.backgroundRead)).toBe(false);
  });

  it('returns to known/current after a successful re-read', async () => {
    sessionActivitySnapshotMock.mockRejectedValueOnce(new Error('host bridge unavailable'));
    await useSessionActivityStore.getState().load({ sessionKey: SESSION_KEY });

    sessionActivitySnapshotMock.mockResolvedValueOnce({
      success: true,
      runtimeAvailable: true,
      snapshot: liveSnapshot(9_000),
    });
    const recovered = await useSessionActivityStore.getState().load({ sessionKey: SESSION_KEY });

    expect(recovered.backgroundRead).toEqual({ state: 'known', readAt: 9_000, failedAt: null });
    expect(backgroundReadFailed(recovered.backgroundRead)).toBe(false);
    expect(classifySessionActivity(recovered)).toBe('active');
  });
});
