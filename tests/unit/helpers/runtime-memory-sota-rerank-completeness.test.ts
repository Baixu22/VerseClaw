// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applyFinalBoost,
  hasSiliconFlowRerankKey,
  rerankCandidates,
  rerankHybridHits,
  type RerankCandidate,
} from "./runtime-memory-cross-encoder-reranker";
import {
  aggregateCompleteness,
  computeContextCompletenessDeterministic,
} from "./runtime-memory-context-completeness";
import type { HybridSearchHit } from "../../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import type { RuntimeMemoryQueryableFact } from "../../../openclaw_runtime/src/runtime-core/memory-context";

describe("runtime memory cross-encoder reranker", () => {
  it("detects SiliconFlow rerank key availability", () => {
    const original = process.env.SILICONFLOW_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    expect(hasSiliconFlowRerankKey()).toBe(false);
    process.env.SILICONFLOW_API_KEY = "test-key";
    expect(hasSiliconFlowRerankKey()).toBe(true);
    if (original === undefined) {
      delete process.env.SILICONFLOW_API_KEY;
    } else {
      process.env.SILICONFLOW_API_KEY = original;
    }
  });

  it("returns no-op fallback when no API key", async () => {
    const original = process.env.SILICONFLOW_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    const candidates: RerankCandidate[] = [
      { id: "a", text: "Alice works as a nurse" },
      { id: "b", text: "Bob likes surfing" },
    ];
    const results = await rerankCandidates("What is Alice's job?", candidates);
    expect(results).toHaveLength(2);
    expect(results[0].originalIndex).toBe(0);
    expect(results[1].originalIndex).toBe(1);
    if (original === undefined) {
      delete process.env.SILICONFLOW_API_KEY;
    } else {
      process.env.SILICONFLOW_API_KEY = original;
    }
  });

  it("reranks hybrid hits when candidates exceed topK", async () => {
    // Build 15 fake hits, topK=5. With no API key, fallback preserves order.
    const original = process.env.SILICONFLOW_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    const hits: HybridSearchHit[] = Array.from({ length: 15 }, (_, i) => ({
      fact: {
        schemaVersion: 1 as const,
        factId: `f${i}`,
        subject: `subj${i}`,
        predicate: "is",
        objectSummary: `summary ${i}`,
        confidence: 0.9,
        source: "agent" as never,
        verificationStatus: "verified" as never,
        sourceEpisodeRefs: [],
        evidenceRefs: [],
        proposedAt: 0,
        valid_at: 0,
        reference_time: 0,
      } as unknown as RuntimeMemoryQueryableFact,
      rrfScore: 1 - i * 0.05,
      bm25Rank: null,
      vectorRank: null,
      entityRank: null,
      bm25Score: 0,
      vectorScore: 0,
      entityScore: 0,
    }));
    const reranked = await rerankHybridHits("query", hits, 5);
    expect(reranked).toHaveLength(5);
    if (original === undefined) {
      delete process.env.SILICONFLOW_API_KEY;
    } else {
      process.env.SILICONFLOW_API_KEY = original;
    }
  });

  it("skips rerank when hits <= topK", async () => {
    const hits: HybridSearchHit[] = Array.from({ length: 3 }, (_, i) => ({
      fact: {
        schemaVersion: 1 as const,
        factId: `f${i}`,
        subject: `s${i}`,
        predicate: "p",
        objectSummary: `o${i}`,
        confidence: 0.9,
        source: "agent" as never,
        verificationStatus: "verified" as never,
        sourceEpisodeRefs: [],
        evidenceRefs: [],
        proposedAt: 0,
        valid_at: 0,
        reference_time: 0,
      } as unknown as RuntimeMemoryQueryableFact,
      rrfScore: 0.5,
      bm25Rank: null,
      vectorRank: null,
      entityRank: null,
      bm25Score: 0,
      vectorScore: 0,
      entityScore: 0,
    }));
    const reranked = await rerankHybridHits("q", hits, 10);
    expect(reranked).toHaveLength(3);
  });

  it("applies final boost with recency, temporal, and proof count", () => {
    const now = Date.UTC(2024, 0, 1);
    const recentFact = {
      fact: {
        schemaVersion: 1 as const,
        factId: "recent",
        subject: "Alice",
        predicate: "job",
        objectSummary: "nurse",
        confidence: 0.9,
        source: "agent" as never,
        verificationStatus: "verified" as never,
        sourceEpisodeRefs: [],
        evidenceRefs: [{ kind: "tool_result" as never, ref: "x" as never }],
        proposedAt: now,
        valid_at: now - 1000,
        reference_time: now,
      } as unknown as RuntimeMemoryQueryableFact,
      rrfScore: 0.9,
      bm25Rank: null,
      vectorRank: null,
      entityRank: null,
      bm25Score: 0,
      vectorScore: 0,
      entityScore: 0,
    };
    const oldFact = {
      fact: {
        ...recentFact.fact,
        factId: "old",
        valid_at: now - 365 * 24 * 60 * 60 * 1000 * 5,
        evidenceRefs: [],
      } as unknown as RuntimeMemoryQueryableFact,
      rrfScore: 0.9,
      bm25Rank: null,
      vectorRank: null,
      entityRank: null,
      bm25Score: 0,
      vectorScore: 0,
      entityScore: 0,
    };
    const boosted = applyFinalBoost([recentFact, oldFact], now);
    expect(boosted[0].fact.factId).toBe("recent");
    expect(boosted[0].rrfScore).toBeGreaterThan(boosted[1].rrfScore);
  });

  it("returns original hits when referenceTime is undefined", () => {
    const hits: HybridSearchHit[] = [
      {
        fact: {} as RuntimeMemoryQueryableFact,
        rrfScore: 0.5,
        bm25Rank: null,
        vectorRank: null,
        entityRank: null,
        bm25Score: 0,
        vectorScore: 0,
        entityScore: 0,
      },
    ];
    const boosted = applyFinalBoost(hits, undefined);
    expect(boosted).toHaveLength(1);
    expect(boosted[0].rrfScore).toBe(0.5);
  });
});

describe("runtime memory context completeness", () => {
  it("returns COMPLETE when all evidence is covered", () => {
    const result = computeContextCompletenessDeterministic(
      "Alice works as a nurse at City Hospital and started surfing in March 2018.",
      [
        "Alice works as a nurse",
        "Alice started surfing in March 2018",
      ],
    );
    expect(result.level).toBe("COMPLETE");
    expect(result.coverage).toBe(1);
    expect(result.matchedEvidence).toHaveLength(2);
    expect(result.missingEvidence).toHaveLength(0);
  });

  it("returns INSUFFICIENT when no evidence is covered", () => {
    const result = computeContextCompletenessDeterministic(
      "Bob likes pizza and lives in Paris.",
      ["Alice works as a nurse at City Hospital"],
    );
    expect(result.level).toBe("INSUFFICIENT");
    expect(result.coverage).toBe(0);
    expect(result.missingEvidence).toHaveLength(1);
  });

  it("returns PARTIAL when half of evidence is covered", () => {
    const result = computeContextCompletenessDeterministic(
      "Alice works as a nurse.",
      [
        "Alice works as a nurse",
        "Alice started surfing in March 2018",
      ],
    );
    expect(result.coverage).toBe(0.5);
    expect(result.level).toBe("PARTIAL");
  });

  it("returns COMPLETE when evidence array is empty", () => {
    const result = computeContextCompletenessDeterministic("context", []);
    expect(result.level).toBe("COMPLETE");
  });

  it("aggregates completeness by category", () => {
    const results = [
      { level: "COMPLETE" as const, category: "single_hop" },
      { level: "INSUFFICIENT" as const, category: "multi_hop" },
      { level: "PARTIAL" as const, category: "multi_hop" },
      { level: "COMPLETE" as const, category: "single_hop" },
    ];
    const aggregated = aggregateCompleteness(results);
    expect(aggregated.overall.COMPLETE).toBe(2);
    expect(aggregated.overall.PARTIAL).toBe(1);
    expect(aggregated.overall.INSUFFICIENT).toBe(1);
    expect(aggregated.byCategory.single_hop?.COMPLETE).toBe(2);
    expect(aggregated.byCategory.multi_hop?.INSUFFICIENT).toBe(1);
  });
});
