// Temporal evolution evaluation driver for runtime-memory.
// Moves the clock forward each turn, writes a fact mid-run with a temporal
// invalid_at boundary, and measures recall evolution. Fills the "all fixtures
// use fixed referenceTime=1000, no temporal variance" gap from Phase 35/36.
//
// Design note: the shadow diagnostics path reads runtime_memory_facts directly
// (no join with runtime_memory_invalidations). To test temporal invalidity via
// the consumer's `invalidated_at_reference_time` rejection path, the writeFact's
// `invalid_at` is set to `expireAtTurn * stepMs` before persistence. When the
// clock advances past that boundary, the consumer rejects the fact.

import {
  type RuntimeMemoryTemporalFact,
} from "../../runtime-core/memory-context.js";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../runtime-core/database-cleanup-for-tests.js";
import { createRuntimeMemoryPersistenceStore } from "../../runtime-core/memory-persistence.js";
import {
  buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
  type TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
} from "../../runtime-core/task-loop-memory-shadow-diagnostics.js";
import type { MultiTurnQueryPlan } from "./multi-turn-driver.js";
import { mean } from "./statistics.js";

export type TemporalEvolutionOptions = {
  turns: number;
  stepMs: number;
  taskId: string;
  initialFacts: readonly RuntimeMemoryTemporalFact[];
  writeAtTurn: number;
  writeFact: RuntimeMemoryTemporalFact;
  // Turn at which the written fact becomes invalid (invalid_at = expireAtTurn * stepMs).
  // Set to a value >= turns to disable expiry.
  expireAtTurn: number;
  query: MultiTurnQueryPlan;
  databasePath: string;
  config?: unknown;
};

export type TemporalEvolutionResult = {
  perTurn: ReadonlyArray<{ turn: number; referenceTime: number; recall: number }>;
  recallBeforeWrite: number;
  recallAfterWrite: number;
  recallAfterInvalidate: number;
  writeEffect: number;
  invalidateEffect: number;
};

export function runTemporalEvolution(
  options: TemporalEvolutionOptions,
): TemporalEvolutionResult {
  if (options.turns < 1) {
    throw new Error(`runTemporalEvolution: turns must be >= 1 (got ${options.turns})`);
  }

  const config = options.config ?? { runtime: { memory: { persist: true } } };

  // Seed initial facts.
  const seedPersistence = createRuntimeMemoryPersistenceStore({
    config,
    database: { path: options.databasePath },
    now: () => 0,
  });
  if (seedPersistence.migrate().status !== "migrated") {
    throw new Error(`runTemporalEvolution: migration failed for ${options.databasePath}`);
  }
  for (const fact of options.initialFacts) {
    const result = seedPersistence.appendFact(fact);
    if (result.status !== "persisted") {
      throw new Error(`runTemporalEvolution: appendFact failed for ${fact.factId}`);
    }
  }

  // Prepare the writeFact with invalid_at set to the expiry boundary.
  const expiryTime = options.expireAtTurn * options.stepMs;
  const writeFactWithExpiry: RuntimeMemoryTemporalFact = {
    ...options.writeFact,
    ...(expiryTime < options.turns * options.stepMs ? { invalid_at: expiryTime } : {}),
  };

  const perTurn: Array<{ turn: number; referenceTime: number; recall: number }> = [];

  for (let turn = 0; turn < options.turns; turn += 1) {
    const referenceTime = turn * options.stepMs;

    // Write fact at the specified turn.
    if (turn === options.writeAtTurn) {
      const writePersistence = createRuntimeMemoryPersistenceStore({
        config,
        database: { path: options.databasePath },
        now: () => referenceTime,
      });
      const writeResult = writePersistence.appendFact(writeFactWithExpiry);
      if (writeResult.status !== "persisted") {
        throw new Error(`runTemporalEvolution: writeFact failed for ${options.writeFact.factId}`);
      }
      closeRuntimeMemoryHydrationShadowDatabasesForTest();
    }

    const diag = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config,
      loopRunId: `temporal_evolution_turn_${turn}`,
      sessionKey: "agent:main:temporal-evolution",
      iteration: turn,
      options: {
        explicitOptIn: true,
        testResearchOnly: true,
        databasePath: options.databasePath,
        limit: 50,
        maxFacts: 200,
        now: () => referenceTime,
        queries: [
          {
            queryId: `te_query_${turn}`,
            taskId: options.query.taskId,
            subject: options.query.subject,
            predicate: options.query.predicate,
            referenceTime,
            tokenBudget: options.query.tokenBudget,
            limit: options.query.limit,
            expectedFactIds: [...options.query.expectedFactIds],
          },
        ],
      },
    });

    perTurn.push({
      turn,
      referenceTime,
      recall: extractRecall(diag),
    });
  }

  const beforeWrite = perTurn.filter((t) => t.turn < options.writeAtTurn).map((t) => t.recall);
  const afterWrite = perTurn
    .filter((t) => t.turn >= options.writeAtTurn && t.turn < options.expireAtTurn)
    .map((t) => t.recall);
  const afterInvalidate = perTurn
    .filter((t) => t.turn >= options.expireAtTurn)
    .map((t) => t.recall);

  const recallBeforeWrite = beforeWrite.length > 0 ? mean(beforeWrite) : 0;
  const recallAfterWrite = afterWrite.length > 0 ? mean(afterWrite) : 0;
  const recallAfterInvalidate = afterInvalidate.length > 0 ? mean(afterInvalidate) : 0;

  return {
    perTurn,
    recallBeforeWrite,
    recallAfterWrite,
    recallAfterInvalidate,
    writeEffect: recallAfterWrite - recallBeforeWrite,
    invalidateEffect: recallAfterInvalidate - recallAfterWrite,
  };
}

function extractRecall(
  diag: TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
): number {
  if (diag.queries.length === 0) return 0;
  const queryResult = diag.queries[0];
  const expected = queryResult.expectedFactIds.length;
  if (expected === 0) return 1;
  return queryResult.truePositiveCount / expected;
}
