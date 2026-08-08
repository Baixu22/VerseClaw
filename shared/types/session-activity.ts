import type { GitRepositoryStatus } from './git';

export type SessionActivityRunStatus = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'aborted';
export type SessionActivityTaskKind = 'mission' | 'taskLoop' | 'clawGraph' | 'taskLedger';
export type SessionActivityTaskStatus = 'queued' | 'running' | 'review' | 'blocked' | 'completed' | 'failed' | 'aborted';
export type SessionActivitySubagentStatus = 'started' | 'completed' | 'error' | 'aborted' | 'verified';
export type SessionActivityTerminalKind = 'interactive' | 'agentCommand' | 'webPreviewDevServer';
export type SessionActivityTerminalStatus = 'idle' | 'starting' | 'running' | 'exited' | 'blocked' | 'completed' | 'error';
export type SessionActivityAttentionLevel = 'none' | 'passive' | 'active' | 'attention';

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

export type SessionActivitySubagent = {
  id: string;
  role?: string;
  task?: string;
  summary?: string;
  status: SessionActivitySubagentStatus;
  updatedAt: number;
  source: 'event' | 'snapshot';
};

export type SessionActivityTerminal = {
  id: string;
  kind: SessionActivityTerminalKind;
  cwd?: string | null;
  status: SessionActivityTerminalStatus;
  exitCode?: number | null;
  updatedAt: number;
};

export type SessionActivitySnapshot = {
  session: {
    sessionKey: string;
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
  terminals: SessionActivityTerminal[];
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
    terminals: [],
    continuity: { queueCount: 0, contextPressure: null, checkpoint: false, blockedReason: null },
    availability: { git: false, tasks: false, subagents: true, terminals: false, continuity: true },
    capturedAt,
  };
}

const COMPLETED_TASK_STATUSES = new Set<SessionActivityTaskStatus>(['completed', 'aborted']);
const COMPLETED_SUBAGENT_STATUSES = new Set<SessionActivitySubagentStatus>(['completed', 'verified', 'aborted']);
const COMPLETED_TERMINAL_STATUSES = new Set<SessionActivityTerminalStatus>(['completed', 'exited']);

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
    || Boolean(showGit && snapshot.git?.hasConflicts)
    || snapshot.tasks.some((task) => task.status === 'blocked' || task.status === 'failed')
    || snapshot.subagents.some((agent) => agent.status === 'error')
    || terminals.some((terminal) => terminal.status === 'blocked' || terminal.status === 'error')
    || snapshot.continuity.queueCount > 0
    || snapshot.continuity.contextPressure === 'high'
    || Boolean(snapshot.continuity.checkpoint)
    || Boolean(snapshot.continuity.blockedReason);
  if (needsAttention) return 'attention';

  const active = snapshot.session.status === 'running'
    || snapshot.session.status === 'waiting_approval'
    || snapshot.tasks.some((task) => task.status === 'running' || task.status === 'review')
    || snapshot.subagents.some((agent) => agent.status === 'started')
    || terminals.some((terminal) => terminal.status === 'starting' || terminal.status === 'running')
    || snapshot.continuity.contextPressure === 'medium';
  if (active) return 'active';

  const passive = snapshot.session.status !== 'idle'
    || Boolean(snapshot.session.phase)
    || Boolean(showGit && snapshot.git?.isRepository && !snapshot.git.clean)
    || snapshot.tasks.length > 0
    || snapshot.subagents.length > 0
    || terminals.length > 0;
  return passive ? 'passive' : 'none';
}
