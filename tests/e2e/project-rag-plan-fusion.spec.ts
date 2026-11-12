import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { freemem } from 'node:os';
import type { Page } from '@playwright/test';
import type { KnowledgeRetrieveResult, KnowledgeRetrievalReport } from '../../shared/host-api/contract';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig } from './fixtures/fp-p1-harness';

type Json = Record<string, unknown>;
async function host<T = Json>(page: Page, module: string, action: string, payload?: Json): Promise<T> {
  return page.evaluate(async request => {
    const response = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: request.module,
      action: request.action, ...(request.payload ? { payload: request.payload } : {}) });
    if (!response.ok) throw new Error(response.error?.message ?? 'Host request failed');
    return response.data as T;
  }, { module, action, payload });
}

test('Project RAG fuses real local lanes, retains owner rejection and shows evidence without synthetic confidence', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  const assets = process.env.PROJECT_RAG_E2E_ASSETS_DIR;
  test.skip(!assets, 'Set PROJECT_RAG_E2E_ASSETS_DIR for the native retrieval journey.');
  test.setTimeout(360000);
  const workspace = join(homeDir, 'plan-workspace'), vault = join(homeDir, 'plan-vault');
  await mkdir(workspace, { recursive: true });
  await mkdir(join(vault, 'concepts'), { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
  const steps: Record<string, boolean> = {};
  const receipt: Json = { actor: 'codex/project-rag-plan-electron', driven_by: 'agent', status: 'fail', steps,
    freeMemoryAtStartMiB: Math.floor(freemem() / 1024 / 1024) };
  let diagnosticPage: Page | undefined;
  try {
    const page = await getStableWindow(app);
    diagnosticPage = page;
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
    const created = await host(page, 'workspaces', 'create', { name: 'Project retrieval fixture', rootPath: workspace, agentId: 'main', permissionMode: 'fullAccess' });
    const owner = created.activeWorkspace as { id: string; activeSessionKey: string };
    const config = buildMockProviderConfig(9, workspace);
    config.channels = {};
    config.update = { checkOnStart: false };
    config.plugins = { enabled: true, entries: { 'memory-wiki': { enabled: true, config: {
      vaultMode: 'isolated', vault: { path: vault }, search: { backend: 'local', corpus: 'wiki' },
    } } } };
    const modelName = '6fa0c02a9c302be6-embeddinggemma-300m-qat-Q8_0.gguf';
    for (const state of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
      await mkdir(join(state, 'models/project-rag'), { recursive: true });
      await writeFile(join(state, 'openclaw.json'), JSON.stringify(config, null, 2));
      await copyFile(join(assets!, modelName), join(state, 'models/project-rag', modelName));
    }
    const file = join(vault, 'concepts/source.md');
    const raw = (revision: number, port: number, denied = false) => `---\ntitle: Gateway deployment\nrevision: ${revision}\nstatus: active\ntrust: confirmed\nupdatedAt: "2026-11-12T00:00:00Z"\nscope:\n  workspaceId: ${owner.id}\n${denied ? 'acl:\n  read: [other]\n' : ''}---\nThe gateway deployment port is ${port}.\n`;
    await writeFile(file, raw(1, 18789));
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: await allocatePort() });
    await host(page, 'gateway', 'start').catch(error => { if (!String(error).includes('timed out')) throw error; });
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 120000 }).toBe('running');
    await page.evaluate(() => { window.location.hash = '#/settings/models'; });
    await page.getByTestId('embedding-mode').selectOption('local');
    receipt.freeMemoryBeforeModelMiB = Math.floor(freemem() / 1024 / 1024);
    await page.getByTestId('embedding-configure').click();
    await expect.poll(async () => {
      const value = await host(page, 'knowledge', 'embeddingStatus');
      receipt.lastEmbeddingStatus = value;
      const status = (value.embedding as { status?: string } | undefined)?.status;
      return status === 'unavailable' || status === 'cancelled' || status === 'ready' ? 'terminal' : status;
    }, { timeout: 300000 }).toBe('terminal');
    await expect(page.getByTestId('embedding-status'), JSON.stringify(receipt.lastEmbeddingStatus)).toHaveAttribute('data-state', 'ready');
    await page.getByTestId('vector-configure').click();
    await expect(page.getByTestId('vector-status')).toHaveAttribute('data-state', 'ready', { timeout: 90000 });
    const retrieve = async (payload: Json = {}): Promise<KnowledgeRetrievalReport> => {
      const response = await host<KnowledgeRetrieveResult>(page, 'knowledge', 'retrieve', {
        query: 'gateway deployment port', workspaceId: owner.id, sessionKey: owner.activeSessionKey,
        profile: 'local', mode: 'suggest', ...payload,
      });
      expect(response.success, JSON.stringify(response)).toBe(true);
      expect(response.retrieval).toBeDefined();
      return response.retrieval!;
    };
    const fused = await retrieve();
    receipt.fused = fused;
    expect(fused.status, JSON.stringify(fused)).toBe('complete');
    expect(fused.effectiveProfile).toBe('local');
    expect(fused.results[0].snippet).toContain('18789');
    expect(fused.results[0].rankSignals.lanes.map(lane => lane.lane)).toEqual(['lexical', 'dense']);
    expect(fused.results[0].scoreKind).toBe('rrf');
    expect(fused.results[0].score).toBeCloseTo(fused.results[0].rankSignals.lanes.reduce((sum, lane) => sum + lane.contribution, 0));
    expect(fused.results[0]).not.toHaveProperty('confidence');
    steps.realHybrid = true;
    const oldPin = fused.results[0].sourceRef;
    await writeFile(file, raw(2, 18789, true));
    const revoked = await retrieve();
    receipt.revoked = revoked;
    expect(revoked.results).toEqual([]);
    steps.immediateRevocation = true;
    await writeFile(file, raw(3, 19999));
    for (const method of ['wiki.index.reconcile', 'wiki.index.idle', 'wiki.vector.rebuild', 'wiki.vector.idle']) {
      await host(page, 'gateway', 'rpc', { method, params: { workspaceId: owner.id, sessionKey: owner.activeSessionKey }, timeoutMs: 60000 });
    }
    const restored = await retrieve();
    receipt.restored = restored;
    expect(restored.results[0].snippet).toContain('19999');
    const stale = await retrieve({ query: '', mode: 'manual', sourceRefs: [oldPin] });
    receipt.stalePin = stale;
    expect(stale.results).toEqual([]);
    expect(stale.filters.length).toBeGreaterThan(0);
    steps.versionPin = true;
    const quality = await retrieve({ profile: 'quality' });
    receipt.quality = quality;
    expect(quality.status).toBe('partial');
    expect(quality.fallbackReasons).toContain('rerank-unavailable');
    steps.qualityCapability = true;
    await page.evaluate(() => { window.location.hash = '#/'; });
    const composer = page.getByTestId('chat-composer-input');
    await expect(composer).toBeVisible({ timeout: 30000 });
    await page.getByTestId('chat-knowledge-scope-button').click();
    await page.getByTestId('chat-knowledge-scope-wiki').click();
    const draft = 'What port does the gateway deployment use in this project?';
    await composer.fill(draft);
    await expect(page.getByTestId('chat-knowledge-suggestion')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('chat-knowledge-suggestion-open').click();
    const evidence = page.getByTestId('chat-knowledge-preflight-item');
    await expect(evidence.first()).toContainText('Gateway deployment');
    await expect(evidence.first()).not.toContainText(/\b\d+\s?%/u);
    await page.screenshot({ path: testInfo.outputPath('plan-preflight.png'), fullPage: true });
    steps.preflightNoSyntheticConfidence = true;
    await page.getByTestId('chat-knowledge-suggestion-dismiss').click();
    await expect(page.getByTestId('chat-knowledge-suggestion')).toHaveCount(0);
    await expect(composer).toHaveValue(draft);
    steps.draftPreserved = true;
    receipt.status = 'pass';
  } finally {
    if (receipt.status !== 'pass' && diagnosticPage && !diagnosticPage.isClosed()) {
      receipt.freeMemoryAtFailureMiB = Math.floor(freemem() / 1024 / 1024);
      receipt.lastEmbeddingStatus = await host(diagnosticPage, 'knowledge', 'embeddingStatus').catch(error => ({ error: String(error) }));
      receipt.lastGatewayStatus = await host(diagnosticPage, 'gateway', 'status').catch(error => ({ error: String(error) }));
    }
    await writeFile(testInfo.outputPath('plan-lifecycle-receipt.json'), JSON.stringify(receipt, null, 2));
    await closeElectronApp(app);
  }
});
