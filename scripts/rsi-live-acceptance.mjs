#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { buildResponsesRequest, createResponsesProvider } from './lib/rsi-responses-provider.mjs';
import { artifactPath } from './lib/agent-first-trials.mjs';
import { sha256File } from './rsi-tf0604-baseline.mjs';
import { CODING_BINDINGS_PATH, resolveHistoricalTask } from './lib/rsi-live-grader.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const referenceTestDigestCache = new Map();
const productChangeCache = new Map();
function referenceTestDigest(root, revision, path) {
  const key = `${resolve(root)}\0${revision}\0${path}`;
  if (referenceTestDigestCache.has(key)) return referenceTestDigestCache.get(key);
  const value = sha(execFileSync('git', ['-C', root, 'show', `${revision}:${path}`], { windowsHide: true }));
  referenceTestDigestCache.set(key, value);
  return value;
}
function historicalProductChanges(root, base, reference) {
  const key = `${resolve(root)}\0${base}\0${reference}`;
  if (productChangeCache.has(key)) return productChangeCache.get(key);
  const changed = execFileSync('git', ['-C', root, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--no-renames', base, reference], {
    windowsHide: true,
    encoding: 'utf8',
  }).trim().split(/\r?\n/u).filter(Boolean);
  const productChanges = changed.filter((path) => /^(scripts|src|electron|shared|openclaw_runtime\/src)\//u.test(path)
    && !/\.test\.[cm]?[jt]sx?$|\/tests\//u.test(path));
  productChangeCache.set(key, productChanges);
  return productChanges;
}
function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

/** Restore omitted revision identities from original evidence, never infer a parent. */
export function codingCohortFor(root, directory) {
  const path = join(directory, 'task-bindings.json');
  if (!existsSync(path)) return false;
  assert.equal(sha(readFileSync(path)), sha(readFileSync(join(root, CODING_BINDINGS_PATH))), 'coding-cohort-binding-drift');
  return true;
}

export function inspectLiveCorpus(root = ROOT, { codingCohort = false } = {}) {
  const corpus = read(join(root, CORPUS));
  return corpus.tasks.map((task) => {
    const original = read(join(root, task.referenceSolution.sourceRecord));
    const base = original.candidate?.base, reference = original.candidate?.commit;
    assert(/^[0-9a-f]{40}$/u.test(base ?? '') && /^[0-9a-f]{40}$/u.test(reference ?? ''), `missing-task-revision:${task.id}`);
    const productChanges = historicalProductChanges(root, base, reference);
    const definition = codingCohort ? resolveHistoricalTask(root, task.id, { codingCohort }) : null;
    return { id: task.id, base, reference, productChanges, originalDecision: original.decision?.status ?? null,
      ...(codingCohort ? { codingBindingDigest: sha(readFileSync(join(root, CODING_BINDINGS_PATH))),
        baselineSetup: definition.baselineSetup ?? null, targetScope: definition.input.targetScope, prompt: definition.input.prompt } : {}),
      sourceRecord: task.referenceSolution.sourceRecord,
      sourceRecordDigest: sha256File(join(root, task.referenceSolution.sourceRecord)),
      oraclePaths: task.oracle.testPaths, commands: task.oracle.commandLines };
  });
}

export async function probeLiveResource({ directory, endpoint, model, apiKey, campaignLedger }) {
  assert(!existsSync(join(directory, 'provider-preflight.json')), 'preflight-already-recorded');
  const start = Date.now();
  const marker = 'RSI_PROVIDER_READY';
  const request = { instructions: 'Reply with the exact marker only.', input: marker };
  let result;
  try {
    const provider = createResponsesProvider({ endpoint, model, apiKey, maxOutputTokens: 512, timeoutMs: 45000, reasoningEffort: 'low' });
    const reservation = campaignLedger ? await campaignLedger.reserve(buildResponsesRequest({ model, ...request,
      maxOutputTokens: 512, reasoningEffort: 'low' }), 'provider-preflight') : null;
    let receipt;
    try { receipt = await provider(request); }
    finally { if (reservation) campaignLedger.settle(reservation, receipt); }
    result = { driven_by: 'agent', actor: 'codex/rsi-live-preflight', scope: 'provider admission; not a task outcome',
      startedAt: new Date(start).toISOString(), durationMs: Date.now() - start,
      passed: receipt.response.status === 'completed' && receipt.response.text.trim() === marker && receipt.response.usage !== null,
      ...receipt };
  } catch (caught) {
    result = { driven_by: 'agent', actor: 'codex/rsi-live-preflight', scope: 'provider admission; not a task outcome',
      startedAt: new Date(start).toISOString(), durationMs: Date.now() - start, passed: false,
      error: caught.message.split(apiKey).join('[REDACTED]') };
  }
  write(join(directory, 'provider-preflight.json'), JSON.parse(JSON.stringify(result).split(apiKey).join('[REDACTED]')));
  return result;
}

/** A reference must pass and its unresolved base must fail before a paid trial. */
export function assessTaskAdmission({ reference, baseline }) {
  const issues = [];
  const counted = (report) => {
    if (!Array.isArray(report?.testResults)) return false;
    const assertions = report.testResults.flatMap((suite) => Array.isArray(suite.assertionResults) ? suite.assertionResults : []);
    return assertions.length > 0 && assertions.length === report.numTotalTests
      && assertions.filter((entry) => entry.status === 'passed').length === report.numPassedTests
      && assertions.filter((entry) => entry.status === 'failed').length === report.numFailedTests;
  };
  const complete = (stage) => stage && stage.oracleUnchanged === true && Array.isArray(stage.commands) && stage.commands.length > 0
    && Array.isArray(stage.executions) && stage.executions.length === stage.commands.length
    && stage.executions.every((entry, index) => entry.command === stage.commands[index] && Number.isInteger(entry.exitCode)
      && !entry.timedOut && entry.error === null && entry.report);
  const referencePassed = complete(reference) && reference.executions.every((entry) => entry.exitCode === 0
    && (entry.kind === 'command' || counted(entry.report) && entry.report?.success === true && entry.report.numTotalTests > 0
      && entry.report.numPassedTests === entry.report.numTotalTests && entry.report.numFailedTests === 0 && entry.report.numPendingTests === 0
      && (entry.report.numSkippedTests ?? 0) === 0 && (entry.report.numTodoTests ?? 0) === 0));
  const referenceMissing = reference?.diagnostics?.filter((entry) => entry?.kind === 'missing-module') ?? [];
  const baselineMissing = baseline?.diagnostics?.filter((entry) => entry?.kind === 'missing-module') ?? [];
  const baselineMissingTarget = baseline && baseline.passed === false && complete(baseline)
    && baselineMissing.length > 0 && baselineMissing.every((entry) => entry.inTargetScope === true);
  const baselineMissingInfrastructure = baselineMissing.some((entry) => entry.inTargetScope !== true);
  if (!referencePassed || reference?.passed !== true) {
    if (reference?.failureClass === 'oracle-input-drift') issues.push('reference-oracle-input-drift');
    else if (reference?.failureClass === 'infrastructure' || referenceMissing.some((entry) => entry.inTargetScope !== true)) {
      issues.push('reference-infrastructure-failure');
    } else if ((!complete(reference) && !(reference?.failureClass === 'assertion' || reference?.failureClass === 'target-module-absent'))
      || reference?.timedOut === true || reference?.executions?.some((entry) => entry?.timedOut === true || entry?.error !== null)) {
      issues.push('reference-infrastructure-failure');
    } else issues.push('reference-oracle-not-passing');
  }
  if (!baseline) issues.push('unresolved-baseline-not-executed');
  else if (baseline.passed === true) issues.push('baseline-already-passes');
  else if (!complete(baseline)
    || (!baselineMissingTarget
      && !baseline.executions?.some((entry) => entry.exitCode !== 0 && counted(entry.report) && entry.report?.numFailedTests > 0))) {
    if (baseline.failureClass === 'oracle-input-drift') issues.push('baseline-oracle-input-drift');
    else if (baseline.failureClass === 'infrastructure' || baselineMissingInfrastructure) issues.push('baseline-infrastructure-failure');
    else if (baseline.timedOut === true || baseline.executions?.some((entry) => entry?.timedOut === true || entry?.error !== null)) issues.push('baseline-infrastructure-failure');
    else issues.push('baseline-has-no-gradeable-failure');
  }
  const result = { passed: issues.length === 0, issues };
  if (result.passed && baselineMissingTarget) result.warnings = ['baseline-target-module-absent'];
  return result;
}

export function finalizeLiveAdmission(root, directory, options = {}) {
  const codingCohort = codingCohortFor(root, directory);
  const tasks = inspectLiveCorpus(root, { codingCohort });
  assert.equal(tasks.length, 24, 'live-admission-corpus-size');
  const admissions = tasks.map((task) => {
    const path = join(directory, 'calibration', task.id, 'admission.json');
    if (!existsSync(path)) return { taskId: task.id, passed: false, status: 'not-calibrated', issues: ['task-not-calibrated'] };
    const retained = read(path);
    assert.deepEqual(retained.source, task, 'calibration-source-drift');
    for (const stageName of ['reference', 'baseline']) {
      const stage = retained.stages?.[stageName];
      if (codingCohort) {
        assert.deepEqual(stage?.baselineSetup ?? null, task.baselineSetup, 'calibration-baseline-setup-drift');
        for (const support of stage?.supportPackages ?? []) {
          assert.equal(support.declaredVersion, support.resolvedVersion, 'calibration-support-version-drift');
        }
        assert(Array.isArray(stage?.supportPackages), 'calibration-support-metadata-missing');
      }
      assert.equal(stage?.oracleRevision, task.reference, 'calibration-oracle-revision-drift');
      for (const testPath of task.oraclePaths) {
        const expectedDigest = referenceTestDigest(root, task.reference, testPath);
        assert.equal(stage?.oracleTestDigests?.[testPath], expectedDigest, 'calibration-oracle-digest-drift');
      }
    }
    const admission = assessTaskAdmission({ reference: retained.stages.reference, baseline: retained.stages.baseline });
    assert.deepEqual(retained.admission, admission, 'admission-recomputation');
    return { taskId: task.id, ...admission, status: admission.passed ? 'admitted' : 'rejected', admissionDigest: sha(readFileSync(path)) };
  });
  const tasksAdmitted = admissions.every((task) => task.passed);
  let provider = { status: tasksAdmitted ? 'missing' : 'not-evaluated', receipt: 'provider-preflight.json', responseId: null, usage: null };
  let providerPassed = false;
  if (tasksAdmitted) {
    const path = join(directory, 'provider-preflight.json');
    if (existsSync(path)) {
      try {
        const receipt = read(path);
        providerPassed = receipt?.driven_by === 'agent' && typeof receipt.actor === 'string' && receipt.actor.trim().length > 0
          && receipt.passed === true && receipt.response?.status === 'completed' && receipt.response?.usage !== null
          && typeof receipt.response?.usage === 'object'
          && receipt.request?.url === 'http://127.0.0.1:3065/v1/responses'
          && receipt.request?.body?.model === 'space-bunny'
          && receipt.response?.model === 'space-bunny';
        provider = { status: providerPassed ? 'ready' : 'failed', receipt: 'provider-preflight.json',
          responseId: receipt.response?.id ?? null, usage: receipt.response?.usage ?? null };
      } catch {
        provider = { status: 'invalid', receipt: 'provider-preflight.json', responseId: null, usage: null };
      }
    }
  }
  const passed = tasksAdmitted && providerPassed;
  const result = { schemaVersion: 'RsiLiveAdmissionReport/v1', driven_by: 'agent', actor: 'codex/rsi-admission-verifier',
    status: passed ? 'ready-for-measurement' : 'NO_GO', admissions, provider,
    trialSlots: tasks.flatMap((task) => [1, 2, 3].flatMap((repeat) => ['sekb-off', 'sekb-shadow', 'sekb-confirmed'].map((arm) => ({
      taskId: task.id, repeat, arm, status: 'not-run',
      reason: passed ? 'measurement-not-started' : !tasksAdmitted ? 'task-admission-not-satisfied' : 'provider-admission-not-satisfied',
    })))),
    claims: { taskQualityMeasured: false, benefit: false, promotionReady: false, realHuman: false, productLocksChanged: false } };
  if (options.write !== false) write(join(directory, 'admission-report.json'), result);
  return result;
}export function checkLiveAcceptance(root, directory) {
  const errors = [];
  let report;
  try {
    const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const full = artifactPath(directory, relative(directory, join(path, entry.name)));
      return entry.isDirectory() ? walk(full) : [relative(directory, full).replaceAll('\\', '/')];
    });
    const files = walk(directory).filter((path) => path !== 'SHA256SUMS').sort();
    const expected = files.map((path) => `${sha(readFileSync(join(directory, path)))}  ${path}`).join('\n') + '\n';
    assert.equal(readFileSync(artifactPath(directory, 'SHA256SUMS'), 'utf8'), expected, 'acceptance-manifest-drift');
    report = finalizeLiveAdmission(root, directory, { write: false });
    assert.deepEqual(read(artifactPath(directory, 'admission-report.json')), report, 'acceptance-recomputation');
    for (const task of report.admissions.filter((entry) => entry.status !== 'not-calibrated')) {
      const admission = read(artifactPath(directory, `calibration/${task.taskId}/admission.json`));
      for (const stage of ['reference', 'baseline']) {
        for (const [index, execution] of (admission.stages[stage].executions ?? []).entries()) {
          if (execution.kind !== 'vitest' || execution.report === null) continue;
          assert.deepEqual(read(artifactPath(directory, `calibration/${task.taskId}/${stage}/oracle-${index + 1}.json`)),
            execution.report, 'raw-calibration-report-drift');
        }
      }
    }
    const summaryPath = join(directory, 'result.v1.json');
    if (existsSync(summaryPath)) {
      const summary = read(summaryPath);
      assert.equal(summary.status, report.status, 'summary-status-drift');
      assert.equal(summary.trialExecution?.executed, 0, 'unexecuted-trials-claimed');
      assert.equal(summary.trialExecution?.unexecuted, report.trialSlots.length, 'summary-slot-count-drift');
      assert(Object.values(summary.claims ?? {}).length === 6 && Object.values(summary.claims).every((value) => value === false), 'summary-claim-boundary');
      for (const [path, digest] of Object.entries(summary.candidate?.sourceHashes ?? {})) {
        const bytes = execFileSync('git', ['show', `${summary.candidate.commit}:${path}`], { cwd: root, windowsHide: true });
        assert.equal(sha(bytes), digest, 'summary-source-commit-drift');
      }
    }
  } catch (caught) { errors.push(caught.message); }
  return { passed: errors.length === 0, errors, acceptanceStatus: report?.status ?? 'invalid',
    measuredTaskTrials: 0, unexecutedSlots: report?.trialSlots.length ?? null, benefitClaim: false };
}

export async function calibrateLiveTask(root, directory, taskId, options = {}) {
  const { prepareGradeWorkspace, resolveHistoricalTask, runLiveTaskOracles } = await import('./lib/rsi-live-grader.mjs');
  const target = join(directory, 'calibration', taskId);
  assert(!existsSync(target), 'calibration-already-exists');
  if (options.codingCohort && !existsSync(join(directory, 'task-bindings.json'))) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'task-bindings.json'), readFileSync(join(root, CODING_BINDINGS_PATH)), { flag: 'wx' });
  }
  const codingCohort = codingCohortFor(root, directory);
  const task = resolveHistoricalTask(root, taskId, { codingCohort });
  const source = inspectLiveCorpus(root, { codingCohort }).find((entry) => entry.id === taskId);
  assert(source, 'unknown-task');
  mkdirSync(target, { recursive: true });
  write(join(target, 'identity.json'), source);
  const stages = {};
  for (const [name, revision] of [['reference', source.reference], ['baseline', source.base]]) {
    const workspace = join(target, name, 'workspace');
    try {
      await prepareGradeWorkspace({ root, task, workspace, revision });
      stages[name] = await runLiveTaskOracles({ root, task, workspace, outDir: join(target, name, 'oracle'),
        timeoutMs: options.timeoutMs ?? 120000, supportRoot: options.supportRoot });
    } catch (caught) {
      const failureClass = /^frozen oracle digest mismatch:/u.test(caught.message) ? 'oracle-input-drift' : 'infrastructure';
      stages[name] = { passed: false, failureClass, error: caught.message, executions: [], diagnostics: [] };
    }
  }
  const admission = assessTaskAdmission({ reference: stages.reference, baseline: stages.baseline });
  const result = { schemaVersion: 'RsiLiveTaskAdmission/v1', driven_by: 'agent', actor: 'codex/rsi-independent-calibrator',
    taskId, source, stages, admission, claims: { modelQuality: false, benefit: false, realHuman: false } };
  write(join(target, 'admission.json'), result);
  return result;
}

if (isMainEntrypoint(import.meta.url)) {
  try {
    const { positionals, values } = parseArgs({ allowPositionals: true, options: {
      'run-dir': { type: 'string' }, 'task-id': { type: 'string' }, endpoint: { type: 'string' }, model: { type: 'string' },
      'timeout-ms': { type: 'string' },
      'coding-cohort': { type: 'boolean' }, 'support-root': { type: 'string' },
    } });
    assert(values['run-dir'], '--run-dir required');
    const requestedDirectory = resolve(values['run-dir']);
    const directory = existsSync(requestedDirectory) ? realpathSync(requestedDirectory) : requestedDirectory;
    assert(/^[dD]:[\\/]/u.test(directory), 'live scratch must stay on D:');
    mkdirSync(directory, { recursive: true });
    let result;
    if (positionals[0] === 'inventory') {
      result = { driven_by: 'agent', actor: 'codex/rsi-live-inventory', tasks: inspectLiveCorpus(ROOT) };
      write(join(directory, 'task-inventory.json'), result);
    } else if (positionals[0] === 'probe') {
      let input = ''; for await (const chunk of process.stdin) input += chunk;
      const { key } = JSON.parse(input); input = '';
      assert(typeof key === 'string' && key.length > 0, 'stdin credential required');
      result = await probeLiveResource({ directory, endpoint: values.endpoint ?? 'http://127.0.0.1:3065/v1/responses', model: values.model ?? 'space-bunny', apiKey: key });
      result = { passed: result.passed, scope: result.scope, responseId: result.response?.id ?? null, usage: result.response?.usage ?? null, error: result.error ?? null };
    } else if (positionals[0] === 'calibrate') {
      assert(values['task-id'], '--task-id required');
      const resultOnDisk = await calibrateLiveTask(ROOT, directory, values['task-id'], { timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : undefined,
        codingCohort: values['coding-cohort'], supportRoot: values['support-root'] });
      result = { passed: resultOnDisk.admission.passed, taskId: resultOnDisk.taskId, admission: resultOnDisk.admission,
        referencePassed: resultOnDisk.stages.reference.passed, baselinePassed: resultOnDisk.stages.baseline.passed };
    } else if (positionals[0] === 'finalize') result = finalizeLiveAdmission(ROOT, directory);
    else if (positionals[0] === 'check') result = checkLiveAcceptance(ROOT, directory);
    else throw new Error('Use inventory, probe, calibrate, finalize or check');
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed === false || result.status === 'NO_GO' ? 1 : 0;
  } catch (caught) { console.error(caught.message); process.exitCode = 1; }
}
