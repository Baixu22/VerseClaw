#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, 'openclaw_runtime');
const { values } = parseArgs({ options: {
  output: { type: 'string' },
  'baseline-types': { type: 'string' },
} });
if (!values.output || !values['baseline-types']) throw new Error('--output and --baseline-types are required');
const output = resolve(values.output);
mkdirSync(output, { recursive: true });
const spec = 'harness/specs/tasks/verseshell-concurrent-acquisition-20261107.md';
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || 'git failed');
  return result.stdout.trim();
};
const candidate = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: git('status', '--porcelain').length > 0 };
if (candidate.dirty) throw new Error('Freeze a clean candidate before acceptance');
const dependencies = createRequire(join(runtime, 'package.json'));
const rootDependencies = createRequire(join(root, 'package.json'));
const packageFile = (require, name, entry) => join(dirname(require.resolve(`${name}/package.json`)), entry);
const vitest = packageFile(dependencies, 'vitest', 'vitest.mjs');
const tsgo = packageFile(dependencies, '@typescript/native-preview', 'bin/tsgo.js');
const eslint = packageFile(rootDependencies, 'eslint', 'bin/eslint.js');
const env = { ...process.env, TEMP: 'D:\\tmp', TMP: 'D:\\tmp', PERFORMANCE_LIFECYCLE_REPORT_DIR: output, COMMS_OUTPUT_DIR: join(output, 'comms') };
const commands = [];
function run(id, args, cwd = root, required = true) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(join(output, `${id}.log`), (result.stdout || '') + (result.stderr || ''));
  const entry = { id, argv: [process.execPath, ...args], cwd, exitCode: result.status, durationMs: Date.now() - startedAt, required };
  commands.push(entry);
  return entry;
}
run('harness-context', ['harness/src/cli.mjs', 'context', '--spec', spec]);
run('harness-validate', ['harness/src/cli.mjs', 'validate', '--spec', spec]);
run('harness-dry-run', ['harness/src/cli.mjs', 'run', '--spec', spec, '--dry-run']);
run('tests', [vitest, 'run', '--config', 'test/vitest/vitest.verseshell.config.ts', '--maxWorkers=1', '--reporter=json', `--outputFile=${join(output, 'tests.json')}`], runtime);
run('focused-types', [tsgo, '--noEmit', '-p', 'harness/specs/fixtures/verseshell-concurrent-acquisition-20261107/focused-tsconfig.json']);
run('runtime-types', [tsgo, '--noEmit', '-p', 'tsconfig.json', '--composite', 'false'], runtime, false);
const changed = [
  'process-manager.ts', 'process-manager.test.ts', 'governed-process.ts',
  'governed-process.test.ts', 'concurrent-acquisition.integration.test.ts',
].map(file => `openclaw_runtime/src/agents/verseshell/${file}`);
run('lint', [eslint, ...changed, 'scripts/verify-verseshell-acquisition.mjs', '--format', 'json', '--output-file', join(output, 'lint.json')]);
run('comms-replay', ['scripts/comms/replay.mjs']);
run('comms-compare', ['scripts/comms/compare.mjs']);
const diagnostics = text => text.split(/\r?\n/u).filter(line => line.includes('error TS'));
const baseline = readFileSync(values['baseline-types'], 'utf8');
writeFileSync(join(output, 'baseline-runtime-types.log'), baseline);
const current = readFileSync(join(output, 'runtime-types.log'), 'utf8');
const normalize = text => diagnostics(text).map(line => line.replace(/\(\d+,\d+\)/gu, ''));
const old = new Set(normalize(baseline));
const introduced = normalize(current).filter(line => !old.has(line));
const tests = JSON.parse(readFileSync(join(output, 'tests.json'), 'utf8'));
const owned = JSON.parse(readFileSync(join(output, 'owned-processes.json'), 'utf8'));
const failed = commands.filter(command => command.required && command.exitCode !== 0);
const report = {
  schema: 'clawx.verseshell-concurrent-acquisition-acceptance/v1',
  generatedAt: new Date().toISOString(), driven_by: 'agent', actor: 'codex',
  task: 'TF-0828', candidate, spec,
  tests: { total: tests.numTotalTests, passed: tests.numPassedTests, failed: tests.numFailedTests, skipped: tests.numPendingTests },
  processes: owned,
  types: { focused: commands.find(command => command.id === 'focused-types').exitCode === 0,
    runtimeFullPass: commands.find(command => command.id === 'runtime-types').exitCode === 0,
    baselineCommit: 'c7573ec11095b541f3a4a9c5470bf4e0727489bc', baselineDiagnostics: diagnostics(baseline).length,
    candidateDiagnostics: diagnostics(current).length, introduced },
  dependencies: { mode: 'reused installed dependencies via read-only junctions; no fresh-install claim', vitest, tsgo, eslint, node: process.version },
  sourceHashes: [...changed, 'scripts/verify-verseshell-acquisition.mjs', spec,
    'harness/specs/tasks/performance-resource-governance-20261107.md',
    'harness/specs/rules/verseshell-process-lifecycle-boundary.md',
    'openclaw_runtime/test/vitest/vitest.verseshell.config.ts',
    'harness/specs/fixtures/verseshell-concurrent-acquisition-20261107/focused-tsconfig.json',
  ].map(file => ({ path: file, sha256: createHash('sha256').update(readFileSync(join(root, file))).digest('hex') })),
  commands,
  claims: { hostLifecycle: true, realNodeProtocolChildren: true, realVerseShellPayload: false, mixedWorkloadBenefit: false },
  limitations: ['The existing 18 opt-in binary/platform cases are recorded as skipped.', 'Full runtime typecheck retains the compared baseline diagnostics.'],
  verdict: failed.length === 0 && tests.numFailedTests === 0 && owned.ownedResidualPids === 0 && introduced.length === 0 ? 'pass-scoped-acquisition' : 'fail',
};
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const tokenPatterns = [ /\bsk-[A-Za-z0-9_-]{20,}\b/gu, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/gu, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu ];
const files = () => readdirSync(output, { recursive: true }).filter(file => statSync(join(output, file)).isFile());
const credentialFiles = files().filter(file => /\.(?:json|log|md)$/u.test(file));
const hits = credentialFiles.flatMap(file => tokenPatterns.flatMap(pattern => [...readFileSync(join(output, file), 'utf8').matchAll(pattern)].map(() => file)));
writeFileSync(join(output, 'credential-scan.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex', scannedFiles: credentialFiles.length, hits: hits.length, paths: [...new Set(hits)] }, null, 2) + '\n');
const manifest = files().filter(file => file !== 'SHA256SUMS').sort().map(file => `${createHash('sha256').update(readFileSync(join(output, file))).digest('hex')}  ${file.replaceAll('\\', '/')}`).join('\n');
writeFileSync(join(output, 'SHA256SUMS'), manifest + '\n');
console.log(JSON.stringify({ verdict: report.verdict, tests: report.tests, types: report.types, ownedResidualPids: owned.ownedResidualPids, credentialHits: hits.length }));
if (report.verdict !== 'pass-scoped-acquisition' || hits.length > 0) process.exitCode = 1;
