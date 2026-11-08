import type { ScopedRunId, TaskId } from './types/identity-scope.js';
import type { SessionDelegationCoordinator } from './types/session-delegation.js';
import type { TaskCredential } from './task-system/types.js';
import type { CheckoutWriterCredential } from './checkout-ownership.js';

/** Read-only task origin captured at spawn, never a writer claim. */
export type SessionTaskRequesterReference = {
  taskRef: string;
  coordinator: Pick<SessionDelegationCoordinator, 'workspaceId' | 'sessionKey' | 'sessionGeneration' | 'bindingRevision'>;
};

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

/** Runtime correlation; Main resolves the stored workspace before qualifying the run. */
export type SessionTaskEffectRequest = {
  requestId: string;
  sessionKey: string;
  sessionGeneration: string;
  runId: string;
  workspaceDir: string;
  /** Logical project root from the runtime sandbox owner when execution is isolated. */
  projectWorkspaceDir?: string;
  toolName: string;
  expectedClaimId?: string;
  /** Stable runtime tool identity; the transport requestId remains a separate correlation. */
  operationId?: string;
  checkoutAccess?: 'write' | 'control';
  expectedExecutionRevision?: number;
};

export type SessionTaskWriterClaim = {
  id: string;
  taskNodeId: TaskId;
  run: ScopedRunId;
  sessionGeneration: string;
  createdAt: string;
  credential?: TaskCredential;
  /** Captured execution binding, retained across a coordinator-only pause. */
  executionRevision?: number;
};

export type SessionTaskEffectAdmission = {
  status: 'granted';
  claim: SessionTaskWriterClaim;
  bindingRevision: number;
  checkout?: { baseRoot: string; worktreeId: string | null; credential: CheckoutWriterCredential; unused?: boolean };
};

export function parseSessionTaskEffectRequest(value: unknown): SessionTaskEffectRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TASK_SCOPE_REQUEST_INVALID');
  const record = value as Record<string, unknown>;
  const fields = ['requestId', 'sessionKey', 'sessionGeneration', 'runId', 'workspaceDir', 'toolName'] as const;
  for (const field of fields) {
    if (typeof record[field] !== 'string' || !record[field].trim() || record[field].length > 4096) {
      throw new Error(`TASK_SCOPE_REQUEST_INVALID: ${field}`);
    }
  }
  if (record.expectedClaimId !== undefined && (typeof record.expectedClaimId !== 'string' || !record.expectedClaimId)) {
    throw new Error('TASK_SCOPE_REQUEST_INVALID: expectedClaimId');
  }
  if (record.projectWorkspaceDir !== undefined && (typeof record.projectWorkspaceDir !== 'string' || !record.projectWorkspaceDir.trim())) {
    throw new Error('TASK_SCOPE_REQUEST_INVALID: projectWorkspaceDir');
  }
  if (record.operationId !== undefined && (typeof record.operationId !== 'string' || !record.operationId.trim() || record.operationId.length > 2048))
    throw new Error('TASK_SCOPE_REQUEST_INVALID: operationId');
  if (record.checkoutAccess !== undefined && !['write', 'control'].includes(String(record.checkoutAccess)))
    throw new Error('TASK_SCOPE_REQUEST_INVALID: checkoutAccess');
  if (record.checkoutAccess && !record.operationId) throw new Error('TASK_SCOPE_REQUEST_INVALID: operationId');
  if (record.expectedExecutionRevision !== undefined && (!Number.isSafeInteger(record.expectedExecutionRevision) || Number(record.expectedExecutionRevision) < 1))
    throw new Error('TASK_SCOPE_REQUEST_INVALID: expectedExecutionRevision');
  return Object.fromEntries([...fields, 'expectedClaimId', 'projectWorkspaceDir', 'operationId', 'checkoutAccess', 'expectedExecutionRevision'].filter((field) => record[field] !== undefined)
    .map((field) => [field, record[field]])) as SessionTaskEffectRequest;
}

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
    && link.nodeId === input.activeTaskNodeId
    && (!link.sessionGeneration || link.sessionGeneration === input.generation),
  );
  // A fork receives a task reference for reading, never a write claim. This
  // resolver is read-only, so a fork can still present its bound task; the
  // admission layer decides whether a write is allowed.
  if (!ownLink) {
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
