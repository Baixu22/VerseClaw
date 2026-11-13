// driven_by: agent; actor: codex-g7-inline-spill-tf0749-01a1d34c; realHumanEvidence: false
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

const [workspace, output, replayFile] = process.argv.slice(2);
assert(workspace && output && replayFile, 'usage: closeout-integrity <workspace> <output.json> <clean-replay-verification.json>');
const root = resolve(workspace), fixture = join(root, 'harness/specs/fixtures/context-inline-spill-benefit-round9');
const meta = { driven_by: 'agent', actor: 'codex-g7-inline-spill-tf0749-01a1d34c', realHumanEvidence: false };
const sha = b => createHash('sha256').update(b).digest('hex');
const json = p => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const git = args => execFileSync('git', args, { cwd: root, windowsHide: true });
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]).sort();
const safe = (dir, name) => { const p = resolve(dir, name); assert(p.startsWith(resolve(dir) + sep), name); return p; };
const manifest = (dir, complete = false) => {
  const bytes = readFileSync(join(dir, 'SHA256SUMS'));
  const rows = bytes.toString('utf8').trim().split(/\r?\n/).map(line => {
    const m = /^([a-f0-9]{64})  (.+)$/.exec(line); assert(m, line);
    assert.equal(sha(readFileSync(safe(dir, m[2]))), m[1], m[2]); return m[2];
  });
  assert.equal(new Set(rows).size, rows.length);
  if (complete) assert.deepEqual(rows.sort(), files(dir).filter(p => p !== join(dir, 'SHA256SUMS')).map(p => relative(dir, p).replaceAll('\\', '/')).sort());
  return { path: relative(root, dir).replaceAll('\\', '/'), files: rows.length, manifestSha256: sha(bytes) };
};

try {
  const pre = json(join(fixture, 'live/preflight.json'));
  const post = json(join(fixture, 'live/postflight.json'));
  const replay = json(replayFile);
  assert(replay.passed && replay.B7CleanCandidate && replay.verifierAcceptedCleanCandidate);
  assert.equal(replay.candidate.commit, pre.candidate.commit);
  assert.equal(replay.decision.verdict, 'GO');
  for (const gate of ['b1_mechanism_and_autonomy', 'b2_task_benefit', 'b3_retention_benefit', 'b4_non_inferiority', 'b5_no_fabrication', 'b6_budget', 'b7_evidence']) assert.equal(replay.decision[gate], true, gate);
  const sourceChecks = Object.entries(pre.sourceInputs).map(([path, identity]) => {
    const bytes = readFileSync(join(root, path));
    assert.equal(sha(bytes), identity.sha256, path); assert.equal(bytes.length, identity.bytes, path);
    assert.equal(sha(git(['show', pre.candidate.commit + ':' + path])), identity.sha256, path);
    assert.equal(git(['rev-parse', pre.candidate.commit + ':' + path]).toString('utf8').trim(), identity.gitBlob, path);
    assert.equal(git(['hash-object', '--no-filters', path]).toString('utf8').trim(), identity.worktreeBlob, path);
    return { path, sha256: identity.sha256, gitBlob: identity.gitBlob };
  });
  const copies = json(join(fixture, 'artifact-provenance.json')).artifacts;
  for (const copy of copies) {
    assert.equal(sha(readFileSync(copy.source)), copy.sha256, copy.source);
    assert.equal(sha(readFileSync(safe(fixture, copy.path))), copy.sha256, copy.path);
  }
  for (const item of post.recovery.originalRunFiles) {
    for (const dir of [post.recovery.originalDirectory, join(fixture, 'original-live'), join(fixture, 'live')]) assert.equal(sha(readFileSync(safe(dir, item.file))), item.sha256, item.file);
  }
  assert.equal(post.recovery.originalExitCode, null); assert.equal(post.recovery.originalExitCodeObserved, false);
  assert.equal(post.recovery.providerCallsAdded, 0); assert.equal(post.recovery.modelOutputsChanged, false);
  assert(!existsSync(join(fixture, 'original-live/postflight.json')));
  const archives = gunzipSync(readFileSync(join(fixture, 'live/archives.jsonl.gz'))).toString('utf8').trim().split('\n').map(JSON.parse);
  for (const item of archives) assert.equal(sha(readFileSync(safe(post.recovery.originalDirectory, item.file))), item.fileSha256, item.file);
  const rawRuns = readFileSync(join(fixture, 'live/runs.jsonl'), 'utf8').trim().split(/\r?\n/);
  const rawCalls = readFileSync(join(fixture, 'live/provider-calls.jsonl'), 'utf8').trim().split(/\r?\n/);
  assert.equal(rawRuns.length, 96); assert.equal(rawCalls.length, 324); assert.equal(archives.length, 609);
  const historical = ['context-inline-spill', 'context-inline-spill-benefit', 'context-inline-spill-benefit-round3', 'context-inline-spill-benefit-round4', 'context-inline-spill-benefit-round5', 'context-inline-spill-benefit-round6', 'context-inline-spill-benefit-round7', 'context-inline-spill-benefit-round8'].map(name => manifest(join(root, 'harness/specs/fixtures', name)));
  const inventory = json(join(fixture, 'commands.json'));
  const originalLive = inventory.commands.find(c => c.name === 'live');
  assert.equal(originalLive.status, 'interrupted-after-96-runs'); assert.equal(originalLive.exitCode, null); assert.equal(originalLive.exitCodeObserved, false);
  let commandLogs = 0;
  for (const command of inventory.commands.filter(c => c.status === 'finished')) for (const [stream, observation] of Object.entries(command.logs)) {
    const bytes = readFileSync(join(fixture, 'checks', command.name + '.' + stream + '.txt'));
    assert.equal(sha(bytes), observation.sha256); assert.equal(bytes.length, observation.bytes); commandLogs++;
  }
  const secrets = [process.env.CONTEXT_INLINE_SPILL_API_KEY, process.env.LOCAL3065_API_KEY].filter(Boolean);
  let hits = 0, scannedFiles = 0;
  for (const path of files(fixture)) {
    const bytes = readFileSync(path), text = (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
    hits += secrets.filter(s => text.includes(s)).length + (text.match(/\bsk-[A-Za-z0-9_-]{16,}\b/g)?.length ?? 0); scannedFiles++;
  }
  assert.equal(hits, 0, 'credential scan');
  const rootManifest = manifest(fixture, true);
  writeFileSync(output, JSON.stringify({ schema: 'G7Round9IntegrityReadback/v1', ...meta, checkedAt: new Date().toISOString(), passed: true, measuredCandidate: pre.candidate, actualHead: git(['rev-parse', 'HEAD']).toString('utf8').trim(), rootManifest, sources: sourceChecks, copiedSources: copies.length, originalRunFiles: post.recovery.originalRunFiles.length, archivesVerifiedAgainstOriginalDisk: archives.length, rawRuns: rawRuns.length, rawProviderCalls: rawCalls.length, historical, commandLogsVerified: commandLogs, credentialScan: { hits, files: scannedFiles, configuredCredentialVars: ['CONTEXT_INLINE_SPILL_API_KEY', 'LOCAL3065_API_KEY'], availableConfiguredCredentials: secrets.length }, originalLiveExitCode: null, providerCallsAddedByRecovery: 0, decision: replay.decision }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, sources: sourceChecks.length, historicalFiles: historical.reduce((n, h) => n + h.files, 0), archives: archives.length, credentialHits: hits, rootFiles: rootManifest.files }));
} catch (error) {
  writeFileSync(output, JSON.stringify({ schema: 'G7Round9IntegrityReadback/v1', ...meta, passed: false, error: String(error) }, null, 2) + '\n');
  console.error(String(error)); process.exitCode = 1;
}
