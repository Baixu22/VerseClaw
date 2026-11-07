import { writeFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const sessionKey = 'agent:main:main';
const events = 240;
const chunk = (index: number) => `word${String(index).padStart(3, '0')} `;
const finalText = Array.from({ length: events }, (_, index) => chunk(index + 1)).join('');
type Probe = { recording: boolean; commits: number; longTasks: number[]; inputLatencies: number[]; keydowns: number };

for (const language of ['en', 'zh', 'ja', 'ru']) {
  test(`stream publication retains input and scrolling (${language})`, async ({ launchElectronApp }, testInfo) => {
    test.setTimeout(120_000);
    const runId = 'publication-' + language;
    const history = Array.from({ length: 40 }, (_, index) => [
      { id: `history-user-${index}`, role: 'user', content: `Historical request ${index}`, timestamp: 1700000000000 + index * 1000 },
      { id: `history-answer-${index}`, role: 'assistant', content: `Historical reply ${index}\n\n${'- Stable completed paragraph with **markdown** and `code`.\n'.repeat(4)}`, timestamp: 1700000000500 + index * 1000 },
    ]).flat();
    const app = await launchElectronApp({ skipSetup: true });
    const mocks = (messages: typeof history) => ({
      gatewayStatus: { state: 'running', port: 18789, gatewayReady: true },
      gatewayRpcByMethod: {
        'sessions.list': { sessions: [{ key: sessionKey, displayName: 'Publication test' }] },
        'chat.history': { messages }, 'chat.send': { runId }, 'chat.abort': {},
      },
      hostApi: {
        [JSON.stringify(['settings', 'getAll', null])]: { language, theme: 'light' },
        [JSON.stringify(['agents', 'list', null])]: { success: true, agents: [{ id: 'main', name: 'Main' }] },
        [JSON.stringify(['providers', 'accounts', null])]: [{ id: 'fixture', vendorId: 'anthropic', label: 'Fixture',
          authMode: 'api_key', model: 'fixture-model', enabled: true, isDefault: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
        [JSON.stringify(['providers', 'accountKeyInfo', null])]: [{ accountId: 'fixture', hasKey: true, keyMasked: 'fixture' }],
        [JSON.stringify(['providers', 'vendors', null])]: [],
        [JSON.stringify(['providers', 'getDefaultAccount', null])]: { accountId: 'fixture' },
        [JSON.stringify(['chat', 'sendWithMedia', null])]: { success: true, result: { runId } },
      },
    });
    try {
      await installIpcMocks(app, mocks(history));
      const page = await getStableWindow(app);
      await page.addInitScript(() => {
        const probe: Probe = { recording: false, commits: 0, longTasks: [], inputLatencies: [], keydowns: 0 };
        const target = window as unknown as { __tf0833: Probe; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
        target.__tf0833 = probe;
        target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, inject: () => 1,
          onCommitFiberRoot: () => { if (probe.recording) probe.commits++; } };
        new PerformanceObserver(list => {
          if (probe.recording) probe.longTasks.push(...list.getEntries().map(entry => entry.duration));
        }).observe({ type: 'longtask', buffered: true });
        window.addEventListener('keydown', () => {
          if (!probe.recording) return;
          const at = performance.now(); probe.keydowns++;
          requestAnimationFrame(() => probe.inputLatencies.push(performance.now() - at));
        }, true);
      });
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      const input = page.getByTestId('chat-composer-input');
      await expect(input).toBeEnabled({ timeout: 30_000 });
      await expect(page.getByText('Historical reply 39', { exact: false })).toBeVisible();
      await input.fill('Stream the measured response');
      await page.getByTestId('chat-composer-send').click();
      await app.evaluate(({ BrowserWindow }, identity) => {
        for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:runtime-event', { ...identity, type: 'run.started', seq: 0, startedAt: Date.now() });
      }, { sessionKey, runId });
      await page.evaluate(() => { (window as unknown as { __tf0833: Probe }).__tf0833.recording = true; });
      await app.evaluate(({ BrowserWindow }, data) => {
        let index = 0;
        const timer = setInterval(() => {
          index++;
          const event = { sessionKey: data.sessionKey, runId: data.runId, type: 'assistant.delta', seq: index,
            delta: `word${String(index).padStart(3, '0')} ` };
          for (const win of BrowserWindow.getAllWindows()) win.webContents.send('chat:runtime-event', event);
          if (index === data.events) clearInterval(timer);
        }, 4);
      }, { sessionKey, runId, events });
      const scroll = page.getByTestId('chat-scroll-container');
      const scrollBefore = await scroll.evaluate(element => element.scrollTop);
      await scroll.hover(); await page.mouse.wheel(0, -450);
      await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeLessThan(scrollBefore - 20);
      const scrollAfter = await scroll.evaluate(element => element.scrollTop);
      await input.click(); await input.pressSequentially('next question', { delay: 8 });
      await expect(input).toHaveValue('next question');
      await expect(page.getByText('word240', { exact: false })).toBeAttached();
      const rendered = await page.getByText('word240', { exact: false }).last().innerText();
      expect(rendered.trim()).toBe(finalText.trim());
      const sample = await page.evaluate(async () => {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const probe = (window as unknown as { __tf0833: Probe }).__tf0833;
        probe.recording = false; return probe;
      });
      expect(sample.commits).toBeGreaterThan(0); expect(sample.keydowns).toBeGreaterThan(0);
      expect(sample.inputLatencies.length).toBeGreaterThan(0);
      await installIpcMocks(app, mocks([...history,
        { id: 'measured-user', role: 'user', content: 'Stream the measured response', timestamp: Date.now() },
        { id: 'measured-final', role: 'assistant', content: finalText, timestamp: Date.now() },
      ]));
      await app.evaluate(({ BrowserWindow }, data) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', { sessionKey: data.sessionKey, runId: data.runId, type: 'run.ended', seq: data.events + 1, status: 'completed', endedAt: Date.now() });
          win.webContents.send('gateway:chat-message', { sessionKey: data.sessionKey, runId: data.runId, state: 'final',
            message: { id: 'measured-final', role: 'assistant', content: data.finalText } });
        }
      }, { sessionKey, runId, events, finalText });
      await expect(input).toBeEnabled(); await expect(input).toHaveValue('next question');
      await page.screenshot({ path: testInfo.outputPath('stream-' + language + '.png') });
      await writeFile(testInfo.outputPath('measurement.json'), JSON.stringify({ driven_by: 'agent', actor: 'codex', language,
        workload: { historyMessages: history.length, events, intervalMs: 4, expectedText: finalText },
        metricSource: 'React DevTools commit callback, native renderer PerformanceObserver and keyboard-to-next-frame latency',
        inputRetained: true, scrollBefore, scrollAfter, finalTextCorrect: true, sample }, null, 2));
    } finally { await closeElectronApp(app); }
  });
}
