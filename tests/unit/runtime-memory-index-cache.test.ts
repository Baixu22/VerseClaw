// @vitest-environment node
// Phase 1.2: HybridSearchIndex LRU cache unit tests.
// Validates that repeated calls to hybridSearchFacts with the same fact corpus
// reuse a cached index instead of rebuilding, and that the cache invalidates
// correctly when the fact set changes.

import { describe, expect, it, beforeEach } from "vitest";
import {
  hybridSearchFacts,
  clearHybridSearchIndexCache,
  getHybridSearchIndexCacheStats,
  type HybridSearchQuery,
} from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

function makeFact(
  id: string,
  subject: string,
  objectSummary: string,
  overrides: Partial<RuntimeMemoryTemporalFact> = {},
): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject,
    predicate: "has",
    objectSummary,
    confidence: 0.8,
    source: "tool_result",
    verificationStatus: "verified",
    valid_at: 100,
    reference_time: 100,
    ...overrides,
  });
}

describe("Phase 1.2: HybridSearchIndex LRU cache", () => {
  beforeEach(() => {
    clearHybridSearchIndexCache();
  });

  it("first call builds index (cache miss), second call reuses (cache hit)", () => {
    const facts = [
      makeFact("f1", "User", "prefers dark theme"),
      makeFact("f2", "User", "prefers TypeScript"),
      makeFact("f3", "Project", "uses React 19"),
    ];
    const query: HybridSearchQuery = { queryText: "dark theme", topK: 5 };

    const results1 = hybridSearchFacts(facts, query);
    const stats1 = getHybridSearchIndexCacheStats();
    expect(stats1.size).toBe(1);

    const results2 = hybridSearchFacts(facts, query);
    const stats2 = getHybridSearchIndexCacheStats();
    expect(stats2.size).toBe(1);

    expect(results1).toEqual(results2);
  });

  it("different fact sets produce different cache entries", () => {
    const factsA = [makeFact("a1", "User", "likes coffee")];
    const factsB = [makeFact("b1", "User", "likes tea")];
    const query: HybridSearchQuery = { queryText: "likes", topK: 5 };

    hybridSearchFacts(factsA, query);
    expect(getHybridSearchIndexCacheStats().size).toBe(1);

    hybridSearchFacts(factsB, query);
    expect(getHybridSearchIndexCacheStats().size).toBe(2);
  });

  it("same fact IDs but different valid_at creates new cache entry", () => {
    const factsV1 = [makeFact("f1", "User", "prefers dark", { valid_at: 100 })];
    const factsV2 = [makeFact("f1", "User", "prefers dark", { valid_at: 200 })];
    const query: HybridSearchQuery = { queryText: "dark", topK: 5 };

    hybridSearchFacts(factsV1, query);
    expect(getHybridSearchIndexCacheStats().size).toBe(1);

    hybridSearchFacts(factsV2, query);
    expect(getHybridSearchIndexCacheStats().size).toBe(2);
  });

  it("LRU eviction when cache exceeds max size (16)", () => {
    const query: HybridSearchQuery = { queryText: "test", topK: 1 };

    for (let i = 0; i < 18; i++) {
      const facts = [makeFact(`f${i}`, "User", `fact ${i}`)];
      hybridSearchFacts(facts, query);
    }

    const stats = getHybridSearchIndexCacheStats();
    expect(stats.size).toBe(stats.maxSize);
    expect(stats.maxSize).toBe(16);
  });

  it("clearHybridSearchIndexCache empties the cache", () => {
    const facts = [makeFact("f1", "User", "test")];
    hybridSearchFacts(facts, { queryText: "test", topK: 1 });
    expect(getHybridSearchIndexCacheStats().size).toBe(1);

    clearHybridSearchIndexCache();
    expect(getHybridSearchIndexCacheStats().size).toBe(0);
  });

  it("different pre-filters (subject) produce different cache entries", () => {
    const facts = [
      makeFact("f1", "User", "likes coffee"),
      makeFact("f2", "Project", "uses React"),
    ];

    hybridSearchFacts(facts, { queryText: "coffee", subject: "User", topK: 5 });
    expect(getHybridSearchIndexCacheStats().size).toBe(1);

    hybridSearchFacts(facts, { queryText: "React", subject: "Project", topK: 5 });
    expect(getHybridSearchIndexCacheStats().size).toBe(2);
  });

  it("empty query returns empty without caching", () => {
    const facts = [makeFact("f1", "User", "test")];
    const result = hybridSearchFacts(facts, { queryText: "", topK: 5 });
    expect(result).toEqual([]);
    expect(getHybridSearchIndexCacheStats().size).toBe(0);
  });
});
