// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryWikiProjectionService, resolveMemoryWikiConfig } from '../../openclaw_runtime/extensions/memory-wiki/runtime-api';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import type { OpenKeyedStoreOptions, PluginStateKeyedStore } from '../../openclaw_runtime/src/plugin-sdk/plugin-state-runtime';
import { closeTrackedSqliteHandlesUnder } from '../../openclaw_runtime/src/infra/node-sqlite';

describe('Project RAG real owner index lifecycle recovery', () => {
  let root: string;
  const services: Array<ReturnType<typeof createMemoryWikiProjectionService>> = [];
  const values = new Map<string, unknown>();
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'project-rag-index-'));
    await mkdir(join(root, 'vault/concepts'), { recursive: true });
    vi.stubEnv('OPENCLAW_STATE_DIR', join(root, 'state-root'));
    values.clear();
  });
  afterEach(async () => {
    for (const service of services.splice(0)) await service.stop();
    closeOpenClawStateDatabaseForTest(); closeTrackedSqliteHandlesUnder(root);
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });
  const identity = () => ({ workspaceId: 'agent-fixture-workspace', workspaceDir: root, agentSessionKey: 'agent:main:main', sessionId: 'generation-1', egressProviderRefs: [] });
  const raw = (revision = 1, policy = '', text = 'PROJECT_RAG_INDEX_ALPHA 中文检索 😀') => `---\ntitle: Index fixture\nrevision: ${revision}\nstatus: active\ntrust: confirmed\nscope:\n  workspaceId: agent-fixture-workspace\n${policy}---\n# Source\n\n${text}\n`;
  function make() {
    const errors: string[] = [];
    const service = createMemoryWikiProjectionService({ config: resolveMemoryWikiConfig({ vault: { path: join(root, 'vault') }, search: { backend: 'local', corpus: 'wiki' } }),
      openKeyedStore: <T>(_options: OpenKeyedStoreOptions): PluginStateKeyedStore<T> => ({
        register: async (key, value) => { values.set(key, structuredClone(value)); },
        registerIfAbsent: async (key, value) => { if (values.has(key)) return false; values.set(key, structuredClone(value)); return true; },
        lookup: async key => values.get(key) as T | undefined,
        consume: async key => { const value = values.get(key); values.delete(key); return value as T | undefined; },
        delete: async key => values.delete(key), clear: async () => { values.clear(); },
        entries: async () => [...values].map(([key, value]) => ({ key, value: value as T, createdAt: 1 })),
      }), onError: error => errors.push(error.message) });
    services.push(service); return { service, errors };
  }

  it('publishes in a worker, follows edits and revocation, and recovers changes missed during stop', async () => {
    const file = join(root, 'vault/concepts/source.md');
    await writeFile(file, raw());
    const first = make(); await first.service.start();
    expect(first.service.status(identity()).status).toBe('disabled');
    await first.service.enable(identity());
    try { await first.service.idle(identity()); }
    catch (error) { throw new Error(JSON.stringify({ status: first.service.status(identity()), errors: first.errors }), { cause: error }); }
    const initial = await first.service.search(identity(), 'PROJECT_RAG_INDEX_ALPHA');
    expect(initial.status, JSON.stringify(initial)).toBe('available'); expect(initial.candidates.length).toBeGreaterThan(0);
    expect(initial.candidates.some(c => c.quote.includes('PROJECT_RAG_INDEX_ALPHA'))).toBe(true);
    const status = first.service.status(identity());
    expect('workerThreadIds' in status && status.workerThreadIds.some(id => id > 0)).toBe(true);
    await writeFile(file, raw(2, '', 'PROJECT_RAG_INDEX_BETA 日本語 русский'));
    await first.service.reconcile(identity()); await first.service.idle(identity());
    expect((await first.service.search(identity(), 'PROJECT_RAG_INDEX_ALPHA')).candidates).toHaveLength(0);
    const beta = await first.service.search(identity(), 'PROJECT_RAG_INDEX_BETA');
    expect(beta.candidates.some(c => c.quote.includes('BETA')), JSON.stringify({ beta, status: first.service.status(identity()), errors: first.errors })).toBe(true);
    await writeFile(file, raw(3, 'acl:\n  read: [someone-else]\n', 'PROJECT_RAG_INDEX_BETA'));
    expect((await first.service.search(identity(), 'PROJECT_RAG_INDEX_BETA')).candidates).toHaveLength(0);
    await first.service.reconcile(identity());
    await first.service.stop();
    await writeFile(file, raw(4, '', 'PROJECT_RAG_INDEX_GAMMA restart'));
    const restarted = make(); await restarted.service.start(); await restarted.service.idle(identity());
    expect((await restarted.service.search(identity(), 'PROJECT_RAG_INDEX_GAMMA')).candidates.length).toBeGreaterThan(0);
    const resumedStatus = restarted.service.status(identity());
    expect('sources' in resumedStatus && resumedStatus.sources.length).toBe(1);
    await unlink(file);
    expect((await restarted.service.search(identity(), 'PROJECT_RAG_INDEX_GAMMA')).candidates).toHaveLength(0);
    await restarted.service.reconcile(identity());
    const finalStatus = restarted.service.status(identity());
    expect('sources' in finalStatus && finalStatus.sources.every(s => !s.eligible)).toBe(true);
    expect(first.errors.filter(message => !message.includes('cancelled'))).toEqual([]);
    expect(restarted.errors).toEqual([]);
  }, 120_000);

  it('keeps malformed source revisions unavailable and rejects a foreign query scope', async () => {
    const file = join(root, 'vault/concepts/source.md'); await writeFile(file, raw());
    const { service } = make(); await service.enable(identity()); await service.idle(identity());
    await expect(service.search({ ...identity(), workspaceId: 'foreign' }, 'PROJECT_RAG_INDEX_ALPHA')).rejects.toThrow(/scope/);
    await expect(service.search({ ...identity(), sessionId: 'generation-2' }, 'PROJECT_RAG_INDEX_ALPHA')).rejects.toThrow(/scope/);
    await expect(service.reconcile({ ...identity(), sessionId: 'generation-2' })).rejects.toThrow(/scope/);
    await expect(service.disable({ ...identity(), sessionId: 'generation-2' })).rejects.toThrow(/scope/);
    await writeFile(file, Buffer.from([0xff, 0xff]));
    await expect(service.reconcile(identity())).rejects.toThrow();
    const status = service.status(identity());
    expect('sources' in status && status.sources.every(source => !source.eligible)).toBe(true);
    expect(await readFile(file)).toEqual(Buffer.from([0xff, 0xff]));
  }, 120_000);
});
