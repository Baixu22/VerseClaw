import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createEmbeddingSpace, validateEmbeddingVector, type EmbeddingSpaceV1 } from '../../openclaw_runtime/src/knowledge/retrieval/embedding-space';
import type { SourceRefV2 } from '../../shared/knowledge/owner-read-contract';

type Pin = { path: string; digest: string };
export type CapacityVector = { id: string; source: SourceRefV2; chunkDigest: string; vector: number[];
  sourceFile: Pin; receipt: Pin & { index: number } };
type CapacityInput = { schema: 'ProjectRagCapacityInput/v1'; driven_by: 'agent'; provenance: 'real-model-output';
  candidate: string; corpusDigest: string; namespaceId: string; space: EmbeddingSpaceV1; count: number; vectors: Pin; queries: CapacityVector[] };

/** Stream frozen model output and verify its original provider response and owner bytes. */
export async function loadCapacityInput(file: string, candidate: string) {
  const manifestFile = await realpath(file), root = dirname(manifestFile);
  assert((await stat(manifestFile)).size <= 16 * 1024 * 1024, 'Capacity manifest exceeds read budget');
  const bytes = await readFile(manifestFile), input = JSON.parse(bytes.toString('utf8')) as CapacityInput;
  const hash = (value: Buffer | string) => 'sha256:' + createHash('sha256').update(value).digest('hex');
  assert(input.schema === 'ProjectRagCapacityInput/v1' && input.driven_by === 'agent' && input.provenance === 'real-model-output'
    && input.candidate === candidate, 'Capacity input provenance/candidate mismatch');
  const space = createEmbeddingSpace(input.space);
  assert(space.spaceId === input.space.spaceId && [768, 4096].includes(space.dimensions), 'Capacity input space mismatch');
  assert(Number.isSafeInteger(input.count) && input.count > 0 && input.count <= 1000000
    && /^sha256:[a-f0-9]{64}$/.test(input.corpusDigest), 'Invalid capacity input size or corpus');
  const inside = async (name: string) => {
    assert(typeof name === 'string' && name && !isAbsolute(name), 'Invalid capacity input path');
    const resolved = await realpath(resolve(root, name)), sub = relative(root, resolved);
    assert(!isAbsolute(sub) && sub !== '..' && !sub.startsWith('..' + sep), 'Capacity input escaped root'); return resolved;
  };
  const cache = new Map<string, Buffer>();
  const read = async (pin: Pin) => {
    assert(pin && /^sha256:[a-f0-9]{64}$/.test(pin.digest), 'Capacity input pin missing');
    const key = pin.path + ':' + pin.digest;
    if (cache.has(key)) return cache.get(key)!;
    const filename = await inside(pin.path); assert((await stat(filename)).size <= 4 * 1024 * 1024, 'Capacity source/receipt exceeds read budget');
    const raw = await readFile(filename); assert.equal(hash(raw), pin.digest, 'Capacity source/receipt changed');
    cache.set(key, raw); if (cache.size > 8) cache.delete(cache.keys().next().value!);
    return raw;
  };
  const validate = async (row: CapacityVector, kind: 'query' | 'document') => {
    assert(row && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 256, 'Invalid capacity vector id');
    const source = row.source, locator = source?.locator;
    assert(input.namespaceId && source?.namespaceId === input.namespaceId && source?.schema === 'SourceRef/v2' && locator?.coordinateSpace === 'raw-source-utf8-v1'
      && Number.isSafeInteger(locator.startByte) && locator.startByte >= 0 && Number.isSafeInteger(locator.endByteExclusive)
      && locator.endByteExclusive > locator.startByte, 'Capacity vector lacks an owner range');
    const raw = await read(row.sourceFile);
    assert(hash(raw) === source.sourceDigest && locator.endByteExclusive <= raw.length
      && hash(raw.subarray(locator.startByte, locator.endByteExclusive)) === row.chunkDigest, 'Capacity owner bytes mismatch');
    const receipt = JSON.parse((await read(row.receipt)).toString('utf8'));
    assert(receipt.schema === 'ProjectRagEmbeddingCapture/v1' && receipt.driven_by === 'agent'
      && receipt.status === 'completed' && receipt.candidate === candidate && receipt.spaceId === space.spaceId
      && receipt.providerRef === space.providerRef && receipt.model === space.model && receipt.responseId && receipt.kind === kind
      && receipt.corpusDigest === input.corpusDigest && Number.isSafeInteger(row.receipt.index), 'Capacity provider provenance mismatch');
    const original = receipt.outputs?.find((output: { index: number }) => output.index === row.receipt.index);
    assert(original?.chunkDigest === row.chunkDigest && original.sourceDigest === source.sourceDigest, 'Capacity provider source binding mismatch');
    const vector = validateEmbeddingVector(space, row.vector), expected = validateEmbeddingVector(space, original.vector);
    assert(vector.every((value, i) => Math.abs(value - expected[i]) < 1e-7), 'Capacity vector differs from provider output');
    return { ...row, vector };
  };
  assert(Array.isArray(input.queries) && input.queries.length === 31, 'Capacity requires 31 frozen model queries');
  const queries: CapacityVector[] = [];
  for (const query of input.queries) queries.push(await validate(query, 'query'));
  assert(new Set(queries.map(query => query.id)).size === queries.length, 'Duplicate capacity queries');
  const vectorFile = await inside(input.vectors.path);
  assert(/^sha256:[a-f0-9]{64}$/.test(input.vectors.digest), 'Capacity vectors digest missing');
  const rows = async function* () {
    const hashStream = createHash('sha256'), decoder = new StringDecoder('utf8'), ids = new Set<string>();
    let pending = '', count = 0;
    for await (const chunk of createReadStream(vectorFile, { highWaterMark: 64 * 1024 })) {
      hashStream.update(chunk); pending += decoder.write(chunk as Buffer);
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        assert(Buffer.byteLength(line) <= 1024 * 1024 && line.trim(), 'Capacity vector row invalid or too large');
        const row = await validate(JSON.parse(line), 'document');
        assert(!ids.has(row.id) && ++count <= input.count, 'Duplicate or excess capacity rows'); ids.add(row.id); yield row;
      }
      assert(Buffer.byteLength(pending) <= 1024 * 1024, 'Capacity vector row too large');
    }
    pending += decoder.end(); assert(!pending.trim(), 'Capacity JSONL requires a final newline');
    assert.equal(count, input.count, 'Capacity vector count mismatch');
    assert.equal('sha256:' + hashStream.digest('hex'), input.vectors.digest, 'Capacity vector file changed');
  };
  return { input, space, queries, rows, digest: hash(bytes) };
}
