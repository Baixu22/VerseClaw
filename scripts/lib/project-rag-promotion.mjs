import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pairedEffect } from './paired-ablation.mjs';
import queries from '../../harness/specs/fixtures/project-rag/v4/queries.json' with { type: 'json' };
import tasks from '../../harness/specs/fixtures/project-rag/v4/tasks.json' with { type: 'json' };
import release from '../../harness/specs/fixtures/project-rag/release-v4.json' with { type: 'json' };
import trialPlan from '../../harness/specs/fixtures/project-rag/v4/trial-plan.json' with { type: 'json' };
import policy from '../../harness/specs/fixtures/project-rag/v4/promotion-policy.json' with { type: 'json' };
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { loadFrozenRagCorpus, evaluateRagTaskPromotion, gradeRagTaskArtifact, sha256 } from './project-rag-corpus.mjs';
import { gradeRagQuery, RAG_QUERY_EVALUATOR_VERSION } from './project-rag-query-grade.mjs';
import { normalizeRetrievalPolicy, retrievalPolicyDigest } from '../../openclaw_runtime/src/knowledge/retrieval/policy.ts';
import { verifyKnowledgeAdaptationPackage } from './project-rag-adaptation-readback.mjs';

const digest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fraction = value => finite(value) && value >= 0 && value <= 1;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Recompute summary from every frozen query and trial slot; imported verdicts are ignored. */
export function evaluateOfflineRagReport(input) {
  assert(input && input.schema === 'ProjectRagOfflineReport/v1' && input.driven_by === 'agent', 'Invalid offline report');
  assert.equal(input.evaluatorVersion, RAG_QUERY_EVALUATOR_VERSION, 'Offline report evaluator version mismatch');
  assert(input.executionProvenance === 'native-product-observation' && /^sha256:[a-f0-9]{64}$/.test(input.experimentBindingDigest),
    'Native product execution binding is required');
  assert(input.corpusDigest === release.freezeDigest, 'Offline report uses an unrecognized frozen corpus');
  assert(/^[a-f0-9]{40}$/.test(input.candidateCommit), 'A fixed source candidate is required');
  for (const key of ['candidateDigest', 'baselineDigest', 'calibrationDigest'])
    assert(typeof input[key] === 'string' && /^sha256:[a-f0-9]{64}$/.test(input[key]), `Missing ${key}`);
  assert(['local', 'quality', 'research'].includes(input.profile), 'Invalid evaluation profile');
  assert(Number.isSafeInteger(input.sealedAt) && input.sealedAt > 0 && input.sealedAt <= Date.now(), 'Missing frozen evaluation time');
  assert(Array.isArray(input.queries) && input.queries.length === 240, 'All 240 query observations are required');
  assert(Array.isArray(input.trials) && input.trials.length === 540, 'All 540 original task slots are required');
  const seen = new Set(), familyBaseline = new Map(), familyFull = new Map();
  const recalls = [], precisions = [];
  let safetyViolations = 0;
  for (const row of input.queries) {
    const expected = queries.find(query => query.id === row.queryId);
    assert(expected && !seen.has(row.queryId), 'Unknown or duplicate frozen query'); seen.add(row.queryId);
    for (const arm of ['page', 'full']) {
      const value = row[arm];
      assert.equal(value?.evaluatorVersion, input.evaluatorVersion, 'Query evaluator versions must not be mixed');
      assert(/^sha256:[a-f0-9]{64}$/.test(value?.rawDigest), 'Missing raw query capture digest');
      assert(value && fraction(value.ndcg5) && fraction(value.recallAt20) && fraction(value.overlapRecallAt20)
        && fraction(value.supportCoverageAt20) && value.recallAt20 <= value.supportCoverageAt20
        && value.supportCoverageAt20 <= value.overlapRecallAt20 && fraction(value.exactRefPrecision)
        && Number.isSafeInteger(value.safetyViolations) && value.safetyViolations >= 0, 'Invalid query measurement');
      safetyViolations += value.safetyViolations;
      const group = arm === 'page' ? familyBaseline : familyFull;
      group.set(expected.familyId, [...(group.get(expected.familyId) ?? []), value.ndcg5]);
    }
    recalls.push(row.full.recallAt20 - row.page.recallAt20);
    precisions.push(row.full.exactRefPrecision);
  }
  const queryRows = map => [...map].map(([caseId, values]) => ({ caseId, repeat: 0, ndcg5: mean(values) }));
  const retrieval = pairedEffect(queryRows(familyBaseline), queryRows(familyFull), { metric: 'ndcg5', k: 1, minCases: 20 });
  const slotIds = new Set(), selected = { off: [], page: [], full: [] };
  let unknownUsageSlots = 0, missingSlots = 0;
  for (const row of input.trials) {
    const task = tasks.find(task => task.id === row.taskId);
    const slot = `${row.taskId}:${row.repeat}:${row.arm}`;
    assert(task && trialPlan.slots.some(slot => slot.taskId === row.taskId && slot.repeat === row.repeat && slot.arm === row.arm)
      && !slotIds.has(slot), 'Unknown or duplicate task slot'); slotIds.add(slot);
    assert(['pass', 'fail', 'timeout', 'crash', 'missing', 'skip'].includes(row.outcome), 'Unknown trial outcome');
    assert(/^sha256:[a-f0-9]{64}$/.test(row.attemptDigest) && row.experimentBindingDigest === input.experimentBindingDigest,
      'Missing original attempt or experiment binding');
    assert(Number.isSafeInteger(row.safetyViolations) && row.safetyViolations >= 0, 'Missing safety observations');
    safetyViolations += row.safetyViolations;
    if (!['pass', 'fail'].includes(row.outcome)) missingSlots += 1;
    if (!finite(row.costUsd) || row.costUsd < 0 || !Number.isSafeInteger(row.tokens) || row.tokens < 0) unknownUsageSlots += 1;
    const envelope = policy.profiles[task.profile].taskEnvelope;
    if (!Number.isSafeInteger(row.modelCalls) || row.modelCalls < 0 || !finite(row.elapsedMs) || row.elapsedMs < 0
      || row.tokens > envelope.maxTotalTokens || row.costUsd > envelope.maximumTotalUsd
      || row.modelCalls > envelope.maxModelCalls || row.elapsedMs > envelope.deadlineMs) safetyViolations += 1;
    if (task.profile === input.profile) selected[row.arm].push({ caseId: row.taskId, repeat: row.repeat,
      success: row.outcome === 'pass', costUsd: row.costUsd, tokens: row.tokens });
  }
  // The frozen primary comparison is safe-page versus full; all three arms
  // remain mandatory observations and share the same budgets and safety checks.
  const effect = pairedEffect(selected.page, selected.full,
    { metric: 'success', k: 3, minCases: 20, minimumEffect: input.profile === 'research' ? 0.1 : 0.05 });
  const fullCost = unknownUsageSlots ? null : mean(selected.full.map(row => row.costUsd));
  const baselineCost = unknownUsageSlots ? null : mean(selected.page.map(row => row.costUsd));
  return {
    schema: 'OfflineRetrievalEvaluation/v1', candidateDigest: input.candidateDigest,
    baselineDigest: input.baselineDigest, corpusDigest: input.corpusDigest, reportDigest: digest(input),
    candidateCommit: input.candidateCommit, profile: input.profile, queryCount: 240, taskCount: 60,
    taskSlots: 540, repeats: 3, arms: ['off', 'page', 'full'], missingSlots, unknownUsageSlots, safetyViolations,
    ndcg5Gain: retrieval.meanDiff, ndcg5Ci95: retrieval.ci95,
    recallAt20Delta: Math.min(...recalls), exactRefPrecision: Math.min(...precisions),
    successGain: effect.meanDiff,
    successCi95: effect.ci95,
    baselineCostUsd: baselineCost, absoluteCostIncreaseUsd: fullCost === null ? null : fullCost - baselineCost,
    relativeCostIncrease: baselineCost > 0 ? (fullCost - baselineCost) / baselineCost : null,
    calibrationDigest: input.calibrationDigest, sealedAt: input.sealedAt, driven_by: 'agent',
  };
}

/** Reopen pinned original captures and regrade participant artifacts before publication. */
export function verifyOfflineRagPolicyPackage(directory, expectedManifestDigest, manifestName = 'policy-package.json') {
  assert(typeof manifestName === 'string' && manifestName && manifestName.length <= 255
    && basename(manifestName) === manifestName && !/[\\/\r\n\0]/.test(manifestName), 'Invalid offline policy manifest name');
  const root = realpathSync(directory);
  const inside = file => {
    const resolved = realpathSync(resolve(root, file)), sub = relative(root, resolved);
    assert(sub !== '..' && !sub.startsWith('..' + sep) && !isAbsolute(sub), 'Offline evidence escaped the selected directory');
    return resolved;
  };
  const read = pin => {
    assert(pin && typeof pin.path === 'string' && /^sha256:[a-f0-9]{64}$/.test(pin.digest), 'Missing raw evidence pin');
    const file = inside(pin.path); assert(statSync(file).size <= 64 * 1024 * 1024, 'Offline evidence exceeds its read budget');
    const bytes = readFileSync(file); assert.equal(sha256(bytes), pin.digest, 'Offline evidence changed');
    return JSON.parse(bytes.toString('utf8'));
  };
  const manifestFile = inside(manifestName);
  assert(statSync(manifestFile).size <= 2 * 1024 * 1024, 'Policy package exceeds its read budget');
  const manifestBytes = readFileSync(manifestFile);
  assert.equal(sha256(manifestBytes), expectedManifestDigest, 'Policy package changed');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert(manifest.schema === 'OfflineRagPolicyPackage/v1' && manifest.driven_by === 'agent');
  const report = read(manifest.report);
  const candidate = normalizeRetrievalPolicy(manifest.candidate);
  const evaluation = evaluateOfflineRagReport(report);
  assert.equal(candidate.profile, report.profile, 'Offline policy profile drift');
  assert.equal(retrievalPolicyDigest(candidate), report.candidateDigest, 'Offline policy candidate drift');
  // The selected package carries the frozen corpus; no runtime path depends on
  // the source checkout or a bundler's import.meta.url layout.
  const bundle = loadFrozenRagCorpus(inside('frozen-corpus'), release.freezeDigest);
  assert(Array.isArray(manifest.queryCaptures) && manifest.queryCaptures.length === 480, 'Missing raw query captures');
  const queryIds = new Set();
  for (const capture of manifest.queryCaptures) {
    assert(['page', 'full'].includes(capture.arm), 'Unknown query arm');
    const key = `${capture.queryId}:${capture.arm}`; assert(!queryIds.has(key), 'Duplicate raw query capture'); queryIds.add(key);
    const raw = read(capture);
    assert(raw.candidate === report.candidateCommit && raw.queryId === capture.queryId && raw.arm === capture.arm
      && raw.profile === report.profile, 'Raw query identity drift');
    if (capture.arm === 'full') assert.equal(raw.plan?.policyDigest, evaluation.candidateDigest, 'Raw query did not execute the candidate policy');
    const measured = gradeRagQuery(bundle, capture.queryId, raw);
    const summary = report.queries.find(row => row.queryId === capture.queryId)?.[capture.arm];
    for (const key of ['evaluatorVersion', 'ndcg5', 'recallAt20', 'overlapRecallAt20', 'supportCoverageAt20', 'exactRefPrecision', 'safetyViolations'])
      assert.equal(summary?.[key], measured[key], 'Query summary differs from the raw owner capture');
    assert.equal(summary.rawDigest, capture.digest);
  }
  const execution = read(manifest.taskExecutions), evidenceDirectory = inside(execution.evidenceDirectory);
  assert(execution.complete === true && Array.isArray(execution.runs) && execution.runs.length === 540,
    'Incomplete original task cohort');
  const experiment = JSON.parse(readFileSync(resolve(evidenceDirectory, 'experiment.json'), 'utf8'));
  assert.equal(experiment.binding.cleanCandidate, report.candidateCommit, 'Experiment candidate drift');
  assert.equal(experiment.digest, report.experimentBindingDigest, 'Experiment summary drift');
  assert.equal(experiment.binding.arms.find(arm => arm.arm === 'full')?.policyDigests?.[report.profile],
    evaluation.candidateDigest, 'Experiment candidate policy drift');
  const verdict = evaluateRagTaskPromotion(bundle, execution.runs, { directory: evidenceDirectory,
    experimentDigest: execution.experimentDigest, safetyDigest: execution.safetyDigest, attemptDigests: execution.attemptDigests });
  assert(verdict.status !== 'insufficient-evidence', 'Incomplete independent task evidence');
  for (const attempt of execution.runs) {
    const slot = bundle.plan.slots.find(slot => slot.id === attempt.slotId); assert(slot);
    const original = JSON.parse(readFileSync(resolve(evidenceDirectory, `attempts/${sha256(slot.id).slice(7)}.json`), 'utf8'));
    assert(isDeepStrictEqual(original.capture, attempt.capture), 'Original task capture binding changed');
    if (slot.arm === 'full' && slot.profile === report.profile)
      assert.equal(attempt.capture.policyDigest, evaluation.candidateDigest, 'Task did not execute the candidate policy');
    assert(attempt.capture?.materializationReceipt, 'Task materialization pin missing');
    const workspace = inside(attempt.capture.workspace), materialization = inside(attempt.capture.materializationReceipt);
    const regraded = gradeRagTaskArtifact(bundle, slot.taskId, workspace, materialization);
    assert(isDeepStrictEqual(regraded, attempt.grade), 'Independent task grade changed');
    const trial = report.trials.find(row => row.taskId === slot.taskId && row.repeat === slot.repeat && row.arm === slot.arm);
    assert(trial && trial.outcome === attempt.outcome && trial.attemptDigest === execution.attemptDigests[slot.id]
      && trial.experimentBindingDigest === experiment.digest, 'Task summary identity drift');
    assert.equal(trial.tokens, attempt.actualBudget.totalTokens);
    assert.equal(trial.modelCalls, attempt.actualBudget.modelCalls);
    assert.equal(trial.elapsedMs, attempt.actualBudget.elapsedMs);
    const measuredCost = attempt.usageUnknown ? null
      : Object.values(attempt.costs).reduce((sum, value) => sum + value, 0) + attempt.unknownReserveUsd;
    assert.equal(trial.costUsd, measuredCost, 'Measured task cost drift');
    assert.equal(trial.safetyViolations, Number(attempt.safetyViolation));
  }
  const adaptation = verifyKnowledgeAdaptationPackage(root, manifest.adaptation, report.candidateCommit, evaluation.candidateDigest,
    candidate.profile, evaluation.baselineDigest);
  assert.equal(adaptation.status, 'qualified', 'Actual-KB adaptation qualification incomplete: ' + adaptation.reasons.join(', '));
  return { candidate, expectedPolicyDigest: evaluation.baselineDigest, evaluation,
    evidenceRoot: root, evidenceManifestDigest: expectedManifestDigest };
}
