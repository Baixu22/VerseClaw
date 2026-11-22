import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig } from './fixtures/fp-p1-harness';

async function host<T>(page: Page, module: string, action: string, payload?: Record<string, unknown>): Promise<T> {
  return page.evaluate(async request => {
    const response = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: request.module, action: request.action, ...(request.payload ? { payload: request.payload } : {}) });
    if (!response.ok) throw new Error(response.error?.message ?? 'Host request failed');
    return response.data as T;
  }, { module, action, payload });
}

test('Project RAG rerank settings call an admitted local endpoint and preserve RRF fallback', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(120000);
  const workspace = join(homeDir, 'rerank-workspace'), vault = join(homeDir, 'rerank-vault');
  await mkdir(workspace, { recursive: true }); await mkdir(join(vault, 'concepts'), { recursive: true });
  const receipt: Record<string, unknown> = { actor: 'codex/project-rag-g1-rerank-electron', driven_by: 'agent', realHumanEvidence: false, status: 'fail' };
  const requests: Array<{ model: string; documents: string[] }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); requests.push(body);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ model: body.model, results: body.documents.map((_: string, index: number) => ({ index, relevance_score: 1 - index / 100 })) }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No endpoint port');
  const endpoint = `http://127.0.0.1:${address.port}`;
  const app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
    const created = await host<{ activeWorkspace: { id: string; activeSessionKey: string } }>(page, 'workspaces', 'create', { name: 'Rerank settings fixture', rootPath: workspace, agentId: 'main', permissionMode: 'fullAccess' });
    const owner = created.activeWorkspace;
    const config = buildMockProviderConfig(9, workspace); config.channels = {}; config.update = { checkOnStart: false };
    config.plugins = { enabled: true, entries: { 'memory-wiki': { enabled: true, config: { vaultMode: 'isolated', vault: { path: vault }, search: { backend: 'local', corpus: 'wiki' } } } } };
    for (const state of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
      await mkdir(state, { recursive: true }); await writeFile(join(state, 'openclaw.json'), JSON.stringify(config));
    }
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: await allocatePort() });
    await host(page, 'gateway', 'start').catch(error => { if (!String(error).includes('timed out')) throw error; });
    await expect.poll(async () => (await host<{ state: string }>(page, 'gateway', 'status')).state, { timeout: 120000 }).toBe('running');
    await page.evaluate(() => { window.location.hash = '#/settings/models'; });
    await expect(page.getByTestId('knowledge-rerank-settings')).toBeVisible();
    await page.getByTestId('rerank-mode').selectOption('local');
    await page.getByTestId('rerank-endpoint').fill(endpoint);
    await page.getByTestId('rerank-configure').click();
    await expect(page.getByTestId('rerank-status')).toHaveAttribute('data-state', 'ready');
    receipt.configured = await host(page, 'knowledge', 'rerankStatus');
    await writeFile(join(vault, 'concepts/evidence.md'), `---\ntitle: Gateway deployment\nrevision: 1\nstatus: active\ntrust: confirmed\nupdatedAt: "2026-11-12T00:00:00Z"\nscope:\n  workspaceId: ${owner.id}\n---\nThe gateway deployment port is 18789.\n`);
    await host(page, 'gateway', 'rpc', { method: 'sessions.create', params: { key: owner.activeSessionKey, agentId: 'main' }, timeoutMs: 30000 });
    for (const method of ['wiki.index.start', 'wiki.index.reconcile', 'wiki.index.idle']) {
      await host(page, 'gateway', 'rpc', { method, params: { workspaceId: owner.id, sessionKey: owner.activeSessionKey }, timeoutMs: 60000 });
    }
    type RetrieveResult = { success: boolean; retrieval?: { status: string; rerank?: { status: string; candidateCount: number; calibrated: boolean }; fallbackReasons: string[] } };
    const retrieve = async (profile: 'local' | 'quality' | 'research') => host<RetrieveResult>(page, 'knowledge', 'retrieve', { query: 'gateway deployment port', workspaceId: owner.id, sessionKey: owner.activeSessionKey, profile, mode: 'suggest' });
    const indexedRaw = await readFile(join(vault, 'concepts/evidence.md'), 'utf8');
    const quality: RetrieveResult = await retrieve('quality');
    receipt.quality = quality;
    expect(quality.retrieval?.rerank).toMatchObject({ status: 'complete', candidateCount: 1, calibrated: false });
    expect(await readFile(join(vault, 'concepts/evidence.md'), 'utf8')).toBe(indexedRaw);
    receipt.retrievalPreservedOwnerBytes = true;
    expect(requests.some(request => request.model === 'Qwen/Qwen3-Reranker-0.6B' && request.documents.includes('The gateway deployment port is 18789.\n'))).toBe(true);
    const research: RetrieveResult = await retrieve('research');
    receipt.research = research;
    expect(research.retrieval?.rerank?.status).toBe('complete');
    const localCalls = requests.length;
    const local: RetrieveResult = await retrieve('local');
    receipt.local = local;
    expect(local.retrieval?.rerank).toBeUndefined(); expect(requests.length).toBe(localCalls);
    await page.getByTestId('rerank-cancel').click();
    await expect(page.getByTestId('rerank-status')).toHaveAttribute('data-state', 'cancelled');
    const cancelled: RetrieveResult = await retrieve('quality');
    receipt.cancelled = cancelled;
    expect(cancelled.retrieval?.status).toBe('partial');
    expect(cancelled.retrieval?.fallbackReasons.some(reason => reason.includes('not configured'))).toBe(true);
    await page.getByTestId('rerank-retry').click();
    await expect(page.getByTestId('rerank-status')).toHaveAttribute('data-state', 'ready');
    const retried: RetrieveResult = await retrieve('quality');
    receipt.retried = retried;
    expect(retried.retrieval?.rerank?.status).toBe('complete');
    await page.screenshot({ path: testInfo.outputPath('rerank-settings.png'), fullPage: true });
    receipt.status = 'pass';
  } finally {
    await writeFile(testInfo.outputPath('rerank-lifecycle-receipt.json'), JSON.stringify(receipt, null, 2));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await closeElectronApp(app);
  }
});
