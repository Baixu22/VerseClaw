// driven_by: agent; actor: codex-g7-inline-spill-tf0749-01a1d34c; realHumanEvidence: false
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function visibleExecBookmark(question: string, visibleText: string) {
  const uri = visibleText.match(/context-archive:\/\/[^\s"<>;,]+/)?.[0];
  const checksum = visibleText.match(/sha256:[a-f0-9]{64}/)?.[0];
  return uri && checksum ? question + '\noriginal_exec_archive_uri=' + uri + '\noriginal_exec_checksum=' + checksum : question;
}
export function bookmarkPair(text: string) {
  const uri = text.match(/^original_exec_archive_uri=(context-archive:\/\/[^\s"<>;,]+)$/m)?.[1];
  const checksum = text.match(/^original_exec_checksum=(sha256:[a-f0-9]{64})$/m)?.[1];
  return uri && checksum ? { uri, checksum } : null;
}
const root = 'D:/tmp/g7-closeout-pass-r8-01a1d34c';
const live = join(root, 'live', readdirSync(join(root, 'live'))[0]!);
const bytes = readFileSync(join(live, 'runs.jsonl'));
const records = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line).record);
const checks = [];
for (const row of records.filter(row => row.arm === 'recall-stable' && !row.recallOk)) {
  const firstInput = row.providerCalls[0].request.input;
  const initialText = String(firstInput[0].content);
  const bookmark = visibleExecBookmark('Original agent question', initialText);
  const selected = bookmarkPair(bookmark);
  assert(selected);
  assert.equal(selected.uri, row.archive.uri);
  assert.equal(selected.checksum, row.archive.checksum);
  const wrong = row.toolCalls[0].arguments;
  assert.notEqual(wrong.archive_uri, selected.uri);
  const current = row.providerCalls[1].request.input;
  const oldBytes = JSON.stringify(current);
  const protectedQuestion = { ...current[0], content: bookmark + '\n\n' + String(current[0].content) };
  const recovered = bookmarkPair(String(protectedQuestion.content));
  assert.deepEqual(recovered, selected);
  assert.equal(JSON.stringify(current), oldBytes);
  assert(!bookmark.includes('private_evidence='));
  checks.push({ fixtureId: row.fixtureId, repetition: row.repetition, originalUri: selected.uri,
    observedFirstUri: wrong.archive_uri, initialInputSha256: createHash('sha256').update(JSON.stringify(firstInput)).digest('hex'),
    currentInputSha256: createHash('sha256').update(oldBytes).digest('hex'), recoveredWithoutArgumentRewrite: true });
}
assert.equal(visibleExecBookmark('Question', 'No reference in the visible result'), 'Question');
const result = { schema: 'G7VisibleBookmarkMechanismProbe/v1', driven_by: 'agent', actor: 'codex-g7-inline-spill-tf0749-01a1d34c',
  realHumanEvidence: false, recordedAt: new Date().toISOString(), source: join(live, 'runs.jsonl'), capturedBytes: bytes.length,
  capturedSha256: createHash('sha256').update(bytes).digest('hex'), checks, protectedSource: 'existing agent-driven user question',
  copiedContent: 'initially visible URI/checksum only', mode: 'deterministic', liveBenefitEvaluated: false, taskForestUpdated: false };
writeFileSync(join(root, 'bookmark-prototype-readback.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ failedStableRunsReplayed: checks.length, recoverySuggestionsFromVisibleReferences: checks.length }));
