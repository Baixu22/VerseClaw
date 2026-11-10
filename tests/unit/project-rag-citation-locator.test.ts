// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingestMemoryWikiSource, readMemoryWikiChunkCitation, readMemoryWikiRetrievalChunks, resolveMemoryWikiConfig } from '../../openclaw_runtime/extensions/memory-wiki/runtime-api';
import { citationLocatorForChunk, type ChunkerProfileV1, type KnowledgeChunkV2, type KnowledgeTokenizer } from '../../openclaw_runtime/src/plugin-sdk/knowledge-retrieval';
import { digestOwnerReadContent } from '../../openclaw_runtime/src/runtime-core/knowledge-owner-read';

// Fixture token units are intentionally deterministic; a provider must supply its model tokenizer.
const tokenizer: KnowledgeTokenizer = { id: 'agent-fixture-codepoints/v1', digest: digestOwnerReadContent('agent-fixture-codepoints/v1'), count: text => [...text].length };
const profile: ChunkerProfileV1 = { schema: 'ChunkerProfile/v1', version: 'markdown-structure-v2', targetTokens: 160, maxTokens: 768, maxChars: 2400, overlap: 0,
  tokenizerId: tokenizer.id, tokenizerDigest: tokenizer.digest };
const body = '# 接入 / Integration\r\n\r\nEnglish_identifier and camelCaseValue. 中文检索 日本語 русский 😀.\r\n\r\n## Procedure\r\n\r\n1. Read the owner.\r\n2. Verify bytes.\r\n\r\n| Key | Value |\r\n| --- | --- |\r\n| timeout | 100 |\r\n\r\n~~~typescript\r\nconst api_key_name = "fixture";\r\n~~~\r\n';

describe('Project RAG real-owner chunk citations', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'project-rag-citation-')); await mkdir(join(root, 'concepts')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const config = () => resolveMemoryWikiConfig({ vault: { path: root }, search: { backend: 'local', corpus: 'wiki' } });
  const page = (extra = '', text = body) => '\uFEFF---\r\ntitle: Source\r\nrevision: 1\r\nstatus: active\r\ntrust: confirmed\r\n' + extra + '---\r\n' + text;
  const save = (raw: string) => writeFile(join(root, 'concepts/source.md'), raw, 'utf8');
  const read = (signal?: AbortSignal) => readMemoryWikiRetrievalChunks({ config: config(), lookup: 'concepts/source.md', profile, tokenizer, signal });
  const reopen = (chunk: KnowledgeChunkV2, signal?: AbortSignal) => readMemoryWikiChunkCitation({ config: config(), lookup: 'concepts/source.md', locator: citationLocatorForChunk(chunk), signal });

  it('round-trips frontmatter, CRLF, multilingual text and every chunk through the exact owner range', async () => {
    const raw = page(); await save(raw);
    const result = await read(); expect(result.status).toBe('admitted');
    if (result.status !== 'admitted') throw Error(result.reason);
    expect(result.document.parser).toEqual({ id: 'owner-markdown/v1', encoding: 'utf-8', normalization: 'identity-raw-utf8' });
    expect(result.document.text).toBe(body);
    const bytes = await readFile(join(root, 'concepts/source.md'));
    for (const chunk of result.chunks) {
      const span = chunk.source.locator;
      expect(bytes.subarray(span.startByte, span.endByteExclusive).toString('utf8')).toBe(chunk.quote);
      expect(chunk.source.sourceDigest).toBe(digestOwnerReadContent(bytes));
      expect(chunk.chunkDigest).toBe(digestOwnerReadContent(chunk.quote));
      expect(chunk.quote).not.toContain('title: Source');
      expect(await reopen(chunk)).toEqual({ status: 'exact-match', quote: chunk.quote });
    }
    expect(result.chunks.map(c => c.kind)).toEqual(expect.arrayContaining(['heading', 'paragraph', 'step', 'table', 'code']));
    const again = await read(); if (again.status !== 'admitted') throw Error(again.reason);
    expect(again.chunks.map(c => c.chunkId)).toEqual(result.chunks.map(c => c.chunkId));
  });

  it.each(['local-file', 'watched-directory', 'github-public-directory'])('normalizes accepted %s provenance through the same owner reader', async sourceType => {
    await save(page(`sourceType: ${sourceType}\r\nsourcePath: "fixture/source.md"\r\n`));
    const result = await read(); if (result.status !== 'admitted') throw Error(result.reason);
    expect(result.document.provenance).toEqual({ kind: { 'local-file': 'file', 'watched-directory': 'directory', 'github-public-directory': 'github' }[sourceType],
      sourcePath: 'fixture/source.md', sourceRevision: '1' });
  });

  it('rejects stale version, raw byte, policy and chunk identity pins after an owner edit', async () => {
    await save(page()); const result = await read(); if (result.status !== 'admitted') throw Error(result.reason);
    const chunk = result.chunks.find(c => c.kind === 'paragraph')!;
    const locator = citationLocatorForChunk(chunk);
    locator.chunkId = 'chunk:sha256:' + 'f'.repeat(64);
    expect(await readMemoryWikiChunkCitation({ config: config(), lookup: 'concepts/source.md', locator })).toMatchObject({ status: 'invalid', reason: 'chunk_identity_mismatch' });
    await save(page().replace('revision: 1', 'revision: 2'));
    expect(await reopen(chunk)).toMatchObject({ status: 'invalid', reason: 'revision_mismatch' });
    await save(page('', body.replace('English_identifier', 'Changed_identifier')));
    expect(await reopen(chunk)).toMatchObject({ status: 'invalid', reason: 'digest_mismatch' });
    await save(page('acl:\r\n  read: [someone-else]\r\n'));
    expect(await reopen(chunk)).toMatchObject({ status: 'invalid', reason: 'acl_denied' });
    await rm(join(root, 'concepts/source.md'));
    expect(await reopen(chunk)).toMatchObject({ status: 'invalid', reason: 'not_found' });
  });

  it('denies revoked, private and cancelled content before producing chunks', async () => {
    await save(page().replace('status: active', 'status: revoked'));
    expect(await read()).toMatchObject({ status: 'denied', reason: 'revoked' });
    await save(page('privacyTier: private\r\n'));
    expect(await read()).toMatchObject({ status: 'denied', reason: 'sensitive' });
    await save(page()); const controller = new AbortController(); controller.abort();
    expect(await read(controller.signal)).toMatchObject({ status: 'denied', reason: 'cancelled' });
  });

  it('returns a parse failure for invalid source encoding and empty content', async () => {
    await save(page('', ''));
    await expect(read()).rejects.toThrow(/empty/);
    await writeFile(join(root, 'concepts/source.md'), Buffer.from([0xff, 0xfe, 0xff]));
    await expect(read()).rejects.toThrow();
  });

  it('normalizes an actual file import through the existing Wiki source owner', async () => {
    const inputPath = join(root, 'input.txt');
    await writeFile(inputPath, '\uFEFF文件 source\r\nEnglish_identifier 日本語 русский 😀\r\n');
    const imported = await ingestMemoryWikiSource({ config: config(), inputPath, title: 'Imported Source' });
    const result = await readMemoryWikiRetrievalChunks({ config: config(), lookup: imported.pagePath, profile, tokenizer });
    if (result.status !== 'admitted') throw Error(result.reason);
    expect(result.document.provenance).toMatchObject({ kind: 'file', sourcePath: inputPath });
    expect(result.chunks.some(c => c.quote.includes('English_identifier 日本語 русский 😀'))).toBe(true);
    for (const chunk of result.chunks) {
      expect(await readMemoryWikiChunkCitation({ config: config(), lookup: imported.pagePath, locator: citationLocatorForChunk(chunk) })).toEqual({ status: 'exact-match', quote: chunk.quote });
    }
  });

  it('rejects invalid encoding and late NUL bytes before creating a source page', async () => {
    const inputPath = join(root, 'invalid.txt');
    for (const bytes of [Buffer.from([0x61, 0xc3, 0x28]), Buffer.concat([Buffer.from('x'.repeat(4097)), Buffer.from([0])])]) {
      await writeFile(inputPath, bytes);
      await expect(ingestMemoryWikiSource({ config: config(), inputPath, title: 'Must Not Exist' })).rejects.toThrow(/invalid UTF-8|binary/);
      await expect(readFile(join(root, 'sources/must-not-exist.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
});
