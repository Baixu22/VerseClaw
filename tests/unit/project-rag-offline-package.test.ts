// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadFrozenRagCorpus } from '../../scripts/lib/project-rag-corpus.mjs';
import { verifyOfflineRagPolicyPackage } from '../../scripts/lib/project-rag-promotion.mjs';
import { gradeRagQuery, RAG_QUERY_EVALUATOR_VERSION } from '../../scripts/lib/project-rag-query-grade.mjs';
import { defaultRetrievalPolicy, retrievalPolicyDigest } from '../../openclaw_runtime/src/knowledge/retrieval/policy';
import queries from '../../harness/specs/fixtures/project-rag/v4/queries.json';
import tasks from '../../harness/specs/fixtures/project-rag/v4/tasks.json';
import release from '../../harness/specs/fixtures/project-rag/release-v4.json';
import { spawnSync } from 'node:child_process';
import { executeCodeProbe } from '../../scripts/lib/project-rag-code-oracle.mjs';
import { verifyOfflineRagPolicyPackage as verifyPackagedPolicy } from '../../openclaw_runtime/src/knowledge/retrieval/offline-policy-package';

const corpus = resolve('harness/specs/fixtures/project-rag/v4');
const pin = 'sha256:' + 'a'.repeat(64);
const digest = (value: string | Buffer) => 'sha256:' + createHash('sha256').update(value).digest('hex');
const roots: string[] = [];
const policy = { ...defaultRetrievalPolicy('quality'), version: 'agent-fixture/v3', rrfK: 50 };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rag-offline-package-')); roots.push(root);
  const report = { schema: 'ProjectRagOfflineReport/v1', evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION, driven_by: 'agent', corpusDigest: release.freezeDigest,
    executionProvenance: 'native-product-observation', experimentBindingDigest: pin,
    candidateCommit: 'b'.repeat(40), candidateDigest: retrievalPolicyDigest(policy),
    baselineDigest: retrievalPolicyDigest(defaultRetrievalPolicy('quality')), calibrationDigest: pin,
    profile: 'quality', sealedAt: Date.now(),
    queries: queries.map(query => ({ queryId: query.id,
      page: { evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION, ndcg5: 0.2, recallAt20: 0.5, supportCoverageAt20: 0.5, overlapRecallAt20: 0.5, exactRefPrecision: 1, safetyViolations: 0, rawDigest: pin },
      full: { evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION, ndcg5: 1, recallAt20: 1, supportCoverageAt20: 1, overlapRecallAt20: 1, exactRefPrecision: 1, safetyViolations: 0, rawDigest: pin } })),
    trials: tasks.flatMap(task => [1, 2, 3].flatMap(repeat => ['off', 'page', 'full'].map(arm => ({
      taskId: task.id, repeat, arm, outcome: arm === 'full' ? 'pass' : 'fail',
      attemptDigest: pin, experimentBindingDigest: pin, costUsd: 0.001, tokens: 100,
      modelCalls: 1, elapsedMs: 100, safetyViolations: 0 })))) };
  const bytes = JSON.stringify(report);
  writeFileSync(join(root, 'report.json'), bytes);
  return { root, report, manifest: { schema: 'OfflineRagPolicyPackage/v1', driven_by: 'agent', candidate: policy,
    report: { path: 'report.json', digest: digest(bytes) }, queryCaptures: [] as unknown[] } };
}
function save(root: string, manifest: unknown, name = 'quality-policy.json') {
  const bytes = JSON.stringify(manifest); writeFileSync(join(root, name), bytes); return digest(bytes);
}
afterEach(() => { for (const root of roots.splice(0)) {
  if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith('rag-offline-package-')) throw new Error('Unexpected test cleanup root');
  rmSync(root, { recursive: true, force: true });
} });

describe('sealed offline policy evidence', () => {
  it('replays pinned path semantics independently of the host platform', () => {
    const source = 'export function normalize(value: string) { return path.normalize(value); }';
    const spec = { symbol: 'normalize', builtins: ['path'] };
    expect(executeCodeProbe(source, spec, {}, [{ args: ['C:/owner/../file.ts'] }], 'win32')).toEqual([{ value: 'C:\\file.ts' }]);
    expect(executeCodeProbe(source, spec, {}, [{ args: ['C:/owner/../file.ts'] }], 'linux')).toEqual([{ value: 'C:/file.ts' }]);
  });
  it('rejects policy drift and manifest names that escape the selected directory', () => {
    const { root, manifest } = fixture();
    const changed = { ...manifest, candidate: { ...policy, rrfK: 51 } };
    expect(() => verifyOfflineRagPolicyPackage(root, save(root, changed), 'quality-policy.json')).toThrow('candidate drift');
    expect(() => verifyOfflineRagPolicyPackage(root, pin, '../quality-policy.json')).toThrow('manifest name');
  });

  it('rejects forged positive summaries after reopening the original query bytes', () => {
    const { root, report, manifest } = fixture();
    cpSync(corpus, join(root, 'frozen-corpus'), { recursive: true });
    const raw = JSON.stringify({ candidate: report.candidateCommit, queryId: queries[0].id, arm: 'page',
      profile: report.profile, ownerPinsVerified: true, safetyViolations: 0, results: [] });
    writeFileSync(join(root, 'raw.json'), raw);
    report.queries[0].page.rawDigest = digest(raw);
    const reportBytes = JSON.stringify(report); writeFileSync(join(root, 'report.json'), reportBytes);
    manifest.report.digest = digest(reportBytes);
    manifest.queryCaptures = queries.flatMap(query => ['page', 'full'].map(arm => ({
      queryId: query.id, arm, path: 'raw.json', digest: digest(raw) })));
    expect(() => verifyOfflineRagPolicyPackage(root, save(root, manifest), 'quality-policy.json')).toThrow('Query summary differs');
  });

  it('checks source byte bounds and line coordinates before awarding precise references', () => {
    const bundle = loadFrozenRagCorpus(corpus, release.freezeDigest), gold = bundle.gold[0], sourceRef = gold.facts[0].sourceRef;
    const source = bundle.corpus.sources.find(row => row.id === gold.facts[0].sourceId)!;
    const length = readFileSync(join(bundle.root, source.path)).length;
    const observation = { ownerPinsVerified: true, safetyViolations: 0, results: [{ sourceRef }] };
    expect(gradeRagQuery(bundle, gold.queryId, observation).exactRefPrecision).toBe(1);
    for (const locator of [{ ...sourceRef.locator!, endByteExclusive: length + 1 },
      { ...sourceRef.locator!, startLine: sourceRef.locator!.startLine + 1 }]) {
      const grade = gradeRagQuery(bundle, gold.queryId, { ...observation, results: [{ sourceRef: { ...sourceRef, locator } }] });
      expect(grade.exactRefPrecision).toBe(0); expect(grade.safetyViolations).toBeGreaterThan(0);
    }
  });

  it('loads the bundled verifier outside the checkout without a compiler installation', async () => {
    const { root, manifest } = fixture(), entry = join(root, 'dist/project-rag-policy-verifier.mjs');
    const built = spawnSync(process.execPath, [resolve('scripts/build-rag-policy-verifier.mjs'), dirname(entry)],
      { cwd: resolve('.'), encoding: 'utf8', timeout: 30000, windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' } });
    expect(built.status, built.stderr).toBe(0);
    const verified = spawnSync(process.execPath, [entry, root, save(root, manifest), 'quality-policy.json'],
      { cwd: root, encoding: 'utf8', timeout: 15000, windowsHide: true, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' } });
    expect(verified.status).toBe(1);
    expect(verified.stderr).toContain('frozen-corpus');
    expect(verified.stderr).not.toMatch(/Cannot find package|Cannot find module/);
    const provenanceFile = join(dirname(entry), 'project-rag-policy-verifier.json');
    const provenance = JSON.parse(readFileSync(provenanceFile, 'utf8'));
    writeFileSync(provenanceFile, JSON.stringify({ ...provenance, cleanSource: true, candidate: 'b'.repeat(40) }));
    await expect(verifyPackagedPolicy(root, save(root, manifest), { runtimeRoot: root, manifestName: 'quality-policy.json' }))
      .rejects.toThrow('frozen-corpus');
  });
});
