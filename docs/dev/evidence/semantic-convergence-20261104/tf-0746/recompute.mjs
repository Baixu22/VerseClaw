import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const directory = dirname(fileURLToPath(import.meta.url));
const read = file => JSON.parse(readFileSync(join(directory, file), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = read('report.json');
const matrix = read('matrix.json');
const commands = read('commands.json');
let tests = 0;
for (const [id, expected] of Object.entries(report.suites)) {
  const suite = read(id + '-tests.json');
  assert.equal(suite.success, true, id);
  assert.equal(suite.numFailedTests, 0, id);
  assert.equal(suite.numPendingTests, 0, id);
  assert.equal(suite.numPassedTests, expected.passed, id);
  tests += suite.numPassedTests;
}
assert.equal(tests, report.totalPassed);
assert.equal(matrix.rows.length, report.matrixRows);
assert(matrix.rows.every(row => row.verdict === 'pass' && row.command && row.oracle && row.negative && row.artifacts.length));
assert.equal(new Set(matrix.rows.filter(row => row.finding !== 'OPS').map(row => row.finding)).size, report.findings);
const negative = read('negative-cases.json').cases;
assert.equal(negative.length, report.declaredNegativeCases);
assert(negative.every(row => row.status === 'passed'));
const electron = read('electron-verdicts.json').tests;
assert.equal(electron.length, report.electron.uniqueCases);
assert(electron.every(row => row.status === 'passed' && row.errors.length === 0));
for (const gate of commands.gates) {
  assert.equal(gate.candidate.commit, report.candidate.commit, gate.id);
  assert.equal(gate.candidate.dirty, false, gate.id);
  assert.equal(gate.sourceStable, true, gate.id);
  assert.equal(gate.exitCode, 0, gate.id);
}
assert.equal(read('full-typecheck.json').success, true);
assert.equal(read('credential-scan.json').hitCount, 0);
const process = read('process-observations.json');
assert.equal(process.firstAlive, false);
assert.equal(process.childAlive, false);
assert.equal(process.secondAlive, true);
assert.equal(read('review-adjudication.json').acceptedFindings, 0);
for (const file of ['full-run-cleanup.json', 'settings-cleanup.json']) {
  assert.deepEqual(read(file).survivors, []);
  assert.deepEqual(read(file).sweep.remaining, []);
}
const sources = read('source-manifest.json').sourceHashes;
for (const [file, expected] of Object.entries(sources)) {
  const bytes = execFileSync('git', ['show', report.candidate.commit + ':' + file], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(hash(bytes), expected, file);
}
const lines = readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n');
assert.equal(lines.length, readdirSync(directory).length - 1);
for (const line of lines) {
  const [, expected, file] = /^([a-f0-9]{64})  (.+)$/.exec(line);
  assert.equal(hash(readFileSync(join(directory, file))), expected, file);
}
console.log(JSON.stringify({ tests, electron: electron.length, matrixRows: matrix.rows.length,
  findings: report.findings, declaredNegatives: negative.length, sourceBlobs: Object.keys(sources).length,
  hashEntries: lines.length, passed: true }, null, 2));
