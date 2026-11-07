import { existsSync } from "node:fs";
import { TaskSystemStore } from "./store.js";
import { resolveTaskDomain } from "./identity.js";
import type { TaskCredential } from "./types.js";

export function assertTaskWorktreeReleasable(workspace: string): void {
  if (!existsSync(workspace)) return;
  const domain = resolveTaskDomain(workspace);
  if (!existsSync(domain.database)) return;
  const store = new TaskSystemStore(domain);
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
function keepTaskRun(guard: NonNullable<ReturnType<typeof createTaskRuntimeGuard>>) {
  if (!guard.credential || !guard.runId) return;
  const key = JSON.stringify([
    guard.domain.id,
    guard.sessionKey,
    guard.runId,
    guard.credential.epoch,
  ]);
  const store = new TaskSystemStore(guard.domain);
  try {
    store.beginRun(guard.credential, guard.runId);
  } finally {
    store.close();
  }
  if (activeRuns.has(key)) return;
  const credential = guard.credential;
  const timer = setInterval(() => {
    let db: TaskSystemStore | undefined;
    try {
      db = new TaskSystemStore(guard.domain);
      db.control(credential, "renew");
    } catch {
      clearInterval(timer);
      activeRuns.delete(key);
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
    const store = new TaskSystemStore(entry.guard.domain);
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
) {
  if (!workspace || !sessionKey) return null;
  if (!existsSync(workspace)) return null;
  const domain = resolveTaskDomain(workspace);
  if (!existsSync(domain.database))
    return { domain, credential: null as TaskCredential | null, sessionKey, generation, runId };
  const store = new TaskSystemStore(domain);
  try {
    const view = store.binding(sessionKey, generation);
    if (!view || view.referenceOnly)
      return { domain, credential: null as TaskCredential | null, sessionKey, generation, runId };
    if (!generation || !view.claim) throw new Error("TASK_RUNTIME_GENERATION_REQUIRED");
    const credential: TaskCredential = {
      taskNodeId: view.contract.taskNodeId,
      sessionKey: view.claim.sessionKey,
      generation,
      epoch: view.claim.epoch,
    };
    return { domain, credential, sessionKey, generation, runId };
  } finally {
    store.close();
  }
}

export function readPersistentTaskContext(
  workspace: string | undefined,
  sessionKey: string | undefined,
  generation: string | undefined,
  runId?: string,
): string | null {
  const guard = createTaskRuntimeGuard(workspace, sessionKey, generation, runId);
  if (!guard || !existsSync(guard.domain.database)) return null;
  const store = new TaskSystemStore(guard.domain);
  try {
    if (guard.credential && store.get(guard.credential.taskNodeId).claim?.state === "active")
      keepTaskRun(guard);
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
  const store = new TaskSystemStore(guard.domain);
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
    if (!guard.credential && !view.referenceOnly)
      guard.credential = {
        taskNodeId: view.contract.taskNodeId,
        sessionKey: view.claim.sessionKey,
        generation: view.claim.generation,
        epoch: view.claim.epoch,
      };
    if (!view.referenceOnly) {
      if (!guard.credential) throw new Error("TASK_CLAIM_REQUIRED");
      store.assertOwner(guard.credential, true);
      if (view.claim.state === "active") keepTaskRun(guard);
    }
    const marker = "\n<PERSISTENT_TASK_CONTRACT>\n";
    const index = basePrompt.lastIndexOf(marker);
    const prefix = index < 0 ? basePrompt : basePrompt.slice(0, index);
    const text = store
      .context(guard.sessionKey, guard.generation)!
      .replaceAll("<", "\\u003c")
      .replaceAll(">", "\\u003e");
    if (text.length > maxTaskChars) throw new Error("TASK_MODEL_CONTEXT_BUDGET_EXCEEDED");
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
  const readonlyTools = new Set([
    "read",
    "grep",
    "find",
    "ls",
    "web_search",
    "web_fetch",
    "session_status",
    "task_control",
    "read_file",
    "read_files",
    "search_content",
    "result_query",
    "list_directory",
  ]);
  if (!existsSync(guard.domain.database)) {
    if (guard.credential) throw new Error("TASK_STORE_UNAVAILABLE");
    if(readonlyTools.has(toolName))return execute();
    throw new Error('TASK_CLAIM_REQUIRED: create or select the persistent task with task_control before executing side effects');
  }
  if (toolName === "task_control") return execute();
  if (!guard.credential && guard.generation) {
    const bindingStore = new TaskSystemStore(guard.domain);
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
    if (readonlyTools.has(toolName)) return execute();
    throw new Error("TASK_CLAIM_REQUIRED");
  }
  const store = new TaskSystemStore(guard.domain);
  const credential = guard.credential;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    if (store.binding(guard.sessionKey, guard.generation)?.referenceOnly) {
      if (readonlyTools.has(toolName)) return execute();
      throw new Error("TASK_REFERENCE_READ_ONLY");
    }
    if (
      toolName === "process" &&
      ["poll", "log", "list"].includes(String((params as { action?: unknown } | null)?.action))
    ) {
      store.assertOwner(credential, true);
      const result = await execute();
      store.reconcileProcessResult(credential, result);
      return result;
    }
    store.assertOwner(credential);
    keepTaskRun(guard);
    if (readonlyTools.has(toolName)) return execute();
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
      store.recordToolVerification(credential, toolName, params, result, verificationInputs);
    return result;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    store.close();
  }
}
