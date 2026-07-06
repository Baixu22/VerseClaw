// LLM utility scoring for runtime-memory evaluation.
// Deterministic proxy (no real LLM calls) that maps recalled facts to a
// utility score via geometric mean of fact coverage and answer completeness.
// Fills the "ScriptedLlm responses are discarded, no utility measurement" gap.

import { mean, percentile } from "./statistics.js";

export type UtilityScoreInput = {
  recalledFactIds: readonly string[];
  referenceFactIds: readonly string[];
};

export type UtilityScoreResult = {
  factCoverage: number;
  answerCompleteness: number;
  utilityScore: number;
  matchedFactIds: readonly string[];
  missingFactIds: readonly string[];
  extraneousFactIds: readonly string[];
};

export type UtilityEvalResult = {
  perQuery: ReadonlyArray<UtilityScoreResult>;
  meanUtility: number;
  p50Utility: number;
  p95Utility: number;
  meanCoverage: number;
  meanCompleteness: number;
};

export function scoreUtility(input: UtilityScoreInput): UtilityScoreResult {
  const recalledSet = new Set(input.recalledFactIds);
  const referenceSet = new Set(input.referenceFactIds);

  const matched: string[] = [];
  const missing: string[] = [];
  const extraneous: string[] = [];

  for (const factId of input.referenceFactIds) {
    if (recalledSet.has(factId)) {
      matched.push(factId);
    } else {
      missing.push(factId);
    }
  }

  for (const factId of input.recalledFactIds) {
    if (!referenceSet.has(factId)) {
      extraneous.push(factId);
    }
  }

  // factCoverage: of all recalled facts, how many are relevant (in reference).
  const factCoverage =
    input.recalledFactIds.length === 0
      ? 0
      : matched.length / input.recalledFactIds.length;

  // answerCompleteness: of all reference facts, how many were recalled.
  const answerCompleteness =
    input.referenceFactIds.length === 0
      ? 1
      : matched.length / input.referenceFactIds.length;

  // Geometric mean ensures both dimensions must be high for a high score.
  // sqrt(coverage × completeness) — penalizes "many irrelevant recalls" and
  // "correct but incomplete recalls" equally.
  const utilityScore = Math.sqrt(factCoverage * answerCompleteness);

  return {
    factCoverage,
    answerCompleteness,
    utilityScore,
    matchedFactIds: matched,
    missingFactIds: missing,
    extraneousFactIds: extraneous,
  };
}

export function aggregateUtility(
  perQuery: ReadonlyArray<UtilityScoreResult>,
): UtilityEvalResult {
  if (perQuery.length === 0) {
    return {
      perQuery: [],
      meanUtility: 0,
      p50Utility: 0,
      p95Utility: 0,
      meanCoverage: 0,
      meanCompleteness: 0,
    };
  }

  const utilities = perQuery.map((q) => q.utilityScore);
  const coverages = perQuery.map((q) => q.factCoverage);
  const completenesses = perQuery.map((q) => q.answerCompleteness);

  return {
    perQuery,
    meanUtility: mean(utilities),
    p50Utility: percentile(utilities, 0.5),
    p95Utility: percentile(utilities, 0.95),
    meanCoverage: mean(coverages),
    meanCompleteness: mean(completenesses),
  };
}
