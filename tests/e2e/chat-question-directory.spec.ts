import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-layout';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const longAnswer = [
  'This answer intentionally contains enough text to make the chat scrollable in the Electron window.',
  'It gives the question directory a meaningful target to jump to when the user selects an entry.',
  'The content itself is not important; the test only verifies that the in-chat question outline remains visible and clickable.',
].join(' ');

const seededHistory = [
  { role: 'user', content: 'First question: summarize the market opening.', timestamp: 1000 },
  { role: 'assistant', content: `${longAnswer}\n\n${longAnswer}\n\n${longAnswer}`, timestamp: 1001 },
  { role: 'user', content: 'Second question: list the strongest sectors.', timestamp: 1002 },
  { role: 'assistant', content: `${longAnswer}\n\n${longAnswer}\n\n${longAnswer}`, timestamp: 1003 },
  { role: 'user', content: 'Third question: explain notable risks.', timestamp: 1004 },
  { role: 'assistant', content: `${longAnswer}\n\n${longAnswer}\n\n${longAnswer}`, timestamp: 1005 },
  { role: 'user', content: 'Fourth question: prepare the final action plan.', timestamp: 1006 },
  { role: 'assistant', content: 'Here is the final action plan.', timestamp: 1007 },
];

const workspace = {
  id: WORKSPACE_ID,
  name: 'Layout Workspace',
  rootPath: '/workspace/layout',
  permissionMode: 'readOnly',
  activeSessionKey: SESSION_KEY,
  state: {},
  sessionStates: {},
};

test.describe('ClawX chat question directory', () => {
  test('keeps assistive panels hidden on a fresh empty chat', async ({ launchElectronApp }) => {
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
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'Main', workspace: '/workspace/layout' }],
              },
            },
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [],
            activeWorkspaceId: null,
            activeWorkspace: null,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: null,
            activeWorkspace: null,
          },
        },
      });

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1366, height: 820 });
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-page')).toBeVisible();
      await expect(page.getByTestId('chat-assistive-rail')).toHaveCount(0);
      await expect(page.getByTestId('work-mode-summary-panel')).toHaveCount(0);
      await expect(page.getByTestId('task-ledger-summary')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows a toolbar button that opens a clickable in-conversation question directory', async ({ launchElectronApp }) => {
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
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
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
        },
      });

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1600, height: 900 });
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();

      const toggle = page.getByTestId('chat-question-directory-toggle');
      await expect(toggle).toBeVisible();
      await toggle.click();

      const directory = page.getByTestId('chat-question-directory');
      await expect(directory).toBeVisible({ timeout: 30_000 });
      await expect(directory).toContainText('Question directory');
      await expect(directory).toContainText('First question: summarize the market opening.');
      await expect(directory).toContainText('Fourth question: prepare the final action plan.');
      await expect(directory.locator('button')).toHaveCount(4);

      await page.getByTestId('chat-question-directory-item-6').click();
      await expect(page.getByTestId('chat-message-6')).toBeInViewport();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('hides chat assistive panels when the workspace panel opens', async ({ launchElectronApp }) => {
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
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
        },
        hostApi: {
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            agents: [{
              id: 'main',
              name: 'Main',
              isDefault: true,
              workspace: '/workspace/layout',
              mainSessionKey: SESSION_KEY,
              channelTypes: [],
            }],
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'Main', workspace: '/workspace/layout' }],
              },
            },
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
        },
      });

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1366, height: 820 });
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await expect(page.getByTestId('chat-assistive-rail')).toBeVisible();
      await expect(page.getByTestId('work-mode-summary-panel')).toBeVisible();

      await page.getByTestId('chat-question-directory-toggle').click();
      await expect(page.getByTestId('chat-question-directory')).toBeVisible();

      await page.getByTestId('chat-workspace-toggle').click();

      const sidePanel = page.getByTestId('artifact-panel-aside');
      await expect(sidePanel).toBeVisible();
      await expect(page.getByTestId('chat-question-directory')).toHaveCount(0);
      await expect(page.getByTestId('chat-assistive-rail')).toHaveCount(0);
      await expect(page.getByTestId('work-mode-summary-panel')).toHaveCount(0);

      const metrics = await page.evaluate(() => {
        const scroll = document.querySelector('[data-testid="chat-scroll-container"]')?.getBoundingClientRect();
        const panel = document.querySelector('[data-testid="artifact-panel-aside"]')?.getBoundingClientRect();
        const pageRect = document.querySelector('[data-testid="chat-page"]')?.getBoundingClientRect();
        return {
          scrollWidth: scroll?.width ?? 0,
          panelWidth: panel?.width ?? 0,
          pageWidth: pageRect?.width ?? 0,
        };
      });

      expect(metrics.scrollWidth).toBeGreaterThan(480);
      expect(metrics.panelWidth).toBeLessThanOrEqual(metrics.pageWidth * 0.52);
    } finally {
      await closeElectronApp(app);
    }
  });
});
