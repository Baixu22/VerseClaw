import {
  isEvidenceRef,
  isEvidenceRefType,
  type Checkpoint,
  type EvidenceRef,
  type EvidenceRefType,
} from "./evidence.js";
import type {
  RuntimeCheckpointSerializerDiagnostic,
} from "./checkpoint-serializer.js";
import {
  isAgentMapResult,
  isAgentMapTag,
  type AgentMapFileSelection,
  type AgentMapRankedTag,
  type AgentMapResult,
  type AgentMapTag,
} from "./agent-map.js";
import {
  isEvidenceVerifierDecision,
  isEvidenceVerifierFinding,
  isEvidenceVerifierFindingCode,
  isEvidenceVerifierReport,
  type EvidenceVerifierDecision,
  type EvidenceVerifierFinding,
  type EvidenceVerifierFindingCode,
  type EvidenceVerifierReport,
} from "./evidence-verifier.js";
import {
  isRuntimeMemoryAcceptedVerificationStatus,
  isRuntimeMemoryEpisodeRecord,
  isRuntimeMemoryInvalidationProposal,
  isRuntimeMemoryTemporalFact,
  isRuntimeMemoryTemporalFactCandidate,
  rejectRawRuntimeMemoryInput,
  type RuntimeMemoryEpisodeRecord,
  type RuntimeMemoryInvalidationProposal,
  type RuntimeMemoryQueryableFact,
  type RuntimeMemorySourceEpisodeRef,
  type RuntimeMemorySourceRef,
} from "./memory-context.js";
import {
  isRuntimeSymbolNode,
  type RuntimeSymbolCheckpoint,
  type RuntimeSymbolNode,
  type RuntimeSymbolReference,
} from "./symbols.js";
import {
  isRuntimeTraceSpan,
  isRuntimeTraceSourceRef,
  isRuntimeTraceSpanKind,
  isRuntimeTraceSpanStatus,
  sanitizeRuntimeTraceSpan,
  type RuntimeTraceQuery,
  type RuntimeTraceSourceRef,
  type RuntimeTraceSpan,
  type RuntimeTraceSpanKind,
  type RuntimeTraceSpanStatus,
} from "./trace-context.js";
import type { RuntimeTaskEventLogSearchQuery } from "./event-log.js";
import type { RuntimeTaskEventLogRecord } from "./event-log.js";
import type { RuntimeTaskEvent } from "./events.js";
import {
  isFiniteNumber,
  isNonEmptyString,
  isOptionalFiniteNumber,
  isOptionalString,
  isRecord,
  isRuntimeTaskEventKind,
  isRuntimeTaskStatus,
  type RuntimeCoreJsonObject,
  type RuntimeCoreJsonValue,
  type RuntimeTaskEventKind,
  type RuntimeTaskStatus,
} from "./types.js";

export const GROUNDING_REF_KINDS = [
  "evidence",
  "file",
  "test",
  "tool",
  "trace",
  "source",
  "checkpoint",
  "event",
  "event_log",
  "verifier_report",
  "verifier_finding",
  "memory",
  "symbol",
  "patch",
] as const;

export type GroundingRefKind = (typeof GROUNDING_REF_KINDS)[number];

export const GROUNDING_REF_TRUSTS = [
  "verified",
  "supplied",
  "projected",
  "untrusted",
] as const;

export type GroundingRefTrust = (typeof GROUNDING_REF_TRUSTS)[number];

export type GroundingRefAuthority = "none";

export const GROUNDING_REF_AUTHORITY: GroundingRefAuthority = "none";

export const GROUNDING_REF_REF_LIMIT = 512;
export const GROUNDING_REF_LABEL_LIMIT = 128;
export const GROUNDING_REF_SUMMARY_LIMIT = 512;
export const GROUNDING_METADATA_KEY_LIMIT = 24;
export const GROUNDING_METADATA_DEPTH_LIMIT = 3;
export const GROUNDING_METADATA_STRING_LIMIT = 256;
export const GROUNDING_RESULT_DEFAULT_TOKEN_BUDGET = 256;

export type GroundingProjectionMetadata = {
  derived: true;
  sourceSurface: string;
  sourceField: string;
  transform: string;
  lossy: boolean;
  rawRetained: false;
};

export type GroundingSanitizationMetadata = {
  sanitized: true;
  rawRetained: false;
  labelLimit?: number;
  summaryLimit?: number;
  refLimit?: number;
  metadataKeyLimit?: number;
  metadataDepthLimit?: number;
  metadataStringLimit?: number;
  redacted?: string[];
  rejectedReason?: string;
};

export type GroundingRef = {
  kind: GroundingRefKind;
  id: string;
  canonicalKey: string;
  ref: string;
  label?: string;
  summary?: string;
  evidenceRef?: EvidenceRef;
  sourceRef?: RuntimeTraceSourceRef;
  taskId?: string;
  loopRunId?: string;
  traceId?: string;
  spanId?: string;
  eventId?: string;
  checkpointId?: string;
  toolCallId?: string;
  timestamp?: number;
  trust: GroundingRefTrust;
  authority: GroundingRefAuthority;
  rawRetained: false;
  projection: GroundingProjectionMetadata;
  sanitization: GroundingSanitizationMetadata;
  metadata?: RuntimeCoreJsonObject;
};

export type GroundingTimeRange = {
  start?: number;
  end?: number;
};

export type GroundingQuery = {
  readonly: true;
  kind?: GroundingRefKind | GroundingRefKind[];
  trust?: GroundingRefTrust | GroundingRefTrust[];
  taskId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  linkedSpanId?: string;
  eventId?: string;
  checkpointId?: string;
  toolCallId?: string;
  spanName?: string;
  spanKind?: RuntimeTraceSpanKind;
  spanStatus?: RuntimeTraceSpanStatus;
  eventKind?: RuntimeTaskEventKind | RuntimeTaskEventKind[];
  checkpointState?: RuntimeTaskStatus;
  verifierDecision?: EvidenceVerifierDecision;
  verifierFindingCode?: EvidenceVerifierFindingCode;
  evidenceType?: EvidenceRefType;
  evidenceRef?: string;
  toolName?: string;
  file?: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
  commit?: string;
  diffHash?: string;
  testCommand?: string;
  timeRange?: GroundingTimeRange;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
  maxTraceIds?: number;
  tokenBudget?: number;
  includeUntrusted?: false;
  includeRaw?: false;
  metadata?: RuntimeCoreJsonObject;
};

export type GroundingSummaryItem = {
  id: string;
  canonicalKey: string;
  kind: GroundingRefKind;
  ref: string;
  label?: string;
  summary: string;
  trust: GroundingRefTrust;
  authority: GroundingRefAuthority;
  sourceSurface: string;
  sourceField: string;
  rank: number;
  timestamp?: number;
  metadata?: RuntimeCoreJsonObject;
};

export type GroundingResult = {
  readonly: true;
  query: GroundingQuery;
  refs: GroundingRef[];
  items: GroundingSummaryItem[];
  omittedRefCount: number;
  tokenBudget: number;
  estimatedTokens: number;
  metadata?: RuntimeCoreJsonObject;
};

const GROUNDING_REF_KIND_SET = new Set<GroundingRefKind>(GROUNDING_REF_KINDS);
const GROUNDING_REF_TRUST_SET = new Set<GroundingRefTrust>(GROUNDING_REF_TRUSTS);
const TOKEN_CHAR_WIDTH = 4;
const METADATA_ARRAY_LIMIT = 8;
const METADATA_KEY_LIMIT = 96;
const RESULT_ITEM_LIMIT = 128;
const QUERY_DEFAULT_LIMIT = 128;
const QUERY_MAX_LIMIT = RESULT_ITEM_LIMIT;
const QUERY_MAX_PAGE = 10_000;
const QUERY_MAX_TOKEN_BUDGET = 4_096;
const GROUNDING_RAW_METADATA_KEY_PATTERN =
  /(^|[._\-\s])(raw(prompt|chat|trace|payload|checkpoint)|full(trace|payload|checkpoint|eventpayload|toolargs|tooloutput)|prompt|model[._\-\s]?messages?|provider[._\-\s]?(ordering|selection)|runtime[._\-\s]?decisions?|gateway[._\-\s]?requests?|eventpayload|toolargs|tooloutput|stdout|stderr|process\.env|processenv|completeenv|env|secrets?|api[._\-\s]?key|access[._\-\s]?key|private[._\-\s]?key|authorization|auth[._\-\s]?headers?|password|traceparent|tracestate|baggage|transcript|jsonl)([._\-\s]|$)/i;
const GROUNDING_RAW_METADATA_TEXT_PATTERN =
  /\b(raw[\s_\-]*(prompt|chat|trace|payload|checkpoint)|full[\s_\-]*(trace|payload|checkpoint|event[\s_\-]*payload|tool[\s_\-]*(args|output))|prompt|model[\s_\-]*messages?|provider[\s_\-]*(ordering|selection)|runtime[\s_\-]*decisions?|gateway[\s_\-]*requests?|event[\s_\-]*payload|tool[\s_\-]*(args|output)|stdout|stderr|process\.env|complete[\s_\-]*env|traceparent|tracestate|baggage|authorization|password|secret|api[\s_\-]*key|access[\s_\-]*key|private[\s_\-]*key|bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]{8,})\b/i;
const GROUNDING_AUTHORITY_METADATA_TEXT_PATTERN =
  /\b(?!no)(runtime|completion|provider[\s_\-]*ordering|memory[\s_\-]*promotion|patch[\s_\-]*mutation|context[\s_\-]*item|provider[\s_\-]*result|prompt|durable[\s_\-]*fact|fact[\s_\-]*acceptance|episode[\s_\-]*write|memory[\s_\-]*persistence|symbol[\s_\-]*mutation)[\s_\-]*authority\s*[:=]\s*(true|yes|1|allow|allowed|enabled|grant|granted)\b/i;

export type RuntimeTraceGroundingRefOptions = {
  taskId?: string;
  loopRunId?: string;
  traceId?: string;
  spanId?: string;
  eventId?: string;
  checkpointId?: string;
  toolCallId?: string;
  timestamp?: number;
  ownerId?: string;
  sourceSurface?: string;
  sourceField?: string;
  transform?: string;
  trust?: GroundingRefTrust;
  metadata?: RuntimeCoreJsonObject;
};

export type GroundingProjectionOptions = RuntimeTraceGroundingRefOptions & {
  source?: string;
  evidenceTrust?: GroundingRefTrust;
};

type EvidenceRefGroundingParams = {
  ownerId: string;
  sourceSurface: string;
  sourceField: string;
  transform: string;
  trust: GroundingRefTrust;
  taskId?: string;
  loopRunId?: string;
  traceId?: string;
  spanId?: string;
  eventId?: string;
  checkpointId?: string;
  toolCallId?: string;
  timestamp?: number;
  index: number;
  metadata?: RuntimeCoreJsonObject;
  lossy?: boolean;
};

export function isGroundingRefKind(value: unknown): value is GroundingRefKind {
  return (
    typeof value === "string" &&
    GROUNDING_REF_KIND_SET.has(value as GroundingRefKind)
  );
}

export function isGroundingRefTrust(value: unknown): value is GroundingRefTrust {
  return (
    typeof value === "string" &&
    GROUNDING_REF_TRUST_SET.has(value as GroundingRefTrust)
  );
}

export function isGroundingJsonObject(
  value: unknown,
): value is RuntimeCoreJsonObject {
  return isPlainRecord(value) && Object.values(value).every(isGroundingJsonValue);
}

export function isGroundingProjectionMetadata(
  value: unknown,
): value is GroundingProjectionMetadata {
  return (
    isRecord(value) &&
    value.derived === true &&
    isNonEmptyString(value.sourceSurface) &&
    isNonEmptyString(value.sourceField) &&
    isNonEmptyString(value.transform) &&
    typeof value.lossy === "boolean" &&
    value.rawRetained === false
  );
}

export function isGroundingSanitizationMetadata(
  value: unknown,
): value is GroundingSanitizationMetadata {
  return (
    isRecord(value) &&
    value.sanitized === true &&
    value.rawRetained === false &&
    optionalNonNegativeInteger(value.labelLimit) &&
    optionalNonNegativeInteger(value.summaryLimit) &&
    optionalNonNegativeInteger(value.refLimit) &&
    optionalNonNegativeInteger(value.metadataKeyLimit) &&
    optionalNonNegativeInteger(value.metadataDepthLimit) &&
    optionalNonNegativeInteger(value.metadataStringLimit) &&
    (value.redacted === undefined || isStringArray(value.redacted)) &&
    isOptionalString(value.rejectedReason)
  );
}

export function isGroundingRef(value: unknown): value is GroundingRef {
  return (
    isRecord(value) &&
    isGroundingRefKind(value.kind) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.canonicalKey) &&
    isNonEmptyString(value.ref) &&
    isOptionalString(value.label) &&
    isOptionalString(value.summary) &&
    (value.evidenceRef === undefined || isGroundingEvidenceRef(value.evidenceRef)) &&
    (value.sourceRef === undefined || isRuntimeTraceSourceRef(value.sourceRef)) &&
    isOptionalString(value.taskId) &&
    isOptionalString(value.loopRunId) &&
    isOptionalString(value.traceId) &&
    isOptionalString(value.spanId) &&
    isOptionalString(value.eventId) &&
    isOptionalString(value.checkpointId) &&
    isOptionalString(value.toolCallId) &&
    isOptionalFiniteNumber(value.timestamp) &&
    isGroundingRefTrust(value.trust) &&
    value.authority === GROUNDING_REF_AUTHORITY &&
    value.rawRetained === false &&
    isGroundingProjectionMetadata(value.projection) &&
    isGroundingSanitizationMetadata(value.sanitization) &&
    (value.metadata === undefined || isGroundingJsonObject(value.metadata))
  );
}

export function isGroundingTimeRange(value: unknown): value is GroundingTimeRange {
  return (
    isRecord(value) &&
    isOptionalFiniteNumber(value.start) &&
    isOptionalFiniteNumber(value.end)
  );
}

export function isGroundingQuery(value: unknown): value is GroundingQuery {
  return (
    isRecord(value) &&
    value.readonly === true &&
    optionalGroundingKindFilter(value.kind) &&
    optionalGroundingTrustFilter(value.trust) &&
    isOptionalString(value.taskId) &&
    isOptionalString(value.traceId) &&
    isOptionalString(value.spanId) &&
    isOptionalString(value.parentSpanId) &&
    isOptionalString(value.linkedSpanId) &&
    isOptionalString(value.eventId) &&
    isOptionalString(value.checkpointId) &&
    isOptionalString(value.toolCallId) &&
    isOptionalString(value.spanName) &&
    (value.spanKind === undefined || isRuntimeTraceSpanKind(value.spanKind)) &&
    (value.spanStatus === undefined || isRuntimeTraceSpanStatus(value.spanStatus)) &&
    optionalRuntimeTaskEventKindFilter(value.eventKind) &&
    (value.checkpointState === undefined || isRuntimeTaskStatus(value.checkpointState)) &&
    (value.verifierDecision === undefined ||
      isEvidenceVerifierDecision(value.verifierDecision)) &&
    (value.verifierFindingCode === undefined ||
      isEvidenceVerifierFindingCode(value.verifierFindingCode)) &&
    (value.evidenceType === undefined || isEvidenceRefType(value.evidenceType)) &&
    isOptionalString(value.evidenceRef) &&
    isOptionalString(value.toolName) &&
    isOptionalString(value.file) &&
    isOptionalString(value.symbol) &&
    isOptionalFiniteNumber(value.startLine) &&
    isOptionalFiniteNumber(value.endLine) &&
    isOptionalString(value.commit) &&
    isOptionalString(value.diffHash) &&
    isOptionalString(value.testCommand) &&
    (value.timeRange === undefined || isGroundingTimeRange(value.timeRange)) &&
    (value.sortOrder === undefined ||
      value.sortOrder === "asc" ||
      value.sortOrder === "desc") &&
    optionalNonNegativeInteger(value.page) &&
    optionalNonNegativeInteger(value.limit) &&
    optionalNonNegativeInteger(value.maxTraceIds) &&
    optionalNonNegativeInteger(value.tokenBudget) &&
    (value.includeUntrusted === undefined || value.includeUntrusted === false) &&
    (value.includeRaw === undefined || value.includeRaw === false) &&
    (value.metadata === undefined || isGroundingJsonObject(value.metadata))
  );
}

export function isGroundingSummaryItem(
  value: unknown,
): value is GroundingSummaryItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.canonicalKey) &&
    isGroundingRefKind(value.kind) &&
    isNonEmptyString(value.ref) &&
    isOptionalString(value.label) &&
    isNonEmptyString(value.summary) &&
    isGroundingRefTrust(value.trust) &&
    value.authority === GROUNDING_REF_AUTHORITY &&
    isNonEmptyString(value.sourceSurface) &&
    isNonEmptyString(value.sourceField) &&
    isFiniteNumber(value.rank) &&
    isOptionalFiniteNumber(value.timestamp) &&
    (value.metadata === undefined || isGroundingJsonObject(value.metadata))
  );
}

export function isGroundingResult(value: unknown): value is GroundingResult {
  return (
    isRecord(value) &&
    value.readonly === true &&
    isGroundingQuery(value.query) &&
    Array.isArray(value.refs) &&
    value.refs.every(isGroundingRef) &&
    Array.isArray(value.items) &&
    value.items.every(isGroundingSummaryItem) &&
    isNonNegativeInteger(value.omittedRefCount) &&
    isNonNegativeInteger(value.tokenBudget) &&
    isNonNegativeInteger(value.estimatedTokens) &&
    Number(value.estimatedTokens) <= Number(value.tokenBudget) &&
    (value.metadata === undefined || isGroundingJsonObject(value.metadata))
  );
}

export function sanitizeGroundingRef(value: GroundingRef): GroundingRef {
  const metadata = sanitizeGroundingMetadata(value.metadata);
  const evidenceRef = sanitizeEvidenceRef(value.evidenceRef);
  const sourceRef = sanitizeSourceRef(value.sourceRef);
  return {
    kind: value.kind,
    id: boundedRequired(value.id, GROUNDING_REF_REF_LIMIT),
    canonicalKey: boundedRequired(value.canonicalKey, GROUNDING_REF_REF_LIMIT),
    ref: boundedRequired(value.ref, GROUNDING_REF_REF_LIMIT),
    ...stringField("label", value.label, GROUNDING_REF_LABEL_LIMIT),
    ...stringField("summary", value.summary, GROUNDING_REF_SUMMARY_LIMIT),
    ...(evidenceRef ? { evidenceRef } : {}),
    ...(sourceRef ? { sourceRef } : {}),
    ...stringField("taskId", value.taskId),
    ...stringField("loopRunId", value.loopRunId),
    ...stringField("traceId", value.traceId),
    ...stringField("spanId", value.spanId),
    ...stringField("eventId", value.eventId),
    ...stringField("checkpointId", value.checkpointId),
    ...stringField("toolCallId", value.toolCallId),
    ...(isFiniteNumber(value.timestamp) ? { timestamp: value.timestamp } : {}),
    trust: value.trust,
    authority: GROUNDING_REF_AUTHORITY,
    rawRetained: false,
    projection: sanitizeProjection(value.projection),
    sanitization: sanitizeSanitization(value.sanitization),
    ...(metadata ? { metadata } : {}),
  };
}

export function sanitizeGroundingQuery(value: GroundingQuery): GroundingQuery {
  const metadata = sanitizeGroundingMetadata(value.metadata);
  return {
    ...value,
    readonly: true,
    ...(value.includeUntrusted === undefined ? {} : { includeUntrusted: false }),
    ...(value.includeRaw === undefined ? {} : { includeRaw: false }),
    ...(metadata ? { metadata } : { metadata: undefined }),
  };
}

export function sanitizeGroundingMetadata(
  value: unknown,
): RuntimeCoreJsonObject | undefined {
  return isPlainRecord(value) ? sanitizeMetadataObject(value, 0) : undefined;
}

export function buildGroundingRefFixture(
  overrides: Partial<GroundingRef> = {},
): GroundingRef {
  const ref = {
    kind: "trace",
    id: "grounding_ref_1",
    canonicalKey: "trace:trace_1",
    ref: "trace_1",
    label: "Runtime trace",
    summary: "Fixture grounding reference.",
    evidenceRef: {
      type: "trace",
      ref: "trace_1",
      label: "Runtime trace",
      summary: "Fixture trace evidence.",
    },
    sourceRef: {
      file: "openclaw_runtime/src/runtime-core/grounding.ts",
      symbol: "GroundingRef",
    },
    taskId: "task_1",
    traceId: "trace_1",
    spanId: "span_task_1",
    timestamp: 1,
    trust: "supplied",
    authority: GROUNDING_REF_AUTHORITY,
    rawRetained: false,
    projection: {
      derived: true,
      sourceSurface: "runtime-core",
      sourceField: "evidenceRefs",
      transform: "identity",
      lossy: false,
      rawRetained: false,
    },
    sanitization: defaultSanitization(),
    metadata: { fixture: true },
    ...overrides,
  } as GroundingRef;
  const sanitized = sanitizeGroundingRef(ref);
  if (!isGroundingRef(sanitized)) {
    throw new Error("Invalid grounding ref fixture");
  }
  return sanitized;
}

export function buildGroundingQueryFixture(
  overrides: Partial<GroundingQuery> = {},
): GroundingQuery {
  const query = {
    readonly: true,
    taskId: "task_1",
    traceId: "trace_1",
    spanId: "span_task_1",
    limit: 10,
    tokenBudget: GROUNDING_RESULT_DEFAULT_TOKEN_BUDGET,
    includeRaw: false,
    ...overrides,
  } as GroundingQuery;
  const sanitized = sanitizeGroundingQuery(query);
  if (!isGroundingQuery(sanitized)) {
    throw new Error("Invalid grounding query fixture");
  }
  return sanitized;
}

export function buildGroundingResultFixture(
  overrides: Partial<GroundingResult> = {},
): GroundingResult {
  const query = sanitizeGroundingQuery(
    overrides.query ?? buildGroundingQueryFixture(),
  );
  const refs = (overrides.refs ?? [buildGroundingRefFixture()])
    .map((ref) => sanitizeGroundingRef(ref));
  const tokenBudget = Math.max(
    0,
    Math.floor(overrides.tokenBudget ?? query.tokenBudget ?? GROUNDING_RESULT_DEFAULT_TOKEN_BUDGET),
  );
  const items = buildSummaryItems(overrides.items ?? refs.map(summaryItemFromRef), {
    limit: query.limit,
    tokenBudget,
  });
  const metadata = sanitizeGroundingMetadata(overrides.metadata);
  const result: GroundingResult = {
    readonly: true,
    query,
    refs,
    items: items.items,
    omittedRefCount: Math.max(0, refs.length - items.items.length),
    tokenBudget,
    estimatedTokens: items.estimatedTokens,
    ...(metadata ? { metadata } : {}),
  };
  if (!isGroundingResult(result)) {
    throw new Error("Invalid grounding result fixture");
  }
  return result;
}

export function groundingRefsFromEvidenceRefs(
  refs: readonly EvidenceRef[],
  options: GroundingProjectionOptions = {},
): GroundingRef[] {
  return dedupeGroundingRefs(
    refs
      .filter(isEvidenceRef)
      .map((ref, index) =>
        groundingRefFromEvidenceRef(ref, evidenceRefGroundingParams(ref, options, {
          ownerId: options.ownerId ?? "evidenceRefs",
          sourceSurface: options.sourceSurface ?? "EvidenceRef",
          sourceField: options.sourceField ?? "evidenceRefs",
          transform: options.transform ?? "evidence-ref-identity",
          index,
          lossy: false,
        }))
      ),
  );
}

export function groundingRefForProjectedFile(
  path: string,
  options: GroundingProjectionOptions = {},
): GroundingRef {
  const ref = projectionString(path, "unknown-file");
  return makeGroundingRef({
    kind: "file",
    id: `${options.sourceSurface ?? "projection"}:file:${ref}`,
    canonicalKey: `file:${ref}`,
    ref,
    label: ref,
    summary: "File reference projected from a string field.",
    sourceRef: { file: ref },
    taskId: options.taskId,
    loopRunId: options.loopRunId,
    traceId: options.traceId,
    spanId: options.spanId,
    eventId: options.eventId,
    checkpointId: options.checkpointId,
    toolCallId: options.toolCallId,
    timestamp: options.timestamp,
    trust: projectionTrust("projected", options),
    sourceSurface: options.sourceSurface ?? "projection",
    sourceField: options.sourceField ?? "file",
    transform: options.transform ?? "string-file-projection",
    lossy: true,
    metadata: {
      ...(options.metadata ?? {}),
      projectedFromString: true,
      rawRetained: false,
    },
  });
}

export function groundingRefForProjectedTest(
  command: string,
  options: GroundingProjectionOptions = {},
): GroundingRef {
  const ref = projectionString(command, "unknown-test-command");
  return makeGroundingRef({
    kind: "test",
    id: `${options.sourceSurface ?? "projection"}:test:${stableHash(ref)}`,
    canonicalKey: `test:${ref}`,
    ref,
    label: "Projected test command",
    summary: "Test reference projected from a string field.",
    taskId: options.taskId,
    loopRunId: options.loopRunId,
    traceId: options.traceId,
    spanId: options.spanId,
    eventId: options.eventId,
    checkpointId: options.checkpointId,
    toolCallId: options.toolCallId,
    timestamp: options.timestamp,
    trust: projectionTrust("projected", options),
    sourceSurface: options.sourceSurface ?? "projection",
    sourceField: options.sourceField ?? "test",
    transform: options.transform ?? "string-test-projection",
    lossy: true,
    metadata: {
      ...(options.metadata ?? {}),
      projectedFromString: true,
      rawRetained: false,
    },
  });
}

export function groundingRefsFromRuntimeTaskEvent(
  event: RuntimeTaskEvent,
  options: GroundingProjectionOptions = {},
): GroundingRef[] {
  const traceContext = event.traceContext;
  const traceId = options.traceId ?? traceContext?.traceId;
  const spanId = options.spanId ?? traceContext?.spanId;
  const loopRunId = options.loopRunId ?? stringMetadata(traceContext?.attributes, "loopRunId") ??
    stringMetadata(traceContext?.attributes, "runId");
  const checkpointId = options.checkpointId ?? runtimeTaskEventCheckpointId(event);
  const toolCallId = options.toolCallId ?? runtimeTaskEventToolCallId(event);
  const context: GroundingProjectionOptions = {
    ...options,
    taskId: options.taskId ?? event.taskId,
    loopRunId,
    traceId,
    spanId,
    eventId: options.eventId ?? event.eventId,
    checkpointId,
    toolCallId,
    timestamp: options.timestamp ?? event.timestamp,
  };
  const refs: GroundingRef[] = [
    makeGroundingRef({
      kind: "event",
      id: `event:${event.eventId}`,
      canonicalKey: `event:${event.eventId}`,
      ref: event.eventId,
      label: `Runtime event ${event.kind}`,
      summary: runtimeTaskEventSummary(event),
      taskId: context.taskId,
      loopRunId: context.loopRunId,
      traceId: context.traceId,
      spanId: context.spanId,
      eventId: context.eventId,
      checkpointId: context.checkpointId,
      toolCallId: context.toolCallId,
      timestamp: context.timestamp,
      trust: projectionTrust("supplied", options),
      sourceSurface: options.sourceSurface ?? "RuntimeTaskEvent",
      sourceField: options.sourceField ?? "event",
      transform: options.transform ?? "runtime-event-summary",
      lossy: true,
      metadata: {
        ...(options.metadata ?? {}),
        ...runtimeTaskEventMetadata(event),
        rawRetained: false,
      },
    }),
    ...groundingRefsFromEvidenceRefs(event.evidenceRefs, {
      ...context,
      sourceSurface: "RuntimeTaskEvent",
      sourceField: "evidenceRefs",
      transform: "runtime-event-evidence-link",
    }),
    ...groundingRefsFromEvidenceRefs(runtimeTaskEventPayloadEvidenceRefs(event), {
      ...context,
      sourceSurface: "RuntimeTaskEvent",
      sourceField: "payload.evidenceRefs",
      transform: "runtime-event-payload-evidence-link",
    }),
  ];

  if (traceId || spanId) {
    const ref = traceId ? `${traceId}${spanId ? `:${spanId}` : ""}` : spanId ?? "trace";
    refs.push(makeGroundingRef({
      kind: "trace",
      id: `event:${event.eventId}:trace`,
      canonicalKey: traceId && spanId ? `trace:${traceId}:${spanId}` : `trace:${ref}`,
      ref,
      label: "Runtime event trace context",
      summary: `Trace context linked to runtime event ${event.eventId}.`,
      taskId: context.taskId,
      loopRunId: context.loopRunId,
      traceId,
      spanId,
      eventId: context.eventId,
      checkpointId: context.checkpointId,
      toolCallId: context.toolCallId,
      timestamp: context.timestamp,
      trust: projectionTrust("supplied", options),
      sourceSurface: "RuntimeTaskEvent",
      sourceField: "traceContext",
      transform: "runtime-event-trace-context",
      lossy: true,
      metadata: {
        ...(traceContext?.parentSpanId
          ? { parentSpanId: traceContext.parentSpanId }
          : {}),
        hasTraceContextAttributes: Boolean(traceContext?.attributes),
        rawRetained: false,
      },
    }));
  }

  return dedupeGroundingRefs(refs);
}

export function groundingRefsFromRuntimeTaskEventLogRecord(
  record: RuntimeTaskEventLogRecord,
  options: GroundingProjectionOptions = {},
): GroundingRef[] {
  const event = record.event;
  const traceId = options.traceId ?? event.traceContext?.traceId;
  const spanId = options.spanId ?? event.traceContext?.spanId;
  const context: GroundingProjectionOptions = {
    ...options,
    taskId: options.taskId ?? event.taskId,
    traceId,
    spanId,
    eventId: options.eventId ?? event.eventId,
    checkpointId: options.checkpointId ?? runtimeTaskEventCheckpointId(event),
    toolCallId: options.toolCallId ?? runtimeTaskEventToolCallId(event),
    timestamp: options.timestamp ?? record.appendedAt,
  };
  return dedupeGroundingRefs([
    makeGroundingRef({
      kind: "event_log",
      id: `event-log:${record.sequence}:${event.eventId}`,
      canonicalKey: `event_log:${record.sequence}:${event.eventId}`,
      ref: `${record.sequence}:${event.eventId}`,
      label: "Runtime event log record",
      summary: `Event log record ${record.sequence} captured ${event.kind} event ${event.eventId}.`,
      taskId: context.taskId,
      traceId: context.traceId,
      spanId: context.spanId,
      eventId: context.eventId,
      checkpointId: context.checkpointId,
      toolCallId: context.toolCallId,
      timestamp: context.timestamp,
      trust: projectionTrust("supplied", options),
      sourceSurface: options.sourceSurface ?? "RuntimeTaskEventLogRecord",
      sourceField: options.sourceField ?? "record",
      transform: options.transform ?? "event-log-record-summary",
      lossy: true,
      metadata: {
        schemaVersion: record.schemaVersion,
        schemaMarker: record.schemaMarker,
        sequence: record.sequence,
        appendedAt: record.appendedAt,
        eventId: event.eventId,
        eventKind: event.kind,
        eventTimestamp: event.timestamp,
        evidenceRefCount: event.evidenceRefs.length,
        hasIdempotencyKey: Boolean(record.idempotencyKey),
        rawRetained: false,
      },
    }),
    ...groundingRefsFromRuntimeTaskEvent(event, {
      ...context,
      sourceSurface: "RuntimeTaskEventLogRecord",
      sourceField: "event",
      transform: "event-log-event-summary",
    }),
  ]);
}

export function groundingRefsFromCheckpoint(
  checkpoint: Checkpoint,
  options: GroundingProjectionOptions = {},
): GroundingRef[] {
  const context: GroundingProjectionOptions = {
    ...options,
    taskId: options.taskId ?? checkpoint.taskId,
    checkpointId: options.checkpointId ?? checkpoint.checkpointId,
  };
  return dedupeGroundingRefs([
    makeGroundingRef({
      kind: "checkpoint",
      id: `checkpoint:${checkpoint.checkpointId}`,
      canonicalKey: `checkpoint:${checkpoint.checkpointId}`,
      ref: checkpoint.checkpointId,
      label: `Checkpoint ${checkpoint.state}`,
      summary: checkpoint.contextSummary || `Checkpoint ${checkpoint.checkpointId} is ${checkpoint.state}.`,
      taskId: context.taskId,
      loopRunId: context.loopRunId,
      traceId: context.traceId,
      spanId: context.spanId,
      eventId: context.eventId,
      checkpointId: context.checkpointId,
      toolCallId: context.toolCallId,
      timestamp: context.timestamp,
      trust: projectionTrust("supplied", options),
      sourceSurface: options.sourceSurface ?? "Checkpoint",
      sourceField: options.sourceField ?? "checkpoint",
      transform: options.transform ?? "checkpoint-bounded-summary",
      lossy: true,
      metadata: {
        schemaVersion: checkpoint.schemaVersion,
        checkpointState: checkpoint.state,
        openObligationCount: checkpoint.openObligations.length,
        toolResultCount: checkpoint.toolResults.length,
        fileHashCount: Object.keys(checkpoint.fileHashes).length,
        evidenceRefCount: checkpoint.evidenceRefs.length,
        rawRetained: false,
      },
    }),
    ...groundingRefsFromEvidenceRefs(checkpoint.evidenceRefs, {
      ...context,
      sourceSurface: "Checkpoint",
      sourceField: "evidenceRefs",
      transform: "checkpoint-evidence-link",
    }),
  ]);
}

export function groundingRefsFromCheckpointDiagnostics(
  diagnostics: readonly RuntimeCheckpointSerializerDiagnostic[],
  options: GroundingProjectionOptions = {},
): GroundingRef[] {
  return dedupeGroundingRefs(diagnostics.map((diagnostic, index) => {
    const ref = diagnostic.checkpointId ?? diagnostic.taskId ??
      `${diagnostic.code}:${index + 1}`;
    return makeGroundingRef({
      kind: "checkpoint",
      id: `checkpoint:diagnostic:${diagnostic.code}:${index + 1}`,
      canonicalKey: `checkpoint:diagnostic:${diagnostic.code}:${ref}`,
      ref,
      label: `Checkpoint diagnostic ${diagnostic.code}`,
      summary: `Checkpoint diagnostic ${diagnostic.code}: ${diagnostic.message}`,
      taskId: options.taskId ?? diagnostic.taskId,
      loopRunId: options.loopRunId,
      traceId: options.traceId,
      spanId: options.spanId,
      eventId: options.eventId,
      checkpointId: options.checkpointId ?? diagnostic.checkpointId,
      toolCallId: options.toolCallId,
      timestamp: options.timestamp,
      trust: projectionTrust("projected", options),
      sourceSurface: options.sourceSurface ?? "RuntimeCheckpointSerializerDiagnostic",
      sourceField: options.sourceField ?? "diagnostics",
      transform: options.transform ?? "checkpoint-diagnostic-summary",
      lossy: true,
      metadata: {
        ...(options.metadata ?? {}),
        diagnosticCode: diagnostic.code,
        recoverable: diagnostic.recoverable,
        hasExpectedSchemaMarker: Boolean(diagnostic.expectedSchemaMarker),
        hasActualSchemaMarker: Boolean(diagnostic.actualSchemaMarker),
        rawRetained: false,
      },
    });
  }));
}

export function groundingRefsFromEvidenceVerifierReport(
  report: EvidenceVerifierReport,
  options: GroundingProjectionOptions = {},
): GroundingRef[] {
  if (!isEvidenceVerifierReport(report)) {
    return [];
  }
  const context: GroundingProjectionOptions = {
    ...options,
    taskId: options.taskId ?? report.taskId,
  };
  return dedupeGroundingRefs([
    makeGroundingRef({
      kind: "verifier_report",
      id: `verifier-report:${report.taskId}`,
      canonicalKey: [
        "verifier_report",
        report.taskId,
        report.decision,
        report.findings.length,
        report.evidenceRefs.length,
      ].join(":"),
      ref: report.taskId,
      label: `Evidence verifier ${report.decision}`,
      summary: `Evidence verifier report ${report.decision}; findings=${report.findings.length}; evidenceRefs=${report.evidenceRefs.length}.`,
      taskId: context.taskId,
      loopRunId: context.loopRunId,
      traceId: context.traceId,
      spanId: context.spanId,
      eventId: context.eventId,
      checkpointId: context.checkpointId,
      toolCallId: context.toolCallId,
      timestamp: context.timestamp,
      trust: projectionTrust("verified", options),
      sourceSurface: options.sourceSurface ?? "EvidenceVerifierReport",
      sourceField: options.sourceField ?? "report",
      transform: options.transform ?? "verifier-report-summary",
      lossy: true,
      metadata: {
        ...(options.metadata ?? {}),
        verifierDecision: report.decision,
        findingCount: report.findings.length,
        evidenceRefCount: report.evidenceRefs.length,
        requiredEvidenceKinds: report.requiredEvidenceKinds,
        legacyDecisionUnaffected: report.legacyDecisionUnaffected,
        linkedRefsAutoVerified: false,
        rawRetained: false,
      },
    }),
    ...groundingRefsFromEvidenceRefs(report.evidenceRefs, {
      ...context,
      trust: linkedEvidenceTrust(options),
      sourceSurface: "EvidenceVerifierReport",
      sourceField: "evidenceRefs",
      transform: "verifier-report-evidence-link",
      metadata: {
        linkedRefsAutoVerified: false,
      },
    }),
    ...report.findings.flatMap((finding, index) =>
      groundingRefsFromEvidenceVerifierFinding(finding, {
        ...context,
        ownerId: `${report.taskId}:finding:${index + 1}`,
        sourceSurface: "EvidenceVerifierReport",
        sourceField: "findings",
        transform: "verifier-finding-summary",
      })
    ),
  ]);
}

export function groundingRefsFromEvidenceVerifierFinding(
  finding: EvidenceVerifierFinding,
  options: GroundingProjectionOptions = {},
): GroundingRef[] {
  if (!isEvidenceVerifierFinding(finding)) {
    return [];
  }
  const ownerId = options.ownerId ??
    `${finding.code}:${finding.obligationId ?? finding.toolCallId ?? stableHash(finding.message)}`;
  return dedupeGroundingRefs([
    makeGroundingRef({
      kind: "verifier_finding",
      id: `verifier-finding:${ownerId}`,
      canonicalKey: `verifier_finding:${finding.code}:${finding.obligationId ?? ""}:${finding.toolCallId ?? ""}:${stableHash(finding.message)}`,
      ref: finding.code,
      label: `Verifier finding ${finding.code}`,
      summary: `Verifier finding ${finding.code} (${finding.severity}/${finding.category}): ${finding.message}`,
      taskId: options.taskId,
      loopRunId: options.loopRunId,
      traceId: options.traceId,
      spanId: options.spanId,
      eventId: options.eventId,
      checkpointId: options.checkpointId,
      toolCallId: options.toolCallId ?? finding.toolCallId,
      timestamp: options.timestamp,
      trust: projectionTrust("verified", options),
      sourceSurface: options.sourceSurface ?? "EvidenceVerifierFinding",
      sourceField: options.sourceField ?? "finding",
      transform: options.transform ?? "verifier-finding-summary",
      lossy: true,
      metadata: {
        ...(options.metadata ?? {}),
        verifierFindingCode: finding.code,
        severity: finding.severity,
        category: finding.category,
        ...(finding.obligationId ? { obligationId: finding.obligationId } : {}),
        evidenceRefCount: finding.evidenceRefs.length,
        linkedRefsAutoVerified: false,
        rawRetained: false,
      },
    }),
    ...groundingRefsFromEvidenceRefs(finding.evidenceRefs, {
      ...options,
      trust: linkedEvidenceTrust(options),
      ownerId,
      sourceSurface: "EvidenceVerifierFinding",
      sourceField: "evidenceRefs",
      transform: "verifier-finding-evidence-link",
      metadata: {
        verifierFindingCode: finding.code,
        linkedRefsAutoVerified: false,
      },
    }),
  ]);
}

export function groundingRefsFromRuntimeTraceSpan(
  span: RuntimeTraceSpan,
  options: RuntimeTraceGroundingRefOptions = {},
): GroundingRef[] {
  if (!isRuntimeTraceSpan(span)) {
    return [];
  }

  const record = sanitizeRuntimeTraceSpan(span);
  const taskId = stringMetadata(record.attributes, "task.id") ?? options.taskId;
  const loopRunId = stringMetadata(record.attributes, "loopRunId") ??
    stringMetadata(record.attributes, "runId") ??
    options.loopRunId;
  const toolName = stringMetadata(record.attributes, "tool.name");
  const toolCallId = stringMetadata(record.attributes, "toolCallId") ??
    options.toolCallId;
  const checkpointId = stringMetadata(record.attributes, "checkpointId") ??
    options.checkpointId;
  const base = traceGroundingOptions(record, {
    ...options,
    taskId,
    loopRunId,
    toolCallId,
    checkpointId,
  });

  return dedupeGroundingRefs([
    makeGroundingRef({
      kind: "trace",
      id: `trace:span:${record.traceId}:${record.spanId}`,
      canonicalKey: `trace:${record.traceId}:${record.spanId}`,
      ref: `${record.traceId}:${record.spanId}`,
      label: record.name,
      summary: formatRuntimeTraceSpanGroundingSummary(record),
      taskId,
      loopRunId,
      traceId: record.traceId,
      spanId: record.spanId,
      checkpointId,
      toolCallId,
      timestamp: record.startedAt,
      trust: "supplied",
      sourceSurface: "runtime-trace",
      sourceField: "span",
      transform: "trace-span-summary",
      metadata: {
        ...base.metadata,
        ...(toolName ? { toolName } : {}),
        sourceRefCount: record.sourceRefs.length,
        evidenceRefCount: collectRuntimeTraceEvidenceRefs(record).length,
        eventCount: record.events.length,
        linkRelationships: record.links.map((link) => link.relationship),
        sourceRefsAreEvidenceLinksOnly: true,
        noVerifierAuthority: true,
        noRuntimeAuthority: true,
      },
    }),
    ...groundingRefsFromRuntimeTraceSourceRefs(record.sourceRefs, {
      ...base,
      sourceSurface: "runtime-trace",
      sourceField: "span.sourceRefs",
      transform: "trace-source-anchor",
      trust: "projected",
    }),
    ...record.evidenceRefs.map((ref, index) =>
      groundingRefFromEvidenceRef(ref, {
        ownerId: `${record.traceId}:${record.spanId}`,
        sourceSurface: "runtime-trace",
        sourceField: "span.evidenceRefs",
        transform: "trace-span-evidence-link",
        trust: "supplied",
        taskId,
        loopRunId,
        traceId: record.traceId,
        spanId: record.spanId,
        checkpointId,
        toolCallId,
        timestamp: record.startedAt,
        index,
        metadata: {
          ...base.metadata,
          sourceRefsAreEvidenceLinksOnly: true,
          noVerifierAuthority: true,
        },
      })
    ),
    ...record.events.flatMap((event, eventIndex) => [
      groundingRefFromRuntimeTraceSpanEvent(record, event, eventIndex, base),
      ...(event.evidenceRefs ?? []).map((ref, index) =>
        groundingRefFromEvidenceRef(ref, {
          ownerId: `${record.traceId}:${record.spanId}:event:${eventIndex + 1}`,
          sourceSurface: "runtime-trace",
          sourceField: "span.events.evidenceRefs",
          transform: "trace-span-event-evidence-link",
          trust: "supplied",
          taskId,
          loopRunId,
          traceId: record.traceId,
          spanId: record.spanId,
          checkpointId,
          toolCallId,
          timestamp: event.timestamp,
          index,
          metadata: {
            ...base.metadata,
            spanEventName: event.name,
            sourceRefsAreEvidenceLinksOnly: true,
            noVerifierAuthority: true,
          },
        })
      ),
    ]),
  ]);
}

export function groundingRefsFromRuntimeTraceSourceRefs(
  sourceRefs: readonly RuntimeTraceSourceRef[],
  options: RuntimeTraceGroundingRefOptions = {},
): GroundingRef[] {
  return dedupeGroundingRefs(
    sourceRefs
      .filter(isRuntimeTraceSourceRef)
      .map((sourceRef, index) => {
        const key = runtimeTraceSourceRefKey(sourceRef);
        return makeGroundingRef({
          kind: "source",
          id: `${options.sourceSurface ?? "runtime-trace"}:source:${options.ownerId ?? "refs"}:${index + 1}`,
          canonicalKey: `source:${key}`,
          ref: key,
          label: runtimeTraceSourceRefLabel(sourceRef),
          summary: `Source anchor ${runtimeTraceSourceRefLabel(sourceRef)}.`,
          sourceRef,
          taskId: options.taskId,
          loopRunId: options.loopRunId,
          traceId: options.traceId,
          spanId: options.spanId,
          eventId: options.eventId,
          checkpointId: options.checkpointId,
          toolCallId: options.toolCallId,
          timestamp: options.timestamp,
          trust: options.trust ?? "projected",
          sourceSurface: options.sourceSurface ?? "runtime-trace",
          sourceField: options.sourceField ?? "sourceRefs",
          transform: options.transform ?? "trace-source-anchor",
          metadata: {
            ...(options.metadata ?? {}),
            ...runtimeTraceSourceRefMetadata(sourceRef),
            sourceRefsAreEvidenceLinksOnly: true,
            sourceRefsAreRelevanceAnchorsOnly: true,
            noVerifierAuthority: true,
            noRuntimeAuthority: true,
          },
        });
      }),
  );
}

export function findGroundingRefs(
  refs: readonly GroundingRef[],
  query: GroundingQuery = { readonly: true },
): GroundingRef[] {
  const normalized = normalizeGroundingQueryForHelpers(query).query;
  const ranked = rankGroundingRefs(
    dedupeGroundingRefs(
      refs
        .filter(isGroundingRef)
        .map((ref) => sanitizeGroundingRef(ref))
        .filter((ref) => matchesGroundingQuery(ref, normalized)),
    ),
    normalized,
  );
  return paginateGroundingRefs(ranked, normalized);
}

export function summarizeGroundingRefs(
  refs: readonly GroundingRef[],
  query: GroundingQuery = { readonly: true },
): GroundingResult {
  const normalized = normalizeGroundingQueryForHelpers(query);
  const matched = rankGroundingRefs(
    dedupeGroundingRefs(
      refs
        .filter(isGroundingRef)
        .map((ref) => sanitizeGroundingRef(ref))
        .filter((ref) => matchesGroundingQuery(ref, normalized.query)),
    ),
    normalized.query,
  );
  const paged = paginateGroundingRefs(matched, normalized.query);
  const built = buildSummaryItems(paged.map(summaryItemFromRef), {
    limit: normalized.limit,
    tokenBudget: normalized.tokenBudget,
  });
  const visibleKeys = new Set(built.items.map((item) => item.canonicalKey));
  const visibleRefs = paged.filter((ref) => visibleKeys.has(ref.canonicalKey));
  const metadata = sanitizeGroundingMetadata({
    diagnostics: normalized.diagnostics,
    totalMatchedRefCount: matched.length,
    returnedRefCount: visibleRefs.length,
    boundedPage: normalized.page,
    boundedLimit: normalized.limit,
    boundedTokenBudget: normalized.tokenBudget,
    readonlyLocalQuery: true,
    rawRetained: false,
  });
  const result: GroundingResult = {
    readonly: true,
    query: normalized.query,
    refs: visibleRefs,
    items: built.items,
    omittedRefCount: Math.max(0, matched.length - visibleRefs.length),
    tokenBudget: normalized.tokenBudget,
    estimatedTokens: built.estimatedTokens,
    ...(metadata ? { metadata } : {}),
  };
  if (!isGroundingResult(result)) {
    throw new Error("Invalid grounding query result");
  }
  return result;
}

export function groundingQueryFromRuntimeTraceQuery(
  query: RuntimeTraceQuery = {},
): GroundingQuery {
  return normalizeGroundingQueryForHelpers({
    readonly: true,
    ...(query.traceId ? { traceId: query.traceId } : {}),
    ...(query.spanId ? { spanId: query.spanId } : {}),
    ...(query.parentSpanId ? { parentSpanId: query.parentSpanId } : {}),
    ...(query.linkedSpanId ? { linkedSpanId: query.linkedSpanId } : {}),
    ...(query.taskId ? { taskId: query.taskId } : {}),
    ...(query.toolName ? { toolName: query.toolName } : {}),
    ...(query.file ? { file: query.file } : {}),
    ...(query.symbol ? { symbol: query.symbol } : {}),
    ...(query.name ? { spanName: query.name } : {}),
    ...(query.kind ? { spanKind: query.kind } : {}),
    ...(query.status ? { spanStatus: query.status } : {}),
    ...(query.timeRange ? { timeRange: query.timeRange } : {}),
    includeRaw: false,
  }).query;
}

export function groundingQueryFromEventLogSearchQuery(
  query: RuntimeTaskEventLogSearchQuery = {},
): GroundingQuery {
  return normalizeGroundingQueryForHelpers({
    readonly: true,
    ...(query.taskId ? { taskId: query.taskId } : {}),
    ...(query.kind ? { eventKind: query.kind } : {}),
    ...(query.sortOrder ? { sortOrder: query.sortOrder } : {}),
    ...(query.page !== undefined ? { page: query.page } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
    ...(query.timestampGte !== undefined || query.timestampLt !== undefined
      ? {
          timeRange: {
            ...(query.timestampGte !== undefined ? { start: query.timestampGte } : {}),
            ...(query.timestampLt !== undefined ? { end: query.timestampLt } : {}),
          },
        }
      : {}),
    includeRaw: false,
  }).query;
}

export function rankGroundingRefs(
  refs: readonly GroundingRef[],
  query: GroundingQuery = { readonly: true },
): GroundingRef[] {
  const normalized = normalizeGroundingQueryForHelpers(query).query;
  return refs
    .filter(isGroundingRef)
    .map((ref) => sanitizeGroundingRef(ref))
    .map((ref, index) => ({
      ref,
      index,
      rank: groundingRefRank(ref, normalized),
    }))
    .sort((left, right) => compareRankedGroundingRefs(left, right, normalized))
    .map((entry) => entry.ref);
}

export function groundingRefsFromMemoryEpisode(
  episode: RuntimeMemoryEpisodeRecord,
): GroundingRef[] {
  if (!isRuntimeMemoryEpisodeRecord(episode)) {
    return [];
  }
  const rawRejection = rejectRawRuntimeMemoryInput(episode);
  const record = makeGroundingRef({
    kind: "memory",
    id: `memory:episode:${episode.episodeId}`,
    canonicalKey: `memory:episode:${episode.episodeId}`,
    ref: episode.episodeId,
    label: `Memory episode ${episode.kind}`,
    summary: rawRejection
      ? `Memory episode rejected as raw input: ${rawRejection.reason}.`
      : episode.boundedSummary,
    taskId: episode.taskId,
    timestamp: episode.reference_time,
    trust: rawRejection ? "untrusted" : "supplied",
    sourceSurface: "runtime-memory",
    sourceField: "episode",
    transform: rawRejection ? "reject-raw-memory-episode" : "episode-summary",
    rejectedReason: rawRejection?.reason,
    metadata: rawRejection
      ? { memoryRecord: "episode", rejected: true }
      : {
          memoryRecord: "episode",
          episodeKind: episode.kind,
          noDurableFactPromotion: true,
        },
  });
  if (rawRejection) {
    return [record];
  }
  return dedupeGroundingRefs([
    record,
    ...episode.sourceRefs.map((ref, index) =>
      groundingRefFromMemorySourceRef(ref, {
        ownerId: episode.episodeId,
        ownerField: "episode.sourceRefs",
        taskId: episode.taskId,
        timestamp: episode.reference_time,
        index,
      })
    ),
    ...episode.evidenceRefs.map((ref, index) =>
      groundingRefFromEvidenceRef(ref, {
        ownerId: episode.episodeId,
        sourceSurface: "runtime-memory",
        sourceField: "episode.evidenceRefs",
        transform: "memory-evidence-link",
        trust: projectedTrustForEvidenceRef(ref),
        taskId: episode.taskId,
        timestamp: episode.reference_time,
        index,
        metadata: {
          memoryRecord: "episode",
          sourceRefsAreEvidenceLinksOnly: true,
          noDurableFactPromotion: true,
        },
      })
    ),
  ]);
}

export function groundingRefsFromMemoryFact(
  fact: RuntimeMemoryQueryableFact,
): GroundingRef[] {
  if (
    !isRuntimeMemoryTemporalFact(fact) &&
    !isRuntimeMemoryTemporalFactCandidate(fact)
  ) {
    return [];
  }
  const rawRejection = rejectRawRuntimeMemoryInput(fact);
  const accepted = isRuntimeMemoryAcceptedVerificationStatus(
    fact.verificationStatus,
  );
  const recordTrust: GroundingRefTrust = rawRejection
    ? "untrusted"
    : accepted
    ? "verified"
    : "projected";
  const record = makeGroundingRef({
    kind: "memory",
    id: `memory:fact:${fact.factId}`,
    canonicalKey: `memory:fact:${fact.factId}`,
    ref: fact.factId,
    label: `${fact.verificationStatus} memory fact`,
    summary: rawRejection
      ? `Memory fact rejected as raw input: ${rawRejection.reason}.`
      : `${fact.subject} ${fact.predicate}: ${fact.objectSummary}`,
    taskId: fact.taskId,
    timestamp: fact.reference_time,
    trust: recordTrust,
    sourceSurface: "runtime-memory",
    sourceField: "fact",
    transform: rawRejection
      ? "reject-raw-memory-fact"
      : accepted
      ? "accepted-fact-record-only"
      : "candidate-fact-record",
    rejectedReason: rawRejection?.reason,
    metadata: rawRejection
      ? { memoryRecord: "fact", rejected: true }
      : {
          memoryRecord: "fact",
          verificationStatus: fact.verificationStatus,
          acceptedFactScope: accepted ? "fact_record_only" : "not_accepted",
          linkedRefsAutoVerified: false,
          noDurableFactPromotionFromGrounding: true,
        },
  });
  if (rawRejection) {
    return [record];
  }
  return dedupeGroundingRefs([
    record,
    ...fact.sourceEpisodeRefs.map((ref, index) =>
      groundingRefFromMemorySourceEpisodeRef(ref, {
        ownerId: fact.factId,
        ownerField: "fact.sourceEpisodeRefs",
        fallbackTaskId: fact.taskId,
        index,
      })
    ),
    ...fact.evidenceRefs.map((ref, index) =>
      groundingRefFromEvidenceRef(ref, {
        ownerId: fact.factId,
        sourceSurface: "runtime-memory",
        sourceField: "fact.evidenceRefs",
        transform: "memory-fact-evidence-link",
        trust: projectedTrustForEvidenceRef(ref),
        taskId: fact.taskId,
        timestamp: fact.reference_time,
        index,
        metadata: {
          memoryRecord: "fact",
          linkedRefsAutoVerified: false,
          sourceRefsAreEvidenceLinksOnly: true,
        },
      })
    ),
  ]);
}

export function groundingRefsFromMemoryProposal(
  proposal: RuntimeMemoryInvalidationProposal,
): GroundingRef[] {
  if (!isRuntimeMemoryInvalidationProposal(proposal)) {
    return [];
  }
  const rawRejection = rejectRawRuntimeMemoryInput(proposal);
  const record = makeGroundingRef({
    kind: "memory",
    id: `memory:proposal:${proposal.invalidationId}`,
    canonicalKey: `memory:proposal:${proposal.invalidationId}`,
    ref: proposal.invalidationId,
    label: `${proposal.verificationStatus} memory invalidation proposal`,
    summary: rawRejection
      ? `Memory proposal rejected as raw input: ${rawRejection.reason}.`
      : `${proposal.reason} invalidation proposed for ${proposal.factId}.`,
    timestamp: proposal.reference_time,
    trust: rawRejection ? "untrusted" : "projected",
    sourceSurface: "runtime-memory",
    sourceField: "invalidationProposal",
    transform: rawRejection
      ? "reject-raw-memory-proposal"
      : "proposal-record",
    rejectedReason: rawRejection?.reason,
    metadata: rawRejection
      ? { memoryRecord: "invalidationProposal", rejected: true }
      : {
          memoryRecord: "invalidationProposal",
          factId: proposal.factId,
          verificationStatus: proposal.verificationStatus,
          proposalTrustProjected: true,
          noDurableFactPromotionFromGrounding: true,
        },
  });
  if (rawRejection) {
    return [record];
  }
  return dedupeGroundingRefs([
    record,
    ...proposal.sourceEpisodeRefs.map((ref, index) =>
      groundingRefFromMemorySourceEpisodeRef(ref, {
        ownerId: proposal.invalidationId,
        ownerField: "proposal.sourceEpisodeRefs",
        index,
      })
    ),
    ...proposal.evidenceRefs.map((ref, index) =>
      groundingRefFromEvidenceRef(ref, {
        ownerId: proposal.invalidationId,
        sourceSurface: "runtime-memory",
        sourceField: "proposal.evidenceRefs",
        transform: "memory-proposal-evidence-link",
        trust: projectedTrustForEvidenceRef(ref),
        timestamp: proposal.reference_time,
        index,
        metadata: {
          memoryRecord: "invalidationProposal",
          sourceRefsAreEvidenceLinksOnly: true,
        },
      })
    ),
  ]);
}

export function groundingRefsFromAgentMapResult(
  result: AgentMapResult,
): GroundingRef[] {
  if (!isAgentMapResult(result)) {
    return [];
  }
  return dedupeGroundingRefs([
    makeGroundingRef({
      kind: "source",
      id: `agent-map:result:${result.status}`,
      canonicalKey: `agent-map:result:${result.status}`,
      ref: `agent-map:${result.status}`,
      label: "AgentMap result",
      summary: result.content || `AgentMap result status: ${result.status}.`,
      trust: "supplied",
      sourceSurface: "agent-map",
      sourceField: "result",
      transform: "readonly-result-summary",
      metadata: {
        resultStatus: result.status,
        tokenBudget: result.tokenBudget,
        tokenEstimate: result.tokenEstimate,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
        noRuntimeAuthority: true,
      },
    }),
    ...result.includedFiles.map((file, index) =>
      groundingRefFromAgentMapFileSelection(file, "includedFiles", index)
    ),
    ...result.excludedFiles.map((file, index) =>
      groundingRefFromAgentMapFileSelection(file, "excludedFiles", index)
    ),
    ...result.includedSymbols.flatMap((rankedTag) =>
      groundingRefsFromAgentMapRankedTag(rankedTag)
    ),
    ...result.evidenceRefs.map((ref, index) =>
      groundingRefFromEvidenceRef(ref, {
        ownerId: `agent-map:${result.status}`,
        sourceSurface: "agent-map",
        sourceField: "result.evidenceRefs",
        transform: "agent-map-evidence-link",
        trust: "projected",
        index,
        metadata: {
          sourceRefsAreEvidenceLinksOnly: true,
          noPromptAuthority: true,
        },
      })
    ),
    ...result.evidence.flatMap((item) =>
      item.evidenceRefs.map((ref, index) =>
        groundingRefFromEvidenceRef(ref, {
          ownerId: item.evidenceId,
          sourceSurface: "agent-map",
          sourceField: "evidence.evidenceRefs",
          transform: "agent-map-evidence-item-link",
          trust: "projected",
          index,
          metadata: {
            agentMapEvidenceId: item.evidenceId,
            agentMapEvidenceType: item.type,
            sourceRefsAreEvidenceLinksOnly: true,
          },
        })
      )
    ),
    ...(result.diagnostics ?? []).flatMap((diagnostic, diagnosticIndex) =>
      diagnostic.evidenceRefs.map((ref, index) =>
        groundingRefFromEvidenceRef(ref, {
          ownerId: `agent-map:diagnostic:${diagnosticIndex + 1}`,
          sourceSurface: "agent-map",
          sourceField: "diagnostics.evidenceRefs",
          transform: "agent-map-diagnostic-link",
          trust: "projected",
          index,
          metadata: {
            agentMapDiagnosticCode: diagnostic.code,
            agentMapDiagnosticSeverity: diagnostic.severity,
            sourceRefsAreEvidenceLinksOnly: true,
          },
        })
      )
    ),
  ]);
}

export function groundingRefsFromAgentMapTag(tag: AgentMapTag): GroundingRef[] {
  if (!isAgentMapTag(tag)) {
    return [];
  }
  return dedupeGroundingRefs([
    makeGroundingRef({
      kind: "symbol",
      id: `agent-map:tag:${tag.tagId}`,
      canonicalKey: `agent-map:tag:${tag.tagId}`,
      ref: tag.tagId,
      label: tag.namePath.join("."),
      summary: tag.signature ?? tag.snippet ?? tag.name,
      sourceRef: runtimeSourceRefFromAgentMapTag(tag),
      trust: "supplied",
      sourceSurface: "agent-map",
      sourceField: "tag",
      transform: "readonly-symbol-tag",
      metadata: {
        tagId: tag.tagId,
        tagKind: tag.kind,
        symbolKind: tag.symbolKind,
        file: tag.file,
        name: tag.name,
        sourceRefsAreEvidenceLinksOnly: true,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
        noRuntimeAuthority: true,
      },
    }),
    makeGroundingRef({
      kind: "file",
      id: `agent-map:tag-file:${tag.tagId}`,
      canonicalKey: `file:${tag.file}`,
      ref: tag.file,
      label: tag.file,
      summary: `AgentMap tag ${tag.name} is located in ${tag.file}.`,
      sourceRef: runtimeSourceRefFromAgentMapTag(tag),
      trust: "supplied",
      sourceSurface: "agent-map",
      sourceField: "tag.file",
      transform: "readonly-symbol-file-link",
      metadata: {
        tagId: tag.tagId,
        sourceRefsAreEvidenceLinksOnly: true,
      },
    }),
    ...tag.evidenceRefs.map((ref, index) =>
      groundingRefFromEvidenceRef(ref, {
        ownerId: tag.tagId,
        sourceSurface: "agent-map",
        sourceField: "tag.evidenceRefs",
        transform: "agent-map-tag-evidence-link",
        trust: "projected",
        index,
        metadata: {
          tagId: tag.tagId,
          sourceRefsAreEvidenceLinksOnly: true,
        },
      })
    ),
  ]);
}

export function groundingRefsFromSymbolNode(
  node: RuntimeSymbolNode,
): GroundingRef[] {
  if (!isRuntimeSymbolNode(node)) {
    return [];
  }
  return dedupeGroundingRefs([
    makeGroundingRef({
      kind: "symbol",
      id: `symbol:node:${node.symbolId}`,
      canonicalKey: `symbol:node:${node.symbolId}`,
      ref: node.symbolId,
      label: node.namePath.join("."),
      summary: node.signature ?? `${node.namePath.join(".")} (${node.kind})`,
      sourceRef: runtimeSourceRefFromSymbolNode(node),
      trust: "supplied",
      sourceSurface: "runtime-symbol",
      sourceField: "node",
      transform: "readonly-symbol-node",
      metadata: {
        symbolId: node.symbolId,
        kind: node.kind,
        file: node.file,
        sourceRefsAreRelevanceLinksOnly: true,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
        noRuntimeAuthority: true,
      },
    }),
    makeGroundingRef({
      kind: "file",
      id: `symbol:node-file:${node.symbolId}`,
      canonicalKey: `file:${node.file}`,
      ref: node.file,
      label: node.file,
      summary: `Symbol ${node.name} is located in ${node.file}.`,
      sourceRef: runtimeSourceRefFromSymbolNode(node),
      trust: "supplied",
      sourceSurface: "runtime-symbol",
      sourceField: "node.file",
      transform: "readonly-symbol-source-link",
      metadata: {
        symbolId: node.symbolId,
        sourceRefsAreRelevanceLinksOnly: true,
      },
    }),
    ...node.evidence.map((ref, index) =>
      groundingRefFromEvidenceRef(ref, {
        ownerId: node.symbolId,
        sourceSurface: "runtime-symbol",
        sourceField: "node.evidence",
        transform: "symbol-node-evidence-link",
        trust: "projected",
        index,
        metadata: {
          symbolId: node.symbolId,
          sourceRefsAreEvidenceLinksOnly: true,
        },
      })
    ),
  ]);
}

export function groundingRefsFromSymbolReference(
  reference: RuntimeSymbolReference,
): GroundingRef[] {
  const ref = `${reference.file}:${reference.range.start.line}:${reference.range.start.character}`;
  return dedupeGroundingRefs([
    makeGroundingRef({
      kind: "source",
      id: `symbol:reference:${ref}`,
      canonicalKey: `symbol:reference:${ref}`,
      ref,
      label: reference.file,
      summary: reference.snippet ?? `Symbol reference in ${reference.file}.`,
      sourceRef: {
        file: reference.file,
        startLine: reference.range.start.line,
        endLine: reference.range.end.line,
      },
      trust: "supplied",
      sourceSurface: "runtime-symbol",
      sourceField: "reference",
      transform: "readonly-symbol-reference",
      metadata: {
        file: reference.file,
        sourceRefsAreRelevanceLinksOnly: true,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
        noRuntimeAuthority: true,
      },
    }),
    ...reference.evidence.map((item, index) =>
      groundingRefFromEvidenceRef(item, {
        ownerId: ref,
        sourceSurface: "runtime-symbol",
        sourceField: "reference.evidence",
        transform: "symbol-reference-evidence-link",
        trust: "projected",
        index,
        metadata: {
          sourceRefsAreEvidenceLinksOnly: true,
        },
      })
    ),
  ]);
}

export function groundingRefsFromSymbolCheckpoint(
  checkpoint: RuntimeSymbolCheckpoint,
): GroundingRef[] {
  return dedupeGroundingRefs([
    makeGroundingRef({
      kind: "checkpoint",
      id: `symbol:checkpoint:${checkpoint.checkpointId}`,
      canonicalKey: `symbol:checkpoint:${checkpoint.checkpointId}`,
      ref: checkpoint.checkpointId,
      label: checkpoint.namePath.join("."),
      summary: checkpoint.signature ??
        `Symbol checkpoint for ${checkpoint.namePath.join(".")}.`,
      sourceRef: {
        file: checkpoint.file,
        startLine: checkpoint.range.start.line,
        endLine: checkpoint.range.end.line,
        symbol: checkpoint.namePath.join("."),
      },
      checkpointId: checkpoint.checkpointId,
      timestamp: checkpoint.createdAt,
      trust: "supplied",
      sourceSurface: "runtime-symbol",
      sourceField: "checkpoint",
      transform: "readonly-symbol-checkpoint",
      metadata: {
        symbolId: checkpoint.symbolId,
        kind: checkpoint.kind,
        file: checkpoint.file,
        sourceRefsAreRelevanceLinksOnly: true,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
        noRuntimeAuthority: true,
      },
    }),
    ...checkpoint.evidence.map((item, index) =>
      groundingRefFromEvidenceRef(item, {
        ownerId: checkpoint.checkpointId,
        sourceSurface: "runtime-symbol",
        sourceField: "checkpoint.evidence",
        transform: "symbol-checkpoint-evidence-link",
        trust: "projected",
        index,
        metadata: {
          symbolId: checkpoint.symbolId,
          sourceRefsAreEvidenceLinksOnly: true,
        },
      })
    ),
  ]);
}

type NormalizedGroundingQuery = {
  query: GroundingQuery;
  page: number;
  limit: number;
  tokenBudget: number;
  diagnostics: RuntimeCoreJsonObject[];
};

function traceGroundingOptions(
  span: RuntimeTraceSpan,
  options: RuntimeTraceGroundingRefOptions,
): RuntimeTraceGroundingRefOptions {
  const durationMs = span.endedAt === undefined
    ? undefined
    : Math.max(0, span.endedAt - span.startedAt);
  const metadata = sanitizeGroundingMetadata({
    ...(options.metadata ?? {}),
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    linkedSpanIds: span.links.map((link) => link.spanId),
    spanName: span.name,
    spanKind: span.kind,
    spanStatus: span.status,
    ...(durationMs !== undefined ? { durationMs } : {}),
    readonlyTraceContext: true,
  });
  return {
    ...options,
    ownerId: options.ownerId ?? `${span.traceId}:${span.spanId}`,
    traceId: span.traceId,
    spanId: span.spanId,
    timestamp: options.timestamp ?? span.startedAt,
    metadata: metadata ?? {},
  };
}

function groundingRefFromRuntimeTraceSpanEvent(
  span: RuntimeTraceSpan,
  event: RuntimeTraceSpan["events"][number],
  index: number,
  options: RuntimeTraceGroundingRefOptions,
): GroundingRef {
  const action = externalTraceContextAction(event);
  const eventId = `trace:event:${span.traceId}:${span.spanId}:${index + 1}`;
  return makeGroundingRef({
    kind: "event",
    id: eventId,
    canonicalKey: eventId,
    ref: `${span.traceId}:${span.spanId}:${event.name}:${index + 1}`,
    label: event.name,
    summary: action
      ? `External trace context ${action}; kept only as untrusted sanitized keys.`
      : `Trace span event ${event.name}.`,
    taskId: options.taskId,
    loopRunId: options.loopRunId,
    traceId: span.traceId,
    spanId: span.spanId,
    eventId,
    checkpointId: options.checkpointId,
    toolCallId: options.toolCallId,
    timestamp: event.timestamp,
    trust: action ? "untrusted" : "supplied",
    sourceSurface: "runtime-trace",
    sourceField: "span.events",
    transform: action
      ? "external-trace-context-untrusted"
      : "trace-span-event-summary",
    metadata: {
      ...(options.metadata ?? {}),
      spanEventName: event.name,
      eventAttributeKeys: Object.keys(event.attributes ?? {}),
      evidenceRefCount: event.evidenceRefs?.length ?? 0,
      ...(action ? { externalTraceContextAction: action, trusted: false } : {}),
      noVerifierAuthority: true,
      noRuntimeAuthority: true,
    },
  });
}

function formatRuntimeTraceSpanGroundingSummary(span: RuntimeTraceSpan): string {
  const parts = [
    `${span.status.toUpperCase()} ${span.kind} ${span.name}`,
    `span=${span.spanId}`,
  ];
  if (span.parentSpanId) {
    parts.push(`parent=${span.parentSpanId}`);
  }
  const taskId = stringMetadata(span.attributes, "task.id");
  if (taskId) {
    parts.push(`task=${taskId}`);
  }
  const toolName = stringMetadata(span.attributes, "tool.name");
  if (toolName) {
    parts.push(`tool=${toolName}`);
  }
  const sources = span.sourceRefs
    .map(runtimeTraceSourceRefLabel)
    .slice(0, 3);
  if (sources.length > 0) {
    parts.push(`source=${sources.join(",")}`);
  }
  if (span.evidenceRefs.length > 0) {
    parts.push(`evidence=${span.evidenceRefs.length}`);
  }
  if (span.statusMessage) {
    parts.push(`message=${span.statusMessage}`);
  }
  return parts.join(" | ");
}

function collectRuntimeTraceEvidenceRefs(span: RuntimeTraceSpan): EvidenceRef[] {
  const seen = new Set<string>();
  return [
    ...span.evidenceRefs,
    ...span.events.flatMap((event) => event.evidenceRefs ?? []),
  ].flatMap((ref) => {
    const key = `${ref.type}:${ref.ref}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [ref];
  });
}

function runtimeTraceSourceRefKey(ref: RuntimeTraceSourceRef): string {
  return [
    ref.file ?? "",
    ref.startLine ?? "",
    ref.endLine ?? "",
    ref.symbol ?? "",
    ref.commit ?? "",
    ref.diffHash ?? "",
  ].join(":");
}

function runtimeTraceSourceRefLabel(ref: RuntimeTraceSourceRef): string {
  const range = ref.startLine === undefined && ref.endLine === undefined
    ? undefined
    : `${ref.startLine ?? ""}-${ref.endLine ?? ""}`;
  return [
    ref.file,
    range,
    ref.symbol,
    ref.commit,
    ref.diffHash,
  ].filter(isNonEmptyString).join("#") || "source";
}

function runtimeTraceSourceRefMetadata(
  ref: RuntimeTraceSourceRef,
): RuntimeCoreJsonObject {
  return sanitizeGroundingMetadata({
    ...(ref.file ? { file: ref.file } : {}),
    ...(ref.startLine !== undefined ? { startLine: ref.startLine } : {}),
    ...(ref.endLine !== undefined ? { endLine: ref.endLine } : {}),
    ...(ref.symbol ? { symbol: ref.symbol } : {}),
    ...(ref.commit ? { commit: ref.commit } : {}),
    ...(ref.diffHash ? { diffHash: ref.diffHash } : {}),
  }) ?? {};
}

function externalTraceContextAction(
  event: RuntimeTraceSpan["events"][number],
): string | undefined {
  if (event.name !== "trace_context.external") {
    return undefined;
  }
  const action = event.attributes?.action;
  return typeof action === "string" && action.length > 0 ? action : "rejected";
}

function normalizeGroundingQueryForHelpers(
  value: GroundingQuery,
): NormalizedGroundingQuery {
  const inputRecord: Record<string, unknown> = isRecord(value) ? value : {};
  const includeRawRejected = inputRecord.includeRaw === true;
  const sanitized = sanitizeGroundingQuery(value);
  const page = boundedQueryInteger(sanitized.page, 0, QUERY_MAX_PAGE);
  const limit = boundedQueryInteger(
    sanitized.limit,
    QUERY_DEFAULT_LIMIT,
    QUERY_MAX_LIMIT,
  );
  const tokenBudget = boundedQueryInteger(
    sanitized.tokenBudget,
    GROUNDING_RESULT_DEFAULT_TOKEN_BUDGET,
    QUERY_MAX_TOKEN_BUDGET,
  );
  const diagnostics: RuntimeCoreJsonObject[] = [];
  if (includeRawRejected) {
    diagnostics.push({
      code: "includeRaw_rejected",
      message: "includeRaw=true is ignored; grounding queries return sanitized summaries only.",
      includeRaw: false,
      rawRetained: false,
    });
  }
  if (
    sanitized.page !== page ||
    sanitized.limit !== limit ||
    sanitized.tokenBudget !== tokenBudget
  ) {
    diagnostics.push({
      code: "query_bounds_applied",
      page,
      limit,
      tokenBudget,
    });
  }

  return {
    query: {
      ...sanitized,
      page,
      limit,
      tokenBudget,
      includeRaw: false,
      includeUntrusted: false,
    },
    page,
    limit,
    tokenBudget,
    diagnostics,
  };
}

function boundedQueryInteger(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

function matchesGroundingQuery(ref: GroundingRef, query: GroundingQuery): boolean {
  if (ref.trust === "untrusted") {
    return false;
  }
  if (!matchesFilter(ref.kind, query.kind)) return false;
  if (!matchesFilter(ref.trust, query.trust)) return false;
  if (query.taskId !== undefined && ref.taskId !== query.taskId) return false;
  if (query.traceId !== undefined && ref.traceId !== query.traceId) return false;
  if (query.spanId !== undefined && ref.spanId !== query.spanId) return false;
  if (query.eventId !== undefined && ref.eventId !== query.eventId) return false;
  if (query.checkpointId !== undefined && ref.checkpointId !== query.checkpointId) {
    return false;
  }
  if (query.toolCallId !== undefined && ref.toolCallId !== query.toolCallId) {
    return false;
  }
  if (
    query.parentSpanId !== undefined &&
    metadataString(ref, "parentSpanId") !== query.parentSpanId
  ) {
    return false;
  }
  if (
    query.linkedSpanId !== undefined &&
    !metadataStringArrayIncludes(ref, "linkedSpanIds", query.linkedSpanId)
  ) {
    return false;
  }
  if (query.spanName !== undefined && metadataString(ref, "spanName") !== query.spanName) {
    return false;
  }
  if (query.spanKind !== undefined && metadataString(ref, "spanKind") !== query.spanKind) {
    return false;
  }
  if (
    query.spanStatus !== undefined &&
    metadataString(ref, "spanStatus") !== query.spanStatus
  ) {
    return false;
  }
  if (!matchesFilter(metadataString(ref, "eventKind"), query.eventKind)) {
    return false;
  }
  if (
    query.checkpointState !== undefined &&
    metadataString(ref, "checkpointState") !== query.checkpointState
  ) {
    return false;
  }
  if (
    query.verifierDecision !== undefined &&
    metadataString(ref, "verifierDecision") !== query.verifierDecision
  ) {
    return false;
  }
  if (
    query.verifierFindingCode !== undefined &&
    metadataString(ref, "verifierFindingCode") !== query.verifierFindingCode
  ) {
    return false;
  }
  if (query.evidenceType !== undefined && !matchesEvidenceType(ref, query.evidenceType)) {
    return false;
  }
  if (query.evidenceRef !== undefined && !matchesEvidenceRef(ref, query.evidenceRef)) {
    return false;
  }
  if (query.toolName !== undefined && metadataString(ref, "toolName") !== query.toolName) {
    return false;
  }
  if (query.file !== undefined && !matchesGroundingFile(ref, query.file)) return false;
  if (query.symbol !== undefined && !matchesGroundingSymbol(ref, query.symbol)) {
    return false;
  }
  if (!matchesGroundingRange(ref, query)) return false;
  if (query.commit !== undefined && !matchesGroundingCommit(ref, query.commit)) {
    return false;
  }
  if (query.diffHash !== undefined && !matchesGroundingDiffHash(ref, query.diffHash)) {
    return false;
  }
  if (query.testCommand !== undefined && !matchesGroundingTestCommand(ref, query.testCommand)) {
    return false;
  }
  if (query.timeRange !== undefined && !groundingRefWithinTimeRange(ref, query.timeRange)) {
    return false;
  }
  return true;
}

function paginateGroundingRefs(
  refs: readonly GroundingRef[],
  query: GroundingQuery,
): GroundingRef[] {
  const page = boundedQueryInteger(query.page, 0, QUERY_MAX_PAGE);
  const limit = boundedQueryInteger(query.limit, QUERY_DEFAULT_LIMIT, QUERY_MAX_LIMIT);
  const start = page * limit;
  return refs.slice(start, start + limit);
}

function groundingRefRank(ref: GroundingRef, query: GroundingQuery): number {
  let rank = 0;
  if (isErrorGroundingRef(ref)) rank += 1_000_000;
  if (matchesCurrentGroundingFocus(ref, query)) rank += 850_000;
  if (isTestOrVerifierGroundingRef(ref)) rank += 600_000;
  if (isEvidenceLinkedGroundingRef(ref)) rank += 400_000;
  if (ref.kind === "checkpoint") rank += 300_000;
  if (query.taskId !== undefined && ref.taskId === query.taskId) rank += 100_000;
  if (query.traceId !== undefined && ref.traceId === query.traceId) rank += 10_000;
  if (query.spanId !== undefined && ref.spanId === query.spanId) rank += 10_000;
  return rank + groundingTrustRank(ref.trust);
}

function compareRankedGroundingRefs(
  left: { ref: GroundingRef; index: number; rank: number },
  right: { ref: GroundingRef; index: number; rank: number },
  query: GroundingQuery,
): number {
  const rank = right.rank - left.rank;
  if (rank !== 0) return rank;
  const time = compareGroundingTimestamps(left.ref, right.ref, query.sortOrder);
  if (time !== 0) return time;
  return left.index - right.index;
}

function compareGroundingTimestamps(
  left: GroundingRef,
  right: GroundingRef,
  sortOrder: GroundingQuery["sortOrder"],
): number {
  if (left.timestamp === undefined && right.timestamp === undefined) return 0;
  if (left.timestamp === undefined) return 1;
  if (right.timestamp === undefined) return -1;
  const delta = left.timestamp - right.timestamp;
  return sortOrder === "desc" ? -delta : delta;
}

function isErrorGroundingRef(ref: GroundingRef): boolean {
  return (
    metadataString(ref, "spanStatus") === "error" ||
    metadataString(ref, "eventKind") === "error" ||
    metadataString(ref, "verifierFindingSeverity") === "error" ||
    metadataString(ref, "verifierFindingCode") === "event_replay_inconsistent" ||
    metadataString(ref, "toolResultStatus") === "error"
  );
}

function matchesCurrentGroundingFocus(
  ref: GroundingRef,
  query: GroundingQuery,
): boolean {
  return (
    (query.file !== undefined && matchesGroundingFile(ref, query.file)) ||
    (query.symbol !== undefined && matchesGroundingSymbol(ref, query.symbol)) ||
    (query.testCommand !== undefined &&
      matchesGroundingTestCommand(ref, query.testCommand)) ||
    (query.toolName !== undefined && metadataString(ref, "toolName") === query.toolName)
  );
}

function isTestOrVerifierGroundingRef(ref: GroundingRef): boolean {
  return (
    ref.kind === "test" ||
    ref.kind === "verifier_report" ||
    ref.kind === "verifier_finding" ||
    metadataString(ref, "spanKind") === "test" ||
    metadataString(ref, "spanKind") === "verifier"
  );
}

function isEvidenceLinkedGroundingRef(ref: GroundingRef): boolean {
  return (
    ref.evidenceRef !== undefined ||
    ref.kind === "evidence" ||
    metadataBoolean(ref, "sourceRefsAreEvidenceLinksOnly") ||
    metadataStringArrayIncludes(ref, "linkRelationships", "evidence") ||
    metadataStringArrayIncludes(ref, "linkRelationships", "resume")
  );
}

function groundingTrustRank(trust: GroundingRefTrust): number {
  switch (trust) {
    case "verified":
      return 300;
    case "supplied":
      return 200;
    case "projected":
      return 100;
    case "untrusted":
      return 0;
  }
}

function matchesFilter<T extends string>(
  value: T | undefined,
  filter: T | readonly T[] | undefined,
): boolean {
  if (filter === undefined) return true;
  if (value === undefined) return false;
  return Array.isArray(filter) ? filter.includes(value) : value === filter;
}

function matchesEvidenceType(ref: GroundingRef, evidenceType: EvidenceRefType): boolean {
  return (
    ref.evidenceRef?.type === evidenceType ||
    metadataString(ref, "evidenceRefType") === evidenceType
  );
}

function matchesEvidenceRef(ref: GroundingRef, evidenceRef: string): boolean {
  return ref.evidenceRef?.ref === evidenceRef || ref.ref === evidenceRef;
}

function matchesGroundingFile(ref: GroundingRef, file: string): boolean {
  return samePath(ref.sourceRef?.file, file) || samePath(metadataString(ref, "file"), file);
}

function matchesGroundingSymbol(ref: GroundingRef, symbol: string): boolean {
  return ref.sourceRef?.symbol === symbol || metadataString(ref, "symbol") === symbol;
}

function matchesGroundingRange(ref: GroundingRef, query: GroundingQuery): boolean {
  if (query.startLine === undefined && query.endLine === undefined) {
    return true;
  }
  const start = ref.sourceRef?.startLine ?? metadataNumber(ref, "startLine");
  const end = ref.sourceRef?.endLine ?? metadataNumber(ref, "endLine") ?? start;
  if (start === undefined || end === undefined) {
    return false;
  }
  const queryStart = query.startLine ?? query.endLine ?? Number.NEGATIVE_INFINITY;
  const queryEnd = query.endLine ?? query.startLine ?? Number.POSITIVE_INFINITY;
  return start <= queryEnd && end >= queryStart;
}

function matchesGroundingCommit(ref: GroundingRef, commit: string): boolean {
  return ref.sourceRef?.commit === commit || metadataString(ref, "commit") === commit;
}

function matchesGroundingDiffHash(ref: GroundingRef, diffHash: string): boolean {
  return ref.sourceRef?.diffHash === diffHash ||
    metadataString(ref, "diffHash") === diffHash;
}

function matchesGroundingTestCommand(ref: GroundingRef, testCommand: string): boolean {
  return (
    (ref.evidenceRef?.type === "test" && ref.evidenceRef.ref === testCommand) ||
    metadataString(ref, "testCommand") === testCommand ||
    (ref.kind === "test" && ref.ref === testCommand)
  );
}

function groundingRefWithinTimeRange(
  ref: GroundingRef,
  timeRange: GroundingTimeRange,
): boolean {
  if (ref.timestamp === undefined) {
    return false;
  }
  const start = timeRange.start ?? Number.NEGATIVE_INFINITY;
  const end = timeRange.end ?? Number.POSITIVE_INFINITY;
  return ref.timestamp >= start && ref.timestamp <= end;
}

function metadataString(ref: GroundingRef, key: string): string | undefined {
  return stringMetadata(ref.metadata, key);
}

function metadataNumber(ref: GroundingRef, key: string): number | undefined {
  const value = ref.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metadataBoolean(ref: GroundingRef, key: string): boolean {
  return ref.metadata?.[key] === true;
}

function metadataStringArrayIncludes(
  ref: GroundingRef,
  key: string,
  expected: string,
): boolean {
  const value = ref.metadata?.[key];
  return Array.isArray(value) &&
    value.some((item) => typeof item === "string" && item === expected);
}

function stringMetadata(
  metadata: RuntimeCoreJsonObject | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function samePath(value: string | undefined, expected: string): boolean {
  return value !== undefined &&
    value.replace(/\\/gu, "/") === expected.replace(/\\/gu, "/");
}

type GroundingRefBuildInput = {
  kind: GroundingRefKind;
  id: string;
  canonicalKey: string;
  ref: string;
  label?: string;
  summary?: string;
  evidenceRef?: EvidenceRef;
  sourceRef?: RuntimeTraceSourceRef;
  taskId?: string;
  loopRunId?: string;
  traceId?: string;
  spanId?: string;
  eventId?: string;
  checkpointId?: string;
  toolCallId?: string;
  timestamp?: number;
  trust: GroundingRefTrust;
  sourceSurface: string;
  sourceField: string;
  transform: string;
  lossy?: boolean;
  metadata?: RuntimeCoreJsonObject;
  rejectedReason?: string;
};

function makeGroundingRef(input: GroundingRefBuildInput): GroundingRef {
  return sanitizeGroundingRef({
    kind: input.kind,
    id: input.id,
    canonicalKey: input.canonicalKey,
    ref: input.ref,
    ...(input.label ? { label: input.label } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.loopRunId ? { loopRunId: input.loopRunId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.spanId ? { spanId: input.spanId } : {}),
    ...(input.eventId ? { eventId: input.eventId } : {}),
    ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
    trust: input.trust,
    authority: GROUNDING_REF_AUTHORITY,
    rawRetained: false,
    projection: {
      derived: true,
      sourceSurface: input.sourceSurface,
      sourceField: input.sourceField,
      transform: input.transform,
      lossy: input.lossy ?? true,
      rawRetained: false,
    },
    sanitization: {
      ...defaultSanitization(),
      ...(input.rejectedReason ? { rejectedReason: input.rejectedReason } : {}),
    },
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}

function groundingRefFromMemorySourceRef(
  ref: RuntimeMemorySourceRef,
  params: {
    ownerId: string;
    ownerField: string;
    taskId?: string;
    timestamp?: number;
    index: number;
  },
): GroundingRef {
  const rawRejection = rejectRawRuntimeMemoryInput(ref);
  const raw = rawRejection !== undefined;
  return makeGroundingRef({
    kind: kindFromMemorySourceRef(ref),
    id: `memory:source:${params.ownerId}:${params.index + 1}`,
    canonicalKey: raw
      ? `memory:source:rejected:${params.ownerId}:${params.index + 1}`
      : `${kindFromMemorySourceRef(ref)}:${ref.ref}`,
    ref: ref.ref,
    label: ref.label ?? ref.symbol ?? ref.file ?? ref.ref,
    summary: raw
      ? `Memory source rejected as raw input: ${rawRejection.reason}.`
      : `Memory ${ref.type} source link.`,
    sourceRef: runtimeSourceRefFromMemorySourceRef(ref),
    taskId: params.taskId,
    timestamp: params.timestamp,
    trust: raw ? "untrusted" : "projected",
    sourceSurface: "runtime-memory",
    sourceField: params.ownerField,
    transform: raw ? "reject-raw-memory-source" : "memory-source-link",
    rejectedReason: rawRejection?.reason,
    metadata: raw
      ? { memorySourceRefType: ref.type, rejected: true }
      : {
          memorySourceRefType: ref.type,
          sourceRefsAreEvidenceLinksOnly: true,
          noDurableFactPromotion: true,
        },
  });
}

function groundingRefFromMemorySourceEpisodeRef(
  ref: RuntimeMemorySourceEpisodeRef,
  params: {
    ownerId: string;
    ownerField: string;
    fallbackTaskId?: string;
    index: number;
  },
): GroundingRef {
  return makeGroundingRef({
    kind: "memory",
    id: `memory:source-episode:${params.ownerId}:${params.index + 1}`,
    canonicalKey: `memory:episode:${ref.episodeId}`,
    ref: ref.episodeId,
    label: ref.kind ? `Memory episode ${ref.kind}` : "Memory episode",
    summary: `Memory fact links to source episode ${ref.episodeId}.`,
    taskId: ref.taskId ?? params.fallbackTaskId,
    timestamp: ref.reference_time,
    trust: "projected",
    sourceSurface: "runtime-memory",
    sourceField: params.ownerField,
    transform: "memory-source-episode-link",
    metadata: {
      memoryRecord: "sourceEpisodeRef",
      sourceRefsAreEvidenceLinksOnly: true,
      linkedRefsAutoVerified: false,
      noDurableFactPromotion: true,
    },
  });
}

function isEvidenceRefGroundingParams(
  value: GroundingProjectionOptions | EvidenceRefGroundingParams,
): value is EvidenceRefGroundingParams {
  const record: Record<string, unknown> = isRecord(value) ? value : {};
  return (
    isNonEmptyString(record.ownerId) &&
    isNonEmptyString(record.sourceSurface) &&
    isNonEmptyString(record.sourceField) &&
    isNonEmptyString(record.transform) &&
    isGroundingRefTrust(record.trust) &&
    Number.isInteger(record.index) &&
    Number(record.index) >= 0
  );
}

function evidenceRefGroundingParams(
  ref: EvidenceRef,
  options: GroundingProjectionOptions,
  overrides: Partial<EvidenceRefGroundingParams> = {},
): EvidenceRefGroundingParams {
  return {
    ownerId: overrides.ownerId ?? options.ownerId ?? ref.ref,
    sourceSurface: overrides.sourceSurface ?? options.sourceSurface ??
      options.source ?? "grounding",
    sourceField: overrides.sourceField ?? options.sourceField ?? "evidenceRef",
    transform: overrides.transform ?? options.transform ?? "evidence-ref-link",
    trust: overrides.trust ?? options.evidenceTrust ??
      projectionTrust(options.trust ?? evidenceRefDefaultTrust(ref), options, ref.metadata),
    taskId: overrides.taskId ?? options.taskId,
    loopRunId: overrides.loopRunId ?? options.loopRunId,
    traceId: overrides.traceId ?? options.traceId,
    spanId: overrides.spanId ?? options.spanId,
    eventId: overrides.eventId ?? options.eventId,
    checkpointId: overrides.checkpointId ?? options.checkpointId,
    toolCallId: overrides.toolCallId ?? options.toolCallId,
    timestamp: overrides.timestamp ?? options.timestamp,
    index: overrides.index ?? 0,
    metadata: {
      ...(options.metadata ?? {}),
      ...(overrides.metadata ?? {}),
      sourceRefsAreEvidenceLinksOnly: true,
      noVerifierAuthority: true,
      noRuntimeAuthority: true,
    },
    lossy: overrides.lossy ?? false,
  };
}

function projectionString(value: string, fallback: string): string {
  return boundedRequired(value || fallback, GROUNDING_REF_REF_LIMIT);
}

function projectionTrust(
  fallback: GroundingRefTrust,
  options: GroundingProjectionOptions,
  metadata?: RuntimeCoreJsonObject,
): GroundingRefTrust {
  if (
    options.trust === "untrusted" ||
    isUntrustedProjectionSource(options.source) ||
    isUntrustedProjectionSource(options.sourceSurface) ||
    isUntrustedProjectionSource(stringMetadata(metadata, "source")) ||
    metadata?.trusted === false
  ) {
    return "untrusted";
  }
  return options.trust ?? options.evidenceTrust ?? fallback;
}

function linkedEvidenceTrust(
  options: GroundingProjectionOptions,
): GroundingRefTrust {
  if (
    options.trust === "untrusted" ||
    isUntrustedProjectionSource(options.source) ||
    isUntrustedProjectionSource(options.sourceSurface)
  ) {
    return "untrusted";
  }
  return options.evidenceTrust ?? "supplied";
}

function evidenceRefDefaultTrust(ref: EvidenceRef): GroundingRefTrust {
  if (
    isUntrustedProjectionSource(stringMetadata(ref.metadata, "source")) ||
    ref.metadata?.trusted === false
  ) {
    return "untrusted";
  }
  return ref.metadata?.sourceProjected === true ? "projected" : "supplied";
}

function isUntrustedProjectionSource(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized === "renderer" ||
    normalized === "external" ||
    normalized === "untrusted"
  ) {
    return true;
  }
  const tokens = normalized.split(/[^a-z0-9]+/u).filter(Boolean);
  return tokens.includes("renderer") ||
    tokens.includes("external") ||
    tokens.includes("untrusted");
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function runtimeTaskEventCheckpointId(
  event: RuntimeTaskEvent,
): string | undefined {
  if (event.kind === "checkpoint") {
    return event.payload.checkpoint.checkpointId;
  }
  return stringMetadata(event.traceContext?.attributes, "checkpointId");
}

function runtimeTaskEventToolCallId(
  event: RuntimeTaskEvent,
): string | undefined {
  if (event.kind === "tool_call_request" || event.kind === "tool_call_result") {
    return event.payload.callId;
  }
  return stringMetadata(event.traceContext?.attributes, "toolCallId");
}

function runtimeTaskEventSummary(event: RuntimeTaskEvent): string {
  switch (event.kind) {
    case "progress":
      return `Runtime progress event ${event.eventId}; progress=${event.payload.progress ?? "unknown"}.`;
    case "context":
      return `Runtime context event ${event.eventId}; items=${event.payload.contextItems.length}.`;
    case "tool_call_request":
      return `Runtime tool call request ${event.payload.callId}; tool=${event.payload.toolName}.`;
    case "tool_call_result":
      return `Runtime tool call result ${event.payload.callId}; status=${event.payload.status}.`;
    case "evidence":
      return `Runtime evidence event ${event.eventId}; evidenceRefs=${event.payload.evidenceRefs.length}.`;
    case "checkpoint":
      return `Runtime checkpoint event ${event.payload.checkpoint.checkpointId}; state=${event.payload.checkpoint.state}.`;
    case "error":
      return `Runtime error event ${event.eventId}; type=${event.payload.error.type}.`;
    default:
      return `Runtime status event ${event.eventId}; status=${event.kind}.`;
  }
}

function runtimeTaskEventMetadata(event: RuntimeTaskEvent): RuntimeCoreJsonObject {
  const base: RuntimeCoreJsonObject = {
    eventKind: event.kind,
    eventTimestamp: event.timestamp,
    evidenceRefCount: event.evidenceRefs.length,
    hasTraceContext: event.traceContext !== undefined,
  };
  switch (event.kind) {
    case "progress":
      return {
        ...base,
        ...(event.payload.progress !== undefined ? { progress: event.payload.progress } : {}),
        hasMessage: event.payload.message !== undefined,
      };
    case "context":
      return { ...base, contextItemCount: event.payload.contextItems.length };
    case "tool_call_request":
      return {
        ...base,
        toolCallId: event.payload.callId,
        toolName: event.payload.toolName,
        hasArgs: true,
        hasPermissionContext: event.payload.permissionContext !== undefined,
      };
    case "tool_call_result":
      return {
        ...base,
        toolCallId: event.payload.callId,
        toolResultStatus: event.payload.status,
        contextItemCount: event.payload.contextItems.length,
        toolEvidenceRefCount: event.payload.evidence.length,
        hasStructuredData: event.payload.structuredData !== undefined,
        hasError: event.payload.error !== undefined,
      };
    case "evidence":
      return { ...base, payloadEvidenceRefCount: event.payload.evidenceRefs.length };
    case "checkpoint":
      return {
        ...base,
        checkpointId: event.payload.checkpoint.checkpointId,
        checkpointState: event.payload.checkpoint.state,
        openObligationCount: event.payload.checkpoint.openObligations.length,
        toolResultCount: event.payload.checkpoint.toolResults.length,
        fileHashCount: Object.keys(event.payload.checkpoint.fileHashes).length,
        checkpointEvidenceRefCount: event.payload.checkpoint.evidenceRefs.length,
      };
    case "error":
      return {
        ...base,
        errorType: event.payload.error.type,
        retryable: event.payload.error.retryable,
        errorEvidenceRefCount: event.payload.error.evidenceRefs.length,
      };
    default:
      return {
        ...base,
        taskStatus: event.kind,
        hasMessage: event.payload.message !== undefined,
        hasSummary: event.payload.summary !== undefined,
      };
  }
}

function runtimeTaskEventPayloadEvidenceRefs(
  event: RuntimeTaskEvent,
): EvidenceRef[] {
  switch (event.kind) {
    case "tool_call_result":
      return [
        ...event.payload.evidence,
        ...(event.payload.error?.evidenceRefs ?? []),
      ];
    case "evidence":
      return event.payload.evidenceRefs;
    case "checkpoint":
      return [
        ...event.payload.checkpoint.evidenceRefs,
        ...event.payload.checkpoint.toolResults.flatMap((result) => [
          ...result.evidence,
          ...(result.error?.evidenceRefs ?? []),
        ]),
      ];
    case "error":
      return event.payload.error.evidenceRefs;
    default:
      return [];
  }
}

export function groundingRefFromEvidenceRef(
  ref: EvidenceRef,
  options?: GroundingProjectionOptions,
): GroundingRef;
export function groundingRefFromEvidenceRef(
  ref: EvidenceRef,
  params: EvidenceRefGroundingParams,
): GroundingRef;
export function groundingRefFromEvidenceRef(
  ref: EvidenceRef,
  params: GroundingProjectionOptions | EvidenceRefGroundingParams = {},
): GroundingRef {
  const resolved = isEvidenceRefGroundingParams(params)
    ? params
    : evidenceRefGroundingParams(ref, params);
  const rawRejection = rejectRawRuntimeMemoryInput(ref);
  const raw = rawRejection !== undefined;
  const kind = kindFromEvidenceRef(ref);
  return makeGroundingRef({
    kind,
    id: `${resolved.sourceSurface}:evidence:${resolved.ownerId}:${resolved.index + 1}`,
    canonicalKey: raw
      ? `${resolved.sourceSurface}:evidence:rejected:${resolved.ownerId}:${resolved.index + 1}`
      : `${kind}:${ref.type}:${ref.ref}`,
    ref: ref.ref,
    label: ref.label ?? ref.ref,
    summary: raw
      ? `Evidence link rejected as raw input: ${rawRejection.reason}.`
      : ref.summary ?? `${ref.type} evidence link.`,
    evidenceRef: raw ? undefined : ref,
    sourceRef: raw ? undefined : runtimeSourceRefFromEvidenceRef(ref),
    taskId: resolved.taskId,
    loopRunId: resolved.loopRunId,
    traceId: resolved.traceId,
    spanId: resolved.spanId,
    eventId: resolved.eventId,
    checkpointId: resolved.checkpointId,
    toolCallId: resolved.toolCallId,
    timestamp: resolved.timestamp,
    trust: raw ? "untrusted" : resolved.trust,
    sourceSurface: resolved.sourceSurface,
    sourceField: resolved.sourceField,
    transform: raw ? "reject-raw-evidence-link" : resolved.transform,
    lossy: raw ? true : resolved.lossy,
    rejectedReason: rawRejection?.reason,
    metadata: raw
      ? { evidenceRefType: ref.type, rejected: true }
      : {
          evidenceRefType: ref.type,
          ...(resolved.metadata ?? {}),
        },
  });
}

function groundingRefFromAgentMapFileSelection(
  selection: AgentMapFileSelection,
  sourceField: "includedFiles" | "excludedFiles",
  index: number,
): GroundingRef {
  return makeGroundingRef({
    kind: "file",
    id: `agent-map:file:${sourceField}:${index + 1}:${selection.file}`,
    canonicalKey: `file:${selection.file}`,
    ref: selection.file,
    label: selection.file,
    summary: `${selection.included ? "Included" : "Excluded"} AgentMap file: ${selection.reason}.`,
    sourceRef: { file: selection.file },
    trust: "supplied",
    sourceSurface: "agent-map",
    sourceField,
    transform: "readonly-file-selection",
    metadata: {
      included: selection.included,
      reason: selection.reason,
      tokenEstimate: selection.tokenEstimate,
      tagIds: selection.tagIds,
      sourceRefsAreEvidenceLinksOnly: true,
      noPromptAuthority: true,
      noProviderOrderingAuthority: true,
    },
  });
}

function groundingRefsFromAgentMapRankedTag(
  rankedTag: AgentMapRankedTag,
): GroundingRef[] {
  return [
    ...groundingRefsFromAgentMapTag(rankedTag.tag),
    ...rankedTag.evidenceRefs.map((ref, index) =>
      groundingRefFromEvidenceRef(ref, {
        ownerId: rankedTag.tag.tagId,
        sourceSurface: "agent-map",
        sourceField: "includedSymbols.evidenceRefs",
        transform: "agent-map-ranked-symbol-evidence-link",
        trust: "projected",
        index,
        metadata: {
          tagId: rankedTag.tag.tagId,
          rank: rankedTag.rank,
          sourceRefsAreEvidenceLinksOnly: true,
        },
      })
    ),
    ...rankedTag.reasons.flatMap((reason, reasonIndex) =>
      reason.evidenceRefs.map((ref, index) =>
        groundingRefFromEvidenceRef(ref, {
          ownerId: `${rankedTag.tag.tagId}:reason:${reasonIndex + 1}`,
          sourceSurface: "agent-map",
          sourceField: "includedSymbols.reasons.evidenceRefs",
          transform: "agent-map-ranking-reason-link",
          trust: "projected",
          index,
          metadata: {
            tagId: rankedTag.tag.tagId,
            reasonKind: reason.kind,
            scoreDelta: reason.scoreDelta,
            sourceRefsAreEvidenceLinksOnly: true,
          },
        })
      )
    ),
  ];
}

function projectedTrustForEvidenceRef(ref: EvidenceRef): GroundingRefTrust {
  return rejectRawRuntimeMemoryInput(ref) ? "untrusted" : "projected";
}

function kindFromMemorySourceRef(ref: RuntimeMemorySourceRef): GroundingRefKind {
  switch (ref.type) {
    case "file":
      return "file";
    case "symbol":
      return "symbol";
    case "tool":
      return "tool";
    case "trace":
      return "trace";
    case "checkpoint":
      return "checkpoint";
    case "event":
      return "event";
    case "test":
      return "test";
    default:
      return "source";
  }
}

function kindFromEvidenceRef(ref: EvidenceRef): GroundingRefKind {
  switch (ref.type) {
    case "file":
      return "file";
    case "test":
      return "test";
    case "tool":
      return "tool";
    case "trace":
      return "trace";
    case "checkpoint":
      return "checkpoint";
    case "memory":
      return "memory";
    default:
      return "evidence";
  }
}

function runtimeSourceRefFromMemorySourceRef(
  ref: RuntimeMemorySourceRef,
): RuntimeTraceSourceRef | undefined {
  if (!ref.file && !ref.symbol) {
    return undefined;
  }
  return {
    ...(ref.file ? { file: ref.file } : {}),
    ...(ref.symbol ? { symbol: ref.symbol } : {}),
  };
}

function runtimeSourceRefFromEvidenceRef(
  ref: EvidenceRef,
): RuntimeTraceSourceRef | undefined {
  if (ref.type !== "file") {
    return undefined;
  }
  const parsed = parseFileLineRef(ref.ref);
  return parsed;
}

function runtimeSourceRefFromAgentMapTag(tag: AgentMapTag): RuntimeTraceSourceRef {
  return {
    file: tag.file,
    startLine: tag.range.startLine,
    endLine: tag.range.endLine,
    symbol: tag.namePath.join("."),
  };
}

function runtimeSourceRefFromSymbolNode(
  node: RuntimeSymbolNode,
): RuntimeTraceSourceRef {
  return {
    file: node.file,
    startLine: node.range.start.line,
    endLine: node.range.end.line,
    symbol: node.namePath.join("."),
  };
}

function parseFileLineRef(ref: string): RuntimeTraceSourceRef {
  const match = /^(.*):(\d+)$/u.exec(ref);
  if (!match) {
    return { file: ref };
  }
  return {
    file: match[1] ?? ref,
    startLine: Number(match[2]),
  };
}

function dedupeGroundingRefs(refs: readonly GroundingRef[]): GroundingRef[] {
  const seen = new Set<string>();
  const deduped: GroundingRef[] = [];
  for (const ref of refs) {
    const key = ref.canonicalKey;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(ref);
  }
  return deduped;
}

function isGroundingEvidenceRef(value: unknown): value is EvidenceRef {
  return (
    isEvidenceRef(value) &&
    (!isRecord(value) ||
      value.metadata === undefined ||
      isGroundingJsonObject(value.metadata))
  );
}

function isGroundingJsonValue(value: unknown): value is RuntimeCoreJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isGroundingJsonValue);
  }
  return isGroundingJsonObject(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function optionalGroundingKindFilter(value: unknown): boolean {
  return (
    value === undefined ||
    isGroundingRefKind(value) ||
    (Array.isArray(value) && value.every(isGroundingRefKind))
  );
}

function optionalGroundingTrustFilter(value: unknown): boolean {
  return (
    value === undefined ||
    isGroundingRefTrust(value) ||
    (Array.isArray(value) && value.every(isGroundingRefTrust))
  );
}

function optionalRuntimeTaskEventKindFilter(value: unknown): boolean {
  return (
    value === undefined ||
    isRuntimeTaskEventKind(value) ||
    (Array.isArray(value) && value.every(isRuntimeTaskEventKind))
  );
}

function sanitizeProjection(value: unknown): GroundingProjectionMetadata {
  const record = isRecord(value) ? value : {};
  return {
    derived: true,
    sourceSurface: boundedFallback(record.sourceSurface, "unknown"),
    sourceField: boundedFallback(record.sourceField, "unknown"),
    transform: boundedFallback(record.transform, "identity"),
    lossy: record.lossy === true,
    rawRetained: false,
  };
}

function sanitizeSanitization(value: unknown): GroundingSanitizationMetadata {
  const record = isRecord(value) ? value : {};
  const redacted = Array.isArray(record.redacted)
    ? record.redacted
        .filter((item): item is string => typeof item === "string")
        .map((item) => boundedRequired(item, GROUNDING_REF_LABEL_LIMIT))
        .filter(isNonEmptyString)
        .slice(0, METADATA_ARRAY_LIMIT)
    : undefined;
  const rejectedReason = typeof record.rejectedReason === "string"
    ? boundedRequired(record.rejectedReason, GROUNDING_REF_SUMMARY_LIMIT)
    : undefined;
  return {
    ...defaultSanitization(),
    ...(redacted && redacted.length > 0 ? { redacted } : {}),
    ...(rejectedReason ? { rejectedReason } : {}),
  };
}

function defaultSanitization(): GroundingSanitizationMetadata {
  return {
    sanitized: true,
    rawRetained: false,
    labelLimit: GROUNDING_REF_LABEL_LIMIT,
    summaryLimit: GROUNDING_REF_SUMMARY_LIMIT,
    refLimit: GROUNDING_REF_REF_LIMIT,
    metadataKeyLimit: GROUNDING_METADATA_KEY_LIMIT,
    metadataDepthLimit: GROUNDING_METADATA_DEPTH_LIMIT,
    metadataStringLimit: GROUNDING_METADATA_STRING_LIMIT,
  };
}

function sanitizeEvidenceRef(value: EvidenceRef | undefined): EvidenceRef | undefined {
  if (!isGroundingEvidenceRef(value)) {
    return undefined;
  }
  const metadata = sanitizeGroundingMetadata(value.metadata);
  return {
    type: value.type,
    ref: boundedRequired(value.ref, GROUNDING_REF_REF_LIMIT),
    ...stringField("label", value.label, GROUNDING_REF_LABEL_LIMIT),
    ...stringField("summary", value.summary, GROUNDING_REF_SUMMARY_LIMIT),
    ...(metadata ? { metadata } : {}),
  };
}

function sanitizeSourceRef(
  value: RuntimeTraceSourceRef | undefined,
): RuntimeTraceSourceRef | undefined {
  if (!isRuntimeTraceSourceRef(value)) {
    return undefined;
  }
  return {
    ...stringField("file", value.file),
    ...(isFiniteNumber(value.startLine)
      ? { startLine: Math.max(0, value.startLine) }
      : {}),
    ...(isFiniteNumber(value.endLine)
      ? { endLine: Math.max(0, value.endLine) }
      : {}),
    ...stringField("symbol", value.symbol, GROUNDING_REF_LABEL_LIMIT),
    ...stringField("commit", value.commit, 64),
    ...stringField("diffHash", value.diffHash, GROUNDING_REF_LABEL_LIMIT),
  };
}

function sanitizeMetadataObject(
  value: Record<string, unknown>,
  depth: number,
): RuntimeCoreJsonObject {
  if (depth >= GROUNDING_METADATA_DEPTH_LIMIT) {
    return {};
  }
  const out: RuntimeCoreJsonObject = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(
    0,
    GROUNDING_METADATA_KEY_LIMIT,
  )) {
    const key = boundedRequired(rawKey, METADATA_KEY_LIMIT);
    if (!key || isRawGroundingMetadataKey(key)) {
      continue;
    }
    const child = sanitizeMetadataValue(rawValue, depth + 1);
    if (child !== undefined) {
      out[key] = child;
    }
  }
  return out;
}

function sanitizeMetadataValue(
  value: unknown,
  depth: number,
): RuntimeCoreJsonValue | undefined {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === "string") {
    if (isRawGroundingMetadataText(value)) {
      return undefined;
    }
    return boundedRequired(value, GROUNDING_METADATA_STRING_LIMIT);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, METADATA_ARRAY_LIMIT)
      .flatMap((item) => {
        const child = sanitizeMetadataValue(item, depth + 1);
        return child === undefined ? [] : [child];
      });
  }
  if (isPlainRecord(value)) {
    return sanitizeMetadataObject(value, depth);
  }
  return undefined;
}

function isRawGroundingMetadataKey(key: string): boolean {
  const compact = key.replace(/[._\-\s]+/gu, "");
  return GROUNDING_RAW_METADATA_KEY_PATTERN.test(key) ||
    GROUNDING_RAW_METADATA_KEY_PATTERN.test(compact);
}

function isRawGroundingMetadataText(value: string): boolean {
  const normalized = value.replace(/[_\-]+/gu, " ");
  return rejectRawRuntimeMemoryInput(value) !== undefined ||
    GROUNDING_RAW_METADATA_TEXT_PATTERN.test(value) ||
    GROUNDING_RAW_METADATA_TEXT_PATTERN.test(normalized) ||
    GROUNDING_AUTHORITY_METADATA_TEXT_PATTERN.test(value) ||
    GROUNDING_AUTHORITY_METADATA_TEXT_PATTERN.test(normalized);
}

function summaryItemFromRef(ref: GroundingRef, index: number): GroundingSummaryItem {
  return {
    id: ref.id,
    canonicalKey: ref.canonicalKey,
    kind: ref.kind,
    ref: ref.ref,
    ...stringField("label", ref.label, GROUNDING_REF_LABEL_LIMIT),
    summary: boundedRequired(
      ref.summary ?? `${ref.kind} ${ref.ref}`,
      GROUNDING_REF_SUMMARY_LIMIT,
    ),
    trust: ref.trust,
    authority: GROUNDING_REF_AUTHORITY,
    sourceSurface: ref.projection.sourceSurface,
    sourceField: ref.projection.sourceField,
    rank: index + 1,
    ...(ref.timestamp !== undefined ? { timestamp: ref.timestamp } : {}),
    ...(ref.metadata ? { metadata: ref.metadata } : {}),
  };
}

function buildSummaryItems(
  input: readonly GroundingSummaryItem[],
  params: { limit?: number; tokenBudget: number },
): { items: GroundingSummaryItem[]; estimatedTokens: number } {
  const limit = Math.min(
    RESULT_ITEM_LIMIT,
    Math.max(0, Math.floor(params.limit ?? RESULT_ITEM_LIMIT)),
  );
  const items: GroundingSummaryItem[] = [];
  let estimatedTokens = 0;

  for (const item of input.slice(0, limit).map(sanitizeSummaryItem)) {
    const nextTokens = estimateTokens(item.summary);
    if (items.length > 0 && estimatedTokens + nextTokens > params.tokenBudget) {
      continue;
    }
    if (estimatedTokens + nextTokens > params.tokenBudget) {
      const available = params.tokenBudget - estimatedTokens;
      if (available <= 0) {
        continue;
      }
      item.summary = truncateToTokenBudget(item.summary, available);
    }
    if (!isGroundingSummaryItem(item)) {
      continue;
    }
    items.push(item);
    estimatedTokens += estimateTokens(item.summary);
  }
  return { items, estimatedTokens };
}

function sanitizeSummaryItem(value: GroundingSummaryItem): GroundingSummaryItem {
  const metadata = sanitizeGroundingMetadata(value.metadata);
  return {
    id: boundedRequired(value.id, GROUNDING_REF_REF_LIMIT),
    canonicalKey: boundedRequired(value.canonicalKey, GROUNDING_REF_REF_LIMIT),
    kind: value.kind,
    ref: boundedRequired(value.ref, GROUNDING_REF_REF_LIMIT),
    ...stringField("label", value.label, GROUNDING_REF_LABEL_LIMIT),
    summary: boundedRequired(value.summary, GROUNDING_REF_SUMMARY_LIMIT),
    trust: value.trust,
    authority: GROUNDING_REF_AUTHORITY,
    sourceSurface: boundedFallback(value.sourceSurface, "unknown"),
    sourceField: boundedFallback(value.sourceField, "unknown"),
    rank: isFiniteNumber(value.rank) ? value.rank : 0,
    ...(isFiniteNumber(value.timestamp) ? { timestamp: value.timestamp } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function stringField<Key extends string>(
  key: Key,
  value: unknown,
  limit = GROUNDING_REF_REF_LIMIT,
): Partial<Record<Key, string>> {
  if (typeof value !== "string") {
    return {};
  }
  const bounded = boundedRequired(value, limit);
  return bounded ? { [key]: bounded } as Partial<Record<Key, string>> : {};
}

function boundedFallback(value: unknown, fallback: string): string {
  const bounded = typeof value === "string"
    ? boundedRequired(value, GROUNDING_REF_REF_LIMIT)
    : "";
  return bounded || fallback;
}

function boundedRequired(value: string, maxLength: number): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  if (maxLength <= 1) {
    return trimmed.slice(0, maxLength);
  }
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  return boundedRequired(text, Math.max(0, tokenBudget * TOKEN_CHAR_WIDTH));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHAR_WIDTH);
}
