import { existsSync } from "node:fs";
import { TaskSystemStore } from "../../../shared/task-system/store.js";
import { resolveTaskDomain } from "../../../shared/task-system/identity.js";
import type { TaskWriterDelegation,TaskCredential,TaskDelegationIntent } from "../../../shared/task-system/types.js";

export type PreparedTaskDelegation = { workspace: string; record: TaskWriterDelegation };

export function capturePersistentTaskDelegationIntent(input:{workspace?:string;childWorkspace?:string;parentSessionKey:string;parentGeneration?:string;childSessionKey:string;childGeneration?:string;childRunId:string;observer?:boolean}):TaskDelegationIntent|null{
  if(!input.workspace||!existsSync(input.workspace))return null;
  const domain=resolveTaskDomain(input.workspace);if(!existsSync(domain.database))return null;
  const store=new TaskSystemStore(domain);
  try{
    const parent=store.binding(input.parentSessionKey,input.parentGeneration);
    if(!parent)return null;
    if(parent.referenceOnly||!parent.claim||!input.parentGeneration||!input.childGeneration)throw new Error('TASK_DELEGATION_PARENT_NOT_WRITER');
    store.assertOwner(parent.claim);
    return {...input,workspace:input.workspace,childWorkspace:input.childWorkspace??input.workspace,parentGeneration:input.parentGeneration,childGeneration:input.childGeneration,observer:input.observer===true,expectedParent:{taskNodeId:parent.claim.taskNodeId,sessionKey:parent.claim.sessionKey,generation:parent.claim.generation,epoch:parent.claim.epoch}};
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
}): PreparedTaskDelegation | null {
  if (!input.workspace || !existsSync(input.workspace)) return null;
  const domain = resolveTaskDomain(input.workspace);
  if (!existsSync(domain.database)) return null;
  const store = new TaskSystemStore(domain);
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
      return { workspace: input.workspace, record: existing };
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
    });
    return { workspace: input.workspace, record };
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
  const store = new TaskSystemStore(resolveTaskDomain(prepared.workspace));
  try {
    store.recordDelegationDispatch(prepared.record.child.sessionKey, runId, phase);
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
  const domain = resolveTaskDomain(input.workspace);
  if (!existsSync(domain.database)) return null;
  const store = new TaskSystemStore(domain);
  try {
    if (!store.delegationForChild(input.childSessionKey)) return null;
    if (typeof input.endedAt !== "number") throw new Error("TASK_TERMINAL_RECEIPT_REQUIRED");
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
