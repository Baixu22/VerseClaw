import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [directory, output] = process.argv.slice(2);
if (!directory || !output) throw new Error('usage: round7-verify <run-directory> <output.json> [--seal]');
const root = process.cwd();
const dir = resolve(directory);
const out = resolve(output);
const actor = 'codex-g7-inline-spill-tf0749-01a1d34c';
const metadata = { driven_by: 'agent', actor, realHumanEvidence: false };
const hash = value => createHash('sha256').update(value).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
try {
  const result = json(join(dir, 'result.json'));
  const records = json(join(dir, 'runs.json')).records;
  const pre = json(join(dir, 'preflight.json'));
  const freeze = json(resolve(root, pre.designFreeze.path));
  assert(['ContextInlineSpillRound7FrozenDesign/v1', 'ContextInlineSpillRound8FrozenDesign/v1', 'ContextInlineSpillRound9FrozenDesign/v1'].includes(freeze.schema));
  assert.equal(result.design.strategy, freeze.live.strategy);
  assert.equal(result.design.pressureSource, freeze.live.pressureSource);
  assert.equal(result.design.providerTimeoutMs, freeze.live.providerTimeoutMs);
  const oldRoot = resolve(root, freeze.round6Preservation.path);
  assert.equal(hash(readFileSync(join(oldRoot, 'SHA256SUMS'))), freeze.round6Preservation.sha256);
  const oldFiles = readFileSync(join(oldRoot, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/);
  for (const line of oldFiles) {
    const [, digest, path] = /^([a-f0-9]{64})  (.+)$/.exec(line) ?? [];
    assert(digest && path); assert.equal(hash(readFileSync(resolve(oldRoot, path))), digest, path);
  }
  const oldOutcome = json(join(oldRoot, 'outcome.json'));
  assert.equal(oldOutcome.decision.verdict, 'NO_GO');
  for (const gate of ['b1_mechanism_and_autonomy', 'b2_task_benefit', 'b6_budget']) assert.equal(oldOutcome.decision[gate], false);
  const roles = ['assistant', 'user', 'toolResult', 'toolResult', 'toolResult'];
  let pressureEvents = 0;
  for (const record of records) {
    const pressure = ['recall-stable', 'retention-off'].includes(record.arm);
    const expected = pressure ? record.toolCalls.filter(call => call.failure_code !== 'parallel_recall_limit').length : 0;
    assert.equal(record.pressureEvents.length, expected);
    for (const event of record.pressureEvents) {
      pressureEvents++;
      assert.equal(event.source, 'tool');
      assert.deepEqual(event.roles, roles);
      assert.deepEqual(event.messages.map(item => ({ role: item.role, toolName: item.toolName, chars: item.chars, sha256: item.sha256 })), freeze.pressure.messages);
    }
    for (const call of record.providerCalls) {
      assert.equal(hash(JSON.stringify(call.request.tools[0])), freeze.toolDefinitionSha256);
      assert(!String(call.request.input[0].content).includes('user: Additional context for the remaining checks:'), 'tool logs regained protected user provenance');
    }
  }
  execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'context-inline-spill-benefit-round6-verify.mjs'), dir, out,
    ...(process.argv.includes('--seal') ? ['--seal'] : [])], { stdio: 'inherit', windowsHide: true });
  const verified = json(out);
  verified.schema = 'ContextInlineSpillRound7Verification/v1';
  verified.pressureProvenance = { source: 'tool', events: pressureEvents, originalLogBytesPreserved: true,
    userAssistantCadencePreserved: true, additionalToolPressureChars: freeze.pressure.transferredLogChars,
    sourceOfInstruction: 'fixed agent-driven continue instruction' };
  verified.round6EvidencePreserved = { files: oldFiles.length, sha256: freeze.round6Preservation.sha256, verdict: 'NO_GO' };
  writeFileSync(out, JSON.stringify(verified, null, 2) + '\n');
  console.log(JSON.stringify({ output: out, mode: verified.mode, pressureEvents, cleanCandidate: verified.B7CleanCandidate,
    status: verified.decision.status, verdict: verified.decision.verdict }));
} catch (error) {
  writeFileSync(out, JSON.stringify({ schema: 'ContextInlineSpillRound7Verification/v1', ...metadata,
    B7CleanCandidate: false, verifierAcceptedCleanCandidate: false, passed: false,
    decision: { status: 'inconclusive', verdict: 'NO_GO', b7_evidence: false }, error: String(error) }, null, 2) + '\n');
  console.error(String(error)); process.exitCode = 1;
}
