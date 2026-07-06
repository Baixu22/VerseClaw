// @vitest-environment node
// Phase 37 enhanced evaluation — Dimension 7: Conflict Resolution.
// Verifies that the consumer's selectConflictWinners picks the correct winner
// when multiple facts share the same (taskId, subject, predicate).

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import {
  buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
  type TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
} from "../../openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow";
import {
  buildConflictScenario,
  evaluateConflictResolution,
  type ConflictGroup,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/conflict-resolution-eval";
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

const TASK_ID = "task_conflict_resolution";
const REFERENCE_TIME = 1_000;
const GROUP_COUNT = 6; // 2 groups per pattern (confidence, valid_at, factId)

describe("runtime memory conflict resolution evaluation", () => {
  it("buildConflictScenario generates groupCount groups × 3 facts each", () => {
    const scenario = buildConflictScenario({
      groupCount: GROUP_COUNT,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });

    expect(scenario).toHaveLength(GROUP_COUNT);
    for (const group of scenario) {
      expect(group.facts).toHaveLength(3);
      expect(group.expectedWinnerFactId).toBeTruthy();
      expect(group.query.expectedFactIds).toEqual([group.expectedWinnerFactId]);
    }
  });

  it("each group accepts exactly 1 fact (conflict resolution)", () => {
    const scenario = buildConflictScenario({
      groupCount: GROUP_COUNT,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });
    const dbPath = createTempDbPath("conflict-single-", tempDirs);
    initializeEmptyDb(dbPath);
    for (const group of scenario) {
      for (const fact of group.facts) {
        appendFactToDb(dbPath, fact);
      }
    }
    closeRuntimeMemoryHydrationShadowDatabasesForTest();

    const diagnostics = runConflictDiagnostics(scenario, dbPath);
    const result = evaluateConflictResolution(scenario, diagnostics);

    for (const group of result.perGroup) {
      expect(group.acceptedFactId).not.toBeNull();
    }
  });

  it("highest confidence wins (pattern 0 groups)", () => {
    const scenario = buildConflictScenario({
      groupCount: 3,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });
    const dbPath = createTempDbPath("conflict-confidence-", tempDirs);
    initializeEmptyDb(dbPath);
    for (const group of scenario) {
      for (const fact of group.facts) {
        appendFactToDb(dbPath, fact);
      }
    }
    closeRuntimeMemoryHydrationShadowDatabasesForTest();

    const diagnostics = runConflictDiagnostics(scenario, dbPath);
    const result = evaluateConflictResolution(scenario, diagnostics);

    // Group 0 is pattern 0 (different confidence)
    const group0 = result.perGroup[0];
    expect(group0.expectedWinnerFactId).toBe("conflict_group_0_fact_1");
    expect(group0.correct).toBe(true);
  });

  it("latest valid_at wins when confidence is tied (pattern 1 groups)", () => {
    const scenario = buildConflictScenario({
      groupCount: 3,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });
    const dbPath = createTempDbPath("conflict-validat-", tempDirs);
    initializeEmptyDb(dbPath);
    for (const group of scenario) {
      for (const fact of group.facts) {
        appendFactToDb(dbPath, fact);
      }
    }
    closeRuntimeMemoryHydrationShadowDatabasesForTest();

    const diagnostics = runConflictDiagnostics(scenario, dbPath);
    const result = evaluateConflictResolution(scenario, diagnostics);

    // Group 1 is pattern 1 (same confidence, different valid_at)
    const group1 = result.perGroup[1];
    expect(group1.expectedWinnerFactId).toBe("conflict_group_1_fact_1");
    expect(group1.correct).toBe(true);
  });

  it("wrongConflictWinnerRate = 0 when all winners are correct", () => {
    const scenario = buildConflictScenario({
      groupCount: GROUP_COUNT,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });
    const dbPath = createTempDbPath("conflict-correct-", tempDirs);
    initializeEmptyDb(dbPath);
    for (const group of scenario) {
      for (const fact of group.facts) {
        appendFactToDb(dbPath, fact);
      }
    }
    closeRuntimeMemoryHydrationShadowDatabasesForTest();

    const diagnostics = runConflictDiagnostics(scenario, dbPath);
    const result = evaluateConflictResolution(scenario, diagnostics);

    expect(result.wrongConflictWinnerRate).toBe(0);
    for (const group of result.perGroup) {
      expect(group.correct).toBe(true);
    }
  });

  it("conflictSuppressionRate = 1 (all non-winners rejected)", () => {
    const scenario = buildConflictScenario({
      groupCount: GROUP_COUNT,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });
    const dbPath = createTempDbPath("conflict-suppression-", tempDirs);
    initializeEmptyDb(dbPath);
    for (const group of scenario) {
      for (const fact of group.facts) {
        appendFactToDb(dbPath, fact);
      }
    }
    closeRuntimeMemoryHydrationShadowDatabasesForTest();

    const diagnostics = runConflictDiagnostics(scenario, dbPath);
    const result = evaluateConflictResolution(scenario, diagnostics);

    // 3 facts per group, 1 accepted → 2 rejected per group
    // suppressionRate = rejected / total = (2*6) / (3*6) = 12/18 = 0.6667
    expect(result.conflictSuppressionRate).toBeCloseTo(2 / 3, 4);
    expect(result.totalConflicts).toBe(GROUP_COUNT * 3);
  });
});

function initializeEmptyDb(dbPath: string): void {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: CONFIG,
    database: { path: dbPath },
    now: () => REFERENCE_TIME,
  });
  if (persistence.migrate().status !== "migrated") {
    throw new Error(`initializeEmptyDb: migration failed for ${dbPath}`);
  }
}

function runConflictDiagnostics(
  scenario: readonly ConflictGroup[],
  dbPath: string,
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[] {
  const results: TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[] = [];
  for (let i = 0; i < scenario.length; i += 1) {
    const group = scenario[i];
    const diag = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config: CONFIG,
      loopRunId: `conflict_resolution_${i}`,
      sessionKey: "agent:main:conflict-resolution",
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
