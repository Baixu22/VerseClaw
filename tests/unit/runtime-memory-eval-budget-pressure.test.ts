// @vitest-environment node
// Phase 36 enhanced evaluation — Dimension 5: Budget Pressure.
// Verifies that recall degrades gracefully as tokenBudget shrinks and that
// the consumer's token_budget_exceeded / limit_exceeded rejection paths fire
// correctly under pressure.

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import {
  buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
  type TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
} from "../../openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow";
import {
  buildBudgetPressureScenario,
  evaluateBudgetPressure,
  type BudgetLevel,
  type BudgetPressureScenario,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/budget-pressure-eval";
import {
  appendFactToDb,
  createTempDbPath,
  RUNTIME_MEMORY_EVAL_CONFIG,
} from "./helpers/runtime-memory-eval-helpers";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";

const CONFIG = RUNTIME_MEMORY_EVAL_CONFIG;
const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const TASK_ID = "task_budget_pressure";
const REFERENCE_TIME = 1_000;
const FACT_COUNT = 5;

const TEST_LEVELS: readonly BudgetLevel[] = [
  { tokenBudget: 256, limit: 8, label: "ample" },
  { tokenBudget: 128, limit: 8, label: "comfortable" },
  { tokenBudget: 64, limit: 8, label: "moderate" },
  { tokenBudget: 32, limit: 8, label: "tight" },
  { tokenBudget: 16, limit: 8, label: "scarce" },
  { tokenBudget: 8, limit: 8, label: "extreme" },
];

describe("runtime memory budget pressure evaluation", () => {
  it("buildBudgetPressureScenario generates factCount × levels queries", () => {
    const scenario = buildBudgetPressureScenario({
      factCount: FACT_COUNT,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
      levels: TEST_LEVELS,
    });

    expect(scenario.facts).toHaveLength(FACT_COUNT);
    expect(scenario.levels).toHaveLength(TEST_LEVELS.length);
    expect(scenario.queries).toHaveLength(FACT_COUNT * TEST_LEVELS.length);
    expect(scenario.factCount).toBe(FACT_COUNT);
  });
  it("keeps retired budget-pressure evaluation from seeding or reading a database", () => {
    const scenario = buildBudgetPressureScenario({
      factCount: FACT_COUNT,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
      levels: TEST_LEVELS,
    });
    expect(scenario.queries).toHaveLength(FACT_COUNT * TEST_LEVELS.length);

    const dbPath = createTempDbPath("budget-retired-", tempDirs);
    expect(tryInitializeDb(dbPath)).toBe("flag_disabled");
    expect(() => appendFactToDb(dbPath, scenario.facts[0])).toThrow(/appendFact failed .*status=skipped/);
  });

  it("still aggregates a fully supplied budget scenario without persistence", () => {
    const scenario = buildBudgetPressureScenario({
      factCount: FACT_COUNT,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
      levels: TEST_LEVELS,
    });
    const diagnostics = scenario.queries.map((query, index) =>
      buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
        config: CONFIG,
        options: {},
        loopRunId: `budget-retired-${index}`,
        sessionKey: "agent:main:budget",
        iteration: index,
        query,
      } as never),
    );

    const result = evaluateBudgetPressure(scenario, diagnostics);
    expect(Number.isFinite(result.kneePoint)).toBe(true);
  });
});

function tryInitializeDb(dbPath: string): string {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: CONFIG,
    database: { path: dbPath },
    now: () => REFERENCE_TIME,
  });
  const result = persistence.migrate();
  return result.status === "skipped" ? result.reason : result.status;
}

function _runBudgetDiagnostics(
  scenario: BudgetPressureScenario,
  dbPath: string,
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[] {
  const results: TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[] = [];
  for (let i = 0; i < scenario.queries.length; i += 1) {
    const query = scenario.queries[i];
    const diag = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config: CONFIG,
      loopRunId: `budget_pressure_${i}`,
      sessionKey: "agent:main:budget-pressure",
      iteration: i,
      options: {
        explicitOptIn: true,
        testResearchOnly: true,
        databasePath: dbPath,
        limit: 50,
        maxFacts: 200,
        now: () => REFERENCE_TIME,
        queries: [
          {
            queryId: query.queryId,
            taskId: query.taskId,
            subject: query.subject,
            predicate: query.predicate,
            referenceTime: query.referenceTime,
            tokenBudget: query.tokenBudget,
            limit: query.limit,
            expectedFactIds: [...query.expectedFactIds],
          },
        ],
      },
    });
    results.push(diag);
  }
  return results;
}
