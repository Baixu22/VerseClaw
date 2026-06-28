import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  hydrateRuntimeMemoryShadowContext,
  readRuntimeMemoryHydrationShadow,
  type RuntimeMemoryEpisodeRecord,
  type RuntimeMemorySourceEpisodeRef,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
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
      reason: "read_shadow_disabled",
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
      reason: "database_path_required",
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
      reason: "database_missing",
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
      reason: "table_missing",
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

  it("returns bounded sanitized episode summaries and fact projections only", () => {
    const dbPath = createTempDbPath();
    const firstEpisode = buildEpisode("phase21_episode_first", 10);
    const secondEpisode = buildEpisode("phase21_episode_second", 20);
    const sourceEpisodeRefs = [sourceEpisodeRef(firstEpisode)];
    let persistedAt = 300;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => persistedAt++,
    });

    expect(persistence.appendEpisode(firstEpisode)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(persistence.appendEpisode(secondEpisode)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactFixture({
      factId: "phase21_fact",
      taskId: "task_memory_hydration",
      subject: "HydrationShadow",
      predicate: "reads",
      objectSummary: "Sanitized fact projection only.",
      valid_at: 10,
      reference_time: 10,
      sourceEpisodeRefs,
      metadata: {
        safe: "kept",
        prompt: "raw prompt",
        env: "process.env SECRET traceparent",
      },
    }))).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "phase21_candidate",
      taskId: "task_memory_hydration",
      subject: "HydrationShadow",
      predicate: "keeps",
      objectSummary: "Candidate projection is still non-authoritative.",
      verificationStatus: "candidate",
      sourceEpisodeRefs,
    }))).toMatchObject({
      status: "persisted",
      stored: true,
    });

    const writeDb = new DatabaseSync(dbPath);
    try {
      writeDb.prepare(
        "UPDATE runtime_memory_episodes SET metadata_json = ?, record_json = ? WHERE episode_id = ?",
      ).run(
        JSON.stringify({
          safe: "kept",
          raw: "process.env SECRET traceparent transcript jsonl toolOutput",
        }),
        JSON.stringify({
          raw: "raw task text self-check subagent template stdout stderr traceparent RuntimeMemoryProvider runtime authority",
        }),
        firstEpisode.episodeId,
      );
      writeDb.prepare(
        "UPDATE runtime_memory_facts SET metadata_json = ?, record_json = ? WHERE fact_id = ?",
      ).run(
        JSON.stringify({
          safe: "kept",
          toolOutput: "stdout secret trace marker",
        }),
        JSON.stringify({
          raw: "raw fact record self-check provider runtime authority",
        }),
        "phase21_fact",
      );
    } finally {
      writeDb.close();
    }

    const before = inspectPersistenceTables(dbPath);
    let readOnlyOpenCalls = 0;
    const hydration = hydrateRuntimeMemoryShadowContext({
      config: { runtime: { memory: { persist: true } } },
      databasePath: dbPath,
      readShadow: true,
      limit: 1,
      maxFacts: 1,
      now: () => 400,
      openReadOnlyDatabase: (pathname) => {
        readOnlyOpenCalls += 1;
        return new DatabaseSync(pathname, { readOnly: true });
      },
    });
    const after = inspectPersistenceTables(dbPath);

    expect(readOnlyOpenCalls).toBe(2);
    expect(after).toEqual(before);
    expect(hydration).toEqual({
      status: "loaded",
      episodes: [
        expect.objectContaining({
          episodeId: "phase21_episode_first",
          taskId: "task_memory_hydration",
          kind: "verifier_summary",
          boundedSummary: "Sanitized hydration evidence for phase21_episode_first.",
          metadata: {
            safe: "kept",
            raw: "[redacted]",
          },
        }),
      ],
      facts: [
        expect.objectContaining({
          factId: "phase21_fact",
          recordKind: "fact",
          taskId: "task_memory_hydration",
          subject: "HydrationShadow",
          predicate: "reads",
          objectSummary: "Sanitized fact projection only.",
          metadata: {
            safe: "kept",
          },
        }),
      ],
      stats: {
        episodeCount: 2,
        factCount: 2,
        episodesReturned: 1,
        factsReturned: 1,
        episodeLimit: 1,
        factLimit: 1,
        truncated: true,
        inspectedAt: 400,
      },
      diagnostics: [],
      authority: {
        diagnosticsOnly: true,
        readonly: true,
        noPromptInjection: true,
        noProviderOrdering: true,
        noRuntimeAuthority: true,
        noDurableFactAuthority: true,
      },
    });

    const serialized = JSON.stringify(hydration);
    expect(serialized).not.toContain("record_json");
    expect(serialized).not.toContain("raw task text");
    expect(serialized).not.toContain("raw fact record");
    expect(serialized).not.toContain("self-check");
    expect(serialized).not.toContain("subagent");
    expect(serialized).not.toContain("template");
    expect(serialized).not.toContain("stdout secret");
    expect(serialized).not.toContain("stderr");
    expect(serialized).not.toContain("process.env");
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("traceparent");
    expect(serialized).not.toContain("transcript");
    expect(serialized).not.toContain("jsonl");
    expect(serialized).not.toContain("toolOutput\":\"stdout");
    expect(serialized).not.toContain("RuntimeMemoryProvider");
    expect(serialized).not.toContain("provider runtime authority");
    expect(serialized).not.toContain("runtimeAuthority");
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
  return path.join(createTempDir(), "openclaw.sqlite");
}

function createTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-memory-hydration-"));
  tempDirs.push(dir);
  return dir;
}

function sqlCount(db: DatabaseSync, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as
    | { count?: number | bigint }
    | undefined;
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
    return {
      episodes: sqlCount(db, "runtime_memory_episodes"),
      facts: sqlCount(db, "runtime_memory_facts"),
      invalidations: sqlCount(db, "runtime_memory_invalidations"),
      meta: sqlCount(db, "runtime_memory_meta"),
    };
  } finally {
    db.close();
  }
}
