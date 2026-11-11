import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  closeRuntimeMemoryHydrationShadowDatabasesForTest,
  readRuntimeMemoryHydrationShadow,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];

afterEach(() => {
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("runtime memory read hydration controlled real DB opt-in evaluation", () => {
  it("cannot build the sanitized real-DB projections this evaluation compares", () => {
    // TF-0500 retired runtime.memory.persist; createControlledRuntimeMemoryDatabase
    // writes episodes and facts through the retired store, so the Phase 28
    // baseline/naive/guarded comparison cannot be constructed.
    const dbPath = createTempDbPath();
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
    });
    expect(persistence.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
  });

  it("keeps the retired real-DB read path inert for explicit zero budget and zero limit", () => {
    const dbPath = createTempDbPath();

    // Even with every evaluation gate requested, the persist gate returns first,
    // so no projection, budget or limit accounting is produced.
    const hydration = readRuntimeMemoryHydrationShadow({
      config: { runtime: { memory: { persist: true } } },
      databasePath: dbPath,
      readShadow: true,
      maxFacts: 0,
      limit: 0,
    });
    expect(hydration.status).toBe("skipped");
    expect(hydration.status).toBe("skipped");
    if (hydration.status !== "skipped") throw new Error("expected skipped");
    expect(hydration.reason).toBe("flag_disabled");
    expect(hydration.facts).toHaveLength(0);
    expect(hydration.episodes).toHaveLength(0);
  });
});

function createTempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-memory-phase-29-"));
  tempDirs.push(dir);
  return path.join(dir, "openclaw.sqlite");
}
