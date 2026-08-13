// @vitest-environment node
// P0-B: memory self-edit writes must persist through the runtime integration
// port (SQLite), not just mutate the in-memory store snapshot that the adapter
// rebuilds on every call. Covers cross-call / cross-restart durability, direct
// SQLite row assertions, and persistence-failure injection.

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeMemorySelfEditTool,
  type MemorySelfEditToolContext,
} from "../../openclaw_runtime/src/runtime-core/memory-self-edit-tools";
import {
  createRuntimeMemoryRuntimeIntegration,
  type RuntimeMemoryRuntimeIntegrationPort,
} from "../../openclaw_runtime/src/runtime-core/memory-runtime-integration";
import { RuntimeMemoryStore } from "../../openclaw_runtime/src/runtime-core/memory-store";
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const persistConfig = { runtime: { memory: { persist: true } } };

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-memory-self-edit-"));
  tempDirs.push(dir);
  return path.join(dir, "openclaw.sqlite");
}

function makeFact(
  id: string,
  overrides: Partial<RuntimeMemoryTemporalFact> = {},
): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject: `Subject_${id}`,
    predicate: "value",
    objectSummary: `Fact ${id} summary.`,
    confidence: 0.7,
    source: "tool_result",
    verificationStatus: "verified",
    valid_at: 100,
    reference_time: 100,
    acceptedAt: 100,
    ...overrides,
  });
}

function seedFact(dbPath: string, fact: RuntimeMemoryTemporalFact): void {
  const integration = createRuntimeMemoryRuntimeIntegration({
    config: persistConfig,
    database: { path: dbPath },
    now: () => 100,
  });
  expect(integration.migrate()).toMatchObject({ status: "migrated" });
  expect(integration.appendFact(fact)).toMatchObject({
    status: "persisted",
    stored: true,
  });
}

function makePersistentContext(dbPath: string, now = 1000): MemorySelfEditToolContext {
  const integration = createRuntimeMemoryRuntimeIntegration({
    config: persistConfig,
    database: { path: dbPath },
    now: () => now,
  });
  const { store } = integration.loadStore();
  return { store, persistence: integration, now };
}

function loadFreshStore(dbPath: string, now = 1000): RuntimeMemoryStore {
  const integration = createRuntimeMemoryRuntimeIntegration({
    config: persistConfig,
    database: { path: dbPath },
    now: () => now,
  });
  const loaded = integration.loadStore();
  expect(loaded.status).toBe("loaded");
  return loaded.store;
}

describe("P0-B: memory self-edit durable persistence", () => {
  it("memory_update persists supersede + invalidation across calls", () => {
    const dbPath = createTempDbPath();
    seedFact(dbPath, makeFact("old_fact"));

    const context = makePersistentContext(dbPath, 2000);
    const result = executeMemorySelfEditTool(
      "memory_update",
      { factId: "old_fact", objectSummary: "New summary.", confidence: 0.9 },
      context,
    );

    expect(result.ok).toBe(true);
    const data = result.data as { newFactId: string };
    expect(data.newFactId).toContain("old_fact_superseded_");

    // A fresh integration (new process / new call) reads persisted state back.
    const store = loadFreshStore(dbPath, 2000);
    const newFact = store.getFactById(data.newFactId);
    expect(newFact).toBeDefined();
    expect(newFact?.objectSummary).toBe("New summary.");
    expect(newFact?.confidence).toBe(0.9);

    const invalidation = store
      .listInvalidations()
      .find((inv) => inv.factId === "old_fact");
    expect(invalidation).toBeDefined();
    expect(invalidation?.reason).toBe("superseded");
    expect(invalidation?.replacementFactId).toBe(data.newFactId);
  });

  it("memory_update writes rows into SQLite (fact, invalidation, relation)", () => {
    const dbPath = createTempDbPath();
    seedFact(dbPath, makeFact("old_fact"));

    const result = executeMemorySelfEditTool(
      "memory_update",
      { factId: "old_fact", objectSummary: "New summary." },
      makePersistentContext(dbPath, 2000),
    );
    expect(result.ok).toBe(true);
    const newFactId = (result.data as { newFactId: string }).newFactId;

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const factRow = db
        .prepare("SELECT record_kind FROM runtime_memory_facts WHERE fact_id = ?")
        .get(newFactId) as { record_kind?: unknown } | undefined;
      expect(factRow?.record_kind).toBe("fact");

      const invRow = db
        .prepare(
          "SELECT reason, replacement_fact_id FROM runtime_memory_invalidations WHERE fact_id = ?",
        )
        .get("old_fact") as
        | { reason?: unknown; replacement_fact_id?: unknown }
        | undefined;
      expect(invRow?.reason).toBe("superseded");
      expect(invRow?.replacement_fact_id).toBe(newFactId);

      const relRow = db
        .prepare(
          "SELECT relation_type FROM runtime_memory_fact_relations WHERE source_fact_id = ? AND target_fact_id = ?",
        )
        .get(newFactId, "old_fact") as { relation_type?: unknown } | undefined;
      expect(relRow?.relation_type).toBe("supersedes");
    } finally {
      db.close();
    }
  });

  it("memory_forget persists invalidation across calls", () => {
    const dbPath = createTempDbPath();
    seedFact(dbPath, makeFact("forget_me"));

    const result = executeMemorySelfEditTool(
      "memory_forget",
      { factId: "forget_me", reason: "human_rejected" },
      makePersistentContext(dbPath, 2000),
    );
    expect(result.ok).toBe(true);

    const store = loadFreshStore(dbPath, 2000);
    const invalidation = store
      .listInvalidations()
      .find((inv) => inv.factId === "forget_me");
    expect(invalidation).toBeDefined();
    expect(invalidation?.reason).toBe("human_rejected");
  });

  it("memory_update returns ok:false when persistence rejects the write", () => {
    const store = new RuntimeMemoryStore({ now: () => 1000 });
    store.appendFact(makeFact("f1"));

    const failingPersistence: RuntimeMemoryRuntimeIntegrationPort = {
      migrate: () => ({ status: "skipped", reason: "flag_disabled", migrated: false }),
      appendEpisode: () => ({
        status: "rejected",
        reason: "invalid_episode",
        message: "unused",
        persisted: false,
      }),
      appendFact: () => ({
        status: "rejected",
        reason: "invalid_fact",
        message: "boom",
        persisted: false,
      }),
      invalidateFact: () => ({
        status: "rejected",
        reason: "invalid_invalidation",
        message: "unused",
        persisted: false,
      }),
      persistRelation: () => ({ status: "persisted", persisted: true }),
      recordFactAccess: () => ({
        status: "rejected",
        reason: "unknown_fact",
        message: "unused",
        persisted: false,
      }),
      loadStore: () => ({ status: "loaded", store }),
    };

    const context: MemorySelfEditToolContext = {
      store,
      persistence: failingPersistence,
      now: 2000,
    };
    const result = executeMemorySelfEditTool(
      "memory_update",
      { factId: "f1", objectSummary: "x" },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("boom");
  });

  it("memory_forget returns ok:false when persistence rejects the write", () => {
    const store = new RuntimeMemoryStore({ now: () => 1000 });
    store.appendFact(makeFact("forget_me"));

    const failingPersistence: RuntimeMemoryRuntimeIntegrationPort = {
      migrate: () => ({ status: "skipped", reason: "flag_disabled", migrated: false }),
      appendEpisode: () => ({
        status: "rejected",
        reason: "invalid_episode",
        message: "unused",
        persisted: false,
      }),
      appendFact: () => ({
        status: "rejected",
        reason: "invalid_fact",
        message: "unused",
        persisted: false,
      }),
      invalidateFact: () => ({
        status: "rejected",
        reason: "invalid_invalidation",
        message: "forget failed",
        persisted: false,
      }),
      persistRelation: () => ({ status: "persisted", persisted: true }),
      recordFactAccess: () => ({
        status: "rejected",
        reason: "unknown_fact",
        message: "unused",
        persisted: false,
      }),
      loadStore: () => ({ status: "loaded", store }),
    };

    const context: MemorySelfEditToolContext = {
      store,
      persistence: failingPersistence,
      now: 2000,
    };
    const result = executeMemorySelfEditTool(
      "memory_forget",
      { factId: "forget_me" },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("forget failed");
  });

  it("memory_strengthen persists usage across restart (SQLite row assertion)", () => {
    const dbPath = createTempDbPath();
    seedFact(dbPath, makeFact("hot_fact"));

    const first = executeMemorySelfEditTool(
      "memory_strengthen",
      { factId: "hot_fact" },
      makePersistentContext(dbPath, 2000),
    );
    expect(first.ok).toBe(true);
    expect((first.data as { usageCount: number }).usageCount).toBe(1);

    // A second call from a fresh context (new process) sees the prior access.
    const second = executeMemorySelfEditTool(
      "memory_strengthen",
      { factId: "hot_fact" },
      makePersistentContext(dbPath, 3000),
    );
    expect(second.ok).toBe(true);
    expect((second.data as { usageCount: number }).usageCount).toBe(2);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare(
          "SELECT access_count, last_accessed_at FROM runtime_memory_fact_usage WHERE fact_id = ?",
        )
        .get("hot_fact") as
        | { access_count?: unknown; last_accessed_at?: unknown }
        | undefined;
      expect(row?.access_count).toBe(2);
      expect(row?.last_accessed_at).toBe(3000);
    } finally {
      db.close();
    }

    // Reloading the store hydrates the persisted usage stats.
    const store = loadFreshStore(dbPath, 4000);
    const stat = store.getUsageStats().find((s) => s.factId === "hot_fact");
    expect(stat?.count).toBe(2);
    expect(stat?.lastAccessedAt).toBe(3000);
  });

  it("memory_strengthen returns ok:false when persistence rejects the access", () => {
    const store = new RuntimeMemoryStore({ now: () => 1000 });
    store.appendFact(makeFact("f1"));

    const failingPersistence: RuntimeMemoryRuntimeIntegrationPort = {
      migrate: () => ({ status: "skipped", reason: "flag_disabled", migrated: false }),
      appendEpisode: () => ({
        status: "rejected",
        reason: "invalid_episode",
        message: "unused",
        persisted: false,
      }),
      appendFact: () => ({
        status: "rejected",
        reason: "invalid_fact",
        message: "unused",
        persisted: false,
      }),
      invalidateFact: () => ({
        status: "rejected",
        reason: "invalid_invalidation",
        message: "unused",
        persisted: false,
      }),
      persistRelation: () => ({ status: "persisted", persisted: true }),
      recordFactAccess: () => ({
        status: "rejected",
        reason: "unknown_fact",
        message: "access boom",
        persisted: false,
      }),
      loadStore: () => ({ status: "loaded", store }),
    };

    const result = executeMemorySelfEditTool(
      "memory_strengthen",
      { factId: "f1" },
      { store, persistence: failingPersistence, now: 2000 },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("access boom");
  });

  it("memory_update returns ok:false when the supersedes relation fails to persist", () => {
    const store = new RuntimeMemoryStore({ now: () => 1000 });
    store.appendFact(makeFact("f1"));

    const relationFailingPersistence: RuntimeMemoryRuntimeIntegrationPort = {
      migrate: () => ({ status: "skipped", reason: "flag_disabled", migrated: false }),
      appendEpisode: () => ({
        status: "rejected",
        reason: "invalid_episode",
        message: "unused",
        persisted: false,
      }),
      appendFact: (fact) => ({
        status: "persisted",
        stored: true,
        duplicate: false,
        persisted: true,
        value: fact as never,
      }),
      invalidateFact: (proposal) => ({
        status: "persisted",
        stored: true,
        duplicate: false,
        persisted: true,
        value: proposal as never,
      }),
      persistRelation: () => ({
        status: "rejected",
        reason: "invalid_relation_type",
        message: "relation boom",
        persisted: false,
      }),
      recordFactAccess: () => ({
        status: "rejected",
        reason: "unknown_fact",
        message: "unused",
        persisted: false,
      }),
      loadStore: () => ({ status: "loaded", store }),
    };

    const result = executeMemorySelfEditTool(
      "memory_update",
      { factId: "f1", objectSummary: "x" },
      { store, persistence: relationFailingPersistence, now: 2000 },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("relation boom");
  });
});
