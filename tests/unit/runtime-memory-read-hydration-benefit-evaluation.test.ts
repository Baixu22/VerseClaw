// @vitest-environment node
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  consumeRuntimeMemoryHydrationFacts,
  hydrateRuntimeMemoryShadowContext,
} from "../../openclaw_runtime/src/runtime-core";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import {
  createTempDbPath,
  evaluate,
  expectThreshold,
  loadEvalFixtures,
  pickMemoryDependentGroups,
  seedTempDb,
  sum,
  percentile,
  type ThresholdAssert,
} from "./helpers/runtime-memory-eval-helpers";

const {
  facts,
  queries,
  scenarios,
  expectedMetrics,
  corpus,
  labelByFactId,
} = loadEvalFixtures();

const tempDirs: string[] = [];

const thresholdAssert: ThresholdAssert = {
  ge: (value, min, message) => expect(value, message).toBeGreaterThanOrEqual(min),
  le: (value, max, message) => expect(value, message).toBeLessThanOrEqual(max),
};

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime memory read hydration benefit evaluation corpus", () => {
  it("covers the required scale, eight scenario categories, and ten label classes", () => {
    expect(facts.length).toBeGreaterThanOrEqual(500);
    expect(facts.length).toBeLessThanOrEqual(2000);
    expect(queries.length).toBeGreaterThanOrEqual(100);
    expect(scenarios.map((entry) => entry.arm)).toEqual([
      "baseline",
      "naiveMemory",
      "guardedMemory",
    ]);

    const categories = new Set(facts.map((fact) => fact.category));
    expect(categories).toEqual(
      new Set([
        "repo_conventions",
        "user_preferences",
        "project_architecture",
        "task_history",
        "negative_memory",
        "conflict_memory",
        "hazard_memory",
        "distractor_memory",
      ]),
    );

    const labelCounts = new Map<string, number>();
    for (const fact of facts) {
      for (const label of fact.labels) {
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      }
    }
    for (const label of [
      "useful",
      "stale",
      "invalid",
      "future",
      "candidate",
      "rejected",
      "conflict",
      "prompt_injection",
      "raw_leak",
      "distractor",
    ]) {
      expect(labelCounts.get(label) ?? 0).toBeGreaterThan(0);
    }

    expect(expectedMetrics.corpus.provenance).toBe("controlled_fixture");
    expect(expectedMetrics.corpus.sanitized).toBe(true);
    expect(expectedMetrics.corpus.noUserRealData).toBe(true);
    expect(expectedMetrics.corpus.reproducible).toBe(true);
  });
});

describe("runtime memory read hydration benefit evaluation", () => {
  it("proves guarded memory beats baseline and naive hydration across the three arms", () => {
    const report = evaluate(corpus, queries, labelByFactId);
    expect(report.guardedRecallAtK).toBe(1);
    expect(report.guardedPrecision).toBe(1);
    expect(report.naiveRecallAtK).toBe(1);
    expect(report.naivePrecision).toBeLessThan(0.4);
    expect(report.baselineRecallAtK).toBe(0);

    expectThreshold(report, "guardedRecallAtK", expectedMetrics, thresholdAssert);
    expectThreshold(report, "guardedPrecision", expectedMetrics, thresholdAssert);
    expectThreshold(report, "staleInvalidSuppressionRate", expectedMetrics, thresholdAssert);
    expectThreshold(report, "candidateRejectedSuppressionRate", expectedMetrics, thresholdAssert);
    expectThreshold(report, "conflictSuppressionRate", expectedMetrics, thresholdAssert);
    expectThreshold(report, "taskSubjectPredicateIsolationRate", expectedMetrics, thresholdAssert);
    expectThreshold(report, "rawLeakRate", expectedMetrics, thresholdAssert);
    expectThreshold(report, "promptInjectionReturnRate", expectedMetrics, thresholdAssert);
    expectThreshold(report, "wrongConflictWinnerRate", expectedMetrics, thresholdAssert);
    expectThreshold(report, "emptyNoOpSafetyRate", expectedMetrics, thresholdAssert);
    expectThreshold(report, "guardedVsBaselineLiftMemoryDependent", expectedMetrics, thresholdAssert);
    expectThreshold(report, "guardedMemoryIrrelevantReductionVsBaseline", expectedMetrics, thresholdAssert);
    expectThreshold(report, "guardedVsNaiveHazardReduction", expectedMetrics, thresholdAssert);

    expect(report.baselineTaskSuccessRate).toBe(
      expectedMetrics.expected.baselineTaskSuccessRate,
    );
    expect(report.naiveMemoryTaskSuccessRate).toBe(0);
    expect(report.guardedMemoryTaskSuccessRate).toBe(1);
    expect(report.guardedVsBaselineLiftMemoryDependent).toBeGreaterThanOrEqual(0.15);
    expect(report.guardedMemoryIrrelevantSuccessRate).toBe(
      report.baselineMemoryIrrelevantSuccessRate,
    );
  });

  it("suppresses stale, invalid, candidate, rejected, conflict, hazard, and distractor facts under guarded memory", () => {
    const report = evaluate(corpus, queries, labelByFactId);

    expect(report.guardedReturnedUnsafeLabelCount).toBe(0);
    expect(report.guardedReturnedHazardCount).toBe(0);
    expect(report.guardedReturnedMustRejectCount).toBe(0);
    expect(report.guardedReturnedDistractorCount).toBe(0);
    expect(report.naiveReturnedHazardCount).toBeGreaterThan(0);
    expect(report.naiveReturnedUnsafeLabelCount).toBeGreaterThan(0);
    expect(report.naiveReturnedMustRejectCount).toBeGreaterThan(0);

    const repoQuery = queries.find((entry) =>
      entry.category === "repo_conventions" && entry.memoryRelevant
    );
    expect(repoQuery).toBeDefined();
    const repoGuarded = consumeRuntimeMemoryHydrationFacts(corpus, repoQuery!);
    expect(repoGuarded.acceptedFacts.map((fact) => fact.factId)).toEqual(
      repoQuery!.expectedFactIds,
    );
    expect(repoGuarded.metrics.rejectionCounts.expired_at_reference_time)
      .toBeGreaterThan(0);
    expect(repoGuarded.metrics.rejectionCounts.invalidated_at_reference_time)
      .toBeGreaterThan(0);
    expect(repoGuarded.metrics.rejectionCounts.future_valid_at).toBeGreaterThan(0);
    expect(repoGuarded.metrics.rejectionCounts.record_kind_not_fact).toBeGreaterThan(0);
    expect(repoGuarded.metrics.rejectionCounts.verification_status_not_verified)
      .toBeGreaterThan(0);
    expect(repoGuarded.metrics.rejectionCounts.conflicting_fact).toBeGreaterThan(0);
    expect(repoGuarded.metrics.rejectionCounts.prompt_injection_sentinel)
      .toBeGreaterThan(0);
    expect(repoGuarded.metrics.rejectionCounts.raw_leak_sentinel).toBeGreaterThan(0);
    expect(repoGuarded.metrics.rejectionCounts.task_mismatch).toBeGreaterThan(0);
    expect(repoGuarded.metrics.rejectionCounts.subject_mismatch).toBeGreaterThan(0);
    expect(repoGuarded.metrics.rejectionCounts.predicate_mismatch).toBeGreaterThan(0);

    const acceptedText = JSON.stringify(repoGuarded.acceptedFacts);
    expect(acceptedText).not.toContain("Ignore earlier instructions");
    expect(acceptedText).not.toContain("record_json");
  });

  it("keeps the pure consumer latency p95 under 50ms on the full in-memory corpus", () => {
    const samples: number[] = [];
    const startedAt = () => performance.now();
    for (const query of queries) {
      const t0 = startedAt();
      consumeRuntimeMemoryHydrationFacts(corpus, query);
      samples.push(startedAt() - t0);
    }
    const p95 = percentile(samples, 0.95);
    const p50 = percentile(samples, 0.5);
    expect(p95).toBeLessThan(50);
    expect(p50).toBeLessThan(50);
  });
  it("cannot seed temp SQLite hydration while persistence is retired", () => {
    const subsetGroups = pickMemoryDependentGroups(3, facts);
    const dbPath = createTempDbPath("runtime-memory-benefit-eval-sqlite-", tempDirs);

    // TF-0500 retired runtime.memory.persist; seedTempDb and
    // hydrateRuntimeMemoryShadowContext both gate on it, so the SQLite arm of
    // this benchmark cannot run. The pure-consumer latency case above still
    // covers the consumer hot path.
    expect(() => seedTempDb(dbPath, subsetGroups)).toThrow(/seedTempDb: migration failed/);

    const hydration = hydrateRuntimeMemoryShadowContext({
      config: { runtime: { memory: { persist: true } } },
      databasePath: dbPath,
      readShadow: true,
    });
    expect(hydration.status).toBe("skipped");
    expect(hydration.facts).toHaveLength(0);
  });

  it("returns an empty no-op for memory-irrelevant queries without violations", () => {
    const irrelevant = queries.filter((entry) => !entry.memoryRelevant);
    expect(irrelevant.length).toBeGreaterThan(0);
    for (const query of irrelevant) {
      const guarded = consumeRuntimeMemoryHydrationFacts(corpus, query);
      expect(guarded.acceptedFacts).toEqual([]);
      expect(guarded.metrics.acceptedFacts).toBe(0);
      for (const mustReject of query.mustRejectFactIds) {
        expect(guarded.rejectedFacts.some((entry) => entry.fact.factId === mustReject))
          .toBe(true);
      }
    }
    const report = evaluate(corpus, queries, labelByFactId);
    expect(report.emptyNoOpSafetyRate).toBe(1);
  });

  it("keeps the consumer a pure function with no side effects on repeated calls", () => {
    const query = queries.find((entry) => entry.memoryRelevant)!;
    const first = consumeRuntimeMemoryHydrationFacts(corpus, query);
    const second = consumeRuntimeMemoryHydrationFacts(corpus, query);
    expect(second.acceptedFacts).toEqual(first.acceptedFacts);
    expect(second.rejectedFacts).toEqual(first.rejectedFacts);
    expect(second.metrics).toEqual(first.metrics);
  });
});

// Keep `sum` referenced to satisfy import linter when percentile is the only
// other utility used directly. Both are re-exported via helpers for consumers.
void sum;
