#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statfsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { aggregateReliability, RELIABILITY_TRIAL_OUTCOMES } from './lib/reliability-aggregation.mjs';
import { pairedEffect } from './lib/paired-ablation.mjs';
import { sha256File, TF0604_PACK_DIR } from './rsi-tf0604-baseline.mjs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TF0592_PACK_DIR = 'harness/specs/fixtures/rsi-evidence-loop/tf0592';
const ACTOR = 'codex/rsi-tf0592-executor';
const K = 3;
const MIN_CASES = 20;
const FAILURE_CLASSES = ['infrastructure', 'task', 'grader', 'agent'];
const INPUT_PATHS = {
  corpus: `${TF0604_PACK_DIR}/task-corpus.v1.json`,
  rawTrials: `${TF0604_PACK_DIR}/raw-trials.v1.json`,
  policy: 'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v1.json',
};
const FILES = {
  resource: 'resource-fingerprint.v1.json',
  report: 'statistical-report.v1.json',
  controls: 'negative-controls.v1.json',
  controlResults: 'negative-control-results.v1.json',
  validation: 'validation-report.v1.json',
};
const SOURCE_PATHS = [
  'scripts/rsi-tf0592-statistical-adjudication.mjs',
  'scripts/rsi-tf0592-statistical-adjudication.d.mts',
  'scripts/rsi-tf0604-baseline.mjs',
  'scripts/lib/reliability-aggregation.mjs',
  'scripts/lib/paired-ablation.mjs',
  'scripts/lib/entrypoint.mjs',
  'tests/unit/rsi-tf0592-statistical-adjudication.test.ts',
  'harness/specs/tasks/rsi-tf0592-statistical-adjudication.md',
  'harness/specs/rules/reliability-aggregation-boundary.md',
  'harness/specs/rules/paired-ablation-boundary.md',
  'harness/specs/rules/agent-engineering-acceptance-boundary.md',
  'harness/specs/rules/task-forest-autoclose-and-roles.md',
  'harness/src/profiles.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'docs/README.md',
  'docs/dev/rsi-capability-and-boundaries.md',
];
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const round = (value) => value === null ? null : Number(value.toFixed(6));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const error = (code, message) => ({ code, message });

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function git(args, root = ROOT) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
}

function readInputs(root) {
  return {
    ...Object.fromEntries(Object.entries(INPUT_PATHS).map(([name, path]) => [name, readJson(join(root, path))])),
    hashes: Object.fromEntries(Object.entries(INPUT_PATHS).map(([name, path]) => [name, sha256File(join(root, path))])),
  };
}

export function collectResourceFingerprint(root = ROOT) {
  const status = git(['status', '--porcelain', '--untracked-files=all'], root);
  const stats = statfsSync(root);
  const pnpm = process.platform === 'win32'
    ? execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'pnpm --version'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim()
    : execFileSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8', timeout: 15000 }).trim();
  return {
    schemaVersion: 'RsiTf0592ResourceFingerprint/v1',
    generatedAt: new Date().toISOString(),
    driven_by: 'agent',
    actor: ACTOR,
    candidate: {
      commit: git(['rev-parse', 'HEAD'], root),
      tree: git(['rev-parse', 'HEAD^{tree}'], root),
      branch: git(['branch', '--show-current'], root),
      dirty: status.length > 0,
      dirtyPaths: status ? status.split(/\r?\n/u) : [],
      sourceHashes: Object.fromEntries(SOURCE_PATHS.map((path) => [path, sha256File(join(root, path))])),
    },
    runtime: { node: process.version, pnpm, platform: process.platform, arch: process.arch, osRelease: os.release() },
    observedResources: {
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      disk: { freeBytes: Number(stats.bavail) * Number(stats.bsize), totalBytes: Number(stats.blocks) * Number(stats.bsize), status: 'measured' },
    },
    envelope: {
      cpuFloorCores: 1, cpuCeilingCores: 1,
      memoryFloorBytes: 256 * 1024 ** 2, memoryCeilingBytes: Math.min(os.totalmem(), 4 * 1024 ** 3),
      concurrency: 1, timeoutMs: 900000, retries: 0, workerCount: 1,
      model: { status: 'not-run', id: null, version: null },
      tools: { status: 'not-run', manifestDigest: null },
      grader: { status: 'not-run', id: null, version: null },
      seed: { status: 'not-run', value: null },
      networkMode: 'not-run', externalCalls: 0, isolation: 'not-run', enforcement: 'not-run',
    },
    claimBoundary: 'Observed host resources and a planned envelope; no model trial or enforced trial isolation is claimed.',
  };
}

export function wilsonCi95(successes, total) {
  if (total === 0) return null;
  const z = 1.959964;
  const p = successes / total;
  const denominator = 1 + z ** 2 / total;
  const centre = (p + z ** 2 / (2 * total)) / denominator;
  const spread = z / denominator * Math.sqrt(p * (1 - p) / total + z ** 2 / (4 * total ** 2));
  return [round(Math.max(0, centre - spread)), round(Math.min(1, centre + spread))];
}

function trialsByArm(corpus, rawTrials) {
  if (!Array.isArray(corpus?.cases) || corpus.cases.length < MIN_CASES || new Set(corpus.cases.map((entry) => entry.id)).size !== corpus.cases.length) throw new Error('invalid-corpus');
  if (!Array.isArray(rawTrials?.cases)) throw new Error('invalid-raw-trials');
  const ids = new Set(corpus.cases.map((entry) => entry.id));
  const seenCases = new Set();
  const arms = { baseline: new Map(), treatment: new Map() };
  for (const entry of rawTrials.cases) {
    if (!ids.has(entry.caseId) || seenCases.has(entry.caseId)) throw new Error('duplicate-or-unknown-case');
    seenCases.add(entry.caseId);
    if (!Array.isArray(entry.trials)) throw new Error('invalid-raw-trials');
    const seenTrials = new Set();
    for (const [index, value] of entry.trials.entries()) {
      const trial = typeof value === 'string' ? { outcome: value } : value;
      if (!trial || typeof trial !== 'object') throw new Error('invalid-trial');
      const outcome = trial.outcome ?? trial.status;
      const arm = trial.arm ?? 'baseline';
      const repeat = trial.repeat ?? index + 1;
      const failureClass = trial.failureClass ?? entry.failureClass ?? null;
      if (!RELIABILITY_TRIAL_OUTCOMES.includes(outcome)) throw new Error('unknown-trial-outcome');
      if (!Object.hasOwn(arms, arm) || !Number.isInteger(repeat) || repeat < 1 || repeat > K || seenTrials.has(`${arm}:${repeat}`)) throw new Error('duplicate-or-invalid-trial');
      if (failureClass !== null && !FAILURE_CLASSES.includes(failureClass)) throw new Error('unknown-failure-class');
      if (outcome === 'pass' && failureClass !== null) throw new Error('failure-class-on-pass');
      if (outcome !== 'pass' && failureClass === null) throw new Error('unclassified-failure');
      for (const metric of ['tokens', 'turns', 'toolCalls', 'wallClockMs', 'cost']) {
        if (trial[metric] !== undefined && trial[metric] !== null && (!Number.isFinite(trial[metric]) || trial[metric] < 0)) throw new Error('invalid-trial-metric');
      }
      seenTrials.add(`${arm}:${repeat}`);
      const list = arms[arm].get(entry.caseId) ?? [];
      list.push({ ...trial, caseId: entry.caseId, repeat, arm, outcome, failureClass });
      arms[arm].set(entry.caseId, list);
    }
  }
  if (seenCases.size !== ids.size) throw new Error('missing-raw-case');
  for (const arm of Object.values(arms)) for (const list of arm.values()) list.sort((a, b) => a.repeat - b.repeat);
  return arms;
}

function armSummary(corpus, arm) {
  const eligible = (trial) => trial.outcome === 'pass' || (trial.outcome === 'fail' && trial.failureClass === 'agent');
  const perTask = corpus.cases.map((task) => {
    const trials = arm.get(task.id) ?? [];
    const complete = trials.length === K && trials.every(eligible);
    const passes = trials.filter((trial) => trial.outcome === 'pass').length;
    return {
      caseId: task.id, taskId: task.taskId, trialCount: trials.length, complete,
      status: !trials.length ? 'not-run' : complete ? 'complete' : 'incomplete',
      passK: complete ? passes === K : null, passAtK: complete ? passes > 0 : null,
      trials,
    };
  });
  const reliability = aggregateReliability(corpus.cases.map((task) => ({
    id: task.id, safetyRequired: task.safetyRequired === true, anchor: task.anchor,
    trials: Array.from({ length: K }, (_, index) => {
      const trial = (arm.get(task.id) ?? []).find((entry) => entry.repeat === index + 1);
      return !trial ? 'missing' : eligible(trial) ? trial.outcome : ['pass', 'fail'].includes(trial.outcome) ? 'missing' : trial.outcome;
    }),
  })), { k: K, minCases: MIN_CASES });
  const complete = perTask.filter((task) => task.complete);
  const sufficient = complete.length >= MIN_CASES;
  const completeTrials = complete.flatMap((task) => task.trials);
  const allTrials = perTask.flatMap((task) => task.trials);
  const incompleteTrials = perTask.filter((task) => !task.complete).flatMap((task) => task.trials);
  const failureClasses = Object.fromEntries(FAILURE_CLASSES.map((name) => [name, {
    trialCount: allTrials.filter((trial) => trial.failureClass === name).length,
    caseCount: perTask.filter((task) => task.trials.some((trial) => trial.failureClass === name)).length,
  }]));
  const sumMetric = (trials, metric) => trials.length && trials.every((trial) => typeof trial[metric] === 'number') ? round(trials.reduce((sum, trial) => sum + trial[metric], 0)) : null;
  const budget = { recordedTotals: {}, incompleteCaseConsumption: {}, completedCaseOnly: {}, observedTrialCount: allTrials.length };
  for (const [metric, label] of [['tokens', 'tokensPerCompletedCase'], ['turns', 'turnsPerCompletedCase'], ['toolCalls', 'toolCallsPerCompletedCase'], ['cost', 'costPerCompletedCase']]) {
    const total = sumMetric(allTrials, metric);
    const completedTotal = sumMetric(completeTrials, metric);
    budget[label] = complete.length && total !== null ? round(total / complete.length) : null;
    budget.recordedTotals[metric] = total;
    budget.incompleteCaseConsumption[metric] = sumMetric(incompleteTrials, metric);
    budget.completedCaseOnly[label] = complete.length && completedTotal !== null ? round(completedTotal / complete.length) : null;
  }
  budget.recordedTotals.wallClockMs = sumMetric(allTrials, 'wallClockMs');
  budget.incompleteCaseConsumption.wallClockMs = sumMetric(incompleteTrials, 'wallClockMs');
  const latencies = allTrials.map((trial) => trial.wallClockMs).filter((value) => typeof value === 'number').sort((a, b) => a - b);
  const quantile = (q) => {
    if (!latencies.length || latencies.length !== allTrials.length) return null;
    const position = (latencies.length - 1) * q;
    return round(latencies[Math.floor(position)] + (latencies[Math.ceil(position)] - latencies[Math.floor(position)]) * (position % 1));
  };
  budget.wallClockP50Ms = quantile(0.5);
  budget.wallClockP95Ms = quantile(0.95);
  return {
    status: sufficient ? reliability.gate : 'insufficient-evidence', perTask, failureClasses, budget,
    trialCount: perTask.reduce((sum, task) => sum + task.trialCount, 0),
    completeCaseCount: complete.length, incompleteCaseCount: perTask.length - complete.length,
    aggregate: {
      passK: sufficient ? reliability.passK : null,
      passAtK: sufficient ? reliability.passAtK : null,
      perTrialSuccessRate: sufficient ? reliability.perTrialSuccessRate : null,
      confidenceInterval95: sufficient ? wilsonCi95(complete.filter((task) => task.passK).length, complete.length) : null,
      passAtKConfidenceInterval95: sufficient ? wilsonCi95(complete.filter((task) => task.passAtK).length, complete.length) : null,
      intervalMethod: 'wilson-over-complete-cases', flakeRate: reliability.flakeRate,
      incomplete: reliability.incomplete.map((entry) => {
        const trial = (arm.get(entry.caseId) ?? []).find((item) => item.repeat === entry.trialIndex + 1);
        return trial?.outcome === 'fail' && trial.failureClass !== 'agent'
          ? { ...entry, outcome: trial.outcome, failureClass: trial.failureClass, reason: 'not-agent-failure' } : entry;
      }), reasons: reliability.reasons,
    },
  };
}

export function summarizeTf0592Trials(corpus, rawTrials, policy) {
  if (policy?.taskSet?.k !== K || policy.taskSet.minimumCompleteCases !== MIN_CASES) throw new Error('policy-drift');
  const arms = trialsByArm(corpus, rawTrials);
  const baseline = armSummary(corpus, arms.baseline);
  const treatment = armSummary(corpus, arms.treatment);
  const baselineRuns = [], treatmentRuns = [], unmatched = [];
  for (const task of corpus.cases) {
    for (let repeat = 1; repeat <= K; repeat += 1) {
      const base = (arms.baseline.get(task.id) ?? []).find((trial) => trial.repeat === repeat);
      const treat = (arms.treatment.get(task.id) ?? []).find((trial) => trial.repeat === repeat);
      const eligible = (trial) => trial && (trial.outcome === 'pass' || (trial.outcome === 'fail' && trial.failureClass === 'agent'));
      if (eligible(base) && eligible(treat)) {
        baselineRuns.push({ caseId: task.id, repeat, success: base.outcome === 'pass' ? 1 : 0 });
        treatmentRuns.push({ caseId: task.id, repeat, success: treat.outcome === 'pass' ? 1 : 0 });
      } else if (base || treat) unmatched.push({ caseId: task.id, repeat, baseline: base?.outcome ?? 'missing', treatment: treat?.outcome ?? 'missing' });
    }
  }
  const pairedCaseIds = new Set(corpus.cases.filter((task) => baselineRuns.filter((trial) => trial.caseId === task.id).length === K).map((task) => task.id));
  const completePairCases = pairedCaseIds.size;
  const enoughPairs = completePairCases >= MIN_CASES;
  const baseCases = baseline.perTask.filter((task) => pairedCaseIds.has(task.caseId));
  const treatCases = treatment.perTask.filter((task) => pairedCaseIds.has(task.caseId));
  // Repeat keys establish matching; inference uses independent case clusters, not k correlated observations.
  const effect = pairedEffect(
    baseCases.map((task) => ({ caseId: task.caseId, repeat: 0, success: task.passK ? 1 : 0 })),
    treatCases.map((task) => ({ caseId: task.caseId, repeat: 0, success: task.passK ? 1 : 0 })),
    { metric: 'success' },
  );
  const diffs = baseCases.map((task, index) => Number(treatCases[index].passK) - Number(task.passK));
  const average = mean(diffs);
  const sd = diffs.length > 1 ? Math.sqrt(diffs.reduce((sum, diff) => sum + (diff - average) ** 2, 0) / (diffs.length - 1)) : null;
  const mde = policy.promotion?.thresholds?.passKAbsoluteImprovement?.minimum;
  if (mde !== 0.05) throw new Error('policy-drift');
  const varianceUsable = enoughPairs && sd !== null && sd > 0;
  const detectableEffect = varianceUsable ? (1.959964 + 0.841621) * sd / Math.sqrt(diffs.length) : null;
  const powerStatus = !varianceUsable ? 'insufficient-evidence' : detectableEffect > mde ? 'underpowered' : 'design-computed';
  return {
    status: baseline.status,
    reason: baseline.completeCaseCount < MIN_CASES ? `complete cases ${baseline.completeCaseCount} < required ${MIN_CASES}` : null,
    run: { k: K, minimumCompleteCases: MIN_CASES, trialCount: baseline.trialCount + treatment.trialCount, baselineTrialCount: baseline.trialCount, treatmentTrialCount: treatment.trialCount, completeCaseCount: baseline.completeCaseCount, incompleteCaseCount: baseline.incompleteCaseCount, cleanStateRequired: true },
    perTask: baseline.perTask, aggregate: baseline.aggregate, failureClasses: baseline.failureClasses, treatment,
    pairedDiff: {
      status: enoughPairs ? 'computed' : 'insufficient-evidence', metric: 'pass^k', pairUnit: 'caseId/repeat', inferenceUnit: 'caseId',
      pairCount: diffs.length, completePairCaseCount: completePairCases, unmatched,
      repeatPairCount: baselineRuns.length,
      excludedPartialPairs: baselineRuns.flatMap((trial, index) => pairedCaseIds.has(trial.caseId) ? [] : [{ caseId: trial.caseId, repeat: trial.repeat, baseline: trial.success, treatment: treatmentRuns[index].success }]),
      intervalMethod: 'normal-approximation over complete case clusters',
      varianceStatus: sd === null ? 'not-estimable' : sd === 0 ? 'degenerate' : 'estimated',
      meanDiff: enoughPairs ? effect.meanDiff : null, ci95: varianceUsable ? effect.ci95 : null,
      effectSize: varianceUsable ? effect.cohensDz : null,
      passKDelta: enoughPairs ? round(average) : null,
    },
    power: {
      status: powerStatus,
      method: 'normal-approximation paired pass^k over complete case clusters; planning only',
      inferenceUnit: 'caseId', reason: !enoughPairs ? 'paired-case-floor-not-met' : !varianceUsable ? 'degenerate-variance' : 'observed-variance-design',
      confidenceLevel: 0.95, targetPower: 0.8, minimumDetectableEffect: mde,
      observedDetectableEffect: round(detectableEffect),
      requiredCasesApprox: varianceUsable ? Math.ceil(((1.959964 + 0.841621) * sd / mde) ** 2) : null,
      requiredPairsApprox: varianceUsable ? K * Math.ceil(((1.959964 + 0.841621) * sd / mde) ** 2) : null,
      passKPower: powerStatus,
    },
    budget: { ...baseline.budget, costCeilingRelativeIncrease: policy.budgets.costCeiling.maxRelativeIncrease },
    claims: { realHuman: false, liveProvider: false, promotionReady: false, productLocksChanged: false },
  };
}

export function buildTf0592Report(root = ROOT) {
  const inputs = readInputs(root);
  const resource = collectResourceFingerprint(root);
  const report = {
    schemaVersion: 'RsiTf0592StatisticalReport/v1', taskId: 'TF-0592', generatedAt: resource.generatedAt,
    driven_by: 'agent', actor: ACTOR,
    inputs: { corpusPath: INPUT_PATHS.corpus, rawTrialsPath: INPUT_PATHS.rawTrials, policyPath: INPUT_PATHS.policy, hashes: inputs.hashes, corpusCaseCount: inputs.corpus.cases.length },
    resourceFingerprint: resource,
    ...summarizeTf0592Trials(inputs.corpus, inputs.rawTrials, inputs.policy),
  };
  return { inputs, resource, report };
}

export function validateTf0592Report(report, root = ROOT, options = {}) {
  const errors = [];
  if (report?.schemaVersion !== 'RsiTf0592StatisticalReport/v1' || report.taskId !== 'TF-0592') errors.push(error('schema-version', 'unexpected report identity'));
  if (report?.driven_by !== 'agent' || !report?.actor) errors.push(error('agent-label', 'a concrete agent actor is required'));
  const resource = report?.resourceFingerprint;
  const candidate = resource?.candidate;
  const observed = resource?.observedResources;
  const envelope = resource?.envelope;
  if (resource?.schemaVersion !== 'RsiTf0592ResourceFingerprint/v1' || resource?.driven_by !== 'agent' || resource?.actor !== report?.actor
    || !/^[a-f0-9]{40}$/u.test(candidate?.commit ?? '') || !/^[a-f0-9]{40}$/u.test(candidate?.tree ?? '')
    || !Array.isArray(candidate?.dirtyPaths) || !same(Object.keys(candidate?.sourceHashes ?? {}).sort(), [...SOURCE_PATHS].sort())
    || !envelope || !Number.isInteger(observed?.cpuCount) || observed.cpuCount < 1
    || !Number.isFinite(observed?.totalMemoryBytes) || observed.totalMemoryBytes <= 0
    || !Number.isFinite(observed?.freeMemoryBytes) || observed.freeMemoryBytes < 0 || observed.freeMemoryBytes > observed.totalMemoryBytes
    || !Number.isFinite(observed?.disk?.freeBytes) || observed.disk.freeBytes < 0
    || !Number.isFinite(observed?.disk?.totalBytes) || observed.disk.totalBytes < observed.disk.freeBytes
    || !resource?.runtime?.pnpm || resource.runtime.node !== process.version || resource.runtime.platform !== process.platform || resource.runtime.arch !== process.arch) errors.push(error('resource-fingerprint-missing', 'bound candidate, runtime and observed resources are required'));
  if (!envelope || envelope.cpuFloorCores !== 1 || envelope.cpuCeilingCores !== 1
    || envelope.memoryFloorBytes !== 256 * 1024 ** 2 || envelope.memoryCeilingBytes !== Math.min(observed?.totalMemoryBytes ?? 0, 4 * 1024 ** 3)
    || envelope.concurrency !== 1 || envelope.workerCount !== 1 || envelope.retries !== 0 || envelope.timeoutMs !== 900000
    || envelope.networkMode !== 'not-run' || envelope.externalCalls !== 0 || envelope.enforcement !== 'not-run' || envelope.isolation !== 'not-run'
    || !same(envelope.model, { status: 'not-run', id: null, version: null }) || !same(envelope.grader, { status: 'not-run', id: null, version: null })
    || !same(envelope.tools, { status: 'not-run', manifestDigest: null }) || !same(envelope.seed, { status: 'not-run', value: null })) errors.push(error('resource-envelope', 'the reserved model, tool, grader, isolation and resource envelope changed'));
  if (Object.values(report?.claims ?? {}).length !== 4 || Object.values(report.claims).some((value) => value !== false)) errors.push(error('claim-boundary', 'agent-driven instrument evidence cannot authorize product or provider claims'));
  if (!options.allowDraft && resource?.candidate?.dirty !== false) errors.push(error('dirty-candidate', 'final candidate must have been clean'));
  if (Object.keys(report?.failureClasses ?? {}).sort().join(',') !== [...FAILURE_CLASSES].sort().join(',')) errors.push(error('unknown-failure-class', 'failure classes must remain separated'));
  try {
    const inputs = readInputs(root);
    if (!same(report.inputs?.hashes, inputs.hashes) || report.inputs?.corpusPath !== INPUT_PATHS.corpus || report.inputs?.rawTrialsPath !== INPUT_PATHS.rawTrials || report.inputs?.policyPath !== INPUT_PATHS.policy) errors.push(error('input-digest-mismatch', 'sealed input identity differs'));
    const expected = summarizeTf0592Trials(inputs.corpus, inputs.rawTrials, inputs.policy);
    if (expected.status === 'insufficient-evidence' && report.status !== expected.status) errors.push(error('insufficient-evidence-bypass', 'complete-case floor cannot be bypassed'));
    if (expected.aggregate.passK === null && (report.aggregate?.passK !== null || report.aggregate?.passAtK !== null || report.aggregate?.confidenceInterval95 !== null)) errors.push(error('thin-sample-metric', 'thin samples cannot expose pass metrics'));
    if (!same(expected.aggregate.incomplete, report.aggregate?.incomplete)) errors.push(error('incomplete-trial-dropped', 'incomplete records differ from raw trials'));
    if (report.pairedDiff?.status === 'computed' && expected.pairedDiff.status !== 'computed') errors.push(error('paired-diff-without-pairs', 'complete paired-case floor is not met'));
    for (const key of Object.keys(expected)) if (!same(report[key], expected[key])) errors.push(error('statistical-recomputation', `${key} differs from the bound raw inputs`));
    for (const path of SOURCE_PATHS) if (resource?.candidate?.sourceHashes?.[path] !== sha256File(join(root, path))) errors.push(error('source-digest-mismatch', `source changed: ${path}`));
    if (!options.allowDraft && options.verifyCandidate !== false && resource?.candidate?.commit) {
      const commit = resource.candidate.commit;
      if (git(['rev-parse', `${commit}^{tree}`], root) !== resource.candidate.tree) errors.push(error('candidate-identity', 'recorded commit/tree do not match'));
      git(['merge-base', '--is-ancestor', commit, 'HEAD'], root);
      const changed = git(['diff', '--name-only', commit, 'HEAD'], root).split(/\r?\n/u).filter(Boolean);
      if (changed.some((path) => !Object.values(FILES).map((file) => `${TF0592_PACK_DIR}/${file}`).concat(`${TF0592_PACK_DIR}/SHA256SUMS`).includes(path))) errors.push(error('candidate-identity', 'candidate descendants contain non-evidence changes'));
      if (git(['status', '--porcelain', '--untracked-files=all'], root)) errors.push(error('dirty-workspace', 'final check requires a clean worktree'));
    }
  } catch (caught) {
    errors.push(error('input-or-candidate-invalid', caught.message));
  }
  return { passed: errors.length === 0, errors };
}

const CONTROL_DEFINITIONS = [
  ['complete-floor-bypass', 'insufficient-evidence-bypass'],
  ['pass-metric-on-thin-sample', 'thin-sample-metric'],
  ['unknown-failure-class', 'unknown-failure-class'],
  ['resource-fingerprint-missing', 'resource-fingerprint-missing'],
  ['dirty-candidate', 'dirty-candidate'],
  ['dropped-incomplete-trial', 'incomplete-trial-dropped'],
  ['paired-diff-without-pairs', 'paired-diff-without-pairs'],
  ['input-digest-tamper', 'input-digest-mismatch'],
  ['source-digest-tamper', 'source-digest-mismatch'],
  ['fabricated-trial-count', 'statistical-recomputation'],
  ['resource-envelope-tamper', 'resource-envelope'],
  ['real-human-claim', 'claim-boundary'],
];

export function buildNegativeControls() {
  return { schemaVersion: 'RsiTf0592NegativeControls/v1', taskId: 'TF-0592', driven_by: 'agent', actor: ACTOR, controls: CONTROL_DEFINITIONS.map(([id, expectedCode]) => ({ id, mutation: id, expectedCode })) };
}

export function runNegativeControls(report, controls = buildNegativeControls(), root = ROOT) {
  return controls.controls.map((control) => {
    const next = structuredClone(report);
    // A counterfactual clean input isolates each mutation; persisted run identity is never edited.
    next.resourceFingerprint.candidate.dirty = false;
    next.resourceFingerprint.candidate.dirtyPaths = [];
    const mutation = control.mutation;
    if (mutation === 'complete-floor-bypass') next.status = 'pass';
    if (mutation === 'pass-metric-on-thin-sample') next.aggregate.passK = 1;
    if (mutation === 'unknown-failure-class') next.failureClasses.unknown = { trialCount: 1, caseCount: 1 };
    if (mutation === 'resource-fingerprint-missing') delete next.resourceFingerprint.envelope;
    if (mutation === 'dirty-candidate') next.resourceFingerprint.candidate.dirty = true;
    if (mutation === 'dropped-incomplete-trial') next.aggregate.incomplete = [];
    if (mutation === 'paired-diff-without-pairs') { next.pairedDiff.status = 'computed'; next.pairedDiff.pairCount = 1; }
    if (mutation === 'input-digest-tamper') next.inputs.hashes.rawTrials = '0'.repeat(64);
    if (mutation === 'source-digest-tamper') next.resourceFingerprint.candidate.sourceHashes[SOURCE_PATHS[0]] = '0'.repeat(64);
    if (mutation === 'fabricated-trial-count') next.run.trialCount += 1;
    if (mutation === 'resource-envelope-tamper') next.resourceFingerprint.envelope.cpuCeilingCores = 0;
    if (mutation === 'real-human-claim') next.claims.realHuman = true;
    const result = validateTf0592Report(next, root, { verifyCandidate: false });
    const codes = [...new Set(result.errors.map((entry) => entry.code))];
    return { ...control, observedCodes: codes, passed: codes.includes(control.expectedCode) };
  });
}

function writeSums(root) {
  const pack = join(root, TF0592_PACK_DIR);
  writeFileSync(join(pack, 'SHA256SUMS'), `${Object.values(FILES).map((file) => `${sha256File(join(pack, file))}  ${file}`).join('\n')}\n`, 'utf8');
}

export function writeTf0592Pack(root = ROOT) {
  const { resource, report } = buildTf0592Report(root);
  const controls = buildNegativeControls();
  const results = runNegativeControls(report, controls, root);
  const validation = {
    schemaVersion: 'RsiTf0592ValidationReport/v1', taskId: 'TF-0592', generatedAt: resource.generatedAt,
    driven_by: 'agent', actor: ACTOR, sealState: resource.candidate.dirty ? 'draft' : 'sealed',
    reportStatus: report.status, reportValidation: validateTf0592Report(report, root, { allowDraft: true }),
    negativeControls: { passed: results.every((entry) => entry.passed), count: results.length, results },
    claims: report.claims,
  };
  for (const [key, value] of Object.entries({ resource, report, controls, controlResults: results, validation })) writeJson(join(root, TF0592_PACK_DIR, FILES[key]), value);
  writeSums(root);
  return validation;
}

export function validateTf0592Pack(root = ROOT, options = {}) {
  const errors = [];
  let report, observedControls = [];
  try {
    const pack = join(root, TF0592_PACK_DIR);
    const expectedFiles = [...Object.values(FILES), 'SHA256SUMS'].sort();
    if (!same(readdirSync(pack).sort(), expectedFiles)) errors.push(error('pack-file-coverage', 'pack contains missing or undeclared files'));
    const lines = readFileSync(join(pack, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/u);
    const expectedLines = Object.values(FILES).map((file) => `${sha256File(join(pack, file))}  ${file}`);
    if (!same(lines.sort(), expectedLines.sort())) errors.push(error('pack-digest-mismatch', 'SHA256SUMS differs from retained bytes'));
    report = readJson(join(pack, FILES.report));
    const resource = readJson(join(pack, FILES.resource));
    const controls = readJson(join(pack, FILES.controls));
    const results = readJson(join(pack, FILES.controlResults));
    const validation = readJson(join(pack, FILES.validation));
    if (!same(resource, report.resourceFingerprint)) errors.push(error('resource-report-mismatch', 'resource artifact differs from report'));
    if (!same(controls, buildNegativeControls())) errors.push(error('negative-control-registry', 'registered controls changed'));
    observedControls = runNegativeControls(report, buildNegativeControls(), root);
    errors.push(...validateTf0592Report(report, root, options).errors);
    if (!same(results, observedControls) || !observedControls.every((entry) => entry.passed)) errors.push(error('negative-control-results', 'saved control results differ from replay'));
    if (validation.driven_by !== 'agent' || !validation.actor || validation.reportValidation?.passed !== true || validation.reportStatus !== report.status || !same(validation.negativeControls, { passed: true, count: observedControls.length, results: observedControls }) || !same(validation.claims, report.claims)) errors.push(error('validation-report', 'saved validation does not match the report and replay'));
    if (!options.allowDraft && validation.sealState !== 'sealed') errors.push(error('draft-evidence', 'draft evidence cannot pass final readback'));
  } catch (caught) { errors.push(error('pack-read-error', caught.message)); }
  return { passed: !errors.length, errors, status: report?.status ?? 'invalid', completeCaseCount: report?.run?.completeCaseCount ?? null, negativeControlCount: observedControls.length };
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { write: { type: 'boolean' }, check: { type: 'boolean' }, json: { type: 'boolean' } } });
  try {
    const result = values.write ? writeTf0592Pack() : validateTf0592Pack();
    const passed = values.write ? result.reportValidation.passed && result.negativeControls.passed : result.passed;
    console.log(JSON.stringify(values.write ? { passed, sealState: result.sealState, reportStatus: result.reportStatus, negativeControlCount: result.negativeControls.count } : result, null, 2));
    process.exitCode = passed ? 0 : 1;
  } catch (caught) { console.error(caught.message); process.exitCode = 1; }
}
