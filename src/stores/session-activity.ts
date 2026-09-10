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
const eventUnsubscribers: Array<() => void> = [];
const mockTimers = new Map<string, ReturnType<typeof setTimeout>[]>();
let initialized = false;

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

export function reduceSessionActivity(snapshot: SessionActivitySnapshot, event: SessionActivityEvent): SessionActivitySnapshot {
  const payload = event.payload as unknown as Record<string, unknown>;
  const key = routingSessionKey(event);
  if (key && key !== snapshot.session.sessionKey) return snapshot;
  const updatedAt = eventTime(payload);
  const next = { ...snapshot, capturedAt: Math.max(snapshot.capturedAt, updatedAt) };

  if (event.channel === 'runtime') {
    const runtime = event.payload;
    if (!shouldApply(updatedAt, snapshot.session.updatedAt)) return snapshot;
    if (runtime.type === 'run.started') {
      next.session = {
        ...snapshot.session,
        runId: runtime.runId,
        status: 'running',
        startedAt: runtime.startedAt ?? updatedAt,
        endedAt: null,
        error: null,
        updatedAt,
      };
    } else if (runtime.type === 'run.ended') {
      next.session = {
        ...snapshot.session,
        runId: runtime.runId,
        status: runtime.status === 'completed' ? 'completed' : runtime.status === 'aborted' ? 'aborted' : 'failed',
        endedAt: runtime.endedAt ?? updatedAt,
        error: runtime.error ?? null,
        updatedAt,
      };
    } else if ('phase' in runtime && typeof runtime.phase === 'string') {
      next.session = { ...snapshot.session, phase: runtime.phase, updatedAt };
    }
    if (runtime.type === 'approval.updated' && ['pending', 'requested', 'waiting'].includes(String(runtime.status))) {
      next.session = { ...next.session, status: 'waiting_approval', phase: runtime.phase ?? 'approval', updatedAt };
    }
    return next;
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
      status: data.status,
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

function mockSnapshot(sessionKey: string, scenario: SessionActivityMockScenario): SessionActivitySnapshot {
  const snapshot = createEmptySessionActivitySnapshot(sessionKey);
  const now = Date.now();
  if (scenario === 'git-dirty' || scenario === 'blocked-recovery') {
    snapshot.git = {
      isRepository: true, workspaceRoot: 'C:\\workspace', branch: 'feat/session-activity', ahead: 1, behind: 0,
      clean: false, hasConflicts: scenario === 'blocked-recovery', stagedCount: 1, unstagedCount: 2, untrackedCount: 0, conflictedCount: scenario === 'blocked-recovery' ? 1 : 0,
      changes: [{ path: 'src/pages/Chat/index.tsx', absolutePath: 'C:\\workspace\\src\\pages\\Chat\\index.tsx', status: 'M', staged: true, unstaged: true, untracked: false, conflicted: scenario === 'blocked-recovery', bucket: scenario === 'blocked-recovery' ? 'conflicted' : 'staged', additions: 42, deletions: 8 }],
    };
    snapshot.availability.git = true;
  }
  if (scenario === 'running-task' || scenario === 'multi-subagent') {
    snapshot.session = { ...snapshot.session, runId: 'mock-run', status: 'running', phase: 'execute', startedAt: now - 18_000, updatedAt: now };
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
    snapshot.session = { ...snapshot.session, status: 'failed', phase: 'blocked', endedAt: now - 2_000, error: 'A checkpoint needs review before continuing.', updatedAt: now };
    snapshot.continuity = { queueCount: 2, contextPressure: 'high', checkpoint: true, blockedReason: 'Checkpoint review required' };
  }
  if (scenario === 'completed-recently') {
    snapshot.session = { ...snapshot.session, runId: 'mock-completed', status: 'completed', phase: 'complete', startedAt: now - 30_000, endedAt: now - 4_000, updatedAt: now - 4_000 };
    snapshot.tasks = [{ id: 'mock-task', kind: 'taskLoop', title: 'Verified task loop', status: 'completed', progress: 1, phase: 'complete', updatedAt: now - 4_000, source: 'snapshot' }];
    snapshot.availability.tasks = true;
  }
  return snapshot;
}

function scheduleMock(sessionKey: string, scenario: SessionActivityMockScenario, apply: (event: SessionActivityEvent) => void): void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  if (scenario === 'running-task' || scenario === 'multi-subagent') {
    timers.push(setTimeout(() => apply({ channel: 'runtime', payload: { type: 'run.ended', runId: 'mock-run', sessionKey, status: 'completed', endedAt: Date.now() } }), 4_500));
  }
  if (scenario === 'multi-subagent') {
    // `taskNodeId` must equal the seeded row's id, or `subagentLifecycleIdentityKey`
    // derives a different key and the event appends a duplicate instead of
    // settling the row that is already on screen.
    timers.push(setTimeout(() => apply({ channel: 'subagent', payload: { runId: 'mock-child', taskNodeId: 'rail-node-1', sessionKey, roleName: 'explorer', childSessionKey: 'agent:explorer:rail-scout', agentId: 'explorer', status: 'completed', summary: '已定位 3 处可复用组件', ts: Date.now() } }), 3_200));
  }
  mockTimers.set(sessionKey, timers);
}

export type SessionActivityState = {
  snapshots: Record<string, SessionActivitySnapshot>;
  initialized: boolean;
  init: () => void;
  load: (input: { workspaceId?: string | null; sessionKey: string }) => Promise<SessionActivitySnapshot>;
  apply: (event: SessionActivityEvent) => void;
  refreshGit: (workspaceId?: string | null, sessionKey?: string) => Promise<void>;
};

export const useSessionActivityStore = create<SessionActivityState>((set, get) => {
  const applyEvent = (event: SessionActivityEvent) => {
    const key = routingSessionKey(event);
    if (!key) return;
    const current = get().snapshots[key] ?? createEmptySessionActivitySnapshot(key);
    const next = reduceSessionActivity(current, event);
    if (next !== current) {
      sessionSnapshots.set(key, next);
      set((state) => ({ snapshots: { ...state.snapshots, [key]: next } }));
    }
  };

  return {
    snapshots: {},
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
      const isMockMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mock') === '1';
      const initial = isMockMode
        ? mockSnapshot(sessionKey, mockScenario())
        : createEmptySessionActivitySnapshot(sessionKey);
      set((state) => ({ snapshots: { ...state.snapshots, [sessionKey]: initial } }));
      if (initial.session.status !== 'idle' || initial.git || initial.tasks.length || initial.terminals.length) {
        scheduleMock(sessionKey, mockScenario(), applyEvent);
      }

      if (isMockMode) {
        sessionSnapshots.set(sessionKey, initial);
        /* Git comes from `git.status()` even under mock, because the mock host
         * bridge answers that call with the same fixture the review tab reads.
         * Seeding a second git object into each scenario would let the status
         * card's changed-line figures disagree with the diff they link to. */
        void get().refreshGit(workspaceId, sessionKey);
        return initial;
      }

      const [activityResult] = await Promise.allSettled([
        hostApi.sessionActivity.snapshot({ workspaceId, sessionKey }),
      ]);
      let snapshot = get().snapshots[sessionKey] ?? initial;
      if (activityResult.status === 'fulfilled' && activityResult.value.success && activityResult.value.snapshot) {
        const hydrated = activityResult.value.snapshot;
        const mergeItems = <T extends { id: string; updatedAt: number }>(base: T[], incoming: T[]) => incoming.reduce(upsert, base);
        snapshot = {
          ...snapshot,
          ...hydrated,
          session: hydrated.session && hydrated.session.updatedAt >= snapshot.session.updatedAt
            ? { ...snapshot.session, ...hydrated.session, sessionKey }
            : snapshot.session,
          tasks: mergeItems(snapshot.tasks, hydrated.tasks),
          subagents: mergeItems(snapshot.subagents, hydrated.subagents),
          terminals: mergeItems(snapshot.terminals, hydrated.terminals),
          continuity: { ...snapshot.continuity, ...hydrated.continuity },
          availability: { ...snapshot.availability, ...hydrated.availability },
          capturedAt: Math.max(snapshot.capturedAt, hydrated.capturedAt),
        };
      }
      sessionSnapshots.set(sessionKey, snapshot);
      set((state) => ({ snapshots: { ...state.snapshots, [sessionKey]: snapshot } }));
      return snapshot;
    },
    apply: applyEvent,
    refreshGit: async (_workspaceId, sessionKey) => {
      if (!sessionKey) return;
      try {
        const result = await hostApi.git.status();
        if (!result.success) return;
        const current = get().snapshots[sessionKey] ?? createEmptySessionActivitySnapshot(sessionKey);
        const next = { ...current, git: result.status, availability: { ...current.availability, git: true }, capturedAt: Date.now() };
        sessionSnapshots.set(sessionKey, next);
        set((state) => ({ snapshots: { ...state.snapshots, [sessionKey]: next } }));
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
  initialized = false;
}

export type { SessionActivityEvent };
