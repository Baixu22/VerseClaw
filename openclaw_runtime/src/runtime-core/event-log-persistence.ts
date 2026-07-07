// SQLite persistence adapter for default-off RuntimeTaskEventLog shadow records.
import type { Insertable, Selectable } from "kysely";
import {
  executeSqliteQuerySync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import {
  openOpenClawStateDatabase,
  type OpenClawStateDatabase,
  type OpenClawStateDatabaseOptions,
} from "../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import {
  resolveRuntimeEventLogFeatureFlags,
  RuntimeTaskEventLogStore,
  type RuntimeTaskEventLogAppendOptions,
  type RuntimeTaskEventLogAppendContextQuery,
  type RuntimeTaskEventLogAppendContextResult,
  type RuntimeTaskEventLogAppendResult,
  type RuntimeTaskEventLogDiagnostic,
  type RuntimeTaskEventLogLoadResult,
  type RuntimeTaskEventLogRecord,
  type RuntimeTaskEventLogStorage,
} from "./event-log.js";
import type { RuntimeTaskEvent } from "./events.js";
import {
  isRecord,
  type RuntimeCoreJsonObject,
} from "./types.js";

export const RUNTIME_TASK_EVENT_LOG_PERSISTENCE_OWNER =
  "openclaw_runtime.runtime-core.event-log-persistence";

export type RuntimeTaskEventLogSqliteScope = {
  taskId?: string;
  sessionKey?: string;
  traceId?: string;
};

export type RuntimeTaskEventLogPersistenceOpenDatabase = (
  options?: OpenClawStateDatabaseOptions,
) => OpenClawStateDatabase;

export type RuntimeTaskEventLogSqliteStorageOptions = {
  database?: OpenClawStateDatabaseOptions;
  openDatabase?: RuntimeTaskEventLogPersistenceOpenDatabase;
  scope?: RuntimeTaskEventLogSqliteScope;
};

export type RuntimeTaskEventLogRuntimeIntegrationOptions =
  RuntimeTaskEventLogSqliteStorageOptions & {
    config?: unknown;
    metadata?: RuntimeCoreJsonObject;
  };

export type RuntimeTaskEventLogPruneOptions = RuntimeTaskEventLogSqliteStorageOptions & {
  taskId?: string;
  now?: number;
  maxAgeMs?: number;
  maxRecordsPerTask?: number;
  deleteBatchSize?: number;
  maxTasksPerRun?: number;
  dryRun?: boolean;
};

export type RuntimeTaskEventLogPruneSkippedReason =
  | "below_record_floor"
  | "no_old_candidates"
  | "checkpoint_anchor_protected";

export type RuntimeTaskEventLogPruneTaskResult = {
  taskId: string;
  totalRows: number;
  oldRowCount: number;
  candidateCount: number;
  pruned: number;
  recentFloorSequence?: number;
  latestCheckpointSequence?: number;
  skippedReason?: RuntimeTaskEventLogPruneSkippedReason;
};

export type RuntimeTaskEventLogPruneResult = {
  dryRun: boolean;
  scannedTasks: number;
  taskIds: string[];
  eligibleTasks: number;
  skippedTasks: number;
  taskResults: RuntimeTaskEventLogPruneTaskResult[];
  pruned: number;
  diagnostics: RuntimeTaskEventLogDiagnostic[];
};

type RuntimeTaskEventLogDatabase = Pick<
  OpenClawStateKyselyDatabase,
  "runtime_task_event_log_records"
>;
type RuntimeTaskEventLogRow = Selectable<
  OpenClawStateKyselyDatabase["runtime_task_event_log_records"]
>;
type RuntimeTaskEventLogInsert = Insertable<
  OpenClawStateKyselyDatabase["runtime_task_event_log_records"]
>;
type RuntimeTaskEventLogMaxSequenceRow = {
  max_sequence: number | bigint | string | null;
};
type RuntimeTaskEventLogCountRow = {
  count: number | bigint | string | null;
};
type RuntimeTaskEventLogOldTaskRow = {
  task_id: string;
  oldest_appended_at: number | bigint | string | null;
  old_row_count: number | bigint | string | null;
};
type RuntimeTaskEventLogPruneTaskCandidate = {
  taskId: string;
  oldestAppendedAt: number;
  oldRowCount: number;
  totalRows: number;
};

const RUNTIME_TASK_EVENT_LOG_DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const RUNTIME_TASK_EVENT_LOG_DEFAULT_MAX_RECORDS_PER_TASK = 2_000;
const RUNTIME_TASK_EVENT_LOG_DEFAULT_DELETE_BATCH_SIZE = 500;
const RUNTIME_TASK_EVENT_LOG_DEFAULT_MAX_TASKS_PER_RUN = 25;
const RUNTIME_TASK_EVENT_LOG_PRUNE_INTERVAL = 100;

export function createRuntimeTaskEventLogSqliteStorage(
  options: RuntimeTaskEventLogSqliteStorageOptions = {},
): RuntimeTaskEventLogSqliteStorage {
  return new RuntimeTaskEventLogSqliteStorage(options);
}

export class RuntimeTaskEventLogSqliteStorage implements RuntimeTaskEventLogStorage {
  readonly #database?: OpenClawStateDatabaseOptions;
  readonly #openDatabase: RuntimeTaskEventLogPersistenceOpenDatabase;
  readonly #scope: RuntimeTaskEventLogSqliteScope;

  constructor(options: RuntimeTaskEventLogSqliteStorageOptions = {}) {
    this.#database = options.database;
    this.#openDatabase = options.openDatabase ?? openOpenClawStateDatabase;
    this.#scope = normalizeScope(options.scope);
  }

  load(): unknown[] {
    return this.loadResult().records;
  }

  loadResult(): RuntimeTaskEventLogLoadResult {
    const { db, query } = this.#stateDb();
    let select = query.selectFrom("runtime_task_event_log_records").selectAll();
    if (this.#scope.taskId) {
      select = select.where("task_id", "=", this.#scope.taskId);
    }
    if (this.#scope.sessionKey) {
      select = select.where("session_key", "=", this.#scope.sessionKey);
    }
    if (this.#scope.traceId) {
      select = select.where("trace_id", "=", this.#scope.traceId);
    }
    return executeSqliteQuerySync(
      db,
      select
        .orderBy("event_timestamp", "asc")
        .orderBy("task_sequence", "asc")
        .orderBy("event_id", "asc"),
    ).rows.reduce<RuntimeTaskEventLogLoadResult>(
      (result, row) => {
        const parsed = recordFromRow(row);
        if ("diagnostic" in parsed) {
          result.diagnostics.push(parsed.diagnostic);
        } else {
          result.records.push(parsed.record);
        }
        return result;
      },
      { records: [], diagnostics: [] },
    );
  }

  loadAppendContext(
    context: RuntimeTaskEventLogAppendContextQuery,
  ): RuntimeTaskEventLogAppendContextResult {
    const { db, query } = this.#stateDb();
    const maxSequence = executeSqliteQuerySync(
      db,
      query
        .selectFrom("runtime_task_event_log_records")
        .select((eb) => eb.fn.max<number | bigint | string>("task_sequence").as("max_sequence"))
        .where("task_id", "=", context.taskId),
    ).rows[0] as RuntimeTaskEventLogMaxSequenceRow | undefined;
    const duplicateEventRow = executeSqliteQuerySync(
      db,
      query
        .selectFrom("runtime_task_event_log_records")
        .selectAll()
        .where("event_id", "=", context.eventId)
        .limit(1),
    ).rows[0];
    const duplicateIdempotencyRow = context.idempotencyKey
      ? executeSqliteQuerySync(
          db,
          query
            .selectFrom("runtime_task_event_log_records")
            .selectAll()
            .where("task_id", "=", context.taskId)
            .where("idempotency_key", "=", context.idempotencyKey)
            .limit(1),
        ).rows[0]
      : undefined;
    const diagnostics: RuntimeTaskEventLogDiagnostic[] = [];
    const duplicateEventRecord = duplicateEventRow
      ? parsedRecordOrDiagnostic(duplicateEventRow, diagnostics)
      : undefined;
    const duplicateIdempotencyRecord = duplicateIdempotencyRow
      ? parsedRecordOrDiagnostic(duplicateIdempotencyRow, diagnostics)
      : undefined;

    return {
      maxSequence: normalizeDbNumber(maxSequence?.max_sequence, -1),
      ...(duplicateEventRecord ? { duplicateEventRecord } : {}),
      ...(duplicateIdempotencyRecord ? { duplicateIdempotencyRecord } : {}),
      diagnostics,
    };
  }

  append(record: RuntimeTaskEventLogRecord): void {
    const { db, query } = this.#stateDb();
    executeSqliteQuerySync(
      db,
      query.insertInto("runtime_task_event_log_records").values(insertFromRecord(record)),
    );
  }

  #stateDb(): {
    db: OpenClawStateDatabase["db"];
    query: ReturnType<typeof getNodeSqliteKysely<RuntimeTaskEventLogDatabase>>;
  } {
    const stateDb = this.#openDatabase(this.#database);
    return {
      db: stateDb.db,
      query: getNodeSqliteKysely<RuntimeTaskEventLogDatabase>(stateDb.db),
    };
  }
}

export function createRuntimeTaskEventLogRuntimeIntegration(
  options: RuntimeTaskEventLogRuntimeIntegrationOptions = {},
): RuntimeTaskEventLogRuntimeIntegration {
  return new RuntimeTaskEventLogRuntimeIntegration(options);
}

export class RuntimeTaskEventLogRuntimeIntegration {
  readonly #config: unknown;
  readonly #database?: OpenClawStateDatabaseOptions;
  readonly #openDatabase?: RuntimeTaskEventLogPersistenceOpenDatabase;
  readonly #metadata?: RuntimeCoreJsonObject;
  #successfulAppends = 0;

  constructor(options: RuntimeTaskEventLogRuntimeIntegrationOptions = {}) {
    this.#config = options.config;
    this.#database = options.database;
    this.#openDatabase = options.openDatabase;
    this.#metadata = options.metadata;
  }

  append(
    event: RuntimeTaskEvent,
    options: RuntimeTaskEventLogAppendOptions = {},
  ): RuntimeTaskEventLogAppendResult {
    if (!resolveRuntimeEventLogFeatureFlags(this.#config).eventLogPersist) {
      return { appended: false, duplicate: false, diagnostics: [] };
    }
    const store = new RuntimeTaskEventLogStore(
      createRuntimeTaskEventLogSqliteStorage({
        ...(this.#database ? { database: this.#database } : {}),
        ...(this.#openDatabase ? { openDatabase: this.#openDatabase } : {}),
        scope: { taskId: event.taskId },
      }),
    );
    const metadata = mergeMetadata(this.#metadata, options.metadata);
    const result = store.append(event, {
      ...options,
      ...(metadata ? { metadata } : {}),
    });
    if (!result.appended) {
      return result;
    }
    this.#successfulAppends += 1;
    if (this.#successfulAppends % RUNTIME_TASK_EVENT_LOG_PRUNE_INTERVAL !== 0) {
      return result;
    }
    const prune = pruneRuntimeTaskEventLogRecords({
      ...(this.#database ? { database: this.#database } : {}),
      ...(this.#openDatabase ? { openDatabase: this.#openDatabase } : {}),
      taskId: event.taskId,
    });
    return {
      ...result,
      diagnostics: [...result.diagnostics, ...prune.diagnostics],
    };
  }
}

export function pruneRuntimeTaskEventLogRecords(
  options: RuntimeTaskEventLogPruneOptions = {},
): RuntimeTaskEventLogPruneResult {
  const result: RuntimeTaskEventLogPruneResult = {
    dryRun: options.dryRun === true,
    scannedTasks: 0,
    taskIds: [],
    eligibleTasks: 0,
    skippedTasks: 0,
    taskResults: [],
    pruned: 0,
    diagnostics: [],
  };
  try {
    const stateDb = openRuntimeTaskEventLogStateDb(options);
    const now = options.now ?? Date.now();
    const maxAgeMs = normalizePositiveInt(
      options.maxAgeMs,
      RUNTIME_TASK_EVENT_LOG_DEFAULT_MAX_AGE_MS,
    );
    const maxRecordsPerTask = normalizePositiveInt(
      options.maxRecordsPerTask,
      RUNTIME_TASK_EVENT_LOG_DEFAULT_MAX_RECORDS_PER_TASK,
    );
    const deleteBatchSize = normalizePositiveInt(
      options.deleteBatchSize,
      RUNTIME_TASK_EVENT_LOG_DEFAULT_DELETE_BATCH_SIZE,
    );
    const taskIds = options.taskId
      ? [options.taskId]
      : listPruneTaskIds(stateDb, {
          now,
          maxAgeMs,
          maxRecordsPerTask,
          maxTasksPerRun: normalizePositiveInt(
            options.maxTasksPerRun,
            RUNTIME_TASK_EVENT_LOG_DEFAULT_MAX_TASKS_PER_RUN,
          ),
        });
    result.taskIds.push(...taskIds);
    for (const taskId of taskIds) {
      const taskResult = pruneTaskRuntimeEventLogRecords(stateDb, {
        taskId,
        now,
        maxAgeMs,
        maxRecordsPerTask,
        deleteBatchSize,
        dryRun: result.dryRun,
      });
      result.taskResults.push(taskResult);
      result.pruned += taskResult.pruned;
    }
    result.scannedTasks = result.taskResults.length;
    result.eligibleTasks = result.taskResults.filter((task) => !task.skippedReason).length;
    result.skippedTasks = result.taskResults.length - result.eligibleTasks;
  } catch (error) {
    result.diagnostics.push(storeReadFailureDiagnostic(
      options.taskId
        ? `RuntimeTaskEvent log prune failed for task ${options.taskId}: ${errorMessage(error)}`
        : `RuntimeTaskEvent log prune failed: ${errorMessage(error)}`,
    ));
  }
  return result;
}

function insertFromRecord(record: RuntimeTaskEventLogRecord): RuntimeTaskEventLogInsert {
  const metadata = metadataFromRecord(record);
  return {
    event_id: record.event.eventId,
    task_id: record.event.taskId,
    task_sequence: record.sequence,
    kind: record.event.kind,
    event_timestamp: record.event.timestamp,
    appended_at: record.appendedAt,
    idempotency_key: record.idempotencyKey ?? null,
    session_key: metadata.sessionKey ?? null,
    workspace_id: metadata.workspaceId ?? null,
    run_id: metadata.runId ?? null,
    task_ledger_root_id: metadata.taskLedgerRootId ?? null,
    trace_id: metadata.traceId ?? record.event.traceContext?.traceId ?? null,
    schema_version: record.schemaVersion,
    schema_marker: record.schemaMarker,
    record_json: JSON.stringify(record),
  };
}

function recordFromRow(
  row: RuntimeTaskEventLogRow,
):
  | { record: unknown }
  | { diagnostic: RuntimeTaskEventLogDiagnostic } {
  try {
    return { record: JSON.parse(row.record_json) };
  } catch (error) {
    return {
      diagnostic: {
        code: "store_read_failure",
        message: `RuntimeTaskEvent log row parse failed: ${errorMessage(error)}`,
        recoverable: true,
        eventId: row.event_id,
        ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
      },
    };
  }
}

function parsedRecordOrDiagnostic(
  row: RuntimeTaskEventLogRow,
  diagnostics: RuntimeTaskEventLogDiagnostic[],
): unknown | undefined {
  const parsed = recordFromRow(row);
  if ("diagnostic" in parsed) {
    diagnostics.push(parsed.diagnostic);
    return undefined;
  }
  return parsed.record;
}

function metadataFromRecord(record: RuntimeTaskEventLogRecord): Record<string, string | undefined> {
  const metadata = record.metadata;
  return {
    sessionKey: stringField(metadata, "sessionKey"),
    workspaceId: stringField(metadata, "workspaceId"),
    runId: stringField(metadata, "runId") ?? stringField(metadata, "loopRunId"),
    taskLedgerRootId: stringField(metadata, "taskLedgerRootId"),
    traceId: stringField(metadata, "traceId"),
  };
}

function mergeMetadata(
  base: RuntimeCoreJsonObject | undefined,
  override: RuntimeCoreJsonObject | undefined,
): RuntimeCoreJsonObject | undefined {
  if (!base && !override) {
    return undefined;
  }
  return { ...(base ?? {}), ...(override ?? {}) };
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function normalizeScope(
  scope: RuntimeTaskEventLogSqliteScope | undefined,
): RuntimeTaskEventLogSqliteScope {
  return {
    ...(nonEmpty(scope?.taskId) ? { taskId: nonEmpty(scope?.taskId) } : {}),
    ...(nonEmpty(scope?.sessionKey) ? { sessionKey: nonEmpty(scope?.sessionKey) } : {}),
    ...(nonEmpty(scope?.traceId) ? { traceId: nonEmpty(scope?.traceId) } : {}),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim() ? value.trim() : undefined;
}

function openRuntimeTaskEventLogStateDb(
  options: RuntimeTaskEventLogSqliteStorageOptions,
): {
  db: OpenClawStateDatabase["db"];
  query: ReturnType<typeof getNodeSqliteKysely<RuntimeTaskEventLogDatabase>>;
} {
  const stateDb = (options.openDatabase ?? openOpenClawStateDatabase)(options.database);
  return {
    db: stateDb.db,
    query: getNodeSqliteKysely<RuntimeTaskEventLogDatabase>(stateDb.db),
  };
}

function listPruneTaskIds(
  stateDb: {
    db: OpenClawStateDatabase["db"];
    query: ReturnType<typeof getNodeSqliteKysely<RuntimeTaskEventLogDatabase>>;
  },
  options: {
    now: number;
    maxAgeMs: number;
    maxRecordsPerTask: number;
    maxTasksPerRun: number;
  },
): string[] {
  const cutoff = options.now - options.maxAgeMs;
  const oldTaskRows = executeSqliteQuerySync(
    stateDb.db,
    stateDb.query
      .selectFrom("runtime_task_event_log_records")
      .select("task_id")
      .select((eb) => [
        eb.fn.min<number | bigint | string>("appended_at").as("oldest_appended_at"),
        eb.fn.count<number | bigint | string>("event_id").as("old_row_count"),
      ])
      .where("appended_at", "<", cutoff)
      .groupBy("task_id")
  ).rows as RuntimeTaskEventLogOldTaskRow[];
  const candidates: RuntimeTaskEventLogPruneTaskCandidate[] = oldTaskRows.flatMap((row) => {
    const taskId = row.task_id;
    const totalRows = countTaskRows(stateDb, taskId);
    if (totalRows <= options.maxRecordsPerTask) {
      return [];
    }
    const recentFloorSequence = latestRecentFloorSequence(
      stateDb,
      taskId,
      options.maxRecordsPerTask,
    );
    if (typeof recentFloorSequence !== "number") {
      return [];
    }
    const checkpointSequence = latestCheckpointSequence(stateDb, taskId);
    const candidateCount = countTaskCandidateRows(stateDb, {
      taskId,
      cutoff,
      recentFloorSequence,
      ...(checkpointSequence !== undefined ? { checkpointSequence } : {}),
    });
    if (candidateCount <= 0) {
      return [];
    }
    return [{
      taskId,
      totalRows,
      oldRowCount: normalizeDbNumber(row.old_row_count, 0),
      oldestAppendedAt: normalizeDbNumber(row.oldest_appended_at, Number.MAX_SAFE_INTEGER),
    }];
  });
  return candidates
    .sort((left, right) =>
      left.oldestAppendedAt - right.oldestAppendedAt ||
      right.totalRows - left.totalRows ||
      left.taskId.localeCompare(right.taskId)
    )
    .slice(0, options.maxTasksPerRun)
    .map((candidate) => candidate.taskId);
}

function pruneTaskRuntimeEventLogRecords(
  stateDb: {
    db: OpenClawStateDatabase["db"];
    query: ReturnType<typeof getNodeSqliteKysely<RuntimeTaskEventLogDatabase>>;
  },
  options: {
    taskId: string;
    now: number;
    maxAgeMs: number;
    maxRecordsPerTask: number;
    deleteBatchSize: number;
    dryRun: boolean;
  },
): RuntimeTaskEventLogPruneTaskResult {
  const totalRows = countTaskRows(stateDb, options.taskId);
  const oldRowCount = countTaskOldRows(
    stateDb,
    options.taskId,
    options.now - options.maxAgeMs,
  );
  const baseResult: RuntimeTaskEventLogPruneTaskResult = {
    taskId: options.taskId,
    totalRows,
    oldRowCount,
    candidateCount: 0,
    pruned: 0,
  };
  if (totalRows <= options.maxRecordsPerTask) {
    return {
      ...baseResult,
      skippedReason: "below_record_floor",
    };
  }
  if (oldRowCount === 0) {
    return {
      ...baseResult,
      skippedReason: "no_old_candidates",
    };
  }
  const recentFloorSequence = latestRecentFloorSequence(
    stateDb,
    options.taskId,
    options.maxRecordsPerTask,
  );
  if (typeof recentFloorSequence !== "number") {
    return {
      ...baseResult,
      skippedReason: "below_record_floor",
    };
  }
  const checkpointSequence = latestCheckpointSequence(stateDb, options.taskId);
  const resultBaseWithAnchors: RuntimeTaskEventLogPruneTaskResult = {
    ...baseResult,
    recentFloorSequence,
    ...(typeof checkpointSequence === "number"
      ? { latestCheckpointSequence: checkpointSequence }
      : {}),
  };
  const preAnchorCandidateCount = countTaskCandidateRows(stateDb, {
    taskId: options.taskId,
    cutoff: options.now - options.maxAgeMs,
    recentFloorSequence,
  });
  if (preAnchorCandidateCount === 0) {
    return {
      ...resultBaseWithAnchors,
      skippedReason: "no_old_candidates",
    };
  }
  const candidateCount = countTaskCandidateRows(stateDb, {
    taskId: options.taskId,
    cutoff: options.now - options.maxAgeMs,
    recentFloorSequence,
    ...(typeof checkpointSequence === "number" ? { checkpointSequence } : {}),
  });
  if (candidateCount === 0) {
    return {
      ...resultBaseWithAnchors,
      candidateCount,
      skippedReason: "checkpoint_anchor_protected",
    };
  }
  let candidateQuery = stateDb.query
    .selectFrom("runtime_task_event_log_records")
    .select("event_id")
    .where("task_id", "=", options.taskId)
    .where("appended_at", "<", options.now - options.maxAgeMs)
    .where("task_sequence", "<", recentFloorSequence)
    .orderBy("task_sequence", "asc")
    .limit(options.deleteBatchSize);
  if (typeof checkpointSequence === "number") {
    candidateQuery = candidateQuery.where("task_sequence", "<", checkpointSequence);
  }
  const deleteIds = executeSqliteQuerySync(stateDb.db, candidateQuery).rows.map((row) =>
    row.event_id
  );
  if (deleteIds.length === 0 || options.dryRun) {
    return {
      ...resultBaseWithAnchors,
      candidateCount,
      pruned: deleteIds.length,
    };
  }
  const deleted = executeSqliteQuerySync(
    stateDb.db,
    stateDb.query
      .deleteFrom("runtime_task_event_log_records")
      .where("event_id", "in", deleteIds),
  );
  return {
    ...resultBaseWithAnchors,
    candidateCount,
    pruned: Number(deleted.numAffectedRows ?? BigInt(deleteIds.length)),
  };
}

function latestRecentFloorSequence(
  stateDb: {
    db: OpenClawStateDatabase["db"];
    query: ReturnType<typeof getNodeSqliteKysely<RuntimeTaskEventLogDatabase>>;
  },
  taskId: string,
  maxRecordsPerTask: number,
): number | undefined {
  return executeSqliteQuerySync(
    stateDb.db,
    stateDb.query
      .selectFrom("runtime_task_event_log_records")
      .select("task_sequence")
      .where("task_id", "=", taskId)
      .orderBy("task_sequence", "desc")
      .limit(maxRecordsPerTask),
  ).rows.at(-1)?.task_sequence;
}

function latestCheckpointSequence(
  stateDb: {
    db: OpenClawStateDatabase["db"];
    query: ReturnType<typeof getNodeSqliteKysely<RuntimeTaskEventLogDatabase>>;
  },
  taskId: string,
): number | undefined {
  const sequence = executeSqliteQuerySync(
    stateDb.db,
    stateDb.query
      .selectFrom("runtime_task_event_log_records")
      .select("task_sequence")
      .where("task_id", "=", taskId)
      .where("kind", "=", "checkpoint")
      .orderBy("task_sequence", "desc")
      .limit(1),
  ).rows[0]?.task_sequence;
  return typeof sequence === "number" ? sequence : undefined;
}

function countTaskRows(
  stateDb: {
    db: OpenClawStateDatabase["db"];
    query: ReturnType<typeof getNodeSqliteKysely<RuntimeTaskEventLogDatabase>>;
  },
  taskId: string,
): number {
  return normalizeDbNumber((executeSqliteQuerySync(
    stateDb.db,
    stateDb.query
      .selectFrom("runtime_task_event_log_records")
      .select((eb) => eb.fn.count<number | bigint | string>("event_id").as("count"))
      .where("task_id", "=", taskId),
  ).rows[0] as RuntimeTaskEventLogCountRow | undefined)?.count, 0);
}

function countTaskOldRows(
  stateDb: {
    db: OpenClawStateDatabase["db"];
    query: ReturnType<typeof getNodeSqliteKysely<RuntimeTaskEventLogDatabase>>;
  },
  taskId: string,
  cutoff: number,
): number {
  return normalizeDbNumber((executeSqliteQuerySync(
    stateDb.db,
    stateDb.query
      .selectFrom("runtime_task_event_log_records")
      .select((eb) => eb.fn.count<number | bigint | string>("event_id").as("count"))
      .where("task_id", "=", taskId)
      .where("appended_at", "<", cutoff),
  ).rows[0] as RuntimeTaskEventLogCountRow | undefined)?.count, 0);
}

function countTaskCandidateRows(
  stateDb: {
    db: OpenClawStateDatabase["db"];
    query: ReturnType<typeof getNodeSqliteKysely<RuntimeTaskEventLogDatabase>>;
  },
  options: {
    taskId: string;
    cutoff: number;
    recentFloorSequence: number;
    checkpointSequence?: number;
  },
): number {
  let query = stateDb.query
    .selectFrom("runtime_task_event_log_records")
    .select((eb) => eb.fn.count<number | bigint | string>("event_id").as("count"))
    .where("task_id", "=", options.taskId)
    .where("appended_at", "<", options.cutoff)
    .where("task_sequence", "<", options.recentFloorSequence);
  if (typeof options.checkpointSequence === "number") {
    query = query.where("task_sequence", "<", options.checkpointSequence);
  }
  return normalizeDbNumber((executeSqliteQuerySync(
    stateDb.db,
    query,
  ).rows[0] as RuntimeTaskEventLogCountRow | undefined)?.count, 0);
}

function normalizeDbNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  const numberValue = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(numberValue) ? Math.trunc(numberValue) : fallback;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value));
}

function storeReadFailureDiagnostic(message: string): RuntimeTaskEventLogDiagnostic {
  return {
    code: "store_read_failure",
    message,
    recoverable: true,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
