import type { SessionActivitySnapshotPayload } from '@shared/host-api/contract';
import type {
  SessionActivitySnapshot,
  SessionActivityTask,
  SessionActivityTerminalStatus,
} from '@shared/types/session-activity';
import { createEmptySessionActivitySnapshot } from '@shared/types/session-activity';
import type { TaskLedgerNode, TaskLedgerSnapshot } from '@shared/types/task-ledger';
import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { createGitApi } from './git-api';
import { createTaskLedgerApi } from './task-ledger-api';
import type { TerminalSessionManager } from './terminal-session-manager';

type RuntimeActivityResponse = {
  snapshot?: Partial<SessionActivitySnapshot>;
};

function taskStatus(status: string): SessionActivityTask['status'] {
  if (status === 'doing' || status === 'running') return 'running';
  if (status === 'review') return 'review';
  if (status === 'blocked') return 'blocked';
  if (status === 'done' || status === 'complete' || status === 'completed') return 'completed';
  if (status === 'dropped' || status === 'aborted' || status === 'cancelled') return 'aborted';
  if (status === 'failed' || status === 'error') return 'failed';
  return 'queued';
}

function taskFromLedger(node: TaskLedgerNode): SessionActivityTask {
  return {
    id: node.id,
    kind: node.kind === 'goal' || node.kind === 'milestone' ? 'mission' : 'taskLedger',
    title: node.title,
    status: taskStatus(node.status),
    progress: typeof node.progress === 'number' && Number.isFinite(node.progress) ? node.progress : undefined,
    updatedAt: Date.parse(node.updatedAt) || Date.now(),
    source: 'task-ledger',
  };
}

function tasksForSession(ledger: TaskLedgerSnapshot, sessionKey: string): SessionActivityTask[] {
  const linked = new Set(
    ledger.sessionLinks
      .filter((link) => link.sessionKey === sessionKey)
      .map((link) => link.nodeId)
      .filter((nodeId): nodeId is string => Boolean(nodeId)),
  );
  return ledger.nodes.filter((node) => linked.has(node.id)).map(taskFromLedger);
}

function terminalStatus(status: string, exitCode?: number | null): SessionActivityTerminalStatus {
  if (status === 'running' || status === 'starting' || status === 'idle' || status === 'blocked') return status;
  if (status === 'exited') return exitCode && exitCode !== 0 ? 'error' : 'completed';
  return 'idle';
}

function unsupportedRpc(error: unknown): boolean {
  return /unknown method|method not found|not implemented|unsupported|unrecognized request/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

function mergeRuntimeSnapshot(
  snapshot: SessionActivitySnapshot,
  runtime: Partial<SessionActivitySnapshot> | undefined,
  sessionKey: string,
): SessionActivitySnapshot {
  if (!runtime) return snapshot;
  return {
    ...snapshot,
    session: { ...snapshot.session, ...(runtime.session ?? {}), sessionKey },
    tasks: [...snapshot.tasks, ...(Array.isArray(runtime.tasks) ? runtime.tasks : [])],
    subagents: Array.isArray(runtime.subagents) ? runtime.subagents : snapshot.subagents,
    goals: Array.isArray(runtime.goals) ? runtime.goals : snapshot.goals,
    processes: Array.isArray(runtime.processes) ? runtime.processes : snapshot.processes,
    lineage: Array.isArray(runtime.lineage) ? runtime.lineage : snapshot.lineage,
    continuity: { ...snapshot.continuity, ...(runtime.continuity ?? {}) },
    availability: { ...snapshot.availability, ...(runtime.availability ?? {}) },
    capturedAt: Math.max(snapshot.capturedAt, runtime.capturedAt ?? 0),
  };
}

export function createSessionActivityApi({
  gatewayManager,
  terminalManager,
}: {
  gatewayManager: GatewayManager;
  terminalManager: TerminalSessionManager;
}): CompleteHostServiceRegistry['sessionActivity'] {
  const gitApi = createGitApi();
  const taskLedgerApi = createTaskLedgerApi();

  return {
    snapshot: async (payload: SessionActivitySnapshotPayload) => {
      const sessionKey = payload.sessionKey?.trim();
      if (!sessionKey) throw new Error('sessionKey is required');
      let snapshot = createEmptySessionActivitySnapshot(sessionKey);
      let runtimeAvailable = false;

      const [gitResult, ledgerResult, runtimeResult] = await Promise.allSettled([
        gitApi.status(),
        taskLedgerApi.snapshot({ workspaceId: payload.workspaceId ?? undefined }),
        gatewayManager.rpc<RuntimeActivityResponse>('session.activitySnapshot', { sessionKey }),
      ]);

      if (gitResult.status === 'fulfilled' && gitResult.value.success) {
        snapshot.git = gitResult.value.status;
        snapshot.availability.git = true;
      }
      if (ledgerResult.status === 'fulfilled' && ledgerResult.value.success) {
        snapshot.tasks = tasksForSession(ledgerResult.value.snapshot, sessionKey);
        snapshot.availability.tasks = true;
      }
      if (runtimeResult.status === 'fulfilled') {
        snapshot = mergeRuntimeSnapshot(snapshot, runtimeResult.value.snapshot, sessionKey);
        runtimeAvailable = true;
      } else if (!unsupportedRpc(runtimeResult.reason)) {
        snapshot.availability.continuity = false;
      }

      const terminals = terminalManager.list({
        workspaceId: payload.workspaceId ?? undefined,
        sessionKey,
      });
      snapshot.terminals = terminals
        .filter(
          (terminal): terminal is typeof terminal & { sessionId: string } =>
            Boolean(terminal.sessionId),
        )
        .map((terminal) => ({
          id: terminal.sessionId,
          kind: terminal.kind ?? 'interactive',
          cwd: terminal.cwd,
          status: terminalStatus(terminal.status, terminal.exitCode),
          exitCode: terminal.exitCode,
          updatedAt: snapshot.capturedAt,
        }));
      snapshot.availability.terminals = true;
      snapshot.capturedAt = Date.now();

      return { success: true, snapshot, runtimeAvailable };
    },
  };
}
