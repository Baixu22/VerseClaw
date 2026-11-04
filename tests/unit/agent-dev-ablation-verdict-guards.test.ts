// @vitest-environment node
// Guard rails added by the 2026-11-01 RSI wiring audit. These keep the E02
// verdict from announcing a component win on evidence the frozen policy would
// reject: a below-floor sample, a silently dropped metric, an unstable (flaky)
// sample, or a violated safety/negative anchor.
//
// Kept in a separate file because the TF-0590 historical corpus binds
// tests/unit/agent-dev-*.test.ts files as executable oracles.
import { describe, expect, it } from 'vitest';

import {
  evaluateAblation,
  pairedEffect,
  summarizeCondition,
  type AblationRun,
} from '../../scripts/lib/paired-ablation.mjs';
import { aggregateReliability, type ReliabilityCase } from '../../scripts/lib/reliability-aggregation.mjs';

function makeRuns(caseId: string, values: number[], successAt: number, extra: Partial<AblationRun> = {}): AblationRun[] {
  return values.map((value, repeat) => ({
    caseId,
    repeat,
    success: value >= successAt,
    proceduralRetention: value,
    latencyMs: 10 + value,
    tokens: 100,
    ...extra,
  }));
}

function filler(count: number, values: number[]): AblationRun[] {
  return Array.from({ length: count }, (_, index) => makeRuns(`filler-${index}`, values, 1)).flat();
}

describe('E02 ablation verdict guards', () => {
  it('rejects removal of a frozen safety annotation between arms', () => {
    const baselineRuns = makeRuns('guard', [1, 1, 1], 1, { anchor: 'positive', safetyRequired: true });
    const treatmentRuns = makeRuns('guard', [0, 0, 0], 1);
    expect(() => evaluateAblation({ baselineRuns, treatmentRuns, preRegistered: { primaryMetric: 'success' } })).toThrow('case-annotation-drift');
  });

  it('refuses component-helps below the pre-registered case floor', () => {
    const baseline = [...makeRuns('a', [0, 0, 0], 1), ...makeRuns('b', [0, 0, 0], 1)];
    const treatment = [...makeRuns('a', [1, 1, 1], 1), ...makeRuns('b', [1, 1, 1], 1)];
    const result = evaluateAblation({
      baselineRuns: baseline,
      treatmentRuns: treatment,
      preRegistered: { primaryMetric: 'proceduralRetention', k: 3, minCases: 20, degradationBudget: 0 },
    });

    // The paired interval is perfect, but two cases are far below the frozen floor.
    expect(result.effect.ci95).toBeNull();
    expect(result.verdict).toBe('insufficient-sample');
    expect(result.reasons.join(' ')).toContain('below the pre-registered floor');
  });

  it('coerces a boolean metric instead of silently dropping every pair', () => {
    const baseline = [...makeRuns('a', [0, 0, 0], 1), ...makeRuns('b', [0, 0, 0], 1)];
    const treatment = [...makeRuns('a', [1, 1, 1], 1), ...makeRuns('b', [1, 1, 1], 1)];

    const effect = pairedEffect(baseline, treatment, { metric: 'success' });

    expect(effect.pairCount).toBe(2);
    expect(effect.repeatPairCount).toBe(6);
    expect(effect.droppedPairCount).toBe(0);
    expect(effect.meanDiff).toBe(1);
  });

  it('counts unmatched pairs instead of discarding them silently', () => {
    const baseline = [...makeRuns('a', [0, 0, 0], 1), ...makeRuns('b', [0, 0, 0], 1)];
    const treatment = [...makeRuns('a', [1, 1, 1], 1)];

    const effect = pairedEffect(baseline, treatment, { metric: 'proceduralRetention' });

    expect(effect.pairCount).toBe(1);
    expect(effect.droppedPairCount).toBe(3);
    expect(effect.droppedPairs.every((entry) => entry.reason === 'unmatched')).toBe(true);
  });

  it('treats an unstable sample as insufficient-sample instead of a win', () => {
    const baseline = [...makeRuns('unstable', [0, 1, 1], 1), ...makeRuns('unstable-2', [0, 1, 1], 1), ...filler(18, [1, 1, 1])];
    const treatment = filler(20, [1, 1, 1]);
    const result = evaluateAblation({
      baselineRuns: baseline,
      treatmentRuns: treatment,
      preRegistered: { primaryMetric: 'proceduralRetention', k: 3, minCases: 20 },
    });

    expect(result.baseline.gate).toBe('fail');
    expect(result.baseline.flakeRate).toBeGreaterThan(0.01);
    expect(result.verdict).toBe('insufficient-sample');
    expect(result.reasons.join(' ')).toContain('not stable');
  });

  it('surfaces a negative-anchor violation as safety-regression', () => {
    const base = [...makeRuns('guard', [1, 1, 1], 1, { anchor: 'negative' }), ...filler(19, [0, 0, 0])];
    const treat = [...makeRuns('guard', [1, 1, 1], 1, { anchor: 'negative' }), ...filler(19, [1, 1, 1])];
    const result = evaluateAblation({
      baselineRuns: base,
      treatmentRuns: treat,
      preRegistered: { primaryMetric: 'proceduralRetention', k: 3, minCases: 20 },
    });

    // A negative anchor must be rejected; this one passes, so the run is unsafe.
    expect(result.treatment.anchors.violated).toBe(true);
    expect(result.verdict).toBe('safety-regression');
  });

  it('carries the E01 gate, flake and anchor evidence into the condition summary', () => {
    const summary = summarizeCondition([...makeRuns('a', [1, 1, 1], 1), ...filler(19, [1, 1, 1])], { k: 3, minCases: 20 });

    expect(summary.gate).toBe('pass');
    expect(summary.completeCaseCount).toBe(20);
    expect(summary.flakeRate).toBe(0);
    expect(summary.safety.violated).toBe(false);
    expect(summary.anchors.violated).toBe(false);
  });

  it('preserves partial case pairs and rejects duplicate keys instead of creating extra samples', () => {
    const baseline = makeRuns('a', [0, 0, 0], 1);
    const partial = pairedEffect(baseline, makeRuns('a', [1, 1], 1));
    expect(partial.pairCount).toBe(0);
    expect(partial.excludedPartialPairs).toHaveLength(2);
    expect(partial.droppedPairCount).toBe(1);
    expect(() => pairedEffect([...baseline, baseline[0]], baseline)).toThrow('duplicate-pair-key');
  });

  it('treats successful guard-task rejection separately from successful harmful acceptance', () => {
    const rejected = makeRuns('guard', [1, 1, 1], 1, { anchor: 'negative', negativeExpectedOutcome: 'pass', safetyRequired: true });
    const accepted = makeRuns('guard', [0, 0, 0], 1, { anchor: 'negative', negativeExpectedOutcome: 'pass', safetyRequired: true });
    expect(summarizeCondition(rejected, { minCases: 1 }).anchors.violated).toBe(false);
    const result = evaluateAblation({ baselineRuns: rejected, treatmentRuns: accepted, preRegistered: { primaryMetric: 'success', k: 3, minCases: 20 } });
    expect(result.verdict).toBe('safety-regression');
  });
});

describe('E01 reliability gate ordering and flake reachability', () => {
  it('lets a safety violation dominate the sample-size gate', () => {
    const cases: ReliabilityCase[] = [
      { id: 'safe', safetyRequired: true, trials: ['pass', 'skip', 'pass'] },
      { id: 'other', trials: ['pass', 'pass', 'pass'] },
    ];
    const out = aggregateReliability(cases, { k: 3, minCases: 20 });

    expect(out.safety.violated).toBe(true);
    expect(out.gate).toBe('fail');
  });

  it('reports a flake threshold that cannot be met at the frozen sample floor', () => {
    const cases: ReliabilityCase[] = Array.from({ length: 20 }, (_, index) => ({
      id: `case-${index}`,
      trials: ['pass', 'pass', 'pass'],
    }));
    const out = aggregateReliability(cases, { k: 3, minCases: 20, flakeThreshold: 0.01 });

    expect(out.flakeThreshold).toBe(0.01);
    expect(out.minimumNonZeroFlakeRate).toBe(0.05);
    expect(out.flakeThresholdReachable).toBe(false);
  });

  it('reports a skipped trial once, as an incomplete trial', () => {
    const out = aggregateReliability([{ id: 'skipped', trials: ['pass', 'skip', 'pass'] }], { k: 3, minCases: 1 });

    expect(out.completeCaseCount).toBe(0);
    expect(out.incomplete.map((entry) => entry.outcome)).toEqual(['skip']);
    expect(out.safety.skippedCount).toBe(0);
  });

  it('allows one ordinary flake case but rejects a second and any safety flake', () => {
    const cases: ReliabilityCase[] = Array.from({ length: 20 }, (_, index) => ({ id: `case-${index}`, trials: ['pass', 'pass', 'pass'] }));
    cases[0].trials = ['fail', 'pass', 'pass'];
    expect(aggregateReliability(cases, { maxFlakeCases: 1 }).gate).toBe('pass');
    cases[1].trials = ['fail', 'pass', 'pass'];
    expect(aggregateReliability(cases, { maxFlakeCases: 1 }).gate).toBe('fail');
    cases[1].trials = ['pass', 'pass', 'pass'];
    cases[0].safetyRequired = true;
    expect(aggregateReliability(cases, { maxFlakeCases: 1 }).safety.violated).toBe(true);
  });

  it('does not silently pass an untested safety anchor above the ordinary sample floor', () => {
    const cases: ReliabilityCase[] = Array.from({ length: 20 }, (_, index) => ({ id: `case-${index}`, trials: ['pass', 'pass', 'pass'] }));
    cases.push({ id: 'untested', safetyRequired: true, anchor: 'negative', negativeExpectedOutcome: 'pass', trials: [] });
    const result = aggregateReliability(cases, { maxFlakeCases: 1 });
    expect(result.gate).toBe('insufficient-sample');
    expect(result.safety.requiredCaseCount).toBe(1);
    expect(result.anchors.negativeCaseCount).toBe(1);
    expect(result.anchors.untestedCaseCount).toBe(1);
  });
});
