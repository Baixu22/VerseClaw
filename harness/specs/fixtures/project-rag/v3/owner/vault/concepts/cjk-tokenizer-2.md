---
title: openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T04:49:07.401Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
// Module B: Hybrid retrieval (FTS5 BM25 + vector ANN, RRF-fused).
//
// MVP implementation — no external dependencies. The architecture matches the
// production design (two retrieval paths fused by Reciprocal Rank Fusion),
// but the backends are pure-TypeScript so the system is fully testable
// without ONNX models or the sqlite-vec native extension:
//
//   - BM25 path: word-level Okapi BM25 with field weighting
//     (subject×3, predicate×2, objectSummary×1). Captures exact term matches
//     — error codes, identifiers, proper nouns — where vector search is weak.
//   - Vector path: character 3-gram TF-IDF cosine similarity. Captures
//     morphological / fuzzy / paraphrase matches where BM25 is weak. This is
//     the swap point for a real embedding model (all-MiniLM-L6-v2) later:
//     replace `embedDocument`/`embedQuery` with ONNX output and the rest of
//     the pipeline (RRF fusion, ranking) is unchanged.
//   - RRF fusion: score(doc) = 1/(k + rank_bm25) + 1/(k + rank_vec), k=60.
//     Documents ranking high in both paths float to the top; single-path
//     matches still appear but lower.
//
// Pre-filters (taskId, subject, referenceTime, verification status) are
// applied BEFORE indexing, mirroring the consumer's field-level gating.
//
// `HybridSearchIndex` precomputes per-fact n-gram vectors and BM25 corpus
// stats once so repeated queries against the same corpus are cheap. The pure
// `hybridSearchFacts` convenience builds a transient index per call.

import { cjkBigrams, CJK_RUN_RE } from "./memory-tokenization.js";
export { cjkBigrams } from "./memory-tokenization.js";
import {
  isRuntimeMemoryAcceptedVerificationStatus,
  type RuntimeMemoryQueryableFact,
} from "./memory-context.js";
import {
  isEmbeddingProviderAvailable,
  type EmbeddingProviderOrNone,
  type RuntimeEmbeddingProvider,
} from "./memory-embedding-provider.js";
// Week 2 v2: temporalPolicy 三档 (strict_current / include_history_ranked / as_of).
// 当 temporalPolicy 存在时, 覆盖 temporalMode 的行为; 否则保持现有 temporalMode 行为 (向后兼容).
import {
  computeHistoryPenalty,
  passesTemporalPolicy,
} from "./memory-temporal-policy.js";
import type { TemporalPolicy } from "./memory-trace.js";

export type HybridSearchQuery = {
  queryText: string;
  referenceTime?: number;
  taskId?: string;
  subject?: string;
  topK?: number;
  /** Include candidate (non-verified) facts. Default false. */
  includeCandidates?: boolean;
  /**
   * Confidence threshold for including candidate facts. When set, candidate
   * facts with confidence >= threshold are included even if includeCandidates
   * is false. Useful for surfacing high-confidence candidates that may contain
   * valuable information. Default undefined (no threshold-based inclusion).
   */
  candidateThreshold?: number;
  /** Retrieval fusion options (RRF k, weights, conditional fusion). */
  fusion?: HybridSearchFusionOptions;
  /**
   * Temporal query mode (Zep bi-temporal inspired).
   * - `filter` (default): exclude facts with valid_at > referenceTime or
   *   invalidated/expired facts. Current behavior — temporal filter only.
   * - `boost`: same filtering as `filter`, plus a temporal recency boost
   *   (up to +10%) for facts whose valid_at is close to referenceTime.
   *   Uses 30-day exponential decay: boost = exp(-|delta| / 30d).
   * - `strict`: only return facts that were valid AT referenceTime —
   *   valid_at ≤ referenceTime AND (invalid_at undefined OR invalid_at > referenceTime).
   *   Answers "what did we know at time X?".
   */
  temporalMode?: "filter" | "boost" | "strict";
  /**
   * Week 2 v2: High-level temporal policy (overrides temporalMode when set).
   * Source: memory-arch-roadmap.md §B3
   *
   * - `strict_current` (default): only currently-valid facts (hard filter
   *   invalid_at/expired_at < now). Maps to temporalMode=filter.
   * - `include_history_ranked`: allow historical facts (invalid_at/expired_at
   *   < now) but penalize them at ranking time (×0.5 by default). Maps to
   *   temporalMode=boost + post-filter penalty. For "before/previously/former"
   *   queries.
   * - `as_of`: rebuild snapshot at asOfTime. Maps to temporalMode=strict +
   *   referenceTime=asOfTime. For "in 2023" / "at that time" queries.
   *
   * When undefined, falls back to temporalMode (backward compat).
   */
  temporalPolicy?: TemporalPolicy;
  /**
   * Week 2 v2: as_of snapshot time (Unix ms). Only used when
   * temporalPolicy = "as_of". When undefined with as_of policy,
   * degrades to strict_current behavior.
   */
  asOfTime?: number;
};

export type HybridSearchHit = {
  fact: RuntimeMemoryQueryableFact;
  rrfScore: number;
  bm25Rank: number | null;
  vectorRank: number | null;
  entityRank: number | null;
  bm25Score: number;
  vectorScore: number;
  entityScore: number;
  // S0-3: cross-encoder relevance score in [0, 1]. Populated by
  // rerankHybridHits after cross-encoder reranking. Read by applyFinalBoost
  // for the Hindsight combined_score = ce_norm × recency × temporal ×
  // proof_count formula, and by applyEntityBoost so entity signals amplify
  // the CE score (not just the RRF score). Eliminates the Cross-encoder →
  // FinalBoost coupling break (mem-status §3 断裂点 2).
  // When undefined (no reranker run), applyFinalBoost falls back to rrfScore.
  ceScore?: number;
  /**
   * COMPASS 2.0: Expansion rank (0-based).
   * - undefined: initial hit (直接来自 BM25/Vector/Entity 检索)
   * - 0, 1, 2, ...: expansion hit 的排名 (来自 chained retrieval 扩展)
   * 用于 U_decision 公式: expansionFactor = 1/(1+expansionRank).
   */
  expansionRank?: number;
};

export type HybridSearchFusionOptions = {
  /** RRF k parameter. Lower k amplifies top-rank differences. Default 60. */
  rrfK?: number;
  /** BM25 path weight in RRF fusion. Default 1. */
  wBm25?: number;
  /** Vector path weight in RRF fusion. Default 1. */
  wVector?: number;
  /** Entity matching path weight in RRF fusion. Default 0 (disabled for
   * backward compatibility; set to >0 to enable three-signal fusion).
   *
   * The entity path extracts proper nouns, identifiers, and number strings
   * from both query and facts, then ranks by Jaccard similarity of entity
   * sets. This catches exact entity matches (error codes, function names,
   * configuration keys) that BM25 and character n-grams dilute across many
   * partial matches. */
  wEntity?: number;
  /** Conditional fusion alpha: if one path rank ≤ alpha and the other > beta/null,
   * use the strong path only (skip RRF). 0 = disabled. Default 0.
   * NOTE: per-fact conditional is known-broken; prefer perQueryConditional. */
  conditionalAlpha?: number;
  /** Conditional fusion beta: rank threshold for "not confident". Default Infinity. */
  conditionalBeta?: number;
  /** Per-query conditional fusion: detect path disagreement at top-1 and select
   * the dominant path for the ENTIRE query (zero out the other path's weight).
   * Avoids the per-fact scoring imbalance that breaks conditionalAlpha. */
  perQueryConditional?: boolean;
  /** Top-K window for per-query agreement check. If a path's top-1 is NOT in
   * the other path's top-K, that path is considered "dominant". Default 5. */
  perQueryK?: number;
  /** Tie-breaker when both paths strongly disagree (neither top-1 in the other's
   * top-K). "vector" trusts Vector (historically stronger), "bm25" trusts BM25.
   * Default "vector". */
  perQueryTieBreak?: "vector" | "bm25";
  /** Normalize RRF score by the number of paths that found each fact.
   * Default false (classic sum RRF).
   *
   * When true, a fact found by both paths gets score = (bm25RRF + vectorRRF) / 2,
   * while a fact found by one path gets score = pathRRF / 1. This eliminates the
   * unfair double-weight advantage that dual-path noise facts get under classic
   * sum RRF, which pushes single-path target matches (typos, morphological
   * variants) out of top-K.
   *
   * Empirically: classic sum RRF causes MRR regression vs Vector-only on typo/
   * morph queries. Normalized RRF preserves or exceeds Vector-only MRR. */
  normalizeByPathCount?: boolean;
  /**
   * P3-2: Candidate width cap for each retrieval arm before RRF fusion.
   *
   * Each arm (BM25, Vector, Entity) produces a ranked list of all candidates
   * with score > 0. When the corpus is large (e.g., 1000+ facts), these lists
   * can be hundreds of entries long, making the RRF union pool very large.
   * This cap truncates each arm's ranked list to the top-N candidates before
   * RRF fusion, bounding the union pool size.
   *
   * Default 300 (Hindsight/Mem0 standard candidate width for cross-encoder
   * reranking). Set to Infinity to disable capping (legacy behavior).
   *
   * Rationale: a fact ranked #301+ in a single arm has RRF score
   * ≤ 1/(60+301) ≈ 0.0028 — negligible compared to top-20 scores (~0.016).
   * Capping at 300 loses < 0.3% of RRF score mass while reducing the fusion
   * pool by 3-5× when the corpus is large. Facts ranked low in one arm but
   * high in another are preserved via the other arm's top-300.
   *
   * This also prepares for P3-3 (cross-encoder reranking): the cross-encoder
   * should only rerank top-300 RRF candidates, not the entire pool. Capping
   * each arm to 300 ensures the RRF pool is naturally bounded (≤ 900, typically
   * ~300-500 due to overlap), so the cross-encoder input is well-sized.
   */
  candidateTopK?: number;
};

const RRF_K = 60;
const DEFAULT_TOP_K = 20;
// P3-2: Default candidate width cap per arm before RRF fusion.
// Source: Hindsight/Mem0 standard — cross-encoder reranks top-300 RRF candidates.
const DEFAULT_CANDIDATE_TOP_K = 300;

const BM25_K1 = 1.5;
const BM25_B = 0.75;

// P3-1 (Mem0 query-length adaptive BM25): short queries (1-3 tokens) get
// a sigmoid-boosted k1 so partial matches rank higher. Mem0 observed that
// standard Okapi BM25 under-rewards short queries because the IDF × TF
// product is small when there are few query terms. The sigmoid boost
// amplifies the score for short queries without changing long-query behavior.
// Source: mem0-main/mem0/memory/main.py adaptive_search method.
const BM25_SHORT_QUERY_THRESHOLD = 3;

/**
 * P3-1: Compute adaptive BM25 parameters based on query length.
 * Short queries (≤3 tokens) get a boosted k1 to reward partial matches.
 * Long queries use standard Okapi parameters.
 */
function adaptiveBM25Params(queryTokenCount: number): {
  k1: number;
  b: number;
} {
  if (queryTokenCount <= BM25_SHORT_QUERY_THRESHOLD) {
    // Sigmoid boost: 1 token → 1.2×, 2 tokens → ~1.12×, 3 tokens → ~1.05×
    const sigmoid = 1 + 0.2 * (1 / (1 + Math.exp(queryTokenCount - 1)));
    return {
      k1: BM25_K1 * sigmoid,
      b: BM25_B,
    };
  }
  return { k1: BM25_K1, b: BM25_B };
}

const FIELD_WEIGHTS = { subject: 3, predicate: 2, objectSummary: 1 } as const;

/**
 * Optimal fusion configuration selected by the 21-variant ablation test
 * (tests/unit/runtime-memory-mvp-module-b-ablation-test.test.ts), extended
 * with entity matching as a third signal (Phase 3.1).
 *
 * Strategy: Vector-primary with BM25 boost + entity matching. k=0 amplifies
 * rank gaps so Vector #1 (score 1.0) always beats Vector #2 (score 0.5).
 * Normalization (divide by path count) ensures multi-path noise facts don't
 * get unfair double/triple-weight. Asymmetric weights (wVector=1.0, wBm25=0.5,
 * wEntity=0.5) let BM25 and entity matches boost agreed facts without
 * overriding the Vector ordering.
 *
 * Entity matching is enabled by default (wEntity=0.5) because it catches
 * exact proper-noun / identifier / number matches that BM25 and character
 * n-grams dilute. Facts with no entity overlap get no entity path contribution,
 * so the normalization by pathCount ensures no penalty for entity-less facts.
 *
 * No-harm guarantee: MRR ≥ Vector-only, Recall@5 ≥ Vector-only.
 * Measured (two-signal): MRR +0.011, Recall@5 +3.3pp vs Vector-only baseline.
 */
export const OPTIMAL_HYBRID_FUSION: HybridSearchFusionOptions = {
  // Multi-path agreement should reinforce rank, not average it down.
  // Dividing by pathCount made weak single-path hits outrank strong dual-path hits
  // (embedding mock integration: f2 over f1). Ablations can still opt into normalize.
  normalizeByPathCount: false,
  // P2-3 (2026-07-04): k=0 → k=60. With cross-encoder ceScore now driving
  // final ranking (S0-3), RRF only shapes the candidate pool. k=60 produces
  // a more diverse candidate pool (BM25/entity-only matches get closer scores
  // to Vector matches), letting the cross-encoder see more candidates. k=0
  // was optimal pre-cross-encoder because it amplified rank gaps for stable
  // MRR, but that's now the cross-encoder's job.
  rrfK: 60,
  wBm25: 0.5,
  wVector: 1.0,
  wEntity: 0.5,
  // P3-2: cap each arm to top-300 before fusion. Bounds the RRF pool for
  // downstream cross-encoder reranking (P3-3). No-op when corpus ≤ 300 facts.
  candidateTopK: DEFAULT_CANDIDATE_TOP_K,
};

/**
 * Run hybrid retrieval over an in-memory fact list. Builds a transient index
 * per call. For repeated queries against the same corpus, build a
 * `HybridSearchIndex` once and call `search()` repeatedly.
 *
 * Uses `OPTIMAL_HYBRID_FUSION` by default (Vector-primary with BM25 boost).
 * Pass `query.fusion` to override.
 *
 * Uses a module-level LRU cache to avoid rebuilding the index when the same
 * pre-filtered candidate set is queried repeatedly. Cache key is derived from
 * fact IDs + valid_at + invalid_at (content-sensitive). Max 16 entries.
 */
export function hybridSearchFacts(
  facts: readonly RuntimeMemoryQueryableFact[],
  query: HybridSearchQuery,
): HybridSearchHit[] {
  const topK = query.topK ?? DEFAULT_TOP_K;
  if (topK <= 0 || facts.length === 0 || query.queryText.trim().length === 0) {
    return [];
  }
  const candidates = preFilter(facts, query);
  if (candidates.length === 0) return [];

  const index = getCachedHybridSearchIndex(candidates);
  const hits = index.search(query.queryText, topK, query.fusion ?? OPTIMAL_HYBRID_FUSION);

  // Week 2 v2: temporalPolicy 优先于 temporalMode (向后兼容).
  // temporalPolicy 存在时, 用 passesTemporalPolicy + computeHistoryPenalty;
  // 否则保持现有 temporalMode 行为.
  if (query.temporalPolicy !== undefined) {
    const policy = query.temporalPolicy;
    const now = query.referenceTime ?? Date.now();
    const asOfTime = query.asOfTime;
    void asOfTime;

    // include_history_ranked: 对历史 fact 应用降权 (×0.5)
    if (policy === "include_history_ranked") {
      for (const hit of hits) {
        const penalty = computeHistoryPenalty(hit.fact, now);
        hit.rrfScore = hit.rrfScore * penalty;
        if (hit.ceScore !== undefined) {
          hit.ceScore = hit.ceScore * penalty;
        }
      }
      hits.sort((a, b) => b.rrfScore - a.rrfScore);
    }
    // strict_current / as_of: 过滤已在 preFilter 完成, 这里无需额外处理.
  } else {
    // 向后兼容: temporalMode 路径
    const temporalMode = query.temporalMode ?? "filter";
    if (temporalMode === "boost" && query.referenceTime !== undefined) {
      const refTime = query.referenceTime;
      const halfLifeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
      for (const hit of hits) {
        const timeDelta = Math.abs(refTime - hit.fact.valid_at);
        const temporalBoost = Math.exp(-timeDelta / halfLifeMs);
        hit.rrfScore = hit.rrfScore * (1 + 0.1 * temporalBoost);
      }
      hits.sort((a, b) => b.rrfScore - a.rrfScore);
    }
  }

  return hits;
}

const INDEX_CACHE_MAX = 16;
const indexCache = new Map<string, HybridSearchIndex>();

function getCachedHybridSearchIndex(
  candidates: readonly RuntimeMemoryQueryableFact[],
): HybridSearchIndex {
  const key = computeIndexCacheKey(candidates);
  const cached = indexCache.get(key);
  if (cached) {
    indexCache.delete(key);
    indexCache.set(key, cached);
    return cached;
  }
  const index = new HybridSearchIndex(candidates);
  if (indexCache.size >= INDEX_CACHE_MAX) {
    const oldest = indexCache.keys().next().value;
    if (oldest !== undefined) indexCache.delete(oldest);
  }
  indexCache.set(key, index);
  return index;
}

function computeIndexCacheKey(
  candidates: readonly RuntimeMemoryQueryableFact[],
): string {
  const parts: string[] = [];
  for (const f of candidates) {
    parts.push(`${f.factId}:${f.valid_at}:${f.invalid_at ?? "x"}`);
  }
  parts.sort();
  return parts.join("|");
}

export function clearHybridSearchIndexCache(): void {
  indexCache.clear();
  embeddingIndexCache.clear();
}

export function getHybridSearchIndexCacheStats(): { size: number; maxSize: number } {
  return {
    size: indexCache.size + embeddingIndexCache.size,
    maxSize: INDEX_CACHE_MAX,
  };
}

// === Embedding-aware index cache ===
// Separate cache for embedding-enabled indices. Keyed by fact IDs + provider
// id + dimension to avoid mixing different embedding spaces.

const embeddingIndexCache = new Map<string, HybridSearchIndex>();

function getEmbeddingCachedIndex(
  candidates: readonly RuntimeMemoryQueryableFact[],
  provider: RuntimeEmbeddingProvider,
  embeddings: Map<string, Float32Array>,
): HybridSearchIndex {
  const key = `${provider.id}:${provider.dimension}|${computeIndexCacheKey(candidates)}`;
  const cached = embeddingIndexCache.get(key);
  if (cached) {
    embeddingIndexCache.delete(key);
    embeddingIndexCache.set(key, cached);
    return cached;
  }
  const index = new HybridSearchIndex(candidates, { embeddings });
  if (embeddingIndexCache.size >= INDEX_CACHE_MAX) {
    const oldest = embeddingIndexCache.keys().next().value;
    if (oldest !== undefined) embeddingIndexCache.delete(oldest);
  }
  embeddingIndexCache.set(key, index);
  return index;
}

/**
 * Async factory: build a HybridSearchIndex with precomputed fact embeddings.
 *
 * Calls `embeddingProvider.embedBatch(allFactTexts)` once to precompute
 * embeddings for all facts, then constructs the index with those embeddings
 * attached. The sync `search()` method falls back to 3-gram TF-IDF;
 * `searchWithEmbedding()` uses the precomputed embeddings.
 *
 * Returns a regular HybridSearchIndex (no embedding) when provider is
 * NO_EMBEDDING_PROVIDER — caller can use sync `search()` safely.
 */
export async function buildHybridSearchIndex(
  facts: readonly RuntimeMemoryQueryableFact[],
  embeddingProvider: EmbeddingProviderOrNone,
): Promise<HybridSearchIndex> {
  if (!isEmbeddingProviderAvailable(embeddingProvider)) {
    return new HybridSearchIndex(facts);
  }
  const texts = facts.map((f) => buildWeightedDoc(f));
  const embeddingsArr = texts.length > 0
    ? await embeddingProvider.embedBatch(texts)
    : [];
  const embeddings = new Map<string, Float32Array>();
  for (let i = 0; i < facts.length; i++) {
    const emb = embeddingsArr[i];
    if (emb && emb.length > 0) {
      embeddings.set(facts[i].factId, new Float32Array(emb));
    }
  }
  return getEmbeddingCachedIndex(facts, embeddingProvider, embeddings);
}

/**
 * Async hybrid search with real embedding vectors. Falls back to sync
 * `hybridSearchFacts` (3-gram TF-IDF) when no provider is available.
 *
 * The caller provides an embedding provider; this function handles
 * precomputing the query embedding via `embedQuery` and delegates to
 * `searchWithEmbedding` on a cached index.
 */
export async function hybridSearchFactsWithEmbedding(
  facts: readonly RuntimeMemoryQueryableFact[],
  query: HybridSearchQuery,
  embeddingProvider: EmbeddingProviderOrNone,
): Promise<HybridSearchHit[]> {
  if (!isEmbeddingProviderAvailable(embeddingProvider)) {
    return hybridSearchFacts(facts, query);
  }
  const topK = query.topK ?? DEFAULT_TOP_K;
  if (topK <= 0 || facts.length === 0 || query.queryText.trim().length === 0) {
    return [];
  }
  const candidates = preFilter(facts, query);
  if (candidates.length === 0) return [];

  const index = await buildHybridSearchIndex(candidates, embeddingProvider);
  const queryEmbeddingArr = await embeddingProvider.embedQuery(query.queryText);
  const queryEmbedding = new Float32Array(queryEmbeddingArr);
  const hits = index.searchWithEmbedding(
    query.queryText,
    queryEmbedding,
    topK,
    query.fusion ?? OPTIMAL_HYBRID_FUSION,
  );

  const temporalMode = query.temporalMode ?? "filter";
  // Week 2 v2: temporalPolicy 优先于 temporalMode
  if (query.temporalPolicy !== undefined) {
    const policy = query.temporalPolicy;
    const now = query.referenceTime ?? Date.now();
    if (policy === "include_history_ranked") {
      for (const hit of hits) {
        const penalty = computeHistoryPenalty(hit.fact, now);
        hit.rrfScore = hit.rrfScore * penalty;
        if (hit.ceScore !== undefined) {
          hit.ceScore = hit.ceScore * penalty;
        }
      }
      hits.sort((a, b) => b.rrfScore - a.rrfScore);
    }
  } else if (temporalMode === "boost" && query.referenceTime !== undefined) {
    const refTime = query.referenceTime;
    const halfLifeMs = 30 * 24 * 60 * 60 * 1000;
    for (const hit of hits) {
      const timeDelta = Math.abs(refTime - hit.fact.valid_at);
      const temporalBoost = Math.exp(-timeDelta / halfLifeMs);
      hit.rrfScore = hit.rrfScore * (1 + 0.1 * temporalBoost);
    }
    hits.sort((a, b) => b.rrfScore - a.rrfScore);
  }

  return hits;
}

function preFilter(
  facts: readonly RuntimeMemoryQueryableFact[],
  query: HybridSearchQuery,
): RuntimeMemoryQueryableFact[] {
  const out: RuntimeMemoryQueryableFact[] = [];
  const temporalMode = query.temporalMode ?? "filter";
  const hasReferenceTime = query.referenceTime !== undefined;
  // Week 2 v2: temporalPolicy 优先于 temporalMode
  const hasTemporalPolicy = query.temporalPolicy !== undefined;
  for (const fact of facts) {
    if (query.taskId !== undefined) {
      const matchesTask =
        fact.taskId === query.taskId ||
        fact.sourceEpisodeRefs.some((ref) => ref.taskId === query.taskId);
      if (!matchesTask) continue;
    }
    if (query.subject !== undefined && fact.subject !== query.subject) continue;

    if (hasTemporalPolicy) {
      // Week 2 v2: 三档 policy 过滤
      const policy = query.temporalPolicy as TemporalPolicy;
      const now = query.referenceTime ?? Date.now();
      const result = passesTemporalPolicy(fact, policy, now, query.asOfTime);
      if (!result.passes) continue;
    } else if (hasReferenceTime) {
      // 向后兼容: temporalMode 路径
      const refTime = query.referenceTime as number;
      if (fact.valid_at > refTime) continue;

      if (temporalMode === "strict") {
        if (fact.invalid_at !== undefined && fact.invalid_at <= refTime) continue;
      } else {
        if (fact.invalid_at !== undefined && fact.invalid_at <= refTime) continue;
        if (fact.expired_at !== undefined && fact.expired_at <= refTime) continue;
      }
    }

    if (!query.includeCandidates) {
      if (!isRuntimeMemoryAcceptedVerificationStatus(fact.verificationStatus)) {
        if (
          query.candidateThreshold !== undefined &&
          typeof fact.confidence === "number" &&
          fact.confidence >= query.candidateThreshold
        ) {
          // Include high-confidence candidate
        } else {
          continue;
        }
      }
    }
    out.push(fact);
  }
  return out;
}

type IndexedFact = {
  fact: RuntimeMemoryQueryableFact;
  wordTf: Map<string, number>;
  docLen: number;
  ngramVec: Map<string, number>;
  entitySet: Set<string>;
  embeddingVec?: Float32Array;
};

/**
 * Precomputed hybrid-search index over a fact corpus. Build once, query many.
 *
 * The index supports two vector paths:
 * - 3-gram TF-IDF (default, synchronous, zero-dependency)
 * - Real embedding (optional, requires precomputed embeddings via `buildHybridSearchIndex`)
 *
 * When embeddings are attached, `searchWithEmbedding()` uses cosine similarity
 * over Float32Array vectors instead of the 3-gram TF-IDF path. The sync `search()`
 * method always uses 3-gram TF-IDF, preserving zero-regression behavior.
 */
export class HybridSearchIndex {
  private readonly facts: IndexedFact[];
  private readonly factsById: Map<string, IndexedFact>;
  private readonly N: number;
  private readonly avgdl: number;
  private readonly df: Map<string, number>;
  private readonly hasEmbeddings: boolean;

  constructor(
    facts: readonly RuntimeMemoryQueryableFact[],
    options?: {
      embeddings?: Map<string, Float32Array>;
    },
  ) {
    this.facts = facts.map((fact) => {
      const text = buildWeightedDoc(fact);
      const words = tokenizeWords(text);
      const wordTf = new Map<string, number>();
      for (const w of words) wordTf.set(w, (wordTf.get(w) ?? 0) + 1);
      return {
        fact,
        wordTf,
        docLen: words.length,
        ngramVec: tfidfVector(characterNgrams(text)),
        entitySet: extractEntities(text),
      };
    });

    if (options?.embeddings) {
      for (const d of this.facts) {
        const emb = options.embeddings.get(d.fact.factId);
        if (emb) d.embeddingVec = emb;
      }
    }

    this.factsById = new Map<string, IndexedFact>();
    for (const d of this.facts) this.factsById.set(d.fact.factId, d);

    this.N = this.facts.length;
    const totalLen = this.facts.reduce((s, d) => s + d.docLen, 0);
    this.avgdl = this.N > 0 ? totalLen / this.N : 0;

    this.df = new Map<string, number>();
    for (const d of this.facts) {
      for (const term of d.wordTf.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }

    this.hasEmbeddings = this.facts.some((d) => d.embeddingVec !== undefined);
  }

  /**
   * Get a map of factId → embedding for all facts with precomputed embeddings.
   * Used by weighted graph traversal (Item 5 v2) to compute semantic_score
   * = cosine(queryEmbedding, factEmbedding) for graph scoring.
   *
   * Returns an empty map if no embeddings are attached.
   */
  getFactEmbeddings(): Map<string, Float32Array> {
    const result = new Map<string, Float32Array>();
    for (const d of this.facts) {
      if (d.embeddingVec) result.set(d.fact.factId, d.embeddingVec);
    }
    return result;
  }

  search(
    queryText: string,
    topK: number = DEFAULT_TOP_K,
    fusion?: HybridSearchFusionOptions,
  ): HybridSearchHit[] {
    if (topK <= 0 || this.facts.length === 0 || queryText.trim().length === 0) {
      return [];
    }

    const rrfK = fusion?.rrfK ?? RRF_K;
    const baseWBm25 = fusion?.wBm25 ?? 1;
    const baseWVector = fusion?.wVector ?? 1;
    const baseWEntity = fusion?.wEntity ?? 0;
    const condAlpha = fusion?.conditionalAlpha ?? 0;
    const condBeta = fusion?.conditionalBeta ?? Infinity;
    const perQuery = fusion?.perQueryConditional ?? false;
    const perQueryK = fusion?.perQueryK ?? 5;
    const perQueryTieBreak = fusion?.perQueryTieBreak ?? "vector";
    const normalizeByPathCount = fusion?.normalizeByPathCount ?? false;
    // P3-2: cap each arm to top-N before fusion. Infinity = no cap (legacy).
    const candidateTopK = fusion?.candidateTopK ?? DEFAULT_CANDIDATE_TOP_K;

    const bm25Ranked = capArm(this.rankBM25(queryText), candidateTopK);
    const vectorRanked = capArm(this.rankVector(queryText), candidateTopK);
    const entityRanked = baseWEntity > 0
      ? capArm(this.rankEntity(queryText), candidateTopK)
      : [];

    const bm25RankById = new Map<string, number>();
    bm25Ranked.forEach((e, i) => bm25RankById.set(e.factId, i + 1));
    const vectorRankById = new Map<string, number>();
    vectorRanked.forEach((e, i) => vectorRankById.set(e.factId, i + 1));
    const entityRankById = new Map<string, number>();
    entityRanked.forEach((e, i) => entityRankById.set(e.factId, i + 1));

    // === Per-query conditional fusion ===
    // Detect disagreement at top-1 and select the dominant path for the
    // ENTIRE query. This avoids the per-fact scoring imbalance that breaks
    // conditionalAlpha (where dual-path noise facts get double RRF weight
    // and push single-path target matches out of top-K).
    let effectiveWBm25 = baseWBm25;
    let effectiveWVector = baseWVector;
    if (perQuery && bm25Ranked.length > 0 && vectorRanked.length > 0) {
      const bm25Top1Id = bm25Ranked[0].factId;
      const vectorTop1Id = vectorRanked[0].factId;
      if (bm25Top1Id !== vectorTop1Id) {
        // Top-1 disagree — check agreement window
        const bm25TopKIds = new Set<string>(
          bm25Ranked.slice(0, perQueryK).map((e) => e.factId),
        );
        const vectorTopKIds = new Set<string>(
          vectorRanked.slice(0, perQueryK).map((e) => e.factId),
        );
        const vectorTop1InBm25 = bm25TopKIds.has(vectorTop1Id);
        const bm25Top1InVector = vectorTopKIds.has(bm25Top1Id);

        if (vectorTop1InBm25 && !bm25Top1InVector) {
          // Vector's top-1 is confirmed by BM25, but BM25's top-1 is NOT confirmed
          // by Vector → Vector is the dominant path, zero out BM25 weight.
          effectiveWBm25 = 0;
        } else if (bm25Top1InVector && !vectorTop1InBm25) {
          // BM25's top-1 is confirmed by Vector, but Vector's top-1 is NOT confirmed
          // by BM25 → BM25 is the dominant path, zero out Vector weight.
          effectiveWVector = 0;
        } else if (!vectorTop1InBm25 && !bm25Top1InVector) {
          // Strong disagreement — neither top-1 is in the other's top-K.
          // Fall back to the configured tie-breaker (Vector by default, since
          // the character n-gram path empirically handles typos/morph/paraphrase
          // far better than word-level BM25).
          if (perQueryTieBreak === "vector") {
            effectiveWBm25 = 0;
          } else {
            effectiveWVector = 0;
          }
        }
        // else: both top-1 are in each other's top-K → agreement → keep both weights
      }
    }

    const allIds = new Set<string>([
      ...bm25RankById.keys(),
      ...vectorRankById.keys(),
      ...entityRankById.keys(),
    ]);

    const bm25ScoreById = new Map<string, number>();
    for (const e of bm25Ranked) bm25ScoreById.set(e.factId, e.score);
    const vectorScoreById = new Map<string, number>();
    for (const e of vectorRanked) vectorScoreById.set(e.factId, e.score);
    const entityScoreById = new Map<string, number>();
    for (const e of entityRanked) entityScoreById.set(e.factId, e.score);

    const hits: HybridSearchHit[] = [];
      for (const factId of allIds) {
        const indexed = this.factsById.get(factId);
        if (!indexed) continue;
        const bm25Rank = bm25RankById.get(factId) ?? null;
        const vectorRank = vectorRankById.get(factId) ?? null;
        const entityRank = entityRankById.get(factId) ?? null;
        let rrf = 0;
        let pathCount = 0;

        if (condAlpha > 0) {
          const bm25Confident = bm25Rank !== null && bm25Rank <= condAlpha;
          const vectorConfident = vectorRank !== null && vectorRank <= condAlpha;
          const bm25NotConfident = bm25Rank === null || bm25Rank > condBeta;
          const vectorNotConfident = vectorRank === null || vectorRank > condBeta;

          if (vectorConfident && bm25NotConfident) {
            if (vectorRank !== null) { rrf = effectiveWVector / (rrfK + vectorRank); pathCount = 1; }
          } else if (bm25Confident && vectorNotConfident) {
            if (bm25Rank !== null) { rrf = effectiveWBm25 / (rrfK + bm25Rank); pathCount = 1; }
          } else {
            if (bm25Rank !== null) { rrf += effectiveWBm25 / (rrfK + bm25Rank); pathCount++; }
            if (vectorRank !== null) { rrf += effectiveWVector / (rrfK + vectorRank); pathCount++; }
          }
        } else {
          if (bm25Rank !== null) { rrf += effectiveWBm25 / (rrfK + bm25Rank); pathCount++; }
          if (vectorRank !== null) { rrf += effectiveWVector / (rrfK + vectorRank); pathCount++; }
        }

        if (entityRank !== null && baseWEntity > 0) {
          rrf += baseWEntity / (rrfK + entityRank);
          pathCount++;
        }

        if (normalizeByPathCount && pathCount > 1) {
          rrf = rrf / pathCount;
        }

        hits.push({
          fact: indexed.fact,
          rrfScore: rrf,
          bm25Rank,
          vectorRank,
          entityRank,
          bm25Score: bm25ScoreById.get(factId) ?? 0,
          vectorScore: vectorScoreById.get(factId) ?? 0,
          entityScore: entityScoreById.get(factId) ?? 0,
        });
      }

    hits.sort((a, b) => b.rrfScore - a.rrfScore);
    return hits.slice(0, topK);
  }

  /**
   * Async search using real embedding vectors for the vector path. Falls back
   * to sync `search()` (3-gram TF-IDF) when no fact embeddings are attached
   * or no query embedding is provided.
   *
   * The RRF fusion logic is identical to `search()`; only the vector ranking
   * source changes (embedding cosine similarity vs 3-gram TF-IDF cosine).
   */
  searchWithEmbedding(
    queryText: string,
    queryEmbedding: Float32Array | null,
    topK: number = DEFAULT_TOP_K,
    fusion?: HybridSearchFusionOptions,
  ): HybridSearchHit[] {
    if (!this.hasEmbeddings || !queryEmbedding) {
      return this.search(queryText, topK, fusion);
    }
    if (topK <= 0 || this.facts.length === 0 || queryText.trim().length === 0) {
      return [];
    }

    const rrfK = fusion?.rrfK ?? RRF_K;
    const baseWBm25 = fusion?.wBm25 ?? 1;
    const baseWVector = fusion?.wVector ?? 1;
    const baseWEntity = fusion?.wEntity ?? 0;
    const perQuery = fusion?.perQueryConditional ?? false;
    const perQueryK = fusion?.perQueryK ?? 5;
    const perQueryTieBreak = fusion?.perQueryTieBreak ?? "vector";
    const normalizeByPathCount = fusion?.normalizeByPathCount ?? false;
    // P3-2: cap each arm to top-N before fusion. Infinity = no cap (legacy).
    const candidateTopK = fusion?.candidateTopK ?? DEFAULT_CANDIDATE_TOP_K;

    const bm25Ranked = capArm(this.rankBM25(queryText), candidateTopK);
    const vectorRanked = capArm(this.rankVectorEmbedding(queryEmbedding), candidateTopK);
    const entityRanked = baseWEntity > 0
      ? capArm(this.rankEntity(queryText), candidateTopK)
      : [];

    const bm25RankById = new Map<string, number>();
    bm25Ranked.forEach((e, i) => bm25RankById.set(e.factId, i + 1));
    const vectorRankById = new Map<string, number>();
    vectorRanked.forEach((e, i) => vectorRankById.set(e.factId, i + 1));
    const entityRankById = new Map<string, number>();
    entityRanked.forEach((e, i) => entityRankById.set(e.factId, i + 1));

    let effectiveWBm25 = baseWBm25;
    let effectiveWVector = baseWVector;
    if (perQuery && bm25Ranked.length > 0 && vectorRanked.length > 0) {
      const bm25Top1Id = bm25Ranked[0].factId;
      const vectorTop1Id = vectorRanked[0].factId;
      if (bm25Top1Id !== vectorTop1Id) {
        const bm25TopKIds = new Set<string>(
          bm25Ranked.slice(0, perQueryK).map((e) => e.factId),
        );
        const vectorTopKIds = new Set<string>(
          vectorRanked.slice(0, perQueryK).map((e) => e.factId),
        );
        const vectorTop1InBm25 = bm25TopKIds.has(vectorTop1Id);
        const bm25Top1InVector = vectorTopKIds.has(bm25Top1Id);
        if (vectorTop1InBm25 && !bm25Top1InVector) {
          effectiveWBm25 = 0;
        } else if (bm25Top1InVector && !vectorTop1InBm25) {
          effectiveWVector = 0;
        } else if (!vectorTop1InBm25 && !bm25Top1InVector) {
          if (perQueryTieBreak === "vector") effectiveWBm25 = 0;
          else effectiveWVector = 0;
        }
      }
    }

    const allIds = new Set<string>([
      ...bm25RankById.keys(),
      ...vectorRankById.keys(),
      ...entityRankById.keys(),
    ]);

    const bm25ScoreById = new Map<string, number>();
    for (const e of bm25Ranked) bm25ScoreById.set(e.factId, e.score);
    const vectorScoreById = new Map<string, number>();
    for (const e of vectorRanked) vectorScoreById.set(e.factId, e.score);
    const entityScoreById = new Map<string, number>();
    for (const e of entityRanked) entityScoreById.set(e.factId, e.score);

    const hits: HybridSearchHit[] = [];
    for (const factId of allIds) {
      const indexed = this.factsById.get(factId);
      if (!indexed) continue;
      const bm25Rank = bm25RankById.get(factId) ?? null;
      const vectorRank = vectorRankById.get(factId) ?? null;
      const entityRank = entityRankById.get(factId) ?? null;
      let rrf = 0;
      let pathCount = 0;

      if (bm25Rank !== null) { rrf += effectiveWBm25 / (rrfK + bm25Rank); pathCount++; }
      if (vectorRank !== null) { rrf += effectiveWVector / (rrfK + vectorRank); pathCount++; }
      if (entityRank !== null && baseWEntity > 0) {
        rrf += baseWEntity / (rrfK + entityRank);
        pathCount++;
      }
      if (normalizeByPathCount && pathCount > 1) {
        rrf = rrf / pathCount;
      }

      hits.push({
        fact: indexed.fact,
        rrfScore: rrf,
        bm25Rank,
        vectorRank,
        entityRank,
        bm25Score: bm25ScoreById.get(factId) ?? 0,
        vectorScore: vectorScoreById.get(factId) ?? 0,
        entityScore: entityScoreById.get(factId) ?? 0,
      });
    }

    hits.sort((a, b) => b.rrfScore - a.rrfScore);
    return hits.slice(0, topK);
  }

  private rankVectorEmbedding(
    queryEmbedding: Float32Array,
  ): { factId: string; score: number }[] {
    const ranked: { factId: string; score: number }[] = [];
    for (const doc of this.facts) {
      if (!doc.embeddingVec) continue;
      const sim = cosineEmbedding(queryEmbedding, doc.embeddingVec);
      if (sim > 0) ranked.push({ factId: doc.fact.factId, score: sim });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  private rankBM25(queryText: string): { factId: string; score: number }[] {
    const queryTokens = tokenizeWords(queryText);
    if (queryTokens.length === 0) return [];

    // P3-1: use adaptive BM25 parameters based on query length.
    const { k1: adaptiveK1, b: adaptiveB } = adaptiveBM25Params(
      queryTokens.length,
    );

    const ranked: { factId: string; score: number }[] = [];
    for (const doc of this.facts) {
      let score = 0;
      for (const term of new Set(queryTokens)) {
        const dfTerm = this.df.get(term) ?? 0;
        if (dfTerm === 0) continue;
        const tfTerm = doc.wordTf.get(term) ?? 0;
        if (tfTerm === 0) continue;
        const idf = Math.log(((this.N - dfTerm + 0.5) / (dfTerm + 0.5)) + 1);
        const denom =
          tfTerm +
          adaptiveK1 * (1 - adaptiveB + adaptiveB * (doc.docLen / Math.max(this.avgdl, 1)));
        score += idf * ((tfTerm * (adaptiveK1 + 1)) / denom);
      }
      if (score > 0) ranked.push({ factId: doc.fact.factId, score });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  private rankVector(queryText: string): { factId: string; score: number }[] {
    const queryVec = tfidfVector(characterNgrams(queryText));
    if (queryVec.size === 0) return [];

    const ranked: { factId: string; score: number }[] = [];
    for (const doc of this.facts) {
      const sim = cosine(queryVec, doc.ngramVec);
      if (sim > 0) ranked.push({ factId: doc.fact.factId, score: sim });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  private rankEntity(queryText: string): { factId: string; score: number }[] {
    const queryEntities = extractEntities(queryText);
    if (queryEntities.size === 0) return [];

    const ranked: { factId: string; score: number }[] = [];
    for (const doc of this.facts) {
      const score = jaccardSet(queryEntities, doc.entitySet);
      if (score > 0) ranked.push({ factId: doc.fact.factId, score });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }
}

/**
 * P3-2: Cap an arm's ranked list to the top-N candidates.
 * Returns the input array unchanged when cap is Infinity or the list is
 * already within the cap. Avoids copying on the hot path when no cap is needed.
 */
function capArm<T>(
  ranked: readonly T[],
  cap: number,
): T[] {
  if (!Number.isFinite(cap) || ranked.length <= cap) {
    return ranked as T[];
  }
  return ranked.slice(0, cap);
}

function buildWeightedDoc(fact: RuntimeMemoryQueryableFact): string {
  const subject = fact.subject ?? "";
  const predicate = fact.predicate ?? "";
  const objectSummary = fact.objectSummary ?? "";
  return [
    subject.repeat(FIELD_WEIGHTS.subject),
    predicate.repeat(FIELD_WEIGHTS.predicate),
    objectSummary,
  ].join(" ");
}

function tfidfVector(grams: string[]): Map<string, number> {
  const vec = new Map<string, number>();
  for (const g of grams) vec.set(g, (vec.get(g) ?? 0) + 1);
  return vec;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let aSq = 0;
  let bSq = 0;
  for (const [k, v] of a) {
    aSq += v * v;
    const bv = b.get(k);
    if (bv !== undefined) dot += v * bv;
  }
  for (const [, v] of b) bSq += v * v;
  if (aSq === 0 || bSq === 0) return 0;
  return dot / (Math.sqrt(aSq) * Math.sqrt(bSq));
}

function cosineEmbedding(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let aSq = 0;
  let bSq = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    aSq += av * av;
    bSq += bv * bv;
  }
  if (aSq === 0 || bSq === 0) return 0;
  return dot / (Math.sqrt(aSq) * Math.sqrt(bSq));
}

/**
 * Word tokens for the token/BM25 channel. ASCII words as before; CJK covered
 * by bigrams (TF-0114). Relationship to characterNgrams (req-2): the two are
 * separate weighted channels of the hybrid score — bigrams feed this
 * token/BM25 channel, character trigrams feed the n-gram cosine channel — so
 * CJK appearing in both is intended multi-signal coverage, not
 * double-counting within a single channel.
 */
export function tokenizeWords(text: string): string[] {
  const asciiWords = text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 1);
  return [...asciiWords, ...cjkBigrams(text)];
}

/**
 * Extract entities from text: proper nouns, identifiers (camelCase / snake_case
 * / hyphen-joined), and multi-digit numbers. These are the tokens where exact
 * match matters most — error codes, function names, configuration keys — and
 * where BM25 / character n-grams dilute the signal across many partial matches.
 *
 * The entity path ranks facts by Jaccard similarity of entity sets, so a fact
 * sharing the exact same proper noun or identifier as the query gets a strong
 * boost regardless of BM25 / n-gram ranking.
 */
export function extractEntities(text: string): Set<string> {
  const entities = new Set<string>();
  const properNouns = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
  const identifiers = text.match(/\b[a-z][a-zA-Z0-9]*(?:[A-Z][a-z]+)+\b/g) ?? [];
  const snakeCase = text.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? [];
  const hyphenated = text.match(/\b[a-z]+(?:-[a-z0-9]+)+\b/g) ?? [];
  const numbers = text.match(/\b\d{2,}\b/g) ?? [];
  // TF-0114 (T-P0-6): contiguous CJK runs (2+ chars) as entities — the five
  // ASCII patterns above match nothing in pure Chinese text.
  const cjkRuns = text.match(CJK_RUN_RE) ?? [];
  for (const e of properNouns) entities.add(e.toLowerCase());
  for (const e of identifiers) entities.add(e.toLowerCase());
  for (const e of snakeCase) entities.add(e.toLowerCase());
  for (const e of hyphenated) entities.add(e.toLowerCase());
  for (const e of numbers) entities.add(e);
  for (const e of cjkRuns) entities.add(e);
  return entities;
}

function jaccardSet(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const e of a) {
    if (b.has(e)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Character trigrams for the n-gram cosine channel. Character-level, so it
 * already works for CJK. TF-0114 req-2: kept as-is alongside the new CJK
 * bigrams in tokenizeWords — the two feed different weighted channels of the
 * hybrid score (see the no-double-counting note on tokenizeWords).
 */
function characterNgrams(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 3) return normalized.length > 0 ? [normalized] : [];
  const padded = ` ${normalized} `;
  const grams: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i++) {
    const g = padded.slice(i, i + 3);
    if (!/^\s+$/.test(g)) grams.push(g);
  }
  return grams;
}

// === Diagnostics ===

export type HybridRetrievalDiagnostics = {
  candidateCount: number;
  bm25Hits: number;
  vectorHits: number;
  entityHits: number;
  fusedHits: number;
  topRrfScore: number;
};

export function diagnoseHybridRetrieval(
  facts: readonly RuntimeMemoryQueryableFact[],
  query: HybridSearchQuery,
): HybridRetrievalDiagnostics {
  const hits = hybridSearchFacts(facts, query);
  return {
    candidateCount: preFilter(facts, query).length,
    bm25Hits: hits.filter((h) => h.bm25Rank !== null).length,
    vectorHits: hits.filter((h) => h.vectorRank !== null).length,
    entityHits: hits.filter((h) => h.entityRank !== null).length,
    fusedHits: hits.length,
    topRrfScore: hits.length > 0 ? hits[0].rrfScore : 0,
  };
}

~~~
