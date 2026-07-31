#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256CanonicalEvidenceFile } from './lib/canonical-evidence-hash.mjs';
import { normalizeCapturedOutput } from './lib/captured-output-redaction.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'artifacts/system-maturity/P7-001');
const gatesDir = path.join(outDir, 'gates');
fs.mkdirSync(gatesDir, { recursive: true });
const reportPath = path.join(outDir, 'full-validation.json');
const resume = process.argv.includes('--resume');
const previous = resume && fs.existsSync(reportPath)
  ? JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  : null;

const commands = [
  ['diff-check', 'git', ['diff', '--check']],
  ['focused-unit', 'pnpm', ['exec', 'vitest', 'run', 'tests/unit/system-maturity-traceability-p7-001.test.ts']],
  ['plan-validate', 'node', ['scripts/validate-system-maturity-plan.mjs']],
  ['delivery-hash-sync', 'node', ['scripts/update-system-maturity-delivery-hashes.mjs']],
  ['evidence-validate', 'node', ['scripts/validate-system-maturity-evidence.mjs']],
  ['harness-task', 'pnpm', ['harness', 'validate', '--spec', 'harness/specs/tasks/system-maturity-traceability.md']],
  ['harness-ci', 'pnpm', ['run', 'harness:ci']],
  ['lint-check', 'pnpm', ['run', 'lint:check']],
  ['typecheck', 'pnpm', ['run', 'typecheck']],
  ['unit-full', 'pnpm', ['test']],
];

const results = [];
for (const [id, command, args] of commands) {
  const prior = previous?.commands?.find((item) => item.id === id);
  if (prior?.exitCode === 0
    && fs.existsSync(path.join(root, prior.stdout))
    && fs.existsSync(path.join(root, prior.stderr))) {
    results.push({ ...prior, reused: true });
    console.log(`${id}: reused exit=0`);
    continue;
  }
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const useWindowsCommandHost = process.platform === 'win32' && command === 'pnpm';
  const executable = useWindowsCommandHost ? (process.env.ComSpec || 'cmd.exe') : command;
  const commandArgs = useWindowsCommandHost
    ? ['/d', '/s', '/c', [command, ...args].join(' ')]
    : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
  });
  const stdoutPath = path.join(gatesDir, `${id}.stdout.txt`);
  const stderrPath = path.join(gatesDir, `${id}.stderr.txt`);
  const redactionPaths = {
    workspaceRoot: root,
    userHome: process.env.USERPROFILE || os.homedir(),
  };
  const stdout = normalizeCapturedOutput(result.stdout, redactionPaths);
  const stderr = normalizeCapturedOutput(
    [result.stderr, result.error?.stack].filter(Boolean).join('\n'),
    redactionPaths,
  );
  fs.writeFileSync(stdoutPath, stdout);
  fs.writeFileSync(stderrPath, stderr);
  results.push({
    id,
    command: [command, ...args].join(' '),
    startedAt,
    durationMs: Date.now() - started,
    exitCode: result.status ?? 1,
    signal: result.signal || null,
    spawnError: result.error?.message || null,
    stdout: path.relative(root, stdoutPath).replace(/\\/gu, '/'),
    stdoutSha256: sha256CanonicalEvidenceFile(stdoutPath),
    stderr: path.relative(root, stderrPath).replace(/\\/gu, '/'),
    stderrSha256: sha256CanonicalEvidenceFile(stderrPath),
  });
  console.log(`${id}: exit=${result.status ?? 1}`);
}

const report = {
  schemaVersion: 1,
  task: 'P7-001',
  generatedAt: new Date().toISOString(),
  ok: results.every((result) => result.exitCode === 0),
  commands: results,
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (!report.ok) process.exit(1);
