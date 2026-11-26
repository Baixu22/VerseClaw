import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gradeAutonomyContinuation } from '../shared/long-session-paired-evaluation.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = 'harness/specs/fixtures/autonomy-context-system/baseline/v1/';
const json = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const textHash = path => sha(readFileSync(resolve(root, path), 'utf8').replaceAll('\r\n', '\n'));
const manifest = json(base + 'baseline-manifest.json');
const readback = json(base + 'offline-readback.json');
const policy = json(base + 'frozen-evaluation-policy.json');
const fixture = json(manifest.fixturePath);
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--run-report'), 'Usage: node scripts/verify-autonomy-context-baseline.mjs [--run-report <offline-run.json>]');
for (const entry of [...manifest.sourceFiles, ...manifest.artifacts]) {
  assert.equal(textHash(entry.path), entry.sha256, `Changed file: ${entry.path}`);
}
for (const entry of json(base + 'preregistration-portable.json').inputs) {
  assert.equal(textHash(entry.path), entry.sha256, `Preregistration changed: ${entry.path}`);
}
assert.equal(execFileSync('git', ['merge-base', '--is-ancestor', manifest.sourceCandidate, 'HEAD'], { cwd: root }).length, 0);
assert.equal(fixture.cases.length, 45);
assert.equal(new Set(fixture.cases.map(entry => entry.family)).size, 15);
assert.deepEqual(policy.arms.filter(arm => arm.status === 'planned').map(arm => arm.id), ['working-projection', 'conditioned']);
const report = args.length ? json(args[1]) : readback;
assert.equal(report.liveProviderCalls, 0);
assert.equal(report.heldoutExecuted, 0);
assert.equal(report.liveQuality, 'not-measured');
assert.equal(report.productTaskResult, 'not-measured');
assert.equal(report.fixtureSha256, textHash(manifest.fixturePath));
assert.equal(report.policySha256, textHash(base + 'frozen-evaluation-policy.json'));
assert.equal(report.rows.length, 60);
const expectedCases = fixture.cases.filter(entry => policy.offline.defaultSplits.includes(entry.split));
const expectedKeys = expectedCases.flatMap(entry => ['current', 'simple-masking'].map(arm => `${entry.id}:${arm}`)).sort();
assert.deepEqual(report.rows.map(row => `${row.id}:${row.arm}`).sort(), expectedKeys);
for (const row of report.rows) {
  const entry = expectedCases.find(entry => entry.id === row.id);
  assert.equal(row.actor, manifest.actor);
  assert.equal(row.driven_by, 'agent');
  assert.equal(row.measurementBasis, 'offline-scripted-continuation');
  assert.deepEqual(row.grade, gradeAutonomyContinuation(entry.oracle.assertions, row.observed), row.id);
  assert.equal(row.negativeControl.detected, true);
  assert.equal(row.productTaskGrade, null);
  assert.equal(row.costs.total.costUsd, null);
  assert.equal(row.costs.providerMeasured, false);
  assert(row.steps.length <= entry.remainingBudget.actions, `Action budget exceeded: ${row.id}`);
}
const digest = sha(JSON.stringify(report.rows.map(row => ({ id: row.id, arm: row.arm, observed: row.observed, grade: row.grade }))));
assert.equal(report.semanticDigest, digest);
assert.equal(digest, readback.semanticDigest, 'Continuation differs from frozen baseline');
const counts = Object.fromEntries(['current', 'simple-masking'].map(arm => [arm,
  Object.fromEntries(['pass', 'fail', 'unknown'].map(status => [status, report.rows.filter(row => row.arm === arm && row.grade.status === status).length]))]));
assert.deepEqual(counts, readback.gradeCounts);
console.log(JSON.stringify({ actor: manifest.actor, driven_by: 'agent', verifiedFiles: manifest.sourceFiles.length + manifest.artifacts.length,
  families: 15, executedRows: report.rows.length, semanticDigest: digest, gradeCounts: counts, liveProviderCalls: 0 }, null, 2));
