import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const WORKSPACE_ID = 'workspace-secret';
const SECRET_TEXT = 'here is a key sk-' + 'a'.repeat(24) + ' ok';

const workspace = {
  id: WORKSPACE_ID,
  name: 'Secret Workspace',
  rootPath: '/tmp/secret-workspace',
  agentId: 'main',
  activeSessionKey: SESSION_KEY,
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: {},
};

test.describe('Verse Claw secret-shaped content highlighting', () => {
  test('composer highlights secret-shaped text and shows dismissible advisory', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
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
          [stableStringify(['gateway', 'status', null])]: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'main' }] } },
          },
          [stableStringify(['/api/workspaces', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, workspaces: [workspace], activeWorkspaceId: WORKSPACE_ID } },
          },
          [stableStringify(['workspaces', 'list', null])]: {
            success: true,
            profiles: [workspace],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: workspace,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            success: true,
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: workspace,
          },
        },
      });

      const page = await getStableWindow(app);
      await page.waitForLoadState('domcontentloaded');
      const composer = page.getByTestId('chat-composer-input');
      await composer.waitFor({ state: 'visible', timeout: 20000 });

      await expect(page.getByTestId('chat-composer-secret-span')).toHaveCount(0);

      await composer.fill(SECRET_TEXT);

      // Debounced (150ms) + deferred scan; allow generous headroom.
      const secretSpan = page.getByTestId('chat-composer-secret-span');
      await secretSpan.first().waitFor({ state: 'visible', timeout: 10000 });
      await expect(secretSpan.first()).toContainText('sk-');

      const advisory = page.getByTestId('chat-sensitive-advisory');
      await advisory.waitFor({ state: 'visible', timeout: 10000 });

      // Dismiss hides the advisory for the same signature.
      await page.getByTestId('chat-sensitive-advisory-dismiss').click();
      await expect(advisory).toHaveCount(0);

      // Clearing the composer removes the highlight.
      await composer.fill('');
      await expect(secretSpan).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
