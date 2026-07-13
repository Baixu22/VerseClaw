// @vitest-environment node
// Phase 36 enhanced evaluation — Dimension 1: Conversation Chain.
// Verifies that memory hydration accumulates value across linked turns:
// turn N's query depends on facts written in turns 0..N.

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import {
  buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
  type TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
} from "../../openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow";
import {
  buildChainScenario,
  evaluateChain,
  type ChainTurnPlan,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/chain-eval";
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

const TASK_ID = "task_chain_eval";
const SUBJECT = "ChainSubject";
const REFERENCE_TIME = 1_000;
const TURNS = 4;

describe("runtime memory chain evaluation", () => {
  it("builds a 4-turn chain scenario with cumulative expected fact IDs", () => {
    const scenario = buildChainScenario({
      turns: TURNS,
      taskId: TASK_ID,
      baseSubject: SUBJECT,
      referenceTime: REFERENCE_TIME,
    });

    expect(scenario).toHaveLength(TURNS);
    expect(scenario[0].expectedCumulativeFactIds).toEqual([`${SUBJECT}_chain_0`]);
    expect(scenario[1].expectedCumulativeFactIds).toEqual([
      `${SUBJECT}_chain_0`,
      `${SUBJECT}_chain_1`,
    ]);
    expect(scenario[3].expectedCumulativeFactIds).toHaveLength(4);
    expect(scenario[3].writeFact.factId).toBe(`${SUBJECT}_chain_3`);
    expect(scenario[3].queries).toHaveLength(4);
    expect(scenario[0].queries).toHaveLength(1);
  });

  it("baseline (empty DB) yields aggregateChainRecall=0", () => {
    const scenario = buildChainScenario({
      turns: TURNS,
      taskId: TASK_ID,
      baseSubject: SUBJECT,
      referenceTime: REFERENCE_TIME,
    });
    const dbPath = createTempDbPath("chain-baseline-", tempDirs);
    initializeEmptyDb(dbPath);

    const diagnostics = runChainDiagnostics(scenario, dbPath, new Set());
    const result = evaluateChain(scenario, diagnostics);

    expect(result.aggregateChainRecall).toBe(0);
    expect(result.maxDepth).toBe(-1);
    for (const turn of result.perTurn) {
      expect(turn.recall).toBe(0);
      expect(turn.depth).toBe(-1);
    }
  });

  it("treatment (all facts seeded) yields aggregateChainRecall=1 and maxDepth=3", () => {
    const scenario = buildChainScenario({
      turns: TURNS,
      taskId: TASK_ID,
      baseSubject: SUBJECT,
      referenceTime: REFERENCE_TIME,
    });
    const dbPath = createTempDbPath("chain-treatment-", tempDirs);
    initializeEmptyDb(dbPath);

    const writeAll = new Set([0, 1, 2, 3]);
    const diagnostics = runChainDiagnostics(scenario, dbPath, writeAll);
    const result = evaluateChain(scenario, diagnostics);

    expect(result.aggregateChainRecall).toBe(1);
    expect(result.maxDepth).toBe(3);
    for (const turn of result.perTurn) {
      expect(turn.recall).toBe(1);
      expect(turn.depth).toBe(turn.turn);
    }
  });

  it("partial missing (only even turns seeded) yields aggregateChainRecall≈0.5", () => {
    const scenario = buildChainScenario({
      turns: TURNS,
      taskId: TASK_ID,
      baseSubject: SUBJECT,
      referenceTime: REFERENCE_TIME,
    });
    const dbPath = createTempDbPath("chain-partial-", tempDirs);
    initializeEmptyDb(dbPath);

    const writeEven = new Set([0, 2]);
    const diagnostics = runChainDiagnostics(scenario, dbPath, writeEven);
    const result = evaluateChain(scenario, diagnostics);

    // Turns 0 and 1 expect [f0] and [f0,f1]; f0 is present.
    // Turn 0: recall = 1/1 = 1
    // Turn 1: recall = 1/2 = 0.5
    // Turns 2 and 3 expect [f0,f1,f2] and [f0,f1,f2,f3]; f0 and f2 present.
    // Turn 2: recall = 2/3
    // Turn 3: recall = 2/4 = 0.5
    expect(result.perTurn[0].recall).toBe(1);
    expect(result.perTurn[1].recall).toBeCloseTo(0.5, 5);
    expect(result.perTurn[2].recall).toBeCloseTo(2 / 3, 5);
    expect(result.perTurn[3].recall).toBe(0.5);
    expect(result.aggregateChainRecall).toBeGreaterThan(0.4);
    expect(result.aggregateChainRecall).toBeLessThan(0.7);
  });

  it("chainDepth is monotonically non-decreasing when all facts are seeded", () => {
    const scenario = buildChainScenario({
      turns: TURNS,
      taskId: TASK_ID,
      baseSubject: SUBJECT,
      referenceTime: REFERENCE_TIME,
    });
    const dbPath = createTempDbPath("chain-monotonic-", tempDirs);
    initializeEmptyDb(dbPath);

    const diagnostics = runChainDiagnostics(scenario, dbPath, new Set([0, 1, 2, 3]));
    const result = evaluateChain(scenario, diagnostics);

    for (let i = 1; i < result.perTurn.length; i += 1) {
      expect(result.perTurn[i].depth).toBeGreaterThanOrEqual(result.perTurn[i - 1].depth);
    }
  });

  it("growthRate stays within [0, 1] for all turns", () => {
    const scenario = buildChainScenario({
      turns: TURNS,
      taskId: TASK_ID,
      baseSubject: SUBJECT,
      referenceTime: REFERENCE_TIME,
    });
    const dbPath = createTempDbPath("chain-growth-", tempDirs);
    initializeEmptyDb(dbPath);

    const diagnostics = runChainDiagnostics(scenario, dbPath, new Set([0, 2]));
    const result = evaluateChain(scenario, diagnostics);

    for (const turn of result.perTurn) {
      expect(turn.growthRate).toBeGreaterThanOrEqual(0);
      expect(turn.growthRate).toBeLessThanOrEqual(1);
    }
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

function runChainDiagnostics(
  scenario: readonly ChainTurnPlan[],
  dbPath: string,
  writeTurns: Set<number>,
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[] {
  const results: TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[] = [];
  for (const plan of scenario) {
    if (writeTurns.has(plan.turn)) {
      appendFactToDb(dbPath, plan.writeFact);
      // Clear the readonly DB cache so the next read sees the newly written fact.
      closeRuntimeMemoryHydrationShadowDatabasesForTest();
    }
    const diag = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config: CONFIG,
      loopRunId: `chain_eval_turn_${plan.turn}`,
      sessionKey: "agent:main:chain-eval",
      iteration: plan.turn,
      options: {
        explicitOptIn: true,
        testResearchOnly: true,
        databasePath: dbPath,
        limit: 50,
        maxFacts: 200,
        now: () => REFERENCE_TIME,
        queries: plan.queries.map((q) => ({
          queryId: q.queryId,
          taskId: q.taskId,
          subject: q.subject,
          predicate: q.predicate,
          referenceTime: q.referenceTime,
          tokenBudget: q.tokenBudget,
          limit: q.limit,
          expectedFactIds: [...q.expectedFactIds],
        })),
      },
    });
    results.push(diag);
  }
  return results;
}
