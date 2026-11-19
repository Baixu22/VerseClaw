import { existsSync } from "node:fs";
import { TaskSystemStore } from "../../../shared/task-system/store.js";
import { resolveTaskDomain } from "../../../shared/task-system/identity.js";
import { createExecutionTaskAccess, openExecutionTaskStore, type ExecutionTaskAuthorityBasis } from "./execution-task-authority.js";
import type { TaskWriterDelegation,TaskCredential,TaskDelegationIntent } from "../../../shared/task-system/types.js";
import { managedProcessReservations } from './verseshell/managed-process-reservation.js';
import { listRunningSessions } from './bash-process-registry.js';
import { getProcessSupervisor } from '../process/supervisor/index.js';
import { resolveExecutionCheckout } from './worktree-service.js';

export type PreparedTaskDelegation = { workspace: string; record: TaskWriterDelegation; authorityBasis?: ExecutionTaskAuthorityBasis };

export function capturePersistentTaskDelegationIntent(input:{workspace?:string;childWorkspace?:string;parentSessionKey:string;parentGeneration?:string;childSessionKey:string;childGeneration?:string;childRunId:string;observer?:boolean}):TaskDelegationIntent|null{
  if(!input.workspace||!existsSync(input.workspace))return null;
  const access=createExecutionTaskAccess(input.workspace);const domain=access.domain;if(!existsSync(domain.database))return null;
  const store=new TaskSystemStore(domain, undefined, access);
  try{
    const parent=store.binding(input.parentSessionKey,input.parentGeneration);
    if(!parent)return null;
    if(parent.referenceOnly||!parent.claim||!input.parentGeneration||!input.childGeneration)throw new Error('TASK_DELEGATION_PARENT_NOT_WRITER');
    store.assertOwner(parent.claim);
    return {...input,workspace:input.workspace,childWorkspace:input.childWorkspace??input.workspace,parentGeneration:input.parentGeneration,childGeneration:input.childGeneration,observer:input.observer===true,authorityBasis:access.basis,expectedParent:{taskNodeId:parent.claim.taskNodeId,sessionKey:parent.claim.sessionKey,generation:parent.claim.generation,epoch:parent.claim.epoch}};
  }finally{store.close();}
}

/** Called after the child generation is durable and before Gateway dispatch. */
export function preparePersistentTaskDelegation(input: {
  workspace?: string;
  childWorkspace?: string;
  parentSessionKey: string;
  parentGeneration?: string;
  childSessionKey: string;
  childGeneration?: string;
  childRunId: string;
  observer?: boolean;
  expectedParent?:TaskCredential;
  authorityBasis?: ExecutionTaskAuthorityBasis;
}): PreparedTaskDelegation | null {
  if (!input.workspace || !existsSync(input.workspace)) return null;
  const access = createExecutionTaskAccess(input.workspace, input.authorityBasis);
  const domain = access.domain;
  if (access.basis.registrationRevision !== null && !input.authorityBasis) throw new Error('TASK_DELEGATION_AUTHORITY_REQUIRED');
  if (!existsSync(domain.database)) return null;
  const store = new TaskSystemStore(domain, undefined, access);
  try {
    const existing = store.delegationForChild(input.childSessionKey);
    if (existing) {
      if (
        existing.parent.sessionKey !== input.parentSessionKey ||
        existing.parent.generation !== input.parentGeneration ||
        existing.child.generation !== input.childGeneration ||
        existing.childRunId !== input.childRunId ||
        existing.childWorktree !==
          resolveTaskDomain(input.childWorkspace ?? input.workspace).worktree ||
        existing.mode !== (input.observer ? "observer" : "writer")
      )
        throw new Error("TASK_DELEGATION_IDENTITY_CONFLICT");
      if (existing.authorityBasis) createExecutionTaskAccess(input.workspace, existing.authorityBasis).assertCurrent();
      return { workspace: input.workspace, record: existing, authorityBasis: access.basis };
    }
    const parent = store.binding(input.parentSessionKey, input.parentGeneration);
    if (!parent) return null;
    if (parent.referenceOnly || !parent.claim) throw new Error("TASK_DELEGATION_PARENT_NOT_WRITER");
    if(input.expectedParent&&(parent.claim.taskNodeId!==input.expectedParent.taskNodeId||parent.claim.epoch!==input.expectedParent.epoch||parent.claim.generation!==input.expectedParent.generation))throw new Error('TASK_DELEGATION_PARENT_CHANGED_WHILE_QUEUED');
    if (!input.parentGeneration || parent.claim.generation !== input.parentGeneration)
      throw new Error("TASK_DELEGATION_PARENT_GENERATION_REQUIRED");
    if (!input.childGeneration) throw new Error("TASK_DELEGATION_CHILD_GENERATION_REQUIRED");
    const record = store.prepareWriterDelegation(parent.claim, {
      delegationId: input.childRunId,
      childSessionKey: input.childSessionKey,
      childGeneration: input.childGeneration,
      childWorktree: input.childWorkspace ?? input.workspace,
      childRunId: input.childRunId,
      mode: input.observer ? "observer" : "writer",
      authorityBasis: access.basis,
    });
    return { workspace: input.workspace, record, authorityBasis: access.basis };
  } finally {
    store.close();
  }
}

export function recordPersistentTaskDispatch(
  prepared: PreparedTaskDelegation | null,
  phase: "dispatched" | "unknown",
  runId: string,
): void {
  if (!prepared) return;
  const store = openExecutionTaskStore(prepared.workspace, prepared.authorityBasis);
  try {
    store.recordDelegationDispatch(prepared.record.child.sessionKey, runId, phase);
  } finally {
    store.close();
  }
}

/** Read the task owner's cancellation before emitting or replaying a worker completion. */
export function isCancelledPersistentTaskWorker(entry: {
  workspaceDir?: string; childSessionKey: string; runId: string; initialRunId?: string;
}): boolean {
  if (!entry.workspaceDir || !existsSync(entry.workspaceDir)) return false;
  const access = createExecutionTaskAccess(entry.workspaceDir);
  if (!existsSync(access.domain.database)) return false;
  const store = new TaskSystemStore(access.domain, undefined, access);
  try {
    const delegation = store.delegationForChild(entry.childSessionKey);
    if (!delegation || delegation.mode !== "writer" || delegation.childRunId !== (entry.initialRunId ?? entry.runId)) return false;
    const { contract } = store.get(delegation.taskNodeId);
    return contract.state === "cancelling" || contract.state === "cancelled";
  } finally {
    store.close();
  }
}

/** Registry supplies terminal timing; callers supply the current parent generation. */
export function returnPersistentTaskWriter(input: {
  workspace?: string;
  childSessionKey: string;
  runId: string;
  endedAt?: number;
  outcome: string;
  parentGeneration?: string;
}): TaskWriterDelegation | null {
  if (!input.workspace || !existsSync(input.workspace)) return null;
  const access = createExecutionTaskAccess(input.workspace);
  const domain = access.domain;
  if (!existsSync(domain.database)) return null;
  const store = new TaskSystemStore(domain, undefined, access);
  try {
    const delegation = store.delegationForChild(input.childSessionKey);
    if (!delegation) return null;
    if (typeof input.endedAt !== "number") throw new Error("TASK_TERMINAL_RECEIPT_REQUIRED");
    if (delegation.authorityBasis) createExecutionTaskAccess(delegation.parentWorktree, delegation.authorityBasis).assertCurrent();
    if (delegation.mode === 'writer') {
      const generation = delegation.child.generation;
      const durable = managedProcessReservations().some(record => !record.sessionKey || !record.sessionGeneration || !record.runId
        || (record.sessionKey === input.childSessionKey && record.sessionGeneration === generation));
      const live = listRunningSessions().some(process => (process.lifecycleCanonicalSessionKey ?? process.sessionKey) === input.childSessionKey
        && (!process.lifecycleExpectedSessionId || process.lifecycleExpectedSessionId === generation));
      const supervised = getProcessSupervisor().snapshotRunsForSession(input.childSessionKey).some(run => run.state !== 'exited'
        && (!run.lifecycleExpectedSessionId || run.lifecycleExpectedSessionId === generation));
      const checkout = resolveExecutionCheckout(delegation.childWorktree);
      const writer = checkout.service.writer(checkout.worktreeId);
      const checkoutPending = writer?.owner.kind === 'run' && writer.owner.run.scope.sessionKey === input.childSessionKey
        && writer.owner.sessionGeneration === generation && writer.operations.some(operation => operation.state !== 'settled');
      if (durable || live || supervised || checkoutPending) return store.markDelegationRecoveryRequired(input.childSessionKey,
        { runId: input.runId, endedAt: input.endedAt, outcome: input.outcome }, 'checkout-or-process-effects-pending');
    }
    return store.returnDelegatedWriter(input.childSessionKey, {
      runId: input.runId,
      endedAt: input.endedAt,
      outcome: input.outcome,
      parentGeneration: input.parentGeneration ?? "",
    });
  } finally {
    store.close();
  }
}
