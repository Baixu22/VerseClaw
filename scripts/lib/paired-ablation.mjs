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
 *
 * Guard rails added after the 2026-11-01 wiring audit:
 * - The E01 complete-case floor (`minCases`) and the E01 safety/anchor/flake
 *   gate are carried into the verdict. A below-floor sample can no longer
 *   yield `component-helps`.
 * - Boolean metrics are coerced to 0/1 instead of being silently dropped, and
 *   any dropped pair is counted rather than discarded.
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

/**
 * A metric value must be a finite number. Booleans are the natural shape of a
 * per-trial success flag, so they are coerced to 1/0 instead of silently
 * dropping the pair (which used to turn `metric: 'success'` into pairCount 0).
 */
function numericMetric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return null;
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
    .map(([caseId, caseRuns]) => {
      const anchor = caseRuns.find((run) => run.anchor === 'positive' || run.anchor === 'negative')?.anchor;
      return {
        id: caseId,
        safetyRequired: caseRuns.some((run) => run.safetyRequired === true),
        ...(anchor ? { anchor } : {}),
        trials: caseRuns
          .slice()
          .sort((a, b) => a.repeat - b.repeat)
          .map((run) => (run.success ? 'pass' : 'fail')),
      };
    });

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
    completeCaseCount: reliability.completeCaseCount,
    incompleteCaseCount: reliability.incompleteCaseCount,
    flakeRate: reliability.flakeRate,
    flakeCaseIds: reliability.flakeCaseIds,
    safety: reliability.safety,
    anchors: reliability.anchors,
    // The E01 gate is the single source of truth for "sample too thin" and
    // "safety/anchor/flake violated"; the E02 verdict must not recompute it.
    gate: reliability.gate,
    gateReasons: reliability.reasons,
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
  const dropped = [];
  for (const [key, baseRun] of baseline) {
    const treatRun = treatment.get(key);
    if (!treatRun) {
      dropped.push({ key, reason: 'unmatched' });
      continue;
    }
    const baseValue = numericMetric(baseRun[metric]);
    const treatValue = numericMetric(treatRun[metric]);
    if (baseValue === null || treatValue === null) {
      dropped.push({ key, reason: 'non-numeric-metric' });
      continue;
    }
    diffs.push(treatValue - baseValue);
  }

  const pairCount = diffs.length;
  const meanDiff = mean(diffs);
  const droppedPairs = dropped.slice(0, 20);
  if (pairCount < 2 || meanDiff === null) {
    return {
      metric, pairCount, droppedPairCount: dropped.length, droppedPairs,
      meanDiff: round(meanDiff), sd: null, standardError: null, ci95: null, cohensDz: null,
    };
  }
  const variance = diffs.reduce((total, diff) => total + (diff - meanDiff) ** 2, 0) / (pairCount - 1);
  const sd = Math.sqrt(variance);
  const standardError = sd / Math.sqrt(pairCount);
  const margin = Z_95 * standardError;
  return {
    metric,
    pairCount,
    droppedPairCount: dropped.length,
    droppedPairs,
    meanDiff: round(meanDiff),
    sd: round(sd),
    standardError: round(standardError),
    ci95: [round(meanDiff - margin), round(meanDiff + margin)],
    cohensDz: sd === 0 ? 0 : round(meanDiff / sd),
  };
}

function armIntegrityViolated(summary) {
  return summary.safety?.violated === true || summary.anchors?.violated === true;
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
  const integrityViolated = armIntegrityViolated(baseline) || armIntegrityViolated(treatment);
  const belowFloor = baseline.gate === 'insufficient-sample' || treatment.gate === 'insufficient-sample';
  // A `fail` gate that is not a safety/anchor violation is a flake/stability
  // failure: the sample is unstable, which is not usable evidence either way.
  const unstable =
    (baseline.gate === 'fail' && !armIntegrityViolated(baseline))
    || (treatment.gate === 'fail' && !armIntegrityViolated(treatment));

  if (integrityViolated) {
    verdict = 'safety-regression';
    reasons.push('safety-required case or positive/negative anchor violated');
  } else if (!safetyOk) {
    verdict = 'safety-regression';
    reasons.push('safety violations observed');
  } else if (belowFloor) {
    verdict = 'insufficient-sample';
    reasons.push(
      `complete cases below the pre-registered floor of ${minCases} `
      + `(baseline ${baseline.completeCaseCount}, treatment ${treatment.completeCaseCount})`,
    );
  } else if (treatment.incompleteCaseCount > 0 || baseline.incompleteCaseCount > 0) {
    verdict = 'insufficient-sample';
    reasons.push('incomplete cases present');
  } else if (unstable) {
    verdict = 'insufficient-sample';
    reasons.push('flake rate above the frozen threshold; the sample is not stable');
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
  if (effect.droppedPairCount > 0) reasons.push(`${effect.droppedPairCount} pair(s) dropped as non-numeric or unmatched`);

  return { preRegistered, baseline, treatment, effect, verdict, reasons };
}