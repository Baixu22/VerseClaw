import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gradeRagQuery, RAG_QUERY_EVALUATOR_VERSION } from './project-rag-query-grade.mjs';
import { jsonBytes, sha256, safeCorpusFile } from './project-rag-corpus.mjs';
import { pairedEffect } from './paired-ablation.mjs';

/** Reopen the actual-KB evaluation, original captures and blind judgments. Never trust summary scores. */
export function verifyKnowledgeAdaptationPackage(directory, pin, expectedCandidate, expectedPolicyDigest) {
  const root = realpathSync(directory);
  const read = ref => {
    assert(ref && typeof ref.path === 'string' && /^sha256:[a-f0-9]{64}$/.test(ref.digest), 'Missing adaptation evidence pin');
    const file = realpathSync(resolve(root, ref.path)), sub = relative(root, file);
    assert(!isAbsolute(sub) && sub !== '..' && !sub.startsWith('..' + sep), 'Adaptation evidence escaped root');
    assert(statSync(file).size <= 64 * 1024 * 1024, 'Adaptation evidence exceeds read budget');
    const bytes = readFileSync(file); assert.equal(sha256(bytes), ref.digest, 'Adaptation evidence changed');
    return { value: JSON.parse(bytes.toString('utf8')), file };
  };
  const manifest = read(pin).value, plan = read(manifest.plan).value;
  assert(manifest.schema === 'KnowledgeAdaptationQualification/v1' && manifest.driven_by === 'agent', 'Invalid adaptation package');
  assert(plan.schema === 'KnowledgeAdaptationRunPlan/v1' && plan.driven_by === 'agent' && plan.candidate === expectedCandidate,
    'Adaptation candidate mismatch');
  assert.equal(plan.evaluatorVersion, RAG_QUERY_EVALUATOR_VERSION, 'Adaptation evaluator mismatch');
  assert.equal(plan.policyDigest, expectedPolicyDigest, 'Adaptation policy mismatch');
  assert(Number.isSafeInteger(plan.frozenAt) && plan.frozenAt > 0, 'Missing pre-execution adaptation freeze');
  for (const key of ['modelDigest', 'generationSettingsDigest', 'embeddingSpaceDigest', 'chunkerDigest', 'corpusDigest'])
    assert(/^sha256:[a-f0-9]{64}$/.test(plan[key]), `Missing adaptation ${key}`);
  const snapshotRead = read(manifest.snapshot), snapshot = snapshotRead.value;
  const { snapshotDigest, ...snapshotBody } = snapshot;
  assert.equal(sha256(jsonBytes(snapshotBody)), snapshotDigest, 'Adaptation snapshot identity mismatch');
  assert(snapshot.status === 'complete' && ['existing-owner', 'agent-built-adaptation'].includes(snapshot.origin), 'Incomplete adaptation snapshot');
  assert.equal(plan.corpusDigest, snapshotDigest, 'Adaptation corpus mismatch');
  const dataset = read(manifest.dataset).value;
  assert(dataset.schema === 'KnowledgeAdaptationEvaluation/v1' && dataset.evaluatorVersion === RAG_QUERY_EVALUATOR_VERSION
    && dataset.snapshotDigest === snapshotDigest && dataset.origin === snapshot.origin && dataset.driven_by === 'agent', 'Adaptation dataset mismatch');
  assert(Array.isArray(dataset.queries) && dataset.queries.length && dataset.queries.length <= 10000 && dataset.review?.actor !== dataset.actor
    && dataset.review?.driven_by === 'agent' && dataset.review.snapshotDigest === snapshotDigest, 'Missing independent frozen question review');
  const ids = dataset.queries.map(query => query.id);
  assert(new Set(ids).size === ids.length && isDeepStrictEqual([...ids].sort(), [...dataset.review.acceptedQuestionIds].sort()), 'Question inventory mismatch');
  const families = new Map(dataset.families.map(family => [family.id, family]));
  const sourceFamilies = new Map();
  for (const family of dataset.families) for (const id of family.sourceIds) {
    assert(!sourceFamilies.has(id), 'Source appears in multiple adaptation families'); sourceFamilies.set(id, family.id);
  }
  assert(new Set(dataset.queries.map(query => query.split)).size === 3, 'Missing calibration/validation/held-out splits');
  const familySplits = new Map();
  for (const query of dataset.queries) {
    assert(families.has(query.familyId) && query.sourceIds.every(id => sourceFamilies.get(id) === query.familyId)
      && ['calibration', 'validation', 'held-out'].includes(query.split)
      && (!familySplits.has(query.familyId) || familySplits.get(query.familyId) === query.split), 'Adaptation source-family split mismatch');
    familySplits.set(query.familyId, query.split);
  }
  const sourceRoot = dirname(snapshotRead.file);
  const bundle = { root: sourceRoot, corpus: { sources: snapshot.sources.map(source => ({ path: source.path, ref: source.snapshot.source })) }, gold: dataset.gold };
  assert(Array.isArray(dataset.gold) && dataset.gold.length === ids.length && new Set(dataset.gold.map(row => row.queryId)).size === ids.length,
    'Gold inventory mismatch');
  assert.equal(sourceFamilies.size, snapshot.sources.length, 'Unassigned adaptation source');
  const normalizedFamilies = new Map();
  for (const source of snapshot.sources) {
    const family = sourceFamilies.get(source.id), key = source.normalizedDigest;
    assert(family && /^sha256:[a-f0-9]{64}$/.test(key) && (!normalizedFamilies.has(key) || normalizedFamilies.get(key) === family),
      'Duplicate source crosses adaptation families');
    normalizedFamilies.set(key, family);
  }
  for (const source of bundle.corpus.sources) assert.equal(sha256(readFileSync(safeCorpusFile(sourceRoot, source.path))), source.ref.sourceDigest, 'Archived source changed');
  assert(Array.isArray(manifest.captures) && manifest.captures.length === ids.length * 2, 'Incomplete paired adaptation captures');
  const rows = [], keys = new Set();
  const reasons = new Set();
  for (const ref of manifest.captures) {
    const capture = read(ref).value, query = dataset.queries.find(query => query.id === capture.queryId);
    const key = capture.queryId + ':' + capture.arm;
    assert(query && ['page', 'full'].includes(capture.arm) && !keys.has(key), 'Duplicate or unknown adaptation capture'); keys.add(key);
    assert(capture.schema === 'KnowledgeAdaptationCapture/v1' && capture.driven_by === 'agent'
      && capture.executionProvenance === 'native-product-observation' && capture.candidate === expectedCandidate
      && capture.planDigest === manifest.plan.digest && capture.startedAt >= plan.frozenAt && capture.completedAt >= capture.startedAt
      && capture.completedAt <= Date.now(), 'Adaptation execution identity mismatch');
    for (const field of ['modelDigest', 'generationSettingsDigest', 'embeddingSpaceDigest', 'chunkerDigest', 'corpusDigest'])
      assert.equal(capture[field], plan[field], `Paired adaptation ${field} mismatch`);
    assert.equal(capture.policyDigest, capture.arm === 'full' ? plan.policyDigest : plan.baselinePolicyDigest, 'Adaptation arm policy drift');
    const scores = {};
    for (const stage of ['indexed', 'parsed', 'candidates', 'reranked', 'retained']) {
      if (capture.stages?.[stage]) scores[stage] = gradeRagQuery(bundle, query.id, capture.stages[stage]);
    }
    assert(scores.retained && capture.retainedEvidence?.schema === 'RetainedEvidenceManifest/v1', 'Final DCS evidence missing');
    const retainedPins = capture.retainedEvidence.units.flatMap(unit => unit.citations.map(citation => citation.sourceRef));
    assert(capture.stages.retained.results.every(hit => retainedPins.some(source => isDeepStrictEqual(source, hit.sourceRef))), 'Retained capture differs from DCS');
    const answer = read(capture.answer).value, judge = read(capture.judgment).value;
    assert(answer.candidate === expectedCandidate && answer.planDigest === manifest.plan.digest && answer.queryId === query.id
      && answer.arm === capture.arm && /^sha256:[a-f0-9]{64}$/.test(answer.inputDigest) && sha256(answer.text) === answer.textDigest,
    'Answer identity mismatch');
    assert(judge.driven_by === 'agent' && judge.actor !== answer.actor && judge.status === 'completed'
      && judge.blinded === true && judge.answerDigest === answer.textDigest && judge.inputDigest === answer.inputDigest
      && judge.datasetDigest === manifest.dataset.digest && [judge.correct, judge.support, judge.abstain].every(value => value === 0 || value === 1),
    'Independent answer judgment mismatch');
    const gold = dataset.gold.find(row => row.queryId === query.id);
    assert(gold, 'Missing adaptation gold');
    assert(['answerable', 'absent', 'conflicting'].includes(gold.answerability)
      && (gold.answerability === 'absent' ? gold.facts.length === 0 : gold.facts.length > 0), 'Gold answerability mismatch');
    const success = judge.correct === 1 && judge.support === 1 && (gold.answerability === 'answerable' || judge.abstain === 1);
    const losses = Object.entries(scores).filter(([, score]) => score.recallAt20 < 1).map(([stage]) => stage);
    const failureStage = gold.answerability === 'absent' ? success ? null : 'abstention'
      : losses[0] ?? (!judge.support ? 'answer-support' : !judge.correct ? 'answer' : null);
    if (capture.status !== 'completed' || answer.status !== 'completed') reasons.add('adaptation-incomplete-execution');
    const usage = capture.usage;
    if (!usage || !Number.isSafeInteger(usage.totalTokens) || usage.totalTokens < 0 || !Number.isFinite(usage.costUsd) || usage.costUsd < 0)
      reasons.add('adaptation-unknown-usage');
    if (Object.values(scores).some(score => score.safetyViolations || score.exactRefPrecision !== 1)) reasons.add('adaptation-source-safety');
    rows.push({ queryId: query.id, familyId: query.familyId, split: query.split, locale: query.locale, arm: capture.arm,
      answerability: gold.answerability, success, scores, failureStage, costUsd: usage?.costUsd ?? null, elapsedMs: capture.completedAt - capture.startedAt });
  }
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const familyRows = arm => [...new Set(rows.filter(row => row.split === 'held-out').map(row => row.familyId))].map(caseId => ({ caseId, repeat: 0,
    score: mean(rows.filter(row => row.split === 'held-out' && row.familyId === caseId && row.arm === arm).map(row => Number(row.success))) }));
  const effect = pairedEffect(familyRows('page'), familyRows('full'), { metric: 'score', k: 1, minCases: 20 });
  if (effect.pairCount < 20 || !effect.ci95 || effect.ci95[0] <= 0 || effect.meanDiff < (plan.profile === 'research' ? 0.1 : 0.05))
    reasons.add('adaptation-quality-gain-unproven');
  const baselineCost = mean(rows.filter(row => row.arm === 'page').map(row => row.costUsd ?? 0));
  const fullCost = mean(rows.filter(row => row.arm === 'full').map(row => row.costUsd ?? 0));
  if (baselineCost <= 0 || fullCost > baselineCost * (plan.profile === 'research' ? 1.25 : 1.1)) reasons.add('adaptation-cost-gain-unproven');
  const slices = [...new Set(rows.map(row => row.split + ':' + row.locale + ':' + row.answerability))].map(slice => {
    const selected = rows.filter(row => row.split + ':' + row.locale + ':' + row.answerability === slice);
    return { slice, arms: ['page', 'full'].map(arm => { const values = selected.filter(row => row.arm === arm);
      return { arm, count: values.length, successRate: mean(values.map(row => Number(row.success))),
        failures: values.filter(row => row.failureStage).map(row => ({ queryId: row.queryId, stage: row.failureStage })) }; }) };
  });
  return { schema: 'KnowledgeAdaptationQualificationResult/v1', driven_by: 'agent', candidate: expectedCandidate,
    origin: snapshot.origin, snapshotDigest, evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION,
    planDigest: manifest.plan.digest, datasetDigest: manifest.dataset.digest, rows, slices, effect,
    status: reasons.size ? 'insufficient-evidence' : 'qualified', reasons: [...reasons] };
}
