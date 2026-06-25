import type { EvidenceRef } from "./evidence.js";

export type RuntimeCoreJsonPrimitive = string | number | boolean | null;
export type RuntimeCoreJsonValue =
  | RuntimeCoreJsonPrimitive
  | RuntimeCoreJsonValue[]
  | { [key: string]: RuntimeCoreJsonValue };
export type RuntimeCoreJsonObject = { [key: string]: RuntimeCoreJsonValue };

export const RUNTIME_TASK_STATUSES = [
  "created",
  "planning",
  "assembling_context",
  "running",
  "waiting_permission",
  "waiting_tool",
  "waiting_external",
  "applying_changes",
  "verifying",
  "completed",
  "failed",
  "blocked",
  "cancelled",
] as const;

export type RuntimeTaskStatus = typeof RUNTIME_TASK_STATUSES[number];

export const LEGACY_RUNTIME_TASK_STATUS_MAP = {
  queued: "created",
  ready: "planning",
  running: "running",
  succeeded: "completed",
  complete: "completed",
  done: "completed",
  failed: "failed",
  error: "failed",
  lost: "failed",
  timed_out: "failed",
  timeout: "failed",
  blocked: "blocked",
  cancelled: "cancelled",
  canceled: "cancelled",
} as const satisfies Record<string, RuntimeTaskStatus>;

export type LegacyRuntimeTaskStatus = keyof typeof LEGACY_RUNTIME_TASK_STATUS_MAP;

export const RUNTIME_TASK_EVENT_KINDS = [
  ...RUNTIME_TASK_STATUSES,
  "progress",
  "context",
  "tool_call_request",
  "tool_call_result",
  "evidence",
  "checkpoint",
  "error",
] as const;

export type RuntimeTaskEventKind = typeof RUNTIME_TASK_EVENT_KINDS[number];

export const CONTEXT_ITEM_KINDS = [
  "instruction",
  "message",
  "summary",
  "memory",
  "file",
  "symbol",
  "trace",
  "checkpoint",
  "evidence",
  "other",
] as const;

export type ContextItemKind = typeof CONTEXT_ITEM_KINDS[number];

export const CONTEXT_ITEM_PRIORITIES = ["P0", "P1", "P2"] as const;

export type ContextItemPriority = typeof CONTEXT_ITEM_PRIORITIES[number];

export type RuntimeTraceContext = {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  attributes?: RuntimeCoreJsonObject;
};

export type ContextItem = {
  id: string;
  kind: ContextItemKind;
  text: string;
  source?: string;
  priority?: ContextItemPriority;
  evidenceRefs: EvidenceRef[];
  createdAt?: number;
  metadata?: RuntimeCoreJsonObject;
};

export type ToolCallRetryPolicy = {
  maxAttempts?: number;
  backoffMs?: number;
  retryable?: boolean;
};

export type ToolCallRequest = {
  callId: string;
  taskId: string;
  toolName: string;
  args: RuntimeCoreJsonObject;
  permissionContext?: RuntimeCoreJsonObject;
  retryPolicy?: ToolCallRetryPolicy;
  idempotencyKey?: string;
  traceContext?: RuntimeTraceContext;
};

export const TOOL_CALL_RESULT_STATUSES = ["success", "error", "denied", "cancelled"] as const;

export type ToolCallResultStatus = typeof TOOL_CALL_RESULT_STATUSES[number];

export const RUNTIME_ERROR_TYPES = [
  "model",
  "tool",
  "permission",
  "budget",
  "context",
  "verifier",
  "runtime",
] as const;

export type RuntimeErrorType = typeof RUNTIME_ERROR_TYPES[number];

export type RuntimeError = {
  type: RuntimeErrorType;
  message: string;
  retryable: boolean;
  evidenceRefs: EvidenceRef[];
};

export type ToolCallResult = {
  callId: string;
  status: ToolCallResultStatus;
  contextItems: ContextItem[];
  structuredData?: RuntimeCoreJsonValue;
  error?: RuntimeError;
  startedAt: number;
  finishedAt: number;
  evidence: EvidenceRef[];
};

const RUNTIME_TASK_STATUS_SET = new Set<RuntimeTaskStatus>(RUNTIME_TASK_STATUSES);
const RUNTIME_TASK_EVENT_KIND_SET = new Set<RuntimeTaskEventKind>(RUNTIME_TASK_EVENT_KINDS);
const CONTEXT_ITEM_KIND_SET = new Set<ContextItemKind>(CONTEXT_ITEM_KINDS);
const CONTEXT_ITEM_PRIORITY_SET = new Set<ContextItemPriority>(CONTEXT_ITEM_PRIORITIES);
const TOOL_CALL_RESULT_STATUS_SET = new Set<ToolCallResultStatus>(TOOL_CALL_RESULT_STATUSES);
const RUNTIME_ERROR_TYPE_SET = new Set<RuntimeErrorType>(RUNTIME_ERROR_TYPES);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

export function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

export function isRuntimeCoreJsonValue(value: unknown): value is RuntimeCoreJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isRuntimeCoreJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isRuntimeCoreJsonValue);
}

export function isRuntimeCoreJsonObject(value: unknown): value is RuntimeCoreJsonObject {
  return isRecord(value) && Object.values(value).every(isRuntimeCoreJsonValue);
}

export function isRuntimeTaskStatus(value: unknown): value is RuntimeTaskStatus {
  return typeof value === "string" && RUNTIME_TASK_STATUS_SET.has(value as RuntimeTaskStatus);
}

export function mapLegacyRuntimeTaskStatus(value: unknown): RuntimeTaskStatus | undefined {
  if (isRuntimeTaskStatus(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return LEGACY_RUNTIME_TASK_STATUS_MAP[value as LegacyRuntimeTaskStatus];
}

export function isRuntimeTaskEventKind(value: unknown): value is RuntimeTaskEventKind {
  return typeof value === "string" && RUNTIME_TASK_EVENT_KIND_SET.has(value as RuntimeTaskEventKind);
}

export function isContextItemKind(value: unknown): value is ContextItemKind {
  return typeof value === "string" && CONTEXT_ITEM_KIND_SET.has(value as ContextItemKind);
}

export function isContextItemPriority(value: unknown): value is ContextItemPriority {
  return typeof value === "string" && CONTEXT_ITEM_PRIORITY_SET.has(value as ContextItemPriority);
}

export function isRuntimeTraceContext(value: unknown): value is RuntimeTraceContext {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isOptionalString(value.traceId) &&
    isOptionalString(value.spanId) &&
    isOptionalString(value.parentSpanId) &&
    (value.attributes === undefined || isRuntimeCoreJsonObject(value.attributes))
  );
}

function isEvidenceRefShape(value: unknown): value is EvidenceRef {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.type) &&
    isNonEmptyString(value.ref) &&
    isOptionalString(value.label) &&
    isOptionalString(value.summary) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isContextItem(value: unknown): value is ContextItem {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.id) &&
    isContextItemKind(value.kind) &&
    isString(value.text) &&
    isOptionalString(value.source) &&
    (value.priority === undefined || isContextItemPriority(value.priority)) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRefShape) &&
    isOptionalFiniteNumber(value.createdAt) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isToolCallRetryPolicy(value: unknown): value is ToolCallRetryPolicy {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.maxAttempts === undefined ||
      (Number.isInteger(value.maxAttempts) && Number(value.maxAttempts) >= 0)) &&
    (value.backoffMs === undefined ||
      (Number.isInteger(value.backoffMs) && Number(value.backoffMs) >= 0)) &&
    (value.retryable === undefined || typeof value.retryable === "boolean")
  );
}

export function isToolCallRequest(value: unknown): value is ToolCallRequest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.callId) &&
    isNonEmptyString(value.taskId) &&
    isNonEmptyString(value.toolName) &&
    isRuntimeCoreJsonObject(value.args) &&
    (value.permissionContext === undefined ||
      isRuntimeCoreJsonObject(value.permissionContext)) &&
    (value.retryPolicy === undefined || isToolCallRetryPolicy(value.retryPolicy)) &&
    isOptionalString(value.idempotencyKey) &&
    (value.traceContext === undefined || isRuntimeTraceContext(value.traceContext))
  );
}

export function isToolCallResultStatus(value: unknown): value is ToolCallResultStatus {
  return (
    typeof value === "string" &&
    TOOL_CALL_RESULT_STATUS_SET.has(value as ToolCallResultStatus)
  );
}

export function isRuntimeErrorType(value: unknown): value is RuntimeErrorType {
  return typeof value === "string" && RUNTIME_ERROR_TYPE_SET.has(value as RuntimeErrorType);
}

export function isRuntimeError(value: unknown): value is RuntimeError {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isRuntimeErrorType(value.type) &&
    isNonEmptyString(value.message) &&
    typeof value.retryable === "boolean" &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRefShape)
  );
}

export function isToolCallResult(value: unknown): value is ToolCallResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.callId) &&
    isToolCallResultStatus(value.status) &&
    Array.isArray(value.contextItems) &&
    value.contextItems.every(isContextItem) &&
    (value.structuredData === undefined || isRuntimeCoreJsonValue(value.structuredData)) &&
    (value.error === undefined || isRuntimeError(value.error)) &&
    isFiniteNumber(value.startedAt) &&
    isFiniteNumber(value.finishedAt) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isEvidenceRefShape)
  );
}

export function buildContextItemFixture(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "context_1",
    kind: "instruction",
    text: "Keep the runtime contract shape stable.",
    source: "fixture",
    priority: "P1",
    evidenceRefs: [{ type: "file", ref: "AGENTS.md", label: "Project instructions" }],
    createdAt: 1,
    ...overrides,
  };
}

export function buildToolCallRequestFixture(
  overrides: Partial<ToolCallRequest> = {},
): ToolCallRequest {
  return {
    callId: "tool_call_1",
    taskId: "task_1",
    toolName: "example_tool",
    args: { input: "example" },
    permissionContext: { mode: "read" },
    retryPolicy: { maxAttempts: 1, retryable: true },
    idempotencyKey: "tool_call_1:example_tool",
    traceContext: { traceId: "trace_1", spanId: "span_tool_call_1" },
    ...overrides,
  };
}

export function buildRuntimeErrorFixture(overrides: Partial<RuntimeError> = {}): RuntimeError {
  return {
    type: "tool",
    message: "Tool call failed.",
    retryable: false,
    evidenceRefs: [{ type: "tool", ref: "tool_call_1" }],
    ...overrides,
  };
}

export function buildToolCallResultFixture(
  overrides: Partial<ToolCallResult> = {},
): ToolCallResult {
  return {
    callId: "tool_call_1",
    status: "success",
    contextItems: [buildContextItemFixture({ id: "tool_context_1", kind: "summary" })],
    structuredData: { ok: true },
    startedAt: 1,
    finishedAt: 2,
    evidence: [{ type: "tool", ref: "tool_call_1", label: "Tool result" }],
    ...overrides,
  };
}
