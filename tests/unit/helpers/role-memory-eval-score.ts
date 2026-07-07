// Area 4 §3.6 — Role Memory eval pack maturity score helper.
//
// Mirrors the structure of runtime-memory-maturity-score.ts but adapted to
// Role Memory's deterministic (non-LLM) nature. Role Memory is a governed
// retrieval/routing system, so the eval pack measures three concrete gates:
//   1. bucketPrecision  — does buildContextPack route each fixture card to
//                         the correct bucket? (≥ 0.8 required)
//   2. budgetAdherence  — does the output respect per-bucket and total token
//                         budgets? (100% required)
//   3. conflictExclusion — are conflict cards routed exclusively to
//                         openConflicts and never leaked into other buckets?
//                         (100% required)
//
// Unlike runtime-memory-maturity-score.ts, there is no LLM layer, no
// anti-overfitting dimension, and no cross-validation dimension — Role Memory
// routing is deterministic, so statistical rigor and LLM-judge concerns do
// not apply.

import type { ContextPack, ContextPackBucketName } from '../../../openclaw_runtime/src/memory/types';

export type RoleMemoryEvalDimension =
  | 'bucketPrecision'
  | 'budgetAdherence'
  | 'conflictExclusion';

export type RoleMemoryEvalWeights = Record<RoleMemoryEvalDimension, number>;

export const ROLE_MEMORY_EVAL_WEIGHTS: RoleMemoryEvalWeights = {
  bucketPrecision: 0.4,
  budgetAdherence: 0.3,
  conflictExclusion: 0.3,
};

export const ROLE_MEMORY_EVAL_THRESHOLDS: Record<RoleMemoryEvalDimension, number> = {
  bucketPrecision: 0.8,
  budgetAdherence: 1.0,
  conflictExclusion: 1.0,
};

export type RoleMemoryEvalResult = {
  dimension: RoleMemoryEvalDimension;
  value: number;          // 0..1
  passed: boolean;
  details: string;        // human-readable summary
};

export type RoleMemoryEvalScore = {
  overall: number;        // 0..1 weighted sum
  passed: boolean;        // all three gates passed
  results: RoleMemoryEvalResult[];
  disqualifiers: string[];
};

export type BucketRoutingAssertion = {
  cardId: string;
  expectedBucket: ContextPackBucketName;
  description?: string;
};

/**
 * Compute bucket precision: fraction of fixture cards routed to the correct
 * bucket by selectMemoryForContextPack. A card counts as "correct" only if
 * its explanation.bucket === expectedBucket AND explanation.selected === true
 * (i.e. it was not truncated/dropped).
 */
export function evaluateBucketPrecision(
  explanations: Array<{ cardId: string; selected: boolean; bucket?: ContextPackBucketName }>,
  assertions: BucketRoutingAssertion[],
): RoleMemoryEvalResult {
  const relevant = explanations.filter((exp) =>
    assertions.some((assertion) => assertion.cardId === exp.cardId),
  );
  const correct = relevant.filter((exp) => {
    const assertion = assertions.find((a) => a.cardId === exp.cardId);
    return assertion && exp.selected && exp.bucket === assertion.expectedBucket;
  });
  const value = relevant.length === 0 ? 0 : correct.length / relevant.length;
  return {
    dimension: 'bucketPrecision',
    value,
    passed: value >= ROLE_MEMORY_EVAL_THRESHOLDS.bucketPrecision,
    details: `${correct.length}/${relevant.length} cards routed to the correct bucket (threshold ≥ ${ROLE_MEMORY_EVAL_THRESHOLDS.bucketPrecision})`,
  };
}

/**
 * Compute budget adherence: 1.0 if estimatedTokens.total <= budget.total AND
 * every per-bucket token count is within its per-bucket budget; 0.0 otherwise.
 * The total-budget trim pass in buildContextPack should guarantee this, so
 * any violation is a real bug.
 */
export function evaluateBudgetAdherence(pack: ContextPack): RoleMemoryEvalResult {
  const budget = pack.budget;
  const tokens = pack.estimatedTokens;
  const buckets: ContextPackBucketName[] = [
    'hardConstraints', 'rolePlaybook', 'projectFacts',
    'teamHandoffs', 'recentEpisodes', 'openConflicts', 'taskState',
  ];
  const perBucketOk = buckets.every((bucket) => tokens[bucket] <= budget[bucket]);
  const totalOk = tokens.total <= budget.total;
  const value = perBucketOk && totalOk ? 1.0 : 0.0;
  const violations: string[] = [];
  if (!totalOk) violations.push(`total ${tokens.total} > ${budget.total}`);
  for (const bucket of buckets) {
    if (tokens[bucket] > budget[bucket]) {
      violations.push(`${bucket} ${tokens[bucket]} > ${budget[bucket]}`);
    }
  }
  return {
    dimension: 'budgetAdherence',
    value,
    passed: value >= ROLE_MEMORY_EVAL_THRESHOLDS.budgetAdherence,
    details: violations.length === 0
      ? `total=${tokens.total}/${budget.total}, all per-bucket within budget`
      : `violations: ${violations.join('; ')}`,
  };
}

/**
 * Compute conflict exclusion: 1.0 if every card whose id is in
 * openConflictCardIds appears ONLY in the openConflicts bucket and in no
 * other bucket; 0.0 if any conflict card leaks into another bucket.
 *
 * Note: buildContextPack stores bucket items as rendered text strings, not
 * card ids, so we rely on candidateExplanations to verify routing. A conflict
 * card's explanation must have bucket === "openConflicts" and selected === true.
 */
export function evaluateConflictExclusion(
  explanations: Array<{ cardId: string; selected: boolean; bucket?: ContextPackBucketName; penalties?: string[] }>,
  conflictCardIds: string[],
): RoleMemoryEvalResult {
  if (conflictCardIds.length === 0) {
    return {
      dimension: 'conflictExclusion',
      value: 1.0,
      passed: true,
      details: 'no conflict cards in fixture (vacuously true)',
    };
  }
  const conflictSet = new Set(conflictCardIds);
  const conflictExplanations = explanations.filter((exp) => conflictSet.has(exp.cardId));
  const leaked = conflictExplanations.filter(
    (exp) => exp.selected && exp.bucket !== 'openConflicts',
  );
  const notRouted = conflictExplanations.filter((exp) => !exp.selected);
  const value = leaked.length === 0 && notRouted.length === 0 ? 1.0 : 0.0;
  return {
    dimension: 'conflictExclusion',
    value,
    passed: value >= ROLE_MEMORY_EVAL_THRESHOLDS.conflictExclusion,
    details: leaked.length === 0 && notRouted.length === 0
      ? `${conflictExplanations.length}/${conflictCardIds.length} conflict cards routed exclusively to openConflicts`
      : `${leaked.length} leaked to other buckets, ${notRouted.length} not routed to openConflicts`,
  };
}

export function computeRoleMemoryEvalScore(results: RoleMemoryEvalResult[]): RoleMemoryEvalScore {
  const disqualifiers: string[] = [];
  for (const result of results) {
    if (!result.passed && result.dimension === 'budgetAdherence') {
      disqualifiers.push('budget_violation_disqualifier');
    }
    if (!result.passed && result.dimension === 'conflictExclusion') {
      disqualifiers.push('conflict_leak_disqualifier');
    }
  }
  const overall = results.reduce(
    (sum, result) => sum + result.value * ROLE_MEMORY_EVAL_WEIGHTS[result.dimension],
    0,
  );
  const passed = results.every((result) => result.passed);
  return {
    overall: Number(overall.toFixed(4)),
    passed,
    results,
    disqualifiers,
  };
}
