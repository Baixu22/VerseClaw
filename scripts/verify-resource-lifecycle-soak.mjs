#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyLifecycleReport } from './lib/resource-lifecycle-report.mjs';
import { resolveMixedToolchain, pinnedMixedEnvironment } from './lib/resource-mixed-measurement.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { candidate: { type: 'string' }, artifacts: { type: 'string' }, output: { type: 'string' } } });
assert(values.candidate && values.artifacts && values.output, '--candidate, --artifacts and --output are required');
const candidateRoot = resolve(values.candidate), out = resolve(values.output); mkdirSync(out, { recursive: true });
const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const write = (name, value) => { const target = join(out, name), temp = target + '.' + randomUUID() + '.tmp'; writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); renameSync(temp, target); };
const git = (cwd, ...args) => { const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const artifacts = json(values.artifacts);
const candidate = { commit: git(candidateRoot, 'rev-parse', 'HEAD'), tree: git(candidateRoot, 'rev-parse', 'HEAD^{tree}') };
assert.equal(git(root, 'status', '--porcelain'), ''); assert.equal(git(candidateRoot, 'status', '--porcelain'), '');
assert.equal(git(root, 'rev-parse', 'HEAD'), candidate.commit, 'Driver and candidate must be the same commit');
const productPaths = ['electron', 'src', 'shared', 'openclaw_runtime', 'packages', 'resources', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vite.config.ts', 'scripts/build-openclaw-runtime.mjs', 'scripts/generate-ext-bridge.mjs', 'scripts/versebrowser-build-provenance.mjs'];
assert.equal(git(root, 'diff', '--name-only', artifacts.products.after.source, candidate.commit, '--', ...productPaths), '', 'Product source differs from build');
const driverFiles = ['scripts/verify-resource-lifecycle-soak.mjs', 'scripts/lib/resource-lifecycle-report.mjs', 'scripts/lib/resource-mixed-measurement.mjs', 'tests/e2e/resource-lifecycle-soak.spec.ts', 'tests/e2e/fixtures/electron.ts', 'tests/e2e/fixtures/electron-process-cleanup.ts', 'tests/e2e/fixtures/windows-process.ts', 'playwright.resource-lifecycle.config.ts', 'openclaw_runtime/src/process/process-tree-sampler.ts'];
const identity = { candidate, build: artifacts.products.after, executables: artifacts.executables, driverFiles: driverFiles.map(path => ({ path, sha256: sha(join(root, path)) })) };
const verifyBuild = () => {
  assert(identity.build.files.length > 0, 'Empty build artifact inventory');
  const paths = identity.build.files.map(file => file.path);
  const enumerate = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? enumerate(join(directory, entry.name)) : entry.isFile() ? [relative(candidateRoot, join(directory, entry.name)).replaceAll('\\', '/')] : []);
  const actual = ['dist', 'dist-electron', 'openclaw_runtime/dist', 'packages/versebrowser/dist'].flatMap(path => enumerate(join(candidateRoot, path)));
  assert.deepEqual([...paths].sort(), actual.sort(), 'Build inventory does not cover all actual outputs');
  for (const required of ['dist/index.html', 'dist-electron/main/index.js', 'dist-electron/preload/index.js', 'openclaw_runtime/dist/entry.js']) assert(paths.includes(required), 'Missing launched artifact: ' + required);
  assert(paths.some(path => path.startsWith('dist/assets/')) && paths.some(path => path.startsWith('packages/versebrowser/dist/')), 'Incomplete renderer/browser inventory');
  for (const file of identity.build.files) assert.equal(sha(join(candidateRoot, file.path)), file.sha256, file.path);
  assert.deepEqual(resolveMixedToolchain(), identity.executables.map(({ role, path }) => ({ role, path })));
  for (const file of identity.executables) assert.equal(sha(file.path), file.sha256, file.path);
};
verifyBuild();
if (existsSync(join(out, 'manifest.json'))) assert.deepEqual(json(join(out, 'manifest.json')), identity, 'Run identity changed'); else write('manifest.json', identity);
const attempts = existsSync(join(out, 'attempts.json')) ? json(join(out, 'attempts.json')) : [];
const directory = join(out, `attempt-${attempts.length + 1}-${randomUUID()}`); mkdirSync(directory); mkdirSync(join(directory, 'electron'));
const attempt = { directory, startedAt: Date.now(), status: 'running', exitCode: null, verified: false }; attempts.push(attempt); write('attempts.json', attempts);
const env = { ...process.env, ...pinnedMixedEnvironment(identity.executables), RESOURCE_SOAK_SMOKE: '0', RESOURCE_SOAK_SOURCE: candidate.commit,
  TEMP: 'D:/tmp', TMP: 'D:/tmp', CLAWX_E2E_KEEP_TEMP: '1', CLAWX_E2E_APP_LOGS: '1', CLAWX_E2E_RUN_ROOT: join(directory, 'electron'), PLAYWRIGHT_JSON_OUTPUT_NAME: join(directory, 'playwright.json') };
const args = [join(root, 'node_modules/@playwright/test/cli.js'), 'test', '--config', join(root, 'playwright.resource-lifecycle.config.ts'), '--output', join(directory, 'results')];
attempt.argv = [process.execPath, ...args]; attempt.cwd = candidateRoot; write('attempts.json', attempts);
console.log('START lifecycle ' + directory);
const log = openSync(join(directory, 'command.log'), 'wx');
let result;
try { result = spawnSync(process.execPath, args, { cwd: candidateRoot, env, windowsHide: true, stdio: ['ignore', log, log], timeout: 4_800_000 }); }
finally { closeSync(log); }
Object.assign(attempt, { status: 'completed', endedAt: Date.now(), exitCode: result.status, error: result.error?.message });
try {
  const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
  const reports = files(directory).filter(path => path.endsWith('lifecycle.json')); assert.equal(reports.length, 1);
  attempt.report = reports[0]; attempt.reportSha256 = sha(reports[0]);
  assert.equal(result.status, 0, 'Native lifecycle test failed; preserved log identifies the failure');
  const raw = json(reports[0]); assert.equal(raw.candidate, candidate.commit);
  const verification = verifyLifecycleReport(raw);
  verifyBuild(); for (const file of identity.driverFiles) assert.equal(sha(join(root, file.path)), file.sha256);
  assert.equal(git(root, 'rev-parse', 'HEAD'), candidate.commit); assert.equal(git(candidateRoot, 'status', '--porcelain'), '');
  attempt.verified = true;
  write('report.json', { driven_by: 'agent', actor: 'codex', verdict: 'pass-lifecycle-receipts', identity, verification, raw: { path: reports[0], sha256: attempt.reportSha256 }, attempts });
  console.log(JSON.stringify({ verified: true, repeated: verification.repeatCycles, soakProbes: verification.soakProbes, ownedExits: verification.ownedExits }));
} catch (error) { attempt.verificationError = String(error); throw error; }
finally { write('attempts.json', attempts); }
