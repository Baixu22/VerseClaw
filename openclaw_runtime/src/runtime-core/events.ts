import {
  buildContextItemFixture,
  buildRuntimeErrorFixture,
  buildToolCallRequestFixture,
  buildToolCallResultFixture,
  isContextItem,
  isFiniteNumber,
  isNonEmptyString,
  isRecord,
  isRuntimeCoreJsonObject,
  isRuntimeError,
  isRuntimeTaskEventKind,
  isRuntimeTaskStatus,
  isRuntimeTraceContext,
  isToolCallRequest,
  isToolCallResult,
  type ContextItem,
  type RuntimeCoreJsonObject,
  type RuntimeError,
  type RuntimeTaskEventKind,
  type RuntimeTaskStatus,
  type RuntimeTraceContext,
  type ToolCallRequest,
  type ToolCallResult,
} from "./types.js";
import {
  buildCheckpointFixture,
  buildEvidenceRefFixture,
  isCheckpoint,
  isEvidenceRef,
  type Checkpoint,
  type EvidenceRef,
} from "./evidence.js";

export type RuntimeTaskStatusEventPayload = {
  status: RuntimeTaskStatus;
  message?: string;
  summary?: string;
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeTaskProgressEventPayload = {
  progress?: number;
  message?: string;
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeTaskContextEventPayload = {
  contextItems: ContextItem[];
};

export type RuntimeTaskEvidenceEventPayload = {
  evidenceRefs: EvidenceRef[];
};

export type RuntimeTaskCheckpointEventPayload = {
  checkpoint: Checkpoint;
};

export type RuntimeTaskErrorEventPayload = {
  error: RuntimeError;
};

export type RuntimeTaskEventPayloadByKind = {
  [Status in RuntimeTaskStatus]: RuntimeTaskStatusEventPayload & { status: Status };
} & {
  progress: RuntimeTaskProgressEventPayload;
  context: RuntimeTaskContextEventPayload;
  tool_call_request: ToolCallRequest;
  tool_call_result: ToolCallResult;
  evidence: RuntimeTaskEvidenceEventPayload;
  checkpoint: RuntimeTaskCheckpointEventPayload;
  error: RuntimeTaskErrorEventPayload;
};

export type RuntimeTaskEventBase<Kind extends RuntimeTaskEventKind = RuntimeTaskEventKind> = {
  schemaVersion: 1;
  eventId: string;
  taskId: string;
  kind: Kind;
  timestamp: number;
  payload: RuntimeTaskEventPayloadByKind[Kind];
  traceContext?: RuntimeTraceContext;
  evidenceRefs: EvidenceRef[];
};

export type RuntimeTaskEvent = {
  [Kind in RuntimeTaskEventKind]: RuntimeTaskEventBase<Kind>;
}[RuntimeTaskEventKind];

export type RuntimeTaskEventFixtureOverrides = Partial<
  Omit<RuntimeTaskEventBase, "kind" | "payload">
> & {
  kind?: RuntimeTaskEventKind;
  payload?: RuntimeTaskEventPayloadByKind[RuntimeTaskEventKind];
};

function hasRuntimeTaskEventBase(value: unknown): value is RuntimeTaskEventBase {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    isNonEmptyString(value.eventId) &&
    isNonEmptyString(value.taskId) &&
    isRuntimeTaskEventKind(value.kind) &&
    isFiniteNumber(value.timestamp) &&
    isRecord(value.payload) &&
    (value.traceContext === undefined || isRuntimeTraceContext(value.traceContext)) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef)
  );
}

function isProgressValue(value: unknown): boolean {
  return value === undefined || (isFiniteNumber(value) && value >= 0 && value <= 100);
}

function isStatusEventPayload(
  value: unknown,
  status: RuntimeTaskStatus,
): value is RuntimeTaskStatusEventPayload {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.status === status &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.summary === undefined || typeof value.summary === "string") &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

function isProgressEventPayload(value: unknown): value is RuntimeTaskProgressEventPayload {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isProgressValue(value.progress) &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

function isContextEventPayload(value: unknown): value is RuntimeTaskContextEventPayload {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.contextItems) && value.contextItems.every(isContextItem);
}

function isEvidenceEventPayload(value: unknown): value is RuntimeTaskEvidenceEventPayload {
  if (!isRecord(value)) {
    return false;
  }
  return Array.isArray(value.evidenceRefs) && value.evidenceRefs.every(isEvidenceRef);
}

function isCheckpointEventPayload(value: unknown): value is RuntimeTaskCheckpointEventPayload {
  if (!isRecord(value)) {
    return false;
  }
  return isCheckpoint(value.checkpoint);
}

function isErrorEventPayload(value: unknown): value is RuntimeTaskErrorEventPayload {
  if (!isRecord(value)) {
    return false;
  }
  return isRuntimeError(value.error);
}

function isPayloadForKind(value: unknown, kind: RuntimeTaskEventKind): boolean {
  if (isRuntimeTaskStatus(kind)) {
    return isStatusEventPayload(value, kind);
  }
  switch (kind) {
    case "progress":
      return isProgressEventPayload(value);
    case "context":
      return isContextEventPayload(value);
    case "tool_call_request":
      return isToolCallRequest(value);
    case "tool_call_result":
      return isToolCallResult(value);
    case "evidence":
      return isEvidenceEventPayload(value);
    case "checkpoint":
      return isCheckpointEventPayload(value);
    case "error":
      return isErrorEventPayload(value);
  }
}

export function isRuntimeTaskEvent(value: unknown): value is RuntimeTaskEvent {
  return hasRuntimeTaskEventBase(value) && isPayloadForKind(value.payload, value.kind);
}

export function serializeRuntimeTaskEvent(event: RuntimeTaskEvent): string {
  if (!isRuntimeTaskEvent(event)) {
    throw new Error("Invalid runtime task event contract");
  }
  return JSON.stringify(event);
}

export function parseRuntimeTaskEvent(value: string): RuntimeTaskEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("Invalid runtime task event JSON", { cause: error });
  }
  if (!isRuntimeTaskEvent(parsed)) {
    throw new Error("Invalid runtime task event contract");
  }
  return parsed;
}

function buildPayloadForKind(
  kind: RuntimeTaskEventKind,
): RuntimeTaskEventPayloadByKind[RuntimeTaskEventKind] {
  if (isRuntimeTaskStatus(kind)) {
    return { status: kind } as RuntimeTaskEventPayloadByKind[RuntimeTaskEventKind];
  }
  switch (kind) {
    case "progress":
      return { progress: 25, message: "Runtime task is making progress." };
    case "context":
      return {
        contextItems: [buildContextItemFixture()],
      };
    case "tool_call_request":
      return buildToolCallRequestFixture();
    case "tool_call_result":
      return buildToolCallResultFixture();
    case "evidence":
      return {
        evidenceRefs: [buildEvidenceRefFixture()],
      };
    case "checkpoint":
      return {
        checkpoint: buildCheckpointFixture(),
      };
    case "error":
      return {
        error: buildRuntimeErrorFixture(),
      };
  }
}

export function buildRuntimeTaskEventFixture(
  overrides: RuntimeTaskEventFixtureOverrides = {},
): RuntimeTaskEvent {
  const { kind = "running", payload, ...baseOverrides } = overrides;
  const event = {
    schemaVersion: 1,
    eventId: "event_1",
    taskId: "task_1",
    timestamp: 1,
    traceContext: { traceId: "trace_1", spanId: "span_event_1" },
    evidenceRefs: [buildEvidenceRefFixture({ type: "trace", ref: "trace_1" })],
    ...baseOverrides,
    kind,
    payload: payload ?? buildPayloadForKind(kind),
  };

  if (!isRuntimeTaskEvent(event)) {
    throw new Error("Invalid runtime task event fixture");
  }
  return event;
}
