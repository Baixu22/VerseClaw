// @vitest-environment node
// Layer 1: Write-path real filtering behavior.
// Answers "what gets saved" by probing the 4-layer defense with independent
// inputs (useful / syntactic noise / semantic noise). Anti-overfitting: ground
// truth comes from input classification, NOT consumer design goals. Key real
// finding: the system does NOT reject semantic noise (well-formed but irrelevant
// facts), exposing the root cause of noise accumulation.

import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import {
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryInvalidationProposalFixture,
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { RUNTIME_MEMORY_EVAL_CONFIG } from "./helpers/runtime-memory-eval-helpers";

const tempDirs: string[] = [];
const NOW = () => 1_000;

function makeDbPath(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return path.join(dir, "openclaw.sqlite");
}

import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function makePersistence(dbPath: string, maxFacts?: number) {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: RUNTIME_MEMORY_EVAL_CONFIG,
    database: { path: dbPath },
    now: NOW,
    ...(maxFacts !== undefined ? { maxFacts } : {}),
  });
  const migration = persistence.migrate();
  if (migration.status !== "migrated") {
    throw new Error(`migration failed: ${JSON.stringify(migration)}`);
  }
  return persistence;
}

// Build a fact with raw content in objectSummary, bypassing fixture sanitize.
// The persistence layer's sanitizeFactForPersistence will catch this.
function makeRawContentFact(params: {
  factId: string;
  objectSummary: string;
  taskId?: string;
  subject?: string;
  predicate?: string;
}): RuntimeMemoryTemporalFact {
  const valid = buildRuntimeMemoryTemporalFactFixture({
    factId: params.factId,
    taskId: params.taskId ?? "task_raw",
    subject: params.subject ?? "RawTest",
    predicate: params.predicate ?? "raw_content",
    objectSummary: "safe placeholder",
    valid_at: 100,
    reference_time: 100,
  });
  // Override objectSummary with raw content AFTER sanitize, bypassing fixture guard.
  // Persistence layer will re-sanitize and reject.
  return { ...valid, objectSummary: params.objectSummary } as RuntimeMemoryTemporalFact;
}

afterAll(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Layer 1: write-path real filtering — useful facts persist through 4 layers", () => {
  it("cannot exercise the write-path filtering layers while persistence is retired", () => {
    const dbPath = makeDbPath("write-path-semantic-retired-");

    // TF-0500 retired runtime.memory.persist, so makePersistence() throws before any
    // fact reaches the 4-layer write filter. The 12 cases that probed useful-fact
    // acceptance, syntactic-noise rejection, truncation, dedupe, invalidation and
    // FIFO eviction are therefore unreachable.
    //
    // NOTE: this is a real coverage loss. The sanitize/persist internals are not
    // exported, so those behaviours cannot be tested without re-enabling persist.
    expect(() => makePersistence(dbPath)).toThrow(/migration failed/);

    const persistence = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: dbPath },
      now: NOW,
    });
    expect(persistence.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactFixture({ factId: "retired_fact" }))).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
    });
  });

  it("keeps retired writes from creating a database file", () => {
    const dbPath = makeDbPath("write-path-semantic-no-file-");
    const persistence = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: dbPath },
      now: NOW,
    });
    expect(persistence.migrate()).toMatchObject({ status: "skipped" });
    expect(existsSync(dbPath)).toBe(false);
  });
});
