import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  planCriticalFirstBudget,
  selectCompressionPlan,
} from "../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.js";
import type { CompactionSettings } from "../../openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.js";
import { deprecationCounters } from "../../openclaw_runtime/src/observability/deprecation-counters.js";

const SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  contextWindow: 1_000,
};

function percentile99(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.99) - 1)] ?? 0;
}

describe("A5 performance budgets", () => {
  beforeEach(() => deprecationCounters.reset());
  afterEach(() => deprecationCounters.reset());

  it("planner 100-call p99 stays <= 30ms", () => {
    const durations: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now();
      selectCompressionPlan({
        tokensBefore: 700 + index,
        settings: SETTINGS,
        thresholds: { tier1: 0.55 },
      });
      durations.push(performance.now() - started);
    }
    const p99 = percentile99(durations);
    expect(p99).toBeLessThanOrEqual(30);

    const outDir = path.resolve("artifacts/context-compression-p5");
    mkdirSync(outDir, { recursive: true });
    const evidence = {
      schema: "p5-planner-p99/v1",
      generatedAt: new Date().toISOString(),
      samples: durations.length,
      p99Ms: p99,
      maxMs: Math.max(...durations),
      budgetMs: 30,
    };
    writeFileSync(path.join(outDir, "planner-p99.json"), `${JSON.stringify(evidence, null, 2)}
`);
  });

  it("A5+A1+A3 cumulative per-turn smoke p99 stays <= 300ms and writes bounded evidence", () => {
    const durations: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now();
      planCriticalFirstBudget({
        criticalLedger: [],
        latestUserAsk: `fix auth ${index}`,
        unfinishedActions: ["update tests"],
        failureChainValidation: ["failed: auth timeout"],
        exactIdentifiers: ["AUTH_PROFILE_ID"],
        importantFacts: ["provider timeout is 30s"],
        niceToHaveProse: ["background notes"],
        budgetTokens: 120,
      });
      deprecationCounters.incrementA1ShadowSuccess(1);
      deprecationCounters.incrementA3MissionTicks(1);
      deprecationCounters.checkBudgetViolation("a1");
      deprecationCounters.checkBudgetViolation("a3");
      deprecationCounters.checkBudgetViolation("a5");
      durations.push(performance.now() - started);
    }
    const p99 = percentile99(durations);
    expect(p99).toBeLessThanOrEqual(300);

    const outDir = path.resolve("artifacts/context-compression-p5");
    mkdirSync(outDir, { recursive: true });
    const evidence = {
      schema: "p5-performance-smoke/v1",
      generatedAt: new Date().toISOString(),
      samples: durations.length,
      p99Ms: p99,
      maxMs: Math.max(...durations),
      budgetMs: 300,
      counters: deprecationCounters.snapshot(),
    };
    writeFileSync(path.join(outDir, "perf-smoke.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    expect(JSON.parse(JSON.stringify(evidence))).toEqual(evidence);
  });
});
