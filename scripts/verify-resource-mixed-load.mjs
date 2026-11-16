#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, renameSync } from 'node:fs';
import { cpus, freemem, totalmem, platform, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compareMixedRuns, summarizeMixedRun, resolveMixedToolchain, pinnedMixedEnvironment } from './lib/resource-mixed-measurement.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { before: { type: 'string' }, after: { type: 'string' }, output: { type: 'string' }, builds: { type: 'string' }, artifacts: { type: 'string' } } });
assert(values.before && values.after && values.output && values.builds && values.artifacts, '--before, --after, --output, --builds and --artifacts are required');
const roots = { before: resolve(values.before), after: resolve(values.after) };
const out = resolve(values.output); mkdirSync(out, { recursive: true });
const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''));
const write = (name, value) => { const target = join(out, name), temp = target + '.' + randomUUID() + '.tmp'; writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); renameSync(temp, target); };
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const git = (cwd, ...args) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
};
const fixturePath = join(root, 'harness/specs/fixtures/resource-mixed-load-20261108/workload.json');
const fixture = json(fixturePath);
const driverFiles = ['tests/e2e/resource-mixed-load.spec.ts', 'tests/e2e/fixtures/electron.ts', 'tests/e2e/fixtures/electron-process-cleanup.ts', 'tests/e2e/fixtures/windows-process.ts', 'openclaw_runtime/src/process/process-tree-sampler.ts', 'shared/types/resources.ts', 'playwright.resource-governance.config.ts', 'scripts/verify-resource-mixed-load.mjs', 'scripts/lib/resource-mixed-measurement.mjs'];
assert.equal(git(root, 'status', '--porcelain'), '', 'Freeze the driver source first');
const builds = json(values.builds);
const artifacts = json(values.artifacts);
const verifyArtifacts = variant => {
  const expected = artifacts.products[variant]; assert(expected?.files.length > 0, 'Missing build artifact manifest');
  assert.deepEqual(resolveMixedToolchain(), artifacts.executables.map(({ role, path }) => ({ role, path })), 'Active execution toolchain changed');
  for (const file of expected.files) assert.equal(sha(join(roots[variant], file.path)), file.sha256, 'Build artifact changed: ' + file.path);
  for (const file of artifacts.executables) assert.equal(sha(file.path), file.sha256, 'Execution dependency changed: ' + file.path);
};
const productPaths = ['electron', 'src', 'shared', 'openclaw_runtime', 'packages', 'resources', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vite.config.ts', 'scripts/build-openclaw-runtime.mjs', 'scripts/generate-ext-bridge.mjs', 'scripts/versebrowser-build-provenance.mjs'];
const products = Object.fromEntries(Object.entries(roots).map(([variant, cwd]) => {
  assert.equal(git(cwd, 'status', '--porcelain'), '', 'Product checkout is dirty');
  const steps = builds.filter(step => step.variant === (variant === 'before' ? 'baseline' : 'candidate'));
  assert.equal(steps.length, 7); assert(steps.every(step => step.exitCode === 0));
  const commit = git(cwd, 'rev-parse', 'HEAD');
  const buildSource = steps[0].commit;
  assert.equal(artifacts.products[variant].source, buildSource); verifyArtifacts(variant);
  assert.equal(git(cwd, 'diff', '--name-only', buildSource, commit, '--', ...productPaths), '', 'Built product differs from source');
  return [variant, { path: cwd, commit, tree: git(cwd, 'rev-parse', 'HEAD^{tree}'), buildSource, productDiff: [], buildSteps: steps, buildArtifacts: artifacts.products[variant] }];
}));
const identity = { driver: { commit: git(root, 'rev-parse', 'HEAD'), tree: git(root, 'rev-parse', 'HEAD^{tree}'), files: driverFiles.map(path => ({ path, sha256: sha(join(root, path)) })) }, fixture: { path: fixturePath, sha256: sha(fixturePath), value: fixture }, products, executables: artifacts.executables };
const manifest = join(out, 'manifest.json');
if (existsSync(manifest)) assert.deepEqual(json(manifest), identity, 'Existing run uses another driver or candidate');
else write('manifest.json', identity);
const machineSnapshot = `machine-${randomUUID()}.json`;
write(machineSnapshot, { driven_by: 'agent', actor: 'codex', capturedAt: new Date().toISOString(), platform: platform(), release: release(), node: process.version, cpuModel: cpus()[0]?.model, logicalCpus: cpus().length, physicalMemoryBytes: totalmem(), freeMemoryAtStartBytes: freemem(), dependencies: 'Reused installed dependency views for both builds; no fresh-install claim.' });
const attemptsPath = join(out, 'attempts.json');
const attempts = existsSync(attemptsPath) ? json(attemptsPath) : [];
const filesBelow = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesBelow(join(directory, entry.name)) : [join(directory, entry.name)]);
const rows = [];
for (const windows of fixture.windows) for (const workers of fixture.workers) for (const [position, variant] of fixture.order.entries()) {
  const id = `w${windows}-a${workers}-${position}-${variant}`;
  const existing = attempts.filter(attempt => attempt.id === id);
  const passed = existing.findLast(attempt => attempt.exitCode === 0 && attempt.verified);
  if (passed) {
    assert.equal(sha(passed.measurement), passed.measurementSha256);
    rows.push(json(passed.measurement)); continue;
  }
  verifyArtifacts(variant);
  const parent = join(out, id); mkdirSync(parent, { recursive: true });
  const directory = join(parent, `attempt-${existing.length + 1}-${randomUUID()}`); mkdirSync(directory); mkdirSync(join(directory, 'electron'));
  const args = [join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', join(root, 'playwright.resource-governance.config.ts'), '--output', join(directory, 'results')];
  const env = { ...process.env, ...pinnedMixedEnvironment(artifacts.executables), TEMP: 'D:/tmp', TMP: 'D:/tmp', CLAWX_E2E_KEEP_TEMP: '1', CLAWX_E2E_APP_LOGS: '1', CLAWX_E2E_RUN_ROOT: join(directory, 'electron'), PLAYWRIGHT_JSON_OUTPUT_NAME: join(directory, 'playwright.json'),
    RESOURCE_MIXED_WORKERS: String(workers), RESOURCE_MIXED_WINDOWS: String(windows), RESOURCE_MIXED_VARIANT: variant, RESOURCE_MIXED_SOURCE: products[variant].commit };
  console.log('START ' + id); const startedAt = Date.now();
  const attempt = { id, variant, workers, windows, position, argv: [process.execPath, ...args], cwd: roots[variant], startedAt, machineSnapshot, exitCode: null, status: 'running', verified: false, directory };
  attempts.push(attempt); write('attempts.json', attempts);
  const result = spawnSync(process.execPath, args, { cwd: roots[variant], env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  writeFileSync(join(directory, 'command.log'), (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''));
  Object.assign(attempt, { durationMs: Date.now() - startedAt, exitCode: result.status, status: 'completed' });
  try {
    const measurements = filesBelow(directory).filter(path => path.endsWith('measurement.json'));
    assert.equal(measurements.length, 1, 'Expected one native measurement');
    attempt.measurement = measurements[0]; attempt.measurementSha256 = sha(measurements[0]);
    const measurement = json(measurements[0]);
    assert.equal(result.status, 0, 'Native trial failed; inspect preserved command log');
    assert.equal(measurement.fixtureSha256, identity.fixture.sha256);
    assert.equal(measurement.sourceCommit, products[variant].commit);
    attempt.summary = summarizeMixedRun(measurement, fixture); attempt.verified = true;
    rows.push(measurement);
  } catch (error) { attempt.verificationError = String(error); throw error; }
  finally { write('attempts.json', attempts); console.log(`END ${id} exit=${result.status} verified=${attempt.verified}`); }
}
for (const file of identity.driver.files) assert.equal(sha(join(root, file.path)), file.sha256);
for (const [variant, cwd] of Object.entries(roots)) { verifyArtifacts(variant); assert.equal(git(cwd, 'rev-parse', 'HEAD'), products[variant].commit); assert.equal(git(cwd, 'status', '--porcelain'), ''); }
const comparisons = compareMixedRuns(rows, fixture);
write('report.json', { driven_by: 'agent', actor: 'codex', verdict: 'pass-mixed-work-measurement', identity, trials: rows.length, tasks: rows.length * fixture.tasks, attempts: attempts.map(({ id, directory, exitCode, verified }) => ({ id, directory, exitCode, verified })), comparisons,
  decision: 'Keep the existing defaults. Select workload-specific operating points from throughput and tail latency together; scripted workers and local waits characterize this fixture.' });
console.log(JSON.stringify({ trials: rows.length, tasks: rows.length * fixture.tasks, verdict: 'pass-mixed-work-measurement' }));
