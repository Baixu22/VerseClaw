// Simple in-memory trace buffer in the gateway/runtime process.
// Traces reported via `observability.reportTrace` are stored here and
// served by `observability.traces`. The electron process merges these
// with its own trace buffer on the Observability page.
//
// This is NOT persisted to disk in MVP — traces reset on gateway restart.

import type { ObservabilityScorecard, ObservabilityTrace } from "./types.js";

const MAX_TRACES = 100;
const traceBuffer = new Map<string, ObservabilityTrace>();
// Scorecards are stored alongside traces so the dashboard can surface quality
// grades without recomputing. Keyed by traceId.
const scorecardStore = new Map<string, ObservabilityScorecard>();

export function storeRuntimeTrace(trace: ObservabilityTrace, scorecard?: ObservabilityScorecard): void {
  traceBuffer.set(trace.id, trace);
  if (scorecard) {
    scorecardStore.set(trace.id, scorecard);
  }
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

export function getRuntimeScorecard(traceId: string): ObservabilityScorecard | undefined {
  return scorecardStore.get(traceId);
}

export function clearRuntimeTraceBuffer(): void {
  traceBuffer.clear();
  scorecardStore.clear();
}
