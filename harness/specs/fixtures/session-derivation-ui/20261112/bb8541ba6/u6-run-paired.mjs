import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readlinkSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PREP_ROOT = dirname(fileURLToPath(import.meta.url));
const BASELINE_ROOT = 'D:/ClawX-acceptance/unified-baseline-5ffc-01a1ce4c';
const BASELINE_HEAD = '5ffcdfe89f6bed36dd6ebc2f366990c1a05d3976';
const DRIVER_REL = 'tests/e2e/u6-interaction-metrics.final.spec.ts';
const HELPER_NAMES = ['electron.ts', 'fp-p1-harness.ts', 'session-task-chain.ts', 'electron-process-cleanup.ts', 'windows-process.ts'];
const BASELINE_OVERLAY = new Set(HELPER_NAMES);

const sha = (value) => createHash('sha256').update(value).digest('hex');
const shaFile = (path) => sha(readFileSync(path));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const now = () => new Date().toISOString();

function argsToObject(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error('Unexpected argument: ' + token);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Missing value for --' + key);
    result[key] = value;
    index += 1;
  }
  return result;
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function assertRoot(root) {
  const actual = (value) => realpathSync(value).replaceAll('\\', '/').toLowerCase();
  assert.equal(actual(git(root, ['rev-parse', '--show-toplevel'])), actual(root), 'Git root does not match the physical checkout');
}

function statusLines(root) {
  assertRoot(root);
  const output = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

function safeInside(parent, child) {
  const parentAbs = resolve(parent);
  const childAbs = resolve(child);
  return childAbs === parentAbs || childAbs.startsWith(parentAbs + sep);
}

function verifyPreparation(manifest) {
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.driven_by, 'agent');
  assert.equal(manifest.required_identical, true);
  assert.deepEqual(manifest.helpers.map((entry) => entry.name).sort(), [...HELPER_NAMES].sort());
  const helperHashes = {};
  for (const entry of manifest.helpers) {
    const staged = join(PREP_ROOT, 'helpers', entry.name);
    if (BASELINE_OVERLAY.has(entry.name)) {
      assert.ok(existsSync(staged), 'Missing staged final helper: ' + staged);
      assert.equal(shaFile(staged), entry.sha256, 'Staged helper differs from manifest: ' + entry.name);
    }
    helperHashes[entry.name] = entry.sha256;
  }
  const driverSha = shaFile(join(PREP_ROOT, DRIVER_REL));
  return { helperHashes, driverSha };
}

function verifySideFrozen(root, side, expectedHead, driverSha, helperHashes) {
  assertRoot(root);
  const head = git(root, ['rev-parse', 'HEAD']);
  assert.equal(head, expectedHead, side + ' HEAD drifted');
  const actualDriver = shaFile(join(root, DRIVER_REL));
  assert.equal(actualDriver, driverSha, side + ' driver bytes differ from the frozen final driver');
  const actualHelpers = {};
  for (const name of HELPER_NAMES) {
    const path = join(root, 'tests/e2e/fixtures', name);
    assert.ok(existsSync(path), side + ' missing helper ' + name);
    actualHelpers[name] = shaFile(path);
    assert.equal(actualHelpers[name], helperHashes[name], side + ' helper differs: ' + name);
  }
  return { head, driverSha: actualDriver, helpers: actualHelpers };
}

function verifyBuildManifest(root, side, expectedHead, input) {
  const path = resolve(input);
  assert.ok(existsSync(path), side + ' build manifest not found: ' + path);
  const raw = readFileSync(path);
  const manifest = JSON.parse(raw.toString('utf8'));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.driven_by, 'agent');
  assert.equal(manifest.side, side);
  assert.equal(manifest.source_head, expectedHead);
  assert.ok(Number.isFinite(Date.parse(manifest.built_at)), side + ' build manifest has invalid built_at');
  const artifacts = {
    main_sha256: shaFile(join(root, 'dist-electron/main/index.js')),
    renderer_sha256: shaFile(join(root, 'dist/index.html')),
    runtime_entry_sha256: shaFile(join(root, 'openclaw_runtime/dist/entry.js')),
  };
  for (const [key, value] of Object.entries(artifacts)) {
    assert.match(manifest[key], /^[a-f0-9]{64}$/, side + ' build manifest missing hash ' + key);
    assert.equal(value, manifest[key], side + ' build artifact drifted: ' + key);
  }
  assert.equal(sha(JSON.stringify(manifest.artifacts)), manifest.artifact_tree_sha256, side + ' artifact manifest payload changed');
  for (const entry of manifest.artifacts) {
    const target = resolve(root, entry.path);
    assert.ok(safeInside(root, target), 'Build artifact escaped checkout');
    if (entry.symlinkTarget) {
      assert.equal(readlinkSync(target), entry.symlinkTarget, side + ' build link changed: ' + entry.path);
      assert.equal(relative(root, realpathSync(target)).replaceAll('\\', '/'), entry.resolvedPath, side + ' build link target changed');
    }
    assert.equal(shaFile(target), entry.sha256, side + ' build output changed: ' + entry.path);
  }
  return { path, sha256: sha(raw), manifest, artifacts };
}

function verifyBaselineInitialState(lines) {
  const allowed = new Set([
    'M tests/e2e/fixtures/electron.ts',
    'M tests/e2e/fixtures/fp-p1-harness.ts',
    'M tests/e2e/fixtures/session-task-chain.ts',
    'M tests/e2e/fixtures/electron-process-cleanup.ts',
    'M tests/e2e/fixtures/windows-process.ts',
    '?? tests/e2e/u6-interaction-metrics.spec.ts',
    '?? tests/e2e/u6-interaction-metrics.final.spec.ts',
  ]);
  const normalized = lines.map((line) => { const match = line.match(/^\s*([A-Z?]{1,2})\s+(.+)$/); return match ? match[1] + ' ' + match[2] : line; });
  const unexpected = normalized.filter((line) => !allowed.has(line));
  assert.deepEqual(unexpected, [], 'Baseline has changes outside the prepared U6 overlay/driver');
  return normalized;
}

function materializeBaseline(driverSha) {
  const driverTarget = join(BASELINE_ROOT, DRIVER_REL);
  ensureDirectory(dirname(driverTarget));
  writeFileSync(driverTarget, readFileSync(join(PREP_ROOT, DRIVER_REL)));
  for (const name of BASELINE_OVERLAY) {
    const target = join(BASELINE_ROOT, 'tests/e2e/fixtures', name);
    ensureDirectory(dirname(target));
    writeFileSync(target, readFileSync(join(PREP_ROOT, 'helpers', name)));
  }
  assert.equal(shaFile(driverTarget), driverSha);
}

function collectFiles(root, predicate, files = []) {
  if (!existsSync(root)) return files;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) collectFiles(path, predicate, files);
    else if (predicate(path)) files.push(path);
  }
  return files;
}

async function cleanupReceipt(side, runId, runDir, resultsRoot, root) {
  const setupPath = join(resultsRoot, 'electron-process-run.json');
  const ownerPath = join(resultsRoot, 'electron-process-cleanup.json');
  let actualRoot, owner, error = null;
  try {
    actualRoot = readJson(setupPath).runRoot;
    assert.ok(typeof actualRoot === 'string' && safeInside(runDir, actualRoot), 'Unexpected Electron run root');
    owner = readJson(ownerPath);
    assert.equal(resolve(owner.runRoot), resolve(actualRoot), 'Cleanup receipt belongs to another run');
  } catch (cause) { error = String(cause); }
  const entries = actualRoot && existsSync(actualRoot) ? readdirSync(actualRoot) : [];
  const launchMarkers = entries.filter(name => /^electron-launch-[\da-f-]+\.json$/.test(name));
  const profileDirs = entries.filter(name => /^verse-claw-e2e-(home|user-data)-/.test(name));
  let processQuery = { status: 'unavailable', processes: [], checks: [], error: null };
  if (actualRoot && !error) try {
    const { discoverWindowsElectronProcesses, checkWindowsProcesses } = await import(pathToFileURL(join(root, 'tests/e2e/fixtures/windows-process.ts')).href);
    const discovered = await discoverWindowsElectronProcesses(actualRoot);
    const identities = [...new Map([...(owner.checks ?? []), ...discovered].map(value => [`${value.pid}:${value.creationTime}`, value])).values()];
    const checks = await checkWindowsProcesses(identities, false);
    processQuery = { status: checks.some(value => value.status === 'unavailable') ? 'unavailable' : 'ok',
      processes: checks.filter(value => value.status === 'alive'), checks, error: null };
  } catch (cause) { processQuery = { status: 'unavailable', processes: [], checks: [], error: String(cause) }; }
  const passed = !error && owner?.status === 'passed'
    && owner.remaining?.length === 0 && owner.survivors?.length === 0
    && processQuery.status === 'ok' && processQuery.processes.length === 0 && launchMarkers.length === 0;
  return { schema_version: 1, driven_by: 'agent', actor: 'u6-paired-runner', run_id: runId, side,
    checked_at: now(), run_dir: runDir, actual_run_root: actualRoot, passed, error,
    owner_receipt: { path: ownerPath, sha256: existsSync(ownerPath) ? shaFile(ownerPath) : null, status: owner?.status },
    launch_markers: launchMarkers, retained_profile_dirs: profileDirs, process_query: processQuery };
}

function evidenceInventory(runRoot) {
  return collectFiles(runRoot, (path) => path.endsWith('interaction-metrics.json') || path.endsWith('.last-run.json'))
    .map((path) => ({ path, sha256: shaFile(path), relative_path: relative(runRoot, path) }));
}

async function runSide({ side, root, head, driverSha, helperHashes, buildManifest, runId, runRoot }) {
  const sideRoot = join(runRoot, side);
  const processRoot = join(root, '.tmp', 'e2e-runs', 'u6-paired', runId, side);
  const resultsRoot = join(processRoot, 'results');
  ensureDirectory(sideRoot);
  ensureDirectory(resultsRoot);
  const logPath = join(sideRoot, 'playwright.log');
  const env = {
    ...process.env,
    TEMP: 'D:/tmp',
    TMP: 'D:/tmp',
    CI: '1',
    CLAWX_E2E_APP_LOGS: '1',
    CLAWX_E2E_RUN_ROOT_BASE: processRoot,
    CLAWX_U6_SIDE: side,
    CLAWX_U6_EXPECTED_HEAD: head,
    CLAWX_U6_DRIVER_SHA256: driverSha,
    CLAWX_U6_HELPER_HASHES: JSON.stringify(helperHashes),
    CLAWX_U6_BUILD_MANIFEST: buildManifest.path,
    CLAWX_U6_UNSUPPORTED_PROOF: '{}',
  };
  const cli = join(root, 'node_modules/@playwright/test/cli.js');
  assert.ok(existsSync(cli), side + ' missing Playwright CLI: ' + cli);
  writeJson(join(sideRoot, 'environment.json'), {
    schema_version: 1, driven_by: 'agent', actor: 'u6-paired-runner', side, head,
    cwd: root, runner_node: process.execPath, temp: { TEMP: env.TEMP, TMP: env.TMP },
    run_root: processRoot, results_root: resultsRoot, build_manifest: buildManifest.path,
    stable_environment: { CI: env.CI, language: 'en', viewport: '1280x800', workers: 1, retries: 0 },
  });
  const startedAt = now();
  const monotonicStart = performance.now();
  const log = createWriteStream(logPath, { flags: 'w' });
  const child = spawn(process.execPath, [cli, 'test', DRIVER_REL, '--workers=1', '--retries=0', '--output=' + resultsRoot,
    '--reporter=list', '--trace=retain-on-failure'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { process.stdout.write(chunk); log.write(chunk); });
  child.stderr.on('data', (chunk) => { process.stderr.write(chunk); log.write(chunk); });
  const exit = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  await new Promise((resolveClose) => log.end(resolveClose));
  const cleanup = await cleanupReceipt(side, runId, processRoot, resultsRoot, root);
  writeJson(join(sideRoot, 'cleanup-receipt.json'), cleanup);
  const receipt = {
    schema_version: 1, driven_by: 'agent', actor: 'u6-paired-runner', run_id: runId, side,
    started_at: startedAt, finished_at: now(), duration_ms: Math.round(performance.now() - monotonicStart),
    head, driver_sha256: driverSha, helpers: helperHashes,
    build_manifest: { path: buildManifest.path, sha256: buildManifest.sha256, artifacts: buildManifest.artifacts },
    playwright: { cli, exit_code: exit.code, signal: exit.signal, log_path: logPath, log_sha256: shaFile(logPath) },
    cleanup_passed: cleanup.passed, cleanup_receipt: join(sideRoot, 'cleanup-receipt.json'),
    evidence: evidenceInventory(processRoot),
  };
  writeJson(join(sideRoot, 'side-receipt.json'), receipt);
  return receipt;
}

const args = argsToObject(process.argv.slice(2));
for (const required of ['candidate-root', 'candidate-head', 'baseline-build-manifest', 'candidate-build-manifest']) {
  assert.ok(args[required], 'Missing required --' + required);
}
assert.match(args['candidate-head'], /^[a-f0-9]{40}$/, '--candidate-head must be a 40-character lowercase SHA');
const candidateRoot = resolve(args['candidate-root']);
const candidateHead = args['candidate-head'];
const baselineBuildInput = resolve(args['baseline-build-manifest']);
const candidateBuildInput = resolve(args['candidate-build-manifest']);
const runId = args['run-id'] ?? new Date().toISOString().replace(/[:.]/g, '-');
assert.match(runId, /^[a-zA-Z0-9._-]+$/, '--run-id contains unsupported characters');
const runRoot = join(PREP_ROOT, 'runs', runId);
assert.ok(safeInside(PREP_ROOT, runRoot), 'Run root escaped preparation directory');
ensureDirectory(join(PREP_ROOT, 'runs'));
assert.ok(!existsSync(runRoot), 'Use a new run ID to preserve all previous attempts');
mkdirSync(runRoot);
const pairedPath = join(runRoot, 'paired-receipt.json');
const firstFailurePath = join(runRoot, 'first-failure.json');
const receipt = {
  schema_version: 1, driven_by: 'agent', actor: 'u6-paired-runner', run_id: runId, status: 'running',
  started_at: now(), finished_at: null, baseline: { root: BASELINE_ROOT, expected_head: BASELINE_HEAD },
  candidate: { root: candidateRoot, expected_head: candidateHead }, baseline_initial_status: [], candidate_initial_status: [],
  baseline_final_status: [], candidate_final_status: [], frozen: null, sides: {}, errors: [],
};

function recordFirstFailure(failure) {
  if (existsSync(firstFailurePath)) return;
  writeJson(firstFailurePath, { schema_version: 1, driven_by: 'agent', actor: 'u6-paired-runner', run_id: runId,
    recorded_at: now(), ...failure });
}

try {
  const helperManifest = readJson(join(PREP_ROOT, 'helper-manifest.json'));
  const prep = verifyPreparation(helperManifest);
  const baselineActualHead = git(BASELINE_ROOT, ['rev-parse', 'HEAD']);
  assert.equal(baselineActualHead, BASELINE_HEAD, 'Baseline HEAD drifted');
  const candidateActualHead = git(candidateRoot, ['rev-parse', 'HEAD']);
  assert.equal(candidateActualHead, candidateHead, 'Candidate HEAD differs from --candidate-head');
  const normalizedPath = (value) => resolve(value).replace(/\\/g, '/');
  assert.equal(normalizedPath(git(BASELINE_ROOT, ['rev-parse', '--show-toplevel'])), normalizedPath(BASELINE_ROOT));
  assert.equal(normalizedPath(git(candidateRoot, ['rev-parse', '--show-toplevel'])), normalizedPath(candidateRoot));
  receipt.baseline_initial_status = verifyBaselineInitialState(statusLines(BASELINE_ROOT));
  receipt.candidate_initial_status = statusLines(candidateRoot);
  assert.deepEqual(receipt.candidate_initial_status, [], 'Candidate worktree must be clean at the frozen candidate HEAD');
  const baselineBuild = verifyBuildManifest(BASELINE_ROOT, 'baseline', BASELINE_HEAD, baselineBuildInput);
  const candidateBuild = verifyBuildManifest(candidateRoot, 'candidate', candidateHead, candidateBuildInput);
  verifySideFrozen(candidateRoot, 'candidate', candidateHead, prep.driverSha, prep.helperHashes);
  materializeBaseline(prep.driverSha);
  receipt.frozen = { driver_sha256: prep.driverSha, helpers: prep.helperHashes,
    baseline_build: { path: baselineBuild.path, sha256: baselineBuild.sha256 },
    candidate_build: { path: candidateBuild.path, sha256: candidateBuild.sha256 } };
  verifySideFrozen(BASELINE_ROOT, 'baseline', BASELINE_HEAD, prep.driverSha, prep.helperHashes);
  writeJson(pairedPath, receipt);

  const baseline = await runSide({ side: 'baseline', root: BASELINE_ROOT, head: BASELINE_HEAD, driverSha: prep.driverSha,
    helperHashes: prep.helperHashes, buildManifest: baselineBuild, runId, runRoot });
  receipt.sides.baseline = baseline;
  if (baseline.playwright.exit_code !== 0) recordFirstFailure({ stage: 'playwright', side: 'baseline',
    exit_code: baseline.playwright.exit_code, signal: baseline.playwright.signal, log_path: baseline.playwright.log_path });
  else if (!baseline.cleanup_passed) recordFirstFailure({ stage: 'cleanup', side: 'baseline',
    receipt: baseline.cleanup_receipt });
  writeJson(pairedPath, receipt);

  if (!baseline.cleanup_passed) {
    receipt.sides.candidate = { status: 'not_run', reason: 'Baseline process cleanup is unresolved; candidate window was not started.' };
    throw new Error('Baseline cleanup must be confirmed before candidate execution');
  }

  const candidate = await runSide({ side: 'candidate', root: candidateRoot, head: candidateHead, driverSha: prep.driverSha,
    helperHashes: prep.helperHashes, buildManifest: candidateBuild, runId, runRoot });
  receipt.sides.candidate = candidate;
  if (candidate.playwright.exit_code !== 0) recordFirstFailure({ stage: 'playwright', side: 'candidate',
    exit_code: candidate.playwright.exit_code, signal: candidate.playwright.signal, log_path: candidate.playwright.log_path });
  else if (!candidate.cleanup_passed) recordFirstFailure({ stage: 'cleanup', side: 'candidate',
    receipt: candidate.cleanup_receipt });
  writeJson(pairedPath, receipt);

  verifySideFrozen(BASELINE_ROOT, 'baseline', BASELINE_HEAD, prep.driverSha, prep.helperHashes);
  verifySideFrozen(candidateRoot, 'candidate', candidateHead, prep.driverSha, prep.helperHashes);
  verifyBuildManifest(BASELINE_ROOT, 'baseline', BASELINE_HEAD, baselineBuild.path);
  verifyBuildManifest(candidateRoot, 'candidate', candidateHead, candidateBuild.path);
  assert.equal(shaFile(baselineBuild.path), baselineBuild.sha256, 'Baseline build manifest changed during run');
  assert.equal(shaFile(candidateBuild.path), candidateBuild.sha256, 'Candidate build manifest changed during run');
  receipt.baseline_final_status = statusLines(BASELINE_ROOT);
  receipt.candidate_final_status = statusLines(candidateRoot);
  assert.deepEqual(receipt.candidate_final_status, [], 'Candidate worktree changed during paired execution');
  receipt.status = baseline.playwright.exit_code === 0 && candidate.playwright.exit_code === 0
    && baseline.cleanup_passed && candidate.cleanup_passed ? 'passed' : 'failed';
} catch (error) {
  receipt.errors.push(String(error?.stack ?? error));
  receipt.status = 'failed';
  recordFirstFailure({ stage: 'preflight-or-postcheck', error: String(error?.stack ?? error) });
} finally {
  receipt.finished_at = now();
  writeJson(pairedPath, receipt);
}

console.log(JSON.stringify({ run_id: runId, status: receipt.status, paired_receipt: pairedPath,
  first_failure: existsSync(firstFailurePath) ? firstFailurePath : null }, null, 2));
process.exitCode = receipt.status === 'passed' ? 0 : 1;
