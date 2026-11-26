import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

test('mentions the knowledge bot in Chat, follows real request phases across pages and keeps the result', async ({ electronApp, page }, testInfo) => {
  test.setTimeout(120_000);
  const answer = 'The release is on Thursday.';
  await installIpcMocks(electronApp, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
    gatewayRpc: {
      '["sessions.list",{}]': { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'Release chat', sessionId: 'generation-a' }] } },
      '["chat.history",null]': { success: true, result: { messages: [], hasMore: false } },
    },
    hostApi: {
      '["sessions","history",null]': { success: true, messages: [], hasMore: false },
      '["knowledge","operationsStatus",null]': { success: true, operations: { config: { answerMode: 'strict' } } },
    },
  });
  await electronApp.evaluate(({ ipcMain, BrowserWindow }, answer) => {
    type Request = { id: string; module: string; action: string; payload?: { requestId?: string; question?: string; method?: string } };
    const previous = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: Request) => Promise<unknown>> })._invokeHandlers.get('host:invoke')!;
    const control = { requestId: '', questions: [] as string[], chatSends: 0, release: (_fail: boolean) => {} };
    Object.assign(globalThis, { knowledgeMentionControl: control });
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, req: Request) => {
      if (req.module === 'chat' && req.action === 'sendWithMedia') control.chatSends++;
      if (req.module !== 'knowledge' || req.action !== 'answerFromSourceSet') return previous(event, req);
      control.requestId = req.payload?.requestId ?? '';
      control.questions.push(req.payload?.question ?? '');
      BrowserWindow.getAllWindows()[0].webContents.send('chat:knowledge-answer-progress', { requestId: control.requestId, phase: 'searching' });
      const failed = await new Promise<boolean>(resolve => { control.release = resolve; });
      return { id: req.id, ok: true, data: failed ? { success: false, error: 'Source temporarily unavailable' } : {
        success: true, answer, sources: [{ id: 'release', title: 'Release notes', lookup: 'release.md', excerpt: 'Thursday' }],
        unknowns: [], suggestedNextActions: [], groundingStatus: 'grounded', retrievalDiagnostics: { resultCount: 1 },
      } };
    });
  }, answer);
  await page.reload();
  await completeSetup(page);
  const input = page.getByTestId('chat-composer-input');
  await page.getByTestId('chat-composer-actions').click();
  await page.getByTestId('chat-composer-action-more').click();
  await page.getByTestId('chat-composer-agent').click();
  await page.getByTestId('chat-mention-knowledge').click();
  await expect(input).toHaveValue('@knowledge ');
  await input.fill('@知识库助手 查一下发布日期');
  await input.press('Enter');
  const activity = page.getByTestId('chat-knowledge-bot-activity');
  await expect(activity).toBeVisible();
  await expect(activity).toHaveAttribute('data-phase', 'searching');
  await expect(activity.getByTestId('knowledge-bot')).toHaveAttribute('data-state', 'searching');
  const phase = async (value: string, matching = true) => electronApp.evaluate(({ BrowserWindow }, args) => {
    const control = (globalThis as unknown as { knowledgeMentionControl: { requestId: string } }).knowledgeMentionControl;
    BrowserWindow.getAllWindows()[0].webContents.send('chat:knowledge-answer-progress', {
      requestId: args.matching ? control.requestId : 'unrelated', phase: args.value,
    });
  }, { value, matching });
  const finish = (failed = false) => electronApp.evaluate((_app, fail) =>
    (globalThis as unknown as { knowledgeMentionControl: { release: (value: boolean) => void } }).knowledgeMentionControl.release(fail), failed);
  await phase('reading', false);
  await expect(activity).toHaveAttribute('data-phase', 'searching');
  await phase('reading');
  await expect(activity).toHaveAttribute('data-phase', 'reading');
  await page.getByTestId('sidebar-new-chat').click();
  await expect(activity).toHaveCount(0);
  await page.getByTestId('sidebar-session-agent:main:main').click();
  await expect(activity).toHaveAttribute('data-phase', 'reading');
  await activity.getByTestId('chat-knowledge-bot-open').click();
  await expect(page.getByTestId('knowledge-chat-page')).toHaveAttribute('data-bot-state', 'reading');
  await phase('thinking');
  await expect(page.getByTestId('knowledge-chat-page')).toHaveAttribute('data-bot-state', 'thinking');
  await page.getByTestId('knowledge-chat-back').click();
  await expect(activity).toHaveAttribute('data-phase', 'thinking');
  await phase('verifying');
  await expect(activity.getByTestId('knowledge-bot')).toHaveAttribute('data-state', 'working');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(activity.getByTestId('knowledge-bot')).toHaveAttribute('data-motion', 'reduced');
  await page.screenshot({ path: testInfo.outputPath('knowledge-bot-working.png') });
  await finish();
  await expect(activity).toHaveAttribute('data-phase', 'finished');
  await expect(activity.getByTestId('chat-knowledge-bot-answer')).toContainText(answer);
  await activity.getByTestId('chat-knowledge-bot-steps').locator('summary').click();
  await expect(activity.locator('li')).toHaveCount(4);
  await page.reload();
  await expect(activity).toHaveAttribute('data-phase', 'finished');
  await expect(activity).toContainText(answer);
  await input.fill('@knowledge');
  await input.press('Enter');
  await expect(activity).toHaveAttribute('data-phase', 'finished');
  expect(await electronApp.evaluate(() => (globalThis as unknown as { knowledgeMentionControl: { questions: string[] } }).knowledgeMentionControl.questions)).toEqual(['查一下发布日期']);
  await input.fill('@knowledge Retry the date');
  await input.press('Enter');
  await expect(activity).toHaveAttribute('data-phase', 'searching');
  await finish(true);
  await expect(activity.getByRole('alert')).toContainText('Source temporarily unavailable');
  await activity.getByTestId('chat-knowledge-bot-retry').click();
  await expect(activity).toHaveAttribute('data-phase', 'searching');
  await finish();
  await expect(activity).toHaveAttribute('data-phase', 'finished');
  expect(await electronApp.evaluate(() => (globalThis as unknown as { knowledgeMentionControl: { chatSends: number } }).knowledgeMentionControl.chatSends)).toBe(0);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: testInfo.outputPath('knowledge-bot-complete.png') });
});
