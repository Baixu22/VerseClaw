import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig } from './fixtures/fp-p1-harness';

type Json = Record<string, unknown>;
async function host<T = Json>(page: Page, module: string, action: string, payload?: Json): Promise<T> {
  return page.evaluate(async request => {
    const result = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: request.module,
      action: request.action, ...(request.payload ? { payload: request.payload } : {}) });
    if (!result.ok) throw Error(result.error?.message ?? 'Host request failed');
    return result.data as T;
  }, { module, action, payload });
}

test('Project RAG index publishes, invalidates and recovers through real Electron Host and Gateway', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(360_000);
  const workspaceRoot = join(homeDir, 'rag-index-workspace'), vault = join(homeDir, 'rag-index-vault');
  await mkdir(workspaceRoot, { recursive: true }); await mkdir(join(vault, 'concepts'), { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
  const receipt: Json = { actor: 'codex/project-rag-index-electron', driven_by: 'agent', platform: process.platform, status: 'fail', steps: {} };
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
    const created = await host(page, 'workspaces', 'create', { name: 'Project RAG index fixture', rootPath: workspaceRoot, agentId: 'main', permissionMode: 'fullAccess' });
    const owner = created.activeWorkspace as { id: string; activeSessionKey: string };
    const cfg = buildMockProviderConfig(9, workspaceRoot);
    cfg.plugins = { enabled: true, entries: { 'memory-wiki': { enabled: true, config: {
      vaultMode: 'isolated', vault: { path: vault, renderMode: 'native' }, search: { backend: 'local', corpus: 'wiki' },
    } } } };
    cfg.channels = {}; cfg.update = { checkOnStart: false };
    for (const dir of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
      await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'openclaw.json'), JSON.stringify(cfg, null, 2));
    }
    const file = join(vault, 'concepts/source.md');
    const raw = (revision: number, text: string, policy = '') => `---\ntitle: Index source\nrevision: ${revision}\nstatus: active\ntrust: confirmed\nscope:\n  workspaceId: ${owner.id}\n${policy}---\n# Source\n\n${text}\n`;
    await writeFile(file, raw(1, 'RAG_INDEX_INITIAL 中文检索 😀'));
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: await allocatePort() });
    try { await host(page, 'gateway', 'start'); }
    catch (error) { if (!String(error).includes('timed out')) throw error; }
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 120_000 }).toBe('running');
    const rpc = <T = Json>(operation: string, params: Json = {}) => host<T>(page, 'gateway', 'rpc', {
      method: `wiki.index.${operation}`, params: { workspaceId: owner.id, sessionKey: owner.activeSessionKey, ...params }, timeoutMs: 60_000,
    });
    expect(await rpc('status')).toMatchObject({ status: 'disabled' });
    receipt.enabled = await rpc('start', { readIdentity: { workspaceId: 'forged', principalId: '*' } });
    const firstStatus = await rpc<{ sources: Array<{ eligible: boolean; activeGeneration: string | null }>; workerThreadIds: number[] }>('idle');
    expect(firstStatus.sources.some(s => s.eligible && s.activeGeneration)).toBe(true);
    expect(firstStatus.workerThreadIds.some(id => id > 0)).toBe(true);
    const first = await rpc<{ status: string; candidates: Array<{ quote: string; sourceRef: Json }> }>('search', { query: 'RAG_INDEX_INITIAL' });
    expect(first.status).toBe('available'); expect(first.candidates.some(c => c.quote.includes('RAG_INDEX_INITIAL'))).toBe(true);
    await writeFile(file, raw(2, 'RAG_INDEX_UPDATED 日本語 русский'));
    await rpc('reconcile'); await rpc('idle');
    expect((await rpc<{ candidates: unknown[] }>('search', { query: 'RAG_INDEX_INITIAL' })).candidates).toEqual([]);
    const updated = await rpc<{ candidates: Array<{ quote: string }> }>('search', { query: 'RAG_INDEX_UPDATED' });
    expect(updated.candidates.some(c => c.quote.includes('RAG_INDEX_UPDATED'))).toBe(true);
    await writeFile(file, raw(3, 'RAG_INDEX_FORBIDDEN', 'acl:\n  read: [someone-else]\n'));
    expect((await rpc<{ candidates: unknown[] }>('search', { query: 'RAG_INDEX_UPDATED' })).candidates).toEqual([]);
    await rpc('reconcile');
    const revoked = await rpc<{ sources: Array<{ eligible: boolean }> }>('status');
    expect(revoked.sources.every(s => !s.eligible)).toBe(true);
    await host(page, 'gateway', 'stop');
    await writeFile(file, raw(4, 'RAG_INDEX_RESTART recovered'));
    try { await host(page, 'gateway', 'start'); }
    catch (error) { if (!String(error).includes('timed out')) throw error; }
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 120_000 }).toBe('running');
    await rpc('idle');
    expect((await rpc<{ candidates: Array<{ quote: string }> }>('search', { query: 'RAG_INDEX_RESTART' })).candidates.some(c => c.quote.includes('RAG_INDEX_RESTART'))).toBe(true);
    await unlink(file); await rpc('reconcile');
    expect((await rpc<{ candidates: unknown[] }>('search', { query: 'RAG_INDEX_RESTART' })).candidates).toEqual([]);
    await host(page, 'gateway', 'stop');
    const sqlite = new DatabaseSync(join(userDataDir, 'openclaw-source-state/state/openclaw.sqlite'));
    try { sqlite.exec('DROP TABLE knowledge_index_chunks_fts; CREATE TABLE knowledge_index_chunks_fts (chunk_id TEXT);'); }
    finally { sqlite.close(); }
    try { await host(page, 'gateway', 'start'); }
    catch (error) { if (!String(error).includes('timed out')) throw error; }
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 120_000 }).toBe('running');
    expect(await rpc('search', { query: 'RAG_INDEX_RESTART' })).toMatchObject({ status: 'unavailable', candidates: [] });
    await expect(page.getByTestId('main-layout')).toBeVisible();
    await expect(page.locator('textarea').first()).toBeVisible();
    receipt.status = 'pass'; receipt.firstStatus = firstStatus;
    receipt.steps = { explicitEnable: true, forgedScopeClamped: true, nativeWorkerPublished: true, updateReplaced: true,
      aclRejected: true, restartReconciled: true, deletionRejected: true, corruptFtsIsolated: true, ordinaryChatVisible: true };
  } finally {
    await writeFile(testInfo.outputPath('index-lifecycle-receipt.json'), JSON.stringify(receipt, null, 2));
    await testInfo.attach('index-lifecycle-receipt', { body: await readFile(testInfo.outputPath('index-lifecycle-receipt.json')), contentType: 'application/json' });
    try { await host(await getStableWindow(app), 'gateway', 'stop'); } catch { /* Gateway may not have started. */ }
    await closeElectronApp(app);
  }
});
