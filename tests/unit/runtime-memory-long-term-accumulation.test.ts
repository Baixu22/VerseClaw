// @vitest-environment node
// Layer 4: Long-term accumulation simulation.
//
// ORIGINAL INTENT: write 100/300 turns of facts to real SQLite, then measure
// retention rate, noise accumulation, FIFO eviction at maxFacts=512, topic-drift
// recall decay, invalidation accumulation and absence of active GC.
//
// CURRENT CONTRACT (TF-0500 / TF-0574): runtime.memory persist/shadow/provider/
// proposeFacts are retired and never resolve to true. seedCorpusToDb therefore
// fails at migrate(), and every measurement helper below reads from that same
// database. The whole simulation is unreachable without re-enabling the retired
// capability, which no test may do.
//
// NOTE: this is a real coverage loss, not an equivalent substitution. The
// long-term retention/noise/FIFO properties are no longer measured by any test.

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import {
  createTempDbPath,
  RUNTIME_MEMORY_EVAL_CONFIG,
} from "./helpers/runtime-memory-eval-helpers";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Layer 4: long-term accumulation — retired", () => {
  it("cannot seed the corpus the accumulation measurements need", () => {
    const dbPath = createTempDbPath("long-term-retired-", tempDirs);
    const persistence = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: dbPath },
    });
    expect(persistence.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
  });

  it("keeps the retired write path from persisting facts across turns", () => {
    const dbPath = createTempDbPath("long-term-retired-write-", tempDirs);
    const persistence = createRuntimeMemoryPersistenceStore({
      config: RUNTIME_MEMORY_EVAL_CONFIG,
      database: { path: dbPath },
    });
    const result = persistence.appendFact({
      schemaVersion: 1,
      factId: "long_term_fact",
    } as never);
    expect(result).toMatchObject({ status: "skipped", reason: "flag_disabled" });
  });
});
