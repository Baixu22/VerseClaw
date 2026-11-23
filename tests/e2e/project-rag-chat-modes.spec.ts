import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, buildMockProviderConfig, MOCK_MODEL_ID, startScriptedLlm } from './fixtures/fp-p1-harness';

type Json = Record<string, unknown>;
async function host<T = Json>(page: Page, module: string, action: string, payload?: Json): Promise<T> {
  return page.evaluate(async input => {
    const response = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: input.module,
      action: input.action, ...(input.payload ? { payload: input.payload } : {}) });
    if (!response.ok) throw Error(response.error?.message ?? 'Host request failed');
    return response.data as T;
  }, { module, action, payload });
}

test('Project RAG chat modes retain real owner evidence and bound optional reads', async ({ homeDir, userDataDir, launchElectronApp }, testInfo) => {
  test.setTimeout(480000);
  const receipt: Json = { actor: 'codex/project-rag-relay-01a1d438', driven_by: 'agent', realHumanEvidence: false,
    providerKind: 'scripted-local-fixture', status: 'fail', steps: {} };
  const steps = receipt.steps as Record<string, boolean>;
  const wire: string[] = [];
  let releaseHeld!: () => void;
  const held = new Promise<void>(resolve => { releaseHeld = resolve; });
  const llm = await startScriptedLlm(async text => {
    wire.push(text);
    if (text.includes('RAG11 hold run')) await held;
    return { text: 'RAG11 scripted reply' };
  });
  const workspace = join(homeDir, 'chat-workspace'), vault = join(homeDir, 'chat-vault');
  await mkdir(workspace, { recursive: true });
  await mkdir(join(vault, 'concepts'), { recursive: true });
  const app = await launchElectronApp({ skipSetup: true, env: { VERSE_CLAW_OPENCLAW_RUNTIME: 'source' } });
  let page: Page | undefined;
  try {
    page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
    const created = await host<{ activeWorkspace: { id: string; activeSessionKey: string } }>(page, 'workspaces', 'create',
      { name: 'RAG11 interaction fixture', rootPath: workspace, agentId: 'main', permissionMode: 'fullAccess' });
    const owner = created.activeWorkspace;
    const config = buildMockProviderConfig(llm.port, workspace, { contextBlock: { injectionBudget: { totalChars: 1800 } } });
    (config.models as { providers: { openai: { models: Array<{ input: string[] }> } } }).providers.openai.models[0].input = ['text', 'image'];
    config.channels = {}; config.update = { checkOnStart: false };
    config.plugins = { enabled: true, entries: { 'memory-wiki': { enabled: true, config: {
      vaultMode: 'isolated', vault: { path: vault }, search: { backend: 'local', corpus: 'wiki' },
    } } } };
    const now = new Date().toISOString();
    const account = { id: 'rag11-openai', vendorId: 'openai', label: 'RAG11 scripted provider', authMode: 'api_key',
      baseUrl: `http://127.0.0.1:${llm.port}/v1`, model: MOCK_MODEL_ID, enabled: true, isDefault: true, createdAt: now, updatedAt: now };
    expect((await host(page, 'providers', 'createAccount', { account, apiKey: 'test-key-ok' })).success).toBe(true);
    expect((await host(page, 'providers', 'setDefaultAccount', { accountId: account.id })).success).toBe(true);
    for (const state of [join(homeDir, '.openclaw'), join(userDataDir, 'openclaw-source-state')]) {
      await mkdir(state, { recursive: true }); await writeFile(join(state, 'openclaw.json'), JSON.stringify(config));
    }
    const raw = (title: string, body: string, revision = 1, extra = '') =>
      `---\ntitle: ${title}\nrevision: ${revision}\nstatus: active\ntrust: confirmed\nupdatedAt: "${now}"\nscope:\n  workspaceId: ${owner.id}\n${extra}---\n${body}\n`;
    const path = 'concepts/deployment-guide.md';
    const source = join(vault, path);
    await writeFile(source, raw('Deployment guide', 'The deployment port is 18789.'));
    await writeFile(join(vault, 'concepts/queue-guide.md'), raw('Queue guide', 'Queued follow-ups retain their selected project evidence.'));
    await writeFile(join(vault, 'concepts/budget-guide.md'), raw('Large budget guide', 'Large source evidence. '.repeat(500)));
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: await allocatePort() });
    await host(page, 'gateway', 'start').catch(error => { if (!String(error).includes('timed out')) throw error; });
    await expect.poll(async () => (await host<{ state: string }>(page!, 'gateway', 'status')).state, { timeout: 120000 }).toBe('running');
    await host(page, 'gateway', 'rpc', { method: 'sessions.create', params: { key: owner.activeSessionKey, agentId: 'main' }, timeoutMs: 30000 });
    await page.evaluate(() => { window.location.hash = '#/settings/models'; });
    await expect(page.getByTestId('embedding-mode')).toBeVisible();
    await page.evaluate(() => { window.location.hash = '#/'; });
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Json) => Promise<Json>> })._invokeHandlers;
      const original = handlers.get('host:invoke')!;
      const reads: unknown[] = [];
      (globalThis as unknown as { rag11OwnerReads: unknown[] }).rag11OwnerReads = reads;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: Json) => {
        const response = await original(event, request);
        if (request.module === 'knowledge' && (request.action === 'get' || request.action === 'routeContext' || request.action === 'search')) reads.push({ action: request.action, request: request.payload, response });
        return response;
      });
    });
    const composer = page.getByTestId('chat-composer-input');
    const mode = page.getByTestId('chat-knowledge-interaction'), profile = page.getByTestId('chat-knowledge-profile');
    const openKnowledgeSettings = async () => {
      const trigger = page!.getByTestId('chat-knowledge-scope-button');
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
      await expect(page!.getByTestId('chat-knowledge-scope-menu')).toHaveAttribute('data-state', 'open');
    };
    const revealKnowledgeOptions = async () => {
      await openKnowledgeSettings();
      if (!(await mode.isVisible())) await page!.getByTestId('chat-knowledge-options-toggle').click();
    };
    const selectMode = async (value: string) => { await revealKnowledgeOptions(); await mode.selectOption(value); };
    const selectProfile = async (value: string) => { await revealKnowledgeOptions(); await profile.selectOption(value); };

    await expect(composer).toBeVisible({ timeout: 30000 });
    await openKnowledgeSettings();
    await expect(mode).toHaveValue('off'); await expect(profile).toHaveValue('local');
    await page.keyboard.press('Escape');
    await composer.fill('RAG11 Off plain send'); await composer.press('Enter');
    await expect.poll(() => wire.some(text => text.includes('RAG11 Off plain send')), { timeout: 90000 }).toBe(true);
    await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', 'idle', { timeout: 90000 });
    await expect(page.getByTestId('chat-used-knowledge')).toHaveCount(0);
    steps.offOrdinarySend = true;
    await selectProfile('quality'); await expect(mode).toHaveValue('off');
    await selectMode('manual'); await expect(mode).toHaveValue('manual'); await expect(profile).toHaveValue('quality');
    await selectProfile('research'); await expect(mode).toHaveValue('manual');
    await selectMode('suggest'); await expect(profile).toHaveValue('research'); await selectProfile('local');
    await composer.fill(path);
    await expect(page.getByTestId('chat-knowledge-suggestion')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('chat-knowledge-suggestion-open').click();
    await expect(page.getByTestId('chat-knowledge-preflight-version').first()).toContainText('Version');
    await expect(page.getByTestId('chat-knowledge-preflight-budget').first()).toContainText('bytes');
    await page.screenshot({ path: testInfo.outputPath('rag11-preflight.png'), fullPage: true });
    await page.getByTestId('chat-knowledge-inspect-source').first().click();
    await expect(page.getByTestId('chat-knowledge-inspected-body')).toContainText('18789');
    await page.screenshot({ path: testInfo.outputPath('rag11-inspect.png'), fullPage: true });
    await page.getByTestId('chat-knowledge-inspected-attach').click();
    await expect(page.getByTestId('chat-knowledge-selected-item')).toHaveCount(1);
    await expect(composer).toHaveValue(path);
    await selectMode('off'); await expect(page.getByTestId('chat-knowledge-selected-item')).toHaveCount(0);
    await expect(profile).toHaveValue('local');
    steps.orthogonalModesAndInspect = true;
    await selectMode('suggest'); await composer.fill('deployment guide port');
    await expect(page.getByTestId('chat-knowledge-suggestion')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('chat-knowledge-suggestion-dismiss').click();
    await expect(composer).toHaveValue('deployment guide port');
    await expect(page.getByTestId('chat-knowledge-suggestion')).toHaveCount(0);
    steps.dismissPreservesDraft = true;
    const fallback = await host<{ retrieval?: { fallbackReasons: string[] } }>(page, 'knowledge', 'routeContext', {
      message: path, mode: 'suggest', profile: 'local', scope: 'wiki', sessionKey: owner.activeSessionKey, workspaceId: owner.id,
    });
    receipt.sourceFallback = fallback.retrieval;
    expect(fallback.retrieval?.fallbackReasons.some(reason => /index|fallback/.test(reason))).toBe(true);

    const attach = async (lookup: string) => {
      await openKnowledgeSettings();
      await page!.getByTestId('chat-knowledge-search-input').fill(lookup);
      const row = page!.getByTestId('chat-knowledge-search-result').filter({ hasText: lookup }).first();
      let attempts = 0;
      for (; attempts < 3; attempts++) {
        await page!.getByTestId('chat-knowledge-search-submit').click();
        if (await row.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) break;
      }
      ((receipt.manualSearchAttempts ??= []) as Json[]).push({ lookup, attempts: attempts + 1 });
      await row.click();
      await composer.press('Escape');
    };
    const finishSend = async (used = true) => {
      await expect(page!.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', 'idle', { timeout: 90000 });
      if (used) await expect(page!.getByTestId('chat-used-knowledge').last()).toContainText('Used Knowledge:', { timeout: 30000 });
    };
    await selectMode('manual'); await attach(path); await attach('concepts/budget-guide.md');
    await composer.fill('RAG11 manual evidence with budget drop'); await composer.press('Enter');
    await finishSend();
    const usage = page.getByTestId('chat-used-knowledge').last();
    await expect(usage).toContainText('1 fragments');
    await expect(usage).toContainText('1 selected sources not retained');
    await expect(page.getByTestId('chat-used-knowledge-sources').last()).toContainText('Deployment guide');
    await expect(page.getByTestId('chat-used-knowledge-sources').last()).not.toContainText('Large budget guide');
    await page.screenshot({ path: testInfo.outputPath('rag11-used.png'), fullPage: true });
    steps.actualRetainedUsageAndBudgetDrop = true;
    await selectMode('auto-read'); await composer.fill(path); await composer.press('Enter');
    await finishSend(); await expect(page.getByTestId('chat-used-knowledge-sources').last()).toContainText('Deployment guide');
    steps.autoReadExactOwner = true;

    await selectMode('manual'); await attach(path);
    await composer.fill('RAG11 hold run'); await composer.press('Enter');
    await expect.poll(() => wire.some(text => text.includes('RAG11 hold run')), { timeout: 60000 }).toBe(true);
    await selectMode('auto-read'); await composer.fill('concepts/queue-guide.md');
    await composer.press('Enter');
    await expect(composer).toHaveValue('', { timeout: 15000 });
    expect(wire.some(text => text.includes('concepts/queue-guide.md'))).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('rag11-queue.png'), fullPage: true });
    releaseHeld();
    await expect.poll(() => wire.some(text => text.includes('concepts/queue-guide.md')), { timeout: 90000 }).toBe(true);
    await finishSend(); await expect(page.getByTestId('chat-used-knowledge-sources').last()).toContainText('Queue guide');
    steps.normalQueuedAutoRead = true;

    const image = join(homeDir, 'pixel.png');
    await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=', 'base64'));
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as typeof dialog.showOpenDialog;
    }, image);
    await selectMode('manual'); await attach(path);
    await page.getByTestId('chat-composer-actions').click();
    await page.getByTestId('chat-composer-action-attach-files').click();
    await expect(page.getByText('pixel.png', { exact: true }).first()).toBeVisible();
    await composer.fill('RAG11 media evidence'); await composer.press('Enter');
    await finishSend();
    await expect(page.getByTestId('chat-used-knowledge-sources').last()).toContainText('Deployment guide');
    steps.mediaWithEvidence = true;

    // Delayed delivery and provider failures use the existing Host boundary; owner reads above are real.
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Json) => Promise<Json>> })._invokeHandlers;
      const original = handlers.get('host:invoke')!;
      const state = { fault: 'off', calls: [] as Array<{ module: unknown; action: unknown; payload: unknown }> };
      (globalThis as unknown as { rag11Faults: typeof state }).rag11Faults = state;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: Json) => {
        if (request.module === 'knowledge' || request.module === 'chat') state.calls.push({ module: request.module, action: request.action, payload: request.payload });
        if (request.module === 'knowledge' && (request.action === 'routeContext' || request.action === 'get') && state.fault !== 'off') {
          const fault = state.fault;
          if (fault === 'provider-timeout') { await new Promise(resolve => setTimeout(resolve, 6500)); return { id: request.id, ok: true, data: { success: false, error: 'scripted provider deadline exceeded' } }; }
          const response = await original(event, request);
          if (fault === 'late') await new Promise(resolve => setTimeout(resolve, 1600));
          return response;
        }
        return original(event, request);
      });
    });
    const fault = (value: string) => app.evaluate((_electron, kind) => {
      (globalThis as unknown as { rag11Faults: { fault: string } }).rag11Faults.fault = kind;
    }, value);
    const callCount = () => app.evaluate(() => (globalThis as unknown as { rag11Faults: { calls: Array<{ action: string }> } }).rag11Faults.calls.filter(call => call.action === 'routeContext').length);
    await selectMode('suggest'); await fault('late');
    let before = await callCount(); await composer.fill(path + '  ');
    await expect.poll(callCount).toBeGreaterThan(before);
    await openKnowledgeSettings();
    await page.getByTestId('chat-knowledge-menu-cancel').click();
    await expect(composer).toHaveValue(path + '  ');
    await page.waitForTimeout(1800); await expect(page.getByTestId('chat-knowledge-suggestion')).toHaveCount(0);
    steps.cancelAndLateResponse = true;
    before = await callCount(); await composer.fill('concepts/queue-guide.md ');
    await expect.poll(callCount).toBeGreaterThan(before); await selectProfile('quality');
    await page.waitForTimeout(1800); await expect(page.getByTestId('chat-knowledge-preflight-item')).toHaveCount(0);
    steps.profileChangeFencesOldResponse = true;
    before = await callCount(); await selectProfile('local'); await composer.fill(path);
    await expect.poll(callCount).toBeGreaterThan(before); await selectMode('off');
    await page.waitForTimeout(1800); await expect(page.getByTestId('chat-knowledge-suggestion')).toHaveCount(0);
    steps.scopeChangeFencesOldResponse = true;
    await selectMode('auto-read'); before = await callCount(); await composer.fill(path); await composer.press('Enter');
    await expect.poll(callCount).toBeGreaterThan(before); await composer.fill('RAG11 replacement draft');
    await page.waitForTimeout(1800); await expect(composer).toHaveValue('RAG11 replacement draft');
    expect(wire.some(text => text.includes('RAG11 replacement draft'))).toBe(false);
    steps.queryChangePreservesUnsentDraft = true;

    await fault('off'); await selectMode('suggest'); await composer.fill(path + ' ');
    await expect(page.getByTestId('chat-knowledge-suggestion')).toBeVisible({ timeout: 30000 });
    await page.getByTestId('chat-knowledge-suggestion-open').click(); await fault('late');
    await page.getByTestId('chat-knowledge-inspect-source').first().click();
    await selectMode('off'); await page.waitForTimeout(1800);
    await expect(page.getByTestId('chat-knowledge-source-inspector')).toHaveCount(0);
    steps.lateInspectFenced = true;

    await fault('late'); await selectMode('suggest');
    before = await callCount(); await composer.fill('concepts/queue-guide.md');
    await expect.poll(callCount).toBeGreaterThan(before);
    await page.getByTestId(`sidebar-session-project-${owner.id}`).locator('.project-row-wrap').hover();
    await page.getByTestId(`sidebar-project-new-session-${owner.id}`).click();
    await expect(page.getByTestId('chat-used-knowledge')).toHaveCount(0);
    await composer.fill('RAG11 new session draft');
    await page.waitForTimeout(1800);
    await expect(composer).toHaveValue('RAG11 new session draft');
    await expect(page.getByTestId('chat-knowledge-suggestion')).toHaveCount(0);
    steps.sessionSwitchFencesOldResponse = true;

    await selectMode('auto-read'); await selectProfile('quality'); await fault('provider-timeout');
    await composer.fill('RAG11 provider timeout ordinary send');
    const started = Date.now(); await composer.press('Enter');
    await expect(composer).toHaveValue('', { timeout: 8000 });
    receipt.optionalReadTimeoutMs = Date.now() - started;
    expect(receipt.optionalReadTimeoutMs as number).toBeLessThan(8000);
    await finishSend(false); await fault('off');
    steps.providerTimeoutDoesNotHoldSend = true;

    await selectProfile('local'); await composer.fill('RAG11 missing indexed content');
    await composer.press('Enter'); await finishSend(false);
    steps.missingIndexDoesNotHoldSend = true;
    await writeFile(source, raw('Deployment guide', 'The deployment port is 19999.', 2));
    await selectMode('suggest');
    // A source refresh can consume the local lane's bounded first read. Re-enter
    // the query as a user retry; keep every request's original retrieval budget.
    let revisionAttempts = 0;
    for (; revisionAttempts < 3; revisionAttempts++) {
      await composer.fill(`${path}${' '.repeat(revisionAttempts)}`);
      if (await page.getByTestId('chat-knowledge-suggestion').waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) break;
    }
    receipt.sourceRevisionAttempts = revisionAttempts + 1;
    await expect(page.getByTestId('chat-knowledge-suggestion')).toBeVisible();
    await page.getByTestId('chat-knowledge-suggestion-open').click();
    await expect(page.getByTestId('chat-knowledge-preflight-version').first()).not.toContainText('Version 1');
    await page.getByTestId('chat-knowledge-inspect-source').first().click();
    await expect(page.getByTestId('chat-knowledge-inspected-body')).toContainText('19999');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('chat-knowledge-source-inspector')).toHaveCount(0);
    await writeFile(source, raw('Deployment guide', 'Denied source body', 3, 'acl:\n  read: [other]\n'));
    await page.getByTestId('chat-knowledge-inspect-source').first().click();
    await expect(page.getByTestId('chat-knowledge-suggestion')).toHaveCount(0);
    await composer.fill(path + '  ');
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('chat-knowledge-suggestion')).toHaveCount(0);
    await expect(page.getByTestId('chat-knowledge-inspected-body')).toHaveCount(0);
    steps.currentVersionAndOwnerDenial = true;
    await writeFile(source, raw('Deployment guide', 'The deployment port is 19999.', 4));
    await fault('late'); before = await callCount(); await composer.fill(path);
    await expect.poll(callCount).toBeGreaterThan(before);
    const otherRoot = join(homeDir, 'other-workspace'); await mkdir(otherRoot, { recursive: true });
    await host(page, 'workspaces', 'create', { name: 'Other RAG11 workspace', rootPath: otherRoot, agentId: 'main', permissionMode: 'fullAccess' });
    await expect(page.getByText('Other RAG11 workspace', { exact: true }).last()).toBeVisible();
    await composer.fill('RAG11 other workspace draft'); await page.waitForTimeout(1800);
    await expect(composer).toHaveValue('RAG11 other workspace draft');
    await expect(page.getByTestId('chat-knowledge-suggestion')).toHaveCount(0);
    steps.workspaceSwitchFencesOldResponse = true;
    receipt.faultCalls = await app.evaluate(() => (globalThis as unknown as { rag11Faults: { calls: unknown[] } }).rag11Faults.calls);
    receipt.modelCalls = wire.length;
    receipt.status = 'pass';
  } finally {
    releaseHeld();
    if (page && !page.isClosed()) receipt.ownerReads = await app.evaluate(() =>
      (globalThis as unknown as { rag11OwnerReads?: unknown[] }).rag11OwnerReads ?? []).catch(() => []);
    if (receipt.status !== 'pass' && page && !page.isClosed()) {
      await page.screenshot({ path: testInfo.outputPath('rag11-failure.png'), fullPage: true }).catch(() => {});
      receipt.gateway = await host(page, 'gateway', 'status').catch(error => ({ error: String(error) }));
    }
    await writeFile(testInfo.outputPath('chat-modes-receipt.json'), JSON.stringify(receipt, null, 2));
    await closeElectronApp(app); await new Promise<void>(resolve => llm.server.close(() => resolve()));
  }
});
