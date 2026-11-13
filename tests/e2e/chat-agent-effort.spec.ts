import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

const WORKSPACE = {
  id: 'workspace-1',
  name: 'Demo Workspace',
  rootPath: '/tmp/demo-workspace',
  agentId: 'main',
  activeSessionKey: SESSION_KEY,
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: { [SESSION_KEY]: {} },
};

const WORKSPACE_SNAPSHOT = {
  profiles: [WORKSPACE],
  activeWorkspaceId: WORKSPACE.id,
  activeWorkspace: WORKSPACE,
};

test.describe('Verse Claw combined model and reasoning settings', () => {
  test('opens the reasoning section in the shared menu, slides to max, and commits max', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        (globalThis as unknown as {
          __clawxEffortRequests?: Array<{ agentId?: string; effort?: string }>;
        }).__clawxEffortRequests = [];

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
              return makeResponse({ success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] } });
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
                modelDisplay: 'test/model',
                modelRef: 'test/model',
                overrideModelRef: 'test/model',
                inheritedModel: false,
                workspace: '~/.openclaw/workspace',
                agentDir: '~/.openclaw/agents/main/agent',
                mainSessionKey: SESSION_KEY,
                channelTypes: [],
                reasoningEffort: 'high',
              }],
              defaultAgentId: 'main',
              defaultModelRef: 'test/model',
              configuredChannelTypes: [],
              channelOwners: {},
              channelAccountOwners: {},
            });
          }
          if (request.module === 'agents' && request.action === 'updateReasoningEffort') {
            (globalThis as unknown as {
              __clawxEffortRequests: Array<{ agentId?: string; effort?: string }>;
            }).__clawxEffortRequests.push({
              agentId: request.payload?.agentId as string | undefined,
              effort: request.payload?.reasoningEffort as string | undefined,
            });
            return makeResponse({
              success: true,
              agents: [{
                id: 'main', name: 'Main', modelRef: 'test/model', modelDisplay: 'test/model',
                mainSessionKey: 'agent:main:main', reasoningEffort: request.payload?.reasoningEffort,
                channelTypes: [],
              }],
              defaultAgentId: 'main', defaultModelRef: 'test/model',
              configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {},
            });
          }
          if (request.module === 'workspaces' && request.action === 'list') {
            return makeResponse(WORKSPACE_SNAPSHOT);
          }
          if (request.module === 'taskLedger' && request.action === 'snapshot') {
            return makeResponse({
              snapshot: {
                workspaceId: WORKSPACE.id,
                nodes: [],
                edges: [],
                eventsCount: 0,
                activeNodeIds: [],
                blockedNodeIds: [],
                reviewNodeIds: [],
                recentDecisions: [],
              },
            });
          }
          return makeResponse({});
        });
      });

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpcByMethod: {
          'sessions.list': { success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] } },
          'chat.history': { success: true, result: { messages: [] } },
          '*': { success: true, result: {} },
        },
      });
      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

      // The flame shortcut opens the reasoning section of the same menu that
      // contains model selection.
      const effortButton = page.getByTestId('chat-agent-effort-button');
      await expect(effortButton).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-button')).toBeVisible();

      // Open the shared menu directly to its reasoning section.
      await effortButton.click();
      await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();
      await expect(page.getByTestId('chat-model-scope-selector')).toHaveCount(0);
      await expect(page.getByTestId('chat-agent-effort-popover')).toBeVisible();

      // The slider should have 7 stops (0..6)
      const slider = page.getByTestId('chat-agent-effort-slider');
      await expect(slider).toHaveAttribute('min', '0');
      await expect(slider).toHaveAttribute('max', '6');

      // Slide to max (index 6)
      await slider.fill('6');
      await slider.dispatchEvent('pointerup');

      // Max is a first-class persisted effort value in the shared agent contract.
      await expect.poll(async () => {
        return await app.evaluate(() => {
          const requests = (globalThis as unknown as {
            __clawxEffortRequests?: Array<{ agentId?: string; effort?: string }>;
          }).__clawxEffortRequests ?? [];
          return requests.at(-1)?.effort;
        });
      }).toBe('max');

      const effortScreenshotPath = testInfo.outputPath('combined-effort-max.png');
      await page.screenshot({ path: effortScreenshotPath, animations: 'disabled' });
      await testInfo.attach('combined-effort-max', {
        path: effortScreenshotPath,
        contentType: 'image/png',
      });

      // Escape closes the whole shared menu.
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('chat-agent-effort-popover')).toHaveCount(0);

      await page.getByTestId('chat-model-picker-button').click();
      const settingsMenu = page.getByTestId('chat-model-picker-menu');
      await expect(settingsMenu).toBeVisible();
      const settingRows = settingsMenu.locator('.codex-execution-settings__row');
      await expect(settingRows).toHaveCount(1);
      await expect(page.getByTestId('chat-model-options')).toBeVisible();
      const screenshotPath = testInfo.outputPath('combined-model-effort-menu.png');
      await page.screenshot({ path: screenshotPath, animations: 'disabled' });
      await testInfo.attach('combined-model-effort-menu', {
        path: screenshotPath,
        contentType: 'image/png',
      });
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps the reasoning slider inside the shared dropdown surface', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

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
              return makeResponse({ success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] } });
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
                modelDisplay: 'test/model',
                modelRef: 'test/model',
                overrideModelRef: 'test/model',
                inheritedModel: false,
                workspace: '~/.openclaw/workspace',
                agentDir: '~/.openclaw/agents/main/agent',
                mainSessionKey: SESSION_KEY,
                channelTypes: [],
                reasoningEffort: 'medium',
              }],
              defaultAgentId: 'main',
              defaultModelRef: 'test/model',
              configuredChannelTypes: [],
              channelOwners: {},
              channelAccountOwners: {},
            });
          }
          if (request.module === 'agents' && request.action === 'updateReasoningEffort') {
            return makeResponse({ success: true });
          }
          if (request.module === 'workspaces' && request.action === 'list') {
            return makeResponse(WORKSPACE_SNAPSHOT);
          }
          if (request.module === 'taskLedger' && request.action === 'snapshot') {
            return makeResponse({ snapshot: { workspaceId: WORKSPACE.id, nodes: [], edges: [], eventsCount: 0, activeNodeIds: [], blockedNodeIds: [], reviewNodeIds: [], recentDecisions: [] } });
          }
          return makeResponse({});
        });
      });

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpcByMethod: {
          'sessions.list': { success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] } },
          'chat.history': { success: true, result: { messages: [] } },
          '*': { success: true, result: {} },
        },
      });
      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

      // Open the inline reasoning section.
      await page.getByTestId('chat-agent-effort-button').click();
      const popover = page.getByTestId('chat-agent-effort-popover');
      await expect(popover).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-menu')).toBeVisible();

      const surface = page.getByTestId('chat-model-picker-menu');
      const surfaceBg = await surface.evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor;
      });
      expect(surfaceBg).not.toBe('rgb(0, 0, 0)');

      const clipPathCount = await popover.locator('clipPath').count();
      expect(clipPathCount).toBe(1);

      const slider = page.getByTestId('chat-agent-effort-slider');
      await expect(slider).toHaveAttribute('step', '0.05');
      const trackMetrics = await page.evaluate(() => {
        const root = document.documentElement;
        const track = document.querySelector<HTMLElement>('[data-testid="chat-agent-effort-track"]')!;
        const surface = track.querySelector<HTMLElement>('.effort-track-surface')!;
        const hadLight = root.classList.contains('light');
        const hadDark = root.classList.contains('dark');
        const readTheme = (theme: 'light' | 'dark') => {
          root.classList.remove('light', 'dark');
          root.classList.add(theme);
          const style = getComputedStyle(track);
          return {
            background: getComputedStyle(surface).backgroundColor,
            borderRadius: style.borderRadius,
            clipPath: style.clipPath,
            height: style.height,
            thumbSize: style.getPropertyValue('--effort-thumb-size').trim(),
          };
        };
        const light = readTheme('light');
        const dark = readTheme('dark');
        root.classList.remove('light', 'dark');
        if (hadLight) root.classList.add('light');
        if (hadDark) root.classList.add('dark');
        return { light, dark };
      });
      expect(trackMetrics.light.background).not.toBe(trackMetrics.dark.background);
      expect(trackMetrics.light.background).not.toMatch(/rgb\((?:0|12), (?:0|12), (?:0|12)\)/);
      expect(trackMetrics.dark.background).not.toMatch(/rgb\((?:0|12), (?:0|12), (?:0|12)\)/);
      expect(trackMetrics.light).toMatchObject({ borderRadius: '9999px', clipPath: 'none', height: '28px', thumbSize: '24px' });
      expect(trackMetrics.dark).toMatchObject({ borderRadius: '9999px', clipPath: 'none', height: '28px', thumbSize: '24px' });

      const card = popover.locator('.effort-card');
      await expect(card).toHaveClass(/effort-card--inline/);
      const boxShadow = await card.evaluate((el) => {
        return window.getComputedStyle(el).boxShadow;
      });
      expect(boxShadow).toBe('none');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not commit when slider stays at the current value', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        (globalThis as unknown as {
          __clawxEffortRequests?: Array<{ agentId?: string; effort?: string }>;
        }).__clawxEffortRequests = [];

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
              return makeResponse({ success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] } });
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
                modelDisplay: 'test/model',
                modelRef: 'test/model',
                overrideModelRef: 'test/model',
                inheritedModel: false,
                workspace: '~/.openclaw/workspace',
                agentDir: '~/.openclaw/agents/main/agent',
                mainSessionKey: SESSION_KEY,
                channelTypes: [],
                reasoningEffort: 'high',
              }],
              defaultAgentId: 'main',
              defaultModelRef: 'test/model',
              configuredChannelTypes: [],
              channelOwners: {},
              channelAccountOwners: {},
            });
          }
          if (request.module === 'agents' && request.action === 'updateReasoningEffort') {
            (globalThis as unknown as {
              __clawxEffortRequests: Array<{ agentId?: string; effort?: string }>;
            }).__clawxEffortRequests.push({
              agentId: request.payload?.agentId as string | undefined,
              effort: request.payload?.reasoningEffort as string | undefined,
            });
            return makeResponse({ success: true });
          }
          if (request.module === 'workspaces' && request.action === 'list') {
            return makeResponse(WORKSPACE_SNAPSHOT);
          }
          if (request.module === 'taskLedger' && request.action === 'snapshot') {
            return makeResponse({ snapshot: { workspaceId: WORKSPACE.id, nodes: [], edges: [], eventsCount: 0, activeNodeIds: [], blockedNodeIds: [], reviewNodeIds: [], recentDecisions: [] } });
          }
          return makeResponse({});
        });
      });

      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpcByMethod: {
          'sessions.list': { success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] } },
          'chat.history': { success: true, result: { messages: [] } },
          '*': { success: true, result: {} },
        },
      });
      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-agent-effort-button').click();
      await expect(page.getByTestId('chat-agent-effort-popover')).toBeVisible();

      // If the agent snapshot is still settling, the popover falls back to auto.
      // Setting the current value should not commit.
      const slider = page.getByTestId('chat-agent-effort-slider');
      await slider.fill('0');

      // Wait briefly to ensure no async commit fires
      await page.waitForTimeout(500);

      const effortCalls = await app.evaluate(() => {
        return (globalThis as unknown as {
          __clawxEffortRequests?: Array<{ agentId?: string; effort?: string }>;
        }).__clawxEffortRequests ?? [];
      });
      expect(effortCalls.length).toBe(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
