import type {
  ObservabilityDashboardSnapshot,
  ObservabilityMetricCard,
  ObservabilityScorecard,
  ObservabilityTokenUsage,
  ObservabilityTrace,
  ObservabilityTraceMetrics,
} from "./types.js";

export const EMPTY_OBSERVABILITY_TOKEN_USAGE: ObservabilityTokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costUsd: 0,
};

export function addObservabilityTokenUsage(
  left: ObservabilityTokenUsage,
  right: ObservabilityTokenUsage,
): ObservabilityTokenUsage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: left.totalTokens + right.totalTokens,
    costUsd: Number((left.costUsd + right.costUsd).toFixed(8)),
  };
}

export function aggregateTraceMetrics(trace: ObservabilityTrace): ObservabilityTraceMetrics {
  const errorCount = trace.spans.filter((span) => span.status === "error" || span.status === "aborted").length + (trace.status === "error" ? 1 : 0);
  const toolCallCount = trace.spans.filter((span) => span.kind === "tool").length + (trace.metrics.toolCallCount ?? 0);
  const subagentCount = trace.spans.filter((span) => span.kind === "subagent").length + (trace.metrics.subagentCount ?? 0);
  const memoryOperationCount = trace.spans.filter((span) => span.kind === "memory" || span.kind === "gatekeeper").length;
  const contextPackCount = trace.spans.filter((span) => span.kind === "context-pack").length;
  const verifierCount = trace.spans.filter((span) => span.kind === "verifier" || span.roleName === "skeptic").length;
  const longestSpan = trace.spans.reduce<ObservabilityTraceMetrics["longestSpan"]>((current, span) => {
    const durationMs = span.durationMs ?? 0;
    if (!current || durationMs > current.durationMs) {
      return { id: span.id, name: span.name, durationMs };
    }
    return current;
  }, undefined);
  return {
    traceId: trace.id,
    durationMs: trace.durationMs ?? Math.max(0, Date.now() - trace.startedAt),
    spanCount: trace.spans.length,
    errorCount,
    toolCallCount,
    subagentCount,
    memoryOperationCount,
    contextPackCount,
    verifierCount,
    tokenUsage: { ...trace.tokenUsage },
    costUsd: trace.tokenUsage.costUsd,
    longestSpan,
  };
}

function toneForErrors(errorCount: number): ObservabilityMetricCard["tone"] {
  return errorCount === 0 ? "good" : errorCount < 3 ? "warn" : "bad";
}

export function buildMetricCards(traces: readonly ObservabilityTrace[]): ObservabilityMetricCard[] {
  const metrics = traces.map(aggregateTraceMetrics);
  const totals = metrics.reduce(
    (acc, metric) => ({
      durationMs: acc.durationMs + metric.durationMs,
      errorCount: acc.errorCount + metric.errorCount,
      toolCallCount: acc.toolCallCount + metric.toolCallCount,
      subagentCount: acc.subagentCount + metric.subagentCount,
      tokenCount: acc.tokenCount + metric.tokenUsage.totalTokens,
      costUsd: acc.costUsd + metric.costUsd,
    }),
    { durationMs: 0, errorCount: 0, toolCallCount: 0, subagentCount: 0, tokenCount: 0, costUsd: 0 },
  );
  return [
    { id: "traces", label: "Traces", value: traces.length, tone: "neutral" },
    { id: "avg-duration", label: "Avg Duration", value: traces.length ? Math.round(totals.durationMs / traces.length) : 0, unit: "ms", tone: "neutral" },
    { id: "errors", label: "Errors", value: totals.errorCount, tone: toneForErrors(totals.errorCount) },
    { id: "subagents", label: "Subagents", value: totals.subagentCount, tone: "neutral" },
    { id: "tools", label: "Tool Calls", value: totals.toolCallCount, tone: "neutral" },
    { id: "tokens", label: "Tokens", value: totals.tokenCount, tone: "neutral" },
    { id: "cost", label: "Cost", value: Number(totals.costUsd.toFixed(6)), unit: "USD", tone: totals.costUsd > 1 ? "warn" : "good" },
  ];
}

export function buildDashboardSnapshot(
  traces: readonly ObservabilityTrace[],
  scorecards: readonly ObservabilityScorecard[] = [],
  now = Date.now(),
): ObservabilityDashboardSnapshot {
  const scoreByTrace = new Map(scorecards.map((scorecard) => [scorecard.traceId, scorecard]));
  const alerts: string[] = [];
  for (const trace of traces) {
    const metrics = aggregateTraceMetrics(trace);
    if (metrics.errorCount > 0) {
      alerts.push(`${trace.name} has ${metrics.errorCount} error(s).`);
    }
    if (metrics.contextPackCount === 0 && trace.tags.includes("role-first")) {
      alerts.push(`${trace.name} has no context-pack span.`);
    }
    if (trace.mode === "adversarial-review" && metrics.verifierCount === 0) {
      alerts.push(`${trace.name} is adversarial but has no verifier span.`);
    }
  }
  return {
    generatedAt: now,
    cards: buildMetricCards(traces),
    scorecards: [...scorecards],
    traces: traces.map((trace) => {
      const metrics = aggregateTraceMetrics(trace);
      return {
        id: trace.id,
        name: trace.name,
        status: trace.status,
        durationMs: metrics.durationMs,
        score: scoreByTrace.get(trace.id)?.score,
        costUsd: metrics.costUsd,
        tokenCount: metrics.tokenUsage.totalTokens,
        spanCount: metrics.spanCount,
        errorCount: metrics.errorCount,
      };
    }),
    alerts,
  };
}


/**
 * Decision plan §5 "read" axis metric hooks (C0/C1-2 prep).
 * Process counters live in context-engine/coding-observability.ts;
 * this export is a stable name map for scorecard / A-B harnesses.
 * Recording here is a no-op stub (does not change dashboard behavior).
 */
export const CODING_READ_AXIS_METRICS = {
  /** Tool call count / token cost for navigation coding tasks (off/on A-B). */
  toolCallsAndTokenCost: "coding.read.toolCallsAndTokenCost",
  /** FactStore materializer hit rate (fresh / (fresh+parsed)). */
  factStoreHitRate: "coding.read.factStoreHitRate",
  /** Injected tool schema character occupancy (W0-4 / addendum 6). */
  schemaOccupancy: "coding.read.schemaOccupancy",
} as const;

export type CodingReadAxisMetricKey =
  (typeof CODING_READ_AXIS_METRICS)[keyof typeof CODING_READ_AXIS_METRICS];

/** No-op stub: reserved for future dashboard wiring without changing current behavior. */
export function recordCodingReadAxisMetric(
  _key: CodingReadAxisMetricKey,
  _value: number,
  _labels?: Record<string, string>,
): void {
  // intentional no-op (C1-2 prep)
}
