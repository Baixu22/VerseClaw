// driven_by: agent; actor: codex-g7-inline-spill-tf0749-01a1d34c; realHumanEvidence: false
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildVisibleRecallNavigation, navigatedDeterministicTurn } from './navigation-prototype.mts';
const source = 'D:/tmp/g7-closeout-pass-r7-01a1d34c/live/2026-11-13T09-05-58-153Z-live/runs.jsonl';
const bytes = readFileSync(source);
const records = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line).record);
const checks = [];
for (const row of records.filter(row => row.arm === 'recall-stable')) {
  const call = row.providerCalls[1];
  if (!call) continue;
  const before = JSON.stringify(call.request.input);
  const repair = buildVisibleRecallNavigation(call.request.input);
  assert.equal(JSON.stringify(call.request.input), before);
  assert.equal(repair.navigation.recommendedArguments?.archive_uri, row.archive.uri);
  assert.equal(repair.navigation.recommendedArguments?.checksum, row.archive.checksum);
  assert.equal(repair.navigation.recommendedArguments?.offset, 5500);
  assert(!repair.input.at(-1)!.content.includes('private_evidence='), 'navigation copied a payload value');
  assert.deepEqual(repair.input.slice(0, -1), call.request.input);
  checks.push({ fixtureId: row.fixtureId, repetition: row.repetition, inputSha256: createHash('sha256').update(before).digest('hex'),
    navigation: repair.navigation, observedNextCallOriginal: row.toolCalls[1]?.arguments.archive_uri === row.archive.uri });
}
const checksum = 'sha256:' + 'a'.repeat(64), uri = 'context-archive://session/original.json';
const hidden = [{ role: 'user', content: 'No visible reference' }, { type: 'function_call', name: 'context_archive_recall', call_id: 'first',
  arguments: JSON.stringify({ archive_uri: uri, checksum, offset: 5500, max_chars: 5500 }) },
  { type: 'function_call_output', call_id: 'first', output: '{"ok":false,"diagnostics":[{"code":"projection_omitted"}]}' }];
assert.equal(buildVisibleRecallNavigation(hidden).navigation.recommendedArguments?.offset, 11000);
assert.equal(navigatedDeterministicTurn([{ role: 'user', content: 'No visible reference' }]).text, '{"value":null}');
assert.equal(navigatedDeterministicTurn([{ type: 'function_call_output', output: '{"ok":true,"content":"private_evidence=VISIBLE_VALUE\\n"}' }]).text, '{"value":"VISIBLE_VALUE"}');
writeFileSync('D:/tmp/g7-closeout-pass-r7-01a1d34c/navigation-prototype-readback.json', JSON.stringify({ schema: 'G7VisibleNavigationMechanismProbe/v1',
  driven_by: 'agent', actor: 'codex-g7-inline-spill-tf0749-01a1d34c', realHumanEvidence: false, recordedAt: new Date().toISOString(),
  source, capturedBytes: bytes.length, capturedSha256: createHash('sha256').update(bytes).digest('hex'), checks,
  sourceInputUnchanged: true, payloadValuesCopied: false, clearedOutputFallbackVerified: true, missingReferenceNullVerified: true,
  mode: 'deterministic', liveBenefitEvaluated: false, taskForestUpdated: false }, null, 2) + '\n');
console.log(JSON.stringify({ capturedStableInputs: checks.length, originalNavigation: checks.length,
  observedModelOriginal: checks.filter(check => check.observedNextCallOriginal).length }));
