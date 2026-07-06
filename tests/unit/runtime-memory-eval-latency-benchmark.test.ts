// @vitest-environment node
// Phase 38 D2: Latency benchmark dimension test.
// Verifies that evaluateLatencyBenchmark correctly extracts p50/p95 from
// MultiTurnRunResult aggregate metrics and compares against thresholds.

import { describe, expect, it } from "vitest";
import {
  evaluateLatencyBenchmark,
  DEFAULT_LATENCY_BUDGET_MS,
  DEFAULT_TOKEN_OVERHEAD_BUDGET,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/latency-benchmark-eval";
import type { MultiTurnRunResult } from "../../openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver";

function buildMockRunResult(
  latencyP50: number,
  latencyP95: number,
  tokenP50: number,
  tokenP95: number,
): MultiTurnRunResult {
  return {
    turns: [],
    aggregateBaseline: {
      recallAtK: { mean: 0, p50: 0, p95: 0, count: 0 },
      precision: { mean: 0, p50: 0, p95: 0, count: 0 },
      latencyMs: { mean: 0, p50: 0, p95: 0, count: 0 },
      tokenOverhead: { mean: 0, p50: 0, p95: 0, count: 0 },
      rawLeakRate: { mean: 0, p50: 0, p95: 0, count: 0 },
      promptInjectionReturnRate: { mean: 0, p50: 0, p95: 0, count: 0 },
      acceptedFactCount: { mean: 0, p50: 0, p95: 0, count: 0 },
      rejectedFactCount: { mean: 0, p50: 0, p95: 0, count: 0 },
    },
    aggregateTreatment: {
      recallAtK: { mean: 0, p50: 0, p95: 0, count: 0 },
      precision: { mean: 0, p50: 0, p95: 0, count: 0 },
      latencyMs: { mean: (latencyP50 + latencyP95) / 2, p50: latencyP50, p95: latencyP95, count: 10 },
      tokenOverhead: { mean: (tokenP50 + tokenP95) / 2, p50: tokenP50, p95: tokenP95, count: 10 },
      rawLeakRate: { mean: 0, p50: 0, p95: 0, count: 0 },
      promptInjectionReturnRate: { mean: 0, p50: 0, p95: 0, count: 0 },
      acceptedFactCount: { mean: 0, p50: 0, p95: 0, count: 0 },
      rejectedFactCount: { mean: 0, p50: 0, p95: 0, count: 0 },
    },
    totalDurationMs: 1000,
    turnCount: 10,
    queriesPerTurn: 4,
  };
}

describe("latency benchmark evaluation", () => {
  it("extracts p50/p95 latency and token overhead from MultiTurnRunResult", () => {
    const runResult = buildMockRunResult(5, 25, 50, 100);
    const result = evaluateLatencyBenchmark(runResult);

    expect(result.latencyMsP50).toBe(5);
    expect(result.latencyMsP95).toBe(25);
    expect(result.tokenOverheadP50).toBe(50);
    expect(result.tokenOverheadP95).toBe(100);
  });

  it("latencyPassRate = 1 when p95 <= budget (default 50ms)", () => {
    const runResult = buildMockRunResult(10, 40, 50, 100);
    const result = evaluateLatencyBenchmark(runResult);

    expect(result.latencyPassRate).toBe(1);
    expect(result.latencyBudgetMs).toBe(DEFAULT_LATENCY_BUDGET_MS);
  });

  it("latencyPassRate = 0 when p95 > budget", () => {
    const runResult = buildMockRunResult(30, 75, 50, 100);
    const result = evaluateLatencyBenchmark(runResult);

    expect(result.latencyPassRate).toBe(0);
  });

  it("tokenPassRate = 1 when tokenOverhead p95 <= budget (default 200)", () => {
    const runResult = buildMockRunResult(5, 25, 50, 150);
    const result = evaluateLatencyBenchmark(runResult);

    expect(result.tokenPassRate).toBe(1);
    expect(result.tokenBudgetMax).toBe(DEFAULT_TOKEN_OVERHEAD_BUDGET);
  });

  it("tokenPassRate = 0 when tokenOverhead p95 > budget", () => {
    const runResult = buildMockRunResult(5, 25, 100, 250);
    const result = evaluateLatencyBenchmark(runResult);

    expect(result.tokenPassRate).toBe(0);
  });

  it("custom budgets override defaults", () => {
    const runResult = buildMockRunResult(10, 30, 50, 80);
    const result = evaluateLatencyBenchmark(runResult, {
      latencyBudgetMs: 25,
      tokenBudgetMax: 75,
    });

    expect(result.latencyBudgetMs).toBe(25);
    expect(result.tokenBudgetMax).toBe(75);
    // p95 latency 30 > 25 → fail
    expect(result.latencyPassRate).toBe(0);
    // p95 token 80 > 75 → fail
    expect(result.tokenPassRate).toBe(0);
  });

  it("baseline arm metrics are used when arm = 'baseline'", () => {
    const runResult = buildMockRunResult(5, 25, 50, 100);
    const result = evaluateLatencyBenchmark(runResult, { arm: "baseline" });

    // Baseline metrics are all 0 in the mock
    expect(result.latencyMsP50).toBe(0);
    expect(result.latencyMsP95).toBe(0);
    expect(result.tokenOverheadP50).toBe(0);
    expect(result.tokenOverheadP95).toBe(0);
    expect(result.latencyPassRate).toBe(1);
    expect(result.tokenPassRate).toBe(1);
  });
});
