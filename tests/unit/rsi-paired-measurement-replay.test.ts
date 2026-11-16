import { describe, expect, it } from 'vitest';
import { reconstructPairedStatistics, type ReplayPlan, type ReplayRecord } from '../../scripts/rsi-paired-measurement-replay.mjs';

function fixture(): { plan: ReplayPlan; records: ReplayRecord[] } {
  const tasks = Array.from({ length: 20 }, (_, index) => ({ id: `case-${index}` }));
  const slots = tasks.flatMap(task => ['sekb-off', 'sekb-shadow', 'sekb-confirmed'].flatMap(arm =>
    [1, 2, 3].map(repeat => ({ id: `${task.id}/${arm}/${repeat}`, caseId: task.id, arm, repeat }))));
  return { plan: { design: { k: 3, minimumCompleteCases: 20 }, tasks, slots }, records: slots.map(slot => ({ slot, outcome: 'fail' })) };
}

describe('independent v4 paired replay arithmetic', () => {
  it('separates pass^k from pass@k and counts one case for three correlated repeats', () => {
    const { plan, records } = fixture();
    records.filter(record => record.slot.caseId === 'case-0' && record.slot.arm === 'sekb-confirmed')
      .forEach(record => { record.outcome = record.slot.repeat === 2 ? 'pass' : 'fail'; });
    const result = reconstructPairedStatistics(plan, records);
    expect(result.arms['sekb-confirmed'].passK).toBe(0);
    expect(result.arms['sekb-confirmed'].passAtK).toBe(0.05);
    expect(result.comparisons['sekb-confirmed'].pairCount).toBe(20);
    expect(result.comparisons['sekb-confirmed'].ci95).toBeNull();
  });

  it('retains an observed crash and an unexecuted slot separately', () => {
    const { plan, records } = fixture();
    const crashed = records.find(record => record.slot.arm === 'sekb-confirmed')!;
    crashed.outcome = 'crash';
    const unexecuted = records.find(record => record.slot.caseId === 'case-1' && record.slot.arm === 'sekb-shadow')!;
    records.splice(records.indexOf(unexecuted), 1);
    const result = reconstructPairedStatistics(plan, records);
    expect(result.incomplete).toEqual([crashed.slot.id]);
    expect(result.missing).toEqual([unexecuted.slot.id]);
    expect(result.arms['sekb-confirmed'].completeCaseCount).toBe(19);
    expect(result.comparisons['sekb-confirmed'].pairCount).toBe(19);
    expect(result.comparisons['sekb-confirmed'].meanDiff).toBeNull();
  });

  it('rejects duplicate receipts and repeated schedule coordinates', () => {
    const { plan, records } = fixture();
    expect(() => reconstructPairedStatistics(plan, [...records, records[0]])).toThrow('replay-duplicate-or-unknown-receipt');
    plan.slots[1].repeat = 1;
    expect(() => reconstructPairedStatistics(plan, records)).toThrow('replay-repeat-schedule');
  });

  it('keeps a zero-variance difference without inventing an interval or sample size', () => {
    const { plan, records } = fixture();
    const result = reconstructPairedStatistics(plan, records).comparisons['sekb-confirmed'];
    expect(result.meanDiff).toBe(0);
    expect(result.varianceStatus).toBe('degenerate');
    expect(result.ci95).toBeNull();
    expect(result.power).toMatchObject({ status: 'insufficient-evidence', requiredCasesApprox: null });
  });

  it('computes the interval over case differences when one complete case improves', () => {
    const { plan, records } = fixture();
    records.filter(record => record.slot.caseId === 'case-0' && record.slot.arm === 'sekb-confirmed')
      .forEach(record => { record.outcome = 'pass'; });
    const result = reconstructPairedStatistics(plan, records).comparisons['sekb-confirmed'];
    expect(result.meanDiff).toBe(0.05);
    expect(result.ci95).toEqual([-0.047998, 0.147998]);
    expect(result.power).toMatchObject({ status: 'underpowered', requiredCasesApprox: 157 });
  });

  it('preserves guard-oracle semantics and zero safety-flake allowance', () => {
    const { plan, records } = fixture();
    plan.tasks[0] = { id: 'case-0', safetyRequired: true, anchor: 'negative', negativeExpectedOutcome: 'pass' };
    records.filter(record => record.slot.caseId === 'case-0' && record.slot.arm === 'sekb-confirmed')
      .forEach(record => { record.outcome = record.slot.repeat === 1 ? 'fail' : 'pass'; });
    const result = reconstructPairedStatistics(plan, records);
    expect(result.arms['sekb-confirmed'].safety.violated).toBe(true);
    expect(result.arms['sekb-confirmed'].anchors.violated).toBe(true);
    expect(result.arms['sekb-off'].anchors.violated).toBe(true);
  });
});
