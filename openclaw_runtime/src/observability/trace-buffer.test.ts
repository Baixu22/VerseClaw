/**
 * B-4 v2: trace-buffer scorecard storage — synthetic context-health scorecards
 * are stored, bounded by their own cap, and never collide with real trace ids.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  clearRuntimeTraceBuffer,
  getRuntimeScorecards,
  storeRuntimeScorecard,
  storeRuntimeTrace,
} from "./trace-buffer.js";
import type { ObservabilityScorecard, ObservabilityTrace } from "./types.js";

afterEach(() => {
  clearRuntimeTraceBuffer();
});

function healthCard(traceId: string, score: number): ObservabilityScorecard {
  return {
    traceId,
    score,
    grade: score >= 90 ? "A" : "F",
    items: [{ id: "injectionPressure", label: "Injection Pressure", score, weight: 0.2, reason: "ok" }],
  };
}

function makeTrace(id: string): ObservabilityTrace {
  return {
    id,
    mode: "main",
    status: "completed",
    startedAt: 0,
    updatedAt: 1,
    endedAt: 1,
    tracePath: `/tmp/${id}.jsonl`,
    tags: [],
    totalSpanCount: 0,
    spanCount: 0,
    errorCount: 0,
    tokenUsage: { input: 0, output: 0, cache: 0, total: 0 },
    model: "test-model",
  } as unknown as ObservabilityTrace;
}

describe("B-4 v2 storeRuntimeScorecard", () => {
  it("stores synthetic context-health cards and returns them via getRuntimeScorecards", () => {
    storeRuntimeScorecard(healthCard("ctx-health-turn-1", 95));
    const cards = getRuntimeScorecards();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.traceId).toBe("ctx-health-turn-1");
    expect(cards[0]?.score).toBe(95);
  });

  it("ignores scorecards without a traceId", () => {
    storeRuntimeScorecard(healthCard("", 95));
    expect(getRuntimeScorecards()).toHaveLength(0);
  });

  it("does not evict real trace scorecards when only synthetic ones overflow", () => {
    // One real trace scorecard tied to an actual trace id.
    const real = healthCard("trace-real-1", 88);
    storeRuntimeTrace(makeTrace("trace-real-1"), real);
    // Overflow with synthetic cards.
    for (let i = 0; i < 120; i += 1) {
      storeRuntimeScorecard(healthCard(`ctx-health-turn-${i}`, 90));
    }
    const cards = getRuntimeScorecards();
    const realCard = cards.find((card) => card.traceId === "trace-real-1");
    expect(realCard).toBeDefined();
    const syntheticCount = cards.filter((card) => card.traceId.startsWith("ctx-health-")).length;
    expect(syntheticCount).toBeLessThanOrEqual(100);
  });
});
