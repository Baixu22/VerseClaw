// @vitest-environment node
// E01 reliability aggregation: deterministic pass^k / flake / anchor fixture.
// See docs/dev/harness-gap-closure/design.md §4 for the pre-registered thresholds.
import { describe, expect, it } from 'vitest';

import {
  aggregateReliability,
  type ReliabilityCase,
} from '../../scripts/lib/reliability-aggregation.mjs';

describe('aggregateReliability', () => {
  it('computes pass^k and pass@k separately on the 2-case x 3-run fixture (PPP/PPF)', () => {
    const cases: ReliabilityCase[] = [
      { id: 'case-a', trials: ['pass', 'pass', 'pass'], anchor: 'positive' },
      { id: 'case-b', trials: ['pass', 'pass', 'fail'] },
    ];
    const out = aggregateReliability(cases, { k: 3, minCases: 2 });

    // pass^1 == per-trial success rate; pass^3 == all-k success fraction.
    expect(out.perTrialSuccessRate).toBe(0.8333);
    expect(out.passK).toBe(0.5);
    expect(out.passAtK).toBe(1);
    expect(out.passK).not.toBe(out.passAtK);
    expect(out.completeCaseCount).toBe(2);
    expect(out.incompleteCaseCount).toBe(0);
    expect(out.flakeRate).toBe(0);
  });

  it('preserves missing/timeout/crash/skip as incomplete and excludes them from denominators', () => {
    const cases: ReliabilityCase[] = [
      { id: 'ok', trials: ['pass', 'pass', 'pass'] },
      { id: 'missing', trials: ['pass'] },
      { id: 'timeout', trials: ['pass', 'timeout', 'pass'] },
      { id: 'crash', trials: ['crash', 'pass', 'pass'] },
      { id: 'skip', trials: ['pass', 'skip', 'pass'] },
    ];
    const out = aggregateReliability(cases, { k: 3, minCases: 1 });

    expect(out.caseCount).toBe(5);
    expect(out.completeCaseCount).toBe(1);
    expect(out.incompleteCaseCount).toBe(4);
    const outcomes = out.incomplete
      .map((entry) => `${entry.caseId}:${entry.outcome}`)
      .sort();
    expect(outcomes).toEqual(['crash:crash', 'missing:missing', 'skip:skip', 'timeout:timeout']);
    // Only the single complete case contributes to the denominators.
    expect(out.passK).toBe(1);
    expect(out.trialCount).toBe(3);
  });

  it('flags a flake only when the first scheduled trial failed and a later re-run passed', () => {
    const flaky: ReliabilityCase[] = [{ id: 'flaky', trials: ['fail', 'fail', 'pass'] }];
    const flaked = aggregateReliability(flaky, { k: 3, minCases: 1 });
    expect(flaked.flakeCaseIds).toEqual(['flaky']);
    expect(flaked.flakeRate).toBe(1);
    expect(flaked.gate).toBe('fail'); // flake above threshold

    const stable: ReliabilityCase[] = [{ id: 'stable-fail', trials: ['fail', 'fail', 'fail'] }];
    const earlyFailLateFail = aggregateReliability(stable, { k: 3, minCases: 1 });
    expect(earlyFailLateFail.flakeCaseIds).toEqual([]);
    expect(earlyFailLateFail.flakeRate).toBe(0);
  });

  it('fails the gate when a safety-required case is skipped', () => {
    const cases: ReliabilityCase[] = [
      { id: 'safe', safetyRequired: true, trials: ['pass', 'skip', 'pass'] },
      { id: 'other', trials: ['pass', 'pass', 'pass'] },
    ];
    const out = aggregateReliability(cases, { k: 3, minCases: 1 });
    expect(out.safety.violated).toBe(true);
    expect(out.safety.skippedCount).toBe(1);
    expect(out.gate).toBe('fail');
  });

  it('enforces positive (must pass) and negative (must reject) anchors', () => {
    const good: ReliabilityCase[] = [
      { id: 'benign', anchor: 'positive', trials: ['pass', 'pass', 'pass'] },
      { id: 'malicious', anchor: 'negative', trials: ['fail', 'fail', 'fail'] },
    ];
    const ok = aggregateReliability(good, { k: 3, minCases: 1 });
    expect(ok.anchors.violated).toBe(false);

    const bad: ReliabilityCase[] = [
      { id: 'benign', anchor: 'positive', trials: ['pass', 'fail', 'pass'] },
      { id: 'malicious', anchor: 'negative', trials: ['fail', 'pass', 'fail'] },
    ];
    const violated = aggregateReliability(bad, { k: 3, minCases: 1 });
    expect(violated.anchors.violated).toBe(true);
    expect(violated.gate).toBe('fail');
  });

  it('reports insufficient-sample instead of passing when complete cases are below the gate', () => {
    const cases: ReliabilityCase[] = [{ id: 'only', trials: ['pass', 'pass', 'pass'] }];
    const out = aggregateReliability(cases, { k: 3, minCases: 20 });
    expect(out.gate).toBe('insufficient-sample');
    expect(out.reasons.join(' ')).toContain('complete cases 1 < required 20');
  });
});