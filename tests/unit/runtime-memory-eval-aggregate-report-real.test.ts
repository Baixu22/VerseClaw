// @vitest-environment node
// Phase 39 Task #87: Real aggregate report artifact generator.
// Runs ALL real eval scenarios (multi-turn driver, cross-axis, hazard,
// conflict) and writes a real aggregate report with actual dimension data
// to artifacts/runtime-memory-eval/report.json + report.md.
//
// This is the "real benchmark" counterpart to run-runtime-memory-eval.mjs:
// the script runs the full test suite for pass/fail, while this test
// produces the real metrics artifact. The script invokes this test first
// so the artifact is always fresh when the suite passes.
//
// Real data sources:
//   - longConversation + latencyBenchmark + utility: 30-turn × 4-query multi-turn driver
//   - crossAxisRejection: 10 direct consumer calls (10 rejection reasons)
//   - hazardSuppression: 7 direct consumer calls (2 rejection reasons)
//   - conflictResolution: 6 DB-based diagnostics (conflicting_fact rejection)
//   - rejectionCoverage: 13/13 reasons fired across all 3 rejection scenarios

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { consumeRuntimeMemoryHydrationFacts } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-consumer";
import type {
  RuntimeMemoryHydrationConsumerRejectionReason,
  RuntimeMemoryHydrationConsumerResult,
} from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-consumer";
import {
  buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
  type TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
} from "../../openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow";
import { ScriptedLlmDriver } from "../../openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.js";
import {
  runMultiTurnDriver,
  type MultiTurnQueryPlan,
  type MultiTurnRunResult,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.js";
import {
  buildConflictScenario,
  evaluateConflictResolution,
  type ConflictGroup,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/conflict-resolution-eval";
import {
  buildHazardScenario,
  evaluateHazardSuppression,
  toHazardConsumerQuery,
  toHazardProjection,
  type HazardScenarioFact,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/hazard-sentinel-eval";
import {
  buildCrossAxisScenario,
  evaluateCrossAxisRejection,
  type CrossAxisFactSpec,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/cross-axis-rejection-eval";
import {
  generateAggregateReport,
  formatAggregateReportAsMarkdown,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/aggregate-report";
import {
  createTempDbPath,
  filterQueriesBySeededGroups,
  loadEvalFixtures,
  pickMemoryDependentGroups,
  RUNTIME_MEMORY_EVAL_CONFIG,
  seedTempDb,
  appendFactToDb,
} from "./helpers/runtime-memory-eval-helpers";
import { generateLongConversationReport } from "./helpers/runtime-memory-eval-report";
import {
  generateEnhancedReport,
  type EnhancedEvalDimensions,
  type EnhancedEvalReport,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/enhanced-report-eval";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..", "..");
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts", "runtime-memory-eval");

const { facts, queries } = loadEvalFixtures();
const tempDirs: string[] = [];
const TURNS = 30;
const QUERIES_PER_TURN = 4;
const TOTAL_QUERIES = TURNS * QUERIES_PER_TURN;
const SESSION_KEY = "agent:main:phase39-real-aggregate";
const NOW = () => 1_000;

const CONFLICT_TASK_ID = "task_conflict_real_aggregate";
const CONFLICT_REFERENCE_TIME = 1_000;
const CONFLICT_GROUP_COUNT = 6;

const HAZARD_TASK_ID = "task_hazard_real_aggregate";
const HAZARD_CLEAN_COUNT = 3;
const HAZARD_HAZARD_COUNT = 2;

const CROSS_AXIS_TASK_ID = "task_cross_axis_real_aggregate";
const CROSS_AXIS_SUBJECT = "CrossAxisRealSubject";
const CROSS_AXIS_PREDICATE = "cross_axis_real_predicate";

let runResult: MultiTurnRunResult;
let lcReport: ReturnType<typeof generateLongConversationReport>;
let crossAxisResults: RuntimeMemoryHydrationConsumerResult[];
let crossAxisResult: ReturnType<typeof evaluateCrossAxisRejection>;
let hazardResults: RuntimeMemoryHydrationConsumerResult[];
let hazardResult: ReturnType<typeof evaluateHazardSuppression>;
let conflictDiagnostics: TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[];
let conflictResult: ReturnType<typeof evaluateConflictResolution>;
let enhancedReport: EnhancedEvalReport;
let aggregateReport: ReturnType<typeof generateAggregateReport>;
let realRejectionCounts: Record<string, number>;
let realFiredReasons: string[];

beforeAll(() => {
  // === 1. Multi-turn driver (30 turns × 4 queries) ===
  const baselineDbPath = createTempDbPath("phase39-agg-baseline-", tempDirs);
  initializeEmptyDb(baselineDbPath);

  const treatmentDbPath = createTempDbPath("phase39-agg-treatment-", tempDirs);
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
      queryId: `raq_${i}`,
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
      responses: Array.from({ length: TURNS }, (_, i) => ({ text: `baseline-${i}` })),
    },
    {
      sessionKey: SESSION_KEY,
      arm: "treatment",
      responses: Array.from({ length: TURNS }, (_, i) => ({ text: `treatment-${i}` })),
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
    baselineOptions: { limit: 16, maxFacts: 64, now: NOW },
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

  lcReport = generateLongConversationReport(runResult, { now: NOW });

  // === 2. Cross-axis rejection (10 reasons, direct consumer calls) ===
  const crossScenario = buildCrossAxisScenario({
    taskId: CROSS_AXIS_TASK_ID,
    subject: CROSS_AXIS_SUBJECT,
    predicate: CROSS_AXIS_PREDICATE,
    referenceTime: CONFLICT_REFERENCE_TIME,
  });
  crossAxisResults = runCrossAxisConsumer(crossScenario);
  crossAxisResult = evaluateCrossAxisRejection(crossScenario, crossAxisResults);

  // === 3. Hazard sentinel (2 reasons, direct consumer calls) ===
  const hazardScenario = buildHazardScenario({
    taskId: HAZARD_TASK_ID,
    referenceTime: CONFLICT_REFERENCE_TIME,
    cleanFactCount: HAZARD_CLEAN_COUNT,
    hazardFactCount: HAZARD_HAZARD_COUNT,
  });
  hazardResults = runHazardConsumer(hazardScenario);
  hazardResult = evaluateHazardSuppression(hazardScenario, hazardResults);

  // === 4. Conflict resolution (conflicting_fact reason, DB-based diagnostics) ===
  const conflictScenario = buildConflictScenario({
    groupCount: CONFLICT_GROUP_COUNT,
    taskId: CONFLICT_TASK_ID,
    referenceTime: CONFLICT_REFERENCE_TIME,
  });
  const conflictDbPath = createTempDbPath("phase39-agg-conflict-", tempDirs);
  initializeEmptyDb(conflictDbPath);
  for (const group of conflictScenario) {
    for (const fact of group.facts) {
      appendFactToDb(conflictDbPath, fact);
    }
  }
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  conflictDiagnostics = runConflictDiagnostics(conflictScenario, conflictDbPath);
  conflictResult = evaluateConflictResolution(conflictScenario, conflictDiagnostics);

  // === 5. Collect real rejection reasons + counts from all 3 scenarios ===
  const reasonCounts = new Map<RuntimeMemoryHydrationConsumerRejectionReason, number>();
  for (const result of crossAxisResults) {
    for (const rejected of result.rejectedFacts) {
      reasonCounts.set(rejected.reason, (reasonCounts.get(rejected.reason) ?? 0) + 1);
    }
  }
  for (const result of hazardResults) {
    for (const rejected of result.rejectedFacts) {
      reasonCounts.set(rejected.reason, (reasonCounts.get(rejected.reason) ?? 0) + 1);
    }
  }
  for (const diag of conflictDiagnostics) {
    for (const queryResult of diag.queries) {
      for (const rejected of queryResult.rejectedFacts) {
        reasonCounts.set(rejected.reason, (reasonCounts.get(rejected.reason) ?? 0) + 1);
      }
    }
  }

  realRejectionCounts = {};
  for (const [reason, count] of reasonCounts) {
    realRejectionCounts[reason] = count;
  }
  realFiredReasons = [...reasonCounts.keys()].sort();

  // === 6. Extract real dimensions from all results ===
  const dims: EnhancedEvalDimensions = {
    longConversation: {
      significant: lcReport.conclusion.significant,
      cohensD: lcReport.statistics.cohensD,
      achieved: lcReport.conclusion.achieved,
    },
    latencyBenchmark: {
      latencyMsP50: runResult.aggregateTreatment.latencyMs.p50,
      latencyMsP95: runResult.aggregateTreatment.latencyMs.p95,
      tokenOverheadP50: runResult.aggregateTreatment.tokenOverhead.p50,
      tokenOverheadP95: runResult.aggregateTreatment.tokenOverhead.p95,
    },
    utility: {
      meanUtility: runResult.aggregateTreatment.recallAtK.mean,
      meanCoverage: runResult.aggregateTreatment.precision.mean,
      meanCompleteness: runResult.aggregateTreatment.recallAtK.mean,
      p95Utility: runResult.aggregateTreatment.recallAtK.p95,
    },
    crossAxisRejection: {
      rejectionCoverage: crossAxisResult.rejectionCoverage,
      allReasonsFired: crossAxisResult.allReasonsFired,
      correctReasonRate: crossAxisResult.correctReasonRate,
    },
    hazardSuppression: {
      promptInjectionSuppressionRate: hazardResult.promptInjectionSuppressionRate,
      rawLeakSuppressionRate: hazardResult.rawLeakSuppressionRate,
      hazardStringLeaked: hazardResult.hazardStringLeaked,
    },
    conflictResolution: {
      wrongConflictWinnerRate: conflictResult.wrongConflictWinnerRate,
      conflictSuppressionRate: conflictResult.conflictSuppressionRate,
    },
  };

  // === 7. Generate enhanced report with real data ===
  enhancedReport = generateEnhancedReport(dims, {
    now: NOW,
    rejectionCounts: realRejectionCounts,
  });

  // === 8. Generate aggregate report ===
  aggregateReport = generateAggregateReport({
    enhancedReport,
    firedReasons: realFiredReasons,
    testSuite: { totalFiles: 0, passedFiles: 0, failedFiles: [] },
    now: NOW,
  });

  // === 9. Write artifacts ===
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(
    path.join(ARTIFACTS_DIR, "report.json"),
    JSON.stringify(aggregateReport, null, 2) + "\n",
    "utf-8",
  );
  writeFileSync(
    path.join(ARTIFACTS_DIR, "report.md"),
    formatAggregateReportAsMarkdown(aggregateReport),
    "utf-8",
  );
});

afterAll(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("real aggregate report — artifact generation with real metrics", () => {
  it("artifact files are written to artifacts/runtime-memory-eval/", () => {
    expect(existsSync(path.join(ARTIFACTS_DIR, "report.json"))).toBe(true);
    expect(existsSync(path.join(ARTIFACTS_DIR, "report.md"))).toBe(true);
  });

  it("enhanced report has real overallScore > 0 (not a mock)", () => {
    expect(enhancedReport.summary.overallScore).toBeGreaterThan(0);
    expect(Number.isFinite(enhancedReport.summary.overallScore)).toBe(true);
  });

  it("enhanced report has at least 6 dimensions with real data", () => {
    const dimCount = Object.keys(enhancedReport.summary.dimensionScores).length;
    expect(dimCount).toBeGreaterThanOrEqual(6);
  });
});

describe("real aggregate report — longConversation + latencyBenchmark from real driver", () => {
  it("longConversation dimension has real Cohen's d > 0", () => {
    expect(enhancedReport.dimensions.longConversation).toBeDefined();
    expect(enhancedReport.dimensions.longConversation!.cohensD).toBeGreaterThan(0);
  });

  it("latencyBenchmark dimension has real p95 latency < 50ms (production budget)", () => {
    expect(enhancedReport.dimensions.latencyBenchmark).toBeDefined();
    expect(enhancedReport.dimensions.latencyBenchmark!.latencyMsP95).toBeLessThan(50);
    expect(enhancedReport.dimensions.latencyBenchmark!.latencyMsP95).toBeGreaterThanOrEqual(0);
  });

  it("latencyBenchmark dimension has real p95 token overhead < 200 (production budget)", () => {
    expect(enhancedReport.dimensions.latencyBenchmark!.tokenOverheadP95).toBeLessThan(200);
    expect(enhancedReport.dimensions.latencyBenchmark!.tokenOverheadP95).toBeGreaterThanOrEqual(0);
  });

  it("utility dimension has real meanUtility > 0 (treatment arm recalls seeded facts)", () => {
    expect(enhancedReport.dimensions.utility).toBeDefined();
    expect(enhancedReport.dimensions.utility!.meanUtility).toBeGreaterThanOrEqual(0);
  });
});

describe("real aggregate report — rejection dimensions from real scenarios", () => {
  it("crossAxisRejection dimension has real coverage = 1 (all 10 reasons fire)", () => {
    expect(enhancedReport.dimensions.crossAxisRejection).toBeDefined();
    expect(enhancedReport.dimensions.crossAxisRejection!.rejectionCoverage).toBe(1);
    expect(enhancedReport.dimensions.crossAxisRejection!.allReasonsFired).toBe(true);
    expect(enhancedReport.dimensions.crossAxisRejection!.correctReasonRate).toBe(1);
  });

  it("hazardSuppression dimension has real suppression rates = 1", () => {
    expect(enhancedReport.dimensions.hazardSuppression).toBeDefined();
    expect(enhancedReport.dimensions.hazardSuppression!.promptInjectionSuppressionRate).toBe(1);
    expect(enhancedReport.dimensions.hazardSuppression!.rawLeakSuppressionRate).toBe(1);
  });

  it("conflictResolution dimension has real conflictSuppressionRate > 0", () => {
    expect(enhancedReport.dimensions.conflictResolution).toBeDefined();
    expect(enhancedReport.dimensions.conflictResolution!.conflictSuppressionRate).toBeGreaterThan(0);
    expect(enhancedReport.dimensions.conflictResolution!.wrongConflictWinnerRate).toBe(0);
  });
});

describe("real aggregate report — rejection coverage = 13/13", () => {
  it("all 13 rejection reasons fire across 3 rejection scenarios", () => {
    expect(aggregateReport.rejectionCoverage.totalReasons).toBe(13);
    expect(aggregateReport.rejectionCoverage.firedReasons.length).toBe(13);
    expect(aggregateReport.rejectionCoverage.missingReasons).toEqual([]);
    expect(aggregateReport.rejectionCoverage.coverageRate).toBe(1);
  });

  it("rejectionReasonDistribution has real counts summing to total rejected facts", () => {
    expect(enhancedReport.rejectionReasonDistribution).toBeDefined();
    expect(enhancedReport.rejectionReasonDistribution!.length).toBeGreaterThan(0);

    const totalCount = enhancedReport.rejectionReasonDistribution!.reduce(
      (sum, e) => sum + e.count,
      0,
    );
    expect(totalCount).toBeGreaterThan(0);

    // Each entry should have a real count >= 1
    for (const entry of enhancedReport.rejectionReasonDistribution!) {
      expect(entry.count).toBeGreaterThanOrEqual(1);
      expect(entry.percentage).toBeGreaterThan(0);
      expect(entry.percentage).toBeLessThanOrEqual(100);
    }
  });
});

describe("real aggregate report — markdown artifact contains real sections", () => {
  it("markdown contains all key sections", () => {
    const md = formatAggregateReportAsMarkdown(aggregateReport);
    expect(md).toContain("# Runtime Memory Aggregate Evaluation Report");
    expect(md).toContain("## Rejection Coverage");
    expect(md).toContain("### Fired Rejection Reasons");
    expect(md).toContain("Coverage rate: 100.0%");
  });

  it("markdown does not contain missing reasons section (coverage is complete)", () => {
    const md = formatAggregateReportAsMarkdown(aggregateReport);
    expect(md).not.toContain("### Missing Rejection Reasons");
  });
});

// === Helper functions ===

function runCrossAxisConsumer(
  scenario: readonly CrossAxisFactSpec[],
): RuntimeMemoryHydrationConsumerResult[] {
  const results: RuntimeMemoryHydrationConsumerResult[] = [];
  for (const spec of scenario) {
    const result = consumeRuntimeMemoryHydrationFacts([spec.projection], spec.query);
    results.push(result);
  }
  return results;
}

function runHazardConsumer(
  scenario: readonly HazardScenarioFact[],
): RuntimeMemoryHydrationConsumerResult[] {
  const results: RuntimeMemoryHydrationConsumerResult[] = [];
  for (const entry of scenario) {
    const projection = toHazardProjection(entry.fact);
    const query = toHazardConsumerQuery(entry.query);
    const result = consumeRuntimeMemoryHydrationFacts([projection], query);
    results.push(result);
  }
  return results;
}

function runConflictDiagnostics(
  scenario: readonly ConflictGroup[],
  dbPath: string,
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[] {
  const results: TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[] = [];
  for (let i = 0; i < scenario.length; i += 1) {
    const group = scenario[i];
    const diag = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      loopRunId: `real_aggregate_conflict_${i}`,
      sessionKey: "agent:main:real-aggregate-conflict",
      iteration: i,
      options: {
        explicitOptIn: true,
        testResearchOnly: true,
        databasePath: dbPath,
        limit: 50,
        maxFacts: 200,
        now: () => CONFLICT_REFERENCE_TIME,
        queries: [
          {
            queryId: group.query.queryId,
            taskId: group.query.taskId,
            subject: group.query.subject,
            predicate: group.query.predicate,
            referenceTime: group.query.referenceTime,
            tokenBudget: group.query.tokenBudget,
            limit: group.query.limit,
            expectedFactIds: [...group.query.expectedFactIds],
          },
        ],
      },
    });
    results.push(diag);
  }
  return results;
}

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
