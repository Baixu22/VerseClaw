// Adapted from ragcode-context-engine (MIT), https://github.com/MarshallEriksen-Neura/ragcode
// Source: src/retrieval/hybrid-retriever.ts — semantic branch removed per SPEC §6.3
// ("去掉 semantic 分支即纯 FTS"). What survives verbatim is the fusion core:
// Reciprocal Rank Fusion (fuseHits/rankFusionHits, incl. the k/(k+rank) scaling note)
// and the exact-beats-keyword merge semantics. The recall legs are rewired from
// ragcode's GraphStore contract onto the local FactStore (exact = symbol-name lookup,
// keyword = chunks_fts bm25); the SemanticStore/EmbeddingProvider legs and the
// diagnostics/trace apparatus are not carried over (framework glue, do-not-copy spirit).
import type { CodeChunk } from "../../fact-types.js";
import type { FactStore } from "../../factstore/store.js";
import { rerankWithGraph } from "./graph-reranker.js";
import type { SourceRefV2 } from "../../../runtime-core/knowledge-owner-read.js";
import type { QueryContext } from "./query-context.js";

export interface SearchHit {
  chunk: CodeChunk;
  score: number;
  source: "exact" | "keyword" | "graph";
  reason: string;
  scoreBreakdown?: Record<string, number | undefined>;
}

export interface HybridRetrievalResult {
  hits: SearchHit[];
  exactCount: number;
  keywordCount: number;
}

export interface HybridRetrievalOptions {
  limit?: number;
  disableGraphRerank?: boolean;
  relationshipSources?: readonly SourceRefV2[];
}

/** Exact + keyword recall over the FactStore, fused with RRF, then graph-reranked. */
export function retrieveHybrid(
  store: FactStore,
  repoRoot: string,
  context: QueryContext,
  options: HybridRetrievalOptions = {},
): HybridRetrievalResult {
  const limit = options.limit ?? 20;
  const exactHits = searchExact(store, repoRoot, context, Math.max(20, limit * 2));
  const keywordHits = searchKeyword(store, repoRoot, context, Math.max(40, limit * 4));
  const fused = fuseHits(exactHits, keywordHits);
  const reranked =
    options.disableGraphRerank || !options.relationshipSources
      ? fused
      : rerankWithGraph(store, repoRoot, fused, { admittedSources: options.relationshipSources });
  return {
    hits: reranked.slice(0, limit),
    exactCount: exactHits.length,
    keywordCount: keywordHits.length,
  };
}

function searchExact(
  store: FactStore,
  repoRoot: string,
  context: QueryContext,
  cap: number,
): SearchHit[] {
  const needles = new Set<string>();
  for (const token of context.codeTokens) {
    needles.add(token);
  }
  for (const term of context.lexicalTerms) {
    if ((term.source === "raw" || term.source === "identifier") && term.term.length >= 3) {
      needles.add(term.term);
    }
  }
  const hits: SearchHit[] = [];
  const seenChunks = new Set<string>();
  for (const needle of needles) {
    if (hits.length >= cap) break;
    for (const symbol of store.findSymbolByNameLike(repoRoot, needle)) {
      if (symbol.kind === "file") continue;
      const chunk = chunkForSymbol(store, repoRoot, symbol.filePath, symbol.name, symbol.startLine);
      if (!chunk || seenChunks.has(chunk.id)) continue;
      seenChunks.add(chunk.id);
      const exactness = symbol.name.toLowerCase() === needle.toLowerCase() ? "exact" : "partial";
      hits.push({
        chunk,
        score: exactness === "exact" ? 2 : 1,
        source: "exact",
        reason: `${exactness} symbol match: ${symbol.name} ~ "${needle}"`,
      });
      if (hits.length >= cap) break;
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.chunk.filePath.localeCompare(b.chunk.filePath));
}

function chunkForSymbol(
  store: FactStore,
  repoRoot: string,
  filePath: string,
  symbolName: string,
  startLine: number,
): CodeChunk | undefined {
  const chunks = store.getChunksByFile(repoRoot, filePath);
  return (
    chunks.find((chunk) => chunk.symbolName === symbolName && chunk.startLine === startLine) ??
    chunks.find((chunk) => chunk.symbolName === symbolName) ??
    chunks.find((chunk) => chunk.startLine <= startLine && chunk.endLine >= startLine)
  );
}

function searchKeyword(
  store: FactStore,
  repoRoot: string,
  context: QueryContext,
  cap: number,
): SearchHit[] {
  const terms = context.lexicalTerms.map((term) => term.term).filter((term) => term.length >= 2);
  if (terms.length === 0) return [];
  const weightByTerm = new Map(context.lexicalTerms.map((term) => [term.term, term.weight]));
  return store.searchChunks(repoRoot, terms, cap).map(({ chunk, rank }) => {
    const matched = terms.filter((term) => chunk.content.toLowerCase().includes(term));
    const termScore = matched.reduce((sum, term) => sum + (weightByTerm.get(term) ?? 0.3), 0);
    const rankSignal = Number.isFinite(rank) ? Math.min(0.25, Math.log1p(Math.max(0, -rank))) : 0;
    return {
      chunk,
      score: termScore + rankSignal,
      source: "keyword" as const,
      reason: `FTS MATCH [${matched.slice(0, 4).join(", ")}]; bm25=${Number.isFinite(rank) ? rank.toFixed(6) : "nan"}`,
    };
  });
}

// Reciprocal Rank Fusion (Cormack et al. 2009). Fusion depends only on each
// hit's rank within its own source list, not on raw score magnitude — this is
// what lets us combine exact (integer-ish) and keyword (bm25, ~thousands)
// scores that live on incompatible scales.
//
// Textbook RRF is 1/(k+rank), which tops out around 1/k (~0.016 at k=60) —
// far below the graph proximity boosts added to the fused score later. To keep
// the fused score on a ~0..1 scale we use the order-preserving variant
// k/(k+rank). Scaling by a constant is monotonic, so it does not change RRF ranking.
const RRF_K = 60;

export function fuseHits(exactHits: SearchHit[], keywordHits: SearchHit[]): SearchHit[] {
  const byChunk = new Map<string, SearchHit>();
  for (const hit of rankFusionHits(exactHits, "exact")) {
    mergeHit(byChunk, hit);
  }
  for (const hit of rankFusionHits(keywordHits, "keyword")) {
    mergeHit(byChunk, hit);
  }

  return [...byChunk.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.chunk.filePath.localeCompare(b.chunk.filePath);
  });
}

function rankFusionHits(hits: SearchHit[], label: "exact" | "keyword"): SearchHit[] {
  return hits.map((hit, index) => {
    const rank = index + 1;
    const score = RRF_K / (RRF_K + rank);
    return {
      ...hit,
      score,
      scoreBreakdown: {
        ...hit.scoreBreakdown,
        [label]: hit.score,
        sourceNormalized: score,
        final: score,
      },
      reason: `${hit.reason}; rank fusion ${label} rank ${rank} rrf=${score.toFixed(3)}`,
    };
  });
}

function mergeHit(byChunk: Map<string, SearchHit>, hit: SearchHit): void {
  const existing = byChunk.get(hit.chunk.id);
  if (!existing) {
    byChunk.set(hit.chunk.id, hit);
    return;
  }

  byChunk.set(hit.chunk.id, {
    ...existing,
    score: existing.score + hit.score,
    scoreBreakdown: {
      ...existing.scoreBreakdown,
      ...hit.scoreBreakdown,
      exact: existing.scoreBreakdown?.exact ?? hit.scoreBreakdown?.exact,
      keyword: existing.scoreBreakdown?.keyword ?? hit.scoreBreakdown?.keyword,
      sourceNormalized:
        (existing.scoreBreakdown?.sourceNormalized ?? existing.score) +
        (hit.scoreBreakdown?.sourceNormalized ?? hit.score),
      final: existing.score + hit.score,
    },
    source: existing.source === "exact" || hit.source === "exact" ? "exact" : existing.source,
    reason: `${existing.reason}; ${hit.reason}`,
  });
}
