// Phase 2.2: Background consolidation (Cognee memify + Letta v2 sleep-time).
//
// Runs periodically (not in the write path) to improve stored fact quality:
//   1. Prune: invalidate low-importance facts that haven't been accessed recently.
//   2. Merge: invalidate near-duplicate facts (same subject, high 3-gram cosine
//      similarity), keeping the higher-confidence survivor.
//   3. Strengthen: identify high-usage facts for importance boost (the boost is
//      already applied implicitly through usage-aware eviction scoring; this step
//      reports which facts qualify so callers can log/observe it).
//
// All operations use store.invalidateFact() — no destructive deletes. The store
// remains append-only; consolidation just marks facts as expired/superseded.

import {
  isRuntimeMemoryTemporalFact,
  type RuntimeMemoryInvalidationProposal,
  type RuntimeMemoryInvalidationReason,
  type RuntimeMemoryQueryableFact,
} from "./memory-context.js";
import type { RuntimeMemoryStore } from "./memory-store.js";

export type ConsolidationConfig = {
  /** Facts with importance below this are prune candidates. Default 0.15. */
  pruneImportanceThreshold: number;
  /** Prune candidates not accessed in this many days. Default 14. */
  pruneStaleDays: number;
  /** Character 3-gram cosine similarity above this triggers merge. Default 0.88. */
  mergeSimilarityThreshold: number;
  /** Max facts processed in a single run. Default 256. */
  batchSize: number;
};

export const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationConfig = {
  pruneImportanceThreshold: 0.2,
  pruneStaleDays: 14,
  mergeSimilarityThreshold: 0.88,
  batchSize: 256,
};

export type ConsolidationMergePair = {
  survivorId: string;
  absorbedId: string;
  similarity: number;
};

export type ConsolidationResult = {
  prunedFactIds: string[];
  mergedPairs: ConsolidationMergePair[];
  strengthenedFactIds: string[];
  durationMs: number;
};

/**
 * Run background consolidation against a store. Mutates the store by adding
 * invalidation proposals for pruned and merged facts. Returns a report of
 * what was done.
 */
export function runConsolidation(
  store: RuntimeMemoryStore,
  config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
  now: number = Date.now(),
): ConsolidationResult {
  const startTime = Date.now();

  const allFacts = store.queryFacts() as readonly RuntimeMemoryQueryableFact[];
  const usageStats = store.getUsageStats();
  const usageByFactId = new Map(usageStats.map((s) => [s.factId, s]));

  const batch = allFacts.slice(0, config.batchSize);

  const prunedFactIds: string[] = [];
  const mergedPairs: ConsolidationMergePair[] = [];
  const strengthenedFactIds: string[] = [];
  const absorbedIds = new Set<string>();

  // === Step 1: Prune low-importance stale facts ===
  const staleMs = config.pruneStaleDays * 24 * 60 * 60 * 1000;
  const survivorFacts: RuntimeMemoryQueryableFact[] = [];

  for (const fact of batch) {
    const importance = computeImportance(fact);
    const usage = usageByFactId.get(fact.factId);
    const lastRelevant = usage?.lastAccessedAt ?? getLastRelevantTime(fact, now);
    const isStale = now - lastRelevant > staleMs;

    if (importance < config.pruneImportanceThreshold && isStale) {
      const proposal = buildConsolidationInvalidation(
        fact.factId,
        "expired",
        now,
      );
      store.invalidateFact(proposal);
      prunedFactIds.push(fact.factId);
    } else {
      survivorFacts.push(fact);
    }
  }

  // === Step 2: Merge near-duplicate facts within same subject ===
  const bySubject = new Map<string, RuntimeMemoryQueryableFact[]>();
  for (const fact of survivorFacts) {
    if (absorbedIds.has(fact.factId)) continue;
    const group = bySubject.get(fact.subject) ?? [];
    group.push(fact);
    bySubject.set(fact.subject, group);
  }

  for (const group of bySubject.values()) {
    if (group.length < 2) continue;

    const vectors = group.map((f) => ({
      fact: f,
      vec: tfidfVector(characterNgrams(f.objectSummary ?? "")),
    }));

    for (let i = 0; i < vectors.length; i++) {
      if (absorbedIds.has(vectors[i].fact.factId)) continue;
      for (let j = i + 1; j < vectors.length; j++) {
        if (absorbedIds.has(vectors[j].fact.factId)) continue;

        const sim = cosine(vectors[i].vec, vectors[j].vec);
        if (sim < config.mergeSimilarityThreshold) continue;

        const a = vectors[i].fact;
        const b = vectors[j].fact;
        const [survivor, absorbed] =
          (a.confidence ?? 0) >= (b.confidence ?? 0) ? [a, b] : [b, a];

        const proposal = buildConsolidationInvalidation(
          absorbed.factId,
          "superseded",
          now,
          survivor.factId,
        );
        store.invalidateFact(proposal);
        absorbedIds.add(absorbed.factId);
        mergedPairs.push({
          survivorId: survivor.factId,
          absorbedId: absorbed.factId,
          similarity: sim,
        });

        if (absorbed.factId === vectors[i].fact.factId) break;
      }
    }
  }

  // === Step 3: Identify high-usage facts for strengthening ===
  const activeSurvivors = survivorFacts.filter(
    (f) => !absorbedIds.has(f.factId),
  );
  const counts = activeSurvivors
    .map((f) => usageByFactId.get(f.factId)?.count ?? 0)
    .sort((a, b) => a - b);

  if (counts.length > 0) {
    const p75 = counts[Math.floor(counts.length * 0.75)];
    for (const fact of activeSurvivors) {
      const usage = usageByFactId.get(fact.factId);
      if (usage && usage.count > p75 && usage.count > 0) {
        strengthenedFactIds.push(fact.factId);
      }
    }
  }

  return {
    prunedFactIds,
    mergedPairs,
    strengthenedFactIds,
    durationMs: Date.now() - startTime,
  };
}

// === Importance computation (mirrors RuntimeMemoryStore.computeImportanceScore) ===

function computeImportance(fact: RuntimeMemoryQueryableFact): number {
  let score = typeof fact.confidence === "number" ? fact.confidence : 0;

  const statusBonus: Record<string, number> = {
    human_approved: 0.3,
    deterministic_rule: 0.25,
    verified: 0.1,
  };
  score += statusBonus[fact.verificationStatus] ?? 0;

  const sourceBonus: Record<string, number> = {
    human_confirmation: 0.2,
    deterministic_rule: 0.15,
    verifier_summary: 0.1,
    test_output: 0.05,
    tool_result: 0.05,
  };
  score += sourceBonus[fact.source] ?? 0;

  if (fact.evidenceRefs && fact.evidenceRefs.length > 0) {
    score += Math.min(fact.evidenceRefs.length * 0.05, 0.15);
  }

  return Math.min(score, 1.0);
}

function getLastRelevantTime(
  fact: RuntimeMemoryQueryableFact,
  fallback: number,
): number {
  if (isRuntimeMemoryTemporalFact(fact) && typeof fact.acceptedAt === "number") {
    return fact.acceptedAt;
  }
  return typeof fact.valid_at === "number" ? fact.valid_at : fallback;
}

// === Invalidation proposal builder ===

function buildConsolidationInvalidation(
  factId: string,
  reason: RuntimeMemoryInvalidationReason,
  now: number,
  replacementFactId?: string,
): RuntimeMemoryInvalidationProposal {
  return {
    schemaVersion: 1,
    invalidationId: `consolidation-${factId}-${reason}-${now}`,
    factId,
    reason,
    invalid_at: now,
    reference_time: now,
    proposedBy: "deterministic_rule",
    verificationStatus: "deterministic_rule",
    sourceEpisodeRefs: [],
    evidenceRefs: [],
    ...(replacementFactId !== undefined ? { replacementFactId } : {}),
  };
}

// === Character 3-gram vector utilities (mirrors memory-hybrid-retrieval.ts) ===

function characterNgrams(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 3) return normalized.length > 0 ? [normalized] : [];
  const padded = ` ${normalized} `;
  const grams: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i++) {
    const g = padded.slice(i, i + 3);
    if (!/^\s+$/.test(g)) grams.push(g);
  }
  return grams;
}

function tfidfVector(grams: string[]): Map<string, number> {
  const vec = new Map<string, number>();
  for (const g of grams) vec.set(g, (vec.get(g) ?? 0) + 1);
  return vec;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let aSq = 0;
  let bSq = 0;
  for (const [k, v] of a) {
    aSq += v * v;
    const bv = b.get(k);
    if (bv !== undefined) dot += v * bv;
  }
  for (const [, v] of b) bSq += v * v;
  if (aSq === 0 || bSq === 0) return 0;
  return dot / (Math.sqrt(aSq) * Math.sqrt(bSq));
}
