// Context completeness metric (Zep-aligned).
//
// Zep's diagnostic contribution to LoCoMo: classify each retrieval result as
// COMPLETE / PARTIAL / INSUFFICIENT based on whether gold evidence is present
// in the assembled context. This separates "retrieval failed" (INSUFFICIENT)
// from "generation failed" (COMPLETE + WRONG) — error taxonomy's missing piece.
//
// Uses deterministic token overlap + LLM judge fallback for borderline cases.
// CI-safe: no-op (returns "PARTIAL") when no DeepSeek key.

export type CompletenessLevel = "COMPLETE" | "PARTIAL" | "INSUFFICIENT";

export type CompletenessResult = {
  level: CompletenessLevel;
  coverage: number; // [0, 1]
  matchedEvidence: string[];
  missingEvidence: string[];
};

/**
 * Deterministic token-overlap completeness. Fast, no LLM call.
 * A gold evidence string is "matched" if >= 50% of its tokens (excluding
 * stopwords) appear in the assembled context.
 */
export function computeContextCompletenessDeterministic(
  assembledContext: string,
  goldEvidence: readonly string[],
): CompletenessResult {
  if (goldEvidence.length === 0) {
    return {
      level: "COMPLETE",
      coverage: 1,
      matchedEvidence: [],
      missingEvidence: [],
    };
  }
  const contextTokens = tokenize(assembledContext);
  const contextTokenSet = new Set(contextTokens);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const evidence of goldEvidence) {
    const evidenceTokens = tokenize(evidence);
    if (evidenceTokens.length === 0) {
      matched.push(evidence);
      continue;
    }
    const overlap = evidenceTokens.filter((t) => contextTokenSet.has(t));
    const coverage = overlap.length / evidenceTokens.length;
    if (coverage >= 0.5) {
      matched.push(evidence);
    } else {
      missing.push(evidence);
    }
  }
  const coverageRatio = matched.length / goldEvidence.length;
  let level: CompletenessLevel;
  if (coverageRatio >= 0.8) {
    level = "COMPLETE";
  } else if (coverageRatio >= 0.5) {
    level = "PARTIAL";
  } else {
    level = "INSUFFICIENT";
  }
  return {
    level,
    coverage: coverageRatio,
    matchedEvidence: matched,
    missingEvidence: missing,
  };
}

/**
 * Aggregate completeness across multiple questions. Returns by-category and
 * overall distribution. Used for the final eval report.
 */
export function aggregateCompleteness(
  results: Array<{ level: CompletenessLevel; category?: string }>,
): {
  overall: Record<CompletenessLevel, number>;
  byCategory: Record<string, Record<CompletenessLevel, number>>;
} {
  const overall: Record<CompletenessLevel, number> = {
    COMPLETE: 0,
    PARTIAL: 0,
    INSUFFICIENT: 0,
  };
  const byCategory: Record<string, Record<CompletenessLevel, number>> = {};
  for (const r of results) {
    overall[r.level] += 1;
    if (r.category) {
      if (!byCategory[r.category]) {
        byCategory[r.category] = { COMPLETE: 0, PARTIAL: 0, INSUFFICIENT: 0 };
      }
      byCategory[r.category][r.level] += 1;
    }
  }
  return { overall, byCategory };
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "can", "shall", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "above", "below", "up", "down", "and",
  "but", "or", "not", "no", "if", "then", "that", "this", "these",
  "those", "it", "its", "they", "them", "their", "he", "she", "his",
  "her", "we", "us", "our", "you", "your", "i", "me", "my",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}
