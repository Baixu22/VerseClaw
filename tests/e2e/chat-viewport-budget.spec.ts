import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const sessionKey = 'agent:main:main';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#dde8f4"/><text x="60" y="160" font-size="36">History image fixture</text></svg>';
const preview = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
function history(imagePath: string, count: number) {
  return Array.from({ length: count / 2 }, (_, turn) => [
    { id: 'user-' + turn, role: 'user', content: 'Request ' + turn, timestamp: 1700000000000 + turn * 1000 },
    { id: 'answer-' + turn, role: 'assistant', timestamp: 1700000000500 + turn * 1000,
      content: [{ type: 'thinking', thinking: `Reasoning for turn ${turn}.\n` + 'Measured details. '.repeat(80) },
        { type: 'text', text: `Answer ${turn}\n\n` + ('Variable height paragraph with **markdown** and `code`.\n\n').repeat(turn % 7 + 1)
          + (turn === 149 ? 'Large final message.\n\n' + 'Long content remains complete. '.repeat(700) : '') }],
      ...(turn === 149 ? { _attachedFiles: [{ filePath: imagePath, fileName: 'history.svg', mimeType: 'image/svg+xml', fileSize: svg.length, preview }] } : {}),
    },
  ]).flat();
}

for (const language of ['en', 'zh', 'ja', 'ru']) {
  test(`long history navigation, expansion and reload (${language})`, async ({ launchElectronApp, homeDir }, testInfo) => {
    test.setTimeout(180_000);
    const imagePath = join(homeDir, 'history.svg'); await writeFile(imagePath, svg);
    const messages = history(imagePath, 300);
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, { gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
        gatewayRpcByMethod: { 'sessions.list': { sessions: [{ key: sessionKey, displayName: 'Long history' }] }, 'chat.history': { messages: messages.slice(-200) } },
        hostApi: {
          [JSON.stringify(['settings', 'getAll', null])]: { language, theme: 'light' },
          [JSON.stringify(['agents', 'list', null])]: { success: true, agents: [{ id: 'main', name: 'Main' }] },
          [JSON.stringify(['sessions', 'history', null])]: { success: true, messages },
          [JSON.stringify(['media', 'thumbnails', null])]: { [imagePath]: { preview, fileSize: svg.length } },
        } });
      const page = await getStableWindow(app); await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      const scroller = page.getByTestId('chat-scroll-container');
      await expect(page.getByTestId('chat-load-more-history')).toBeAttached({ timeout: 30_000 });
      await page.getByTestId('chat-load-more-history').click();
      await expect(page.getByTestId('chat-load-more-history')).toHaveCount(0);
      const first = page.getByTestId('chat-message-nav-rail-item-0');
      await expect(first).toBeAttached(); await first.click();
      await expect(page.getByTestId('chat-message-0')).toBeInViewport();
      await expect(page.getByTestId('chat-message-0')).toContainText('Request 0');
      const firstCount = await page.locator('[data-viewport-key]').count();
      expect(firstCount).toBeGreaterThan(0); expect(firstCount).toBeLessThanOrEqual(120);
      await page.getByTestId('chat-message-nav-rail-item-140').click();
      const anchor = page.getByTestId('chat-message-140'); await expect(anchor).toBeInViewport();
      const closed = await anchor.boundingBox();
      const toggle = anchor.getByTestId('chat-turn-summary-toggle');
      await expect(toggle).toBeVisible(); await toggle.click();
      const expanded = await anchor.boundingBox();
      expect(expanded!.height).not.toBe(closed!.height);
      await toggle.click();
      await page.getByTestId('chat-message-nav-rail-item-298').click();
      await expect(page.getByTestId('chat-message-299')).toContainText('Large final message.');
      const image = page.getByTestId('chat-message-299').locator('img').last();
      await expect(image).toBeAttached();
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.screenshot({ path: testInfo.outputPath('long-history-' + language + '.png') });
      const finalCount = await page.locator('[data-viewport-key]').count(); expect(finalCount).toBeLessThanOrEqual(120);
      await writeFile(testInfo.outputPath('navigation.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex', language,
        loadedMessages: 300, firstMessageVisible: true, middleMessageVisible: true, expandedHeight: expanded!.height,
        closedHeight: closed!.height, imageLoaded: true, fullLargeText: true, mounted: { first: firstCount, final: finalCount } }, null, 2));
    } finally { await closeElectronApp(app); }
  });
}

test('paired retained history and scrolling workload', async ({ launchElectronApp, homeDir }, testInfo) => {
  test.setTimeout(240_000);
  const imagePath = join(homeDir, 'history.svg'); await writeFile(imagePath, svg);
  const sessions = Array.from({ length: 12 }, (_, index) => ({ key: index === 0 ? sessionKey : 'agent:main:cache-' + index, displayName: 'Cache session ' + index }));
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, { gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
      gatewayRpcByMethod: { 'sessions.list': { sessions } },
      hostApi: { [JSON.stringify(['agents', 'list', null])]: { success: true, agents: [{ id: 'main', name: 'Main' }] } } });
    await app.evaluate(({ ipcMain }, data) => {
      const ipc = ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: { id: string; module: string; action: string; payload?: Record<string, unknown> }) => unknown> };
      const original = ipc._invokeHandlers.get('host:invoke')!;
      const calls: string[] = []; (globalThis as Record<string, unknown>).__viewportHistoryCalls = calls;
      const workspace = { id: 'viewport-workspace', name: 'Viewport cache', rootPath: data.rootPath,
        agentId: 'main', selectedAgentId: 'main', activeSessionKey: 'agent:main:main', permissionMode: 'readOnly',
        createdAt: 1, updatedAt: 1, lastOpenedAt: 1, state: {},
        sessionStates: Object.fromEntries(data.sessions.map(session => [session.key, {}])) };
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', (event, request) => {
        const payload = request.payload ?? {};
        if (request.module === 'workspaces' && ['list', 'getActive', 'saveState', 'update'].includes(request.action)) {
          if (typeof payload.activeSessionKey === 'string') workspace.activeSessionKey = payload.activeSessionKey;
          return { id: request.id, ok: true, data: { profiles: [workspace], activeWorkspaceId: workspace.id, activeWorkspace: workspace } };
        }
        const key = String((payload.params as { sessionKey?: string } | undefined)?.sessionKey ?? payload.sessionKey ?? 'agent:main:main');
        if ((request.module === 'gateway' && request.action === 'rpc' && payload.method === 'chat.history')
          || (request.module === 'sessions' && request.action === 'history')) {
          calls.push(key);
          const suffix = key.split(':').at(-1)!;
          const messages = data.messages.map((message, index) => ({ ...message, id: suffix + '-' + index,
            ...(index === 199 ? { content: [{ type: 'text', text: `Answer 99 ${suffix}` }] } : {}),
            ...(index === 198 ? { details: { toolOutput: Array.from({ length: 32768 }, (_, n) => `${suffix}:${n}:` + 'v'.repeat(56)).join('') } } : {}) }));
          return { id: request.id, ok: true, data: request.module === 'gateway' ? { messages } : { success: true, messages } };
        }
        return original(event, request);
      });
    }, { messages: history(imagePath, 200), rootPath: homeDir, sessions });
    const page = await getStableWindow(app); await page.reload();
    await expect(page.getByText('Answer 99', { exact: false })).toBeAttached({ timeout: 30_000 });
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const result = await cdp.send('Performance.getMetrics');
      return result.metrics.find(metric => metric.name === 'JSHeapUsedSize')!.value; };
    const beforeHeap = await heap();
    for (const session of sessions.slice(1)) {
      const row = page.getByTestId('sidebar-session-' + session.key); await row.click();
      await expect(page.getByText('Answer 99 ' + session.key.split(':').at(-1), { exact: true })).toBeAttached();
      await expect.poll(() => app.evaluate(() => (globalThis as Record<string, unknown>).__viewportHistoryCalls as string[])).toContain(session.key);
    }
    const retainedHeap = await heap();
    await page.getByTestId('sidebar-session-' + sessionKey).click();
    await expect(page.getByText('Answer 99 main', { exact: true })).toBeAttached();
    const scroller = page.getByTestId('chat-scroll-container'); await scroller.hover();
    const samples: Array<{ durationMs: number; top: number }> = [];
    for (let index = 0; index < 12; index++) {
      const started = Date.now(); await page.mouse.wheel(0, index < 6 ? -320 : 320);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      samples.push({ durationMs: Date.now() - started, top: await scroller.evaluate(element => element.scrollTop) });
    }
    expect(new Set(samples.map(sample => sample.top)).size).toBeGreaterThan(2);
    const calls = await app.evaluate(() => (globalThis as Record<string, unknown>).__viewportHistoryCalls as string[]);
    expect(calls.filter(key => key === sessionKey).length).toBeGreaterThan(1);
    await writeFile(testInfo.outputPath('measurement.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex',
      workload: { sessions: 12, messagesPerSession: 200, toolMetadataLines: 32768, scrolls: 12, scrollDelta: 320 },
      beforeHeap, retainedHeap, heapGrowth: retainedHeap - beforeHeap, finalHeap: await heap(), calls, samples,
      limits: 'Controlled Host API history fixtures with retained large tool metadata; actual Electron renderer heap after GC and mouse scrolling.' }, null, 2));
  } finally { await closeElectronApp(app); }
});
