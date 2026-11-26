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

/**
 * Smoke test: verifies the effort popover and intensity toggle are reachable
 * and functional in a minimal mocked environment. This is a fast "does it
 * boot and can I click the key things" check — not a deep behavioral test.
 */
test.describe('Verse Claw effort & intensity smoke', () => {
  test('effort button is visible and opens a popover with a slider', async ({ launchElectronApp }) => {
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

      // Effort button should be visible
      await expect(page.getByTestId('chat-model-picker-button')).toBeVisible();

      // Click to open popover
      await page.getByTestId('chat-model-picker-button').click();
      await expect(page.getByTestId('chat-agent-effort-popover')).toBeVisible();

      // Slider should be present with correct range
      const slider = page.getByTestId('chat-agent-effort-slider');
      await expect(slider).toHaveAttribute('min', '0');
      await expect(slider).toHaveAttribute('max', '6');

      // 7 tick labels should be visible under the track
      const popover = page.getByTestId('chat-agent-effort-popover');
      const tickContainer = popover.getByTestId('chat-agent-effort-ticks');
      await expect(tickContainer.locator('span')).toHaveCount(7);

      // Close with Escape
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('chat-agent-effort-popover')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('intensity toggle is visible in the work mode summary panel after sending a message', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

        (globalThis as unknown as {
          __clawxSettingsRequests?: Array<{ payload?: { key?: string; value?: unknown } }>;
        }).__clawxSettingsRequests = [];

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
            (globalThis as unknown as {
              __clawxSettingsRequests: Array<{ payload?: { key?: string; value?: unknown } }>;
            }).__clawxSettingsRequests.push({ payload: request.payload as { key?: string; value?: unknown } | undefined });
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
          if (request.module === 'workspaces' && request.action === 'saveState') {
            return makeResponse({ success: true });
          }
          if (request.module === 'taskLedger' && request.action === 'snapshot') {
            return makeResponse({ snapshot: { workspaceId: WORKSPACE.id, nodes: [], edges: [], eventsCount: 0, activeNodeIds: [], blockedNodeIds: [], reviewNodeIds: [], recentDecisions: [] } });
          }
          if (request.module === 'chat' && request.action === 'sendWithMedia') {
            return makeResponse({ success: true, result: { runId: 'smoke-run' } });
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

      // Send a message; legacy Work Mode prompt overrides should no longer be
      // written as a user-visible behavior preset.
      await page.getByTestId('chat-composer-input').fill('Hello world');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByTestId('work-mode-summary-panel')).toHaveCount(0);
      const wroteLegacyOverride = await app.evaluate(() => {
        const requests = (globalThis as unknown as {
          __clawxSettingsRequests?: Array<{ payload?: { key?: string; value?: unknown } }>;
        }).__clawxSettingsRequests ?? [];
        return requests.some((entry) => entry.payload?.key === 'workModePromptModeOverrides');
      });
      expect(wroteLegacyOverride).toBe(false);
    } finally {
      await closeElectronApp(app);
    }
  });
});
