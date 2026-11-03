// @vitest-environment node
// Phase 36: long-conversation read-hydration evaluation.
//
// ORIGINAL INTENT: run 30 turns x 4 queries under a scripted LLM, compare
// treatment vs baseline recall@k, compute a bootstrap CI, and assert a
// significant conclusion.
//
// CURRENT CONTRACT (TF-0500 / TF-0574): runtime.memory persist/shadow/provider/
// proposeFacts are retired and never resolve to true, so the persistence-backed
// driver cannot produce a dataset. A "significant conclusion" would require
// re-enabling the retired capability, which no test may do.

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

describe("retired long-conversation read-hydration evaluation", () => {
  it("cannot build the baseline or treatment datasets", () => {
    const baseline = createTempDbPath("phase36-lc-retired-baseline-", tempDirs);
    const treatment = createTempDbPath("phase36-lc-retired-treatment-", tempDirs);

    const store = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: baseline },
    });
    expect(store.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(() => seedTempDb(treatment, [])).toThrow(/seedTempDb: migration failed/);
  });
});
