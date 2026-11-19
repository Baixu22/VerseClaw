// @vitest-environment node
// Phase 36 enhanced evaluation — Dimension 3: Temporal Evolution.
// Verifies that recall evolves correctly as facts are written and as the
// clock advances past the fact's invalid_at boundary.

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import { runTemporalEvolution } from "../../openclaw_runtime/src/agents/runtime-memory-eval/temporal-evolution-driver";
import {
  buildTemporalFactFromSpec,
  createTempDbPath,
  RUNTIME_MEMORY_EVAL_CONFIG as _RUNTIME_MEMORY_EVAL_CONFIG,
} from "./helpers/runtime-memory-eval-helpers";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const TASK_ID = "task_temporal_eval";
const SUBJECT = "TemporalSubject";
const PREDICATE = "temporalPredicate";
const STEP_MS = 100;
const TURNS = 6;

function buildWriteFact() {
  return buildTemporalFactFromSpec({
    factId: "temporal_write_fact",
    taskId: TASK_ID,
    subject: SUBJECT,
    predicate: PREDICATE,
    objectSummary: "Fact written at turn 2.",
    validAt: 0,
  });
}

function buildQuery(factId: string) {
  return {
    queryId: "te_query",
    taskId: TASK_ID,
    subject: SUBJECT,
    predicate: PREDICATE,
    referenceTime: 0,
    tokenBudget: 512,
    limit: 8,
    expectedFactIds: [factId],
  };
}

describe("runtime memory temporal evolution", () => {
  it("keeps the retired temporal-evolution run from seeding persistence", () => {
    const dbPath = createTempDbPath("temporal-retired-", tempDirs);
    const writeFact = buildWriteFact();

    // The driver seeds through createRuntimeMemoryPersistenceStore, which the
    // retired runtime.memory.persist flag can never enable.
    expect(() =>
      runTemporalEvolution({
        turns: TURNS,
        stepMs: STEP_MS,
        taskId: TASK_ID,
        initialFacts: [],
        writeAtTurn: 2,
        writeFact,
        expireAtTurn: TURNS + 1,
        query: buildQuery(writeFact.factId),
        databasePath: dbPath,
      }),
    ).toThrow(/migration failed/);
  });
});
