import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../..');
const sha = data => createHash('sha256').update(data).digest('hex');
const json = name => JSON.parse(readFileSync(join(directory, name), 'utf8'));
for (const line of readFileSync(join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  assert.ok(match, 'Invalid checksum entry');
  assert.equal(sha(readFileSync(join(directory, match[2]))), match[1], match[2]);
}
const source = json('source-manifest.json');
const report = json('report.json');
const commands = json('commands.json');
assert.equal(source.candidate, report.sourceCandidate);
assert.equal(commands.candidate, source.candidate);
assert.equal(report.driven_by, 'agent');
assert.equal(report.acceptance, 'passed');
assert.equal(commands.records.length, 9);
assert.ok(commands.records.every(record => record.status === 'finished' && record.exitCode === 0));
for (const file of source.files) {
  const committed = execFileSync('git', ['show', `${source.candidate}:${file.path}`], {
    cwd: root, windowsHide: true, maxBuffer: 30_000_000,
  });
  assert.equal(sha(committed), file.sha256, file.path);
  if (process.argv.includes('--working-tree')) {
    assert.equal(sha(readFileSync(join(root, file.path))), file.sha256, `${file.path} working tree`);
  }
}
for (const record of json('source-equivalence.json')) {
  const changed = execFileSync('git', ['diff', '--name-only', record.from, record.to, '--', ...record.paths], {
    cwd: root, windowsHide: true, encoding: 'utf8',
  }).trim();
  assert.equal(changed, '');
  assert.deepEqual(record.changed, []);
}
const unit = json('unit.json');
assert.equal(unit.numTotalTests, 79);
assert.equal(unit.numPassedTests, 79);
assert.equal(unit.numFailedTests, 0);
const electron = json('electron.json');
assert.equal(electron.stats.expected, 2);
assert.equal(electron.stats.unexpected, 0);
assert.equal(electron.stats.flaky, 0);
assert.equal(json('runtime-build.json').exitCode, 0);
assert.ok(json('lint.json').every(file => file.errorCount === 0));
const ui = json('task-ui-readback.json');
assert.equal(ui.hiddenPersists, true);
assert.equal(ui.hidePreservesClaim, true);
assert.equal(ui.keyboardToggle, true);
assert.deepEqual(ui.languages, ['en', 'zh', 'ja', 'ru']);
for (const file of json('visual-review.json').images) {
  assert.equal(readFileSync(join(directory, file)).subarray(1, 4).toString(), 'PNG');
}
console.log(JSON.stringify({ passed: true, candidate: source.candidate, unit: 79, electron: 2, screenshots: 8 }));
