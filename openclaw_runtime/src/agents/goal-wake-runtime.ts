// Runtime Lifecycle Governance — goal-wake runtime facade.
//
// Phase 3 arm/dispatch/read implementations are split into bounded modules
// so the per-module line budget stays enforceable. This module owns the
// persisted turn-barrier ack and process-exit task finalization, then
// re-exports one runtime controller object for production callers.
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import { TaskFlowCasStore, type CasFlowRow } from "../tasks/task-flow-cas.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { armGoalWaitProcess } from "./goal-wake-arm.js";
import { goalWakeEnabled } from "./goal-wake-config.js";
import { runGoalWakeLevelCheckForTask } from "./goal-wake-dispatch.js";
import {
  GOAL_WAKE_CONTROLLER_ID,
  countActiveGoalWakeRowsForSession,
  getGoalWakeFlowRow,
  getGoalWakeTaskRunRow,
  getGoalWaitTask,
  getLatestMissionForSession,
} from "./goal-wake-read.js";
import {
  normalizeGoalWakeNumber,
  parseGoalWakeWaitJson,
  type GoalWakeAckResult,
  type GoalWakeLevelCheckResult,
  type GoalWakeTaskExitInput,
  type GoalWakeTaskRunRow,
} from "./goal-wake-types.js";

type GoalWakeFacadeDatabase = Pick<
  OpenClawStateKyselyDatabase,
  "flow_runs" | "task_runs"
>;

export async function ackGoalWaitYield(
  input: { flowId: string; sessionKey?: string },
  cfg?: OpenClawConfig,
  options: OpenClawStateDatabaseOptions = {},
): Promise<GoalWakeAckResult> {
  if (!goalWakeEnabled(cfg)) {
    return { ok: false, reason: "flag-disabled", message: "goal wake is disabled" };
  }
  const row = new TaskFlowCasStore(options).getById(input.flowId);
  if (!row) {
    return { ok: false, reason: "not-found", message: `flow not found: ${input.flowId}` };
  }
  if (row.controller_id !== GOAL_WAKE_CONTROLLER_ID) {
    return {
      ok: false,
      reason: "not-goal-wake",
      message: `flow ${input.flowId} is not a goal-wake flow`,
    };
  }
  if (input.sessionKey && row.owner_key !== input.sessionKey) {
    return {
      ok: false,
      reason: "session-mismatch",
      message: `flow ${input.flowId} is owned by ${row.owner_key}, not ${input.sessionKey}`,
    };
  }
  if (
    row.status === "succeeded" ||
    row.status === "failed" ||
    row.status === "cancelled" ||
    row.status === "lost"
  ) {
    return {
      ok: true,
      flowId: input.flowId,
      revision: normalizeGoalWakeNumber(row.revision) ?? 0,
      alreadyAcked: true,
      dispatched: false,
    };
  }
  if (row.status !== "waiting") {
    return {
      ok: false,
      reason: "illegal-transition",
      message: `flow ${input.flowId} is ${row.status}, not waiting`,
    };
  }
  const wait = parseGoalWakeWaitJson(row.wait_json);
  if (!wait) {
    return { ok: false, reason: "error", message: `flow ${input.flowId} has no wait_json` };
  }
  if (wait.turnBarrier === "acked") {
    return {
      ok: true,
      flowId: input.flowId,
      revision: normalizeGoalWakeNumber(row.revision) ?? 0,
      alreadyAcked: true,
      dispatched: false,
    };
  }
  const result = new TaskFlowCasStore(options).casUpsert({
    flowId: input.flowId,
    expectedRevision: normalizeGoalWakeNumber(row.revision) ?? 0,
    status: "waiting",
    controllerId: GOAL_WAKE_CONTROLLER_ID,
    ownerKey: row.owner_key,
    waitJson: JSON.stringify({ ...wait, turnBarrier: "acked" }),
    stateJson: row.state_json ?? undefined,
    blockedTaskId: row.blocked_task_id ?? undefined,
    blockedSummary: row.blocked_summary ?? undefined,
    currentStep: row.current_step ?? undefined,
    deliveryState: "barrier-acked",
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason === "illegal-transition" ? "illegal-transition" : "revision-conflict",
      message: result.message,
    };
  }
  return {
    ok: true,
    flowId: input.flowId,
    revision: result.revision,
    alreadyAcked: false,
    // Dispatch is level-triggered by the process-exit level-check; ack only
    // opens the persisted turn barrier.
    dispatched: false,
  };
}

/** Ack every still-pending goal-wait barrier owned by a session. */
export async function ackPendingGoalWaitFlowsForSession(
  sessionKey: string,
  cfg?: OpenClawConfig,
): Promise<GoalWakeAckResult[]> {
  if (!goalWakeEnabled(cfg) || !sessionKey.trim()) return [];
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<GoalWakeFacadeDatabase>(db);
  const rows = executeSqliteQuerySync<CasFlowRow>(
    db,
    query
      .selectFrom("flow_runs")
      .selectAll()
      .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
      .where("owner_key", "=", sessionKey.trim())
      .where("status", "=", "waiting"),
  ).rows;
  const acks: GoalWakeAckResult[] = [];
  for (const row of rows) {
    const wait = parseGoalWakeWaitJson(row.wait_json);
    if (!wait || wait.turnBarrier !== "pending") continue;
    acks.push(
      await ackGoalWaitYield({ flowId: row.flow_id, sessionKey: sessionKey.trim() }, cfg),
    );
    if (row.blocked_task_id) {
      await runGoalWakeLevelCheckForTask(row.blocked_task_id, { cfg });
    }
  }
  return acks;
}

/** Finalize only the task_runs row for a process exit. */
export async function finalizeGoalWaitTaskProcess(
  input: GoalWakeTaskExitInput,
  opts: {
    dispatch?: NonNullable<Parameters<typeof runGoalWakeLevelCheckForTask>[1]>["dispatch"];
    cfg?: OpenClawConfig;
    /**
     * Settle the row without waking. The timeout path needs this so it can
     * contain the OS process before the mission is told the wait is over.
     */
    skipWake?: boolean;
  } = {},
): Promise<{ task: GoalWakeTaskRunRow | undefined; levelCheck: GoalWakeLevelCheckResult }> {
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<GoalWakeFacadeDatabase>(db);
  const endedAt = input.endedAt ?? Date.now();
  const lastEventAt = input.lastEventAt ?? endedAt;
  const existing = executeSqliteQueryTakeFirstSync(
    db,
    query.selectFrom("task_runs").selectAll().where("task_id", "=", input.taskId),
  );
  if (!existing) {
    return {
      task: undefined,
      levelCheck: {
        taskId: input.taskId,
        taskStatus: "queued",
        terminal: false,
        flows: [{ flowId: "", outcome: "flow-missing", reason: "task not found" }],
      },
    };
  }
  if (
    existing.status !== "succeeded" &&
    existing.status !== "failed" &&
    existing.status !== "timed_out" &&
    existing.status !== "cancelled" &&
    existing.status !== "lost"
  ) {
    runOpenClawStateWriteTransaction(() => {
      executeSqliteQuerySync(
        db,
        query
          .updateTable("task_runs")
          .set({
            status: input.status,
            ended_at: endedAt,
            last_event_at: lastEventAt,
            error: input.error ?? existing.error,
            terminal_summary: input.terminalSummary ?? existing.terminal_summary,
            terminal_outcome:
              input.terminalOutcome ??
              (input.status === "succeeded" ? "succeeded" : existing.terminal_outcome),
          })
          .where("task_id", "=", input.taskId),
      );
    });
  }
  const task = getGoalWakeTaskRunRow(input.taskId);
  if (opts.skipWake) {
    return {
      task,
      levelCheck: {
        taskId: input.taskId,
        taskStatus: task?.status ?? input.status,
        terminal: true,
        flows: [],
      },
    };
  }
  const levelCheck = await runGoalWakeLevelCheckForTask(input.taskId, {
    ...(opts.dispatch ? { dispatch: opts.dispatch } : {}),
    ...(opts.cfg ? { cfg: opts.cfg } : {}),
  });
  return { task, levelCheck };
}

/**
 * Fire a `child` goal-wait when the spawned session it waits on has finished.
 *
 * This is the seam the subagent completion path calls. It owns no announce or
 * generation logic of its own: the caller is responsible for having decided the
 * completion is legitimate for the current parent generation, and this only
 * records the outcome so the normal level check produces the continuation.
 *
 * Completion delivery is at-least-once, so this must be idempotent. It is: the
 * task finalizer refuses to overwrite a terminal row, and the settled flow
 * keeps the level check from dispatching a second continuation.
 */
export async function fireGoalWaitChild(input: {
  taskId: string;
  status?: "succeeded" | "failed" | "cancelled" | "lost";
  endedAt?: number;
  error?: string;
  terminalSummary?: string;
}): Promise<{ task: GoalWakeTaskRunRow | undefined; levelCheck: GoalWakeLevelCheckResult }> {
  const endedAt = input.endedAt ?? Date.now();
  const status = input.status ?? "succeeded";
  return await finalizeGoalWaitTaskProcess({
    taskId: input.taskId,
    status,
    endedAt,
    lastEventAt: endedAt,
    ...(input.error ? { error: input.error } : {}),
    terminalSummary: input.terminalSummary ?? "subagent completed",
    ...(status === "succeeded" ? { terminalOutcome: "succeeded" as const } : {}),
  });
}

/**
 * Fire a `timer` goal-wait.
 *
 * This is the seam the Cron service calls when an `at` job comes due. It
 * deliberately owns no scheduling of its own: the existing single Cron
 * `setTimeout` decides *when*, and this only records that the deadline passed
 * and lets the normal level check produce the continuation.
 *
 * Cron delivery is at-least-once, so this must be idempotent. It is: the task
 * finalizer refuses to overwrite a terminal row, and the settled flow keeps the
 * level check from dispatching a second continuation.
 */
export async function fireGoalWaitTimer(input: {
  taskId: string;
  firedAt?: number;
  reason?: string;
}): Promise<{ task: GoalWakeTaskRunRow | undefined; levelCheck: GoalWakeLevelCheckResult }> {
  const firedAt = input.firedAt ?? Date.now();
  return await finalizeGoalWaitTaskProcess({
    taskId: input.taskId,
    status: "succeeded",
    endedAt: firedAt,
    lastEventAt: firedAt,
    terminalSummary: input.reason ?? "timer fired",
    terminalOutcome: "succeeded",
  });
}

/** Spawn outcome is unknown: enter lost and wake the owner. Never replay spawn. */
export async function markGoalWaitSpawnUnknown(
  taskId: string,
  error?: string,
): Promise<GoalWakeLevelCheckResult> {
  await finalizeGoalWaitTaskProcess({
    taskId,
    status: "lost",
    error: error ?? "spawn outcome unknown; command will not be replayed",
    terminalSummary: "spawn outcome unknown",
  });
  return await runGoalWakeLevelCheckForTask(taskId);
}

export const goalWakeRuntime = {
  goalWakeEnabled,
  armGoalWaitProcess,
  ackGoalWaitYield,
  ackPendingGoalWaitFlowsForSession,
  finalizeGoalWaitTaskProcess,
  fireGoalWaitChild,
  fireGoalWaitTimer,
  markGoalWaitSpawnUnknown,
  runGoalWakeLevelCheckForTask,
  getGoalWaitTask,
  getLatestMissionForSession,
  countActiveGoalWakeRowsForSession,
  getGoalWakeFlowRow,
  getGoalWakeTaskRunRow,
};
