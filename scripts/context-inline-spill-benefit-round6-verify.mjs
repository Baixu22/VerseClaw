import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error('usage: node context-inline-spill-benefit-round6-verify.mjs <run-directory> <output.json> [--seal]');
const root = process.cwd();
const dir = resolve(directory);
const out = resolve(output);
const actor = 'codex-g7-inline-spill-tf0749-01a1d34c';
const metadata = { driven_by: 'agent', actor, realHumanEvidence: false };
const hash = value => createHash('sha256').update(value).digest('hex');
const parse = value => JSON.parse(String(value).replace(/^\uFEFF/, ''));
const json = path => parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const oracle = { 'deploy-token': 'DEPLOY_TOKEN_7f31ab', 'db-passport': 'DB_PASSPORT_9c02de',
  'cache-seed': 'CACHE_SEED_44aa10', 'signing-key': 'SIGNING_KEY_b71c55',
  'tenant-id': 'TENANT_ID_3d9e77', 'migration-hash': 'MIGRATION_HASH_a1f4c8' };
const lines = path => readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(parse);
function safePath(base, name) {
  const path = resolve(base, name);
  assert(path.startsWith(resolve(base) + sep), 'artifact path leaves its directory');
  return path;
}
function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? filesBelow(join(path, entry.name)) : [join(path, entry.name)]).sort();
}
function finalAnswer(text) {
  try {
    const value = parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).value;
    if (value === null || typeof value === 'string') return { ok: true, value };
  } catch {}
  return { ok: false, value: null };
}
function originalBytes(entry) { return Buffer.from(entry.base64, 'base64'); }
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stableValue(value[key])]));
}

mkdirSync(dirname(out), { recursive: true });
try {
  const result = json(join(dir, 'result.json'));
  const records = json(join(dir, 'runs.json')).records;
  const preflight = json(join(dir, 'preflight.json'));
  const postflight = json(join(dir, 'postflight.json'));
  const candidate = preflight.candidate;
  assert.equal(candidate.dirty, false, 'dirty candidate rejected');
  assert.equal(candidate.status, '');
  assert.deepEqual(result.candidate, candidate);
  assert.equal(postflight.candidate.dirty, false, 'candidate became dirty during execution');
  assert.equal(postflight.sameCandidate, true, 'candidate or sources changed during execution');
  assert.deepEqual(postflight.candidate, candidate);
  assert.deepEqual(postflight.sourceInputs, preflight.sourceInputs);
  assert.equal(git(['rev-parse', 'HEAD']), candidate.commit, 'verifier must run at the tested clean candidate');
  assert.equal(git(['rev-parse', 'HEAD^{tree}']), candidate.tree);
  assert.equal(git(['status', '--porcelain=v1']), '', 'verifier source checkout is dirty');
  const freezeFile = safePath(root, preflight.designFreeze.path);
  const freeze = json(freezeFile);
  assert.equal(hash(readFileSync(freezeFile)), preflight.designFreeze.sha256);
  assert.deepEqual(result.designFreeze, preflight.designFreeze);
  assert(preflight.designFreeze.commit !== candidate.commit, 'design and candidate must be separate commits');
  git(['merge-base', '--is-ancestor', preflight.designFreeze.commit, candidate.commit]);
  assert.equal(hash(execFileSync('git', ['show', preflight.designFreeze.commit + ':' + preflight.designFreeze.path], { cwd: root })), preflight.designFreeze.sha256);
  const requiredSources = [...new Set([...Object.keys(freeze.unchangedSourcesSha256), preflight.designFreeze.path,
    'scripts/context-inline-spill-benefit-loop-eval.mts', 'scripts/context-inline-spill-benefit-round5-verify.mjs',
    'scripts/context-inline-spill-benefit-round5-recompute.mjs', 'scripts/context-inline-spill-benefit-round6-verify.mjs',
    'tests/unit/context-inline-spill-benefit-clean-candidate.test.ts', 'harness/specs/tasks/inline-spill-real-benefit-eval-round6.md',
    'harness/specs/rules/inline-spill-eval-projected-input.md', 'harness/specs/scenarios/context-family.md',
    '.gitattributes', 'package.json', 'openclaw_runtime/package.json',
    ...(freeze.schema === 'ContextInlineSpillRound7FrozenDesign/v1' ? ['scripts/context-inline-spill-benefit-strategy.mts',
      'scripts/context-inline-spill-benefit-round7-verify.mjs', 'tests/unit/context-inline-spill-benefit-strategy.test.ts',
      'harness/specs/tasks/inline-spill-real-benefit-eval-round7.md'] : [])])];
  assert.deepEqual(Object.keys(preflight.sourceInputs).sort(), requiredSources.sort());
  for (const path of requiredSources) {
    const identity = preflight.sourceInputs[path];
    const bytes = readFileSync(safePath(root, path));
    assert.equal(bytes.length, identity.bytes, path);
    assert.equal(hash(bytes), identity.sha256, path);
    assert.equal(git(['rev-parse', candidate.commit + ':' + path]), identity.gitBlob, path);
    assert.equal(git(['hash-object', '--no-filters', path]), identity.worktreeBlob, path);
    assert.equal(identity.gitBlob, identity.worktreeBlob, path);
    if (Object.hasOwn(freeze.unchangedSourcesSha256, path)) assert.equal(identity.sha256, freeze.unchangedSourcesSha256[path]);
  }
  const preservationFile = freeze.round5PreservationPath ? safePath(root, freeze.round5PreservationPath) : join(dirname(freezeFile), 'round5-preservation.json');
  assert.equal(hash(readFileSync(preservationFile)), freeze.round5PreservationSha256);
  const preservation = json(preservationFile);
  const historicalBytes = readFileSync(join(dirname(preservationFile), preservation.rawBundle.path));
  assert.equal(hash(historicalBytes), preservation.rawBundle.sha256);
  const historical = gunzipSync(historicalBytes).toString('utf8').trim().split('\n').map(parse);
  assert.equal(historical.length, preservation.files.length);
  for (const item of preservation.files) {
    const retained = historical.find(entry => entry.path === item.path);
    assert(retained, 'missing fifth-round original: ' + item.path);
    const bytes = originalBytes(retained);
    assert.equal(bytes.length, item.bytes);
    assert.equal(hash(bytes), item.sha256);
  }
  const oldOutcome = parse(originalBytes(historical.find(item => item.path.endsWith('/inline-r5-outcome.json'))));
  const oldFailure = parse(originalBytes(historical.find(item => item.path.endsWith('/verification-failure.json'))));
  assert.equal(oldOutcome.candidate.dirty, true);
  assert.equal(oldOutcome.decision.status, 'mechanism-only');
  assert.equal(oldFailure.B7CleanCandidate, false);
  for (const gate of ['b2_task_benefit', 'b3_retention_benefit', 'b4_non_inferiority', 'b6_budget']) assert.equal(oldOutcome.decision[gate], false);

  if (process.argv.includes('--seal')) {
    const archives = filesBelow(join(dir, 'archives')).map(path => {
      const bytes = readFileSync(path);
      return { ...metadata, file: relative(dir, path).replaceAll('\\', '/'), bytes: bytes.length,
        fileSha256: hash(bytes), content: bytes.toString('utf8') };
    });
    const bundle = gzipSync(archives.map(item => JSON.stringify(item)).join('\n') + '\n');
    writeFileSync(join(dir, 'archives.jsonl.gz'), bundle);
    save(join(dir, 'archive-manifest.json'), { ...metadata, count: archives.length, bytes: bundle.length, sha256: hash(bundle) });
    if (!existsSync(join(dir, 'runner-SHA256SUMS'))) writeFileSync(join(dir, 'runner-SHA256SUMS'), readFileSync(join(dir, 'SHA256SUMS')));
    const rootFiles = readdirSync(dir, { withFileTypes: true }).filter(item => item.isFile() && !['SHA256SUMS', 'seal-credential-scan.json'].includes(item.name)).map(item => item.name).sort();
    const secrets = [process.env.CONTEXT_INLINE_SPILL_API_KEY, process.env.LOCAL3065_API_KEY].filter(Boolean);
    const texts = rootFiles.filter(name => !name.endsWith('.gz')).map(name => readFileSync(join(dir, name), 'utf8')).concat(archives.map(item => item.content));
    const hits = texts.reduce((sum, text) => sum + secrets.filter(secret => text.includes(secret)).length + (text.match(/\bsk-[A-Za-z0-9_-]{16,}\b/g)?.length ?? 0), 0);
    save(join(dir, 'seal-credential-scan.json'), { ...metadata, filesScanned: texts.length, hits, passed: hits === 0 });
    rootFiles.push('seal-credential-scan.json');
    writeFileSync(join(dir, 'SHA256SUMS'), rootFiles.sort().map(name => hash(readFileSync(join(dir, name))) + '  ' + name).join('\n') + '\n');
  }
  const requiredFiles = ['result.json', 'runs.json', 'runs.jsonl', 'provider-calls.jsonl', 'preflight.json', 'postflight.json',
    'progress.json', 'credential-scan.json', 'runner-SHA256SUMS', 'archives.jsonl.gz', 'archive-manifest.json', 'seal-credential-scan.json'];
  const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/).map(line => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line); assert(match, 'invalid SHA256SUMS row');
    assert.equal(hash(readFileSync(safePath(dir, match[2]))), match[1], match[2]); return match[2];
  });
  for (const name of requiredFiles) assert(sums.includes(name), 'unsealed artifact: ' + name);
  assert.equal(json(join(dir, 'seal-credential-scan.json')).hits, 0);
  assert.equal(json(join(dir, 'credential-scan.json')).hits, 0);
  assert.deepEqual(lines(join(dir, 'runs.jsonl')).map(item => item.record), records);
  const wires = lines(join(dir, 'provider-calls.jsonl'));
  assert.equal(wires.length, records.reduce((sum, row) => sum + row.turns, 0));
  let wireIndex = 0;
  for (const row of records) for (const call of row.providerCalls) {
    const wire = wires[wireIndex++];
    const { driven_by, actor: wireActor, realHumanEvidence, arm, fixtureId, repetition, ...raw } = wire;
    assert.equal(driven_by, 'agent'); assert.equal(wireActor, actor); assert.equal(realHumanEvidence, false);
    assert.equal(arm, row.arm); assert.equal(fixtureId, row.fixtureId); assert.equal(repetition, row.repetition);
    assert.deepEqual(raw, call);
  }
  const archiveBytes = readFileSync(join(dir, 'archives.jsonl.gz'));
  const archiveManifest = json(join(dir, 'archive-manifest.json'));
  assert.equal(hash(archiveBytes), archiveManifest.sha256);
  const archives = gunzipSync(archiveBytes).toString('utf8').trim().split('\n').map(parse);
  assert.equal(archives.length, archiveManifest.count);
  const byUri = new Map();
  for (const item of archives) {
    const bytes = Buffer.from(item.content, 'utf8');
    assert.equal(hash(bytes), item.fileSha256); assert.equal(bytes.length, item.bytes);
    const archive = parse(item.content);
    const payloadBytes = typeof archive.payload === 'string' ? archive.payload : JSON.stringify(stableValue(archive.payload));
    assert.equal(archive.handle.checksum, 'sha256:' + hash(payloadBytes));
    assert.equal(archive.handle.byteLength, Buffer.byteLength(payloadBytes));
    archive.text = typeof archive.payload === 'string' ? archive.payload : JSON.stringify(archive.payload, null, 2);
    assert(!byUri.has(archive.handle.uri), 'duplicate archive URI'); byUri.set(archive.handle.uri, archive);
  }
  const protocolOut = out + '.protocol.json';
  execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'context-inline-spill-benefit-round5-verify.mjs'), dir, protocolOut], { stdio: 'inherit', windowsHide: true });
  const stats = json(protocolOut + '.stats.json');
  const diagnostics = { responseStatuses: {}, incompleteReasons: {}, returnedModels: {}, transportErrors: 0,
    missingUsage: 0, archiveSelection: {}, perRun: [], retentionPairs: {} };
  for (const arm of Object.keys(result.design.arms)) diagnostics.archiveSelection[arm] = { originalTarget: 0, otherArchive: 0,
    missingArchive: 0, invalidTargetMetadata: 0, originalOracleHits: 0, otherOracleHits: 0, maxSerializedResultChars: 0 };
  for (const row of records) {
    assert.equal(row.providerCalls.length <= freeze.live.maxTurns, true);
    const original = byUri.get(row.archive.uri); assert(original, 'original target archive missing');
    assert.equal(original.handle.checksum, row.archive.checksum); assert.equal(original.handle.byteLength, row.archive.byteLength);
    const value = oracle[row.fixtureId] ?? null;
    const position = value === null ? -1 : original.payload.indexOf(value);
    if (value !== null) assert(position >= 0, 'oracle missing from original payload');
    const selected = [];
    for (const call of row.providerCalls) {
      assert.equal(call.request.max_output_tokens, freeze.live.maxOutputTokens);
      assert.deepEqual(call.request.reasoning, freeze.live.reasoning);
      assert.equal(call.request.temperature, freeze.live.temperature);
      assert.equal(call.request.model, freeze.provider.model);
      let body = null;
      try { body = parse(call.raw_response); } catch {}
      const status = body?.status ?? (call.failure_class === 'provider_transport_error' ? 'transport-error' : call.status);
      diagnostics.responseStatuses[status] = (diagnostics.responseStatuses[status] ?? 0) + 1;
      if (body?.model) diagnostics.returnedModels[body.model] = (diagnostics.returnedModels[body.model] ?? 0) + 1;
      if (status === 'incomplete') {
        const reason = body.incomplete_details?.reason ?? 'unknown';
        diagnostics.incompleteReasons[reason] = (diagnostics.incompleteReasons[reason] ?? 0) + 1;
        assert.equal(call.status, 'failed'); assert.equal(row.success, false); assert.equal(row.failureClass, 'provider_incomplete');
      }
      if (call.failure_class === 'provider_transport_error') diagnostics.transportErrors++;
      if (result.mode === 'live' && !body?.usage) diagnostics.missingUsage++;
      if (result.mode === 'live' && call.status === 'executed') {
        assert.equal(body.status, 'completed'); assert.equal(body.model, freeze.provider.model);
        for (const field of ['input_tokens', 'output_tokens', 'total_tokens']) assert(Number.isSafeInteger(body.usage?.[field]) && body.usage[field] >= 0, 'missing provider token usage');
      }
    }
    if (result.mode === 'live') {
      const last = row.providerCalls.at(-1);
      const expected = last.status === 'failed' || last.tool_call_count > 0 ? { ok: false, value: null } : finalAnswer(last.text);
      assert.deepEqual(row.finalAnswer, expected, 'final answer differs from raw final response');
    }
    const arm = diagnostics.archiveSelection[row.arm];
    for (const tool of row.toolCalls) {
      const args = tool.arguments;
      const match = args.archive_uri === row.archive.uri && args.checksum === row.archive.checksum;
      const lengthOk = args.byte_length === undefined || args.byte_length === row.archive.byteLength;
      const kind = match && lengthOk ? 'originalTarget' : match ? 'invalidTargetMetadata' : args.archive_uri ? 'otherArchive' : 'missingArchive';
      arm[kind]++;
      arm.maxSerializedResultChars = Math.max(arm.maxSerializedResultChars, tool.result_chars ?? 0);
      let returned = null; try { returned = parse(tool.raw_result); } catch {}
      if (tool.ok) {
        const archive = byUri.get(args.archive_uri); assert(archive, 'returned archive was not retained');
        assert.equal(archive.handle.checksum, args.checksum);
        assert.equal(archive.handle.source.sessionId, row.sessionId);
        assert.equal(returned.content, archive.text.slice(returned.offset, returned.offset + args.max_chars));
        assert.equal(returned.char_count, archive.text.length);
        assert.equal(returned.truncated, returned.offset + returned.content.length < archive.text.length);
      }
      const hit = Boolean(value && returned?.content?.includes(value));
      if (hit && kind === 'originalTarget') arm.originalOracleHits++;
      if (hit && kind === 'otherArchive') arm.otherOracleHits++;
      selected.push({ callId: tool.call_id, kind, offset: args.offset ?? 0, maxChars: args.max_chars ?? null,
        ok: tool.ok, contentChars: returned?.content?.length ?? 0, rawOracleHit: hit,
        originalPageCoversOracle: kind === 'originalTarget' && tool.ok && position >= returned.offset && position < returned.offset + returned.content.length });
    }
    diagnostics.perRun.push({ arm: row.arm, fixtureId: row.fixtureId, repetition: row.repetition,
      success: row.success, failureClass: row.failureClass, turns: row.turns, modelRecalls: row.toolCalls.length,
      aboveThreeRecalls: row.toolCalls.length > 3, originalOraclePosition: position, selected });
  }
  for (const [name, wantedEvidence] of [['evidence', true], ['controls', false]]) {
    const pair = { pairs: 0, both: 0, onlyStable: 0, onlyOff: 0, neither: 0 };
    for (const row of records.filter(row => row.arm === 'recall-stable' && Object.hasOwn(oracle, row.fixtureId) === wantedEvidence)) {
      const off = records.find(other => other.arm === 'retention-off' && other.fixtureId === row.fixtureId && other.repetition === row.repetition);
      pair.pairs++; pair[row.success ? off.success ? 'both' : 'onlyStable' : off.success ? 'onlyOff' : 'neither']++;
    }
    diagnostics.retentionPairs[name] = pair;
  }
  const gates = { ...stats.decisions, b7_evidence: true };
  const allBenefitGates = Object.entries(gates).filter(([key]) => /^b[1-7]_/.test(key)).every(([, value]) => value === true);
  const status = result.mode !== 'live' ? 'inconclusive' : allBenefitGates ? 'task-benefit-verified'
    : gates.b1_mechanism_and_autonomy && (!gates.b2_task_benefit || !gates.b3_retention_benefit) ? 'mechanism-only' : 'no-benefit';
  const facts = { schema: 'ContextInlineSpillRound6Verification/v1', ...metadata, mode: result.mode,
    candidate, designFreeze: preflight.designFreeze, B7CleanCandidate: true, verifierAcceptedCleanCandidate: true,
    passed: true, sha256FilesVerified: sums.length, archivesVerified: archives.length,
    fifthRoundOriginalFilesPreserved: historical.length, fifthRoundVerdict: 'mechanism-only / NO_GO',
    decision: { status, verdict: result.mode === 'live' && allBenefitGates ? 'GO' : 'NO_GO', ...gates },
    stats: stats.stats, comparisons: stats.comparisons, evidenceComparisons: stats.evidenceComparisons, diagnostics,
    engineeringAcceptedByAgent: false, productDefaultsChanged: false, productLocksChanged: false, releaseApproved: false };
  save(out, facts);
  console.log(JSON.stringify({ output: out, acceptedCleanCandidate: true, mode: result.mode, records: records.length,
    providerCalls: wires.length, status, verdict: facts.decision.verdict, B7CleanCandidate: true }));
} catch (error) {
  save(out, { schema: 'ContextInlineSpillRound6Verification/v1', ...metadata, passed: false,
    B7CleanCandidate: false, verifierAcceptedCleanCandidate: false, decision: { status: 'inconclusive', verdict: 'NO_GO', b7_evidence: false },
    error: String(error) });
  console.error(String(error));
  process.exitCode = 1;
}
