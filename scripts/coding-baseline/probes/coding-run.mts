/** Freeze actual CLI inputs and results for the CodingRun v1 boundary. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectTaskLoopCodingRun, serializeCodingRunJsonl } from '../../../shared/types/coding-run.ts';

const output = process.env.CODING_BASELINE_OUTPUT;
if (!output || !path.isAbsolute(output)) throw new Error('CODING_BASELINE_OUTPUT must be absolute');
mkdirSync(output, { recursive: true });
const rows: Array<Record<string, unknown>> = [];
const run = (name: string, jsonl: string, expectedExit: number, expectedFinal?: string) => {
  const inputFile = path.join(output, `${name}.jsonl`);
  writeFileSync(inputFile, jsonl);
  const args = ['scripts/coding-run-summary.mjs', inputFile];
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 20_000 });
  const parsed = JSON.parse((expectedExit === 0 ? result.stdout : result.stderr).trim());
  const pass = result.status === expectedExit && (expectedFinal === undefined || parsed.finalStatus === expectedFinal);
  rows.push({ name, argv: [process.execPath, ...args], inputSha256: createHash('sha256').update(jsonl).digest('hex'),
    exitCode: result.status, stdout: result.stdout, stderr: result.stderr, expectedExit, expectedFinal, pass });
};
for (const [status, gate, expected] of [
  ['complete', true, 'completed'], ['complete', false, 'unavailable'], ['cancelled', false, 'aborted'],
  ['aborted', false, 'aborted'], ['error', false, 'error'], ['blocked', false, 'unavailable'],
] as const) {
  const p = projectTaskLoopCodingRun({ loopRunId: `loop-${status}`, status, phase: 'verify',
    ...(gate ? { evidenceGate: { status: 'pass' } } : {}), testsRun: ['pnpm test'] });
  run(`${status}-${gate ? 'gate' : 'no-gate'}`, serializeCodingRunJsonl(p.codingRun, p.events), 0, expected);
}
const p = projectTaskLoopCodingRun({ loopRunId: 'negative', status: 'complete', phase: 'verify', evidenceGate: { status: 'pass' } });
const jsonl = serializeCodingRunJsonl(p.codingRun, p.events);
for (const kind of ['cross-run', 'empty-scope', 'numeric-run', 'numeric-task', 'bad-completion', 'bad-event', 'bad-iteration', 'bad-sequence', 'bad-version', 'unknown-scope-field', 'unknown-event-field']) {
  const records = jsonl.split('\n').map((line) => JSON.parse(line));
  if (kind === 'cross-run') records[2].payload.codingRunId = 'another-run';
  if (kind === 'empty-scope') records[0].payload.scope = {};
  if (kind === 'numeric-run') records[0].payload.runIds = [42];
  if (kind === 'numeric-task') records[0].payload.taskLedgerRootId = 42;
  if (kind === 'bad-completion') records[0].payload.completion.taskStatus = 'made-up';
  if (kind === 'bad-event') records[2].payload.status = 'invented';
  if (kind === 'bad-iteration') records[1].payload.iteration = -1;
  if (kind === 'bad-sequence') records[1].sequence = 9;
  if (kind === 'bad-version') records[0].schema = 'coding-run/v2';
  if (kind === 'unknown-scope-field') records[0].payload.scope = { workspaceId: 'w', projectId: 'p', grantsWrite: true };
  if (kind === 'unknown-event-field') records[1].payload.grantsWrite = true;
  run(kind, records.map((record) => JSON.stringify(record)).join('\n'), 1);
}
const report = { schema: 'CodingRunCliAcceptance/v1', driven_by: 'agent', actor: 'codex-coding-p1', realHumanEvidence: false,
  candidate: execFileSync('git', ['rev-parse', 'HEAD'], { windowsHide: true, encoding: 'utf8' }).trim(),
  rows, pass: rows.every((row) => row.pass) };
writeFileSync(path.join(output, 'cli-results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cases: rows.length, pass: report.pass }));
assert(report.pass);
