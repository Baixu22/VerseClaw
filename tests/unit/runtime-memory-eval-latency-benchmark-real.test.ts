// @vitest-environment node
// Phase 39: real latency benchmark.
//
// ORIGINAL INTENT: run a real 30-turn multi-turn driver and assert p50/p95
// latency and token overhead against production and strict budgets.
//
// CURRENT CONTRACT (TF-0500 / TF-0574): runtime.memory persist/shadow/provider/
// proposeFacts are retired and never resolve to true, so the driver cannot
// produce a dataset. Asserting budgets would require re-enabling the retired
// capability, which no test may do.

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

describe("retired runtime-memory latency benchmark", () => {
  it("cannot seed the dataset the benchmark measures", () => {
    const dbPath = createTempDbPath("phase39-real-retired-", tempDirs);
    const persistence = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: dbPath },
    });
    expect(persistence.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(() => seedTempDb(dbPath, [])).toThrow(/seedTempDb: migration failed/);
  });
});
