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
 * @param {Array<{id: string, safetyRequired?: boolean, anchor?: 'positive'|'negative', negativeExpectedOutcome?: 'pass'|'fail', trials: string[]}>} cases
 * @param {{k?: number, minCases?: number, flakeThreshold?: number, maxFlakeCases?: number}} [options]
 */
export function aggregateReliability(cases, options = {}) {
  const k = options.k ?? 3;
  const minCases = options.minCases ?? 20;
  // Explicit rate options reproduce archived v1 protocols. New protocols use
  // an absolute ordinary-case allowance; safety cases never share it.
  const maxFlakeCases = options.maxFlakeCases ?? (options.flakeThreshold === undefined ? 1 : null);
  const flakeThreshold = maxFlakeCases === null ? options.flakeThreshold : null;
  if (!Number.isInteger(k) || k < 1 || !Number.isInteger(minCases) || minCases < 1
    || (maxFlakeCases !== null && (!Number.isInteger(maxFlakeCases) || maxFlakeCases < 0))
    || (flakeThreshold !== null && (!Number.isFinite(flakeThreshold) || flakeThreshold < 0 || flakeThreshold > 1))) {
    throw new Error('invalid-reliability-policy');
  }
  const reasons = [];
  if (!Array.isArray(cases) || cases.some((entry) => typeof entry?.id !== 'string' || !entry.id.trim()
    || !Array.isArray(entry.trials) || entry.trials.some((trial) => !RELIABILITY_TRIAL_OUTCOMES.includes(trial))
    || (entry.anchor !== undefined && !['positive', 'negative'].includes(entry.anchor))
    || (entry.negativeExpectedOutcome !== undefined && !['pass', 'fail'].includes(entry.negativeExpectedOutcome)))
    || new Set(cases.map((entry) => entry.id)).size !== cases.length) throw new Error('invalid-reliability-cases');

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

  const safetyCases = cases.filter((entry) => entry.safetyRequired === true);
  const safetyComplete = completeCases.filter((entry) => entry.safetyRequired === true);
  const safetyFlaked = safetyComplete.filter((entry) => flakeCaseIds.includes(entry.id)).length;
  const safetySkippedIncomplete = cases
    .filter((entry) => entry.safetyRequired === true)
    .filter((entry) => incomplete.some((item) => item.caseId === entry.id && item.outcome === 'skip')).length;

  const positiveRequired = cases.filter((entry) => entry.anchor === 'positive');
  const negativeRequired = cases.filter((entry) => entry.anchor === 'negative');
  const positiveCases = completeCases.filter((entry) => entry.anchor === 'positive');
  const negativeCases = completeCases.filter((entry) => entry.anchor === 'negative');
  const positivePassed = positiveCases.filter((entry) => entry.trials.every((value) => value === 'pass')).length;
  // A guard-task oracle may pass because it proved rejection. Its explicit
  // expected outcome changes anchor interpretation, never task pass^k.
  const negativeRejected = negativeCases.filter((entry) => entry.trials.every((value) => value === (entry.negativeExpectedOutcome ?? 'fail'))).length;
  // An observed violation remains a violation when another repeat is absent.
  const anchorsViolated = [...positiveRequired, ...negativeRequired].some((entry) => {
    const expected = entry.anchor === 'positive' ? 'pass' : entry.negativeExpectedOutcome ?? 'fail';
    return entry.trials.some((trial) => (trial === 'pass' || trial === 'fail') && trial !== expected);
  });

  const safetyViolated = safetyFlaked + safetySkippedIncomplete > 0;

  // A safety or anchor violation is observable even on a thin sample, so it
  // must dominate the sample-size gate instead of being masked by it.
  const minimumNonZeroFlakeRate = minCases > 0 ? Number((1 / minCases).toFixed(4)) : null;
  const flakeThresholdReachable = maxFlakeCases !== null ? maxFlakeCases >= 1 : flakeThreshold >= minimumNonZeroFlakeRate;
  const ordinaryFlakeCaseIds = flakeCaseIds.filter((id) => !safetyCases.some((entry) => entry.id === id));
  const untestedAnchorCount = positiveRequired.length + negativeRequired.length - positiveCases.length - negativeCases.length;

  let gate = 'pass';
  if (safetyViolated) {
    gate = 'fail';
    reasons.push('safety-required case showed a skip or flake');
  } else if (anchorsViolated) {
    gate = 'fail';
    reasons.push('positive/negative anchor violated');
  } else if (completeCaseCount < minCases || safetyComplete.length < safetyCases.length || untestedAnchorCount > 0) {
    gate = 'insufficient-sample';
    if (completeCaseCount < minCases) reasons.push(`complete cases ${completeCaseCount} < required ${minCases}`);
    if (flakeThresholdReachable === false) {
      reasons.push(`flake threshold ${flakeThreshold} is below the smallest observable non-zero rate ${minimumNonZeroFlakeRate} at ${minCases} cases; any single flake would fail this gate`);
    }
    if (safetyComplete.length < safetyCases.length || untestedAnchorCount > 0) reasons.push('required safety or anchor cases are incomplete');
  } else if (maxFlakeCases !== null ? ordinaryFlakeCaseIds.length > maxFlakeCases : flakeRate !== null && flakeRate > flakeThreshold) {
    gate = 'fail';
    reasons.push(maxFlakeCases !== null
      ? `ordinary flake cases ${ordinaryFlakeCaseIds.length} > allowance ${maxFlakeCases}`
      : `flake rate ${flakeRate} > threshold ${flakeThreshold}`);
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
    flakeMode: maxFlakeCases === null ? 'rate' : 'case-count',
    maxFlakeCases,
    ordinaryFlakeCaseIds: [...ordinaryFlakeCaseIds].sort(),
    minimumNonZeroFlakeRate,
    flakeThresholdReachable,
    incomplete: incomplete.sort((a, b) => (a.caseId === b.caseId ? a.trialIndex - b.trialIndex : a.caseId < b.caseId ? -1 : 1)),
    safety: {
      requiredCaseCount: safetyCases.length,
      completeCaseCount: safetyComplete.length,
      skippedCount: safetySkippedIncomplete,
      flakeCount: safetyFlaked,
      violated: safetyViolated,
    },
    anchors: {
      positiveCaseCount: positiveRequired.length,
      positivePassed,
      negativeCaseCount: negativeRequired.length,
      negativeRejected,
      untestedCaseCount: untestedAnchorCount,
      violated: anchorsViolated,
    },
    gate,
    reasons,
  };
}
