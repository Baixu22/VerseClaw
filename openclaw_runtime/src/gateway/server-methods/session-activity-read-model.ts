import { normalizeRunScope, resolveProjectIdForWorkspace, type AutonomySessionScope, type SessionKey, type WorkspaceId } from '../../../../shared/types/identity-scope.js';
import type { SessionActivityReadSource, SessionActivityTaskReference } from '../../../../shared/types/session-activity.js';
import type { TaskSystemStore } from '../../../../shared/task-system/store.js';
import type { SessionEntry } from '../../config/sessions/types.js';
import type { GatewayRequestContext } from './types.js';

/** Copy scope from the original SessionStore row, with its existing compatibility mapping. */
export function sessionActivityOwnerScope(key: string, entry: SessionEntry | undefined): AutonomySessionScope | null {
  if (!entry?.workspaceId || !entry.sessionId) return null;
  return { workspaceId: entry.workspaceId as WorkspaceId, projectId: resolveProjectIdForWorkspace(entry.workspaceId as WorkspaceId),
    sessionKey: key as SessionKey, sessionGeneration: entry.sessionId };
}

/** A1 and discovery use the same current-run identity and missing-generation decisions. */
export async function readSessionActivityRun(scope: AutonomySessionScope, entry: SessionEntry, context: GatewayRequestContext) {
  const missing = (reason: 'owner-missing' | 'run-identity-missing' | 'scope-mismatch', state: 'unknown' | 'unavailable' = 'unknown') =>
    ({ owner: 'runtime', state, value: null, readAt: Date.now(), reason } as const);
  const sessionRuns = [...context.chatAbortControllers.entries()].filter(([, run]) => run.sessionKey === scope.sessionKey && !run.controller.signal.aborted);
  const runs = sessionRuns.filter(([, run]) => run.sessionId === scope.sessionGeneration).sort((a, b) => b[1].startedAtMs - a[1].startedAtMs);
  let runId = runs[0]?.[0] ?? null;
  let source: SessionActivityReadSource<ReturnType<typeof normalizeRunScope> | null> | null = null;
  if (!runId && sessionRuns.some(([, run]) => !run.sessionId)) source = missing('run-identity-missing');
  if (runs.some(([, run]) => run.workspaceId && run.workspaceId !== scope.workspaceId)) return { source: missing('scope-mismatch', 'unavailable'), startedAt: null };
  if (!runId && entry.spawnedBy) {
    const [{ getLatestSubagentRunByChildSessionKey }, { getAgentRunContext }] = await Promise.all([
      import('../../agents/subagent-registry-read.js'), import('../../infra/agent-events.js'),
    ]);
    const child = getLatestSubagentRunByChildSessionKey(scope.sessionKey);
    if (!child) source = missing('owner-missing');
    if (child && !child.endedAt) {
      const run = getAgentRunContext(child.runId);
      if (run?.sessionKey === scope.sessionKey && run.sessionId === scope.sessionGeneration) runId = child.runId;
      else source = missing('run-identity-missing');
    }
  }
  if (runId || !source) source = { owner: 'runtime', state: runId ? 'ready' : 'empty', readAt: Date.now(),
    value: runId ? normalizeRunScope({ runId, scope: { workspaceId: scope.workspaceId, projectId: scope.projectId, sessionKey: scope.sessionKey } }) : null };
  return { source, startedAt: runs[0]?.[1].startedAtMs ?? null };
}

export function readSessionActivityTaskReferences(store: TaskSystemStore, scope: AutonomySessionScope) {
  const task = store.sessionSnapshot(scope.sessionKey, scope.sessionGeneration).task;
  const references: SessionActivityTaskReference[] = task ? [{ authorityId: store.domain.id, taskNodeId: task.contract.taskNodeId,
    revision: task.contract.revision, digest: task.contract.digest, objective: task.contract.objective, state: task.contract.state,
    referenceOnly: task.referenceOnly === true, claim: task.claim ? { sessionKey: task.claim.sessionKey, generation: task.claim.generation,
      epoch: task.claim.epoch, state: task.claim.state } : null }] : [];
  return { task, references };
}
