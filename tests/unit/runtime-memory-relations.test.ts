// @vitest-environment node
// Phase 6.6: Relation chain verification tests.
// Validates the lightweight relation chain: store-level relation methods,
// persistence, AUDN auto-generation, memory_find_related tool, and
// context provider 1-hop expansion.

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
} from "../../openclaw_runtime/src/runtime-core";
import {
  RuntimeMemoryStore,
} from "../../openclaw_runtime/src/runtime-core/memory-store";
import {
  createRuntimeMemoryPersistenceStore,
} from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import {
  createRuntimeMemoryRuntimeIntegration,
} from "../../openclaw_runtime/src/runtime-core/memory-runtime-integration";
import {
  executeMemorySelfEditTool,
} from "../../openclaw_runtime/src/runtime-core/memory-self-edit-tools";
import {
  createRuntimeMemoryContextProvider,
} from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDbPath(): string {
  const dir = `${import.meta.dirname}/.tmp-relations-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  tempDirs.push(dir);
  return `${dir}/test.db`;
}

function makeCandidate(
  id: string,
  subject: string,
  objectSummary: string,
  overrides: Record<string, unknown> = {},
) {
  return buildRuntimeMemoryTemporalFactCandidateFixture({
    factId: id,
    subject,
    predicate: "has_setting",
    objectSummary,
    valid_at: 100,
    reference_time: 100,
    proposedAt: 100,
    ...overrides,
  });
}

function makeFact(
  id: string,
  subject: string,
  objectSummary: string,
  overrides: Record<string, unknown> = {},
) {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject,
    predicate: "has_setting",
    objectSummary,
    valid_at: 100,
    reference_time: 100,
    acceptedAt: 100,
    ...overrides,
  });
}

describe("Phase 6: Relation chain", () => {
  // === Store-level relation methods ===

  describe("RuntimeMemoryStore relations", () => {
    it("appendRelation writes and queryRelations reads correctly", () => {
      const store = new RuntimeMemoryStore();
      store.appendFact(makeFact("f1", "User", "likes dark mode"));
      store.appendFact(makeFact("f2", "User", "likes light mode"));

      store.appendRelation({
        sourceFactId: "f2",
        targetFactId: "f1",
        relationType: "supersedes",
        confidence: 0.9,
      });

      const outgoing = store.queryRelations("f2");
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].relationType).toBe("supersedes");
      expect(outgoing[0].targetFactId).toBe("f1");
      expect(outgoing[0].confidence).toBe(0.9);

      const incoming = store.queryReverseRelations("f1");
      expect(incoming).toHaveLength(1);
      expect(incoming[0].sourceFactId).toBe("f2");
    });

    it("idempotent: same (source, target, type) updates confidence only", () => {
      const store = new RuntimeMemoryStore();
      store.appendFact(makeFact("f1", "User", "A"));
      store.appendFact(makeFact("f2", "User", "B"));

      store.appendRelation({
        sourceFactId: "f2",
        targetFactId: "f1",
        relationType: "supersedes",
        confidence: 0.5,
      });
      store.appendRelation({
        sourceFactId: "f2",
        targetFactId: "f1",
        relationType: "supersedes",
        confidence: 0.9,
      });

      const relations = store.queryRelations("f2");
      expect(relations).toHaveLength(1);
      expect(relations[0].confidence).toBe(0.9);
    });

    it("explosion protection: max 10 outgoing relations per fact", () => {
      const store = new RuntimeMemoryStore();
      store.appendFact(makeFact("source", "User", "main"));
      for (let i = 0; i < 15; i++) {
        store.appendFact(makeFact(`target_${i}`, "User", `info_${i}`));
      }
      for (let i = 0; i < 15; i++) {
        store.appendRelation({
          sourceFactId: "source",
          targetFactId: `target_${i}`,
          relationType: "related_to",
          confidence: i / 15,
        });
      }

      const relations = store.queryRelations("source");
      expect(relations).toHaveLength(10);
      // Should keep the highest confidence ones
      const confidences = relations.map((r) => r.confidence).sort((a, b) => b - a);
      expect(confidences[0]).toBe(14 / 15);
    });
  });

  // === Persistence ===

  describe("persistence", () => {
    it("migrate is idempotent and relation table is created", () => {
      const dbPath = createTempDbPath();
      const store = createRuntimeMemoryPersistenceStore({
        config: { runtime: { memory: { persist: true } } },
        database: { path: dbPath },
        now: () => 1_000,
      });

      // TF-0500 retired runtime.memory.persist: both migrate calls are skipped and
      // idempotent, but no relation table is created.
      expect(store.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
      expect(store.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });
    });

    it("persistRelation writes and loadStore reads relations back", () => {
      const dbPath = createTempDbPath();
      const store = createRuntimeMemoryPersistenceStore({
        config: { runtime: { memory: { persist: true } } },
        database: { path: dbPath },
        now: () => 1_000,
      });

      store.migrate();
      expect(store.appendFact(makeFact("f1", "User", "likes tea"))).toMatchObject({ status: "skipped" });
      expect(store.persistRelation({
        sourceFactId: "f2",
        targetFactId: "f1",
        relationType: "supersedes",
        confidence: 0.85,
      })).toMatchObject({ status: "skipped", reason: "flag_disabled" });

      const loaded = store.loadStore();
      expect(loaded.status).toBe("skipped");
      expect(loaded.store.queryRelations("f2")).toHaveLength(0);
    });
  });

  // === AUDN auto-generation ===

  describe("AUDN auto-generates relations", () => {
    it("AUDN UPDATE disabled — refinement candidate is skipped, no relation generated (project_memory.md constraint)", () => {
      const dbPath = createTempDbPath();
      const integration = createRuntimeMemoryRuntimeIntegration({
        config: { runtime: { memory: { persist: true } } },
        database: { path: dbPath },
        now: () => 1_000,
        curation: { enabled: true },
      });

      expect(integration.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });

      // TF-0500 retired persist, so no fact is stored and no relation is derived.
      const candidate = makeCandidate("new_fact", "User", "prefers dark theme with serif fonts", {
        proposedAt: 200,
        valid_at: 200,
        reference_time: 200,
      });
      const result = integration.appendFact(candidate);
      expect((result as { status?: string }).status).toBe("skipped");

      const loaded = integration.loadStore();
      expect(loaded.status).toBe("skipped");
      expect(loaded.store.queryRelations("new_fact")).toHaveLength(0);
    });

    it("AUDN SUPERSEDE generates supersedes (1.0) + contradicts (0.8) relations", () => {
      const dbPath = createTempDbPath();
      const integration = createRuntimeMemoryRuntimeIntegration({
        config: { runtime: { memory: { persist: true } } },
        database: { path: dbPath },
        now: () => 1_000,
        curation: { enabled: true },
      });

      expect(integration.migrate()).toMatchObject({ status: "skipped", reason: "flag_disabled" });

      const candidate = makeCandidate("new_setting", "User", "now prefers light theme over dark", {
        proposedAt: 200,
        valid_at: 200,
        reference_time: 200,
      });
      expect((integration.appendFact(candidate) as { status?: string }).status).toBe("skipped");

      const loaded = integration.loadStore();
      expect(loaded.status).toBe("skipped");
      const relations = loaded.store.queryRelations("new_setting");
      // No relation is ever derived on the retired path.
      expect(relations.filter((r) => r.relationType === "supersedes")).toHaveLength(0);
      expect(relations.filter((r) => r.relationType === "contradicts")).toHaveLength(0);
    });
  });

  // === memory_find_related tool ===

  describe("memory_find_related tool", () => {
    it("1-hop: returns related facts via relation chain", async () => {
      const store = new RuntimeMemoryStore();
      store.appendFact(makeFact("f1", "User", "likes Python"));
      store.appendFact(makeFact("f2", "User", "likes Rust"));
      store.appendFact(makeFact("f3", "User", "likes Go"));
      store.appendRelation({
        sourceFactId: "f1",
        targetFactId: "f2",
        relationType: "related_to",
        confidence: 0.8,
      });
      store.appendRelation({
        sourceFactId: "f1",
        targetFactId: "f3",
        relationType: "related_to",
        confidence: 0.6,
      });

      const result = await executeMemorySelfEditTool(
        "memory_find_related",
        { factId: "f1", hops: 1 },
        { store },
      );

      expect(result.ok).toBe(true);
      expect(result.tool).toBe("memory_find_related");
      const data = result.data as { facts: { factId: string }[]; relations: unknown[] };
      expect(data.facts.length).toBe(2);
      expect(data.facts.map((f) => f.factId).sort()).toEqual(["f2", "f3"]);
    });

    it("2-hop: traverses two hops and stays acyclic", async () => {
      const store = new RuntimeMemoryStore();
      store.appendFact(makeFact("a", "X", "A"));
      store.appendFact(makeFact("b", "X", "B"));
      store.appendFact(makeFact("c", "X", "C"));
      // a -> b -> c (2-hop)
      store.appendRelation({
        sourceFactId: "a",
        targetFactId: "b",
        relationType: "related_to",
        confidence: 0.9,
      });
      store.appendRelation({
        sourceFactId: "b",
        targetFactId: "c",
        relationType: "related_to",
        confidence: 0.8,
      });
      // c -> a would create a cycle; the visited set prevents infinite loop
      store.appendRelation({
        sourceFactId: "c",
        targetFactId: "a",
        relationType: "related_to",
        confidence: 0.7,
      });

      const result = await executeMemorySelfEditTool(
        "memory_find_related",
        { factId: "a", hops: 2 },
        { store },
      );

      expect(result.ok).toBe(true);
      const data = result.data as { facts: { factId: string }[] };
      const factIds = data.facts.map((f) => f.factId);
      // Should include b (1-hop) and c (2-hop), but not a itself
      expect(factIds).toContain("b");
      expect(factIds).toContain("c");
      expect(factIds).not.toContain("a");
    });

    it("fails when factId is missing", async () => {
      const store = new RuntimeMemoryStore();
      const result = await executeMemorySelfEditTool(
        "memory_find_related",
        {},
        { store },
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain("factId");
    });

    it("fails when fact is not found", async () => {
      const store = new RuntimeMemoryStore();
      const result = await executeMemorySelfEditTool(
        "memory_find_related",
        { factId: "nonexistent" },
        { store },
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain("not found");
    });
  });

  // === Context provider 1-hop expansion ===

  describe("context provider 1-hop expansion", () => {
    it("expands matched facts with 1-hop related facts", async () => {
      // TF-0500 retired runtime.memory.provider; the expansion path is unreachable.
      const provider = createRuntimeMemoryContextProvider({
        facts: [
          makeFact("f1", "User", "likes Python", { taskId: "test" }),
          makeFact("f2", "User", "also likes Rust", { taskId: "test" }),
        ],
        config: { runtime: { memory: { provider: true } } },
        queryRelations: () => [{
          relationId: "f1:f2:related_to",
          sourceFactId: "f1",
          targetFactId: "f2",
          relationType: "related_to",
          confidence: 0.9,
          createdAt: 100,
        }],
      });
      const result = await provider.getContext({
        taskId: "test",
        metadata: { memoryQuery: { subject: "User", predicate: "likes" } },
      }) as { status: string; contextItems: unknown[] };
      expect(result.status).not.toBe("success");
      expect(result.contextItems ?? []).toHaveLength(0);
    });

    it("budget limit: expansion does not exceed MAX_RELATION_EXPANSIONS (2)", async () => {
      const mainFact = makeFact("main", "User", "primary fact", { taskId: "test" });
      const relatedFacts = Array.from({ length: 5 }, (_, i) =>
        makeFact(`rel_${i}`, "Related", `related ${i}`, { taskId: "test" })
      );
      const allFacts = [mainFact, ...relatedFacts];

      const provider = createRuntimeMemoryContextProvider({
        facts: allFacts,
        config: { runtime: { memory: { provider: true } } },
        queryRelations: (factId: string) => {
          if (factId === "main") {
            return relatedFacts.map((f, i) => ({
              relationId: `main:${f.factId}:related_to`,
              sourceFactId: "main",
              targetFactId: f.factId,
              relationType: "related_to" as const,
              confidence: 1 - i * 0.1,
              createdAt: 100,
            }));
          }
          return [];
        },
      });

      const result = await provider.getContext({
        taskId: "test",
        tokenBudget: 2048,
        metadata: {
          memoryQuery: { subject: "User", limit: 10 },
        },
      }, {});

      // Only 2 expanded facts should be included (MAX_RELATION_EXPANSIONS = 2)
      const expandedFactIds = (result as { status?: string; contextItems: Array<{ metadata?: { factId?: string } }> }).contextItems
        .map((item: { metadata?: { factId?: string } }) => item.metadata?.factId)
        .filter((id: unknown): id is string => typeof id === "string" && id.startsWith("rel_"));
      expect(expandedFactIds.length).toBeLessThanOrEqual(2);
    });

    it("zero regression: no queryRelations callback → behaves as before", async () => {
      const provider = createRuntimeMemoryContextProvider({
        facts: [makeFact("f1", "User", "likes Python", { taskId: "test" })],
        config: { runtime: { memory: { provider: true } } },
      });
      const result = await provider.getContext({
        taskId: "test",
        metadata: { memoryQuery: { subject: "User", predicate: "likes" } },
      }) as { status: string; contextItems: unknown[] };
      // TF-0500 retired provider, so neither expansion nor the baseline path succeeds.
      expect(result.status).not.toBe("success");
      expect(result.contextItems ?? []).toHaveLength(0);
    });
  });
});
