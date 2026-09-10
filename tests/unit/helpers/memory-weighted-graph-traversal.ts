// Item 5 v2: Hindsight-style weighted graph traversal (Hindsight §2.4 / retrieval.md).
//
// Replaces simple BFS (all edges equal weight) with Hindsight's additive scoring:
//   graph_score = entity_score + semantic_score + causal_score  ∈ [0, 3]
//
// - entity_score: tanh(sharedEntities × 0.5)  — saturates at ~0.91 for 3+ shared
// - semantic_score: cosine(queryEmbedding, factEmbedding) ∈ [0, 1]
// - causal_score: P1-1 (Hindsight Memory Graph causal edges).
//   Scored ∈ [0, 1] based on relation_type confidence:
//     causes/caused_by: 1.0 (direct causation, strongest signal)
//     enables:          0.7 (enabling condition, medium strength)
//     prevents:         0.5 (negative constraint, useful but weaker for recall)
//     related_to:       0.2 (weak semantic link, mostly handled by entity_score)
//   When a fact is reachable via multiple causal edges along the traversal
//   path, causal_score = min(1.0, Σ edge_scores) — chains of evidence
//   reinforce each other, mirroring Hindsight's agentic loop reasoning.
//
// Key differences from simple BFS:
// 1. Edges have weights — strong entity overlap ranks higher than weak
// 2. Traversal is priority-queue (best-first), not breadth-first
// 3. graph_score becomes an independent RRF arm (not post-processing)
// 4. Budget-based (top-N candidates), not depth-based
// 5. P1-1: causal edges (causes/caused_by/enables/prevents) add a third
//   scoring component, enabling multi-hop reasoning over causal chains
//   rather than just entity co-occurrence
//
// This makes multi-hop safe: weak transitive edges get low scores and are
// naturally pruned, while strong entity-connected facts rise to the top.

import type { HybridSearchHit } from "../../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import type {
  RuntimeMemoryQueryableFact,
  RuntimeMemoryFactRelation,
} from "../../../openclaw_runtime/src/runtime-core/memory-context";
import type { EntityStoreLike } from "../../../openclaw_runtime/src/runtime-core/memory-entity-extraction";

// P1-1: causal edge weight map. Mirrors Hindsight's memory_graph.py scoring.
const CAUSAL_EDGE_WEIGHT: Record<string, number> = {
  causes: 1.0,
  caused_by: 1.0,
  enables: 0.7,
  prevents: 0.5,
  related_to: 0.2,
};

export type WeightedGraphEdge = {
  sourceFactId: string;
  targetFactId: string;
  entityScore: number; // tanh(sharedEntities × 0.5), ∈ [0, ~0.91]
  sharedEntities: string[];
  // P1-1 (Hindsight causal edges): causal score contribution from explicit
  // fact relations (causes/caused_by/enables/prevents/related_to).
  // 0 when no causal relation exists between the two facts.
  causalScore: number;
  // P1-1: the relation type that produced this edge's causalScore, if any.
  // Useful for debugging / explainability. Undefined for pure entity edges.
  causalRelationType?: string;
};

export type WeightedGraphTraversalOptions = {
  /**
   * Max candidates to return from graph traversal. Hindsight high=1000,
   * we use 30 as a balanced default (enough for multi-hop, not too noisy).
   */
  budget?: number;
  /**
   * Max BFS depth. Hindsight doesn't expose this directly (uses budget),
   * but we keep it as a safety cap. Default 3.
   */
  maxDepth?: number;
  /**
   * Min entity score threshold for an edge to be considered. Default 0
   * (include all). Set to 0.46 (1 shared entity) to prune weak edges.
   */
  minEntityScore?: number;
  /**
   * Weight for entity signal in additive scoring. Default 1.0.
   */
  entityWeight?: number;
  /**
   * Weight for semantic signal in additive scoring. Default 1.0.
   */
  semanticWeight?: number;
  /**
   * P1-1 (Hindsight causal edges): weight for causal signal in additive
   * scoring. Default 1.0. Set to 0 to disable causal edges (A/B test).
   */
  causalWeight?: number;
  /**
   * P1-1: explicit fact relations (causes/caused_by/enables/prevents/related_to).
   * When provided, buildWeightedEdges adds causal edges alongside entity edges.
   * Source: RuntimeMemoryFactRelation[] from the persistence layer.
   */
  relations?: ReadonlyArray<RuntimeMemoryFactRelation>;
};

export type WeightedGraphTraversalResult = {
  hits: GraphTraversalHit[];
  expanded: boolean;
  edgeCount: number;
};

export type GraphTraversalHit = {
  fact: RuntimeMemoryQueryableFact;
  /**
   * Additive graph score:
   *   entity_score × entityWeight + semantic_score × semanticWeight + causal_score × causalWeight
   * Range [0, 3] when all weights are 1.0.
   */
  graphScore: number;
  entityScore: number;
  semanticScore: number;
  // P1-1: causal score component from explicit fact relations.
  causalScore: number;
  sharedEntities: string[];
  hopDistance: number;
  // P1-1: the causal relation types traversed to reach this fact, if any.
  causalPath: string[];
};

/**
 * Build weighted edges from EntityStore's reverse index.
 * For each fact, finds related facts via shared entities and computes
 * entity_score = tanh(sharedCount × 0.5).
 *
 * P1-1 (Hindsight causal edges): when `relations` is provided, also adds
 * causal edges from explicit fact relations (causes/caused_by/enables/
 * prevents/related_to). Causal edges supplement entity edges: a fact pair
 * with both entity overlap and a causal relation gets both scores summed.
 *
 * This is O(n × avg_entities_per_fact) — much cheaper than O(n²) pairwise.
 */
export function buildWeightedEdges(
  factIds: readonly string[],
  entityStore: EntityStoreLike,
  options: {
    minEntityScore?: number;
    // P1-1: explicit fact relations for causal edge construction.
    relations?: ReadonlyArray<RuntimeMemoryFactRelation>;
  } = {},
): WeightedGraphEdge[] {
  const minScore = options.minEntityScore ?? 0;
  const edges: WeightedGraphEdge[] = [];
  const seen = new Set<string>();
  const factIdSet = new Set(factIds);

  // P1-1: index relations by both endpoints so we can look up causal score
  // for any fact pair regardless of edge direction. Use the highest-confidence
  // relation when multiple relations exist between the same pair.
  const causalByPair = new Map<string, { score: number; type: string }>();
  if (options.relations) {
    for (const rel of options.relations) {
      // Skip relations pointing to facts outside the current candidate set.
      if (!factIdSet.has(rel.sourceFactId) || !factIdSet.has(rel.targetFactId)) {
        continue;
      }
      const key =
        rel.sourceFactId < rel.targetFactId
          ? `${rel.sourceFactId}|${rel.targetFactId}`
          : `${rel.targetFactId}|${rel.sourceFactId}`;
      const weight = CAUSAL_EDGE_WEIGHT[rel.relationType] ?? 0;
      if (weight <= 0) continue;
      const confidence = typeof rel.confidence === "number" ? rel.confidence : 1.0;
      const score = weight * Math.max(0, Math.min(1, confidence));
      const existing = causalByPair.get(key);
      if (!existing || score > existing.score) {
        causalByPair.set(key, { score, type: rel.relationType });
      }
    }
  }

  for (const factId of factIds) {
    const entities = entityStore.getFactEntities(factId);
    if (!entities || entities.size === 0) continue;

    // Collect candidate related facts via reverse index
    const candidates = new Map<string, Set<string>>(); // otherFactId → shared entities
    for (const entity of entities) {
      const factIdsForEntity = entityStore.getFactsForEntity(entity);
      if (!factIdsForEntity) continue;
      for (const otherFactId of factIdsForEntity) {
        if (otherFactId === factId) continue;
        if (!candidates.has(otherFactId)) {
          candidates.set(otherFactId, new Set());
        }
        candidates.get(otherFactId)!.add(entity);
      }
    }

    // Create edges with entity scores
    for (const [otherFactId, sharedEnts] of candidates) {
      const edgeKey = factId < otherFactId
        ? `${factId}|${otherFactId}`
        : `${otherFactId}|${factId}`;
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);

      const sharedCount = sharedEnts.size;
      const entityScore = Math.tanh(sharedCount * 0.5);
      if (entityScore < minScore) continue;

      // P1-1: look up causal score for this fact pair.
      const causal = causalByPair.get(edgeKey);
      const causalScore = causal?.score ?? 0;

      edges.push({
        sourceFactId: factId,
        targetFactId: otherFactId,
        entityScore,
        sharedEntities: [...sharedEnts],
        causalScore,
        ...(causal ? { causalRelationType: causal.type } : {}),
      });
    }
  }

  // P1-1: add pure causal edges (no entity overlap) so causal chains can
  // reach facts that share no entities with the seed set. This is critical
  // for multi-hop reasoning — e.g., "started job" → "moved city" may share
  // no entities but are strongly causally linked.
  if (options.relations) {
    for (const [edgeKey, causal] of causalByPair) {
      if (seen.has(edgeKey)) continue; // already added as entity edge
      seen.add(edgeKey);
      const [a, b] = edgeKey.split("|");
      edges.push({
        sourceFactId: a,
        targetFactId: b,
        entityScore: 0,
        sharedEntities: [],
        causalScore: causal.score,
        causalRelationType: causal.type,
      });
    }
  }

  return edges;
}

/**
 * Hindsight-style weighted graph traversal.
 *
 * Algorithm:
 * 1. Start from initial hits (seed set)
 * 2. Build weighted edges from EntityStore
 * 3. Best-first traversal: expand edges in priority order (highest entity_score first)
 * 4. For each expanded fact, compute graph_score = entity_score + semantic_score
 * 5. Return top-N by graph_score
 *
 * The semantic_score is computed as cosine similarity between the query
 * embedding and the fact's embedding. This rewards facts that are both
 * structurally connected (entity overlap) AND semantically relevant.
 *
 * Unlike simple BFS, this naturally prunes weak transitive edges because:
 * - Edges with no entity overlap get entity_score=0 and are not traversed
 * - semantic_score provides a query-dependent anchor: facts semantically
 *   distant from the query won't rank high even if structurally connected
 * - Priority queue ensures strong edges are explored first
 */
export function weightedGraphTraversal(
  initialHits: readonly HybridSearchHit[],
  factsById: Map<string, RuntimeMemoryQueryableFact>,
  entityStore: EntityStoreLike,
  queryEmbedding: Float32Array,
  factEmbeddings: Map<string, Float32Array>,
  options: WeightedGraphTraversalOptions = {},
): WeightedGraphTraversalResult {
  const {
    budget = 30,
    maxDepth = 3,
    minEntityScore = 0,
    entityWeight = 1.0,
    semanticWeight = 1.0,
    causalWeight = 1.0,
    relations,
  } = options;

  if (initialHits.length === 0) {
    return { hits: [], expanded: false, edgeCount: 0 };
  }

  // Seed set: fact IDs from initial hits
  const seedIds = new Set(initialHits.map((h) => h.fact.factId));
  const seedVectorScores = new Map<string, number>();
  for (const hit of initialHits) {
    seedVectorScores.set(hit.fact.factId, hit.vectorScore);
  }

  // Build adjacency list from EntityStore + P1-1 causal relations
  const allFactIds = [...factsById.keys()];
  const edges = buildWeightedEdges(allFactIds, entityStore, {
    minEntityScore,
    relations,
  });

  // Build adjacency: factId → list of (neighbor, edge)
  const adjacency = new Map<string, WeightedGraphEdge[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.sourceFactId)) {
      adjacency.set(edge.sourceFactId, []);
    }
    if (!adjacency.has(edge.targetFactId)) {
      adjacency.set(edge.targetFactId, []);
    }
    adjacency.get(edge.sourceFactId)!.push(edge);
    // Reverse edge (same entity/causal score, swapped direction)
    adjacency.get(edge.targetFactId)!.push({
      sourceFactId: edge.targetFactId,
      targetFactId: edge.sourceFactId,
      entityScore: edge.entityScore,
      sharedEntities: edge.sharedEntities,
      causalScore: edge.causalScore,
      ...(edge.causalRelationType ? { causalRelationType: edge.causalRelationType } : {}),
    });
  }

  // Best-first traversal with priority queue (max-heap by combined entity+causal score)
  // Track visited, hop distance, and best entity/causal score paths
  const visited = new Set<string>(seedIds);
  const hopDistance = new Map<string, number>();
  for (const id of seedIds) hopDistance.set(id, 0);
  const bestEntityScore = new Map<string, number>();
  const bestCausalScore = new Map<string, number>();
  const bestSharedEntities = new Map<string, Set<string>>();
  const bestCausalPath = new Map<string, string[]>();
  const bestPath = new Map<string, string[]>(); // factId → path from seed

  // Priority queue: combined score = entityScore + causalScore (both ∈ [0, ~1])
  const pq: Array<{
    score: number;
    factId: string;
    depth: number;
    path: string[];
    shared: string[];
    causalScore: number;
    causalPath: string[];
  }> = [];
  for (const seedId of seedIds) {
    const neighbors = adjacency.get(seedId) ?? [];
    for (const edge of neighbors) {
      if (visited.has(edge.targetFactId)) continue;
      const combinedScore = edge.entityScore + edge.causalScore;
      const causalPath =
        edge.causalRelationType !== undefined ? [edge.causalRelationType] : [];
      pq.push({
        score: combinedScore,
        factId: edge.targetFactId,
        depth: 1,
        path: [seedId, edge.targetFactId],
        shared: edge.sharedEntities,
        causalScore: edge.causalScore,
        causalPath,
      });
    }
  }
  pq.sort((a, b) => b.score - a.score);

  const maxIterations = budget * 10; // safety cap
  let iterations = 0;

  while (pq.length > 0 && iterations < maxIterations) {
    iterations++;
    const next = pq.shift()!;
    if (visited.has(next.factId)) continue;
    if (next.depth > maxDepth) continue;
    if (!factsById.has(next.factId)) continue;

    visited.add(next.factId);
    hopDistance.set(next.factId, next.depth);
    bestEntityScore.set(next.factId, next.score - next.causalScore);
    bestCausalScore.set(next.factId, next.causalScore);
    bestSharedEntities.set(next.factId, new Set(next.shared));
    bestCausalPath.set(next.factId, next.causalPath);
    bestPath.set(next.factId, next.path);

    // Expand neighbors
    const neighbors = adjacency.get(next.factId) ?? [];
    for (const edge of neighbors) {
      if (visited.has(edge.targetFactId)) continue;
      if (next.depth + 1 > maxDepth) continue;
      // Aggregate shared entities along the path
      const aggregatedShared = new Set(next.shared);
      for (const e of edge.sharedEntities) aggregatedShared.add(e);
      const aggregatedEntityScore = Math.tanh(aggregatedShared.size * 0.5);
      // P1-1: aggregate causal score along path. Chains of evidence
      // reinforce: causes→causes = 1.0 + 1.0 = 2.0, capped at 1.0.
      const aggregatedCausalScore = Math.min(
        1.0,
        next.causalScore + edge.causalScore,
      );
      const aggregatedCausalPath = edge.causalRelationType
        ? [...next.causalPath, edge.causalRelationType]
        : next.causalPath;
      const combinedScore = aggregatedEntityScore + aggregatedCausalScore;
      pq.push({
        score: combinedScore,
        factId: edge.targetFactId,
        depth: next.depth + 1,
        path: [...next.path, edge.targetFactId],
        shared: [...aggregatedShared],
        causalScore: aggregatedCausalScore,
        causalPath: aggregatedCausalPath,
      });
    }
    // Re-sort to maintain priority order
    pq.sort((a, b) => b.score - a.score);
    if (visited.size - seedIds.size >= budget * 2) break; // over-fetch 2x, then trim
  }

  // Compute graph_score for all visited non-seed facts
  const traversalHits: GraphTraversalHit[] = [];
  for (const factId of visited) {
    if (seedIds.has(factId)) continue; // skip seeds, they're in initialHits
    const fact = factsById.get(factId);
    if (!fact) continue;

    const entityScore = bestEntityScore.get(factId) ?? 0;
    const sharedEnts = bestSharedEntities.get(factId) ?? new Set<string>();
    const causalScore = bestCausalScore.get(factId) ?? 0;
    const causalPath = bestCausalPath.get(factId) ?? [];

    // Semantic score: cosine(queryEmbedding, factEmbedding)
    const factEmb = factEmbeddings.get(factId);
    let semanticScore = 0;
    if (factEmb && factEmb.length === queryEmbedding.length) {
      semanticScore = cosineSimilarity(queryEmbedding, factEmb);
      // Clamp to [0, 1] — cosine can be negative
      semanticScore = Math.max(0, Math.min(1, semanticScore));
    }

    const graphScore =
      entityScore * entityWeight +
      semanticScore * semanticWeight +
      causalScore * causalWeight;

    traversalHits.push({
      fact,
      graphScore,
      entityScore,
      semanticScore,
      causalScore,
      sharedEntities: [...sharedEnts],
      hopDistance: hopDistance.get(factId) ?? 0,
      causalPath,
    });
  }

  // Sort by graph_score descending, take top budget
  traversalHits.sort((a, b) => b.graphScore - a.graphScore);
  const topHits = traversalHits.slice(0, budget);

  return {
    hits: topHits,
    expanded: topHits.length > 0,
    edgeCount: edges.length,
  };
}

/**
 * Convert graph traversal hits to RRF-style HybridSearchHit.
 * Each hit gets rrfScore = 1/(60 + rank) so it can be fused with other arms.
 *
 * P1-1: causalScore is folded into entityScore (sum) so the downstream RRF
 * fusion sees a unified "graph signal" strength. This avoids adding a new
 * field to HybridSearchHit while preserving causal contribution in ranking.
 * The original entityScore and causalScore remain available on the
 * GraphTraversalHit for debugging/explainability.
 */
export function graphHitsToRRFHits(
  graphHits: readonly GraphTraversalHit[],
  rrfK = 60,
): HybridSearchHit[] {
  return graphHits.map((hit, idx) => ({
    fact: hit.fact,
    rrfScore: 1 / (rrfK + idx + 1),
    bm25Rank: null,
    vectorRank: null,
    entityRank: null,
    bm25Score: 0,
    vectorScore: hit.semanticScore,
    // P1-1: combine entity + causal into the entityScore slot so the graph
    // signal reflects both entity overlap and causal chain strength.
    entityScore: hit.entityScore + hit.causalScore,
  }));
}

/**
 * Merge graph RRF hits with initial hybrid hits.
 * Facts appearing in both get their RRF scores summed (consensus boost).
 */
export function mergeWithGraphRRF(
  initialHits: readonly HybridSearchHit[],
  graphRRFHits: readonly HybridSearchHit[],
): HybridSearchHit[] {
  const mergedById = new Map<string, HybridSearchHit>();
  for (const hit of initialHits) {
    mergedById.set(hit.fact.factId, { ...hit });
  }
  for (const hit of graphRRFHits) {
    const existing = mergedById.get(hit.fact.factId);
    if (existing) {
      existing.rrfScore += hit.rrfScore;
      // Update entity/bm25 scores if they were null
      if (existing.entityRank === null && hit.entityRank !== null) {
        existing.entityRank = hit.entityRank;
      }
    } else {
      mergedById.set(hit.fact.factId, { ...hit });
    }
  }
  return [...mergedById.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
