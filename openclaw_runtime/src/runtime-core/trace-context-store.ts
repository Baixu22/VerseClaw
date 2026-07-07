import {
  findRuntimeTraceSpans,
  isRuntimeTraceSpan,
  sanitizeRuntimeTraceSpan,
  type RuntimeTraceLinkRelationship,
  type RuntimeTraceQuery,
  type RuntimeTraceSpan,
  type RuntimeTraceSpanLink,
  type RuntimeTraceSummary,
  type RuntimeTraceSummaryItem,
} from "./trace-context.js";
import type { EvidenceRef } from "./evidence.js";

export type RuntimeTraceSpanStoreOptions = {
  maxSpans?: number;
  maxSpansPerTrace?: number;
};

export type RuntimeTraceSpanStoreAppendResult = {
  accepted: boolean;
  rejectedReason?: "invalid_span";
  span?: RuntimeTraceSpan;
  totalSpanCount: number;
  traceSpanCount: number;
  evictedSpanCount: number;
  readonly: true;
};

export type RuntimeTraceSpanStoreStats = {
  totalSpanCount: number;
  traceCount: number;
  maxSpans: number;
  maxSpansPerTrace: number;
  evictedSpanCount: number;
  readonly: true;
};

export type RuntimeTraceLinkedSpanQuery = {
  traceId: string;
  spanId: string;
  relationship?: RuntimeTraceLinkRelationship;
};

export type RuntimeTraceSummaryPriorityQuery = Pick<
  RuntimeTraceQuery,
  "taskId" | "toolName" | "file" | "symbol"
>;

const DEFAULT_MAX_SPANS = 256;
const DEFAULT_MAX_SPANS_PER_TRACE = 64;
const TOKEN_CHAR_WIDTH = 4;

export class RuntimeTraceSpanStore {
  readonly maxSpans: number;
  readonly maxSpansPerTrace: number;

  private readonly spansByKey = new Map<string, RuntimeTraceSpan>();
  private readonly insertionOrder: string[] = [];
  private evictedSpanCount = 0;

  constructor(options: RuntimeTraceSpanStoreOptions = {}) {
    this.maxSpans = positiveIntegerOrDefault(
      options.maxSpans,
      DEFAULT_MAX_SPANS,
    );
    this.maxSpansPerTrace = Math.min(
      this.maxSpans,
      positiveIntegerOrDefault(
        options.maxSpansPerTrace,
        DEFAULT_MAX_SPANS_PER_TRACE,
      ),
    );
  }

  append(span: unknown): RuntimeTraceSpanStoreAppendResult {
    if (!isRuntimeTraceSpan(span)) {
      return this.appendResult(false, undefined, 0, "invalid_span");
    }

    const beforeEvicted = this.evictedSpanCount;
    const sanitized = cloneJson(sanitizeRuntimeTraceSpan(span));
    const key = traceSpanKey(sanitized);
    this.deleteKey(key, false);
    this.spansByKey.set(key, sanitized);
    this.insertionOrder.push(key);
    this.enforceTraceBound(sanitized.traceId);
    this.enforceTotalBound();

    return this.appendResult(
      true,
      this.spansByKey.get(key) ? sanitized : undefined,
      this.evictedSpanCount - beforeEvicted,
    );
  }

  appendMany(spans: readonly unknown[]): RuntimeTraceSpanStoreAppendResult[] {
    return spans.map((span) => this.append(span));
  }

  query(query: RuntimeTraceQuery = {}): RuntimeTraceSpan[] {
    return findRuntimeTraceSpans(this.snapshotSpans(), query);
  }

  findTrace(traceId: string): RuntimeTraceSpan[] {
    return this.query({ traceId });
  }

  findSpan(traceId: string, spanId: string): RuntimeTraceSpan | undefined {
    return this.query({ traceId, spanId })[0];
  }

  findChildren(traceId: string, parentSpanId: string): RuntimeTraceSpan[] {
    return this.query({ traceId, parentSpanId });
  }

  findLinkedSpans(query: RuntimeTraceLinkedSpanQuery): RuntimeTraceSpan[] {
    const targetKey = traceSpanKey(query);
    const linkedKeys = new Set<string>();
    for (const span of this.snapshotSpans()) {
      const spanKey = traceSpanKey(span);
      for (const link of span.links) {
        if (!relationshipMatches(query.relationship, link)) {
          continue;
        }
        const linkKey = traceSpanKey(link);
        if (spanKey === targetKey) {
          linkedKeys.add(linkKey);
        }
        if (linkKey === targetKey) {
          linkedKeys.add(spanKey);
        }
      }
    }
    return this.snapshotSpans().filter((span) => linkedKeys.has(traceSpanKey(span)));
  }

  summarizeTrace(
    traceId: string,
    tokenBudget: number,
    priorityQuery: RuntimeTraceSummaryPriorityQuery = {},
  ): RuntimeTraceSummary {
    const spans = this.findTrace(traceId);
    const ranked = rankStoreTraceSpans(spans, priorityQuery);
    return buildTraceSummary(traceId, ranked, tokenBudget, priorityQuery);
  }

  snapshot(): RuntimeTraceSpan[] {
    return this.snapshotSpans();
  }

  stats(): RuntimeTraceSpanStoreStats {
    return {
      totalSpanCount: this.spansByKey.size,
      traceCount: new Set(this.snapshotSpans().map((span) => span.traceId)).size,
      maxSpans: this.maxSpans,
      maxSpansPerTrace: this.maxSpansPerTrace,
      evictedSpanCount: this.evictedSpanCount,
      readonly: true,
    };
  }

  clear(): void {
    this.spansByKey.clear();
    this.insertionOrder.length = 0;
  }

  private appendResult(
    accepted: boolean,
    span: RuntimeTraceSpan | undefined,
    evictedSpanCount: number,
    rejectedReason?: RuntimeTraceSpanStoreAppendResult["rejectedReason"],
  ): RuntimeTraceSpanStoreAppendResult {
    const traceSpanCount = span ? this.findTrace(span.traceId).length : 0;
    return {
      accepted,
      ...(rejectedReason ? { rejectedReason } : {}),
      ...(span ? { span: cloneJson(span) } : {}),
      totalSpanCount: this.spansByKey.size,
      traceSpanCount,
      evictedSpanCount,
      readonly: true,
    };
  }

  private enforceTraceBound(traceId: string): void {
    while (this.traceSpanCount(traceId) > this.maxSpansPerTrace) {
      const oldestKey = this.insertionOrder.find((key) =>
        this.spansByKey.get(key)?.traceId === traceId
      );
      if (!oldestKey) {
        return;
      }
      this.deleteKey(oldestKey, true);
    }
  }

  private enforceTotalBound(): void {
    while (this.spansByKey.size > this.maxSpans) {
      const oldestKey = this.insertionOrder[0];
      if (!oldestKey) {
        return;
      }
      this.deleteKey(oldestKey, true);
    }
  }

  private traceSpanCount(traceId: string): number {
    return this.snapshotSpans().filter((span) => span.traceId === traceId).length;
  }

  private deleteKey(key: string, countEviction: boolean): void {
    if (!this.spansByKey.delete(key)) {
      return;
    }
    const index = this.insertionOrder.indexOf(key);
    if (index >= 0) {
      this.insertionOrder.splice(index, 1);
    }
    if (countEviction) {
      this.evictedSpanCount += 1;
    }
  }

  private snapshotSpans(): RuntimeTraceSpan[] {
    return this.insertionOrder.flatMap((key) => {
      const span = this.spansByKey.get(key);
      return span ? [cloneJson(span)] : [];
    });
  }
}

export function createRuntimeTraceSpanStore(
  options: RuntimeTraceSpanStoreOptions = {},
): RuntimeTraceSpanStore {
  return new RuntimeTraceSpanStore(options);
}

function rankStoreTraceSpans(
  spans: readonly RuntimeTraceSpan[],
  priorityQuery: RuntimeTraceSummaryPriorityQuery,
): RuntimeTraceSpan[] {
  return [...spans]
    .map((span, index) => ({
      span,
      index,
      rank: storeSpanRank(span, priorityQuery),
    }))
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

function storeSpanRank(
  span: RuntimeTraceSpan,
  priorityQuery: RuntimeTraceSummaryPriorityQuery,
): number {
  let rank = 0;
  if (span.status === "error") {
    rank += 1_000_000;
  }
  if (span.kind === "test" || span.kind === "verifier") {
    rank += 600_000;
  }
  if (span.links.some((link) => link.relationship === "evidence")) {
    rank += 300_000;
  }
  if (matchesPriorityQuery(span, priorityQuery)) {
    rank += 100_000;
  }
  if (span.links.some((link) => link.relationship === "resume")) {
    rank += 50_000;
  }
  return rank;
}

function matchesPriorityQuery(
  span: RuntimeTraceSpan,
  query: RuntimeTraceSummaryPriorityQuery,
): boolean {
  return (
    (query.taskId !== undefined && span.attributes["task.id"] === query.taskId) ||
    (query.toolName !== undefined &&
      span.attributes["tool.name"] === query.toolName) ||
    (query.file !== undefined &&
      span.sourceRefs.some((ref) => ref.file === query.file)) ||
    (query.symbol !== undefined &&
      span.sourceRefs.some((ref) => ref.symbol === query.symbol))
  );
}

function buildTraceSummary(
  traceId: string,
  ranked: readonly RuntimeTraceSpan[],
  tokenBudget: number,
  priorityQuery: RuntimeTraceSummaryPriorityQuery,
): RuntimeTraceSummary {
  const budget = Math.max(0, Math.floor(tokenBudget));
  const items: RuntimeTraceSummaryItem[] = [];
  let estimatedTokens = 0;
  for (const span of ranked) {
    const item = toSummaryItem(span, priorityQuery);
    const nextTokens = estimateTokens(item.summary);
    if (estimatedTokens + nextTokens > budget) {
      if (items.length > 0 || budget === 0) {
        continue;
      }
      const summary = truncateToTokenBudget(item.summary, budget);
      items.push({
        ...item,
        summary,
      });
      estimatedTokens += estimateTokens(summary);
      continue;
    }
    items.push(item);
    estimatedTokens += nextTokens;
  }
  return {
    traceId,
    items,
    omittedSpanCount: Math.max(0, ranked.length - items.length),
    tokenBudget: budget,
    estimatedTokens,
    readonly: true,
  };
}

function toSummaryItem(
  span: RuntimeTraceSpan,
  priorityQuery: RuntimeTraceSummaryPriorityQuery,
): RuntimeTraceSummaryItem {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
    name: span.name,
    kind: span.kind,
    status: span.status,
    ...(span.endedAt !== undefined
      ? { durationMs: Math.max(0, span.endedAt - span.startedAt) }
      : {}),
    summary: formatSummary(span),
    eventCount: span.events.length,
    sourceRefs: cloneJson(span.sourceRefs),
    evidenceRefs: collectEvidenceRefs(span),
    links: cloneJson(span.links),
    rank: storeSpanRank(span, priorityQuery),
  };
}

function formatSummary(span: RuntimeTraceSpan): string {
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
  const sourceLabels = span.sourceRefs
    .flatMap((ref) => [ref.file, ref.symbol].filter(isPresentString))
    .slice(0, 3);
  if (sourceLabels.length > 0) {
    parts.push(`source=${sourceLabels.join(",")}`);
  }
  if (span.evidenceRefs.length > 0) {
    parts.push(`evidence=${span.evidenceRefs.length}`);
  }
  if (span.events.length > 0) {
    parts.push(`events=${span.events.length}`);
  }
  if (span.statusMessage) {
    parts.push(`message=${span.statusMessage}`);
  }
  return parts.join(" | ");
}

function collectEvidenceRefs(span: RuntimeTraceSpan): EvidenceRef[] {
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
    return [cloneJson(ref)];
  });
}

function relationshipMatches(
  expected: RuntimeTraceLinkRelationship | undefined,
  link: RuntimeTraceSpanLink,
): boolean {
  return expected === undefined || link.relationship === expected;
}

function traceSpanKey(
  span: Pick<RuntimeTraceSpan | RuntimeTraceSpanLink, "traceId" | "spanId">,
): string {
  return `${span.traceId}\u0000${span.spanId}`;
}

function positiveIntegerOrDefault(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / TOKEN_CHAR_WIDTH);
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  return text.slice(0, Math.max(0, tokenBudget * TOKEN_CHAR_WIDTH));
}

function stringAttribute(
  span: RuntimeTraceSpan,
  key: string,
): string | undefined {
  const value = span.attributes[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isPresentString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
