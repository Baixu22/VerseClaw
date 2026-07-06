// @vitest-environment node
// Phase 36: 30-turn long conversation A/B evaluation with statistical significance.
// Baseline arm: empty DB (no facts) → recall@k = 0.
// Treatment arm: seeded DB (facts match queries) → recall@k > 0.
// Asserts paired t-test significance, bootstrap CI, Cohen's d, minimum sample size,
// and hazard suppression across 30 turns × 4 queries per turn.

import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { ScriptedLlmDriver } from "../../openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.js";
import { runMultiTurnDriver, type MultiTurnQueryPlan, type MultiTurnRunResult } from "../../openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.js";
import {
  bootstrapConfidenceInterval,
  cohensD,
  mean,
  minimumSampleSize,
  pairedTTest,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/statistics.js";
import {
  createTempDbPath,
  filterQueriesBySeededGroups,
  loadEvalFixtures,
  pickMemoryDependentGroups,
  RUNTIME_MEMORY_EVAL_CONFIG,
  seedTempDb,
} from "./helpers/runtime-memory-eval-helpers";
import { generateLongConversationReport } from "./helpers/runtime-memory-eval-report";

const { facts, queries } = loadEvalFixtures();
const tempDirs: string[] = [];
const TURNS = 30;
const QUERIES_PER_TURN = 4;
const TOTAL_QUERIES = TURNS * QUERIES_PER_TURN;
const SESSION_KEY = "agent:main:phase36-long-conversation";
const NOW = () => 1_000;

let runResult: MultiTurnRunResult;

beforeAll(() => {
  const baselineDbPath = createTempDbPath("phase36-lc-baseline-", tempDirs);
  initializeEmptyDb(baselineDbPath);

  const treatmentDbPath = createTempDbPath("phase36-lc-treatment-", tempDirs);
  const groups = pickMemoryDependentGroups(8, facts);
  seedTempDb(treatmentDbPath, groups);

  const memoryRelevantQueries = filterQueriesBySeededGroups(queries, groups);
  if (memoryRelevantQueries.length === 0) {
    throw new Error("No memory-relevant queries with expected facts found in fixture");
  }

  const queryPlans: MultiTurnQueryPlan[] = [];
  for (let i = 0; i < TOTAL_QUERIES; i += 1) {
    const q = memoryRelevantQueries[i % memoryRelevantQueries.length];
    queryPlans.push({
      queryId: `lcq_${i}`,
      taskId: q.taskId,
      subject: q.subject,
      predicate: q.predicate,
      referenceTime: q.referenceTime,
      tokenBudget: q.tokenBudget ?? 512,
      limit: q.limit ?? 8,
      expectedFactIds: q.expectedFactIds,
    });
  }

  const scriptedLlm = new ScriptedLlmDriver([
    {
      sessionKey: SESSION_KEY,
      arm: "baseline",
      responses: Array.from({ length: TURNS }, (_, i) => ({
        text: `baseline-turn-${i}`,
      })),
    },
    {
      sessionKey: SESSION_KEY,
      arm: "treatment",
      responses: Array.from({ length: TURNS }, (_, i) => ({
        text: `treatment-turn-${i}`,
      })),
    },
  ]);

  runResult = runMultiTurnDriver({
    turns: TURNS,
    queriesPerTurn: QUERIES_PER_TURN,
    sessionKey: SESSION_KEY,
    scriptedLlm,
    baselineDatabasePath: baselineDbPath,
    treatmentDatabasePath: treatmentDbPath,
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    queries: queryPlans,
    baselineOptions: {
      limit: 16,
      maxFacts: 64,
      now: NOW,
    },
    treatmentOptions: {
      limit: 16,
      maxFacts: 64,
      now: NOW,
      breakthroughInjection: {
        enabled: true,
        arm: "treatment",
        acceptedFactsMaxTokens: 2048,
      },
    },
  });
});

afterAll(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime memory long conversation statistical evaluation", () => {
  it("completes 30 turns × 4 queries with scripted LLM under 60s", () => {
    expect(runResult.turnCount).toBe(TURNS);
    expect(runResult.queriesPerTurn).toBe(QUERIES_PER_TURN);
    expect(runResult.turns).toHaveLength(TURNS);
    expect(runResult.totalDurationMs).toBeLessThan(60_000);
  });

  it("treatment recall@k exceeds baseline recall@k with paired t-test significance", () => {
    const baselineRecalls = runResult.turns.map((t) => t.baseline.recallAtK);
    const treatmentRecalls = runResult.turns.map((t) => t.treatment.recallAtK);

    expect(mean(treatmentRecalls)).toBeGreaterThan(mean(baselineRecalls));

    const tTest = pairedTTest(baselineRecalls, treatmentRecalls);
    expect(tTest.meanDiff).toBeGreaterThan(0);
    expect(tTest.significant).toBe(true);
    expect(tTest.pValue).toBeLessThan(0.05);
  });

  it("bootstrap CI of treatment recall@k excludes baseline mean", () => {
    const baselineRecalls = runResult.turns.map((t) => t.baseline.recallAtK);
    const treatmentRecalls = runResult.turns.map((t) => t.treatment.recallAtK);
    const baselineMean = mean(baselineRecalls);

    const ci = bootstrapConfidenceInterval(treatmentRecalls, { seed: 0x1a2b3c4d });
    expect(ci.lower).toBeGreaterThan(baselineMean);
  });

  it("minimum sample size for observed cohensD is achievable within 30 turns", () => {
    const baselineRecalls = runResult.turns.map((t) => t.baseline.recallAtK);
    const treatmentRecalls = runResult.turns.map((t) => t.treatment.recallAtK);

    const d = cohensD(baselineRecalls, treatmentRecalls);
    expect(d).toBeGreaterThan(0);

    const requiredN = minimumSampleSize(d, 0.05, 0.8);
    expect(requiredN).toBeLessThanOrEqual(TURNS);
  });

  it("raw leak rate and prompt injection rate remain 0 in treatment across all turns", () => {
    for (const turn of runResult.turns) {
      expect(turn.treatment.rawLeakRate).toBe(0);
      expect(turn.treatment.promptInjectionReturnRate).toBe(0);
    }
    expect(runResult.aggregateTreatment.rawLeakRate.mean).toBe(0);
    expect(runResult.aggregateTreatment.promptInjectionReturnRate.mean).toBe(0);
  });

  it("generates a structured report with significant conclusion", () => {
    const report = generateLongConversationReport(runResult, { now: () => 1_000 });
    expect(report.turns).toBe(TURNS);
    expect(report.queriesPerTurn).toBe(QUERIES_PER_TURN);
    expect(report.conclusion.significant).toBe(true);
    expect(report.conclusion.achieved).toBe(true);
    expect(report.conclusion.effectSizeLabel).not.toBe("negligible");
    expect(report.statistics.pairedTTest.significant).toBe(true);
    expect(report.statistics.minimumSampleSize).toBeLessThanOrEqual(TURNS);
  });
});

function initializeEmptyDb(dbPath: string): void {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    now: NOW,
  });
  if (persistence.migrate().status !== "migrated") {
    throw new Error(`initializeEmptyDb: migration failed for ${dbPath}`);
  }
}
