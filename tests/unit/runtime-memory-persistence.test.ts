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

  it("migrates the SQLite schema idempotently and persists only sanitized bounded records", () => {
    const dbPath = createTempDbPath();
    let now = 1_000;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => now++,
    });

    expect(persistence.migrate()).toMatchObject({
      status: "migrated",
      owner: RUNTIME_MEMORY_PERSISTENCE_OWNER,
      schemaVersion: RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION,
    });
    expect(persistence.migrate()).toMatchObject({ status: "migrated" });

    const episode = buildEpisode("episode_keep", 10, {
      metadata: { safe: "kept", toolOutput: "stdout dump" },
    });
    expect(persistence.appendEpisode(episode)).toMatchObject({
      status: "persisted",
      stored: true,
      duplicate: false,
    });
    expect(persistence.appendEpisode({
      ...episode,
      idempotencyKey: "task_memory:alias",
      sourceRefs: [
        ...episode.sourceRefs,
        {
          type: "symbol",
          ref: "RuntimeMemoryPersistenceAlias",
          symbol: "RuntimeMemoryPersistenceAlias",
          file: "src/runtime-core/memory-persistence.ts",
        },
      ],
    })).toMatchObject({
      status: "persisted",
      stored: false,
      duplicate: true,
    });
    expect(persistence.appendEpisode({
      ...episode,
      episodeId: "episode_raw",
      idempotencyKey: "task_memory:raw",
      sourceRefs: [
        {
          type: "tool",
          ref: "tool_raw",
          label: "stdout: full command output",
        },
      ],
    })).toMatchObject({
      status: "rejected",
      reason: "full_tool_output",
      persisted: false,
    });

    const sourceEpisodeRefs = [sourceEpisodeRef(episode)];
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_active",
      subject: "RuntimeMemoryPersistence",
      predicate: "stores",
      objectSummary: "Only sanitized local memory records.",
      valid_at: 10,
      reference_time: 10,
      sourceEpisodeRefs,
      metadata: { prompt: "raw prompt", safe: "kept" },
    }))).toMatchObject({ status: "persisted", stored: true });
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "candidate_memory",
      subject: "RuntimeMemoryPersistence",
      predicate: "stores",
      objectSummary: "Candidate facts remain non-durable proposals.",
      verificationStatus: "candidate",
      valid_at: 10,
      reference_time: 10,
      sourceEpisodeRefs,
    }))).toMatchObject({ status: "persisted", stored: true });
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "candidate_verified_without_promotion",
      subject: "RuntimeMemoryPersistence",
      predicate: "stores",
      objectSummary: "Verified-looking candidates still have no promotion evidence.",
      verificationStatus: "verified",
      valid_at: 10,
      reference_time: 10,
      sourceEpisodeRefs,
    }))).toMatchObject({ status: "persisted", stored: true });

    const invalidatedFact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_invalidated",
      subject: "RuntimeMemoryPersistence",
      predicate: "stores",
      objectSummary: "Old memory record invalidated by accepted evidence.",
      valid_at: 1,
      reference_time: 1,
      sourceEpisodeRefs,
    });
    persistence.appendFact(invalidatedFact);
    persistence.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
      invalidationId: "invalidation_memory",
      factId: invalidatedFact.factId,
      invalid_at: 20,
      reference_time: 20,
      verificationStatus: "verified",
      sourceEpisodeRefs,
      evidenceRefs: invalidatedFact.evidenceRefs,
    }));
    expect(persistence.appendFact({
      ...invalidatedFact,
      objectSummary: "Duplicate fact must not overwrite canonical truth.",
    })).toMatchObject({
      status: "persisted",
      stored: false,
      duplicate: true,
    });

    const loaded = persistence.loadStore();
    expect(loaded.status).toBe("loaded");
    expect(loaded.store.getEpisodeById("episode_keep")?.sourceRefs.map((ref) => ref.ref))
      .toContain("RuntimeMemoryPersistenceAlias");
    expect(factIds(loaded.store.queryFacts({
      subject: "RuntimeMemoryPersistence",
      time: 30,
    }))).toEqual(["fact_active"]);
    expect(factIds(loaded.store.queryFacts({
      subject: "RuntimeMemoryPersistence",
      time: 30,
      includeCandidates: true,
    }))).toEqual(["fact_active", "candidate_memory"]);
    expect(factIds(loaded.store.queryFacts({
      subject: "RuntimeMemoryPersistence",
      time: 30,
      includeInvalidated: true,
    }))).toEqual(["fact_active", "fact_invalidated"]);
    expect(factIds(loaded.store.queryFacts({
      subject: "RuntimeMemoryPersistence",
      time: 30,
      status: "verified",
    }))).toContain("candidate_verified_without_promotion");

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      expect(sqlCount(db, "runtime_memory_meta")).toBe(1);
      expect(sqlCount(db, "runtime_memory_episodes", "episode_id = 'episode_raw'"))
        .toBe(0);
      expect(sqlCount(db, "runtime_memory_episode_idempotency_keys")).toBe(2);
      const recordJson = String(
        db.prepare(
          "SELECT record_json FROM runtime_memory_episodes WHERE episode_id = ?",
        ).get("episode_keep")?.record_json,
      );
      const factRow = db.prepare(
        "SELECT record_kind, promotion_json, record_json FROM runtime_memory_facts WHERE fact_id = ?",
      ).get("candidate_verified_without_promotion") as {
        record_kind?: unknown;
        promotion_json?: unknown;
        record_json?: unknown;
      };
      const allPersistedText = JSON.stringify({
        episode: recordJson,
        facts: db.prepare("SELECT record_json FROM runtime_memory_facts").all(),
        invalidations: db
          .prepare("SELECT record_json FROM runtime_memory_invalidations")
          .all(),
      });

      expect(recordJson).toContain("[redacted]");
      expect(recordJson).toContain("safe");
      expect(allPersistedText).not.toContain("stdout dump");
      expect(allPersistedText).not.toContain("raw prompt");
      expect(factRow.record_kind).toBe("candidate");
      expect(factRow.promotion_json).toBeNull();
      const persistedCandidateRecord = JSON.parse(
        String(factRow.record_json),
      ) as Record<string, unknown>;
      expect(Object.hasOwn(persistedCandidateRecord, "promotion")).toBe(false);
      expect(persistedCandidateRecord.acceptedAt).toBeUndefined();
      expect(persistedCandidateRecord.proposedAt).toBeDefined();
    } finally {
      db.close();
    }
  });

  it("trims persisted episodes, facts, and invalidations with the same bounded-store policy", () => {
    const dbPath = createTempDbPath();
    let now = 2_000;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      maxEpisodes: 1,
      maxFacts: 1,
      maxInvalidations: 1,
      now: () => now++,
    });

    const firstEpisode = buildEpisode("episode_first", 1);
    const secondEpisode = buildEpisode("episode_second", 2);
    persistence.appendEpisode(firstEpisode);
    persistence.appendEpisode(secondEpisode);
    persistence.appendFact(buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_first",
      sourceEpisodeRefs: [sourceEpisodeRef(firstEpisode)],
    }));
    persistence.appendFact(buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_second",
      sourceEpisodeRefs: [sourceEpisodeRef(secondEpisode)],
    }));
    persistence.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
      invalidationId: "invalidation_first",
      factId: "fact_first",
      verificationStatus: "verified",
      sourceEpisodeRefs: [sourceEpisodeRef(firstEpisode)],
    }));
    persistence.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
      invalidationId: "invalidation_second",
      factId: "fact_second",
      verificationStatus: "verified",
      sourceEpisodeRefs: [sourceEpisodeRef(secondEpisode)],
    }));

    const loaded = persistence.loadStore();
    expect(loaded.store.stats()).toMatchObject({
      episodes: 1,
      facts: 1,
      invalidations: 1,
      maxEpisodes: 1,
      maxFacts: 1,
      maxInvalidations: 1,
    });
    expect(loaded.store.getEpisodeById("episode_first")).toBeUndefined();
    expect(loaded.store.getEpisodeById("episode_second")).toBeDefined();
    expect(loaded.store.getFactById("fact_first")).toBeUndefined();
    expect(loaded.store.getFactById("fact_second")).toBeDefined();

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      expect(sqlCount(db, "runtime_memory_episodes")).toBe(1);
      expect(sqlCount(db, "runtime_memory_facts")).toBe(1);
      expect(sqlCount(db, "runtime_memory_invalidations")).toBe(1);
    } finally {
      db.close();
    }
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

  it("returns bounded diagnostics without creating a missing database or table", () => {
    const missingPath = path.join(createTempDir(), "missing.sqlite");

    expect(inspectRuntimeMemorySanitizedEpisodes({
      config: { runtime: { memory: { persist: true } } },
      database: { path: missingPath },
      now: () => 7_100,
    })).toMatchObject({
      status: "skipped",
      reason: "database_missing",
      episodes: [],
      stats: expect.objectContaining({ inspectedAt: 7_100 }),
    });
    expect(existsSync(missingPath)).toBe(false);

    const dbPath = createTempDbPath();
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("CREATE TABLE unrelated_state (id TEXT PRIMARY KEY);");
    } finally {
      db.close();
    }

    expect(inspectRuntimeMemorySanitizedEpisodes({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
    })).toMatchObject({
      status: "skipped",
      reason: "table_missing",
      episodes: [],
    });

    const readonlyDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      expect(tableExists(readonlyDb, "runtime_memory_episodes")).toBe(false);
      expect(tableExists(readonlyDb, "runtime_memory_meta")).toBe(false);
      expect(tableExists(readonlyDb, "unrelated_state")).toBe(true);
    } finally {
      readonlyDb.close();
    }
  });

  it("lists sanitized episode summaries through a readonly no-mutation inspection helper", () => {
    const dbPath = createTempDbPath();
    let now = 8_000;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      maxEpisodes: 4,
      now: () => now++,
    });
    const firstEpisode = buildEpisode("episode_inspect_first", 10, {
      metadata: {
        safe: "kept",
        inspectionSafe: true,
      },
    });
    const secondEpisode = buildEpisode("episode_inspect_second", 20);
    const sourceEpisodeRefs = [sourceEpisodeRef(firstEpisode)];

    expect(persistence.appendEpisode(firstEpisode)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(persistence.appendEpisode(secondEpisode)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactFixture({
      factId: "readonly_inspection_fact",
      subject: "ReadonlyInspection",
      predicate: "stays_out_of",
      objectSummary: "Episode summaries.",
      sourceEpisodeRefs,
    }))).toMatchObject({ status: "persisted", stored: true });
    expect(persistence.appendFact(buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "readonly_inspection_candidate",
      subject: "ReadonlyInspection",
      predicate: "remains_outside",
      objectSummary: "Episode summaries.",
      verificationStatus: "verified",
      sourceEpisodeRefs,
    }))).toMatchObject({ status: "persisted", stored: true });

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
          raw: "raw task text self-check subagent template stdout stderr traceparent",
        }),
        firstEpisode.episodeId,
      );
    } finally {
      writeDb.close();
    }

    const before = inspectPersistenceTables(dbPath);
    let readOnlyOpenCalls = 0;
    const inspection = inspectRuntimeMemorySanitizedEpisodes({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      limit: 1,
      now: () => 9_000,
      openReadOnlyDatabase: (pathname) => {
        readOnlyOpenCalls += 1;
        return new DatabaseSync(pathname, { readOnly: true });
      },
    });
    const after = inspectPersistenceTables(dbPath);

    expect(readOnlyOpenCalls).toBe(1);
    expect(inspection).toEqual({
      status: "loaded",
      episodes: [
        expect.objectContaining({
          episodeId: "episode_inspect_first",
          taskId: "task_memory",
          kind: "verifier_summary",
          reference_time: 10,
          boundedSummary: "Sanitized bounded memory evidence for episode_inspect_first.",
          redactionStatus: "sanitized",
          metadata: {
            safe: "kept",
            raw: "[redacted]",
          },
          sourceRefs: [
            expect.objectContaining({
              type: "file",
              ref: "src/runtime-core/memory-persistence.ts",
            }),
          ],
          evidenceRefs: [
            expect.objectContaining({
              type: "test",
              ref: "tests/unit/runtime-memory-persistence.test.ts",
            }),
          ],
        }),
      ],
      stats: {
        episodeCount: 2,
        returned: 1,
        limit: 1,
        truncated: true,
        inspectedAt: 9_000,
      },
      diagnostics: [],
    });
    expect(after).toEqual(before);
    expect(JSON.stringify(inspection)).not.toContain("record_json");
    expect(JSON.stringify(inspection)).not.toContain("raw task text");
    expect(JSON.stringify(inspection)).not.toContain("self-check");
    expect(JSON.stringify(inspection)).not.toContain("subagent");
    expect(JSON.stringify(inspection)).not.toContain("template");
    expect(JSON.stringify(inspection)).not.toContain("stdout");
    expect(JSON.stringify(inspection)).not.toContain("stderr");
    expect(JSON.stringify(inspection)).not.toContain("process.env");
    expect(JSON.stringify(inspection)).not.toContain("SECRET");
    expect(JSON.stringify(inspection)).not.toContain("traceparent");
    expect(JSON.stringify(inspection)).not.toContain("transcript");
    expect(JSON.stringify(inspection)).not.toContain("jsonl");
    expect(JSON.stringify(inspection)).not.toContain("toolOutput");
    expect(JSON.stringify(inspection)).not.toContain("readonly_inspection_fact");
    expect(JSON.stringify(inspection)).not.toContain("readonly_inspection_candidate");
    expect(JSON.stringify(inspection)).not.toContain("RuntimeMemoryProvider");
    expect(JSON.stringify(inspection)).not.toContain("completionAuthority");
    expect(JSON.stringify(inspection)).not.toContain("runtimeAuthority");
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
