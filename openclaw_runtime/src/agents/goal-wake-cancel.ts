// Runtime Lifecycle Governance — mission-scoped goal-wake cancel cascade.
//
// `mission.cancel` used to be a single status flip on `mission_runs`. Every
// armed wait survived it: the flow row stayed `waiting`/`running`, the backing
// `task_runs` row stayed live, and the durable helper kept running. Worse, the
// dispatcher kept re-selecting those rows, failed `claimMissionTick` on the
// dead mission, and re-armed a retry timer every backoff window — a permanent
// live-lock rather than "no further tick".
//
// Ordering is deliberate and load-bearing: durable terminal truth first
// (flow + task rows), OS/helper containment second. A crash between the two
// halves leaves settled rows that the restart reconciler can read as terminal,
// which is recoverable; the reverse order would strand a live wait pointing at
// a helper that no longer exists.
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { runOpenClawStateWriteTransaction } from "../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import { ACTIVE_FLOW_STATUSES, TaskFlowCasStore, type CasFlowRow } from "../tasks/task-flow-cas.js";
import { resolveConfigDir } from "../utils.js";
import {
  clearGoalWakeBackoffForMission,
  clearGoalWakeRetryTimersForTask,
} from "./goal-wake-dispatch.js";
import { finalizeDurableCleanupRows } from "./goal-wake-durable-cleanup.js";
import {
  readDurableHelperFiles,
  requestDurableHelperCancellation,
  resolveDurableHelperRoot,
  type DurableHelperProtocolOptions,
} from "./goal-wake-helper-protocol.js";
import { GOAL_WAKE_CONTROLLER_ID, listActiveGoalWakeFlowsForMission } from "./goal-wake-read.js";
import { parseGoalWakeWaitJson } from "./goal-wake-types.js";

type GoalWakeCancelDatabase = Pick<
  OpenClawStateKyselyDatabase,
  "flow_runs" | "mission_runs" | "task_runs"
>;

export type MissionWaitCancelFlowOutcome = {
  flowId: string;
  taskId?: string;
  outcome: "cancelled" | "already-terminal" | "cas-failed";
  reason?: string;
};

export type MissionWaitCancelResult = {
  missionId: string;
  flows: MissionWaitCancelFlowOutcome[];
  finalizedTasks: string[];
  helperCancelRequested: number;
  /** Non-empty means OS containment is unproven; callers must fail closed. */
  helperCancelFailures: Array<{ runId: string; reason: string }>;
  clearedWaitFlowIds: number;
};

function jsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Drop the mission's armed-wait pointer list. Nothing else clears it today. */
export function clearMissionActiveWaitFlowIds(missionId: string): number {
  const id = missionId.trim();
  if (!id) return 0;
  let cleared = 0;
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<GoalWakeCancelDatabase>(db);
    const mission = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom("mission_runs").selectAll().where("mission_id", "=", id),
    );
    if (!mission) return;
    const metadata = jsonRecord(mission.metadata_json);
    const existing = Array.isArray(metadata.activeWaitFlowIds)
      ? (metadata.activeWaitFlowIds as unknown[])
      : [];
    if (existing.length === 0) return;
    cleared = existing.length;
    metadata.activeWaitFlowIds = [];
    // Metadata is not part of the fencing triple (revision/active_tick_id/
    // last_wake_id), so this targeted write must NOT bump revision — doing so
    // would desync the CAS counter that claim/finish tick depend on.
    executeSqliteQuerySync(
      db,
      query
        .updateTable("mission_runs")
        .set({ metadata_json: JSON.stringify(metadata) })
        .where("mission_id", "=", id),
    );
  });
  return cleared;
}

export type DurableClaimRef = { runId: string; nonce: string; ownerEpoch: string };

/**
 * The helper claim a wait is holding, if any.
 *
 * Read from `wait_json` first and `state_json` second because the finalizer
 * nulls the wait payload; callers must snapshot this *before* settling rows.
 */
export function readDurableClaim(row: CasFlowRow): DurableClaimRef | undefined {
  const wait = parseGoalWakeWaitJson(row.wait_json);
  const state = jsonRecord(row.state_json);
  const runId = wait?.runId ?? (typeof state.runId === "string" ? state.runId : undefined);
  const nonce = wait?.runNonce ?? (typeof state.runNonce === "string" ? state.runNonce : undefined);
  const ownerEpoch =
    wait?.ownerEpoch ?? (typeof state.ownerEpoch === "string" ? state.ownerEpoch : undefined);
  if (!runId || !nonce || !ownerEpoch) return undefined;
  return { runId, nonce, ownerEpoch };
}

export type HelperContainmentResult =
  | { state: "requested" }
  | { state: "already-gone"; reason: string }
  | { state: "failed"; reason: string };

/**
 * Ask a durable helper to stop, distinguishing "nothing of ours is running"
 * from a real containment failure.
 *
 * `requestDurableHelperCancellation` throws both when the intent file is gone
 * and when the nonce/ownerEpoch no longer match. Both of those mean our helper
 * is already gone — the run dir was reaped, or a different run owns it now.
 * Counting them as failures would make every ordinary cancel look unsafe and
 * fail the RPC closed for no reason, so the claim is checked first and only a
 * genuine write/protocol error is reported as a failure.
 */
export async function containDurableHelper(
  claim: DurableClaimRef,
  reason: string,
  options: DurableHelperProtocolOptions,
): Promise<HelperContainmentResult> {
  const files = await readDurableHelperFiles(claim.runId, options).catch(() => undefined);
  if (!files?.intent) {
    return { state: "already-gone", reason: "helper intent is gone; run dir already reaped" };
  }
  if (files.intent.nonce !== claim.nonce || files.intent.ownerEpoch !== claim.ownerEpoch) {
    return { state: "already-gone", reason: "helper claim is stale; another run owns this dir" };
  }
  if (files.exit) {
    return { state: "already-gone", reason: "helper already recorded its exit" };
  }
  try {
    await requestDurableHelperCancellation({ ...claim, reason }, options);
    return { state: "requested" };
  } catch (error) {
    return { state: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Cascade a mission's armed goal waits to terminal.
 *
 * Callers must have already written the mission's own terminal status, so a
 * concurrent arm is refused by the `status !== "running"` guard in the arm
 * transaction and cannot race a new wait past this sweep.
 */
export async function cancelGoalWakeWaitsForMission(params: {
  missionId: string;
  reason?: string;
  options?: DurableHelperProtocolOptions;
}): Promise<MissionWaitCancelResult> {
  const missionId = params.missionId.trim();
  const reason = params.reason?.trim() || "mission cancelled";
  const result: MissionWaitCancelResult = {
    missionId,
    flows: [],
    finalizedTasks: [],
    helperCancelRequested: 0,
    helperCancelFailures: [],
    clearedWaitFlowIds: 0,
  };
  if (!missionId) return result;

  const rows = listActiveGoalWakeFlowsForMission(missionId);
  // Snapshot helper claims before the wait payload is nulled by the finalizer.
  const claims = new Map<string, DurableClaimRef>();
  for (const row of rows) {
    const claim = readDurableClaim(row);
    if (claim) claims.set(claim.runId, claim);
  }

  // ---- Phase 1: durable terminal truth (task rows, then flow rows).
  const taskIds = [
    ...new Set(rows.map((row) => row.blocked_task_id).filter((id): id is string => !!id)),
  ];
  for (const taskId of taskIds) {
    await finalizeDurableCleanupRows({
      taskId,
      status: "cancelled",
      terminalSummary: reason,
    });
    result.finalizedTasks.push(taskId);
    // Stop the in-process retry loop for this task before anything can
    // re-enter the dispatcher against the now-dead mission.
    clearGoalWakeRetryTimersForTask(taskId);
  }
  clearGoalWakeBackoffForMission(missionId);

  // Any flow the task-keyed finalizer could not reach (no blocked_task_id, or
  // a status outside its waiting|running filter) is settled directly here.
  for (const row of rows) {
    const current = new TaskFlowCasStore().getById(row.flow_id);
    if (!current) {
      result.flows.push({ flowId: row.flow_id, outcome: "cas-failed", reason: "flow-missing" });
      continue;
    }
    const status = current.status as (typeof ACTIVE_FLOW_STATUSES)[number];
    if (!ACTIVE_FLOW_STATUSES.includes(status)) {
      result.flows.push({
        flowId: row.flow_id,
        ...(row.blocked_task_id ? { taskId: row.blocked_task_id } : {}),
        outcome: "cancelled",
      });
      continue;
    }
    const cas = new TaskFlowCasStore().casUpsert({
      flowId: current.flow_id,
      expectedRevision: Number(current.revision ?? 0),
      status: "cancelled",
      controllerId: GOAL_WAKE_CONTROLLER_ID,
      ownerKey: current.owner_key,
      currentStep: "mission-cancel",
      stateJson: current.state_json ?? undefined,
      waitJson: null,
      blockedTaskId: current.blocked_task_id ?? undefined,
      blockedSummary: current.blocked_summary ?? undefined,
      deliveryState: "mission-cancel",
    });
    result.flows.push({
      flowId: current.flow_id,
      ...(current.blocked_task_id ? { taskId: current.blocked_task_id } : {}),
      outcome: cas.ok ? "cancelled" : "cas-failed",
      ...(cas.ok ? {} : { reason: cas.reason }),
    });
  }

  // ---- Phase 2: OS/helper containment, only after the rows are settled.
  if (claims.size > 0) {
    const options: DurableHelperProtocolOptions = params.options ?? {
      rootDir: resolveDurableHelperRoot(resolveConfigDir()),
    };
    for (const claim of claims.values()) {
      const contained = await containDurableHelper(claim, reason, options);
      if (contained.state === "requested") {
        result.helperCancelRequested += 1;
      } else if (contained.state === "failed") {
        result.helperCancelFailures.push({ runId: claim.runId, reason: contained.reason });
      }
      // `already-gone` needs no action and is not a failure.
    }
  }

  result.clearedWaitFlowIds = clearMissionActiveWaitFlowIds(missionId);
  return result;
}
