// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isUndispatchedSpaceFailure, projectEmptyOracleReceipt } from '../../scripts/rsi-protocol-contrast-recovery.mjs';
import type { BenefitTrialReceipt } from '../../scripts/lib/rsi-benefit-eval.mjs';
const original = { execution: { status: 'completed', failureCategory: 'model', failureClass: null, providerCalls: 1 },
  rawResponse: { id: 'retained-original-response' }, providerAttempts: [{ rawResponse: { id: 'retained-original-response' } }],
  grader: { reports: [{ kind: 'vitest', exitCode: 1, report: { success: false, numTotalTests: 0, testResults: [] } }] } } as unknown as BenefitTrialReceipt;
describe('empty-oracle recovery projections', () => {
  it('keeps original execution and response bytes while projecting an incomplete outcome', () => {
    const bytes = JSON.stringify(original), projection = projectEmptyOracleReceipt(original);
    expect(JSON.stringify(original)).toBe(bytes);
    expect(projection.execution).toMatchObject({ status: 'crash', failureCategory: 'grader-empty-report', providerCalls: 1 });
    expect(projection.rawResponse).toBeNull(); expect(projection.grader).toBeNull();
    expect(projection.providerAttempts).toEqual(original.providerAttempts);
  });
  it('refuses to convert an actual passing or assertion-bearing oracle into missing evidence', () => {
    for (const report of [{ success: true, numTotalTests: 0, testResults: [] },
      { success: false, numTotalTests: 1, testResults: [{ assertionResults: [{ status: 'failed' }] }] }]) {
      const candidate = structuredClone(original); candidate.grader!.reports[0].report = report as never;
      expect(() => projectEmptyOracleReceipt(candidate)).toThrow('empty-unsuccessful-oracle-required');
    }
  });
  it('admits only a no-call workspace space failure for a separately retained first provider attempt', () => {
    const failed = { execution: { failureClass: 'infrastructure', providerCalls: 0,
      note: 'git archive extraction failed: No space left on device' }, providerAttempts: [], rawResponse: null, grader: null } as unknown as BenefitTrialReceipt;
    expect(isUndispatchedSpaceFailure(failed)).toBe(true);
    expect(isUndispatchedSpaceFailure({ ...failed, execution: { ...failed.execution, providerCalls: 1 } })).toBe(false);
    expect(isUndispatchedSpaceFailure({ ...failed, providerAttempts: original.providerAttempts })).toBe(false);
    expect(isUndispatchedSpaceFailure({ ...failed, execution: { ...failed.execution, note: 'timed out after a network call' } })).toBe(false);
    expect(isUndispatchedSpaceFailure(original)).toBe(false);
  });
});
