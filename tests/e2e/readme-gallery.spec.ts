import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { closeElectronApp, expect, test } from './fixtures/electron';

// Capture the real Electron UI with isolated, unconfigured profiles. No replay,
// synthetic conversations, DOM replacement, or provider credentials are used.
for (const language of ['en', 'zh'] as const) {
  test(`README gallery: real ${language} application surfaces`, async ({ launchElectronApp, userDataDir, homeDir }) => {
    test.setTimeout(240_000);
    const gatewayPort = await new Promise<number>((done, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as { port: number }).port;
        server.close(() => done(port));
      });
    });
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language, theme: 'light', gatewayPort }));
    await mkdir(join(homeDir, '.openclaw'), { recursive: true });
    await writeFile(join(homeDir, '.openclaw', 'openclaw.json'), JSON.stringify({
      plugins: {
        load: { paths: [resolve('openclaw_runtime/extensions/memory-wiki')] },
        entries: { 'memory-wiki': { enabled: true, config: {
          vaultMode: 'isolated', vault: { path: join(homeDir, 'readme-vault') },
        } } },
      },
    }));
    const app = await launchElectronApp({ skipSetup: true, theme: 'light' });
    const output = process.env.CLAWX_README_CAPTURE_DIR;
    const captures: Array<{ file: string; route: string; state: string }> = [];
    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      const start = await page.evaluate(() => {
        if (!window.verseClaw) throw new Error('hostInvoke bridge unavailable');
        return window.verseClaw.hostInvoke({
          id: crypto.randomUUID(), module: 'gateway', action: 'start',
        });
      });
      expect(start.ok).toBe(true);
      await expect.poll(async () => page.evaluate(async () => {
        if (!window.verseClaw) throw new Error('hostInvoke bridge unavailable');
        const response = await window.verseClaw.hostInvoke<{ state: string; gatewayReady?: boolean }>({
          id: crypto.randomUUID(), module: 'gateway', action: 'status',
        });
        return response.ok && response.data?.state === 'running' && response.data.gatewayReady !== false;
      }), { timeout: 90_000 }).toBe(true);
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win.isMaximized()) win.unmaximize();
        win.setContentSize(1440, 960);
      });
      const base = new URL(page.url());
      const surfaces = [
        { name: 'chat', route: '/', testId: 'main-layout', state: 'Fresh conversation; no model account or messages' },
        { name: 'knowledge', route: '/knowledge', testId: 'knowledge-page', state: 'Empty knowledge library in an isolated profile' },
        { name: 'tasks', route: '/task-ledger', testId: 'task-ledger-page', state: 'Task Ledger without user tasks' },
        { name: 'settings', route: '/settings/models', testId: 'models-page', state: 'Model and provider settings without credentials' },
      ];
      for (const surface of surfaces) {
        const url = new URL(base);
        url.hash = surface.route;
        await page.goto(url.toString());
        await expect(page.getByTestId(surface.testId)).toBeVisible();
        await expect(page.locator('[data-testid="route-loading-shell"]')).toHaveCount(0);
        if (surface.name === 'chat') {
          await page.getByTestId('sidebar-new-chat').click();
          await expect(page.getByText(/正在加载会话记录|Loading conversation history/)).toHaveCount(0);
          await expect(page.locator('.animate-pulse')).toHaveCount(0);
        }
        if (surface.name === 'settings') {
          await expect(page.getByTestId('providers-settings')).toBeVisible();
          await expect(page.getByTestId('settings-section-loading')).toHaveCount(0);
          await expect(page.getByText(/Loading token usage history|正在加载.*用量|加载.*历史/)).toHaveCount(0);
        }
        const closeToast = page.locator('[data-sonner-toast] [data-close-button]');
        if (await closeToast.count()) await closeToast.first().click();
        await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        if (output) {
          const directory = resolve(output, language);
          await mkdir(directory, { recursive: true });
          await page.mouse.move(1435, 955);
          await page.screenshot({ path: join(directory, `${surface.name}.png`), animations: 'disabled', scale: 'css' });
          captures.push({ file: `${language}/${surface.name}.png`, route: surface.route, state: surface.state });
          await writeFile(join(directory, `${surface.name}.txt`), await page.locator('body').innerText());
        }
      }
      if (output) {
        const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
        await writeFile(join(resolve(output), language, 'capture.json'), JSON.stringify({
          driven_by: 'agent', actor: 'codex-readme', version: pkg.version,
          platform: process.platform, capturedAt: new Date().toISOString(),
          viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
          mocked: false, gateway: 'real-local-process', memoryWiki: 'explicitly enabled in isolated profile',
          paidModelCalls: false, captures,
        }, null, 2));
      }
    } finally {
      await closeElectronApp(app);
    }
  });
}
