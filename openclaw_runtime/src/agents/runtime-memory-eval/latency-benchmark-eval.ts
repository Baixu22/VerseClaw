// Latency benchmark evaluation for runtime-memory.
// Pure function: extract p50/p95 latency and token overhead from a
// MultiTurnRunResult's aggregate treatment metrics, compare against budgets,
// and return a pass/fail result.
//
// Fills the "no latency threshold assertion" gap — multi-turn-driver collects
// latencyMs and tokenOverhead but no eval dimension asserts they stay within
// budget at p95.

import type { MultiTurnRunResult } from "./multi-turn-driver.js";

export type LatencyBenchmarkResult = {
  latencyMsP50: number;
  latencyMsP95: number;
  tokenOverheadP50: number;
  tokenOverheadP95: number;
  latencyBudgetMs: number;
  tokenBudgetMax: number;
  latencyPassRate: number;
  tokenPassRate: number;
};

export const DEFAULT_LATENCY_BUDGET_MS = 50;
export const DEFAULT_TOKEN_OVERHEAD_BUDGET = 200;

export function evaluateLatencyBenchmark(
  runResult: MultiTurnRunResult,
  options?: {
    latencyBudgetMs?: number;
    tokenBudgetMax?: number;
    arm?: "baseline" | "treatment";
  },
): LatencyBenchmarkResult {
  const latencyBudgetMs = options?.latencyBudgetMs ?? DEFAULT_LATENCY_BUDGET_MS;
  const tokenBudgetMax = options?.tokenBudgetMax ?? DEFAULT_TOKEN_OVERHEAD_BUDGET;
  const arm = options?.arm ?? "treatment";

  const aggregate = arm === "baseline" ? runResult.aggregateBaseline : runResult.aggregateTreatment;

  const latencyMsP50 = aggregate.latencyMs.p50;
  const latencyMsP95 = aggregate.latencyMs.p95;
  const tokenOverheadP50 = aggregate.tokenOverhead.p50;
  const tokenOverheadP95 = aggregate.tokenOverhead.p95;

  const latencyPassRate = latencyMsP95 <= latencyBudgetMs ? 1 : 0;
  const tokenPassRate = tokenOverheadP95 <= tokenBudgetMax ? 1 : 0;

  return {
    latencyMsP50,
    latencyMsP95,
    tokenOverheadP50,
    tokenOverheadP95,
    latencyBudgetMs,
    tokenBudgetMax,
    latencyPassRate,
    tokenPassRate,
  };
}
