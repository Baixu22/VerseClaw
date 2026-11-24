import type { SessionActivitySnapshotPayload } from '@shared/host-api/contract';
import type {
  SessionActivityBackgroundRead,
  SessionActivitySnapshot,
  SessionActivityTask,
  SessionActivityTerminalStatus,
} from '@shared/types/session-activity';
import { createEmptySessionActivitySnapshot, createSessionActivityReadSnapshot, fenceSessionActivityRead, parseSessionActivityReadQuery } from '@shared/types/session-activity';
import { normalizeAutonomySessionScope } from '@shared/types/identity-scope';
import { getPersistedCoordinatorBinding, getWorkspaceRootPathById } from './workspaces-api';
import { canonicalPath } from '../../shared/task-system/identity';
import type { TaskLedgerNode, TaskLedgerSnapshot } from '@shared/types/task-ledger';
import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { createGitApi } from './git-api';
import { createTaskLedgerApi } from './task-ledger-api';
import type { TerminalSessionManager } from './terminal-session-manager';
import { collectLongSessionResourceInventory } from './long-session-resource-reclamation';
import { buildSessionHostReadiness } from '../gateway/session-host-readiness';

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
    read: async (input) => {
      const query = parseSessionActivityReadQuery(input);
      let snapshot = createSessionActivityReadSnapshot(query.scope);
      const result = () => ({ success: true as const, snapshot, runtimeAvailable: snapshot.readModel.sources.session.state === 'ready' });
      const fence = (state: 'unavailable' | 'stale' | 'unknown', reason: Parameters<typeof fenceSessionActivityRead>[2]) => {
        snapshot = fenceSessionActivityRead(snapshot, state, reason); return result();
      };
      const root = await getWorkspaceRootPathById(query.scope.workspaceId);
      if (!root) return fence('unavailable', 'owner-missing');
      let binding: Awaited<ReturnType<typeof getPersistedCoordinatorBinding>>;
      try { binding = structuredClone(await getPersistedCoordinatorBinding(query.scope.workspaceId, query.scope.sessionKey)); }
      catch { return fence('unavailable', 'owner-unavailable'); }
      if (query.expectedBindingRevision !== undefined && binding?.bindingRevision !== query.expectedBindingRevision)
        return fence('stale', 'binding-changed');
      if (binding?.sessionGeneration && binding.sessionGeneration !== query.scope.sessionGeneration)
        return fence('stale', 'generation-changed');
      try {
        const response = await gatewayManager.rpc<RuntimeActivityResponse>('session.activitySnapshot', query);
        const read = response.snapshot?.readModel;
        if (read?.schemaVersion !== 'SessionCollaborationRead/v1') return fence('unknown', 'protocol-unverified');
        normalizeAutonomySessionScope(read.scope, query.scope);
        if (read.sources.session.state === 'ready') {
          normalizeAutonomySessionScope(read.sources.session.value.scope, query.scope);
          if (response.snapshot?.session?.sessionKey !== query.scope.sessionKey || response.snapshot.session.sessionId !== query.scope.sessionGeneration)
            return fence('stale', 'scope-mismatch');
          if (read.sources.run.state === 'ready' && read.sources.run.value) normalizeAutonomySessionScope({ ...read.sources.run.value.scope,
            sessionGeneration: query.scope.sessionGeneration }, query.scope);
        }
        snapshot = { ...snapshot, ...response.snapshot, readModel: read };
        const [afterRoot, afterBinding] = await Promise.all([
          getWorkspaceRootPathById(query.scope.workspaceId), getPersistedCoordinatorBinding(query.scope.workspaceId, query.scope.sessionKey),
        ]);
        if (afterRoot !== root || JSON.stringify(afterBinding) !== JSON.stringify(binding)) return fence('stale', 'binding-changed');
        if (binding && read.sources.execution.state === 'ready'
          && canonicalPath(binding.environment.canonicalRoot) !== read.sources.execution.value.executionWorktree)
          return fence('stale', 'execution-changed');
        // The Host await is another reset boundary; revalidate against a fresh Runtime owner read.
        const final = await gatewayManager.rpc<RuntimeActivityResponse>('session.activitySnapshot', query);
        const finalRead = final.snapshot?.readModel;
        if (finalRead?.schemaVersion !== 'SessionCollaborationRead/v1') return fence('unknown', 'protocol-unverified');
        if (finalRead?.sources.session.state !== 'ready') {
          if (read.sources.session.state === 'ready') {
            const source = finalRead.sources.session;
            if (source.state === 'stale' || source.state === 'unavailable' || source.state === 'unknown') return fence(source.state, source.reason);
            return fence('unknown', 'protocol-unverified');
          }
        } else {
          normalizeAutonomySessionScope(finalRead.sources.session.value.scope, query.scope);
          if (final.snapshot?.session?.sessionKey !== query.scope.sessionKey || final.snapshot.session.sessionId !== query.scope.sessionGeneration)
            return fence('stale', 'scope-mismatch');
          if (finalRead.sources.run.state === 'ready' && finalRead.sources.run.value) normalizeAutonomySessionScope({ ...finalRead.sources.run.value.scope,
            sessionGeneration: query.scope.sessionGeneration }, query.scope);
        }
        if (read.sources.execution.state === 'ready' && finalRead?.sources.execution.state === 'ready'
          && JSON.stringify(read.sources.execution.value) !== JSON.stringify(finalRead.sources.execution.value)) return fence('stale', 'execution-changed');
        const [finalRoot, finalBinding] = await Promise.all([
          getWorkspaceRootPathById(query.scope.workspaceId), getPersistedCoordinatorBinding(query.scope.workspaceId, query.scope.sessionKey),
        ]);
        if (finalRoot !== root || JSON.stringify(finalBinding) !== JSON.stringify(binding)) return fence('stale', 'binding-changed');
        snapshot = { ...snapshot, ...final.snapshot, readModel: finalRead };
        snapshot.readModel.sources.binding = binding
          ? { owner: 'workspaces', state: 'ready', readAt: Date.now(), value: { bindingRevision: binding.bindingRevision, sessionGeneration: binding.sessionGeneration, state: binding.state } }
          : { owner: 'workspaces', state: 'unavailable', readAt: Date.now(), value: null, reason: 'owner-missing' };
      } catch { return fence('unavailable', 'owner-unavailable'); }
      return result();
    },
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
      if (snapshot.policy) {
        const before = gatewayManager.getStatus().connectedAt;
        const [ack, cron] = await Promise.allSettled([
          gatewayManager.rpc<{ gatewayGeneration?: unknown; childPid?: unknown }>('runtime.flags.ack', {}, 3_000),
          gatewayManager.rpc<{ enabled?: unknown }>('cron.status', {}, 3_000),
        ]);
        const current = gatewayManager.getStatus();
        const runtimeGeneration = ack.status === 'fulfilled'
          && typeof ack.value.gatewayGeneration === 'string' && ack.value.gatewayGeneration.trim()
          && typeof ack.value.childPid === 'number' && ack.value.childPid > 0
          ? ack.value.gatewayGeneration : null;
        snapshot.policy = {
          ...snapshot.policy,
          host: buildSessionHostReadiness({
            workspaceId: payload.workspaceId?.trim() ?? '', sessionKey,
            sessionId: snapshot.session.sessionId ?? null,
            policy: snapshot.policy,
            gateway: gatewayManager.getCapabilitySnapshot(),
            runtimeGeneration,
            cronEnabled: cron.status === 'fulfilled' && typeof cron.value.enabled === 'boolean' ? cron.value.enabled : null,
            connectionUnchanged: typeof before === 'number' && before === current.connectedAt,
          }),
        };
      }
      snapshot.capturedAt = Date.now();

      return { success: true, snapshot, runtimeAvailable };
    },
  };
}
