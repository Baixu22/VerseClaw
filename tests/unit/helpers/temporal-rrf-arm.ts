// P2-3: Temporal Independent RRF Arm + 8-Bucket Coverage (Hindsight-inspired).
//
// Source: hindsight-main/hindsight-api-slim/hindsight_api/engine/retrieve/temporal_rrf.py
//
// Hindsight treats temporal matching as an independent RRF arm alongside
// BM25, Vector, and Entity arms. This ensures temporal-relevant facts get
// a ranking boost even when they score poorly on lexical or semantic
// similarity — critical for "when did X happen?" queries.
//
// Additionally, Hindsight divides the timeline into 8 equal-sized buckets
// and ensures coverage across buckets. This prevents recent-fact dominance:
// without bucketing, a query about "last year" might return 10 facts all
// from this month because they're all semantically related.
//
// Integration:
//   temporalHits = temporalRRFArm(query, facts, referenceTime, options)
//   merged = mergeRRF([bm25Hits, vectorHits, entityHits, graphHits, temporalHits])
//
// The temporal arm scores facts by:
// 1. Temporal relevance: how close the fact's valid_at is to the query's
//    extracted time (if any). Decay: exp(-Δt / halfLife).
// 2. Bucket coverage: prefer facts from under-represented buckets so the
//    final result set spans the full timeline.

import type { RuntimeMemoryQueryableFact } from "../../openclaw_runtime/src/runtime-core/memory-context";
import type { HybridSearchHit } from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";

export type TemporalRRFOptions = {
  /** Reference time for the query (ms since epoch). Required. */
  referenceTime: number;
  /**
   * Query-extracted time constraint, if any. When provided, facts close to
   * this time get the highest temporal score. When undefined, the query is
   * treated as "all-time" and bucket coverage dominates.
   */
  queryTime?: number;
  /** Half-life for temporal decay (ms). Default 180 days. */
  halfLifeMs?: number;
  /** Number of timeline buckets for coverage. Default 8. */
  bucketCount?: number;
  /** Top-K facts to return from this arm. Default 30. */
  topK?: number;
  /** RRF k parameter for score conversion. Default 60. */
  rrfK?: number;
  /**
   * Span of the timeline covered by buckets. Default "auto" = min/max of
   * fact valid_at. Can be set explicitly as [startMs, endMs].
   */
  bucketSpan?: [number, number] | "auto";
};

/**
 * Compute the temporal relevance score for a fact ∈ [0, 1].
 *   score = exp(-|factTime - queryTime| / halfLife)
 * When queryTime is undefined (all-time query), all facts get 0.5 (neutral)
 * so bucket coverage alone drives the ranking.
 */
export function temporalRelevanceScore(
  factValidAt: number,
  queryTime: number | undefined,
  halfLifeMs: number,
): number {
  if (queryTime === undefined) return 0.5;
  const delta = Math.abs(factValidAt - queryTime);
  return Math.exp(-delta / halfLifeMs);
}

/**
 * Assign each fact to a timeline bucket [0, bucketCount-1].
 * Buckets are equal-sized intervals over the span [spanStart, spanEnd].
 */
export function assignBucket(
  factTime: number,
  spanStart: number,
  spanEnd: number,
  bucketCount: number,
): number {
  if (spanEnd <= spanStart) return 0;
  const t = Math.max(spanStart, Math.min(spanEnd, factTime));
  const normalized = (t - spanStart) / (spanEnd - spanStart);
  return Math.min(bucketCount - 1, Math.floor(normalized * bucketCount));
}

/**
 * Compute bucket coverage bonus for a fact.
 * Facts in under-represented buckets get a bonus so the final result set
 * spans the full timeline. The bonus is inversely proportional to the
 * bucket's current selection count.
 *
 *   bonus = 1 / (1 + selectedCount[bucket])
 */
export function bucketCoverageBonus(
  bucket: number,
  selectedCountByBucket: ReadonlyArray<number>,
): number {
  const count = selectedCountByBucket[bucket] ?? 0;
  return 1 / (1 + count);
}

/**
 * Temporal RRF arm: rank facts by temporal relevance + bucket coverage.
 *
 * Algorithm:
 * 1. Compute spanStart/spanEnd from facts (or use provided span).
 * 2. Assign each fact to a bucket.
 * 3. Sort facts by temporalRelevanceScore descending.
 * 4. Greedily select top-K facts, applying bucket coverage bonus:
 *    - For each candidate, compute combinedScore = relevance + coverageBonus.
 *    - Update selectedCountByBucket after each pick.
 *    - This naturally diversifies across buckets.
 * 5. Convert selected facts to HybridSearchHit with rrfScore.
 */
export function temporalRRFArm(
  facts: ReadonlyArray<RuntimeMemoryQueryableFact>,
  options: TemporalRRFOptions,
): HybridSearchHit[] {
  const {
    referenceTime,
    queryTime,
    halfLifeMs = 180 * 24 * 60 * 60 * 1000,
    bucketCount = 8,
    topK = 30,
    rrfK = 60,
    bucketSpan = "auto",
  } = options;

  if (facts.length === 0) return [];

  // Compute span.
  let spanStart: number;
  let spanEnd: number;
  if (bucketSpan === "auto") {
    const times = facts
      .map((f) => f.valid_at)
      .filter((t): t is number => typeof t === "number" && Number.isFinite(t));
    if (times.length === 0) return [];
    spanStart = Math.min(...times);
    spanEnd = Math.max(...times, referenceTime);
    if (spanEnd <= spanStart) {
      spanEnd = spanStart + 1; // avoid divide-by-zero
    }
  } else {
    [spanStart, spanEnd] = bucketSpan;
  }

  // Score and bucket each fact.
  const scored = facts.map((fact) => {
    const factTime = typeof fact.valid_at === "number" ? fact.valid_at : referenceTime;
    const relevance = temporalRelevanceScore(factTime, queryTime, halfLifeMs);
    const bucket = assignBucket(factTime, spanStart, spanEnd, bucketCount);
    return { fact, relevance, bucket, factTime };
  });

  // Sort by relevance descending (initial order before coverage adjustment).
  scored.sort((a, b) => b.relevance - a.relevance);

  // Greedy selection with bucket coverage bonus.
  const selectedCountByBucket = new Array<number>(bucketCount).fill(0);
  const selected: Array<{
    fact: RuntimeMemoryQueryableFact;
    combinedScore: number;
    bucket: number;
  }> = [];

  for (const candidate of scored) {
    if (selected.length >= topK) break;
    const coverageBonus = bucketCoverageBonus(
      candidate.bucket,
      selectedCountByBucket,
    );
    // Weight: 70% relevance, 30% coverage (Hindsight default).
    const combinedScore = 0.7 * candidate.relevance + 0.3 * coverageBonus;
    selected.push({
      fact: candidate.fact,
      combinedScore,
      bucket: candidate.bucket,
    });
    selectedCountByBucket[candidate.bucket]++;
  }

  // Sort selected by combinedScore descending (final rank).
  selected.sort((a, b) => b.combinedScore - a.combinedScore);

  // Convert to HybridSearchHit with RRF score.
  return selected.map((item, idx) => ({
    fact: item.fact,
    rrfScore: 1 / (rrfK + idx + 1),
    bm25Rank: null,
    vectorRank: null,
    entityRank: null,
    bm25Score: 0,
    vectorScore: 0,
    entityScore: 0,
  }));
}

/**
 * Extract a query time from a natural-language question.
 * Returns undefined when no time constraint is found (all-time query).
 *
 * This is a lightweight heuristic — the full query-time-extractor.ts
 * handles more cases (relative dates, "recently", "currently"). This
 * helper covers the common absolute-date patterns so the temporal arm
 * can be used standalone without importing the full extractor.
 */
export function extractQueryTimeHeuristic(
  question: string,
  referenceTime: number,
): number | undefined {
  const lower = question.toLowerCase();

  // "recently" / "currently" / "now" → referenceTime
  if (/\b(recently|currently|now|lately)\b/.test(lower)) {
    return referenceTime;
  }

  // "last week" / "last month" / "last year"
  const lastMatch = lower.match(/\blast (week|month|year)\b/);
  if (lastMatch) {
    const unit = lastMatch[1];
    const ms =
      unit === "week"
        ? 7 * 24 * 60 * 60 * 1000
        : unit === "month"
          ? 30 * 24 * 60 * 60 * 1000
          : 365 * 24 * 60 * 60 * 1000;
    return referenceTime - ms;
  }

  // "X years ago" / "X months ago" / "X weeks ago"
  const agoMatch = lower.match(/(\d+)\s+(year|month|week|day)s?\s+ago/);
  if (agoMatch) {
    const n = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    const ms =
      unit === "year"
        ? n * 365 * 24 * 60 * 60 * 1000
        : unit === "month"
          ? n * 30 * 24 * 60 * 60 * 1000
          : unit === "week"
            ? n * 7 * 24 * 60 * 60 * 1000
            : n * 24 * 60 * 60 * 1000;
    return referenceTime - ms;
  }

  // Absolute date: "March 2023", "March 15 2023", "2023-03-15", etc.
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const monthAbbr = monthNames.map((m) => m.slice(0, 3));

  // "Month DD, YYYY" or "Month YYYY"
  for (let i = 0; i < monthNames.length; i++) {
    const re = new RegExp(
      `\\b(${monthNames[i]}|${monthAbbr[i]})\\s+(\\d{1,2})?,?\\s*(\\d{4})\\b`,
      "i",
    );
    const m = lower.match(re);
    if (m) {
      const day = m[2] ? parseInt(m[2], 10) : 1;
      const year = parseInt(m[3], 10);
      return Date.UTC(year, i, day);
    }
  }

  // "YYYY-MM" or "YYYY-MM-DD"
  const isoMatch = lower.match(/\b(\d{4})-(\d{1,2})(?:-(\d{1,2}))?\b/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = isoMatch[3] ? parseInt(isoMatch[3], 10) : 1;
    return Date.UTC(year, month, day);
  }

  return undefined;
}
