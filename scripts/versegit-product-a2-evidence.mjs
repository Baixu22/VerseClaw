#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname, platform, release, arch } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

export const A2_ROOT = 'harness/specs/fixtures/versegit-product-integration/a2';
export const A2_BUILD_PATH = `${A2_ROOT}/build-identity.json`;
export const A2_STARTUP_PATH = `${A2_ROOT}/electron-startup.json`;
export const A2_SMOKE_PATH = `${A2_ROOT}/smoke-results.json`;
export const A2_CLEANUP_PATH = `${A2_ROOT}/cleanup.json`;
export const A2_NEGATIVE_PATH = `${A2_ROOT}/negative-checks.json`;
export const A2_INDEPENDENT_PATH = `${A2_ROOT}/independent-review.json`;
export const A2_SUMS_PATH = `${A2_ROOT}/SHA256SUMS`;
export const A2_SCHEMA = 'clawx.versegit.product-a2-evidence/v1';
export const A2_EVIDENCE_PATHS = [A2_BUILD_PATH, A2_STARTUP_PATH, A2_SMOKE_PATH, A2_CLEANUP_PATH, A2_NEGATIVE_PATH, A2_INDEPENDENT_PATH];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const priorEpermPath = 'D:/tmp/clawx-vg-relay-20261022/startup-write-probe.json';

function normalize(path) { return path.replaceAll('\\', '/'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function documentDigest(document) { return sha256(JSON.stringify(stable({ ...document, generated_at: undefined, digest: undefined }))); }
function fileInfo(root, path) {
  const full = resolve(root, path); const rel = normalize(relative(root, full));
  if (!rel || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`path escapes root: ${path}`);
  if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`missing file: ${path}`);
  const bytes = readFileSync(full);
  return { path: rel, sha256: sha256(bytes), bytes: bytes.byteLength, mtime: statSync(full).mtime.toISOString() };
}
function rawFileInfo(path) { const bytes = readFileSync(path); return { sha256: sha256(bytes), bytes: bytes.byteLength }; }
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(root, path, document) { const full = resolve(root, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, `${JSON.stringify(document, null, 2)}\n`, 'utf8'); }
function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }); }
function repoIdentity(root) {
  const dirty = git(root, ['status', '--porcelain=v1', '--untracked-files=normal']).trim();
  return { role: 'worktree-root', branch: git(root, ['branch', '--show-current']).trim() || 'detached', commit: git(root, ['rev-parse', 'HEAD']).trim(), tree: git(root, ['rev-parse', 'HEAD^{tree}']).trim(), dirty: dirty.length > 0, dirtyEntryCount: dirty ? dirty.split(/\r?\n/u).filter(Boolean).length : 0 };
}
function sign(document) { document.digest = documentDigest(document); return document; }
function add(issues, condition, message) { if (!condition) issues.push(message); }
export function findAbsolutePathLeaks(value) {
  const leaks = [];
  const visit = (current, path) => {
    if (typeof current === 'string' && /(?:^|[^A-Za-z])[A-Za-z]:[\\/]|^\/(?:Users|home)\/|^\\\\/u.test(current)) leaks.push(path);
    else if (Array.isArray(current)) current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    else if (current && typeof current === 'object') Object.entries(current).forEach(([key, entry]) => visit(entry, path ? `${path}.${key}` : key));
  };
  visit(value, ''); return leaks;
}
function readProof(path, expectedCommand, readyPattern) {
  const proof = readJson(path);
  if (proof.exit_code !== 0) throw new Error(`${expectedCommand} proof is not exit 0`);
  if (proof.command !== expectedCommand) throw new Error(`${expectedCommand} proof command mismatch`);
  const logBullet = readFileSync(proof.log_path);
  if (!readyPattern.test(logBullet.toString('utf8'))) throw new Error(`${expectedCommand} proof log is missing readiness marker`);
  return { command: expectedCommand, exit_code: 0, started_at: proof.started_at, ended_at: proof.ended_at, duration_ms: proof.duration_ms, log: { role: 'D-scratch', sha256: sha256(logBullet), bytes: logBullet.byteLength }, readiness_marker: readyPattern.source };
}
export function buildBuildIdentity(root, { runtimeProof, viteProof, contractProof } = {}) {
  const source = repoIdentity(root); if (source.dirty) throw new Error('A2 build identity requires a clean candidate');
  const electronPackage = readJson(resolve(root, 'node_modules/electron/package.json'));
  const electronBinary = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("electron"))'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const runtimeArtifacts = ['openclaw_runtime/dist/entry.js', 'openclaw_runtime/dist/knowledge/sekb/index.js', 'openclaw_runtime/dist/extensions/deepseek/provider-policy-api.js', 'openclaw_runtime/dist-runtime/extensions/deepseek/provider-policy-api.js'].map((path) => ({ role: 'runtime', ...fileInfo(root, path) }));
  const uiArtifacts = ['dist/index.html', 'dist-electron/main/index.js', 'dist-electron/preload/index.js'].map((path) => ({ role: 'ui', ...fileInfo(root, path) }));
  return sign({
    schema: A2_SCHEMA, kind: 'build-identity', generated_at: new Date().toISOString(), task: 'TF-0525', driven_by: 'agent', actor: 'codex', source,
    run_identity: { host: { platform: platform(), release: release(), arch: arch(), hostname: hostname() }, node: process.version, package_manager: electronPackage.packageManager ?? 'pnpm', temp_role: 'D-scratch' },
    provenance: { runtime: 'source-build-in-this-task', ui: 'source-build-in-this-task', existing_build_reused: false, diagnostic_only: false },
    commands: [readProof(runtimeProof, 'pnpm run build:runtime', /\[runtime-build-smoke\] gateway ready/u), readProof(viteProof, 'pnpm run build:vite', /built in/u), readProof(contractProof, 'pnpm contract:check', /Contract check passed/u)],
    electron: { role: 'electron-package-binary', package_version: electronPackage.version, binary_sha256: sha256(readFileSync(electronBinary)), binary_bytes: statSync(electronBinary).size },
    artifacts: [...runtimeArtifacts, ...uiArtifacts],
    boundaries: { default_on: false, ga: false, live_ready: false, product_approved: false, m4_authorized: false, real_human_evidence: false },
    limitations: ['Only Windows x64 source-build outputs on this host are measured.', 'The provider debug sidecar is not promoted by this build baseline.'],
  });
}

function runElectronProbe(root, label, userDataRoot) {
  const probeRoot = join(root, '.local', 'a2-probes', label);
  const resultDir = join(root, '.local', 'a2-probes', 'results');
  mkdirSync(probeRoot, { recursive: true }); mkdirSync(resultDir, { recursive: true });
  const probeScript = join(probeRoot, 'probe-main.cjs'); const resultPath = join(resultDir, `${label}.json`);
  writeFileSync(probeScript, `const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.whenReady().then(async () => {
  const result = { ready: app.isReady(), userDataRole: '${label}-user-data', write: null, window: null };
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const file = path.join(app.getPath('userData'), 'write-probe.txt');
    fs.writeFileSync(file, 'ok');
    result.write = { ok: true, content: fs.readFileSync(file, 'utf8') };
  } catch (error) { result.write = { ok: false, code: error.code, message: error.message }; }
  try {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadURL('data:text/html,<html><body id="ok">probe</body></html>');
    result.window = { ok: true, text: await win.webContents.executeJavaScript('document.getElementById("ok").textContent') };
    win.destroy();
  } catch (error) { result.window = { ok: false, code: error.code, message: error.message }; }
  fs.writeFileSync(process.env.PROBE_RESULT, JSON.stringify(result, null, 2));
  app.quit();
});
`, 'utf8');
  const electron = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("electron"))'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const result = spawnSync(electron, ['--no-sandbox', `--user-data-dir=${resolve(userDataRoot)}`, '--disable-gpu', probeScript], { cwd: root, stdio: 'ignore', windowsHide: true, timeout: 30000, env: { ...process.env, PROBE_RESULT: resultPath } });
  if (!existsSync(resultPath)) throw new Error(`${label} Electron probe did not produce a result`);
  const observed = readJson(resultPath);
  const evidence = { label, kind: 'diagnostic-probe', current_source: true, source_build: false, exit_code: result.status, write: observed.write, window: observed.window, raw_result_sha256: rawFileInfo(resultPath).sha256 };
  rmSync(probeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  return evidence;
}
function sanitizeMessage(value) { return String(value).replace(/[A-Za-z]:[\\/][^'"]*/gu, '<machine-path>').slice(0, 500); }
function priorEpermEvidence() {
  if (!existsSync(priorEpermPath)) return { status: 'unavailable', current_source: false, reason: 'prior diagnostic artifact not present' };
  const report = readJson(priorEpermPath); const snapshot = (report.snapshots ?? []).find((entry) => entry?.userDataWrite?.code === 'EPERM');
  if (!snapshot) return { status: 'not-observed', current_source: false, raw_artifact_sha256: rawFileInfo(priorEpermPath).sha256 };
  return { status: 'observed', current_source: false, source_head: report.head, userDataWrite: { ok: false, code: sanitizeMessage(snapshot.userDataWrite.code), message: sanitizeMessage(snapshot.userDataWrite.message) }, raw_artifact_sha256: rawFileInfo(priorEpermPath).sha256 };
}
function flattenSpecs(suites, output = []) { for (const suite of suites ?? []) { if (suite.specs) output.push(...suite.specs); flattenSpecs(suite.suites, output); } return output; }
export function parseSmokeResults(path) {
  const results = readJson(path); const specs = flattenSpecs(results.suites);
  return sign({ schema: A2_SCHEMA, kind: 'smoke-results', generated_at: new Date().toISOString(), task: 'TF-0525', driven_by: 'agent', actor: 'playwright-runner', command: 'pnpm exec playwright test tests/e2e/app-smoke.spec.ts', reporter: 'json', cwd_role: 'worktree-root', raw_results_sha256: rawFileInfo(path).sha256, stats: results.stats, tests: specs.map((spec) => ({ title: spec.title, ok: spec.ok, status: spec.tests?.[0]?.results?.[0]?.status ?? 'unknown', duration_ms: spec.tests?.[0]?.results?.[0]?.duration ?? null })), errors: results.errors ?? [], entered_test_body: specs.length > 0 && specs.every((spec) => (spec.tests?.[0]?.results?.length ?? 0) > 0) });
}
function countFailureArtifacts(root) { const dir = join(root, 'test-results'); return existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((entry) => /trace|video|screenshot/u.test(String(entry))).length : 0; }
export function buildElectronStartup(root, smoke, electronBinarySha) {
  const ordinary = runElectronProbe(root, 'ordinary-temp', 'D:\\tmp\\versegit-a2-current-ordinary');
  const writable = runElectronProbe(root, 'ignored-worktree-root', join(root, '.local', 'a2-probes', 'writable-user-data'));
  const historical = priorEpermEvidence();
  return sign({ schema: A2_SCHEMA, kind: 'electron-startup', generated_at: new Date().toISOString(), task: 'TF-0525', driven_by: 'agent', actor: 'codex', electron_binary_sha256: electronBinarySha, diagnostics: { ordinary_temp: ordinary, writable_isolated_root: writable, historical_eperm: historical }, actual_app_smoke: { reporter: 'playwright', tests: smoke.tests.length, expected: smoke.stats?.expected ?? null, failed: smoke.stats?.unexpected ?? null, entered_test_body: smoke.entered_test_body, first_window_covered: smoke.tests.some((test) => /setup wizard|relaunch/u.test(test.title)), host_invoke_covered: smoke.tests.some((test) => /typed host bridge/u.test(test.title)) }, distinction: { source_build: 'build-identity.json', existing_build_reused: false, formal_test: 'smoke-results.json', diagnostic_probe: 'minimal Electron write/window probes only' }, retention: { user_data_role: 'ignored worktree .local for formal E2E; D-scratch for ordinary probe', trace_policy: 'Playwright retain-on-failure', failure_trace_count: countFailureArtifacts(root), curated_evidence: 'JSON summaries only' }, boundaries: { real_human_evidence: false, m4_authorized: false } });
}
export function buildCleanup(root) {
  const run = readJson(join(root, 'test-results/electron-process-run.json')); const report = readJson(join(root, 'test-results/electron-process-cleanup.json'));
  const pidChecks = (report.reaped ?? []).map((entry) => { let alive = false; try { process.kill(entry.pid, 0); alive = true; } catch {} return { pid: entry.pid, alive_after: alive }; });
  return sign({ schema: A2_SCHEMA, kind: 'cleanup', generated_at: new Date().toISOString(), task: 'TF-0525', driven_by: 'agent', actor: 'codex', raw_run_report_sha256: rawFileInfo(join(root, 'test-results/electron-process-run.json')).sha256, raw_cleanup_report_sha256: rawFileInfo(join(root, 'test-results/electron-process-cleanup.json')).sha256, run_root_role: normalize(relative(root, run.runRoot)) || 'worktree-root', ledger_entries: report.ledgerEntries, pid_checks: pidChecks, survivors: report.survivors ?? [], sweep: { status: report.sweep?.status, owned: report.sweep?.owned?.length ?? 0, remaining: report.sweep?.remaining?.length ?? 0 }, source_modified_by_cleanup: git(root, ['status', '--porcelain=v1', '--untracked-files=no']).trim().length > 0, user_data_retention: 'ignored .local run root is not promoted to Git; curated cleanup summary is retained' });
}

export function validateBuildIdentity(document, { root = repositoryRoot } = {}) {
  const issues = [];
  add(issues, document?.schema === A2_SCHEMA && document?.kind === 'build-identity', 'build identity schema mismatch');
  add(issues, document?.task === 'TF-0525' && document?.driven_by === 'agent' && document.actor === 'codex', 'build identity actor mismatch');
  add(issues, document?.source?.dirty === false && /^[0-9a-f]{40}$/u.test(String(document?.source?.commit)), 'build candidate is not clean and identified');
  add(issues, document?.provenance?.runtime === 'source-build-in-this-task' && document?.provenance?.ui === 'source-build-in-this-task' && document?.provenance?.existing_build_reused === false, 'build provenance mismatch');
  add(issues, Array.isArray(document?.commands) && document.commands.length === 3 && document.commands.every((entry) => entry.exit_code === 0), 'build commands did not pass');
  add(issues, (document?.artifacts ?? []).filter((entry) => entry.role === 'runtime').length === 4 && (document?.artifacts ?? []).filter((entry) => entry.role === 'ui').length === 3, 'build artifact set incomplete');
  for (const artifact of document?.artifacts ?? []) { try { const actual = fileInfo(root, artifact.path); add(issues, actual.sha256 === artifact.sha256 && actual.bytes === artifact.bytes, `build artifact changed: ${artifact.path}`); } catch (error) { issues.push(String(error?.message ?? error)); } }
  add(issues, document?.boundaries?.default_on === false && document?.boundaries?.ga === false && document?.boundaries?.m4_authorized === false && document?.boundaries?.real_human_evidence === false, 'build boundary promoted');
  add(issues, document?.digest === documentDigest(document), 'build identity digest is not reproducible');
  add(issues, findAbsolutePathLeaks(document).length === 0, 'absolute path leak in build identity');
  return { ok: issues.length === 0, issues };
}
export function validateSmokeResults(document) {
  const issues = [];
  add(issues, document?.schema === A2_SCHEMA && document?.kind === 'smoke-results', 'smoke schema mismatch');
  add(issues, document?.task === 'TF-0525' && document?.driven_by === 'agent' && document.actor === 'playwright-runner', 'smoke actor mismatch');
  add(issues, document?.stats?.expected === 5 && document?.stats?.unexpected === 0 && document?.stats?.skipped === 0 && document?.stats?.flaky === 0, 'smoke stats are not clean');
  add(issues, Array.isArray(document?.tests) && document.tests.length === 5 && document.tests.every((test) => test.ok === true && test.status === 'passed'), 'smoke test set did not pass');
  add(issues, document?.tests?.some((test) => /setup wizard/u.test(test.title)) && document?.tests?.some((test) => /typed host bridge/u.test(test.title)), 'first-window or host-invoke coverage missing');
  add(issues, document?.entered_test_body === true, 'formal smoke did not enter test bodies');
  add(issues, document?.digest === documentDigest(document), 'smoke digest is not reproducible');
  add(issues, findAbsolutePathLeaks(document).length === 0, 'absolute path leak in smoke results');
  return { ok: issues.length === 0, issues };
}
export function validateElectronStartup(document) {
  const issues = [];
  add(issues, document?.schema === A2_SCHEMA && document?.kind === 'electron-startup', 'startup schema mismatch');
  add(issues, document?.task === 'TF-0525' && document?.driven_by === 'agent' && document.actor === 'codex', 'startup actor mismatch');
  add(issues, document?.diagnostics?.writable_isolated_root?.write?.ok === true && document?.diagnostics?.writable_isolated_root?.window?.ok === true, 'writable isolated Electron probe failed');
  add(issues, document?.diagnostics?.historical_eperm?.status === 'observed' && document.diagnostics.historical_eperm.current_source === false, 'historical EPERM baseline is missing or mislabelled');
  add(issues, document?.actual_app_smoke?.expected === 5 && document?.actual_app_smoke?.failed === 0 && document?.actual_app_smoke?.entered_test_body === true, 'actual app smoke summary mismatch');
  add(issues, document?.actual_app_smoke?.first_window_covered === true && document?.actual_app_smoke?.host_invoke_covered === true, 'first window or host invoke not covered');
  add(issues, document?.boundaries?.real_human_evidence === false && document?.boundaries?.m4_authorized === false, 'startup boundary promoted');
  add(issues, document?.digest === documentDigest(document), 'startup digest is not reproducible');
  add(issues, findAbsolutePathLeaks(document).length === 0, 'absolute path leak in startup evidence');
  return { ok: issues.length === 0, issues };
}
export function validateCleanup(document) {
  const issues = [];
  add(issues, document?.schema === A2_SCHEMA && document?.kind === 'cleanup', 'cleanup schema mismatch');
  add(issues, document?.task === 'TF-0525' && document?.driven_by === 'agent' && document.actor === 'codex', 'cleanup actor mismatch');
  add(issues, Array.isArray(document?.survivors) && document.survivors.length === 0, 'cleanup process survivors remain');
  add(issues, Array.isArray(document?.pid_checks) && document.pid_checks.every((entry) => entry.alive_after === false), 'a recorded Electron PID is still alive');
  add(issues, document?.sweep?.status === 'ok' && document?.sweep?.remaining === 0, 'cleanup sweep is incomplete');
  add(issues, document?.source_modified_by_cleanup === false, 'cleanup modified tracked source');
  add(issues, document?.digest === documentDigest(document), 'cleanup digest is not reproducible');
  add(issues, findAbsolutePathLeaks(document).length === 0, 'absolute path leak in cleanup evidence');
  return { ok: issues.length === 0, issues };
}
function validators(root) {
  return {
    build: validateBuildIdentity(readJson(join(root, A2_BUILD_PATH)), { root }),
    startup: validateElectronStartup(readJson(join(root, A2_STARTUP_PATH))),
    smoke: validateSmokeResults(readJson(join(root, A2_SMOKE_PATH))),
    cleanup: validateCleanup(readJson(join(root, A2_CLEANUP_PATH))),
  };
}
export function buildNegativeChecks(root) {
  const build = readJson(join(root, A2_BUILD_PATH)); const startup = readJson(join(root, A2_STARTUP_PATH)); const smoke = readJson(join(root, A2_SMOKE_PATH)); const cleanup = readJson(join(root, A2_CLEANUP_PATH));
  const cases = [];
  const record = (id, mutation, issues) => cases.push({ id, mutation, rejected: issues.length > 0, issues: issues.slice(0, 6) });
  const badBuild = structuredClone(build); badBuild.artifacts[0].sha256 = '0'.repeat(64); sign(badBuild); record('build-artifact-hash', 'mutate a source-build artifact digest', validateBuildIdentity(badBuild, { root }).issues);
  const badStartup = structuredClone(startup); badStartup.actual_app_smoke.host_invoke_covered = false; sign(badStartup); record('host-invoke-coverage', 'remove real host-invoke coverage', validateElectronStartup(badStartup).issues);
  const badSmoke = structuredClone(smoke); badSmoke.stats.unexpected = 1; sign(badSmoke); record('smoke-failure', 'relabel a formal smoke failure as expected', validateSmokeResults(badSmoke).issues);
  const badCleanup = structuredClone(cleanup); badCleanup.survivors = [1234]; sign(badCleanup); record('cleanup-survivor', 'hide a surviving Electron process', validateCleanup(badCleanup).issues);
  return sign({ schema: A2_SCHEMA, kind: 'negative-checks', generated_at: new Date().toISOString(), task: 'TF-0525', driven_by: 'agent', actor: 'codex', status: cases.every((entry) => entry.rejected) ? 'passed' : 'failed', cases });
}
export function validateNegativeChecks(document) {
  const issues = [];
  add(issues, document?.schema === A2_SCHEMA && document?.kind === 'negative-checks' && document?.status === 'passed', 'negative evidence did not pass');
  for (const id of ['build-artifact-hash', 'host-invoke-coverage', 'smoke-failure', 'cleanup-survivor']) add(issues, (document?.cases ?? []).some((entry) => entry.id === id && entry.rejected === true && entry.issues?.length > 0), `negative case missing: ${id}`);
  add(issues, document?.digest === documentDigest(document), 'negative digest is not reproducible');
  add(issues, findAbsolutePathLeaks(document).length === 0, 'absolute path leak in negative evidence');
  return { ok: issues.length === 0, issues };
}
export function checkEvidence(root = repositoryRoot) {
  const results = validators(root); const negative = validateNegativeChecks(readJson(join(root, A2_NEGATIVE_PATH))); const independent = readJson(join(root, A2_INDEPENDENT_PATH));
  const issues = [...results.build.issues, ...results.startup.issues, ...results.smoke.issues, ...results.cleanup.issues, ...negative.issues];
  add(issues, independent?.schema === A2_SCHEMA && independent?.kind === 'independent-review' && independent?.status === 'passed', 'independent review did not pass');
  if (independent) {
    for (const path of A2_EVIDENCE_PATHS.filter((entry) => entry !== A2_INDEPENDENT_PATH)) add(issues, independent.evidence_digests?.[path] === rawFileInfo(join(root, path)).sha256, `independent digest mismatch: ${path}`);
    add(issues, independent.digest === documentDigest(independent), 'independent review digest is not reproducible');
    add(issues, findAbsolutePathLeaks(independent).length === 0, 'absolute path leak in independent review');
  }
  const sums = checkSums(root); issues.push(...sums);
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}
function checkSums(root) {
  const path = join(root, A2_SUMS_PATH); if (!existsSync(path)) return ['SHA256SUMS missing'];
  const issues = []; const entries = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u).filter(Boolean)) { const match = /^([0-9a-f]{64})  (.+)$/u.exec(line); if (!match) { issues.push('SHA256SUMS malformed'); continue; } entries.set(match[2], match[1]); }
  if (JSON.stringify([...entries.keys()].sort()) !== JSON.stringify([...A2_EVIDENCE_PATHS].sort())) issues.push('SHA256SUMS path set mismatch');
  for (const entry of A2_EVIDENCE_PATHS) if (rawFileInfo(join(root, entry)).sha256 !== entries.get(entry)) issues.push(`SHA256SUMS mismatch: ${entry}`);
  return issues;
}
function buildIndependentReview(root) {
  const results = validators(root); const negative = validateNegativeChecks(readJson(join(root, A2_NEGATIVE_PATH)));
  const issues = [...results.build.issues, ...results.startup.issues, ...results.smoke.issues, ...results.cleanup.issues, ...negative.issues];
  return sign({ schema: A2_SCHEMA, kind: 'independent-review', generated_at: new Date().toISOString(), task: 'TF-0525', driven_by: 'agent', actor: 'codex', reviewer_role: 'independent-a2-verifier-process', status: issues.length === 0 ? 'passed' : 'failed', checks: [{ id: 'build-identity', passed: results.build.ok, issues: results.build.issues }, { id: 'electron-startup', passed: results.startup.ok, issues: results.startup.issues }, { id: 'smoke-results', passed: results.smoke.ok, issues: results.smoke.issues }, { id: 'cleanup', passed: results.cleanup.ok, issues: results.cleanup.issues }, { id: 'negative-checks', passed: negative.ok, issues: negative.issues }], evidence_digests: Object.fromEntries(A2_EVIDENCE_PATHS.filter((entry) => entry !== A2_INDEPENDENT_PATH).map((entry) => [entry, rawFileInfo(join(root, entry)).sha256])), boundaries: { real_human_evidence: false, default_on: false, ga: false, m4_authorized: false }, issues });
}
function writeSums(root) { writeFileSync(join(root, A2_SUMS_PATH), `${A2_EVIDENCE_PATHS.map((entry) => `${rawFileInfo(join(root, entry)).sha256}  ${entry}`).sort().join('\n')}\n`, 'utf8'); }
function argValue(flag) { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; }
function main() {
  const mode = process.argv[2]; const root = process.env.VERSEGIT_A2_ROOT ? resolve(process.env.VERSEGIT_A2_ROOT) : repositoryRoot;
  if (mode === 'write') {
    const runtimeProof = argValue('--runtime-proof'); const viteProof = argValue('--vite-proof'); const contractProof = argValue('--contract-proof'); const smokePath = argValue('--smoke-results');
    if (!runtimeProof || !viteProof || !contractProof || !smokePath) throw new Error('write requires --runtime-proof, --vite-proof, --contract-proof and --smoke-results');
    const build = buildBuildIdentity(root, { runtimeProof, viteProof, contractProof }); const smoke = parseSmokeResults(smokePath); const startup = buildElectronStartup(root, smoke, build.electron.binary_sha256); const cleanup = buildCleanup(root);
    writeJson(root, A2_BUILD_PATH, build); writeJson(root, A2_SMOKE_PATH, smoke); writeJson(root, A2_STARTUP_PATH, startup); writeJson(root, A2_CLEANUP_PATH, cleanup);
  } else if (mode === 'negative') writeJson(root, A2_NEGATIVE_PATH, buildNegativeChecks(root));
  else if (mode === 'independent') { const review = buildIndependentReview(root); if (review.status !== 'passed') throw new Error(review.issues.join('; ')); writeJson(root, A2_INDEPENDENT_PATH, review); }
  else if (mode === 'seal') writeSums(root);
  else if (mode !== 'check') throw new Error('usage: versegit-product-a2-evidence.mjs <write|negative|independent|seal|check> [options]');
  if (mode !== 'check') { console.log(`[versegit-a2] wrote ${mode}`); return; }
  const result = checkEvidence(root); if (!result.ok) { for (const issue of result.issues) console.error(`[versegit-a2] FAIL: ${issue}`); process.exitCode = 1; return; }
  console.log('[versegit-a2] OK smoke=5/5 host_invoke=true cleanup_survivors=0');
}
if (isMainEntrypoint(import.meta.url)) { try { main(); } catch (error) { console.error(`[versegit-a2] FAIL: ${String(error?.stack ?? error)}`); process.exitCode = 1; } }
