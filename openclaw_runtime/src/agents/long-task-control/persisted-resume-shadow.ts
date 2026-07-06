// Internal persisted resume shadow report over TaskLoop event-log records.
import type { OpenClawStateDatabaseOptions } from "../../state/openclaw-state-db.js";
import {
  LEGACY_RUNTIME_TASK_STATUS_MAP,
  isRuntimeTaskStatus,
  type RuntimeTaskStatus,
} from "../../runtime-core/types.js";
import {
  RuntimeTaskEventLogStore,
  resolveRuntimeEventLogFeatureFlags,
  type RuntimeTaskEventLogDiagnostic,
  type RuntimeTaskEventLogRecord,
} from "../../runtime-core/event-log.js";
import {
  createRuntimeTaskEventLogSqliteStorage,
  type RuntimeTaskEventLogPersistenceOpenDatabase,
} from "../../runtime-core/event-log-persistence.js";
import {
  runRuntimeResumeShadow,
  type RuntimeResumeShadowDiagnostic,
  type RuntimeResumeShadowLegacyState,
  type RuntimeResumeShadowResult,
} from "../../runtime-core/resume-shadow.js";
import {
  buildRuntimeCoreCheckpointFromResumeCheckpoint,
  getLatestLongTaskCheckpoint,
  type LongTaskCheckpointRecord,
} from "./store.js";

export const PERSISTED_RUNTIME_RESUME_SHADOW_SCHEMA_VERSION = 1 as const;
export const PERSISTED_RUNTIME_RESUME_SHADOW_SCHEMA_MARKER =
  "runtime.persisted-resume-shadow.v1" as const;

export type PersistedRuntimeResumeShadowDiagnostic = {
  source: "event_log_store" | "resume_shadow";
  code: string;
  message: string;
  recoverable: true;
  taskId?: string;
  eventId?: string;
  idempotencyKey?: string;
  field?: string;
};

export type PersistedRuntimeResumeShadowMatchStatus =
  | "disabled"
  | "matched"
  | "mismatch"
  | "waiting_verification"
  | "legacy_missing"
  | "event_log_unreadable";

export type PersistedRuntimeResumeShadowRecommendation =
  | "use_legacy_checkpoint"
  | "inspect_event_log"
  | "wait_for_tool_verification";

export type PersistedRuntimeResumeShadowEventLogReadStatus =
  | "clean"
  | "partial"
  | "unreadable";

export type PersistedRuntimeResumeShadowSummary = {
  matchStatus: PersistedRuntimeResumeShadowMatchStatus;
  legacyAuthoritative: true;
  eventCount: number;
  eventLogReadStatus: PersistedRuntimeResumeShadowEventLogReadStatus;
  replayableEventCount: number;
  corruptRowCount: number;
  eventLogStoreFailureCount: number;
  latestEventKind?: string;
  latestEventTimestamp?: number;
  latestCheckpointId?: string;
  mismatchFields: string[];
  blockingDiagnosticCodes: string[];
  recommendation: PersistedRuntimeResumeShadowRecommendation;
};

export type PersistedRuntimeResumeShadowReport = {
  schemaVersion: typeof PERSISTED_RUNTIME_RESUME_SHADOW_SCHEMA_VERSION;
  schemaMarker: typeof PERSISTED_RUNTIME_RESUME_SHADOW_SCHEMA_MARKER;
  enabled: boolean;
  taskId: string;
  sessionKey?: string;
  eventCount: number;
  latestCheckpointId?: string;
  summary: PersistedRuntimeResumeShadowSummary;
  resumeShadowResult: RuntimeResumeShadowResult;
  legacyAuthoritative: true;
  diagnostics: PersistedRuntimeResumeShadowDiagnostic[];
};

export type PersistedRuntimeResumeShadowOptions = {
  config?: unknown;
  taskId: string;
  sessionKey?: string;
  database?: OpenClawStateDatabaseOptions;
  openDatabase?: RuntimeTaskEventLogPersistenceOpenDatabase;
  latestCheckpointReader?: (sessionKey: string) => LongTaskCheckpointRecord | undefined;
};

export function runPersistedRuntimeResumeShadow(
  options: PersistedRuntimeResumeShadowOptions,
): PersistedRuntimeResumeShadowReport {
  const flags = resolveRuntimeEventLogFeatureFlags(options.config);
  if (!flags.resumeReplayShadow) {
    return report({
      options,
      eventCount: 0,
      resumeShadowResult: runRuntimeResumeShadow({
        config: options.config,
        taskId: options.taskId,
      }),
      diagnostics: [],
    });
  }

  const store = new RuntimeTaskEventLogStore(createRuntimeTaskEventLogSqliteStorage({
    ...(options.database ? { database: options.database } : {}),
    ...(options.openDatabase ? { openDatabase: options.openDatabase } : {}),
    scope: { taskId: options.taskId },
  }));
  const exported = store.exportRecords({ taskId: options.taskId });
  const latestCheckpoint = options.sessionKey
    ? (options.latestCheckpointReader ?? getLatestLongTaskCheckpoint)(options.sessionKey)
    : undefined;
  const legacyState = latestCheckpoint
    ? legacyStateFromCheckpoint(options.taskId, latestCheckpoint)
    : undefined;
  const resumeShadowResult = runRuntimeResumeShadow({
    config: options.config,
    taskId: options.taskId,
    eventLogRecords: exported.records,
    ...(legacyState ? { legacyState } : {}),
  });

  return report({
    options,
    eventCount: exported.total,
    latestEvent: latestEventRecord(exported.records),
    latestCheckpointId: latestCheckpoint?.id,
    resumeShadowResult,
    diagnostics: [
      ...exported.diagnostics.map(eventLogDiagnostic),
      ...resumeShadowResult.diagnostics.map(resumeShadowDiagnostic),
    ],
  });
}

function legacyStateFromCheckpoint(
  taskId: string,
  record: LongTaskCheckpointRecord,
): RuntimeResumeShadowLegacyState {
  const status = runtimeStatusFromLegacy(record.status);
  const checkpoint = buildRuntimeCoreCheckpointFromResumeCheckpoint({
    checkpointId: record.id,
    taskId,
    state: status,
    checkpoint: record.checkpoint,
    contextSummary: record.checkpoint.nextAction ?? record.checkpoint.activeTask,
  });
  return {
    taskId,
    status,
    checkpoint,
    metadata: {
      source: "long_task_checkpoints",
      checkpointId: record.id,
      sessionKey: record.sessionKey,
      ...(record.runId ? { runId: record.runId } : {}),
    },
  };
}

function runtimeStatusFromLegacy(status: string): RuntimeTaskStatus {
  const normalized = status.toLowerCase();
  if (isRuntimeTaskStatus(normalized)) {
    return normalized;
  }
  return LEGACY_RUNTIME_TASK_STATUS_MAP[
    normalized as keyof typeof LEGACY_RUNTIME_TASK_STATUS_MAP
  ] ?? "running";
}

function report(input: {
  options: PersistedRuntimeResumeShadowOptions;
  eventCount: number;
  latestEvent?: RuntimeTaskEventLogRecord;
  latestCheckpointId?: string;
  resumeShadowResult: RuntimeResumeShadowResult;
  diagnostics: PersistedRuntimeResumeShadowDiagnostic[];
}): PersistedRuntimeResumeShadowReport {
  return {
    schemaVersion: PERSISTED_RUNTIME_RESUME_SHADOW_SCHEMA_VERSION,
    schemaMarker: PERSISTED_RUNTIME_RESUME_SHADOW_SCHEMA_MARKER,
    enabled: input.resumeShadowResult.enabled,
    taskId: input.options.taskId,
    ...(input.options.sessionKey ? { sessionKey: input.options.sessionKey } : {}),
    eventCount: input.eventCount,
    ...(input.latestCheckpointId ? { latestCheckpointId: input.latestCheckpointId } : {}),
    summary: summary(input),
    resumeShadowResult: input.resumeShadowResult,
    legacyAuthoritative: true,
    diagnostics: input.diagnostics,
  };
}

function latestEventRecord(
  records: RuntimeTaskEventLogRecord[],
): RuntimeTaskEventLogRecord | undefined {
  return records.at(-1);
}

function summary(input: {
  eventCount: number;
  latestEvent?: RuntimeTaskEventLogRecord;
  latestCheckpointId?: string;
  resumeShadowResult: RuntimeResumeShadowResult;
  diagnostics: PersistedRuntimeResumeShadowDiagnostic[];
}): PersistedRuntimeResumeShadowSummary {
  const readStats = eventLogReadStats(input.eventCount, input.diagnostics);
  const matchStatus = matchStatusFor(input.resumeShadowResult, input.diagnostics, readStats);
  return {
    matchStatus,
    legacyAuthoritative: true,
    eventCount: input.eventCount,
    eventLogReadStatus: readStats.eventLogReadStatus,
    replayableEventCount: readStats.replayableEventCount,
    corruptRowCount: readStats.corruptRowCount,
    eventLogStoreFailureCount: readStats.eventLogStoreFailureCount,
    ...(input.latestEvent
      ? {
          latestEventKind: input.latestEvent.event.kind,
          latestEventTimestamp: input.latestEvent.event.timestamp,
        }
      : {}),
    ...(input.latestCheckpointId ? { latestCheckpointId: input.latestCheckpointId } : {}),
    mismatchFields: input.resumeShadowResult.comparison?.mismatchedFields ?? [],
    blockingDiagnosticCodes: blockingDiagnosticCodes(input.diagnostics),
    recommendation: recommendationFor(matchStatus, readStats.eventLogReadStatus),
  };
}

function matchStatusFor(
  result: RuntimeResumeShadowResult,
  diagnostics: PersistedRuntimeResumeShadowDiagnostic[],
  readStats: PersistedRuntimeResumeShadowReadStats,
): PersistedRuntimeResumeShadowMatchStatus {
  if (!result.enabled) {
    return "disabled";
  }
  if (readStats.eventLogReadStatus === "unreadable") {
    return "event_log_unreadable";
  }
  if (result.status === "waiting_verification") {
    return "waiting_verification";
  }
  if (hasDiagnostic(diagnostics, "resume_shadow", "legacy_state_missing")) {
    return "legacy_missing";
  }
  if (result.comparison?.matches === true) {
    return "matched";
  }
  return "mismatch";
}

function recommendationFor(
  matchStatus: PersistedRuntimeResumeShadowMatchStatus,
  readStatus: PersistedRuntimeResumeShadowEventLogReadStatus,
): PersistedRuntimeResumeShadowRecommendation {
  if (matchStatus === "waiting_verification") {
    return "wait_for_tool_verification";
  }
  if (readStatus === "partial" || readStatus === "unreadable") {
    return "inspect_event_log";
  }
  if (matchStatus === "matched" || matchStatus === "disabled") {
    return "use_legacy_checkpoint";
  }
  return "inspect_event_log";
}

function blockingDiagnosticCodes(
  diagnostics: PersistedRuntimeResumeShadowDiagnostic[],
): string[] {
  const blockingCodes = new Set([
    "store_read_failure",
    "legacy_state_missing",
    "state_mismatch",
    "missing_mutating_tool_result",
    "ambiguous_mutating_tool_result",
  ]);
  return [...new Set(
    diagnostics
      .filter((diagnostic) => blockingCodes.has(diagnostic.code))
      .map((diagnostic) => diagnostic.code),
  )];
}

type PersistedRuntimeResumeShadowReadStats = {
  eventLogReadStatus: PersistedRuntimeResumeShadowEventLogReadStatus;
  replayableEventCount: number;
  corruptRowCount: number;
  eventLogStoreFailureCount: number;
};

function eventLogReadStats(
  eventCount: number,
  diagnostics: PersistedRuntimeResumeShadowDiagnostic[],
): PersistedRuntimeResumeShadowReadStats {
  const storeReadFailures = diagnostics.filter((diagnostic) =>
    diagnostic.source === "event_log_store" && diagnostic.code === "store_read_failure"
  );
  const corruptRowCount = storeReadFailures.filter((diagnostic) =>
    typeof diagnostic.eventId === "string" && diagnostic.eventId.length > 0
  ).length;
  const storeLevelFailureCount = storeReadFailures.length - corruptRowCount;
  const eventLogReadStatus: PersistedRuntimeResumeShadowEventLogReadStatus =
    storeLevelFailureCount > 0 || (eventCount === 0 && corruptRowCount > 0)
      ? "unreadable"
      : corruptRowCount > 0
        ? "partial"
        : "clean";
  return {
    eventLogReadStatus,
    replayableEventCount: eventCount,
    corruptRowCount,
    eventLogStoreFailureCount: storeReadFailures.length,
  };
}

function hasDiagnostic(
  diagnostics: PersistedRuntimeResumeShadowDiagnostic[],
  source: PersistedRuntimeResumeShadowDiagnostic["source"],
  code: string,
): boolean {
  return diagnostics.some((diagnostic) =>
    diagnostic.source === source && diagnostic.code === code
  );
}

function eventLogDiagnostic(
  diagnostic: RuntimeTaskEventLogDiagnostic,
): PersistedRuntimeResumeShadowDiagnostic {
  return {
    source: "event_log_store",
    code: diagnostic.code,
    message: diagnostic.message,
    recoverable: true,
    ...(diagnostic.eventId ? { eventId: diagnostic.eventId } : {}),
    ...(diagnostic.idempotencyKey ? { idempotencyKey: diagnostic.idempotencyKey } : {}),
  };
}

function resumeShadowDiagnostic(
  diagnostic: RuntimeResumeShadowDiagnostic,
): PersistedRuntimeResumeShadowDiagnostic {
  return {
    source: "resume_shadow",
    code: diagnostic.code,
    message: diagnostic.message,
    recoverable: true,
    ...(diagnostic.taskId ? { taskId: diagnostic.taskId } : {}),
    ...(diagnostic.idempotencyKey ? { idempotencyKey: diagnostic.idempotencyKey } : {}),
    ...(diagnostic.field ? { field: diagnostic.field } : {}),
  };
}
