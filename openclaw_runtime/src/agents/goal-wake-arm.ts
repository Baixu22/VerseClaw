// Runtime Lifecycle Governance — goal-wake arm transaction.
import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import {
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import { TaskFlowCasStore } from "../tasks/task-flow-cas.js";
import { resolveGoalWakeBudgets } from "./goal-wake-config.js";
import {
  GOAL_WAKE_CONTROLLER_ID,
  getGoalWakeFlowRow,
  getGoalWakeTaskRunRow,
} from "./goal-wake-read.js";
import {
  normalizeGoalWakeNumber,
  parseGoalWakeWaitJson,
  type GoalWakeArmFailure,
  type GoalWakeArmInput,
  type GoalWakeArmResult,
  type GoalWakeBudgets,
  type GoalWakeWaitJson,
} from "./goal-wake-types.js";
import { runGoalWakeLevelCheckForTask } from "./goal-wake-dispatch.js";

type GoalWakeArmDatabase = Pick<
  OpenClawStateKyselyDatabase,
  "flow_runs" | "mission_runs" | "task_runs"
>;

function jsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

type GoalWakeArmFailureReason = GoalWakeArmFailure["reason"];

function armFailure(
  reason: GoalWakeArmFailureReason,
  message?: string,
): GoalWakeArmFailure {
  const error = new Error(message ?? reason) as GoalWakeArmFailure;
  error.reason = reason;
  return error;
}

function goalWaitArmTransaction(
  input: GoalWakeArmInput,
  budgets: GoalWakeBudgets,
  options: OpenClawStateDatabaseOptions = {},
): { taskId: string; flowId: string; missionRevision: number; flowRevision: number } {
  const taskId = input.taskId?.trim() || `task_${randomUUID()}`;
  const flowId = input.flowId?.trim() || `flow_${randomUUID()}`;
  let committed:
    | { taskId: string; flowId: string; missionRevision: number; flowRevision: number }
    | undefined;

  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<GoalWakeArmDatabase>(db);
    const mission = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom("mission_runs").selectAll().where("mission_id", "=", input.missionId),
    );
    if (!mission) {
      throw armFailure("mission-not-found", `mission not found: ${input.missionId}`);
    }
    if (mission.session_key !== input.sessionKey) {
      throw armFailure(
        "session-mismatch",
        `mission ${input.missionId} is owned by ${mission.session_key}, not ${input.sessionKey}`,
      );
    }
    if (input.agentId && mission.agent_id && mission.agent_id !== input.agentId) {
      throw armFailure(
        "session-mismatch",
        `mission ${input.missionId} is owned by agent ${mission.agent_id}, not ${input.agentId}`,
      );
    }
    const currentRevision = normalizeGoalWakeNumber(mission.revision) ?? 0;
    if (currentRevision !== input.expectedRevision) {
      throw armFailure(
        "revision-conflict",
        `expected revision ${input.expectedRevision}, got ${currentRevision}`,
      );
    }
    if (mission.status !== "running") {
      throw armFailure(
        "status-conflict",
        `mission ${input.missionId} is ${mission.status}, not running`,
      );
    }
    if (typeof input.activeTickId === "string" && input.activeTickId.trim()) {
      if (mission.active_tick_id !== input.activeTickId) {
        throw armFailure(
          "status-conflict",
          `mission active tick ${mission.active_tick_id ?? "none"} does not match ${input.activeTickId}`,
        );
      }
    }

    const existingFlow = executeSqliteQueryTakeFirstSync(
      db,
      query
        .selectFrom("flow_runs")
        .selectAll()
        .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
        .where("blocked_task_id", "=", taskId)
        .where("status", "in", ["waiting", "running"])
        .orderBy("created_at", "desc")
        .limit(1),
    );
    if (existingFlow) {
      const wait = parseGoalWakeWaitJson(existingFlow.wait_json);
      if (wait?.missionId === input.missionId && wait.sessionKey === input.sessionKey) {
        committed = {
          taskId,
          flowId: existingFlow.flow_id,
          missionRevision: currentRevision,
          flowRevision: normalizeGoalWakeNumber(existingFlow.revision) ?? 0,
        };
        return;
      }
      throw armFailure(
        "duplicate-wait",
        `task ${taskId} already has a goal-wake wait owned by another mission/session`,
      );
    }

    if (budgets.maxActiveGoalWaits > 0) {
      const activeCountResult = executeSqliteQuerySync(
        db,
        query
          .selectFrom("flow_runs")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
          .where("status", "in", ["waiting", "running"]),
      );
      const activeCount = Number(activeCountResult.rows[0]?.count ?? 0);
      if (activeCount >= budgets.maxActiveGoalWaits) {
        throw armFailure(
          "budget-exceeded",
          `max active goal waits reached (${budgets.maxActiveGoalWaits})`,
        );
      }
    }
    if (budgets.maxFlows > 0) {
      const flowCountResult = executeSqliteQuerySync(
        db,
        query
          .selectFrom("flow_runs")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID),
      );
      const flowCount = Number(flowCountResult.rows[0]?.count ?? 0);
      if (flowCount >= budgets.maxFlows) {
        throw armFailure(
          "budget-exceeded",
          `max goal-wake flows reached (${budgets.maxFlows})`,
        );
      }
    }

    const now = Date.now();
    const commandDigest = input.commandDigest?.trim() || "unset";
    const label = input.label?.trim() || `goal-owned process ${commandDigest.slice(0, 16)}`;
    const flowWaitJson: GoalWakeWaitJson = {
      v: 1,
      turnBarrier: "pending",
      continuation: "mission_tick",
      missionId: input.missionId,
      sessionKey: input.sessionKey,
      ...(input.activeTickId?.trim() ? { tickId: input.activeTickId.trim() } : {}),
      dependency: { kind: "process", taskId },
      ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
      commandDigest,
      ...(input.durableRun
        ? {
            runId: input.durableRun.runId,
            ownerEpoch: input.durableRun.ownerEpoch,
            runNonce: input.durableRun.nonce,
          }
        : {}),
    };

    executeSqliteQuerySync(
      db,
      query.insertInto("task_runs").values({
        task_id: taskId,
        runtime: "process",
        task_kind: "goal-owned-process",
        source_id: `goal-wake:${input.missionId}`,
        requester_session_key: input.sessionKey,
        owner_key: input.sessionKey,
        scope_kind: "session",
        child_session_key: null,
        parent_flow_id: null,
        parent_task_id: null,
        agent_id: input.agentId ?? mission.agent_id ?? null,
        run_id: input.durableRun?.runId ?? null,
        label,
        task: `goal-owned process (sha256:${commandDigest.slice(0, 24)})`,
        status: "queued",
        delivery_status: "not_applicable",
        notify_policy: "silent",
        created_at: now,
        started_at: null,
        ended_at: null,
        last_event_at: now,
        cleanup_after: null,
        error: null,
        progress_summary: input.durableRun
          ? JSON.stringify({
              v: 1,
              ownerEpoch: input.durableRun.ownerEpoch,
              runId: input.durableRun.runId,
              runNonce: input.durableRun.nonce,
            })
          : null,
        terminal_summary: null,
        terminal_outcome: null,
      }),
    );

    const flowResult = new TaskFlowCasStore(options).casUpsert({
      flowId,
      expectedRevision: -1,
      status: "waiting",
      controllerId: GOAL_WAKE_CONTROLLER_ID,
      ownerKey: input.sessionKey,
      blockedTaskId: taskId,
      blockedSummary: label,
      currentStep: "goal-wait",
      stateJson: JSON.stringify({
        v: 1,
        commandDigest,
        ...(input.durableRun
          ? {
              ownerEpoch: input.durableRun.ownerEpoch,
              runId: input.durableRun.runId,
              runNonce: input.durableRun.nonce,
            }
          : {}),
      }),
      waitJson: JSON.stringify(flowWaitJson),
      deliveryState: "armed",
    });
    if (!flowResult.ok) {
      throw armFailure(
        flowResult.reason === "illegal-transition" ? "illegal-transition" : "arm-failed",
        `goal-wake flow CAS create failed: ${flowResult.reason}${flowResult.message ? ` (${flowResult.message})` : ""}`,
      );
    }

    executeSqliteQuerySync(
      db,
      query
        .updateTable("task_runs")
        .set({ parent_flow_id: flowId })
        .where("task_id", "=", taskId),
    );

    const metadata = jsonRecord(mission.metadata_json);
    const currentWaitFlowIds = Array.isArray(metadata.activeWaitFlowIds)
      ? metadata.activeWaitFlowIds.filter((value): value is string => typeof value === "string")
      : [];
    if (!currentWaitFlowIds.includes(flowId)) {
      currentWaitFlowIds.push(flowId);
    }
    metadata.activeWaitFlowIds = currentWaitFlowIds;
    const nextRevision = currentRevision + 1;
    const updateResult = executeSqliteQuerySync(
      db,
      query
        .updateTable("mission_runs")
        .set({
          status: "sleeping",
          metadata_json: JSON.stringify(metadata),
          revision: nextRevision,
          updated_at: now,
        })
        .where("mission_id", "=", input.missionId)
        .where("revision", "=", input.expectedRevision),
    );
    if (Number(updateResult.numAffectedRows ?? 0n) === 0) {
      throw armFailure(
        "revision-conflict",
        `no mission row updated (revision guard) for ${input.missionId}`,
      );
    }

    committed = {
      taskId,
      flowId,
      missionRevision: nextRevision,
      flowRevision: flowResult.revision,
    };
  }, options);

  if (!committed) {
    throw armFailure("arm-failed", "arm transaction produced no committed outcome");
  }
  return committed;
}

/**
 * Arm a single-process goal wait in one per-agent SQLite immediate transaction.
 * Callers must spawn only after this function returns ok. A committed arm also
 * runs one immediate terminal level-check.
 */
export async function armGoalWaitProcess(
  input: GoalWakeArmInput,
  cfg?: OpenClawConfig,
  options: OpenClawStateDatabaseOptions = {},
): Promise<GoalWakeArmResult> {
  const budgets = resolveGoalWakeBudgets(cfg);
  if (!budgets.enabled) {
    return {
      ok: false,
      reason: "flag-disabled",
      message:
        "goal wake is default-off; enable RUNTIME_LIFECYCLE_GOAL_WAKE_ENABLED and RUNTIME_LIFECYCLE_MISSION_FENCING_ENABLED (or runtime.mission.goalWake.enabled)",
    };
  }
  try {
    const committed = goalWaitArmTransaction(input, budgets, options);
    const task = getGoalWakeTaskRunRow(committed.taskId);
    const flow = getGoalWakeFlowRow(committed.flowId);
    const terminal =
      task?.status === "succeeded" ||
      task?.status === "failed" ||
      task?.status === "timed_out" ||
      task?.status === "cancelled" ||
      task?.status === "lost";
    if (terminal) {
      await runGoalWakeLevelCheckForTask(committed.taskId);
    }
    return {
      ok: true,
      taskId: committed.taskId,
      flowId: committed.flowId,
      missionRevision: committed.missionRevision,
      flowRevision: committed.flowRevision,
      turnBarrier: parseGoalWakeWaitJson(flow?.wait_json)?.turnBarrier ?? "pending",
      taskStatus: task?.status ?? "queued",
      flowStatus: flow?.status ?? "waiting",
      terminalLevelCheck: terminal ? "terminal" : "queued",
    };
  } catch (error) {
    if (error && typeof error === "object" && "reason" in error) {
      const reason = (error as GoalWakeArmFailure).reason;
      if (reason) {
        return {
          ok: false,
          reason,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      ok: false,
      reason: "arm-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Persist the turn barrier ack. The caller must only invoke this after the
 * yielding run is fully idle. Ack is idempotent.
 */
