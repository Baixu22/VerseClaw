#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportEvolutionDatabase } from './rsi-candidate-evolution.mjs';
import { checkEvolutionExport } from './lib/rsi-candidate-evolution.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outBase = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : join(root, '.agent-workbench/audits/rsi-candidate-evolution'));
mkdirSync(outBase, { recursive: true });
const outDir = mkdtempSync(join(outBase, 'run-'));
const paths = { tests: join(outDir, 'tests.json'), export: join(outDir, 'export.v1.json'), training: join(outDir, 'training-execution.v1.json'),
  events: join(outDir, 'events.v1.json'), database: join(outDir, 'state.sqlite'), result: join(outDir, 'result.v1.json') };
const command = ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.rsi-adoption.config.ts',
  'tests/unit/rsi-candidate-evolution.test.ts',
  'openclaw_runtime/src/knowledge/sekb/sekb.test.ts', 'tests/unit/tf0018-sekb-no-auto-writeback.test.ts',
  '--reporter=json', `--outputFile=${paths.tests}`];
const started = Date.now();
const child = spawnSync(process.execPath, command, { cwd: root, windowsHide: true,
  timeout: 600000, maxBuffer: 4000000, encoding: 'utf8', env: { ...process.env,
    ...(process.platform === 'win32' ? { TEMP: 'D:/tmp', TMP: 'D:/tmp' } : {}),
    RSI_EVOLUTION_EXPORT: paths.export, RSI_EVOLUTION_EVENTS: paths.events, RSI_EVOLUTION_DB: paths.database,
    RSI_EVOLUTION_TRAINING: paths.training } });
writeFileSync(join(outDir, 'stdout.log'), child.stdout ?? '');
writeFileSync(join(outDir, 'stderr.log'), child.stderr ?? '');
const result = { schemaVersion: 'RsiCandidateEvolutionIntegration/v1', driven_by: 'agent', actor: 'codex/rsi-evolution-integration',
  paidProviderCalls: 0, command: [process.execPath, ...command], elapsedMs: Date.now() - started,
  exitCode: child.status, signal: child.signal, error: child.error?.code ?? null, passed: false, paths };
try {
  const tests = JSON.parse(readFileSync(paths.tests, 'utf8'));
  const saved = JSON.parse(readFileSync(paths.export, 'utf8'));
  const exported = exportEvolutionDatabase({ dbPath: paths.database, runId: saved.runId });
  const events = JSON.parse(readFileSync(paths.events, 'utf8'));
  const checked = checkEvolutionExport(exported);
  result.tests = { total: tests.numTotalTests, passed: tests.numPassedTests, failed: tests.numFailedTests, pending: tests.numPendingTests };
  result.exportValidation = checked;
  result.databaseReadbackMatches = JSON.stringify(saved) === JSON.stringify(exported);
  result.generations = exported.candidates.map(candidate => ({ id: candidate.candidate?.id, parent: candidate.candidate?.parent,
    status: candidate.status, usage: candidate.usage }));
  result.verdicts = exported.decisions.map(decision => ({ status: decision.status, numerical: decision.numerical.status }));
  result.heldOutDigest = exported.plan.heldOutDigest;
  result.measurementCandidateId = exported.measurementCandidateId;
  result.rollback = events.rollback;
  result.passed = child.status === 0 && tests.success && tests.numTotalTests > 0 && tests.numFailedTests === 0
    && tests.numPendingTests === 0 && checked.passed && result.databaseReadbackMatches
    && exported.candidates.length === 2 && exported.unfinishedGenerations.length === 0 && exported.budget.providerCalls === 0
    && result.verdicts[0].status === 'eliminate' && result.verdicts[1].status === 'hold'
    && result.measurementCandidateId === result.generations[1].id
    && events.rollback.offBeforeDigest === events.rollback.offAfterDigest && events.rollback.onDigest !== events.rollback.offBeforeDigest;
} catch (error) { result.readbackError = error.message; }
writeFileSync(paths.result, JSON.stringify(result, null, 2) + '\n');
writeFileSync(join(outBase, 'integration.latest.v1.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
