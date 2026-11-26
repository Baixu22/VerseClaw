import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

test('resumes a Knowledge record from home and delivers a selected turn back to that chat once', async ({ electronApp, page }, testInfo) => {
  test.setTimeout(120_000);
  const key = 'agent:main:main';
  const original = 'Which release should we check?';
  const reply = 'Check the November release.';
  const answer = 'The release notes say Thursday.';
  await installIpcMocks(electronApp, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
    gatewayRpc: { '["sessions.list",{}]': { success: true, result: { sessions: [{ key, displayName: 'Release chat', sessionId: 'release-generation' }] } } },
    hostApi: {
      '["knowledge","answerFromSourceSet",null]': { success: true, answer, groundingStatus: 'grounded', unknowns: [], suggestedNextActions: [],
        sources: [{ id: 'release', lookup: 'notes/release.md', title: 'Release notes', excerpt: 'Thursday' }], retrievalDiagnostics: { resultCount: 1 } },
    },
  });
  await electronApp.evaluate(({ ipcMain }, seed) => {
    type Request = { id: string; module: string; action: string; payload?: { method?: string; params?: { key: string; message: string; idempotencyKey: string } } };
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => Promise<unknown>> })._invokeHandlers;
    const previous = handlers.get('host:invoke')!;
    const history = [seed.original, seed.reply].map((content, i) => ({ id: 'initial-' + i, role: i ? 'assistant' : 'user', content, timestamp: Date.now() - 2000 + i }));
    const sends: NonNullable<NonNullable<Request['payload']>['params']>[] = [];
    Object.assign(globalThis, { knowledgeRelaySends: sends });
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', (event, req: Request) => {
      const ok = (data: unknown) => ({ id: req.id, ok: true, data });
      if ((req.module === 'sessions' && req.action === 'history') || (req.module === 'gateway' && req.payload?.method === 'chat.history')) {
        return ok({ success: true, messages: history, hasMore: false });
      }
      if (req.module === 'gateway' && req.payload?.method === 'sessions.send') {
        const params = req.payload.params!;
        sends.push(params);
        if (sends.length === 1) return ok({});
        history.push({ id: 'relayed', role: 'user', content: params.message, timestamp: Date.now() });
        return ok({ runId: 'relay-receipt' });
      }
      return previous(event, req);
    });
  }, { original, reply });
  await page.reload();
  await completeSetup(page);
  const askAbout = page.getByTestId('chat-ask-knowledge-about-reply').first();
  await askAbout.focus();
  await askAbout.click();
  const question = page.getByTestId('knowledge-librarian-question');
  await expect(question).toHaveValue(new RegExp(reply));
  await question.fill('Check the release date.');
  await question.press('Enter');
  await expect(page.getByTestId('knowledge-librarian-answer-section')).toContainText(answer);
  const relay = page.getByTestId('knowledge-relay-home');
  await relay.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Delivery was not confirmed' })).toBeVisible();
  await relay.click();
  await expect(relay).toHaveText(/Open /);
  await relay.click();
  const delivered = page.getByTestId('chat-user-message-bubble').filter({ hasText: answer });
  await expect(delivered).toContainText('Check the release date.');
  await expect(delivered).toContainText('notes/release.md');
  await page.reload();
  await expect(delivered).toBeVisible();
  await page.getByTestId('chat-knowledge-scope-button').click();
  await page.getByTestId('chat-knowledge-history').click();
  await page.getByTestId('chat-knowledge-history-item').filter({ hasText: 'Check the release date.' }).click();
  await expect(page.getByTestId('knowledge-librarian-answer-section')).toContainText(answer);
  await expect(relay).toHaveText(/Open /);
  const sends = await electronApp.evaluate(() => (globalThis as unknown as { knowledgeRelaySends: { key: string; idempotencyKey: string }[] }).knowledgeRelaySends);
  expect(sends.map(item => item.key)).toEqual([key, key]);
  expect(sends[0].idempotencyKey).toBe(sends[1].idempotencyKey);
  await page.screenshot({ path: testInfo.outputPath('restored-knowledge-conversation.png') });
});
