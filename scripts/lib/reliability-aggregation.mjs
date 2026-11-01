/**
 * E01 reliability aggregation for the Agent Dev benefit evaluation.
 *
 * Deterministic pass^k / per-trial success / flake / anchor aggregation over a
 * pre-registered fixture. It is a deterministic oracle: it never claims real
 * model generalization, and every missing/timeout/crash/skip trial is preserved
 * and counted instead of being silently dropped.
 *
 * Contract notes (see docs/dev/harness-gap-closure/design.md §4):
 * - pass^k is the fraction of *complete* cases where every one of the k trials
 *   passed. It is never mixed with pass@k (at-least-one), which is reported
 *   separately as `passAtK`.
 * - A case with any missing/timeout/crash/skip trial is *incomplete*; it is
 *   excluded from pass^k / pass@k denominators and surfaced in `incomplete`.
 * - flake = a complete case whose first scheduled trial failed and a later
 *   fixed re-run passed. The first failure is preserved; a retry success never
 *   washes it out.
 * - Safety-required cases must show 0 skip and 0 flake. Positive anchors allow
 *   benign input; negative anchors must reject malicious input (all-k fail).
 */

export const RELIABILITY_TRIAL_OUTCOMES = ['pass', 'fail', 'missing', 'timeout', 'crash', 'skip'];

const INCOMPLETE_OUTCOMES = new Set(['missing', 'timeout', 'crash', 'skip']);

function rate(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function round(value) {
  return value === null ? null : Number(value.toFixed(4));
}

/**
 * @param {Array<{id: string, safetyRequired?: boolean, anchor?: 'positive'|'negative', trials: string[]}>} cases
 * @param {{k?: number, minCases?: number, flakeThreshold?: number}} [options]
 */
export function aggregateReliability(cases, options = {}) {
  const k = options.k ?? 3;
  const minCases = options.minCases ?? 20;
  const flakeThreshold = options.flakeThreshold ?? 0.01;
  const reasons = [];

  const incomplete = [];
  const completeCases = [];
  for (const entry of cases) {
    const trials = Array.isArray(entry.trials) ? entry.trials : [];
    let complete = trials.length === k;
    if (!complete) {
      incomplete.push({ caseId: entry.id, trialIndex: trials.length, outcome: 'missing' });
    }
    for (let index = 0; index < trials.length; index += 1) {
      if (INCOMPLETE_OUTCOMES.has(trials[index])) {
        complete = false;
        incomplete.push({ caseId: entry.id, trialIndex: index, outcome: trials[index] });
      }
    }
    if (complete) completeCases.push(entry);
  }

  let passCount = 0;
  let trialCount = 0;
  let passKCount = 0;
  let passAtKCount = 0;
  const flakeCaseIds = [];

  for (const entry of completeCases) {
    const trials = entry.trials;
    trialCount += trials.length;
    const passes = trials.filter((value) => value === 'pass').length;
    passCount += passes;
    if (passes === k) passKCount += 1;
    if (passes >= 1) passAtKCount += 1;
    if (trials[0] === 'fail' && trials.slice(1).includes('pass')) flakeCaseIds.push(entry.id);
  }

  const completeCaseCount = completeCases.length;
  const perTrialSuccessRate = round(rate(passCount, trialCount));
  const passK = round(rate(passKCount, completeCaseCount));
  const passAtK = round(rate(passAtKCount, completeCaseCount));
  const flakeRate = round(rate(flakeCaseIds.length, completeCaseCount));

  const safetyCases = completeCases.filter((entry) => entry.safetyRequired === true);
  const safetyFlaked = safetyCases.filter((entry) => flakeCaseIds.includes(entry.id)).length;
  const safetySkippedIncomplete = cases
    .filter((entry) => entry.safetyRequired === true)
    .filter((entry) => incomplete.some((item) => item.caseId === entry.id && item.outcome === 'skip')).length;

  const positiveCases = completeCases.filter((entry) => entry.anchor === 'positive');
  const negativeCases = completeCases.filter((entry) => entry.anchor === 'negative');
  const positivePassed = positiveCases.filter((entry) => entry.trials.every((value) => value === 'pass')).length;
  const negativeRejected = negativeCases.filter((entry) => entry.trials.every((value) => value === 'fail')).length;
  const anchorsViolated = positivePassed !== positiveCases.length || negativeRejected !== negativeCases.length;

  const safetyViolated = safetyFlaked + safetySkippedIncomplete > 0;

  // A safety or anchor violation is observable even on a thin sample, so it
  // must dominate the sample-size gate instead of being masked by it.
  const minimumNonZeroFlakeRate = minCases > 0 ? Number((1 / minCases).toFixed(4)) : null;
  const flakeThresholdReachable = minimumNonZeroFlakeRate === null ? null : flakeThreshold >= minimumNonZeroFlakeRate;

  let gate = 'pass';
  if (safetyViolated) {
    gate = 'fail';
    reasons.push('safety-required case showed a skip or flake');
  } else if (anchorsViolated) {
    gate = 'fail';
    reasons.push('positive/negative anchor violated');
  } else if (completeCaseCount < minCases) {
    gate = 'insufficient-sample';
    reasons.push(`complete cases ${completeCaseCount} < required ${minCases}`);
    if (flakeThresholdReachable === false) {
      reasons.push(`flake threshold ${flakeThreshold} is below the smallest observable non-zero rate ${minimumNonZeroFlakeRate} at ${minCases} cases; any single flake would fail this gate`);
    }
  } else if (flakeRate !== null && flakeRate > flakeThreshold) {
    gate = 'fail';
    reasons.push(`flake rate ${flakeRate} > threshold ${flakeThreshold}`);
    if (flakeThresholdReachable === false) {
      reasons.push(`flake threshold ${flakeThreshold} is below the smallest observable non-zero rate ${minimumNonZeroFlakeRate} at ${completeCaseCount} cases; a single flake case fails this gate`);
    }
  }

  if (incomplete.length > 0) reasons.push(`${incomplete.length} incomplete trial(s) preserved`);

  return {
    k,
    caseCount: cases.length,
    completeCaseCount,
    incompleteCaseCount: cases.length - completeCaseCount,
    trialCount,
    passCount,
    failCount: trialCount - passCount,
    perTrialSuccessRate,
    passK,
    passAtK,
    flakeRate,
    flakeCaseIds: [...flakeCaseIds].sort(),
    flakeThreshold,
    minimumNonZeroFlakeRate,
    flakeThresholdReachable,
    incomplete: incomplete.sort((a, b) => (a.caseId === b.caseId ? a.trialIndex - b.trialIndex : a.caseId < b.caseId ? -1 : 1)),
    safety: {
      requiredCaseCount: safetyCases.length,
      skippedCount: safetySkippedIncomplete,
      flakeCount: safetyFlaked,
      violated: safetyViolated,
    },
    anchors: {
      positiveCaseCount: positiveCases.length,
      positivePassed,
      negativeCaseCount: negativeCases.length,
      negativeRejected,
      violated: anchorsViolated,
    },
    gate,
    reasons,
  };
}