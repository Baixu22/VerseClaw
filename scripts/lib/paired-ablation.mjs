/**
 * E02 paired-ablation aggregation.
 *
 * Deterministic paired-ablation summary: pass^k (via the E01 aggregator),
 * p50/p95 latency, mean tokens, false blocks and safety violations per
 * condition, plus a paired effect size with a 95% confidence interval and a
 * pre-registered verdict. It never invents a positive effect: a zero or
 * negative effect is a valid, reported result.
 *
 * Repeats establish matching; complete case clusters are the sole inference
 * unit. Boolean success is reduced to pass^k, other metrics to a case mean.
 * CI, variance and the labelled power approximation share this implementation.
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

/**
 * Promotion gate over already-computed evidence. It mirrors
 * promotion-policy.v2 -> promotion.thresholds: absolute pass^k improvement at or
 * above the product floor, a paired 95% interval whose lower bound is strictly
 * positive, cost inside the ceiling, and no safety/anchor regression. A missing
 * cost dimension disqualifies promotion but is not itself a regression, so it
 * returns 'hold' rather than 'eliminate'. 'component-helps' remains a statement
 * about the statistics; only this gate may say 'promote'.
 */
export function evaluatePromotion(input = {}) {
  const minimumImprovement = input.minimumImprovement ?? 0.05;
  const costIncreaseMaximum = input.costIncreaseMaximum ?? null;
  const meanDiff = input.meanDiff ?? null;
  const ci95 = input.ci95 ?? null;
  const costIncrease = input.costIncrease ?? null;
  if (!Number.isFinite(minimumImprovement) || minimumImprovement <= 0) throw new Error('invalid-minimum-improvement');
  if (costIncreaseMaximum !== null && (!Number.isFinite(costIncreaseMaximum) || costIncreaseMaximum < 0)) throw new Error('invalid-cost-ceiling');
  const thresholds = { minimumAbsoluteImprovement: minimumImprovement, costIncreaseMaximum };
  const observed = { meanDiff: Number.isFinite(meanDiff) ? meanDiff : null,
    ci95Lower: Array.isArray(ci95) && Number.isFinite(ci95[0]) ? ci95[0] : null,
    costIncrease: Number.isFinite(costIncrease) ? costIncrease : null };
  const result = (status, reasons) => ({ status, reasons, thresholds, observed });
  if (input.integrityViolated === true) return result('eliminate', ['safety-required case or positive/negative anchor violated']);
  if (input.sampleSufficient !== true) return result('insufficient-evidence', ['complete-case or paired-case floor not met']);
  if (input.unstable === true) return result('hold', ['sample is unstable (flake above the frozen allowance)']);
  if (costIncreaseMaximum !== null && costIncrease === Infinity) return result('eliminate', ['cost increase is unbounded from a zero baseline']);
  if (costIncreaseMaximum !== null && (!Number.isFinite(costIncrease) || costIncrease < -1)) return result('hold', ['cost dimension missing or invalid; promotion is disqualified']);
  if (costIncreaseMaximum !== null && costIncrease > costIncreaseMaximum) {
    return result('eliminate', [`cost increase ${costIncrease} exceeds ceiling ${costIncreaseMaximum}`]);
  }
  if (!Number.isFinite(meanDiff)) return result('insufficient-evidence', ['no valid paired effect was computed']);
  if (meanDiff < minimumImprovement) {
    return result('hold', [`observed improvement ${meanDiff} is below the ${minimumImprovement} product floor`]);
  }
  if (!Array.isArray(ci95) || ci95.length !== 2 || !ci95.every(Number.isFinite)
    || ci95[0] > meanDiff || ci95[1] < meanDiff) return result('hold', ['no usable paired interval (degenerate variance, invalid or missing pairs)']);
  if (!(ci95[0] > 0)) return result('hold', ['95% interval lower bound is not above zero']);
  return result('promote', ['improvement meets the product floor and the interval excludes zero']);
}

export function summarizeCondition(runs, options = {}) {
  const k = options.k ?? 3;
  const minCases = options.minCases ?? 20;
  if (!Number.isInteger(k) || k < 1 || !Number.isInteger(minCases) || minCases < 1) throw new Error('invalid-paired-design');
  const byCase = new Map();
  pairByKey(runs);
  for (const run of runs) {
    if (run.outcome !== undefined && !['pass', 'fail', 'missing', 'timeout', 'crash', 'skip'].includes(run.outcome)) throw new Error('unknown-trial-outcome');
    if (run.outcome === undefined && ![true, false, 0, 1].includes(run.success)) throw new Error('invalid-success-metric');
    if (['pass', 'fail'].includes(run.outcome) && run.success !== undefined
      && numericMetric(run.success) !== Number(run.outcome === 'pass')) throw new Error('outcome-metric-mismatch');
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
        negativeExpectedOutcome: caseRuns.find((run) => run.negativeExpectedOutcome)?.negativeExpectedOutcome,
        trials: caseRuns
          .slice()
          .sort((a, b) => a.repeat - b.repeat)
          .map((run) => run.outcome ?? (run.success ? 'pass' : 'fail')),
      };
    });

  const reliability = aggregateReliability(reliabilityCases, { ...options, k, minCases });
  const measured = (metric) => runs.length > 0 && runs.every((run) => Number.isFinite(run[metric]) && run[metric] >= 0)
    ? runs.map((run) => run[metric]) : [];
  const latencies = measured('latencyMs').sort((a, b) => a - b);
  const tokens = measured('tokens');

  return {
    runCount: runs.length,
    caseCount: byCase.size,
    successRate: reliability.perTrialSuccessRate,
    passK: reliability.passK,
    passAtK: reliability.passAtK,
    p50LatencyMs: round(quantile(latencies, 0.5)),
    p95LatencyMs: round(quantile(latencies, 0.95)),
    meanTokens: mean(tokens),
    falseBlocks: runs.filter((run) => run.falseBlock === true).length,
    safetyViolations: runs.filter((run) => run.safetyViolation === true).length,
    completeCaseCount: reliability.completeCaseCount,
    incompleteCaseCount: reliability.incompleteCaseCount,
    flakeRate: reliability.flakeRate,
    flakeCaseIds: reliability.flakeCaseIds,
    flakeMode: reliability.flakeMode,
    maxFlakeCases: reliability.maxFlakeCases,
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
  for (const run of runs) {
    if (typeof run?.caseId !== 'string' || !run.caseId.trim() || !Number.isInteger(run.repeat) || run.repeat < 0) throw new Error('invalid-pair-key');
    const key = `${run.caseId}::${run.repeat}`;
    if (map.has(key)) throw new Error('duplicate-pair-key');
    map.set(key, run);
  }
  return map;
}

export function pairedEffect(baselineRuns, treatmentRuns, options = {}) {
  const metric = options.metric ?? 'success';
  const k = options.k ?? 3;
  const minCases = options.minCases ?? 20;
  if (!Number.isInteger(k) || k < 1 || !Number.isInteger(minCases) || minCases < 1) throw new Error('invalid-paired-design');
  const baseline = pairByKey(baselineRuns);
  const treatment = pairByKey(treatmentRuns);
  const byCase = new Map();
  const dropped = [];
  for (const key of new Set([...baseline.keys(), ...treatment.keys()])) {
    const baseRun = baseline.get(key);
    const treatRun = treatment.get(key);
    if (!baseRun || !treatRun) {
      dropped.push({ key, reason: 'unmatched' });
      continue;
    }
    const baseValue = numericMetric(baseRun[metric]);
    const treatValue = numericMetric(treatRun[metric]);
    if (baseValue === null || treatValue === null || (metric === 'success' && ![baseValue, treatValue].every((value) => value === 0 || value === 1))) {
      dropped.push({ key, reason: 'non-numeric-metric' });
      continue;
    }
    if ([baseRun, treatRun].some((run) => (run.outcome !== undefined && !['pass', 'fail'].includes(run.outcome))
      || (run.failureClass != null && run.failureClass !== 'agent'))) {
      dropped.push({ key, reason: 'ineligible-trial' });
      continue;
    }
    const pairs = byCase.get(baseRun.caseId) ?? [];
    pairs.push({ caseId: baseRun.caseId, repeat: baseRun.repeat, baseline: baseValue, treatment: treatValue });
    byCase.set(baseRun.caseId, pairs);
  }
  const diffs = [], caseIds = [], excludedPartialPairs = [];
  for (const [caseId, pairs] of [...byCase.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const repeats = pairs.map((pair) => pair.repeat).sort((a, b) => a - b);
    const complete = pairs.length === k && repeats.every((repeat, index) => repeat === index + repeats[0])
      && (repeats[0] === 0 || repeats[0] === 1);
    if (!complete) {
      excludedPartialPairs.push(...pairs);
      continue;
    }
    const value = (arm) => metric === 'success'
      ? Number(pairs.every((pair) => pair[arm] === 1))
      : mean(pairs.map((pair) => pair[arm]));
    diffs.push(value('treatment') - value('baseline'));
    caseIds.push(caseId);
  }
  const pairCount = diffs.length;
  const meanDiff = mean(diffs);
  const sd = pairCount > 1 ? Math.sqrt(diffs.reduce((total, diff) => total + (diff - meanDiff) ** 2, 0) / (pairCount - 1)) : null;
  const varianceUsable = sd !== null && sd > 0;
  const standardError = varianceUsable ? sd / Math.sqrt(pairCount) : null;
  const margin = varianceUsable ? Z_95 * standardError : null;
  const precise = (value) => value === null ? null : Number(value.toFixed(6));
  const minimumEffect = options.minimumEffect ?? 0.05;
  if (!Number.isFinite(minimumEffect) || minimumEffect <= 0) throw new Error('invalid-minimum-effect');
  const enoughCases = pairCount >= minCases;
  const detectable = enoughCases && varianceUsable ? (Z_95 + 0.841621) * sd / Math.sqrt(pairCount) : null;
  const powerStatus = detectable === null ? 'insufficient-evidence' : detectable > minimumEffect ? 'underpowered' : 'design-computed';
  const requiredCases = detectable === null ? null : Math.ceil(((Z_95 + 0.841621) * sd / minimumEffect) ** 2);
  return {
    metric,
    pairCount,
    repeatPairCount: [...byCase.values()].reduce((count, pairs) => count + pairs.length, 0),
    pairUnit: 'caseId/repeat', inferenceUnit: 'caseId',
    aggregation: metric === 'success' ? 'pass^k' : 'case-mean',
    caseIds,
    excludedPartialPairs,
    droppedPairCount: dropped.length,
    droppedPairs: dropped.slice(0, 20),
    meanDiff,
    sd: precise(sd),
    standardError: precise(standardError),
    ci95: varianceUsable && enoughCases ? [precise(meanDiff - margin), precise(meanDiff + margin)] : null,
    cohensDz: varianceUsable && enoughCases ? precise(meanDiff / sd) : null,
    varianceStatus: sd === null ? 'not-estimable' : sd === 0 ? 'degenerate' : 'estimated',
    power: {
      status: powerStatus,
      method: `normal-approximation paired ${metric === 'success' ? 'pass^k' : metric} over complete case clusters; planning only`,
      inferenceUnit: 'caseId', reason: !enoughCases ? 'paired-case-floor-not-met' : !varianceUsable ? 'degenerate-variance' : 'observed-variance-design',
      confidenceLevel: 0.95, targetPower: 0.8, minimumDetectableEffect: minimumEffect,
      observedDetectableEffect: precise(detectable), requiredCasesApprox: requiredCases,
      requiredPairsApprox: requiredCases === null ? null : k * requiredCases,
      passKPower: powerStatus,
    },
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
  const annotations = new Map();
  for (const run of [...baselineRuns, ...treatmentRuns]) {
    const annotation = JSON.stringify([run.safetyRequired === true, run.anchor ?? null, run.negativeExpectedOutcome ?? 'fail']);
    if (annotations.has(run.caseId) && annotations.get(run.caseId) !== annotation) throw new Error('case-annotation-drift');
    annotations.set(run.caseId, annotation);
  }
  const k = preRegistered.k ?? 3;
  const minCases = preRegistered.minCases ?? 20;
  const budget = preRegistered.degradationBudget ?? 0;
  const baseline = summarizeCondition(baselineRuns, { ...preRegistered, k, minCases });
  const treatment = summarizeCondition(treatmentRuns, { ...preRegistered, k, minCases });
  const effect = pairedEffect(baselineRuns, treatmentRuns, { ...preRegistered, metric: preRegistered.primaryMetric, k, minCases });

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
  } else if (effect.pairCount < minCases || effect.droppedPairCount > 0 || effect.excludedPartialPairs.length > 0) {
    verdict = 'insufficient-sample';
    reasons.push('complete paired-case floor not met or incomplete metric pairs preserved');
  } else if (effect.ci95 === null && effect.meanDiff === 0) {
    reasons.push('zero observed effect; degenerate variance does not establish equivalence or promotion');
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

  const promotion = evaluatePromotion({
    minimumImprovement: preRegistered.minimumImprovement ?? preRegistered.minimumEffect ?? 0.05,
    costIncreaseMaximum: preRegistered.costIncreaseMaximum ?? null,
    meanDiff: effect.meanDiff,
    ci95: effect.ci95,
    costIncrease: preRegistered.costIncrease ?? null,
    integrityViolated: integrityViolated || !safetyOk,
    sampleSufficient:
      !belowFloor
      && treatment.incompleteCaseCount === 0
      && baseline.incompleteCaseCount === 0
      && effect.pairCount >= minCases
      && effect.droppedPairCount === 0
      && effect.excludedPartialPairs.length === 0,
    unstable,
  });

  return { preRegistered, baseline, treatment, effect, verdict, promotion, reasons };
}
