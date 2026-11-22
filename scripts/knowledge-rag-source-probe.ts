import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readMemoryWikiChunkCitation, readMemoryWikiRetrievalChunks, resolveMemoryWikiConfig } from '../openclaw_runtime/extensions/memory-wiki/runtime-api';
import { citationLocatorForChunk, type ChunkerProfileV1 } from '../openclaw_runtime/src/plugin-sdk/knowledge-retrieval';
import { digestOwnerReadContent } from '../openclaw_runtime/src/runtime-core/knowledge-owner-read';

async function main() {
  const output = process.argv[2];
  assert(output, 'Pass an output receipt path');
  const root = await mkdtemp(join(tmpdir(), 'rag03-source-probe-'));
  try {
    await mkdir(join(root, 'concepts'));
    const file = join(root, 'concepts/probe.md');
    const content = '\uFEFF---\r\ntitle: Agent source probe\r\nrevision: 1\r\nstatus: active\r\ntrust: confirmed\r\n---\r\n' +
      '# 原始来源\r\n\r\nEnglish_identifier camelCaseValue 中文 日本語 русский 😀.\r\n\r\n## Procedure\r\n\r\n' +
      '1. Read the owner.\r\n2. Verify bytes.\r\n\r\n| Kind | Value |\r\n| --- | --- |\r\n| trace | 原文 |\r\n\r\n' +
      '~~~typescript\r\nconst message = "' + '中文😀example'.repeat(160) + '";\r\n~~~\r\n';
    await writeFile(file, content);
    const config = resolveMemoryWikiConfig({ vault: { path: root }, search: { backend: 'local', corpus: 'wiki' } });
    const tokenizer = { id: 'agent-fixture-codepoints/v1', digest: digestOwnerReadContent('agent-fixture-codepoints/v1'), count: (text: string) => [...text].length };
    const profile: ChunkerProfileV1 = { schema: 'ChunkerProfile/v1', version: 'markdown-structure-v2', targetTokens: 384, maxTokens: 768, maxChars: 2400,
      overlap: 0, tokenizerId: tokenizer.id, tokenizerDigest: tokenizer.digest };
    const result = await readMemoryWikiRetrievalChunks({ config, lookup: 'concepts/probe.md', profile, tokenizer });
    assert.equal(result.status, 'admitted');
    if (result.status !== 'admitted') throw Error(result.reason);
    const bytes = await readFile(file);
    let roundTrips = 0;
    for (const chunk of result.chunks) {
      const range = chunk.source.locator;
      assert.equal(bytes.subarray(range.startByte, range.endByteExclusive).toString('utf8'), chunk.quote);
      assert.equal(chunk.chunkDigest, digestOwnerReadContent(chunk.quote));
      assert(chunk.tokenCount <= profile.maxTokens && [...chunk.retrievalText].length <= profile.maxChars);
      const reopened = await readMemoryWikiChunkCitation({ config, lookup: 'concepts/probe.md', locator: citationLocatorForChunk(chunk) });
      assert.deepEqual(reopened, { status: 'exact-match', quote: chunk.quote });
      roundTrips++;
    }
    assert.equal(result.chunks.map(c => c.quote).join(''), result.document.text);
    const locator = citationLocatorForChunk(result.chunks[0]!);
    await writeFile(file, content.replace('revision: 1', 'revision: 2'));
    const changed = await readMemoryWikiChunkCitation({ config, lookup: 'concepts/probe.md', locator });
    assert.deepEqual(changed, { status: 'invalid', reason: 'revision_mismatch' });
    await writeFile(file, content.replace('status: active', 'status: revoked'));
    const revoked = await readMemoryWikiChunkCitation({ config, lookup: 'concepts/probe.md', locator });
    assert.deepEqual(revoked, { status: 'invalid', reason: 'revoked' });
    await rm(file);
    const deleted = await readMemoryWikiChunkCitation({ config, lookup: 'concepts/probe.md', locator });
    assert.deepEqual(deleted, { status: 'invalid', reason: 'not_found' });
    const receipt = { schema: 'ProjectRagSourceChunkProbe/v1', actor: 'codex/project-rag-source-probe', driven_by: 'agent',
      candidate: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      fixtureOrigin: 'agent-authored-local-Wiki-owner', tokenizerMode: 'agent-fixture-codepoints',
      sourceDigest: digestOwnerReadContent(bytes), parser: result.document.parser,
      chunks: result.chunks.map(c => ({ chunkId: c.chunkId, kind: c.kind, ordinal: c.ordinal, sectionId: c.sectionId, locator: c.source.locator,
        chunkDigest: c.chunkDigest, tokenCount: c.tokenCount, retainedBytes: Buffer.byteLength(c.quote), retrievalCharacters: [...c.retrievalText].length })),
      roundTrips, noLostBytes: true, changed, revoked, deleted, status: 'pass' };
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(resolve(output), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ status: receipt.status, roundTrips, output: resolve(output) }));
  } finally { await rm(root, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
