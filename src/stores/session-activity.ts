import { create } from 'zustand';
import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';
import type {
  ClawGraphLifecycleEvent,
  SubagentRuntimeLifecycleEvent,
  TaskLoopLifecycleEvent,
  TerminalExitEvent,
  TerminalSessionEvent,
} from '@shared/host-events/contract';
import type { MissionLifecycleEvent } from '@shared/types/mission-control';
import type {
  SessionActivityBackgroundRead,
  SessionActivityMockScenario,
  SessionActivitySnapshot,
  SessionActivitySubagent,
  SessionActivityTask,
  SessionActivityTerminal,
  SessionActivityTerminalKind,
  SessionActivityTerminalStatus,
} from '@shared/types/session-activity';
import { createEmptySessionActivitySnapshot } from '@shared/types/session-activity';
import { subagentLifecycleIdentityKey } from '@shared/subagent-lifecycle';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { trajectoryViewFeed, type TrajectoryView } from '@/lib/trajectory-view';
import { TrajectoryAssembler, type TrajectoryEventV2, type TrajectoryViewNode } from '@/lib/trajectory-assembler';
import { lifecycleDefinitions, type LifecycleData } from '@/lib/trajectory-view/lifecycle';

type SessionActivityEvent =
  | { channel: 'runtime'; payload: ChatRuntimeEvent }
  | { channel: 'queue'; payload: { sessionKey: string; queueCount: number } }
  | { channel: 'subagent'; payload: SubagentRuntimeLifecycleEvent }
  | { channel: 'taskLoop'; payload: TaskLoopLifecycleEvent }
  | { channel: 'mission'; payload: MissionLifecycleEvent }
  | { channel: 'clawGraph'; payload: ClawGraphLifecycleEvent }
  | { channel: 'terminal'; payload: TerminalSessionEvent | TerminalExitEvent }
  | { channel: 'command'; payload: ChatRuntimeEvent & { type: 'command.output' } };

const sessionSnapshots = new Map<string, SessionActivitySnapshot>();
const snapshotScopes = new Map<string, string | null>();
const latestLoadRequestBySession = new Map<string, number>();
const eventUnsubscribers: Array<() => void> = [];
const mockTimers = new Map<string, ReturnType<typeof setTimeout>[]>();
type TrajectorySubscription = {
  workspaceId: string | null;
  owner: SessionActivitySnapshot['session'];
  // Retain only a run identity actually observed in this generation's owner read.
  runId: string | null;
  unsubscribe: () => void;
};
const trajectorySubscriptions = new Map<string, TrajectorySubscription>();
const trajectoryViews = new Map<string, TrajectoryView>();
let initialized = false;
let loadRequestSequence = 0;

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function eventTime(payload: Record<string, unknown>, fallback = Date.now()): number {
  return asFiniteNumber(payload.ts ?? payload.updatedAt ?? payload.endedAt ?? payload.startedAt ?? payload.createdAt) ?? fallback;
}

function eventSessionKey(payload: Record<string, unknown>): string | null {
  const sessionKey = payload.sessionKey ?? payload.childSessionKey;
  return typeof sessionKey === 'string' && sessionKey.length > 0 ? sessionKey : null;
}

/**
 * Which session's snapshot an event belongs to.
 *
 * A sub-agent lifecycle event describes the activity of the session that
 * SPAWNED the worker; its `childSessionKey` names the worker's own session.
 * The generic `sessionKey ?? childSessionKey` fallback therefore files a worker
 * under its own snapshot when the parent key is missing, and the parent's
 * status card — the only place the worker was going to be listed — never sees
 * it. Every other channel reports about the session it names, so they keep the
 * generic resolution.
 */
function routingSessionKey(event: SessionActivityEvent): string | null {
  const payload = event.payload as unknown as Record<string, unknown>;
  if (event.channel === 'subagent') {
    const parent = payload.sessionKey;
    return typeof parent === 'string' && parent.length > 0 ? parent : null;
  }
  return eventSessionKey(payload);
}

function shouldApply(updatedAt: number, current: number): boolean {
  return updatedAt >= current;
}

function normalizeWorkspaceScope(workspaceId: string | null | undefined): string | null {
  return workspaceId?.trim() || null;
}

function policyMatchesScope(
  snapshot: SessionActivitySnapshot,
  workspaceId: string | null,
  sessionKey: string,
): boolean {
  if (snapshot.session.sessionKey !== sessionKey) return false;
  const policy = snapshot.policy;
  if (!policy) return true;
  if (policy.scope.sessionKey !== sessionKey) return false;
  return workspaceId === null || policy.scope.workspaceId === workspaceId;
}

function markPolicyRefreshPending(snapshot: SessionActivitySnapshot): SessionActivitySnapshot {
  if (!snapshot.policy) return snapshot;
  return {
    ...snapshot,
    policy: {
      ...snapshot.policy,
      generation: {
        ...snapshot.policy.generation,
        state: 'stale',
        reason: 'refresh-pending',
      },
    },
  };
}

function taskStatus(status: string): SessionActivityTask['status'] {
  if (status === 'doing' || status === 'running') return 'running';
  if (status === 'review') return 'review';
  if (status === 'blocked') return 'blocked';
  if (status === 'done' || status === 'complete' || status === 'completed') return 'completed';
  if (status === 'dropped' || status === 'aborted') return 'aborted';
  if (status === 'failed' || status === 'error') return 'failed';
  return 'queued';
}

function terminalStatus(status: string | undefined, exitCode?: number | null): SessionActivityTerminalStatus {
  if (status === 'running' || status === 'starting' || status === 'idle' || status === 'blocked') return status;
  if (status === 'error') return 'error';
  if (status === 'exited') return exitCode && exitCode !== 0 ? 'error' : 'completed';
  return 'idle';
}

function terminalKind(kind: TerminalSessionEvent['kind'] | undefined): SessionActivityTerminalKind {
  return kind === 'webPreviewDevServer' ? 'webPreviewDevServer' : 'interactive';
}

/**
 * Merge by id, newest-wins per field.
 *
 * `undefined` in the incoming item means "this event did not carry the field",
 * not "clear it". Runtimes commonly report identity fields (`childSessionKey`,
 * `task`) on the opening event only, so a plain object spread would erase them
 * the moment the closing event arrived — and a sub-agent that lost its child
 * session key silently stops being openable.
 */
function upsert<T extends { id: string; updatedAt: number }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [...items, next];
  if (!shouldApply(next.updatedAt, items[index].updatedAt)) return items;
  const defined = Object.fromEntries(
    Object.entries(next).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
  const copy = items.slice();
  copy[index] = { ...items[index], ...defined };
  return copy;
}

/**
 * Folds one background read result into the state already on screen.
 *
 * A successful read is authoritative and replaces the previous one. A failed
 * read leaves the facts alone and keeps `readAt` at the last success, so the
 * panel can mark retained rows as stale instead of presenting them as fresh —
 * and so a first read that fails shows nothing rather than an empty session.
 */
function mergeBackgroundRead(
  previous: SessionActivityBackgroundRead | undefined,
  incoming: SessionActivityBackgroundRead | undefined,
): SessionActivityBackgroundRead {
  if (incoming?.state === 'known') return incoming;
  return {
    state: 'unknown',
    readAt: previous?.readAt ?? null,
    /* An unknown read that carries no failure mark is "this build has no
     * background source" (an unsupported RPC), not a failure: keep it silent. */
    failedAt: incoming ? incoming.failedAt : Date.now(),
  };
}

export function reduceSessionActivity(snapshot: SessionActivitySnapshot, event: SessionActivityEvent): SessionActivitySnapshot {
  const payload = event.payload as unknown as Record<string, unknown>;
  const key = routingSessionKey(event);
  if (key && key !== snapshot.session.sessionKey) return snapshot;
  const updatedAt = eventTime(payload);
  const next = { ...snapshot, capturedAt: Math.max(snapshot.capturedAt, updatedAt) };

  if (event.channel === 'runtime') {
    const runtime = event.payload;
    if (runtime.type === 'approval.updated' && ['pending', 'requested', 'waiting'].includes(String(runtime.status))) {
      next.continuity = { ...snapshot.continuity,
        blockedReason: runtime.message ?? runtime.title ?? snapshot.continuity.blockedReason };
      return next;
    }
    return snapshot;
  }

  if (event.channel === 'queue') {
    next.continuity = { ...next.continuity, queueCount: Math.max(0, event.payload.queueCount) };
    return next;
  }

  if (event.channel === 'command') {
    const command = event.payload;
    const id = command.itemId ?? command.toolCallId ?? `command:${updatedAt}`;
    const status = String(command.status ?? 'completed');
    const commandTerminal: SessionActivityTerminal = {
      id,
      kind: 'agentCommand',
      cwd: command.cwd ?? null,
      status: status === 'error' || status === 'failed' ? 'error' : 'completed',
      exitCode: command.exitCode ?? null,
      updatedAt,
    };
    return { ...next, terminals: upsert(next.terminals, commandTerminal), availability: { ...next.availability, terminals: true } };
  }

  if (event.channel === 'subagent') {
    const data = event.payload;
    const subagent: SessionActivitySubagent = {
      id: subagentLifecycleIdentityKey(data),
      role: data.roleName,
      task: data.task,
      summary: data.summary,
      error: data.error,
      status: data.status === 'accepted' ? 'started' : data.status,
      childSessionKey: data.childSessionKey,
      agentId: data.agentId,
      updatedAt,
      source: 'event',
    };
    return { ...next, subagents: upsert(next.subagents, subagent), availability: { ...next.availability, subagents: true } };
  }

  if (event.channel === 'taskLoop') {
    const data = event.payload;
    const task: SessionActivityTask = {
      id: data.loopRunId,
      kind: 'taskLoop',
      title: `Task Loop ${data.loopRunId}`,
      status: taskStatus(data.status),
      progress: asFiniteNumber(data.progress),
      phase: data.phase,
      updatedAt,
      source: 'event',
    };
    next.tasks = upsert(next.tasks, task);
    next.availability = { ...next.availability, tasks: true };
    if (data.status === 'blocked') next.continuity = { ...next.continuity, blockedReason: data.blockedReason ?? data.error ?? null };
    return next;
  }

  if (event.channel === 'mission') {
    const data = event.payload;
    const task: SessionActivityTask = {
      id: data.missionId,
      kind: 'mission',
      title: `Mission ${data.missionId}`,
      status: taskStatus(data.status),
      progress: asFiniteNumber(data.progress),
      phase: data.phase,
      updatedAt,
      source: 'event',
    };
    next.tasks = upsert(next.tasks, task);
    next.availability = { ...next.availability, tasks: true };
    if (data.status === 'blocked') next.continuity = { ...next.continuity, blockedReason: data.blockedReason ?? data.error ?? null };
    return next;
  }

  if (event.channel === 'clawGraph') {
    const { snapshot: graph } = event.payload;
    const task: SessionActivityTask = {
      id: graph.runId,
      kind: 'clawGraph',
      title: graph.title || graph.workflowId,
      status: taskStatus(graph.status),
      progress: asFiniteNumber(graph.progress),
      updatedAt,
      source: 'event',
    };
    return { ...next, tasks: upsert(next.tasks, task), availability: { ...next.availability, tasks: true } };
  }

  if (event.channel === 'terminal') {
    const data = event.payload;
    const id = data.sessionId;
    const terminal: SessionActivityTerminal = {
      id,
      kind: terminalKind(data.kind),
      cwd: data.cwd,
      status: terminalStatus(data.status, 'exitCode' in data ? data.exitCode : null),
      exitCode: 'exitCode' in data ? data.exitCode : null,
      updatedAt,
    };
    return { ...next, terminals: upsert(next.terminals, terminal), availability: { ...next.availability, terminals: true } };
  }

  return next;
}

function mockScenario(): SessionActivityMockScenario {
  if (typeof window === 'undefined') return 'idle-clean';
  const params = new URLSearchParams(window.location.search);
  // Preserve the existing preview URL: `script=rail` showcases the activity panel.
  const value = params.get('mockScenario')
    ?? params.get('scenario')
    ?? (params.get('script') === 'rail' ? 'multi-subagent' : null);
  const scenarios: SessionActivityMockScenario[] = ['idle-clean', 'git-dirty', 'running-task', 'multi-subagent', 'terminal-active', 'blocked-recovery', 'completed-recently'];
  return scenarios.includes(value as SessionActivityMockScenario) ? value as SessionActivityMockScenario : 'idle-clean';
}

export function sessionFromTrajectory(
  view: TrajectoryView,
  owner?: SessionActivitySnapshot['session'],
  confirmedRunId: string | null | undefined = owner?.runId,
): SessionActivitySnapshot['session'] {
  // A session-key-only view cannot establish a physical generation or a new run.
  if (owner && (view.sessionKey !== owner.sessionKey || !owner.sessionId
    || !confirmedRunId || view.loading || view.error)) return owner;
  const run = view.nodes.filter((node) => node.data.role === 'run'
    && (!owner || node.data.runId === confirmedRunId)).at(-1)?.data;
  if (!run) return owner ?? createEmptySessionActivitySnapshot(view.sessionKey).session;
  // An idle owner may retain a known run's terminal display, never restart it.
  if (owner && !owner.runId && !['completed', 'failed', 'aborted'].includes(run.status)) return owner;
  return { ...owner, sessionKey: view.sessionKey, runId: run.runId, status: run.status,
    startedAt: run.startedAt, endedAt: run.endedAt, error: run.error, updatedAt: run.updatedAt };
}

const MOCK_TIME = Date.parse('2026-11-07T00:00:00.000Z');
function mockRunView(sessionKey: string, runId: string, status: 'running' | 'completed' | 'failed'): TrajectoryView {
  const assembler = new TrajectoryAssembler(lifecycleDefinitions);
  const start: TrajectoryEventV2 = { traceSchema: 'openclaw-trajectory', schemaVersion: 2, traceId: 'mock-trace',
    source: 'runtime', ts: new Date(MOCK_TIME - 12_000).toISOString(), seq: 1, type: 'run/start', role: 'run', phase: 'start', runId, state: { status: 'running' } };
  const events: TrajectoryEventV2[] = status === 'running' ? [start] : [start, { ...start,
    seq: 2, ts: new Date(MOCK_TIME - 4_000).toISOString(), type: 'run/end', phase: 'end', state: { status } }];
  assembler.replace(events);
  return { sessionKey, nodes: assembler.getNodes() as readonly TrajectoryViewNode<LifecycleData>[],
    lastSeq: events.length, legacyFallback: false, loading: false, error: false };
}

function mockSnapshot(sessionKey: string, scenario: SessionActivityMockScenario): SessionActivitySnapshot {
  const snapshot = createEmptySessionActivitySnapshot(sessionKey);
  const now = MOCK_TIME;
  if (scenario === 'git-dirty' || scenario === 'blocked-recovery') {
    snapshot.git = {
      isRepository: true, workspaceRoot: 'C:\\workspace', branch: 'feat/session-activity', ahead: 1, behind: 0,
      clean: false, hasConflicts: scenario === 'blocked-recovery', stagedCount: 1, unstagedCount: 2, untrackedCount: 0, conflictedCount: scenario === 'blocked-recovery' ? 1 : 0,
      changes: [{ path: 'src/pages/Chat/index.tsx', absolutePath: 'C:\\workspace\\src\\pages\\Chat\\index.tsx', status: 'M', staged: true, unstaged: true, untracked: false, conflicted: scenario === 'blocked-recovery', bucket: scenario === 'blocked-recovery' ? 'conflicted' : 'staged', additions: 42, deletions: 8 }],
    };
    snapshot.availability.git = true;
  }
  if (scenario === 'running-task' || scenario === 'multi-subagent') {
    snapshot.tasks = [{ id: 'mock-mission', kind: 'mission', title: 'Workspace implementation', status: 'running', progress: 0.42, phase: 'execute', updatedAt: now, source: 'snapshot' }];
    snapshot.availability.tasks = true;
  }
  if (scenario === 'multi-subagent') {
    /* Ids and `childSessionKey`s match what the `rail` run-script emits and what
     * `DEMO_CHILD_TRANSCRIPTS` in mock-host-bridge serves. Two consequences,
     * both wanted: clicking a row opens a populated transcript instead of the
     * "no transcript" arm, and a live run settles THESE rows rather than
     * appending a second copy of every worker — which is what hydrating from a
     * host snapshot and then receiving lifecycle events does in production.
     * Both start running so the section survives the completed-item retention
     * window while the demo is being looked at. */
    snapshot.subagents = [
      { id: 'rail-node-1', role: 'explorer', task: '检索 rail 相关渲染路径与既有组件', status: 'started', childSessionKey: 'agent:explorer:rail-scout', agentId: 'explorer', updatedAt: now - 5_000, source: 'snapshot' },
      { id: 'rail-node-2', role: 'reviewer', task: '核对 rail 与 composer 下拉的样式一致性', status: 'started', childSessionKey: 'agent:reviewer:rail-review', agentId: 'reviewer', updatedAt: now, source: 'snapshot' },
    ];
    snapshot.availability.subagents = true;
  }
  if (scenario === 'terminal-active') {
    snapshot.terminals = [{ id: 'mock-terminal', kind: 'interactive', cwd: 'C:\\workspace', status: 'running', updatedAt: now }];
    snapshot.availability.terminals = true;
  }
  if (scenario === 'blocked-recovery') {
    snapshot.continuity = { queueCount: 2, contextPressure: 'high', checkpoint: true, blockedReason: 'Checkpoint review required' };
  }
  if (scenario === 'completed-recently') {
    snapshot.tasks = [{ id: 'mock-task', kind: 'taskLoop', title: 'Verified task loop', status: 'completed', progress: 1, phase: 'complete', updatedAt: now - 4_000, source: 'snapshot' }];
    snapshot.availability.tasks = true;
  }
  if (scenario === 'running-task' || scenario === 'multi-subagent') snapshot.session = sessionFromTrajectory(mockRunView(sessionKey, 'mock-run', 'running'));
  if (scenario === 'blocked-recovery') snapshot.session = sessionFromTrajectory(mockRunView(sessionKey, 'mock-recovery', 'failed'));
  if (scenario === 'completed-recently') snapshot.session = sessionFromTrajectory(mockRunView(sessionKey, 'mock-completed', 'completed'));
  snapshot.capturedAt = now;
  return snapshot;
}

function scheduleMock(
  sessionKey: string,
  scenario: SessionActivityMockScenario,
  apply: (event: SessionActivityEvent) => void,
  complete: (view: TrajectoryView) => void,
): void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (scenario === 'running-task' || scenario === 'multi-subagent') {
    timers.push(setTimeout(() => complete(mockRunView(sessionKey, 'mock-run', 'completed')), 4_500));
  }
  if (scenario === 'multi-subagent') {
    // Match the seeded row so completion settles it instead of adding a duplicate.
    timers.push(setTimeout(() => apply({ channel: 'subagent', payload: {
      runId: 'mock-child', taskNodeId: 'rail-node-1', sessionKey, roleName: 'explorer',
      childSessionKey: 'agent:explorer:rail-scout', agentId: 'explorer', status: 'completed',
      summary: '已定位 3 处可复用组件', ts: MOCK_TIME + 3_200,
    } }), 3_200));
  }
  mockTimers.set(sessionKey, timers);
}

export type SessionActivityState = {
  snapshots: Record<string, SessionActivitySnapshot>;
  scopedSnapshots: Record<string, SessionActivitySnapshot>;
  initialized: boolean;
  init: () => void;
  load: (input: { workspaceId?: string | null; sessionKey: string }) => Promise<SessionActivitySnapshot>;
  apply: (event: SessionActivityEvent) => void;
  refreshGit: (workspaceId?: string | null, sessionKey?: string) => Promise<void>;
};

export function sessionActivityScopeKey(workspaceId: string | null | undefined, sessionKey: string): string {
  return JSON.stringify([normalizeWorkspaceScope(workspaceId), sessionKey]);
}

export function selectSessionActivitySnapshot(state: SessionActivityState, workspaceId: string | null | undefined,
  sessionKey: string, generation?: string): SessionActivitySnapshot | undefined {
  const snapshot = state.scopedSnapshots[sessionActivityScopeKey(workspaceId, sessionKey)];
  if (generation && snapshot?.session.sessionId && snapshot.session.sessionId !== generation) return undefined;
  return snapshot;
}

export const useSessionActivityStore = create<SessionActivityState>((set, get) => {
  const publishSnapshot = (workspaceId: string | null, snapshot: SessionActivitySnapshot) => {
    const key = snapshot.session.sessionKey;
    sessionSnapshots.set(key, snapshot);
    set((state) => ({ snapshots: { ...state.snapshots, [key]: snapshot },
      scopedSnapshots: { ...state.scopedSnapshots, [sessionActivityScopeKey(workspaceId, key)]: snapshot } }));
  };
  const disconnectTrajectory = (key: string) => {
    const subscription = trajectorySubscriptions.get(key);
    trajectorySubscriptions.delete(key);
    trajectoryViews.delete(key);
    subscription?.unsubscribe();
  };
  const applyTrajectory = (key: string, subscription: TrajectorySubscription, view: TrajectoryView) => {
    if (trajectorySubscriptions.get(key) !== subscription || view.sessionKey !== key
      || snapshotScopes.get(key) !== subscription.workspaceId) return;
    const current = get().snapshots[key];
    if (!current || !subscription.owner.sessionId
      || current.session.sessionId !== subscription.owner.sessionId) return;
    const previous = trajectoryViews.get(key);
    if (previous && view.lastSeq < previous.lastSeq) return;
    trajectoryViews.set(key, view);
    const projected = sessionFromTrajectory(view, subscription.owner, subscription.runId);
    if (projected === subscription.owner) return;
    publishSnapshot(subscription.workspaceId, {
      ...current, session: { ...current.session, ...projected },
      capturedAt: Math.max(current.capturedAt, projected.updatedAt),
    });
  };
  const connectTrajectory = (
    key: string,
    workspaceId: string | null,
    owner: SessionActivitySnapshot['session'],
  ) => {
    if (!owner.sessionId) {
      disconnectTrajectory(key);
      return;
    }
    const current = trajectorySubscriptions.get(key);
    if (current?.workspaceId === workspaceId && current.owner.sessionId === owner.sessionId) {
      current.owner = owner;
      // A null active run does not revoke a same-generation run's proven history.
      if (owner.runId) current.runId = owner.runId;
      const view = trajectoryViews.get(key);
      if (view) applyTrajectory(key, current, view);
      return current;
    }
    disconnectTrajectory(key);
    const subscription: TrajectorySubscription = {
      workspaceId, owner, runId: owner.runId ?? null, unsubscribe: () => {},
    };
    // connect publishes synchronously; install the token before registering.
    trajectorySubscriptions.set(key, subscription);
    subscription.unsubscribe = trajectoryViewFeed.connect(key, (view) => applyTrajectory(key, subscription, view));
    return subscription;
  };
  const applyEvent = (event: SessionActivityEvent) => {
    const key = routingSessionKey(event);
    if (!key) return;
    const current = get().snapshots[key] ?? createEmptySessionActivitySnapshot(key);
    const generation = (event.channel === 'runtime' || event.channel === 'command') && 'sessionId' in event.payload
      ? event.payload.sessionId : undefined;
    if (generation && current.session.sessionId && generation !== current.session.sessionId) return;
    const workspaceId = snapshotScopes.get(key) ?? null;
    const next = reduceSessionActivity(current, event);
    if (next !== current) publishSnapshot(workspaceId, next);
    if (event.channel === 'runtime') {
      // Runtime notifications request owner confirmation; they do not assign run identity.
      if (event.payload.type === 'approval.updated' || event.payload.type === 'run.started'
        || event.payload.type === 'run.ended') {
        void get().load({ workspaceId, sessionKey: key });
      } else if (trajectorySubscriptions.has(key)) {
        void trajectoryViewFeed.refresh(key);
      }
    }
  };

  return {
    snapshots: {},
    scopedSnapshots: {},
    initialized: false,
    init: () => {
      if (initialized) return;
      initialized = true;
      eventUnsubscribers.push(
        hostEvents.onChatRuntimeEvent((payload) => applyEvent({ channel: payload.type === 'command.output' ? 'command' : 'runtime', payload } as SessionActivityEvent)),
        hostEvents.onChatQueueStatus((payload) => applyEvent({ channel: 'queue', payload })),
        hostEvents.onSubagentLifecycle((payload) => applyEvent({ channel: 'subagent', payload })),
        hostEvents.onTaskLoopLifecycle((payload) => applyEvent({ channel: 'taskLoop', payload })),
        hostEvents.onMissionControlLifecycle((payload) => applyEvent({ channel: 'mission', payload })),
        hostEvents.onClawGraphLifecycle((payload) => applyEvent({ channel: 'clawGraph', payload })),
        hostEvents.onTerminalRegistered((payload) => applyEvent({ channel: 'terminal', payload })),
        hostEvents.onTerminalStatusChanged((payload) => applyEvent({ channel: 'terminal', payload })),
        hostEvents.onTerminalExit((payload) => applyEvent({ channel: 'terminal', payload })),
      );
    },
    load: async ({ workspaceId, sessionKey }) => {
      get().init();
      const requestedWorkspaceId = normalizeWorkspaceScope(workspaceId);
      const requestId = ++loadRequestSequence;
      latestLoadRequestBySession.set(sessionKey, requestId);
      const isCurrentRequest = () => latestLoadRequestBySession.get(sessionKey) === requestId
        && snapshotScopes.get(sessionKey) === requestedWorkspaceId;
      const isMockMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mock') === '1';
      /*
       * Keep same-scope facts while refreshing so a failed re-read remains
       * visible as stale. A different workspace must not reuse the prior
       * session's rows merely because the session key collides.
       */
      const previousScope = snapshotScopes.get(sessionKey);
      const sameScope = previousScope === undefined || previousScope === requestedWorkspaceId;
      const scopedKey = sessionActivityScopeKey(requestedWorkspaceId, sessionKey);
      const previous = get().scopedSnapshots[scopedKey] ?? (sameScope ? get().snapshots[sessionKey] : undefined);
      if (!sameScope || isMockMode) disconnectTrajectory(sessionKey);
      for (const timer of mockTimers.get(sessionKey) ?? []) clearTimeout(timer);
      mockTimers.delete(sessionKey);
      snapshotScopes.set(sessionKey, requestedWorkspaceId);
      const initial = isMockMode
        ? mockSnapshot(sessionKey, mockScenario())
        : markPolicyRefreshPending(previous ?? createEmptySessionActivitySnapshot(sessionKey));
      publishSnapshot(requestedWorkspaceId, initial);
      if (isMockMode
        && (initial.session.status !== 'idle' || initial.git || initial.tasks.length || initial.terminals.length)) {
        scheduleMock(sessionKey, mockScenario(), (event) => {
          if (isCurrentRequest()) applyEvent(event);
        }, (view) => {
          if (!isCurrentRequest()) return;
          const current = get().snapshots[sessionKey];
          if (!current) return;
          publishSnapshot(requestedWorkspaceId, {
            ...current, session: { ...current.session, ...sessionFromTrajectory(view) },
          });
        });
      }

      if (isMockMode) {
        /* Git comes from the same host fixture as the review tab. */
        void get().refreshGit(workspaceId, sessionKey);
        return initial;
      }

      const [activityResult] = await Promise.allSettled([
        hostApi.sessionActivity.snapshot({ workspaceId: requestedWorkspaceId, sessionKey }),
      ]);
      if (!isCurrentRequest()) return get().snapshots[sessionKey] ?? initial;
      const current = get().snapshots[sessionKey] ?? initial;
      const candidate = activityResult.status === 'fulfilled'
        && activityResult.value.success
        && activityResult.value.snapshot
        ? activityResult.value.snapshot
        : null;
      const hydrated = candidate && policyMatchesScope(candidate, requestedWorkspaceId, sessionKey)
        ? candidate
        : null;
      let snapshot: SessionActivitySnapshot;
      if (hydrated) {
        const generationChanged = Boolean(hydrated.session.sessionId
          && current.session.sessionId !== hydrated.session.sessionId);
        const runChanged = (current.session.runId ?? null) !== (hydrated.session.runId ?? null);
        const mergeItems = <T extends { id: string; updatedAt: number }>(base: T[], incoming: T[]) => incoming.reduce(upsert, generationChanged ? [] : base);
        snapshot = {
          ...current,
          ...hydrated,
          session: generationChanged || runChanged || hydrated.session.updatedAt >= current.session.updatedAt
            ? { ...current.session, ...hydrated.session, sessionKey,
              sessionId: hydrated.session.sessionId ?? current.session.sessionId }
            : current.session,
          tasks: mergeItems(current.tasks, hydrated.tasks),
          subagents: mergeItems(current.subagents, hydrated.subagents),
          terminals: mergeItems(current.terminals, hydrated.terminals),
          continuity: { ...current.continuity, ...hydrated.continuity },
          availability: { ...current.availability, ...hydrated.availability },
          backgroundRead: mergeBackgroundRead(current.backgroundRead, hydrated.backgroundRead),
          capturedAt: Math.max(current.capturedAt, hydrated.capturedAt),
        };
      } else {
        /* A failed owner read retains same-scope facts as stale. */
        snapshot = {
          ...current,
          backgroundRead: mergeBackgroundRead(current.backgroundRead, undefined),
        };
      }
      publishSnapshot(requestedWorkspaceId, snapshot);
      if (!isCurrentRequest()) return get().snapshots[sessionKey] ?? snapshot;
      if (!hydrated) return snapshot;
      // Bind only the unmodified owner response, never a trajectory-derived identity.
      const subscription = connectTrajectory(sessionKey, requestedWorkspaceId, hydrated.session);
      if (subscription) await Promise.allSettled([trajectoryViewFeed.refresh(sessionKey)]);
      if (!isCurrentRequest()) return get().snapshots[sessionKey] ?? snapshot;
      return get().snapshots[sessionKey] ?? snapshot;
    },
    apply: applyEvent,
    refreshGit: async (workspaceId, sessionKey) => {
      if (!sessionKey) return;
      const requestedWorkspaceId = normalizeWorkspaceScope(workspaceId);
      const requestId = latestLoadRequestBySession.get(sessionKey);
      const generation = get().snapshots[sessionKey]?.session.sessionId;
      try {
        const result = await hostApi.git.status();
        if (!result.success
          || latestLoadRequestBySession.get(sessionKey) !== requestId
          || get().snapshots[sessionKey]?.session.sessionId !== generation
          || (snapshotScopes.has(sessionKey) && snapshotScopes.get(sessionKey) !== requestedWorkspaceId)) return;
        if (!snapshotScopes.has(sessionKey)) snapshotScopes.set(sessionKey, requestedWorkspaceId);
        const current = get().snapshots[sessionKey] ?? createEmptySessionActivitySnapshot(sessionKey);
        publishSnapshot(requestedWorkspaceId, {
          ...current, git: result.status, availability: { ...current.availability, git: true }, capturedAt: Date.now(),
        });
      } catch {
        // Git is an optional source; the rest of the panel remains available.
      }
    },
  };
});

export function disposeSessionActivitySubscriptions(): void {
  while (eventUnsubscribers.length) eventUnsubscribers.pop()?.();
  for (const timers of mockTimers.values()) timers.forEach(clearTimeout);
  mockTimers.clear();
  const subscriptions = [...trajectorySubscriptions.values()];
  trajectorySubscriptions.clear();
  for (const subscription of subscriptions) subscription.unsubscribe();
  trajectoryViews.clear();
  sessionSnapshots.clear();
  snapshotScopes.clear();
  latestLoadRequestBySession.clear();
  // Do not reuse request IDs after disposal while old promises can still settle.
  loadRequestSequence += 1;
  initialized = false;
  useSessionActivityStore.setState({ snapshots: {}, scopedSnapshots: {}, initialized: false });
}

export type { SessionActivityEvent };
