import { describe, expect, it } from 'vitest';
import {
  F4_BUDGETS,
  aggregateStabilitySamples,
  percentile,
  type StabilitySample,
} from '../../scripts/versegit-product-stability.mts';

function sample(index: number, overrides: Partial<StabilitySample> = {}): StabilitySample {
  return {
    schema: 'clawx.versegit.f4-stability-samples/v1',
    loopId: 'f4-loop-' + String(index + 1).padStart(2, '0'),
    driven_by: 'agent',
    actor: 'codex',
    observedAt: '2026-10-23T00:00:00.000Z',
    durationMs: 10_000 + index * 100,
    peakRssKb: 200_000,
    exitCode: 0,
    passed: true,
    candidateId: 'candidate-' + index,
    candidateInputDigest: 'a'.repeat(64),
    combinedFailureStatus: 'verification-failed',
    combinedSuccessStatus: 'applied',
    individualWorkersPassed: true,
    combinedFailurePassed: true,
    combinedSuccessPassed: true,
    orderingPassed: true,
    revokedGrantRejected: true,
    undoRecovered: true,
    duplicateApplyCount: 0,
    cleanupObserved: true,
    processSurvivors: 0,
    managerSurvivors: 0,
    worktreeSurvivors: 0,
    tempSurvivors: 0,
    reportDigest: 'b'.repeat(64),
    rawReportPath: 'D:/tmp/report.json',
    ...overrides,
  };
}

describe('F4 stability report aggregation', () => {
  it('uses nearest-rank P50/P95 and passes exactly ten bounded loops', () => {
    const samples = Array.from({ length: 10 }, (_, index) => sample(index));
    const aggregate = aggregateStabilitySamples(samples);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
    expect(aggregate).toMatchObject({
      sampleCount: 10,
      successes: 10,
      failures: 0,
      failureRate: 0,
      duplicateApplyCount: 0,
      uniqueCandidateCount: 10,
      revokedGrantRejected: true,
      undoRecovered: true,
      passed: true,
      survivors: { processes: 0, managers: 0, worktrees: 0, tempRoots: 0 },
    });
  });

  it('fails closed on missing loops, failure, duplicate apply and every survivor class', () => {
    const nine = Array.from({ length: 9 }, (_, index) => sample(index));
    expect(aggregateStabilitySamples(nine).passed).toBe(false);
    const bad = Array.from({ length: 10 }, (_, index) => sample(index, index === 0 ? {
      passed: false,
      exitCode: 1,
      duplicateApplyCount: 1,
      processSurvivors: 1,
      managerSurvivors: 1,
      worktreeSurvivors: 1,
      tempSurvivors: 1,
    } : {}));
    const aggregate = aggregateStabilitySamples(bad);
    expect(aggregate.passed).toBe(false);
    expect(aggregate.failures).toBe(1);
    expect(aggregate.duplicateApplyCount).toBe(1);
    expect(aggregate.survivors).toEqual({ processes: 1, managers: 1, worktrees: 1, tempRoots: 1 });
  });

  it('uses frozen source budgets without post-run relaxation', () => {
    expect(F4_BUDGETS).toEqual({
      completeLoops: 10,
      maxFailureRate: 0,
      maxDuplicateApplyCount: 0,
      maxP95LoopMs: 180_000,
      maxPeakRssMb: 2_048,
      maxProcessSurvivors: 0,
      maxManagerSurvivors: 0,
      maxWorktreeSurvivors: 0,
      maxTempSurvivors: 0,
    });
    const overBudget = Array.from({ length: 10 }, (_, index) => sample(index, {
      durationMs: F4_BUDGETS.maxP95LoopMs + 1,
      peakRssKb: (F4_BUDGETS.maxPeakRssMb + 1) * 1024,
    }));
    expect(aggregateStabilitySamples(overBudget)).toMatchObject({
      passed: false,
      checks: { p95Loop: false, peakRss: false },
    });
  });
});
