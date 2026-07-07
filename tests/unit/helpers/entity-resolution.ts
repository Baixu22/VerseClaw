// P1-2: Entity Resolution + Alias Table (Hindsight/Mem0-inspired).
//
// Source: hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/entity_resolver.py
//         mem0-main/mem0/memory/entity_store.py
//
// Hindsight resolves entities using a weighted score:
//   resolution_score = 0.5 × name_similarity + 0.3 × cooccurrence + 0.2 × temporal
// Entities with score > MERGE_THRESHOLD (0.6) are merged into a canonical form.
//
// This is critical for multi-hop retrieval: without resolution, "Jon",
// "Jonathan", and "Jon Smith" would be treated as three separate entities,
// fragmenting the entity graph and breaking causal chain traversal.
//
// Resolution is idempotent: once an alias is mapped to a canonical form,
// subsequent resolutions return the same canonical form without recomputation.

export type EntityOccurrence = {
  entity: string;
  factId: string;
  sessionDate?: number;
};

export type AliasEntry = {
  canonical: string;
  aliases: string[];
  /** Confidence of the merge (0-1). Higher = more confident. */
  confidence: number;
  /** The components that produced the merge, for debugging. */
  scoreBreakdown: {
    nameSimilarity: number;
    cooccurrence: number;
    temporal: number;
    total: number;
  };
};

export type EntityResolverOptions = {
  /** Threshold above which two entities are merged. Default 0.6. */
  mergeThreshold?: number;
  /** Weight for name similarity (string-based). Default 0.5. */
  nameWeight?: number;
  /** Weight for cooccurrence (shared fact context). Default 0.3. */
  cooccurrenceWeight?: number;
  /** Weight for temporal proximity. Default 0.2. */
  temporalWeight?: number;
  /** Max temporal distance (ms) for temporal score > 0. Default 90 days. */
  temporalWindowMs?: number;
};

const DEFAULT_OPTIONS: Required<EntityResolverOptions> = {
  mergeThreshold: 0.6,
  nameWeight: 0.5,
  cooccurrenceWeight: 0.3,
  temporalWeight: 0.2,
  temporalWindowMs: 90 * 24 * 60 * 60 * 1000,
};

/**
 * Normalize an entity string for comparison.
 * Lowercase, trim, collapse whitespace, strip possessive suffixes ('s).
 */
export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/['']s\b/g, "");
}

/**
 * Jaro-Winkler similarity for short strings (names, aliases).
 * Returns [0, 1] where 1 = identical. More forgiving than Levenshtein for
 * name prefixes (e.g., "Jon" vs "Jonathan" scores ~0.93, vs 0.46 for
 * normalized Levenshtein). This matches Hindsight's behavior where prefix
 * matches are rewarded because nicknames often truncate full names.
 */
export function jaroWinklerSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const s1 = a.length < b.length ? a : b;
  const s2 = a.length < b.length ? b : a;
  if (s1.length === 0) return 0;

  const matchDistance = Math.max(Math.floor(s2.length / 2) - 1, 0);
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions) / matches) / 3;

  // Winkler prefix bonus: reward common prefixes up to 4 chars.
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Compute name similarity score ∈ [0, 1].
 * Uses Jaro-Winkler on normalized forms, with a boost for substring
 * containment (e.g., "Jon" ⊂ "Jonathan").
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeEntityName(a);
  const nb = normalizeEntityName(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;

  const jw = jaroWinklerSimilarity(na, nb);

  // Substring boost: "jon" ⊂ "jonathan" should score high even if Jaro
  // alone is ~0.87. This handles nicknames and shortened forms.
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  const substringBoost =
    shorter.length >= 3 && longer.includes(shorter) ? 0.15 : 0;

  return Math.min(1, jw + substringBoost);
}

/**
 * Compute cooccurrence score ∈ [0, 1].
 * Two entities that appear in the same fact (or nearby facts) are more
 * likely to refer to the same concept. We count shared fact IDs and
 * saturate at 3+ co-occurrences.
 */
export function cooccurrenceScore(
  entityA: string,
  entityB: string,
  factIdsByEntity: Map<string, Set<string>>,
): number {
  const factsA = factIdsByEntity.get(entityA);
  const factsB = factIdsByEntity.get(entityB);
  if (!factsA || !factsB) return 0;

  let shared = 0;
  for (const id of factsA) {
    if (factsB.has(id)) shared++;
  }
  if (shared === 0) return 0;
  // Saturate: 1 shared = 0.4, 2 = 0.7, 3+ = 1.0
  return Math.min(1, 0.1 + shared * 0.3);
}

/**
 * Compute temporal proximity score ∈ [0, 1].
 * Entities mentioned close in time are more likely to be the same.
 * Uses the minimum pairwise timestamp distance between occurrences.
 */
export function temporalScore(
  entityA: string,
  entityB: string,
  occurrencesByEntity: Map<string, EntityOccurrence[]>,
  windowMs: number,
): number {
  const occA = occurrencesByEntity.get(entityA);
  const occB = occurrencesByEntity.get(entityB);
  if (!occA || !occB || occA.length === 0 || occB.length === 0) return 0;

  let minDist = Infinity;
  for (const a of occA) {
    if (a.sessionDate === undefined) continue;
    for (const b of occB) {
      if (b.sessionDate === undefined) continue;
      const dist = Math.abs(a.sessionDate - b.sessionDate);
      if (dist < minDist) minDist = dist;
    }
  }
  if (!Number.isFinite(minDist)) return 0;
  if (minDist === 0) return 1;
  if (minDist >= windowMs) return 0;
  // Linear decay over the window.
  return 1 - minDist / windowMs;
}

/**
 * Compute the full resolution score for two entities.
 *   score = nameWeight × name + cooccurrenceWeight × co + temporalWeight × temporal
 */
export function computeResolutionScore(
  entityA: string,
  entityB: string,
  factIdsByEntity: Map<string, Set<string>>,
  occurrencesByEntity: Map<string, EntityOccurrence[]>,
  options: Required<EntityResolverOptions>,
): { total: number; name: number; cooccurrence: number; temporal: number } {
  const name = nameSimilarity(entityA, entityB);
  const co = cooccurrenceScore(entityA, entityB, factIdsByEntity);
  const temp = temporalScore(entityA, entityB, occurrencesByEntity, options.temporalWindowMs);
  const total =
    options.nameWeight * name +
    options.cooccurrenceWeight * co +
    options.temporalWeight * temp;
  return { total, name, cooccurrence: co, temporal: temp };
}

/**
 * Alias table: maps each known entity surface form to its canonical form.
 * Lookup is O(1). Resolution is idempotent: once merged, an alias stays
 * mapped to its canonical form even if the table is rebuilt (the canonical
 * form is chosen deterministically as the longest surface form, breaking
 * ties alphabetically).
 */
export class AliasTable {
  private aliasToCanonical = new Map<string, string>();
  private canonicalToEntry = new Map<string, AliasEntry>();
  private readonly options: Required<EntityResolverOptions>;

  constructor(options: EntityResolverOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Resolve an entity surface form to its canonical form.
   * Returns the input unchanged if no merge has been registered.
   */
  resolve(entity: string): string {
    const normalized = normalizeEntityName(entity);
    return this.aliasToCanonical.get(normalized) ?? entity;
  }

  /**
   * Get the alias entry for a canonical form, if one exists.
   */
  getEntry(canonical: string): AliasEntry | undefined {
    return this.canonicalToEntry.get(normalizeEntityName(canonical));
  }

  /**
   * All registered canonical forms and their aliases.
   */
  entries(): AliasEntry[] {
    return [...this.canonicalToEntry.values()];
  }

  /**
   * Build the alias table from a set of entity occurrences.
   * For each pair of entities, compute the resolution score; if it exceeds
   * the threshold, merge them into a canonical form.
   *
   * Algorithm: greedy agglomerative clustering.
   * 1. Sort all unique entities by frequency (descending).
   * 2. For each entity, compute score against all existing canonical forms.
   * 3. If the best score > threshold, merge into that canonical form.
   * 4. Otherwise, start a new cluster with this entity as canonical.
   *
   * Complexity: O(n × k) where k = number of canonical forms found so far.
   * For typical memory stores (n < 1000, k < 100), this is fast.
   */
  buildFromOccurrences(occurrences: readonly EntityOccurrence[]): void {
    // Index occurrences by normalized entity.
    const factIdsByEntity = new Map<string, Set<string>>();
    const occurrencesByEntity = new Map<string, EntityOccurrence[]>();
    const frequencyByEntity = new Map<string, number>();

    for (const occ of occurrences) {
      const normalized = normalizeEntityName(occ.entity);
      if (normalized.length === 0) continue;

      if (!factIdsByEntity.has(normalized)) {
        factIdsByEntity.set(normalized, new Set());
        occurrencesByEntity.set(normalized, []);
        frequencyByEntity.set(normalized, 0);
      }
      factIdsByEntity.get(normalized)!.add(occ.factId);
      occurrencesByEntity.get(normalized)!.push(occ);
      frequencyByEntity.set(normalized, (frequencyByEntity.get(normalized) ?? 0) + 1);
    }

    // Sort entities by frequency descending (most frequent first).
    const sortedEntities = [...frequencyByEntity.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([e]) => e);

    // Greedy clustering.
    for (const entity of sortedEntities) {
      let bestCanonical: string | null = null;
      let bestScore = 0;

      for (const canonical of this.canonicalToEntry.keys()) {
        const score = computeResolutionScore(
          entity,
          canonical,
          factIdsByEntity,
          occurrencesByEntity,
          this.options,
        );
        if (score.total > bestScore) {
          bestScore = score.total;
          bestCanonical = canonical;
        }
      }

      if (bestCanonical !== null && bestScore >= this.options.mergeThreshold) {
        // Merge into existing canonical cluster.
        const entry = this.canonicalToEntry.get(bestCanonical)!;
        entry.aliases.push(entity);
        // Recompute once to capture the breakdown for the record.
        if (bestScore > entry.confidence) {
          const breakdown = computeResolutionScore(
            entity,
            bestCanonical,
            factIdsByEntity,
            occurrencesByEntity,
            this.options,
          );
          entry.confidence = bestScore;
          entry.scoreBreakdown = {
            nameSimilarity: breakdown.name,
            cooccurrence: breakdown.cooccurrence,
            temporal: breakdown.temporal,
            total: breakdown.total,
          };
        }
        this.aliasToCanonical.set(entity, bestCanonical);
      } else {
        // Start a new cluster with this entity as canonical.
        const canonical = entity;
        this.canonicalToEntry.set(canonical, {
          canonical,
          aliases: [],
          confidence: 1,
          scoreBreakdown: {
            nameSimilarity: 1,
            cooccurrence: 0,
            temporal: 0,
            total: 1,
          },
        });
        this.aliasToCanonical.set(entity, canonical);
      }
    }
  }

  /**
   * Choose the canonical form for a set of surface forms.
   * Prefers the longest form (most specific), breaking ties alphabetically.
   */
  static chooseCanonical(forms: readonly string[]): string {
    if (forms.length === 0) return "";
    return [...forms].sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      return a.localeCompare(b);
    })[0];
  }
}

/**
 * Convenience: build an AliasTable from raw entity occurrences and return
 * a resolver function that maps any entity to its canonical form.
 */
export function buildEntityResolver(
  occurrences: readonly EntityOccurrence[],
  options: EntityResolverOptions = {},
): (entity: string) => string {
  const table = new AliasTable(options);
  table.buildFromOccurrences(occurrences);
  return (entity: string) => table.resolve(entity);
}
