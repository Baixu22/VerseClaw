// @vitest-environment node
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { verifyKnowledgeAdaptationPackage } from '../../scripts/lib/project-rag-adaptation-readback.mjs';
import { jsonBytes, sha256 } from '../../scripts/lib/project-rag-corpus.mjs';
import { RAG_QUERY_EVALUATOR_VERSION } from '../../scripts/lib/project-rag-query-grade.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rag-adaptation-readback-')); roots.push(root);
  const save = (name: string, data: unknown) => { const bytes = jsonBytes(data); writeFileSync(join(root, name), bytes); return { path: name, digest: sha256(bytes) }; };
  const pin = sha256('fixture'), candidate = 'a'.repeat(40), now = Date.now();
  const sources = ['calibration', 'validation', 'held-out'].map((split, i) => {
    const content = `Port ${i} is 8080.`, source = { schema: 'SourceRef/v2', domain: 'wiki', authorityId: 'wiki', namespaceId: 'fixture',
      subjectId: `source-${i}.md`, revision: '1', sourceDigest: sha256(content), policyEpoch: pin,
      locator: { coordinateSpace: 'raw-source-utf8-v1', startByte: 0, endByteExclusive: Buffer.byteLength(content), startLine: 1, endLine: 1 } };
    writeFileSync(join(root, source.subjectId), content);
    return { id: String(i), path: source.subjectId, normalizedDigest: sha256(content), split, snapshot: { source } };
  });
  const body = { schema: 'KnowledgeAdaptationSnapshot/v1', driven_by: 'agent', origin: 'agent-built-adaptation', status: 'complete', sources };
  const snapshot = { ...body, snapshotDigest: sha256(jsonBytes(body)) };
  const queries = sources.map((source, i) => ({ id: 'q' + i, split: source.split, familyId: String(i), sourceIds: [source.id], locale: 'en' }));
  const dataset = { schema: 'KnowledgeAdaptationEvaluation/v1', evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION, snapshotDigest: snapshot.snapshotDigest,
    driven_by: 'agent', origin: snapshot.origin, actor: 'author', queries, families: sources.map(source => ({ id: source.id, sourceIds: [source.id] })),
    gold: sources.map((source, i) => ({ queryId: 'q' + i, answerability: 'answerable', facts: [{ sourceRef: source.snapshot.source }] })),
    review: { actor: 'independent-reviewer', driven_by: 'agent', snapshotDigest: snapshot.snapshotDigest, acceptedQuestionIds: queries.map(q => q.id) } };
  const datasetPin = save('dataset.json', dataset);
  const binding = { modelDigest: pin, generationSettingsDigest: pin, embeddingSpaceDigest: pin, chunkerDigest: pin, corpusDigest: snapshot.snapshotDigest };
  const plan = { schema: 'KnowledgeAdaptationRunPlan/v1', driven_by: 'agent', candidate, evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION,
    policyDigest: pin, baselinePolicyDigest: pin, frozenAt: now - 1000, profile: 'quality', ...binding };
  const planPin = save('plan.json', plan);
  const captures = queries.flatMap((q, i) => ['page', 'full'].map(arm => {
    const sourceRef = sources[i].snapshot.source, text = '8080';
    const answer = { actor: 'generator', candidate, planDigest: planPin.digest, queryId: q.id, arm, inputDigest: pin,
      text, textDigest: sha256(text), status: 'completed' };
    const grade = { driven_by: 'agent', actor: 'blind-judge', status: 'completed', blinded: true, answerDigest: answer.textDigest,
      inputDigest: pin, datasetDigest: datasetPin.digest, correct: 1, support: 1, abstain: 0 };
    return { schema: 'KnowledgeAdaptationCapture/v1', driven_by: 'agent', executionProvenance: 'native-product-observation',
      candidate, planDigest: planPin.digest, queryId: q.id, arm, startedAt: now - 500, completedAt: now - 100, ...binding, policyDigest: pin,
      status: 'completed', usage: { totalTokens: 100, costUsd: 0.001 },
      stages: { retained: { results: [{ sourceRef }], ownerPinsVerified: true, safetyViolations: 0 } },
      retainedEvidence: { schema: 'RetainedEvidenceManifest/v1', units: [{ citations: [{ sourceRef }] }] },
      answer: save(q.id + arm + '-answer.json', answer), judgment: save(q.id + arm + '-judge.json', grade) };
  }));
  const manifest = { schema: 'KnowledgeAdaptationQualification/v1', driven_by: 'agent', plan: planPin, snapshot: save('snapshot.json', snapshot),
    dataset: datasetPin, captures: [] as Array<{path: string; digest: string}> };
  const verify = () => { manifest.captures = captures.map((row, i) => save('capture-' + i + '.json', row));
    return verifyKnowledgeAdaptationPackage(root, save('qualification.json', manifest), candidate, pin); };
  return { verify, captures, root, manifest };
}

it('regrades owner evidence and leaves a small project corpus insufficient for policy promotion', () => {
  const f = fixture(), report = f.verify();
  expect(report.origin).toBe('agent-built-adaptation'); expect(report.rows).toHaveLength(6);
  expect(report.rows.every(row => row.success && row.failureStage === null)).toBe(true);
  expect(report.status).toBe('insufficient-evidence'); expect(report.reasons).toContain('adaptation-quality-gain-unproven');
});
it('rejects evaluator/candidate/model drift before accepting paired evidence', () => {
  const f = fixture(); f.captures[0].candidate = 'b'.repeat(40);
  expect(() => f.verify()).toThrow('identity mismatch');
  f.captures[0].candidate = 'a'.repeat(40); f.captures[0].modelDigest = sha256('another-model');
  expect(() => f.verify()).toThrow('modelDigest mismatch');
});
it('detects a DCS loss and preserves unknown cost without manufacturing a passing summary', () => {
  const f = fixture(); f.captures[0].stages.retained.results = []; f.captures[0].retainedEvidence.units = [];
  f.captures[0].usage.costUsd = null as unknown as number;
  const report = f.verify(); expect(report.rows[0].failureStage).toBe('retained');
  expect(report.reasons).toContain('adaptation-unknown-usage');
});
it('rejects substituted retained pins and changed original source bytes', () => {
  const f = fixture(); f.captures[0].retainedEvidence.units = [];
  expect(() => f.verify()).toThrow('differs from DCS');
  writeFileSync(join(f.root, 'source-0.md'), 'changed');
  expect(() => f.verify()).toThrow('Archived source changed');
});
