import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import type { ElectronApplication } from '@playwright/test';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

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
  sessionStates: {
    [SESSION_KEY]: {},
  },
};

const WORKSPACE_SNAPSHOT = {
  profiles: [WORKSPACE],
  activeWorkspaceId: WORKSPACE.id,
  activeWorkspace: WORKSPACE,
};

async function installHostInvokeRecorder(app: ElectronApplication) {
  await app.evaluate(async () => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: Record<string, unknown>) => Promise<unknown>>;
    })._invokeHandlers;
    const previous = handlers?.get('host:invoke');
    if (!previous) return;
    (globalThis as unknown as {
      __clawxWorkModeRequests?: Array<Record<string, unknown>>;
      __clawxSettingsRequests?: Array<Record<string, unknown>>;
      __clawxLastChatPayload?: unknown;
    }).__clawxWorkModeRequests = [];
    (globalThis as unknown as {
      __clawxSettingsRequests?: Array<Record<string, unknown>>;
    }).__clawxSettingsRequests = [];
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: Record<string, unknown>) => {
      const module = request.module;
      const action = request.action;
      const payload = request.payload as Record<string, unknown> | undefined;
      if (module === 'workspaces' && action === 'saveState') {
        (globalThis as unknown as { __clawxWorkModeRequests: Array<Record<string, unknown>> }).__clawxWorkModeRequests.push({
          module,
          action,
          payload,
        });
        return { id: request.id as string | undefined, ok: true, data: { success: true } };
      }
      if (module === 'settings' && action === 'set') {
        (globalThis as unknown as { __clawxSettingsRequests: Array<Record<string, unknown>> }).__clawxSettingsRequests.push({
          module,
          action,
          payload,
        });
        return { id: request.id as string | undefined, ok: true, data: { success: true } };
      }
      if (module === 'chat' && action === 'sendWithMedia') {
        (globalThis as unknown as { __clawxLastChatPayload?: unknown }).__clawxLastChatPayload = payload;
        return { id: request.id as string | undefined, ok: true, data: { success: true, result: { runId: 'run-work-mode' } } };
      }
      return previous(event, request);
    });
  });
}

async function openChatFromNativeMenu(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const menu = Menu.getApplicationMenu();
    const findMenuItem = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (item.id === 'new-chat') return item;
        const child = item.submenu ? findMenuItem(item.submenu.items) : undefined;
        if (child) return child;
      }
      return undefined;
    };
    const newChatItem = menu ? findMenuItem(menu.items) : undefined;
    newChatItem?.click(undefined, BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], undefined);
  });
}

test.describe('ClawX chat work mode', () => {
  test('switches work modes without changing permission mode and sends selected workMode', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345 },
            },
          },
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { language: 'en', setupComplete: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
          [stableStringify(['workspaces', 'list', null])]: WORKSPACE_SNAPSHOT,
          [stableStringify(['/api/skills/quick-access', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, skills: [] },
            },
          },
        },
      });
      await installHostInvokeRecorder(app);

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-work-mode-button')).toHaveCount(0);

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-work-modes-section')).toBeVisible();
      await page.getByTestId('settings-work-mode-plan').click();
      await page.getByTestId('settings-work-mode-kit-docsData-sheets').click();

      const savedWorkKitConfig = await app.evaluate(() => {
        const requests = (globalThis as unknown as { __clawxSettingsRequests?: Array<{ payload?: { key?: string; value?: { docsData?: string[] } } }> }).__clawxSettingsRequests ?? [];
        return requests.some((entry) => entry.payload?.key === 'workModeKits' && !entry.payload.value?.docsData?.includes('sheets'));
      });
      expect(savedWorkKitConfig).toBe(true);

      await openChatFromNativeMenu(app);
      await expect(page.getByTestId('chat-composer-input')).toBeVisible();
      await expect(page.getByTestId('work-mode-summary-panel')).toContainText('Planning mode');

      const savedPlanMode = await app.evaluate(() => {
        const requests = (globalThis as unknown as { __clawxWorkModeRequests?: Array<{ payload?: { state?: { workMode?: string } } }> }).__clawxWorkModeRequests ?? [];
        return requests.some((entry) => entry.payload?.state?.workMode === 'plan');
      });
      expect(savedPlanMode).toBe(true);

      await page.getByTestId('chat-composer-workspace-actions').click();
      await expect(page.getByTestId('chat-composer-permission-option-acceptEdits')).toBeVisible();
      await page.keyboard.press('Escape');

      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-work-modes-section')).toBeVisible();
      await page.getByTestId('settings-work-mode-docsData').click();
      await openChatFromNativeMenu(app);
      await expect(page.getByTestId('chat-composer-input')).toBeVisible();
      await expect(page.getByTestId('work-mode-summary-panel')).toContainText('Docs/Data mode');

      await page.getByTestId('chat-composer-input').fill('Summarize this spreadsheet');
      await page.getByTitle('Send').click();

      await expect.poll(async () => await app.evaluate(() => (
        (globalThis as unknown as { __clawxLastChatPayload?: { workMode?: string } }).__clawxLastChatPayload?.workMode
      ))).toBe('docsData');
    } finally {
      await closeElectronApp(app);
    }
  });
});
