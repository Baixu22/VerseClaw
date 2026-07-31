import {
  isSensitiveFieldKey,
  redactToolPayloadText,
} from "../logging/redact.js";
import {
  isFiniteNumber,
  isNonEmptyString,
  isRecord,
  isRuntimeCoreJsonObject,
  type RuntimeCoreJsonObject,
} from "./types.js";

export const AGENT_RUN_EVENT_SCHEMA = "agent.run-event/v1" as const;
export const EXECUTION_PLAN_SCHEMA = "agent.execution-plan/v1" as const;
export const PROCESS_HANDLE_SCHEMA = "agent.process-handle/v1" as const;
export const OBSERVATION_V2_SCHEMA = "agent.observation/v2" as const;
export const ARTIFACT_REF_SCHEMA = "agent.artifact-ref/v1" as const;
export const POLICY_DECISION_SCHEMA = "agent.policy-decision/v1" as const;
export const AGENT_RUN_STATE_SCHEMA = "agent.run-state/v1" as const;

export const AGENT_RUN_EVENT_RETENTION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const AGENT_RUN_INLINE_OUTPUT_MAX_BYTES = 4 * 1024;
export const AGENT_RUN_DIAGNOSTIC_MAX_COUNT = 64;

export type AgentRunRedaction = {
  status: "sanitized";
  policy: "openclaw.logging.redact/v1";
  rawRetained: false;
  redactedFields: string[];
};

export type AgentRunRetention = {
  policy: "bounded";
  maxAgeMs: number;
  expiresAt: number;
};

type VersionedAgentContract = {
  schemaVersion: 1;
  redaction: AgentRunRedaction;
  retention: AgentRunRetention;
};

export type ExecutionPlan = VersionedAgentContract & {
  schema: typeof EXECUTION_PLAN_SCHEMA;
  planId: string;
  runId: string;
  turnId: string;
  traceId: string;
  agentId: string;
  sessionId: string;
  workspaceId: string;
  executable: {
    requested: string;
    resolvedPath: string;
    kind: "binary" | "windows_batch";
    identityDigest: string;
    interpreter?: {
      requested: string;
      resolvedPath: string;
      identityDigest: string;
    };
  };
  argv: string[];
  cwd: string;
  envDelta: {
    allowlistedSet: Record<string, string>;
    unset: string[];
    pathPrepend: string[];
  };
  stdinMode: "none" | "pipe" | "inherit";
  outputPolicy: {
    mode: "capture" | "stream" | "artifact";
    maxInlineBytes: number;
    maxTotalBytes: number;
  };
  timeoutMs: number;
  mode: "foreground" | "background" | "pty";
  authorizationRef: string;
  risk: "read_only" | "workspace_write" | "process" | "network" | "destructive";
  expectedEffects: string[];
};

export type ProcessHandle = VersionedAgentContract & {
  schema: typeof PROCESS_HANDLE_SCHEMA;
  processId: string;
  planId: string;
  runId: string;
  traceId: string;
  agentId: string;
  sessionId: string;
  workspaceId: string;
  state: "starting" | "running" | "exited" | "failed" | "cancelled" | "lost";
  pid?: number;
  startedAt: number;
  exitedAt?: number;
  exitCode?: number;
  signal?: string;
  stdinCapability: "none" | "pipe";
  ptyCapability: "none" | "attached";
  recoverability: "same_runtime" | "reconcile_required" | "not_recoverable";
  retentionDeadline: number;
};

export type ArtifactRef = VersionedAgentContract & {
  schema: typeof ARTIFACT_REF_SCHEMA;
  artifactId: string;
  handle: string;
  digest: {
    algorithm: "sha256";
    value: string;
  };
  mediaType: string;
  sizeBytes: number;
  producerPlanId: string;
  sensitivity: "public" | "internal" | "sensitive";
  memoryEligible: false;
};

export type ObservationStreamCursor = {
  cursorStart: number;
  cursorEnd: number;
  truncated: boolean;
  droppedBytes: number;
  inlineText?: string;
};

export type ObservationV2 = VersionedAgentContract & {
  schema: typeof OBSERVATION_V2_SCHEMA;
  observationId: string;
  processId: string;
  planId: string;
  runId: string;
  turnId: string;
  traceId: string;
  status: "running" | "success" | "error" | "cancelled";
  lifecycle: {
    sequence: number;
    stage: "started" | "stdout" | "stderr" | "exited" | "failed" | "cancelled";
    at: number;
  };
  summary: string;
  streams: {
    stdout: ObservationStreamCursor;
    stderr: ObservationStreamCursor;
  };
  artifacts: ArtifactRef[];
  diagnostics: Array<{
    code: string;
    message: string;
    recoverable: boolean;
  }>;
};

export type PolicyDecision = VersionedAgentContract & {
  schema: typeof POLICY_DECISION_SCHEMA;
  decisionId: string;
  runId: string;
  turnId: string;
  traceId: string;
  subject: string;
  outcome: "allow" | "deny" | "require_approval" | "observe";
  reasonCodes: string[];
  decidedAt: number;
};

export type AgentRunPayload =
  | ExecutionPlan
  | ProcessHandle
  | ObservationV2
  | ArtifactRef
  | PolicyDecision;

export const AGENT_RUN_EVENT_TYPES = [
  "execution.plan",
  "process.handle",
  "observation",
  "artifact",
  "policy.decision",
] as const;

export type AgentRunEventType = typeof AGENT_RUN_EVENT_TYPES[number];

export type AgentRunEvent = VersionedAgentContract & {
  schema: typeof AGENT_RUN_EVENT_SCHEMA;
  eventId: string;
  causationId: string | null;
  idempotencyKey: string;
  runId: string;
  taskId: string;
  turnId: string;
  traceId: string;
  sessionId: string;
  workspaceId: string;
  timestamp: number;
  type: AgentRunEventType;
  payload: AgentRunPayload;
};

const BATCH_FILE_PATTERN = /\.(?:cmd|bat)$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const AGENT_RUN_SENSITIVE_KEY_PATTERN =
  /^(?:authorization|cookie|credential|session[_-]?token|csrf|xsrf|jwt)$/i;
const AGENT_RUN_EVENT_TYPE_SET = new Set<AgentRunEventType>(AGENT_RUN_EVENT_TYPES);

export function isAgentRunRedaction(value: unknown): value is AgentRunRedaction {
  return isRecord(value)
    && value.status === "sanitized"
    && value.policy === "openclaw.logging.redact/v1"
    && value.rawRetained === false
    && isStringArray(value.redactedFields);
}

export function isAgentRunRetention(value: unknown): value is AgentRunRetention {
  return isRecord(value)
    && value.policy === "bounded"
    && value.maxAgeMs === AGENT_RUN_EVENT_RETENTION_MAX_AGE_MS
    && isFiniteNumber(value.expiresAt);
}

function hasVersionedContract(value: Record<string, unknown>): boolean {
  return value.schemaVersion === 1
    && isAgentRunRedaction(value.redaction)
    && isAgentRunRetention(value.retention);
}

export function isExecutionPlan(value: unknown): value is ExecutionPlan {
  if (!isRecord(value) || !hasVersionedContract(value) || !isRecord(value.executable)) {
    return false;
  }
  const executable = value.executable;
  const interpreter = executable.interpreter;
  const batchRequested = isNonEmptyString(executable.requested)
    && BATCH_FILE_PATTERN.test(executable.requested);
  const batchResolved = isNonEmptyString(executable.resolvedPath)
    && BATCH_FILE_PATTERN.test(executable.resolvedPath);
  const batchKind = executable.kind === "windows_batch";
  const hasInterpreter = isExecutionIdentity(interpreter);
  if ((batchRequested || batchResolved || batchKind) && !(batchKind && hasInterpreter)) {
    return false;
  }
  if (!batchKind && interpreter !== undefined) {
    return false;
  }
  return value.schema === EXECUTION_PLAN_SCHEMA
    && hasIdentityFields(value, [
      "planId",
      "runId",
      "turnId",
      "traceId",
      "agentId",
      "sessionId",
      "workspaceId",
      "cwd",
      "authorizationRef",
    ])
    && isExecutionIdentity(executable)
    && (executable.kind === "binary" || batchKind)
    && isStringArray(value.argv)
    && value.argv.every((item) => item.length <= 32_768)
    && isEnvDelta(value.envDelta)
    && isOneOf(value.stdinMode, ["none", "pipe", "inherit"])
    && isOutputPolicy(value.outputPolicy)
    && isPositiveInteger(value.timeoutMs)
    && isOneOf(value.mode, ["foreground", "background", "pty"])
    && isOneOf(value.risk, ["read_only", "workspace_write", "process", "network", "destructive"])
    && isStringArray(value.expectedEffects);
}

export function isProcessHandle(value: unknown): value is ProcessHandle {
  if (!isRecord(value) || !hasVersionedContract(value)) {
    return false;
  }
  return value.schema === PROCESS_HANDLE_SCHEMA
    && hasIdentityFields(value, [
      "processId",
      "planId",
      "runId",
      "traceId",
      "agentId",
      "sessionId",
      "workspaceId",
    ])
    && isOneOf(value.state, ["starting", "running", "exited", "failed", "cancelled", "lost"])
    && (value.pid === undefined || isPositiveInteger(value.pid))
    && isFiniteNumber(value.startedAt)
    && (value.exitedAt === undefined || isFiniteNumber(value.exitedAt))
    && (value.exitCode === undefined || Number.isInteger(value.exitCode))
    && (value.signal === undefined || typeof value.signal === "string")
    && isOneOf(value.stdinCapability, ["none", "pipe"])
    && isOneOf(value.ptyCapability, ["none", "attached"])
    && isOneOf(value.recoverability, ["same_runtime", "reconcile_required", "not_recoverable"])
    && isFiniteNumber(value.retentionDeadline)
    && value.retentionDeadline === (value.retention as AgentRunRetention).expiresAt;
}

export function isArtifactRef(value: unknown): value is ArtifactRef {
  if (!isRecord(value) || !hasVersionedContract(value) || !isRecord(value.digest)) {
    return false;
  }
  return value.schema === ARTIFACT_REF_SCHEMA
    && hasIdentityFields(value, ["artifactId", "handle", "mediaType", "producerPlanId"])
    && value.digest.algorithm === "sha256"
    && typeof value.digest.value === "string"
    && SHA256_PATTERN.test(value.digest.value)
    && isNonNegativeInteger(value.sizeBytes)
    && isOneOf(value.sensitivity, ["public", "internal", "sensitive"])
    && value.memoryEligible === false;
}

export function isObservationV2(value: unknown): value is ObservationV2 {
  if (!isRecord(value) || !hasVersionedContract(value) || !isRecord(value.lifecycle)
    || !isRecord(value.streams)) {
    return false;
  }
  return value.schema === OBSERVATION_V2_SCHEMA
    && hasIdentityFields(value, [
      "observationId",
      "processId",
      "planId",
      "runId",
      "turnId",
      "traceId",
    ])
    && isOneOf(value.status, ["running", "success", "error", "cancelled"])
    && isNonNegativeInteger(value.lifecycle.sequence)
    && isOneOf(value.lifecycle.stage, ["started", "stdout", "stderr", "exited", "failed", "cancelled"])
    && isFiniteNumber(value.lifecycle.at)
    && typeof value.summary === "string"
    && value.summary.length <= 2_000
    && isObservationStreamCursor(value.streams.stdout)
    && isObservationStreamCursor(value.streams.stderr)
    && Array.isArray(value.artifacts)
    && value.artifacts.every(isArtifactRef)
    && Array.isArray(value.diagnostics)
    && value.diagnostics.length <= AGENT_RUN_DIAGNOSTIC_MAX_COUNT
    && value.diagnostics.every(isObservationDiagnostic);
}

export function isPolicyDecision(value: unknown): value is PolicyDecision {
  if (!isRecord(value) || !hasVersionedContract(value)) {
    return false;
  }
  return value.schema === POLICY_DECISION_SCHEMA
    && hasIdentityFields(value, ["decisionId", "runId", "turnId", "traceId", "subject"])
    && isOneOf(value.outcome, ["allow", "deny", "require_approval", "observe"])
    && isStringArray(value.reasonCodes)
    && isFiniteNumber(value.decidedAt);
}

export function isAgentRunPayload(value: unknown): value is AgentRunPayload {
  return isExecutionPlan(value)
    || isProcessHandle(value)
    || isObservationV2(value)
    || isArtifactRef(value)
    || isPolicyDecision(value);
}

export function isAgentRunEvent(value: unknown): value is AgentRunEvent {
  if (!isRecord(value) || !hasVersionedContract(value)) {
    return false;
  }
  if (!isAgentRunEventType(value.type) || !isAgentRunPayload(value.payload)) {
    return false;
  }
  return value.schema === AGENT_RUN_EVENT_SCHEMA
    && hasIdentityFields(value, [
      "eventId",
      "idempotencyKey",
      "runId",
      "taskId",
      "turnId",
      "traceId",
      "sessionId",
      "workspaceId",
    ])
    && (value.causationId === null || isNonEmptyString(value.causationId))
    && isFiniteNumber(value.timestamp)
    && payloadType(value.payload) === value.type
    && (value.retention as AgentRunRetention).expiresAt
      === value.timestamp + (value.retention as AgentRunRetention).maxAgeMs;
}

export function sanitizeAgentRunEventForPersistence(event: AgentRunEvent): AgentRunEvent {
  if (!isAgentRunEvent(event)) {
    throw new Error("Invalid AgentRunEvent/v1 contract");
  }
  const originalPayload = cloneJson(event.payload);
  // Persistence redaction is forced and cannot be disabled by logging config.
  const redactedPayload = redactAgentRunValue(originalPayload) as AgentRunPayload;
  const redactedFields = collectChangedPaths(originalPayload, redactedPayload, "payload");
  const payload = withPayloadRedaction(redactedPayload, redactedFields);
  const sanitized: AgentRunEvent = {
    ...cloneJson(event),
    payload,
    redaction: {
      status: "sanitized",
      policy: "openclaw.logging.redact/v1",
      rawRetained: false,
      redactedFields,
    },
  };
  if (!isAgentRunEvent(sanitized)) {
    throw new Error("Sanitized AgentRunEvent/v1 contract is invalid");
  }
  return sanitized;
}

export function isAgentRunEventActive(event: AgentRunEvent, now = Date.now()): boolean {
  return event.retention.expiresAt > now;
}

export function createAgentRunRedaction(redactedFields: string[] = []): AgentRunRedaction {
  return {
    status: "sanitized",
    policy: "openclaw.logging.redact/v1",
    rawRetained: false,
    redactedFields: [...new Set(redactedFields)].sort(),
  };
}

export function createAgentRunRetention(
  timestamp: number,
  maxAgeMs = AGENT_RUN_EVENT_RETENTION_MAX_AGE_MS,
): AgentRunRetention {
  if (maxAgeMs !== AGENT_RUN_EVENT_RETENTION_MAX_AGE_MS) {
    throw new Error("Agent run retention must be 14 days to match the event-log prune owner");
  }
  return { policy: "bounded", maxAgeMs, expiresAt: timestamp + maxAgeMs };
}

export function buildExecutionPlanFixture(
  overrides: Partial<ExecutionPlan> = {},
): ExecutionPlan {
  const timestamp = 1_000;
  return {
    schema: EXECUTION_PLAN_SCHEMA,
    schemaVersion: 1,
    planId: "plan_1",
    runId: "run_1",
    turnId: "turn_1",
    traceId: "trace_1",
    agentId: "agent_1",
    sessionId: "session_1",
    workspaceId: "workspace_1",
    executable: {
      requested: "node",
      resolvedPath: "C:\\Program Files\\nodejs\\node.exe",
      kind: "binary",
      identityDigest: `sha256:${"1".repeat(64)}`,
    },
    argv: ["--version"],
    cwd: "C:\\workspace",
    envDelta: { allowlistedSet: {}, unset: [], pathPrepend: [] },
    stdinMode: "none",
    outputPolicy: { mode: "capture", maxInlineBytes: 4_096, maxTotalBytes: 1_048_576 },
    timeoutMs: 30_000,
    mode: "foreground",
    authorizationRef: "authorization_1",
    risk: "read_only",
    expectedEffects: ["process.spawn"],
    redaction: createAgentRunRedaction(),
    retention: createAgentRunRetention(timestamp),
    ...overrides,
  };
}

export function buildProcessHandleFixture(
  overrides: Partial<ProcessHandle> = {},
): ProcessHandle {
  const timestamp = 1_001;
  const retention = createAgentRunRetention(timestamp);
  return {
    schema: PROCESS_HANDLE_SCHEMA,
    schemaVersion: 1,
    processId: "process_1",
    planId: "plan_1",
    runId: "run_1",
    traceId: "trace_1",
    agentId: "agent_1",
    sessionId: "session_1",
    workspaceId: "workspace_1",
    state: "running",
    pid: 1234,
    startedAt: timestamp,
    stdinCapability: "pipe",
    ptyCapability: "none",
    recoverability: "reconcile_required",
    retentionDeadline: retention.expiresAt,
    redaction: createAgentRunRedaction(),
    retention,
    ...overrides,
  };
}

export function buildArtifactRefFixture(
  overrides: Partial<ArtifactRef> = {},
): ArtifactRef {
  const timestamp = 1_002;
  return {
    schema: ARTIFACT_REF_SCHEMA,
    schemaVersion: 1,
    artifactId: "artifact_1",
    handle: "artifact://run_1/stdout",
    digest: { algorithm: "sha256", value: "a".repeat(64) },
    mediaType: "text/plain",
    sizeBytes: 12,
    producerPlanId: "plan_1",
    sensitivity: "internal",
    memoryEligible: false,
    redaction: createAgentRunRedaction(),
    retention: createAgentRunRetention(timestamp),
    ...overrides,
  };
}

export function buildObservationV2Fixture(
  overrides: Partial<ObservationV2> = {},
): ObservationV2 {
  const timestamp = 1_003;
  return {
    schema: OBSERVATION_V2_SCHEMA,
    schemaVersion: 1,
    observationId: "observation_1",
    processId: "process_1",
    planId: "plan_1",
    runId: "run_1",
    turnId: "turn_1",
    traceId: "trace_1",
    status: "success",
    lifecycle: { sequence: 1, stage: "exited", at: timestamp },
    summary: "Process exited successfully.",
    streams: {
      stdout: { cursorStart: 0, cursorEnd: 12, truncated: false, droppedBytes: 0 },
      stderr: { cursorStart: 0, cursorEnd: 0, truncated: false, droppedBytes: 0 },
    },
    artifacts: [buildArtifactRefFixture()],
    diagnostics: [],
    redaction: createAgentRunRedaction(),
    retention: createAgentRunRetention(timestamp),
    ...overrides,
  };
}

export function buildPolicyDecisionFixture(
  overrides: Partial<PolicyDecision> = {},
): PolicyDecision {
  const timestamp = 1_004;
  return {
    schema: POLICY_DECISION_SCHEMA,
    schemaVersion: 1,
    decisionId: "decision_1",
    runId: "run_1",
    turnId: "turn_1",
    traceId: "trace_1",
    subject: "process.spawn",
    outcome: "allow",
    reasonCodes: ["authorized"],
    decidedAt: timestamp,
    redaction: createAgentRunRedaction(),
    retention: createAgentRunRetention(timestamp),
    ...overrides,
  };
}

export function buildAgentRunEventFixture(
  overrides: Partial<AgentRunEvent> = {},
): AgentRunEvent {
  const timestamp = overrides.timestamp ?? 1_010;
  const payload = overrides.payload ?? buildExecutionPlanFixture({
    retention: createAgentRunRetention(timestamp),
  });
  const type = overrides.type ?? payloadType(payload);
  return {
    schema: AGENT_RUN_EVENT_SCHEMA,
    schemaVersion: 1,
    eventId: "agent_event_1",
    causationId: null,
    idempotencyKey: "run_1:plan_1",
    runId: "run_1",
    taskId: "task_1",
    turnId: "turn_1",
    traceId: "trace_1",
    sessionId: "session_1",
    workspaceId: "workspace_1",
    timestamp,
    type,
    payload,
    redaction: createAgentRunRedaction(),
    retention: createAgentRunRetention(timestamp),
    ...overrides,
  };
}

function isAgentRunEventType(value: unknown): value is AgentRunEventType {
  return typeof value === "string" && AGENT_RUN_EVENT_TYPE_SET.has(value as AgentRunEventType);
}

function payloadType(payload: AgentRunPayload): AgentRunEventType {
  switch (payload.schema) {
    case EXECUTION_PLAN_SCHEMA:
      return "execution.plan";
    case PROCESS_HANDLE_SCHEMA:
      return "process.handle";
    case OBSERVATION_V2_SCHEMA:
      return "observation";
    case ARTIFACT_REF_SCHEMA:
      return "artifact";
    case POLICY_DECISION_SCHEMA:
      return "policy.decision";
  }
}

function isExecutionIdentity(value: unknown): boolean {
  return isRecord(value)
    && hasIdentityFields(value, ["requested", "resolvedPath", "identityDigest"]);
}

function isEnvDelta(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.allowlistedSet)) {
    return false;
  }
  return Object.entries(value.allowlistedSet).every(([key, item]) => key.length > 0 && typeof item === "string")
    && isStringArray(value.unset)
    && isStringArray(value.pathPrepend);
}

function isOutputPolicy(value: unknown): boolean {
  return isRecord(value)
    && isOneOf(value.mode, ["capture", "stream", "artifact"])
    && isNonNegativeInteger(value.maxInlineBytes)
    && value.maxInlineBytes <= AGENT_RUN_INLINE_OUTPUT_MAX_BYTES
    && isPositiveInteger(value.maxTotalBytes)
    && value.maxTotalBytes >= Number(value.maxInlineBytes);
}

function isObservationStreamCursor(value: unknown): value is ObservationStreamCursor {
  return isRecord(value)
    && isNonNegativeInteger(value.cursorStart)
    && isNonNegativeInteger(value.cursorEnd)
    && Number(value.cursorEnd) >= Number(value.cursorStart)
    && typeof value.truncated === "boolean"
    && isNonNegativeInteger(value.droppedBytes)
    && (value.inlineText === undefined
      || (typeof value.inlineText === "string"
        && Buffer.byteLength(value.inlineText, "utf8") <= AGENT_RUN_INLINE_OUTPUT_MAX_BYTES));
}

function isObservationDiagnostic(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.code)
    && typeof value.message === "string"
    && value.message.length <= 1_000
    && typeof value.recoverable === "boolean";
}

function hasIdentityFields(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => isNonEmptyString(value[field]));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function withPayloadRedaction(
  payload: AgentRunPayload,
  redactedFields: string[],
): AgentRunPayload {
  const payloadFields = redactedFields
    .filter((field) => field.startsWith("payload."))
    .map((field) => field.slice("payload.".length));
  return {
    ...payload,
    redaction: createAgentRunRedaction(payloadFields),
  } as AgentRunPayload;
}

function collectChangedPaths(before: unknown, after: unknown, path: string): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return [];
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.flatMap((item, index) => collectChangedPaths(item, after[index], `${path}[${index}]`));
  }
  if (isRecord(before) && isRecord(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .flatMap((key) => collectChangedPaths(before[key], after[key], `${path}.${key}`));
  }
  return [path];
}

function redactAgentRunValue(value: unknown, key = ""): unknown {
  if (isAgentRunSensitiveKey(key)) {
    return "<redacted>";
  }
  if (typeof value === "string") {
    return redactToolPayloadText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAgentRunValue(item, key));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([nestedKey, nestedValue]) => [
      nestedKey,
      redactAgentRunValue(nestedValue, nestedKey),
    ]),
  );
}

function isAgentRunSensitiveKey(key: string): boolean {
  return isSensitiveFieldKey(key) || AGENT_RUN_SENSITIVE_KEY_PATTERN.test(key);
}

export function agentRunEventMetadata(event: AgentRunEvent): RuntimeCoreJsonObject {
  const sanitized = sanitizeAgentRunEventForPersistence(event);
  if (!isRuntimeCoreJsonObject(sanitized)) {
    throw new Error("AgentRunEvent/v1 must be JSON serializable");
  }
  return sanitized;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
