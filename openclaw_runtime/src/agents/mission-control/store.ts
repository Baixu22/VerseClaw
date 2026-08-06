import { randomUUID } from "node:crypto";
import type { Insertable, Selectable, Updateable } from "kysely";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import type { DB as OpenClawStateKyselyDatabase } from "../../state/openclaw-state-db.generated.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
} from "../../state/openclaw-state-db.js";
import {
  normalizeAcceptanceStatus,
  normalizeControlSignals,
  normalizeValidationState,
} from "../long-conversation-control-signals.js";
import type {
  MissionDecision,
  MissionEvidenceRef,
  MissionPhase,
  MissionRunRecord,
  MissionStatus,
} from "./types.js";

type MissionDatabase = Pick<OpenClawStateKyselyDatabase, "mission_runs" | "mission_events">;
type MissionRunRow = Selectable<OpenClawStateKyselyDatabase["mission_runs"]>;
type MissionRunInsert = Insertable<OpenClawStateKyselyDatabase["mission_runs"]>;
type MissionRunUpdate = Updateable<OpenClawStateKyselyDatabase["mission_runs"]>;
type MissionEventInsert = Insertable<OpenClawStateKyselyDatabase["mission_events"]>;

export type MissionStoreEventInput = {
  id?: string;
  missionId: string;
  sessionKey: string;
  type: string;
  phase: MissionPhase;
  status: MissionStatus;
  tick: number;
  decision?: MissionDecision;
  payload?: Record<string, unknown>;
  createdAt?: number;
};

function stateDb() {
  const { db } = openOpenClawStateDatabase();
  return { db, query: getNodeSqliteKysely<MissionDatabase>(db) };
}

function jsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

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

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonEmpty(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function rowToMission(row: MissionRunRow): MissionRunRecord {
  const metadata = jsonRecord(row.metadata_json);
  const control = recordFromUnknown(metadata.longConversationControl);
  return {
    missionId: row.mission_id,
    sessionKey: row.session_key,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.workspace_id !== null ? { workspaceId: row.workspace_id } : {}),
    objective: row.objective,
    acceptance: jsonArray<string>(row.acceptance_json),
    status: row.status as MissionStatus,
    phase: row.phase as MissionPhase,
    tick: row.tick_count,
    repairTicks: row.repair_tick_count,
    maxTicks: row.max_ticks,
    maxRepairTicks: row.max_repair_ticks,
    progress: row.progress,
    ...(row.last_decision ? { lastDecision: row.last_decision as MissionDecision } : {}),
    ...(row.last_reason ? { lastReason: row.last_reason } : {}),
    ...(row.last_reviewer_summary ? { lastReviewerSummary: row.last_reviewer_summary } : {}),
    ...(typeof row.next_wake_at === "number" ? { nextWakeAt: row.next_wake_at } : {}),
    ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}),
    ...(row.trace_id ? { traceId: row.trace_id } : {}),
    ...(row.task_loop_run_id ? { taskLoopRunId: row.task_loop_run_id } : {}),
    evidenceRefs: jsonArray<MissionEvidenceRef>(row.evidence_refs_json),
    risks: jsonArray<string>(row.risks_json),
    remaining: jsonArray<string>(row.remaining_json),
    ...(normalizeControlSignals(control.controlSignals).length
      ? { controlSignals: normalizeControlSignals(control.controlSignals) }
      : {}),
    ...(normalizeValidationState(control.validationState)
      ? { validationState: normalizeValidationState(control.validationState) }
      : {}),
    ...(normalizeAcceptanceStatus(control.acceptanceStatus)
      ? { acceptanceStatus: normalizeAcceptanceStatus(control.acceptanceStatus) }
      : {}),
    ...(row.no_progress_hash ? { noProgressHash: row.no_progress_hash } : {}),
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(typeof row.completed_at === "number" ? { completedAt: row.completed_at } : {}),
    ticks: [],
  };
}

function updateFromValues(values: MissionRunInsert): MissionRunUpdate {
  return {
    session_key: values.session_key,
    agent_id: values.agent_id ?? null,
    workspace_id: values.workspace_id ?? null,
    objective: values.objective,
    acceptance_json: values.acceptance_json,
    status: values.status,
    phase: values.phase,
    tick_count: values.tick_count ?? 0,
    repair_tick_count: values.repair_tick_count ?? 0,
    max_ticks: values.max_ticks,
    max_repair_ticks: values.max_repair_ticks,
    progress: values.progress ?? 0,
    last_decision: values.last_decision ?? null,
    last_reason: values.last_reason ?? null,
    last_reviewer_summary: values.last_reviewer_summary ?? null,
    next_wake_at: values.next_wake_at ?? null,
    blocked_reason: values.blocked_reason ?? null,
    trace_id: values.trace_id ?? null,
    task_loop_run_id: values.task_loop_run_id ?? null,
    evidence_refs_json: values.evidence_refs_json ?? "[]",
    risks_json: values.risks_json ?? "[]",
    remaining_json: values.remaining_json ?? "[]",
    no_progress_hash: values.no_progress_hash ?? null,
    schedule_json: values.schedule_json ?? "{}",
    metadata_json: values.metadata_json ?? "{}",
    updated_at: values.updated_at,
    completed_at: values.completed_at ?? null,
  };
}

export function saveMissionRun(record: MissionRunRecord): MissionRunRecord {
  const metadata = {
    ...record.metadata,
    longConversationControl: {
      controlSignals: record.controlSignals ?? [],
      ...(record.validationState ? { validationState: record.validationState } : {}),
      ...(record.acceptanceStatus ? { acceptanceStatus: record.acceptanceStatus } : {}),
    },
  };
  const values: MissionRunInsert = {
    mission_id: record.missionId,
    session_key: record.sessionKey,
    agent_id: nonEmpty(record.agentId),
    workspace_id: nonEmpty(record.workspaceId ?? undefined),
    objective: record.objective,
    acceptance_json: JSON.stringify(record.acceptance),
    status: record.status,
    phase: record.phase,
    tick_count: record.tick,
    repair_tick_count: record.repairTicks,
    max_ticks: record.maxTicks,
    max_repair_ticks: record.maxRepairTicks,
    progress: record.progress,
    last_decision: record.lastDecision ?? null,
    last_reason: record.lastReason ?? null,
    last_reviewer_summary: record.lastReviewerSummary ?? null,
    next_wake_at: record.nextWakeAt ?? null,
    blocked_reason: record.blockedReason ?? null,
    trace_id: record.traceId ?? null,
    task_loop_run_id: record.taskLoopRunId ?? null,
    evidence_refs_json: JSON.stringify(record.evidenceRefs),
    risks_json: JSON.stringify(record.risks),
    remaining_json: JSON.stringify(record.remaining),
    no_progress_hash: record.noProgressHash ?? null,
    schedule_json: "{}",
    metadata_json: JSON.stringify(metadata),
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    completed_at: record.completedAt ?? null,
  };
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<MissionDatabase>(db);
    executeSqliteQuerySync(
      db,
      query
        .insertInto("mission_runs")
        .values(values)
        .onConflict((conflict) => conflict.column("mission_id").doUpdateSet(updateFromValues(values))),
    );
  });
  return getMissionRun(record.missionId) ?? record;
}

export function getMissionRun(missionId: string): MissionRunRecord | undefined {
  const { db, query } = stateDb();
  const row = executeSqliteQuerySync(
    db,
    query.selectFrom("mission_runs").selectAll().where("mission_id", "=", missionId).limit(1),
  ).rows[0];
  return row ? rowToMission(row) : undefined;
}

export function getLatestMissionForSession(sessionKey: string): MissionRunRecord | undefined {
  const { db, query } = stateDb();
  const row = executeSqliteQuerySync(
    db,
    query
      .selectFrom("mission_runs")
      .selectAll()
      .where("session_key", "=", sessionKey)
      .orderBy("updated_at", "desc")
      .orderBy("mission_id", "desc")
      .limit(1),
  ).rows[0];
  return row ? rowToMission(row) : undefined;
}

export function recordMissionEvent(input: MissionStoreEventInput): void {
  const values: MissionEventInsert = {
    id: input.id ?? `mevt_${randomUUID()}`,
    mission_id: input.missionId,
    session_key: input.sessionKey,
    type: input.type,
    phase: input.phase,
    status: input.status,
    tick: input.tick,
    decision: input.decision ?? null,
    payload_json: JSON.stringify(input.payload ?? {}),
    created_at: input.createdAt ?? Date.now(),
  };
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<MissionDatabase>(db);
    executeSqliteQuerySync(
      db,
      query
        .insertInto("mission_events")
        .values(values)
        .onConflict((conflict) => conflict.column("id").doNothing()),
    );
  });
}

export function clearMissionStoreForTests(): void {
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<MissionDatabase>(db);
    executeSqliteQuerySync(db, query.deleteFrom("mission_events"));
    executeSqliteQuerySync(db, query.deleteFrom("mission_runs"));
  });
}
