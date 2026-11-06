// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { assessTaskAdmission, checkLiveAcceptance, finalizeLiveAdmission, inspectLiveCorpus } from '../../scripts/rsi-live-acceptance.mjs';

describe('real RSI task admission', () => {
  it('retains 216 not-run slots and rejects a rehashed fake admission pass', () => {
    const directory = mkdtempSync('D:/tmp/rsi-live-admission-test-');
    if (!resolve(directory).startsWith(`${resolve('D:/tmp')}${sep}rsi-live-admission-test-`)) throw Error('unsafe cleanup');
    const reportPath = join(directory, 'admission-report.json');
    const seal = () => writeFileSync(join(directory, 'SHA256SUMS'), `${createHash('sha256').update(readFileSync(reportPath)).digest('hex')}  admission-report.json\n`);
    try {
      const report = finalizeLiveAdmission(process.cwd(), directory);
      expect(report.status).toBe('NO_GO');
      expect(report.provider.status).toBe('not-evaluated');
      expect(report.trialSlots).toHaveLength(216);
      seal();
      expect(checkLiveAcceptance(process.cwd(), directory)).toMatchObject({ passed: true, acceptanceStatus: 'NO_GO', measuredTaskTrials: 0 });
      writeFileSync(reportPath, JSON.stringify({ ...report, status: 'ready-for-measurement' }));
      seal();
      expect(checkLiveAcceptance(process.cwd(), directory).passed).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
    expect(assessTaskAdmission({ reference: { ...failed, failureClass: 'assertion' }, baseline: failed }).issues).toContain('reference-oracle-not-passing');
    expect(assessTaskAdmission({ reference: { passed: false }, baseline: failed }).issues).toContain('reference-infrastructure-failure');
    expect(assessTaskAdmission({ reference: { ...reference, passed: false, failureClass: 'infrastructure', executions: [] }, baseline: failed }).issues).toContain('reference-infrastructure-failure');
    expect(assessTaskAdmission({ reference: { ...reference, passed: false, failureClass: 'oracle-input-drift', executions: [] }, baseline: failed }).issues).toContain('reference-oracle-input-drift');
    expect(assessTaskAdmission({ reference: { passed: true }, baseline: { passed: true } }).issues).toContain('baseline-already-passes');
    expect(assessTaskAdmission({ reference: { passed: true }, baseline: { passed: false, executions: [{ exitCode: null, timedOut: true }] } }).passed).toBe(false);
    expect(assessTaskAdmission({ reference: { passed: true }, baseline: { passed: false, failureClass: 'infrastructure', executions: [] } }).issues).toContain('baseline-infrastructure-failure');
    expect(assessTaskAdmission({ reference: { passed: true }, baseline: { passed: false, failureClass: 'oracle-input-drift', executions: [] } }).issues).toContain('baseline-oracle-input-drift');
    expect(assessTaskAdmission({ reference: { passed: false, timedOut: true, executions: [] }, baseline: failed }).issues).toContain('reference-infrastructure-failure');
    expect(assessTaskAdmission({ reference: { passed: false, failureClass: 'target-module-absent', executions: [] }, baseline: failed }).issues).toContain('reference-oracle-not-passing');
    expect(assessTaskAdmission({ reference: { passed: true }, baseline: { passed: false, executions: [] } }).passed).toBe(false);
    const missingTarget = { ...failed, diagnostics: [{ kind: 'missing-module', missingPath: 'src/target.js', importer: 'tests/target.test.ts', inTargetScope: true }],
      executions: [{ ...failed.executions[0], exitCode: 1, report: { success: false, numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, numPendingTests: 0, testResults: [{ assertionResults: [], message: "Cannot find module './target.js'" }] } }] };
    expect(assessTaskAdmission({ reference, baseline: missingTarget })).toEqual({ passed: true, issues: [], warnings: ['baseline-target-module-absent'] });
    expect(assessTaskAdmission({ reference, baseline: { ...missingTarget, diagnostics: [{ ...missingTarget.diagnostics[0], inTargetScope: false }] } }).passed).toBe(false);
    expect(assessTaskAdmission({ reference, baseline: { ...missingTarget, diagnostics: [{ ...missingTarget.diagnostics[0], inTargetScope: false }] } }).issues).toContain('baseline-infrastructure-failure');
  });
});
