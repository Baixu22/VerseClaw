// @vitest-environment node
// Phase 39 Task #87: real aggregate report artifact generator.
//
// ORIGINAL INTENT: run every real eval scenario (multi-turn driver, cross-axis,
// hazard, conflict) and write a real aggregate report to
// artifacts/runtime-memory-eval/report.json + report.md.
//
// CURRENT CONTRACT (TF-0500 / TF-0574): the runtime.memory persist/shadow/
// provider/proposeFacts flags are retired and can never resolve to true, so the
// persistence-backed scenarios this file drives are unreachable. Producing a
// "real" aggregate report would require re-enabling that retired capability,
// which no test may do. The file therefore asserts the retirement boundary and
// keeps the pure aggregate-report formatter covered with an empty dataset.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import {
  createTempDbPath,
  RUNTIME_MEMORY_EVAL_CONFIG,
  seedTempDb,
} from "./helpers/runtime-memory-eval-helpers";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..", "..");
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, "artifacts", "runtime-memory-eval");

const tempDirs: string[] = [];

afterAll(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("retired runtime-memory aggregate evaluation", () => {
  it("cannot seed the fixtures the aggregate report needs", () => {
    const dbPath = createTempDbPath("phase39-agg-retired-", tempDirs);
    const persistence = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: dbPath },
    });
    expect(persistence.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });

    // The helper used by the original beforeAll throws instead of silently
    // producing an empty dataset, so a stale aggregate report can never be
    // mistaken for freshly measured data.
    expect(() => seedTempDb(dbPath, [])).toThrow(/seedTempDb: migration failed/);
  });

  it("still writes a machine-readable retirement marker artifact", () => {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const marker = {
      schema: "RuntimeMemoryAggregateRetirement/v1",
      driven_by: "agent",
      status: "not-run",
      reason: "runtime.memory persist/shadow/provider/proposeFacts flags are retired",
      measured: false,
    };
    const out = path.join(ARTIFACTS_DIR, "retirement-marker.json");
    writeFileSync(out, JSON.stringify(marker, null, 2) + "\n", "utf-8");
    expect(marker.measured).toBe(false);
    expect(marker.status).toBe("not-run");
  });
});
