import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const profile = readFileSync(new URL('../D4/benchmark.json', import.meta.url));
const fixture = JSON.parse(profile);
const verifier = fileURLToPath(new URL('./review-evidence.mjs', import.meta.url));
const sourceCandidate = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const consumer = 'agent-driven-fixture';

function scaleSamples() {
  return { driven_by: 'agent', actor: consumer, records: [2, 20, 100, 500].map(count => ({
    count, sourceCandidate, state: 'measured', samples: Array(20).fill(2), detailSamples: Array(20).fill(1),
    scans: Array(20).fill(2), detailScans: Array(20).fill(1), mainRss: Array(20).fill(4096),
    beforeSha256: digest, afterSha256: digest, taskBeforeSha256: digest, taskAfterSha256: digest,
    modelCallsBefore: 0, modelCallsAfter: 0,
  })) };
}

function pairedSamples(pairCount) {
  const arm = (index, variant) => {
    const sessionKey = 'agent:main:' + variant + '-' + index;
    const run = { runId: variant + '-' + index, scope: { sessionKey } };
    return { state: 'terminal', target: { workspaceId: 'fixture-workspace', sessionKey }, run,
      elapsedMs: 20, dispatchedAt: 100, taskQueueMs: 1, rss: [{ bytes: 4096 }, { bytes: 8192 }],
      notice: { owner: { event: { kind: 'run-terminal' } }, receivedAt: 125 },
      calls: [{ call: { category: 'task' }, state: 'known', usage: { priceVersion: 'fixture-v1', costUsd: 0, usage: { total: 1 } } }],
      terminal: { runId: run.runId, status: 'ok', text: fixture.input.result, startedAt: 101, endedAt: 120 },
      dispatchedTask: fixture.input.task,
      sourceSha256: createHash('sha256').update(fixture.input.contents).digest('hex'),
      requests: [{ model: fixture.provider.model, issued: 'text:' + fixture.input.result,
        userText: fixture.input.task, userTextSha256: createHash('sha256').update(fixture.input.task).digest('hex') }],
      materialUse: variant === 'collaboration' ? [{ phase: 'prompt-used', run, ref: { contentDigest: digest } }] : [] };
  };
  return { schemaVersion: 'SessionCollaborationBenefitSamples/v1', driven_by: 'agent', actor: consumer, sourceCandidate,
    fixture, fixtureSha256: createHash('sha256').update(profile).digest('hex'),
    inputSha256: createHash('sha256').update(fixture.input.contents).digest('hex'),
    workspace: { id: 'fixture-workspace' }, materialDigest: digest, firstFailure: null,
    pairs: Array.from({ length: pairCount }, (_, index) => ({
      id: 'pair-' + index, baseline: arm(index, 'baseline'), collaboration: arm(index, 'collaboration'),
    })),
  };
}

test('index review requires the measured sample counts and detail scan bounds', t => {
  const dir = mkdtempSync(join(tmpdir(), 'session-collaboration-index-evidence-'));
  const scalePath = join(dir, 'scale.json');
  const benefitPath = join(dir, 'benefit.json');
  t.after(() => {
    rmSync(scalePath, { force: true });
    rmSync(benefitPath, { force: true });
    rmdirSync(dir);
  });
  const review = (scale, pairCount = fixture.pairCount) => {
    writeFileSync(scalePath, JSON.stringify(scale));
    writeFileSync(benefitPath, JSON.stringify(pairedSamples(pairCount)));
    return JSON.parse(execFileSync(process.execPath, [verifier, scalePath, benefitPath], { encoding: 'utf8', timeout: 10_000 }));
  };
  const positive = review(scaleSamples());
  const partial = scaleSamples();
  for (const field of ['samples', 'detailSamples', 'scans', 'detailScans', 'mainRss']) partial.records[0][field].pop();
  delete partial.records[1].detailScans;
  const unbounded = scaleSamples();
  unbounded.records[0].scans[0] = 101;
  unbounded.records[1].detailScans[0] = 2;
  const results = [positive, review(partial), review(unbounded)];
  assert.deepEqual(results.map(report => [report.state, report.issues.map(issue => issue.reason)]), [
    ['ready-for-review', []],
    ['incomplete', ['incomplete-scale-samples', 'incomplete-scale-samples']],
    ['incomplete', ['scan-bounds-mismatch', 'scan-bounds-mismatch']],
  ]);
  assert.throws(() => review(scaleSamples(), 1), /Invalid collaboration pair evidence/);
  const tampered = pairedSamples(fixture.pairCount);
  tampered.fixture = { ...fixture, input: { ...fixture.input, result: 'changed-gold' } };
  writeFileSync(scalePath, JSON.stringify(scaleSamples()));
  writeFileSync(benefitPath, JSON.stringify(tampered));
  assert.throws(() => execFileSync(process.execPath, [verifier, scalePath, benefitPath], { encoding: 'utf8' }), /benchmark identity mismatch/);
  const incorrect = pairedSamples(fixture.pairCount);
  incorrect.pairs[0].collaboration.terminal.text = 'wrong-result';
  writeFileSync(benefitPath, JSON.stringify(incorrect));
  const rejected = JSON.parse(execFileSync(process.execPath, [verifier, scalePath, benefitPath], { encoding: 'utf8' }));
  assert.equal(rejected.state, 'incomplete');
  assert.ok(rejected.issues.some(issue => issue.reason === 'incorrect-paired-results'));
  for (const field of ['text', 'runId']) {
    const missingReply = pairedSamples(fixture.pairCount);
    if (field === 'text') delete missingReply.pairs[0].baseline.terminal.text;
    else missingReply.pairs[0].baseline.terminal.runId = 'other-run';
    writeFileSync(benefitPath, JSON.stringify(missingReply));
    const missing = JSON.parse(execFileSync(process.execPath, [verifier, scalePath, benefitPath], { encoding: 'utf8' }));
    assert.equal(missing.state, 'incomplete');
    assert.ok(missing.issues.some(issue => issue.reason === 'incorrect-paired-results'));
  }
  const partialMetrics = pairedSamples(fixture.pairCount);
  partialMetrics.pairs[0].collaboration.rss = [];
  writeFileSync(benefitPath, JSON.stringify(partialMetrics));
  const missingMetric = JSON.parse(execFileSync(process.execPath, [verifier, scalePath, benefitPath], { encoding: 'utf8' }));
  assert.ok(missingMetric.issues.some(issue => issue.reason === 'incomplete-metric-pairs' && issue.metric === 'electronMainPeakSampledRssBytes'));
  for (const field of ['id', 'run', 'session']) {
    const duplicate = pairedSamples(fixture.pairCount);
    if (field === 'id') duplicate.pairs[1].id = duplicate.pairs[0].id;
    if (field === 'run') duplicate.pairs[1].baseline.run.runId = duplicate.pairs[0].baseline.run.runId;
    if (field === 'session') duplicate.pairs[1].baseline.target.sessionKey = duplicate.pairs[0].baseline.target.sessionKey;
    writeFileSync(benefitPath, JSON.stringify(duplicate));
    assert.throws(() => execFileSync(process.execPath, [verifier, scalePath, benefitPath], { encoding: 'utf8' }), /pair identities required/);
  }
  for (const field of ['dispatchedTask', 'userText', 'userTextSha256', 'sourceSha256']) {
    const wrongInput = pairedSamples(fixture.pairCount);
    if (field === 'dispatchedTask') wrongInput.pairs[0].baseline.dispatchedTask = 'Other task';
    else if (field === 'sourceSha256') wrongInput.pairs[0].baseline.sourceSha256 = digest;
    else wrongInput.pairs[0].baseline.requests[0][field] = 'Changed provider input';
    writeFileSync(benefitPath, JSON.stringify(wrongInput));
    const result = JSON.parse(execFileSync(process.execPath, [verifier, scalePath, benefitPath], { encoding: 'utf8' }));
    assert.equal(result.state, 'incomplete');
    assert.ok(result.issues.some(issue => issue.reason === 'incomplete-comparable-pairs'));
  }
  for (const inputSha256 of [undefined, digest]) {
    writeFileSync(benefitPath, JSON.stringify({ ...pairedSamples(fixture.pairCount), inputSha256 }));
    assert.throws(() => execFileSync(process.execPath, [verifier, scalePath, benefitPath], { encoding: 'utf8' }), /benchmark identity mismatch/);
  }
});
