import {
  buildEvidenceRefFixture,
  isEvidenceRef,
  type EvidenceRef,
} from "./evidence.js";
import {
  isContextItem,
  isFiniteNumber,
  isNonEmptyString,
  isOptionalFiniteNumber,
  isOptionalString,
  isRecord,
  isRuntimeCoreJsonObject,
  type ContextItem,
  type RuntimeCoreJsonObject,
  type RuntimeCoreJsonValue,
} from "./types.js";

export const RUNTIME_MEMORY_EPISODE_KINDS = [
  "task_event",
  "tool_result",
  "test_output",
  "verifier_summary",
  "trace_summary",
  "human_confirmation",
  "deterministic_rule",
  "other",
] as const;

export type RuntimeMemoryEpisodeKind =
  typeof RUNTIME_MEMORY_EPISODE_KINDS[number];

export const RUNTIME_MEMORY_SOURCE_REF_TYPES = [
  "event",
  "tool",
  "test",
  "verifier",
  "trace",
  "human",
  "file",
  "symbol",
  "checkpoint",
  "deterministic_rule",
  "other",
] as const;

export type RuntimeMemorySourceRefType =
  typeof RUNTIME_MEMORY_SOURCE_REF_TYPES[number];

export const RUNTIME_MEMORY_FACT_SOURCES = [
  "task_event",
  "tool_result",
  "test_output",
  "verifier_summary",
  "trace_summary",
  "human_confirmation",
  "deterministic_rule",
  "other",
] as const;

export type RuntimeMemoryFactSource =
  typeof RUNTIME_MEMORY_FACT_SOURCES[number];

export const RUNTIME_MEMORY_VERIFICATION_STATUSES = [
  "candidate",
  "verified",
  "human_approved",
  "deterministic_rule",
  "rejected",
  "invalidated",
] as const;

export type RuntimeMemoryVerificationStatus =
  typeof RUNTIME_MEMORY_VERIFICATION_STATUSES[number];

export const RUNTIME_MEMORY_ACCEPTED_VERIFICATION_STATUSES = [
  "verified",
  "human_approved",
  "deterministic_rule",
] as const satisfies readonly RuntimeMemoryVerificationStatus[];

export type RuntimeMemoryAcceptedVerificationStatus =
  typeof RUNTIME_MEMORY_ACCEPTED_VERIFICATION_STATUSES[number];

export const RUNTIME_MEMORY_INVALIDATION_REASONS = [
  "superseded",
  "contradicted",
  "expired",
  "retracted",
  "evidence_failed",
  "human_rejected",
] as const;

export type RuntimeMemoryInvalidationReason =
  typeof RUNTIME_MEMORY_INVALIDATION_REASONS[number];

export const RUNTIME_MEMORY_RAW_INPUT_REJECTION_REASONS = [
  "raw_chat_log",
  "raw_transcript",
  "raw_trace_dump",
  "prompt",
  "full_payload",
  "full_tool_args",
  "full_tool_output",
  "env",
  "secret",
  "trace_baggage",
  "trace_tracestate",
] as const;

export type RuntimeMemoryRawInputRejectionReason =
  typeof RUNTIME_MEMORY_RAW_INPUT_REJECTION_REASONS[number];

/**
 * Memory taxonomy (LangMem + Letta inspired). Each fact is classified into one
 * of three types that drive different eviction, retrieval, and consolidation
 * behavior in later phases:
 *
 * - `semantic`: stable facts (user preferences, attributes, knowledge). High
 *   importance weight, slow eviction. Default when omitted.
 * - `episodic`: time-bound events ("when X happened"). Time-decay weighted,
 *   medium eviction priority.
 * - `procedural`: learned behaviors (what worked / what didn't, derived from
 *   user feedback). Highest retention priority — never evict unless refuted.
 *
 * The field is optional on the candidate so existing callers continue to work
 * unchanged; the persistence layer defaults missing values to "semantic" both
 * in the DB column default and in the `record_json` re-hydration path.
 */
export const RUNTIME_MEMORY_TYPES = [
  "semantic",
  "episodic",
  "procedural",
] as const;

export type RuntimeMemoryType = typeof RUNTIME_MEMORY_TYPES[number];

export function isRuntimeMemoryType(value: unknown): value is RuntimeMemoryType {
  return (
    typeof value === "string" &&
    (RUNTIME_MEMORY_TYPES as readonly string[]).includes(value)
  );
}

export const DEFAULT_RUNTIME_MEMORY_TYPE: RuntimeMemoryType = "semantic";

export const RUNTIME_MEMORY_CONTEXT_FLAG_PATHS = {
  shadow: "runtime.memory.shadow",
  provider: "runtime.memory.provider",
  proposeFacts: "runtime.memory.proposeFacts",
  persist: "runtime.memory.persist",
} as const;

export type RuntimeMemoryFeatureFlag =
  keyof typeof RUNTIME_MEMORY_CONTEXT_FLAG_PATHS;

export type RuntimeMemoryFeatureFlags = Record<
  RuntimeMemoryFeatureFlag,
  boolean
>;

export const DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS = {
  shadow: false,
  provider: false,
  proposeFacts: false,
  persist: false,
} as const satisfies RuntimeMemoryFeatureFlags;

export type RuntimeMemorySourceRef = {
  type: RuntimeMemorySourceRefType;
  ref: string;
  label?: string;
  file?: string;
  symbol?: string;
  eventId?: string;
  toolCallId?: string;
  traceId?: string;
  spanId?: string;
  metadata?: RuntimeCoreJsonObject;
};

export type RuntimeMemorySourceEpisodeRef = {
  episodeId: string;
  taskId?: string;
  kind?: RuntimeMemoryEpisodeKind;
  idempotencyKey?: string;
  reference_time?: number;
};

export type RuntimeMemoryEpisodeRecord = {
  schemaVersion: 1;
  episodeId: string;
  taskId: string;
  kind: RuntimeMemoryEpisodeKind;
  reference_time: number;
  idempotencyKey: string;
  boundedSummary: string;
  sourceRefs: RuntimeMemorySourceRef[];
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
  redactionStatus: "sanitized";
};

export type RuntimeMemoryTemporalFields = {
  valid_at: number;
  invalid_at?: number;
  expired_at?: number;
  reference_time: number;
};

export type RuntimeMemoryFactPromotionEvidence = {
  promotedBy: "verifier" | "human" | "deterministic_rule";
  evidenceRefs: EvidenceRef[];
  approvedBy?: string;
  ruleId?: string;
};

export type RuntimeMemoryTemporalFactCandidate = RuntimeMemoryTemporalFields & {
  schemaVersion: 1;
  factId: string;
  taskId?: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  confidence: number;
  source: RuntimeMemoryFactSource;
  verificationStatus: RuntimeMemoryVerificationStatus;
  sourceEpisodeRefs: RuntimeMemorySourceEpisodeRef[];
  evidenceRefs: EvidenceRef[];
  proposedAt: number;
  memoryType?: RuntimeMemoryType;
  metadata?: RuntimeCoreJsonObject;
  // S0-1: Schema 字段回流 — 让组件之间的信息流动起来.
  // entities: LLM-extracted entity list (Person/Preference/Location/Event/Topic/...).
  //   EntityStore reads this field directly instead of re-running regex extraction,
  //   eliminating the Extraction→EntityStore duplicated-work coupling break.
  //   Source: Hindsight ProcessedFact.entities[] / Mem0 entity_store / Zep schema.
  entities?: string[];
  // proofCount: number of raw pre-consolidation facts merged into this fact.
  //   applyFinalBoost reads this for the combined_score = CE × recency × temporal × proof_count formula.
  //   Source: Hindsight observation consolidation (source_memory_ids + proof_count).
  proofCount?: number;
  // sourceMemoryIds: raw fact IDs that were merged into this consolidated fact.
  //   Enables provenance tracing and EntityStore reverse lookup.
  //   Source: Hindsight source_memory_ids / Zep EntityEdge.episodes[].
  sourceMemoryIds?: string[];
  // P1-3 (Memobase Topic/SubTopic schema): high-level topic classification.
  //   Used for topic-filtered retrieval and per-topic budget allocation.
  //   Source: memobase-main/memobase/profile/schema.py TopicType.
  topic?: string;
  // P1-3: finer-grained label within a topic (e.g., "pet" under "family").
  subTopic?: string;
};

export type RuntimeMemoryTemporalFact = Omit<
  RuntimeMemoryTemporalFactCandidate,
  "verificationStatus" | "proposedAt"
> & {
  verificationStatus: RuntimeMemoryAcceptedVerificationStatus;
  acceptedAt: number;
  promotion: RuntimeMemoryFactPromotionEvidence;
};

export type RuntimeMemoryInvalidationProposal = {
  schemaVersion: 1;
  invalidationId: string;
  factId: string;
  reason: RuntimeMemoryInvalidationReason;
  invalid_at: number;
  reference_time: number;
  proposedBy: RuntimeMemoryFactSource;
  verificationStatus: RuntimeMemoryVerificationStatus;
  sourceEpisodeRefs: RuntimeMemorySourceEpisodeRef[];
  evidenceRefs: EvidenceRef[];
  replacementFactId?: string;
  metadata?: RuntimeCoreJsonObject;
};

// P1-1 (Hindsight Memory Graph causal edges): add causal relation types.
// Source: hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/memory_graph.py
// - causes: A directly causes B (e.g., "started new job" → "moved to new city")
// - caused_by: inverse of causes (B happened because of A)
// - enables: A makes B possible (e.g., "got driver license" → "rented a car")
// - prevents: A stops B from happening (e.g., "allergic to peanuts" → "avoided pad thai")
// These feed weightedGraphTraversal's causal_score (third additive component
// alongside entity_score and semantic_score), enabling multi-hop reasoning
// over causal chains rather than just entity co-occurrence.
export const RUNTIME_MEMORY_RELATION_TYPES = [
  "supersedes",
  "contradicts",
  "related_to",
  "causes",
  "caused_by",
  "enables",
  "prevents",
] as const;

export type RuntimeMemoryRelationType =
  typeof RUNTIME_MEMORY_RELATION_TYPES[number];

export function isRuntimeMemoryRelationType(
  value: unknown,
): value is RuntimeMemoryRelationType {
  return (
    typeof value === "string" &&
    (RUNTIME_MEMORY_RELATION_TYPES as readonly string[]).includes(value)
  );
}

export type RuntimeMemoryFactRelation = {
  relationId: string;
  sourceFactId: string;
  targetFactId: string;
  relationType: RuntimeMemoryRelationType;
  confidence: number;
  metadata?: RuntimeCoreJsonObject;
  createdAt: number;
};

export type RuntimeMemoryFactQuery = {
  taskId?: string;
  subject?: string;
  predicate?: string;
  sourceEpisodeId?: string;
  evidenceRef?: string;
  reference_time?: number;
  includeCandidates?: boolean;
  includeRejected?: boolean;
  includeInvalidated?: boolean;
  includeExpired?: boolean;
  verificationStatuses?: RuntimeMemoryVerificationStatus[];
  limit?: number;
};

export type RuntimeMemorySummaryItem = RuntimeMemoryTemporalFields & {
  factId: string;
  taskId?: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  verificationStatus: RuntimeMemoryVerificationStatus;
  sourceEpisodeRefs: RuntimeMemorySourceEpisodeRef[];
  evidenceRefs: EvidenceRef[];
  rank: number;
  summary: string;
};

export type RuntimeMemorySummary = {
  items: RuntimeMemorySummaryItem[];
  omittedFactCount: number;
  tokenBudget: number;
  estimatedTokens: number;
  readonly: true;
};

export type RuntimeMemoryContextProviderQuery = RuntimeMemoryFactQuery & {
  tokenBudget?: number;
};

export type RuntimeMemoryContextProviderResult = {
  contextItems: ContextItem[];
  summary: RuntimeMemorySummary;
  evidenceRefs: EvidenceRef[];
  readonly: true;
};

export type RuntimeMemoryProvider = {
  readonly id: "runtime-memory";
  getMemoryContext: (
    query: RuntimeMemoryContextProviderQuery,
  ) =>
    | RuntimeMemoryContextProviderResult
    | Promise<RuntimeMemoryContextProviderResult>;
};

export type RuntimeMemoryInputRejection = {
  accepted: false;
  reason: RuntimeMemoryRawInputRejectionReason;
  message: string;
};

export type RuntimeMemorySanitizedText = {
  accepted: true;
  text: string;
  redactions: number;
};

export type RuntimeMemorySanitizedTextResult =
  | RuntimeMemorySanitizedText
  | RuntimeMemoryInputRejection;

export type RuntimeMemorySanitizationResult<T> =
  | { accepted: true; value: T }
  | RuntimeMemoryInputRejection;

export type RuntimeMemoryQueryableFact =
  | RuntimeMemoryTemporalFact
  | RuntimeMemoryTemporalFactCandidate;

const EPISODE_KIND_SET = new Set<RuntimeMemoryEpisodeKind>(
  RUNTIME_MEMORY_EPISODE_KINDS,
);
const SOURCE_REF_TYPE_SET = new Set<RuntimeMemorySourceRefType>(
  RUNTIME_MEMORY_SOURCE_REF_TYPES,
);
const FACT_SOURCE_SET = new Set<RuntimeMemoryFactSource>(
  RUNTIME_MEMORY_FACT_SOURCES,
);
const VERIFICATION_STATUS_SET = new Set<RuntimeMemoryVerificationStatus>(
  RUNTIME_MEMORY_VERIFICATION_STATUSES,
);
const ACCEPTED_VERIFICATION_STATUS_SET =
  new Set<RuntimeMemoryAcceptedVerificationStatus>(
    RUNTIME_MEMORY_ACCEPTED_VERIFICATION_STATUSES,
  );
const INVALIDATION_REASON_SET = new Set<RuntimeMemoryInvalidationReason>(
  RUNTIME_MEMORY_INVALIDATION_REASONS,
);
const REJECTION_REASON_SET = new Set<RuntimeMemoryRawInputRejectionReason>(
  RUNTIME_MEMORY_RAW_INPUT_REJECTION_REASONS,
);

const MAX_TEXT_LENGTH = 512;
const MAX_LABEL_LENGTH = 256;
const MAX_METADATA_KEYS = 24;
const MAX_METADATA_DEPTH = 3;
const MAX_METADATA_STRING_LENGTH = 256;
const DEFAULT_MEMORY_SUMMARY_TOKEN_BUDGET = 256;
const TOKEN_CHAR_WIDTH = 4;

const RAW_TEXT_PATTERNS = [
  {
    reason: "raw_chat_log",
    pattern: /(^|\n)\s*(system|user|assistant|tool)\s*:\s+/i,
  },
  {
    reason: "raw_chat_log",
    pattern: /"role"\s*:\s*"(system|user|assistant|tool)"/i,
  },
  {
    reason: "raw_transcript",
    pattern: /\b(raw\s+transcript|transcript|\.jsonl|conversation log)\b/i,
  },
  {
    reason: "raw_trace_dump",
    pattern: /\b(raw\s+trace|trace dump|traceparent|span dump)\b/i,
  },
  {
    reason: "prompt",
    pattern: /\b(prompt dump|system prompt|developer prompt|raw prompt|subagent|template)\b/i,
  },
  {
    reason: "full_payload",
    pattern: /\bfull payload\b|\bpayload\s*[:=]|"payload"\s*:/i,
  },
  {
    reason: "full_tool_args",
    pattern: /\b(toolArgs|tool args|full tool args)\b/i,
  },
  {
    reason: "full_tool_output",
    pattern: /\b(toolOutput|tool output|stdout|stderr|command output)\b/i,
  },
  {
    reason: "env",
    pattern: /\b(process\.env|environment variables?|OPENAI_API_KEY)\b/i,
  },
  {
    reason: "trace_baggage",
    pattern: /\bbaggage\s*[:=]/i,
  },
  {
    reason: "trace_tracestate",
    pattern: /\btracestate\s*[:=]/i,
  },
  {
    reason: "secret",
    pattern: /\b(secret|api[-_ ]?key|authorization|password|bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]{8,})\b/i,
  },
] as const satisfies readonly {
  reason: RuntimeMemoryRawInputRejectionReason;
  pattern: RegExp;
}[];

const SENSITIVE_METADATA_KEY_PATTERN =
  /(rawChat|raw chat|chatLog|chat log|transcript|jsonl|rawTrace|trace dump|prompt|subagent|template|payload|toolArgs|tool args|toolOutput|tool output|stdout|stderr|process\.env|env|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|authorization|password|baggage|tracestate|traceparent)/i;

export function isRuntimeMemoryEpisodeKind(
  value: unknown,
): value is RuntimeMemoryEpisodeKind {
  return (
    typeof value === "string" &&
    EPISODE_KIND_SET.has(value as RuntimeMemoryEpisodeKind)
  );
}

export function isRuntimeMemorySourceRefType(
  value: unknown,
): value is RuntimeMemorySourceRefType {
  return (
    typeof value === "string" &&
    SOURCE_REF_TYPE_SET.has(value as RuntimeMemorySourceRefType)
  );
}

export function isRuntimeMemoryFactSource(
  value: unknown,
): value is RuntimeMemoryFactSource {
  return (
    typeof value === "string" &&
    FACT_SOURCE_SET.has(value as RuntimeMemoryFactSource)
  );
}

export function isRuntimeMemoryVerificationStatus(
  value: unknown,
): value is RuntimeMemoryVerificationStatus {
  return (
    typeof value === "string" &&
    VERIFICATION_STATUS_SET.has(value as RuntimeMemoryVerificationStatus)
  );
}

export function isRuntimeMemoryAcceptedVerificationStatus(
  value: unknown,
): value is RuntimeMemoryAcceptedVerificationStatus {
  return (
    typeof value === "string" &&
    ACCEPTED_VERIFICATION_STATUS_SET.has(
      value as RuntimeMemoryAcceptedVerificationStatus,
    )
  );
}

export function isRuntimeMemoryInvalidationReason(
  value: unknown,
): value is RuntimeMemoryInvalidationReason {
  return (
    typeof value === "string" &&
    INVALIDATION_REASON_SET.has(value as RuntimeMemoryInvalidationReason)
  );
}

export function isRuntimeMemoryRawInputRejectionReason(
  value: unknown,
): value is RuntimeMemoryRawInputRejectionReason {
  return (
    typeof value === "string" &&
    REJECTION_REASON_SET.has(value as RuntimeMemoryRawInputRejectionReason)
  );
}

export function isRuntimeMemorySourceRef(
  value: unknown,
): value is RuntimeMemorySourceRef {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isRuntimeMemorySourceRefType(value.type) &&
    isNonEmptyString(value.ref) &&
    isOptionalString(value.label) &&
    isOptionalString(value.file) &&
    isOptionalString(value.symbol) &&
    isOptionalString(value.eventId) &&
    isOptionalString(value.toolCallId) &&
    isOptionalString(value.traceId) &&
    isOptionalString(value.spanId) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isRuntimeMemorySourceEpisodeRef(
  value: unknown,
): value is RuntimeMemorySourceEpisodeRef {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.episodeId) &&
    isOptionalString(value.taskId) &&
    (value.kind === undefined || isRuntimeMemoryEpisodeKind(value.kind)) &&
    isOptionalString(value.idempotencyKey) &&
    isOptionalFiniteNumber(value.reference_time)
  );
}

export function isRuntimeMemoryEpisodeRecord(
  value: unknown,
): value is RuntimeMemoryEpisodeRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    isNonEmptyString(value.episodeId) &&
    isNonEmptyString(value.taskId) &&
    isRuntimeMemoryEpisodeKind(value.kind) &&
    isFiniteNumber(value.reference_time) &&
    isNonEmptyString(value.idempotencyKey) &&
    isNonEmptyString(value.boundedSummary) &&
    nonEmptyArrayEvery(value.sourceRefs, isRuntimeMemorySourceRef) &&
    nonEmptyArrayEvery(value.evidenceRefs, isEvidenceRef) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata)) &&
    value.redactionStatus === "sanitized"
  );
}

export function isRuntimeMemoryTemporalFields(
  value: unknown,
): value is RuntimeMemoryTemporalFields {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isFiniteNumber(value.valid_at) &&
    isOptionalFiniteNumber(value.invalid_at) &&
    isOptionalFiniteNumber(value.expired_at) &&
    isFiniteNumber(value.reference_time)
  );
}

export function isRuntimeMemoryFactPromotionEvidence(
  value: unknown,
): value is RuntimeMemoryFactPromotionEvidence {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.promotedBy === "verifier" ||
      value.promotedBy === "human" ||
      value.promotedBy === "deterministic_rule") &&
    nonEmptyArrayEvery(value.evidenceRefs, isEvidenceRef) &&
    isOptionalString(value.approvedBy) &&
    isOptionalString(value.ruleId)
  );
}

export function isRuntimeMemoryTemporalFactCandidate(
  value: unknown,
): value is RuntimeMemoryTemporalFactCandidate {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    isNonEmptyString(value.factId) &&
    isOptionalString(value.taskId) &&
    isNonEmptyString(value.subject) &&
    isNonEmptyString(value.predicate) &&
    isNonEmptyString(value.objectSummary) &&
    isFiniteNumber(value.confidence) &&
    Number(value.confidence) >= 0 &&
    Number(value.confidence) <= 1 &&
    isRuntimeMemoryFactSource(value.source) &&
    isRuntimeMemoryVerificationStatus(value.verificationStatus) &&
    hasRuntimeMemoryTemporalFields(value) &&
    nonEmptyArrayEvery(value.sourceEpisodeRefs, isRuntimeMemorySourceEpisodeRef) &&
    nonEmptyArrayEvery(value.evidenceRefs, isEvidenceRef) &&
    isFiniteNumber(value.proposedAt) &&
    (value.memoryType === undefined || isRuntimeMemoryType(value.memoryType)) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isRuntimeMemoryTemporalFact(
  value: unknown,
): value is RuntimeMemoryTemporalFact {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isRuntimeMemoryTemporalFactCandidate({
      ...value,
      proposedAt: isFiniteNumber(value.acceptedAt) ? value.acceptedAt : 0,
    }) &&
    isRuntimeMemoryAcceptedVerificationStatus(value.verificationStatus) &&
    isFiniteNumber(value.acceptedAt) &&
    isRuntimeMemoryFactPromotionEvidence(value.promotion)
  );
}

export function isRuntimeMemoryInvalidationProposal(
  value: unknown,
): value is RuntimeMemoryInvalidationProposal {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    isNonEmptyString(value.invalidationId) &&
    isNonEmptyString(value.factId) &&
    isRuntimeMemoryInvalidationReason(value.reason) &&
    isFiniteNumber(value.invalid_at) &&
    isFiniteNumber(value.reference_time) &&
    isRuntimeMemoryFactSource(value.proposedBy) &&
    isRuntimeMemoryVerificationStatus(value.verificationStatus) &&
    nonEmptyArrayEvery(value.sourceEpisodeRefs, isRuntimeMemorySourceEpisodeRef) &&
    nonEmptyArrayEvery(value.evidenceRefs, isEvidenceRef) &&
    isOptionalString(value.replacementFactId) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isRuntimeMemoryFactQuery(
  value: unknown,
): value is RuntimeMemoryFactQuery {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isOptionalString(value.taskId) &&
    isOptionalString(value.subject) &&
    isOptionalString(value.predicate) &&
    isOptionalString(value.sourceEpisodeId) &&
    isOptionalString(value.evidenceRef) &&
    isOptionalFiniteNumber(value.reference_time) &&
    optionalBoolean(value.includeCandidates) &&
    optionalBoolean(value.includeRejected) &&
    optionalBoolean(value.includeInvalidated) &&
    optionalBoolean(value.includeExpired) &&
    (value.verificationStatuses === undefined ||
      (Array.isArray(value.verificationStatuses) &&
        value.verificationStatuses.every(isRuntimeMemoryVerificationStatus))) &&
    (value.limit === undefined ||
      (Number.isInteger(value.limit) && Number(value.limit) >= 0))
  );
}

export function isRuntimeMemorySummaryItem(
  value: unknown,
): value is RuntimeMemorySummaryItem {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.factId) &&
    isOptionalString(value.taskId) &&
    isNonEmptyString(value.subject) &&
    isNonEmptyString(value.predicate) &&
    isNonEmptyString(value.objectSummary) &&
    isRuntimeMemoryVerificationStatus(value.verificationStatus) &&
    hasRuntimeMemoryTemporalFields(value) &&
    nonEmptyArrayEvery(value.sourceEpisodeRefs, isRuntimeMemorySourceEpisodeRef) &&
    nonEmptyArrayEvery(value.evidenceRefs, isEvidenceRef) &&
    isFiniteNumber(value.rank) &&
    isNonEmptyString(value.summary)
  );
}

export function isRuntimeMemorySummary(
  value: unknown,
): value is RuntimeMemorySummary {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Array.isArray(value.items) &&
    value.items.every(isRuntimeMemorySummaryItem) &&
    Number.isInteger(value.omittedFactCount) &&
    Number(value.omittedFactCount) >= 0 &&
    Number.isInteger(value.tokenBudget) &&
    Number(value.tokenBudget) >= 0 &&
    Number.isInteger(value.estimatedTokens) &&
    Number(value.estimatedTokens) >= 0 &&
    value.readonly === true
  );
}

export function isRuntimeMemoryContextProviderResult(
  value: unknown,
): value is RuntimeMemoryContextProviderResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Array.isArray(value.contextItems) &&
    value.contextItems.every(isContextItem) &&
    isRuntimeMemorySummary(value.summary) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef) &&
    value.readonly === true
  );
}

export function resolveRuntimeMemoryFeatureFlags(
  value: unknown,
): RuntimeMemoryFeatureFlags {
  const runtime = runtimeConfigFrom(value);
  const memory = isRecord(runtime?.memory) ? runtime.memory : undefined;
  return {
    shadow: strictFlag(memory, "shadow"),
    provider: strictFlag(memory, "provider"),
    proposeFacts: strictFlag(memory, "proposeFacts"),
    persist: strictFlag(memory, "persist"),
  };
}

export function runtimeMemoryFlagEnabled(
  value: unknown,
  flag: RuntimeMemoryFeatureFlag,
): boolean {
  return resolveRuntimeMemoryFeatureFlags(value)[flag];
}

export function rejectRawRuntimeMemoryInput(
  value: unknown,
): RuntimeMemoryInputRejection | undefined {
  const reason = classifyRawRuntimeMemoryInput(value);
  return reason ? makeRejection(reason) : undefined;
}

export function sanitizeRuntimeMemoryText(
  value: string,
  maxLength = MAX_TEXT_LENGTH,
): RuntimeMemorySanitizedTextResult {
  const rawRejection = rejectRawRuntimeMemoryInput(value);
  if (rawRejection) {
    return rawRejection;
  }
  const trimmed = value.trim();
  return {
    accepted: true,
    text: truncateString(trimmed, maxLength),
    redactions: 0,
  };
}

export function sanitizeRuntimeMemoryMetadata(
  value: unknown,
): RuntimeCoreJsonObject {
  if (!isRecord(value)) {
    return {};
  }
  return sanitizeMetadataObject(value, 0).value;
}

export function sanitizeRuntimeMemoryEpisodeRecord(
  episode: RuntimeMemoryEpisodeRecord,
): RuntimeMemorySanitizationResult<RuntimeMemoryEpisodeRecord> {
  const summary = sanitizeRuntimeMemoryText(episode.boundedSummary);
  if (!summary.accepted) {
    return summary;
  }
  return {
    accepted: true,
    value: {
      schemaVersion: 1,
      episodeId: truncateString(episode.episodeId.trim(), MAX_LABEL_LENGTH),
      taskId: truncateString(episode.taskId.trim(), MAX_LABEL_LENGTH),
      kind: episode.kind,
      reference_time: episode.reference_time,
      idempotencyKey: truncateString(
        episode.idempotencyKey.trim(),
        MAX_LABEL_LENGTH,
      ),
      boundedSummary: summary.text,
      sourceRefs: episode.sourceRefs.map(sanitizeRuntimeMemorySourceRef),
      evidenceRefs: episode.evidenceRefs.map(sanitizeEvidenceRef),
      ...(episode.metadata
        ? { metadata: sanitizeRuntimeMemoryMetadata(episode.metadata) }
        : {}),
      redactionStatus: "sanitized",
    },
  };
}

export function sanitizeRuntimeMemoryTemporalFactCandidate(
  fact: RuntimeMemoryTemporalFactCandidate,
): RuntimeMemorySanitizationResult<RuntimeMemoryTemporalFactCandidate> {
  const objectSummary = sanitizeRuntimeMemoryText(
    fact.objectSummary,
    MAX_TEXT_LENGTH,
  );
  if (!objectSummary.accepted) {
    return objectSummary;
  }
  const subject = sanitizeRuntimeMemoryText(fact.subject, MAX_LABEL_LENGTH);
  if (!subject.accepted) {
    return subject;
  }
  const predicate = sanitizeRuntimeMemoryText(fact.predicate, MAX_LABEL_LENGTH);
  if (!predicate.accepted) {
    return predicate;
  }
  return {
    accepted: true,
    value: {
      schemaVersion: 1,
      factId: truncateString(fact.factId.trim(), MAX_LABEL_LENGTH),
      ...(fact.taskId
        ? { taskId: truncateString(fact.taskId.trim(), MAX_LABEL_LENGTH) }
        : {}),
      subject: subject.text,
      predicate: predicate.text,
      objectSummary: objectSummary.text,
      confidence: clampConfidence(fact.confidence),
      source: fact.source,
      verificationStatus: fact.verificationStatus,
      valid_at: fact.valid_at,
      ...(fact.invalid_at !== undefined ? { invalid_at: fact.invalid_at } : {}),
      ...(fact.expired_at !== undefined ? { expired_at: fact.expired_at } : {}),
      reference_time: fact.reference_time,
      sourceEpisodeRefs: fact.sourceEpisodeRefs.map(
        sanitizeRuntimeMemorySourceEpisodeRef,
      ),
      evidenceRefs: fact.evidenceRefs.map(sanitizeEvidenceRef),
      proposedAt: fact.proposedAt,
      ...(fact.memoryType !== undefined
        ? { memoryType: fact.memoryType }
        : {}),
      ...(fact.metadata
        ? { metadata: sanitizeRuntimeMemoryMetadata(fact.metadata) }
        : {}),
    },
  };
}

export function sanitizeRuntimeMemoryTemporalFact(
  fact: RuntimeMemoryTemporalFact,
): RuntimeMemorySanitizationResult<RuntimeMemoryTemporalFact> {
  const candidate = sanitizeRuntimeMemoryTemporalFactCandidate({
    ...fact,
    proposedAt: fact.acceptedAt,
  });
  if (!candidate.accepted) {
    return candidate;
  }
  return {
    accepted: true,
    value: {
      ...candidate.value,
      verificationStatus: fact.verificationStatus,
      acceptedAt: fact.acceptedAt,
      promotion: sanitizeRuntimeMemoryFactPromotionEvidence(fact.promotion),
    },
  };
}

export function sanitizeRuntimeMemoryInvalidationProposal(
  proposal: RuntimeMemoryInvalidationProposal,
): RuntimeMemorySanitizationResult<RuntimeMemoryInvalidationProposal> {
  return {
    accepted: true,
    value: {
      schemaVersion: 1,
      invalidationId: truncateString(
        proposal.invalidationId.trim(),
        MAX_LABEL_LENGTH,
      ),
      factId: truncateString(proposal.factId.trim(), MAX_LABEL_LENGTH),
      reason: proposal.reason,
      invalid_at: proposal.invalid_at,
      reference_time: proposal.reference_time,
      proposedBy: proposal.proposedBy,
      verificationStatus: proposal.verificationStatus,
      sourceEpisodeRefs: proposal.sourceEpisodeRefs.map(
        sanitizeRuntimeMemorySourceEpisodeRef,
      ),
      evidenceRefs: proposal.evidenceRefs.map(sanitizeEvidenceRef),
      ...(proposal.replacementFactId
        ? {
            replacementFactId: truncateString(
              proposal.replacementFactId.trim(),
              MAX_LABEL_LENGTH,
            ),
          }
        : {}),
      ...(proposal.metadata
        ? { metadata: sanitizeRuntimeMemoryMetadata(proposal.metadata) }
        : {}),
    },
  };
}

export function dedupeRuntimeMemoryEpisodes(
  episodes: readonly RuntimeMemoryEpisodeRecord[],
): RuntimeMemoryEpisodeRecord[] {
  const seen = new Set<string>();
  const out: RuntimeMemoryEpisodeRecord[] = [];
  for (const episode of episodes) {
    if (!isRuntimeMemoryEpisodeRecord(episode)) {
      continue;
    }
    const sanitized = sanitizeRuntimeMemoryEpisodeRecord(episode);
    if (!sanitized.accepted) {
      continue;
    }
    const key = sanitized.value.idempotencyKey || sanitized.value.episodeId;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(sanitized.value);
  }
  return out;
}

export function isRuntimeMemoryFactValidAt(
  fact: RuntimeMemoryQueryableFact,
  referenceTime: number,
  options: Pick<
    RuntimeMemoryFactQuery,
    "includeExpired" | "includeInvalidated"
  > = {},
): boolean {
  if (fact.valid_at > referenceTime) {
    return false;
  }
  if (
    options.includeInvalidated !== true &&
    fact.invalid_at !== undefined &&
    fact.invalid_at <= referenceTime
  ) {
    return false;
  }
  if (
    options.includeExpired !== true &&
    fact.expired_at !== undefined &&
    fact.expired_at <= referenceTime
  ) {
    return false;
  }
  return true;
}

export function findRuntimeMemoryFacts(
  facts: readonly RuntimeMemoryQueryableFact[],
  query: RuntimeMemoryFactQuery = {},
): RuntimeMemoryQueryableFact[] {
  const referenceTime = query.reference_time ?? Date.now();
  const matched = facts
    .flatMap((fact) => sanitizeQueryableFact(fact))
    .filter((fact) => matchesRuntimeMemoryFact(fact, query, referenceTime));
  const ranked = rankRuntimeMemoryFacts(matched, query);
  return query.limit === undefined ? ranked : ranked.slice(0, query.limit);
}

export function rankRuntimeMemoryFacts(
  facts: readonly RuntimeMemoryQueryableFact[],
  query: RuntimeMemoryFactQuery = {},
): RuntimeMemoryQueryableFact[] {
  return [...facts]
    .map((fact, index) => ({
      fact,
      index,
      rank: runtimeMemoryFactRank(fact, query),
    }))
    .sort((left, right) => {
      const rank = right.rank - left.rank;
      if (rank !== 0) {
        return rank;
      }
      const time = right.fact.valid_at - left.fact.valid_at;
      if (time !== 0) {
        return time;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.fact);
}

export function summarizeRuntimeMemoryFacts(
  facts: readonly RuntimeMemoryQueryableFact[],
  params: RuntimeMemoryFactQuery & { tokenBudget?: number } = {},
): RuntimeMemorySummary {
  const tokenBudget = Math.max(
    0,
    Math.floor(params.tokenBudget ?? DEFAULT_MEMORY_SUMMARY_TOKEN_BUDGET),
  );
  const matched = findRuntimeMemoryFacts(facts, params);
  const items: RuntimeMemorySummaryItem[] = [];
  let estimatedTokens = 0;

  for (const fact of matched) {
    const item = buildRuntimeMemorySummaryItem(fact, params);
    const nextTokens = estimateTokens(item.summary);
    if (items.length > 0 && estimatedTokens + nextTokens > tokenBudget) {
      continue;
    }
    if (estimatedTokens + nextTokens > tokenBudget) {
      const available = Math.max(0, tokenBudget - estimatedTokens);
      if (available === 0) {
        continue;
      }
      const truncated = {
        ...item,
        summary: truncateToTokenBudget(item.summary, available),
      };
      items.push(truncated);
      estimatedTokens += estimateTokens(truncated.summary);
      continue;
    }
    items.push(item);
    estimatedTokens += nextTokens;
  }

  return {
    items,
    omittedFactCount: Math.max(0, matched.length - items.length),
    tokenBudget,
    estimatedTokens,
    readonly: true,
  };
}

export function buildRuntimeMemoryEpisodeFixture(
  overrides: Partial<RuntimeMemoryEpisodeRecord> = {},
): RuntimeMemoryEpisodeRecord {
  const episode: RuntimeMemoryEpisodeRecord = {
    schemaVersion: 1,
    episodeId: "episode_1",
    taskId: "task_1",
    kind: "tool_result",
    reference_time: 10,
    idempotencyKey: "task_1:tool_result:tool_call_1",
    boundedSummary: "Tool result confirmed the runtime-core memory contract.",
    sourceRefs: [
      {
        type: "tool",
        ref: "tool_call_1",
        toolCallId: "tool_call_1",
      },
    ],
    evidenceRefs: [
      buildEvidenceRefFixture({ type: "tool", ref: "tool_call_1" }),
    ],
    redactionStatus: "sanitized",
    ...overrides,
  };
  const sanitized = sanitizeRuntimeMemoryEpisodeRecord(episode);
  if (!sanitized.accepted || !isRuntimeMemoryEpisodeRecord(sanitized.value)) {
    throw new Error("Invalid runtime memory episode fixture");
  }
  return sanitized.value;
}

export function buildRuntimeMemoryTemporalFactCandidateFixture(
  overrides: Partial<RuntimeMemoryTemporalFactCandidate> = {},
): RuntimeMemoryTemporalFactCandidate {
  const candidate: RuntimeMemoryTemporalFactCandidate = {
    schemaVersion: 1,
    factId: "fact_candidate_1",
    taskId: "task_1",
    subject: "RuntimeMemoryProvider",
    predicate: "stores",
    objectSummary: "Evidence-backed temporal facts only.",
    confidence: 0.8,
    source: "verifier_summary",
    verificationStatus: "candidate",
    valid_at: 10,
    reference_time: 10,
    sourceEpisodeRefs: [
      {
        episodeId: "episode_1",
        taskId: "task_1",
        kind: "verifier_summary",
        idempotencyKey: "task_1:verifier:summary",
        reference_time: 10,
      },
    ],
    evidenceRefs: [
      buildEvidenceRefFixture({ type: "trace", ref: "trace_1" }),
    ],
    proposedAt: 11,
    ...overrides,
  };
  const sanitized = sanitizeRuntimeMemoryTemporalFactCandidate(candidate);
  if (
    !sanitized.accepted ||
    !isRuntimeMemoryTemporalFactCandidate(sanitized.value)
  ) {
    throw new Error("Invalid runtime memory fact candidate fixture");
  }
  return sanitized.value;
}

export function buildRuntimeMemoryTemporalFactFixture(
  overrides: Partial<RuntimeMemoryTemporalFact> = {},
): RuntimeMemoryTemporalFact {
  const fact: RuntimeMemoryTemporalFact = {
    ...buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "fact_1",
      verificationStatus: "verified",
    }),
    verificationStatus: "verified",
    acceptedAt: 12,
    promotion: {
      promotedBy: "verifier",
      evidenceRefs: [
        buildEvidenceRefFixture({ type: "test", ref: "tests/unit/example.test.ts" }),
      ],
    },
    ...overrides,
  };
  const sanitized = sanitizeRuntimeMemoryTemporalFact(fact);
  if (!sanitized.accepted || !isRuntimeMemoryTemporalFact(sanitized.value)) {
    throw new Error("Invalid runtime memory temporal fact fixture");
  }
  return sanitized.value;
}

export function buildRuntimeMemoryInvalidationProposalFixture(
  overrides: Partial<RuntimeMemoryInvalidationProposal> = {},
): RuntimeMemoryInvalidationProposal {
  const proposal: RuntimeMemoryInvalidationProposal = {
    schemaVersion: 1,
    invalidationId: "invalidation_1",
    factId: "fact_1",
    reason: "superseded",
    invalid_at: 20,
    reference_time: 20,
    proposedBy: "human_confirmation",
    verificationStatus: "candidate",
    sourceEpisodeRefs: [
      {
        episodeId: "episode_2",
        taskId: "task_1",
        kind: "human_confirmation",
        idempotencyKey: "task_1:human:confirmation",
        reference_time: 20,
      },
    ],
    evidenceRefs: [
      buildEvidenceRefFixture({ type: "human", ref: "user_confirmation" }),
    ],
    replacementFactId: "fact_2",
    ...overrides,
  };
  const sanitized = sanitizeRuntimeMemoryInvalidationProposal(proposal);
  if (
    !sanitized.accepted ||
    !isRuntimeMemoryInvalidationProposal(sanitized.value)
  ) {
    throw new Error("Invalid runtime memory invalidation proposal fixture");
  }
  return sanitized.value;
}

function matchesRuntimeMemoryFact(
  fact: RuntimeMemoryQueryableFact,
  query: RuntimeMemoryFactQuery,
  referenceTime: number,
): boolean {
  if (!matchesVerification(fact, query)) {
    return false;
  }
  if (!isRuntimeMemoryFactValidAt(fact, referenceTime, query)) {
    return false;
  }
  if (query.taskId !== undefined && fact.taskId !== query.taskId) {
    return false;
  }
  if (query.subject !== undefined && fact.subject !== query.subject) {
    return false;
  }
  if (query.predicate !== undefined && fact.predicate !== query.predicate) {
    return false;
  }
  if (
    query.sourceEpisodeId !== undefined &&
    !fact.sourceEpisodeRefs.some((ref) => ref.episodeId === query.sourceEpisodeId)
  ) {
    return false;
  }
  if (
    query.evidenceRef !== undefined &&
    !fact.evidenceRefs.some((ref) => ref.ref === query.evidenceRef)
  ) {
    return false;
  }
  return true;
}

function matchesVerification(
  fact: RuntimeMemoryQueryableFact,
  query: RuntimeMemoryFactQuery,
): boolean {
  if (query.verificationStatuses !== undefined) {
    return query.verificationStatuses.includes(fact.verificationStatus);
  }
  if (isRuntimeMemoryAcceptedVerificationStatus(fact.verificationStatus)) {
    return true;
  }
  if (fact.verificationStatus === "candidate") {
    return query.includeCandidates === true;
  }
  if (fact.verificationStatus === "rejected") {
    return query.includeRejected === true;
  }
  if (fact.verificationStatus === "invalidated") {
    return query.includeInvalidated === true;
  }
  return false;
}

function runtimeMemoryFactRank(
  fact: RuntimeMemoryQueryableFact,
  query: RuntimeMemoryFactQuery,
): number {
  let rank = 0;
  if (fact.verificationStatus === "verified") rank += 1000;
  if (fact.verificationStatus === "human_approved") rank += 900;
  if (fact.verificationStatus === "deterministic_rule") rank += 850;
  if (fact.evidenceRefs.length > 0) rank += 300;
  if (fact.sourceEpisodeRefs.length > 0) rank += 200;
  if (query.taskId !== undefined && fact.taskId === query.taskId) rank += 100;
  if (query.subject !== undefined && fact.subject === query.subject) rank += 80;
  if (query.predicate !== undefined && fact.predicate === query.predicate) {
    rank += 60;
  }
  if (
    query.evidenceRef !== undefined &&
    fact.evidenceRefs.some((ref) => ref.ref === query.evidenceRef)
  ) {
    rank += 50;
  }
  return rank;
}

function buildRuntimeMemorySummaryItem(
  fact: RuntimeMemoryQueryableFact,
  query: RuntimeMemoryFactQuery,
): RuntimeMemorySummaryItem {
  const rank = runtimeMemoryFactRank(fact, query);
  return {
    factId: fact.factId,
    ...(fact.taskId ? { taskId: fact.taskId } : {}),
    subject: fact.subject,
    predicate: fact.predicate,
    objectSummary: fact.objectSummary,
    verificationStatus: fact.verificationStatus,
    valid_at: fact.valid_at,
    ...(fact.invalid_at !== undefined ? { invalid_at: fact.invalid_at } : {}),
    ...(fact.expired_at !== undefined ? { expired_at: fact.expired_at } : {}),
    reference_time: fact.reference_time,
    sourceEpisodeRefs: fact.sourceEpisodeRefs.map(
      sanitizeRuntimeMemorySourceEpisodeRef,
    ),
    evidenceRefs: fact.evidenceRefs.map(sanitizeEvidenceRef),
    rank,
    summary: formatRuntimeMemorySummaryText(fact),
  };
}

function formatRuntimeMemorySummaryText(fact: RuntimeMemoryQueryableFact): string {
  const parts = [
    `${fact.verificationStatus} ${fact.subject} ${fact.predicate}`,
    fact.objectSummary,
    `valid_at=${fact.valid_at}`,
    `reference_time=${fact.reference_time}`,
  ];
  if (fact.invalid_at !== undefined) {
    parts.push(`invalid_at=${fact.invalid_at}`);
  }
  if (fact.expired_at !== undefined) {
    parts.push(`expired_at=${fact.expired_at}`);
  }
  if (fact.sourceEpisodeRefs.length > 0) {
    parts.push(
      `episodes=${fact.sourceEpisodeRefs
        .map((ref) => ref.episodeId)
        .slice(0, 3)
        .join(",")}`,
    );
  }
  if (fact.evidenceRefs.length > 0) {
    parts.push(
      `evidence=${fact.evidenceRefs
        .map((ref) => ref.ref)
        .slice(0, 3)
        .join(",")}`,
    );
  }
  return parts.join(" | ");
}

function sanitizeQueryableFact(
  fact: RuntimeMemoryQueryableFact,
): RuntimeMemoryQueryableFact[] {
  if (isRuntimeMemoryTemporalFact(fact)) {
    const sanitized = sanitizeRuntimeMemoryTemporalFact(fact);
    return sanitized.accepted ? [sanitized.value] : [];
  }
  if (isRuntimeMemoryTemporalFactCandidate(fact)) {
    const sanitized = sanitizeRuntimeMemoryTemporalFactCandidate(fact);
    return sanitized.accepted ? [sanitized.value] : [];
  }
  return [];
}

function sanitizeRuntimeMemorySourceRef(
  ref: RuntimeMemorySourceRef,
): RuntimeMemorySourceRef {
  const label = truncateOptionalString(ref.label, MAX_LABEL_LENGTH);
  const file = truncateOptionalString(ref.file, MAX_LABEL_LENGTH);
  const symbol = truncateOptionalString(ref.symbol, MAX_LABEL_LENGTH);
  const eventId = truncateOptionalString(ref.eventId, MAX_LABEL_LENGTH);
  const toolCallId = truncateOptionalString(ref.toolCallId, MAX_LABEL_LENGTH);
  const traceId = truncateOptionalString(ref.traceId, MAX_LABEL_LENGTH);
  const spanId = truncateOptionalString(ref.spanId, MAX_LABEL_LENGTH);
  return {
    type: ref.type,
    ref: truncateString(ref.ref.trim(), MAX_LABEL_LENGTH),
    ...(label ? { label } : {}),
    ...(file ? { file } : {}),
    ...(symbol ? { symbol } : {}),
    ...(eventId ? { eventId } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(spanId ? { spanId } : {}),
    ...(ref.metadata
      ? { metadata: sanitizeRuntimeMemoryMetadata(ref.metadata) }
      : {}),
  };
}

function sanitizeRuntimeMemorySourceEpisodeRef(
  ref: RuntimeMemorySourceEpisodeRef,
): RuntimeMemorySourceEpisodeRef {
  return {
    episodeId: truncateString(ref.episodeId.trim(), MAX_LABEL_LENGTH),
    ...(ref.taskId
      ? { taskId: truncateString(ref.taskId.trim(), MAX_LABEL_LENGTH) }
      : {}),
    ...(ref.kind ? { kind: ref.kind } : {}),
    ...(ref.idempotencyKey
      ? {
          idempotencyKey: truncateString(
            ref.idempotencyKey.trim(),
            MAX_LABEL_LENGTH,
          ),
        }
      : {}),
    ...(ref.reference_time !== undefined
      ? { reference_time: ref.reference_time }
      : {}),
  };
}

function sanitizeRuntimeMemoryFactPromotionEvidence(
  promotion: RuntimeMemoryFactPromotionEvidence,
): RuntimeMemoryFactPromotionEvidence {
  const approvedBy = truncateOptionalString(promotion.approvedBy, MAX_LABEL_LENGTH);
  const ruleId = truncateOptionalString(promotion.ruleId, MAX_LABEL_LENGTH);
  return {
    promotedBy: promotion.promotedBy,
    evidenceRefs: promotion.evidenceRefs.map(sanitizeEvidenceRef),
    ...(approvedBy ? { approvedBy } : {}),
    ...(ruleId ? { ruleId } : {}),
  };
}

function sanitizeEvidenceRef(ref: EvidenceRef): EvidenceRef {
  const label = truncateOptionalString(ref.label, 128);
  const summary = truncateOptionalString(ref.summary, MAX_TEXT_LENGTH);
  return {
    type: ref.type,
    ref: truncateString(ref.ref.trim(), MAX_LABEL_LENGTH),
    ...(label ? { label } : {}),
    ...(summary ? { summary } : {}),
    ...(ref.metadata
      ? { metadata: sanitizeRuntimeMemoryMetadata(ref.metadata) }
      : {}),
  };
}

function classifyRawRuntimeMemoryInput(
  value: unknown,
): RuntimeMemoryRawInputRejectionReason | undefined {
  if (typeof value === "string") {
    return classifyRawString(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const reason = classifyRawRuntimeMemoryInput(item);
      if (reason) {
        return reason;
      }
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    const keyReason = classifySensitiveKey(key);
    if (keyReason) {
      return keyReason;
    }
    const childReason = classifyRawRuntimeMemoryInput(child);
    if (childReason) {
      return childReason;
    }
  }
  return undefined;
}

function classifyRawString(
  value: string,
): RuntimeMemoryRawInputRejectionReason | undefined {
  return RAW_TEXT_PATTERNS.find((entry) => entry.pattern.test(value))?.reason;
}

function classifySensitiveKey(
  key: string,
): RuntimeMemoryRawInputRejectionReason | undefined {
  if (!SENSITIVE_METADATA_KEY_PATTERN.test(key)) {
    return undefined;
  }
  if (/baggage/i.test(key)) return "trace_baggage";
  if (/tracestate/i.test(key)) return "trace_tracestate";
  if (/rawChat|chatLog|chat log/i.test(key)) return "raw_chat_log";
  if (/transcript|jsonl/i.test(key)) return "raw_transcript";
  if (/rawTrace|trace dump|traceparent/i.test(key)) return "raw_trace_dump";
  if (/prompt/i.test(key)) return "prompt";
  if (/payload/i.test(key)) return "full_payload";
  if (/toolArgs|tool args/i.test(key)) return "full_tool_args";
  if (/toolOutput|tool output|stdout|stderr/i.test(key)) {
    return "full_tool_output";
  }
  if (/process\.env|env/i.test(key)) return "env";
  return "secret";
}

function sanitizeMetadataObject(
  value: Record<string, unknown>,
  depth: number,
): { value: RuntimeCoreJsonObject; redactions: number } {
  const out: RuntimeCoreJsonObject = {};
  let redactions = 0;
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, MAX_METADATA_KEYS)) {
    const key = truncateString(rawKey.trim(), 96);
    if (!key) {
      continue;
    }
    if (classifySensitiveKey(key)) {
      out[key] = "[redacted]";
      redactions += 1;
      continue;
    }
    const sanitized = sanitizeMetadataValue(rawValue, depth + 1);
    redactions += sanitized.redactions;
    if (sanitized.value !== undefined) {
      out[key] = sanitized.value;
    }
  }
  return { value: out, redactions };
}

function sanitizeMetadataValue(
  value: unknown,
  depth: number,
): { value: RuntimeCoreJsonValue | undefined; redactions: number } {
  if (depth > MAX_METADATA_DEPTH) {
    return { value: "[truncated]", redactions: 1 };
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return { value, redactions: 0 };
  }
  if (typeof value === "string") {
    if (classifyRawString(value)) {
      return { value: "[redacted]", redactions: 1 };
    }
    return {
      value: truncateString(value, MAX_METADATA_STRING_LENGTH),
      redactions: 0,
    };
  }
  if (Array.isArray(value)) {
    let redactions = 0;
    const items = value.slice(0, 8).flatMap((item) => {
      const sanitized = sanitizeMetadataValue(item, depth + 1);
      redactions += sanitized.redactions;
      return sanitized.value === undefined ? [] : [sanitized.value];
    });
    return { value: items, redactions };
  }
  if (isRecord(value)) {
    return sanitizeMetadataObject(value, depth);
  }
  return { value: undefined, redactions: 0 };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHAR_WIDTH);
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const charBudget = tokenBudget * TOKEN_CHAR_WIDTH;
  if (text.length <= charBudget) {
    return text;
  }
  return truncateString(text, Math.max(0, charBudget));
}

function makeRejection(
  reason: RuntimeMemoryRawInputRejectionReason,
): RuntimeMemoryInputRejection {
  return {
    accepted: false,
    reason,
    message: `Runtime memory input rejected: ${reason}.`,
  };
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  const record = isRecord(value) ? value : undefined;
  const directRuntime = isRecord(record?.runtime) ? record.runtime : undefined;
  if (directRuntime) {
    return directRuntime;
  }
  const config = isRecord(record?.config) ? record.config : undefined;
  const configRuntime = isRecord(config?.runtime) ? config.runtime : undefined;
  if (configRuntime) {
    return configRuntime;
  }
  return record;
}

function strictFlag(section: unknown, key: string): boolean {
  return isRecord(section) && section[key] === true;
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function hasRuntimeMemoryTemporalFields(
  value: Record<string, unknown>,
): boolean {
  return (
    isFiniteNumber(value.valid_at) &&
    isOptionalFiniteNumber(value.invalid_at) &&
    isOptionalFiniteNumber(value.expired_at) &&
    isFiniteNumber(value.reference_time)
  );
}

function nonEmptyArrayEvery<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.length > 0 && value.every(guard);
}

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function truncateOptionalString(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  return value === undefined ? undefined : truncateString(value.trim(), maxLength);
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
