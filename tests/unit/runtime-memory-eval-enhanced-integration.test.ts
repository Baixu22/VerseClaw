// @vitest-environment node
// Phase 37: enhanced evaluation integration.
//
// ORIGINAL INTENT: drive a real 10-turn multi-turn run, fold its dimensions into
// an enhanced report, and assert the report's longConversation / latencyBenchmark
// fields are populated with real measurements.
//
// CURRENT CONTRACT (TF-0500 / TF-0574): runtime.memory persist/shadow/provider/
// proposeFacts are retired and never resolve to true, so the persistence-backed
// multi-turn driver cannot produce a dataset. Satisfying the original assertions
// would require re-enabling the retired capability, which no test may do.

import { rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import {
  createTempDbPath,
  RUNTIME_MEMORY_EVAL_CONFIG,
  seedTempDb,
} from "./helpers/runtime-memory-eval-helpers";

const tempDirs: string[] = [];

afterAll(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("retired enhanced evaluation integration", () => {
  it("reports the persistence store as retired rather than migrated", () => {
    const dbPath = createTempDbPath("phase37-int-retired-", tempDirs);
    const persistence = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: dbPath },
    });
    expect(persistence.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
  });

  it("fails the fixture seeding step that the driver depends on", () => {
    const dbPath = createTempDbPath("phase37-int-seed-", tempDirs);
    expect(() => seedTempDb(dbPath, [])).toThrow(/seedTempDb: migration failed/);
  });
});
