// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256 } from '../../scripts/lib/project-rag-corpus.mjs';
import { gradeRagQuery, RAG_QUERY_EVALUATOR_VERSION, type RagQueryBundle } from '../../scripts/lib/project-rag-query-grade.mjs';
import type { SourceRefV2 } from '../../openclaw_runtime/src/runtime-core/knowledge-owner-read';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(content = 'Budget is 100 USD. Backups last 30 days.') {
  const root = mkdtempSync(join(tmpdir(), 'rag-query-grade-')); roots.push(root);
  const raw = Buffer.from(content);
  const ref: SourceRefV2 = { schema: 'SourceRef/v2', domain: 'wiki', authorityId: 'memory-wiki', namespaceId: 'unit-owner',
    subjectId: 'source.md', revision: '1', sourceDigest: sha256(raw), policyEpoch: sha256('unit-policy') };
  writeFileSync(join(root, 'source.md'), raw);
  const locator = (startByte: number, endByteExclusive: number) => ({ coordinateSpace: 'raw-source-utf8-v1' as const,
    startByte, endByteExclusive, startLine: 1 + raw.subarray(0, startByte).filter(byte => byte === 10).length,
    endLine: 1 + raw.subarray(0, endByteExclusive - 1).filter(byte => byte === 10).length });
  const bundle: RagQueryBundle = { root, corpus: { sources: [{ ref, path: 'source.md' }] },
    gold: [{ queryId: 'q', facts: [{ sourceRef: { ...ref, locator: locator(0, raw.length) } }] }] };
  const hit = (start = 0, end = raw.length, patch: Partial<SourceRefV2> = {}) => ({ sourceRef: { ...ref, locator: locator(start, end), ...patch } });
  const grade = (results: unknown[]) => gradeRagQuery(bundle, 'q', { results, ownerPinsVerified: true, safetyViolations: 0 });
  return { root, raw, ref, bundle, locator, hit, grade };
}

describe('versioned owner support coverage', () => {
  it('separates one-byte overlap from complete support recall', () => {
    const f = fixture(), partial = f.grade([f.hit(0, 1)]), full = f.grade([f.hit()]);
    expect(partial).toMatchObject({ evaluatorVersion: RAG_QUERY_EVALUATOR_VERSION, recallAt20: 0, overlapRecallAt20: 1 });
    expect(partial.supportCoverageAt20).toBeCloseTo(1 / f.raw.length);
    expect(full).toMatchObject({ recallAt20: 1, supportCoverageAt20: 1, ndcg5: 1 });
  });
  it('credits a later complete hit at its own rank', () => {
    const f = fixture();
    const partial = f.grade([f.hit(0, 1)]), completed = f.grade([f.hit(0, 1), f.hit()]);
    expect(completed.recallAt20).toBe(1);
    expect(completed.ndcg5).toBeGreaterThan(partial.ndcg5);
    expect(completed.ndcg5).toBeCloseTo(1 / Math.log2(3));
  });
  it('unions complementary fragments and does not double-count overlap', () => {
    const f = fixture();
    const partial = f.grade([f.hit(0, 10), f.hit(5, 15)]);
    expect(partial.supportCoverageAt20).toBeCloseTo(15 / f.raw.length);
    expect(partial.recallAt20).toBe(0);
    expect(f.grade([f.hit(0, 10), f.hit(10)]).recallAt20).toBe(1);
  });
  it('does not fill a gap or improve ranking with duplicates', () => {
    const f = fixture(), hit = f.hit(0, 10);
    expect(f.grade([hit, hit, hit])).toEqual(f.grade([hit]));
    expect(f.grade([f.hit(0, 10), f.hit(11)]).recallAt20).toBe(0);
  });
  it('uses the support range rather than the larger citation envelope', () => {
    const f = fixture(); f.bundle.gold[0].facts[0].support = { startByte: 10, endByteExclusive: 17 };
    expect(f.grade([f.hit(10, 17)])).toMatchObject({ ndcg5: 1, recallAt20: 1 });
    expect(f.grade([f.hit(0, 10)])).toMatchObject({ ndcg5: 0, overlapRecallAt20: 0 });
  });
  it('keeps repeated and overlapping multi-fact hits within normalized ranking bounds', () => {
    const f = fixture();
    f.bundle.gold[0].facts = [
      { sourceRef: f.ref, support: { startByte: 0, endByteExclusive: 10 } },
      { sourceRef: f.ref, support: { startByte: 10, endByteExclusive: f.raw.length } },
    ];
    const combined = f.grade([f.hit(), f.hit()]);
    expect(combined.recallAt20).toBe(1); expect(combined.ndcg5).toBeLessThanOrEqual(1);
    expect(combined.ndcg5).toBe(f.grade([f.hit()]).ndcg5);
    expect(f.grade([f.hit(), f.hit(10)]).ndcg5).toBeCloseTo(1);
    expect(f.grade([f.hit(0, 10), f.hit(10)]).ndcg5).toBeCloseTo(1);
  });
  it.each(['revision', 'sourceDigest', 'policyEpoch', 'namespaceId'] as const)('rejects a changed %s', field => {
    const f = fixture(), result = f.grade([f.hit(0, f.raw.length, { [field]: 'changed' })]);
    expect(result).toMatchObject({ recallAt20: 0, ndcg5: 0, exactRefPrecision: 0, safetyViolations: 1 });
  });
  it('does not lend earlier bytes to the relevance grade of a later rank', () => {
    const f = fixture();
    f.bundle.gold[0].facts = [
      { sourceRef: f.ref, support: { startByte: 0, endByteExclusive: 10 } },
      { sourceRef: f.ref, support: { startByte: 0, endByteExclusive: 20 } },
    ];
    const measured = f.grade([f.hit(0, 10), f.hit(10, 20)]);
    expect(measured.recallAt20).toBe(1);
    expect(measured.ndcg5).toBeCloseTo((7 + 1 / Math.log2(3)) / (7 + 7 / Math.log2(3)));
    expect(f.grade([f.hit(0, 10), f.hit(0, 10), f.hit(10, 20)]).ndcg5).toBeLessThan(measured.ndcg5);
  });
  it('rejects changed raw bytes even when the submitted pin is unchanged', () => {
    const f = fixture(); writeFileSync(join(f.root, 'source.md'), Buffer.alloc(f.raw.length, 65));
    expect(f.grade([f.hit()])).toMatchObject({ recallAt20: 0, exactRefPrecision: 0, safetyViolations: 1 });
  });
  it('checks UTF-8 boundaries and source line numbers', () => {
    const f = fixture('中文\nbackup');
    expect(f.grade([f.hit(0, 1)]).safetyViolations).toBe(1);
    expect(f.grade([f.hit()]).recallAt20).toBe(1);
    const bad = f.hit(); bad.sourceRef.locator!.startLine = 2;
    expect(f.grade([bad]).safetyViolations).toBe(1);
  });
  it('limits coverage to the first twenty hits', () => {
    const f = fixture(); f.bundle.gold[0].facts[0].support = { startByte: 10, endByteExclusive: f.raw.length };
    const misses = Array.from({ length: 20 }, () => f.hit(0, 5));
    expect(f.grade([...misses, f.hit()])).toMatchObject({ recallAt20: 0, supportCoverageAt20: 0, ndcg5: 0 });
  });
  it('fails closed on duplicate oracle support and absent safety counts', () => {
    const f = fixture(); f.bundle.gold[0].facts.push(f.bundle.gold[0].facts[0]);
    expect(() => f.grade([f.hit()])).toThrow('Duplicate gold support');
    const clean = fixture();
    expect(() => gradeRagQuery(clean.bundle, 'q', { results: [] })).toThrow('Actual safety count');
  });
});
