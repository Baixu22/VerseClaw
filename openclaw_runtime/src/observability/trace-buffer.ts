// Simple in-memory trace buffer in the gateway/runtime process.
// Traces reported via `observability.reportTrace` are stored here and
// served by `observability.traces`. The electron process merges these
// with its own trace buffer on the Observability page.
//
// This is NOT persisted to disk in MVP — traces reset on gateway restart.
// The trace buffer is the in-memory observability CACHE only; the OTel/OTLP
// exporter (when installed) exports completed traces through the canonical OTLP
// ExportTraceServiceRequest schema. Exporter-off parity: with no exporter
// installed, storing is byte-identical and nothing is exported; export
// failures never change the store.

import type { ObservabilityScorecard, ObservabilityTrace } from "./types.js";
import type { OtlpJsonExporter } from "./exporter-parity.js";

const MAX_TRACES = 100;
const traceBuffer = new Map<string, ObservabilityTrace>();
// Scorecards are stored alongside traces so the dashboard can surface quality
// grades without recomputing. Keyed by traceId.
const scorecardStore = new Map<string, ObservabilityScorecard>();
// B-4 v2: context-health scorecards are stored under synthetic trace ids
// (`ctx-health-<turnId>`) and never ride a real trace's eviction path, so they
// get their own bounded cap to prevent unbounded growth on long sessions.
const MAX_CONTEXT_HEALTH_SCORECARDS = 100;

// RC-08B: the single production OTLP exporter for the runtime observability
// cache. Default null (exporter-off parity); the runtime installs it when the
// OTel export flag is enabled.
let runtimeTraceExporter: OtlpJsonExporter | null = null;

/** Install (or clear) the production OTLP JSON exporter used by the cache. */
export function setObservabilityTraceExporter(exporter: OtlpJsonExporter | null): void {
  runtimeTraceExporter = exporter;
}

/** Export a completed trace through OTLP when an exporter is installed. */
function exportCompletedTrace(trace: ObservabilityTrace): void {
  const exporter = runtimeTraceExporter;
  if (!exporter || trace.status === "running") {
    return;
  }
  // Export is diagnostic-only: it must never block, change, or fail the store.
  void exporter(trace).catch(() => undefined);
}

export function storeRuntimeTrace(trace: ObservabilityTrace, scorecard?: ObservabilityScorecard): void {
  traceBuffer.set(trace.id, trace);
  if (scorecard) {
    scorecardStore.set(trace.id, scorecard);
  }
  exportCompletedTrace(trace);
  // Evict oldest completed traces when over the cap.
  if (traceBuffer.size > MAX_TRACES) {
    const evictable = [...traceBuffer.values()]
      .filter((t) => t.status !== "running")
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const candidate of evictable) {
      if (traceBuffer.size <= MAX_TRACES) break;
      traceBuffer.delete(candidate.id);
      scorecardStore.delete(candidate.id);
    }
  }
}

export function getRuntimeTraceBuffer(): ObservabilityTrace[] {
  return [...traceBuffer.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function getRuntimeTrace(id: string): ObservabilityTrace | undefined {
  return traceBuffer.get(id);
}

export function getRuntimeScorecards(): ObservabilityScorecard[] {
  return [...scorecardStore.values()];
}

/**
 * B-4 v2: store a scorecard that is not tied to a real trace (e.g. a
 * context-health score keyed by turn). Bounded by its own cap; synthetic keys
 * never collide with real trace ids because of the `ctx-health-` prefix.
 */
export function storeRuntimeScorecard(scorecard: ObservabilityScorecard): void {
  if (!scorecard?.traceId) return;
  scorecardStore.set(scorecard.traceId, scorecard);
  // Evict oldest synthetic scorecards when over the cap (real trace scorecards
  // are evicted alongside their traces and are not counted here).
  if (scorecardStore.size > MAX_CONTEXT_HEALTH_SCORECARDS) {
    const syntheticKeys = [...scorecardStore.keys()].filter((key) => key.startsWith("ctx-health-"));
    let over = syntheticKeys.length - (MAX_CONTEXT_HEALTH_SCORECARDS - (scorecardStore.size - syntheticKeys.length));
    for (const key of syntheticKeys.sort()) {
      if (over <= 0) break;
      scorecardStore.delete(key);
      over -= 1;
    }
  }
}

export function getRuntimeScorecard(traceId: string): ObservabilityScorecard | undefined {
  return scorecardStore.get(traceId);
}

export function clearRuntimeTraceBuffer(): void {
  traceBuffer.clear();
  scorecardStore.clear();
}
