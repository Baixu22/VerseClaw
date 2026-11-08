import type { SessionActivitySnapshotPayload } from '@shared/host-api/contract';
import type {
  SessionActivityBackgroundRead,
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
import { collectLongSessionResourceInventory } from './long-session-resource-reclamation';

type RuntimeActivityResponse = {
  snapshot?: Partial<SessionActivitySnapshot> & {
    /**
     * What the gateway could observe about the DB-backed goal-wake owner read.
     *
     * `unknown` means the query failed inside the gateway, so the projected
     * arrays are empty by failure, not by fact. A response that omits the field
     * cannot prove the read happened, so Main stays unknown instead of assuming
     * an empty session (#121).
     */
    ownerRead?: 'known' | 'unknown';
  };
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

/**
 * Did the runtime actually return the owner projection?
 *
 * The background facts are exactly these three arrays. A response that carries
 * the envelope but not the projection is a missing read, not an empty session,
 * so it must not be reported as a successful read of nothing.
 */
function hasOwnerProjection(snapshot: Partial<SessionActivitySnapshot> | undefined): boolean {
  return Boolean(snapshot)
    && Array.isArray(snapshot?.goals)
    && Array.isArray(snapshot?.processes)
    && Array.isArray(snapshot?.lineage);
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
    completionBatches: Array.isArray(runtime.completionBatches)
      ? runtime.completionBatches
      : snapshot.completionBatches,
    goals: Array.isArray(runtime.goals) ? runtime.goals : snapshot.goals,
    processes: Array.isArray(runtime.processes) ? runtime.processes : snapshot.processes,
    lineage: Array.isArray(runtime.lineage) ? runtime.lineage : snapshot.lineage,
    ...(runtime.stage ? { stage: runtime.stage } : {}),
    ...(runtime.derivation ? { derivation: runtime.derivation } : {}),
    ...(runtime.policy ? { policy: runtime.policy } : {}),
    ...(runtime.resources ? { resources: runtime.resources } : {}),
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
      /* The background read starts unknown and is only upgraded by a real
       * answer; a failed or unsupported read keeps it unknown so the renderer
       * cannot mistake "no rows" for "no activity". */
      let backgroundRead: SessionActivityBackgroundRead = { state: 'unknown', readAt: null, failedAt: null };

      const [gitResult, ledgerResult, runtimeResult] = await Promise.allSettled([
        gitApi.status(),
        taskLedgerApi.snapshot({ workspaceId: payload.workspaceId ?? undefined }),
        gatewayManager.rpc<RuntimeActivityResponse>('session.activitySnapshot', {
          sessionKey,
          ...(payload.workspaceId?.trim() ? { workspaceId: payload.workspaceId.trim() } : {}),
        }),
      ]);

      if (gitResult.status === 'fulfilled' && gitResult.value.success) {
        snapshot.git = gitResult.value.status;
        snapshot.availability.git = true;
      }
      if (ledgerResult.status === 'fulfilled' && ledgerResult.value.success) {
        snapshot.tasks = tasksForSession(ledgerResult.value.snapshot, sessionKey);
        snapshot.availability.tasks = true;
      }
      if (runtimeResult.status === 'fulfilled' && hasOwnerProjection(runtimeResult.value.snapshot)) {
        const ownerRead = runtimeResult.value.snapshot?.ownerRead;
        snapshot = mergeRuntimeSnapshot(snapshot, runtimeResult.value.snapshot, sessionKey);
        if (ownerRead === 'known') {
          runtimeAvailable = true;
          backgroundRead = {
            state: 'known',
            readAt: runtimeResult.value.snapshot?.capturedAt ?? Date.now(),
            failedAt: null,
          };
        } else if (ownerRead === 'unknown') {
          /* The gateway answered, but its goal-wake owner query failed: the
           * arrays are a missing answer, so they must not count as an available
           * runtime read and the panel has to warn instead of showing an empty
           * session. */
          backgroundRead = { state: 'unknown', readAt: null, failedAt: Date.now() };
          snapshot.availability.continuity = false;
        } else {
          /* No owner-read state on the envelope. The projection alone cannot
           * prove the read happened, but this response did not report a failure
           * either, so stay unknown without inventing a failure mark. */
          backgroundRead = { state: 'unknown', readAt: null, failedAt: null };
        }
      } else if (!(runtimeResult.status === 'rejected' && unsupportedRpc(runtimeResult.reason))) {
        /* Timeout, thrown handler, or an envelope without the owner projection.
         * `unsupportedRpc` is excluded above: a gateway that does not implement
         * the method has no background source at all, so the read stays unknown
         * without a failure mark — silent, like the previous availability flag,
         * instead of warning about a read this build cannot perform. */
        backgroundRead = { state: 'unknown', readAt: null, failedAt: Date.now() };
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
      snapshot.resources = await collectLongSessionResourceInventory({
        scope: {
          workspaceId: payload.workspaceId?.trim() || 'unknown',
          sessionKey,
          expectedSessionId: snapshot.session.sessionId ?? null,
          rootPath: snapshot.resources?.scope.rootPath ?? null,
        },
        terminalManager,
        runtimeInventory: snapshot.resources ?? null,
      });
      snapshot.backgroundRead = backgroundRead;
      snapshot.capturedAt = Date.now();

      return { success: true, snapshot, runtimeAvailable };
    },
  };
}
