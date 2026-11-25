import { existsSync } from "node:fs";
import { TaskSystemStore } from "./store.js";
import { resolveTaskDomain, type TaskAuthorityAccess } from "./identity.js";
import type { TaskCredential } from "./types.js";
import type { TaskModelCall, TaskModelUsage } from './trace.js';
import { isReadOnlyTaskTool } from './tool-policy.js';

/** Capture the original execution before the request; settlement keeps that identity. */
export function createTaskModelUsageRecorder(guard: ReturnType<typeof createTaskRuntimeGuard>) {
  const calls = new Map<string, TaskModelCall>();
  return {
    start(callId: string, provider: string, model: string): void {
      if (!guard?.runId || !guard.generation || !existsSync(guard.domain.database)) return;
      const store = new TaskSystemStore(guard.domain, undefined, guard.access);
      try {
        const credential = guard.credential ?? store.modelCallScope(guard.sessionKey, guard.generation, guard.runId)?.credential;
        if (!credential || credential.sessionKey !== guard.sessionKey || credential.generation !== guard.generation) return;
        calls.set(callId, store.beginModelCall(credential, { callId, runId: guard.runId, provider, model }));
      } finally { store.close(); }
    },
    finish(callId: string, usage: TaskModelUsage): void {
      const call = calls.get(callId);
      if (!call || !guard) return;
      const store = new TaskSystemStore(guard.domain, undefined, guard.access);
      try { store.recordModelUsage(call.credential, callId, usage); calls.delete(callId); }
      finally { store.close(); }
    },
  };
}

/** Session lineage and generations come from the session owner; forks inherit no claim. */
export function inheritPersistentTaskReference(workspace:string,sourceSessionKey:string,sourceGeneration:string,sessionKey:string,generation:string,access?:TaskAuthorityAccess) {
  if (!existsSync(workspace)) return null;
  const domain=access?.domain??resolveTaskDomain(workspace);
  if (!existsSync(domain.database)) return null;
  const store=new TaskSystemStore(domain,undefined,access);
  try {return store.inheritReference(sourceSessionKey,sourceGeneration,sessionKey,generation);}
  finally {store.close();}
}

export function assertTaskWorktreeReleasable(workspace: string, access?: TaskAuthorityAccess): void {
  if (!existsSync(workspace)) return;
  const domain = access?.domain ?? resolveTaskDomain(workspace);
  if (!existsSync(domain.database)) return;
  const store = new TaskSystemStore(domain, undefined, access);
  try {
    if (store.worktreeTaskReferences(workspace).length)
      throw new Error("TASK_WORKTREE_HAS_UNFINISHED_TASKS");
  } finally {
    store.close();
  }
}

const activeRuns = new Map<
  string,
  {
    guard: NonNullable<ReturnType<typeof createTaskRuntimeGuard>>;
    timer: ReturnType<typeof setInterval>;
  }
>();
function keepTaskRun(guard: NonNullable<ReturnType<typeof createTaskRuntimeGuard>>, allowPaused = false) {
  if (!guard.credential || !guard.runId) return;
  const key = JSON.stringify([
    guard.domain.id,
    guard.sessionKey,
    guard.runId,
    guard.credential.epoch,
  ]);
  const store = new TaskSystemStore(guard.domain, undefined, guard.access);
  try {
    store.beginRun(guard.credential, guard.runId, allowPaused);
  } finally {
    store.close();
  }
  if (activeRuns.has(key)) return;
  const credential = guard.credential;
  const timer = setInterval(() => {
    let db: TaskSystemStore | undefined;
    try {
      db = new TaskSystemStore(guard.domain, undefined, guard.access);
      const view = db.assertOwner(credential, true);
      if (view.claim?.state === "active") db.control(credential, "renew");
    } catch {
      clearInterval(timer);
    } finally {
      db?.close();
    }
  }, 30_000);
  timer.unref();
  activeRuns.set(key, { guard, timer });
}

export function finishPersistentTaskRun(
  workspace: string,
  sessionKey: string | undefined,
  runId: string,
) {
  if (!sessionKey) return;
  for (const [key, entry] of activeRuns) {
    if (
      entry.guard.sessionKey !== sessionKey ||
      entry.guard.runId !== runId ||
      entry.guard.domain.worktree !== resolveTaskDomain(workspace).worktree
    )
      continue;
    clearInterval(entry.timer);
    activeRuns.delete(key);
    const store = new TaskSystemStore(entry.guard.domain, undefined, entry.guard.access);
    try {
      if (entry.guard.credential) store.endRun(entry.guard.credential, runId);
    } finally {
      store.close();
    }
  }
}

/** Captured once per execution, so handoff cannot silently upgrade an old run. */
export function createTaskRuntimeGuard(
  workspace: string | undefined,
  sessionKey: string | undefined,
  generation: string | undefined,
  runId?: string,
  access?: TaskAuthorityAccess,
) {
  if (!workspace || !sessionKey) return null;
  if (!existsSync(workspace)) return null;
  const domain = access?.domain ?? resolveTaskDomain(workspace);
  if (!existsSync(domain.database))
    return { domain, access, credential: null as TaskCredential | null, sessionKey, generation, runId };
  const store = new TaskSystemStore(domain, undefined, access);
  try {
    const view = store.binding(sessionKey, generation);
    if (!view || view.referenceOnly)
      return { domain, access, credential: null as TaskCredential | null, sessionKey, generation, runId };
    if (!generation || !view.claim) throw new Error("TASK_RUNTIME_GENERATION_REQUIRED");
    const credential: TaskCredential = {
      taskNodeId: view.contract.taskNodeId,
      sessionKey: view.claim.sessionKey,
      generation,
      epoch: view.claim.epoch,
    };
    return { domain, access, credential, sessionKey, generation, runId };
  } finally {
    store.close();
  }
}

export function readPersistentTaskContext(
  workspace: string | undefined,
  sessionKey: string | undefined,
  generation: string | undefined,
  runId?: string,
  access?: TaskAuthorityAccess,
): string | null {
  const guard = createTaskRuntimeGuard(workspace, sessionKey, generation, runId, access);
  if (!guard || !existsSync(guard.domain.database)) return null;
  const store = new TaskSystemStore(guard.domain, undefined, guard.access);
  try {
    if (guard.credential) keepTaskRun(guard, store.get(guard.credential.taskNodeId).claim?.state !== "active");
    return store.context(sessionKey!, generation);
  } finally {
    store.close();
  }
}

/** Each provider call rehydrates the goal even after an in-turn compaction. */
export function restoreTaskModelContext(
  guard: ReturnType<typeof createTaskRuntimeGuard>,
  basePrompt: string,
  maxTaskChars = 12_000,
): string {
  if (!guard) return basePrompt;
  if (!existsSync(guard.domain.database)) {
    if (guard.credential) throw new Error("TASK_STORE_UNAVAILABLE");
    return basePrompt;
  }
  const store = new TaskSystemStore(guard.domain, undefined, guard.access);
  try {
    const view = store.binding(guard.sessionKey, guard.generation);
    if (!view?.claim) {
      const marker = "\n<PERSISTENT_TASK_CONTRACT>\n";
      const index = basePrompt.lastIndexOf(marker);
      if (guard.credential) {
        const former = store.get(guard.credential.taskNodeId);
        if (!["done", "cancelled"].includes(former.contract.state))
          throw new Error("TASK_STALE_OWNER");
      }
      return index < 0 ? basePrompt : basePrompt.slice(0, index);
    }
    // Main can renew an expired idle claim for this exact run. A separately
    // captured model context adopts it only after that run admission is durable.
    const admittedContinuation = guard.credential && view.claim.epoch > guard.credential.epoch
      && view.contract.taskNodeId === guard.credential.taskNodeId
      && view.claim.sessionKey === guard.sessionKey && view.claim.generation === guard.generation
      && guard.runId && store.activeRun(view.claim) === guard.runId;
    if ((!guard.credential || admittedContinuation) && !view.referenceOnly)
      guard.credential = {
        taskNodeId: view.contract.taskNodeId,
        sessionKey: view.claim.sessionKey,
        generation: view.claim.generation,
        epoch: view.claim.epoch,
      };
    if (!view.referenceOnly) {
      if (!guard.credential) throw new Error("TASK_CLAIM_REQUIRED");
      store.assertOwner(guard.credential, true);
      keepTaskRun(guard, view.claim.state !== "active");
    }
    const marker = "\n<PERSISTENT_TASK_CONTRACT>\n";
    const index = basePrompt.lastIndexOf(marker);
    const prefix = index < 0 ? basePrompt : basePrompt.slice(0, index);
    const taskContext = store.context(guard.sessionKey, guard.generation)!;
    const text = taskContext
      .replaceAll("<", "\\u003c")
      .replaceAll(">", "\\u003e");
    if (text.length > maxTaskChars) throw new Error("TASK_MODEL_CONTEXT_BUDGET_EXCEEDED");
    store.recordContextHydration({
      sessionKey:guard.sessionKey,generation:guard.generation,runId:guard.runId,
      taskNodeId:view.contract.taskNodeId,revision:view.contract.revision,epoch:view.claim.epoch,context:taskContext,
    });
    return `${prefix}${marker}${text}\n</PERSISTENT_TASK_CONTRACT>`;
  } finally {
    store.close();
  }
}

export async function executeTaskGuarded<T>(
  guard: ReturnType<typeof createTaskRuntimeGuard>,
  operationId: string,
  toolName: string,
  execute: () => Promise<T>,
  params?: unknown,
): Promise<T> {
  if (!guard) return execute();
  const readOnly = isReadOnlyTaskTool(toolName, params);
  if (!existsSync(guard.domain.database)) {
    if (guard.credential) throw new Error("TASK_STORE_UNAVAILABLE");
    if (readOnly) return execute();
    throw new Error(
      "TASK_CLAIM_REQUIRED: create or select the persistent task with task_control before executing side effects",
    );
  }
  if (toolName === "task_control") return execute();
  if (!guard.credential && guard.generation) {
    const bindingStore = new TaskSystemStore(guard.domain, undefined, guard.access);
    try {
      const bound = bindingStore.binding(guard.sessionKey, guard.generation);
      if (bound?.claim && !bound.referenceOnly)
        guard.credential = {
          taskNodeId: bound.contract.taskNodeId,
          sessionKey: bound.claim.sessionKey,
          generation: guard.generation,
          epoch: bound.claim.epoch,
        };
    } finally {
      bindingStore.close();
    }
  }
  if (!guard.credential) {
    if (toolName === 'read' && readOnly) {
      const reader = new TaskSystemStore(guard.domain, undefined, guard.access);
      try {
        const result = await execute();
        reader.recordReviewRead(guard.sessionKey, guard.generation, operationId, result);
        return result;
      } finally { reader.close(); }
    }
    if (readOnly) return execute();
    throw new Error("TASK_CLAIM_REQUIRED");
  }
  const store = new TaskSystemStore(guard.domain, undefined, guard.access);
  const credential = guard.credential;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    if (store.binding(guard.sessionKey, guard.generation)?.referenceOnly) {
      if (readOnly) return execute();
      throw new Error("TASK_REFERENCE_READ_ONLY");
    }
    if (
      toolName === "process" &&
      ["poll", "log", "list", "kill"].includes(String((params as { action?: unknown } | null)?.action))
    ) {
      store.assertOwner(credential, true);
      const result = await execute();
      store.reconcileProcessResult(credential, result);
      return result;
    }
    const owner = store.assertOwner(credential, readOnly);
    keepTaskRun(guard, readOnly && owner.claim?.state !== "active");
    if (readOnly) return execute();
    const verificationInputs = store.verificationInputs(credential, toolName, params);
    store.beginOperation(credential, operationId, toolName);
    heartbeat = setInterval(() => {
      try {
        store.control(credential, "renew");
      } catch {
        /* The final owner check rejects a lost lease. */
      }
    }, 30_000);
    heartbeat.unref();
    let result: T;
    try {
      result = await execute();
    } catch (error) {
      store.finishOperation(credential, operationId, "unknown", String(error));
      throw error;
    }
    // Background tools may return before their child has finished. Keep their
    // outcome unresolved until the process/effect owner supplies a receipt.
    const details = (
      result as {
        details?: { sessionId?: string; processId?: string; status?: string; exitCode?: number };
      } | null
    )?.details;
    const background = details?.status === "running" || details?.status === "background";
    const handle = details?.sessionId ?? details?.processId;
    store.finishOperation(
      credential,
      operationId,
      background ? "unknown" : "completed",
      background ? "background operation requires owner reconciliation" : "tool returned",
      background && handle ? { handle, params, inputs: verificationInputs } : undefined,
    );
    if (
      !background &&
      store.binding(guard.sessionKey, guard.generation)?.referenceOnly !== true &&
      store.get(credential.taskNodeId).contract.state !== "cancelled"
    )
      store.recordToolVerification(credential, toolName, params, result, verificationInputs, operationId);
    return result;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    store.close();
  }
}
