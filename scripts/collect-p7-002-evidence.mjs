#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleaseGateCommand } from './lib/run-release-gate-command.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'artifacts/system-maturity/P7-002');
const gatesDir = path.join(outDir, 'validation-gates');
fs.mkdirSync(gatesDir, { recursive: true });

const commands = [
  ['diff-check', 'git diff --check'],
  ['focused-unit', 'pnpm exec vitest run tests/unit/system-maturity-traceability-p7-001.test.ts tests/unit/system-maturity-security-suite-p7-002.test.ts'],
  ['harness-task', 'pnpm harness validate --spec harness/specs/tasks/system-maturity-security-regression.md'],
  ['security-full', 'pnpm maturity:security:full'],
  ['lint-check', 'pnpm run lint:check'],
  ['typecheck', 'pnpm run typecheck'],
  ['unit-full', 'pnpm test'],
  ['maturity-validate', 'pnpm maturity:validate'],
];

const results = [];
for (const [id, command] of commands) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = runReleaseGateCommand(command, {
    cwd: root,
    env: process.env,
    timeout: 60 * 60 * 1000,
    maxBuffer: 256 * 1024 * 1024,
  });
  const stdout = normalize(result.stdout);
  const stderr = normalize([result.stderr || '', result.error ? `${result.error.stack || result.error}\n` : ''].join(''));
  const stdoutPath = `validation-gates/${id}.stdout.txt`;
  const stderrPath = `validation-gates/${id}.stderr.txt`;
  fs.writeFileSync(path.join(outDir, stdoutPath), stdout);
  fs.writeFileSync(path.join(outDir, stderrPath), stderr);
  results.push({
    id,
    command,
    startedAt,
    durationMs: Date.now() - started,
    exitCode: result.status ?? 1,
    signal: result.signal || null,
    spawnError: result.error?.message || null,
    stdoutPath,
    stdoutSha256: sha256(stdout),
    stderrPath,
    stderrSha256: sha256(stderr),
  });
  console.log(`${id}: exit=${result.status ?? 1}`);
}

const report = {
  schemaVersion: 1,
  task: 'P7-002',
  generatedAt: new Date().toISOString(),
  ok: results.every((result) => result.exitCode === 0),
  findingIds: [
    'F-AUTH-006',
    'F-DATA-005',
    'F-GOV-001',
    'F-GOV-002',
    'F-REL-001',
    'F-REL-004',
    'F-SEC-003',
    'F-SEC-006',
    'F-SUPPLY-001',
  ],
  commands: results,
};
fs.writeFileSync(path.join(outDir, 'full-validation.json'), `${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exit(1);

function normalize(value) {
  const text = String(value || '').replace(/\r\n?/gu, '\n').replace(/[\t ]+$/gmu, '').replace(/\n*$/u, '');
  return text ? `${text}\n` : '';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
