import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runStdioCase } from './rsi-stdio-tasks.mjs';
import { runStdioCaseWsl } from './rsi-stdio-tasks.mjs';
import { benefitDigest } from './rsi-benefit-eval.mjs';

const { values } = parseArgs({ options: { 'case-id': { type: 'string' }, workspace: { type: 'string' } } });
assert(values['case-id'] && values.workspace, 'stdio-case-and-workspace-required');
const workspace = resolve(values.workspace), id = values['case-id'];
const oracle = JSON.parse(readFileSync(join(workspace, 'oracles', id + '.json'), 'utf8'));
const identity = JSON.parse(readFileSync(join(workspace, 'public', id + '.json'), 'utf8'));
assert.equal(identity.id, id, 'stdio-case-identity');
const runtime = identity.runtime, cpp = runtime === 'cpp';
const source = join(workspace, 'src', id + (cpp ? '.cpp' : '.py'));
const report = existsSync(source) ? (cpp ? runStdioCaseWsl({ id, runtime, cppToolchain: identity.cppToolchain,
  compilerVersion: identity.compilerVersion, vectors: oracle.tests, ...(oracle.nativeChecker ? { nativeChecker: oracle.nativeChecker } : {}) }, source)
  : runStdioCase({ id, runtime, vectors: oracle.tests, ...(oracle.privatePython ? { privatePython: oracle.privatePython } : {}) }, source)) : {
  schemaVersion: oracle.nativeChecker ? 'RsiStdioOracleReport/v2' : oracle.privatePython ? 'RsiStdioOracleReport/v3' : 'RsiStdioOracleReport/v1', caseId: id, runtime, compileError: null, sourceMissing: true,
  ...(oracle.nativeChecker ? { outputComparison: oracle.nativeChecker.schemaVersion, failureClass: 'target-module-absent',
    nativeCheckerDigest: benefitDigest(oracle.nativeChecker) } : {}),
  ...(oracle.privatePython ? { outputComparison: oracle.privatePython.schemaVersion, failureClass: 'target-module-absent',
    privatePythonDigest: benefitDigest(oracle.privatePython), pythonVersion: oracle.privatePython.pythonVersion } : {}),
  ...(oracle.tests.some(test => test.comparison === 'json') ? { outputComparison: 'per-vector-json-structural-or-text-normalization' } : {}),
  normalization: 'CRLF->LF, trim trailing whitespace per line, trim final whitespace',
  results: oracle.tests.map((test, index) => ({ index, testId: test.testId ?? null, ...(test.comparison ? { comparison: test.comparison } : {}), passed: false, timedOut: false,
    exitCode: null, error: 'source-missing', stdoutDigest: null, stderrDigest: null })),
  counts: { total: oracle.tests.length, passed: 0, failed: oracle.tests.length, timedOut: 0 }, passed: false };
writeFileSync(join(workspace, 'stdio-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
process.exitCode = report.passed ? 0 : 1;
