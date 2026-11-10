import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig } from './fixtures/fp-p1-harness';
import type { KnowledgeEmbeddingStatusResult } from '../../shared/knowledge/embedding';

type Json = Record<string, unknown>;
async function host<T = Json>(page: Page, module: string, action: string, payload?: Json): Promise<T> {
  return page.evaluate(async request => {
    const result = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: request.module,
      action: request.action, ...(request.payload ? { payload: request.payload } : {}) });
    if (!result.ok) throw Error(result.error?.message ?? 'Host request failed');
    return result.data as T;
  }, { module, action, payload });
}

test('Project RAG model settings configure, cancel, retry and refresh real embedding services', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  const assets = process.env.PROJECT_RAG_E2E_ASSETS_DIR;
  test.skip(!assets, 'Set PROJECT_RAG_E2E_ASSETS_DIR to run the real local and remote provider journey.');
  test.setTimeout(420_000);
  const workspace = join(homeDir, 'embedding-workspace'), vault = join(homeDir, 'embedding-vault');
  await mkdir(workspace, { recursive: true }); await mkdir(join(vault, 'concepts'), { recursive: true });
  const receipt: Json = { actor: 'codex/project-rag-embedding-electron', driven_by: 'agent', status: 'fail', steps: {} };
  const app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
    const created = await host(page, 'workspaces', 'create', { name: 'Project RAG embedding fixture', rootPath: workspace, agentId: 'main', permissionMode: 'fullAccess' });
    const owner = created.activeWorkspace as { id: string; activeSessionKey: string };
    const config = buildMockProviderConfig(9, workspace);
    config.channels = {}; config.update = { checkOnStart: false };
    config.plugins = { enabled: true, entries: { 'memory-wiki': { enabled: true, config: {
      vaultMode: 'isolated', vault: { path: vault, renderMode: 'native' }, search: { backend: 'local', corpus: 'wiki' },
    } } } };
    for (const state of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
      await mkdir(state, { recursive: true }); await writeFile(join(state, 'openclaw.json'), JSON.stringify(config, null, 2));
      const models = join(state, 'models/project-rag'); await mkdir(models, { recursive: true });
      // The install/warmup probe already verified these real artifacts. Reuse them
      // here so the Electron journey measures provider lifecycle rather than download time.
      await copyFile(join(assets!, '6fa0c02a9c302be6-embeddinggemma-300m-qat-Q8_0.gguf'), join(models, '6fa0c02a9c302be6-embeddinggemma-300m-qat-Q8_0.gguf'));
      for (const [name, hash] of [
        ['tokenizer.json', 'def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a'],
        ['tokenizer_config.json', '355f2b4e5bad7b01f11ef6cb68ebc176f61b95c3276092ea225b1bea0e01e95c'],
      ]) await copyFile(join(assets!, name), join(models, `${hash}-${name}`));
    }
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: await allocatePort() });
    try { await host(page, 'gateway', 'start'); } catch (error) { if (!String(error).includes('timed out')) throw error; }
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 120_000 }).toBe('running');
    await page.evaluate(() => { window.location.hash = '#/settings/models'; });
    await expect(page.getByTestId('knowledge-embedding-settings')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('embedding-status')).toHaveAttribute('data-state', 'disabled');
    await page.getByTestId('embedding-mode').selectOption('local');
    await page.getByTestId('embedding-configure').click();
    await expect(page.getByTestId('embedding-cancel')).toBeEnabled();
    await page.getByTestId('embedding-cancel').click();
    await expect(page.getByTestId('embedding-status')).toHaveAttribute('data-state', 'cancelled', { timeout: 30_000 });
    await page.getByTestId('embedding-retry').click();
    await expect(page.getByTestId('embedding-status')).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
    const local = await host<KnowledgeEmbeddingStatusResult>(page, 'knowledge', 'embeddingStatus');
    expect(local.embedding).toMatchObject({ mode: 'local', status: 'ready', dimensions: 768 });
    await page.evaluate(() => { window.location.hash = '#/settings/general'; });
    await expect(page.getByTestId('knowledge-embedding-settings')).toHaveCount(0);
    await page.evaluate(() => { window.location.hash = '#/settings/models'; });
    await expect(page.getByTestId('embedding-mode')).toHaveValue('local');
    await host(page, 'gateway', 'stop');
    try { await host(page, 'gateway', 'start'); } catch (error) { if (!String(error).includes('timed out')) throw error; }
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 120_000 }).toBe('running');
    await expect.poll(async () => (await host<KnowledgeEmbeddingStatusResult>(page, 'knowledge', 'embeddingStatus')).embedding?.status,
      { timeout: 120_000 }).toBe('ready');
    await expect(page.getByTestId('embedding-status')).toHaveAttribute('data-state', 'ready', { timeout: 15_000 });
    await expect(page.getByTestId('knowledge-embedding-settings').getByRole('alert')).toHaveCount(0);
    const file = join(vault, 'concepts/embedding.md');
    await writeFile(file, `---\ntitle: Embedding source\nrevision: 1\nstatus: active\ntrust: confirmed\nscope:\n  workspaceId: ${owner.id}\n---\nProject RAG source owners enforce access before embedding.\n`);
    const answer = await host(page, 'knowledge', 'answerFromSourceSet', {
      question: 'Who checks access before embedding?', sourceRefs: [{ id: 'concepts/embedding.md', path: 'concepts/embedding.md', kind: 'wiki' }],
      workspaceId: owner.id, semantic: true,
    });
    receipt.localAnswer = answer;
    expect(answer.success).toBe(true);
    expect((answer.semanticLane as { status: string }).status).toBe('available');
    await page.screenshot({ path: testInfo.outputPath('embedding-local-ready.png'), fullPage: true });
    await page.getByTestId('embedding-disable').click();
    await expect(page.getByTestId('embedding-status')).toHaveAttribute('data-state', 'disabled');
    await page.getByTestId('embedding-mode').selectOption('remote');
    await expect(page.getByTestId('embedding-provider')).toHaveValue('siliconflow');
    await page.getByTestId('embedding-provider').fill('agent-fixture-unconfigured');
    await page.getByTestId('embedding-configure').click();
    await expect(page.getByTestId('embedding-status')).toHaveAttribute('data-state', 'unavailable', { timeout: 45_000 });
    await page.getByTestId('embedding-provider').fill('siliconflow');
    await page.getByTestId('embedding-configure').click();
    await expect(page.getByTestId('embedding-status')).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    const remote = await host<KnowledgeEmbeddingStatusResult>(page, 'knowledge', 'embeddingStatus');
    expect(remote.embedding).toMatchObject({ mode: 'remote', model: 'Qwen/Qwen3-VL-Embedding-8B', dimensions: 4096 });
    await page.getByTestId('embedding-retry').click();
    await expect.poll(async () => {
      const value = await host<KnowledgeEmbeddingStatusResult>(page, 'knowledge', 'embeddingStatus');
      return value.embedding?.status === 'ready' && value.embedding.credentialEpoch > remote.embedding!.credentialEpoch;
    }, { timeout: 90_000 }).toBe(true);
    await expect(page.getByTestId('embedding-status')).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
    const refreshed = await host<KnowledgeEmbeddingStatusResult>(page, 'knowledge', 'embeddingStatus');
    expect(refreshed.embedding).toMatchObject({ status: 'ready', dimensions: 4096 });
    expect(refreshed.embedding!.credentialEpoch).toBeGreaterThan(remote.embedding!.credentialEpoch);
    await page.screenshot({ path: testInfo.outputPath('embedding-remote-ready.png'), fullPage: true });
    receipt.status = 'pass'; receipt.local = local; receipt.remote = remote; receipt.refreshed = refreshed;
    receipt.steps = { localCancelled: true, localRetryReady: true, selectionFormRestored: true, localRestartRestored: true, ownerReadSemanticPath: true, disabled: true,
      unavailableProvider: true, realRemoteReady: true, credentialGenerationRefreshed: true };
  } finally {
    try { receipt.lastObservedStatus = await host(await getStableWindow(app), 'knowledge', 'embeddingStatus'); } catch { /* Keep the first test failure. */ }
    await writeFile(testInfo.outputPath('embedding-lifecycle-receipt.json'), JSON.stringify(receipt, null, 2));
    await testInfo.attach('embedding-lifecycle-receipt', { body: await readFile(testInfo.outputPath('embedding-lifecycle-receipt.json')), contentType: 'application/json' });
    try { await host(await getStableWindow(app), 'gateway', 'stop'); } catch { /* Startup can fail before a Gateway exists. */ }
    await closeElectronApp(app);
  }
});
