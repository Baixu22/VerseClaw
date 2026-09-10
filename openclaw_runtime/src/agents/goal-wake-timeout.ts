// Runtime Lifecycle Governance — goal-wait deadline enforcement.
//
// `wait_json.timeoutMs` was written at arm time but never read: a wait whose
// dependency never terminated parked its mission forever, which defeats the
// whole point of a *bounded* wait. This is the reader.
//
// A timeout is not a cancel. The mission asked to stop waiting after a bound,
// so the right outcome is to continue the mission with a `timed_out`
// dependency status, not to silently kill the wait. That reuses the ordinary
// level check, so a timeout produces exactly one continuation through exactly
// the same path as a normal exit.
//
// Ordering matches the cancel cascade and the same requirement: durable
// terminal truth first, OS/helper containment second, wake last. Waking before
// containment could hand the mission a "finished" dependency whose process is
// still running.
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveConfigDir } from "../utils.js";
import { containDurableHelper, readDurableClaim } from "./goal-wake-cancel.js";
import {
  runGoalWakeLevelCheckForTask,
  clearGoalWakeRetryTimersForTask,
} from "./goal-wake-dispatch.js";
import {
  resolveDurableHelperRoot,
  type DurableHelperProtocolOptions,
} from "./goal-wake-helper-protocol.js";
import { getGoalWakeTaskRunRow, listActiveGoalWakeFlows } from "./goal-wake-read.js";
import { finalizeGoalWaitTaskProcess } from "./goal-wake-runtime.js";
import { parseGoalWakeWaitJson, type GoalWakeWaitJson } from "./goal-wake-types.js";

export type OverdueGoalWait = {
  flowId: string;
  taskId: string;
  missionId: string;
  deadlineMs: number;
  overdueMs: number;
  wait: GoalWakeWaitJson;
};

export type GoalWaitTimeoutOutcome = {
  flowId: string;
  taskId: string;
  missionId: string;
  overdueMs: number;
  /** Task status after the expiry write; already-terminal rows are untouched. */
  taskStatus: string;
  continuation: "dispatched" | "barrier-pending" | "none";
  helperCancelRequested: boolean;
  /** Set when the wait was already terminal and only its wake was reconciled. */
  reconciledOnly?: boolean;
  /** Set when OS containment could not be proven; callers must fail closed. */
  helperCancelError?: string;
};

function isTerminalTaskStatus(status: string | undefined): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "cancelled" ||
    status === "lost"
  );
}

/**
 * Waits whose bound has elapsed.
 *
 * The deadline is measured from `flow_runs.created_at`, i.e. the moment the
 * wait was armed, because that is when the mission started waiting.
 */
export function listOverdueGoalWaits(now: number = Date.now()): OverdueGoalWait[] {
  const overdue: OverdueGoalWait[] = [];
  for (const row of listActiveGoalWakeFlows()) {
    const wait = parseGoalWakeWaitJson(row.wait_json);
    if (!wait?.missionId || !wait.dependency.taskId) continue;
    const timeoutMs = wait.timeoutMs;
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      continue;
    }
    const armedAt = Number(row.created_at ?? 0);
    if (!Number.isFinite(armedAt) || armedAt <= 0) continue;
    const deadlineMs = armedAt + timeoutMs;
    if (now <= deadlineMs) continue;
    overdue.push({
      flowId: row.flow_id,
      taskId: wait.dependency.taskId,
      missionId: wait.missionId,
      deadlineMs,
      overdueMs: now - deadlineMs,
      wait,
    });
  }
  return overdue;
}

/**
 * Expire every overdue wait.
 *
 * Level-triggered and idempotent: a wait whose task already reached terminal is
 * left alone, and re-running this after a restart re-derives everything from
 * durable rows without replaying any command.
 */
export async function expireOverdueGoalWaits(
  params: {
    now?: number;
    cfg?: OpenClawConfig;
    options?: DurableHelperProtocolOptions;
    dispatch?: NonNullable<Parameters<typeof runGoalWakeLevelCheckForTask>[1]>["dispatch"];
  } = {},
): Promise<GoalWaitTimeoutOutcome[]> {
  const now = params.now ?? Date.now();
  const outcomes: GoalWaitTimeoutOutcome[] = [];

  for (const row of listActiveGoalWakeFlows()) {
    const wait = parseGoalWakeWaitJson(row.wait_json);
    if (!wait?.missionId || !wait.dependency.taskId) continue;
    const timeoutMs = wait.timeoutMs;
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      continue;
    }
    const armedAt = Number(row.created_at ?? 0);
    if (!Number.isFinite(armedAt) || armedAt <= 0) continue;
    const deadlineMs = armedAt + timeoutMs;
    if (now <= deadlineMs) continue;

    const taskId = wait.dependency.taskId;
    const existing = getGoalWakeTaskRunRow(taskId);
    if (isTerminalTaskStatus(existing?.status)) {
      // The dependency beat the deadline, but its flow is still live — which
      // means a previous wake failed after the terminal write and nothing else
      // will retry it (this sweep is the only thing that revisits the row).
      // Reconcile it instead of skipping, or the mission parks forever behind a
      // dependency that already finished.
      const orphan = await runGoalWakeLevelCheckForTask(taskId, {
        ...(params.dispatch ? { dispatch: params.dispatch } : {}),
        ...(params.cfg ? { cfg: params.cfg } : {}),
      });
      const orphanFlow = orphan.flows.find((flow) => flow.flowId === row.flow_id);
      if (orphanFlow) {
        outcomes.push({
          flowId: row.flow_id,
          taskId,
          missionId: wait.missionId,
          overdueMs: now - deadlineMs,
          taskStatus: existing?.status ?? "unknown",
          continuation:
            orphanFlow.outcome === "dispatched" || orphanFlow.outcome === "duplicate-wake"
              ? "dispatched"
              : orphanFlow.outcome === "barrier-pending"
                ? "barrier-pending"
                : "none",
          helperCancelRequested: false,
          reconciledOnly: true,
        });
      }
      continue;
    }
    // Snapshot the helper claim before the finalizer nulls the wait payload.
    const claim = readDurableClaim(row);

    // ---- 1. Durable terminal truth. Settle the row WITHOUT waking, so the
    // mission is never told the wait is over while its process is still live.
    const overdueMs = now - deadlineMs;
    const finalized = await finalizeGoalWaitTaskProcess(
      {
        taskId,
        status: "timed_out",
        endedAt: now,
        lastEventAt: now,
        error: `goal wait exceeded its ${timeoutMs}ms bound by ${Math.round(overdueMs)}ms`,
        terminalSummary: "goal wait timed out",
      },
      { skipWake: true },
    );
    clearGoalWakeRetryTimersForTask(taskId);

    // ---- 2. OS/helper containment, only once the row is settled.
    let helperCancelRequested = false;
    let helperCancelError: string | undefined;
    if (claim) {
      const options: DurableHelperProtocolOptions = params.options ?? {
        rootDir: resolveDurableHelperRoot(resolveConfigDir()),
      };
      const contained = await containDurableHelper(claim, "goal wait timed out", options);
      if (contained.state === "requested") {
        helperCancelRequested = true;
      } else if (contained.state === "failed") {
        helperCancelError = contained.reason;
      }
      // `already-gone` needs no action and is not a failure.
    }

    // ---- 3. Wake. One continuation, through the ordinary level check.
    const levelCheck = await runGoalWakeLevelCheckForTask(taskId, {
      ...(params.dispatch ? { dispatch: params.dispatch } : {}),
      ...(params.cfg ? { cfg: params.cfg } : {}),
    });
    const flowOutcome = levelCheck.flows.find((flow) => flow.flowId === row.flow_id)
      ?? levelCheck.flows[0];
    outcomes.push({
      flowId: row.flow_id,
      taskId,
      missionId: wait.missionId,
      overdueMs,
      taskStatus: finalized.task?.status ?? "timed_out",
      continuation:
        flowOutcome?.outcome === "dispatched" || flowOutcome?.outcome === "duplicate-wake"
          ? "dispatched"
          : flowOutcome?.outcome === "barrier-pending"
            ? "barrier-pending"
            : "none",
      helperCancelRequested,
      ...(helperCancelError ? { helperCancelError } : {}),
    });
  }
  return outcomes;
}
