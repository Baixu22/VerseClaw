// @vitest-environment node
// P0-B: TF-0500 retires durable Runtime Memory persistence. These tests keep
// the self-edit persistence-failure contracts reachable through an explicit
// port while asserting configured persistence never reaches SQLite.

import { describe, expect, it } from "vitest";
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

const persistConfig = { runtime: { memory: { persist: true } } };

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

describe("P0-B: memory self-edit persistence retirement", () => {
  it("retires durable memory_update while preserving the disabled-write contract", async () => {
    let appendFactCalls = 0;
    let appendRelationCalls = 0;
    const store = new RuntimeMemoryStore({ now: () => 1000 });
    store.appendFact(makeFact("old_fact"));
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: persistConfig,
      persistence: {
        migrate: () => ({ status: "skipped", reason: "flag_disabled", migrated: false }),
        appendEpisode: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
        appendFact: () => {
          appendFactCalls += 1;
          throw new Error("retired persistence must not be reached");
        },
        invalidateFact: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
        persistRelation: () => {
          appendRelationCalls += 1;
          throw new Error("retired persistence must not be reached");
        },
        recordFactAccess: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
        loadStore: () => ({ status: "skipped", reason: "flag_disabled", store }),
      },
      now: () => 2000,
    });

    const result = await executeMemorySelfEditTool(
      "memory_update",
      { factId: "old_fact", objectSummary: "New summary.", confidence: 0.9 },
      { store, persistence: integration, now: 2000 },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("persistence skipped (flag_disabled)");
    expect({ appendFactCalls, appendRelationCalls }).toEqual({
      appendFactCalls: 0,
      appendRelationCalls: 0,
    });
    expect(store.getFactById("old_fact")?.objectSummary).toBe("Fact old_fact summary.");
    expect(store.listInvalidations()).toEqual([]);
  });

  it("retires durable memory_forget and leaves the store untouched", async () => {
    let invalidateCalls = 0;
    const store = new RuntimeMemoryStore({ now: () => 1000 });
    store.appendFact(makeFact("forget_me"));
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: persistConfig,
      persistence: {
        migrate: () => ({ status: "skipped", reason: "flag_disabled", migrated: false }),
        appendEpisode: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
        appendFact: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
        invalidateFact: () => {
          invalidateCalls += 1;
          throw new Error("retired persistence must not be reached");
        },
        persistRelation: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
        recordFactAccess: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
        loadStore: () => ({ status: "skipped", reason: "flag_disabled", store }),
      },
      now: () => 2000,
    });

    const result = await executeMemorySelfEditTool(
      "memory_forget",
      { factId: "forget_me", reason: "human_rejected" },
      { store, persistence: integration, now: 2000 },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("persistence skipped (flag_disabled)");
    expect(invalidateCalls).toBe(0);
    expect(store.getFactById("forget_me")).toBeDefined();
    expect(store.listInvalidations()).toEqual([]);
  });

  it("retires durable memory_strengthen while preserving the failure contract", async () => {
    let accessCalls = 0;
    const store = new RuntimeMemoryStore({ now: () => 1000 });
    store.appendFact(makeFact("hot_fact"));
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: persistConfig,
      persistence: {
        migrate: () => ({ status: "skipped", reason: "flag_disabled", migrated: false }),
        appendEpisode: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
        appendFact: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
        invalidateFact: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
        persistRelation: () => ({ status: "skipped", reason: "flag_disabled", persisted: false }),
        recordFactAccess: () => {
          accessCalls += 1;
          throw new Error("retired persistence must not be reached");
        },
        loadStore: () => ({ status: "skipped", reason: "flag_disabled", store }),
      },
      now: () => 2000,
    });

    const result = await executeMemorySelfEditTool(
      "memory_strengthen",
      { factId: "hot_fact" },
      { store, persistence: integration, now: 2000 },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("persistence skipped (flag_disabled)");
    expect(accessCalls).toBe(0);
    expect(store.getUsageStats()).toEqual([
      { factId: "hot_fact", count: 0, lastAccessedAt: undefined },
    ]);
  });

  it("memory_update returns ok:false when persistence rejects the write", async () => {
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
      loadStore: () => ({ status: "skipped", reason: "flag_disabled", store }),
    };

    const context: MemorySelfEditToolContext = {
      store,
      persistence: failingPersistence,
      now: 2000,
    };
    const result = await executeMemorySelfEditTool(
      "memory_update",
      { factId: "f1", objectSummary: "x" },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("boom");
  });

  it("memory_forget returns ok:false when persistence rejects the write", async () => {
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
      loadStore: () => ({ status: "skipped", reason: "flag_disabled", store }),
    };

    const context: MemorySelfEditToolContext = {
      store,
      persistence: failingPersistence,
      now: 2000,
    };
    const result = await executeMemorySelfEditTool(
      "memory_forget",
      { factId: "forget_me" },
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("forget failed");
  });

  it("memory_strengthen returns ok:false when persistence rejects the access", async () => {
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
      loadStore: () => ({ status: "skipped", reason: "flag_disabled", store }),
    };

    const result = await executeMemorySelfEditTool(
      "memory_strengthen",
      { factId: "f1" },
      { store, persistence: failingPersistence, now: 2000 },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("access boom");
  });

  it("memory_update returns ok:false when the supersedes relation fails to persist", async () => {
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
      loadStore: () => ({ status: "skipped", reason: "flag_disabled", store }),
    };

    const result = await executeMemorySelfEditTool(
      "memory_update",
      { factId: "f1", objectSummary: "x" },
      { store, persistence: relationFailingPersistence, now: 2000 },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("relation boom");
  });
});
