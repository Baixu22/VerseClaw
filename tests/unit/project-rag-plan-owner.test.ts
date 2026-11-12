// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryWikiProjectionService, getMemoryWikiPage, resolveMemoryWikiConfig, retrieveMemoryWiki,
  type MemoryWikiReadIdentity,
} from '../../openclaw_runtime/extensions/memory-wiki/runtime-api';
import { createPluginStateKeyedStoreForTests } from '../../openclaw_runtime/src/plugin-sdk/plugin-state-test-runtime';
import { closeOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';

let root: string | undefined;
let projection: ReturnType<typeof createMemoryWikiProjectionService> | undefined;
let backgroundErrors: Error[] = [];
afterEach(async () => {
  await projection?.stop();
  projection = undefined;
  closeOpenClawStateDatabase();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
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
    const guarded = { ...f.projection, search: async (...args: Parameters<typeof f.projection.search>) => {
      // The watcher may tombstone the FTS row first; capture the owner's denial before restoring it.
      const denied = await getMemoryWikiPage({ config: f.config, lookup: f.sourceRef.subjectId, sourceRef: f.sourceRef, readIdentity: f.identity });
      expect(denied).toMatchObject({ status: 'denied', reason: 'acl_denied' });
      const result = await f.projection.search(...args);
      completeLexical();
      if (result.status !== 'available') throw new Error('Fixture FTS unavailable before denial capture');
      return { ...result, denied: [{ namespaceId: f.sourceRef.namespaceId, subjectId: f.sourceRef.subjectId, reason: denied!.reason! }] };
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
});
