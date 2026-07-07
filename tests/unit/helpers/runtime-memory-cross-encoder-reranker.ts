// Cross-encoder reranker via SiliconFlow API.
// Uses BAAI/bge-reranker-v2-m3 (multilingual, top-tier on MTEB rerank benchmarks).
// Falls back to no-op rerank when SiliconFlow API key is missing (CI-safe).
//
// Hindsight-aligned: RRF top-300 -> cross-encoder rerank -> final top-K.
// This is the唯一真正缺失的能力 — four SOTA frameworks (Hindsight/Mem0/Memobase/Zep)
// all use cross-encoder reranking; we did not have it before.

import { request } from "undici";
import type { RuntimeMemoryQueryableFact } from "../../../openclaw_runtime/src/runtime-core/memory-context";
import type { HybridSearchHit } from "../../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";

const SILICONFLOW_RERANK_URL = "https://api.siliconflow.cn/v1/rerank";
const RERANK_MODEL = "BAAI/bge-reranker-v2-m3";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

export type RerankCandidate = {
  id: string;
  text: string;
};

export type RerankResult = {
  id: string;
  score: number;
  originalIndex: number;
};

export function hasSiliconFlowRerankKey(): boolean {
  return (
    typeof process.env.SILICONFLOW_API_KEY === "string" &&
    process.env.SILICONFLOW_API_KEY.length > 0
  );
}

/**
 * Call SiliconFlow rerank API. Returns scores in [0, 1] for each candidate.
 * Higher score = more relevant to the query.
 */
export async function rerankCandidates(
  query: string,
  candidates: readonly RerankCandidate[],
  topK?: number,
  options: { timeoutMs?: number } = {},
): Promise<RerankResult[]> {
  if (candidates.length === 0) return [];
  if (!hasSiliconFlowRerankKey()) {
    // No-op fallback: return original order with neutral score.
    return candidates.map((c, i) => ({
      id: c.id,
      score: 1 - i / Math.max(candidates.length, 1),
      originalIndex: i,
    }));
  }

  const apiKey = process.env.SILICONFLOW_API_KEY!;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const lastError: unknown = (undefined as unknown);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = JSON.stringify({
        model: RERANK_MODEL,
        query,
        documents: candidates.map((c) => c.text),
        top_n: topK ?? candidates.length,
        return_documents: false,
      });
      const res = await request(SILICONFLOW_RERANK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.statusCode >= 500 && attempt < MAX_RETRIES) {
        await delay(500 * attempt);
        continue;
      }
      if (res.statusCode !== 200) {
        const text = await res.body.text();
        throw new Error(`SiliconFlow rerank API ${res.statusCode}: ${text}`);
      }
      const data = (await res.body.json()) as {
        results: Array<{ index: number; relevance_score: number }>;
      };
      if (!data.results || data.results.length === 0) {
        return candidates.map((c, i) => ({
          id: c.id,
          score: 0,
          originalIndex: i,
        }));
      }
      return data.results.map((r) => ({
        id: candidates[r.index]?.id ?? String(r.index),
        score: r.relevance_score,
        originalIndex: r.index,
      }));
    } catch (err) {
      clearTimeout(timer);
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        await delay(500 * attempt);
        continue;
      }
      // On final failure, return original order with neutral score (graceful degradation).
      return candidates.map((c, i) => ({
        id: c.id,
        score: 1 - i / Math.max(candidates.length, 1),
        originalIndex: i,
      }));
    }
  }
  // Unreachable but TS needs it.
  void lastError;
  return candidates.map((c, i) => ({
    id: c.id,
    score: 1 - i / Math.max(candidates.length, 1),
    originalIndex: i,
  }));
}

/**
 * Rerank HybridSearchHit[] using cross-encoder. Returns top-K hits sorted by
 * rerank score, with the rerank score written to BOTH `ceScore` (new S0-3
 * field, the canonical CE signal) and `rrfScore` (kept in sync for backward
 * compat with downstream code that reads rrfScore).
 *
 * S0-3: the original rrfScore is preserved in `bm25Score` for diagnostics,
 * and the CE score is now available as `hit.ceScore` so applyFinalBoost and
 * applyEntityBoost can read it explicitly (mem-status §3 断裂点 2).
 */
export async function rerankHybridHits(
  query: string,
  hits: readonly HybridSearchHit[],
  topK: number = 10,
): Promise<HybridSearchHit[]> {
  if (hits.length === 0) return [];
  if (hits.length <= topK) {
    // No need to rerank if we already have few enough candidates.
    // S0-3: still stamp ceScore = rrfScore so downstream boosters see a CE
    // signal even without reranking (graceful degradation).
    return hits.map((h) => ({ ...h, ceScore: h.ceScore ?? h.rrfScore }));
  }

  const candidates: RerankCandidate[] = hits.map((h, i) => ({
    id: `${i}-${h.fact.factId}`,
    text: `${h.fact.subject} ${h.fact.predicate}: ${h.fact.objectSummary}`,
  }));

  const results = await rerankCandidates(query, candidates, topK);

  return results
    .map((r) => {
      const original = hits[r.originalIndex];
      if (!original) return null;
      // S0-3: write ceScore explicitly. Keep rrfScore in sync so legacy
      // downstream code (which may still sort by rrfScore) sees the
      // rerank-informed order. Preserve original rrfScore in bm25Score.
      return {
        ...original,
        bm25Score: original.rrfScore,
        ceScore: r.score,
        rrfScore: r.score,
      } as HybridSearchHit;
    })
    .filter((h): h is HybridSearchHit => h !== null)
    .sort((a, b) => (b.ceScore ?? b.rrfScore) - (a.ceScore ?? a.rrfScore))
    .slice(0, topK);
}

/**
 * Apply final boost (Hindsight ce_norm * recency * temporal * proof_count).
 *
 * S0-3: ceNorm now reads `hit.ceScore` (the explicit cross-encoder signal)
 * with fallback to `hit.rrfScore` when no reranker was run. proof_count now
 * reads `hit.fact.proofCount` (the schema-flowback field from S0-1) with
 * fallback to `evidenceRefs.length` for legacy facts. This makes the
 * Hindsight combined_score formula fully wired (mem-status §3 断裂点 2 + 8).
 */
export function applyFinalBoost(
  hits: readonly HybridSearchHit[],
  referenceTime: number | undefined,
): HybridSearchHit[] {
  if (referenceTime === undefined) return [...hits];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const YEAR_MS = 365 * DAY_MS;
  return hits
    .map((hit) => {
      // S0-3: prefer explicit ceScore; fall back to rrfScore when no
      // cross-encoder reranker was run (e.g. CI without API key).
      const ceBase = hit.ceScore ?? hit.rrfScore;
      const ceNorm = Math.max(0, Math.min(1, ceBase));
      // P0 #4 (Hindsight multiplicative boost): recency α=0.2 (was 0.1).
      // Hindsight归因 retrieval algorithm 三大 boost 之一，α=0.2 让 recency
      // 信号更强，但仍在 ±20% 范围内不会压过 cross-encoder 相关性判断。
      // Source: hindsight-main/hindsight-api-slim/hindsight_api/engine/search/reranking.py
      const delta = Math.abs(referenceTime - hit.fact.valid_at);
      const recency = 1 + 0.2 * Math.exp(-delta / YEAR_MS);
      // P0 #4 (Hindsight temporal validity): α=0.2 (was 0.1).
      // +20% if fact is still valid at referenceTime, -20% if expired.
      // Hindsight 用 invalid_at 做 validity gate，我们用 multiplicative 软惩罚。
      const isStillValid =
        hit.fact.invalid_at === undefined || hit.fact.invalid_at > referenceTime;
      const isExpired =
        hit.fact.expired_at !== undefined && hit.fact.expired_at <= referenceTime;
      const temporal = isExpired ? 0.8 : isStillValid ? 1.2 : 1.0;
      // S0-3: proof_count — prefer the schema-flowback field (proofCount,
      // populated by S0-1 from observation consolidation), fall back to
      // evidenceRefs.length for legacy facts. +5% per proof, capped at +25%.
      // Hindsight α=0.1，我们保持 +5%/proof cap 5 (≈+25%)。
      const proofCountValue =
        typeof hit.fact.proofCount === "number" && hit.fact.proofCount > 0
          ? hit.fact.proofCount
          : (hit.fact.evidenceRefs?.length ?? 0);
      const proofCount = 1 + 0.05 * Math.min(proofCountValue, 5);
      const combined = ceNorm * recency * temporal * proofCount;
      return {
        ...hit,
        ceScore: ceNorm,
        rrfScore: combined,
      };
    })
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|UND_ERR/i.test(err.message)) {
      return true;
    }
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Suppress unused import warning — used by callers that pass facts directly.
export type _FactRef = RuntimeMemoryQueryableFact;
