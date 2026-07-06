import { describe, expect, it } from "vitest";
import {
  chainedRetrievalExpand,
  extractFactEntities,
} from "../../openclaw_runtime/src/runtime-core/memory-chained-retrieval";
import type { HybridSearchHit } from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import type { RuntimeMemoryQueryableFact } from "../../openclaw_runtime/src/runtime-core/memory-context";
import { buildRuntimeMemoryTemporalFactFixture } from "../../openclaw_runtime/src/runtime-core";

function makeHit(factId: string, score: number, subject: string): HybridSearchHit {
  return {
    fact: buildRuntimeMemoryTemporalFactFixture({
      factId,
      subject,
      objectSummary: `${subject} detail`,
    }),
    rrfScore: score,
    bm25Rank: 1,
    vectorRank: 1,
    entityRank: null,
    bm25Score: score,
    vectorScore: score,
    entityScore: 0,
  };
}

describe("memory-chained-retrieval", () => {
  describe("chainedRetrievalExpand", () => {
    it("returns initial hits unchanged when no relations exist", () => {
      const hits = [makeHit("f1", 0.9, "Alice")];
      const relationMap = new Map<string, string[]>();
      const factsById = new Map<string, RuntimeMemoryQueryableFact>();
      const result = chainedRetrievalExpand(hits, relationMap, factsById);
      expect(result.expanded).toBe(false);
      expect(result.relatedFactCount).toBe(0);
      expect(result.hits).toHaveLength(1);
    });

    it("expands with related facts when relations exist", () => {
      const hits = [makeHit("f1", 0.9, "Alice")];
      const relationMap = new Map<string, string[]>([["f1", ["f2", "f3"]]]);
      const factsById = new Map<string, RuntimeMemoryQueryableFact>([
        ["f2", buildRuntimeMemoryTemporalFactFixture({ factId: "f2", subject: "Alice", objectSummary: "works at hospital" })],
        ["f3", buildRuntimeMemoryTemporalFactFixture({ factId: "f3", subject: "Alice", objectSummary: "likes gardening" })],
      ]);
      const result = chainedRetrievalExpand(hits, relationMap, factsById);
      expect(result.expanded).toBe(true);
      expect(result.relatedFactCount).toBe(2);
      expect(result.hits.length).toBe(3);
    });

    it("does not duplicate facts already in initial hits", () => {
      const hits = [makeHit("f1", 0.9, "Alice"), makeHit("f2", 0.8, "Alice")];
      const relationMap = new Map<string, string[]>([
        ["f1", ["f2", "f3"]],
        ["f2", ["f1"]],
      ]);
      const factsById = new Map<string, RuntimeMemoryQueryableFact>([
        ["f3", buildRuntimeMemoryTemporalFactFixture({ factId: "f3", subject: "Bob", objectSummary: "knows Alice" })],
      ]);
      const result = chainedRetrievalExpand(hits, relationMap, factsById);
      const factIds = result.hits.map((h) => h.fact.factId);
      expect(factIds).toContain("f1");
      expect(factIds).toContain("f2");
      expect(factIds).toContain("f3");
      expect(new Set(factIds).size).toBe(factIds.length);
    });

    it("respects maxExpansion limit", () => {
      const hits = [makeHit("f1", 0.9, "Alice")];
      const relationMap = new Map<string, string[]>([
        ["f1", ["f2", "f3", "f4", "f5", "f6"]],
      ]);
      const factsById = new Map<string, RuntimeMemoryQueryableFact>();
      for (let i = 2; i <= 6; i++) {
        factsById.set(`f${i}`, buildRuntimeMemoryTemporalFactFixture({ factId: `f${i}`, subject: "Alice", objectSummary: `detail ${i}` }));
      }
      const result = chainedRetrievalExpand(hits, relationMap, factsById, { maxExpansion: 2 });
      expect(result.hits.length).toBe(3);
    });

    it("returns empty hits unchanged", () => {
      const result = chainedRetrievalExpand([], new Map(), new Map());
      expect(result.hits).toHaveLength(0);
      expect(result.expanded).toBe(false);
    });

    it("sorts merged hits by score descending", () => {
      const hits = [makeHit("f1", 0.5, "Alice")];
      const relationMap = new Map<string, string[]>([["f1", ["f2"]]]);
      const factsById = new Map<string, RuntimeMemoryQueryableFact>([
        ["f2", buildRuntimeMemoryTemporalFactFixture({ factId: "f2", subject: "Alice", objectSummary: "detail" })],
      ]);
      const result = chainedRetrievalExpand(hits, relationMap, factsById);
      expect(result.hits[0].rrfScore).toBeGreaterThanOrEqual(result.hits[1].rrfScore);
    });
  });

  describe("extractFactEntities", () => {
    it("extracts entities from fact text", () => {
      const facts = [
        buildRuntimeMemoryTemporalFactFixture({ factId: "f1", subject: "Alice", objectSummary: "works at Seattle General Hospital" }),
      ];
      const entities = extractFactEntities(facts);
      expect(entities.size).toBeGreaterThan(0);
    });

    it("returns empty set for empty facts array", () => {
      const entities = extractFactEntities([]);
      expect(entities.size).toBe(0);
    });
  });
});
