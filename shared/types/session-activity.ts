import type { GitRepositoryStatus } from './git';
import type { SessionEffectivePolicy } from './session-effective-policy';
import type { LongSessionResourceInventory } from '../long-session-resource-reclamation';

export type SessionActivityRunStatus = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'aborted';
export type SessionActivityTaskKind = 'mission' | 'taskLoop' | 'clawGraph' | 'taskLedger';
export type SessionActivityTaskStatus = 'queued' | 'running' | 'review' | 'blocked' | 'completed' | 'failed' | 'aborted';
export type SessionActivitySubagentStatus = 'started' | 'yielded' | 'completed' | 'error' | 'aborted' | 'verified';
export type SessionActivityTerminalKind = 'interactive' | 'agentCommand' | 'webPreviewDevServer';
export type SessionActivityTerminalStatus = 'idle' | 'starting' | 'running' | 'exited' | 'blocked' | 'completed' | 'error';
export type SessionActivityAttentionLevel = 'none' | 'passive' | 'active' | 'attention';
export type SessionActivityGoalKind = 'mission' | 'flow';
export type SessionActivityGoalStatus = 'queued' | 'waiting' | 'running' | 'sleeping' | 'paused' | 'blocked' | 'completed' | 'failed' | 'aborted' | 'lost';
export type SessionActivityProcessKind = 'bash' | 'supervisor' | 'goalOwned';
export type SessionActivityProcessStatus = 'queued' | 'starting' | 'running' | 'exiting' | 'exited' | 'completed' | 'failed' | 'killed' | 'aborted' | 'lost';
export type SessionActivityLineageKind = 'parent' | 'child';
export type SessionActivityLineageStatus = 'started' | 'yielded' | 'completed' | 'aborted' | 'error';

/**
 * Whether the background owner read behind a snapshot actually completed.
 *
 * `unknown` is NOT "nothing is running": it means the goals / processes /
 * lineage facts could not be read, so those empty lists are a missing answer
 * rather than an answer of "none". Only `known` makes "there is no background
 * activity" a fact instead of a guess.
 */
export type SessionActivityBackgroundReadState = 'known' | 'unknown';

/**
 * The source state of the background facts (goals / processes / lineage).
 *
 * This is deliberately separate from `session`, which is the main run's own
 * state: a run can be finished while its background processes are still alive,
 * and a background read can fail while the run state is perfectly well known.
 */
export type SessionActivityBackgroundRead = {
  state: SessionActivityBackgroundReadState;
  /** When the background facts were last read successfully; null if never. */
  readAt: number | null;
  /** When the last read attempt failed; null if none has. Kept beside `readAt`
   * so retained facts can be shown as stale instead of as fresh. */
  failedAt: number | null;
};

/**
 * True only when a background read was attempted and failed.
 *
 * A snapshot that has not been read yet is also `unknown`, but nothing has gone
 * wrong yet — treating that as a failure would turn every first paint into an
 * alert, which is exactly the false warning this state exists to avoid.
 */
export function backgroundReadFailed(read: SessionActivityBackgroundRead): boolean {
  return read.state === 'unknown' && read.failedAt != null;
}

/**
 * Correlation identity for one projected session effect (TF-0082).
 *
 * Every field is copied from the owner that already records it; nothing is
 * derived from another identifier, and a field is absent when its owner does
 * not record one. This is the single lineage shape shared by goals, processes,
 * and lineage rows — consumers must not build a second session identity.
 */
export type SessionActivityLineageRef = {
  /** Session generation (`sessionId`) the effect is pinned to. */
  sessionId?: string;
  /** Run that produced the effect. */
  runId?: string;
  /** Session that requested the run, when the owner records a requester. */
  parentSessionKey?: string;
  /** Durable owner epoch, when the owner defines one. */
  ownerEpoch?: string;
  /** Mission correlation shared by mission goals, goal-wake flows, and their processes. */
  missionId?: string;
};

export type SessionActivityTask = {
  id: string;
  kind: SessionActivityTaskKind;
  title: string;
  status: SessionActivityTaskStatus;
  progress?: number;
  phase?: string;
  updatedAt: number;
  source: 'event' | 'snapshot' | 'task-ledger';
};

export type SessionActivityCompletionBatchMember = {
  runId: string;
  childSessionKey: string;
  roleName: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  deliveryStatus: 'not_required' | 'pending' | 'in_progress' | 'delivered' | 'failed' | 'suspended' | 'discarded';
};

export type SessionActivityCompletionBatch = {
  schemaVersion: 'clawx.orchestration-completion-batch/v1';
  batchId: string;
  orchestrationRunId: string;
  requesterSessionKey: string;
  requesterSessionGeneration: string | null;
  generationState: 'matching' | 'mismatch' | 'unverified';
  status: 'collecting' | 'terminal' | 'fenced';
  outcome: 'incomplete' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'fenced';
  consolidatedReceiptId: string | null;
  acceptedAt: number;
  terminalAt: number | null;
  counts: {
    expected: number;
    settled: number;
    completed: number;
    failed: number;
    cancelled: number;
    unknown: number;
  };
  delivery: {
    state: 'not_required' | 'pending' | 'in_progress' | 'delivered' | 'failed' | 'suspended' | 'discarded';
    delivered: number;
    pending: number;
    suspended: number;
    failed: number;
    discarded: number;
    waitingForRequesterTurn: boolean;
  };
  members: SessionActivityCompletionBatchMember[];
};
export type SessionActivitySubagent = {
  id: string;
  role?: string;
  task?: string;
  summary?: string;
  /** Kept apart from `summary` so a failure can be rendered as one. */
  error?: string;
  status: SessionActivitySubagentStatus;
  /**
   * The child's own session, once the runtime reports one.
   *
   * This is what makes a sub-agent row openable: the workspace Agents tab
   * fetches `sessions.history` for this key. A roster entry without it can be
   * listed but not opened, so the row stays inert rather than leading to an
   * empty transcript pane.
   */
  childSessionKey?: string;
  /** The child's own agent id, for its avatar in the workspace roster. */
  agentId?: string;
  updatedAt: number;
  source: 'event' | 'snapshot';
};

export type SessionActivityGoal = {
  id: string;
  kind: SessionActivityGoalKind;
  /** Redacted display label. Never carries raw goal, command, cwd, or env text. */
  label: string;
  status: SessionActivityGoalStatus;
  phase?: string;
  progress?: number;
  /** Redacted command/objective digest only; raw text is never projected. */
  digest?: string;
  /** Correlation identity for this goal; absent when no owner records one. */
  lineage?: SessionActivityLineageRef;
  updatedAt: number;
};

export type SessionActivityProcess = {
  id: string;
  kind: SessionActivityProcessKind;
  /** Redacted display label. Never carries raw argv, command, cwd, or env text. */
  label: string;
  status: SessionActivityProcessStatus;
  pid?: number;
  /** Redacted command digest only; raw text is never projected. */
  digest?: string;
  /** Correlation identity for this process; absent when no owner records one. */
  lineage?: SessionActivityLineageRef;
  updatedAt: number;
};

export type SessionActivityLineage = {
  id: string;
  kind: SessionActivityLineageKind;
  sessionKey: string;
  role?: string;
  status: SessionActivityLineageStatus;
  /** Correlation identity for this run, including the parent generation pin. */
  lineage?: SessionActivityLineageRef;
  updatedAt: number;
};

export type SessionActivityTerminal = {
  id: string;
  kind: SessionActivityTerminalKind;
  cwd?: string | null;
  status: SessionActivityTerminalStatus;
  exitCode?: number | null;
  updatedAt: number;
};

export type SessionCompletionBatchWorkerStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'missing'
  | 'unknown';

export type SessionCompletionBatchDeliveryState =
  | 'none'
  | 'pending'
  | 'in_progress'
  | 'delivered'
  | 'failed'
  | 'suspended'
  | 'discarded';

export type SessionCompletionBatch = {
  id: string;
  idempotencyKey: string;
  orchestrationRunId: string;
  requesterSessionKey: string;
  requesterSessionId: string | null;
  generationState: 'consistent' | 'mismatch' | 'unknown';
  status: 'collecting' | 'delivery-pending' | 'delivered' | 'partial';
  terminal: boolean;
  expectedWorkerCount: number;
  completedWorkerCount: number;
  failedWorkerCount: number;
  cancelledWorkerCount: number;
  pendingWorkerCount: number;
  workerRuns: Array<{
    runId: string;
    roleName: string | null;
    taskNodeId: string | null;
    childSessionKey: string | null;
    status: SessionCompletionBatchWorkerStatus;
  }>;
  verifier: {
    runId: string;
    status: SessionCompletionBatchWorkerStatus;
  } | null;
  delivery: {
    state: SessionCompletionBatchDeliveryState;
    pendingCount: number;
    inProgressCount: number;
    deliveredCount: number;
    failedCount: number;
    suspendedCount: number;
    discardedCount: number;
  };
  bounded: boolean;
  completionAuthority: 'none';
  updatedAt: number;
};

export type SessionActivitySnapshot = {
  session: {
    sessionKey: string;
    /** Physical generation used by lifecycle cleanup receipts. */
    sessionId?: string | null;
    runId?: string | null;
    status: SessionActivityRunStatus;
    phase?: string;
    startedAt?: number | null;
    endedAt?: number | null;
    error?: string | null;
    updatedAt: number;
  };
  git?: GitRepositoryStatus | null;
  tasks: SessionActivityTask[];
  subagents: SessionActivitySubagent[];
  completionBatches: SessionActivityCompletionBatch[];
  terminals: SessionActivityTerminal[];
  goals: SessionActivityGoal[];
  processes: SessionActivityProcess[];
  lineage: SessionActivityLineage[];
  /** Secret-free projection from TF-0512 facts and the current session policy. */
  policy?: SessionEffectivePolicy;
  /** Owner-consolidated resource read model; absent snapshots are not a zero reading. */
  resources?: LongSessionResourceInventory;
  continuity: {
    queueCount: number;
    contextPressure?: 'low' | 'medium' | 'high' | null;
    checkpoint?: boolean;
    blockedReason?: string | null;
  };
  availability: {
    git: boolean;
    tasks: boolean;
    subagents: boolean;
    terminals: boolean;
    continuity: boolean;
  };
  /** Source state of the background owner read; see `SessionActivityBackgroundRead`. */
  backgroundRead: SessionActivityBackgroundRead;
  capturedAt: number;
};

export type SessionActivityMockScenario =
  | 'idle-clean'
  | 'git-dirty'
  | 'running-task'
  | 'multi-subagent'
  | 'terminal-active'
  | 'blocked-recovery'
  | 'completed-recently';

export function createEmptySessionActivitySnapshot(sessionKey: string, capturedAt = Date.now()): SessionActivitySnapshot {
  return {
    session: { sessionKey, runId: null, status: 'idle', startedAt: null, endedAt: null, error: null, updatedAt: 0 },
    git: null,
    tasks: [],
    subagents: [],
    completionBatches: [],
    terminals: [],
    goals: [],
    processes: [],
    lineage: [],
    continuity: { queueCount: 0, contextPressure: null, checkpoint: false, blockedReason: null },
    availability: { git: false, tasks: false, subagents: true, terminals: false, continuity: true },
    /* Seeded `unknown` on purpose: an empty snapshot is an unread snapshot, and
     * a successful read of nothing is a different fact that has to be earned. */
    backgroundRead: { state: 'unknown', readAt: null, failedAt: null },
    capturedAt,
  };
}

const COMPLETED_TASK_STATUSES = new Set<SessionActivityTaskStatus>(['completed', 'aborted']);
const COMPLETED_SUBAGENT_STATUSES = new Set<SessionActivitySubagentStatus>(['completed', 'verified', 'aborted']);
const COMPLETED_TERMINAL_STATUSES = new Set<SessionActivityTerminalStatus>(['completed', 'exited']);
const COMPLETED_GOAL_STATUSES = new Set<SessionActivityGoalStatus>(['completed', 'aborted', 'lost']);
const COMPLETED_PROCESS_STATUSES = new Set<SessionActivityProcessStatus>(['completed', 'exited']);
const COMPLETED_LINEAGE_STATUSES = new Set<SessionActivityLineageStatus>(['completed', 'aborted']);

export function retainRecentSessionActivity(
  snapshot: SessionActivitySnapshot,
  retentionMinutes: 0 | 5 | 15,
  now = Date.now(),
): SessionActivitySnapshot {
  const cutoff = now - retentionMinutes * 60_000;
  const keepCompleted = (updatedAt: number) => retentionMinutes > 0 && updatedAt >= cutoff;

  return {
    ...snapshot,
    tasks: snapshot.tasks.filter((task) => !COMPLETED_TASK_STATUSES.has(task.status) || keepCompleted(task.updatedAt)),
    subagents: snapshot.subagents.filter((agent) => !COMPLETED_SUBAGENT_STATUSES.has(agent.status) || keepCompleted(agent.updatedAt)),
    terminals: snapshot.terminals.filter((terminal) => !COMPLETED_TERMINAL_STATUSES.has(terminal.status) || keepCompleted(terminal.updatedAt)),
    goals: snapshot.goals.filter((goal) => !COMPLETED_GOAL_STATUSES.has(goal.status) || keepCompleted(goal.updatedAt)),
    processes: snapshot.processes.filter((process) => !COMPLETED_PROCESS_STATUSES.has(process.status) || keepCompleted(process.updatedAt)),
    lineage: snapshot.lineage.filter((entry) => !COMPLETED_LINEAGE_STATUSES.has(entry.status) || keepCompleted(entry.updatedAt)),
  };
}

export function classifySessionActivity(
  snapshot: SessionActivitySnapshot,
  options: { showGit?: boolean; showCommands?: boolean } = {},
): SessionActivityAttentionLevel {
  const showGit = options.showGit ?? true;
  const showCommands = options.showCommands ?? true;
  const terminals = showCommands ? snapshot.terminals : [];

  const needsAttention = snapshot.session.status === 'failed'
    || snapshot.session.status === 'aborted'
    /* A failed background read is the one thing an empty snapshot cannot show
     * on its own: without this the card has no content, so the panel — and with
     * it the warning and its retry — never renders at all. */
    || backgroundReadFailed(snapshot.backgroundRead)
    || Boolean(showGit && snapshot.git?.hasConflicts)
    || snapshot.tasks.some((task) => task.status === 'blocked' || task.status === 'failed')
    || snapshot.subagents.some((agent) => agent.status === 'error')
    || snapshot.goals.some((goal) => goal.status === 'blocked' || goal.status === 'failed')
    || snapshot.processes.some((process) => process.status === 'failed' || process.status === 'killed')
    || snapshot.lineage.some((entry) => entry.status === 'error')
    || terminals.some((terminal) => terminal.status === 'blocked' || terminal.status === 'error')
    || snapshot.continuity.queueCount > 0
    || snapshot.continuity.contextPressure === 'high'
    || Boolean(snapshot.continuity.checkpoint)
    || Boolean(snapshot.continuity.blockedReason);
  if (needsAttention) return 'attention';

  const active = snapshot.session.status === 'running'
    || snapshot.session.status === 'waiting_approval'
    || snapshot.tasks.some((task) => task.status === 'running' || task.status === 'review')
    || snapshot.subagents.some((agent) => agent.status === 'started' || agent.status === 'yielded')
    || snapshot.goals.some((goal) => goal.status === 'running' || goal.status === 'waiting' || goal.status === 'sleeping' || goal.status === 'paused')
    || snapshot.processes.some((process) => process.status === 'starting' || process.status === 'running' || process.status === 'exiting' || process.status === 'queued')
    || snapshot.lineage.some((entry) => entry.status === 'started' || entry.status === 'yielded')
    || terminals.some((terminal) => terminal.status === 'starting' || terminal.status === 'running')
    || snapshot.continuity.contextPressure === 'medium';
  if (active) return 'active';

  const passive = snapshot.session.status !== 'idle'
    || Boolean(snapshot.session.phase)
    || Boolean(showGit && snapshot.git?.isRepository && !snapshot.git.clean)
    || snapshot.tasks.length > 0
    || snapshot.subagents.length > 0
    || snapshot.goals.length > 0
    || snapshot.processes.length > 0
    || snapshot.lineage.length > 0
    || terminals.length > 0;
  return passive ? 'passive' : 'none';
}
