import type { Checkpoint, EvidenceRef } from "./evidence.js";
import { resolveRuntimeEventLogFeatureFlags } from "./event-log.js";
import {
  replayRuntimeTaskEventLogRecords,
  type RuntimeTaskReplayDiagnostic,
  type RuntimeTaskReplayResult,
  type RuntimeTaskReplayState,
} from "./state-reducer.js";
import {
  isRecord,
  type RuntimeCoreJsonObject,
  type RuntimeTaskStatus,
  type ToolCallRequest,
  type ToolCallResult,
} from "./types.js";

export const RUNTIME_RESUME_SHADOW_SCHEMA_VERSION = 1 as const;
export const RUNTIME_RESUME_SHADOW_SCHEMA_MARKER = "runtime.resume-shadow.v1" as const;

export const RUNTIME_RESUME_SHADOW_DIAGNOSTIC_CODES = [
  "event_log_read_failure",
  "legacy_state_read_failure",
  "replay_diagnostic",
  "legacy_state_missing",
  "state_mismatch",
  "completed_tool_result_reused",
  "missing_mutating_tool_result",
  "ambiguous_mutating_tool_result",
] as const;

export type RuntimeResumeShadowDiagnosticCode =
  (typeof RUNTIME_RESUME_SHADOW_DIAGNOSTIC_CODES)[number];

export type RuntimeResumeShadowDiagnostic = {
  code: RuntimeResumeShadowDiagnosticCode;
  message: string;
  recoverable: true;
  taskId?: string;
  field?: string;
  expected?: string;
  actual?: string;
  callId?: string;
  toolName?: string;
  idempotencyKey?: string;
  evidenceRefs?: EvidenceRef[];
};

export type RuntimeResumeShadowLegacyState = {
  taskId: string;
  status: RuntimeTaskStatus;
  checkpoint?: Checkpoint;
  session?: RuntimeResumeShadowLegacySessionState;
  openObligations?: string[];
  toolResults?: ToolCallResult[];
  fileHashes?: Record<string, string>;
  evidenceRefs?: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeResumeShadowLegacySessionState = {
  sessionId?: string;
  status?: RuntimeTaskStatus;
  summary?: string;
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeResumeShadowToolReuse = {
  callId: string;
  toolName: string;
  idempotencyKey: string;
  status: "reused_completed" | "waiting_verification" | "ambiguous";
  evidenceRefs: EvidenceRef[];
  result?: ToolCallResult;
};

export type RuntimeResumeShadowComparison = {
  matches: boolean;
  fieldsCompared: string[];
  mismatchedFields: string[];
};

export type RuntimeResumeShadowStatus = "disabled" | "compared" | "waiting_verification";

export type RuntimeResumeShadowResult = {
  schemaVersion: typeof RUNTIME_RESUME_SHADOW_SCHEMA_VERSION;
  schemaMarker: typeof RUNTIME_RESUME_SHADOW_SCHEMA_MARKER;
  enabled: boolean;
  status: RuntimeResumeShadowStatus;
  legacyAuthoritative: true;
  replay?: RuntimeTaskReplayResult;
  legacyState?: RuntimeResumeShadowLegacyState;
  comparison?: RuntimeResumeShadowComparison;
  toolReuses: RuntimeResumeShadowToolReuse[];
  diagnostics: RuntimeResumeShadowDiagnostic[];
};

export type RuntimeResumeShadowInput = {
  config?: unknown;
  taskId?: string;
  eventLogRecords?: readonly unknown[];
  eventLogReader?: () => readonly unknown[];
  legacyState?: RuntimeResumeShadowLegacyState;
  legacyStateReader?: () => RuntimeResumeShadowLegacyState | undefined;
};

export function runRuntimeResumeShadow(
  input: RuntimeResumeShadowInput,
): RuntimeResumeShadowResult {
  if (!resolveRuntimeEventLogFeatureFlags(input.config).resumeReplayShadow) {
    return disabledResumeShadowResult();
  }

  const eventLogRead = readEventLogRecords(input);
  const legacyRead = readLegacyState(input);
  const replay = replayRuntimeTaskEventLogRecords(eventLogRead.records, {
    taskId: input.taskId ?? legacyRead.legacyState?.taskId,
  });
  const diagnostics = [
    ...eventLogRead.diagnostics,
    ...legacyRead.diagnostics,
    ...replay.diagnostics.map(replayDiagnostic),
  ];
  const toolAudit = auditIdempotentToolResults(replay.state);
  diagnostics.push(...toolAudit.diagnostics);

  const comparison = legacyRead.legacyState
    ? compareReplayWithLegacyState(replay.state, legacyRead.legacyState)
    : undefined;
  if (comparison) {
    diagnostics.push(...comparison.diagnostics);
  } else {
    diagnostics.push(diagnostic({
      code: "legacy_state_missing",
      message: "Resume shadow could not compare replay state because legacy state was not available.",
      taskId: input.taskId ?? replay.state.taskId,
    }));
  }

  return {
    schemaVersion: RUNTIME_RESUME_SHADOW_SCHEMA_VERSION,
    schemaMarker: RUNTIME_RESUME_SHADOW_SCHEMA_MARKER,
    enabled: true,
    status: toolAudit.waitingVerification ? "waiting_verification" : "compared",
    legacyAuthoritative: true,
    replay,
    ...(legacyRead.legacyState ? { legacyState: stableClone(legacyRead.legacyState) } : {}),
    ...(comparison ? { comparison: comparison.comparison } : {}),
    toolReuses: toolAudit.toolReuses,
    diagnostics,
  };
}

function disabledResumeShadowResult(): RuntimeResumeShadowResult {
  return {
    schemaVersion: RUNTIME_RESUME_SHADOW_SCHEMA_VERSION,
    schemaMarker: RUNTIME_RESUME_SHADOW_SCHEMA_MARKER,
    enabled: false,
    status: "disabled",
    legacyAuthoritative: true,
    toolReuses: [],
    diagnostics: [],
  };
}

function readEventLogRecords(input: RuntimeResumeShadowInput): {
  records: readonly unknown[];
  diagnostics: RuntimeResumeShadowDiagnostic[];
} {
  if (input.eventLogRecords) {
    return { records: input.eventLogRecords, diagnostics: [] };
  }
  if (!input.eventLogReader) {
    return { records: [], diagnostics: [] };
  }
  try {
    return { records: input.eventLogReader(), diagnostics: [] };
  } catch (error) {
    return {
      records: [],
      diagnostics: [diagnostic({
        code: "event_log_read_failure",
        message: `Resume shadow event-log read failed: ${errorMessage(error)}`,
        taskId: input.taskId,
      })],
    };
  }
}

function readLegacyState(input: RuntimeResumeShadowInput): {
  legacyState?: RuntimeResumeShadowLegacyState;
  diagnostics: RuntimeResumeShadowDiagnostic[];
} {
  if (input.legacyState) {
    return { legacyState: stableClone(input.legacyState), diagnostics: [] };
  }
  if (!input.legacyStateReader) {
    return { diagnostics: [] };
  }
  try {
    const legacyState = input.legacyStateReader();
    return legacyState ? { legacyState: stableClone(legacyState), diagnostics: [] } : { diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [diagnostic({
        code: "legacy_state_read_failure",
        message: `Resume shadow legacy state read failed: ${errorMessage(error)}`,
        taskId: input.taskId,
      })],
    };
  }
}

function replayDiagnostic(
  replay: RuntimeTaskReplayDiagnostic,
): RuntimeResumeShadowDiagnostic {
  return diagnostic({
    code: "replay_diagnostic",
    message: replay.message,
    taskId: replay.taskId,
    field: replay.code,
    expected: replay.expected ?? replay.expectedSchemaMarker,
    actual: replay.actual ?? replay.actualSchemaMarker,
  });
}

function auditIdempotentToolResults(state: RuntimeTaskReplayState): {
  toolReuses: RuntimeResumeShadowToolReuse[];
  diagnostics: RuntimeResumeShadowDiagnostic[];
  waitingVerification: boolean;
} {
  const toolReuses: RuntimeResumeShadowToolReuse[] = [];
  const diagnostics: RuntimeResumeShadowDiagnostic[] = [];
  const resultsByCallId = new Map(state.toolResults.map((result) => [result.callId, result]));
  for (const request of state.toolRequests.filter((item) =>
    isMutatingToolRequest(item) && !item.idempotencyKey
  )) {
    const result = resultsByCallId.get(request.callId);
    toolReuses.push({
      callId: request.callId,
      toolName: request.toolName,
      idempotencyKey: "",
      status: "ambiguous",
      evidenceRefs: result?.evidence.map(stableClone) ?? [],
      ...(result ? { result: stableClone(result) } : {}),
    });
    diagnostics.push(diagnostic({
      code: "ambiguous_mutating_tool_result",
      message: "Resume shadow found a mutating tool request without an idempotency key.",
      taskId: state.taskId,
      callId: request.callId,
      toolName: request.toolName,
      evidenceRefs: result?.evidence.map(stableClone) ?? [],
    }));
  }
  const requestsByIdempotencyKey = groupRequestsByIdempotencyKey(state.toolRequests);

  for (const [idempotencyKey, requests] of requestsByIdempotencyKey) {
    const mutatingRequests = requests.filter(isMutatingToolRequest);
    if (mutatingRequests.length === 0) {
      continue;
    }

    const completedResults = mutatingRequests
      .map((request) => ({ request, result: resultsByCallId.get(request.callId) }))
      .filter((entry): entry is { request: ToolCallRequest; result: ToolCallResult } =>
        entry.result?.status === "success"
      );

    if (mutatingRequests.length > 1 || completedResults.length > 1) {
      const request = mutatingRequests[0]!;
      toolReuses.push({
        callId: request.callId,
        toolName: request.toolName,
        idempotencyKey,
        status: "ambiguous",
        evidenceRefs: completedResults.flatMap((entry) => entry.result.evidence),
      });
      diagnostics.push(diagnostic({
        code: "ambiguous_mutating_tool_result",
        message: "Resume shadow found ambiguous mutating tool history for one idempotency key.",
        taskId: state.taskId,
        callId: request.callId,
        toolName: request.toolName,
        idempotencyKey,
        evidenceRefs: completedResults.flatMap((entry) => entry.result.evidence),
      }));
      continue;
    }

    const request = mutatingRequests[0]!;
    const result = completedResults[0]?.result;
    if (!result) {
      toolReuses.push({
        callId: request.callId,
        toolName: request.toolName,
        idempotencyKey,
        status: "waiting_verification",
        evidenceRefs: [],
      });
      diagnostics.push(diagnostic({
        code: "missing_mutating_tool_result",
        message:
          "Resume shadow found a mutating tool request without a completed result; legacy resume must wait or verify instead of completing.",
        taskId: state.taskId,
        callId: request.callId,
        toolName: request.toolName,
        idempotencyKey,
      }));
      continue;
    }

    toolReuses.push({
      callId: request.callId,
      toolName: request.toolName,
      idempotencyKey,
      status: "reused_completed",
      evidenceRefs: result.evidence.map(stableClone),
      result: stableClone(result),
    });
    diagnostics.push(diagnostic({
      code: "completed_tool_result_reused",
      message:
        "Resume shadow reused completed mutating tool result metadata by idempotency key without execution.",
      taskId: state.taskId,
      callId: request.callId,
      toolName: request.toolName,
      idempotencyKey,
      evidenceRefs: result.evidence.map(stableClone),
    }));
  }

  return {
    toolReuses,
    diagnostics,
    waitingVerification: toolReuses.some((reuse) => reuse.status !== "reused_completed"),
  };
}

function groupRequestsByIdempotencyKey(
  requests: readonly ToolCallRequest[],
): Map<string, ToolCallRequest[]> {
  const grouped = new Map<string, ToolCallRequest[]>();
  for (const request of requests) {
    if (!request.idempotencyKey) {
      continue;
    }
    const existing = grouped.get(request.idempotencyKey) ?? [];
    existing.push(request);
    grouped.set(request.idempotencyKey, existing);
  }
  return grouped;
}

export function isMutatingToolRequest(request: ToolCallRequest): boolean {
  const permissionContext = request.permissionContext;
  if (isRecord(permissionContext)) {
    const effect = stringValue(permissionContext.effect) ?? stringValue(permissionContext.mode);
    if (effect) {
      return !["read", "readonly", "read_only", "inspect", "query"].includes(effect);
    }
  }
  return [
    "apply_patch",
    "file_write",
    "send_message",
    "gateway_transport",
    "main_transport",
    "mutating_shell",
    "side_effect_tool",
  ].includes(request.toolName);
}

function compareReplayWithLegacyState(
  replayState: RuntimeTaskReplayState,
  legacyState: RuntimeResumeShadowLegacyState,
): {
  comparison: RuntimeResumeShadowComparison;
  diagnostics: RuntimeResumeShadowDiagnostic[];
} {
  const fieldPairs = {
    taskId: [replayState.taskId, legacyState.taskId],
    status: [replayState.status, legacyStatus(legacyState)],
    openObligations: [
      stableStringify(replayState.openObligations),
      stableStringify(legacyOpenObligations(legacyState)),
    ],
    toolResultRefs: [
      stableStringify(replayState.toolResultRefs),
      stableStringify(legacyToolResultRefs(legacyState)),
    ],
    fileHashes: [
      stableStringify(replayState.fileHashes),
      stableStringify(legacyState.checkpoint?.fileHashes ?? legacyState.fileHashes ?? {}),
    ],
  } as const;
  const diagnostics: RuntimeResumeShadowDiagnostic[] = [];
  const mismatchedFields = Object.entries(fieldPairs).flatMap(([field, [actual, expected]]) => {
    if (actual === expected) {
      return [];
    }
    diagnostics.push(diagnostic({
      code: "state_mismatch",
      message: `Resume shadow replay state does not match legacy ${field}.`,
      taskId: legacyState.taskId,
      field,
      expected,
      actual,
    }));
    return [field];
  });

  return {
    comparison: {
      matches: mismatchedFields.length === 0,
      fieldsCompared: Object.keys(fieldPairs),
      mismatchedFields,
    },
    diagnostics,
  };
}

function legacyStatus(legacyState: RuntimeResumeShadowLegacyState): RuntimeTaskStatus {
  return legacyState.checkpoint?.state ?? legacyState.session?.status ?? legacyState.status;
}

function legacyOpenObligations(legacyState: RuntimeResumeShadowLegacyState): string[] {
  return legacyState.checkpoint?.openObligations ?? legacyState.openObligations ?? [];
}

function legacyToolResultRefs(legacyState: RuntimeResumeShadowLegacyState): string[] {
  return (
    legacyState.checkpoint?.toolResults ?? legacyState.toolResults ?? []
  ).map((result) => result.callId);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

function diagnostic(
  value: Omit<RuntimeResumeShadowDiagnostic, "recoverable">,
): RuntimeResumeShadowDiagnostic {
  return { ...value, recoverable: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stableClone<T>(value: T): T {
  return JSON.parse(stableStringify(value)) as T;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}
