import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { hostInvoke, startScriptedLlm } from './fixtures/fp-p1-harness';
import { configureSessionChainProvider } from './fixtures/session-task-chain';
import { createCollaborationProject, enableCollaborationFixtureVisibility } from './fixtures/session-collaboration';

test('scoped collaboration opens original controls and fences an old generation', async ({ launchElectronApp }, info) => {
  test.setTimeout(300_000);
  const provider = await startScriptedLlm(() => ({ text: 'Control fixture ready.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const project = await createCollaborationProject(app, info.outputPath('control'), 'Control project');
    const before = await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: project.sessionKey } });
    const result = await hostInvoke<{ success: boolean }>(app, 'sessions', 'compact', { sessionKey: project.sessionKey, expectedSessionId: 'old-generation' });
    expect(result.success).toBe(false);
    expect(await hostInvoke(app, 'gateway', 'rpc', { method: 'sessions.describe', params: { key: project.sessionKey } })).toEqual(before);

    await createCollaborationProject(app, info.outputPath('destination'), 'Control destination');
    await enableCollaborationFixtureVisibility(app);
    const page = await getStableWindow(app);
    const openControl = async (action: 'fork' | 'migrate' | 'handoff') => {
      await page.getByTestId('sidebar-nav-system').click();
      const panel = page.getByTestId('session-collaboration');
      await panel.getByTestId(`collaboration-row-${encodeURIComponent(project.sessionKey)}`).click({ timeout: 45_000 });
      const controls = panel.getByTestId('collaboration-controls');
      if (await controls.getAttribute('open') === null) await controls.locator('summary').click();
      await controls.getByTestId(`collaboration-control-${action}`).click();
    };
    await openControl('fork');
    await expect(page.getByTestId('chat-session-fork')).toBeVisible();
    await page.keyboard.press('Escape');

    await openControl('migrate');
    const migration = page.getByTestId('execution-migration-dialog');
    await expect(migration).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(migration).toHaveCount(0);

    await openControl('handoff');
    await expect(page.getByTestId('chat-handoff-dialog')).toBeVisible();

  } finally { await closeElectronApp(app); await provider.close(); }
});

test('a delayed guidance receipt preserves a draft edited back to its original text', async ({ launchElectronApp }, info) => {
  test.setTimeout(300_000);
  const provider = await startScriptedLlm(() => ({ text: 'Guidance fixture ready.' }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await configureSessionChainProvider(app, provider.port);
    const target = await createCollaborationProject(app, info.outputPath('guide'), 'Guide project');
    await createCollaborationProject(app, info.outputPath('source'), 'Guide source');
    await enableCollaborationFixtureVisibility(app);
    // Inject a lost acknowledgement at the Host boundary; the original UI and scope owners remain active.
    await app.evaluate(({ ipcMain }, scope) => {
      type Request = { id: string; module: string; action: string; payload: Record<string, unknown> };
      type Response = { ok: boolean; data?: { page?: { items: Array<{ sessionKey: string; sources: Record<string, unknown> }> } } };
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => Promise<Response>> })._invokeHandlers;
      const original = handlers.get('host:invoke')!;
      const state = { sends: 0, id: '', readPending: false, release: undefined as undefined | (() => void) };
      (globalThis as unknown as { guideReceiptFixture: typeof state }).guideReceiptFixture = state;
      handlers.set('host:invoke', async (event, request) => {
        const reply = (data: unknown) => ({ id: request.id, ok: true, data }) as Response;
        if (request.module === 'sessions' && request.action === 'longTaskControlStatus' && request.payload.sessionKey === scope.sessionKey) {
          return reply({ success: true, available: true, queueCount: 0,
            latestCheckpoint: { taskLedgerRootId: 'fixture-loop', checkpoint: { schemaVersion: 1, trigger: 'guide' } } });
        }
        if (request.module === 'chat' && request.action === 'sendWithMedia' && request.payload.expectedGuideRunId === 'fixture-guide-run') {
          state.sends += 1; state.id = String(request.payload.idempotencyKey);
          return reply({ success: false, error: 'Connection lost after acceptance' });
        }
        if (request.module === 'sessions' && request.action === 'longTaskControlHistory' && request.payload.guideReceipt) {
          state.readPending = true;
          await new Promise<void>(resolve => { state.release = resolve; });
          return reply({ success: true, key: scope.sessionKey, events: [{ sessionKey: scope.sessionKey,
            workspaceId: scope.workspaceId, runId: 'fixture-guide-run', idempotencyKey: `chat:${state.id}:guide:event`,
            mode: 'guide', status: 'steered', payload: { sessionGeneration: scope.sessionGeneration } }] });
        }
        const response = await original(event, request);
        if (request.module === 'sessionActivity' && request.action === 'query') {
          for (const item of response.data?.page?.items ?? []) {
            if (item.sessionKey === scope.sessionKey) item.sources.run = { state: 'ready', owner: 'Runtime',
              readAt: Date.now(), reason: null, value: { runId: 'fixture-guide-run', scope } };
          }
        }
        return response;
      });
    }, target.scope);
    const page = await getStableWindow(app);
    await page.getByTestId('sidebar-nav-system').click();
    const panel = page.getByTestId('session-collaboration');
    await panel.getByTestId(`collaboration-row-${encodeURIComponent(target.sessionKey)}`).click({ timeout: 45_000 });
    await panel.getByTestId('collaboration-controls').locator('summary').click();
    await panel.getByTestId('collaboration-control-guide').click();
    const editor = page.getByTestId('chat-composer-input');
    await expect(page.getByTestId('chat-guidance-scope')).toBeVisible();
    await editor.fill('Original guidance');
    await editor.press('Enter');
    await expect(page.getByTestId('chat-guidance-receipt')).toBeEnabled();
    await page.getByTestId('chat-guidance-receipt').click();
    await expect.poll(() => app.evaluate(() =>
      (globalThis as unknown as { guideReceiptFixture: { readPending: boolean } }).guideReceiptFixture.readPending)).toBe(true);
    await editor.fill('New draft');
    await editor.fill('Original guidance');
    await app.evaluate(() => (globalThis as unknown as { guideReceiptFixture: { release: () => void } }).guideReceiptFixture.release());
    await expect(page.getByTestId('chat-guidance-scope')).toHaveCount(0);
    await expect(editor).toHaveValue('Original guidance');
    expect(await app.evaluate(() =>
      (globalThis as unknown as { guideReceiptFixture: { sends: number } }).guideReceiptFixture.sends)).toBe(1);
  } finally { await closeElectronApp(app); await provider.close(); }
});
