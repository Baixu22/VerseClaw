import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  planCriticalFirstBudget,
  selectCompressionPlan,
} from "../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.js";
import type { CompactionSettings } from "../../openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.js";
import { deprecationCounters } from "../../openclaw_runtime/src/observability/deprecation-counters.js";
import {
  ContextBudgetPlanner,
  FingerprintLeaseCoordinator,
  ResumeContractVerifier,
} from "../../openclaw_runtime/src/agents/cross-area/cross-area-facades.js";
import type { OrchestrationTaskGraph } from "../../openclaw_runtime/src/agents/orchestration-protocol.js";

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

function makeGraph(nodeCount: number): OrchestrationTaskGraph {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    taskNodeId: `task-${i + 1}`,
    roleName: "worker",
    task: `Task ${i + 1}`,
    phase: "worker" as const,
    dependsOn: [] as string[],
    scope: "default",
    requiredCapabilities: [],
    attemptPolicy: { maxRepairAttempts: 0, maxRedoAttempts: 0 },
    status: "planned" as const,
  }));
  return { graphRunId: "perf-run", mode: "auto", status: "planned", nodes, edges: [] };
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

describe("A6 performance budgets", () => {
  beforeEach(() => deprecationCounters.reset());
  afterEach(() => deprecationCounters.reset());

  it("10 pause/resume cycles p99 stays <= 300ms and writes bounded evidence", () => {
    const planner = new ContextBudgetPlanner(makeGraph(8), 4);
    planner.plan();
    const verifier = new ResumeContractVerifier();
    const coordinator = new FingerprintLeaseCoordinator();

    const durations: number[] = [];
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const started = performance.now();
      // Pause: A1 commits its lease before A6 writes the checkpoint.
      const pause = coordinator.coordinatePause(`lease-${cycle}`, `checkpoint-${cycle}`);
      expect(pause.leaseBeforeCheckpoint).toBe(true);
      // Resume: A5 re-runs the budget planner and A6 re-checks the contract.
      planner.replanOnResume(3 - (cycle % 3));
      const contract = verifier.verify({ config: undefined }, cycle % 2 === 0);
      expect(contract.requiresReverification).toBe(false);
      durations.push(performance.now() - started);
    }

    expect(planner.resumeReexecutions).toBe(10);
    const p99 = percentile99(durations);
    expect(p99).toBeLessThanOrEqual(300);

    const outDir = path.resolve("artifacts/context-compression-p5");
    mkdirSync(outDir, { recursive: true });
    const evidence = {
      schema: "a6-pause-resume-p99/v1",
      generatedAt: new Date().toISOString(),
      samples: durations.length,
      cycles: durations.length,
      p99Ms: p99,
      maxMs: Math.max(...durations),
      budgetMs: 300,
    };
    writeFileSync(path.join(outDir, "a6-pause-resume-p99.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    expect(JSON.parse(JSON.stringify(evidence))).toEqual(evidence);
  });
});
