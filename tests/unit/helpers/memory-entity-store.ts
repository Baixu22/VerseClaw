// Item 4: Lightweight Entity Store (Hindsight §2.4 / Mem0 §3.3 aligned).
//
// Maintains Map<canonicalEntityName, Set<factId>> for entity-based retrieval.
// During retrieval, query entities are looked up in the store to find facts
// that share entities. Score = tanh(sharedCount * 0.5) (Hindsight formula).
//
// Key differences from the existing hybrid retrieval entity arm (Jaccard):
// - Jaccard penalizes facts with many non-shared entities (intersection / union)
// - tanh(sharedCount * 0.5) rewards multiple shared entities without penalty
// - EntityStore supports canonicalization (e.g., "harry_potter" ↔ "harry potter")
//
// Usage:
//   const store = EntityStore.fromFacts(facts);
//   const queryEntities = store.extractEntities(query);
//   const boostByFactId = store.lookup(queryEntities);
//   // Apply boost: hit.rrfScore *= (1 + boostByFactId.get(hit.fact.factId) ?? 0)

export type EntityStoreInput = {
  factId: string;
  subject: string;
  objectSummary: string;
  predicate?: string;
  // S0-2: LLM-extracted entity list. When present, extractEntitiesFromFact
  // uses these directly (after lowercasing) and skips regex extraction,
  // eliminating the Extraction→EntityStore duplicated-work coupling break
  // (mem-status §3 断裂点 1). When absent, falls back to regex extraction
  // so legacy/cached facts still work.
  // Source: Hindsight ProcessedFact.entities[] / Mem0 entity_store.
  entities?: string[];
};

export class EntityStore {
  private readonly index = new Map<string, Set<string>>();
  private readonly factEntities = new Map<string, Set<string>>();
  private readonly totalFacts: number;

  private constructor(facts: readonly EntityStoreInput[]) {
    this.totalFacts = facts.length;
    for (const fact of facts) {
      const entities = this.extractEntitiesFromFact(fact);
      this.factEntities.set(fact.factId, entities);
      for (const entity of entities) {
        const set = this.index.get(entity) ?? new Set<string>();
        set.add(fact.factId);
        this.index.set(entity, set);
      }
    }
  }

  static fromFacts(facts: readonly EntityStoreInput[]): EntityStore {
    return new EntityStore(facts);
  }

  /**
   * Extract entities from a fact.
   *
   * S0-2: When the input carries an `entities[]` field (populated by the
   * LLM extraction prompt), use it directly after lowercasing + the subject.
   * This eliminates the Extraction→EntityStore duplicated-work coupling break
   * (mem-status §3 断裂点 1) — the LLM already "saw" the entities when
   * extracting, so re-running regex would be both wasteful and lower-quality.
   *
   * When `entities[]` is absent (legacy/cached facts), fall back to the
   * original 7-pattern regex extraction so coverage stays at 100%.
   */
  extractEntitiesFromFact(fact: EntityStoreInput): Set<string> {
    const entities = new Set<string>();

    // 1. Subject is always an entity (person name).
    const subject = fact.subject.trim().toLowerCase();
    if (subject.length > 0) entities.add(subject);

    // S0-2: prefer LLM-extracted entities[] when present.
    if (Array.isArray(fact.entities) && fact.entities.length > 0) {
      for (const e of fact.entities) {
        if (typeof e !== "string") continue;
        const normalized = e.trim().toLowerCase();
        if (normalized.length > 0) entities.add(normalized);
      }
      return entities;
    }

    // Fallback: regex extraction (legacy/cached facts without entities[]).
    const text = `${fact.subject} ${fact.predicate ?? ""} ${fact.objectSummary}`;

    // 2. Multi-word proper nouns: "Harry Potter", "New York", "Skellig Michael"
    // These are caught by matching sequences of capitalized words.
    const multiWord = text.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+\b/g) ?? [];
    for (const e of multiWord) entities.add(e.toLowerCase());

    // 3. Single capitalized words (proper nouns): "Harry", "Potter", "Tim"
    const properNouns = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
    for (const e of properNouns) entities.add(e.toLowerCase());

    // 4. Snake_case identifiers: "dance_studio", "yoga_retreat"
    const snakeCase = text.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? [];
    for (const e of snakeCase) entities.add(e.toLowerCase());

    // 5. Hyphenated: "well-being"
    const hyphenated = text.match(/\b[a-z]+(?:-[a-z0-9]+)+\b/g) ?? [];
    for (const e of hyphenated) entities.add(e.toLowerCase());

    // 6. Numbers (2+ digits): years, ages, quantities
    const numbers = text.match(/\b\d{2,}\b/g) ?? [];
    for (const e of numbers) entities.add(e);

    // 7. Quoted phrases: "Harry Potter and the Philosopher's Stone"
    const quoted = text.match(/"([^"]{3,})"/g) ?? [];
    for (const q of quoted) {
      const cleaned = q.replace(/"/g, "").toLowerCase().trim();
      if (cleaned.length > 0) entities.add(cleaned);
    }

    return entities;
  }

  /**
   * Extract entities from a query string (same extraction logic as facts).
   */
  extractEntities(query: string): Set<string> {
    return this.extractEntitiesFromFact({
      factId: "__query__",
      subject: "",
      objectSummary: query,
    });
  }

  /**
   * Look up facts that share entities with the given query entities.
   * Returns Map<factId, sharedCount> where sharedCount is the number of
   * shared entities between the query and the fact.
   */
  lookup(queryEntities: Set<string>): Map<string, number> {
    const result = new Map<string, number>();
    for (const entity of queryEntities) {
      const factIds = this.index.get(entity);
      if (!factIds) continue;
      for (const factId of factIds) {
        result.set(factId, (result.get(factId) ?? 0) + 1);
      }
    }
    return result;
  }

  /**
   * Score a fact by entity overlap with the query.
   * Uses Hindsight formula: tanh(sharedCount * 0.5).
   * Returns a value in [0, 1) where 0 = no shared entities, ~0.76 = 2 shared, ~0.905 = 3 shared.
   */
  scoreFact(queryEntities: Set<string>, factId: string): number {
    const factEntities = this.factEntities.get(factId);
    if (!factEntities || factEntities.size === 0) return 0;
    let sharedCount = 0;
    for (const e of queryEntities) {
      if (factEntities.has(e)) sharedCount++;
    }
    if (sharedCount === 0) return 0;
    return Math.tanh(sharedCount * 0.5);
  }

  /**
   * Get coverage stats: what fraction of facts have at least 1 entity.
   */
  getCoverage(): { totalFacts: number; factsWithEntities: number; coverage: number; uniqueEntities: number } {
    let factsWithEntities = 0;
    for (const entities of this.factEntities.values()) {
      if (entities.size > 0) factsWithEntities++;
    }
    return {
      totalFacts: this.totalFacts,
      factsWithEntities,
      coverage: this.totalFacts > 0 ? factsWithEntities / this.totalFacts : 0,
      uniqueEntities: this.index.size,
    };
  }

  /**
   * Get the set of entities extracted for a given fact.
   * Returns undefined if factId is not in the store.
   * Used by buildEntityRelationMap to access precomputed entity sets
   * without re-running extraction.
   */
  getFactEntities(factId: string): Set<string> | undefined {
    return this.factEntities.get(factId);
  }

  /**
   * Get all fact IDs that contain a given entity.
   * Used by buildEntityRelationMap to find candidate related facts
   * in O(1) per entity instead of O(n²) pairwise comparison.
   */
  getFactsForEntity(entity: string): Set<string> | undefined {
    return this.index.get(entity);
  }

  /**
   * Apply entity boost to hybrid hits. Mutates rrfScore by multiplying
   * with (1 + entityScore * weight). Default weight = 0.2 (max +20% boost).
   * Generic over the hit shape so callers retain their concrete hit type
   * (e.g. HybridSearchHit) without spreading-related type loss.
   *
   * S0-3: when the hit carries a `ceScore` field (populated by
   * rerankHybridHits), the entity boost is ALSO applied to ceScore so the
   * cross-encoder signal stays in sync with the entity signal. Without this,
   * applyFinalBoost would read a stale ceScore that ignores entity overlap
   * (mem-status §3 断裂点 2). When ceScore is absent, only rrfScore is
   * boosted (legacy behavior).
   */
  applyEntityBoost<T extends { fact: { factId: string }; rrfScore: number; ceScore?: number }>(
    hits: readonly T[],
    queryEntities: Set<string>,
    weight = 0.2,
  ): T[] {
    if (queryEntities.size === 0) return [...hits];
    return hits.map((hit) => {
      const entityScore = this.scoreFact(queryEntities, hit.fact.factId);
      if (entityScore <= 0) return hit;
      const boost = 1 + entityScore * weight;
      const boosted: T = {
        ...hit,
        rrfScore: hit.rrfScore * boost,
      };
      // S0-3: keep ceScore in sync so applyFinalBoost sees the entity-boosted
      // CE signal. Only mutate when ceScore is present.
      if (typeof hit.ceScore === "number") {
        boosted.ceScore = hit.ceScore * boost;
      }
      return boosted;
    });
  }
}
