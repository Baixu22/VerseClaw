import {
  isRuntimeTaskEvent,
  type RuntimeTaskEvent,
} from "./events.js";
import {
  isFiniteNumber,
  isNonEmptyString,
  isRecord,
  isRuntimeCoreJsonObject,
  type RuntimeCoreJsonObject,
  type RuntimeTaskEventKind,
} from "./types.js";
import {
  emitRuntimeEventLogVerificationShadowSample,
  type RuntimeVerificationShadowSamplingOptions,
} from "./verification-shadow-sampling.js";

/**
 * STATUS (#177): built-but-unwired. Every flag below defaults to `false`, and
 * the only production consumers are `agents/long-task-control/persisted-resume-shadow.ts`
 * and `agents/task-loop-controller.ts` (shadow/observation only).
 *
 * Concretely, this means:
 *   - `sessions.restoreCheckpoint` gates the pilot off and falls back to the
 *     legacy compaction path (`sessions.run-control.ts`).
 *   - `checkpoint-rollback-executor.ts` answers `replayEventLog` with
 *     `ok:false, reason:"event_log_replay_not_implemented: …"`.
 *   - `ReplayRollbackTarget` keeps an `event_log` variant that no producer
 *     satisfies yet.
 *
 * So event-level precise replay is NOT available in production today — do not
 * read this module (or the `*-pilot.ts` family beside it) as evidence that it
 * is. Turning it on is option C in #177 and requires real crash/restore
 * correctness evidence, not more shadow runs. The guard test
 * `tests/unit/runtime-event-log-unwired-asset.test.ts` fails if a default is
 * flipped without someone deliberately updating this note.
 */
export const RUNTIME_TASK_EVENT_LOG_SCHEMA_VERSION = 1 as const;
export const RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER = "runtime.task-event-log.v1" as const;

export const RUNTIME_EVENT_LOG_FLAG_PATHS = {
  eventLogShadow: "runtime.eventLog.shadow",
  eventLogPersist: "runtime.eventLog.persist",
  checkpointSerializerShadow: "runtime.checkpointSerializer.shadow",
  resumeReplayShadow: "runtime.resume.replayShadow",
} as const;

export type RuntimeEventLogFeatureFlag = keyof typeof RUNTIME_EVENT_LOG_FLAG_PATHS;
export type RuntimeEventLogFeatureFlags = Record<RuntimeEventLogFeatureFlag, boolean>;

export const DEFAULT_RUNTIME_EVENT_LOG_FEATURE_FLAGS = {
  eventLogShadow: false,
  eventLogPersist: false,
  checkpointSerializerShadow: false,
  resumeReplayShadow: false,
} as const satisfies RuntimeEventLogFeatureFlags;

export const RUNTIME_TASK_EVENT_LOG_DIAGNOSTIC_CODES = [
  "invalid_event",
  "duplicate_idempotency_key",
  "duplicate_event_id",
  "store_write_failure",
  "store_read_failure",
  "schema_marker_mismatch",
] as const;

export type RuntimeTaskEventLogDiagnosticCode =
  (typeof RUNTIME_TASK_EVENT_LOG_DIAGNOSTIC_CODES)[number];

export type RuntimeTaskEventLogDiagnostic = {
  code: RuntimeTaskEventLogDiagnosticCode;
  message: string;
  recoverable: true;
  eventId?: string;
  idempotencyKey?: string;
  expectedSchemaMarker?: string;
  actualSchemaMarker?: string;
};

export type RuntimeTaskEventLogEnvelope = {
  schemaVersion: typeof RUNTIME_TASK_EVENT_LOG_SCHEMA_VERSION;
  schemaMarker: typeof RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER;
  event: RuntimeTaskEvent;
  idempotencyKey?: string;
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeTaskEventLogRecord = RuntimeTaskEventLogEnvelope & {
  sequence: number;
  appendedAt: number;
};

export type RuntimeTaskEventLogAppendOptions = {
  idempotencyKey?: string;
  appendedAt?: number;
  metadata?: RuntimeCoreJsonObject;
  shadow?: RuntimeVerificationShadowSamplingOptions;
};

export type RuntimeTaskEventLogAppendInput =
  | RuntimeTaskEvent
  | RuntimeTaskEventLogEnvelope;

export type RuntimeTaskEventLogAppendResult = {
  record?: RuntimeTaskEventLogRecord;
  appended: boolean;
  duplicate: boolean;
  diagnostics: RuntimeTaskEventLogDiagnostic[];
};

export type RuntimeTaskEventLogAppendManyResult = {
  records: RuntimeTaskEventLogRecord[];
  appendedCount: number;
  diagnostics: RuntimeTaskEventLogDiagnostic[];
};

export type RuntimeTaskEventLogGetResult = {
  record?: RuntimeTaskEventLogRecord;
  diagnostics: RuntimeTaskEventLogDiagnostic[];
};

export type RuntimeTaskEventLogBatchGetResult = {
  records: Array<RuntimeTaskEventLogRecord | undefined>;
  diagnostics: RuntimeTaskEventLogDiagnostic[];
};

export type RuntimeTaskEventLogSortOrder = "asc" | "desc";

export type RuntimeTaskEventLogSearchQuery = {
  taskId?: string;
  kind?: RuntimeTaskEventKind | RuntimeTaskEventKind[];
  timestampGte?: number;
  timestampLt?: number;
  sortOrder?: RuntimeTaskEventLogSortOrder;
  page?: number;
  limit?: number;
};

export type RuntimeTaskEventLogSearchResult = {
  records: RuntimeTaskEventLogRecord[];
  total: number;
  page: number;
  limit?: number;
  nextPage?: number;
  diagnostics: RuntimeTaskEventLogDiagnostic[];
};

export type RuntimeTaskEventLogExportQuery = Omit<
  RuntimeTaskEventLogSearchQuery,
  "page" | "limit"
>;

export type RuntimeTaskEventLogExportResult = Iterable<RuntimeTaskEventLogRecord> & {
  records: RuntimeTaskEventLogRecord[];
  total: number;
  diagnostics: RuntimeTaskEventLogDiagnostic[];
};

export type RuntimeTaskEventLogLoadResult = {
  records: unknown[];
  diagnostics: RuntimeTaskEventLogDiagnostic[];
};

export type RuntimeTaskEventLogAppendContextQuery = {
  taskId: string;
  eventId: string;
  idempotencyKey?: string;
};

export type RuntimeTaskEventLogAppendContextResult = {
  maxSequence: number;
  duplicateEventRecord?: unknown;
  duplicateIdempotencyRecord?: unknown;
  diagnostics: RuntimeTaskEventLogDiagnostic[];
};

export type RuntimeTaskEventLogStorage = {
  load(): unknown[];
  loadResult?(): RuntimeTaskEventLogLoadResult;
  loadAppendContext?(
    query: RuntimeTaskEventLogAppendContextQuery,
  ): RuntimeTaskEventLogAppendContextResult;
  append(record: RuntimeTaskEventLogRecord): void;
};

export type RuntimeTaskEventLogStoreOptions = {
  shadow?: RuntimeVerificationShadowSamplingOptions;
};

type ReadRecordsResult = {
  records: RuntimeTaskEventLogRecord[];
  diagnostics: RuntimeTaskEventLogDiagnostic[];
};

type ReadAppendContextResult = {
  maxSequence: number;
  duplicateEventRecord?: RuntimeTaskEventLogRecord;
  duplicateIdempotencyRecord?: RuntimeTaskEventLogRecord;
  diagnostics: RuntimeTaskEventLogDiagnostic[];
};

type NormalizedAppendInput = {
  event: RuntimeTaskEvent;
  idempotencyKey?: string;
  metadata?: RuntimeCoreJsonObject;
};

export class InMemoryRuntimeTaskEventLogStorage implements RuntimeTaskEventLogStorage {
  readonly #records: RuntimeTaskEventLogRecord[];

  constructor(records: RuntimeTaskEventLogRecord[] = []) {
    this.#records = records.map(cloneJson);
  }

  load(): unknown[] {
    return this.#records.map(cloneJson);
  }

  append(record: RuntimeTaskEventLogRecord): void {
    this.#records.push(cloneJson(record));
  }
}

export class RuntimeTaskEventLogStore {
  readonly #storage: RuntimeTaskEventLogStorage;
  readonly #options: RuntimeTaskEventLogStoreOptions;

  constructor(
    storage: RuntimeTaskEventLogStorage = new InMemoryRuntimeTaskEventLogStorage(),
    options: RuntimeTaskEventLogStoreOptions = {},
  ) {
    this.#storage = storage;
    this.#options = options;
  }

  append(
    input: unknown,
    options: RuntimeTaskEventLogAppendOptions = {},
  ): RuntimeTaskEventLogAppendResult {
    const normalized = normalizeAppendInput(input, options);
    if ("diagnostic" in normalized) {
      return {
        appended: false,
        duplicate: false,
        diagnostics: [normalized.diagnostic],
      };
    }

    const read = this.#readAppendContext(normalized);
    if (read.diagnostics.some((diagnostic) => diagnostic.code === "store_read_failure")) {
      return {
        appended: false,
        duplicate: false,
        diagnostics: read.diagnostics,
      };
    }

    const duplicate = duplicateAppendResult(normalized, read);
    if (duplicate) {
      return duplicate;
    }

    const record: RuntimeTaskEventLogRecord = {
      schemaVersion: RUNTIME_TASK_EVENT_LOG_SCHEMA_VERSION,
      schemaMarker: RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER,
      sequence: Math.max(-1, Math.trunc(read.maxSequence)) + 1,
      appendedAt: options.appendedAt ?? Date.now(),
      event: cloneJson(normalized.event),
      ...(normalized.idempotencyKey ? { idempotencyKey: normalized.idempotencyKey } : {}),
      ...(normalized.metadata ? { metadata: cloneJson(normalized.metadata) } : {}),
    };

    try {
      this.#storage.append(record);
    } catch (error) {
      const writeDiagnostic = diagnostic({
        code: "store_write_failure",
        message: `RuntimeTaskEvent log append failed: ${errorMessage(error)}`,
        eventId: normalized.event.eventId,
        idempotencyKey: normalized.idempotencyKey,
      });
      const afterWriteRead = this.#readAppendContext(normalized);
      if (!afterWriteRead.diagnostics.some((item) => item.code === "store_read_failure")) {
        const duplicateAfterWrite = duplicateAppendResult(normalized, afterWriteRead);
        if (duplicateAfterWrite) {
          return duplicateAfterWrite;
        }
      }
      return {
        appended: false,
        duplicate: false,
        diagnostics: [...read.diagnostics, writeDiagnostic, ...afterWriteRead.diagnostics],
      };
    }

    emitRuntimeEventLogVerificationShadowSample({
      sampling: options.shadow ?? this.#options.shadow,
      events: [record.event],
      fallbackRunId: runtimeEventShadowRunId(record.event),
    });

    return {
      record: cloneJson(record),
      appended: true,
      duplicate: false,
      diagnostics: read.diagnostics,
    };
  }

  appendMany(
    inputs: unknown[],
    options: RuntimeTaskEventLogAppendOptions = {},
  ): RuntimeTaskEventLogAppendManyResult {
    const records: RuntimeTaskEventLogRecord[] = [];
    const diagnostics: RuntimeTaskEventLogDiagnostic[] = [];

    for (const input of inputs) {
      const result = this.append(input, options);
      diagnostics.push(...result.diagnostics);
      if (result.appended && result.record) {
        records.push(result.record);
      }
    }

    return {
      records,
      appendedCount: records.length,
      diagnostics,
    };
  }

  getByEventId(eventId: string): RuntimeTaskEventLogGetResult {
    const read = this.#readRecords();
    return {
      record: read.records.find((record) => record.event.eventId === eventId),
      diagnostics: read.diagnostics,
    };
  }

  batchGet(eventIds: string[]): RuntimeTaskEventLogBatchGetResult {
    const read = this.#readRecords();
    return {
      records: eventIds.map((eventId) =>
        read.records.find((record) => record.event.eventId === eventId),
      ),
      diagnostics: read.diagnostics,
    };
  }

  search(query: RuntimeTaskEventLogSearchQuery = {}): RuntimeTaskEventLogSearchResult {
    const read = this.#readRecords();
    const filtered = filterAndSortRecords(read.records, query);
    const page = normalizePage(query.page);
    const limit = normalizeLimit(query.limit);
    const records = paginateRecords(filtered, page, limit);
    const nextPage =
      limit !== undefined && limit > 0 && page * limit + limit < filtered.length
        ? page + 1
        : undefined;

    return {
      records,
      total: filtered.length,
      page,
      ...(limit !== undefined ? { limit } : {}),
      ...(nextPage !== undefined ? { nextPage } : {}),
      diagnostics: read.diagnostics,
    };
  }

  exportRecords(query: RuntimeTaskEventLogExportQuery = {}): RuntimeTaskEventLogExportResult {
    const read = this.#readRecords();
    const records = filterAndSortRecords(read.records, {
      ...query,
      sortOrder: query.sortOrder ?? "asc",
    });

    return {
      records,
      total: records.length,
      diagnostics: read.diagnostics,
      *[Symbol.iterator]() {
        yield* records;
      },
    };
  }

  #readAppendContext(input: NormalizedAppendInput): ReadAppendContextResult {
    if (!this.#storage.loadAppendContext) {
      const read = this.#readRecords();
      const duplicateEventRecord = read.records.find(
        (record) => record.event.eventId === input.event.eventId,
      );
      const duplicateIdempotencyRecord = findDuplicateIdempotencyRecord(
        read.records,
        input.idempotencyKey,
      );
      return {
        maxSequence: maxSequence(read.records),
        ...(duplicateEventRecord ? { duplicateEventRecord } : {}),
        ...(duplicateIdempotencyRecord ? { duplicateIdempotencyRecord } : {}),
        diagnostics: read.diagnostics,
      };
    }

    let result: RuntimeTaskEventLogAppendContextResult;
    try {
      result = this.#storage.loadAppendContext({
        taskId: input.event.taskId,
        eventId: input.event.eventId,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      });
    } catch (error) {
      return {
        maxSequence: -1,
        diagnostics: [
          diagnostic({
            code: "store_read_failure",
            message: `RuntimeTaskEvent log read failed: ${errorMessage(error)}`,
            eventId: input.event.eventId,
            idempotencyKey: input.idempotencyKey,
          }),
        ],
      };
    }

    const diagnostics = [...result.diagnostics];
    const duplicateEventRecord = normalizeOptionalStoredRecord(
      result.duplicateEventRecord,
      diagnostics,
    );
    const duplicateIdempotencyRecord = normalizeOptionalStoredRecord(
      result.duplicateIdempotencyRecord,
      diagnostics,
    );

    return {
      maxSequence: Number.isFinite(result.maxSequence) ? Math.trunc(result.maxSequence) : -1,
      ...(duplicateEventRecord ? { duplicateEventRecord } : {}),
      ...(duplicateIdempotencyRecord ? { duplicateIdempotencyRecord } : {}),
      diagnostics,
    };
  }

  #readRecords(): ReadRecordsResult {
    let read: RuntimeTaskEventLogLoadResult;
    try {
      read = this.#storage.loadResult
        ? this.#storage.loadResult()
        : { records: this.#storage.load(), diagnostics: [] };
    } catch (error) {
      return {
        records: [],
        diagnostics: [
          diagnostic({
            code: "store_read_failure",
            message: `RuntimeTaskEvent log read failed: ${errorMessage(error)}`,
          }),
        ],
      };
    }

    if (!Array.isArray(read.records)) {
      return {
        records: [],
        diagnostics: [
          diagnostic({
            code: "store_read_failure",
            message: "RuntimeTaskEvent log storage returned a non-array record set.",
          }),
        ],
      };
    }

    const records: RuntimeTaskEventLogRecord[] = [];
    const diagnostics: RuntimeTaskEventLogDiagnostic[] = [...read.diagnostics];
    for (const value of read.records) {
      const normalized = normalizeStoredRecord(value);
      if ("diagnostic" in normalized) {
        diagnostics.push(normalized.diagnostic);
      } else {
        records.push(normalized.record);
      }
    }

    return { records, diagnostics };
  }
}

function duplicateAppendResult(
  input: NormalizedAppendInput,
  read: ReadAppendContextResult,
): RuntimeTaskEventLogAppendResult | undefined {
  const duplicateIdempotencyRecord = read.duplicateIdempotencyRecord;
  if (duplicateIdempotencyRecord) {
    return {
      record: duplicateIdempotencyRecord,
      appended: false,
      duplicate: true,
      diagnostics: [
        ...read.diagnostics,
        diagnostic({
          code: "duplicate_idempotency_key",
          message: `RuntimeTaskEvent idempotency key already exists: ${input.idempotencyKey}`,
          eventId: duplicateIdempotencyRecord.event.eventId,
          idempotencyKey: input.idempotencyKey,
        }),
      ],
    };
  }

  const duplicateEventRecord = read.duplicateEventRecord;
  if (duplicateEventRecord) {
    return {
      record: duplicateEventRecord,
      appended: false,
      duplicate: true,
      diagnostics: [
        ...read.diagnostics,
        diagnostic({
          code: "duplicate_event_id",
          message: `RuntimeTaskEvent id already exists: ${input.event.eventId}`,
          eventId: input.event.eventId,
        }),
      ],
    };
  }

  return undefined;
}

function normalizeOptionalStoredRecord(
  value: unknown,
  diagnostics: RuntimeTaskEventLogDiagnostic[],
): RuntimeTaskEventLogRecord | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = normalizeStoredRecord(value);
  if ("diagnostic" in normalized) {
    diagnostics.push(normalized.diagnostic);
    return undefined;
  }
  return normalized.record;
}

export function createRuntimeTaskEventLogEnvelope(
  event: RuntimeTaskEvent,
  options: RuntimeTaskEventLogAppendOptions = {},
): RuntimeTaskEventLogEnvelope {
  const idempotencyKey = options.idempotencyKey ?? idempotencyKeyFromEvent(event);
  return {
    schemaVersion: RUNTIME_TASK_EVENT_LOG_SCHEMA_VERSION,
    schemaMarker: RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER,
    event,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}

export function isRuntimeTaskEventLogEnvelope(
  value: unknown,
): value is RuntimeTaskEventLogEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === RUNTIME_TASK_EVENT_LOG_SCHEMA_VERSION &&
    value.schemaMarker === RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER &&
    isRuntimeTaskEvent(value.event) &&
    (value.idempotencyKey === undefined || isNonEmptyString(value.idempotencyKey)) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isRuntimeTaskEventLogRecord(
  value: unknown,
): value is RuntimeTaskEventLogRecord {
  if (!isRecord(value) || !isRuntimeTaskEventLogEnvelope(value)) {
    return false;
  }
  const record = value as RuntimeTaskEventLogEnvelope & Record<string, unknown>;
  return (
    isFiniteNumber(record.sequence) &&
    Number.isInteger(record.sequence) &&
    record.sequence >= 0 &&
    isFiniteNumber(record.appendedAt)
  );
}

export function resolveRuntimeEventLogFeatureFlags(
  value: unknown,
): RuntimeEventLogFeatureFlags {
  const runtime = runtimeConfigFrom(value);
  return {
    eventLogShadow: strictFlag(runtime?.eventLog, "shadow"),
    eventLogPersist: strictFlag(runtime?.eventLog, "persist"),
    checkpointSerializerShadow: strictFlag(runtime?.checkpointSerializer, "shadow"),
    resumeReplayShadow: strictFlag(runtime?.resume, "replayShadow"),
  };
}

export function runtimeEventLogFlagEnabled(
  value: unknown,
  flag: RuntimeEventLogFeatureFlag,
): boolean {
  return resolveRuntimeEventLogFeatureFlags(value)[flag];
}

function normalizeAppendInput(
  input: unknown,
  options: RuntimeTaskEventLogAppendOptions,
):
  | NormalizedAppendInput
  | {
      diagnostic: RuntimeTaskEventLogDiagnostic;
    } {
  if (isRuntimeTaskEvent(input)) {
    const idempotencyKey = options.idempotencyKey ?? idempotencyKeyFromEvent(input);
    return {
      event: input,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(options.metadata ? { metadata: options.metadata } : {}),
    };
  }

  if (!isRecord(input)) {
    return {
      diagnostic: invalidEventDiagnostic(input),
    };
  }

  if (!("event" in input)) {
    return {
      diagnostic: invalidEventDiagnostic(input),
    };
  }

  const markerDiagnostic = schemaMarkerDiagnostic(input);
  if (markerDiagnostic) {
    return { diagnostic: markerDiagnostic };
  }

  if (!isRuntimeTaskEvent(input.event)) {
    return {
      diagnostic: invalidEventDiagnostic(input.event),
    };
  }

  const idempotencyKey = options.idempotencyKey ??
    (isNonEmptyString(input.idempotencyKey) ? input.idempotencyKey : undefined) ??
    idempotencyKeyFromEvent(input.event);
  const metadata = options.metadata ??
    (isRuntimeCoreJsonObject(input.metadata) ? input.metadata : undefined);

  return {
    event: input.event,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeStoredRecord(
  value: unknown,
):
  | {
      record: RuntimeTaskEventLogRecord;
    }
  | {
      diagnostic: RuntimeTaskEventLogDiagnostic;
    } {
  if (!isRecord(value)) {
    return {
      diagnostic: invalidEventDiagnostic(value),
    };
  }

  if (!("event" in value)) {
    return {
      diagnostic: invalidEventDiagnostic(value),
    };
  }

  const markerDiagnostic = schemaMarkerDiagnostic(value);
  if (markerDiagnostic) {
    return { diagnostic: markerDiagnostic };
  }

  if (!isRuntimeTaskEvent(value.event)) {
    return {
      diagnostic: invalidEventDiagnostic(value.event),
    };
  }

  if (!isRuntimeTaskEventLogRecord(value)) {
    return {
      diagnostic: diagnostic({
        code: "invalid_event",
        message: "Stored RuntimeTaskEvent log record is not a valid append-only envelope.",
        eventId: value.event.eventId,
      }),
    };
  }

  return { record: cloneJson(value) };
}

function filterAndSortRecords(
  records: RuntimeTaskEventLogRecord[],
  query: RuntimeTaskEventLogSearchQuery,
): RuntimeTaskEventLogRecord[] {
  const kinds = query.kind === undefined
    ? undefined
    : new Set(Array.isArray(query.kind) ? query.kind : [query.kind]);

  return records
    .filter((record) => {
      if (query.taskId !== undefined && record.event.taskId !== query.taskId) {
        return false;
      }
      if (kinds !== undefined && !kinds.has(record.event.kind)) {
        return false;
      }
      if (query.timestampGte !== undefined && record.event.timestamp < query.timestampGte) {
        return false;
      }
      if (query.timestampLt !== undefined && record.event.timestamp >= query.timestampLt) {
        return false;
      }
      return true;
    })
    .sort((left, right) => compareRecords(left, right, query.sortOrder ?? "asc"))
    .map(cloneJson);
}

function compareRecords(
  left: RuntimeTaskEventLogRecord,
  right: RuntimeTaskEventLogRecord,
  sortOrder: RuntimeTaskEventLogSortOrder,
): number {
  const timestampDelta = left.event.timestamp - right.event.timestamp;
  if (timestampDelta !== 0) {
    return sortOrder === "desc" ? -timestampDelta : timestampDelta;
  }
  return left.sequence - right.sequence;
}

function paginateRecords(
  records: RuntimeTaskEventLogRecord[],
  page: number,
  limit: number | undefined,
): RuntimeTaskEventLogRecord[] {
  if (limit === undefined) {
    return records.map(cloneJson);
  }
  const start = page * limit;
  return records.slice(start, start + limit).map(cloneJson);
}

function normalizePage(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.trunc(value));
}

function findDuplicateIdempotencyRecord(
  records: RuntimeTaskEventLogRecord[],
  idempotencyKey: string | undefined,
): RuntimeTaskEventLogRecord | undefined {
  if (!idempotencyKey) {
    return undefined;
  }
  return records.find((record) => record.idempotencyKey === idempotencyKey);
}

function maxSequence(records: RuntimeTaskEventLogRecord[]): number {
  return records.reduce((highest, record) => Math.max(highest, record.sequence), -1);
}

function idempotencyKeyFromEvent(event: RuntimeTaskEvent): string | undefined {
  return event.kind === "tool_call_request" ? event.payload.idempotencyKey : undefined;
}

function runtimeEventShadowRunId(event: RuntimeTaskEvent): string {
  const attrs = isRecord(event.traceContext?.attributes) ? event.traceContext.attributes : undefined;
  return isNonEmptyString(attrs?.runId)
    ? attrs.runId
    : isNonEmptyString(attrs?.loopRunId)
      ? attrs.loopRunId
      : event.taskId;
}

function schemaMarkerDiagnostic(
  value: Record<string, unknown>,
): RuntimeTaskEventLogDiagnostic | undefined {
  if (
    value.schemaVersion === RUNTIME_TASK_EVENT_LOG_SCHEMA_VERSION &&
    value.schemaMarker === RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER
  ) {
    return undefined;
  }

  return diagnostic({
    code: "schema_marker_mismatch",
    message: "RuntimeTaskEvent log envelope schema marker/version mismatch.",
    expectedSchemaMarker: RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER,
    actualSchemaMarker: [
      typeof value.schemaMarker === "string" ? value.schemaMarker : "missing",
      typeof value.schemaVersion === "string" ? value.schemaVersion : "missing",
    ].join("@"),
  });
}

function invalidEventDiagnostic(value: unknown): RuntimeTaskEventLogDiagnostic {
  const eventId = isRecord(value) && isNonEmptyString(value.eventId) ? value.eventId : undefined;
  return diagnostic({
    code: "invalid_event",
    message: "Value is not a valid canonical RuntimeTaskEvent.",
    ...(eventId ? { eventId } : {}),
  });
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (isRecord(value.runtime)) {
    return value.runtime;
  }
  return value;
}

function strictFlag(section: unknown, key: string): boolean {
  return isRecord(section) && section[key] === true;
}

function diagnostic(
  value: Omit<RuntimeTaskEventLogDiagnostic, "recoverable">,
): RuntimeTaskEventLogDiagnostic {
  return {
    ...value,
    recoverable: true,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
