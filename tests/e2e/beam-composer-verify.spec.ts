/** The former border-beam flow now keeps the composer steady during a run. */
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';

const sessionKey = 'agent:main:material';
const key = (module: string, action: string) => JSON.stringify([module, action, null]);

test('composer keeps a solid surface while running and leaves slash menus reachable', async ({ launchElectronApp }, info) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789 },
      gatewayRpcByMethod: {
        'sessions.list': { sessions: [{ key: sessionKey, sessionId: 'material-generation', displayName: 'Material check' }] },
        'chat.history': { sessionKey, messages: [{ id: 'material-user', role: 'user', content: 'Keep the input clear.', timestamp: Date.now() }] },
        '*': {},
      },
      hostApi: {
        [key('agents', 'list')]: { success: true, agents: [{ id: 'main', name: 'main', canonicalSessionKey: sessionKey }], defaultAgentId: 'main' },
        [key('taskLedger', 'sessionTask')]: { success: true, task: null, children: [] },
        [key('runtimeApprovals', 'list')]: { success: true, pending: [] },
      },
    });
    await page.reload();
    const shell = page.getByTestId('chat-composer-shell');
    const input = page.getByTestId('chat-composer-input');
    await expect(input).toBeVisible();
    await expect(page.getByTestId('chat-composer-beam')).toHaveCount(0);
    const event: ChatRuntimeEvent = { type: 'run.started', sessionKey, runId: 'material-run', startedAt: Date.now(), ts: Date.now() };
    await app.evaluate(({ BrowserWindow }, value) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('chat:runtime-event', value);
    }, event);
    await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', 'running');
    await expect(page.getByTestId('chat-composer-beam')).toHaveCount(0);
    for (const dark of [true, false]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      await expect(shell).toHaveCSS('background-color', dark ? 'rgb(53, 53, 51)' : 'rgb(255, 255, 255)');
      await expect(shell).toHaveCSS('backdrop-filter', 'none');
      await expect(shell).toHaveCSS('border-radius', '16px');
      await input.fill('/');
      const menu = page.getByTestId('chat-slash-command-menu');
      await expect(menu).toBeVisible();
      expect(await menu.evaluate(element => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return Boolean(hit && element.contains(hit));
      })).toBe(true);
      await page.screenshot({ path: info.outputPath(`composer-solid-${dark ? 'dark' : 'light'}.png`) });
      await page.keyboard.press('Escape');
      await input.fill('');
    }
    expect(errors).toEqual([]);
  } finally { await closeElectronApp(app); }
});
