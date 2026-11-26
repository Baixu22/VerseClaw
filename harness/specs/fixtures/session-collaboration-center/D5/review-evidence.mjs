import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [scalePath, benefitPath, ...extra] = process.argv.slice(2);
if (!scalePath || !benefitPath || extra.length) throw new Error('Provide the A5 and D4 original evidence paths');
const rawScale = readFileSync(scalePath);
const scale = JSON.parse(rawScale);
if (scale.driven_by !== 'agent' || !Array.isArray(scale.records)) throw new Error('Invalid A5 scale evidence');
const summarizeBenefit = fileURLToPath(new URL('../D4/summarize.mjs', import.meta.url));
const benefit = JSON.parse(execFileSync(process.execPath, [summarizeBenefit, benefitPath], { encoding: 'utf8' }));
const issues = [];
if (scale.failure) issues.push({ source: 'A5', reason: 'first-failure', detail: scale.failure });
if (benefit.firstFailure) issues.push({ source: 'D4', reason: 'first-failure', detail: benefit.firstFailure });
const validNumbers = values => Array.isArray(values) && values.length > 0 &&
  values.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1] };
};
const scenarios = [];
for (const count of [2, 20, 100, 500]) {
  const found = scale.records.filter(record => record.count === count);
  if (found.length !== 1) { issues.push({ source: 'A5', count, reason: 'unique-scale-record-required' }); continue; }
  const [record] = found;
  if (record.sourceCandidate !== benefit.sourceCandidate) {
    issues.push({ source: 'A5', count, reason: 'candidate-mismatch', candidate: record.sourceCandidate });
    continue;
  }
  const series = [record.samples, record.detailSamples, record.scans, record.mainRss];
  if (record.state !== 'measured' || series.some(values => !validNumbers(values) || values.length !== record.samples?.length)) {
    issues.push({ source: 'A5', count, reason: 'incomplete-scale-samples' });
    continue;
  }
  const readOnly =
    /^[a-f0-9]{64}$/.test(record.beforeSha256 ?? '') && record.beforeSha256 === record.afterSha256 &&
    /^[a-f0-9]{64}$/.test(record.taskBeforeSha256 ?? '') && record.taskBeforeSha256 === record.taskAfterSha256 &&
    Number.isSafeInteger(record.modelCallsBefore) && record.modelCallsBefore === record.modelCallsAfter;
  if (!readOnly) issues.push({ source: 'A5', count, reason: 'read-only-owner-evidence-mismatch' });
  scenarios.push({ count, fixtureSource: record.source, listMs: stats(record.samples), detailMs: stats(record.detailSamples),
    scanned: stats(record.scans), peakSampledMainRssBytes: Math.max(...record.mainRss), readOnly });
}
if (benefit.quality.comparablePairs !== benefit.plannedPairs)
  issues.push({ source: 'D4', reason: 'incomplete-comparable-pairs', expected: benefit.plannedPairs, actual: benefit.quality.comparablePairs });
process.stdout.write(JSON.stringify({
  schemaVersion: 'SessionCollaborationIndexEvidenceReview/v1',
  driven_by: 'agent',
  actor: 'session-collaboration-index-evidence',
  state: issues.length ? 'incomplete' : 'ready-for-review',
  candidate: benefit.sourceCandidate,
  provenance: { scaleSha256: createHash('sha256').update(rawScale).digest('hex'), benefitSha256: benefit.rawSha256 },
  scenarios,
  benefit: { providerKind: benefit.providerKind, quality: benefit.quality, metrics: benefit.metrics },
  issues,
  originalDecision: 'docs/dev/session-lifecycle-control-plane/B1-DECISION.zh-CN.md#5',
}, null, 2) + '\n');
