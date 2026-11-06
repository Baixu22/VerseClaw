import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const json = async name => JSON.parse(await readFile(join(root, name), 'utf8'));
const manifest = await json('SHA256SUMS.json');
for (const row of manifest.files) {
  const content = await readFile(join(root, row.file));
  assert.equal(content.length, row.bytes, row.file);
  assert.equal(createHash('sha256').update(content).digest('hex'), row.sha256, row.file);
}
async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(path, entry.name)) : [relative(root, join(path, entry.name)).replaceAll('\\', '/')]))).flat();
}
assert.deepEqual((await files(root)).filter(name => name !== 'SHA256SUMS.json').sort(), manifest.files.map(row => row.file).sort());
const backend = await json('backend.json'), renderer = await json('renderer-host.json');
assert.equal(backend.numFailedTests + renderer.numFailedTests, 0);
assert.equal(backend.numPassedTests + renderer.numPassedTests, 298);
const ui = await json('ui/playwright.json'), live = await json('live/playwright.json');
assert.equal(ui.stats.expected, 5); assert.deepEqual(ui.errors, []);
assert.equal(live.stats.expected, 1); assert.deepEqual(live.errors, []);
assert.equal((await json('live/binding.json')).exitCode, 0);
const receipt = await json('live/receipt.json');
assert.equal(receipt.status, 'pass');
assert.equal(receipt.provider.length, 2);
assert(receipt.provider.every(row => row.httpStatus === 200 && row.toolCount === 0));
assert.deepEqual(receipt.proxyCleanup, { listening: false, sockets: 0, requests: 0 });
const report = await json('quality/report.json'), corpus = await json('quality/corpus.json');
let complete = 0, citations = 0, abstained = 0, baseline = 0, treatment = 0;
for (const task of corpus.cases) {
  const row = await json('quality/' + task.id + '.json');
  const sources = new Map(row.admission.sources.map(source => {
    const page = task.pages.find(page => page.path === source.path);
    assert(page, task.id + ': source identity');
    const range = source.readRange;
    const content = page.content.split('\n').slice(range.fromLine - 1, range.toLine).join('\n');
    assert.equal('sha256:' + createHash('sha256').update(content).digest('hex'), source.citation.contentDigest, task.id + ': source digest');
    return [source.citation.refId, content];
  }));
  if (row.liveModel) {
    assert.equal(row.provider.status, 'completed'); assert.equal(row.provider.model, 'space-bunny');
    const output = JSON.parse(row.provider.text.slice(row.provider.text.indexOf('{'), row.provider.text.lastIndexOf('}') + 1));
    for (const claim of output.claims) for (const citation of claim.citations) {
      assert(sources.get(citation.sourceId)?.includes(citation.quote), task.id + ': exact quote');
    }
    citations++;
    const answer = output.claims.map(claim => claim.text).join('\n');
    assert.equal(row.taskComplete, task.abstain ? !output.claims.length && output.unknowns.length > 0
      : output.claims.length > 0 && task.expected.split('|').every(text => answer.includes(text)) && !(task.id === 'injection' && answer.includes('9999')));
  } else {
    assert(!sources.size || row.admission.conflicts.length > 0);
    assert.equal(task.abstain, true);
  }
  if (row.taskComplete) complete++;
  if (task.abstain && row.abstentionCorrect) abstained++;
  if (!task.abstain) {
    if (row.baseline.taskComplete) baseline++;
    if (row.taskComplete) treatment++;
  }
}
assert.equal(complete, report.taskComplete); assert.equal(citations, report.citationValid);
assert.equal(abstained, 7); assert.equal(baseline, 6); assert.equal(treatment, 7);
const sync = await json('native-sync/report.json');
const transitions = (await readFile(join(root, 'native-sync/transitions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
assert.equal(transitions.length, 25); assert.equal(new Set(transitions.map(row => row.captureKey)).size, 25);
assert.equal(sync.startupRecovered, 3);
assert.equal((await json('credential-scan.json')).hits.length, 0);
console.log(JSON.stringify({ status: 'pass', manifestFiles: manifest.files.length, unitTests: 298, uiScenarios: 5, liveScenarios: 1,
  qualityCases: complete, liveProviderCitationChecks: citations, abstention: abstained, pairedAnswerable: { baseline, treatment }, sourceTransitions: transitions.length }));
