import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const raw = readFileSync(process.argv[2]);
const run = JSON.parse(raw);
if (run.schemaVersion !== 'SessionCollaborationBenefitSamples/v1' || run.driven_by !== 'agent' ||
    !run.sourceCandidate || !run.fixtureSha256 || !run.fixture?.provider?.kind ||
    !Array.isArray(run.pairs) || run.pairs.length !== run.fixture.pairCount) {
  throw new Error('Invalid collaboration pair evidence');
}
const hash = value => createHash('sha256').update(value).digest('hex');
const originalFixture = readFileSync(new URL('./benchmark.json', import.meta.url));
if (run.fixtureSha256 !== hash(originalFixture) || !isDeepStrictEqual(run.fixture, JSON.parse(originalFixture)) ||
    run.inputSha256 !== hash(run.fixture.input.contents))
  throw new Error('Collaboration benchmark identity mismatch');
const pairs = run.pairs.map(pair => Number.isSafeInteger(pair.id) && pair.id >= 1 ? String(pair.id) : pair.id);
const arms = run.pairs.flatMap(pair => [pair.baseline, pair.collaboration]);
const unique = values => values.every(value => typeof value === 'string' && value.length > 0) && new Set(values).size === values.length;
if (!unique(pairs) || !unique(arms.filter(arm => arm.run).map(arm => arm.run.runId)) ||
    !unique(arms.filter(arm => arm.target).map(arm => arm.target.sessionKey)))
  throw new Error('Independent collaboration pair identities required');
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const elapsed = (from, to) => numeric(from) && numeric(to) && to >= from ? to - from : null;
const percentile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : null;
const stats = values => ({ count: values.length, p50: percentile(values, .5), p95: percentile(values, .95) });
const samePlan = pair => [pair.baseline, pair.collaboration].every(arm =>
  arm.state === 'terminal' && arm.run?.runId && arm.target?.workspaceId === run.workspace?.id &&
    arm.run.scope?.sessionKey === arm.target.sessionKey &&
    arm.dispatchedTask === run.fixture.input.task && arm.sourceSha256 === run.inputSha256 && arm.requests.length > 0 && arm.requests.every(request =>
      request.model === run.fixture.provider.model && typeof request.userText === 'string' &&
      request.userTextSha256 === hash(request.userText) && request.userText.includes(run.fixture.input.task))) &&
  pair.baseline.target.sessionKey !== pair.collaboration.target.sessionKey;
const correct = arm => arm.terminal?.status === 'ok' && arm.requests.at(-1)?.issued === `text:${run.fixture.input.result}` &&
  arm.terminal.runId === arm.run?.runId && typeof arm.terminal.text === 'string' &&
  arm.terminal.text.trim() === run.fixture.input.result;
const consumed = arm => arm.materialUse?.some(observation => observation.phase === 'prompt-used' &&
  observation.run?.runId === arm.run?.runId && observation.ref?.contentDigest === run.materialDigest) === true;
const priced = arm => {
  if (!arm.calls?.length || !arm.calls.every(record => record.state === 'known' && record.usage?.priceVersion && numeric(record.usage.costUsd))) return null;
  return JSON.stringify([...new Set(arm.calls.map(record => record.usage.priceVersion))].sort());
};
const coordination = (arm, select) => {
  if (!arm.calls?.length) return null;
  const values = arm.calls.filter(record => record.call.category === 'coordination').map(select);
  return values.every(numeric) ? values.reduce((a, b) => a + b, 0) : null;
};
const explicitReads = arm => arm.requests.filter(request => request.issued === 'd4-direct-read').length;
const metricReaders = {
  repeatedReads: explicitReads,
  modelRequests: arm => arm.requests.length,
  runElapsedMs: arm => arm.elapsedMs,
  dispatchToStartMs: arm => elapsed(arm.dispatchedAt, arm.terminal?.startedAt),
  terminalNotificationMs: arm => arm.notice?.owner?.event?.kind === 'run-terminal'
    ? elapsed(arm.terminal?.endedAt, arm.notice.receivedAt) : null,
  taskReadyToClaimedMs: arm => arm.taskQueueMs,
  electronMainPeakSampledRssBytes: arm => {
    const samples = arm.rss.map(sample => sample.bytes).filter(numeric);
    return samples.length >= 2 ? Math.max(...samples) : null;
  },
  coordinationTokens: arm => coordination(arm, record => record.state === 'known' ? record.usage?.usage?.total : null),
  coordinationUsd: arm => coordination(arm, record => record.state === 'known' ? record.usage?.costUsd : null),
};
const comparable = run.pairs.filter(samePlan);
const quality = {
  comparablePairs: comparable.length,
  correctBaseline: comparable.filter(pair => correct(pair.baseline)).length,
  correctCollaboration: comparable.filter(pair => correct(pair.collaboration) && consumed(pair.collaboration)).length,
};
const metrics = {};
for (const [name, read] of Object.entries(metricReaders)) {
  const baseline = [], collaboration = [], deltas = [], excludedPairs = [];
  for (const pair of run.pairs) {
    if (!samePlan(pair) || !correct(pair.baseline) || !correct(pair.collaboration) || !consumed(pair.collaboration) ||
        (name === 'coordinationUsd' && (!priced(pair.baseline) || priced(pair.baseline) !== priced(pair.collaboration)))) {
      excludedPairs.push(pair.id);
      continue;
    }
    const a = read(pair.baseline), b = read(pair.collaboration);
    if (!numeric(a) || !numeric(b)) { excludedPairs.push(pair.id); continue; }
    baseline.push(a);
    collaboration.push(b);
    deltas.push(b - a);
  }
  const delta = stats(deltas);
  metrics[name] = { baseline: stats(baseline), collaboration: stats(collaboration), delta, excludedPairs,
    assessment: excludedPairs.length ? 'incomplete' : delta.p50 < 0 && delta.p95 <= 0 ? 'improved'
      : delta.p95 > 0 ? 'degraded' : 'unchanged' };
}
process.stdout.write(JSON.stringify({
  schemaVersion: 'SessionCollaborationBenefitSummary/v1', driven_by: run.driven_by, actor: run.actor,
  providerKind: run.fixture.provider.kind, sourceCandidate: run.sourceCandidate,
  fixtureSha256: run.fixtureSha256, rawSha256: hash(raw), firstFailure: run.firstFailure,
  plannedPairs: run.pairs.length, quality, metrics,
}, null, 2) + '\n');
