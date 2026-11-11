import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRuntimeMemoryEpisodeFixture,
  closeRuntimeMemoryHydrationShadowDatabasesForTest,
  hydrateRuntimeMemoryShadowContext,
  readRuntimeMemoryHydrationShadow,
  type RuntimeMemoryEpisodeRecord,
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

describe("runtime memory readonly read hydration shadow helper", () => {
  it("stays default-off without opening, reading, creating, or writing sqlite", () => {
    let openCalls = 0;
    const openReadOnlyDatabase = () => {
      openCalls += 1;
      throw new Error("disabled hydration shadow must not open sqlite");
    };
    const missingPath = path.join(createTempDir(), "missing.sqlite");

    expect(hydrateRuntimeMemoryShadowContext({
      config: { runtime: { memory: { persist: false } } },
      databasePath: missingPath,
      readShadow: true,
      now: () => 100,
      openReadOnlyDatabase,
    })).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      facts: [],
      stats: {
        episodeCount: 0,
        factCount: 0,
        episodesReturned: 0,
        factsReturned: 0,
        episodeLimit: 256,
        factLimit: 512,
        truncated: false,
        inspectedAt: 100,
      },
      authority: {
        diagnosticsOnly: true,
        readonly: true,
        noPromptInjection: true,
        noProviderOrdering: true,
        noRuntimeAuthority: true,
        noDurableFactAuthority: true,
      },
    });

    expect(hydrateRuntimeMemoryShadowContext({
      config: { runtime: { memory: { persist: true } } },
      databasePath: missingPath,
      readShadow: false,
      openReadOnlyDatabase,
    })).toMatchObject({
      status: "skipped",
      // TF-0500 retires persist, so the flag gate now precedes readShadow.
      reason: "flag_disabled",
      episodes: [],
      facts: [],
    });
    expect(openCalls).toBe(0);
    expect(existsSync(missingPath)).toBe(false);
  });

  it("requires an explicit database path before opening sqlite", () => {
    let openCalls = 0;

    expect(readRuntimeMemoryHydrationShadow({
      config: { runtime: { memory: { persist: true } } },
      readShadow: true,
      now: () => 200,
      openReadOnlyDatabase: () => {
        openCalls += 1;
        throw new Error("missing path must not open sqlite");
      },
    })).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      facts: [],
      stats: expect.objectContaining({ inspectedAt: 200 }),
    });
    expect(openCalls).toBe(0);
  });

  it("does not create a missing explicit database file", () => {
    const dbPath = path.join(createTempDir(), "missing.sqlite");

    expect(hydrateRuntimeMemoryShadowContext({
      config: { runtime: { memory: { persist: true } } },
      databasePath: dbPath,
      readShadow: true,
    })).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      facts: [],
    });
    expect(existsSync(dbPath)).toBe(false);
  });

  it("does not create runtime memory tables in an unrelated existing database", () => {
    const dbPath = createTempDbPath();
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("CREATE TABLE unrelated_state (id TEXT PRIMARY KEY);");
    } finally {
      db.close();
    }

    expect(hydrateRuntimeMemoryShadowContext({
      config: { runtime: { memory: { persist: true } } },
      databasePath: dbPath,
      readShadow: true,
    })).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      facts: [],
    });

    const readonlyDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      expect(tableExists(readonlyDb, "runtime_memory_episodes")).toBe(false);
      expect(tableExists(readonlyDb, "runtime_memory_facts")).toBe(false);
      expect(tableExists(readonlyDb, "runtime_memory_meta")).toBe(false);
      expect(tableExists(readonlyDb, "unrelated_state")).toBe(true);
    } finally {
      readonlyDb.close();
    }
  });

  it("cannot persist the sanitized summaries and projections this helper reads", () => {
    // TF-0500 retired runtime.memory.persist, so the store cannot be seeded and
    // the bounded projection assertions below are unreachable. The read path must
    // stay inert rather than surface partial or raw data.
    const dbPath = createTempDbPath();
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => 300,
    });
    expect(persistence.appendEpisode(buildEpisode("phase21_episode_first", 10))).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
    });

    const result = hydrateRuntimeMemoryShadowContext({
      config: { runtime: { memory: { persist: true } } },
      databasePath: dbPath,
      readShadow: true,
    });
    expect(result.status).toBe("skipped");
    expect(result.episodes).toHaveLength(0);
    expect(result.facts).toHaveLength(0);
  });
});

function buildEpisode(
  episodeId: string,
  referenceTime: number,
): RuntimeMemoryEpisodeRecord {
  return buildRuntimeMemoryEpisodeFixture({
    episodeId,
    taskId: "task_memory_hydration",
    kind: "verifier_summary",
    reference_time: referenceTime,
    idempotencyKey: `task_memory_hydration:${episodeId}`,
    boundedSummary: `Sanitized hydration evidence for ${episodeId}.`,
    sourceRefs: [
      {
        type: "file",
        ref: "src/runtime-core/memory-read-hydration-shadow.ts",
        file: "src/runtime-core/memory-read-hydration-shadow.ts",
      },
    ],
    evidenceRefs: [
      {
        type: "test",
        ref: "tests/unit/runtime-memory-read-hydration-shadow.test.ts",
      },
    ],
  });
}

function createTempDbPath(): string {
  return path.join(createTempDir(), "openclaw.sqlite");
}

function createTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-memory-hydration-"));
  tempDirs.push(dir);
  return dir;
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { ok?: unknown } | undefined;
  return row?.ok === 1;
}
