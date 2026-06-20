import { randomUUID } from "node:crypto";
import type { Insertable, Selectable, Updateable } from "kysely";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import type { DB as OpenClawStateKyselyDatabase } from "../../state/openclaw-state-db.generated.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
} from "../../state/openclaw-state-db.js";

export type LongTaskInputMode = "interrupt" | "guide" | "queue";
export type ResumeCheckpointTrigger =
  | "compaction"
  | "interrupt"
  | "run_abort"
  | "clawgraph_node_handoff"
  | "audit_fail"
  | "manual_review"
  | "session_rotation"
  | "queue_drain"
  | "guide";

export type LongTaskQueueStatus = "pending" | "draining" | "drained" | "failed";
export type LongTaskInterventionStatus =
  | "recorded"
  | "queued"
  | "draining"
  | "drained"
  | "steered"
  | "fallback"
  | "checkpointed"
  | "failed";

export type RuntimeResumeCheckpoint = {
  schemaVersion: 1;
  id?: string;
  workspaceId?: string | null;
  sessionKey?: string | null;
  agentId?: string | null;
  trigger: ResumeCheckpointTrigger;
  objective?: string;
  activeNodeId?: string | null;
  activeTask?: string;
  lastConfirmedHandoff?: string;
  openBlockers: string[];
  decisions: string[];
  deviations: string[];
  filesTouched: string[];
  testsRun: string[];
  nextAction?: string;
  reviewNeededItems: string[];
  evidenceRefs: Array<{ type: string; ref: string; label?: string }>;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type LongTaskCheckpointRecord = {
  id: string;
  idempotencyKey?: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  runId?: string;
  traceId?: string;
  clawGraphRunId?: string;
  trigger: ResumeCheckpointTrigger;
  status: string;
  checkpoint: RuntimeResumeCheckpoint;
  createdAt: number;
  updatedAt: number;
};

export type LongTaskInterventionEventRecord = {
  id: string;
  idempotencyKey?: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  runId?: string;
  traceId?: string;
  clawGraphRunId?: string;
  checkpointId?: string;
  mode?: LongTaskInputMode;
  trigger: ResumeCheckpointTrigger;
  status: LongTaskInterventionStatus | string;
  payload: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type LongTaskQueuedUserMessage = {
  id: string;
  idempotencyKey?: string;
  text: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  status: LongTaskQueueStatus;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
  drainedAt?: number;
  enqueuedAt: number;
  updatedAt: number;
  source: string;
  payload: Record<string, unknown>;
};

type LongTaskDatabase = Pick<
  OpenClawStateKyselyDatabase,
  "long_task_checkpoints" | "long_task_intervention_events" | "long_task_user_queue"
>;

type LongTaskCheckpointRow = Selectable<OpenClawStateKyselyDatabase["long_task_checkpoints"]>;
type LongTaskCheckpointInsert = Insertable<OpenClawStateKyselyDatabase["long_task_checkpoints"]>;
type LongTaskCheckpointUpdate = Updateable<OpenClawStateKyselyDatabase["long_task_checkpoints"]>;
type LongTaskInterventionRow = Selectable<
  OpenClawStateKyselyDatabase["long_task_intervention_events"]
>;
type LongTaskInterventionInsert = Insertable<
  OpenClawStateKyselyDatabase["long_task_intervention_events"]
>;
type LongTaskInterventionUpdate = Updateable<
  OpenClawStateKyselyDatabase["long_task_intervention_events"]
>;
type LongTaskQueueRow = Selectable<OpenClawStateKyselyDatabase["long_task_user_queue"]>;
type LongTaskQueueInsert = Insertable<OpenClawStateKyselyDatabase["long_task_user_queue"]>;
type LongTaskQueueUpdate = Updateable<OpenClawStateKyselyDatabase["long_task_user_queue"]>;

function stateDb() {
  const { db } = openOpenClawStateDatabase();
  return { db, query: getNodeSqliteKysely<LongTaskDatabase>(db) };
}

function parseJsonRecord(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseCheckpoint(raw: string | null): RuntimeResumeCheckpoint {
  const parsed = parseJsonRecord(raw);
  return {
    schemaVersion: 1,
    trigger: typeof parsed.trigger === "string" ? (parsed.trigger as ResumeCheckpointTrigger) : "guide",
    openBlockers: Array.isArray(parsed.openBlockers) ? parsed.openBlockers.filter(isString) : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions.filter(isString) : [],
    deviations: Array.isArray(parsed.deviations) ? parsed.deviations.filter(isString) : [],
    filesTouched: Array.isArray(parsed.filesTouched) ? parsed.filesTouched.filter(isString) : [],
    testsRun: Array.isArray(parsed.testsRun) ? parsed.testsRun.filter(isString) : [],
    reviewNeededItems: Array.isArray(parsed.reviewNeededItems)
      ? parsed.reviewNeededItems.filter(isString)
      : [],
    evidenceRefs: Array.isArray(parsed.evidenceRefs)
      ? parsed.evidenceRefs.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const record = item as Record<string, unknown>;
          return typeof record.ref === "string" && record.ref.trim()
            ? [{
                type: typeof record.type === "string" ? record.type : "other",
                ref: record.ref.trim(),
                ...(typeof record.label === "string" ? { label: record.label } : {}),
              }]
            : [];
        })
      : [],
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
    ...(typeof parsed.id === "string" ? { id: parsed.id } : {}),
    ...(typeof parsed.workspaceId === "string" || parsed.workspaceId === null
      ? { workspaceId: parsed.workspaceId as string | null }
      : {}),
    ...(typeof parsed.sessionKey === "string" || parsed.sessionKey === null
      ? { sessionKey: parsed.sessionKey as string | null }
      : {}),
    ...(typeof parsed.agentId === "string" || parsed.agentId === null
      ? { agentId: parsed.agentId as string | null }
      : {}),
    ...(typeof parsed.objective === "string" ? { objective: parsed.objective } : {}),
    ...(typeof parsed.activeNodeId === "string" || parsed.activeNodeId === null
      ? { activeNodeId: parsed.activeNodeId as string | null }
      : {}),
    ...(typeof parsed.activeTask === "string" ? { activeTask: parsed.activeTask } : {}),
    ...(typeof parsed.lastConfirmedHandoff === "string"
      ? { lastConfirmedHandoff: parsed.lastConfirmedHandoff }
      : {}),
    ...(typeof parsed.nextAction === "string" ? { nextAction: parsed.nextAction } : {}),
    ...(parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
      ? { metadata: parsed.metadata as Record<string, unknown> }
      : {}),
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function checkpointRowToRecord(row: LongTaskCheckpointRow): LongTaskCheckpointRecord {
  return {
    id: row.id,
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    sessionKey: row.session_key,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.trace_id ? { traceId: row.trace_id } : {}),
    ...(row.clawgraph_run_id ? { clawGraphRunId: row.clawgraph_run_id } : {}),
    trigger: row.trigger as ResumeCheckpointTrigger,
    status: row.status,
    checkpoint: parseCheckpoint(row.checkpoint_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function interventionRowToRecord(row: LongTaskInterventionRow): LongTaskInterventionEventRecord {
  return {
    id: row.id,
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    sessionKey: row.session_key,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.trace_id ? { traceId: row.trace_id } : {}),
    ...(row.clawgraph_run_id ? { clawGraphRunId: row.clawgraph_run_id } : {}),
    ...(row.checkpoint_id ? { checkpointId: row.checkpoint_id } : {}),
    ...(row.mode ? { mode: row.mode as LongTaskInputMode } : {}),
    trigger: row.trigger as ResumeCheckpointTrigger,
    status: row.status,
    payload: parseJsonRecord(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function queueRowToRecord(row: LongTaskQueueRow): LongTaskQueuedUserMessage {
  return {
    id: row.id,
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    text: row.text,
    sessionKey: row.session_key,
    ...(row.agent_id ? { agentId: row.agent_id } : {}),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    status: row.status as LongTaskQueueStatus,
    attempts: row.attempts,
    ...(row.last_attempt_at !== null ? { lastAttemptAt: row.last_attempt_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.drained_at !== null ? { drainedAt: row.drained_at } : {}),
    enqueuedAt: row.created_at,
    updatedAt: row.updated_at,
    source: row.source,
    payload: parseJsonRecord(row.payload_json),
  };
}

function checkpointUpdate(values: LongTaskCheckpointInsert): LongTaskCheckpointUpdate {
  const { id: _id, created_at: _createdAt, ...update } = values;
  return update;
}

function interventionUpdate(values: LongTaskInterventionInsert): LongTaskInterventionUpdate {
  const { id: _id, created_at: _createdAt, ...update } = values;
  return update;
}

function queueUpdate(values: LongTaskQueueInsert): LongTaskQueueUpdate {
  const { id: _id, created_at: _createdAt, attempts: _attempts, ...update } = values;
  return update;
}

export function buildRuntimeResumeCheckpoint(input: {
  id?: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  trigger: ResumeCheckpointTrigger;
  activeTask?: string;
  deviations?: string[];
  nextAction?: string;
  reviewNeededItems?: string[];
  evidenceRefs?: RuntimeResumeCheckpoint["evidenceRefs"];
  metadata?: Record<string, unknown>;
  createdAt?: number;
}): RuntimeResumeCheckpoint {
  const createdAt = new Date(input.createdAt ?? Date.now()).toISOString();
  return {
    schemaVersion: 1,
    ...(input.id ? { id: input.id } : {}),
    sessionKey: input.sessionKey,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    trigger: input.trigger,
    ...(input.activeTask ? { activeTask: input.activeTask } : {}),
    openBlockers: [],
    decisions: [],
    deviations: input.deviations?.filter(Boolean) ?? [],
    filesTouched: [],
    testsRun: [],
    ...(input.nextAction ? { nextAction: input.nextAction } : {}),
    reviewNeededItems: input.reviewNeededItems?.filter(Boolean) ?? [],
    evidenceRefs: input.evidenceRefs ?? [{ type: "session", ref: input.sessionKey }],
    createdAt,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function recordLongTaskCheckpoint(input: {
  id?: string;
  idempotencyKey?: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  runId?: string;
  traceId?: string;
  clawGraphRunId?: string;
  trigger: ResumeCheckpointTrigger;
  status?: string;
  checkpoint?: RuntimeResumeCheckpoint;
  activeTask?: string;
  deviations?: string[];
  nextAction?: string;
  reviewNeededItems?: string[];
  evidenceRefs?: RuntimeResumeCheckpoint["evidenceRefs"];
  metadata?: Record<string, unknown>;
}): LongTaskCheckpointRecord {
  const now = Date.now();
  const id = input.id ?? `ltcp_${randomUUID()}`;
  const checkpoint =
    input.checkpoint ??
    buildRuntimeResumeCheckpoint({
      id,
      sessionKey: input.sessionKey,
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      trigger: input.trigger,
      activeTask: input.activeTask,
      deviations: input.deviations,
      nextAction: input.nextAction,
      reviewNeededItems: input.reviewNeededItems,
      evidenceRefs: input.evidenceRefs,
      metadata: input.metadata,
      createdAt: now,
    });
  checkpoint.id ??= id;
  const values: LongTaskCheckpointInsert = {
    id,
    idempotency_key: nonEmpty(input.idempotencyKey) ?? null,
    session_key: input.sessionKey,
    agent_id: nonEmpty(input.agentId) ?? null,
    workspace_id: nonEmpty(input.workspaceId) ?? null,
    run_id: nonEmpty(input.runId) ?? null,
    trace_id: nonEmpty(input.traceId) ?? null,
    clawgraph_run_id: nonEmpty(input.clawGraphRunId) ?? null,
    trigger: input.trigger,
    status: input.status ?? "active",
    checkpoint_json: JSON.stringify(checkpoint),
    created_at: now,
    updated_at: now,
  };
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<LongTaskDatabase>(db);
    const insert = query.insertInto("long_task_checkpoints").values(values);
    executeSqliteQuerySync(
      db,
      values.idempotency_key
        ? insert.onConflict((conflict) =>
            conflict.column("idempotency_key").doUpdateSet(checkpointUpdate(values)),
          )
        : insert.onConflict((conflict) => conflict.column("id").doUpdateSet(checkpointUpdate(values))),
    );
  });
  return getLongTaskCheckpointById(values.id) ?? getLatestLongTaskCheckpoint(input.sessionKey)!;
}

export function recordLongTaskInterventionEvent(input: {
  id?: string;
  idempotencyKey?: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  runId?: string;
  traceId?: string;
  clawGraphRunId?: string;
  checkpointId?: string;
  mode?: LongTaskInputMode;
  trigger: ResumeCheckpointTrigger;
  status: LongTaskInterventionStatus | string;
  payload?: Record<string, unknown>;
}): LongTaskInterventionEventRecord {
  const now = Date.now();
  const values: LongTaskInterventionInsert = {
    id: input.id ?? `ltie_${randomUUID()}`,
    idempotency_key: nonEmpty(input.idempotencyKey) ?? null,
    session_key: input.sessionKey,
    agent_id: nonEmpty(input.agentId) ?? null,
    workspace_id: nonEmpty(input.workspaceId) ?? null,
    run_id: nonEmpty(input.runId) ?? null,
    trace_id: nonEmpty(input.traceId) ?? null,
    clawgraph_run_id: nonEmpty(input.clawGraphRunId) ?? null,
    checkpoint_id: nonEmpty(input.checkpointId) ?? null,
    mode: input.mode ?? null,
    trigger: input.trigger,
    status: input.status,
    payload_json: JSON.stringify(input.payload ?? {}),
    created_at: now,
    updated_at: now,
  };
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<LongTaskDatabase>(db);
    const insert = query.insertInto("long_task_intervention_events").values(values);
    executeSqliteQuerySync(
      db,
      values.idempotency_key
        ? insert.onConflict((conflict) =>
            conflict.column("idempotency_key").doUpdateSet(interventionUpdate(values)),
          )
        : insert.onConflict((conflict) =>
            conflict.column("id").doUpdateSet(interventionUpdate(values)),
          ),
    );
  });
  return getLongTaskInterventionById(values.id) ?? getLatestLongTaskIntervention(input.sessionKey)!;
}

export function enqueueLongTaskUserMessage(input: {
  id?: string;
  idempotencyKey?: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  text: string;
  source?: string;
  payload?: Record<string, unknown>;
}): LongTaskQueuedUserMessage {
  const now = Date.now();
  const values: LongTaskQueueInsert = {
    id: input.id ?? `qmsg_${randomUUID()}`,
    idempotency_key: nonEmpty(input.idempotencyKey) ?? null,
    session_key: input.sessionKey,
    agent_id: nonEmpty(input.agentId) ?? null,
    workspace_id: nonEmpty(input.workspaceId) ?? null,
    status: "pending",
    text: input.text,
    source: input.source ?? "queue",
    attempts: 0,
    last_attempt_at: null,
    last_error: null,
    drained_at: null,
    payload_json: JSON.stringify(input.payload ?? {}),
    created_at: now,
    updated_at: now,
  };
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<LongTaskDatabase>(db);
    const insert = query.insertInto("long_task_user_queue").values(values);
    executeSqliteQuerySync(
      db,
      values.idempotency_key
        ? insert.onConflict((conflict) =>
            conflict.column("idempotency_key").doUpdateSet(queueUpdate(values)),
          )
        : insert.onConflict((conflict) => conflict.column("id").doUpdateSet(queueUpdate(values))),
    );
  });
  return getLongTaskQueueItemById(values.id) ?? listLongTaskQueuedMessages(input.sessionKey)[0]!;
}

export function claimPendingLongTaskUserMessages(
  sessionKey: string,
): LongTaskQueuedUserMessage[] {
  const rows = listLongTaskQueuedMessages(sessionKey);
  if (rows.length === 0) {
    return [];
  }
  const now = Date.now();
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<LongTaskDatabase>(db);
    for (const row of rows) {
      executeSqliteQuerySync(
        db,
        query
          .updateTable("long_task_user_queue")
          .set({
            status: "draining",
            attempts: row.attempts + 1,
            last_attempt_at: now,
            last_error: null,
            updated_at: now,
          })
          .where("id", "=", row.id),
      );
    }
  });
  return rows.map((row) => ({
    ...row,
    status: "draining",
    attempts: row.attempts + 1,
    lastAttemptAt: now,
    updatedAt: now,
  }));
}

export function markLongTaskUserMessagesDrained(ids: string[]): void {
  if (ids.length === 0) return;
  const now = Date.now();
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<LongTaskDatabase>(db);
    executeSqliteQuerySync(
      db,
      query
        .updateTable("long_task_user_queue")
        .set({ status: "drained", drained_at: now, updated_at: now, last_error: null })
        .where("id", "in", ids),
    );
  });
}

export function restoreLongTaskUserMessages(ids: string[], reason: string): void {
  if (ids.length === 0) return;
  const now = Date.now();
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<LongTaskDatabase>(db);
    executeSqliteQuerySync(
      db,
      query
        .updateTable("long_task_user_queue")
        .set({ status: "pending", updated_at: now, last_error: reason })
        .where("id", "in", ids),
    );
  });
}

export function markLongTaskUserMessagesFailed(ids: string[], error: string): void {
  if (ids.length === 0) return;
  const now = Date.now();
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<LongTaskDatabase>(db);
    executeSqliteQuerySync(
      db,
      query
        .updateTable("long_task_user_queue")
        .set({ status: "failed", updated_at: now, last_error: error })
        .where("id", "in", ids),
    );
  });
}

export function listLongTaskQueuedMessages(sessionKey: string): LongTaskQueuedUserMessage[] {
  const { db, query } = stateDb();
  return executeSqliteQuerySync(
    db,
    query
      .selectFrom("long_task_user_queue")
      .selectAll()
      .where("session_key", "=", sessionKey)
      .where("status", "=", "pending")
      .orderBy("created_at", "asc")
      .orderBy("id", "asc"),
  ).rows.map(queueRowToRecord);
}

export function countLongTaskQueuedMessages(sessionKey: string): number {
  const { db, query } = stateDb();
  const row = executeSqliteQuerySync(
    db,
    query
      .selectFrom("long_task_user_queue")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("session_key", "=", sessionKey)
      .where("status", "=", "pending"),
  ).rows[0] as { count?: number | string } | undefined;
  return Math.max(0, Number(row?.count ?? 0));
}

export function clearLongTaskUserQueue(sessionKey: string): void {
  const now = Date.now();
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<LongTaskDatabase>(db);
    executeSqliteQuerySync(
      db,
      query
        .updateTable("long_task_user_queue")
        .set({ status: "drained", drained_at: now, updated_at: now })
        .where("session_key", "=", sessionKey)
        .where("status", "in", ["pending", "draining"]),
    );
  });
}

export function getLatestLongTaskCheckpoint(
  sessionKey: string,
): LongTaskCheckpointRecord | undefined {
  const { db, query } = stateDb();
  const row = executeSqliteQuerySync(
    db,
    query
      .selectFrom("long_task_checkpoints")
      .selectAll()
      .where("session_key", "=", sessionKey)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(1),
  ).rows[0];
  return row ? checkpointRowToRecord(row) : undefined;
}

export function listLongTaskCheckpoints(
  sessionKey: string,
  limit = 20,
): LongTaskCheckpointRecord[] {
  const { db, query } = stateDb();
  return executeSqliteQuerySync(
    db,
    query
      .selectFrom("long_task_checkpoints")
      .selectAll()
      .where("session_key", "=", sessionKey)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(100, Math.floor(limit)))),
  ).rows.map(checkpointRowToRecord);
}

export function getLatestLongTaskIntervention(
  sessionKey: string,
): LongTaskInterventionEventRecord | undefined {
  const { db, query } = stateDb();
  const row = executeSqliteQuerySync(
    db,
    query
      .selectFrom("long_task_intervention_events")
      .selectAll()
      .where("session_key", "=", sessionKey)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(1),
  ).rows[0];
  return row ? interventionRowToRecord(row) : undefined;
}

export function listLongTaskInterventions(
  sessionKey: string,
  limit = 20,
): LongTaskInterventionEventRecord[] {
  const { db, query } = stateDb();
  return executeSqliteQuerySync(
    db,
    query
      .selectFrom("long_task_intervention_events")
      .selectAll()
      .where("session_key", "=", sessionKey)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(Math.max(1, Math.min(100, Math.floor(limit)))),
  ).rows.map(interventionRowToRecord);
}

function getLongTaskCheckpointById(id: string): LongTaskCheckpointRecord | undefined {
  const { db, query } = stateDb();
  const row = executeSqliteQuerySync(
    db,
    query.selectFrom("long_task_checkpoints").selectAll().where("id", "=", id).limit(1),
  ).rows[0];
  return row ? checkpointRowToRecord(row) : undefined;
}

function getLongTaskInterventionById(id: string): LongTaskInterventionEventRecord | undefined {
  const { db, query } = stateDb();
  const row = executeSqliteQuerySync(
    db,
    query
      .selectFrom("long_task_intervention_events")
      .selectAll()
      .where("id", "=", id)
      .limit(1),
  ).rows[0];
  return row ? interventionRowToRecord(row) : undefined;
}

function getLongTaskQueueItemById(id: string): LongTaskQueuedUserMessage | undefined {
  const { db, query } = stateDb();
  const row = executeSqliteQuerySync(
    db,
    query.selectFrom("long_task_user_queue").selectAll().where("id", "=", id).limit(1),
  ).rows[0];
  return row ? queueRowToRecord(row) : undefined;
}
