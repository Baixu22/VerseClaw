import { describe, expect, it } from 'vitest';
import { RAG_QUERY_EVALUATOR_VERSION } from '../../scripts/lib/project-rag-query-grade.mjs';
import { defaultRetrievalPolicy, evaluateOfflineRetrievalPromotion, normalizeRetrievalPolicy, retrievalPolicyDigest } from '../../openclaw_runtime/src/knowledge/retrieval/policy';
import { createRetrievalPlan, fuseRetrievalLanes } from '../../openclaw_runtime/src/knowledge/retrieval/plan';
import { evaluateOfflineRagReport } from '../../scripts/lib/project-rag-promotion.mjs';
import type { OfflineRetrievalEvaluationV1 } from '../../shared/knowledge/observability';
import type { SourceRefV2 } from '../../shared/knowledge/owner-read-contract';
import frozenQueries from '../../harness/specs/fixtures/project-rag/v4/queries.json';
import frozenTasks from '../../harness/specs/fixtures/project-rag/v4/tasks.json';
import frozenRelease from '../../harness/specs/fixtures/project-rag/release-v4.json';

const baseline = defaultRetrievalPolicy('quality');
const candidate = { ...baseline, version: 'project-rag-ranked/v3', rrfK: 50 };
const pin = 'sha256:' + 'a'.repeat(64);
const evaluation = (): OfflineRetrievalEvaluationV1 => ({
  schema: 'OfflineRetrievalEvaluation/v1', candidateDigest: retrievalPolicyDigest(candidate),
  baselineDigest: retrievalPolicyDigest(baseline), corpusDigest: pin, reportDigest: pin,
  candidateCommit: 'b'.repeat(40), profile: 'quality', queryCount: 240, taskCount: 60, taskSlots: 540,
  repeats: 3, arms: ['off', 'page', 'full'], missingSlots: 0, unknownUsageSlots: 0, safetyViolations: 0,
  ndcg5Gain: 0.1, ndcg5Ci95: [0.07, 0.13], recallAt20Delta: 0, exactRefPrecision: 1,
  successGain: 0.1, successCi95: [0.06, 0.14], relativeCostIncrease: 0.05,
  absoluteCostIncreaseUsd: 0.01, baselineCostUsd: 0.2, calibrationDigest: pin, sealedAt: 1000, driven_by: 'agent',
});

describe('Project RAG offline policy and receipt contracts', () => {
  it('keeps the original default and admits only bounded policy changes', () => {
    expect(defaultRetrievalPolicy('local')).toEqual({ schema: 'RetrievalPolicy/v1', version: 'project-rag-rrf/v2',
      profile: 'local', rrfK: 60, candidateK: 40, rerankK: 0, finalK: 4, maxPerParent: 2 });
    expect(normalizeRetrievalPolicy(candidate)).toEqual(candidate);
    for (const change of [{ candidateK: 81 }, { finalK: 7 }, { maxPerParent: 3 }, { rrfK: 0 }, { maxChars: 90000 }])
      expect(() => normalizeRetrievalPolicy({ ...candidate, ...change })).toThrow();
  });

  it('binds selected policy to the actual retrieval plan and fusion score', () => {
    const plan = createRetrievalPlan({ query: 'query', namespaceIds: ['owner'], profile: 'quality', policy: candidate, now: 0 });
    expect(plan.policyVersion).toBe(candidate.version);
    expect(plan.policyDigest).toBe(retrievalPolicyDigest(candidate));
    expect(plan.budget.deadlineAtMs).toBe(2500);
    expect(plan.budget.maxChars).toBe(6000);
    const sourceRef = { domain: 'wiki', authorityId: 'owner', namespaceId: 'owner', subjectId: 'page',
      revision: '1', sourceDigest: pin, policyEpoch: '1' } as SourceRefV2;
    const result = fuseRetrievalLanes([{ lane: 'lexical', namespaceId: 'owner', queryFamily: 'root',
      hits: [{ id: 'hit', sourceRef, rawScore: 1, scoreKind: 'fts', data: {} }] }], [], plan.rrfK);
    expect(result.hits[0].rankSignals.fusionScore).toBeCloseTo(1 / 51);
    expect(() => createRetrievalPlan({ query: 'query', namespaceIds: ['owner'], profile: 'local', policy: candidate })).toThrow();
  });

  it('accepts complete positive evidence while preserving all frozen floors', () => {
    expect(evaluateOfflineRetrievalPromotion(candidate, baseline, evaluation())).toEqual([]);
    expect(evaluateOfflineRetrievalPromotion(candidate, baseline, { ...evaluation(), baselineCostUsd: 0,
      relativeCostIncrease: null, absoluteCostIncreaseUsd: 0.04 })).toEqual([]);
  });

  it.each([
    ['unknown cost', { relativeCostIncrease: null }, 'cost-ceiling-exceeded'],
    ['unknown usage', { unknownUsageSlots: 1 }, 'unknown-usage'],
    ['missing task slot', { missingSlots: 1 }, 'incomplete-frozen-cohort'],
    ['partial queries', { queryCount: 239 }, 'incomplete-frozen-cohort'],
    ['nonpositive interval', { successCi95: [0, 0.2] }, 'task-gain-unproven'],
    ['source leak', { safetyViolations: 1 }, 'safety-or-source-precision-regression'],
    ['stale baseline', { baselineDigest: 'sha256:' + 'c'.repeat(64) }, 'policy-binding-mismatch'],
  ] as const)('holds promotion for %s', (_name, changed, reason) => {
    expect(evaluateOfflineRetrievalPromotion(candidate, baseline, { ...evaluation(), ...changed } as OfflineRetrievalEvaluationV1)).toContain(reason);
  });

  it('rejects a summary without the complete frozen raw report', () => {
    expect(() => evaluateOfflineRagReport(evaluation())).toThrow('Invalid offline report');
    expect(() => evaluateOfflineRagReport({ schema: 'ProjectRagOfflineReport/v1', evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION, driven_by: 'agent',
      corpusDigest: pin, queries: [], trials: [] })).toThrow();
  });

  it('recomputes complete raw slots and rejects duplicate or missing evidence', () => {
    const report = {
      schema: 'ProjectRagOfflineReport/v1', evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION, driven_by: 'agent', corpusDigest: frozenRelease.freezeDigest,
      executionProvenance: 'native-product-observation', experimentBindingDigest: pin,
      candidateDigest: retrievalPolicyDigest(candidate), baselineDigest: retrievalPolicyDigest(baseline),
      calibrationDigest: pin, candidateCommit: 'b'.repeat(40), profile: 'quality', sealedAt: 1000,
      queries: frozenQueries.map((query, index) => ({ queryId: query.id,
        page: { evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION, ndcg5: 0.5, recallAt20: 0.8, supportCoverageAt20: 0.85, overlapRecallAt20: 0.9, exactRefPrecision: 1, safetyViolations: 0, rawDigest: pin },
        full: { evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION, ndcg5: 0.6 + (index % 7) / 100, recallAt20: 0.9, supportCoverageAt20: 0.95, overlapRecallAt20: 1, exactRefPrecision: 1, safetyViolations: 0, rawDigest: pin } })),
      trials: frozenTasks.flatMap((task, index) => [1, 2, 3].flatMap(repeat => ['off', 'page', 'full'].map(arm => ({
        taskId: task.id, repeat, arm, outcome: arm === 'full' && index % 4 !== 0 ? 'pass' : 'fail',
        attemptDigest: pin, experimentBindingDigest: pin,
        costUsd: arm === 'full' ? 0.105 : 0.1, tokens: 100, modelCalls: 1, elapsedMs: 100, safetyViolations: 0,
      })))),
    };
    const result = evaluateOfflineRagReport(report);
    expect(result.queryCount).toBe(240);
    expect(result.taskSlots).toBe(540);
    expect(result.unknownUsageSlots).toBe(0);
    expect(result.ndcg5Gain).toBeGreaterThan(0.05);
    expect(result.successGain).toBeGreaterThan(0.05);
    expect(() => evaluateOfflineRagReport({ ...report, evaluatorVersion: 'legacy/v1' })).toThrow('evaluator version');
    const mixed = structuredClone(report);
    mixed.queries[0].page.evaluatorVersion = 'legacy/v1' as typeof RAG_QUERY_EVALUATOR_VERSION;
    expect(() => evaluateOfflineRagReport(mixed)).toThrow('versions must not be mixed');
    expect(() => evaluateOfflineRagReport({ ...report, trials: report.trials.slice(1) })).toThrow();
    expect(() => evaluateOfflineRagReport({ ...report, queries: report.queries.map((row, index) => index === 1 ? report.queries[0] : row) })).toThrow();
    const unknown = structuredClone(report);
    (unknown.trials[0] as { costUsd: number | null }).costUsd = null;
    expect(evaluateOfflineRagReport(unknown).unknownUsageSlots).toBe(1);
  });
});
