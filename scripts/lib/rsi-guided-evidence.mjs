import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NATIVE_CHECKER_VERSION, verifyNativeCheckerEvidence } from './rsi-native-checker.mjs';
import { ISOLATED_PYTHON_VERSION, verifyIsolatedPythonEvidence } from './rsi-isolated-python.mjs';
const read = path => JSON.parse(readFileSync(path, 'utf8'));

export function verifyGuidedOracleArtifact(task, oracle, directory) {
  assert.equal(oracle.oracleUnchanged, true, 'pilot-oracle-drift');
  assert.equal(oracle.oracleRevision, task.source.reference, 'pilot-oracle-revision-drift');
  assert.deepEqual(oracle.oracleTestDigests, task.oracleTestDigests, 'pilot-oracle-digest-drift');
  assert.deepEqual(oracle.commands, task.oracle.commands, 'pilot-oracle-command-drift');
  assert.equal(oracle.oracleHashBefore, oracle.oracleHashAfter, 'pilot-oracle-effects-drift');
  assert.equal(oracle.executions.length, task.oracle.commands.length, 'pilot-oracle-execution-count');
  const outcomes = oracle.executions.map((execution, index) => {
    assert.equal(execution.command, task.oracle.commands[index]);
    if (execution.command === 'internal:stdio-oracle') {
      assert(execution.report, 'pilot-stdio-infrastructure: ' + (execution.error
        || `missing or invalid report (exit ${execution.exitCode}, signal ${execution.signal ?? 'none'})`));
      const raw = read(join(directory, String(index + 1).padStart(2, '0') + '-stdout.log'));
      assert.deepEqual(raw, execution.report, 'pilot-stdio-report-drift');
      assert.notEqual(raw.executionEnvironment, 'wsl-unavailable', 'pilot-stdio-infrastructure: ' + (raw.compileError || 'native worker unavailable'));
      if (task.oracle.comparisonProtocol === NATIVE_CHECKER_VERSION) {
        assert.equal(raw.schemaVersion, 'RsiStdioOracleReport/v2', 'pilot-native-checker-protocol');
        assert.equal(raw.nativeCheckerDigest, task.oracle.nativeCheckerDigest, 'pilot-native-checker-digest');
        assert.notEqual(raw.failureClass, 'infrastructure', 'pilot-native-checker-infrastructure');
        if (!raw.sourceMissing) {
          assert.equal(raw.workerReportVersion, 'RsiNativeCheckerWorker/v2', 'pilot-native-checker-worker-version');
          const workspace = oracle.workspace;
          const privateOracle = read(join(workspace, 'oracles', task.id + '.json'));
          verifyNativeCheckerEvidence(raw, { id: task.id, vectors: privateOracle.tests, nativeChecker: privateOracle.nativeChecker }, workspace);
        }
      }
      if (task.oracle.comparisonProtocol === ISOLATED_PYTHON_VERSION) {
        assert.equal(raw.schemaVersion, 'RsiStdioOracleReport/v3', 'pilot-isolated-python-protocol');
        assert.equal(raw.privatePythonDigest, task.oracle.privatePythonDigest, 'pilot-isolated-python-digest');
        assert.notEqual(raw.failureClass, 'infrastructure', 'pilot-isolated-python-infrastructure');
        const privateOracle = read(join(oracle.workspace, 'oracles', task.id + '.json'));
        verifyIsolatedPythonEvidence(raw, { id: task.id, vectors: privateOracle.tests, privatePython: privateOracle.privatePython }, oracle.workspace);
      }
      assert.equal(raw.results.length, ['RsiStdioOracleReport/v2', 'RsiStdioOracleReport/v3'].includes(raw.schemaVersion) && raw.compileError !== null
        ? 0 : raw.counts.total, 'pilot-stdio-test-count-drift');
      return execution.exitCode === 0 && execution.timedOut === false && execution.error === null
        && raw.passed === true && raw.results.length > 0 && raw.results.every(item => item.passed === true)
        && raw.counts.failed === 0 && raw.counts.timedOut === 0;
    }
    const raw = read(join(directory, String(index + 1).padStart(2, '0') + '-vitest-report.json'));
    assert.deepEqual(raw, execution.report, 'pilot-test-report-drift');
    const assertions = raw.testResults.flatMap(suite => suite.assertionResults ?? []);
    assert.equal(assertions.length, raw.numTotalTests, 'pilot-test-count-drift');
    assert.equal(assertions.filter(item => item.status === 'passed').length, raw.numPassedTests, 'pilot-passed-test-count-drift');
    return execution.exitCode === 0 && execution.timedOut === false && execution.error === null && raw.success === true
      && assertions.length > 0 && assertions.every(item => item.status === 'passed') && raw.numFailedTests === 0
      && raw.numPendingTests === 0 && (raw.numSkippedTests ?? 0) === 0 && (raw.numTodoTests ?? 0) === 0;
  });
  assert.equal(oracle.passed, outcomes.every(Boolean), 'pilot-oracle-verdict-drift');
}
