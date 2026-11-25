// Runtime Lifecycle Governance — goal-wake level-check dispatch.
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { openOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import { TaskFlowCasStore, type CasFlowRow } from "../tasks/task-flow-cas.js";
import { resolveGoalWakeBudgets } from "./goal-wake-config.js";
import { missionFencingController } from "./goal-wake-fencing.js";
import {
  GOAL_WAKE_CONTROLLER_ID,
  getGoalWakeTaskRunRow,
  listActiveGoalWakeFlowsForMission,
} from "./goal-wake-read.js";
import {
  normalizeGoalWakeNumber,
  parseGoalWakeWaitJson,
  type GoalWakeDispatch,
  type GoalWakeDispatchInput,
  type GoalWakeDispatchResult,
  type GoalWakeLevelCheckResult,
  type MissionContinuation,
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

/**
 * Evict the in-process retry timer for a task.
 *
 * The cancel cascade calls this so a dead mission cannot keep re-entering the
 * dispatcher every backoff window. Without it, a cancelled mission produces a
 * permanent `dispatch-failed -> scheduleRetry` live-lock for the life of the
 * process, because the terminal task keeps re-selecting the same live flow.
 */
export function clearGoalWakeRetryTimersForTask(taskId: string): void {
  clearRetryTimer(taskId);
}

/** Drop the per-mission dispatch backoff so a resumed mission wakes promptly. */
export function clearGoalWakeBackoffForMission(missionId: string): void {
  goalWakeBackoffUntil.delete(missionId);
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
      outcomes.push({
        flowId,
        outcome: "flow-missing",
        reason: "flow has no mission wait payload",
      });
      continue;
    }
    // A dead or parked mission must never reach any dispatcher. This lives in
    // the level check rather than in defaultGoalWakeDispatch so the guarantee
    // also holds for the restart reconciler and any injected dispatch.
    const mission = getMissionRun(wait.missionId);
    const missionStatus = mission?.status;
    if (
      !mission ||
      missionStatus === "cancelled" ||
      missionStatus === "complete" ||
      missionStatus === "blocked" ||
      missionStatus === "error"
    ) {
      // Settle the flow so it leaves this selector for good. Leaving it live is
      // what produced the dispatch-failed -> scheduleRetry loop that re-entered
      // every backoff window for the life of the process.
      clearRetryTimer(taskId);
      const settle = new TaskFlowCasStore().casUpsert({
        flowId,
        expectedRevision: normalizeGoalWakeNumber(row.revision) ?? 0,
        status: "cancelled",
        controllerId: GOAL_WAKE_CONTROLLER_ID,
        ownerKey: row.owner_key,
        currentStep: "mission-terminal",
        stateJson: row.state_json ?? undefined,
        waitJson: null,
        blockedTaskId: row.blocked_task_id ?? undefined,
        blockedSummary: row.blocked_summary ?? undefined,
        deliveryState: "mission-terminal",
      });
      outcomes.push({
        flowId,
        outcome: "mission-cancelled",
        reason: settle.ok
          ? `mission ${wait.missionId} is ${missionStatus ?? "missing"}`
          : `settle failed: ${settle.reason}`,
      });
      continue;
    }
    if (missionStatus === "paused") {
      // Parked, not dead. Leave the wait exactly as it is — do not claim it,
      // do not retry — and let mission.resume re-run this level check.
      clearRetryTimer(taskId);
      outcomes.push({
        flowId,
        outcome: "mission-parked",
        reason: `mission ${wait.missionId} is paused`,
      });
      continue;
    }

    // Tracks the revision this loop actually holds. A flow already in `running`
    // (re-dispatch after a park or a restart) was claimed on an earlier pass,
    // so no claim happens now and the revision must not be advanced — assuming
    // it was is what pinned such flows in `running` forever.
    let heldRevision = normalizeGoalWakeNumber(row.revision) ?? 0;
    if (row.status === "waiting") {
      if (wait.turnBarrier !== "acked") {
        outcomes.push({ flowId, outcome: "barrier-pending" });
        continue;
      }
      const claim = new TaskFlowCasStore().casUpsert({
        flowId,
        expectedRevision: heldRevision,
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
      heldRevision = claim.revision;
    }

    const wakePrefix = `goal-wake:${flowId}:${taskId}:`;
    // Reuse the committed wake after a lost ACK, including a later helper exit.
    const wakeId = mission.lastWakeId?.startsWith(wakePrefix)
      ? mission.lastWakeId
      : `${wakePrefix}${String(task?.ended_at ?? task?.last_event_at ?? Date.now())}`;
    const dispatchInput: GoalWakeDispatchInput = {
      missionId: wait.missionId,
      sessionKey: wait.sessionKey,
      flowId,
      wakeId,
      taskId,
      taskStatus: task?.status ?? "lost",
      dependency: wait.dependency,
      ...(typeof task?.error === "string" ? { error: task.error } : {}),
      ...(typeof task?.terminal_summary === "string"
        ? { terminalSummary: task.terminal_summary }
        : {}),
    };
    const dispatch = opts.dispatch ?? defaultGoalWakeDispatch;
    const dispatched = await dispatch(dispatchInput);

    if (dispatched.ok) {
      const finish = new TaskFlowCasStore().casUpsert({
        flowId,
        expectedRevision: heldRevision,
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
      // The mission just accepted a wake, so any recorded tick-failure backoff
      // is stale. Leaving it behind both delays the next legitimate wake and
      // keeps a per-mission entry alive for the life of the process.
      goalWakeBackoffUntil.delete(wait.missionId);
      continue;
    }

    if (dispatched.retryable === false) {
      // Permanent refusal. Never arm a retry timer here: the task stays
      // terminal and the flow stays selectable, so a timer would re-enter this
      // same path every backoff window for the life of the process.
      clearRetryTimer(taskId);
      if (dispatched.missionTerminal) {
        // Settle the flow so the level-check selector stops finding it, and so
        // a restart reconciler reads terminal truth instead of a live wait.
        const current = new TaskFlowCasStore().getById(flowId);
        const settled = current
          ? new TaskFlowCasStore().casUpsert({
              flowId,
              expectedRevision: normalizeGoalWakeNumber(current.revision) ?? 0,
              status: "cancelled",
              controllerId: GOAL_WAKE_CONTROLLER_ID,
              ownerKey: current.owner_key,
              currentStep: "mission-terminal",
              stateJson: current.state_json ?? undefined,
              waitJson: null,
              blockedTaskId: current.blocked_task_id ?? undefined,
              blockedSummary: current.blocked_summary ?? undefined,
              deliveryState: "mission-terminal",
            })
          : undefined;
        outcomes.push({
          flowId,
          outcome: "mission-cancelled",
          reason:
            settled && !settled.ok
              ? `${dispatched.reason} (settle failed: ${settled.reason})`
              : dispatched.reason,
        });
        continue;
      }
      outcomes.push({
        flowId,
        outcome: "mission-parked",
        reason: dispatched.message ?? dispatched.reason,
      });
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

/**
 * Level-triggered reconciliation for one mission's armed waits.
 *
 * `mission.resume` uses this: a dependency that reached terminal while the
 * mission was parked produced no continuation at the time (the dispatcher
 * refused a paused mission without arming a retry), so resume must re-read
 * current state and continue from it. This re-derives from durable rows only
 * and never replays a command.
 */
export async function runGoalWakeLevelCheckForMission(
  missionId: string,
  opts: { dispatch?: GoalWakeDispatch; cfg?: OpenClawConfig } = {},
): Promise<GoalWakeLevelCheckResult[]> {
  const flows = listActiveGoalWakeFlowsForMission(missionId);
  const taskIds = [
    ...new Set(flows.map((row) => row.blocked_task_id).filter((id): id is string => !!id)),
  ];
  const results: GoalWakeLevelCheckResult[] = [];
  for (const taskId of taskIds) {
    results.push(await runGoalWakeLevelCheckForTask(taskId, opts));
  }
  return results;
}

/**
 * Build the single typed continuation handed to `tickMission`.
 *
 * All three trigger kinds converge on this one discriminated shape, so a tick
 * never has to guess which subsystem woke it from the field set present.
 */
export function buildMissionContinuation(input: GoalWakeDispatchInput): MissionContinuation {
  const kind = input.dependency?.kind ?? "process";
  const taskStatus = String(input.taskStatus ?? "lost");
  if (kind === "timer") {
    return {
      kind: "timer",
      taskId: input.taskId,
      taskStatus,
      ...(typeof input.dependency?.fireAt === "number" ? { fireAt: input.dependency.fireAt } : {}),
      firedAt: Date.now(),
      ...(input.dependency?.cronJobId ? { cronJobId: input.dependency.cronJobId } : {}),
    };
  }
  if (kind === "child") {
    return {
      kind: "child",
      taskId: input.taskId,
      taskStatus,
      ...(input.dependency?.childSessionKey
        ? { childSessionKey: input.dependency.childSessionKey }
        : {}),
      ...(typeof input.error === "string" ? { error: input.error } : {}),
      ...(typeof input.terminalSummary === "string"
        ? { terminalSummary: input.terminalSummary }
        : {}),
    };
  }
  if (kind === "approval") {
    return {
      kind: "approval",
      taskId: input.taskId,
      taskStatus,
      ...(input.dependency?.approvalId ? { approvalId: input.dependency.approvalId } : {}),
      ...(typeof input.error === "string" ? { error: input.error } : {}),
      ...(typeof input.terminalSummary === "string"
        ? { terminalSummary: input.terminalSummary }
        : {}),
    };
  }
  if (kind === "event") {
    return {
      kind: "event",
      taskId: input.taskId,
      taskStatus,
      ...(input.dependency?.eventId ? { eventId: input.dependency.eventId } : {}),
      ...(input.dependency?.eventKind ? { eventKind: input.dependency.eventKind } : {}),
      ...(typeof input.error === "string" ? { error: input.error } : {}),
      ...(typeof input.terminalSummary === "string"
        ? { terminalSummary: input.terminalSummary }
        : {}),
    };
  }
  return {
    kind: "process",
    taskId: input.taskId,
    taskStatus,
    ...(typeof input.exitCode === "number" ? { exitCode: input.exitCode } : {}),
    ...(typeof input.exitSignal === "string" ? { exitSignal: input.exitSignal } : {}),
    ...(typeof input.error === "string" ? { error: input.error } : {}),
    ...(typeof input.terminalSummary === "string"
      ? { terminalSummary: input.terminalSummary }
      : {}),
  };
}

async function defaultGoalWakeDispatch(
  input: GoalWakeDispatchInput,
): Promise<GoalWakeDispatchResult> {
  const mission = getMissionRun(input.missionId);
  if (!mission) {
    // Nothing will ever bring this mission back; retrying only live-locks.
    return { ok: false, reason: "mission-not-found", retryable: false, missionTerminal: true };
  }
  if (
    mission.status === "cancelled" ||
    mission.status === "complete" ||
    mission.status === "blocked" ||
    mission.status === "error"
  ) {
    return {
      ok: false,
      reason: "mission-terminal",
      message: `mission ${input.missionId} is ${mission.status}`,
      retryable: false,
      missionTerminal: true,
    };
  }
  if (mission.status === "paused") {
    // Parked, not dead: leave the wait armed and let resume re-run the level
    // check. Retrying on a timer would just burn a tick every backoff window.
    return {
      ok: false,
      reason: "mission-paused",
      message: `mission ${input.missionId} is paused`,
      retryable: false,
    };
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
        wakePayload: buildMissionContinuation(input),
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
