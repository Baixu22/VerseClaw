#!/usr/bin/env node
/** Serial zero-model-call calibration with immutable phase receipts. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { getHeapStatistics } from 'node:v8';
import { benefitDigest } from './lib/rsi-benefit-eval.mjs';
import { codingGit } from './lib/rsi-constructed-tasks.mjs';
import { createStdioTasks, verifyStdioTasks } from './lib/rsi-stdio-tasks.mjs';
import { prepareStdioGradeWorkspace, resolveHistoricalTask, runLiveTaskOracles } from './lib/rsi-live-grader.mjs';
import { verifyGuidedOracleArtifact } from './lib/rsi-guided-evidence.mjs';
import { codingCollectorConfig } from './lib/rsi-coding-protocol.mjs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PHASES = ['baseline', 'reference', 'no-output'];
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const log = value => console.log(JSON.stringify({ driven_by: 'agent', actor: 'codex/rsi-library-checker-calibration', modelRequests: 0, ...value }));
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function sha(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function evidenceInventory(directory) {
  const hashes = {};
  const walk = async (parent, prefix = '') => {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), 'calibration-evidence-symlink');
      const name = prefix + entry.name, path = join(parent, entry.name);
      if (entry.isDirectory()) await walk(path, name + '/');
      else if (entry.isFile()) hashes[name] = await sha(path);
    }
  };
  if (existsSync(directory)) await walk(directory);
  return hashes;
}
export const calibrationFile = (directory, relative) => {
  assert(typeof relative === 'string', 'calibration-relative-path');
  relative = relative.replaceAll('\\', '/');
  assert(typeof relative === 'string' && /^[A-Za-z0-9_.+-]+(?:\/[A-Za-z0-9_.+-]+)*$/u.test(relative)
    && relative.split('/').every(part => part !== '.' && part !== '..'), 'calibration-relative-path');
  let path = resolve(directory);
  for (const part of relative.split('/')) {
    path = join(path, part);
    if (existsSync(path)) assert(!lstatSync(path).isSymbolicLink(), 'calibration-symlink');
  }
  return path;
};
const file = calibrationFile;

export function assertUnstartedCalibrationPhase(directory, phase) {
  assert(PHASES.includes(phase), 'calibration-phase');
  for (const name of [phase, phase + '-grade', phase + '-started.json'])
    assert(!existsSync(join(directory, name)), 'calibration-started-phase-without-receipt:' + phase);
}

export function assertCalibrationPrefix(output, problems) {
  let gap = false;
  let unsettled = false;
  for (const [index, problem] of problems.entries()) {
    const directory = join(output, String(index).padStart(3, '0') + '-' + problem);
    if (!existsSync(directory)) { gap = true; continue; }
    assert(!gap, 'calibration-case-prefix-gap');
    assert(!unsettled, 'calibration-case-after-unsettled-phase');
    let missing = false;
    for (const phase of PHASES) {
      const present = existsSync(join(directory, phase + '-receipt.json'));
      assert(!present || !missing, 'calibration-phase-prefix-gap');
      missing ||= !present;
    }
    unsettled = missing;
  }
}

export function calibrationVerdict(phase, grade) {
  assert(PHASES.includes(phase), 'calibration-phase');
  if (grade.failureClass === 'infrastructure') return 'infrastructure';
  if (phase === 'baseline') {
    assert(grade.passed === false && grade.failureClass === 'target-module-absent', 'calibration-baseline-control');
    return 'baseline-unimplemented';
  }
  if (phase === 'no-output') {
    assert(grade.passed === false && grade.failureClass === 'assertion', 'calibration-no-output-control');
    return 'negative-control-rejected';
  }
  assert((grade.passed === true && grade.failureClass === null)
    || (grade.passed === false && grade.failureClass === 'assertion'), 'calibration-reference-outcome');
  return grade.passed ? 'reference-pass' : 'reference-rejected';
}

export async function loadCalibrationInputs(root, inputs) {
  const plan = read(file(inputs, 'plan.json')), prepared = read(file(inputs, 'report.json'));
  const supplemental = plan.schemaVersion === 'RsiSupplementalMeasurementPlan/v1';
  assert((plan.schemaVersion === 'RsiLibraryCheckerMeasurementPlan/v1' || supplemental) && plan.driven_by === 'agent'
    && plan.realHumanEvidence === false && plan.modelRequests === 0 && plan.usage === 'scripted-control', 'calibration-plan');
  assert(prepared.schemaVersion === (supplemental ? 'RsiSupplementalMeasurementInputs/v1' : 'RsiLibraryCheckerMeasurementInputs/v1') && prepared.modelRequests === 0
    && prepared.formalAdmission === false && prepared.planSha256 === await sha(file(inputs, 'plan.json')), 'calibration-prepared-plan');
  const selection = supplemental ? plan.selectedSources?.map(row => row.caseId) : plan.selectedProblems;
  assert(Array.isArray(selection) && selection.length > 0 && new Set(selection).size === selection.length
    && selection.every(name => supplemental ? /^supplemental-[a-f0-9]{16}$/u.test(name) : /^[A-Za-z0-9_]+$/u.test(name)), 'calibration-selection');
  assert.deepEqual(prepared.cases.map(row => row.problem), selection, 'calibration-input-order');
  if (supplemental) {
    assert(typeof plan.pythonVersion === 'string' && /^Python 3\.\d+\.\d+[A-Za-z0-9.+-]*$/u.test(plan.pythonVersion)
      && plan.calibrationSchemaVersion === 'RsiSupplementalCalibrationBatch/v1', 'calibration-isolated-python-required');
    for (const [index, selected] of plan.selectedSources.entries()) {
      assert(typeof selected.familyId === 'string' && selected.familyId.length > 0
        && typeof selected.sourceKey === 'string' && selected.sourceKey.length > 0
        && [selected.familyOrder, selected.sourceOrder].every(value => Number.isSafeInteger(value) && value >= 0),
      'calibration-family-source-order');
      assert.deepEqual(Object.fromEntries(Object.keys(selected).map(key => [key, prepared.cases[index][key]])), selected,
        'calibration-whole-family-binding');
    }
  }
  assert(Number.isSafeInteger(plan.minimumSystemAvailableBytes) && plan.minimumSystemAvailableBytes >= (supplemental ? 3221225472 : 1610612736),
    'calibration-memory-budget');
  for (const name of ['scripts/rsi-library-checker-calibrate.mjs', 'scripts/rsi-native-checker-worker.py',
    'scripts/rsi-native-checker-replay.py', 'scripts/lib/rsi-native-checker.mjs', ...(supplemental
      ? ['scripts/lib/rsi-isolated-python.mjs', 'scripts/rsi-isolated-python-worker.py', 'scripts/rsi-isolated-python-replay.py'] : [])])
    assert(/^[a-f0-9]{64}$/u.test(plan.sourceFilesSha256?.[name]), 'calibration-required-source:' + name);
  for (const entry of prepared.cases) assert(entry.path === entry.problem + '.json.gz'
    && /^[a-f0-9]{64}$/u.test(entry.sha256) && /^[a-f0-9]{64}$/u.test(entry.packDigest)
    && /^[a-f0-9]{64}$/u.test(entry.referenceSha256) && Number.isSafeInteger(entry.vectors) && entry.vectors >= 5,
  'calibration-case-input');
  return { plan, prepared, selection, supplemental,
    batchVersion: supplemental ? 'RsiSupplementalCalibrationBatch/v1' : 'RsiLibraryCheckerCalibrationBatch/v1',
    phaseVersion: supplemental ? 'RsiSupplementalCalibrationPhase/v1' : 'RsiLibraryCheckerCalibrationPhase/v1',
    evidenceDirectory: supplemental ? 'stdio-python-evidence' : 'native-checker-evidence',
    planSha256: await sha(file(inputs, 'plan.json')), inputsSha256: await sha(file(inputs, 'report.json')), root, inputs };
}

async function verifyExecutor(context) {
  const { root, plan } = context;
  assert(codingGit(root, ['rev-parse', 'HEAD']) === plan.sourceCommit
    && codingGit(root, ['rev-parse', 'HEAD^{tree}']) === plan.sourceTree, 'calibration-executor-commit');
  assert(!codingGit(root, ['status', '--porcelain']), 'calibration-clean-executor-required');
  for (const [name, expected] of Object.entries(plan.sourceFilesSha256))
    assert.equal(await sha(file(root, name)), expected, 'calibration-executor-source:' + name);
  assert.equal(process.version, plan.nodeVersion, 'calibration-node-version');
  const heapOptions = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? '').split(/\s+/u)]
    .filter(option => /^--max-old-space-size=/u.test(option));
  assert(heapOptions.length > 0 && heapOptions.every(option => option === '--max-old-space-size=384'),
    'calibration-node-old-space-budget');
}

export async function calibrationRegistryBinding(directory, registry, task) {
  assert.equal(codingGit(registry.repository, ['rev-parse', 'HEAD']), registry.registryCommit, 'calibration-task-repository-head');
  assert(!codingGit(registry.repository, ['status', '--porcelain']), 'calibration-task-repository-dirty');
  assert(task.id === registry.tasks[0].id && task.base === registry.tasks[0].source.base
    && task.ref === registry.tasks[0].source.reference, 'calibration-resolved-task-identity');
  return { registrySha256: await sha(join(directory, 'registry.json')), registryCommit: registry.registryCommit,
    taskDigest: benefitDigest(task) };
}

async function verifyPhase(context, entry, registry, directory, phase, receipt, binding) {
  assert(receipt.schemaVersion === context.phaseVersion && receipt.modelRequests === 0
    && receipt.phase === phase && receipt.problem === entry.problem && receipt.planSha256 === context.planSha256
    && receipt.packSha256 === entry.sha256, 'calibration-receipt-binding');
  for (const [name, expected] of Object.entries(binding)) assert.equal(receipt[name], expected, 'calibration-task-binding-drift:' + name);
  const workspace = join(directory, phase), outDir = join(directory, phase + '-grade');
  assert.deepEqual(read(join(directory, phase + '-started.json')), { phase, problem: entry.problem,
    planSha256: context.planSha256 }, 'calibration-phase-start-binding');
  assert.equal(await sha(join(directory, phase + '-started.json')), receipt.startedSha256, 'calibration-phase-start-drift');
  const grade = read(join(outDir, 'grade.json'));
  assert.equal(await sha(join(outDir, 'grade.json')), receipt.gradeSha256, 'calibration-grade-drift');
  const verdict = calibrationVerdict(phase, grade);
  assert.equal(receipt.verdict, verdict, 'calibration-verdict-drift');
  for (const [index] of grade.executions.entries()) for (const stream of ['stdout', 'stderr'])
    assert.equal(await sha(join(outDir, String(index + 1).padStart(2, '0') + '-' + stream + '.log')),
      receipt.logsSha256[index][stream], 'calibration-raw-log-drift');
  assert.deepEqual(await evidenceInventory(join(workspace, context.evidenceDirectory)), receipt.evidenceFilesSha256,
    'calibration-native-evidence-drift');
  const path = join(workspace, 'stdio-report.json');
  assert.equal(existsSync(path) ? await sha(path) : null, receipt.reportSha256, 'calibration-report-drift');
  const report = existsSync(path) ? read(path) : null;
  const workerVersion = context.supplemental ? 'RsiIsolatedPythonWorker/v1' : 'RsiNativeCheckerWorker/v2';
  if (verdict === 'infrastructure' && report?.workerReportVersion !== workerVersion) return verdict;
  if (verdict !== 'infrastructure') verifyGuidedOracleArtifact(registry.tasks[0], grade, outDir);
  if (phase === 'reference') assert.equal(report.sourceSha256, entry.referenceSha256, 'calibration-reference-source');
  const replay = spawnSync('python', ['-B', join(context.root, context.supplemental ? 'scripts/rsi-isolated-python-replay.py' : 'scripts/rsi-native-checker-replay.py'),
    '--workspace', workspace, '--report', join(workspace, 'stdio-report.json'),
    '--worker-sha256', context.plan.sourceFilesSha256[context.supplemental ? 'scripts/rsi-isolated-python-worker.py' : 'scripts/rsi-native-checker-worker.py'],
    ...(context.supplemental ? ['--shared-worker-sha256', context.plan.sourceFilesSha256['scripts/rsi-native-checker-worker.py']] : [])],
  { encoding: 'utf8', timeout: 60000, maxBuffer: 1048576, windowsHide: true,
    env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp', PYTHONIOENCODING: 'utf-8' } });
  assert(!replay.error && replay.status === 0, 'calibration-independent-replay:' + (replay.stderr || replay.error?.message));
  const result = JSON.parse(replay.stdout);
  if (context.supplemental) assert(result.caseId === registry.tasks[0].id && result.passed === grade.passed,
    'calibration-independent-verdict');
  else assert(result.modelRequests === 0 && result.result.caseId === registry.tasks[0].id
    && result.result.passed === grade.passed, 'calibration-independent-verdict');
  return verdict;
}

async function memoryGate(context, output, completed) {
  while (freemem() < context.plan.minimumSystemAvailableBytes) {
    if (existsSync(join(output, 'pause-after-family'))) return false;
    log({ status: 'waiting-for-memory', completed, availableBytes: freemem() });
    await sleep(15000);
  }
  return !existsSync(join(output, 'pause-after-family'));
}

export async function calibrateLibraryChecker({ root = ROOT, inputs, output, verifyOnly = false }) {
  root = resolve(root); inputs = resolve(inputs); output = resolve(output);
  const context = await loadCalibrationInputs(root, inputs);
  await verifyExecutor(context);
  const started = { schemaVersion: context.batchVersion, driven_by: 'agent',
    actor: 'codex/rsi-library-checker-calibration', realHumanEvidence: false, modelRequests: 0,
    usage: 'scripted-control', formalAdmission: false, benefit: 'NO_GO', adoption: 'hold',
    planSha256: context.planSha256, inputsSha256: context.inputsSha256, sourceCommit: context.plan.sourceCommit,
    nodeOldSpaceMiB: 384, nodeHeapLimitBytes: getHeapStatistics().heap_size_limit };
  if (existsSync(output)) assert.deepEqual(read(file(output, 'started.json')), started, 'calibration-started-plan-drift');
  else { assert(!verifyOnly, 'calibration-run-missing'); mkdirSync(output, { recursive: true }); write(join(output, 'started.json'), started); }
  assertCalibrationPrefix(output, context.selection);
  const results = [];
  let status = 'running';
  const publish = () => {
    const qualified = results.filter(row => row.qualified);
    const completed = new Set(results.filter(row => row.phases.length === PHASES.length
      && row.phases.every(phase => phase.verdict !== 'infrastructure')).map(row => row.problem));
    const pendingFamilies = new Set(context.prepared.cases.filter(row => !completed.has(row.problem)).map(row => row.familyId));
    const report = { ...started, status,
      plannedFamilies: context.supplemental ? new Set(context.prepared.cases.map(row => row.familyId)).size : context.prepared.cases.length,
      completedFamilies: context.supplemental ? new Set(results.filter(row => !pendingFamilies.has(row.familyId)).map(row => row.familyId)).size : results.length,
      qualifiedFamilies: context.supplemental ? new Set(qualified.map(row => row.familyId)).size : qualified.length,
      ...(context.supplemental ? { plannedSources: context.prepared.cases.length, completedSources: completed.size,
        qualifiedSources: qualified.length } : {}), results };
    if (!verifyOnly) {
      const temporary = join(output, 'progress.next.json');
      assert(!existsSync(temporary), 'calibration-unsettled-progress-write');
      write(temporary, report); renameSync(temporary, join(output, 'progress.json'));
    }
    return report;
  };
  if (existsSync(join(output, 'infrastructure.json'))) {
    assert(verifyOnly, 'calibration-original-infrastructure-requires-new-plan');
    const diagnostic = read(join(output, 'infrastructure.json'));
    assert.equal(diagnostic.planSha256, context.planSha256, 'calibration-infrastructure-plan-drift');
    if (!diagnostic.phase) return { ...started, status: 'infrastructure', diagnostic };
  }
  if (!verifyOnly) publish();
  try {
  for (const [index, entry] of context.prepared.cases.entries()) {
    const directory = join(output, String(index).padStart(3, '0') + '-' + entry.problem);
    if (!existsSync(directory)) {
      if (verifyOnly || !await memoryGate(context, output, results.length)) { status = 'resource-paused'; break; }
      await verifyExecutor(context);
      assert.equal(await sha(file(inputs, entry.path)), entry.sha256, 'calibration-input-drift');
      mkdirSync(directory);
      write(join(directory, 'materialization-started.json'), { problem: entry.problem, packSha256: entry.sha256, planSha256: context.planSha256 });
      // Release the large pack before grading/replay loads another private oracle.
      let pack = JSON.parse(gunzipSync(readFileSync(file(inputs, entry.path))).toString('utf8'));
      assert(pack.cases.length === 1 && pack.cases[0].id === (context.supplemental ? entry.problem : 'library-' + entry.problem), 'calibration-case-identity');
      assert(pack.cases[0].vectors.length === entry.vectors
        && createHash('sha256').update(pack.cases[0].reference).digest('hex') === entry.referenceSha256, 'calibration-frozen-source-vectors');
      if (context.supplemental) assert(pack.cases[0].privatePython?.pythonVersion === context.plan.pythonVersion
        && pack.cases[0].familyId === entry.familyId && pack.cases[0].provenance.sourceKey === entry.sourceKey,
      'calibration-frozen-python-family');
      const registry = createStdioTasks(directory, pack);
      verifyStdioTasks(registry, pack);
      assert.equal(registry.packDigest, entry.packDigest, 'calibration-pack-digest');
      pack = null;
      write(join(directory, 'registry.json'), registry);
      write(join(directory, 'started.json'), { problem: entry.problem, packSha256: entry.sha256,
        planSha256: context.planSha256, registrySha256: await sha(join(directory, 'registry.json')), registryCommit: registry.registryCommit });
    }
    assert(existsSync(join(directory, 'started.json')), 'calibration-unsettled-case-materialization');
    const caseStarted = read(join(directory, 'started.json'));
    assert(caseStarted.problem === entry.problem && caseStarted.packSha256 === entry.sha256
      && caseStarted.planSha256 === context.planSha256, 'calibration-case-start-drift');
    assert.equal(await sha(join(directory, 'registry.json')), caseStarted.registrySha256, 'calibration-registry-drift');
    const registry = read(join(directory, 'registry.json'));
    assert.equal(registry.registryCommit, caseStarted.registryCommit, 'calibration-registry-commit-drift');
    assert.equal(registry.packDigest, entry.packDigest, 'calibration-registry-pack');
    for (const [name, expected] of Object.entries(registry.tasks[0].oracle.inputDigests))
      assert.equal(await sha(file(registry.repository, name)), expected, 'calibration-private-oracle-drift');
    const task = resolveHistoricalTask(registry.repository, registry.tasks[0].id, { codingCohort: true });
    const binding = await calibrationRegistryBinding(directory, registry, task);
    const phases = [];
    for (const phase of PHASES) {
      const receiptPath = join(directory, phase + '-receipt.json');
      if (!existsSync(receiptPath)) {
        assertUnstartedCalibrationPhase(directory, phase);
        if (verifyOnly || !await memoryGate(context, output, results.length)) { status = 'resource-paused'; break; }
        await verifyExecutor(context);
        write(join(directory, phase + '-started.json'), { phase, problem: entry.problem, planSha256: context.planSha256 });
        const workspace = join(directory, phase), outDir = join(directory, phase + '-grade');
        await prepareStdioGradeWorkspace({ root: registry.repository, task, workspace,
          revision: phase === 'baseline' ? task.base : task.ref,
          edits: phase === 'no-output' ? [{ path: task.input.targetScope[0],
            content: context.supplemental ? 'pass\n' : 'int main(){return 0;}\n' }] : [] });
        const grade = await runLiveTaskOracles({ root, task, workspace, outDir,
          timeoutMs: codingCollectorConfig(registry.collectorVersion).oracleTimeoutMs });
        write(join(outDir, 'grade.json'), grade);
        const verdict = calibrationVerdict(phase, grade);
        const logsSha256 = [];
        for (const [index] of grade.executions.entries()) logsSha256.push({
          stdout: await sha(join(outDir, String(index + 1).padStart(2, '0') + '-stdout.log')),
          stderr: await sha(join(outDir, String(index + 1).padStart(2, '0') + '-stderr.log')) });
        write(receiptPath, { schemaVersion: context.phaseVersion, driven_by: 'agent',
          actor: 'codex/rsi-library-checker-calibration', realHumanEvidence: false, modelRequests: 0,
          ...binding,
          phase, problem: entry.problem, planSha256: context.planSha256, packSha256: entry.sha256, verdict,
          startedSha256: await sha(join(directory, phase + '-started.json')), gradeSha256: await sha(join(outDir, 'grade.json')),
          reportSha256: existsSync(join(workspace, 'stdio-report.json')) ? await sha(join(workspace, 'stdio-report.json')) : null,
          logsSha256, evidenceFilesSha256: await evidenceInventory(join(workspace, context.evidenceDirectory)) });
      }
      const receipt = read(receiptPath);
      phases.push({ phase, verdict: await verifyPhase(context, entry, registry, directory, phase, receipt, binding),
        receiptSha256: await sha(receiptPath) });
      if (phases.at(-1).verdict === 'infrastructure') {
        status = 'infrastructure';
        if (!verifyOnly && !existsSync(join(output, 'infrastructure.json')))
          write(join(output, 'infrastructure.json'), { ...started, problem: entry.problem, phase,
            directory, receiptSha256: await sha(receiptPath) });
        break;
      }
    }
    if (phases.length === PHASES.length || status === 'infrastructure') {
      results.push({ problem: entry.problem, directory, phases,
        ...(context.supplemental ? { familyId: entry.familyId, sourceKey: entry.sourceKey } : {}),
        qualified: phases.length === 3 && phases[1].verdict === 'reference-pass' && phases[2].verdict === 'negative-control-rejected' });
      log({ status, completed: results.length, planned: context.prepared.cases.length, problem: entry.problem,
        qualified: results.at(-1).qualified });
    }
    publish();
    if (status !== 'running') break;
  }
  if (status === 'running') status = results.length === context.prepared.cases.length ? 'complete' : 'resource-paused';
  return publish();
  } catch (error) {
    if (!verifyOnly && !existsSync(join(output, 'infrastructure.json')))
      write(join(output, 'infrastructure.json'), { ...started, error: { name: error.name, code: error.code ?? null, message: error.message } });
    throw error;
  }
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { inputs: { type: 'string' }, output: { type: 'string' }, verify: { type: 'boolean' } } });
  assert(values.inputs && values.output, 'calibration-inputs-output-required');
  calibrateLibraryChecker({ inputs: values.inputs, output: values.output, verifyOnly: values.verify === true })
    .then(report => { log({ status: report.status, completed: report.completedFamilies, qualified: report.qualifiedFamilies });
      if (report.status === 'infrastructure') process.exitCode = 1; })
    .catch(error => { log({ status: 'infrastructure', error: { name: error.name, code: error.code ?? null, message: error.message } });
      process.exitCode = 1; });
}
