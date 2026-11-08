// Task gateway methods expose detached task list/get/cancel operations with
// bounded public summaries over the runtime task registry.
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type TaskSummary,
  type TasksListParams,
  validateTasksCancelParams,
  validateTasksGetParams,
  validateTasksListParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { cancelDetachedTaskRunById } from "../../tasks/detached-task-runtime.js";
import { getTaskById, listTaskRecords } from "../../tasks/runtime-internal.js";
import type { TaskRecord, TaskStatus } from "../../tasks/task-registry.types.js";
import {
  TASK_STATUS_DETAIL_MAX_CHARS,
  formatTaskStatusTitle,
  sanitizeTaskStatusText,
} from "../../tasks/task-status.js";
import type { GatewayRequestHandlers } from "./types.js";
import { existsSync } from "node:fs";
import { TaskSystemStore } from "../../../../shared/task-system/store.js";
import { resolveTaskDomain } from "../../../../shared/task-system/identity.js";
import type { TaskCredential } from "../../../../shared/task-system/types.js";
import { loadSubagentSessionEntry } from "../../agents/subagent-session-reconciliation.js";

const DEFAULT_TASKS_LIST_LIMIT = 100;
const MAX_TASKS_LIST_LIMIT = 500;

type TaskLedgerStatus = TaskSummary["status"];

// Gateway task APIs preserve the older ledger status vocabulary while the
// runtime registry tracks finer-grained task states such as `lost`.
const TASK_STATUS_TO_LEDGER_STATUS: Record<TaskStatus, TaskLedgerStatus> = {
  queued: "queued",
  running: "running",
  succeeded: "completed",
  failed: "failed",
  timed_out: "timed_out",
  cancelled: "cancelled",
  lost: "failed",
};

const LEDGER_STATUS_TO_TASK_STATUSES: Record<TaskLedgerStatus, TaskStatus[]> = {
  queued: ["queued"],
  running: ["running"],
  completed: ["succeeded"],
  failed: ["failed", "lost"],
  timed_out: ["timed_out"],
  cancelled: ["cancelled"],
};

function taskUpdatedAt(task: TaskRecord): number {
  return task.lastEventAt ?? task.endedAt ?? task.startedAt ?? task.createdAt;
}

// Status text can originate from providers, shells, and subprocesses. Keep the
// public task shape bounded before it reaches control-plane clients.
function sanitizeOptionalTaskText(
  value: unknown,
  opts?: { errorContext?: boolean },
): string | undefined {
  const sanitized = sanitizeTaskStatusText(value, {
    errorContext: opts?.errorContext,
    maxChars: TASK_STATUS_DETAIL_MAX_CHARS,
  });
  return sanitized || undefined;
}

function mapTaskSummary(task: TaskRecord): TaskSummary {
  const progressSummary = sanitizeOptionalTaskText(task.progressSummary);
  const terminalSummary = sanitizeOptionalTaskText(task.terminalSummary, { errorContext: true });
  const error = sanitizeOptionalTaskText(task.error, { errorContext: true });
  return {
    id: task.taskId,
    taskId: task.taskId,
    kind: task.taskKind ?? task.runtime,
    runtime: task.runtime,
    status: TASK_STATUS_TO_LEDGER_STATUS[task.status],
    title: formatTaskStatusTitle(task),
    ...(task.agentId ? { agentId: task.agentId } : {}),
    sessionKey: task.requesterSessionKey,
    ...(task.childSessionKey ? { childSessionKey: task.childSessionKey } : {}),
    ownerKey: task.ownerKey,
    ...(task.runId ? { runId: task.runId } : {}),
    ...(task.parentFlowId ? { flowId: task.parentFlowId } : {}),
    ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
    ...(task.sourceId ? { sourceId: task.sourceId } : {}),
    createdAt: task.createdAt,
    updatedAt: taskUpdatedAt(task),
    ...(task.startedAt !== undefined ? { startedAt: task.startedAt } : {}),
    ...(task.endedAt !== undefined ? { endedAt: task.endedAt } : {}),
    ...(progressSummary ? { progressSummary } : {}),
    ...(terminalSummary ? { terminalSummary } : {}),
    ...(error ? { error } : {}),
  };
}

function normalizeTaskStatusFilter(status: TasksListParams["status"]): Set<TaskStatus> | null {
  if (!status) {
    return null;
  }
  const statuses = Array.isArray(status) ? status : [status];
  return new Set(statuses.flatMap((value) => LEDGER_STATUS_TO_TASK_STATUSES[value] ?? []));
}

// Session filtering needs all ownership keys because detached child runs may be
// queried from the requester, child session, or owner/control-plane view.
function taskMatchesSession(task: TaskRecord, sessionKey: string | undefined): boolean {
  const normalized = normalizeOptionalString(sessionKey);
  if (!normalized) {
    return true;
  }
  return [task.requesterSessionKey, task.childSessionKey, task.ownerKey].some(
    (candidate) => normalizeOptionalString(candidate) === normalized,
  );
}

// Some records predate a direct `agentId`, so task listings still recover the
// owning agent from session-style keys instead of hiding those tasks.
function taskMatchesAgent(task: TaskRecord, agentId: string | undefined): boolean {
  const normalized = normalizeOptionalString(agentId);
  if (!normalized) {
    return true;
  }
  if (normalizeOptionalString(task.agentId) === normalized) {
    return true;
  }
  return [task.requesterSessionKey, task.childSessionKey, task.ownerKey].some(
    (candidate) => parseAgentSessionKey(candidate)?.agentId === normalized,
  );
}

// Cursor strings are offsets, not opaque tokens; reject malformed values so a
// client cannot silently restart pagination at the first page.
function parseCursor(cursor: string | undefined): number | null {
  if (!cursor) {
    return 0;
  }
  if (!/^\d+$/.test(cursor.trim())) {
    return null;
  }
  const parsed = Number(cursor);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

// Control UI task methods expose the stable gateway protocol shape; helpers
// above keep runtime registry details out of the wire result.
export const tasksHandlers: GatewayRequestHandlers = {
  "tasks.contract.reconcile": async ({ params, respond, context }) => {
    try {
      const c = params.credential as TaskCredential | undefined;
      if (
        !c ||
        typeof c.taskNodeId !== "string" ||
        typeof c.sessionKey !== "string" ||
        typeof c.generation !== "string" ||
        !Number.isSafeInteger(c.epoch) ||
        typeof params.operationId !== "string" ||
        typeof params.effectReceiptId !== "string" ||
        typeof params.workspaceDir !== "string"
      )
        throw new Error("TASK_RECONCILIATION_INPUT_INVALID");
      const session = loadSubagentSessionEntry({
        childSessionKey: c.sessionKey,
        cfg: context.getRuntimeConfig(),
      });
      if (session?.sessionId !== c.generation) throw new Error("TASK_GENERATION_STALE");
      const domain = resolveTaskDomain(params.workspaceDir);
      if (!existsSync(domain.database)) throw new Error("TASK_STORE_UNAVAILABLE");
      const store = new TaskSystemStore(domain);
      try {
        const { reconcilePersistentTaskEffect } =
          await import("../../agents/persistent-task-acceptance.js");
        respond(
          true,
          {
            success: true,
            task: reconcilePersistentTaskEffect(
              store,
              c,
              params.operationId,
              params.effectReceiptId,
            ),
          },
          undefined,
        );
      } finally {
        store.close();
      }
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "tasks.contract.receipt": async ({ params, respond, context }) => {
    try {
      const refs = params.refs as
        | {
            taskId: string;
            candidateDigest: string;
            generation: string;
            verifierReceiptId: string;
            effectReceiptId: string;
          }
        | undefined;
      if (
        !refs ||
        Object.values(refs).some((value) => typeof value !== "string") ||
        typeof params.workspaceDir !== "string"
      )
        throw new Error("TASK_RECEIPT_INPUT_INVALID");
      const domain = resolveTaskDomain(params.workspaceDir);
      if (!existsSync(domain.database)) throw new Error("TASK_STORE_UNAVAILABLE");
      const store = new TaskSystemStore(domain);
      try {
        const owner = store.get(refs.taskId).claim;
        if (!owner) throw new Error("TASK_OWNER_MISSING");
        const session = loadSubagentSessionEntry({
          childSessionKey: owner.sessionKey,
          cfg: context.getRuntimeConfig(),
        });
        if (session?.sessionId !== refs.generation) throw new Error("TASK_GENERATION_STALE");
        const { readPersistentTaskCompletionReceipt } =
          await import("../../agents/persistent-task-acceptance.js");
        respond(true, { ok: true, ...readPersistentTaskCompletionReceipt(store, refs) }, undefined);
      } finally {
        store.close();
      }
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "tasks.contract.accept": async ({ params, respond, context }) => {
    try {
      const credential = params.credential as TaskCredential | undefined;
      if (
        !credential ||
        typeof credential.taskNodeId !== "string" ||
        typeof credential.sessionKey !== "string" ||
        typeof credential.generation !== "string" ||
        !Number.isSafeInteger(credential.epoch) ||
        credential.epoch < 1 ||
        typeof params.workspaceDir !== "string" ||
        typeof params.candidate !== "string"
      )
        throw new Error("TASK_ACCEPTANCE_INPUT_INVALID");
      const session = loadSubagentSessionEntry({
        childSessionKey: credential.sessionKey,
        cfg: context.getRuntimeConfig(),
      });
      if (session?.sessionId !== credential.generation) throw new Error("TASK_GENERATION_STALE");
      const domain = resolveTaskDomain(params.workspaceDir);
      if (!existsSync(domain.database)) throw new Error("TASK_STORE_UNAVAILABLE");
      const store = new TaskSystemStore(domain);
      try {
        const { acceptPersistentTask } = await import("../../agents/persistent-task-acceptance.js");
        respond(
          true,
          { success: true, task: acceptPersistentTask(store, credential, params.candidate) },
          undefined,
        );
      } finally {
        store.close();
      }
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  },
  "tasks.list": ({ params, respond }) => {
    if (!validateTasksListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tasks.list params: ${formatValidationErrors(validateTasksListParams.errors)}`,
        ),
      );
      return;
    }
    const cursor = parseCursor(params.cursor);
    if (cursor === null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid tasks.list cursor"),
      );
      return;
    }
    const statusFilter = normalizeTaskStatusFilter(params.status);
    const limit = Math.min(params.limit ?? DEFAULT_TASKS_LIST_LIMIT, MAX_TASKS_LIST_LIMIT);
    const filtered = listTaskRecords().filter((task) => {
      if (statusFilter && !statusFilter.has(task.status)) {
        return false;
      }
      return taskMatchesAgent(task, params.agentId) && taskMatchesSession(task, params.sessionKey);
    });
    const page = filtered.slice(cursor, cursor + limit);
    const nextOffset = cursor + page.length;
    respond(true, {
      tasks: page.map((task) => mapTaskSummary(task)),
      ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}),
    });
  },
  "tasks.get": ({ params, respond }) => {
    if (!validateTasksGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tasks.get params: ${formatValidationErrors(validateTasksGetParams.errors)}`,
        ),
      );
      return;
    }
    const taskId = params.taskId;
    const task = getTaskById(taskId);
    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${taskId}`),
      );
      return;
    }
    respond(true, { task: mapTaskSummary(task) });
  },
  "tasks.cancel": async ({ params, respond, context }) => {
    if (!validateTasksCancelParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tasks.cancel params: ${formatValidationErrors(validateTasksCancelParams.errors)}`,
        ),
      );
      return;
    }
    const taskId = params.taskId;
    const reason = normalizeOptionalString(params.reason);
    const result = await cancelDetachedTaskRunById({
      cfg: context.getRuntimeConfig(),
      taskId,
      ...(reason ? { reason } : {}),
    });
    respond(true, {
      found: result.found,
      cancelled: result.cancelled,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.task ? { task: mapTaskSummary(result.task) } : {}),
    });
  },
};

export const testApi = {
  mapTaskSummary,
};
export { testApi as __test };
