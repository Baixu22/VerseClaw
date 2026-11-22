import { afterEach, describe, expect, it, vi } from 'vitest';
import { lexicalOverlapScore } from '../../openclaw_runtime/src/context-engine/source-set';
import { readBoundedKnowledgePage, retrieveSelectedSourceSetEvidence } from '@electron/services/knowledge-source-set-answer';
import { createSiliconFlowEmbeddingProvider } from '@electron/services/knowledge-embedding-provider';
import { proxyAwareFetch } from '@electron/utils/proxy-fetch';

vi.mock('@electron/utils/proxy-fetch', () => ({ proxyAwareFetch: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
const ref = { id: 'runbook.md', path: 'runbook.md', kind: 'wiki' as const };

describe('Chinese and bounded long-source retrieval', () => {
  it.each([
    ['网关部署端口是什么', '网关部署端口配置为8080。', '花园浇水时间'],
    ['deployment port', 'Deployment port is 8080.', 'Garden watering schedule'],
  ])('recalls relevant words in %s and leaves unrelated text at zero', (query, hit, miss) => {
    expect(lexicalOverlapScore(query, hit)).toBeGreaterThan(0);
    expect(lexicalOverlapScore(query, miss)).toBe(0);
  });
  const lines = Array.from({ length: 1000 }, (_, index) => index === 220 ? '网关部署端口配置为8080。' : `filler ${index}`);
  const reader = (patch: (from: number) => Record<string, unknown> = () => ({})) => vi.fn(async (range: { fromLine?: number; lineCount: number }) => {
    const fromLine = range.fromLine ?? 1;
    return { path: ref.path, corpus: 'wiki', revision: 2, updatedAt: '2026-11-05T00:00:00Z',
      fromLine, totalLines: lines.length, truncated: fromLine + range.lineCount <= lines.length,
      content: lines.slice(fromLine - 1, fromLine - 1 + range.lineCount).join('\n'), ...patch(fromLine) };
  });
  it('continues to a matching tail window and discloses remaining unread lines', async () => {
    const read = reader();
    const page = await readBoundedKnowledgePage({ ref, question: '网关部署端口是什么', read });
    const result = await retrieveSelectedSourceSetEvidence({ question: '网关部署端口是什么', sourceRefs: [ref], readPage: async () => page });
    expect(result.modelSources[0].content).toContain('8080');
    expect(result.sources[0].readRange).toEqual({ fromLine: 161, toLine: 240, totalLines: 1000, truncated: true });
    expect(read).toHaveBeenCalledTimes(10);
    expect(result.unknowns.join(' ')).toContain('unread lines');
  });
  it.each([{ revision: 3 }, { acl: { read: ['other'] } }, { privacyTier: 'secret' }])('rejects changing owner state during continuation %j', async patch => {
    const page = await readBoundedKnowledgePage({ ref, question: 'port', read: reader(from => from > 1 ? patch : {}) });
    const result = await retrieveSelectedSourceSetEvidence({ question: 'port', sourceRefs: [ref], readPage: async () => page });
    expect(result.sources).toEqual([]);
    expect(result.sourceSet.rejections[0].visibleReason).toContain('source changed');
  });
  it('never continues a rejected first read', async () => {
    const read = reader(() => ({ acl: { read: ['other'] } }));
    await readBoundedKnowledgePage({ ref, question: 'port', read });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('content-addressed embedding cache', () => {
  it('uses the owner-selected Qwen VL model when no model override is set', async () => {
    vi.stubEnv('SILICONFLOW_API_KEY', 'agent-fixture-default-model');
    vi.stubEnv('SILICONFLOW_BASE_URL', '');
    vi.stubEnv('SILICONFLOW_EMBEDDING_MODEL', '');
    const requestImpl = vi.fn<typeof proxyAwareFetch>(async () => new Response(JSON.stringify({
      data: [{ index: 0, embedding: [1, 0] }],
    })));
    const provider = createSiliconFlowEmbeddingProvider({ requestImpl });
    await provider.embedQuery('owner-selected embedding model');
    const [url, init] = requestImpl.mock.calls[0];
    expect(url).toBe('https://api.siliconflow.cn/v1/embeddings');
    expect(JSON.parse(String(init?.body)).model).toBe('Qwen/Qwen3-VL-Embedding-8B');
  });

  it('reuses query/document vectors across providers and invalidates content, model, endpoint and credential scope', async () => {
    vi.stubEnv('SILICONFLOW_API_KEY', 'agent-fixture-cache-1');
    vi.stubEnv('SILICONFLOW_EMBEDDING_MODEL', 'agent-cache-model');
    const fetch = vi.mocked(proxyAwareFetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ data: body.input.map((_: string, index: number) => ({ index, embedding: [1, index] })) }));
    });
    const first = createSiliconFlowEmbeddingProvider();
    await first.embedBatch(['version one', 'version one']);
    await createSiliconFlowEmbeddingProvider().embedQuery('version one');
    expect(fetch).toHaveBeenCalledTimes(1);
    const vector = await first.embedQuery('version one'); vector[0] = 123;
    expect((await first.embedQuery('version one'))[0]).toBe(1);
    await first.embedQuery('version two');
    vi.stubEnv('SILICONFLOW_EMBEDDING_MODEL', 'another-model');
    expect(createSiliconFlowEmbeddingProvider().id).not.toBe(first.id);
    await createSiliconFlowEmbeddingProvider().embedQuery('version one');
    vi.stubEnv('SILICONFLOW_BASE_URL', 'https://example.test/v1');
    await createSiliconFlowEmbeddingProvider().embedQuery('version one');
    vi.stubEnv('SILICONFLOW_API_KEY', 'agent-fixture-cache-2');
    await createSiliconFlowEmbeddingProvider().embedQuery('version one');
    expect(fetch).toHaveBeenCalledTimes(5);
  });
  it('does not cache failed or invalid provider results', async () => {
    vi.stubEnv('SILICONFLOW_API_KEY', 'agent-fixture-cache-errors');
    const fetch = vi.mocked(proxyAwareFetch).mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ index: 0, embedding: [null] }] })))
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] })));
    const provider = createSiliconFlowEmbeddingProvider();
    await expect(provider.embedQuery('failure')).rejects.toThrow('503');
    await expect(provider.embedQuery('failure')).rejects.toThrow('vector');
    expect(await provider.embedQuery('failure')).toEqual([1, 0]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
