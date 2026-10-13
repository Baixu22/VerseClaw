/**
 * E02 paired-ablation aggregation.
 *
 * Deterministic paired-ablation summary: pass^k (via the E01 aggregator),
 * p50/p95 latency, mean tokens, false blocks and safety violations per
 * condition, plus a paired effect size with a 95% confidence interval and a
 * pre-registered verdict. It never invents a positive effect: a zero or
 * negative effect is a valid, reported result.
 *
 * Pairs are keyed by (caseId, repeat). The 95% CI uses the normal
 * approximation (z=1.96); with the design gate (>=20 cases x 3 repeats = 60
 * pairs) that is a close approximation to the paired t interval.
 */
import { aggregateReliability } from './reliability-aggregation.mjs';

const Z_95 = 1.959964;

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value) {
  return value === null ? null : Number(value.toFixed(4));
}

export function summarizeCondition(runs, options = {}) {
  const k = options.k ?? 3;
  const minCases = options.minCases ?? 20;
  const byCase = new Map();
  for (const run of runs) {
    if (!byCase.has(run.caseId)) byCase.set(run.caseId, []);
    byCase.get(run.caseId).push(run);
  }

  const reliabilityCases = [...byCase.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([caseId, caseRuns]) => ({
      id: caseId,
      trials: caseRuns
        .slice()
        .sort((a, b) => a.repeat - b.repeat)
        .map((run) => (run.success ? 'pass' : 'fail')),
    }));

  const reliability = aggregateReliability(reliabilityCases, { k, minCases });
  const latencies = runs.map((run) => run.latencyMs).filter((value) => typeof value === 'number').sort((a, b) => a - b);
  const tokens = runs.map((run) => run.tokens).filter((value) => typeof value === 'number');

  return {
    runCount: runs.length,
    caseCount: byCase.size,
    successRate: reliability.perTrialSuccessRate,
    passK: reliability.passK,
    p50LatencyMs: round(quantile(latencies, 0.5)),
    p95LatencyMs: round(quantile(latencies, 0.95)),
    meanTokens: round(mean(tokens)),
    falseBlocks: runs.filter((run) => run.falseBlock === true).length,
    safetyViolations: runs.filter((run) => run.safetyViolation === true).length,
    incompleteCaseCount: reliability.incompleteCaseCount,
  };
}

function pairByKey(runs) {
  const map = new Map();
  for (const run of runs) map.set(`${run.caseId}::${run.repeat}`, run);
  return map;
}

export function pairedEffect(baselineRuns, treatmentRuns, options = {}) {
  const metric = options.metric ?? 'success';
  const baseline = pairByKey(baselineRuns);
  const treatment = pairByKey(treatmentRuns);

  const diffs = [];
  for (const [key, baseRun] of baseline) {
    const treatRun = treatment.get(key);
    if (!treatRun) continue;
    const baseValue = baseRun[metric];
    const treatValue = treatRun[metric];
    if (typeof baseValue !== 'number' || typeof treatValue !== 'number') continue;
    diffs.push(treatValue - baseValue);
  }

  const pairCount = diffs.length;
  const meanDiff = mean(diffs);
  if (pairCount < 2 || meanDiff === null) {
    return { metric, pairCount, meanDiff: round(meanDiff), sd: null, standardError: null, ci95: null, cohensDz: null };
  }
  const variance = diffs.reduce((total, diff) => total + (diff - meanDiff) ** 2, 0) / (pairCount - 1);
  const sd = Math.sqrt(variance);
  const standardError = sd / Math.sqrt(pairCount);
  const margin = Z_95 * standardError;
  return {
    metric,
    pairCount,
    meanDiff: round(meanDiff),
    sd: round(sd),
    standardError: round(standardError),
    ci95: [round(meanDiff - margin), round(meanDiff + margin)],
    cohensDz: sd === 0 ? 0 : round(meanDiff / sd),
  };
}

/**
 * @param {{baselineRuns: any[], treatmentRuns: any[],
 *   preRegistered: {primaryMetric: string, minCases: number, k: number, degradationBudget?: number, safetyMustHold?: boolean}}} input
 */
export function evaluateAblation(input) {
  const { baselineRuns, treatmentRuns, preRegistered } = input;
  const k = preRegistered.k ?? 3;
  const minCases = preRegistered.minCases ?? 20;
  const budget = preRegistered.degradationBudget ?? 0;
  const baseline = summarizeCondition(baselineRuns, { k, minCases });
  const treatment = summarizeCondition(treatmentRuns, { k, minCases });
  const effect = pairedEffect(baselineRuns, treatmentRuns, { metric: preRegistered.primaryMetric });

  const reasons = [];
  let verdict = 'no-effect';

  const safetyOk =
    preRegistered.safetyMustHold === true
      ? treatment.safetyViolations === 0 && baseline.safetyViolations === 0
      : true;

  if (treatment.incompleteCaseCount > 0 || baseline.incompleteCaseCount > 0) {
    verdict = 'insufficient-sample';
    reasons.push('incomplete cases present');
  } else if (!safetyOk) {
    verdict = 'safety-regression';
    reasons.push('safety violations observed');
  } else if (effect.ci95 === null) {
    verdict = 'insufficient-sample';
    reasons.push('not enough pairs for an interval');
  } else {
    const [lo, hi] = effect.ci95;
    const degradationExceeded = effect.meanDiff < -budget;
    if (degradationExceeded && hi < 0) {
      verdict = 'hurts';
      reasons.push(`primary metric degraded beyond budget ${budget}`);
    } else if (lo > 0) {
      verdict = 'component-helps';
      reasons.push('95% CI excludes zero on the positive side');
    } else if (hi < 0) {
      verdict = 'hurts';
      reasons.push('95% CI excludes zero on the negative side');
    } else {
      verdict = 'no-effect';
      reasons.push('95% CI contains zero');
    }
  }

  return { preRegistered, baseline, treatment, effect, verdict, reasons };
}