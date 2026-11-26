import electronBinaryPath from 'electron';
import { resolveE2EElectronExecutable } from './fixtures/electron-executable';
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getStableWindow, installIpcMocks } from './fixtures/electron';
import { evidencePath } from './fixtures/evidence-root';

const OUT = evidencePath('reports/visual-tune');

/**
 * Visual tuning harness (not a regression test): boots the real Electron app
 * with the same minimal mocks as effort-intensity-smoke and captures
 * screenshots of the composer controls for design review.
 *
 * Unlike the shared fixture, this launch does NOT pass --disable-gpu /
 * --disable-software-rasterizer: the app itself calls
 * app.disableHardwareAcceleration(), so real users render WebGL through
 * SwiftShader — this harness replicates that path so the flame actually runs.
 */
test.describe('visual tuning screenshots', () => {
  test.skip(process.env.CLAWX_VISUAL_TUNE !== '1', 'Set CLAWX_VISUAL_TUNE=1 to capture design-review screenshots');
  test('capture composer, permission menu, slash palette, effort flame', async () => {
    test.setTimeout(180_000);
    const repoRoot = resolve(process.cwd());
    const homeDir = await mkdtemp(join(tmpdir(), 'clawx-visual-home-'));
    const userDataDir = await mkdtemp(join(tmpdir(), 'clawx-visual-data-'));
    await mkdir(userDataDir, { recursive: true });
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en' }, null, 2), 'utf-8');

    const app = await electron.launch({
      executablePath: resolveE2EElectronExecutable(String(electronBinaryPath)),
      args: ['--lang=en-US', join(repoRoot, 'dist-electron/main/index.js')],
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        APPDATA: join(homeDir, 'AppData', 'Roaming'),
        LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
        LANG: 'en_US.UTF-8',
        VERSE_CLAW_E2E: '1',
        VERSE_CLAW_E2E_SKIP_SETUP: '1',
        VERSE_CLAW_USER_DATA_DIR: userDataDir,
      },
    });

    try {
      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (_event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          const makeResponse = (data: unknown) => ({
            id: typeof request.id === 'string' ? request.id : undefined,
            ok: true,
            data,
          });
          if (request.module === 'gateway' && request.action === 'status') {
            return makeResponse({ state: 'running', port: 18789, pid: 12345, gatewayReady: true });
          }
          if (request.module === 'gateway' && request.action === 'rpc') {
            const method = typeof request.payload?.method === 'string' ? request.payload.method : '';
            if (method === 'sessions.list') {
              return makeResponse({ success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } });
            }
            if (method === 'chat.history') {
              return makeResponse({ success: true, result: { messages: [] } });
            }
            return makeResponse({ success: true, result: {} });
          }
          if (request.module === 'settings' && request.action === 'get') {
            return makeResponse({ language: 'en', setupComplete: true });
          }
          if (request.module === 'settings' && request.action === 'set') {
            return makeResponse({ success: true });
          }
          if (request.module === 'agents' && request.action === 'list') {
            return makeResponse({
              success: true,
              agents: [{
                id: 'main',
                name: 'Main',
                isDefault: true,
                modelDisplay: 'model-alpha',
                modelRef: 'custom-alpha123/model-alpha',
                overrideModelRef: 'custom-alpha123/model-alpha',
                inheritedModel: false,
                workspace: '~/.openclaw/workspace',
                agentDir: '~/.openclaw/agents/main/agent',
                mainSessionKey: 'agent:main:main',
                channelTypes: [],
                reasoningEffort: 'medium',
              }],
              defaultAgentId: 'main',
              defaultModelRef: 'custom-alpha123/model-alpha',
              configuredChannelTypes: [],
              channelOwners: {},
              channelAccountOwners: {},
            });
          }
          if (request.module === 'agents' && request.action === 'updateReasoningEffort') {
            return makeResponse({ success: true });
          }
          if (request.module === 'providers' && request.action === 'accounts') {
            const now = new Date().toISOString();
            return makeResponse([
              { id: 'alpha1234', vendorId: 'custom', label: 'Alpha', authMode: 'api_key', baseUrl: 'http://127.0.0.1:1111/v1', model: 'model-alpha', enabled: true, isDefault: true, createdAt: now, updatedAt: now },
              { id: 'beta5678', vendorId: 'custom', label: 'Beta', authMode: 'api_key', baseUrl: 'http://127.0.0.1:2222/v1', model: 'provider/model-beta', enabled: true, isDefault: false, createdAt: now, updatedAt: now },
            ]);
          }
          if (request.module === 'providers' && request.action === 'list') {
            const now = new Date().toISOString();
            return makeResponse([
              { id: 'alpha1234', type: 'custom', name: 'Alpha', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
              { id: 'beta5678', type: 'custom', name: 'Beta', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
            ]);
          }
          if (request.module === 'providers' && request.action === 'accountKeyInfo') {
            return makeResponse([{ accountId: 'alpha1234', hasKey: true }, { accountId: 'beta5678', hasKey: true }]);
          }
          if (request.module === 'providers' && request.action === 'vendors') return makeResponse([]);
          if (request.module === 'providers' && request.action === 'getDefaultAccount') return makeResponse({ accountId: 'alpha1234' });
          if (request.module === 'workspaces' && request.action === 'list') {
            return makeResponse({
              profiles: [{
                id: 'workspace-1',
                name: 'Demo Workspace',
                rootPath: '/tmp/demo-workspace',
                agentId: 'main',
                activeSessionKey: 'agent:main:main',
                permissionMode: 'acceptEdits',
                createdAt: 1,
                updatedAt: 1,
                lastOpenedAt: 1,
                state: {},
                sessionStates: { 'agent:main:main': {} },
              }],
              activeWorkspaceId: 'workspace-1',
              activeWorkspace: {
                id: 'workspace-1',
                name: 'Demo Workspace',
                rootPath: '/tmp/demo-workspace',
                agentId: 'main',
                activeSessionKey: 'agent:main:main',
                permissionMode: 'acceptEdits',
                createdAt: 1,
                updatedAt: 1,
                lastOpenedAt: 1,
                state: {},
                sessionStates: { 'agent:main:main': {} },
              },
            });
          }
          if (request.module === 'taskLedger' && request.action === 'snapshot') {
            return makeResponse({ snapshot: { workspaceId: 'workspace-1', nodes: [], edges: [], eventsCount: 0, activeNodeIds: [], blockedNodeIds: [], reviewNodeIds: [], recentDecisions: [] } });
          }
          return makeResponse({});
        });
      });

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpcByMethod: {
          'sessions.list': { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } },
          'chat.history': { success: true, result: { messages: [] } },
          '*': { success: true, result: {} },
        },
      });
      const page = await getStableWindow(app);
      page.on('console', (msg) => {
        if (msg.text().includes('[fire]')) console.log('RENDERER:', msg.text());
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(600);

      // 1. Full chat page
      await page.screenshot({ path: `${OUT}/01-chat-page.png` });

      const projectTrigger = page.getByTestId('welcome-project-trigger');
      if (await projectTrigger.count()) {
        await projectTrigger.click();
        await expect(page.getByTestId('welcome-project-menu')).toBeVisible();
        await page.screenshot({ path: `${OUT}/01a-project-menu.png` });
        await page.keyboard.press('Escape');
      }

      const branchTrigger = page.getByTestId('welcome-branch-trigger');
      if (await branchTrigger.count()) {
        await branchTrigger.click();
        await expect(page.getByTestId('welcome-branch-menu')).toBeVisible();
        await page.screenshot({ path: `${OUT}/01b-branch-menu.png` });
        await page.keyboard.press('Escape');
      }

      // 2. Plus button + composer close-up
      const composer = page.getByTestId('chat-composer-input');
      const composerBox = await composer.boundingBox();
      if (composerBox) {
        await page.screenshot({
          path: `${OUT}/02-composer.png`,
          clip: {
            x: Math.max(0, composerBox.x - 24),
            y: Math.max(0, composerBox.y - 24),
            width: Math.min(1440, composerBox.width + 48),
            height: Math.min(900 - composerBox.y + 24, composerBox.height + 120),
          },
        });
      }

      // 3. Permission mode menu
      const permBtn = page.getByTestId('chat-composer-permission-mode');
      if (await permBtn.count()) {
        await permBtn.click();
        await expect(page.getByTestId('chat-composer-permission-menu')).toBeVisible();
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${OUT}/03-permission-menu.png` });
        await page.keyboard.press('Escape');
      }

      const knowledgeButton = page.getByTestId('chat-knowledge-scope-button');
      if (await knowledgeButton.count()) {
        await knowledgeButton.click();
        await expect(page.getByTestId('chat-knowledge-scope-menu')).toBeVisible();
        await page.screenshot({ path: `${OUT}/03a-knowledge-menu.png` });
        await page.keyboard.press('Escape');
      }

      const modelButton = page.getByTestId('chat-model-picker-button');
      if (await modelButton.count()) {
        await modelButton.click();
        await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();
        await page.screenshot({ path: `${OUT}/03b-model-menu.png` });
        await page.keyboard.press('Escape');
      }

      // 4. Slash palette
      await composer.click();
      await page.keyboard.type('/');
      const slashMenu = page.getByTestId('chat-slash-command-menu');
      await expect(slashMenu).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/04-slash-palette.png` });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Backspace');

      // 5. Effort popover — mid then max (flame)
      // The flame is a per-frame WebGL simulation; make sure rAF is not
      // throttled by occlusion while capturing.
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.setBackgroundThrottling(false);
        win?.show();
        win?.moveTop();
        win?.focus();
      });
      await page.getByTestId('chat-model-picker-button').click();
      const popover = page.getByTestId('chat-agent-effort-popover');
      await expect(popover).toBeVisible();
      await page.waitForTimeout(300);
      await popover.screenshot({ path: `${OUT}/05-effort-medium.png` });

      const slider = page.getByTestId('chat-agent-effort-slider');
      await slider.focus();
      await page.keyboard.press('End');
      // Let the flame develop (shader eases in over ~2.5s).
      await page.waitForTimeout(2_600);
      const probe = await page.evaluate(() => new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n += 1;
          if (performance.now() - t0 < 1000) requestAnimationFrame(tick);
          else {
            const canvases = Array.from(document.querySelectorAll('[data-testid="chat-agent-effort-fire"]')) as HTMLCanvasElement[];
            res({
              fps: n,
              dpr: window.devicePixelRatio,
              hasRO: 'ResizeObserver' in window,
              canvases: canvases.map((c) => {
                const r = c.getBoundingClientRect();
                return { w: c.width, h: c.height, cssW: r.width, cssH: r.height, opacity: getComputedStyle(c).opacity };
              }),
            });
          }
        };
        requestAnimationFrame(tick);
      }));
      console.log('FLAME PROBE:', JSON.stringify(probe));
      await popover.screenshot({ path: `${OUT}/06-effort-max-flame.png` });
      await page.screenshot({ path: `${OUT}/07-effort-max-context.png` });
    } finally {
      await app.close().catch(() => {});
    }
  });
});
