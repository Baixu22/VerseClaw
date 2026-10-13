// @vitest-environment node
// E02 paired-ablation aggregation semantics (detached from the runtime run).
import { describe, expect, it } from 'vitest';

import {
  summarizeCondition,
  pairedEffect,
  evaluateAblation,
  type AblationRun,
} from '../../scripts/lib/paired-ablation.mjs';

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

describe('paired-ablation aggregation', () => {
  it('summarizes pass^k, p50/p95 latency, tokens, false blocks and safety violations', () => {
    const runs: AblationRun[] = [
      ...makeRuns('a', [1, 1, 1], 1),
      ...makeRuns('b', [1, 1, 0], 1),
      ...makeRuns('c', [0, 0, 0], 1, { falseBlock: true }),
    ];
    const summary = summarizeCondition(runs, { k: 3, minCases: 3 });
    expect(summary.caseCount).toBe(3);
    expect(summary.passK).toBe(0.3333);
    expect(summary.successRate).toBeCloseTo(5 / 9, 4);
    expect(summary.p50LatencyMs).not.toBeNull();
    expect(summary.p95LatencyMs).not.toBeNull();
    expect(summary.meanTokens).toBe(100);
    expect(summary.falseBlocks).toBe(3);
    expect(summary.safetyViolations).toBe(0);
  });

  it('computes a paired mean difference and 95% CI', () => {
    const baseline = [...makeRuns('a', [0, 0, 0], 1), ...makeRuns('b', [0, 0, 0], 1)];
    const treatment = [...makeRuns('a', [1, 1, 1], 1), ...makeRuns('b', [0.5, 0.5, 0.5], 1)];
    const effect = pairedEffect(baseline, treatment, { metric: 'proceduralRetention' });
    expect(effect.pairCount).toBe(6);
    expect(effect.meanDiff).toBeCloseTo(0.75, 4);
    expect(effect.ci95?.[0]).toBeLessThanOrEqual(effect.meanDiff as number);
    expect(effect.ci95?.[1]).toBeGreaterThanOrEqual(effect.meanDiff as number);
  });

  it('reports component-helps only when the 95% CI excludes zero on the positive side', () => {
    const baseline = [...makeRuns('a', [0, 0, 0], 1), ...makeRuns('b', [0, 0, 0], 1), ...makeRuns('c', [0, 0, 0], 1)];
    const treatment = [...makeRuns('a', [1, 1, 1], 1), ...makeRuns('b', [1, 1, 1], 1), ...makeRuns('c', [1, 1, 1], 1)];
    const result = evaluateAblation({ baselineRuns: baseline, treatmentRuns: treatment, preRegistered: { primaryMetric: 'proceduralRetention', k: 3, minCases: 3, degradationBudget: 0 } });
    expect(result.verdict).toBe('component-helps');
  });

  it('returns no-effect when the CI contains zero and never invents a win', () => {
    const baseline = [...makeRuns('a', [0, 0, 0], 1), ...makeRuns('b', [1, 1, 1], 1)];
    const treatment = [...makeRuns('a', [0, 0, 0], 1), ...makeRuns('b', [1, 1, 1], 1)];
    const result = evaluateAblation({ baselineRuns: baseline, treatmentRuns: treatment, preRegistered: { primaryMetric: 'proceduralRetention', k: 3, minCases: 2 } });
    expect(result.verdict).toBe('no-effect');
  });

  it('returns hurts on a significant negative effect and safety-regression on violations', () => {
    const base = [...makeRuns('a', [1, 1, 1], 1), ...makeRuns('b', [1, 1, 1], 1), ...makeRuns('c', [1, 1, 1], 1)];
    const worse = [...makeRuns('a', [0, 0, 0], 1), ...makeRuns('b', [0, 0, 0], 1), ...makeRuns('c', [0, 0, 0], 1)];
    expect(evaluateAblation({ baselineRuns: base, treatmentRuns: worse, preRegistered: { primaryMetric: 'proceduralRetention', k: 3, minCases: 3 } }).verdict).toBe('hurts');

    const unsafe = [...makeRuns('a', [1, 1, 1], 1, { safetyViolation: true })];
    const safe = [...makeRuns('a', [1, 1, 1], 1)];

    expect(evaluateAblation({ baselineRuns: safe, treatmentRuns: unsafe, preRegistered: { primaryMetric: 'proceduralRetention', k: 3, minCases: 1, safetyMustHold: true } }).verdict).toBe('safety-regression');
  });
});