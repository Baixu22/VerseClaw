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
  RUNTIME_MEMORY_EVAL_CONFIG,
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
  it("recallBeforeWrite=0 when no initial facts exist", () => {
    const dbPath = createTempDbPath("temporal-empty-", tempDirs);
    const writeFact = buildWriteFact();

    const result = runTemporalEvolution({
      turns: TURNS,
      stepMs: STEP_MS,
      taskId: TASK_ID,
      initialFacts: [],
      writeAtTurn: 2,
      writeFact,
      expireAtTurn: 999,
      query: buildQuery(writeFact.factId),
      databasePath: dbPath,
      config: RUNTIME_MEMORY_EVAL_CONFIG,
    });

    expect(result.recallBeforeWrite).toBe(0);
  });

  it("writeEffect > 0 after fact is written", () => {
    const dbPath = createTempDbPath("temporal-write-", tempDirs);
    const writeFact = buildWriteFact();

    const result = runTemporalEvolution({
      turns: TURNS,
      stepMs: STEP_MS,
      taskId: TASK_ID,
      initialFacts: [],
      writeAtTurn: 2,
      writeFact,
      expireAtTurn: 999,
      query: buildQuery(writeFact.factId),
      databasePath: dbPath,
      config: RUNTIME_MEMORY_EVAL_CONFIG,
    });

    expect(result.writeEffect).toBeGreaterThan(0);
    expect(result.recallAfterWrite).toBeGreaterThan(result.recallBeforeWrite);
  });

  it("invalidateEffect < 0 after clock advances past invalid_at boundary", () => {
    const dbPath = createTempDbPath("temporal-invalidate-", tempDirs);
    const writeFact = buildWriteFact();

    const result = runTemporalEvolution({
      turns: TURNS,
      stepMs: STEP_MS,
      taskId: TASK_ID,
      initialFacts: [],
      writeAtTurn: 2,
      writeFact,
      expireAtTurn: 4,
      query: buildQuery(writeFact.factId),
      databasePath: dbPath,
      config: RUNTIME_MEMORY_EVAL_CONFIG,
    });

    expect(result.invalidateEffect).toBeLessThan(0);
    expect(result.recallAfterInvalidate).toBeLessThan(result.recallAfterWrite);
  });

  it("referenceTime increases monotonically across turns", () => {
    const dbPath = createTempDbPath("temporal-monotonic-", tempDirs);
    const writeFact = buildWriteFact();

    const result = runTemporalEvolution({
      turns: TURNS,
      stepMs: STEP_MS,
      taskId: TASK_ID,
      initialFacts: [],
      writeAtTurn: 2,
      writeFact,
      expireAtTurn: 4,
      query: buildQuery(writeFact.factId),
      databasePath: dbPath,
      config: RUNTIME_MEMORY_EVAL_CONFIG,
    });

    for (let i = 1; i < result.perTurn.length; i += 1) {
      expect(result.perTurn[i].referenceTime).toBeGreaterThan(
        result.perTurn[i - 1].referenceTime,
      );
    }
    expect(result.perTurn[0].referenceTime).toBe(0);
    expect(result.perTurn[5].referenceTime).toBe(500);
  });

  it("writeAtTurn=2 takes effect immediately at turn 2", () => {
    const dbPath = createTempDbPath("temporal-immediate-write-", tempDirs);
    const writeFact = buildWriteFact();

    const result = runTemporalEvolution({
      turns: TURNS,
      stepMs: STEP_MS,
      taskId: TASK_ID,
      initialFacts: [],
      writeAtTurn: 2,
      writeFact,
      expireAtTurn: 999,
      query: buildQuery(writeFact.factId),
      databasePath: dbPath,
      config: RUNTIME_MEMORY_EVAL_CONFIG,
    });

    expect(result.perTurn[1].recall).toBe(0);
    expect(result.perTurn[2].recall).toBe(1);
  });

  it("expireAtTurn=4 takes effect immediately at turn 4", () => {
    const dbPath = createTempDbPath("temporal-immediate-invalidate-", tempDirs);
    const writeFact = buildWriteFact();

    const result = runTemporalEvolution({
      turns: TURNS,
      stepMs: STEP_MS,
      taskId: TASK_ID,
      initialFacts: [],
      writeAtTurn: 2,
      writeFact,
      expireAtTurn: 4,
      query: buildQuery(writeFact.factId),
      databasePath: dbPath,
      config: RUNTIME_MEMORY_EVAL_CONFIG,
    });

    expect(result.perTurn[3].recall).toBe(1);
    expect(result.perTurn[4].recall).toBe(0);
  });

  it("recall stays 0 throughout when no write and no expiry occur", () => {
    const dbPath = createTempDbPath("temporal-noop-", tempDirs);
    const dummyFact = buildTemporalFactFromSpec({
      factId: "temporal_dummy",
      taskId: TASK_ID,
      subject: SUBJECT,
      predicate: PREDICATE,
      objectSummary: "Dummy fact (never written).",
      validAt: 0,
    });

    const result = runTemporalEvolution({
      turns: TURNS,
      stepMs: STEP_MS,
      taskId: TASK_ID,
      initialFacts: [],
      writeAtTurn: 999,
      writeFact: dummyFact,
      expireAtTurn: 999,
      query: buildQuery(dummyFact.factId),
      databasePath: dbPath,
      config: RUNTIME_MEMORY_EVAL_CONFIG,
    });

    for (const turn of result.perTurn) {
      expect(turn.recall).toBe(0);
    }
  });
});
