import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statfsSync, lstatSync, cpSync, renameSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { CORPUS_DIR, checkCorpus, gradeObservation, loadCorpus, sha256, zeroPassDiagnosis } from './agent-first-task-corpus.mjs';
import { summarizeTf0592Trials } from '../rsi-tf0592-statistical-adjudication.mjs';

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

export function verifyPlanInputs(manifest, root = manifest.source.root) {
  const loaded = loadCorpus(root), profile = loaded.registry.registeredProfiles.find((entry) => entry.id === manifest.profileId);
  assert(profile, 'unregistered execution profile');
  validateTrialManifest(manifest, loaded.corpus, profile, loadTrialAdapters(root));
  assert(git(root, ['rev-parse', `${manifest.source.candidate.commit}^{tree}`]) === manifest.source.candidate.tree, 'invalid source candidate');
  assert.equal(git(root, ['status', '--porcelain']), '', 'source must stay clean during execution/replay');
  assert.deepEqual(sourceBindings(root, loaded.corpus.tasks), manifest.source.bindings, 'frozen source inputs changed');
  assert.equal(loaded.corpusDigest, manifest.corpusDigest, 'corpus content changed');
  assert.deepEqual(manifest.model, { provider: 'mock-openai', id: 'mock-openai/gpt-5.5', version: sha256(readFileSync(join(root, 'openclaw_runtime/extensions/qa-lab/src/providers/shared/mock-provider-definition.ts'))), stochastic: false, seed: 'deterministic-script-v1' }, 'model or seed drift');
  assert.deepEqual(buildInventory(root), manifest.build.files, 'build inventory changed or omitted');
  assert.equal(sha256(JSON.stringify(manifest.build.files)), manifest.build.inventoryDigest);
  assert.deepEqual(read(join(root, 'openclaw_runtime/dist/.buildstamp')), manifest.build.stamp, 'build provenance changed');
  assert.equal(manifest.build.stamp.head, manifest.source.candidate.commit);
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

export function checkTrialRun(runDir, options = {}) {
  const manifest = read(join(runDir, 'manifest.json')), root = options.root ?? manifest.source.root;
  verifyPlanInputs(manifest, root);
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
  const report = checkTrialRun(runDir, { ...options, write: false });
  assert(report.complete, 'incomplete retained run');
  assert.deepEqual(report, read(join(runDir, 'aggregate.json')), 'retained aggregate differs from disk recomputation');
  assert.equal(report.manifestDigest, receipt.manifestDigest);
  return report;
}
