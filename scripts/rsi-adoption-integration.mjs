#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportAdoptionEvents, validateAdoptionExport } from './rsi-adoption-export.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outBase = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : join(root, '.agent-workbench', 'audits', 'rsi-experience-adoption'));
mkdirSync(outBase, { recursive: true });
const outDir = mkdtempSync(join(outBase, 'run-'));
const paths = {
  tests: join(outDir, 'tests.json'), events: join(outDir, 'runtime-events.json'),
  database: join(outDir, 'runtime-state.sqlite'), export: join(outDir, 'export.v1.json'),
  result: join(outDir, 'integration.v1.json'),
};
const command = ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.rsi-adoption.config.ts', '--reporter=json', `--outputFile=${paths.tests}`];
const started = Date.now();
const schemaCommand = ['scripts/generate-kysely-types.mjs', '--verify'];
const schema = spawnSync(process.execPath, schemaCommand, { cwd: join(root, 'openclaw_runtime'), windowsHide: true,
  timeout: 30000, maxBuffer: 1000000, encoding: 'utf8' });
writeFileSync(join(outDir, 'schema-stdout.log'), schema.stdout ?? '');
writeFileSync(join(outDir, 'schema-stderr.log'), schema.stderr ?? '');
const child = spawnSync(process.execPath, command, { cwd: root, windowsHide: true,
  timeout: 300000, maxBuffer: 4000000, encoding: 'utf8',
  env: { ...process.env, ...(process.platform === 'win32' ? { TEMP: 'D:/tmp', TMP: 'D:/tmp' } : {}),
    RSI_ADOPTION_EVENT_REPORT: paths.events, RSI_ADOPTION_DB_SNAPSHOT: paths.database },
});
writeFileSync(join(outDir, 'stdout.log'), child.stdout ?? '');
writeFileSync(join(outDir, 'stderr.log'), child.stderr ?? '');
const result = { schemaVersion: 'RsiAdoptionIntegration/v1', driven_by: 'agent', actor: 'codex/rsi-adoption-integration',
  paidProviderCalls: 0, command: [process.execPath, ...command], elapsedMs: Date.now() - started,
  exitCode: child.status, signal: child.signal, error: child.error?.code ?? null, passed: false, paths };
result.schema = { command: [process.execPath, ...schemaCommand], cwd: join(root, 'openclaw_runtime'), exitCode: schema.status, error: schema.error?.code ?? null };
try {
  const tests = JSON.parse(readFileSync(paths.tests, 'utf8'));
  const events = JSON.parse(readFileSync(paths.events, 'utf8'));
  const exported = exportAdoptionEvents({ dbPath: paths.database });
  writeFileSync(paths.export, JSON.stringify(exported, null, 2) + '\n');
  const validation = validateAdoptionExport(exported);
  result.tests = { total: tests.numTotalTests, passed: tests.numPassedTests, failed: tests.numFailedTests,
    pending: tests.numPendingTests, success: tests.success };
  result.exportValidation = validation;
  result.diagnostics = exported.diagnostics;
  result.operation = events.operation;
  const runtimeTests = tests.testResults.find((file) => file.name.replaceAll('\\', '/').endsWith('/tests/unit/rsi-adoption-runtime.test.ts'));
  result.passed = schema.status === 0 && child.status === 0 && tests.success && tests.numTotalTests > 0 && tests.numFailedTests === 0 &&
    tests.numPendingTests === 0 && validation.passed && exported.source.state === 'present' && !exported.source.truncated &&
    runtimeTests?.assertionResults.length === 2 && runtimeTests.assertionResults.every((test) => test.status === 'passed') &&
    events.operation.beforeSha256 !== events.operation.afterSha256 && events.principle.adoption_count === 1 &&
    events.principle.post_adoption_success === 1 && exported.diagnostics.rejected > 0 &&
    exported.diagnostics.unknownOutcomes > 0 && exported.diagnostics.duplicates > 0;
} catch (error) { result.readbackError = error.message; }
writeFileSync(paths.result, JSON.stringify(result, null, 2) + '\n');
writeFileSync(join(outBase, 'integration.latest.v1.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
