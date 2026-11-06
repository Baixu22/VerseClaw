#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { summarizeTf0592Trials } from './rsi-tf0592-statistical-adjudication.mjs';
import { sha256File } from './rsi-tf0604-baseline.mjs';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { aggregateReliability } from './lib/reliability-aggregation.mjs';
import { evaluateAblation, pairedEffect } from './lib/paired-ablation.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MEASUREMENT_ARCHIVE_DIR = 'harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run';
export const MEASUREMENT_REVALIDATION_DIR = 'harness/specs/fixtures/rsi-coding-cohort/instruments/measurement-archive-v2';
const ORIGINAL_FILES = ['manifest.json', 'aggregate.json', 'run-audit.json', 'run-exclusions.json', 'progress.json', 'promotion-policy.v1.json'];
const FILES = [...ORIGINAL_FILES, 'corpus.v1.json', 'raw-trials.v1.json', 'provenance.v1.json', 'verification.v1.json'];
const SOURCES = ['scripts/rsi-measurement-archive.mjs', 'scripts/rsi-tf0592-statistical-adjudication.mjs',
  'scripts/rsi-tf0604-baseline.mjs', 'scripts/lib/reliability-aggregation.mjs', 'scripts/lib/paired-ablation.mjs'];
const read = (root, file) => JSON.parse(readFileSync(join(root, MEASUREMENT_ARCHIVE_DIR, file), 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const digest = (root, file) => sha256File(join(root, MEASUREMENT_ARCHIVE_DIR, file));

// Preserve the original recorded trial outcomes, including incomplete outcomes
// and missing cost dimensions. This is a retained statistical input projection,
// not a new model execution or a regrade of the original trial workspaces.
export function projectMeasurementTrials(original) {
  const statistics = original.statistics;
  return { schemaVersion: 'RsiHistoricalTrialProjection/v1', driven_by: 'agent', actor: 'codex/rsi-decision-curator', cases: statistics.perTask.map((task) => ({
    caseId: task.caseId,
    trials: [...task.trials, ...statistics.treatment.perTask.find((entry) => entry.caseId === task.caseId).trials].map((trial) => ({
      arm: trial.arm, repeat: trial.repeat, outcome: trial.outcome, failureClass: trial.failureClass,
      tokens: trial.tokens ?? null, turns: trial.turns ?? null, toolCalls: trial.toolCalls ?? null,
      wallClockMs: trial.wallClockMs ?? null, cost: trial.cost ?? null,
    })),
  })) };
}

function compact(summary) {
  return {
    status: summary.status, run: summary.run, aggregate: summary.aggregate,
    treatment: { status: summary.treatment.status, completeCaseCount: summary.treatment.completeCaseCount,
      incompleteCaseCount: summary.treatment.incompleteCaseCount, aggregate: summary.treatment.aggregate },
    pairedDiff: summary.pairedDiff, power: summary.power, budget: summary.budget,
    failureClasses: summary.failureClasses,
  };
}

function decisionControls(policy) {
  const cases = Array.from({ length: 20 }, (_, index) => ({ id: `control-${index}`, trials: ['pass', 'pass', 'pass'] }));
  cases[0].trials = ['fail', 'pass', 'pass'];
  const one = aggregateReliability(cases, { maxFlakeCases: policy.taskSet.maxFlakeCases });
  cases[1].trials = ['fail', 'pass', 'pass'];
  const two = aggregateReliability(cases, { maxFlakeCases: policy.taskSet.maxFlakeCases });
  cases[1].trials = ['pass', 'pass', 'pass']; cases[0].safetyRequired = true;
  const safety = aggregateReliability(cases, { maxFlakeCases: policy.taskSet.maxFlakeCases });
  const guard = (success) => Array.from({ length: 3 }, (_, repeat) => ({ caseId: 'guard', repeat, success,
    safetyRequired: true, anchor: 'negative', negativeExpectedOutcome: 'pass' }));
  const rejection = evaluateAblation({ baselineRuns: guard(true), treatmentRuns: guard(false),
    preRegistered: { primaryMetric: 'success', minCases: 20, k: 3, maxFlakeCases: policy.taskSet.maxFlakeCases } });
  const baselineRuns = [], treatmentRuns = [];
  for (let index = 0; index < 24; index++) for (let repeat = 1; repeat <= 3; repeat++) {
    baselineRuns.push({ caseId: `paired-${index}`, repeat, success: index >= 6 });
    treatmentRuns.push({ caseId: `paired-${index}`, repeat, success: index >= 2 });
  }
  const corpus = { cases: Array.from({ length: 24 }, (_, index) => ({ id: `paired-${index}`, taskId: `paired-${index}` })) };
  const raw = { cases: corpus.cases.map((task) => ({ caseId: task.id,
    trials: ['baseline', 'treatment'].flatMap((arm) => (arm === 'baseline' ? baselineRuns : treatmentRuns).filter((run) => run.caseId === task.id)
      .map((run) => ({ arm, repeat: run.repeat, outcome: run.success ? 'pass' : 'fail', failureClass: run.success ? null : 'agent' }))),
  })) };
  const paired = pairedEffect(baselineRuns, treatmentRuns, { k: 3, minCases: 20 });
  const statistical = summarizeTf0592Trials(corpus, raw, policy);
  const degenerate = pairedEffect(treatmentRuns, treatmentRuns);
  return {
    driven_by: 'agent', actor: 'codex/rsi-decision-controls', evidenceKind: 'deterministic-negative-controls',
    results: [
      { id: 'ordinary-flake-count', observed: [one.gate, two.gate], passed: one.gate === 'pass' && two.gate === 'fail' },
      { id: 'safety-zero-flake', observed: safety.gate, passed: safety.gate === 'fail' && safety.safety.violated },
      { id: 'accepted-negative-before-floor', observed: rejection.verdict, passed: rejection.verdict === 'safety-regression' },
      { id: 'case-cluster-parity', observed: { cases: paired.pairCount, repeats: paired.repeatPairCount },
        passed: paired.pairCount === 24 && paired.repeatPairCount === 72 && same(paired.ci95, statistical.pairedDiff.ci95) && same(paired.power, statistical.power) },
      { id: 'degenerate-interval-unavailable', observed: degenerate.varianceStatus,
        passed: degenerate.ci95 === null && degenerate.power.requiredCasesApprox === null },
    ],
  };
}

export function recomputeMeasurementArchive(root = ROOT) {
  const corpus = read(root, 'corpus.v1.json'), raw = read(root, 'raw-trials.v1.json');
  const oldPolicy = read(root, 'promotion-policy.v1.json');
  const newPolicy = JSON.parse(readFileSync(join(root, 'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v2.json'), 'utf8'));
  return {
    schemaVersion: 'RsiHistoricalMeasurementVerification/v1', driven_by: 'agent', actor: 'codex/rsi-measurement-verifier',
    evidenceKind: 'historical-real-provider-measurement',
    decisionControls: decisionControls(newPolicy),
    originalProtocol: compact(summarizeTf0592Trials(corpus, raw, oldPolicy)),
    countPolicyReanalysis: compact(summarizeTf0592Trials(corpus, raw, newPolicy)),
    reanalysisBoundary: 'Diagnostic recomputation only. V2 was not pre-registered for this run; safety annotations and cost measurements are unavailable. Original source bytes and failure are preserved.',
    evaluatorInputHashes: Object.fromEntries([...SOURCES, 'harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v2.json'].map((path) => [path, sha256File(join(root, path))])),
    claims: { driven_by: 'agent', realHuman: false, newProviderRun: false, promotionReady: false,
      rsiImprovement: false, liveReady: false, productApproved: false, defaultOn: false },
  };
}

function validateInputs(root) {
  const errors = [];
  const original = read(root, 'aggregate.json'), manifest = read(root, 'manifest.json');
  const provenance = read(root, 'provenance.v1.json'), corpus = read(root, 'corpus.v1.json'), raw = read(root, 'raw-trials.v1.json');
  for (const file of ORIGINAL_FILES) {
    if (provenance.originalDigests?.[file] !== digest(root, file)) errors.push(`original-digest-mismatch:${file}`);
  }
  if (manifest.driven_by !== 'agent' || !manifest.actor || manifest.claims?.realHuman !== false
    || manifest.claims?.liveProvider !== true || original.claims?.rsiImprovement !== false) errors.push('historical-identity');
  if (!same(corpus.cases, manifest.tasks.map((task) => ({ id: task.id, taskId: task.id })))) errors.push('historical-corpus-projection');
  if (!same(raw, projectMeasurementTrials(original))) errors.push('historical-trial-projection');
  const expected = new Set(manifest.trials.map((trial) => `${trial.taskId}/${trial.arm}/${trial.repeat}`));
  const recorded = raw.cases.flatMap((task) => task.trials.map((trial) => `${task.caseId}/${trial.arm}/${trial.repeat}`));
  if (expected.size !== 144 || recorded.length !== 144 || new Set(recorded).size !== 144 || recorded.some((id) => !expected.has(id))) errors.push('historical-trial-coverage');
  const audit = read(root, 'run-audit.json'), exclusions = read(root, 'run-exclusions.json'), progress = read(root, 'progress.json');
  if (audit.finalStatistics?.status !== 'fail' || original.statistics.status !== 'fail') errors.push('historical-failure-erased');
  if (provenance.observedProgressSlotCount !== progress.completed.length || provenance.declaredSealedResultCount !== exclusions.sealedTrials
    || provenance.excludedSlotCount !== exclusions.exclusions.length) errors.push('sealed-exclusion-coverage');
  if (provenance.driven_by !== 'agent' || !provenance.actor || !provenance.residuals?.length) errors.push('historical-provenance');
  return errors;
}

export function validateMeasurementArchive(root = ROOT) {
  const errors = [];
  try {
    const pack = join(root, MEASUREMENT_ARCHIVE_DIR);
    if (!same(readdirSync(pack).sort(), [...FILES, 'SHA256SUMS'].sort())) errors.push('archive-file-inventory');
    const sums = readFileSync(join(pack, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/);
    if (sums.length !== FILES.length) errors.push('archive-digest-inventory');
    for (const [index, file] of FILES.entries()) {
      if (sums[index] !== `${digest(root, file)}  ${file}`) errors.push(`archive-digest-mismatch:${file}`);
    }
    errors.push(...validateInputs(root));
    const recomputed = recomputeMeasurementArchive(root);
    if (!recomputed.decisionControls.results.every((entry) => entry.passed)) errors.push('decision-negative-control');
    const current = join(root, MEASUREMENT_REVALIDATION_DIR);
    if (existsSync(current)) {
      const file = 'verification.v2.json';
      if (!same(readdirSync(current).sort(), ['SHA256SUMS', file])) errors.push('archive-revalidation-inventory');
      if (readFileSync(join(current, 'SHA256SUMS'), 'utf8') !== `${sha256File(join(current, file))}  ${file}\n`) errors.push('archive-revalidation-digest');
      const record = JSON.parse(readFileSync(join(current, file), 'utf8'));
      if (record.schemaVersion !== 'RsiHistoricalMeasurementRevalidation/v1' || record.driven_by !== 'agent'
        || !record.actor || record.claims?.newProviderRun !== false || record.claims?.realHuman !== false
        || record.claims?.promotionReady !== false || record.claims?.originalVerdictChanged !== false) errors.push('archive-revalidation-identity');
      if (!same(record.originalDigests, Object.fromEntries(FILES.map(file => [file, digest(root, file)])))) errors.push('archive-revalidation-original-drift');
      if (!same(record.recomputed, recomputed)) errors.push('archive-statistical-recomputation');
    } else if (!same(read(root, 'verification.v1.json'), recomputed)) errors.push('archive-statistical-recomputation');
    const old = read(root, 'aggregate.json').statistics, reproduced = recomputed.originalProtocol;
    if (!same(old.run, reproduced.run) || old.aggregate.passK !== reproduced.aggregate.passK
      || old.treatment.aggregate.passK !== reproduced.treatment.aggregate.passK
      || old.aggregate.flakeRate !== reproduced.aggregate.flakeRate
      || old.pairedDiff.meanDiff !== reproduced.pairedDiff.meanDiff
      || old.pairedDiff.ci95.some((value, index) => Math.abs(value - reproduced.pairedDiff.ci95[index]) > 0.00005)
      || old.power.requiredCasesApprox !== reproduced.power.requiredCasesApprox) errors.push('original-statistics-not-reproduced');
    return { passed: errors.length === 0, errors, evidenceKind: 'historical-real-provider-measurement',
      recordedTrialSlots: reproduced.run.trialCount, originalStatus: old.status, reproducedStatus: reproduced.status,
      reanalysisStatus: recomputed.countPolicyReanalysis.status, promotionReady: false };
  } catch (error) {
    return { passed: false, errors: [...errors, `archive-readback:${error.message}`] };
  }
}

export function writeMeasurementVerification(root = ROOT) {
  const errors = validateInputs(root);
  if (errors.length) throw new Error(errors.join(', '));
  const pack = join(root, MEASUREMENT_REVALIDATION_DIR), file = 'verification.v2.json';
  if (existsSync(pack)) throw new Error('archive-revalidation-already-exists');
  mkdirSync(pack, { recursive: true });
  const record = { schemaVersion: 'RsiHistoricalMeasurementRevalidation/v1', driven_by: 'agent', actor: 'codex/rsi-archive-maintenance-verifier',
    generatedAt: new Date().toISOString(), boundary: 'Current evaluator replay of retained inputs; original archive bytes and verdict are unchanged.',
    originalDigests: Object.fromEntries(FILES.map(file => [file, digest(root, file)])), recomputed: recomputeMeasurementArchive(root),
    claims: { newProviderRun: false, realHuman: false, promotionReady: false, originalVerdictChanged: false } };
  writeFileSync(join(pack, file), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  writeFileSync(join(pack, 'SHA256SUMS'), `${sha256File(join(pack, file))}  ${file}\n`, { flag: 'wx' });
  return validateMeasurementArchive(root);
}

if (isMainEntrypoint(import.meta.url)) {
  const { values } = parseArgs({ options: { check: { type: 'boolean' }, write: { type: 'boolean' }, json: { type: 'boolean' } } });
  const result = values.write ? writeMeasurementVerification() : validateMeasurementArchive();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.passed ? 0 : 1;
}
