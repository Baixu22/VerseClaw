import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAblation } from './paired-ablation.mjs';

const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const keys = (value, allowed, code) => assert(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => allowed.includes(key)), code);
const TYPES = ['plan', 'attempt', 'candidate', 'decision'];
const entryId = (runId, kind, generation = 0) => `rsi-evolution:${runId}:${kind}:${generation}`;

function frozenPolicy() {
  const source = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../harness/specs/fixtures/rsi-evidence-loop/promotion-policy.v2.json'), 'utf8'));
  assert.equal(source.schemaVersion, 'RsiPromotionPolicy/v2');
  const policy = { sourceDigest: digest(source), k: source.taskSet.k, minCases: source.taskSet.minimumCompleteCases,
    minimumImprovement: source.promotion.thresholds.passKAbsoluteImprovement.minimum,
    costIncreaseMaximum: source.budgets.costCeiling.maxRelativeIncrease, maxFlakeCases: source.taskSet.maxFlakeCases,
    minSafetyCases: source.taskSet.minimumSafetyCases, minPositiveAnchors: source.taskSet.minimumPositiveAnchors,
    minNegativeAnchors: source.taskSet.minimumNegativeAnchors, selectionRule: 'first-qualified-generation' };
  assert.deepEqual([policy.k, policy.minCases, policy.minimumImprovement, policy.costIncreaseMaximum, policy.maxFlakeCases], [3, 20, 0.05, 0.1, 1], 'frozen-policy-drift');
  return policy;
}

function validateEnvelope(envelope) {
  keys(envelope, ['providerCalls', 'tokens', 'costUsd', 'wallClockMs'], 'invalid-generator-budget');
  assert(Number.isSafeInteger(envelope.providerCalls) && envelope.providerCalls >= 0
    && Number.isSafeInteger(envelope.tokens) && envelope.tokens >= 0
    && Number.isFinite(envelope.costUsd) && envelope.costUsd >= 0
    && Number.isSafeInteger(envelope.wallClockMs) && envelope.wallClockMs > 0, 'invalid-generator-budget');
}

function validatePlan(plan) {
  assert.equal(plan.schemaVersion, 'RsiCandidateEvolutionPlan/v1');
  assert(plan.driven_by === 'agent' && text(plan.actor) && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(plan.runId), 'evolution-plan-identity');
  assert.deepEqual(plan.policy, frozenPolicy(), 'frozen-policy-drift');
  keys(plan.splits, ['training', 'validation', 'heldOut'], 'evolution-splits');
  const seen = new Set();
  for (const split of ['training', 'validation', 'heldOut']) {
    assert(Array.isArray(plan.splits[split]) && plan.splits[split].length > 0, 'evolution-split-empty');
    for (const item of plan.splits[split]) {
      keys(item, ['caseId', 'inputDigest', 'graderDigest', 'safetyRequired', 'anchor', 'negativeExpectedOutcome'], 'evolution-split-fields');
      assert(text(item.caseId) && hash(item.inputDigest) && hash(item.graderDigest), 'evolution-split-binding');
      assert((item.safetyRequired === undefined || typeof item.safetyRequired === 'boolean')
        && [undefined, null, 'positive', 'negative'].includes(item.anchor)
        && [undefined, 'pass', 'fail'].includes(item.negativeExpectedOutcome), 'evolution-split-annotation');
      assert(!seen.has(item.caseId), 'split-overlap');
      seen.add(item.caseId);
    }
  }
  assert.equal(plan.heldOutDigest, digest(plan.splits.heldOut), 'held-out-commitment-drift');
  const baseline = plan.baseline;
  assert(text(baseline.id) && baseline.kind === 'confirmed-sekb' && text(baseline.context)
    && Array.isArray(baseline.sourceCaseIds) && baseline.sourceCaseIds.length > 0, 'evolution-baseline');
  assert(baseline.sourceCaseIds.every(id => text(id) && ![...plan.splits.validation, ...plan.splits.heldOut].some(item => item.caseId === id)), 'baseline-evaluation-overlap');
  keys(plan.budget, ['maxGenerations', 'perGeneration', 'wholeRun'], 'invalid-generator-budget');
  assert(Number.isSafeInteger(plan.budget.maxGenerations) && plan.budget.maxGenerations > 0, 'invalid-generator-budget');
  validateEnvelope(plan.budget.perGeneration); validateEnvelope(plan.budget.wholeRun);
}

function readEntry(store, runId, kind, generation = 0) {
  const entry = store.find_trajectory(entryId(runId, kind, generation))?.metadata?.rsiEvolutionEntry;
  assert(entry && entry.runId === runId && entry.kind === kind && entry.generation === generation
    && entry.digest === digest(entry.payload), `evolution-${kind}-record-missing-or-drifted`);
  return entry;
}

function writeEntry(store, runId, kind, generation, payload) {
  JSON.stringify(payload, (key, value) => {
    assert(typeof value !== 'number' || Number.isFinite(value), `non-finite-evolution-field:${key}`);
    return value;
  });
  const entry = { schemaVersion: 'RsiCandidateEvolutionEntry/v1', runId, kind, generation,
    payload: structuredClone(payload), digest: digest(payload) };
  const createdAt = new Date().toISOString();
  const inserted = store.create_trajectory({
    trajectory_id: entryId(runId, kind, generation), created_at: createdAt,
    task_intent: `RSI candidate evolution ${kind}`, task_type: 'rsi/candidate-evolution',
    context_fingerprint: ['rsi', 'prompt-evolution'], steps: [], outcome: 'partial', error_signature: null,
    cost: { tokens: 0, duration_seconds: 0, retries: 0 }, distilled: true, distilled_into: [], expires_at: null,
    metadata: { driven_by: 'agent', actor: 'codex/rsi-candidate-evolution', rsiEvolutionEntry: entry },
  });
  assert(inserted, kind === 'attempt' ? 'generation-already-started' : `evolution-${kind}-already-recorded`);
  assert.equal(digest(readEntry(store, runId, kind, generation)), digest(entry), 'evolution-persistence-drift');
  return entry;
}

/** Explicit evaluator invocation; runtime principles and their active statuses are untouched. */
export function freezeEvolutionRun(store, input) {
  keys(input, ['runId', 'actor', 'baseline', 'splits', 'budget'], 'evolution-plan-fields');
  const plan = { schemaVersion: 'RsiCandidateEvolutionPlan/v1', driven_by: 'agent', ...structuredClone(input),
    policy: frozenPolicy(), heldOutDigest: digest(input.splits.heldOut) };
  validatePlan(plan);
  writeEntry(store, plan.runId, 'plan', 0, plan);
  return plan;
}

function verifySources(plan, sources) {
  assert(Array.isArray(sources) && sources.length > 0, 'training-sources-required');
  const caseIds = new Set();
  for (const source of sources) {
    const binding = plan.splits.training.find(item => item.caseId === source.caseId);
    assert(binding && binding.inputDigest === source.inputDigest && binding.graderDigest === source.graderDigest
      && !caseIds.has(source.caseId) && hash(source.digest), 'training-binding');
    caseIds.add(source.caseId);
    const { digest: sourceDigest, ...body } = source;
    assert.equal(sourceDigest, digest(body), 'training-source-drift');
    assert(text(source.summary) && source.summary.length <= 256 && Array.isArray(source.observations)
      && source.observations.length === source.steps.length, 'training-summary-required');
    assert(source.observations.some(observation => observation.stage === 'initial' && observation.exitCode === 1), 'training-original-failure-required');
    for (const [index, observation] of source.observations.entries()) {
      keys(observation, ['stage', 'toolCallId', 'exitCode', 'sourceDigest', 'inputDigest', 'outputDigest', 'stdoutDigest', 'stderrDigest'], 'training-observation-fields');
      assert(['initial', 'repaired'].includes(observation.stage) && text(observation.toolCallId)
        && [0, 1].includes(observation.exitCode), 'training-observation');
      for (const key of ['sourceDigest', 'inputDigest', 'outputDigest', 'stdoutDigest', 'stderrDigest']) assert(hash(observation[key]), 'training-source-code-drift');
      const step = source.steps[index];
      assert(step.input?.__sekb_quarantine === true && step.output?.raw?.__sekb_quarantine === true
        && step.input.fingerprint === observation.inputDigest.slice(0, 16)
        && step.output.raw.fingerprint === observation.outputDigest.slice(0, 16), 'training-quarantine-binding');
    }
    assert(source.attribution.length > 0 && source.attribution.every(receipt => receipt.evidence.schemaVersion === 'RsiExperienceAttribution/v1'
      && receipt.evidence.driven_by === 'agent' && receipt.evidence.taskId === source.caseId
      && receipt.evidence.trajectoryId === source.trajectoryId && receipt.evidence.runId === source.runId
      && hash(receipt.evidence.principleVersion)), 'training-attribution-binding');
    const accepted = source.attribution.filter(receipt => receipt.status === 'accepted');
    assert(accepted.some(receipt => receipt.evidence.trigger === 'adopted')
      && accepted.some(receipt => receipt.evidence.source === 'grader' && receipt.evidence.outcomeKind === 'task'
        && receipt.evidence.outcome === source.outcome), 'training-graded-adoption-required');
    assert(accepted.filter(receipt => receipt.evidence.trigger === 'adopted').every(receipt => source.observations
      .some(observation => observation.toolCallId === receipt.evidence.operation?.toolCallId && observation.exitCode === 0)), 'training-operation-binding');
  }
  assert.deepEqual([...caseIds].sort(), plan.splits.training.map(item => item.caseId).sort(), 'training-case-coverage');
}

function trainingSources(store, plan, ids) {
  assert(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, 'training-sources-required');
  const sources = ids.map(id => {
    const trajectory = store.get_trajectory(id), binding = trajectory.metadata.rsiTraining;
    assert(binding?.schemaVersion === 'RsiEvolutionTraining/v1'
      && binding.inputDigest === digest(trajectory.task_intent), 'training-binding');
    const body = { trajectoryId: id, runId: binding.runId, caseId: binding.caseId, inputDigest: binding.inputDigest,
      graderDigest: binding.graderDigest, outcome: trajectory.outcome, summary: binding.summary,
      observations: binding.observations, steps: trajectory.steps,
      cost: trajectory.cost, attribution: store.list_adoption_events({ runId: binding.runId })
        .filter(receipt => receipt.evidence.trajectoryId === id) };
    return { ...body, digest: digest(body) };
  }).sort((a, b) => a.caseId.localeCompare(b.caseId));
  verifySources(plan, sources);
  return sources;
}

function candidateBody(plan, attempt, context) {
  const version = digest(context);
  return { id: `rsi-prompt-${digest([plan.runId, attempt.generation, version]).slice(0, 24)}`, kind: 'evolved-prompt',
    version, context, runId: plan.runId, generation: attempt.generation, planDigest: digest(plan),
    parent: { id: attempt.parent.id, version: attempt.parent.version }, sourceDigest: digest(attempt.sources),
    sourceCaseIds: [...new Set([...plan.baseline.sourceCaseIds, ...attempt.sources.map(source => source.caseId)])].sort() };
}

function reserveBudget(plan, entries) {
  const attempts = entries.filter(entry => entry.kind === 'attempt');
  for (const key of ['providerCalls', 'tokens', 'costUsd', 'wallClockMs']) {
    const reserved = attempts.reduce((total, entry) => total + entry.payload.reservation[key], 0);
    assert(reserved + plan.budget.perGeneration[key] <= plan.budget.wholeRun[key], 'whole-run-generator-budget');
  }
}

/** The reservation is durable before the callback sees a detached training projection. */
export async function generateEvolutionCandidate(store, input, generator) {
  const { runId, generation, parentId, sourceTrajectoryIds } = input;
  const plan = readEntry(store, runId, 'plan').payload;
  validatePlan(plan);
  assert(Number.isSafeInteger(generation) && generation >= 1 && generation <= plan.budget.maxGenerations, 'generation-budget');
  assert(!store.find_trajectory(entryId(runId, 'attempt', generation)), 'generation-already-started');
  const parent = generation === 1 ? { ...plan.baseline, version: digest(plan.baseline.context) }
    : readEntry(store, runId, 'candidate', generation - 1).payload.candidate;
  assert(parent && parentId === parent.id && parent.version === digest(parent.context), 'candidate-parent-binding');
  const sources = trainingSources(store, plan, sourceTrajectoryIds);
  const priorEntries = exportEvolutionRun(store, runId).entries;
  reserveBudget(plan, priorEntries);
  const view = { generation, parent: { id: parent.id, version: parent.version, context: parent.context },
    sources, budget: structuredClone(plan.budget.perGeneration) };
  const attempt = { generation, planDigest: digest(plan), parent: view.parent, sources,
    reservation: structuredClone(plan.budget.perGeneration), inputDigest: digest(view) };
  const attemptEntry = writeEntry(store, runId, 'attempt', generation, attempt);
  const started = Date.now(), abort = new AbortController();
  let timer, output, failure = null, usage = null, candidate = null, generatorActor = null, originalOutputDigest = null;
  try {
    output = await Promise.race([
      Promise.resolve().then(() => generator(structuredClone(view), abort.signal)),
      new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('generator-timeout')); }, attempt.reservation.wallClockMs); }),
    ]);
    originalOutputDigest = digest(output);
    keys(output, ['context', 'usage', 'actor'], 'generator-output-fields');
    assert(text(output.context) && output.context.length <= 12000 && text(output.actor), 'generator-output-invalid');
    keys(output.usage, ['providerCalls', 'tokens', 'costUsd'], 'generator-usage-required');
    usage = Object.fromEntries(['providerCalls', 'tokens', 'costUsd'].map(key => {
      const value = output.usage[key];
      return [key, Number.isFinite(value) && value >= 0 && (key === 'costUsd' || Number.isSafeInteger(value)) ? value : null];
    }));
    generatorActor = output.actor;
    for (const key of ['providerCalls', 'tokens', 'costUsd']) {
      assert(Number.isFinite(usage[key]) && usage[key] >= 0
        && (key === 'costUsd' || Number.isSafeInteger(usage[key])), 'generator-usage-unknown');
      assert(usage[key] <= attempt.reservation[key], 'generator-budget-exceeded');
    }
    assert(Date.now() - started <= attempt.reservation.wallClockMs, 'generator-timeout');
    candidate = candidateBody(plan, attempt, output.context);
  } catch (error) { failure = String(error?.message ?? error).slice(0, 2000); }
  finally { clearTimeout(timer); }
  const result = { status: failure ? 'failed' : 'generated', candidate, failure, usage, generatorActor,
    elapsedMs: Date.now() - started, attemptDigest: attemptEntry.digest,
    originalOutputDigest };
  writeEntry(store, runId, 'candidate', generation, result);
  return result;
}

function validationRows(plan, rows) {
  assert(Array.isArray(rows), 'validation-runs-required');
  const bindings = new Map(plan.splits.validation.map(item => [item.caseId, item]));
  const byKey = new Map();
  for (const row of rows) {
    keys(row, ['caseId', 'repeat', 'outcome', 'tokens', 'toolCalls', 'safetyViolation', 'rawResult', 'rawDigest'], 'validation-run-fields');
    assert(bindings.has(row.caseId) && Number.isSafeInteger(row.repeat) && row.repeat >= 1 && row.repeat <= plan.policy.k, 'validation-split-binding');
    assert(['pass', 'fail', 'missing', 'timeout', 'crash', 'skip'].includes(row.outcome), 'validation-outcome');
    const key = `${row.caseId}/${row.repeat}`;
    assert(!byKey.has(key), 'validation-duplicate'); byKey.set(key, row);
    assert(typeof row.safetyViolation === 'boolean', 'validation-safety-flag');
    for (const metric of ['tokens', 'toolCalls']) assert(row[metric] === null || Number.isSafeInteger(row[metric]) && row[metric] >= 0, 'validation-cost');
    if (['pass', 'fail'].includes(row.outcome)) {
      assert(row.rawResult && digest(row.rawResult) === row.rawDigest && row.rawResult.sourceDigest === digest(row.rawResult.source)
        && row.rawResult.exitCode === (row.outcome === 'pass' ? 0 : 1)
        && Number.isSafeInteger(row.rawResult.elapsedMs) && row.rawResult.elapsedMs >= 0, 'validation-raw-result');
    }
  }
  return plan.splits.validation.flatMap(binding => Array.from({ length: plan.policy.k }, (_, index) => {
    const row = byKey.get(`${binding.caseId}/${index + 1}`) ?? {
      caseId: binding.caseId, repeat: index + 1, outcome: 'missing', tokens: null, toolCalls: null, safetyViolation: false,
    };
    return { ...row, success: row.outcome === 'pass', latencyMs: row.rawResult?.elapsedMs ?? null, safetyRequired: binding.safetyRequired === true,
      ...(binding.anchor ? { anchor: binding.anchor } : {}), negativeExpectedOutcome: binding.negativeExpectedOutcome ?? 'fail' };
  }));
}

function validationDecision(plan, candidate, validation) {
  keys(validation, ['evidenceKind', 'actor', 'baselineRuns', 'treatmentRuns'], 'validation-fields');
  // Provider measurements enter through the separately sealed benefit evaluator, not a renamed control.
  assert(validation.evidenceKind === 'agent-scripted-control', 'validation-evidence-kind');
  assert(text(validation.actor), 'validation-actor');
  const baselineRuns = validationRows(plan, validation.baselineRuns), treatmentRuns = validationRows(plan, validation.treatmentRuns);
  const completed = plan.splits.validation.filter(item => [...baselineRuns, ...treatmentRuns]
    .filter(row => row.caseId === item.caseId).every(row => ['pass', 'fail'].includes(row.outcome))).map(item => item.caseId);
  const meanCost = (runs, metric) => {
    const rows = runs.filter(row => completed.includes(row.caseId));
    return rows.length > 0 && rows.every(row => Number.isFinite(row[metric]))
      ? rows.reduce((sum, row) => sum + row[metric], 0) / completed.length : null;
  };
  const costs = Object.fromEntries(['tokens', 'toolCalls'].map(metric => {
    const baseline = meanCost(baselineRuns, metric), treatment = meanCost(treatmentRuns, metric);
    const increase = baseline === null || treatment === null ? null : baseline === 0 ? treatment === 0 ? 0 : Infinity : treatment / baseline - 1;
    return [metric, { baseline, treatment, increase: increase === Infinity ? 'unbounded' : increase }];
  }));
  const increases = Object.values(costs).map(item => item.increase === 'unbounded' ? Infinity : item.increase);
  const costIncrease = increases.includes(null) ? null : Math.max(...increases);
  const evaluation = evaluateAblation({ baselineRuns, treatmentRuns, preRegistered: {
    primaryMetric: 'success', k: plan.policy.k, minCases: plan.policy.minCases,
    minimumImprovement: plan.policy.minimumImprovement, costIncreaseMaximum: plan.policy.costIncreaseMaximum,
    costIncrease, maxFlakeCases: plan.policy.maxFlakeCases, safetyMustHold: true, degradationBudget: 0,
  } });
  // JSON records the unbounded ratio in costs; the numerical gate has already consumed Infinity.
  if (costIncrease === Infinity) evaluation.preRegistered.costIncrease = null;
  const requiredCoverage = plan.splits.validation.filter(item => item.safetyRequired).length >= plan.policy.minSafetyCases
    && plan.splits.validation.filter(item => item.anchor === 'positive').length >= plan.policy.minPositiveAnchors
    && plan.splits.validation.filter(item => item.anchor === 'negative').length >= plan.policy.minNegativeAnchors;
  const negative = evaluation.effect.meanDiff !== null && evaluation.effect.meanDiff < 0;
  const status = evaluation.promotion.status === 'eliminate' || negative ? 'eliminate' : 'hold';
  return { candidateId: candidate.id, candidateVersion: candidate.version, status,
    numerical: evaluation.promotion, evaluation, costs, requiredCoverage,
    measurementEligible: evaluation.promotion.status === 'promote' && requiredCoverage,
    reasons: [...evaluation.promotion.reasons, ...(negative ? ['negative validation effect'] : []),
      ...(!requiredCoverage ? ['required safety/anchor coverage missing'] : []),
      ...(status === 'hold' ? ['agent-scripted validation retained; final provider measurement is separate'] : [])],
    validationDigest: digest(validation), validation: structuredClone(validation) };
}

export function screenEvolutionCandidate(store, { runId, generation, validation }) {
  const plan = readEntry(store, runId, 'plan').payload;
  const generated = readEntry(store, runId, 'candidate', generation).payload;
  const candidate = generated.candidate;
  validatePlan(plan); assert(candidate, 'generated-candidate-required');
  assert(validation?.actor !== generated.generatorActor, 'generator-cannot-screen-own-candidate');
  const decision = validationDecision(plan, candidate, validation);
  writeEntry(store, runId, 'decision', generation, decision);
  return decision;
}

/** Evaluation-only switch. Off returns the prior bytes before inspecting a candidate. */
export function resolveEvolutionPrompt(previousPrompt, candidate, enabled = false) {
  if (enabled !== true) return previousPrompt;
  assert(candidate?.kind === 'evolved-prompt' && text(candidate.context) && candidate.version === digest(candidate.context), 'candidate-prompt-drift');
  return candidate.context;
}

function projection(entries) {
  const plan = entries.find(entry => entry.kind === 'plan')?.payload;
  assert(plan, 'evolution-plan-record-missing');
  const attempts = entries.filter(entry => entry.kind === 'attempt');
  const results = entries.filter(entry => entry.kind === 'candidate');
  const unfinishedGenerations = attempts.filter(entry => !results.some(result => result.generation === entry.generation)).map(entry => entry.generation);
  const unknownGenerations = attempts.filter(entry => {
    const usage = results.find(result => result.generation === entry.generation)?.payload.usage;
    return !usage || Object.values(usage).some(value => value === null);
  }).map(entry => entry.generation);
  const reserved = Object.fromEntries(['providerCalls', 'tokens', 'costUsd', 'wallClockMs']
    .map(key => [key, attempts.reduce((total, entry) => total + entry.payload.reservation[key], 0)]));
  const usage = Object.fromEntries(['providerCalls', 'tokens', 'costUsd'].map(key => [key, unknownGenerations.length
    ? null : results.reduce((total, entry) => total + entry.payload.usage[key], 0)]));
  const eligible = entries.filter(entry => entry.kind === 'decision' && entry.payload.measurementEligible)
    .sort((a, b) => a.generation - b.generation);
  const measurementCandidateId = unfinishedGenerations.length === 0 && unknownGenerations.length === 0
    ? eligible[0]?.payload.candidateId ?? null : null;
  return { schemaVersion: 'RsiCandidateEvolutionExport/v1', driven_by: 'agent', actor: plan.actor,
    runId: plan.runId, plan, entries, unfinishedGenerations,
    candidates: results.map(entry => entry.payload), decisions: entries.filter(entry => entry.kind === 'decision').map(entry => entry.payload),
    budget: { ...usage, reserved, unknownGenerations }, measurementCandidateId, selectedCandidateId: null,
    claims: { benefit: false, promotionReady: false, paidProviderMeasurement: false, productDefaultsChanged: false, realHuman: false } };
}

export function exportEvolutionRun(store, runId) {
  const entries = store.query_trajectories({ task_type: 'rsi/candidate-evolution' })
    .map(trajectory => trajectory.metadata.rsiEvolutionEntry).filter(entry => entry?.runId === runId);
  return buildEvolutionExport(entries);
}

export function buildEvolutionExport(entries) {
  entries = [...entries].sort((a, b) => TYPES.indexOf(a.kind) - TYPES.indexOf(b.kind) || a.generation - b.generation);
  const exported = projection(entries);
  const checked = checkEvolutionExport(exported);
  assert(checked.passed, checked.errors.join(', '));
  return exported;
}

/** Re-derive lineage, source bindings, reservations, raw validation and every screening verdict. */
export function checkEvolutionExport(exported) {
  try {
    assert.equal(exported?.schemaVersion, 'RsiCandidateEvolutionExport/v1');
    assert(Array.isArray(exported.entries) && exported.entries.length > 0, 'evolution-entries-required');
    const entries = exported.entries, plan = entries.find(entry => entry.kind === 'plan')?.payload;
    validatePlan(plan);
    const seen = new Set();
    for (const entry of entries) {
      assert(entry.schemaVersion === 'RsiCandidateEvolutionEntry/v1' && entry.runId === plan.runId && TYPES.includes(entry.kind)
        && entry.digest === digest(entry.payload), 'evolution-entry-drift');
      const key = `${entry.kind}/${entry.generation}`;
      assert(!seen.has(key), 'evolution-entry-duplicate'); seen.add(key);
      if (entry.kind === 'plan') assert.equal(entry.generation, 0, 'plan-generation');
      else assert(Number.isSafeInteger(entry.generation) && entry.generation >= 1 && entry.generation <= plan.budget.maxGenerations, 'generation-budget');
    }
    const attempts = entries.filter(entry => entry.kind === 'attempt');
    for (const entry of attempts) {
      const attempt = entry.payload;
      assert.equal(attempt.generation, entry.generation, 'attempt-generation');
      assert.equal(attempt.planDigest, digest(plan), 'attempt-plan-drift');
      assert.deepEqual(attempt.reservation, plan.budget.perGeneration, 'attempt-budget-drift');
      verifySources(plan, attempt.sources);
      const parent = entry.generation === 1 ? { ...plan.baseline, version: digest(plan.baseline.context) }
        : entries.find(item => item.kind === 'candidate' && item.generation === entry.generation - 1)?.payload.candidate;
      assert(parent && digest(parent.context) === parent.version, 'candidate-parent-binding');
      assert.deepEqual(attempt.parent, { id: parent.id, version: parent.version, context: parent.context }, 'candidate-parent-drift');
      assert.equal(attempt.inputDigest, digest({ generation: entry.generation, parent: attempt.parent, sources: attempt.sources, budget: attempt.reservation }), 'generator-input-drift');
    }
    for (const key of ['providerCalls', 'tokens', 'costUsd', 'wallClockMs']) assert(attempts
      .reduce((total, entry) => total + entry.payload.reservation[key], 0) <= plan.budget.wholeRun[key], 'whole-run-generator-budget');
    for (const entry of entries.filter(item => item.kind === 'candidate')) {
      const result = entry.payload, attempt = attempts.find(item => item.generation === entry.generation);
      assert(attempt && result.attemptDigest === attempt.digest && ['generated', 'failed'].includes(result.status), 'candidate-attempt-binding');
      assert(Number.isSafeInteger(result.elapsedMs) && result.elapsedMs >= 0, 'generator-duration-drift');
      if (result.status === 'generated') {
        assert(result.failure === null && result.usage && text(result.generatorActor), 'candidate-result');
        for (const key of ['providerCalls', 'tokens', 'costUsd']) assert(Number.isFinite(result.usage[key]) && result.usage[key] >= 0
          && result.usage[key] <= attempt.payload.reservation[key], 'candidate-usage-drift');
        assert(result.elapsedMs <= attempt.payload.reservation.wallClockMs, 'generator-timeout');
        assert.deepEqual(result.candidate, candidateBody(plan, attempt.payload, result.candidate?.context), 'candidate-version-drift');
      } else assert(result.candidate === null && text(result.failure), 'generator-failure-drift');
    }
    for (const entry of entries.filter(item => item.kind === 'decision')) {
      const generated = entries.find(item => item.kind === 'candidate' && item.generation === entry.generation)?.payload;
      const candidate = generated?.candidate;
      assert(candidate, 'decision-candidate-missing');
      assert(entry.payload.validation?.actor !== generated.generatorActor, 'generator-cannot-screen-own-candidate');
      assert.equal(digest(entry.payload), digest(validationDecision(plan, candidate, entry.payload.validation)), 'selection-result-drift');
    }
    assert.equal(digest(exported), digest(projection(entries)), 'evolution-projection-drift');
    return { passed: true, errors: [], entries: entries.length, generations: attempts.length };
  } catch (error) { return { passed: false, errors: [String(error.message ?? error)] }; }
}

/** Bind a screened staged version to a fresh experiment, keeping final task contents evaluator-owned. */
export function bindEvolutionCandidate(exported, generation, tasks) {
  const check = checkEvolutionExport(exported);
  assert(check.passed, `candidate-evolution-invalid: ${check.errors.join(', ')}`);
  const entry = exported.entries.find(item => item.kind === 'candidate' && item.generation === generation);
  const decision = exported.entries.find(item => item.kind === 'decision' && item.generation === generation);
  assert(entry?.payload.candidate && decision?.payload.status === 'hold' && decision.payload.numerical.status === 'promote'
    && decision.payload.requiredCoverage && exported.unfinishedGenerations.length === 0
    && exported.budget.unknownGenerations.length === 0 && exported.measurementCandidateId === entry.payload.candidate.id,
  'candidate-not-staged-for-measurement');
  const expected = tasks.map(task => ({ caseId: task.id, inputDigest: digest(task), graderDigest: task.oracleDigest }));
  assert.deepEqual(exported.plan.splits.heldOut, expected, 'final-held-out-binding-drift');
  const candidate = entry.payload.candidate;
  assert(candidate.sourceCaseIds.every(id => !tasks.some(task => task.id === id)), 'training-evaluation-overlap');
  return { candidate: { id: candidate.id, kind: 'evolved-prompt', context: candidate.context, sourceCaseIds: candidate.sourceCaseIds },
    evolution: { schemaVersion: 'RsiBenefitEvolutionBinding/v1', generation, exportDigest: digest(exported),
      candidateVersion: candidate.version, heldOutDigest: exported.plan.heldOutDigest, export: structuredClone(exported) } };
}
