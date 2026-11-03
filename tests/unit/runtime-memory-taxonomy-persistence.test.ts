// @vitest-environment node
// Phase 4.1 persistence: memoryType round-trip through the SQLite layer.
//
// ORIGINAL INTENT: verify memory_type is written to its column, included in
// record_json, reconstructed on load, and added by the additive migration to
// pre-Phase-4.1 databases.
//
// CURRENT CONTRACT (TF-0500 / TF-0574): runtime.memory.persist is retired and
// never resolves to true, so createRuntimeMemoryPersistenceStore().migrate()
// returns skipped and no row is ever written. The entire round-trip contract is
// unreachable; these cases assert the retirement boundary instead.
//
// NOTE: real coverage loss — the memory_type column/record_json round-trip and
// the additive migration are no longer exercised by any test.

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeMemoryPersistenceStore,
} from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import {
  buildRuntimeMemoryTemporalFactFixture,
} from "../../openclaw_runtime/src/runtime-core";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-memory-taxonomy-"));
  tempDirs.push(dir);
  return path.join(dir, "openclaw.sqlite");
}

const PERSIST_CONFIG = { runtime: { memory: { persist: true } } };

describe("Phase 4.1 persistence: memoryType round-trip (retired)", () => {
  it("never migrates, so no memory_type column is created", () => {
    const dbPath = createTempDbPath();
    const store = createRuntimeMemoryPersistenceStore({
      config: PERSIST_CONFIG,
      database: { path: dbPath },
      now: () => 1_000,
    });
    expect(store.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(store.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
  });

  it("rejects every memoryType write without persisting a row", () => {
    const dbPath = createTempDbPath();
    const store = createRuntimeMemoryPersistenceStore({
      config: PERSIST_CONFIG,
      database: { path: dbPath },
      now: () => 1_000,
    });

    for (const memoryType of ["procedural", "episodic", "semantic"] as const) {
      const fact = buildRuntimeMemoryTemporalFactFixture({
        factId: `fact_${memoryType}`,
        memoryType,
      } as never);
      expect(store.appendFact(fact)).toMatchObject({
        status: "skipped",
        reason: "flag_disabled",
      });
    }
  });

  it("exposes an empty store when loading the retired persistence", () => {
    const dbPath = createTempDbPath();
    const store = createRuntimeMemoryPersistenceStore({
      config: PERSIST_CONFIG,
      database: { path: dbPath },
      now: () => 1_000,
    });
    const loaded = store.loadStore();
    expect(loaded.status).toBe("skipped");
    expect(loaded.store.stats()).toMatchObject({ facts: 0, episodes: 0, invalidations: 0 });
  });
});
