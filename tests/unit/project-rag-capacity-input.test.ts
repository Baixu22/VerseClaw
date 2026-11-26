// @vitest-environment node
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadCapacityInput } from '../../scripts/lib/project-rag-capacity-input';
import { createEmbeddingSpace } from '../../openclaw_runtime/src/knowledge/retrieval/embedding-space';
import { sha256 } from '../../scripts/lib/project-rag-corpus.mjs';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(dimensions = 768) {
  const root = await mkdtemp(join(tmpdir(), 'capacity-input-')); roots.push(root);
  const save = async (name: string, value: unknown) => { const text = typeof value === 'string' ? value : JSON.stringify(value);
    await writeFile(join(root, name), text); return { path: name, digest: sha256(text) }; };
  const candidate = 'a'.repeat(40), content = 'agent fixture source';
  const sourceFile = await save('source.txt', content), corpusDigest = sha256('fixture snapshot');
  const space = createEmbeddingSpace({ providerRef: 'agent-fixture', model: 'fixture-model', modelRevision: 'fixture-r1', dimensions,
    maxInputTokens: 100, tokenizerId: 'fixture-tokenizer', tokenizerDigest: sha256('tokenizer'),
    inputFormat: { id: 'fixture', query: '{text}', document: '{text}' }, normalization: 'l2' });
  const vector = Array.from({ length: dimensions }, (_, i) => i === 0 ? 1 : 0);
  const source = { schema: 'SourceRef/v2', namespaceId: 'fixture', domain: 'wiki', authorityId: 'wiki', subjectId: 'source.txt', revision: '1',
    sourceDigest: sourceFile.digest, policyEpoch: sha256('policy'), locator: { coordinateSpace: 'raw-source-utf8-v1', startByte: 0,
      endByteExclusive: Buffer.byteLength(content), startLine: 1, endLine: 1 } };
  const receipt = { schema: 'ProjectRagEmbeddingCapture/v1', driven_by: 'agent', status: 'completed', candidate, spaceId: space.spaceId,
    providerRef: space.providerRef, model: space.model, responseId: 'agent-fixture-response', corpusDigest,
    outputs: [{ index: 0, vector, chunkDigest: sourceFile.digest, sourceDigest: sourceFile.digest }] };
  const documentReceipt = await save('document-response.json', { ...receipt, kind: 'document' });
  const queryContent = Array.from({ length: 31 }, (_, i) => `query-${i.toString().padStart(2, '0')}\n`).join('');
  const queryFile = await save('queries.txt', queryContent);
  const queries = Array.from({ length: 31 }, (_, i) => {
    const text = `query-${i.toString().padStart(2, '0')}\n`, startByte = i * Buffer.byteLength(text);
    return { id: 'query-' + i, source: { ...source, subjectId: 'queries.txt', sourceDigest: queryFile.digest,
      locator: { ...source.locator, startByte, endByteExclusive: startByte + Buffer.byteLength(text), startLine: i + 1, endLine: i + 1 } },
      chunkDigest: sha256(text), vector, sourceFile: queryFile };
  });
  const queryReceipt = await save('query-response.json', { ...receipt, kind: 'query',
    outputs: queries.map((query, index) => ({ index, vector, chunkDigest: query.chunkDigest, sourceDigest: queryFile.digest })) });
  const row = { id: 'vector-0', source, chunkDigest: sourceFile.digest, vector, sourceFile, receipt: { ...documentReceipt, index: 0 } };
  const manifest = { schema: 'ProjectRagCapacityInput/v1', driven_by: 'agent', provenance: 'real-model-output', candidate, corpusDigest,
    namespaceId: 'fixture', space, count: 1, vectors: await save('vectors.jsonl', JSON.stringify(row) + '\n'),
    queries: queries.map((query, index) => ({ ...query, receipt: { ...queryReceipt, index } })) };
  await save('manifest.json', manifest);
  return { root, candidate, row, manifest, save, file: join(root, 'manifest.json') };
}
it.each([768, 4096])('streams %i-dimensional provider-bound vectors without running a capacity benchmark', async dimensions => {
  const f = await fixture(dimensions), input = await loadCapacityInput(f.file, f.candidate);
  expect(input.space.dimensions).toBe(dimensions); expect(input.queries).toHaveLength(31);
  const rows = []; for await (const row of input.rows()) rows.push(row);
  expect(rows).toHaveLength(1); expect(rows[0].vector).toHaveLength(dimensions);
});
it('rejects source, vector and candidate substitutions', async () => {
  const f = await fixture();
  await expect(loadCapacityInput(f.file, 'b'.repeat(40))).rejects.toThrow('candidate mismatch');
  const input = await loadCapacityInput(f.file, f.candidate);
  f.row.vector[0] = 0; f.row.vector[1] = 1;
  await f.save('vectors.jsonl', JSON.stringify(f.row) + '\n');
  await expect(async () => { for await (const _row of input.rows()) { /* exhaust verified input */ } }).rejects.toThrow('differs from provider');
  await f.save('source.txt', 'changed');
  const changed = await loadCapacityInput(f.file, f.candidate);
  await expect(async () => { for await (const _row of changed.rows()) { /* read source bytes */ } }).rejects.toThrow('source/receipt changed');
});
it('rejects truncated streams and a forged space identity', async () => {
  const f = await fixture(), input = await loadCapacityInput(f.file, f.candidate);
  await f.save('vectors.jsonl', JSON.stringify(f.row));
  await expect(async () => { for await (const _row of input.rows()) { /* exhaust verified input */ } }).rejects.toThrow('final newline');
  f.manifest.space = { ...f.manifest.space, spaceId: sha256('wrong-space') }; await f.save('manifest.json', f.manifest);
  await expect(loadCapacityInput(f.file, f.candidate)).rejects.toThrow('space mismatch');
});
it('rejects aliases of one vector response used to inflate the capacity row count', async () => {
  const f = await fixture();
  f.manifest.count = 2;
  f.manifest.vectors = await f.save('vectors.jsonl', [f.row, { ...f.row, id: 'renamed-copy' }].map(row => JSON.stringify(row)).join('\n') + '\n');
  await f.save('manifest.json', f.manifest);
  const input = await loadCapacityInput(f.file, f.candidate);
  await expect(async () => { for await (const _row of input.rows()) { /* consume input */ } }).rejects.toThrow('Repeated capacity evidence');
});
it('rejects repeated query evidence despite different query ids', async () => {
  const f = await fixture();
  f.manifest.queries[1] = { ...f.manifest.queries[0], id: 'different-label' };
  await f.save('manifest.json', f.manifest);
  await expect(loadCapacityInput(f.file, f.candidate)).rejects.toThrow('Repeated capacity query evidence');
});
