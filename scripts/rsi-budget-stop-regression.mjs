#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runCodingCollector } from './rsi-coding-collector.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({ options: { 'frozen-root': { type: 'string' }, campaign: { type: 'string' },
  'scratch-source': { type: 'string' }, 'support-root': { type: 'string' }, out: { type: 'string' } } });
assert(Object.values(values).length === 5 && values.out, 'frozen-root, campaign, scratch-source, support-root and new out required');
const out = resolve(values.out); assert(!existsSync(out), 'regression-output-already-exists');
const original = join(resolve(values.campaign), 'measurement');
assert(existsSync(join(original, 'plan.json')), 'retained-campaign-required');
const plan = read(join(original, 'plan.json'));
assert.equal(plan.runId, 'e8866141-a1f3-43c4-8efa-dfc9822cd24d', 'regression-campaign-drift');
const last = plan.slots.filter(slot => existsSync(join(original, 'trials', slot.id + '.json'))).at(-1);
assert.equal(last.position, 197, 'regression-retained-prefix');
const originalReportDigest = hash(readFileSync(join(original, 'report.json')));
mkdirSync(dirname(out), { recursive: true });
const fixture = mkdtempSync('D:/tmp/rsi-budget-stop-regression-');
const directory = join(fixture, 'measurement'), scratch = join(fixture, 'receipts');
function copy(source, target) {
  assert(lstatSync(source).isDirectory() || lstatSync(source).isFile(), 'regression-link-input');
  if (lstatSync(source).isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source)) copy(join(source, name), join(target, name));
  } else copyFileSync(source, target);
}
copy(original, directory);
for (const path of [join(directory, 'trials', last.id + '.json'), join(directory, 'started', last.id + '.json')]) {
  assert(resolve(path).startsWith(resolve(fixture) + sep), 'regression-fixture-escape'); unlinkSync(path);
}
mkdirSync(join(scratch, last.id), { recursive: true });
copyFileSync(join(resolve(values['scratch-source']), last.id, 'receipt.json'), join(scratch, last.id, 'receipt.json'));
let attemptedDispatches = 0, checkpoint = null, stop = null;
const campaignLedger = { campaignDigest: hash(JSON.stringify(plan.budget.campaign)), reserve: async () => {
  attemptedDispatches++; throw new Error('regression-provider-dispatch-forbidden');
} };
const originalLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('{')) {
    const event = JSON.parse(args[0]);
    if (event.slot === last.id) {
      const bytes = readFileSync(join(directory, 'report.json'));
      checkpoint = JSON.parse(bytes.toString('utf8'));
      writeFileSync(join(dirname(out), 'report-before-stop.json'), bytes, { flag: 'wx' });
    }
  }
  originalLog(...args);
};
const startedAt = new Date().toISOString();
try {
  await runCodingCollector({ root: resolve(values['frozen-root']), directory, scratch,
    supportRoot: resolve(values['support-root']), apiKey: 'regression-dispatch-disabled', campaignLedger });
} catch (error) { stop = error; }
finally { console.log = originalLog; }
assert.equal(attemptedDispatches, 0, 'regression-attempted-provider-call');
assert.equal(stop?.message.split(/\r?\n/u, 1)[0].trim(), 'token-budget-exhausted', 'regression-original-stop-changed');
assert.equal(stop.cause, undefined, 'regression-report-sealing-failed');
assert.equal(checkpoint?.coverage.recorded, 197, 'regression-initial-report-state');
const final = read(join(directory, 'report.json'));
assert.equal(final.coverage.recorded, 198, 'regression-stale-final-report');
assert.equal(final.coverage.missing.length, 18, 'regression-missing-slots');
assert.equal(final.coverage.incomplete.length, 1, 'regression-incomplete-slot');
assert.equal(final.status, 'eliminate', 'regression-original-verdict');
assert.equal(hash(readFileSync(join(original, 'report.json'))), originalReportDigest, 'regression-original-artifact-changed');
const result = { schemaVersion: 'RsiBudgetStopRegression/v1', driven_by: 'agent', actor: 'codex/rsi-budget-stop-regression',
  evidenceKind: 'retained-receipt-orchestration-regression', startedAt, endedAt: new Date().toISOString(),
  collectorSource: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..'), encoding: 'utf8', windowsHide: true }).trim(),
  frozenMeasurementSource: plan.source.commit, originalCampaign: values.campaign, fixtureDirectory: fixture,
  checkpointRecordedSlots: checkpoint.coverage.recorded, finalRecordedSlots: final.coverage.recorded,
  missingSlots: final.coverage.missing.length, incompleteSlots: final.coverage.incomplete.length,
  originalStop: stop.message, originalReportPreserved: true, providerCalls: attemptedDispatches,
  replayedReceipt: last.id, finalReportDigest: hash(readFileSync(join(directory, 'report.json'))), passed: true };
writeFileSync(out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
