import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

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

test.describe('Verse Claw chat agent effort popover', () => {
  test('opens the effort popover, slides to max, and commits max', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        (globalThis as unknown as {
          __clawxEffortRequests?: Array<{ agentId?: string; effort?: string }>;
        }).__clawxEffortRequests = [];

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({
          state: 'running',
          port: 18789,
          pid: 12345,
        }));

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string, _params: unknown) => {
          if (method === 'sessions.list') {
            return {
              success: true,
              result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
            };
          }
          if (method === 'chat.history') {
            return { success: true, result: { messages: [] } };
          }
          return { success: true, result: {} };
        });

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

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

      // The effort button should be visible directly in the composer controls.
      const effortButton = page.getByTestId('chat-agent-effort-button');
      await expect(effortButton).toBeVisible();

      // Open the popover
      await effortButton.click();
      await expect(page.getByTestId('chat-agent-effort-popover')).toBeVisible();

      // The slider should have 7 stops (0..6)
      const slider = page.getByTestId('chat-agent-effort-slider');
      await expect(slider).toHaveAttribute('min', '0');
      await expect(slider).toHaveAttribute('max', '6');

      // Slide to max (index 6)
      await slider.fill('6');

      // Max is a first-class persisted effort value in the shared agent contract.
      await expect.poll(async () => {
        return await app.evaluate(() => {
          const requests = (globalThis as unknown as {
            __clawxEffortRequests?: Array<{ agentId?: string; effort?: string }>;
          }).__clawxEffortRequests ?? [];
          return requests.at(-1)?.effort;
        });
      }).toBe('max');

      // Close popover with Escape
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('chat-agent-effort-popover')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('renders a theme-aware rounded effort popover', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345 }));

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string) => {
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] } };
          }
          if (method === 'chat.history') return { success: true, result: { messages: [] } };
          return { success: true, result: {} };
        });

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

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

      // Open the effort popover
      await page.getByTestId('chat-agent-effort-button').click();
      const popover = page.getByTestId('chat-agent-effort-popover');
      await expect(popover).toBeVisible();

      const cardBg = await popover.locator('.effort-card').evaluate((el) => {
        return window.getComputedStyle(el).backgroundColor;
      });
      expect(cardBg).not.toBe('rgb(0, 0, 0)');

      const clipPathCount = await popover.locator('clipPath').count();
      expect(clipPathCount).toBe(2);

      const radius = await popover.locator('.effort-card').evaluate((el) => {
        return window.getComputedStyle(el).borderRadius;
      });
      expect(radius).not.toBe('0px');
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

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345 }));

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string) => {
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] } };
          }
          if (method === 'chat.history') return { success: true, result: { messages: [] } };
          return { success: true, result: {} };
        });

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
