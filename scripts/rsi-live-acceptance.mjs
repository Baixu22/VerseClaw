#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { createResponsesProvider } from './lib/rsi-responses-provider.mjs';
import { artifactPath } from './lib/agent-first-trials.mjs';
import { sha256File } from './rsi-tf0604-baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = 'harness/specs/fixtures/agent-first-task-corpus/task-corpus.v1.json';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

/** Restore omitted revision identities from original evidence, never infer a parent. */
export function inspectLiveCorpus(root = ROOT) {
  const corpus = read(join(root, CORPUS));
  return corpus.tasks.map((task) => {
    const original = read(join(root, task.referenceSolution.sourceRecord));
    const base = original.candidate?.base, reference = original.candidate?.commit;
    assert(/^[0-9a-f]{40}$/u.test(base ?? '') && /^[0-9a-f]{40}$/u.test(reference ?? ''), `missing-task-revision:${task.id}`);
    const changed = execFileSync('git', ['diff', '--name-only', base, reference], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim().split(/\r?\n/u).filter(Boolean);
    const productChanges = changed.filter((path) => /^(scripts|src|electron|shared|openclaw_runtime\/src)\//u.test(path)
      && !/\.test\.[cm]?[jt]sx?$|\/tests\//u.test(path));
    return { id: task.id, base, reference, productChanges, originalDecision: original.decision?.status ?? null,
      sourceRecord: task.referenceSolution.sourceRecord,
      sourceRecordDigest: sha256File(join(root, task.referenceSolution.sourceRecord)),
      oraclePaths: task.oracle.testPaths, commands: task.oracle.commandLines };
  });
}

export async function probeLiveResource({ directory, endpoint, model, apiKey }) {
  assert(!existsSync(join(directory, 'provider-preflight.json')), 'preflight-already-recorded');
  const start = Date.now();
  const marker = 'RSI_PROVIDER_READY';
  const request = { instructions: 'Reply with the exact marker only.', input: marker };
  let result;
  try {
    const provider = createResponsesProvider({ endpoint, model, apiKey, maxOutputTokens: 64, timeoutMs: 45000 });
    const receipt = await provider(request);
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
  if (!referencePassed || reference.passed !== true) issues.push('reference-oracle-not-passing');
  if (!baseline) issues.push('unresolved-baseline-not-executed');
  else if (baseline.passed === true) issues.push('baseline-already-passes');
  else if (!complete(baseline)
    || !baseline.executions.some((entry) => entry.exitCode !== 0 && counted(entry.report) && entry.report?.numFailedTests > 0)) issues.push('baseline-has-no-gradeable-failure');
  return { passed: issues.length === 0, issues };
}

export function finalizeLiveAdmission(root, directory, options = {}) {
  const tasks = inspectLiveCorpus(root);
  const admissions = tasks.map((task) => {
    const path = join(directory, 'calibration', task.id, 'admission.json');
    if (!existsSync(path)) return { taskId: task.id, passed: false, status: 'not-calibrated', issues: ['task-not-calibrated'] };
    const retained = read(path);
    assert.deepEqual(retained.source, task, 'calibration-source-drift');
    const admission = assessTaskAdmission({ reference: retained.stages.reference, baseline: retained.stages.baseline });
    assert.deepEqual(retained.admission, admission, 'admission-recomputation');
    return { taskId: task.id, ...admission, status: admission.passed ? 'admitted' : 'rejected', admissionDigest: sha(readFileSync(path)) };
  });
  const passed = admissions.every((task) => task.passed);
  const result = { schemaVersion: 'RsiLiveAdmissionReport/v1', driven_by: 'agent', actor: 'codex/rsi-admission-verifier',
    status: passed ? 'ready-for-measurement' : 'NO_GO', admissions,
    trialSlots: tasks.flatMap((task) => [1, 2, 3].flatMap((repeat) => ['sekb-off', 'sekb-shadow', 'sekb-confirmed'].map((arm) => ({
      taskId: task.id, repeat, arm, status: 'not-run', reason: passed ? 'measurement-not-started' : 'task-admission-not-satisfied',
    })))),
    claims: { taskQualityMeasured: false, benefit: false, promotionReady: false, realHuman: false, productLocksChanged: false } };
  if (options.write !== false) write(join(directory, 'admission-report.json'), result);
  return result;
}

export function checkLiveAcceptance(root, directory) {
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
  const task = resolveHistoricalTask(root, taskId);
  const source = inspectLiveCorpus(root).find((entry) => entry.id === taskId);
  assert(source, 'unknown-task');
  mkdirSync(target, { recursive: true });
  write(join(target, 'identity.json'), source);
  const stages = {};
  for (const [name, revision] of [['reference', source.reference], ['baseline', source.base]]) {
    const workspace = join(target, name, 'workspace');
    try {
      await prepareGradeWorkspace({ root, task, workspace, revision });
      stages[name] = await runLiveTaskOracles({ root, task, workspace, outDir: join(target, name, 'oracle'), timeoutMs: options.timeoutMs ?? 120000 });
    } catch (caught) {
      stages[name] = { passed: false, failureClass: 'infrastructure', error: caught.message, executions: [] };
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
    } });
    assert(values['run-dir'], '--run-dir required');
    const directory = resolve(values['run-dir']);
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
      const resultOnDisk = await calibrateLiveTask(ROOT, directory, values['task-id'], { timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : undefined });
      result = { passed: resultOnDisk.admission.passed, taskId: resultOnDisk.taskId, admission: resultOnDisk.admission,
        referencePassed: resultOnDisk.stages.reference.passed, baselinePassed: resultOnDisk.stages.baseline.passed };
    } else if (positionals[0] === 'finalize') result = finalizeLiveAdmission(ROOT, directory);
    else if (positionals[0] === 'check') result = checkLiveAcceptance(ROOT, directory);
    else throw new Error('Use inventory, probe, calibrate, finalize or check');
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed === false || result.status === 'NO_GO' ? 1 : 0;
  } catch (caught) { console.error(caught.message); process.exitCode = 1; }
}
