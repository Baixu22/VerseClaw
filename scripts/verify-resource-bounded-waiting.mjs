#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, 'openclaw_runtime');
const base = 'e6155185dbfc488080ee432f37e20929080a8b27';
const spec = 'harness/specs/tasks/resource-bounded-waiting-20261107.md';
const { values } = parseArgs({ options: { output: { type: 'string' }, 'baseline-types': { type: 'string' }, negative: { type: 'string' } } });
if (!values.output || !values['baseline-types'] || !values.negative) throw new Error('--output, --baseline-types and --negative are required');
const output = resolve(values.output);
mkdirSync(output, { recursive: true });
const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''));
const write = (name, data) => writeFileSync(join(output, name), JSON.stringify(data, null, 2) + '\n');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
function git(...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr || 'git failed');
  return r.stdout.trim();
}
const candidate = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: Boolean(git('status', '--porcelain')) };
if (candidate.dirty) throw new Error('Freeze a clean candidate before acceptance');
const deps = createRequire(join(root, 'package.json'));
const runtimeDeps = createRequire(join(runtime, 'package.json'));
const entry = (r, name, file) => join(dirname(r.resolve(`${name}/package.json`)), file);
const vitest = entry(deps, 'vitest', 'vitest.mjs');
const runtimeVitest = entry(runtimeDeps, 'vitest', 'vitest.mjs');
const tsgo = entry(runtimeDeps, '@typescript/native-preview', 'bin/tsgo.js');
const eslint = entry(deps, 'eslint', 'bin/eslint.js');
const env = { ...process.env, TEMP: 'D:\\tmp', TMP: 'D:\\tmp', GOMEMLIMIT: '1GiB', GOMAXPROCS: '2', RESOURCE_WAITING_REPORT_DIR: output, COMMS_OUTPUT_DIR: join(output, 'comms') };
const commands = [];
function run(id, args, cwd = root, required = true, executable = process.execPath) {
  const start = Date.now();
  const r = spawnSync(executable, args, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(output, `${id}.log`), (r.stdout ?? '') + (r.stderr ?? '') + (r.error?.message ?? ''));
  commands.push({ id, argv: [executable, ...args], cwd, exitCode: r.status, durationMs: Date.now() - start, required,
    environment: { TEMP: env.TEMP, TMP: env.TMP, GOMEMLIMIT: env.GOMEMLIMIT, GOMAXPROCS: env.GOMAXPROCS } });
}
run('harness-context', ['harness/src/cli.mjs', 'context', '--spec', spec]);
run('harness-validate', ['harness/src/cli.mjs', 'validate', '--spec', spec]);
run('harness-dry-run', ['harness/src/cli.mjs', 'run', '--spec', spec, '--dry-run']);
const mainTests = [
  'resource-fabric-bounded-waiting', 'resource-fabric-chat-history', 'resource-fabric-workspace-exec',
  'resource-fabric-primitives', 'resource-fabric-invariants', 'resource-fabric-pressure', 'terminal-api', 'git-api',
].map(name => `tests/unit/${name}.test.ts`);
run('main-tests', [vitest, 'run', ...mainTests, '--maxWorkers=1', '--reporter=json', `--outputFile=${join(output, 'main-tests.json')}`]);
run('runtime-tests', [runtimeVitest, 'run', '--config', 'test/vitest/vitest.resource-waiting.config.ts', '--maxWorkers=1', '--reporter=json', `--outputFile=${join(output, 'runtime-tests.json')}`], runtime);
run('focused-types', [tsgo, '--noEmit', '-p', 'harness/specs/fixtures/resource-bounded-waiting-20261107/focused-tsconfig.json']);
run('runtime-types', [tsgo, '--noEmit', '-p', 'tsconfig.json', '--composite', 'false'], runtime, false);
const changed = git('diff', '--name-only', base, 'HEAD').split(/\r?\n/u).filter(Boolean);
run('lint', [eslint, ...changed.filter(path => /\.(?:ts|mjs)$/u.test(path)), '--format', 'json', '--output-file', join(output, 'lint.json')]);
run('comms-replay', ['scripts/comms/replay.mjs']);
run('comms-compare', ['scripts/comms/compare.mjs']);
run('artifact-retention', ['scripts/check-repository-artifacts.mjs']);
run('diff-check', ['diff', '--check', base, 'HEAD'], root, true, 'git');
const extract = text => text.split(/\r?\n/u).filter(line => line.includes('error TS'));
const baseline = readFileSync(values['baseline-types'], 'utf8').replace(/^\uFEFF/u, '');
writeFileSync(join(output, 'baseline-runtime-types.log'), baseline);
const current = readFileSync(join(output, 'runtime-types.log'), 'utf8');
const normalize = line => line.replace(/\(\d+,\d+\)/gu, '');
const remaining = extract(baseline).map(normalize);
const introduced = extract(current).map(normalize).filter(line => {
  const at = remaining.indexOf(line);
  if (at < 0) return true;
  remaining.splice(at, 1); return false;
});
const testSummary = name => {
  const r = json(join(output, `${name}.json`));
  return { total: r.numTotalTests, passed: r.numPassedTests, failed: r.numFailedTests, skipped: r.numPendingTests,
    suitesFailed: r.numFailedTestSuites, success: r.success,
    cases: r.testResults.flatMap(t => t.assertionResults.map(a => ({ name: a.fullName, status: a.status }))) };
};
const tests = { main: testSummary('main-tests'), runtime: testSummary('runtime-tests') };
const negative = json(values.negative);
const negativeControls = { baselineCommit: base, exitCode: Number(readFileSync(values.negative.replace(/\.json$/u, '.exit'), 'utf8').trim()),
  command: [process.execPath, vitest, 'run', mainTests[0], '-t', 'regression: old Fabric', '--maxWorkers=1', '--reporter=json', `--outputFile=${values.negative}`],
  passed: negative.numPassedTests, failed: negative.numFailedTests,
  cases: negative.testResults.flatMap(t => t.assertionResults.filter(a => a.status === 'failed').map(a => ({ name: a.fullName, failure: a.failureMessages[0].split('\n    at ')[0] }))),
  raw: { path: resolve(values.negative), sha256: hash(values.negative) } };
write('negative-controls.json', negativeControls);
const pressures = ['fabric', 'runtime'].map(kind => ({ kind, ...json(join(output, `pressure-${kind}.json`)) }));
const pressurePass = pressures.every(p => p.requests === 200 && p.counts.success === 42 && p.counts.rejected === 134 && p.counts.cancelled === 8 && p.counts.timeout === 16 && p.counts.unexpected === 0
  && new Set(p.outcomes.map(o => o.id)).size === 200 && p.peak.active === 2 && p.peak.queued === 64 && Object.values(p.final).every(n => n === 0));
const sourceHashes = changed.map(path => ({ path, sha256: hash(join(root, path)) }));
const cleanAfter = !git('status', '--porcelain');
const runtimeExit = commands.find(c => c.id === 'runtime-types').exitCode;
const verdict = commands.every(c => !c.required || c.exitCode === 0) && Object.values(tests).every(t => t.success && t.failed === 0 && t.suitesFailed === 0)
  && pressurePass && negativeControls.failed === 3 && negativeControls.exitCode === 1 && introduced.length === 0 && extract(baseline).length > 0
  && (runtimeExit === 0 || (runtimeExit === 2 && extract(current).length > 0)) && cleanAfter
  ? 'pass-bounded-waiting' : 'fail';
write('report.json', { schema: 'clawx.resource-bounded-waiting/v1', generatedAt: new Date().toISOString(), driven_by: 'agent', actor: 'codex', task: 'TF-0829', candidate, cleanAfter,
  spec, tests, pressures: pressures.map(({ kind, requests, counts, peak, final }) => ({ kind, requests, counts, peak, final })),
  negativeControls: { failed: negativeControls.failed, baselineCommit: base },
  types: { focused: commands.find(c => c.id === 'focused-types').exitCode === 0, runtimeFullPass: runtimeExit === 0,
    baselineCommit: base, baselineDiagnostics: extract(baseline).length, candidateDiagnostics: extract(current).length, introduced },
  dependencies: { mode: 'reuse-installed-junctions', root: realpathSync(join(root, 'node_modules')), runtime: realpathSync(join(runtime, 'node_modules')), vitest, runtimeVitest, tsgo, eslint, node: process.version },
  sourceHashes, commands, verdict });
const files = () => readdirSync(output, { recursive: true }).filter(p => statSync(join(output, p)).isFile());
const patterns = [/\bsk-[A-Za-z0-9_-]{20,}\b/gu, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/gu, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu];
const scanned = files().filter(p => /\.(?:json|log|md)$/u.test(p));
const hits = scanned.flatMap(p => patterns.flatMap(re => [...readFileSync(join(output, p), 'utf8').matchAll(re)].map(() => p)));
write('credential-scan.json', { driven_by: 'agent', actor: 'codex', scannedFiles: scanned.length, hits: hits.length, paths: [...new Set(hits)] });
writeFileSync(join(output, 'SHA256SUMS'), files().filter(p => p !== 'SHA256SUMS').sort().map(p => `${hash(join(output, p))}  ${p.replaceAll('\\', '/')}`).join('\n') + '\n');
console.log(JSON.stringify({ verdict, tests: Object.fromEntries(Object.entries(tests).map(([k,t]) => [k, { passed: t.passed, failed: t.failed, skipped: t.skipped }])), pressurePass, introduced, credentialHits: hits.length }));
if (verdict !== 'pass-bounded-waiting' || hits.length) process.exitCode = 1;
