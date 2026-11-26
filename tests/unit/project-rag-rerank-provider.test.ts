// @vitest-environment node
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryWikiRerankService } from '../../openclaw_runtime/extensions/memory-wiki/src/retrieval-rerank';
import { resolveMemoryWikiConfig } from '../../openclaw_runtime/extensions/memory-wiki/src/config';
import { createEndpointRerankProvider } from '../../openclaw_runtime/src/knowledge/retrieval/rerank';
import { createRetrievalPlan, runRetrievalPlan, type RetrievalHit } from '../../openclaw_runtime/src/knowledge/retrieval/plan';
import type { SourceRefV2 } from '../../shared/knowledge/owner-read-contract';

const ref = (id: string): SourceRefV2 => ({ schema: 'SourceRef/v2', domain: 'wiki', authorityId: 'memory-wiki', namespaceId: 'fixture', subjectId: id, revision: '1', sourceDigest: `sha256:${'a'.repeat(64)}`, policyEpoch: `sha256:${'b'.repeat(64)}` });
const hit = (id: string): RetrievalHit<string> => ({ id, sourceRef: ref(id), rawScore: 1, scoreKind: 'fixture', data: id });
const providerStub = () => ({ schema: 'RerankProvider/v1' as const, providerRef: 'fixture', model: 'Qwen/Qwen3-Reranker-0.6B' });

describe('Project RAG RerankProvider/v1', () => {
  it('reads SiliconFlow nested token usage for every completed batch', async () => {
    const stored = JSON.parse(await readFile(resolve('harness/specs/fixtures/project-rag/rag-a1-adaptation-20261125/siliconflow-rerank-response.json'), 'utf8'));
    const size = stored.results.length;
    const provider = createEndpointRerankProvider({ providerRef: 'siliconflow', model: 'Qwen/Qwen3-Reranker-0.6B', endpoint: 'https://api.siliconflow.cn/v1/rerank',
      request: async body => { expect(body.documents).toHaveLength(size); return stored; },
    });
    const result = await provider.rerank('query', Array.from({ length: size * 2 }, (_, index) => ({ id: String(index), text: 'stored candidate' })), {
      signal: new AbortController().signal, deadlineAtMs: Date.now() + 1000, batchSize: size, batchChars: 1000,
    });
    expect(result).toMatchObject({ status: 'complete', batchCount: 2, inputTokens: 5436 });
  });

  it.each([undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('keeps the batch total unknown when one batch reports %s tokens', async tokens => {
    let calls = 0;
    const provider = createEndpointRerankProvider({ providerRef: 'fixture', model: 'rerank', endpoint: 'http://localhost/rerank',
      request: async () => ({ results: [{ index: 0, relevance_score: 1 }], tokens: { input_tokens: ++calls === 1 ? 12 : tokens } }),
    });
    const result = await provider.rerank('query', [{ id: 'a', text: 'alpha' }, { id: 'b', text: 'beta' }], {
      signal: new AbortController().signal, deadlineAtMs: Date.now() + 1000, batchSize: 1, batchChars: 100,
    });
    expect(result.status).toBe('complete'); expect(result.inputTokens).toBeUndefined();
  });

  it('retains the legacy token shape including a measured zero', async () => {
    const provider = createEndpointRerankProvider({ providerRef: 'fixture', model: 'rerank', endpoint: 'http://localhost/rerank',
      request: async () => ({ results: [{ index: 0, relevance_score: 1 }], tokens: { input_tokens: 0 } }),
    });
    expect((await provider.rerank('query', [{ id: 'a', text: 'alpha' }], {
      signal: new AbortController().signal, deadlineAtMs: Date.now() + 1000, batchSize: 1, batchChars: 100,
    })).inputTokens).toBe(0);
  });

  it('keeps an unsafe batch sum unknown', async () => {
    const provider = createEndpointRerankProvider({ providerRef: 'fixture', model: 'rerank', endpoint: 'http://localhost/rerank',
      request: async () => ({ results: [{ index: 0, relevance_score: 1 }], tokens: { input_tokens: Number.MAX_SAFE_INTEGER } }),
    });
    expect((await provider.rerank('query', [{ id: 'a', text: 'alpha' }, { id: 'b', text: 'beta' }], {
      signal: new AbortController().signal, deadlineAtMs: Date.now() + 1000, batchSize: 1, batchChars: 100,
    })).inputTokens).toBeUndefined();
  });

  it('persists and restores a local endpoint within the same owner scope', async () => {
    const values = new Map<string, unknown>();
    const openKeyedStore = () => ({ lookup: async (key: string) => values.get(key), register: async (key: string, value: unknown) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } });
    const service = createMemoryWikiRerankService({ config: resolveMemoryWikiConfig({ vault: { path: 'D:/tmp/rag08-owner-vault' } }), openKeyedStore: openKeyedStore as never });
    const identity = { workspaceId: 'w', workspaceDir: 'D:/tmp', agentSessionKey: 's', sessionId: 'i', egressProviderRefs: [] };
    await service.configure({ mode: 'local', endpoint: 'http://127.0.0.1:9931', model: 'Qwen/Qwen3-Reranker-0.6B' }, identity);
    expect(service.status(identity)).toMatchObject({ mode: 'local', status: 'ready', model: 'Qwen/Qwen3-Reranker-0.6B' });
    expect((await service.provider(identity)).schema).toBe('RerankProvider/v1');
    await service.cancel(identity);
    expect(service.status(identity).status).toBe('cancelled');
    let cancelledError = '';
    try { await service.provider(identity); } catch (error) { cancelledError = String(error); }
    expect(cancelledError).toContain('not configured');
    await expect(service.configure({ mode: 'local', endpoint: 'http://192.0.2.1:9931' }, identity)).rejects.toThrow('loopback');
    await expect(service.provider(identity)).rejects.toThrow('not configured');
    await service.retry(identity);
    expect(service.status(identity).status).toBe('ready');
    expect((await service.provider(identity)).schema).toBe('RerankProvider/v1');
  });
  it.each(['cancel', 'disable', 'replace'] as const)('stops an already acquired provider after %s', async change => {
    const values = new Map<string, unknown>(), requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? ''); response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ results: [{ index: 0, relevance_score: 1 }] }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const service = createMemoryWikiRerankService({ config: resolveMemoryWikiConfig({ vault: { path: 'D:/tmp/rag-review-owner' } }),
      openKeyedStore: (() => ({ lookup: async (key: string) => values.get(key), register: async (key: string, value: unknown) => values.set(key, value),
        delete: async (key: string) => values.delete(key) })) as never });
    const identity = { workspaceId: 'w', workspaceDir: 'D:/tmp', agentSessionKey: 's', sessionId: 'i', egressProviderRefs: [] };
    try {
      const selection = { mode: 'local' as const, endpoint: `http://127.0.0.1:${address.port}` };
      await service.configure(selection, identity);
      const old = await service.provider(identity);
      if (change === 'replace') await service.configure(selection, identity);
      else await service[change](identity);
      await expect(old.rerank('query', [{ id: 'one', text: 'secret owner text' }], {
        signal: new AbortController().signal, deadlineAtMs: Date.now() + 1000, batchSize: 1, batchChars: 100,
      })).rejects.toThrow(/Rerank/);
      expect(requests).toEqual([]);
    } finally { await service.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('validates complete finite-score permutations and batches with a shared deadline', async () => {
    const requests: string[][] = [];
    const provider = createEndpointRerankProvider({ providerRef: 'fixture', model: 'Qwen/Qwen3-Reranker-0.6B', endpoint: 'http://fixture/rerank', request: async body => {
      requests.push(body.documents);
      return { results: [...body.documents.keys()].reverse().map(index => ({ index, relevance_score: (index + 1) / 10 })), tokens: { input_tokens: 12 } };
    } });
    const result = await provider.rerank('query', [{ id: 'a', text: 'alpha' }, { id: 'b', text: 'beta' }, { id: 'c', text: 'gamma' }], { signal: new AbortController().signal, deadlineAtMs: Date.now() + 2000, batchSize: 2, batchChars: 20 });
    expect(result).toMatchObject({ schema: 'RerankResult/v1', status: 'complete', candidateCount: 3, batchCount: 2, inputTokens: 24, calibrated: false });
    expect(result.results.map(row => row.id)).toEqual(['b', 'a', 'c']);
    expect(requests).toEqual([['alpha', 'beta'], ['gamma']]);
    expect(result).not.toHaveProperty('confidence');
    for (const results of [[{ index: 0, relevance_score: 1 }], [{ index: 0, relevance_score: 1 }, { index: 0, relevance_score: 0.5 }], [{ index: 0, relevance_score: Number.NaN }, { index: 1, relevance_score: 1 }]]) {
      await expect(createEndpointRerankProvider({ providerRef: 'fixture', model: 'Qwen/Qwen3-Reranker-0.6B', endpoint: 'http://fixture/rerank', request: async () => ({ results }) })
        .rerank('query', [{ id: 'a', text: 'alpha' }, { id: 'b', text: 'beta' }], { signal: new AbortController().signal, deadlineAtMs: Date.now() + 1000, batchSize: 2, batchChars: 100 })).rejects.toThrow('permutation');
    }
  });

  it('cancels an in-flight HTTP request and enforces the request deadline', async () => {
    const server = createServer(async (_request, response) => { await new Promise(resolve => setTimeout(resolve, 200)); response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ results: [{ index: 0, relevance_score: 1 }] })); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
      const controller = new AbortController();
      const provider = createEndpointRerankProvider({ providerRef: 'local:rerank', model: 'Qwen/Qwen3-Reranker-0.6B', endpoint: `http://127.0.0.1:${address.port}/rerank`, request: async (body, signal) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/rerank`, { method: 'POST', body: JSON.stringify(body), signal });
        return await response.json();
      } });
      const pending = provider.rerank('query', [{ id: 'a', text: 'alpha' }], { signal: controller.signal, deadlineAtMs: Date.now() + 1000, batchSize: 2, batchChars: 100 });
      controller.abort();
      expect((await pending).status).toBe('cancelled');
      expect((await provider.rerank('query', [{ id: 'a', text: 'alpha' }], { signal: new AbortController().signal, deadlineAtMs: Date.now() + 10, batchSize: 2, batchChars: 100 })).status).toBe('cancelled');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('reranks quality/research after admission, re-verifies, and never calls for local or explicit pins', async () => {
    for (const profile of ['quality', 'research'] as const) {
      const observed: string[] = [];
      const plan = createRetrievalPlan({ query: 'gateway', namespaceIds: ['fixture'], profile });
      const result = await runRetrievalPlan({ plan, retrieve: async () => ({ status: 'available', hits: [hit('a'), hit('b')] }), verify: async () => undefined,
        rerank: { provider: { ...providerStub(), rerank: async (_query, candidates) => { observed.push(...candidates.map(row => row.id)); return { schema: 'RerankResult/v1', status: 'complete', providerRef: 'fixture', model: 'Qwen/Qwen3-Reranker-0.6B', scoreKind: 'raw-relevance', calibrated: false, candidateCount: 2, batchCount: 1, elapsedMs: 1, results: [{ id: 'b', score: 2 }, { id: 'a', score: 1 }] }; } }, candidates: row => ({ id: row.id, text: row.data }) } });
      expect(observed).toEqual(['a', 'b']); expect(result.results.map(row => row.id)).toEqual(['b', 'a']); expect(result.status).toBe('complete'); expect(result.effectiveProfile).toBe('hybrid'); expect(result.rerank?.calibrated).toBe(false);
    }
    for (const options of [{ profile: 'local' as const }, { profile: 'quality' as const, explicitRefs: [ref('a')] }]) {
      const plan = createRetrievalPlan({ query: 'gateway', namespaceIds: ['fixture'], ...options });
      const result = await runRetrievalPlan({ plan, retrieve: async () => ({ status: 'available', hits: [hit('a')] }), verify: async () => undefined,
        rerank: { provider: { ...providerStub(), rerank: async () => { throw new Error('must not call'); } }, candidates: row => ({ id: row.id, text: row.data }) } });
      expect(result.status).toBe('complete'); expect(result.rerank).toBeUndefined();
    }
  });

  it('preserves RRF on invalid, failed and owner-revoked rerank results', async () => {
    for (const failure of ['bad-result', 'provider-error', 'owner-revoked'] as const) {
      let verifies = 0;
      const result = await runRetrievalPlan({ plan: createRetrievalPlan({ query: 'gateway', namespaceIds: ['fixture'], profile: 'quality' }),
        retrieve: async () => ({ status: 'available', hits: [hit('a'), hit('b')] }), verify: async () => { verifies += 1; return failure === 'owner-revoked' && verifies === 3 ? 'revoked' : undefined; },
        rerank: { provider: { ...providerStub(), rerank: async () => { if (failure === 'provider-error') throw new Error('unavailable'); return { schema: 'RerankResult/v1', status: 'complete', providerRef: 'fixture', model: 'Qwen/Qwen3-Reranker-0.6B', scoreKind: 'raw-relevance', calibrated: false, candidateCount: 2, batchCount: 1, elapsedMs: 1, results: failure === 'bad-result' ? [{ id: 'b', score: 2 }] : [{ id: 'b', score: 2 }, { id: 'a', score: 1 }] }; } }, candidates: row => ({ id: row.id, text: row.data }) } });
      expect(result.results.map(row => row.id)).toEqual(failure === 'owner-revoked' ? ['a'] : ['a', 'b']);
      expect(result.status).toBe('partial'); expect(result.fallbackReasons.some(reason => reason.startsWith('rerank-failed:'))).toBe(true);
    }
  });
  it('removes sources revoked during a failed provider call before lexical fallback', async () => {
    let revoked = false;
    const result = await runRetrievalPlan({ plan: createRetrievalPlan({ query: 'gateway', namespaceIds: ['fixture'], profile: 'quality' }),
      retrieve: async () => ({ status: 'available', hits: [hit('a'), hit('b')] }),
      verify: async row => revoked && row.id === 'a' ? 'revoked' : undefined,
      rerank: { provider: { ...providerStub(), rerank: async () => { revoked = true; throw new Error('provider disconnected'); } },
        candidates: row => ({ id: row.id, text: row.data }) } });
    expect(result.results.map(row => row.id)).toEqual(['b']);
    expect(result.filters).toContainEqual({ namespaceId: 'fixture', subjectId: 'a', reason: 'revoked' });
  });

  it('runs the multilingual fixed-pool ablation with explicit fixture or live provenance', { timeout: 120000 }, async () => {
    const liveOutput = process.env.PROJECT_RAG_RERANK_EVAL_OUT, key = process.env.SILICONFLOW_API_KEY;
    if (liveOutput && !key) throw new Error('Live ablation requires SILICONFLOW_API_KEY');
    const fixtureRoot = liveOutput ? undefined : await mkdtemp(resolve(tmpdir(), 'rerank-ablation-'));
    const output = liveOutput ?? resolve(fixtureRoot!, 'report.json');
    try {
    const cases = [
      { query: 'Which port does the gateway use?', documents: ['Bread needs flour and water.', 'The gateway listens on port 18789.', 'Archive retention is thirty days.'], relevant: 1 },
      { query: '网关监听哪个端口？', documents: ['归档保留三十天。', '面包需要面粉和水。', '网关监听端口是 18789。'], relevant: 2 },
      { query: 'どのポートでゲートウェイが待ち受けますか？', documents: ['ゲートウェイのポートは18789です。', 'パンには小麦粉と水が必要です。', 'アーカイブの保持期間は30日です。'], relevant: 0 },
      { query: 'Какой порт использует шлюз?', documents: ['Архив хранится тридцать дней.', 'Для хлеба нужны мука и вода.', 'Шлюз использует порт 18789.'], relevant: 2 },
    ];
    const fixtureScores = [[0.1, 0.9, 0.2], [0.2, 0.1, 0.95], [0.92, 0.3, 0.1], [0.1, 0.3, 0.9]];
    const provider = createEndpointRerankProvider({ providerRef: liveOutput ? 'siliconflow' : 'fixture:fixed-pool', model: liveOutput ? 'Qwen/Qwen3-Reranker-0.6B' : 'fixture-ranking', endpoint: 'https://api.siliconflow.cn/v1/rerank', request: async (body, signal) => {
      if (!liveOutput) {
        const caseIndex = cases.findIndex(test => test.query === body.query);
        expect(caseIndex).toBeGreaterThanOrEqual(0);
        expect(body.documents).toEqual(cases[caseIndex].documents);
        return { results: fixtureScores[caseIndex].map((relevance_score, index) => ({ index, relevance_score })) };
      }
      const response = await fetch('https://api.siliconflow.cn/v1/rerank', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
      if (!response.ok) throw new Error(`Live rerank HTTP ${response.status}`); return await response.json();
    } });
    const scores = (orders: number[][]) => {
      const dcg = orders.map(order => order.reduce((sum, document, index) => sum + (document === 1 ? 1 / Math.log2(index + 2) : 0), 0));
      const ideal = 1;
      return { ndcgAt5: dcg.reduce((a, b) => a + b, 0) / orders.length / ideal,
        precisionAt5: orders.reduce((sum, order) => sum + order.filter(document => document === 1).length, 0) / orders.length / 5 };
    };
    const baselineOrders = cases.map(test => test.documents.map((_, index) => index === test.relevant ? 1 : 0));
    const modelOrders: number[][] = [], receipts = [];
    for (const test of cases) {
      const receipt = await provider.rerank(test.query, test.documents.map((text, index) => ({ id: String(index), text })), { signal: AbortSignal.timeout(20000), deadlineAtMs: Date.now() + 20000, batchSize: 16, batchChars: 16000 });
      expect(receipt.status).toBe('complete'); receipts.push(receipt);
      const scoresById = new Map(receipt.results.map(row => [Number(row.id), row.score]));
      modelOrders.push([...test.documents.keys()].sort((a, b) => scoresById.get(b)! - scoresById.get(a)!).map(index => index === test.relevant ? 1 : 0));
    }
    const report = { schema: 'ProjectRagRerankAblation/v1', driven_by: 'agent', actor: 'codex/project-rag-g1', realHumanEvidence: false,
      model: provider.model, evidenceSource: liveOutput ? 'live-provider' : 'scripted-fixture', fixedCandidatePool: true, caseCount: cases.length, baseline: scores(baselineOrders), modelArm: scores(modelOrders),
      costs: { elapsedMs: receipts.reduce((sum, receipt) => sum + receipt.elapsedMs, 0), inputTokens: receipts.every(receipt => receipt.inputTokens !== undefined) ? receipts.reduce((sum, receipt) => sum + receipt.inputTokens!, 0) : null,
        providerReportsTokenUsage: receipts.some(receipt => receipt.inputTokens !== undefined), providerMonetaryCost: null },
      promotionDecision: 'measured-only-no-policy-promotion' };
    await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(resolve(output), JSON.stringify(report, null, 2));
    const retained = JSON.parse(await readFile(output, 'utf8'));
    expect(retained).toMatchObject({ evidenceSource: liveOutput ? 'live-provider' : 'scripted-fixture', caseCount: 4, fixedCandidatePool: true });
    expect(retained.baseline.ndcgAt5).toBeCloseTo(0.6577324383928644);
    if (!liveOutput) expect(retained.modelArm).toEqual({ ndcgAt5: 1, precisionAt5: 0.2 });
    } finally {
      if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
