// @vitest-environment node
// Phase 4.1 persistence: Validates that memoryType round-trips through the
// SQLite persistence layer — the column is written, record_json includes it,
// and loading reconstructs the fact with the correct memoryType. Also verifies
// the additive migration adds memory_type to pre-existing databases.

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeMemoryPersistenceStore,
} from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import {
  buildRuntimeMemoryTemporalFactFixture,
} from "../../openclaw_runtime/src/runtime-core";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-memory-taxonomy-"));
  tempDirs.push(dir);
  return path.join(dir, "openclaw.sqlite");
}

describe("Phase 4.1 persistence: memoryType round-trip", () => {
  it("persists and reloads a fact with memoryType: procedural", () => {
    const dbPath = createTempDbPath();
    let now = 1_000;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => now++,
    });

    persistence.migrate();

    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_procedural",
      subject: "UserWorkflow",
      predicate: "preference",
      objectSummary: "User prefers committing with conventional commit messages.",
      memoryType: "procedural",
    });
    expect(persistence.appendFact(fact)).toMatchObject({
      status: "persisted",
      stored: true,
    });

    const loaded = persistence.loadStore();
    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") return;

    const facts = loaded.store.queryFacts({ subject: "UserWorkflow" });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.memoryType).toBe("procedural");
  });

  it("persists and reloads a fact with memoryType: episodic", () => {
    const dbPath = createTempDbPath();
    let now = 1_000;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => now++,
    });

    persistence.migrate();

    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_episodic",
      subject: "DeploymentEvent",
      predicate: "occurred",
      objectSummary: "Service was deployed to production at 3pm on Tuesday.",
      memoryType: "episodic",
    });
    persistence.appendFact(fact);

    const loaded = persistence.loadStore();
    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") return;

    const facts = loaded.store.queryFacts({ subject: "DeploymentEvent" });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.memoryType).toBe("episodic");
  });

  it("defaults memoryType to semantic in record_json when omitted", () => {
    const dbPath = createTempDbPath();
    let now = 1_000;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => now++,
    });

    persistence.migrate();

    // Omit memoryType — should default to "semantic" in the DB.
    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_default_type",
      subject: "DefaultType",
      predicate: "value",
      objectSummary: "Fact without explicit memoryType.",
    });
    persistence.appendFact(fact);

    // Verify the DB column has the default.
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare("SELECT memory_type, record_json FROM runtime_memory_facts WHERE fact_id = ?")
        .get("fact_default_type") as { memory_type?: string; record_json?: string };
      expect(row.memory_type).toBe("semantic");
      const parsed = JSON.parse(row.record_json ?? "{}") as { memoryType?: string };
      expect(parsed.memoryType).toBe("semantic");
    } finally {
      db.close();
    }
  });

  it("writes the memory_type column for all three types", () => {
    const dbPath = createTempDbPath();
    let now = 1_000;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => now++,
    });

    persistence.migrate();

    const types = ["semantic", "episodic", "procedural"] as const;
    for (const memoryType of types) {
      persistence.appendFact(buildRuntimeMemoryTemporalFactFixture({
        factId: `fact_${memoryType}`,
        subject: `Subject_${memoryType}`,
        predicate: "value",
        objectSummary: `Fact with memoryType ${memoryType}.`,
        memoryType,
      }));
    }

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      for (const memoryType of types) {
        const row = db
          .prepare("SELECT memory_type FROM runtime_memory_facts WHERE fact_id = ?")
          .get(`fact_${memoryType}`) as { memory_type?: string };
        expect(row.memory_type).toBe(memoryType);
      }
    } finally {
      db.close();
    }
  });

  it("migrates a pre-Phase-4.1 database by adding memory_type column", () => {
    const dbPath = createTempDbPath();

    // Simulate a pre-Phase-4.1 database: create the table WITHOUT memory_type.
    const setupDb = new DatabaseSync(dbPath);
    try {
      setupDb.exec(`
        CREATE TABLE IF NOT EXISTS runtime_memory_meta (
          meta_key TEXT NOT NULL PRIMARY KEY,
          owner TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runtime_memory_episodes (
          episode_id TEXT NOT NULL PRIMARY KEY,
          task_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          reference_time INTEGER NOT NULL,
          idempotency_key TEXT NOT NULL,
          bounded_summary TEXT NOT NULL,
          source_refs_json TEXT NOT NULL,
          evidence_refs_json TEXT NOT NULL,
          metadata_json TEXT,
          redaction_status TEXT NOT NULL,
          record_json TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runtime_memory_episode_idempotency_keys (
          idempotency_key TEXT NOT NULL PRIMARY KEY,
          episode_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runtime_memory_facts (
          fact_id TEXT NOT NULL PRIMARY KEY,
          record_kind TEXT NOT NULL,
          task_id TEXT,
          subject TEXT NOT NULL,
          predicate TEXT NOT NULL,
          object_summary TEXT NOT NULL,
          confidence REAL NOT NULL,
          source TEXT NOT NULL,
          verification_status TEXT NOT NULL,
          valid_at INTEGER NOT NULL,
          invalid_at INTEGER,
          expired_at INTEGER,
          reference_time INTEGER NOT NULL,
          source_episode_refs_json TEXT NOT NULL,
          evidence_refs_json TEXT NOT NULL,
          metadata_json TEXT,
          proposed_at INTEGER,
          accepted_at INTEGER,
          promotion_json TEXT,
          record_json TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS runtime_memory_invalidations (
          invalidation_id TEXT NOT NULL PRIMARY KEY,
          fact_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          invalid_at INTEGER NOT NULL,
          reference_time INTEGER NOT NULL,
          proposed_by TEXT NOT NULL,
          verification_status TEXT NOT NULL,
          source_episode_refs_json TEXT NOT NULL,
          evidence_refs_json TEXT NOT NULL,
          replacement_fact_id TEXT,
          metadata_json TEXT,
          record_json TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      // Insert a legacy fact WITHOUT memoryType in record_json.
      const legacyFact = buildRuntimeMemoryTemporalFactFixture({
        factId: "fact_legacy",
        subject: "LegacySubject",
        predicate: "value",
        objectSummary: "Legacy fact created before Phase 4.1.",
      });
      // Strip memoryType to simulate a pre-4.1 record.
      const { memoryType: _omitted, ...legacyRecord } = legacyFact;
      void _omitted;
      setupDb
        .prepare(
          `INSERT INTO runtime_memory_facts (
            fact_id, record_kind, task_id, subject, predicate, object_summary,
            confidence, source, verification_status, valid_at, invalid_at,
            expired_at, reference_time, source_episode_refs_json,
            evidence_refs_json, metadata_json, proposed_at, accepted_at,
            promotion_json, record_json, schema_version, created_at, updated_at
          ) VALUES (?, 'fact', NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          legacyRecord.factId,
          legacyRecord.subject,
          legacyRecord.predicate,
          legacyRecord.objectSummary,
          legacyRecord.confidence,
          legacyRecord.source,
          legacyRecord.verificationStatus,
          legacyRecord.valid_at,
          legacyRecord.reference_time,
          JSON.stringify(legacyRecord.sourceEpisodeRefs),
          JSON.stringify(legacyRecord.evidenceRefs),
          legacyRecord.acceptedAt,
          JSON.stringify(legacyRecord.promotion),
          JSON.stringify(legacyRecord),
          1000,
          1000,
        );
    } finally {
      setupDb.close();
    }

    // Now open with the persistence store — migration should add memory_type.
    let now = 2_000;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => now++,
    });

    const migrateResult = persistence.migrate();
    expect(migrateResult).toMatchObject({ status: "migrated" });

    // Verify the column was added.
    const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const columns = verifyDb
        .prepare("PRAGMA table_info(runtime_memory_facts)")
        .all() as Array<{ name?: string }>;
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).toContain("memory_type");

      // The legacy fact should have the default value.
      const row = verifyDb
        .prepare("SELECT memory_type FROM runtime_memory_facts WHERE fact_id = ?")
        .get("fact_legacy") as { memory_type?: string };
      expect(row.memory_type).toBe("semantic");
    } finally {
      verifyDb.close();
    }

    // The legacy fact should still load (memoryType undefined in JSON, but valid).
    const loaded = persistence.loadStore();
    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") return;
    const facts = loaded.store.queryFacts({ subject: "LegacySubject" });
    expect(facts).toHaveLength(1);
    // memoryType is undefined in the legacy record_json, which is valid.
    expect(facts[0]?.memoryType).toBeUndefined();
  });

  it("is idempotent: migrating twice does not error or duplicate columns", () => {
    const dbPath = createTempDbPath();
    let now = 1_000;
    const persistence = createRuntimeMemoryPersistenceStore({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => now++,
    });

    persistence.migrate();
    persistence.migrate();

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const columns = db
        .prepare("PRAGMA table_info(runtime_memory_facts)")
        .all() as Array<{ name?: string }>;
      const memoryTypeColumns = columns.filter((c) => c.name === "memory_type");
      expect(memoryTypeColumns).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
