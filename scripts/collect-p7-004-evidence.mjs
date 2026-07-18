#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runReleaseGateCommand } from './lib/run-release-gate-command.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'artifacts/system-maturity/P7-004');
const gatesDir = path.join(outDir, 'validation-gates');
fs.mkdirSync(gatesDir, { recursive: true });

// Order: logic gates first; harness near end after files land; seal last.
const commands = [
  ['diff-check', 'git diff --check'],
  ['focused-unit', 'pnpm exec vitest run tests/unit/system-maturity-quarterly-audit-p7-004.test.ts'],
  ['quarterly-dry-run', 'pnpm maturity:quarterly -- --dry-run'],
  ['agent-dev-audit', 'pnpm agent-dev:audit'],
  ['agent-dev-deep-test', 'pnpm agent-dev:deep-test:reuse'],
  ['typecheck', 'pnpm run typecheck'],
  ['e2e-agent-dev-quality', ensureE2eQualityCommand()],
  ['lint-check', 'pnpm run lint:check'],
  ['unit-full', 'pnpm test'],
  // harness after product/plan file changes are already on disk from this collector's prior steps
  ['harness-task', 'pnpm harness validate --spec harness/specs/tasks/system-maturity-quarterly-audit.md'],
  // hash-sync before validate: maturity:validate includes evidence hash checks
  ['maturity-hash-sync-pre', 'node scripts/update-system-maturity-delivery-hashes.mjs'],
  ['maturity-validate', 'pnpm maturity:validate'],
  ['maturity-hash-sync', 'node scripts/update-system-maturity-delivery-hashes.mjs'],
  ['maturity-evidence', 'pnpm maturity:evidence'],
  ['harness-recheck', 'pnpm harness validate --spec harness/specs/tasks/system-maturity-quarterly-audit.md'],
  ['quarterly-final', 'pnpm maturity:quarterly'],
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
  if ((result.status ?? 1) !== 0) {
    // Keep writing partial report for diagnosis, but fail closed.
    writeReport(results, false);
    process.exit(1);
  }
}

writeReport(results, true);

function writeReport(commands, ok) {
  const report = {
    schemaVersion: 1,
    task: 'P7-004',
    generatedAt: new Date().toISOString(),
    ok,
    primaryFindingIds: ['F-GOV-002', 'F-GOV-003'],
    gatePolicy: {
      agentDevAudit: 'pnpm agent-dev:audit',
      deepTest: 'pnpm agent-dev:deep-test:reuse',
      requiredFullGates: [
        'pnpm run typecheck',
        'pnpm run test:e2e:agent-dev-quality:run',
      ],
    },
    commands,
  };
  fs.writeFileSync(path.join(outDir, 'full-validation.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function ensureE2eQualityCommand() {
  const distIndex = path.join(root, 'dist', 'index.html');
  const distElectron = path.join(root, 'dist-electron', 'main');
  if (fs.existsSync(distIndex) && fs.existsSync(distElectron)) {
    return 'pnpm run test:e2e:agent-dev-quality:run';
  }
  // build:vite produces renderer + electron bundles required by Playwright Electron e2e
  return 'pnpm run build:vite && pnpm run test:e2e:agent-dev-quality:run';
}

function normalize(value) {
  const text = String(value || '').replace(/\r\n?/gu, '\n').replace(/[\t ]+$/gmu, '').replace(/\n*$/u, '');
  return text ? `${text}\n` : '';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
