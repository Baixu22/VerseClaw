// Chained retrieval for multi-hop questions.
// Step 1: standard hybrid search. Step 2: entity-relation expansion.
// RRF-fuses Step 1 + Step 2 to surface facts connected via shared entities.
//
// Week 4 v2: 从 maxDepth=2/cap=10 收紧到 maxDepth=1/cap=5 (constrained expansion).
// 新增 causalEdgeFilter 选项: 仅沿 causal/enables 边扩张 (避免噪声).
// 新增 bridgeFactIds 选项: 从桥 fact 出发扩张 (替代 initialHits).
//
// Source: memory-arch-roadmap.md §C.4, Week 4

import {
  extractEntities,
  type HybridSearchHit,
} from "./memory-hybrid-retrieval.js";
import {
  getRelatedFactIds,
} from "./memory-entity-extraction.js";
import type { RuntimeMemoryQueryableFact } from "./memory-context.js";

export type ChainedRetrievalResult = {
  hits: HybridSearchHit[];
  expanded: boolean;
  relatedFactCount: number;
  /** Week 4 v2: 实际扩张的 fact IDs (写入 recall trace) */
  expansionFactIds: string[];
};

/**
 * Week 4 v2: causal 边类型过滤.
 *
 * constrained expansion 仅沿 causal/enables 边扩张, 避免噪声.
 * 当 causalEdgeFilter 启用时, relationMap 应只包含 causal/enables 边.
 *
 * 注意: relationMap 是 factId → factId[] 的邻接表, 边类型隐含在 map 构建时.
 * 调用方应在传入前过滤 relationMap, 只保留 causal 边.
 */
export type ChainedRetrievalOptions = {
  /** 最大扩张深度 (Week 4 v2 默认 1, 旧版默认 2) */
  maxDepth?: number;
  /** 最大扩张 fact 数量 (Week 4 v2 默认 5, 旧版默认 10) */
  maxExpansion?: number;
  /**
   * Week 4 v2: 是否启用 causal 边过滤.
   * 启用时, 调用方应确保 relationMap 只含 causal 边.
   * 此选项仅作为标记, 实际过滤在 relationMap 构建时完成.
   */
  causalEdgeFilter?: boolean;
};

export function chainedRetrievalExpand(
  initialHits: HybridSearchHit[],
  relationMap: Map<string, string[]>,
  factsById: Map<string, RuntimeMemoryQueryableFact>,
  options: ChainedRetrievalOptions = {},
): ChainedRetrievalResult {
  // Week 4 v2: 默认 maxDepth=1, maxExpansion=5 (constrained expansion)
  const { maxDepth = 1, maxExpansion = 5 } = options;

  if (initialHits.length === 0) {
    return {
      hits: initialHits,
      expanded: false,
      relatedFactCount: 0,
      expansionFactIds: [],
    };
  }

  // Collect fact IDs from initial hits
  const initialFactIds = new Set(initialHits.map((h) => h.fact.factId));
  const initialScoreById = new Map(
    initialHits.map((h) => [h.fact.factId, h.rrfScore]),
  );

  // Find related facts via entity relation graph
  const relatedIds: string[] = [];
  for (const factId of initialFactIds) {
    const related = getRelatedFactIds(factId, relationMap, maxDepth);
    for (const rId of related) {
      if (!initialFactIds.has(rId) && factsById.has(rId)) {
        relatedIds.push(rId);
      }
    }
  }

  if (relatedIds.length === 0) {
    return {
      hits: initialHits,
      expanded: false,
      relatedFactCount: 0,
      expansionFactIds: [],
    };
  }

  // Build expansion hits with RRF-style scoring
  // Related facts get a diminishing score based on their position in the expansion
  const expandedHits: HybridSearchHit[] = relatedIds
    .slice(0, maxExpansion)
    .map((factId, idx) => {
      const fact = factsById.get(factId)!;
      const expansionRank = idx + 1;
      const expansionScore = 1 / (60 + expansionRank);
      return {
        fact,
        rrfScore: expansionScore,
        bm25Rank: null,
        vectorRank: null,
        entityRank: null,
        bm25Score: 0,
        vectorScore: 0,
        entityScore: 0,
      };
    });

  // Merge initial + expansion hits, sort by score, deduplicate
  const mergedById = new Map<string, HybridSearchHit>();
  for (const hit of initialHits) {
    mergedById.set(hit.fact.factId, hit);
  }
  for (const hit of expandedHits) {
    const existing = mergedById.get(hit.fact.factId);
    if (existing) {
      existing.rrfScore += hit.rrfScore;
    } else {
      mergedById.set(hit.fact.factId, hit);
    }
  }

  const merged = [...mergedById.values()].sort(
    (a, b) => b.rrfScore - a.rrfScore,
  );

  return {
    hits: merged,
    expanded: true,
    relatedFactCount: relatedIds.length,
    expansionFactIds: expandedHits.map((h) => h.fact.factId),
  };
}

/**
 * Week 4 v2: 从桥 fact 出发做 constrained expansion.
 *
 * 与 chainedRetrievalExpand 的区别:
 *   - 输入是桥 fact IDs (来自 discoverBridges), 而非 initialHits
 *   - 严格 maxDepth=1, cap=5
 *   - 返回 expansion fact IDs (用于回填 Bridge Lift@K)
 *
 * @param bridgeFactIds 桥 fact IDs (来自 discoverBridges)
 * @param relationMap 因果边邻接表 (调用方应过滤为 causal/enables 边)
 * @param factsById 全部 fact 索引
 */
export function constrainedExpansionFromBridge(
  bridgeFactIds: readonly string[],
  relationMap: Map<string, string[]>,
  factsById: Map<string, RuntimeMemoryQueryableFact>,
  options: { maxDepth?: number; maxExpansion?: number } = {},
): {
  expansionFactIds: string[];
  expansionHits: HybridSearchHit[];
} {
  const maxDepth = options.maxDepth ?? 1;
  const maxExpansion = options.maxExpansion ?? 5;

  if (bridgeFactIds.length === 0) {
    return { expansionFactIds: [], expansionHits: [] };
  }

  const relatedIds: string[] = [];
  const bridgeSet = new Set(bridgeFactIds);
  for (const factId of bridgeFactIds) {
    const related = getRelatedFactIds(factId, relationMap, maxDepth);
    for (const rId of related) {
      if (!bridgeSet.has(rId) && factsById.has(rId)) {
        relatedIds.push(rId);
      }
    }
  }

  const expansionFactIds = relatedIds.slice(0, maxExpansion);
  const expansionHits: HybridSearchHit[] = expansionFactIds.map(
    (factId, idx) => {
      const fact = factsById.get(factId)!;
      const expansionRank = idx + 1;
      const expansionScore = 1 / (60 + expansionRank);
      return {
        fact,
        rrfScore: expansionScore,
        bm25Rank: null,
        vectorRank: null,
        entityRank: null,
        bm25Score: 0,
        vectorScore: 0,
        entityScore: 0,
      };
    },
  );

  return { expansionFactIds, expansionHits };
}

export function extractFactEntities(
  facts: readonly RuntimeMemoryQueryableFact[],
): Set<string> {
  const entities = new Set<string>();
  for (const fact of facts) {
    const text = `${fact.subject} ${fact.objectSummary}`;
    for (const e of extractEntities(text)) {
      entities.add(e);
    }
  }
  return entities;
}
