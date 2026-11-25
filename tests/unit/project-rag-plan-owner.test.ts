// @vitest-environment node
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryWikiProjectionService, getMemoryWikiPage, resolveMemoryWikiConfig, retrieveMemoryWiki,
  type MemoryWikiReadIdentity,
} from '../../openclaw_runtime/extensions/memory-wiki/runtime-api';
import { createPluginStateKeyedStoreForTests } from '../../openclaw_runtime/src/plugin-sdk/plugin-state-test-runtime';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { closeTrackedSqliteHandlesUnder } from '../../openclaw_runtime/src/infra/node-sqlite';
import memoryWikiPlugin from '../../openclaw_runtime/extensions/memory-wiki';
import type { OpenClawPluginApi } from '../../openclaw_runtime/extensions/memory-wiki/api';

let root: string | undefined;
let projection: ReturnType<typeof createMemoryWikiProjectionService> | undefined;
let backgroundErrors: Error[] = [];
afterEach(async () => {
  await projection?.stop();
  projection = undefined;
  closeOpenClawStateDatabase();
  vi.unstubAllEnvs();
  if (root) {
    closeTrackedSqliteHandlesUnder(root);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  root = undefined;
  expect(backgroundErrors.filter(error => !error.message.includes('cancelled'))).toEqual([]);
  backgroundErrors = [];
});

async function fixture() {
  root = await mkdtemp(join(tmpdir(), 'rag-plan-owner-'));
  vi.stubEnv('OPENCLAW_STATE_DIR', join(root, 'state'));
  const vault = join(root, 'vault');
  await mkdir(join(vault, 'concepts'), { recursive: true });
  const config = resolveMemoryWikiConfig({ vaultMode: 'isolated', vault: { path: vault }, search: { backend: 'local', corpus: 'wiki' } });
  const identity: MemoryWikiReadIdentity = { workspaceId: 'workspace-fixture', workspaceDir: root,
    agentSessionKey: 'agent:main:rag-plan', sessionId: 'physical-plan-fixture', egressProviderRefs: [] };
  const raw = (body: string, denied = false, conflict = false) => `---\ntitle: Gateway configuration\nrevision: 1\nstatus: active\ntrust: confirmed\nupdatedAt: "2026-11-12T00:00:00Z"\nscope:\n  workspaceId: ${identity.workspaceId}\n${denied ? 'acl:\n  read: [other]\n' : ''}${conflict ? 'contradictions: [unresolved deployment conflict]\n' : ''}---\n${body}\n`;
  const file = join(vault, 'concepts/gateway.md'), original = raw('The gateway configuration uses port 18789.');
  await writeFile(file, original);
  projection = createMemoryWikiProjectionService({ config,
    openKeyedStore: <T>(options: Parameters<typeof createPluginStateKeyedStoreForTests<T>>[1]) => createPluginStateKeyedStoreForTests<T>('memory-wiki', options),
    onError: error => { backgroundErrors.push(error); } });
  await projection.enable(identity);
  await projection.idle(identity, 10000);
  const page = await getMemoryWikiPage({ config, lookup: 'concepts/gateway.md', readIdentity: identity, lineCount: 100 });
  expect(page?.ownerSnapshot).toBeDefined();
  return { config, identity, raw, file, original, sourceRef: page!.sourceRef!, projection };
}

describe('Project RAG owner-side plan', () => {
  it('keeps indexed owner bytes unchanged during gateway retrieval and pinned inspection', async () => {
    const f = await fixture();
    type Handler = Parameters<OpenClawPluginApi['registerGatewayMethod']>[1];
    const methods = new Map<string, Handler>();
    memoryWikiPlugin.register!({
      pluginConfig: { vaultMode: 'isolated', vault: { path: f.config.vault.path }, search: { backend: 'local', corpus: 'wiki' } },
      config: { agents: { defaults: { workspace: f.identity.workspaceDir } } },
      runtime: { state: { openKeyedStore: <T>(options: Parameters<typeof createPluginStateKeyedStoreForTests<T>>[1]) =>
        createPluginStateKeyedStoreForTests<T>('memory-wiki', options) } },
      logger: { warn: vi.fn() },
      registerGatewayMethod: (name: string, handler: Handler) => methods.set(name, handler),
      registerMemoryPromptSupplement: vi.fn(), registerMemoryCorpusSupplement: vi.fn(),
      registerService: vi.fn(), registerTool: vi.fn(), registerCli: vi.fn(),
    } as unknown as OpenClawPluginApi);
    const invoke = async (method: string, request: Record<string, unknown>) => {
      const respond = vi.fn();
      await methods.get(method)!({ params: { ...request, readIdentity: f.identity }, respond,
        client: { connect: { client: { mode: 'backend' } } } } as unknown as Parameters<Handler>[0]);
      expect(respond).toHaveBeenCalledOnce();
      return respond.mock.calls[0];
    };
    const [retrieved, result] = await invoke('wiki.retrieve', { query: 'gateway configuration', profile: 'local', mode: 'suggest' });
    expect(retrieved).toBe(true);
    expect(result.results.some((row: { snippet: string }) => row.snippet.includes('18789'))).toBe(true);
    expect(await readFile(f.file, 'utf8')).toBe(f.original);
    const [inspected, page] = await invoke('wiki.get', { lookup: f.sourceRef.subjectId, sourceRef: f.sourceRef });
    expect(inspected).toBe(true);
    expect(page.status).not.toBe('denied');
    expect(page.sourceRef).toEqual(f.sourceRef);
    expect(await readFile(f.file, 'utf8')).toBe(f.original);
    const [invalid] = await invoke('wiki.get', { lookup: f.sourceRef.subjectId, sourceRef: {} });
    expect(invalid).toBe(false);
    expect(await readFile(f.file, 'utf8')).toBe(f.original);
    const [cancelled] = await invoke('wiki.retrieval.cancel', { requestId: 'research-cancel-before-admission' });
    expect(cancelled).toBe(true);
    const [late, , error] = await invoke('wiki.retrieve', { query: 'gateway', profile: 'research', mode: 'suggest',
      requestId: 'research-cancel-before-admission', researchBudget: { requestId: 'research-cancel-before-admission', maxTokens: 4000, maxCostUsd: 0.0125 } });
    expect(late).toBe(false); expect(JSON.stringify(error)).toContain('cancelled before admission');
    const [wrongBudget] = await invoke('wiki.retrieve', { query: 'gateway', profile: 'research', requestId: 'one-request',
      researchBudget: { requestId: 'another-request', maxTokens: 4000, maxCostUsd: 0.0125 } });
    expect(wrongBudget).toBe(false);
    await writeFile(f.file, f.raw('Changed source', true));
    const [checked, denied] = await invoke('wiki.get', { lookup: f.sourceRef.subjectId, sourceRef: f.sourceRef });
    expect(checked).toBe(true);
    expect(denied).toMatchObject({ status: 'denied', content: '' });
  });

  it('fuses actual FTS candidates with an injected dense lane using the same chunk pins', async () => {
    const f = await fixture();
    const rows = (await f.projection.search(f.identity, 'gateway configuration')).candidates;
    const search = vi.fn(async () => ({ status: 'available', candidates: rows.map(row => ({ ...row, id: row.chunkId, distance: 0.01 })) }));
    const result = await retrieveMemoryWiki({ ...f, query: 'gateway configuration', vector: { search } as never });
    expect(result.status).toBe('complete');
    expect(result.results).toHaveLength(rows.length);
    expect(result.results[0].rankSignals.lanes.map(lane => lane.lane)).toEqual(['lexical', 'dense']);
    expect(result.results[0].scoreKind).toBe('rrf');
    expect(result.results[0].sourceRef).toMatchObject({ subjectId: 'concepts/gateway.md' });
    expect(result.results[0].snippet).toContain('18789');
    expect(result.results[0]).not.toHaveProperty('confidence');
    expect(result.results[0].autoReadAdmission.eligible).toBe(false);
    expect(result.plan.admissionContextId).toBeTruthy();
    expect(result.plan.generations.some(generation => generation.lane === 'lexical')).toBe(true);
  });

  it('routes budgeted Research dense calls through the shared spend owner', async () => {
    const f = await fixture();
    const rows = (await f.projection.search(f.identity, 'gateway configuration')).candidates;
    const result = await retrieveMemoryWiki({ ...f, query: 'gateway configuration', profile: 'research', allowRemote: true,
      researchBudget: { requestId: 'budgeted-owner-query', maxTokens: 4000, maxCostUsd: 0.0125 },
      appConfig: { models: { providers: { fixture: { baseUrl: 'https://example.test', models: [{
        id: 'embed', name: 'embed', reasoning: false, input: ['text'], contextWindow: 8000, maxTokens: 1,
        cost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
      }] } } } },
      embedding: { status: () => ({ mode: 'remote' }) } as never,
      vector: { search: async (_identity, text, _limit, request) => {
        expect(request?.remoteSpend).toBeTypeOf('function');
        await request!.remoteSpend!({ providerRef: 'fixture', model: 'embed', texts: [text], signal: request!.signal! }, async report => { report(7); });
        return { status: 'available', candidates: rows.map(row => ({ ...row, id: row.chunkId, distance: 0.01 })) };
      } } as Parameters<typeof retrieveMemoryWiki>[0]['vector'] });
    expect(result.remoteSpend?.calls).toBeGreaterThan(0);
    expect(result.remoteSpend?.actualTokens).toBe(result.remoteSpend!.calls * 7);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('rejects an index generation change before returning ranked results', async () => {
    const f = await fixture(), rows = (await f.projection.search(f.identity, 'gateway')).candidates;
    let generationId = 'generation-1';
    const result = await retrieveMemoryWiki({ ...f, query: 'gateway', vector: {
      snapshot: () => ({ generationId, spaceId: 'space-1', credentialEpoch: 1 }),
      search: async () => {
        generationId = 'generation-2';
        return { status: 'available', candidates: rows.map(row => ({ ...row, id: row.chunkId, distance: 0.01 })) };
      },
    } as never });
    expect(result.plan.generations).toContainEqual({ namespaceId: f.sourceRef.namespaceId, lane: 'dense', generation: 'generation-1', spaceId: 'space-1', credentialEpoch: 1 });
    expect(result.results).toEqual([]);
    expect(result.snapshotStatus).toBe('changed');
    expect(result.fallbackReasons).toContain('owner-or-index-generation-changed');
  });

  it('returns owner-verified lexical evidence on dense provider failure', async () => {
    const f = await fixture();
    const result = await retrieveMemoryWiki({ ...f, query: 'gateway configuration', vector: { search: async () => { throw new Error('dense fixture failed'); } } as never });
    expect(result.status).toBe('partial');
    expect(result.results[0].snippet).toContain('18789');
    expect(result.fallbackReasons).toContain('dense:dense fixture failed');
  });

  it('uses explicit pins without starting a vector query or rebuilding the index', async () => {
    const f = await fixture(), search = vi.fn();
    const result = await retrieveMemoryWiki({ ...f, query: '', mode: 'manual', explicitRefs: [f.sourceRef], vector: { search } as never });
    expect(result.status).toBe('complete');
    expect(result.results[0].rankSignals.lanes[0].lane).toBe('exact');
    expect(result.results[0].snippet).toContain('18789');
    expect(search).not.toHaveBeenCalled();
  });

  it('reads a current chunk pin without separate line arguments and rejects an altered digest', async () => {
    const f = await fixture();
    const chunk = (await f.projection.search(f.identity, 'gateway')).candidates[0];
    const page = await getMemoryWikiPage({ config: f.config, lookup: chunk.sourceRef.subjectId,
      sourceRef: chunk.sourceRef, readIdentity: f.identity });
    expect(page?.sourceRef).toEqual(chunk.sourceRef);
    expect(page?.content).toEqual(chunk.quote);
    const invalid = await getMemoryWikiPage({ config: f.config, lookup: chunk.sourceRef.subjectId,
      sourceRef: { ...chunk.sourceRef, sourceDigest: `sha256:${'0'.repeat(64)}` }, readIdentity: f.identity });
    expect(invalid).toMatchObject({ status: 'denied', reason: 'digest_mismatch', content: '' });
  });

  it('rejects a revoked owner pin even when a lane supplies the previous quote', async () => {
    const f = await fixture(), rows = (await f.projection.search(f.identity, 'gateway')).candidates;
    await writeFile(f.file, f.raw('The gateway configuration uses port 18789.', true));
    const result = await retrieveMemoryWiki({ ...f, query: 'gateway', vector: { search: async () => ({ status: 'available', candidates: rows.map(row => ({ ...row, id: row.chunkId, distance: 0.01 })) }) } as never });
    expect(result.results).toEqual([]);
    expect(result.filters.some(filter => filter.reason === 'acl_denied')).toBe(true);
  });

  it('keeps a denial sticky across a same-query restore in another lane', async () => {
    const f = await fixture(), rows = (await f.projection.search(f.identity, 'gateway')).candidates;
    await writeFile(f.file, f.raw('The gateway configuration uses port 18789.', true));
    let completeLexical!: () => void;
    const lexicalDone = new Promise<void>(resolve => { completeLexical = resolve; });
    const guarded = { ...f.projection, search: async (...args: Parameters<typeof f.projection.search>): ReturnType<typeof f.projection.search> => {
      // The watcher may tombstone the FTS row first; capture the owner's denial before restoring it.
      const denied = await getMemoryWikiPage({ config: f.config, lookup: f.sourceRef.subjectId, sourceRef: f.sourceRef, readIdentity: f.identity });
      expect(denied).toMatchObject({ status: 'denied', reason: 'acl_denied' });
      const result = await f.projection.search(...args);
      completeLexical();
      if (result.status !== 'available') throw new Error('Fixture FTS unavailable before denial capture');
      return { ...result, status: 'available', denied: [{ namespaceId: f.sourceRef.namespaceId, subjectId: f.sourceRef.subjectId, reason: denied!.reason! }] };
    } };
    const result = await retrieveMemoryWiki({ ...f, projection: guarded, query: 'gateway', vector: { search: async () => {
      await lexicalDone;
      await writeFile(f.file, f.original);
      return { status: 'available', candidates: rows.map(row => ({ ...row, id: row.chunkId, distance: 0.01 })) };
    } } as never });
    expect((await getMemoryWikiPage({ config: f.config, lookup: f.sourceRef.subjectId, sourceRef: f.sourceRef, readIdentity: f.identity }))?.ownerSnapshot).toBeDefined();
    expect(result.results).toEqual([]);
    expect(result.filters.some(filter => filter.reason === 'acl_denied')).toBe(true);
  });

  it('keeps a page fallback inside the same owner scope when the index is unavailable', async () => {
    const f = await fixture();
    const result = await retrieveMemoryWiki({ config: f.config, identity: f.identity, query: 'gateway configuration' });
    expect(result.status).toBe('partial');
    expect(result.results[0].snippet).toContain('18789');
    expect(result.results[0].rankSignals.lanes[0].scoreKind).toBe('page-lexical');
    expect(result.fallbackReasons).toContain('lexical:page-lexical-fallback');
  });

  it('does not invoke a remote embedding in the local profile', async () => {
    const f = await fixture(), search = vi.fn();
    const result = await retrieveMemoryWiki({ ...f, query: 'gateway', vector: { search } as never, embedding: { status: () => ({ mode: 'remote' }) } as never });
    expect(search).not.toHaveBeenCalled();
    expect(result.fallbackReasons).toContain('dense:remote-provider-not-in-local-profile');
    expect(result.results[0].snippet).toContain('18789');
  });

  it('rejects query operator injection without changing the active projection', async () => {
    const f = await fixture();
    const before = f.projection.status(f.identity);
    await retrieveMemoryWiki({ ...f, query: 'gateway"; DELETE FROM knowledge_index_sources; --' });
    expect(f.projection.status(f.identity)).toEqual(before);
    expect((await f.projection.search(f.identity, 'gateway')).candidates[0].quote).toContain('18789');
  });

  it('rejects automatic reading of an exact source with a disclosed conflict', async () => {
    const f = await fixture();
    await writeFile(f.file, f.raw('The gateway configuration uses port 18789.', false, true));
    const page = await getMemoryWikiPage({ config: f.config, lookup: 'concepts/gateway.md', readIdentity: f.identity });
    const result = await retrieveMemoryWiki({ ...f, query: '', mode: 'auto-read', explicitRefs: [page!.sourceRef!] });
    expect(result.results[0].autoReadAdmission).toMatchObject({ eligible: false, reason: 'source-conflict' });
  });

  it('admits a single current confirmed exact source with content', async () => {
    const f = await fixture();
    const result = await retrieveMemoryWiki({ ...f, query: 'concepts/gateway.md', mode: 'auto-read' });
    expect(result.results[0]).toMatchObject({ freshnessLevel: 'fresh',
      autoReadAdmission: { eligible: true, reason: 'owner-confirmed-exact-ref' } });
    expect(result.results[0].snippet).toContain('18789');
  });

  it('keeps unknown freshness and advisory trust out of Auto-read', async () => {
    const f = await fixture();
    for (const raw of [f.original.replace('2026-11-12T00:00:00Z', 'unknown'), f.original.replace('trust: confirmed', 'trust: advisory')]) {
      await writeFile(f.file, raw);
      const result = await retrieveMemoryWiki({ ...f, query: 'concepts/gateway.md', mode: 'auto-read' });
      expect(result.results[0].autoReadAdmission).toMatchObject({ eligible: false,
        reason: 'source-confirmation-or-freshness-unavailable' });
    }
  });

  it('accepts either valid owner timestamp without a malformed timestamp masking the other', async () => {
    const f = await fixture();
    for (const raw of [f.original.replace('updatedAt:', 'verifiedAt:'),
      f.original.replace('updatedAt:', 'verifiedAt: "unknown"\nupdatedAt:')]) {
      await writeFile(f.file, raw);
      const result = await retrieveMemoryWiki({ ...f, query: 'concepts/gateway.md', mode: 'auto-read' });
      expect(result.results[0].autoReadAdmission.eligible).toBe(true);
      expect(result.results[0].freshnessLevel).toBe('fresh');
    }
  });

  it('does not admit ambiguous exact parents or empty evidence', async () => {
    const f = await fixture();
    const other = join(root!, 'vault/concepts/other.md');
    await writeFile(other, f.raw('Another deployment guide.'));
    const page = await getMemoryWikiPage({ config: f.config, lookup: 'concepts/other.md', readIdentity: f.identity });
    const result = await retrieveMemoryWiki({ ...f, query: '', mode: 'auto-read', explicitRefs: [f.sourceRef, page!.sourceRef!] });
    expect(result.results.every(row => !row.autoReadAdmission.eligible)).toBe(true);
    await writeFile(f.file, f.raw(''));
    const empty = await retrieveMemoryWiki({ ...f, query: 'concepts/gateway.md', mode: 'auto-read' });
    expect(empty.results.every(row => !row.autoReadAdmission.eligible)).toBe(true);
  });
});
