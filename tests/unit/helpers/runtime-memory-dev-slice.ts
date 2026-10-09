export type StratifiedQaItem<TQa> = {
  qa: TQa;
  conversationId: string;
  category: string;
};

export type DevSliceCache<TQuestion = unknown> = {
  version: string;
  sampleSeed: number;
  sampleSizes: Record<string, number>;
  questions: TQuestion[];
};

// P1-SOTA: Bumped cache version to invalidate caches built before the
// SOTA-aligned retrieval flow (cross-encoder rerank + chained retrieval
// expansion + final boost + generous judge v2). Old caches would skip the
// new retrieval logic, producing stale J scores.
// Item 1 (2026-07-04): Bumped again because RRF candidate pool widened
// from top-30 to top-300 and cross-encoder topK from 15 to 50 (Hindsight
// §2.3 alignment). Old caches store top-30 retrieval results that miss
// the new wider candidate set.
// Item 4 (2026-07-04): Bumped again because EntityStore boost is applied
// after cross-encoder rerank (tanh(sharedCount * 0.5) * 0.2 weight). Old
// caches store finalHits without the entity boost, so re-running with
// EntityStore enabled would otherwise use stale ordering.
// Item 3 (2026-07-04): Bumped again because cross-session observation
// consolidation replaces fragmented facts with merged observations. The
// fact set and factIds change, so old retrieval caches are stale.
// Item 6 (2026-07-04): Bumped again because temporal RRF arm replaces the
// +10% temporal boost, changing RRF scores for all temporal questions.
// Item 5 Stage 1 (2026-07-04): Bumped again because buildEntityRelationMap
// now uses EntityStore's richer entity extraction + reverse index. depth=3
// was attempted and rolled back, but the EntityStore integration itself
// changes relation map edges, so cache must be invalidated.
// Item 5 v2 (2026-07-04): Bumped again because simple BFS is replaced by
// Hindsight-style weighted graph traversal as independent RRF arm. Edges
// now have weights (tanh entity score), traversal is priority-queue
// best-first, and graph hits are merged via RRF instead of post-processing.
// Stage 2 (2026-07-04): Bumped because episodic memory is now enabled by
// default (no DISABLE_EPISODIC_MEMORY=1). Episodic retrieval adds raw
// conversation snippets to the context, changing retrievalCache content.
// S0-1/S0-2 (2026-07-04): Bumped because facts now carry entities[]/
// proofCount/sourceMemoryIds (schema flowback) and the extraction prompt
// emits entities[] which the EntityStore reads directly. Retrieval cache
// must rebuild so the new field propagation takes effect everywhere.
// Phase 1 (2026-07-05): Bumped for Query Classifier integration.
// classifyQuery is now called per question; sub-questions pre-computed by
// the classifier are reused by runSequentialSelfAsk to avoid redundant
// decomposition LLM calls. Retrieval results themselves are unchanged,
// but the cache is bumped to ensure the new classification stats are
// collected alongside the fresh retrieval pass.
// Phase 2 (2026-07-05): Bumped for Feedback Loop diagnostic integration.
// retrieveWithFeedbackLoop's rewriteQueryForRetrieval is now called per
// question when initial completeness != COMPLETE, generating rewritten
// queries for stats. Does NOT replace retrieval results, but the cache
// is bumped so the new feedbackLoop stats are collected fresh.
// Phase 3 (2026-07-05): Bumped for Self-ask Merge diagnostic integration.
// selfAskDecomposeAndMerge is now called for multi_hop queries to compute
// what the merged arm hits WOULD be, alongside the existing sequential-
// self-ask path. Does NOT replace finalHits, but cache is bumped so the
// new selfAskMerge stats are collected fresh.
// Phase 4 (2026-07-05): Bumped for Unified Judge diagnostic integration.
// judgeWithUnifiedPrompt is now called per question alongside the existing
// frozen judge, comparing verdicts to measure agreement rate. Does NOT
// replace judgeScore used in error taxonomy / report metrics, but cache
// is bumped so the new unifiedJudge stats are collected fresh.
// P0 (2026-07-05): Bumped again for the SOTA-aligned P0 batch:
// - #5 Generous judge 7 rules (BASE_RULES rewritten, promptVersion →
//   unified-v2-generous-7rules-2026-07-05). Old caches would reuse stale
//   judgeScore from the stricter prompt and understate P0 #5's gain.
// - #2 ADDITIVE-only extraction (linkedFactIds + Exhaustive Extraction +
//   Memory Linking + Temporal Anchoring; BUFFERED_EXTRACTION_PROMPT_VERSION
//   → buffered-v4-2026-07-05-additive-p0). Old caches store pre-P0 facts
//   with no linkedFactIds and first-topic-dominance bias.
// - #4 Multiplicative boost α=0.2 + expired_at -20% penalty. applyFinalBoost
//   scoring changes for every fact, so retrievalCache finalHits are stale.
// - #3 Temporal 四元组: expired_at hard filter in the main pipeline +
//   Consolidation prompt Contradiction Detection emitting
//   invalidated_source_indices (invalid_at set on contradicted old facts).
//   Both change the surviving fact set and ordering.
// - #1 Hindsight Observation 2 阶合成层: OBSERVATION_CACHE_VERSION →
//   3.0-p0-1-hindsight-observation. Observations now carry trend/evidence/
//   reason, and the consolidation prompt enforces PREFER UPDATE OVER CREATE
//   + ONE OBSERVATION PER DISTINCT FACET. Old observation caches lack the
//   new fields and the new merge boundaries.
export const DEV_SLICE_CACHE_VERSION = "34.0-audn-lifecycle-2026-07-06";
export const DEV_SLICE_SAMPLE_SEED = 42;
export const DEV_SLICE_SAMPLE_SIZES: Record<string, number> = {
  single_hop: 82,
  temporal: 31,
  multi_hop: 28,
  open_domain: 9,
};

export function createMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fisherYatesShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function buildStratifiedDevSlice<TItem extends StratifiedQaItem<unknown>>(
  allItems: readonly TItem[],
  options: {
    sampleSizes?: Record<string, number>;
    seed?: number;
    excludedCategories?: readonly string[];
  } = {},
): TItem[] {
  const sampleSizes = options.sampleSizes ?? DEV_SLICE_SAMPLE_SIZES;
  const excluded = new Set(options.excludedCategories ?? ["adversarial"]);
  const byCategory = new Map<string, TItem[]>();

  for (const item of allItems) {
    if (excluded.has(item.category)) continue;
    const items = byCategory.get(item.category) ?? [];
    items.push(item);
    byCategory.set(item.category, items);
  }

  const rng = createMulberry32(options.seed ?? DEV_SLICE_SAMPLE_SEED);
  const sampled: TItem[] = [];
  for (const [category, items] of byCategory) {
    const target = sampleSizes[category] ?? 0;
    if (target <= 0) continue;
    sampled.push(...fisherYatesShuffle(items, rng).slice(0, target));
  }
  return sampled;
}

export function isDevSliceCacheValid(
  cache: DevSliceCache,
  options: {
    version?: string;
    sampleSeed?: number;
    sampleSizes?: Record<string, number>;
  } = {},
): boolean {
  const version = options.version ?? DEV_SLICE_CACHE_VERSION;
  const sampleSeed = options.sampleSeed ?? DEV_SLICE_SAMPLE_SEED;
  const sampleSizes = options.sampleSizes ?? DEV_SLICE_SAMPLE_SIZES;

  if (cache.version !== version || cache.sampleSeed !== sampleSeed) return false;
  for (const [category, size] of Object.entries(sampleSizes)) {
    if (cache.sampleSizes[category] !== size) return false;
  }
  return Array.isArray(cache.questions);
}

// Shared full-benchmark sampling contract; values unchanged from the original evaluator.
export const DEFAULT_SAMPLE_SIZES: Record<string, number> = { multi_hop: 96, temporal: 150, single_hop: 127, open_domain: 127 };
export const DEFAULT_SAMPLE_SEED = 42;
