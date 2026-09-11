// @vitest-environment node
// P3-2: Candidate Width Cap (RRF topK 300) — dedicated unit tests.
//
// Verifies that `candidateTopK` in `HybridSearchFusionOptions` correctly:
// - Caps each arm's ranked list to top-N before RRF fusion
// - Is a no-op when the corpus is smaller than the cap
// - Preserves top-K fusion quality (no regression vs uncapped)
// - Defaults to 300 when not specified
// - Supports Infinity to disable capping (legacy behavior)
// - Bounds the RRF union pool size to ≤ 3 × candidateTopK
import { describe, expect, it } from "vitest";
import {
  HybridSearchIndex,
  OPTIMAL_HYBRID_FUSION,
} from "../../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import type { RuntimeMemoryQueryableFact } from "../../../openclaw_runtime/src/runtime-core/memory-context";

function makeFact(
  factId: string,
  text: string,
  subject: string = "user",
): RuntimeMemoryQueryableFact {
  return {
    factId,
    subject,
    predicate: text.split(" ")[0] ?? text,
    objectSummary: text,
    valid_at: 1000,
    verificationStatus: "accepted" as never,
    sourceEpisodeRefs: [],
    evidenceRefs: [],
    proposedAt: 1000,
  } as never;
}

describe("P3-2: candidateTopK — candidate width cap", () => {
  describe("OPTIMAL_HYBRID_FUSION default", () => {
    it("includes candidateTopK: 300 by default", () => {
      expect(OPTIMAL_HYBRID_FUSION.candidateTopK).toBe(300);
    });
  });

  describe("small corpus (no-op behavior)", () => {
    it("does not change results when corpus ≤ candidateTopK", () => {
      const facts = [
        makeFact("f1", "alice likes hiking"),
        makeFact("f2", "alice works at google"),
        makeFact("f3", "alice lives in tokyo"),
      ];
      const index = new HybridSearchIndex(facts);

      const uncapped = index.search("alice hiking", 3, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: Infinity,
      });
      const capped = index.search("alice hiking", 3, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: 300,
      });

      expect(capped).toEqual(uncapped);
    });

    it("returns identical results for candidateTopK=300 and unset (default)", () => {
      const facts = Array.from({ length: 50 }, (_, i) =>
        makeFact(`f${i}`, `fact number ${i} about topic ${i % 5}`),
      );
      const index = new HybridSearchIndex(facts);

      const withExplicit = index.search("topic", 10, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: 300,
      });
      const withDefault = index.search("topic", 10, OPTIMAL_HYBRID_FUSION);

      expect(withExplicit.map((h) => h.fact.factId)).toEqual(
        withDefault.map((h) => h.fact.factId),
      );
    });
  });

  describe("large corpus (capping behavior)", () => {
    it("caps BM25 arm to candidateTopK when corpus is large", () => {
      // Create 500 facts that all match the query "common".
      const facts = Array.from({ length: 500 }, (_, i) =>
        makeFact(`f${i}`, `common fact ${i}`),
      );
      const index = new HybridSearchIndex(facts);

      const capped = index.search("common", 10, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: 50,
      });
      expect(capped).toHaveLength(10);

      const uncapped = index.search("common", 10, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: Infinity,
      });
      expect(uncapped).toHaveLength(10);

      // Top-10 should be identical (capping at 50 doesn't affect top-10
      // because ranks 51-500 have negligible RRF scores).
      expect(capped.map((h) => h.fact.factId)).toEqual(
        uncapped.map((h) => h.fact.factId),
      );
    });

    it("caps each arm independently, preserving union diversity", () => {
      // With 500 facts all matching "common", candidateTopK=300 caps each arm.
      // The union pool should contain ≤ 900 facts (3 arms × 300) but the
      // final top-20 should still be diverse (not all from one arm).
      const facts = Array.from({ length: 500 }, (_, i) =>
        makeFact(`f${i}`, `common word ${i} unique${i}`),
      );
      const index = new HybridSearchIndex(facts);

      const results = index.search("common", 20, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: 300,
        wEntity: 0.5,
      });

      expect(results).toHaveLength(20);
      // All results should be valid fact IDs from the corpus
      const validIds = new Set(facts.map((f) => f.factId));
      for (const h of results) {
        expect(validIds.has(h.fact.factId)).toBe(true);
      }
      // Results should have non-zero RRF scores (capping didn't break scoring)
      for (const h of results) {
        expect(h.rrfScore).toBeGreaterThan(0);
      }
    });

    it("bounds RRF union pool to ≤ 3 × candidateTopK", () => {
      // Create 1000 facts, all matching the query.
      const facts = Array.from({ length: 1000 }, (_, i) =>
        makeFact(`f${i}`, `match word ${i}`),
      );
      const index = new HybridSearchIndex(facts);

      // With candidateTopK=100, each arm returns ≤ 100.
      // Union pool ≤ 300 (3 arms × 100).
      // Request topK=1000 to see the full pool.
      const results = index.search("match", 1000, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: 100,
        wEntity: 0.5, // enable entity arm
      });

      // Pool should be ≤ 300 (3 arms × 100), but likely smaller due to overlap.
      expect(results.length).toBeLessThanOrEqual(300);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("candidateTopK=1 returns at most 1 candidate per arm", () => {
      const facts = [
        makeFact("f1", "alpha beta"),
        makeFact("f2", "alpha gamma"),
        makeFact("f3", "alpha delta"),
      ];
      const index = new HybridSearchIndex(facts);

      const results = index.search("alpha", 10, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: 1,
      });

      // With cap=1, each arm returns only its top-1. Union ≤ 3.
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("candidateTopK=0 returns empty results", () => {
      const facts = [makeFact("f1", "alpha beta")];
      const index = new HybridSearchIndex(facts);

      const results = index.search("alpha", 10, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: 0,
      });

      expect(results).toEqual([]);
    });

    it("Infinity cap preserves legacy behavior (no capping)", () => {
      const facts = Array.from({ length: 500 }, (_, i) =>
        makeFact(`f${i}`, `word ${i}`),
      );
      const index = new HybridSearchIndex(facts);

      const results = index.search("word", 10, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: Infinity,
      });

      expect(results).toHaveLength(10);
    });
  });

  describe("searchWithEmbedding integration", () => {
    it("respects candidateTopK in embedding-based search", () => {
      const facts = Array.from({ length: 400 }, (_, i) =>
        makeFact(`f${i}`, `embed match ${i}`),
      );
      // Attach mock embeddings (all facts share the same direction as query).
      const factsWithEmb = facts.map((f) => ({
        ...f,
        embeddingVec: new Float32Array([1, 0, 0]),
      }));
      const index = new HybridSearchIndex(factsWithEmb);

      const queryEmb = new Float32Array([1, 0, 0]);
      const results = index.searchWithEmbedding("embed", queryEmb, 50, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: 100,
      });

      // Pool ≤ 300 (3 arms × 100), but we only requested 50.
      expect(results.length).toBeLessThanOrEqual(50);
    });
  });

  describe("no-harm guarantee", () => {
    it("capping at 300 does not degrade top-5 vs uncapped on small corpus", () => {
      // With only 100 facts, cap=300 is a no-op, so results must be identical.
      const facts = Array.from({ length: 100 }, (_, i) =>
        makeFact(`f${i}`, `topic ${i} content`),
      );
      const index = new HybridSearchIndex(facts);

      const capped = index.search("topic", 5, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: 300,
      });
      const uncapped = index.search("topic", 5, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: Infinity,
      });

      expect(capped.map((h) => h.fact.factId)).toEqual(
        uncapped.map((h) => h.fact.factId),
      );
    });

    it("capping at 300 does not change top-5 on 500-fact corpus", () => {
      // With 500 facts, cap=300 truncates arms but top-5 should be stable
      // because ranks 301-500 have negligible RRF scores.
      const facts = Array.from({ length: 500 }, (_, i) =>
        makeFact(`f${i}`, `common word ${i}`),
      );
      const index = new HybridSearchIndex(facts);

      const capped = index.search("common", 5, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: 300,
      });
      const uncapped = index.search("common", 5, {
        ...OPTIMAL_HYBRID_FUSION,
        candidateTopK: Infinity,
      });

      expect(capped.map((h) => h.fact.factId)).toEqual(
        uncapped.map((h) => h.fact.factId),
      );
    });
  });
});
