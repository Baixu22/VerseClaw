import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { sql, type Selectable } from "kysely";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import { resolveRuntimeEventLogFeatureFlags } from "./event-log.js";
import {
  isRuntimeTaskEventKind,
  type RuntimeTaskEventKind,
} from "./types.js";

export const RUNTIME_EVENT_LOG_OPERATOR_INSPECTION_SCHEMA_VERSION = 1 as const;
export const RUNTIME_EVENT_LOG_OPERATOR_INSPECTION_SCHEMA_MARKER =
  "runtime.event-log.operator-inspection.v1" as const;

export type RuntimeEventLogOperatorInspectionStatus = "skipped" | "loaded" | "error";
export type RuntimeEventLogOperatorInspectionSkippedReason =
  | "flag_disabled"
  | "database_path_required"
  | "database_missing"
  | "table_missing";
export type RuntimeEventLogOperatorInspectionReadStatus =
  | "not_opened"
  | "clean"
  | "partial"
  | "unreadable";
export type RuntimeEventLogOperatorInspectionDiagnosticCode =
  | RuntimeEventLogOperatorInspectionSkippedReason
  | "inspection_failed"
  | "corrupt_rows_detected";

export type RuntimeEventLogOperatorInspectionDiagnostic = {
  code: RuntimeEventLogOperatorInspectionDiagnosticCode;
  message: string;
  recoverable: true;
  eventId?: string;
  taskId?: string;
};

export type RuntimeEventLogOperatorInspectionOpenReadOnlyDatabase = (
  pathname: string,
) => DatabaseSync;

export type RuntimeEventLogOperatorInspectionOptions = {
  config?: unknown;
  databasePath?: string;
  taskId?: string;
  sessionKey?: string;
  traceId?: string;
  kind?: RuntimeTaskEventKind | RuntimeTaskEventKind[];
  timestampGte?: number;
  timestampLt?: number;
  limit?: number;
  maxTasks?: number;
  now?: () => number;
  maxAgeMs?: number;
  maxRecordsPerTask?: number;
  openReadOnlyDatabase?: RuntimeEventLogOperatorInspectionOpenReadOnlyDatabase;
};

export type RuntimeEventLogOperatorInspectionEventSummary = {
  eventId: string;
  taskId: string;
  sequence: number;
  kind: RuntimeTaskEventKind | string;
  timestamp: number;
  appendedAt: number;
  sessionKey?: string;
  runId?: string;
  traceId?: string;
};

export type RuntimeEventLogOperatorRetentionEvidence = {
  taskId: string;
  totalRows: number;
  oldRowCount: number;
  candidateCount: number;
  latestCheckpointId?: string;
  latestCheckpointSequence?: number;
  recentFloorSequence?: number;
  skippedReason?:
    | "below_record_floor"
    | "no_old_candidates"
    | "checkpoint_anchor_protected";
};

export type RuntimeEventLogOperatorResumeComparisonSummary = {
  legacyAuthoritative: true;
  eventLogAuthoritative: false;
  comparisonStatus: "not_run";
};

export type RuntimeEventLogOperatorInspectionStats = {
  eventCount: number;
  returned: number;
  limit: number;
  truncated: boolean;
  inspectedAt: number;
  readStatus: RuntimeEventLogOperatorInspectionReadStatus;
  corruptRowCount: number;
  taskIds: string[];
  eventIds: string[];
  kinds: string[];
  sessionIds: string[];
  runIds: string[];
  traceIds: string[];
  latestCheckpointId?: string;
};

export type RuntimeEventLogOperatorInspectionSideEffects = {
  sqliteOpened: boolean;
  readOnly: boolean;
  databaseCreated: false;
  tableCreated: false;
  databaseWritten: false;
  migrationRun: false;
  externalArtifactCreated: false;
};

export type RuntimeEventLogOperatorInspectionResult = {
  schemaVersion: typeof RUNTIME_EVENT_LOG_OPERATOR_INSPECTION_SCHEMA_VERSION;
  schemaMarker: typeof RUNTIME_EVENT_LOG_OPERATOR_INSPECTION_SCHEMA_MARKER;
  status: RuntimeEventLogOperatorInspectionStatus;
  enabled: boolean;
  reason?: RuntimeEventLogOperatorInspectionSkippedReason | "inspection_failed";
  events: RuntimeEventLogOperatorInspectionEventSummary[];
  retentionEvidence: RuntimeEventLogOperatorRetentionEvidence[];
  resumeComparison: RuntimeEventLogOperatorResumeComparisonSummary;
  stats: RuntimeEventLogOperatorInspectionStats;
  sideEffects: RuntimeEventLogOperatorInspectionSideEffects;
  diagnostics: RuntimeEventLogOperatorInspectionDiagnostic[];
};

type RuntimeEventLogInspectionDatabase = Pick<
  OpenClawStateKyselyDatabase,
  "runtime_task_event_log_records"
>;
type RuntimeEventLogInspectionRow = Selectable<
  OpenClawStateKyselyDatabase["runtime_task_event_log_records"]
>;
type RuntimeEventLogInspectionSummaryRow = Pick<
  RuntimeEventLogInspectionRow,
  | "event_id"
  | "task_id"
  | "task_sequence"
  | "kind"
  | "event_timestamp"
  | "appended_at"
  | "session_key"
  | "run_id"
  | "trace_id"
>;
type CountRow = { count: number | bigint | string | null };
type SequenceRow = {
  task_sequence?: number | bigint | string | null;
  event_id?: string | null;
};
type TaskRow = { task_id: string };

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_MAX_TASKS = 25;
const MAX_TASKS = 100;
const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_RECORDS_PER_TASK = 2_000;
const EVENT_LOG_TABLE = "runtime_task_event_log_records";
const RECORD_BODY_COLUMN = ["record", "json"].join("_");

export function inspectRuntimeEventLogForOperator(
  options: RuntimeEventLogOperatorInspectionOptions,
): RuntimeEventLogOperatorInspectionResult {
  const limit = normalizeBound(options.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const maxTasks = normalizeBound(options.maxTasks, DEFAULT_MAX_TASKS, MAX_TASKS);
  const inspectedAt = options.now?.() ?? Date.now();
  const base = {
    limit,
    inspectedAt,
  };

  if (!resolveRuntimeEventLogFeatureFlags(options.config).eventLogPersist) {
    return skippedResult("flag_disabled", base, false);
  }
  const databasePath = nonEmpty(options.databasePath);
  if (!databasePath) {
    return skippedResult("database_path_required", base, false);
  }
  if (!existsSync(databasePath)) {
    return skippedResult("database_missing", base, false);
  }

  const openReadOnlyDatabase = options.openReadOnlyDatabase ?? openInspectionDatabase;
  let db: DatabaseSync | undefined;
  try {
    db = openReadOnlyDatabase(databasePath);
    if (!inspectionTableExists(db)) {
      return skippedResult("table_missing", base, true, true);
    }

    const query = normalizeQuery(options);
    const eventCount = countEvents(db, query);
    const corruptRowCount = countCorruptRows(db, query);
    const rows = readEventRows(db, query, limit + 1);
    const returnedRows = rows.slice(0, limit);
    const events = returnedRows.map(eventSummaryFromRow);
    const latestCheckpoint = latestCheckpointRow(db, query);
    const diagnostics = corruptRowCount > 0
      ? [diagnostic({
          code: "corrupt_rows_detected",
          message: "Runtime Event Log readonly inspection detected corrupt stored records.",
        })]
      : [];

    return {
      ...baseResult({
        enabled: true,
        status: "loaded",
        stats: {
          ...statsFromEvents({
            events,
            eventCount,
            limit,
            inspectedAt,
            readStatus: corruptRowCount > 0 ? "partial" : "clean",
            corruptRowCount,
            latestCheckpointId: latestCheckpoint?.event_id ?? undefined,
          }),
          truncated: eventCount > limit || rows.length > limit,
        },
        sideEffects: sideEffects(true),
        diagnostics,
      }),
      events,
      retentionEvidence: retentionEvidence(db, {
        query,
        maxTasks,
        now: inspectedAt,
        maxAgeMs: normalizePositiveInt(options.maxAgeMs, DEFAULT_MAX_AGE_MS),
        maxRecordsPerTask: normalizePositiveInt(
          options.maxRecordsPerTask,
          DEFAULT_MAX_RECORDS_PER_TASK,
        ),
      }),
    };
  } catch {
    return {
      ...baseResult({
        enabled: true,
        status: "error",
        reason: "inspection_failed",
        stats: emptyStats({
          ...base,
          readStatus: "unreadable",
        }),
        sideEffects: sideEffects(Boolean(db)),
        diagnostics: [
          diagnostic({
            code: "inspection_failed",
            message: "Runtime Event Log readonly inspection failed.",
          }),
        ],
      }),
    };
  } finally {
    if (db) {
      clearNodeSqliteKyselyCacheForDatabase(db);
      if (db.isOpen) {
        db.close();
      }
    }
  }
}

function openInspectionDatabase(pathname: string): DatabaseSync {
  const sqlite = requireNodeSqlite();
  return new sqlite.DatabaseSync(pathname, { readOnly: true });
}

function inspectionTableExists(db: DatabaseSync): boolean {
  const row = db // sqlite-allow-raw
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(EVENT_LOG_TABLE) as { ok?: unknown } | undefined;
  return row?.ok === 1;
}

type NormalizedQuery = {
  taskId?: string;
  sessionKey?: string;
  traceId?: string;
  kinds?: RuntimeTaskEventKind[];
  timestampGte?: number;
  timestampLt?: number;
};

function normalizeQuery(options: RuntimeEventLogOperatorInspectionOptions): NormalizedQuery {
  const kinds = Array.isArray(options.kind) ? options.kind : options.kind ? [options.kind] : [];
  return {
    ...(nonEmpty(options.taskId) ? { taskId: nonEmpty(options.taskId) } : {}),
    ...(nonEmpty(options.sessionKey) ? { sessionKey: nonEmpty(options.sessionKey) } : {}),
    ...(nonEmpty(options.traceId) ? { traceId: nonEmpty(options.traceId) } : {}),
    ...(kinds.length > 0 ? { kinds: kinds.filter(isRuntimeTaskEventKind) } : {}),
    ...(finite(options.timestampGte) ? { timestampGte: Math.trunc(options.timestampGte) } : {}),
    ...(finite(options.timestampLt) ? { timestampLt: Math.trunc(options.timestampLt) } : {}),
  };
}

function countEvents(db: DatabaseSync, query: NormalizedQuery): number {
  const kysely = getNodeSqliteKysely<RuntimeEventLogInspectionDatabase>(db);
  const row = executeSqliteQueryTakeFirstSync(
    db,
    applyFilters(
      kysely
        .selectFrom(EVENT_LOG_TABLE)
        .select((eb) => eb.fn.countAll<number>().as("count")),
      query,
    ),
  ) as CountRow | undefined;
  return normalizeDbNumber(row?.count, 0);
}

function countCorruptRows(db: DatabaseSync, query: NormalizedQuery): number {
  const kysely = getNodeSqliteKysely<RuntimeEventLogInspectionDatabase>(db);
  const row = executeSqliteQueryTakeFirstSync(
    db,
    applyFilters(
      kysely
        .selectFrom(EVENT_LOG_TABLE)
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where(/* kysely-allow-raw */ sql<boolean>`json_valid(${sql.ref(RECORD_BODY_COLUMN)}) = 0`),
      query,
    ),
  ) as CountRow | undefined;
  return normalizeDbNumber(row?.count, 0);
}

function readEventRows(
  db: DatabaseSync,
  query: NormalizedQuery,
  limit: number,
): RuntimeEventLogInspectionSummaryRow[] {
  const kysely = getNodeSqliteKysely<RuntimeEventLogInspectionDatabase>(db);
  return executeSqliteQuerySync(
    db,
    applyFilters(
      kysely
        .selectFrom(EVENT_LOG_TABLE)
        .select([
          "event_id",
          "task_id",
          "task_sequence",
          "kind",
          "event_timestamp",
          "appended_at",
          "session_key",
          "run_id",
          "trace_id",
        ])
        .orderBy("event_timestamp", "asc")
        .orderBy("task_sequence", "asc")
        .orderBy("event_id", "asc")
        .limit(limit),
      query,
    ),
  ).rows;
}

function latestCheckpointRow(
  db: DatabaseSync,
  query: NormalizedQuery,
): SequenceRow | undefined {
  const kysely = getNodeSqliteKysely<RuntimeEventLogInspectionDatabase>(db);
  return executeSqliteQueryTakeFirstSync(
    db,
    applyFilters(
      kysely
        .selectFrom(EVENT_LOG_TABLE)
        .select(["event_id", "task_sequence"])
        .where("kind", "=", "checkpoint")
        .orderBy("event_timestamp", "desc")
        .orderBy("task_sequence", "desc")
        .orderBy("event_id", "desc")
        .limit(1),
      query,
    ),
  ) as SequenceRow | undefined;
}

function retentionEvidence(
  db: DatabaseSync,
  options: {
    query: NormalizedQuery;
    maxTasks: number;
    now: number;
    maxAgeMs: number;
    maxRecordsPerTask: number;
  },
): RuntimeEventLogOperatorRetentionEvidence[] {
  const taskIds = listTaskIds(db, options.query, options.maxTasks);
  return taskIds.map((taskId) =>
    retentionEvidenceForTask(db, {
      taskId,
      now: options.now,
      maxAgeMs: options.maxAgeMs,
      maxRecordsPerTask: options.maxRecordsPerTask,
    })
  );
}

function listTaskIds(
  db: DatabaseSync,
  query: NormalizedQuery,
  maxTasks: number,
): string[] {
  const kysely = getNodeSqliteKysely<RuntimeEventLogInspectionDatabase>(db);
  return executeSqliteQuerySync(
    db,
    applyFilters(
      kysely
        .selectFrom(EVENT_LOG_TABLE)
        .select("task_id")
        .groupBy("task_id")
        .orderBy("task_id", "asc")
        .limit(maxTasks),
      query,
    ),
  ).rows.map((row: TaskRow) => row.task_id);
}

function retentionEvidenceForTask(
  db: DatabaseSync,
  options: {
    taskId: string;
    now: number;
    maxAgeMs: number;
    maxRecordsPerTask: number;
  },
): RuntimeEventLogOperatorRetentionEvidence {
  const cutoff = options.now - options.maxAgeMs;
  const totalRows = countTaskRows(db, options.taskId);
  const oldRowCount = countTaskOldRows(db, options.taskId, cutoff);
  const base = {
    taskId: options.taskId,
    totalRows,
    oldRowCount,
    candidateCount: 0,
  };
  if (totalRows <= options.maxRecordsPerTask) {
    return { ...base, skippedReason: "below_record_floor" };
  }
  if (oldRowCount === 0) {
    return { ...base, skippedReason: "no_old_candidates" };
  }
  const recentFloorSequence = recentFloorSequenceForTask(
    db,
    options.taskId,
    options.maxRecordsPerTask,
  );
  if (typeof recentFloorSequence !== "number") {
    return { ...base, skippedReason: "below_record_floor" };
  }
  const latestCheckpoint = latestCheckpointForTask(db, options.taskId);
  const candidateCount = countCandidateRows(db, {
    taskId: options.taskId,
    cutoff,
    recentFloorSequence,
    ...(latestCheckpoint?.task_sequence !== undefined
      ? { checkpointSequence: normalizeDbNumber(latestCheckpoint.task_sequence, -1) }
      : {}),
  });
  const withAnchors = {
    ...base,
    candidateCount,
    recentFloorSequence,
    ...(latestCheckpoint?.event_id ? { latestCheckpointId: latestCheckpoint.event_id } : {}),
    ...(latestCheckpoint?.task_sequence !== undefined
      ? { latestCheckpointSequence: normalizeDbNumber(latestCheckpoint.task_sequence, -1) }
      : {}),
  };
  if (candidateCount > 0) {
    return withAnchors;
  }
  const preAnchorCount = countCandidateRows(db, {
    taskId: options.taskId,
    cutoff,
    recentFloorSequence,
  });
  return {
    ...withAnchors,
    skippedReason: preAnchorCount > 0 ? "checkpoint_anchor_protected" : "no_old_candidates",
  };
}

function countTaskRows(db: DatabaseSync, taskId: string): number {
  const kysely = getNodeSqliteKysely<RuntimeEventLogInspectionDatabase>(db);
  const row = executeSqliteQueryTakeFirstSync(
    db,
    kysely
      .selectFrom(EVENT_LOG_TABLE)
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("task_id", "=", taskId),
  ) as CountRow | undefined;
  return normalizeDbNumber(row?.count, 0);
}

function countTaskOldRows(db: DatabaseSync, taskId: string, cutoff: number): number {
  const kysely = getNodeSqliteKysely<RuntimeEventLogInspectionDatabase>(db);
  const row = executeSqliteQueryTakeFirstSync(
    db,
    kysely
      .selectFrom(EVENT_LOG_TABLE)
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("task_id", "=", taskId)
      .where("appended_at", "<", cutoff),
  ) as CountRow | undefined;
  return normalizeDbNumber(row?.count, 0);
}

function recentFloorSequenceForTask(
  db: DatabaseSync,
  taskId: string,
  maxRecordsPerTask: number,
): number | undefined {
  const kysely = getNodeSqliteKysely<RuntimeEventLogInspectionDatabase>(db);
  const row = executeSqliteQuerySync(
    db,
    kysely
      .selectFrom(EVENT_LOG_TABLE)
      .select("task_sequence")
      .where("task_id", "=", taskId)
      .orderBy("task_sequence", "desc")
      .limit(maxRecordsPerTask),
  ).rows.at(-1) as SequenceRow | undefined;
  return row?.task_sequence === undefined
    ? undefined
    : normalizeDbNumber(row.task_sequence, -1);
}

function latestCheckpointForTask(db: DatabaseSync, taskId: string): SequenceRow | undefined {
  const kysely = getNodeSqliteKysely<RuntimeEventLogInspectionDatabase>(db);
  return executeSqliteQueryTakeFirstSync(
    db,
    kysely
      .selectFrom(EVENT_LOG_TABLE)
      .select(["event_id", "task_sequence"])
      .where("task_id", "=", taskId)
      .where("kind", "=", "checkpoint")
      .orderBy("task_sequence", "desc")
      .limit(1),
  ) as SequenceRow | undefined;
}

function countCandidateRows(
  db: DatabaseSync,
  options: {
    taskId: string;
    cutoff: number;
    recentFloorSequence: number;
    checkpointSequence?: number;
  },
): number {
  const kysely = getNodeSqliteKysely<RuntimeEventLogInspectionDatabase>(db);
  let query = kysely
    .selectFrom(EVENT_LOG_TABLE)
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("task_id", "=", options.taskId)
    .where("appended_at", "<", options.cutoff)
    .where("task_sequence", "<", options.recentFloorSequence);
  if (typeof options.checkpointSequence === "number") {
    query = query.where("task_sequence", "<", options.checkpointSequence);
  }
  const row = executeSqliteQueryTakeFirstSync(db, query) as CountRow | undefined;
  return normalizeDbNumber(row?.count, 0);
}

function applyFilters<T>(
  query: T,
  filters: NormalizedQuery,
): T {
  let filtered = query;
  const where = (current: T, column: string, op: string, value: unknown): T =>
    (current as { where(column: string, op: string, value: unknown): T })
      .where(column, op, value);
  if (filters.taskId) {
    filtered = where(filtered, "task_id", "=", filters.taskId);
  }
  if (filters.sessionKey) {
    filtered = where(filtered, "session_key", "=", filters.sessionKey);
  }
  if (filters.traceId) {
    filtered = where(filtered, "trace_id", "=", filters.traceId);
  }
  if (filters.kinds && filters.kinds.length > 0) {
    filtered = where(filtered, "kind", "in", filters.kinds);
  }
  if (filters.timestampGte !== undefined) {
    filtered = where(filtered, "event_timestamp", ">=", filters.timestampGte);
  }
  if (filters.timestampLt !== undefined) {
    filtered = where(filtered, "event_timestamp", "<", filters.timestampLt);
  }
  return filtered;
}

function eventSummaryFromRow(
  row: RuntimeEventLogInspectionSummaryRow,
): RuntimeEventLogOperatorInspectionEventSummary {
  return {
    eventId: row.event_id,
    taskId: row.task_id,
    sequence: normalizeDbNumber(row.task_sequence, 0),
    kind: row.kind,
    timestamp: normalizeDbNumber(row.event_timestamp, 0),
    appendedAt: normalizeDbNumber(row.appended_at, 0),
    ...(row.session_key ? { sessionKey: row.session_key } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.trace_id ? { traceId: row.trace_id } : {}),
  };
}

function skippedResult(
  reason: RuntimeEventLogOperatorInspectionSkippedReason,
  base: {
    limit: number;
    inspectedAt: number;
  },
  opened: boolean,
  enabled = false,
): RuntimeEventLogOperatorInspectionResult {
  return baseResult({
    enabled,
    status: "skipped",
    reason,
    stats: emptyStats({
      ...base,
      readStatus: opened ? "unreadable" : "not_opened",
    }),
    sideEffects: sideEffects(opened),
    diagnostics: [
      diagnostic({
        code: reason,
        message: skippedMessage(reason),
      }),
    ],
  });
}

function baseResult(input: {
  enabled: boolean;
  status: RuntimeEventLogOperatorInspectionStatus;
  reason?: RuntimeEventLogOperatorInspectionResult["reason"];
  stats: RuntimeEventLogOperatorInspectionStats;
  sideEffects: RuntimeEventLogOperatorInspectionSideEffects;
  diagnostics: RuntimeEventLogOperatorInspectionDiagnostic[];
}): RuntimeEventLogOperatorInspectionResult {
  return {
    schemaVersion: RUNTIME_EVENT_LOG_OPERATOR_INSPECTION_SCHEMA_VERSION,
    schemaMarker: RUNTIME_EVENT_LOG_OPERATOR_INSPECTION_SCHEMA_MARKER,
    status: input.status,
    enabled: input.enabled,
    ...(input.reason ? { reason: input.reason } : {}),
    events: [],
    retentionEvidence: [],
    resumeComparison: {
      legacyAuthoritative: true,
      eventLogAuthoritative: false,
      comparisonStatus: "not_run",
    },
    stats: input.stats,
    sideEffects: input.sideEffects,
    diagnostics: input.diagnostics,
  };
}

function emptyStats(input: {
  limit: number;
  inspectedAt: number;
  readStatus: RuntimeEventLogOperatorInspectionReadStatus;
}): RuntimeEventLogOperatorInspectionStats {
  return {
    eventCount: 0,
    returned: 0,
    limit: input.limit,
    truncated: false,
    inspectedAt: input.inspectedAt,
    readStatus: input.readStatus,
    corruptRowCount: 0,
    taskIds: [],
    eventIds: [],
    kinds: [],
    sessionIds: [],
    runIds: [],
    traceIds: [],
  };
}

function statsFromEvents(input: {
  events: RuntimeEventLogOperatorInspectionEventSummary[];
  eventCount: number;
  limit: number;
  inspectedAt: number;
  readStatus: RuntimeEventLogOperatorInspectionReadStatus;
  corruptRowCount: number;
  latestCheckpointId?: string;
}): Omit<RuntimeEventLogOperatorInspectionStats, "truncated"> {
  return {
    eventCount: input.eventCount,
    returned: input.events.length,
    limit: input.limit,
    inspectedAt: input.inspectedAt,
    readStatus: input.readStatus,
    corruptRowCount: input.corruptRowCount,
    taskIds: uniqueBounded(input.events.map((event) => event.taskId)),
    eventIds: input.events.map((event) => event.eventId),
    kinds: uniqueBounded(input.events.map((event) => event.kind)),
    sessionIds: uniqueBounded(input.events.flatMap((event) => event.sessionKey ?? [])),
    runIds: uniqueBounded(input.events.flatMap((event) => event.runId ?? [])),
    traceIds: uniqueBounded(input.events.flatMap((event) => event.traceId ?? [])),
    ...(input.latestCheckpointId ? { latestCheckpointId: input.latestCheckpointId } : {}),
  };
}

function sideEffects(opened: boolean): RuntimeEventLogOperatorInspectionSideEffects {
  return {
    sqliteOpened: opened,
    readOnly: opened,
    databaseCreated: false,
    tableCreated: false,
    databaseWritten: false,
    migrationRun: false,
    externalArtifactCreated: false,
  };
}

function skippedMessage(reason: RuntimeEventLogOperatorInspectionSkippedReason): string {
  if (reason === "flag_disabled") {
    return "Runtime Event Log readonly inspection requires runtime.eventLog.persist.";
  }
  if (reason === "database_path_required") {
    return "Runtime Event Log readonly inspection requires an explicit database path.";
  }
  if (reason === "database_missing") {
    return "Runtime Event Log readonly inspection skipped a missing database.";
  }
  return "Runtime Event Log readonly inspection skipped because the event-log table is missing.";
}

function diagnostic(
  value: Omit<RuntimeEventLogOperatorInspectionDiagnostic, "recoverable">,
): RuntimeEventLogOperatorInspectionDiagnostic {
  return {
    ...value,
    recoverable: true,
  };
}

function normalizeBound(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.trunc(value)));
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value));
}

function normalizeDbNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  const numberValue = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : fallback;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim() ? value.trim() : undefined;
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function uniqueBounded(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].slice(0, 100);
}
