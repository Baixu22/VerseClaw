import {
  RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER,
  RUNTIME_TASK_EVENT_LOG_SCHEMA_VERSION,
} from "./event-log.js";
import {
  isCheckpoint,
  isEvidenceRef,
  type Checkpoint,
  type EvidenceRef,
} from "./evidence.js";
import {
  isRuntimeTaskEvent,
  type RuntimeTaskEvent,
} from "./events.js";
import {
  isNonEmptyString,
  isRecord,
  isRuntimeCoreJsonObject,
  isRuntimeTaskStatus,
  type ContextItem,
  type RuntimeCoreJsonObject,
  type RuntimeError,
  type RuntimeTaskEventKind,
  type RuntimeTaskStatus,
  type ToolCallRequest,
  type ToolCallResult,
} from "./types.js";
import {
  isRuntimeTaskContinueAsNewShadow,
  type RuntimeTaskContinueAsNewShadow,
} from "./checkpoint-serializer.js";

export const RUNTIME_TASK_REPLAY_SCHEMA_VERSION = 1 as const;
export const RUNTIME_TASK_REPLAY_SCHEMA_MARKER =
  "runtime.task-state-reducer.v1" as const;

export const RUNTIME_TASK_EVENT_SCHEMA_MARKER = "runtime.task-event.v1" as const;

export const RUNTIME_TASK_REPLAY_DIAGNOSTIC_CODES = [
  "invalid_event",
  "invalid_event_order",
  "duplicate_event_id",
  "missing_checkpoint_payload",
  "schema_marker_mismatch",
  "terminal_event_continuation",
] as const;

export type RuntimeTaskReplayDiagnosticCode =
  (typeof RUNTIME_TASK_REPLAY_DIAGNOSTIC_CODES)[number];

export type RuntimeTaskReplayDiagnostic = {
  code: RuntimeTaskReplayDiagnosticCode;
  message: string;
  recoverable: true;
  eventId?: string;
  taskId?: string;
  index?: number;
  expected?: string;
  actual?: string;
  expectedSchemaMarker?: string;
  actualSchemaMarker?: string;
};

export type RuntimeTaskReplayStateName = RuntimeTaskStatus | "checkpoint";

export type RuntimeTaskReplayState = {
  schemaVersion: typeof RUNTIME_TASK_REPLAY_SCHEMA_VERSION;
  schemaMarker: typeof RUNTIME_TASK_REPLAY_SCHEMA_MARKER;
  taskId?: string;
  state: RuntimeTaskReplayStateName;
  status: RuntimeTaskStatus;
  createdAt?: number;
  updatedAt?: number;
  lastEventId?: string;
  lastEventKind?: RuntimeTaskEventKind;
  eventCount: number;
  eventIds: string[];
  duplicateEventIds: string[];
  openObligations: string[];
  contextSummary: string;
  contextItems: ContextItem[];
  toolRequests: ToolCallRequest[];
  toolResults: ToolCallResult[];
  toolResultRefs: string[];
  pendingToolCallIds: string[];
  fileHashes: Record<string, string>;
  evidenceRefs: EvidenceRef[];
  latestCheckpoint?: Checkpoint;
  checkpoints: Checkpoint[];
  lastError?: RuntimeError;
  compaction?: RuntimeTaskContinueAsNewShadow;
  metadata: RuntimeCoreJsonObject;
};

export type RuntimeTaskReplayOptions = {
  taskId?: string;
  allowPartialHistory?: boolean;
};

export type RuntimeTaskReplayResult = {
  state: RuntimeTaskReplayState;
  diagnostics: RuntimeTaskReplayDiagnostic[];
};

type NormalizedReplayInput = {
  event?: RuntimeTaskEvent;
  metadata?: RuntimeCoreJsonObject;
  compaction?: RuntimeTaskContinueAsNewShadow;
  diagnostics: RuntimeTaskReplayDiagnostic[];
};

type MutableReplayState = RuntimeTaskReplayState & {
  terminalEventId?: string;
};

const TERMINAL_STATUSES = new Set<RuntimeTaskStatus>([
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);

const VALID_STATUS_TRANSITIONS: Record<RuntimeTaskStatus, RuntimeTaskStatus[]> = {
  created: [
    "planning",
    "assembling_context",
    "running",
    "waiting_external",
    "failed",
    "blocked",
    "cancelled",
  ],
  planning: [
    "assembling_context",
    "running",
    "waiting_permission",
    "waiting_external",
    "failed",
    "blocked",
    "cancelled",
  ],
  assembling_context: [
    "planning",
    "running",
    "waiting_permission",
    "waiting_tool",
    "waiting_external",
    "failed",
    "blocked",
    "cancelled",
  ],
  running: [
    "waiting_permission",
    "waiting_tool",
    "waiting_external",
    "applying_changes",
    "verifying",
    "completed",
    "failed",
    "blocked",
    "cancelled",
  ],
  waiting_permission: ["running", "failed", "blocked", "cancelled"],
  waiting_tool: ["running", "verifying", "failed", "blocked", "cancelled"],
  waiting_external: ["planning", "running", "failed", "blocked", "cancelled"],
  applying_changes: ["running", "verifying", "failed", "blocked", "cancelled"],
  verifying: [
    "running",
    "applying_changes",
    "completed",
    "failed",
    "blocked",
    "cancelled",
  ],
  completed: [],
  failed: [],
  blocked: [],
  cancelled: [],
};

export function replayRuntimeTaskEvents(
  inputs: readonly unknown[],
  options: RuntimeTaskReplayOptions = {},
): RuntimeTaskReplayResult {
  const state = createInitialReplayState(options.taskId);
  const diagnostics: RuntimeTaskReplayDiagnostic[] = [];
  const seenEventIds = new Set<string>();
  let previousTimestamp: number | undefined;

  inputs.forEach((input, index) => {
    const normalized = normalizeReplayInput(input, index);
    diagnostics.push(...normalized.diagnostics);
    if (!normalized.event) {
      return;
    }

    const event = normalized.event;
    if (seenEventIds.has(event.eventId)) {
      state.duplicateEventIds.push(event.eventId);
      diagnostics.push(
        diagnostic({
          code: "duplicate_event_id",
          message: `RuntimeTaskEvent id was replayed more than once: ${event.eventId}`,
          eventId: event.eventId,
          taskId: event.taskId,
          index,
        }),
      );
      return;
    }
    seenEventIds.add(event.eventId);

    const taskIdMismatch = detectTaskIdMismatch(state, event, options.taskId, index);
    if (taskIdMismatch) {
      diagnostics.push(taskIdMismatch);
      return;
    }

    if (previousTimestamp !== undefined && event.timestamp < previousTimestamp) {
      diagnostics.push(
        diagnostic({
          code: "invalid_event_order",
          message: "RuntimeTaskEvent timestamps must not move backward during replay.",
          eventId: event.eventId,
          taskId: event.taskId,
          index,
          expected: `timestamp >= ${previousTimestamp}`,
          actual: String(event.timestamp),
        }),
      );
    }
    previousTimestamp = event.timestamp;

    if (state.terminalEventId && !normalized.compaction) {
      diagnostics.push(
        diagnostic({
          code: "terminal_event_continuation",
          message:
            "Terminal RuntimeTaskEvent was followed by a non-compaction continuation.",
          eventId: event.eventId,
          taskId: event.taskId,
          index,
          expected: "continue-as-new or compaction marker",
          actual: event.kind,
        }),
      );
      return;
    }

    if (normalized.compaction) {
      state.compaction = stableClone(normalized.compaction);
    }

    diagnostics.push(...applyReplayEvent(state, event, normalized.metadata, index));
  });

  finalizeReplayState(state);
  const { terminalEventId: _terminalEventId, ...publicState } = state;
  return {
    state: publicState,
    diagnostics,
  };
}

export function replayRuntimeTaskEventLogRecords(
  records: readonly unknown[],
  options: RuntimeTaskReplayOptions = {},
): RuntimeTaskReplayResult {
  return replayRuntimeTaskEvents(records, options);
}

function createInitialReplayState(taskId?: string): MutableReplayState {
  return {
    schemaVersion: RUNTIME_TASK_REPLAY_SCHEMA_VERSION,
    schemaMarker: RUNTIME_TASK_REPLAY_SCHEMA_MARKER,
    ...(taskId ? { taskId } : {}),
    state: "created",
    status: "created",
    eventCount: 0,
    eventIds: [],
    duplicateEventIds: [],
    openObligations: [],
    contextSummary: "",
    contextItems: [],
    toolRequests: [],
    toolResults: [],
    toolResultRefs: [],
    pendingToolCallIds: [],
    fileHashes: {},
    evidenceRefs: [],
    checkpoints: [],
    metadata: {
      reducerSchemaMarker: RUNTIME_TASK_REPLAY_SCHEMA_MARKER,
      reducerSchemaVersion: RUNTIME_TASK_REPLAY_SCHEMA_VERSION,
    },
  };
}

function normalizeReplayInput(input: unknown, index: number): NormalizedReplayInput {
  const envelope = unwrapEventLogEnvelope(input, index);
  if ("diagnostic" in envelope) {
    return { diagnostics: [envelope.diagnostic] };
  }

  const eventCandidate = envelope.eventCandidate;
  const eventSchemaDiagnostic = runtimeTaskEventSchemaDiagnostic(eventCandidate, index);
  if (eventSchemaDiagnostic) {
    return { diagnostics: [eventSchemaDiagnostic] };
  }

  if (isRuntimeTaskEvent(eventCandidate)) {
    return {
      event: stableClone(eventCandidate),
      metadata: envelope.metadata,
      compaction: envelope.compaction ?? compactionFromEvent(eventCandidate),
      diagnostics: [],
    };
  }

  const checkpointDiagnostic = missingCheckpointDiagnostic(eventCandidate, index);
  if (checkpointDiagnostic) {
    return { diagnostics: [checkpointDiagnostic] };
  }

  return {
    diagnostics: [
      diagnostic({
        code: "invalid_event",
        message: "Value is not a valid canonical RuntimeTaskEvent.",
        eventId: eventIdFrom(eventCandidate),
        taskId: taskIdFrom(eventCandidate),
        index,
      }),
    ],
  };
}

function unwrapEventLogEnvelope(
  input: unknown,
  index: number,
):
  | {
      eventCandidate: unknown;
      metadata?: RuntimeCoreJsonObject;
      compaction?: RuntimeTaskContinueAsNewShadow;
    }
  | { diagnostic: RuntimeTaskReplayDiagnostic } {
  if (!isRecord(input) || !("event" in input)) {
    return { eventCandidate: input };
  }

  if (
    input.schemaVersion !== RUNTIME_TASK_EVENT_LOG_SCHEMA_VERSION ||
    input.schemaMarker !== RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER
  ) {
    return {
      diagnostic: diagnostic({
        code: "schema_marker_mismatch",
        message: "RuntimeTaskEvent log envelope schema marker/version mismatch.",
        eventId: eventIdFrom(input.event),
        taskId: taskIdFrom(input.event),
        index,
        expectedSchemaMarker: RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER,
        actualSchemaMarker: [
          String(input.schemaMarker ?? "missing"),
          String(input.schemaVersion ?? "missing"),
        ].join("@"),
      }),
    };
  }

  const metadata = isRuntimeCoreJsonObject(input.metadata)
    ? stableClone(input.metadata)
    : undefined;
  return {
    eventCandidate: input.event,
    metadata,
    compaction: compactionFromMetadata(metadata),
  };
}

function runtimeTaskEventSchemaDiagnostic(
  value: unknown,
  index: number,
): RuntimeTaskReplayDiagnostic | undefined {
  if (!isRecord(value) || value.schemaVersion === undefined) {
    return undefined;
  }
  if (value.schemaVersion === 1) {
    return undefined;
  }
  return diagnostic({
    code: "schema_marker_mismatch",
    message: "RuntimeTaskEvent schema version mismatch.",
    eventId: eventIdFrom(value),
    taskId: taskIdFrom(value),
    index,
    expectedSchemaMarker: RUNTIME_TASK_EVENT_SCHEMA_MARKER,
    actualSchemaMarker: `runtime.task-event.v${String(value.schemaVersion)}`,
  });
}

function missingCheckpointDiagnostic(
  value: unknown,
  index: number,
): RuntimeTaskReplayDiagnostic | undefined {
  if (!isRecord(value) || value.kind !== "checkpoint") {
    return undefined;
  }
  return diagnostic({
    code: "missing_checkpoint_payload",
    message: "RuntimeTaskEvent checkpoint event is missing a canonical checkpoint payload.",
    eventId: eventIdFrom(value),
    taskId: taskIdFrom(value),
    index,
  });
}

function detectTaskIdMismatch(
  state: MutableReplayState,
  event: RuntimeTaskEvent,
  expectedTaskId: string | undefined,
  index: number,
): RuntimeTaskReplayDiagnostic | undefined {
  const currentTaskId = expectedTaskId ?? state.taskId;
  if (!currentTaskId) {
    state.taskId = event.taskId;
    return undefined;
  }
  if (currentTaskId === event.taskId) {
    return undefined;
  }
  return diagnostic({
    code: "invalid_event_order",
    message: "RuntimeTaskEvent task id does not match the replayed task history.",
    eventId: event.eventId,
    taskId: event.taskId,
    index,
    expected: currentTaskId,
    actual: event.taskId,
  });
}

function applyReplayEvent(
  state: MutableReplayState,
  event: RuntimeTaskEvent,
  envelopeMetadata: RuntimeCoreJsonObject | undefined,
  index: number,
): RuntimeTaskReplayDiagnostic[] {
  const diagnostics: RuntimeTaskReplayDiagnostic[] = [];

  state.eventCount += 1;
  state.eventIds.push(event.eventId);
  state.lastEventId = event.eventId;
  state.lastEventKind = event.kind;
  state.updatedAt = event.timestamp;
  addEvidenceRefs(state, event.evidenceRefs);

  if (state.eventCount === 1 && event.kind !== "created") {
    diagnostics.push(
      diagnostic({
        code: "invalid_event_order",
        message: "RuntimeTaskEvent replay did not start with a created event.",
        eventId: event.eventId,
        taskId: event.taskId,
        index,
        expected: "created",
        actual: event.kind,
      }),
    );
  }

  applyReplayMetadata(state, envelopeMetadata);

  if (isRuntimeTaskStatus(event.kind)) {
    diagnostics.push(...applyStatus(state, event.kind, event, index));
    applyReplayMetadata(state, metadataFromPayload(event.payload));
    return diagnostics;
  }

  switch (event.kind) {
    case "progress":
      applyReplayMetadata(state, metadataFromPayload(event.payload));
      diagnostics.push(...applyMetadataStatus(state, event, index));
      break;
    case "context":
      state.contextItems.push(...event.payload.contextItems.map(stableClone));
      for (const item of event.payload.contextItems) {
        addEvidenceRefs(state, item.evidenceRefs);
      }
      break;
    case "tool_call_request":
      state.toolRequests.push(stableClone(event.payload));
      break;
    case "tool_call_result":
      addToolResult(state, event.payload);
      addEvidenceRefs(state, event.payload.evidence);
      if (event.payload.error) {
        state.lastError = stableClone(event.payload.error);
        addEvidenceRefs(state, event.payload.error.evidenceRefs);
      }
      break;
    case "evidence":
      addEvidenceRefs(state, event.payload.evidenceRefs);
      break;
    case "checkpoint":
      diagnostics.push(...applyCheckpoint(state, event, index));
      break;
    case "error":
      state.lastError = stableClone(event.payload.error);
      addEvidenceRefs(state, event.payload.error.evidenceRefs);
      break;
  }

  return diagnostics;
}

function applyStatus(
  state: MutableReplayState,
  status: RuntimeTaskStatus,
  event: RuntimeTaskEvent,
  index: number,
): RuntimeTaskReplayDiagnostic[] {
  const diagnostics: RuntimeTaskReplayDiagnostic[] = [];
  if (!isValidStatusTransition(state.status, status)) {
    diagnostics.push(
      diagnostic({
        code: "invalid_event_order",
        message: "RuntimeTaskEvent status transition is not valid for replay.",
        eventId: event.eventId,
        taskId: event.taskId,
        index,
        expected: `${state.status} -> one of ${
          VALID_STATUS_TRANSITIONS[state.status].join(", ") || "<terminal>"
        }`,
        actual: status,
      }),
    );
  }

  state.status = status;
  state.state = status;
  if (status === "created" && state.createdAt === undefined) {
    state.createdAt = event.timestamp;
  }
  if (TERMINAL_STATUSES.has(status)) {
    state.terminalEventId = event.eventId;
  }
  return diagnostics;
}

function applyMetadataStatus(
  state: MutableReplayState,
  event: RuntimeTaskEvent,
  index: number,
): RuntimeTaskReplayDiagnostic[] {
  const metadata = "metadata" in event.payload ? event.payload.metadata : undefined;
  const status = isRecord(metadata) && isRuntimeTaskStatus(metadata.status)
    ? metadata.status
    : undefined;
  return status ? applyStatus(state, status, event, index) : [];
}

function applyCheckpoint(
  state: MutableReplayState,
  event: RuntimeTaskEvent,
  index: number,
): RuntimeTaskReplayDiagnostic[] {
  if (event.kind !== "checkpoint" || !isCheckpoint(event.payload.checkpoint)) {
    return [
      diagnostic({
        code: "missing_checkpoint_payload",
        message:
          "RuntimeTaskEvent checkpoint event is missing a canonical checkpoint payload.",
        eventId: event.eventId,
        taskId: event.taskId,
        index,
      }),
    ];
  }

  const checkpoint = stableClone(event.payload.checkpoint);
  if (checkpoint.taskId !== event.taskId) {
    return [
      diagnostic({
        code: "invalid_event_order",
        message: "Checkpoint task id does not match its RuntimeTaskEvent task id.",
        eventId: event.eventId,
        taskId: event.taskId,
        index,
        expected: event.taskId,
        actual: checkpoint.taskId,
      }),
    ];
  }

  state.state = "checkpoint";
  state.status = checkpoint.state;
  state.latestCheckpoint = checkpoint;
  state.checkpoints.push(checkpoint);
  state.openObligations = [...checkpoint.openObligations];
  state.contextSummary = checkpoint.contextSummary;
  state.fileHashes = sortStringRecord(checkpoint.fileHashes);
  checkpoint.toolResults.forEach((result) => addToolResult(state, result));
  addEvidenceRefs(state, checkpoint.evidenceRefs);
  return [];
}

function applyReplayMetadata(
  state: MutableReplayState,
  metadata: RuntimeCoreJsonObject | undefined,
): void {
  if (!metadata) {
    return;
  }
  if (isStringArray(metadata.openObligations)) {
    state.openObligations = [...metadata.openObligations];
  }
  if (typeof metadata.contextSummary === "string") {
    state.contextSummary = metadata.contextSummary;
  }
  if (isStringRecord(metadata.fileHashes)) {
    state.fileHashes = sortStringRecord(metadata.fileHashes);
  }
  if (Array.isArray(metadata.evidenceRefs) && metadata.evidenceRefs.every(isEvidenceRef)) {
    addEvidenceRefs(state, metadata.evidenceRefs);
  }
}

function metadataFromPayload(payload: unknown): RuntimeCoreJsonObject | undefined {
  return isRecord(payload) && isRuntimeCoreJsonObject(payload.metadata)
    ? payload.metadata
    : undefined;
}

function isValidStatusTransition(
  previousStatus: RuntimeTaskStatus,
  nextStatus: RuntimeTaskStatus,
): boolean {
  return (
    previousStatus === nextStatus ||
    VALID_STATUS_TRANSITIONS[previousStatus].includes(nextStatus)
  );
}

function finalizeReplayState(state: MutableReplayState): void {
  const resultCallIds = new Set(state.toolResults.map((result) => result.callId));
  state.pendingToolCallIds = state.toolRequests
    .filter((request) => !resultCallIds.has(request.callId))
    .map((request) => request.callId);
  state.toolResultRefs = uniqueStrings([
    ...state.toolResultRefs,
    ...state.toolResults.map((result) => result.callId),
  ]);
  state.fileHashes = sortStringRecord(state.fileHashes);
}

function addToolResult(state: MutableReplayState, result: ToolCallResult): void {
  const existingIndex = state.toolResults.findIndex(
    (candidate) => candidate.callId === result.callId,
  );
  const cloned = stableClone(result);
  if (existingIndex >= 0) {
    state.toolResults[existingIndex] = cloned;
  } else {
    state.toolResults.push(cloned);
  }
  state.toolResultRefs = uniqueStrings([...state.toolResultRefs, result.callId]);
}

function addEvidenceRefs(
  state: MutableReplayState,
  refs: readonly EvidenceRef[],
): void {
  const seen = new Set(state.evidenceRefs.map(evidenceRefKey));
  for (const ref of refs) {
    const key = evidenceRefKey(ref);
    if (!seen.has(key)) {
      state.evidenceRefs.push(stableClone(ref));
      seen.add(key);
    }
  }
}

function compactionFromEvent(
  event: RuntimeTaskEvent,
): RuntimeTaskContinueAsNewShadow | undefined {
  const metadata = isRecord(event.payload) && "metadata" in event.payload
    ? event.payload.metadata
    : undefined;
  return isRuntimeCoreJsonObject(metadata)
    ? compactionFromMetadata(metadata)
    : undefined;
}

function compactionFromMetadata(
  metadata: RuntimeCoreJsonObject | undefined,
): RuntimeTaskContinueAsNewShadow | undefined {
  if (!metadata) {
    return undefined;
  }
  const marker = metadata.continueAsNew ?? metadata.compaction;
  return isRuntimeTaskContinueAsNewShadow(marker) ? stableClone(marker) : undefined;
}

function eventIdFrom(value: unknown): string | undefined {
  return isRecord(value) && isNonEmptyString(value.eventId) ? value.eventId : undefined;
}

function taskIdFrom(value: unknown): string | undefined {
  return isRecord(value) && isNonEmptyString(value.taskId) ? value.taskId : undefined;
}

function evidenceRefKey(ref: EvidenceRef): string {
  return [ref.type, ref.ref, ref.label ?? "", ref.summary ?? ""].join("\u0000");
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function sortStringRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function diagnostic(
  value: Omit<RuntimeTaskReplayDiagnostic, "recoverable">,
): RuntimeTaskReplayDiagnostic {
  return {
    ...value,
    recoverable: true,
  };
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
