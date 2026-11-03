import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  RUNTIME_MEMORY_PERSISTENCE_OWNER,
  RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION,
  createRuntimeMemoryPersistenceStore,
  inspectRuntimeMemorySanitizedEpisodes,
} from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import {
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryInvalidationProposalFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryEpisodeRecord,
  type RuntimeMemorySourceEpisodeRef,
} from "../../openclaw_runtime/src/runtime-core";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime memory default-off local persistence proof", () => {
  it("does not open, migrate, read, or write the local store when persist is false", () => {
    let openCalls = 0;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: false } } },
      openDatabase: () => {
        openCalls += 1;
        throw new Error("disabled persistence must not open sqlite");
      },
    });

    expect(persistence.migrate()).toEqual({
      status: "skipped",
      reason: "flag_disabled",
      migrated: false,
    });
    expect(persistence.appendEpisode(buildEpisode("episode_disabled", 10)))
      .toEqual({
        status: "skipped",
        reason: "flag_disabled",
        persisted: false,
      });
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactFixture()))
      .toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(persistence.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture()))
      .toMatchObject({ status: "skipped", reason: "flag_disabled" });

    const loaded = persistence.loadStore();
    expect(loaded.status).toBe("skipped");
    expect(loaded.store.stats()).toMatchObject({
      episodes: 0,
      facts: 0,
      invalidations: 0,
    });
    expect(openCalls).toBe(0);
  });

  it("leaves no database file and skips migration for a retired persistence request", () => {
    const dbPath = createTempDbPath();
    const openDatabase = () => {
      throw new Error("retired persistence must not open sqlite");
    };
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      openDatabase: openDatabase as never,
    });

    expect(persistence.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(persistence.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(existsSync(dbPath)).toBe(false);
  });

  it("rejects every retired write path without persisting or opening sqlite", () => {
    const dbPath = createTempDbPath();
    let openCalls = 0;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      openDatabase: (() => {
        openCalls += 1;
        throw new Error("retired persistence must not open sqlite");
      }) as never,
    });

    const disabled = { status: "skipped", reason: "flag_disabled" };
    expect(persistence.appendEpisode(buildEpisode("retired_episode", 1))).toMatchObject(disabled);
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactFixture())).toMatchObject(disabled);
    expect(persistence.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture())).toMatchObject(disabled);
    expect(openCalls).toBe(0);
    expect(existsSync(dbPath)).toBe(false);
  });


  it("skips readonly episode inspection without opening sqlite when persist is false or omitted", () => {
    let openCalls = 0;
    const openReadOnlyDatabase = () => {
      openCalls += 1;
      throw new Error("disabled inspection must not open sqlite");
    };

    expect(inspectRuntimeMemorySanitizedEpisodes({
      config: { runtime: { memory: { persist: false } } },
      database: { path: path.join(createTempDir(), "missing.sqlite") },
      now: () => 7_000,
      openReadOnlyDatabase,
    })).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
      stats: {
        episodeCount: 0,
        returned: 0,
        limit: 256,
        truncated: false,
        inspectedAt: 7_000,
      },
    });

    expect(inspectRuntimeMemorySanitizedEpisodes({
      config: { runtime: { memory: {} } },
      database: { path: path.join(createTempDir(), "missing.sqlite") },
      openReadOnlyDatabase,
    })).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
    });
    expect(openCalls).toBe(0);
  });

  it("returns a retired inspection result without creating a missing database or table", () => {
    const missingPath = path.join(createTempDir(), "missing.sqlite");

    expect(inspectRuntimeMemorySanitizedEpisodes({
      config: { runtime: { memory: { persist: true } } },
      database: { path: missingPath },
      now: () => 7_100,
    })).toMatchObject({
      status: "skipped",
      reason: "flag_disabled",
      episodes: [],
    });
    expect(existsSync(missingPath)).toBe(false);
  });

  it("lists no episodes through the readonly inspector while retired", () => {
    const dbPath = createTempDbPath();
    const openReadOnlyDatabase = () => {
      throw new Error("retired inspection must not open sqlite");
    };
    const result = inspectRuntimeMemorySanitizedEpisodes({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      limit: 4,
      openReadOnlyDatabase,
    });
    expect(result).toMatchObject({ status: "skipped", reason: "flag_disabled", episodes: [] });
    expect(existsSync(dbPath)).toBe(false);
  });

});

function buildEpisode(
  episodeId: string,
  referenceTime: number,
  overrides: Partial<RuntimeMemoryEpisodeRecord> = {},
): RuntimeMemoryEpisodeRecord {
  return buildRuntimeMemoryEpisodeFixture({
    episodeId,
    taskId: "task_memory",
    kind: "verifier_summary",
    reference_time: referenceTime,
    idempotencyKey: `task_memory:${episodeId}`,
    boundedSummary: `Sanitized bounded memory evidence for ${episodeId}.`,
    sourceRefs: [
      {
        type: "file",
        ref: "src/runtime-core/memory-persistence.ts",
        file: "src/runtime-core/memory-persistence.ts",
      },
    ],
    evidenceRefs: [
      {
        type: "test",
        ref: "tests/unit/runtime-memory-persistence.test.ts",
      },
    ],
    ...overrides,
  });
}

function sourceEpisodeRef(
  episode: RuntimeMemoryEpisodeRecord,
): RuntimeMemorySourceEpisodeRef {
  return {
    episodeId: episode.episodeId,
    taskId: episode.taskId,
    kind: episode.kind,
    idempotencyKey: episode.idempotencyKey,
    reference_time: episode.reference_time,
  };
}

function createTempDbPath(): string {
  const dir = createTempDir();
  return path.join(dir, "openclaw.sqlite");
}

function createTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-memory-persistence-"));
  tempDirs.push(dir);
  return dir;
}

function factIds(facts: readonly { readonly factId: string }[]): string[] {
  return facts.map((fact) => fact.factId);
}

function sqlCount(db: DatabaseSync, tableName: string, where?: string): number {
  const query = `SELECT COUNT(*) AS count FROM ${tableName}${where ? ` WHERE ${where}` : ""}`;
  const row = db.prepare(query).get() as { count?: number | bigint } | undefined;
  return Number(row?.count ?? 0);
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { ok?: unknown } | undefined;
  return row?.ok === 1;
}

function inspectPersistenceTables(dbPath: string): Record<string, unknown> {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const meta = db.prepare(
      "SELECT created_at, updated_at FROM runtime_memory_meta WHERE meta_key = ?",
    ).get("runtime-memory");
    return {
      meta,
      episodes: sqlCount(db, "runtime_memory_episodes"),
      idempotency: sqlCount(db, "runtime_memory_episode_idempotency_keys"),
      facts: sqlCount(db, "runtime_memory_facts"),
      invalidations: sqlCount(db, "runtime_memory_invalidations"),
    };
  } finally {
    db.close();
  }
}
