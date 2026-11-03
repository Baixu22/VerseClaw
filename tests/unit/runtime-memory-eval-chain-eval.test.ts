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

  it("keeps the retired chain evaluation from producing diagnostics data", () => {
    const scenario = buildChainScenario({
      turns: TURNS,
      taskId: TASK_ID,
      baseSubject: SUBJECT,
      referenceTime: REFERENCE_TIME,
    });

    // TF-0500 retired runtime.memory.persist; the DB-backed read-hydration shadow
    // diagnostics this eval drives depend on that flag, so seeding a fact fails.
    const dbPath = createTempDbPath("chain-retired-", tempDirs);
    expect(tryInitializeDb(dbPath)).toBe("flag_disabled");
    expect(() => runChainDiagnostics(scenario, dbPath, new Set([0]))).toThrow(
      /appendFact failed .*status=skipped/,
    );
  });

  it("still evaluates a fully supplied chain scenario without persistence", () => {
    const scenario = buildChainScenario({
      turns: TURNS,
      taskId: TASK_ID,
      baseSubject: SUBJECT,
      referenceTime: REFERENCE_TIME,
    });
    // evaluateChain is a pure aggregation; it requires one diagnostic per turn.
    // With nothing ever recalled, recall stays 0 and depth stays -1.
    const diagnostics = scenario.map((plan) => ({
      turn: plan.turn,
      queries: plan.queries.map((query) => ({
        query,
        acceptedFacts: [],
        rejectedFacts: [],
        truePositiveCount: 0,
        falsePositiveCount: 0,
      })),
    })) as unknown as TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[];

    const result = evaluateChain(scenario, diagnostics);
    expect(result.aggregateChainRecall).toBe(0);
    expect(result.maxDepth).toBe(-1);
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
