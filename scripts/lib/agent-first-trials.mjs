import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statfsSync, lstatSync, cpSync, renameSync, statSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute, delimiter } from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { CORPUS_DIR, checkCorpus, gradeObservation, loadCorpus, sha256, zeroPassDiagnosis } from './agent-first-task-corpus.mjs';
import { summarizeTf0592Trials } from '../rsi-tf0592-statistical-adjudication.mjs';
import { buildTaskCorpus } from './rsi-historical-task-corpus.mjs';
import { gradeTraceEvidence, runTaskOracles } from './agent-first-graders.mjs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); renameSync(temp, path);
};
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const text = (value) => typeof value === 'string' && value.trim().length > 0;
export const TRIAL_FILES = ['task.json', 'job.json', 'worker.json', 'final-state.json', 'trace.jsonl', 'stdout.log', 'stderr.log'];
const INPUT_PATHS = [
  `${CORPUS_DIR}/tasks.v1.json`, `${CORPUS_DIR}/registry-extension.v1.json`, `${CORPUS_DIR}/calibration.v1.json`,
  'scripts/lib/agent-first-task-corpus.mjs', 'scripts/lib/agent-first-trials.mjs', 'scripts/lib/agent-first-trial-worker.mjs',
  'scripts/lib/agent-first-evaluation-loop.mjs', 'scripts/lib/agent-first-evaluation-framework.mjs',
  'scripts/rsi-tf0592-statistical-adjudication.mjs', 'scripts/lib/reliability-aggregation.mjs', 'scripts/lib/paired-ablation.mjs',
  'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json', 'harness/specs/tasks/agent-first-isolated-trials.md',
  'package.json', 'pnpm-lock.yaml', 'openclaw_runtime/package.json', 'openclaw_runtime/pnpm-lock.yaml',
  'scripts/agent-first-trials.mjs', 'tests/unit/agent-first-trials.test.ts',
  `${CORPUS_DIR}/trial-adapters.v1.json`,
];
const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(path, entry.name)) : entry.isFile() ? [join(path, entry.name)] : []);

function evidenceFiles(directory) {
  return walk(directory).map((path) => relative(directory, path).replaceAll('\\', '/'))
    .filter((path) => path !== 'record.json' && !['temp', 'home', 'cache'].includes(path.split('/')[0])).sort();
}

export function artifactPath(root, path) {
  assert(text(path) && !isAbsolute(path), 'artifact references must be relative');
  const full = resolve(root, path), rel = relative(resolve(root), full);
  assert(rel !== '..' && !rel.startsWith(`..${os.platform() === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel), 'artifact escapes run');
  let current = full;
  while (current !== resolve(root)) {
    if (existsSync(current)) assert(!lstatSync(current).isSymbolicLink(), 'linked artifacts are invalid');
    current = dirname(current);
  }
  return full;
}

function sourceBindings(root, tasks) {
  const paths = [...new Set([...INPUT_PATHS, ...Object.values(loadTrialAdapters(root)).map((entry) => entry.entrypoint), ...tasks.flatMap((task) => [task.source.path, task.reference.entrypoint]),
    ...git(root, ['ls-files', 'openclaw_runtime/src', 'openclaw_runtime/extensions/qa-lab', 'openclaw_runtime/packages']).split('\n').filter(Boolean)])].sort();
  return Object.fromEntries(paths.map((path) => [path, sha256(readFileSync(join(root, path)))]));
}

function trialIdentities(corpus) {
  return corpus.tasks.flatMap((task) => ['baseline', 'treatment'].flatMap((arm) => [1, 2, 3].map((repeat) => ({ taskId: task.id, arm, repeat, trialId: `${task.id}-${arm}-${repeat}` }))));
}

function executionEnvelope(profile, environment) {
  return { ...profile.resourceEnvelope, cpuCeiling: environment.cpuCount, memoryMbCeiling: 4096, processCeiling: 64, timeoutMs: 900000, maxOutputBytes: 16 * 1024 ** 2,
    concurrency: 1, retries: 0, network: 'loopback-only', enforcement: 'wall/output/RSS/process monitored; native CPU/RSS hard caps not installed' };
}

function frozenTestPaths(root) {
  const corpus = buildTaskCorpus(root);
  for (const task of corpus.tasks) for (const path of task.oracle.testPaths) FROZEN_TEST_PATHS.add(path);
  return corpus;
}

const HISTORICAL_CASE_SOURCE = 'historical-system';
const HISTORICAL_ARMS = ['baseline', 'treatment'];
const TREATMENT_PROMPT = 'When a matching prior success/failure pair exists, compare both paths and preserve counterexamples before choosing the next action.';
const FROZEN_TEST_PATHS = new Set();
const HARNESS_NETWORK_ENV_KEYS = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']);

function sha256Value(value) { return sha256(JSON.stringify(value)); }
function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries({ ...process.env, ...extra })) {
    if (HARNESS_NETWORK_ENV_KEYS.has(key) || /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE[_-]?KEY|CREDENTIAL)$/iu.test(key)) continue;
    if (typeof value === 'string') env[key] = value;
  }
  env.TEMP = 'D:/tmp'; env.TMP = 'D:/tmp'; env.TMPDIR = 'D:/tmp';
  env.CI = 'true'; env.NO_COLOR = '1'; env.FORCE_COLOR = '0';
  env.npm_config_verify_deps_before_run = 'false';
  env.pnpm_config_verify_deps_before_run = 'false';
  return env;
}

function historicalCorpus(root) { return buildTaskCorpus(root); }
function heldOutDigest(corpus) {
  const ids = [...corpus.split.heldOut].sort();
  return sha256(JSON.stringify({ schemaVersion: 'RsiHeldOutSplit/v1', taskIds: ids, tasks: corpus.tasks.filter((task) => ids.includes(task.id)).map((task) => sha256Value(task)) }));
}
/**
 * A frozen task is only unusable when no oracle path carries hidden signal, or when the sealed
 * oracle cannot be bound to a pinned reference revision. Oracle paths that merely pre-exist at the
 * base revision are not a defect: they are scrubbed from the agent snapshot and restored by the
 * grader, so the verdict still depends on work the agent did not see.
 */
export function historicalTaskDefect(task, hiddenSignalPaths = task?.oracle?.hiddenSignalPaths ?? []) {
  if (!task?.oracle) return 'task has no sealed oracle';
  if (typeof task.referenceSolution?.baseCommit !== 'string' || !task.referenceSolution.baseCommit) return `task ${task.id} has no base revision`;
  if (typeof task.referenceSolution?.referenceCommit !== 'string' || !task.referenceSolution.referenceCommit) return `task ${task.id} has no reference revision`;
  if (!(task.oracle.testPaths ?? []).length) return `task ${task.id} has no sealed oracle test paths`;
  if (!hiddenSignalPaths.length) return `task ${task.id} carries no hidden oracle signal`;
  return null;
}
function historicalTrialIdentities(corpus) {
  return corpus.tasks.flatMap((task) => HISTORICAL_ARMS.flatMap((arm) => [1,2,3].map((repeat) => ({ taskId: task.id, arm, repeat, trialId: `${task.id}-${arm}-${repeat}` }))));
}
export function buildHistoricalTrialPlan(root = process.cwd()) {
  root = resolve(root);
  const corpus = frozenTestPaths(root);
  const digest = heldOutDigest(corpus);
  return { corpus, splitDigest: digest, trials: historicalTrialIdentities(corpus), hiddenTestPaths: [...new Set(corpus.tasks.flatMap((task) => task.oracle.testPaths))] };
}
function materializeSnapshot(root, revision, directory) {
  mkdirSync(directory, { recursive: true });
  const archive = spawnSync('git', ['archive', '--format=tar', revision], { cwd: root, windowsHide: true, maxBuffer: 1024 ** 3 });
  if (archive.status !== 0) throw Object.assign(new Error(String(archive.stderr ?? 'git archive failed')), { failureClass: 'infrastructure' });
  const untar = spawnSync('tar', ['-x', '-C', directory], { input: archive.stdout, windowsHide: true, maxBuffer: 1024 ** 3 });
  if (untar.status !== 0) throw Object.assign(new Error(String(untar.stderr ?? 'tar extract failed')), { failureClass: 'infrastructure' });
}
function findInstalledRoot(root) {
  const candidates = [join(root, 'node_modules', 'vitest', 'vitest.mjs'), join(root, 'node_modules', '.bin', 'vitest.CMD'), join(root, 'node_modules', '.bin', 'vitest')];
  return candidates.find((path) => existsSync(path)) ?? null;
}
function directoryFingerprint(directory, excluded = new Set(['node_modules', 'agent-node_modules'])) {
  const files = walk(directory).map((path) => relative(directory, path).replaceAll('\\', '/')).filter((path) => !path.split('/').some((part) => excluded.has(part))).sort();
  return Object.fromEntries(files.map((path) => [path, sha256(readFileSync(join(directory, path)))]));
}
function diffFingerprint(before, after) {
  const added = Object.keys(after).filter((path) => !Object.hasOwn(before, path)).sort();
  const changed = Object.keys(after).filter((path) => Object.hasOwn(before, path) && before[path] !== after[path]).sort();
  const removed = Object.keys(before).filter((path) => !Object.hasOwn(after, path)).sort();
  return { added, changed, removed };
}
export function loadTrialAdapters(root = process.cwd()) {
  const registry = read(join(root, CORPUS_DIR, 'trial-adapters.v1.json'));
  assert(registry.schemaVersion === 'AgentFirstTrialAdapters/v1' && registry.driven_by === 'agent' && text(registry.actor), 'invalid adapter registry');
  assert(registry.adapters && !Array.isArray(registry.adapters), 'missing adapters');
  for (const adapter of Object.values(registry.adapters)) {
    assert(text(adapter.entrypoint) && text(adapter.export), 'invalid adapter entry');
    artifactPath(root, adapter.entrypoint);
  }
  return registry.adapters;
}

function buildInventory(root) {
  return ['openclaw_runtime/dist', 'openclaw_runtime/dist-runtime'].flatMap((dir) => walk(join(root, dir))).sort().map((file) => ({ path: relative(root, file).replaceAll('\\', '/'), sha256: sha256(readFileSync(file)) }));
}

export function validateTrialManifest(manifest, corpus, profile, registeredAdapters) {
  assert(manifest?.schemaVersion === 'AgentFirstTrialManifest/v1' && manifest.driven_by === 'agent' && text(manifest.actor), 'invalid manifest identity');
  assert(text(manifest.runId) && manifest.source?.candidate?.dirty === false, 'invalid source candidate');
  assert.equal(manifest.suiteId, corpus.suiteId); assert.equal(manifest.profileId, profile.id);
  assert.deepEqual(manifest.trials, trialIdentities(corpus), 'frozen trial set, arms or repeats changed');
  assert.equal(manifest.k, 3); assert.deepEqual(manifest.arms, ['baseline', 'treatment']);
  assert.deepEqual(manifest.graders, profile.graderIds, 'frozen graders changed');
  assert(registeredAdapters && corpus.tasks.every((task) => Object.hasOwn(registeredAdapters, task.executor.kind)), 'unregistered adapter');
  assert.deepEqual(manifest.adapters, registeredAdapters, 'execution adapter drift');
  assert.equal(manifest.toolsDigest, sha256(JSON.stringify(manifest.source.bindings)), 'tool identity differs');
  const env = manifest.environment;
  assert(env?.node && env.platform === process.platform && env.arch === process.arch && env.osRelease && Number.isInteger(env.cpuCount) && env.cpuCount >= profile.resourceEnvelope.cpuFloor &&
    Number.isFinite(env.totalMemoryBytes) && env.totalMemoryBytes >= profile.resourceEnvelope.memoryMbFloor * 1024 ** 2 && Number.isFinite(env.freeMemoryBytes) && env.freeMemoryBytes >= 0 && env.freeMemoryBytes <= env.totalMemoryBytes &&
    Number.isFinite(env.diskFreeBytes) && env.diskFreeBytes >= profile.resourceEnvelope.diskFreeMbFloor * 1024 ** 2, 'resource fingerprint missing or invalid');
  assert.deepEqual(manifest.envelope, executionEnvelope(profile, env), 'execution policy or resource envelope drift');
  assert.deepEqual(manifest.claims, { liveProvider: false, realHuman: false, rsiImprovement: false, productLocksChanged: false });
}

export function createTrialPlan(root, runDir) {
  root = resolve(root); runDir = resolve(runDir);
  assert(git(root, ['status', '--porcelain']) === '', 'a clean committed candidate is required');
  assert(!existsSync(join(runDir, 'manifest.json')), 'preserve the existing immutable manifest');
  assert(checkCorpus(root).ok, 'task corpus/calibration must validate');
  const { corpus, registry, corpusDigest } = loadCorpus(root);
  const profile = registry.registeredProfiles.find((entry) => entry.id === 'agent-first-system-profile');
  const disk = statfsSync(runDir), envelope = profile.resourceEnvelope;
  assert(os.cpus().length >= envelope.cpuFloor && os.totalmem() / 1024 ** 2 >= envelope.memoryMbFloor && Number(disk.bavail) * Number(disk.bsize) / 1024 ** 2 >= envelope.diskFreeMbFloor, 'host resource floor not met');
  const bindings = sourceBindings(root, corpus.tasks);
  const buildFiles = buildInventory(root);
  const buildStamp = read(join(root, 'openclaw_runtime/dist/.buildstamp'));
  const candidate = { commit: git(root, ['rev-parse', 'HEAD']), tree: git(root, ['rev-parse', 'HEAD^{tree}']), dirty: false };
  assert.equal(buildStamp.head, candidate.commit, 'build must be made from the planned candidate');
  const environment = { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), cpuCount: os.cpus().length, totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), diskFreeBytes: Number(disk.bavail) * Number(disk.bsize) };
  const manifest = {
    schemaVersion: 'AgentFirstTrialManifest/v1', driven_by: 'agent', actor: 'codex/agent-first-planner', runId: randomUUID(), createdAt: new Date().toISOString(),
    source: { root, candidate, bindings },
    profileId: profile.id, suiteId: corpus.suiteId, corpusDigest, k: 3, arms: ['baseline', 'treatment'],
    model: { provider: 'mock-openai', id: 'mock-openai/gpt-5.5', version: sha256(readFileSync(join(root, 'openclaw_runtime/extensions/qa-lab/src/providers/shared/mock-provider-definition.ts'))), stochastic: false, seed: 'deterministic-script-v1' },
    graders: profile.graderIds, toolsDigest: sha256(JSON.stringify(bindings)),
    environment, envelope: executionEnvelope(profile, environment), adapters: loadTrialAdapters(root),
    build: { stamp: buildStamp, files: buildFiles, inventoryDigest: sha256(JSON.stringify(buildFiles)) },
    trials: trialIdentities(corpus),
    claims: { liveProvider: false, realHuman: false, rsiImprovement: false, productLocksChanged: false },
  };
  validateTrialManifest(manifest, corpus, profile, loadTrialAdapters(root));
  write(join(runDir, 'manifest.json'), manifest);
  write(join(runDir, 'progress.json'), { schemaVersion: 'AgentFirstTrialProgress/v1', manifestDigest: sha256(readFileSync(join(runDir, 'manifest.json'))), completed: [], recordDigests: {} });
  return manifest;
}

export function verifyPlanInputs(manifest, root = manifest.source.root, options = {}) {
  const loaded = loadCorpus(root), profile = loaded.registry.registeredProfiles.find((entry) => entry.id === manifest.profileId);
  assert(profile, 'unregistered execution profile');
  validateTrialManifest(manifest, loaded.corpus, profile, loadTrialAdapters(root));
  assert(git(root, ['rev-parse', `${manifest.source.candidate.commit}^{tree}`]) === manifest.source.candidate.tree, 'invalid source candidate');
  if (!options.retained) assert.equal(git(root, ['status', '--porcelain']), '', 'source must stay clean during execution/replay');
  if (!options.retained) assert.deepEqual(sourceBindings(root, loaded.corpus.tasks), manifest.source.bindings, 'frozen source inputs changed');
  assert.equal(loaded.corpusDigest, manifest.corpusDigest, 'corpus content changed');
  assert.deepEqual(manifest.model, { provider: 'mock-openai', id: 'mock-openai/gpt-5.5', version: sha256(readFileSync(join(root, 'openclaw_runtime/extensions/qa-lab/src/providers/shared/mock-provider-definition.ts'))), stochastic: false, seed: 'deterministic-script-v1' }, 'model or seed drift');
  if (!options.retained) assert.deepEqual(buildInventory(root), manifest.build.files, 'build inventory changed or omitted');
  assert.equal(sha256(JSON.stringify(manifest.build.files)), manifest.build.inventoryDigest);
  if (!options.retained) assert.deepEqual(read(join(root, 'openclaw_runtime/dist/.buildstamp')), manifest.build.stamp, 'build provenance changed');
  if (options.retained) {
    assert(manifest.build.files.length > 0 && manifest.build.files.every((file) =>
      /^(?:openclaw_runtime\/dist|openclaw_runtime\/dist-runtime)\//u.test(file.path) && /^sha256:[a-f0-9]{64}$/u.test(file.sha256)), 'invalid archived build receipt');
    verifyCandidateBlobs(root, manifest.source.candidate.commit, manifest.source.bindings);
    // Archive verification reports the measured candidate. Its grader and task
    // inputs stay byte-identical; later reader/evidence-only work is separate.
    for (const path of [
      `${CORPUS_DIR}/tasks.v1.json`, `${CORPUS_DIR}/registry-extension.v1.json`,
      'scripts/lib/agent-first-task-corpus.mjs', 'scripts/rsi-tf0592-statistical-adjudication.mjs',
      'scripts/lib/reliability-aggregation.mjs', 'scripts/lib/paired-ablation.mjs',
    ]) assert.equal(sha256(readFileSync(join(root, path))), manifest.source.bindings[path], `frozen replay grader changed: ${path}`);
  }
  assert.equal(manifest.build.stamp.head, manifest.source.candidate.commit);
}

function verifyCandidateBlobs(root, commit, bindings) {
  const paths = Object.keys(bindings);
  const blobs = execFileSync('git', ['cat-file', '--batch'], {
    cwd: root, input: paths.map((path) => `${commit}:${path}`).join('\n') + '\n',
    windowsHide: true, maxBuffer: 128 * 1024 ** 2,
  });
  let offset = 0;
  for (const path of paths) {
    const end = blobs.indexOf(10, offset);
    assert(end >= 0, 'candidate object response is incomplete');
    const header = blobs.subarray(offset, end).toString('utf8');
    const size = Number(header.split(' ')[2]);
    assert(/^[a-f0-9]+ blob \d+$/u.test(header) && Number.isSafeInteger(size), `candidate input missing: ${path}`);
    offset = end + 1;
    assert.equal(sha256(blobs.subarray(offset, offset + size)), bindings[path], `candidate input differs: ${path}`);
    offset += size + 1;
  }
  assert.equal(offset, blobs.length, 'candidate object count differs');
}

export function classifyTrial(worker, grades, observation, execution) {
  if (execution.timedOut) return { outcome: 'timeout', failureClass: 'infrastructure' };
  if (worker?.error?.failureClass === 'task') return { outcome: 'fail', failureClass: 'task' };
  if (execution.budgetExceeded || execution.exitCode !== 0 || worker?.error) return { outcome: 'fail', failureClass: 'infrastructure' };
  if (!worker?.isolation?.emptyWorkspaceAtStart || worker.isolation.gitHistoryAtStart !== false || observation?.isolation?.noGitMetadata !== true || observation.isolation.historyVisible !== false || observation?.cleanup?.gatewayPortClosed !== true || execution.cleanup?.processTree !== 'empty') return { outcome: 'fail', failureClass: 'infrastructure' };
  if (observation.raw?.flowStatus && (observation.raw.flowStatus !== 'pass' || observation.raw.unexpectedStep === true)) return { outcome: 'fail', failureClass: 'agent' };
  if (!Array.isArray(grades) || grades.length !== 2 || grades.some((grade) => grade.verdict === 'unknown')) return { outcome: 'fail', failureClass: 'grader' };
  if (grades.some((grade) => grade.verdict === 'fail')) return { outcome: 'fail', failureClass: 'agent' };
  return { outcome: 'pass', failureClass: null };
}

function safeTrialEnv(directory) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE[_-]?KEY/iu.test(name)) delete env[name];
  for (const name of ['NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'OPENCLAW_HOME', 'OPENCLAW_STATE_DIR', 'OPENCLAW_CONFIG_PATH']) delete env[name];
  return { ...env, HOME: join(directory, 'home'), USERPROFILE: join(directory, 'home'), APPDATA: join(directory, 'home', 'AppData/Roaming'), LOCALAPPDATA: join(directory, 'home', 'AppData/Local'), XDG_CONFIG_HOME: join(directory, 'cache/config'), XDG_CACHE_HOME: join(directory, 'cache'), TEMP: join(directory, 'temp'), TMP: join(directory, 'temp'), TMPDIR: join(directory, 'temp'), GIT_CEILING_DIRECTORIES: join(directory, 'temp'), OPENCLAW_QA_KEEP_TEMP: '1', OPENCLAW_QA_PROGRESS: '0' };
}

async function spawnTrial(root, directory, job, envelope) {
  const { tsImport } = await import(pathToFileURL(join(root, 'openclaw_runtime/node_modules/tsx/dist/esm/api/index.mjs')));
  const { readProcessTreeSample } = await tsImport(pathToFileURL(join(root, 'openclaw_runtime/src/process/process-tree-sampler.ts')).href, import.meta.url);
  const { killProcessTree } = await tsImport(pathToFileURL(join(root, 'openclaw_runtime/src/process/kill-tree.ts')).href, import.meta.url);
  const { captureProcessTrees, verifyProcessTreesTerminated } = await tsImport(pathToFileURL(join(root, 'openclaw_runtime/src/process/os-containment.ts')).href, import.meta.url);
  const samples = [], chunks = { stdout: [], stderr: [] };
  let bytes = 0, timedOut = false, budgetExceeded = null, sampleInFlight = false;
  const started = Date.now();
  const child = spawn(process.execPath, [join(root, 'scripts/lib/agent-first-trial-worker.mjs'), '--job', join(directory, 'job.json'), '--trial-dir', directory], { cwd: join(directory, 'workspace'), env: safeTrialEnv(directory), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  write(join(directory, 'process.json'), { pid: child.pid, state: 'running', startedAt: new Date().toISOString() });
  const capturedPids = new Map();
  const terminate = () => { if (child.pid) killProcessTree(child.pid, { force: true }); };
  const sample = async () => {
    if (sampleInFlight || child.exitCode !== null) return;
    sampleInFlight = true;
    try {
      const value = await readProcessTreeSample({ rootPids: [child.pid] });
      samples.push(value);
      const capture = await captureProcessTrees([child.pid]);
      if (capture.status === 'ok') for (const [pid, token] of capture.capturedPids) capturedPids.set(pid, token);
      if ((value.treeRssBytes ?? 0) > envelope.memoryMbCeiling * 1024 ** 2 || (value.processCount ?? 0) > envelope.processCeiling) { budgetExceeded = 'rss-or-process-ceiling'; terminate(); }
    } finally { sampleInFlight = false; }
  };
  const timer = setTimeout(() => { timedOut = true; terminate(); }, envelope.timeoutMs);
  const interval = job.task.executor.kind === 'qa-scenario' ? setInterval(() => void sample().catch((error) => samples.push({ status: 'unknown', detail: String(error) })), 3000) : null;
  if (interval) void sample().catch((error) => samples.push({ status: 'unknown', detail: String(error) }));
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > envelope.maxOutputBytes) { budgetExceeded = 'output-ceiling'; terminate(); } else chunks[stream].push(chunk);
  });
  let error = null;
  const exitCode = await new Promise((resolveExit) => {
    child.once('error', (caught) => { error = String(caught); resolveExit(null); });
    child.once('close', (code) => resolveExit(code));
  });
  clearTimeout(timer); if (interval) clearInterval(interval);
  while (sampleInFlight) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  for (const stream of ['stdout', 'stderr']) writeFileSync(join(directory, `${stream}.log`), Buffer.concat(chunks[stream]));
  const tree = capturedPids.size ? await verifyProcessTreesTerminated({ status: 'ok', rootPids: [child.pid], capturedPids }) : { status: job.task.executor.kind === 'loop-control' ? 'empty' : 'unknown' };
  write(join(directory, 'process.json'), { pid: child.pid, state: 'terminal', exitCode, completedAt: new Date().toISOString(), tree });
  if (tree.status !== 'empty') budgetExceeded ??= 'unverified-process-cleanup';
  return { pid: child.pid, exitCode, error, timedOut, budgetExceeded, durationMs: Date.now() - started, samples, cleanup: { childExited: true, processTree: tree.status } };
}

export function readTrialRecord(manifest, runDir, entry, root = manifest.source.root) {
  const directory = artifactPath(runDir, `trials/${entry.trialId}`);
  const record = read(join(directory, 'record.json'));
  assert(record.schemaVersion === 'AgentFirstTrial/v1' && record.driven_by === 'agent' && text(record.actor), 'invalid trial producer');
  assert.deepEqual(record.identity, entry, 'trial identity changed');
  assert.equal(record.manifestDigest, sha256(readFileSync(join(runDir, 'manifest.json'))), 'trial manifest mismatch');
  for (const [name, hash] of Object.entries(record.artifacts)) assert.equal(sha256(readFileSync(artifactPath(directory, name))), hash, `trial artifact changed: ${name}`);
  assert(TRIAL_FILES.every((name) => Object.hasOwn(record.artifacts, name)), 'missing required trial artifacts');
  const actualFiles = evidenceFiles(directory);
  assert.deepEqual(actualFiles, Object.keys(record.artifacts).sort(), 'raw evidence inventory changed');
  const task = read(join(directory, 'task.json')), observation = read(join(directory, 'final-state.json')), worker = read(join(directory, 'worker.json'));
  const grades = manifest.graders.map((id) => gradeObservation(task, observation, id));
  const classification = classifyTrial(worker, grades, observation, record.execution);
  assert.deepEqual(record.grades, grades, 'grader result differs from final-state replay');
  assert.deepEqual(record.classification, classification, 'outcome/failure class differs');
  assert.equal(worker.trialId, entry.trialId); assert.equal(observation.trialId, entry.trialId);
  assert.equal(worker.driven_by, 'agent'); assert(text(worker.actor), 'worker actor missing');
  const frozenTask = loadCorpus(root).corpus.tasks.find((value) => value.id === entry.taskId);
  assert.deepEqual(task, frozenTask, 'trial task differs from the frozen corpus');
  const trace = readFileSync(join(directory, 'trace.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(trace.map(({ driven_by: _driven, actor: _actor, ...event }) => event), observation.events, 'trace differs from observation');
  if (task.executor.kind === 'qa-scenario' && !worker.error) {
    const observed = trace.filter((event) => event.kind === 'assert');
    assert.deepEqual(observation.raw.observedAssertions, observation.events.filter((event) => event.kind === 'assert'));
    for (const [index, condition] of task.oracle.conditions.entries()) {
      const value = observed[index];
      assert.equal(observation.conditions[index]?.actual, value?.expression === condition.expression ? value.actual : null, 'final state contradicts raw assertions');
    }
  }
  const job = read(join(directory, 'job.json'));
  assert.deepEqual(job.task, task, 'task identity changed');
  assert.deepEqual(job.identity, entry); assert.equal(job.trialId, entry.trialId); assert.equal(job.runId, manifest.runId);
  assert.deepEqual(job.adapter, manifest.adapters[task.executor.kind]);
  const processState = read(join(directory, 'process.json'));
  assert(processState.state === 'terminal' && processState.pid === record.execution.pid && processState.exitCode === record.execution.exitCode, 'process outcome contradicted');
  return record;
}

export async function runTrialPlan(runDir, options = {}) {
  const manifest = read(join(runDir, 'manifest.json')), root = options.root ?? manifest.source.root;
  verifyPlanInputs(manifest, root);
  const progress = read(join(runDir, 'progress.json'));
  assert(!existsSync(join(runDir, '.executor-lock')), 'an executor already owns this run');
  writeFileSync(join(runDir, '.executor-lock'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx' });
  try {
  assert.equal(progress.manifestDigest, sha256(readFileSync(join(runDir, 'manifest.json'))), 'progress manifest changed');
  const tasks = new Map(loadCorpus(root).corpus.tasks.map((task) => [task.id, task]));
  let executed = 0;
  for (const entry of manifest.trials) {
    if (progress.completed.includes(entry.trialId)) {
      assert.equal(sha256(readFileSync(artifactPath(runDir, `trials/${entry.trialId}/record.json`))), progress.recordDigests[entry.trialId], 'sealed record changed');
      readTrialRecord(manifest, runDir, entry, root); continue;
    }
    if (options.limit && executed >= options.limit) break;
    const directory = artifactPath(runDir, `trials/${entry.trialId}`);
    assert(!existsSync(directory), 'an interrupted unsealed trial requires a fresh explicit trial/run; never overwrite it');
    for (const folder of ['workspace', 'home/AppData/Roaming', 'home/AppData/Local', 'cache/config', 'temp']) mkdirSync(join(directory, folder), { recursive: true });
    const task = tasks.get(entry.taskId), adapter = manifest.adapters[task.executor.kind];
    assert(adapter, 'unregistered execution adapter');
    const job = { task, adapter, sourceRoot: root, runId: manifest.runId, trialId: entry.trialId, identity: entry };
    write(join(directory, 'task.json'), task); write(join(directory, 'job.json'), job);
    console.log(`[agent-first-trials] ${entry.trialId} starting`);
    const execution = await spawnTrial(root, directory, job, manifest.envelope);
    if (!existsSync(join(directory, 'worker.json'))) {
      write(join(directory, 'worker.json'), { driven_by: 'agent', actor: 'agent-first-executor', trialId: entry.trialId, error: { message: execution.error ?? 'worker did not produce evidence' }, isolation: { emptyWorkspaceAtStart: true, gitHistoryAtStart: false } });
      write(join(directory, 'final-state.json'), { taskId: task.id, trialId: entry.trialId, source: 'environment', conditions: [], events: [], cleanup: { gatewayPortClosed: false } });
      writeFileSync(join(directory, 'trace.jsonl'), '');
    }
    const worker = read(join(directory, 'worker.json')), observation = read(join(directory, 'final-state.json'));
    const grades = manifest.graders.map((id) => gradeObservation(task, observation, id));
    const classification = classifyTrial(worker, grades, observation, execution);
    const record = { schemaVersion: 'AgentFirstTrial/v1', driven_by: 'agent', actor: 'codex/agent-first-executor', identity: entry,
      manifestDigest: progress.manifestDigest, execution, grades, classification,
      artifacts: Object.fromEntries(evidenceFiles(directory).map((path) => [path, sha256(readFileSync(join(directory, path)))])) };
    write(join(directory, 'record.json'), record);
    progress.recordDigests[entry.trialId] = sha256(readFileSync(join(directory, 'record.json')));
    progress.completed.push(entry.trialId); write(join(runDir, 'progress.json'), progress);
    console.log(`[agent-first-trials] ${entry.trialId} ${classification.outcome}/${classification.failureClass ?? 'none'}`);
    executed++;
  }
  return checkTrialRun(runDir, { root });
  } finally {
    // Keep release atomic without deleting an unverified caller path.
    renameSync(join(runDir, '.executor-lock'), join(runDir, `.executor-finished-${Date.now()}.json`));
  }
}

export function writeHistoricalManifest(runDir, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const run = options.dependenciesRoot ?? resolve(options.runDirRoot ?? 'D:/tmp/rsi-dependencies');
  const nodeModulesPath = join(run, 'node_modules');
  assert(existsSync(join(nodeModulesPath, 'vitest', 'vitest.mjs')), 'offline dependencies must be installed before manifest creation');
  assert(existsSync(join(run, 'openclaw_runtime', 'node_modules')), 'offline runtime dependencies must be installed before manifest creation');
  const plan = buildHistoricalTrialPlan(root);
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=all']);
  const commit = git(root, ['rev-parse', 'HEAD']);
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
  const manifest = { schemaVersion: 'RsiHistoricalTrialManifest/v1', driven_by: 'agent', actor: 'codex/tf0604-historical-planner', runId: randomUUID(), createdAt: new Date().toISOString(), source: { root, candidate: { commit, tree, dirty: Boolean(dirty) } }, suite: { id: 'rsi-historical-core', caseCount: plan.corpus.tasks.length, publicCaseCount: plan.corpus.split.public.length, heldOutCaseCount: plan.corpus.split.heldOut.length, heldOutDigest: plan.splitDigest }, model: { provider: 'custom', id: options.model ?? 'ccs-404/deepseek-v4.1-flash', reasoningEffort: 'high', stochastic: true, seed: null }, nodeModulesPath, tasks: plan.corpus.tasks, trials: plan.trials, hiddenTestPaths: plan.hiddenTestPaths, envelope: { concurrency: options.concurrency ?? 1, timeoutMs: options.timeoutMs ?? 900000, retries: 0, network: 'disabled', isolation: 'fresh git-archive directory per trial', agentSeesHiddenTests: false }, claims: { realHuman: false, liveProvider: true, rsiImprovement: false, productLocksChanged: false } };
  write(join(runDir,'manifest.json'), manifest);
  write(join(runDir,'progress.json'), { schemaVersion: 'RsiHistoricalTrialProgress/v1', manifestDigest: 'sha256:' + createHash('sha256').update(readFileSync(join(runDir,'manifest.json'))).digest('hex'), completed: [], recordDigests: {} });
  return manifest;
}
export function checkHistoricalRun(runDir, options = {}) {
  const manifest = read(join(runDir,'manifest.json'));
  assert(manifest.schemaVersion==='RsiHistoricalTrialManifest/v1','invalid historical manifest');
  const progress=read(join(runDir,'progress.json'));
  assert(progress.manifestDigest==='sha256:' + createHash('sha256').update(readFileSync(join(runDir,'manifest.json'))).digest('hex'),'manifest changed');
  const results=manifest.trials.filter((trial)=>progress.completed.includes(trial.trialId)).map((trial)=>read(join(runDir,'trials',trial.trialId,'historical-result.json')));
  assert(progress.completed.length===new Set(progress.completed).size,'duplicate trial completion');
  assert(progress.completed.length===Object.keys(progress.recordDigests).length,'missing result seal');
  for(const trial of progress.completed){const p=join(runDir,'trials',trial,'historical-result.json'); assert('sha256:' + createHash('sha256').update(readFileSync(p)).digest('hex')===progress.recordDigests[trial],'trial result changed');}
  const complete = results.length===manifest.trials.length;
  const raw={cases:manifest.tasks.map((task)=>({caseId:task.id,trials:results.filter((result)=>result.taskId===task.id).map((result)=>({arm:result.arm,repeat:result.repeat,outcome:result.grader?.verdict ?? (result.failureClass==='infrastructure'?'timeout':'fail'),failureClass:result.failureClass,wallClockMs:null,tokens:null,turns:null,toolCalls:null,cost:null}))}))};
  const statistics=summarizeTf0592Trials({cases:manifest.tasks.map((task)=>({id:task.id,taskId:task.id}))},raw,read(join(manifest.source.root,'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json')));
  const report={schemaVersion:'RsiHistoricalTrialAggregate/v1',driven_by:'agent',actor:'codex/tf0604-historical-reader',manifestDigest:progress.manifestDigest,complete,recordedTrials:results.length,expectedTrials:manifest.trials.length,completeCaseCount:statistics.run.completeCaseCount,incompleteCaseCount:statistics.run.incompleteCaseCount,statistics,failureClasses:statistics.failureClasses,claims:manifest.claims};
  if(options.write!==false) write(join(runDir,'aggregate.json'),report); return report;
}
function writeHistoricalResult(trialDir, value) {
  write(join(trialDir, 'historical-result.json'), { schemaVersion: 'RsiHistoricalTrialResult/v1', driven_by: 'agent', actor: 'codex/tf0604-historical-runner', ...value });
}

export async function runHistoricalTrial(runDir, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const trialId = options.trialId;
  const manifest = read(join(runDir, 'manifest.json'));
  const entry = manifest.trials.find((value) => value.trialId === trialId);
  assert(entry, 'unknown historical trial');
  const trialDir = artifactPath(runDir, 'trials/' + trialId);
  mkdirSync(trialDir, { recursive: true });
  const task = manifest.tasks.find((value) => value.id === entry.taskId);
  assert(task, 'missing frozen task');
  const startedAt = new Date().toISOString();
  const baseDir = join(trialDir, 'base');
  const agentRoot = join(trialDir, 'agent');
  const resultPath = join(trialDir, 'historical-result.json');
  if (existsSync(baseDir) || existsSync(agentRoot) || existsSync(resultPath)) throw new Error('historical trial already exists');
  let failureClass = null;
  let stage = 'setup';
  try {
    materializeSnapshot(root, task.referenceSolution.baseCommit, baseDir);
    const oraclePaths = task.oracle.testPaths ?? [];
    const hiddenSignalPaths = task.oracle.hiddenSignalPaths ?? oraclePaths;
    const taskDefect = historicalTaskDefect(task, hiddenSignalPaths);
    if (taskDefect) {
      rmSync(trialDir, { recursive: true, force: true });
      throw Object.assign(new Error(taskDefect), { failureClass: 'task' });
    }
    cpSync(baseDir, agentRoot, { recursive: true });
    // The agent must not read the sealed assertions, so every oracle path is removed from its
    // snapshot; the grader restores the frozen copies before scoring.
    const preexistingOraclePaths = oraclePaths.filter((path) => existsSync(join(baseDir, path)));
    const scrubbedOraclePaths = [];
    for (const path of oraclePaths) {
      const snapshotPath = join(agentRoot, path);
      if (existsSync(snapshotPath)) { rmSync(snapshotPath, { force: true }); scrubbedOraclePaths.push(path); }
    }
    const rsiRoot = join(agentRoot, '.rsi');
    mkdirSync(rsiRoot, { recursive: true });
    write(join(rsiRoot, 'TASK.json'), { taskId: task.id, sourceTaskId: task.sourceTaskId, title: task.title, baseCommit: task.referenceSolution.baseCommit, objective: task.input.prompt, acceptanceCriteria: task.input.acceptanceCriteria, targetScope: task.input.targetScope, arm: entry.arm, instruction: 'Implement the task in this repository. Do not inspect or modify tests in the final hidden oracle. Do not install dependencies, use network, create loops/retries, or modify product locks. Report exact checks you actually ran.' });
    if (entry.arm === 'treatment') write(join(rsiRoot, 'AGENT_INSTRUCTIONS.md'), '# Agent instructions\n\n' + TREATMENT_PROMPT + '\n');
    write(join(rsiRoot, 'RESULT_SCHEMA.json'), { type: 'object', additionalProperties: false, required: ['status','summary','testsRun'], properties: { status: { type: 'string', enum: ['completed','blocked'] }, summary: { type: 'string' }, testsRun: { type: 'array', items: { type: 'string' } } } });
    // Guarantee the sealed assertions are actually absent from the agent snapshot.
    for (const path of preexistingOraclePaths) {
      if (existsSync(join(agentRoot, path))) throw Object.assign(new Error('oracle test not scrubbed from agent snapshot: ' + path), { failureClass: 'grader' });
    }
    const before = directoryFingerprint(agentRoot);
    stage = 'agent';
    const configuredCli = process.env.CODEX_CLI_PATH;
    const cli = configuredCli && existsSync(configuredCli) ? configuredCli : 'C:/Users/27933/AppData/Local/OpenAI/Codex/bin/0ab0e7a8f3779036/codex.exe';
    assert(existsSync(cli), 'Codex CLI executable is missing');
    const args = ['exec','--ignore-user-config','--json','--ephemeral', ...(entry.arm === 'treatment' ? ['-c','project_doc_fallback_filenames=[".rsi/AGENT_INSTRUCTIONS.md"]'] : []), '--disable','memories','--disable','plugins','--disable','hooks','--disable','in_app_browser','--model', manifest.model.id, '-c','model_providers.custom.name="custom"','-c','model_providers.custom.base_url="http://127.0.0.1:15721/v1"','-c','model_providers.custom.wire_api="responses"','-c','model_providers.custom.experimental_bearer_token="PROXY_MANAGED"','-c','model_provider="custom"','-c','model_reasoning_effort="high"','-c','approval_policy="never"','--sandbox','danger-full-access','--skip-git-repo-check','-C',agentRoot,'--output-schema',join(rsiRoot,'RESULT_SCHEMA.json'),'-o',join(trialDir,'agent-last.json'), 'You are executing an isolated repository task. Read README.md, AGENTS.md if present, and .rsi/TASK.json. Implement the requested change in this workspace, run relevant existing checks that do not install dependencies, and return the required structured result. Do not use network.'];
    const child = spawn(cli, args, { cwd: agentRoot, env: cleanEnv({ OPENAI_BASE_URL: 'http://127.0.0.1:15721/v1', OPENAI_API_KEY: process.env.Z30_API_KEY ?? '' }), windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    const stdout = []; const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk))); child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    const timeoutMs = manifest.envelope.timeoutMs;
    const exit = await new Promise((resolveExit) => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolveExit({ code: null, timedOut: true }); }, timeoutMs); child.once('error', (error) => { clearTimeout(timer); resolveExit({ code: null, error: String(error), timedOut: false }); }); child.once('exit', (code) => { clearTimeout(timer); resolveExit({ code, timedOut: false }); }); });
    writeFileSync(join(trialDir,'agent.stdout.log'), Buffer.concat(stdout)); writeFileSync(join(trialDir,'agent.stderr.log'), Buffer.concat(stderr));
    const after = directoryFingerprint(agentRoot);
    const diff = diffFingerprint(before, after);
    const agentDiff = { ...diff, added: diff.added.filter((path) => !path.startsWith('.rsi/')), changed: diff.changed.filter((path) => !path.startsWith('.rsi/')), removed: diff.removed.filter((path) => !path.startsWith('.rsi/')) };
    const touched = [...agentDiff.added, ...agentDiff.changed];
    // Oracle paths are scrubbed from the snapshot and overwritten by the grader, so agent writes
    // there cannot influence the verdict; they are recorded for audit instead of failing the trial.
    const oracleWrites = touched.filter((path) => oraclePaths.includes(path));
    const forbidden = touched.filter((path) => path.startsWith('.git/'));
    if (exit.timedOut) failureClass = 'infrastructure';
    if (exit.error) failureClass = 'infrastructure';
    if (forbidden.length) failureClass = 'agent';
    if (exit.code !== 0 && !failureClass) failureClass = 'agent';
    stage = 'grade';
    const graderRoot = join(trialDir,'grader');
    cpSync(agentRoot, graderRoot, { recursive: true, filter: (path) => !path.includes(join(agentRoot, 'node_modules')) && !path.includes(join(agentRoot, '.rsi')) });
    for (const taskTest of task.oracle.testPaths) { const source = readFileSync(join(root, taskTest)); mkdirSync(dirname(join(graderRoot, taskTest)), { recursive: true }); writeFileSync(join(graderRoot, taskTest), source); }

    const dependenciesRoot = options.dependenciesRoot ? resolve(options.dependenciesRoot) : manifest.source.root;
    const oracle = runTaskOracles(task, root, join(trialDir,'oracle'), { authorityRoot: graderRoot, dependenciesRoot });
    const traceGrade = gradeTraceEvidence(oracle.trace);
    const verdict = oracle.verdict.verdict === 'pass' && traceGrade.verdict === 'pass' && !forbidden.length && !failureClass ? 'pass' : oracle.verdict.verdict === 'unknown' || traceGrade.verdict === 'unknown' ? 'unknown' : 'fail';
    if (verdict !== 'pass' && !failureClass) failureClass = verdict === 'unknown' ? 'grader' : 'agent';
    const result = { trialId, taskId: task.id, arm: entry.arm, repeat: entry.repeat, baseCommit: task.referenceSolution.baseCommit, startedAt, completedAt: new Date().toISOString(), agent: { exitCode: exit.code, timedOut: exit.timedOut, error: exit.error ?? null }, diff: agentDiff, forbiddenPaths: forbidden, oracleWrites, scrubbedOraclePaths, preexistingOraclePaths, grader: { verdict, deterministic: oracle.verdict, trace: traceGrade, oracleDirectory: oracle.directory }, failureClass, checks: { isolatedSnapshot: true, networkDisabledByCli: true, hiddenTestsRestored: true, hiddenTestsHiddenFromAgent: oraclePaths.every((path) => !existsSync(join(agentRoot, path))), noGitMetadataAtStart: !existsSync(join(agentRoot,'.git')) }, claims: { realHuman: false, liveProvider: true, rsiImprovement: false, productLocksChanged: false } };
    writeHistoricalResult(trialDir,result);
    return result;
  } catch (error) {
    const result = { trialId, taskId: task.id, arm: entry.arm, repeat: entry.repeat, startedAt, completedAt: new Date().toISOString(), stage, error: String(error?.stack ?? error), failureClass: error?.failureClass ?? failureClass ?? 'infrastructure', claims: { realHuman: false, liveProvider: true, rsiImprovement: false, productLocksChanged: false } };
    writeHistoricalResult(trialDir,result); return result;
  }
}

export function retainHistoricalRun(runDir, outputDir, options = {}) {
  const root = options.root ?? process.cwd();
  const run = resolve(runDir);
  const out = resolve(outputDir);
  assert(!existsSync(out), 'preserve an existing retained pack');
  const report = checkHistoricalRun(run, { root, write: false });
  const manifest = read(join(run, 'manifest.json'));
  const progress = read(join(run, 'progress.json'));
  const files = new Map();
  const add = (name, bytes) => files.set(name.replaceAll('\\', '/'), Buffer.from(bytes));
  add('manifest.json', readFileSync(join(run, 'manifest.json')));
  add('progress.json', readFileSync(join(run, 'progress.json')));
  add('aggregate.json', Buffer.from(JSON.stringify(report, null, 2) + '\n'));
  for (const trialId of progress.completed) {
    const dir = join(run, 'trials', trialId);
    add(join(trialId, 'historical-result.json'), readFileSync(join(dir, 'historical-result.json')));
    for (const name of ['agent-last.json', 'agent.stdout.log', 'agent.stderr.log']) {
      const path = join(dir, name);
      if (existsSync(path)) add(join(trialId, name), readFileSync(path));
    }
    const result = read(join(dir, 'historical-result.json'));
    const oracleDirectory = result.grader?.oracleDirectory;
    if (oracleDirectory && existsSync(oracleDirectory)) {
      for (const path of walk(oracleDirectory)) add(join(trialId, 'oracle', relative(oracleDirectory, path)), readFileSync(path));
    }
  }
  const sums = [...files.keys()].sort().map((name) => sha256(files.get(name)).concat('  ', name));
  files.set('SHA256SUMS', Buffer.from(sums.join('\n') + '\n'));
  mkdirSync(out, { recursive: true });
  for (const [name, bytes] of files) { const target = artifactPath(out, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
  return { schemaVersion: 'RsiHistoricalTrialRetention/v1', driven_by: 'agent', actor: 'codex/tf0604-historical-retainer', directory: out,
    manifestDigest: progress.manifestDigest, recordedTrials: report.recordedTrials, completeCaseCount: report.completeCaseCount,
    fileCount: files.size, complete: report.complete, claims: manifest.claims };
}

export function checkTrialRun(runDir, options = {}) {
  const manifest = read(join(runDir, 'manifest.json')), root = options.root ?? manifest.source.root;
  verifyPlanInputs(manifest, root, options);
  const progress = read(join(runDir, 'progress.json'));
  assert.equal(progress.manifestDigest, sha256(readFileSync(join(runDir, 'manifest.json'))));
  assert(new Set(progress.completed).size === progress.completed.length && progress.completed.every((id) => manifest.trials.some((trial) => trial.trialId === id)), 'duplicate/unknown completed trial');
  assert.deepEqual(Object.keys(progress.recordDigests).sort(), [...progress.completed].sort(), 'missing/unknown record seals');
  const records = manifest.trials.filter((entry) => progress.completed.includes(entry.trialId)).map((entry) => {
    assert.equal(sha256(readFileSync(artifactPath(runDir, `trials/${entry.trialId}/record.json`))), progress.recordDigests[entry.trialId], 'sealed record changed');
    return readTrialRecord(manifest, runDir, entry, root);
  });
  const corpus = loadCorpus(root).corpus;
  const rawTrials = { cases: corpus.tasks.map((task) => ({ caseId: task.id, trials: records.filter((record) => record.identity.taskId === task.id).map((record) => ({ arm: record.identity.arm, repeat: record.identity.repeat, ...record.classification, wallClockMs: record.execution.durationMs, tokens: null, turns: null, toolCalls: null, cost: null })) })) };
  const statistics = summarizeTf0592Trials({ cases: corpus.tasks.map((task) => ({ id: task.id, taskId: task.id })) }, rawTrials,
    read(join(root, 'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json')));
  const investigations = statistics.perTask.flatMap((entry) => {
    const diagnosis = zeroPassDiagnosis(entry.trials.filter((trial) => trial.outcome === 'pass').length, entry.trials.length);
    return diagnosis ? [{ taskId: entry.taskId, ...diagnosis }] : [];
  });
  const report = { schemaVersion: 'AgentFirstTrialAggregate/v1', driven_by: 'agent', actor: 'codex/agent-first-statistical-reader', manifestDigest: progress.manifestDigest,
    sourceCandidate: manifest.source.candidate, complete: progress.completed.length === manifest.trials.length, recordedTrials: records.length, expectedTrials: manifest.trials.length,
    statistics, investigations, claims: manifest.claims };
  if (options.write !== false) write(join(runDir, 'aggregate.json'), report);
  return report;
}

/** Copy only named evidence, never caches, credentials or previous workspace data. */
export function retainTrialRun(runDir, outputDir, options = {}) {
  const report = checkTrialRun(runDir, { ...options, write: false });
  assert(report.complete, 'cannot seal an incomplete execution pack');
  assert(!existsSync(join(outputDir, 'manifest.json')), 'preserve an existing retained run');
  mkdirSync(outputDir, { recursive: true });
  for (const name of ['manifest.json', 'progress.json']) cpSync(join(runDir, name), join(outputDir, name));
  const manifest = read(join(runDir, 'manifest.json'));
  for (const entry of manifest.trials) {
    const from = artifactPath(runDir, `trials/${entry.trialId}`), to = artifactPath(outputDir, `trials/${entry.trialId}`);
    mkdirSync(to, { recursive: true });
    for (const name of [...Object.keys(read(join(from, 'record.json')).artifacts), 'record.json']) {
      const destination = artifactPath(to, name); mkdirSync(dirname(destination), { recursive: true }); cpSync(artifactPath(from, name), destination);
    }
  }
  write(join(outputDir, 'aggregate.json'), report);
  write(join(outputDir, 'retention.json'), { schemaVersion: 'AgentFirstTrialRetention/v1', driven_by: 'agent', actor: 'agent-first-evidence-owner', rawRun: resolve(runDir), manifestDigest: report.manifestDigest,
    files: walk(outputDir).map((path) => ({ path: relative(outputDir, path).replaceAll('\\', '/'), sha256: sha256(readFileSync(path)) })) });
  return report;
}

export function verifyRetainedRun(runDir, options = {}) {
  const receipt = read(join(runDir, 'retention.json'));
  assert(receipt.schemaVersion === 'AgentFirstTrialRetention/v1' && receipt.driven_by === 'agent' && text(receipt.actor), 'invalid retention receipt');
  const allowedFiles = [...receipt.files.map((file) => file.path), 'retention.json', 'SHA256SUMS', 'credential-scan.json', 'acceptance.json'].sort();
  const observedFiles = walk(runDir).map((path) => relative(runDir, path).replaceAll('\\', '/')).sort();
  assert(observedFiles.every((path) => allowedFiles.includes(path)), 'unregistered retained artifact');
  for (const file of receipt.files) assert.equal(sha256(readFileSync(artifactPath(runDir, file.path))), file.sha256, `retained evidence changed: ${file.path}`);
  const report = checkTrialRun(runDir, { ...options, retained: true, write: false });
  assert(report.complete, 'incomplete retained run');
  assert.deepEqual(report, read(join(runDir, 'aggregate.json')), 'retained aggregate differs from disk recomputation');
  assert.equal(report.manifestDigest, receipt.manifestDigest);
  return report;
}

/** Verify the small, tracked acceptance summary and, when available, its raw retained run. */
export function verifyTrialAcceptance(file, options = {}) {
  const root = options.root ?? process.cwd(), acceptancePath = resolve(root, file), directory = dirname(acceptancePath);
  const acceptance = read(acceptancePath);
  assert.equal(acceptance.schemaVersion, 'AgentFirstTrialAcceptance/v1', 'invalid trial acceptance schema');
  assert.equal(acceptance.driven_by, 'agent', 'trial acceptance must be agent-driven');
  assert(text(acceptance.actor) && acceptance.taskId === 'TF-0592', 'invalid trial acceptance provenance');
  assert(acceptance.sourceCandidate && text(acceptance.sourceCandidate.commit) && text(acceptance.sourceCandidate.tree), 'missing candidate identity');
  assert(text(acceptance.manifestDigest) && text(acceptance.rawEvidence?.path) && Number.isInteger(acceptance.rawEvidence?.fileCount), 'missing raw evidence identity');
  assert(acceptance.claims && Object.values(acceptance.claims).every((value) => value === false), 'trial acceptance overclaims');
  assert(text(acceptance.scope) && Array.isArray(acceptance.limitations) && acceptance.limitations.length > 0, 'trial acceptance must state its scope');

  const artifact = (name) => {
    const entry = acceptance.artifacts?.[name];
    assert(entry && text(entry.path) && /^sha256:[a-f0-9]{64}$/u.test(entry.sha256), `missing ${name} artifact receipt`);
    const path = artifactPath(directory, entry.path);
    assert.equal(sha256(readFileSync(path)), entry.sha256, `${name} acceptance artifact changed`);
    return read(path);
  };
  const aggregate = artifact('aggregate'), controls = artifact('controls'), retention = artifact('retention');

  assert.equal(git(root, ['rev-parse', `${acceptance.sourceCandidate.commit}^{tree}`]), acceptance.sourceCandidate.tree, 'candidate tree does not match acceptance');
  try { git(root, ['merge-base', '--is-ancestor', acceptance.sourceCandidate.commit, 'HEAD']); }
  catch { assert.fail('acceptance candidate is not in the current history'); }

  assert.equal(retention.schemaVersion, 'AgentFirstTrialRetention/v1', 'invalid retention schema');
  assert.equal(retention.driven_by, 'agent', 'retention must be agent-driven');
  assert(text(retention.actor) && Array.isArray(retention.files), 'invalid retention provenance');
  assert.equal(retention.manifestDigest, acceptance.manifestDigest, 'retention manifest differs');
  assert.equal(retention.files.length, acceptance.rawEvidence.fileCount, 'retention file count differs');
  const retained = new Map(retention.files.map((entry) => [entry.path, entry.sha256]));
  assert.equal(retained.get(acceptance.artifacts.aggregate.path), acceptance.artifacts.aggregate.sha256, 'retained aggregate receipt differs');

  assert.equal(aggregate.schemaVersion, 'AgentFirstTrialAggregate/v1', 'invalid aggregate schema');
  assert.equal(aggregate.manifestDigest, acceptance.manifestDigest, 'aggregate manifest differs');
  assert.deepEqual(aggregate.sourceCandidate, acceptance.sourceCandidate, 'aggregate candidate differs');
  assert.equal(aggregate.complete, true, 'aggregate is incomplete');
  assert.equal(aggregate.recordedTrials, acceptance.protocol.recordedTrials, 'recorded trial count differs');
  assert.equal(aggregate.expectedTrials, acceptance.protocol.expectedTrials, 'expected trial count differs');
  assert.equal(aggregate.statistics.run.k, acceptance.protocol.k, 'k differs');
  assert.equal(aggregate.statistics.run.completeCaseCount, acceptance.protocol.completeCaseCount, 'complete case count differs');
  assert.equal(aggregate.statistics.run.incompleteCaseCount, 0, 'incomplete cases remain');

  const baseline = aggregate.statistics.perTask, treatment = aggregate.statistics.treatment.perTask;
  assert(Array.isArray(baseline) && Array.isArray(treatment), 'missing per-arm statistics');
  const trials = [...baseline.flatMap((entry) => entry.trials.map((trial) => ({ ...trial, taskId: entry.taskId }))),
    ...treatment.flatMap((entry) => entry.trials.map((trial) => ({ ...trial, taskId: entry.taskId })))];
  assert.equal(trials.length, aggregate.recordedTrials, 'per-task trials differ from recorded total');
  assert.equal(new Set(trials.map((trial) => `${trial.taskId}/${trial.arm}/${trial.repeat}`)).size, trials.length, 'duplicate trial identity');
  for (const trial of trials) assert(['baseline', 'treatment'].includes(trial.arm) && Number.isInteger(trial.repeat) && trial.repeat > 0, 'invalid trial identity');
  const outcomes = trials.reduce((counts, trial) => ({ ...counts, [trial.outcome]: (counts[trial.outcome] ?? 0) + 1 }), {});
  assert.deepEqual(outcomes, acceptance.expected.outcomes, 'trial outcomes differ');
  const failureClasses = Object.fromEntries(['infrastructure', 'task', 'grader', 'agent'].map((name) => [name,
    (aggregate.statistics.failureClasses[name]?.trialCount ?? 0) + (aggregate.statistics.treatment.failureClasses[name]?.trialCount ?? 0)]));
  assert.deepEqual(failureClasses, acceptance.expected.failureClasses, 'failure classes differ');
  assert.equal(aggregate.statistics.status, acceptance.expected.statisticsStatus, 'statistics status differs');
  assert.equal(aggregate.statistics.aggregate.passK, acceptance.expected.passK, 'pass^k differs');
  assert.deepEqual(aggregate.statistics.aggregate.confidenceInterval95, acceptance.expected.confidenceInterval95, 'confidence interval differs');
  assert.equal(aggregate.statistics.pairedDiff.status, acceptance.expected.pairedDiffStatus, 'paired diff status differs');
  assert.equal(aggregate.statistics.power.status, acceptance.expected.powerStatus, 'power status differs');

  assert.equal(controls.schemaVersion, 'AgentFirstTrialReplayControls/v1', 'invalid replay control schema');
  assert.equal(controls.driven_by, 'agent', 'replay controls must be agent-driven');
  assert(text(controls.actor) && controls.passed === true, 'replay controls did not pass');
  assert.equal(controls.sourceManifestDigest, acceptance.manifestDigest, 'replay controls manifest differs');
  assert.equal(controls.results.length, acceptance.controls.expectedCount, 'replay control count differs');
  assert(controls.results.every((row) => row.validBaseline === true && row.rejected === true && text(row.reason)), 'a negative replay control was not rejected');

  let rawVerified = false;
  if (options.raw) {
    const report = verifyRetainedRun(resolve(root, options.raw), { root });
    assert.equal(report.manifestDigest, acceptance.manifestDigest, 'raw retained manifest differs');
    assert.deepEqual(report, aggregate, 'raw retained aggregate differs from tracked evidence');
    rawVerified = true;
  }
  return { schemaVersion: 'AgentFirstTrialAcceptanceCheck/v1', complete: true, taskId: acceptance.taskId,
    sourceCandidate: acceptance.sourceCandidate, recordedTrials: aggregate.recordedTrials,
    controls: controls.results.length, rawVerified };
}
