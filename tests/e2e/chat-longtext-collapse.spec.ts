import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-longtext';

const LONG_TEXT = Array.from({ length: 20 }, (_, index) => `pasted line ${index + 1}`).join('\n');

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
  name: 'Long Text Workspace',
  rootPath: '/tmp/longtext-workspace',
  agentId: 'main',
  activeSessionKey: SESSION_KEY,
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: {},
};

test.describe('Verse Claw composer long-text collapse', () => {
  test('long paste collapses into a chip with expand and dismiss', async ({ launchElectronApp }) => {
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

      // Dispatch a real ClipboardEvent so React's onPaste sees clipboardData.
      await page.evaluate((longText) => {
        const textarea = document.querySelector('[data-testid="chat-composer-input"]') as HTMLTextAreaElement;
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', longText);
        textarea.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        }));
      }, LONG_TEXT);

      const chip = page.getByTestId('chat-composer-collapse-chip');
      await chip.waitFor({ state: 'visible', timeout: 5000 });
      await expect(chip).toContainText('pasted line 1');
      await expect(composer).toHaveValue('');

      // Expand puts the text back into the textarea.
      await page.getByTestId('chat-composer-collapse-expand').click();
      await expect(chip).toHaveCount(0);
      await expect(composer).toHaveValue(LONG_TEXT);

      // Collapse again via a second long paste after clearing.
      await composer.fill('');
      await page.evaluate((longText) => {
        const textarea = document.querySelector('[data-testid="chat-composer-input"]') as HTMLTextAreaElement;
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', longText);
        textarea.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        }));
      }, LONG_TEXT);
      await chip.waitFor({ state: 'visible', timeout: 5000 });

      // Dismiss discards the buffer.
      await page.getByTestId('chat-composer-collapse-dismiss').click();
      await expect(chip).toHaveCount(0);
      await expect(composer).toHaveValue('');
    } finally {
      await closeElectronApp(app);
    }
  });
});
