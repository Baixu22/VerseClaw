// Entity extraction and relation graph builder for memory facts.
// Uses deterministic regex (no LLM) to extract entities from fact text,
// then builds fact-to-fact "related_to" relations based on shared entities.
// This powers multi-hop chained retrieval (Phase 2.3).

import { extractEntities } from "./memory-hybrid-retrieval.js";

export type EntityTriplet = {
  entity: string;
  context: string;
};

export type EntityRelationEntry = {
  sourceFactId: string;
  targetFactId: string;
  sharedEntities: string[];
  confidence: number;
};

export type EntityExtractionInput = {
  factId: string;
  subject: string;
  objectSummary: string;
};

/**
 * Structural type for EntityStore integration (avoids hard dependency from
 * openclaw_runtime on tests/unit/helpers). Any object exposing these two
 * methods can serve as an entity store for buildEntityRelationMap.
 *
 * Item 5 (Stage 1): When provided, buildEntityRelationMap uses the store's
 * precomputed entity sets (richer than regex-only extraction — includes
 * multi-word proper nouns, snake_case, hyphenated, numbers, quoted phrases)
 * and reverse index for O(n) relation building instead of O(n²) pairwise.
 */
export type EntityStoreLike = {
  /** Get the set of entities extracted for a given fact, or undefined. */
  getFactEntities(factId: string): Set<string> | undefined;
  /** Get all fact IDs that contain a given entity, or undefined. */
  getFactsForEntity(entity: string): Set<string> | undefined;
};

export function extractEntityTriplets(
  subject: string,
  objectSummary: string,
): EntityTriplet[] {
  const entities = extractEntities(`${subject} ${objectSummary}`);
  return [...entities].map((entity) => ({
    entity,
    context: objectSummary.slice(0, 128),
  }));
}

export function findFactsWithSharedEntities(
  newFact: EntityExtractionInput,
  existingFacts: readonly EntityExtractionInput[],
): EntityRelationEntry[] {
  const newEntities = extractEntities(
    `${newFact.subject} ${newFact.objectSummary}`,
  );
  if (newEntities.size === 0) return [];

  const relations: EntityRelationEntry[] = [];
  for (const existing of existingFacts) {
    if (existing.factId === newFact.factId) continue;
    const existingEntities = extractEntities(
      `${existing.subject} ${existing.objectSummary}`,
    );
    if (existingEntities.size === 0) continue;

    const shared: string[] = [];
    for (const e of newEntities) {
      if (existingEntities.has(e)) shared.push(e);
    }

    if (shared.length > 0) {
      relations.push({
        sourceFactId: newFact.factId,
        targetFactId: existing.factId,
        sharedEntities: shared,
        confidence: Math.min(0.9, 0.4 + shared.length * 0.15),
      });
    }
  }
  return relations;
}

export type BuildEntityRelationMapOptions = {
  /**
   * Optional EntityStore for richer entity extraction and O(n) relation
   * building. When provided, the store's precomputed entity sets are used
   * instead of the regex-only extractEntities(), and the reverse index
   * (entity → factIds) is used to find candidate related facts in O(1)
   * per entity instead of O(n²) pairwise comparison.
   *
   * This is critical for Item 5 (BFS depth=3): the regex-only extraction
   * misses multi-word proper nouns, quoted phrases, and snake_case
   * identifiers, causing depth=3 to pull in noise via weak literal overlaps.
   * EntityStore's broader extraction provides higher-precision relations
   * that make depth=3 safe.
   */
  entityStore?: EntityStoreLike;
  /**
   * Max relations per fact (cap to avoid exploding density). Default 5.
   * When EntityStore is used, this cap applies to entity-based relations;
   * same-subject relations are added on top (also capped at 5 per fact).
   */
  maxRelationsPerFact?: number;
};

export function buildEntityRelationMap(
  facts: readonly EntityExtractionInput[],
  options?: BuildEntityRelationMapOptions,
): Map<string, string[]> {
  const adjacency = new Map<string, Set<string>>();
  for (const f of facts) {
    if (!adjacency.has(f.factId)) adjacency.set(f.factId, new Set());
  }

  const maxRelations = options?.maxRelationsPerFact ?? 5;
  const entityStore = options?.entityStore;

  // Signal 1: Same-subject relations (high-precision, cheap).
  // Facts about "Jon" are likely related to other facts about "Jon".
  // This compensates for entity extractors missing pronouns and aliases.
  const bySubject = new Map<string, string[]>();
  for (const f of facts) {
    const key = f.subject.toLowerCase().trim();
    if (key.length === 0) continue;
    const arr = bySubject.get(key) ?? [];
    arr.push(f.factId);
    bySubject.set(key, arr);
  }
  for (const factIds of bySubject.values()) {
    if (factIds.length < 2) continue;
    for (let i = 0; i < factIds.length; i += 1) {
      for (let j = i + 1; j < factIds.length; j += 1) {
        const a = adjacency.get(factIds[i]);
        const b = adjacency.get(factIds[j]);
        if (a && b && a.size < maxRelations && b.size < maxRelations) {
          a.add(factIds[j]);
          b.add(factIds[i]);
        }
      }
    }
  }

  // Signal 2: Shared-entity relations.
  // When EntityStore is provided, use its richer extraction + reverse index
  // for O(n) relation building. Otherwise fall back to O(n²) pairwise regex.
  if (entityStore) {
    // O(n) path: for each fact, look up its entities in the store's reverse
    // index, collect candidate related facts, and add edges for shared entities.
    for (const f of facts) {
      const fEntities = entityStore.getFactEntities(f.factId);
      if (!fEntities || fEntities.size === 0) continue;
      const currentAdjacency = adjacency.get(f.factId);
      if (!currentAdjacency) continue;

      // Collect candidate fact IDs that share at least one entity.
      const candidates = new Map<string, number>(); // factId → sharedCount
      for (const entity of fEntities) {
        const factIds = entityStore.getFactsForEntity(entity);
        if (!factIds) continue;
        for (const otherFactId of factIds) {
          if (otherFactId === f.factId) continue;
          candidates.set(otherFactId, (candidates.get(otherFactId) ?? 0) + 1);
        }
      }

      // Add edges for candidates with shared entities. Sort by sharedCount
      // descending so the strongest relations are added first (respecting cap).
      const sortedCandidates = [...candidates.entries()].sort(
        (a, b) => b[1] - a[1],
      );
      for (const [otherFactId, sharedCount] of sortedCandidates) {
        if (currentAdjacency.size >= maxRelations) break;
        const otherAdjacency = adjacency.get(otherFactId);
        if (!otherAdjacency) continue;
        if (otherAdjacency.size >= maxRelations) continue;
        // Confidence from sharedCount: 1 shared → 0.55, 2 → 0.7, 3+ → 0.85
        const confidence = Math.min(0.85, 0.4 + sharedCount * 0.15);
        void confidence; // currently unused, reserved for future weighting
        currentAdjacency.add(otherFactId);
        otherAdjacency.add(f.factId);
      }
    }
  } else {
    // O(n²) fallback: pairwise regex entity extraction (legacy behavior).
    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        const relations = findFactsWithSharedEntities(facts[i], [facts[j]]);
        if (relations.length > 0) {
          adjacency.get(facts[i].factId)?.add(facts[j].factId);
          adjacency.get(facts[j].factId)?.add(facts[i].factId);
        }
      }
    }
  }

  const result = new Map<string, string[]>();
  for (const [factId, related] of adjacency) {
    result.set(factId, [...related]);
  }
  return result;
}

export function getRelatedFactIds(
  factId: string,
  relationMap: Map<string, string[]>,
  maxDepth: number = 1,
): string[] {
  const visited = new Set<string>([factId]);
  const result: string[] = [];
  let frontier: string[] = [factId];

  for (let depth = 0; depth < maxDepth; depth++) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      const related = relationMap.get(id) ?? [];
      for (const r of related) {
        if (!visited.has(r)) {
          visited.add(r);
          result.push(r);
          nextFrontier.push(r);
        }
      }
    }
    frontier = nextFrontier;
  }
  return result;
}
