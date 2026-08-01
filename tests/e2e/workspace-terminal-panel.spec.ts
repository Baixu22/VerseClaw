import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-1';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const workspace = {
  id: WORKSPACE_ID,
  name: 'Demo Workspace',
  rootPath: '/workspace/demo',
  permissionMode: 'readOnly',
  activeSessionKey: SESSION_KEY,
  state: {},
  sessionStates: {},
};

const runnableWorkspace = {
  ...workspace,
  permissionMode: 'acceptEdits',
};

test.describe('Workspace terminal panel', () => {
  test('renders compact terminal chrome and permission block state', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
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
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            agents: [{
              id: 'main',
              name: 'Main',
              isDefault: true,
              workspace: '/workspace/demo',
              mainSessionKey: SESSION_KEY,
              channelTypes: [],
            }],
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [workspace],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: workspace,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: workspace,
          },
          [stableStringify(['workspaces', 'saveState', {
            id: WORKSPACE_ID,
            sessionKey: SESSION_KEY,
            state: { artifactPanel: { workspaceView: 'terminal' } },
          }])]: { success: true },
          [stableStringify(['terminal', 'status', { workspaceId: WORKSPACE_ID, sessionKey: SESSION_KEY }])]: {
            success: true,
            status: 'idle',
            sessionId: null,
          },
          [stableStringify(['git', 'status', null])]: {
            ok: true,
            status: {
              isRepository: false,
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const workspaceToggle = page.getByTestId('chat-workspace-toggle');
      await expect(workspaceToggle).toBeVisible({ timeout: 30_000 });
      await expect(workspaceToggle).toBeEnabled({ timeout: 30_000 });
      await workspaceToggle.click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible();
      await expect(sidePanel.getByTestId('artifact-panel-tab-files')).toBeVisible();
      await sidePanel.getByTestId('artifact-panel-new-tab').click();
      await expect(page.getByTestId('artifact-panel-new-tab-review')).toBeVisible();
      await expect(page.getByTestId('artifact-panel-new-tab-browser')).toBeVisible();
      await expect(page.getByTestId('artifact-panel-new-tab-audit')).toBeVisible();
      await page.getByTestId('artifact-panel-new-tab-terminal').click();

      await expect(sidePanel.getByTestId('workspace-terminal-panel')).toBeVisible();
      await expect(sidePanel.getByText('/workspace/demo').first()).toBeVisible();
      await expect(sidePanel.getByText('Interactive terminal is disabled in this permission mode')).toBeVisible();
      await expect(sidePanel.getByRole('button', { name: 'Start' })).toBeDisabled();
      await expect(sidePanel.locator('.xterm')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('starts a live workspace terminal from the launcher', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
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
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            agents: [{
              id: 'main',
              name: 'Main',
              isDefault: true,
              workspace: '/workspace/demo',
              mainSessionKey: SESSION_KEY,
              channelTypes: [],
            }],
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [runnableWorkspace],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: runnableWorkspace,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: runnableWorkspace,
          },
          [stableStringify(['workspaces', 'saveState', {
            id: WORKSPACE_ID,
            sessionKey: SESSION_KEY,
            state: { artifactPanel: { workspaceView: 'terminal' } },
          }])]: { success: true },
          [stableStringify(['workspaces', 'saveState', null])]: { success: true },
          [stableStringify(['terminal', 'status', { workspaceId: WORKSPACE_ID, sessionKey: SESSION_KEY }])]: {
            success: true,
            status: 'idle',
            sessionId: null,
          },
          [stableStringify(['terminal', 'open', null])]: {
            success: true,
            blocked: false,
            status: 'running',
            sessionId: 'terminal-1',
            cwd: '/workspace/demo',
            cols: 80,
            rows: 24,
            pid: 1234,
          },
          [stableStringify(['git', 'status', null])]: {
            ok: true,
            status: {
              isRepository: false,
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const workspaceToggle = page.getByTestId('chat-workspace-toggle');
      await expect(workspaceToggle).toBeVisible({ timeout: 30_000 });
      await workspaceToggle.click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel.getByTestId('artifact-panel-tab-files')).toBeVisible();
      await sidePanel.getByTestId('artifact-panel-new-tab').click();
      await page.getByTestId('artifact-panel-new-tab-terminal').click();
      await expect(sidePanel.getByRole('button', { name: 'Start' })).toBeEnabled();
      await sidePanel.getByRole('button', { name: 'Start' }).click();

      await expect.poll(async () => app.evaluate(() => {
        const calls = (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> }).__verseClawE2eHostCalls ?? [];
        return calls.some((call) => call.module === 'terminal' && call.action === 'open');
      })).toBe(true);
      await expect(sidePanel.getByText('Running').first()).toBeVisible();

      const terminalOpenCalls = () => app.evaluate(() => (
        (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> }).__verseClawE2eHostCalls ?? []
      ).filter((call) => call.module === 'terminal' && call.action === 'open').length);
      await expect(terminalOpenCalls).resolves.toBe(1);
      await expect(sidePanel).toHaveAttribute('data-terminal-placement', 'side');
      await sidePanel.getByTestId('artifact-panel-terminal-placement').click();
      await expect(sidePanel).toHaveAttribute('data-terminal-placement', 'bottom');
      await sidePanel.getByTestId('artifact-panel-terminal-placement').click();
      await expect(sidePanel).toHaveAttribute('data-terminal-placement', 'side');
      await expect(terminalOpenCalls).resolves.toBe(1);

      await sidePanel.getByTestId('artifact-panel-tab-close-terminal').click();
      await expect(sidePanel.getByTestId('workspace-terminal-panel')).toHaveCount(0);
      await expect(sidePanel.getByTestId('artifact-panel-tab-files')).toBeVisible();
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> }).__verseClawE2eHostCalls ?? []
      ).filter((call) => call.module === 'terminal' && call.action === 'close').length)).toBe(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
