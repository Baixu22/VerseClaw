import {
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
  isRuntimeCoreJsonValue,
  type ContextItem,
  type RuntimeCoreJsonObject,
  type RuntimeCoreJsonValue,
} from "./types.js";

export const RUNTIME_TRACE_SPAN_KINDS = [
  "task",
  "tool",
  "test",
  "verifier",
  "checkpoint",
  "resume",
  "runtime",
  "other",
] as const;

export type RuntimeTraceSpanKind = typeof RUNTIME_TRACE_SPAN_KINDS[number];

export const RUNTIME_TRACE_SPAN_STATUSES = ["unset", "ok", "error"] as const;

export type RuntimeTraceSpanStatus = typeof RUNTIME_TRACE_SPAN_STATUSES[number];

export const RUNTIME_TRACE_LINK_RELATIONSHIPS = [
  "resume",
  "evidence",
  "related",
] as const;

export type RuntimeTraceLinkRelationship =
  typeof RUNTIME_TRACE_LINK_RELATIONSHIPS[number];

export const RUNTIME_TRACE_CONTEXT_FLAG_PATHS = {
  shadow: "runtime.traceContext.shadow",
  provider: "runtime.traceContext.provider",
  propagation: "runtime.traceContext.propagation",
} as const;

export type RuntimeTraceContextFeatureFlag =
  keyof typeof RUNTIME_TRACE_CONTEXT_FLAG_PATHS;

export type RuntimeTraceContextFeatureFlags = Record<
  RuntimeTraceContextFeatureFlag,
  boolean
>;

export const DEFAULT_RUNTIME_TRACE_CONTEXT_FEATURE_FLAGS = {
  shadow: false,
  provider: false,
  propagation: false,
} as const satisfies RuntimeTraceContextFeatureFlags;

export type RuntimeTraceSourceRef = {
  file?: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  commit?: string;
  diffHash?: string;
};

export type RuntimeTraceSpanLink = {
  traceId: string;
  spanId: string;
  relationship: RuntimeTraceLinkRelationship;
  attributes?: RuntimeCoreJsonObject;
};

export type RuntimeTraceSpanEvent = {
  name: string;
  timestamp: number;
  attributes?: RuntimeCoreJsonObject;
  evidenceRefs?: EvidenceRef[];
};

export type RuntimeTraceSpan = {
  schemaVersion: 1;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: RuntimeTraceSpanKind;
  startedAt: number;
  endedAt?: number;
  status: RuntimeTraceSpanStatus;
  statusMessage?: string;
  links: RuntimeTraceSpanLink[];
  attributes: RuntimeCoreJsonObject;
  events: RuntimeTraceSpanEvent[];
  sourceRefs: RuntimeTraceSourceRef[];
  evidenceRefs: EvidenceRef[];
};

export type RuntimeTraceTimeRange = {
  start?: number;
  end?: number;
};

export type RuntimeTraceQuery = {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  linkedSpanId?: string;
  taskId?: string;
  toolName?: string;
  file?: string;
  symbol?: string;
  name?: string;
  kind?: RuntimeTraceSpanKind;
  status?: RuntimeTraceSpanStatus;
  timeRange?: RuntimeTraceTimeRange;
};

export type RuntimeTraceSummaryItem = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: RuntimeTraceSpanKind;
  status: RuntimeTraceSpanStatus;
  durationMs?: number;
  summary: string;
  eventCount: number;
  sourceRefs: RuntimeTraceSourceRef[];
  evidenceRefs: EvidenceRef[];
  links: RuntimeTraceSpanLink[];
  rank: number;
};

export type RuntimeTraceSummary = {
  traceId?: string;
  items: RuntimeTraceSummaryItem[];
  omittedSpanCount: number;
  tokenBudget: number;
  estimatedTokens: number;
  readonly: true;
};

export type RuntimeTraceContextProviderQuery = RuntimeTraceQuery & {
  tokenBudget?: number;
};

export type RuntimeTraceContextProviderResult = {
  contextItems: ContextItem[];
  summary: RuntimeTraceSummary;
  evidenceRefs: EvidenceRef[];
  readonly: true;
};

export type RuntimeTraceContextProvider = {
  readonly id: "runtime-trace-context";
  getTraceContext: (
    query: RuntimeTraceContextProviderQuery,
  ) =>
    | RuntimeTraceContextProviderResult
    | Promise<RuntimeTraceContextProviderResult>;
};

export type RuntimeTraceExternalContextAction =
  | "marked_untrusted"
  | "rejected";

export type RuntimeTraceSanitizedExternalContext = {
  source: "external";
  traceId: string;
  parentSpanId: string;
  traceFlags: string;
  trusted: false;
  tracestateKeys: string[];
  baggageKeys: string[];
};

export type RuntimeTraceExternalContextResult =
  | {
      action: "marked_untrusted";
      context: RuntimeTraceSanitizedExternalContext;
    }
  | {
      action: "rejected";
      reason: "missing" | "malformed" | "invalid";
    };

const SPAN_KIND_SET = new Set<RuntimeTraceSpanKind>(RUNTIME_TRACE_SPAN_KINDS);
const SPAN_STATUS_SET = new Set<RuntimeTraceSpanStatus>(
  RUNTIME_TRACE_SPAN_STATUSES,
);
const LINK_RELATIONSHIP_SET = new Set<RuntimeTraceLinkRelationship>(
  RUNTIME_TRACE_LINK_RELATIONSHIPS,
);
const W3C_TRACEPARENT_PATTERN =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);
const MAX_ATTRIBUTE_KEYS = 24;
const MAX_ATTRIBUTE_DEPTH = 3;
const MAX_ATTRIBUTE_STRING_LENGTH = 256;
const MAX_SOURCE_REF_LENGTH = 256;
const DEFAULT_TRACE_SUMMARY_TOKEN_BUDGET = 256;
const TOKEN_CHAR_WIDTH = 4;
const SENSITIVE_ATTRIBUTE_KEY_PATTERN =
  /(prompt|message|payload|checkpoint|args?|output|stdout|stderr|env|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|authorization|password|baggage|tracestate)/i;
const SENSITIVE_TEXT_PATTERN =
  /(prompt|payload|tool args?|stdout|stderr|env|secret|token|api[-_ ]?key|access[-_ ]?key|private[-_ ]?key|authorization|password|baggage|tracestate|sk-[A-Za-z0-9_-]{8,})/i;

export function isRuntimeTraceSpanKind(
  value: unknown,
): value is RuntimeTraceSpanKind {
  return typeof value === "string" && SPAN_KIND_SET.has(value as RuntimeTraceSpanKind);
}

export function isRuntimeTraceSpanStatus(
  value: unknown,
): value is RuntimeTraceSpanStatus {
  return (
    typeof value === "string" &&
    SPAN_STATUS_SET.has(value as RuntimeTraceSpanStatus)
  );
}

export function isRuntimeTraceLinkRelationship(
  value: unknown,
): value is RuntimeTraceLinkRelationship {
  return (
    typeof value === "string" &&
    LINK_RELATIONSHIP_SET.has(value as RuntimeTraceLinkRelationship)
  );
}

export function isRuntimeTraceSourceRef(
  value: unknown,
): value is RuntimeTraceSourceRef {
  if (!isRecord(value)) {
    return false;
  }
  const hasAnchor = isNonEmptyString(value.file) || isNonEmptyString(value.symbol);
  return (
    hasAnchor &&
    isOptionalString(value.file) &&
    isOptionalFiniteNumber(value.startLine) &&
    isOptionalFiniteNumber(value.endLine) &&
    isOptionalString(value.symbol) &&
    isOptionalString(value.commit) &&
    isOptionalString(value.diffHash)
  );
}

export function isRuntimeTraceSpanLink(
  value: unknown,
): value is RuntimeTraceSpanLink {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.traceId) &&
    isNonEmptyString(value.spanId) &&
    isRuntimeTraceLinkRelationship(value.relationship) &&
    (value.attributes === undefined || isRuntimeCoreJsonObject(value.attributes))
  );
}

export function isRuntimeTraceSpanEvent(
  value: unknown,
): value is RuntimeTraceSpanEvent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.name) &&
    isFiniteNumber(value.timestamp) &&
    (value.attributes === undefined || isRuntimeCoreJsonObject(value.attributes)) &&
    (value.evidenceRefs === undefined ||
      (Array.isArray(value.evidenceRefs) && value.evidenceRefs.every(isEvidenceRef)))
  );
}

export function isRuntimeTraceTimeRange(
  value: unknown,
): value is RuntimeTraceTimeRange {
  if (!isRecord(value)) {
    return false;
  }
  return isOptionalFiniteNumber(value.start) && isOptionalFiniteNumber(value.end);
}

export function isRuntimeTraceQuery(value: unknown): value is RuntimeTraceQuery {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isOptionalString(value.traceId) &&
    isOptionalString(value.spanId) &&
    isOptionalString(value.parentSpanId) &&
    isOptionalString(value.linkedSpanId) &&
    isOptionalString(value.taskId) &&
    isOptionalString(value.toolName) &&
    isOptionalString(value.file) &&
    isOptionalString(value.symbol) &&
    isOptionalString(value.name) &&
    (value.kind === undefined || isRuntimeTraceSpanKind(value.kind)) &&
    (value.status === undefined || isRuntimeTraceSpanStatus(value.status)) &&
    (value.timeRange === undefined || isRuntimeTraceTimeRange(value.timeRange))
  );
}

export function isRuntimeTraceSpan(value: unknown): value is RuntimeTraceSpan {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    isNonEmptyString(value.traceId) &&
    isNonEmptyString(value.spanId) &&
    isOptionalString(value.parentSpanId) &&
    isNonEmptyString(value.name) &&
    isRuntimeTraceSpanKind(value.kind) &&
    isFiniteNumber(value.startedAt) &&
    isOptionalFiniteNumber(value.endedAt) &&
    isRuntimeTraceSpanStatus(value.status) &&
    isOptionalString(value.statusMessage) &&
    Array.isArray(value.links) &&
    value.links.every(isRuntimeTraceSpanLink) &&
    isRuntimeCoreJsonObject(value.attributes) &&
    Array.isArray(value.events) &&
    value.events.every(isRuntimeTraceSpanEvent) &&
    Array.isArray(value.sourceRefs) &&
    value.sourceRefs.every(isRuntimeTraceSourceRef) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef)
  );
}

export function isRuntimeTraceSummaryItem(
  value: unknown,
): value is RuntimeTraceSummaryItem {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.traceId) &&
    isNonEmptyString(value.spanId) &&
    isOptionalString(value.parentSpanId) &&
    isNonEmptyString(value.name) &&
    isRuntimeTraceSpanKind(value.kind) &&
    isRuntimeTraceSpanStatus(value.status) &&
    isOptionalFiniteNumber(value.durationMs) &&
    isNonEmptyString(value.summary) &&
    Number.isInteger(value.eventCount) &&
    Number(value.eventCount) >= 0 &&
    Array.isArray(value.sourceRefs) &&
    value.sourceRefs.every(isRuntimeTraceSourceRef) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef) &&
    Array.isArray(value.links) &&
    value.links.every(isRuntimeTraceSpanLink) &&
    isFiniteNumber(value.rank)
  );
}

export function isRuntimeTraceSummary(value: unknown): value is RuntimeTraceSummary {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isOptionalString(value.traceId) &&
    Array.isArray(value.items) &&
    value.items.every(isRuntimeTraceSummaryItem) &&
    Number.isInteger(value.omittedSpanCount) &&
    Number(value.omittedSpanCount) >= 0 &&
    Number.isInteger(value.tokenBudget) &&
    Number(value.tokenBudget) >= 0 &&
    Number.isInteger(value.estimatedTokens) &&
    Number(value.estimatedTokens) >= 0 &&
    value.readonly === true
  );
}

export function isRuntimeTraceContextProviderResult(
  value: unknown,
): value is RuntimeTraceContextProviderResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Array.isArray(value.contextItems) &&
    value.contextItems.every(isContextItem) &&
    isRuntimeTraceSummary(value.summary) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef) &&
    value.readonly === true
  );
}

export function resolveRuntimeTraceContextFeatureFlags(
  value: unknown,
): RuntimeTraceContextFeatureFlags {
  const runtime = runtimeConfigFrom(value);
  const traceContext = isRecord(runtime?.traceContext)
    ? runtime.traceContext
    : undefined;
  return {
    shadow: strictFlag(traceContext, "shadow"),
    provider: strictFlag(traceContext, "provider"),
    propagation: strictFlag(traceContext, "propagation"),
  };
}

export function runtimeTraceContextFlagEnabled(
  value: unknown,
  flag: RuntimeTraceContextFeatureFlag,
): boolean {
  return resolveRuntimeTraceContextFeatureFlags(value)[flag];
}

export function sanitizeRuntimeTraceAttributes(
  value: unknown,
): RuntimeCoreJsonObject {
  if (!isRecord(value)) {
    return {};
  }
  return sanitizeAttributeObject(value, 0);
}

export function sanitizeRuntimeTraceSpan(span: RuntimeTraceSpan): RuntimeTraceSpan {
  return {
    ...span,
    ...(span.statusMessage
      ? { statusMessage: sanitizeTraceStatusMessage(span.statusMessage) }
      : {}),
    links: span.links.map((link) => ({
      ...link,
      ...(link.attributes
        ? { attributes: sanitizeRuntimeTraceAttributes(link.attributes) }
        : {}),
    })),
    attributes: sanitizeRuntimeTraceAttributes(span.attributes),
    events: span.events.map(sanitizeSpanEvent),
    sourceRefs: span.sourceRefs.map(sanitizeSourceRef),
    evidenceRefs: span.evidenceRefs.map(sanitizeEvidenceRef),
  };
}

export function sanitizeExternalRuntimeTraceContext(params: {
  traceparent?: string;
  tracestate?: string;
  baggage?: string;
}): RuntimeTraceExternalContextResult {
  const traceparent = params.traceparent?.trim().toLowerCase();
  if (!traceparent) {
    return { action: "rejected", reason: "missing" };
  }
  const match = W3C_TRACEPARENT_PATTERN.exec(traceparent);
  if (!match) {
    return { action: "rejected", reason: "malformed" };
  }
  const [, version, traceId, parentSpanId, traceFlags] = match;
  if (
    version === "ff" ||
    traceId === ZERO_TRACE_ID ||
    parentSpanId === ZERO_SPAN_ID
  ) {
    return { action: "rejected", reason: "invalid" };
  }
  return {
    action: "marked_untrusted",
    context: {
      source: "external",
      traceId,
      parentSpanId,
      traceFlags,
      trusted: false,
      tracestateKeys: headerKeys(params.tracestate),
      baggageKeys: headerKeys(params.baggage),
    },
  };
}

export function findRuntimeTraceSpans(
  spans: readonly RuntimeTraceSpan[],
  query: RuntimeTraceQuery = {},
): RuntimeTraceSpan[] {
  return spans
    .filter(isRuntimeTraceSpan)
    .map(sanitizeRuntimeTraceSpan)
    .filter((span) => matchesRuntimeTraceQuery(span, query));
}

export function findRuntimeTraceChildren(
  spans: readonly RuntimeTraceSpan[],
  traceId: string,
  parentSpanId: string,
): RuntimeTraceSpan[] {
  return findRuntimeTraceSpans(spans, { traceId, parentSpanId });
}

export function findRuntimeTraceLinkedSpans(
  spans: readonly RuntimeTraceSpan[],
  span: Pick<RuntimeTraceSpan, "traceId" | "spanId">,
): RuntimeTraceSpan[] {
  const sanitized = spans.filter(isRuntimeTraceSpan).map(sanitizeRuntimeTraceSpan);
  const linkedKeys = new Set(
    sanitized
      .filter((item) => item.traceId === span.traceId && item.spanId === span.spanId)
      .flatMap((item) => item.links.map((link) => traceSpanKey(link))),
  );
  const incomingKeys = sanitized
    .filter((item) =>
      item.links.some((link) =>
        link.traceId === span.traceId && link.spanId === span.spanId
      )
    )
    .map((item) => traceSpanKey(item));
  for (const key of incomingKeys) {
    linkedKeys.add(key);
  }
  return sanitized.filter((item) => linkedKeys.has(traceSpanKey(item)));
}

export function summarizeRuntimeTrace(
  spans: readonly RuntimeTraceSpan[],
  params: RuntimeTraceQuery & { tokenBudget?: number } = {},
): RuntimeTraceSummary {
  const tokenBudget = Math.max(
    0,
    Math.floor(params.tokenBudget ?? DEFAULT_TRACE_SUMMARY_TOKEN_BUDGET),
  );
  const matched = findRuntimeTraceSpans(spans, params);
  const ranked = rankRuntimeTraceSpans(matched, params);
  const items: RuntimeTraceSummaryItem[] = [];
  let estimatedTokens = 0;

  for (const span of ranked) {
    const item = buildSummaryItem(span, params);
    const nextTokens = estimateTraceSummaryTokens(item.summary);
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
      estimatedTokens += estimateTraceSummaryTokens(truncated.summary);
      continue;
    }
    items.push(item);
    estimatedTokens += nextTokens;
  }

  return {
    ...(params.traceId ? { traceId: params.traceId } : {}),
    items,
    omittedSpanCount: Math.max(0, matched.length - items.length),
    tokenBudget,
    estimatedTokens,
    readonly: true,
  };
}

export function rankRuntimeTraceSpans(
  spans: readonly RuntimeTraceSpan[],
  query: RuntimeTraceQuery = {},
): RuntimeTraceSpan[] {
  return [...spans]
    .map((span, index) => ({ span, index, rank: traceSpanRank(span, query) }))
    .sort((left, right) => {
      const rank = right.rank - left.rank;
      if (rank !== 0) {
        return rank;
      }
      const time = left.span.startedAt - right.span.startedAt;
      if (time !== 0) {
        return time;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.span);
}

export function buildRuntimeTraceSpanFixture(
  overrides: Partial<RuntimeTraceSpan> = {},
): RuntimeTraceSpan {
  const span: RuntimeTraceSpan = {
    schemaVersion: 1,
    traceId: "trace_1",
    spanId: "span_task_1",
    name: "task.run",
    kind: "task",
    startedAt: 1,
    endedAt: 5,
    status: "ok",
    links: [],
    attributes: {
      "task.id": "task_1",
      "workspace.path": "C:/workspace",
    },
    events: [
      {
        name: "context.assembled",
        timestamp: 2,
        attributes: { itemCount: 2 },
        evidenceRefs: [{ type: "trace", ref: "trace_1" }],
      },
    ],
    sourceRefs: [
      {
        file: "openclaw_runtime/src/runtime-core/trace-context.ts",
        symbol: "RuntimeTraceSpan",
      },
    ],
    evidenceRefs: [{ type: "trace", ref: "trace_1", label: "Runtime trace" }],
    ...overrides,
  };
  if (!isRuntimeTraceSpan(span)) {
    throw new Error("Invalid runtime trace span fixture");
  }
  return sanitizeRuntimeTraceSpan(span);
}

function matchesRuntimeTraceQuery(
  span: RuntimeTraceSpan,
  query: RuntimeTraceQuery,
): boolean {
  if (query.traceId !== undefined && span.traceId !== query.traceId) return false;
  if (query.spanId !== undefined && span.spanId !== query.spanId) return false;
  if (query.parentSpanId !== undefined && span.parentSpanId !== query.parentSpanId) {
    return false;
  }
  if (query.linkedSpanId !== undefined && !span.links.some((link) => link.spanId === query.linkedSpanId)) {
    return false;
  }
  if (query.name !== undefined && span.name !== query.name) return false;
  if (query.kind !== undefined && span.kind !== query.kind) return false;
  if (query.status !== undefined && span.status !== query.status) return false;
  if (query.taskId !== undefined && span.attributes["task.id"] !== query.taskId) {
    return false;
  }
  if (query.toolName !== undefined && span.attributes["tool.name"] !== query.toolName) {
    return false;
  }
  if (query.file !== undefined && !span.sourceRefs.some((ref) => ref.file === query.file)) {
    return false;
  }
  if (query.symbol !== undefined && !span.sourceRefs.some((ref) => ref.symbol === query.symbol)) {
    return false;
  }
  if (query.timeRange !== undefined && !spanWithinTimeRange(span, query.timeRange)) {
    return false;
  }
  return true;
}

function spanWithinTimeRange(
  span: RuntimeTraceSpan,
  timeRange: RuntimeTraceTimeRange,
): boolean {
  const spanEnd = span.endedAt ?? span.startedAt;
  const queryStart = timeRange.start ?? Number.NEGATIVE_INFINITY;
  const queryEnd = timeRange.end ?? Number.POSITIVE_INFINITY;
  return span.startedAt <= queryEnd && spanEnd >= queryStart;
}

function traceSpanRank(span: RuntimeTraceSpan, query: RuntimeTraceQuery): number {
  let rank = 0;
  if (span.status === "error") rank += 1000;
  if (span.kind === "test" || span.kind === "verifier") rank += 600;
  if (hasTraceEvidenceRefs(span)) rank += 350;
  if (span.links.some((link) => link.relationship === "evidence")) rank += 300;
  if (span.links.some((link) => link.relationship === "resume")) rank += 250;
  if (query.taskId !== undefined && span.attributes["task.id"] === query.taskId) {
    rank += 120;
  }
  if (query.toolName !== undefined && span.attributes["tool.name"] === query.toolName) {
    rank += 120;
  }
  if (query.file !== undefined && span.sourceRefs.some((ref) => ref.file === query.file)) {
    rank += 100;
  }
  if (query.symbol !== undefined && span.sourceRefs.some((ref) => ref.symbol === query.symbol)) {
    rank += 100;
  }
  return rank;
}

function hasTraceEvidenceRefs(span: RuntimeTraceSpan): boolean {
  return (
    span.evidenceRefs.length > 0 ||
    span.events.some((event) => (event.evidenceRefs?.length ?? 0) > 0)
  );
}

function collectTraceEvidenceRefs(span: RuntimeTraceSpan): EvidenceRef[] {
  const refs = [
    ...span.evidenceRefs,
    ...span.events.flatMap((event) => event.evidenceRefs ?? []),
  ];
  const seen = new Set<string>();
  return refs.flatMap((ref) => {
    const key = `${ref.type}:${ref.ref}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [sanitizeEvidenceRef(ref)];
  });
}

function buildSummaryItem(
  span: RuntimeTraceSpan,
  query: RuntimeTraceQuery,
): RuntimeTraceSummaryItem {
  const rank = traceSpanRank(span, query);
  return (
    {
      traceId: span.traceId,
      spanId: span.spanId,
      ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
      name: span.name,
      kind: span.kind,
      status: span.status,
      ...(span.endedAt !== undefined
        ? { durationMs: Math.max(0, span.endedAt - span.startedAt) }
        : {}),
      summary: formatSummaryText(span),
      eventCount: span.events.length,
      sourceRefs: span.sourceRefs.map(sanitizeSourceRef),
      evidenceRefs: collectTraceEvidenceRefs(span),
      links: span.links.map((link) => ({
        ...link,
        ...(link.attributes
          ? { attributes: sanitizeRuntimeTraceAttributes(link.attributes) }
          : {}),
      })),
      rank,
    }
  );
}

function formatSummaryText(span: RuntimeTraceSpan): string {
  const parts = [
    `${span.status.toUpperCase()} ${span.kind} ${span.name}`,
    `span=${span.spanId}`,
  ];
  if (span.parentSpanId) {
    parts.push(`parent=${span.parentSpanId}`);
  }
  const taskId = stringAttribute(span, "task.id");
  if (taskId) {
    parts.push(`task=${taskId}`);
  }
  const toolName = stringAttribute(span, "tool.name");
  if (toolName) {
    parts.push(`tool=${toolName}`);
  }
  const sources = span.sourceRefs
    .flatMap((ref) => [ref.file, ref.symbol].filter(isNonEmptyString))
    .slice(0, 3);
  if (sources.length > 0) {
    parts.push(`source=${sources.join(",")}`);
  }
  if (span.evidenceRefs.length > 0) {
    parts.push(`evidence=${span.evidenceRefs.map((ref) => ref.ref).slice(0, 3).join(",")}`);
  }
  if (span.statusMessage) {
    parts.push(`message=${sanitizeTraceStatusMessage(span.statusMessage, 96)}`);
  }
  return parts.join(" | ");
}

function stringAttribute(
  span: RuntimeTraceSpan,
  key: string,
): string | undefined {
  const value = span.attributes[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function estimateTraceSummaryTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHAR_WIDTH);
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const charBudget = tokenBudget * TOKEN_CHAR_WIDTH;
  if (text.length <= charBudget) {
    return text;
  }
  return truncateString(text, Math.max(0, charBudget));
}

function sanitizeAttributeObject(
  value: Record<string, unknown>,
  depth: number,
): RuntimeCoreJsonObject {
  const out: RuntimeCoreJsonObject = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, MAX_ATTRIBUTE_KEYS)) {
    const key = truncateString(rawKey.trim(), 96);
    if (!key) {
      continue;
    }
    if (SENSITIVE_ATTRIBUTE_KEY_PATTERN.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    const sanitized = sanitizeAttributeValue(rawValue, depth + 1);
    if (sanitized !== undefined) {
      out[key] = sanitized;
    }
  }
  return out;
}

function sanitizeAttributeValue(
  value: unknown,
  depth: number,
): RuntimeCoreJsonValue | undefined {
  if (depth > MAX_ATTRIBUTE_DEPTH) {
    return "[truncated]";
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === "string") {
    return truncateString(value, MAX_ATTRIBUTE_STRING_LENGTH);
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 8)
      .flatMap((item) => {
        const sanitized = sanitizeAttributeValue(item, depth + 1);
        return sanitized === undefined ? [] : [sanitized];
      });
    return items;
  }
  if (isRecord(value)) {
    return sanitizeAttributeObject(value, depth);
  }
  return isRuntimeCoreJsonValue(value) ? value : undefined;
}

function sanitizeSpanEvent(event: RuntimeTraceSpanEvent): RuntimeTraceSpanEvent {
  return {
    name: truncateString(event.name.trim(), 128),
    timestamp: event.timestamp,
    ...(event.attributes
      ? { attributes: sanitizeRuntimeTraceAttributes(event.attributes) }
      : {}),
    ...(event.evidenceRefs
      ? { evidenceRefs: event.evidenceRefs.map(sanitizeEvidenceRef) }
      : {}),
  };
}

function sanitizeTraceStatusMessage(value: string, maxLength = 256): string {
  const bounded = truncateString(value.trim(), maxLength);
  return SENSITIVE_TEXT_PATTERN.test(bounded) ? "[redacted]" : bounded;
}

function sanitizeSourceRef(ref: RuntimeTraceSourceRef): RuntimeTraceSourceRef {
  const file = truncateOptionalString(ref.file, MAX_SOURCE_REF_LENGTH);
  const symbol = truncateOptionalString(ref.symbol, MAX_SOURCE_REF_LENGTH);
  return {
    ...(file ? { file } : {}),
    ...(ref.startLine !== undefined ? { startLine: Math.max(0, ref.startLine) } : {}),
    ...(ref.endLine !== undefined ? { endLine: Math.max(0, ref.endLine) } : {}),
    ...(symbol ? { symbol } : {}),
    ...(truncateOptionalString(ref.commit, 64)
      ? { commit: truncateOptionalString(ref.commit, 64) }
      : {}),
    ...(truncateOptionalString(ref.diffHash, 128)
      ? { diffHash: truncateOptionalString(ref.diffHash, 128) }
      : {}),
  };
}

function sanitizeEvidenceRef(ref: EvidenceRef): EvidenceRef {
  const label = truncateOptionalString(ref.label, 128);
  const summary = truncateOptionalString(ref.summary, 256);
  return {
    type: ref.type,
    ref: truncateString(ref.ref.trim(), 512),
    ...(label ? { label } : {}),
    ...(summary ? { summary } : {}),
    ...(ref.metadata ? { metadata: sanitizeRuntimeTraceAttributes(ref.metadata) } : {}),
  };
}

function headerKeys(value: string | undefined): string[] {
  return Array.from(new Set(
    (value ?? "")
      .split(",")
      .map((part) => part.split("=", 1)[0]?.trim())
      .filter(isNonEmptyString)
      .map((key) => truncateString(key, 64)),
  )).slice(0, 16);
}

function traceSpanKey(span: Pick<RuntimeTraceSpan | RuntimeTraceSpanLink, "traceId" | "spanId">): string {
  return `${span.traceId}\u0000${span.spanId}`;
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
