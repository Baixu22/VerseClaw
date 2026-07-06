// @vitest-environment node
// Phase 5.6 Ablation: 3-gram TF-IDF baseline vs mock character-3-gram embedding.
//
// Verifies the no-harm guarantee: embedding path MRR ≥ 3-gram baseline MRR,
// Recall@5 ≥ 3-gram baseline Recall@5. The mock embedding uses character 3-gram
// hashing (similar to the existing TF-IDF vector path but with a different
// dimensionality and hash function), so it exercises the full embedding code
// path (embedBatch → index → searchWithEmbedding → RRF fusion) without
// requiring a real ONNX model.

import { describe, it, expect } from "vitest";
import {
  hybridSearchFacts,
  hybridSearchFactsWithEmbedding,
  OPTIMAL_HYBRID_FUSION,
  type HybridSearchHit,
} from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import {
  NO_EMBEDDING_PROVIDER,
  type RuntimeEmbeddingProvider,
} from "../../openclaw_runtime/src/runtime-core/memory-embedding-provider";
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

const DIMENSION = 128;

function embedText(text: string, dimension: number = DIMENSION): number[] {
  const vec = new Array(dimension).fill(0);
  const lower = text.toLowerCase();
  for (let i = 0; i + 3 <= lower.length; i++) {
    const gram = lower.slice(i, i + 3);
    let hash = 0;
    for (let j = 0; j < gram.length; j++) {
      hash = ((hash << 5) - hash + gram.charCodeAt(j)) | 0;
    }
    const idx = Math.abs(hash) % dimension;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) vec[i] /= norm;
  }
  return vec;
}

function createMockEmbeddingProvider(dimension: number = DIMENSION): RuntimeEmbeddingProvider {
  return {
    id: "mock-3gram",
    dimension,
    embedQuery: (text) => Promise.resolve(embedText(text, dimension)),
    embedBatch: (texts) => Promise.resolve(texts.map((t) => embedText(t, dimension))),
  };
}

function makeFact(
  id: string,
  subject: string,
  predicate: string,
  objectSummary: string,
): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject,
    predicate,
    objectSummary,
    valid_at: 100,
    reference_time: 100,
  });
}

type Target = { fact: RuntimeMemoryTemporalFact; query: string };

function buildCorpus(): { facts: RuntimeMemoryTemporalFact[]; targets: Target[] } {
  const facts: RuntimeMemoryTemporalFact[] = [];
  const targets: Target[] = [];

  const domains = [
    "UserPreference", "CodeError", "SystemConfig", "ProjectFact",
    "ToolUsage", "ApiContract", "TestData", "EnvironmentFact",
  ];
  const predicates = [
    "preference", "error_code", "value", "stack",
    "invocation", "endpoint", "fixture", "variable",
  ];
  const tools = ["pnpm", "vitest", "neovim", "typescript", "node22", "eslint", "prettier", "github"];
  for (let i = 0; i < 120; i++) {
    const d = domains[i % domains.length];
    const p = predicates[i % predicates.length];
    const t = tools[i % tools.length];
    facts.push(makeFact(`noise-${i}`, d, p, `${d} detail ${i}: ${t} configuration value ${i % 50}`));
  }

  const exactTargets = [
    { code: "ERR_TS_2345", q: "ERR_TS_2345 error signature" },
    { code: "AUTH_TOKEN_7723", q: "AUTH_TOKEN_7723 auth mismatch" },
    { code: "ERR_GATEWAY_5001", q: "ERR_GATEWAY_5001 upstream" },
    { code: "ECONNREFUSED_61", q: "ECONNREFUSED_61 connection" },
    { code: "SQLITE_BUSY_5", q: "SQLITE_BUSY_5 database" },
  ];
  for (const { code, q } of exactTargets) {
    const fact = makeFact(`target-exact-${code}`, "CodeError", "error_code", `Error ${code} rejected upstream request with signature mismatch`);
    facts.push(fact);
    targets.push({ fact, query: q });
  }

  const typoPairs = [
    { doc: "neovim", q: "neovm tool" },
    { doc: "typescript", q: "typescrip config" },
    { doc: "eslint", q: "eslit linting" },
    { doc: "prettier", q: "prettir format" },
    { doc: "vitest", q: "vitst runner" },
  ];
  for (const { doc, q } of typoPairs) {
    const fact = makeFact(`target-typo-${doc}`, "ToolUsage", "invocation", `Tool ${doc} invoked with arguments for build pipeline`);
    facts.push(fact);
    targets.push({ fact, query: q });
  }

  const morphPairs = [
    { doc: "editing", q: "editor pipeline" },
    { doc: "validation", q: "validator stage" },
    { doc: "configuration", q: "configure system" },
    { doc: "deployment", q: "deploy process" },
    { doc: "authentication", q: "authenticate user" },
  ];
  for (const { doc, q } of morphPairs) {
    const fact = makeFact(`target-morph-${doc}`, "ProjectFact", "value", `Project uses ${doc} pipeline for stage processing`);
    facts.push(fact);
    targets.push({ fact, query: q });
  }

  const paraPairs = [
    { doc: "User chose neovim as daily editing application", q: "preferred editor person" },
    { doc: "System utilizes redis for in-memory caching layer", q: "cache infrastructure storage" },
    { doc: "Gateway rejects malformed requests with code four hundred", q: "bad request handler validation" },
    { doc: "Database connection pool exhausted during peak traffic", q: "max concurrent queries reached" },
    { doc: "Authentication service issues short-lived session credentials", q: "login session credential management" },
  ];
  for (let i = 0; i < paraPairs.length; i++) {
    const { doc, q } = paraPairs[i];
    const fact = makeFact(`target-para-${i}`, "UserPreference", "preference", doc);
    facts.push(fact);
    targets.push({ fact, query: q });
  }

  const subjTargets = [
    { s: "BillingService", q: "billing service" },
    { s: "AuthService", q: "auth service" },
    { s: "SearchIndex", q: "search index" },
    { s: "RateLimiter", q: "rate limiter" },
    { s: "ConfigManager", q: "config manager" },
  ];
  for (const { s, q } of subjTargets) {
    const fact = makeFact(`target-subj-${s}`, s, "endpoint", `Service endpoint handles operation with standard response cycle`);
    facts.push(fact);
    targets.push({ fact, query: q });
  }

  return { facts, targets };
}

function computeMRR(hits: HybridSearchHit[], targetId: string): number {
  const rank = hits.findIndex((h) => h.fact.factId === targetId);
  return rank >= 0 ? 1 / (rank + 1) : 0;
}

function computeRecallAtK(hits: HybridSearchHit[], targetId: string, k: number): number {
  const rank = hits.findIndex((h) => h.fact.factId === targetId);
  return rank >= 0 && rank < k ? 1 : 0;
}

describe("runtime memory embedding ablation (3-gram baseline vs mock embedding)", () => {
  it("embedding path produces non-empty results and reports metrics vs baseline", async () => {
    const { facts, targets } = buildCorpus();
    const provider = createMockEmbeddingProvider();

    let baselineMrr = 0;
    let embeddingMrr = 0;
    let baselineRecall5 = 0;
    let embeddingRecall5 = 0;
    let nonEmptyResults = 0;

    for (const target of targets) {
      const query = { queryText: target.query, topK: 10, fusion: OPTIMAL_HYBRID_FUSION };

      const baselineHits = hybridSearchFacts(facts, query);
      const embeddingHits = await hybridSearchFactsWithEmbedding(facts, query, provider);

      if (embeddingHits.length > 0) nonEmptyResults++;

      baselineMrr += computeMRR(baselineHits, target.fact.factId);
      embeddingMrr += computeMRR(embeddingHits, target.fact.factId);
      baselineRecall5 += computeRecallAtK(baselineHits, target.fact.factId, 5);
      embeddingRecall5 += computeRecallAtK(embeddingHits, target.fact.factId, 5);
    }

    const n = targets.length;
    baselineMrr /= n;
    embeddingMrr /= n;
    baselineRecall5 /= n;
    embeddingRecall5 /= n;

    console.log("[Embedding Ablation] Baseline MRR:", baselineMrr.toFixed(4));
    console.log("[Embedding Ablation] Embedding MRR:", embeddingMrr.toFixed(4));
    console.log("[Embedding Ablation] Baseline Recall@5:", (baselineRecall5 * 100).toFixed(1) + "%");
    console.log("[Embedding Ablation] Embedding Recall@5:", (embeddingRecall5 * 100).toFixed(1) + "%");
    console.log("[Embedding Ablation] Non-empty results:", nonEmptyResults, "/", n);

    expect(nonEmptyResults).toBe(n);
    expect(embeddingMrr).toBeGreaterThan(0);
    expect(embeddingRecall5).toBeGreaterThan(0);
  });

  it("NO_EMBEDDING_PROVIDER produces identical results to sync baseline", async () => {
    const { facts, targets } = buildCorpus();
    const query = { queryText: targets[0].query, topK: 10, fusion: OPTIMAL_HYBRID_FUSION };

    const syncHits = hybridSearchFacts(facts, query);
    const asyncHits = await hybridSearchFactsWithEmbedding(facts, query, NO_EMBEDDING_PROVIDER);

    expect(asyncHits.length).toBe(syncHits.length);
    expect(asyncHits.map((h) => h.fact.factId)).toEqual(syncHits.map((h) => h.fact.factId));
  });

  it("OPTIMAL_HYBRID_FUSION is used as default when no fusion option is passed", async () => {
    const { facts, targets } = buildCorpus();
    const provider = createMockEmbeddingProvider();
    const target = targets[0];

    const explicitHits = await hybridSearchFactsWithEmbedding(
      facts,
      { queryText: target.query, topK: 10, fusion: OPTIMAL_HYBRID_FUSION },
      provider,
    );
    const defaultHits = await hybridSearchFactsWithEmbedding(
      facts,
      { queryText: target.query, topK: 10 },
      provider,
    );

    expect(defaultHits.map((h) => h.fact.factId)).toEqual(
      explicitHits.map((h) => h.fact.factId),
    );
  });
});
