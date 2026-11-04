// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assessTaskAdmission, inspectLiveCorpus } from '../../scripts/rsi-live-acceptance.mjs';

describe('real RSI task admission', () => {
  it('recovers original base/reference identities without guessing HEAD parents', () => {
    const tasks = inspectLiveCorpus(process.cwd());
    expect(tasks).toHaveLength(24);
    expect(tasks[0]).toMatchObject({ id: 'tf-0274-e01', base: '874befaaa018bdb1160f8f064b17f053fcfe8512', reference: '42aaf5522499fbb940aa2dd1007967eb55adb0f3' });
    expect(tasks.filter((task) => ['tf-0283-l01', 'tf-0285-l03', 'tf-0278-s03'].includes(task.id)).every((task) => task.productChanges.length === 0)).toBe(true);
  });

  it('requires both a passing reference and a gradeable failed baseline', () => {
    const reference = { passed: true, commands: ['frozen-command'], oracleUnchanged: true, executions: [{ command: 'frozen-command', kind: 'vitest', exitCode: 0, error: null,
      report: { success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0,
        testResults: [{ assertionResults: [{ status: 'passed' }] }] }, timedOut: false }] };
    const failed = { ...reference, passed: false, executions: [{ ...reference.executions[0], exitCode: 1, report: {
      success: false, numTotalTests: 1, numPassedTests: 0, numFailedTests: 1, numPendingTests: 0,
      testResults: [{ assertionResults: [{ status: 'failed' }] }] } }] };
    expect(assessTaskAdmission({ reference, baseline: failed }).passed).toBe(true);
    expect(assessTaskAdmission({ reference: { passed: true }, baseline: failed }).passed).toBe(false);
    expect(assessTaskAdmission({ reference: failed, baseline: failed }).issues).toContain('reference-oracle-not-passing');
    expect(assessTaskAdmission({ reference: { passed: true }, baseline: { passed: true } }).issues).toContain('baseline-already-passes');
    expect(assessTaskAdmission({ reference: { passed: true }, baseline: { passed: false, executions: [{ exitCode: null, timedOut: true }] } }).passed).toBe(false);
    expect(assessTaskAdmission({ reference: { passed: true }, baseline: { passed: false, executions: [] } }).passed).toBe(false);
  });
});
