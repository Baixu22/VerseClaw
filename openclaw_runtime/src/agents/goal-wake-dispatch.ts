// Runtime Lifecycle Governance — goal-wake level-check dispatch.
import {
  executeSqliteQuerySync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { openOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import { TaskFlowCasStore, type CasFlowRow } from "../tasks/task-flow-cas.js";
import { resolveGoalWakeBudgets } from "./goal-wake-config.js";
import { missionFencingController } from "./goal-wake-fencing.js";
import {
  GOAL_WAKE_CONTROLLER_ID,
  getGoalWakeTaskRunRow,
} from "./goal-wake-read.js";
import {
  normalizeGoalWakeNumber,
  parseGoalWakeWaitJson,
  type GoalWakeDispatch,
  type GoalWakeDispatchInput,
  type GoalWakeDispatchResult,
  type GoalWakeLevelCheckResult,
} from "./goal-wake-types.js";
import { getMissionRun } from "./mission-control/store.js";

type GoalWakeDispatchDatabase = Pick<
  OpenClawStateKyselyDatabase,
  "flow_runs" | "mission_runs" | "task_runs"
>;

const goalWakeBackoffUntil = new Map<string, number>();
const goalWakeRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function isBackoffActive(missionId: string, now: number): boolean {
  const until = goalWakeBackoffUntil.get(missionId);
  return typeof until === "number" && until > now;
}

function recordBackoff(missionId: string, delayMs: number): void {
  if (delayMs <= 0) return;
  goalWakeBackoffUntil.set(missionId, Date.now() + delayMs);
}

function clearRetryTimer(taskId: string): void {
  const timer = goalWakeRetryTimers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    goalWakeRetryTimers.delete(taskId);
  }
}

function scheduleRetry(taskId: string, delayMs: number): void {
  if (delayMs <= 0) return;
  clearRetryTimer(taskId);
  const timer = setTimeout(() => {
    goalWakeRetryTimers.delete(taskId);
    void runGoalWakeLevelCheckForTask(taskId);
  }, delayMs);
  timer.unref?.();
  goalWakeRetryTimers.set(taskId, timer);
}

/** Wake once per effect ACK; duplicate delivery is deduped by mission fencing. */
export async function runGoalWakeLevelCheckForTask(
  taskId: string,
  opts: { dispatch?: GoalWakeDispatch; cfg?: OpenClawConfig } = {},
): Promise<GoalWakeLevelCheckResult> {
  const task = getGoalWakeTaskRunRow(taskId);
  const terminal =
    task?.status === "succeeded" ||
    task?.status === "failed" ||
    task?.status === "timed_out" ||
    task?.status === "cancelled" ||
    task?.status === "lost";
  if (!terminal) {
    return {
      taskId,
      taskStatus: task?.status ?? "queued",
      terminal: false,
      flows: [],
    };
  }

  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<GoalWakeDispatchDatabase>(db);
  const flows = executeSqliteQuerySync<CasFlowRow>(
    db,
    query
      .selectFrom("flow_runs")
      .selectAll()
      .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
      .where("blocked_task_id", "=", taskId)
      .where("status", "in", ["waiting", "running"])
      .orderBy("created_at", "asc"),
  ).rows;

  const outcomes: GoalWakeLevelCheckResult["flows"] = [];
  for (const row of flows) {
    const flowId = row.flow_id;
    const wait = parseGoalWakeWaitJson(row.wait_json);
    if (!wait || !wait.missionId) {
      outcomes.push({ flowId, outcome: "flow-missing", reason: "flow has no mission wait payload" });
      continue;
    }
    if (row.status === "waiting") {
      if (wait.turnBarrier !== "acked") {
        outcomes.push({ flowId, outcome: "barrier-pending" });
        continue;
      }
      const claim = new TaskFlowCasStore().casUpsert({
        flowId,
        expectedRevision: normalizeGoalWakeNumber(row.revision) ?? 0,
        status: "running",
        controllerId: GOAL_WAKE_CONTROLLER_ID,
        ownerKey: row.owner_key,
        currentStep: "wake-dispatch",
        stateJson: row.state_json ?? undefined,
        waitJson: row.wait_json ?? undefined,
        blockedTaskId: row.blocked_task_id ?? undefined,
        blockedSummary: row.blocked_summary ?? undefined,
        deliveryState: "wake-delivering",
      });
      if (!claim.ok) {
        outcomes.push({ flowId, outcome: "dispatch-failed", reason: claim.reason });
        continue;
      }
    }

    const wakeId = `goal-wake:${flowId}:${taskId}:${String(
      task?.ended_at ?? task?.last_event_at ?? Date.now(),
    )}`;
    const dispatchInput: GoalWakeDispatchInput = {
      missionId: wait.missionId,
      sessionKey: wait.sessionKey,
      flowId,
      wakeId,
      taskId,
      taskStatus: task?.status ?? "lost",
      ...(typeof task?.error === "string" ? { error: task.error } : {}),
      ...(typeof task?.terminal_summary === "string"
        ? { terminalSummary: task.terminal_summary }
        : {}),
    };
    const dispatch = opts.dispatch ?? defaultGoalWakeDispatch;
    const dispatched = await dispatch(dispatchInput);

    if (dispatched.ok) {
      const expectedRevision =
        row.status === "waiting"
          ? (normalizeGoalWakeNumber(row.revision) ?? 0) + 1
          : (normalizeGoalWakeNumber(row.revision) ?? 0) + 1;
      const finish = new TaskFlowCasStore().casUpsert({
        flowId,
        expectedRevision,
        status: "succeeded",
        controllerId: GOAL_WAKE_CONTROLLER_ID,
        ownerKey: row.owner_key,
        currentStep: "effect-acked",
        stateJson: row.state_json ?? undefined,
        waitJson: null,
        blockedTaskId: row.blocked_task_id ?? undefined,
        blockedSummary: row.blocked_summary ?? undefined,
        deliveryState: "effect-acked",
      });
      if (!finish.ok && finish.reason !== "revision-conflict") {
        outcomes.push({ flowId, outcome: "dispatch-failed", reason: finish.reason });
        continue;
      }
      outcomes.push({
        flowId,
        outcome: dispatched.duplicate ? "duplicate-wake" : "dispatched",
      });
      clearRetryTimer(taskId);
      continue;
    }

    const budgets = resolveGoalWakeBudgets(opts.cfg);
    recordBackoff(wait.missionId, budgets.tickFailureBackoffMs);
    scheduleRetry(taskId, budgets.tickFailureBackoffMs);
    outcomes.push({
      flowId,
      outcome: "dispatch-failed",
      reason: dispatched.message ?? dispatched.reason,
    });
  }

  return {
    taskId,
    taskStatus: task?.status ?? "queued",
    terminal,
    flows: outcomes,
  };
}

async function defaultGoalWakeDispatch(
  input: GoalWakeDispatchInput,
): Promise<GoalWakeDispatchResult> {
  const mission = getMissionRun(input.missionId);
  if (!mission) {
    return { ok: false, reason: "mission-not-found" };
  }
  if (isBackoffActive(input.missionId, Date.now())) {
    return { ok: false, reason: "tick-backoff" };
  }
  const activeTickId = `mission_tick_${input.missionId}_${(mission.tick ?? 0) + 1}`;
  const claim = missionFencingController.claimMissionTick({
    missionId: input.missionId,
    expectedRevision: mission.revision ?? 0,
    activeTickId,
    wakeId: input.wakeId,
    allowedStatuses: ["idle", "sleeping", "ask_user"],
    requireIdle: true,
  });
  if (!claim.ok) {
    if (claim.reason === "duplicate-wake") {
      return { ok: true, duplicate: true };
    }
    return { ok: false, reason: claim.reason, message: claim.message };
  }
  const { tickMission } = await import("./mission-control/controller.js");
  try {
    const record = await tickMission(
      {
        missionId: input.missionId,
        reason: "event",
        wake: {
          wakeId: input.wakeId,
          preClaimed: {
            revision: claim.revision,
            activeTickId: claim.row.active_tick_id ?? activeTickId,
            tick: Number(claim.row.tick_count ?? 0),
          },
        },
        wakePayload: {
          kind: "process",
          taskId: input.taskId,
          taskStatus: input.taskStatus,
          ...(typeof input.exitCode === "number" ? { exitCode: input.exitCode } : {}),
          ...(typeof input.exitSignal === "string" ? { exitSignal: input.exitSignal } : {}),
          ...(typeof input.error === "string" ? { error: input.error } : {}),
          ...(typeof input.terminalSummary === "string"
            ? { terminalSummary: input.terminalSummary }
            : {}),
        },
      },
      undefined,
      {},
    );
    return { ok: true, duplicate: false, missionRevision: record.revision };
  } catch (error) {
    return {
      ok: false,
      reason: "tick-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Read-only probe used by the goal_wait tool and exec wait=goal binding. */
