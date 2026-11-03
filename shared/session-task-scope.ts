/**
 * A4 session task scope: derive a read-only task binding from the existing
 * coordinator/session-link owners. This module neither creates tasks nor owns
 * completion; callers must use the returned diagnostic before side effects.
 */

export type SessionTaskScopeInput = {
  sessionKey: string;
  workspaceId: string;
  generation: string;
  activeTaskNodeId?: string | null;
  coordinatorSessionKey?: string | null;
  bindingRevision?: number | null;
  bindingState?: 'active' | 'paused' | 'invalid' | 'missing';
  links: Array<{
    id: string;
    sessionKey: string;
    sessionGeneration?: string | null;
    nodeId?: string | null;
    relation?: 'related' | 'forked_from' | 'handoff_from';
    sourceSessionKey?: string | null;
  }>;
  task?: {
    nodeId: string;
    workspaceId: string;
    nodeKind: string;
    status: string;
    generation?: string | null;
  } | null;
};

export type SessionTaskScopeResult =
  | {
    status: 'ready';
    taskRef: string;
    workspaceId: string;
    generation: string;
    coordinatorSessionKey: string;
    bindingRevision: number;
    readOnly: true;
    writeClaim: 'not-granted';
  }
  | {
    status: 'empty';
    reason: 'discussion-no-task';
  }
  | {
    status: 'unavailable';
    reason:
      | 'coordinator-missing'
      | 'binding-not-ready'
      | 'task-not-found'
      | 'task-workspace-mismatch'
      | 'task-generation-stale'
      | 'task-ref-missing'
      | 'external-ref-not-task';
  };

export function resolveSessionTaskScope(input: SessionTaskScopeInput): SessionTaskScopeResult {
  if (!input.activeTaskNodeId) {
    return { status: 'empty', reason: 'discussion-no-task' };
  }
  if (!input.coordinatorSessionKey || !input.bindingRevision) {
    return { status: 'unavailable', reason: 'coordinator-missing' };
  }
  if (input.bindingState !== 'active') {
    return { status: 'unavailable', reason: 'binding-not-ready' };
  }
  const ownLink = input.links.find((link) =>
    link.sessionKey === input.sessionKey
    && (!link.sessionGeneration || link.sessionGeneration === input.generation),
  );
  // A fork receives a task reference for reading, never a write claim. This
  // resolver is read-only, so a fork can still present its bound task; the
  // admission layer decides whether a write is allowed.
  if (!ownLink || ownLink.nodeId !== input.activeTaskNodeId) {
    return { status: 'unavailable', reason: 'task-ref-missing' };
  }
  if (!input.task || input.task.nodeKind === 'external') {
    return { status: 'unavailable', reason: input.task?.nodeKind === 'external' ? 'external-ref-not-task' : 'task-not-found' };
  }
  if (input.task.nodeId !== input.activeTaskNodeId) return { status: 'unavailable', reason: 'task-not-found' };
  if (input.task.workspaceId !== input.workspaceId) return { status: 'unavailable', reason: 'task-workspace-mismatch' };
  if (input.task.generation && input.task.generation !== input.generation) {
    return { status: 'unavailable', reason: 'task-generation-stale' };
  }
  return {
    status: 'ready',
    taskRef: input.task.nodeId,
    workspaceId: input.workspaceId,
    generation: input.generation,
    coordinatorSessionKey: input.coordinatorSessionKey,
    bindingRevision: input.bindingRevision,
    readOnly: true,
    writeClaim: 'not-granted',
  };
}
