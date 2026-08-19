// Runtime Lifecycle Governance — read-only goal-wake ledger probes.
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { openOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import { TaskFlowCasStore, type CasFlowRow } from "../tasks/task-flow-cas.js";
import type { MissionRunRecord, MissionStatus } from "./mission-control/types.js";
import {
  normalizeGoalWakeNumber,
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
