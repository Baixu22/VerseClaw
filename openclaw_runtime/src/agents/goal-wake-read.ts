// Runtime Lifecycle Governance — read-only goal-wake ledger probes.
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { openOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import { ACTIVE_FLOW_STATUSES, TaskFlowCasStore, type CasFlowRow } from "../tasks/task-flow-cas.js";
import type { MissionRunRecord, MissionStatus } from "./mission-control/types.js";
import {
  normalizeGoalWakeNumber,
  parseGoalWakeWaitJson,
  type GoalWakeTaskRunRow,
} from "./goal-wake-types.js";

export const GOAL_WAKE_CONTROLLER_ID = "goal-wake";

type GoalWakeReadDatabase = Pick<
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

export function getGoalWakeFlowRow(flowId: string): CasFlowRow | undefined {
  return new TaskFlowCasStore().getById(flowId);
}

export function getGoalWakeTaskRunRow(taskId: string): GoalWakeTaskRunRow | undefined {
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<GoalWakeReadDatabase>(db);
  return executeSqliteQueryTakeFirstSync(
    db,
    query.selectFrom("task_runs").selectAll().where("task_id", "=", taskId),
  );
}

export function getGoalWaitTask(taskId: string): GoalWakeTaskRunRow | undefined {
  return getGoalWakeTaskRunRow(taskId);
}

/** Active (non-terminal) goal-owned rows for one session. Drain uses this to
 *  refuse cleanup while a durable process/flow still has a live owner. */
export function countActiveGoalWakeRowsForSession(sessionKey: string): {
  tasks: number;
  flows: number;
} {
  if (!sessionKey.trim()) return { tasks: 0, flows: 0 };
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<GoalWakeReadDatabase>(db);
  const taskCount = executeSqliteQuerySync(
    db,
    query
      .selectFrom("task_runs")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("runtime", "=", "process")
      .where("owner_key", "=", sessionKey.trim())
      .where("status", "in", ["queued", "running"]),
  ).rows[0]?.count;
  const flowCount = executeSqliteQuerySync(
    db,
    query
      .selectFrom("flow_runs")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
      .where("owner_key", "=", sessionKey.trim())
      .where("status", "in", ["waiting", "running"]),
  ).rows[0]?.count;
  return { tasks: Number(taskCount ?? 0), flows: Number(flowCount ?? 0) };
}

/**
 * Armed (non-terminal) goal-wake flow for one session, newest first.
 *
 * TF-0082 owner path 6: the `sessions.yieldState` RPC reports this state; the
 * arm path itself stays tool-only because mission/tick identity is bound from
 * the live run context.
 */
export type ArmedGoalWaitRow = {
  flowId: string;
  status: string;
  updatedAt: number;
  taskId?: string;
  missionId?: string;
  turnBarrier?: string;
  runId?: string;
  ownerEpoch?: string;
  timeoutMs?: number;
};

export function readArmedGoalWaitForSession(sessionKey: string): ArmedGoalWaitRow | undefined {
  const key = sessionKey.trim();
  if (!key) return undefined;
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<GoalWakeReadDatabase>(db);
  const row = executeSqliteQueryTakeFirstSync(
    db,
    query
      .selectFrom("flow_runs")
      .selectAll()
      .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
      .where("owner_key", "=", key)
      .where("status", "in", ["waiting", "running"])
      .orderBy("updated_at", "desc")
      .orderBy("flow_id", "desc")
      .limit(1),
  );
  if (!row) return undefined;
  const wait = parseGoalWakeWaitJson(row.wait_json);
  return {
    flowId: row.flow_id,
    status: row.status,
    updatedAt: Number(row.updated_at ?? 0),
    ...(wait?.dependency?.taskId ? { taskId: wait.dependency.taskId } : {}),
    ...(wait?.missionId ? { missionId: wait.missionId } : {}),
    ...(wait?.turnBarrier ? { turnBarrier: wait.turnBarrier } : {}),
    ...(wait?.runId ? { runId: wait.runId } : {}),
    ...(wait?.ownerEpoch ? { ownerEpoch: wait.ownerEpoch } : {}),
    ...(typeof wait?.timeoutMs === "number" && Number.isFinite(wait.timeoutMs)
      ? { timeoutMs: wait.timeoutMs }
      : {}),
  };
}

/** Every non-terminal goal-wake flow, newest last. Used by deadline sweeps. */
export function listActiveGoalWakeFlows(): CasFlowRow[] {
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<GoalWakeReadDatabase>(db);
  return executeSqliteQuerySync<CasFlowRow>(
    db,
    query
      .selectFrom("flow_runs")
      .selectAll()
      .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
      .where("status", "in", ACTIVE_FLOW_STATUSES)
      .orderBy("created_at", "asc"),
  ).rows;
}

/**
 * Every non-terminal goal-wake flow owned by one mission.
 *
 * `wait_json.missionId` is authoritative because it is written in the same
 * transaction as the flow row. `metadata_json.activeWaitFlowIds` is used only
 * as a self-healing union, so a row whose wait payload was cleared out-of-band
 * is still reachable by the cancel cascade and the resume reconciler.
 */
export function listActiveGoalWakeFlowsForMission(missionId: string): CasFlowRow[] {
  const id = missionId.trim();
  if (!id) return [];
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<GoalWakeReadDatabase>(db);
  const active = executeSqliteQuerySync<CasFlowRow>(
    db,
    query
      .selectFrom("flow_runs")
      .selectAll()
      .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
      .where("status", "in", ACTIVE_FLOW_STATUSES)
      .orderBy("created_at", "asc"),
  ).rows;

  const mission = executeSqliteQueryTakeFirstSync(
    db,
    query.selectFrom("mission_runs").selectAll().where("mission_id", "=", id),
  );
  const metadata = jsonRecord(mission?.metadata_json);
  const declared = new Set(
    (Array.isArray(metadata.activeWaitFlowIds) ? (metadata.activeWaitFlowIds as unknown[]) : [])
      .filter((value): value is string => typeof value === "string"),
  );

  return active.filter((row) => {
    const wait = parseGoalWakeWaitJson(row.wait_json);
    if (wait?.missionId) return wait.missionId === id;
    return declared.has(row.flow_id);
  });
}

/**
 * Resolve an armed `child` wait from the spawned session it is bound to.
 *
 * The subagent completion path knows only its child session key; this is the
 * join into the goal-wake ledger, so the caller never has to reach into wait
 * payloads itself.
 */
export function findGoalWaitChildTaskBySessionKey(
  childSessionKey: string,
): { taskId: string; flowId: string; missionId: string } | undefined {
  const key = childSessionKey.trim();
  if (!key) return undefined;
  for (const row of listActiveGoalWakeFlows()) {
    const wait = parseGoalWakeWaitJson(row.wait_json);
    if (wait?.dependency.kind !== "child") continue;
    if (wait.dependency.childSessionKey !== key) continue;
    return {
      taskId: wait.dependency.taskId,
      flowId: row.flow_id,
      missionId: wait.missionId,
    };
  }
  return undefined;
}

/**
 * Resolve an armed `timer` wait from the Cron job that owns its deadline.
 *
 * The Cron service knows only its own job id, so this is the join it needs to
 * reach the goal-wake ledger without cron importing mission internals.
 */
export function findGoalWaitTimerTaskByCronJobId(
  cronJobId: string,
): { taskId: string; flowId: string; missionId: string; fireAt?: number } | undefined {
  const jobId = cronJobId.trim();
  if (!jobId) return undefined;
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<GoalWakeReadDatabase>(db);
  const rows = executeSqliteQuerySync<CasFlowRow>(
    db,
    query
      .selectFrom("flow_runs")
      .selectAll()
      .where("controller_id", "=", GOAL_WAKE_CONTROLLER_ID)
      .where("status", "in", ACTIVE_FLOW_STATUSES)
      .orderBy("created_at", "asc"),
  ).rows;
  for (const row of rows) {
    const wait = parseGoalWakeWaitJson(row.wait_json);
    if (wait?.dependency.kind !== "timer") continue;
    if (wait.dependency.cronJobId !== jobId) continue;
    return {
      taskId: wait.dependency.taskId,
      flowId: row.flow_id,
      missionId: wait.missionId,
      ...(typeof wait.dependency.fireAt === "number" ? { fireAt: wait.dependency.fireAt } : {}),
    };
  }
  return undefined;
}

/** Read-only mission context used by tool construction to bind identity. */
export function getLatestMissionForSession(sessionKey: string): MissionRunRecord | undefined {
  if (!sessionKey.trim()) return undefined;
  const { db } = openOpenClawStateDatabase();
  const query = getNodeSqliteKysely<GoalWakeReadDatabase>(db);
  const row = executeSqliteQueryTakeFirstSync(
    db,
    query
      .selectFrom("mission_runs")
      .selectAll()
      .where("session_key", "=", sessionKey.trim())
      .orderBy("updated_at", "desc")
      .orderBy("mission_id", "desc")
      .limit(1),
  );
  if (!row) return undefined;
  const metadata = jsonRecord(row.metadata_json);
  const control =
    typeof metadata.longConversationControl === "object" && metadata.longConversationControl
      ? (metadata.longConversationControl as Record<string, unknown>)
      : {};
  return {
    missionId: row.mission_id,
    sessionKey: row.session_key,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    objective: row.objective,
    acceptance: [],
    status: row.status as MissionStatus,
    phase: row.phase as MissionRunRecord["phase"],
    tick: Number(row.tick_count ?? 0),
    repairTicks: Number(row.repair_tick_count ?? 0),
    maxTicks: Number(row.max_ticks ?? 0),
    maxRepairTicks: Number(row.max_repair_ticks ?? 0),
    progress: Number(row.progress ?? 0),
    revision: normalizeGoalWakeNumber(row.revision) ?? 0,
    activeTickId: row.active_tick_id,
    lastWakeId: row.last_wake_id,
    ...(row.last_decision ? { lastDecision: row.last_decision as MissionRunRecord["lastDecision"] } : {}),
    ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}),
    ...(row.trace_id ? { traceId: row.trace_id } : {}),
    evidenceRefs: [],
    risks: [],
    remaining: [],
    metadata: { ...metadata, longConversationControl: control },
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    ...(typeof row.completed_at === "number" ? { completedAt: row.completed_at } : {}),
    ticks: [],
  };
}
