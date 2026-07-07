// P2-1: Mental Model Delta Refresh (Hindsight-inspired).
//
// Source: hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/mental_model.py
//
// Hindsight maintains a "Mental Model" per subject — a structured summary
// of everything known about that person. When new facts arrive, the model
// is refreshed via a delta computation:
//   1. Compare new facts against the existing model's facets.
//   2. For each facet, decide: ADD (new info) / UPDATE (changed info) /
//      NO_CHANGE (already known) / CONTRADICT (conflicts with model).
//   3. Emit a delta describing what changed, with a confidence score.
//
// This is useful for:
// - Open-domain queries: the mental model provides a compact summary the
//   generator can use directly, avoiding the need to retrieve and synthesize
//   dozens of individual facts.
// - Multi-hop queries: the model's facets expose connections between facts
//   that flat retrieval might miss.
// - Temporal queries: the model tracks when each facet was last updated,
//   enabling "what changed recently" queries.
//
// Unlike Hindsight's LLM-driven model refresh, this implementation uses a
// deterministic delta computation (no LLM call) so it can run inline during
// retrieval without adding latency. The trade-off is lower recall on
// semantic merges — those are handled by Observation consolidation (P0 #1).

export type MentalModelFacet = {
  /** Facet key, e.g., "occupation", "hobby", "family.spouse". */
  key: string;
  /** Current value of the facet. */
  value: string;
  /** Source fact IDs that contributed to this facet. */
  sourceFactIds: string[];
  /** Timestamp when this facet was last updated. */
  lastUpdated: number;
  /** Times this facet has been reinforced (proof count). */
  proofCount: number;
  /** Trend indicator (P0 #1 inspired). */
  trend?: "STABLE" | "STRENGTHENING" | "WEAKENING" | "NEW" | "STALE";
};

export type MentalModel = {
  subject: string;
  facets: Map<string, MentalModelFacet>;
  lastRefreshed: number;
};

export type FacetDelta = {
  key: string;
  operation: "ADD" | "UPDATE" | "NO_CHANGE" | "CONTRADICT";
  oldValue?: string;
  newValue: string;
  sourceFactIds: string[];
  confidence: number;
  /** When the delta was computed. */
  timestamp: number;
};

export type MentalModelDelta = {
  subject: string;
  facets: FacetDelta[];
  stats: {
    added: number;
    updated: number;
    contradicted: number;
    unchanged: number;
  };
};

/**
 * Initialize an empty mental model for a subject.
 */
export function createMentalModel(subject: string): MentalModel {
  return {
    subject,
    facets: new Map(),
    lastRefreshed: 0,
  };
}

/**
 * Derive a facet key from a fact's predicate.
 * Normalizes predicates like "started_job" / "has_job" → "occupation".
 * This groups semantically related facts under the same facet.
 */
export function deriveFacetKey(predicate: string): string {
  const p = predicate.toLowerCase().trim();
  // Map common predicate variants to canonical facet keys.
  const facetMap: Record<string, string> = {
    // Occupation
    started_job: "occupation",
    has_job: "occupation",
    works_as: "occupation",
    works_at: "occupation.company",
    occupation: "occupation",
    promoted_to: "occupation.level",
    fired_from: "occupation.status",
    quit_job: "occupation.status",
    // Education
    studied: "education.major",
    graduated_from: "education.school",
    enrolled_in: "education.program",
    // Family
    married_to: "family.spouse",
    has_child: "family.children",
    has_pet: "family.pets",
    has_sibling: "family.siblings",
    // Preferences
    likes: "preferences.like",
    dislikes: "preferences.dislike",
    loves: "preferences.love",
    hates: "preferences.hate",
    hobby: "preferences.hobby",
    favorite_food: "preferences.food",
    favorite_color: "preferences.color",
    // Lifestyle
    lives_in: "lifestyle.location",
    moved_to: "lifestyle.location",
    moved_from: "lifestyle.origin",
    // Health
    has_allergy: "health.allergy",
    has_condition: "health.condition",
    // Plans
    plans_to: "plans.goal",
    wants_to: "plans.desire",
    will_attend: "plans.event",
  };
  return facetMap[p] ?? p;
}

/**
 * Compute the delta between new facts and an existing mental model.
 * For each fact, derive its facet key and compare against the model:
 * - Facet doesn't exist → ADD
 * - Facet exists, value matches → NO_CHANGE (increment proofCount)
 * - Facet exists, value differs → UPDATE (replace value, keep history)
 * - Facet exists, value contradicts (negation/opposite) → CONTRADICT
 */
export function computeMentalModelDelta(
  model: MentalModel,
  newFacts: ReadonlyArray<{
    factId: string;
    predicate: string;
    objectSummary: string;
    sessionDate?: number;
  }>,
  referenceTime: number,
): MentalModelDelta {
  const facets: FacetDelta[] = [];
  const stats = { added: 0, updated: 0, contradicted: 0, unchanged: 0 };

  for (const fact of newFacts) {
    const key = deriveFacetKey(fact.predicate);
    const value = fact.objectSummary;
    const sessionDate = fact.sessionDate ?? referenceTime;
    const existing = model.facets.get(key);

    if (!existing) {
      // ADD: new facet.
      facets.push({
        key,
        operation: "ADD",
        newValue: value,
        sourceFactIds: [fact.factId],
        confidence: 0.8,
        timestamp: sessionDate,
      });
      stats.added++;
      continue;
    }

    // Check for value similarity.
    const similarity = textSimilarity(existing.value, value);
    const isContradiction = isContradictingValue(existing.value, value);

    if (isContradiction) {
      // CONTRADICT: the new fact conflicts with the existing facet.
      facets.push({
        key,
        operation: "CONTRADICT",
        oldValue: existing.value,
        newValue: value,
        sourceFactIds: [...existing.sourceFactIds, fact.factId],
        confidence: 0.7,
        timestamp: sessionDate,
      });
      stats.contradicted++;
    } else if (similarity > 0.7) {
      // NO_CHANGE: same info, increment proof count.
      facets.push({
        key,
        operation: "NO_CHANGE",
        newValue: value,
        sourceFactIds: [fact.factId],
        confidence: 0.9,
        timestamp: sessionDate,
      });
      stats.unchanged++;
    } else {
      // UPDATE: different but non-contradicting info.
      facets.push({
        key,
        operation: "UPDATE",
        oldValue: existing.value,
        newValue: value,
        sourceFactIds: [...existing.sourceFactIds, fact.factId],
        confidence: 0.75,
        timestamp: sessionDate,
      });
      stats.updated++;
    }
  }

  return {
    subject: model.subject,
    facets,
    stats,
  };
}

/**
 * Apply a delta to a mental model, producing an updated model.
 * This is a pure function — it does not mutate the input model.
 */
export function applyMentalModelDelta(
  model: MentalModel,
  delta: MentalModelDelta,
): MentalModel {
  const newFacets = new Map(model.facets);
  for (const facetDelta of delta.facets) {
    const existing = newFacets.get(facetDelta.key);
    switch (facetDelta.operation) {
      case "ADD":
      case "UPDATE":
      case "CONTRADICT":
        newFacets.set(facetDelta.key, {
          key: facetDelta.key,
          value: facetDelta.newValue,
          sourceFactIds: facetDelta.sourceFactIds,
          lastUpdated: facetDelta.timestamp,
          proofCount:
            (existing?.proofCount ?? 0) +
            (facetDelta.operation === "ADD" ? 1 : 1),
          trend: computeFacetTrend(existing, facetDelta),
        });
        break;
      case "NO_CHANGE":
        if (existing) {
          newFacets.set(facetDelta.key, {
            ...existing,
            proofCount: existing.proofCount + 1,
            lastUpdated: Math.max(existing.lastUpdated, facetDelta.timestamp),
          });
        }
        break;
    }
  }
  return {
    subject: model.subject,
    facets: newFacets,
    lastRefreshed: Date.now(),
  };
}

/**
 * Render a mental model as a compact text block for the generator.
 * Each facet is one line: "key: value (proof: N, updated: YYYY-MM-DD)".
 */
export function renderMentalModel(model: MentalModel): string {
  const lines: string[] = [`## Mental Model: ${model.subject}`];
  const sortedFacets = [...model.facets.values()].sort(
    (a, b) => b.proofCount - a.proofCount || b.lastUpdated - a.lastUpdated,
  );
  for (const facet of sortedFacets) {
    const date = new Date(facet.lastUpdated).toISOString().slice(0, 10);
    const trend = facet.trend ? ` [${facet.trend}]` : "";
    lines.push(
      `- ${facet.key}: ${facet.value} (proof: ${facet.proofCount}, updated: ${date}${trend})`,
    );
  }
  return lines.join("\n");
}

/**
 * Compute a simple text similarity score ∈ [0, 1].
 * Uses token overlap (Jaccard) on lowercase word sets.
 */
function textSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter((t) => t.length > 0));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter((t) => t.length > 0));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Heuristic contradiction detection.
 * Checks for negation patterns and opposite values.
 */
function isContradictingValue(oldValue: string, newValue: string): boolean {
  const oldLower = oldValue.toLowerCase();
  const newLower = newValue.toLowerCase();
  // Negation: one value negates the other.
  const negationPatterns = [
    /\bnot\b/,
    /\bno longer\b/,
    /\bnever\b/,
    /\bstopped\b/,
    /\bquit\b/,
    /\bdoesn'?t\b/,
    /\bdon'?t\b/,
    /\bisn'?t\b/,
    /\baren'?t\b/,
    /\bwasn'?t\b/,
    /\bweren'?t\b/,
  ];
  const oldNegated = negationPatterns.some((re) => re.test(oldLower));
  const newNegated = negationPatterns.some((re) => re.test(newLower));
  // If one is negated and the other isn't, it's likely a contradiction.
  if (oldNegated !== newNegated) {
    // But only if they share enough tokens to be about the same thing.
    const similarity = textSimilarity(oldValue, newValue);
    if (similarity > 0.3) return true;
  }
  return false;
}

/**
 * Compute trend for a facet based on its delta operation and history.
 * - ADD → NEW (first time this facet is set)
 * - UPDATE/CONTRADICT → STRENGTHENING (facet is being actively revised)
 * - NO_CHANGE on a stale facet → STABLE
 * - Facet not updated in 90+ days → STALE
 */
function computeFacetTrend(
  existing: MentalModelFacet | undefined,
  delta: FacetDelta,
): MentalModelFacet["trend"] {
  if (!existing) return "NEW";
  if (delta.operation === "UPDATE" || delta.operation === "CONTRADICT") {
    return "STRENGTHENING";
  }
  const ageMs = delta.timestamp - existing.lastUpdated;
  const staleThreshold = 90 * 24 * 60 * 60 * 1000;
  if (ageMs > staleThreshold) return "STALE";
  return "STABLE";
}
