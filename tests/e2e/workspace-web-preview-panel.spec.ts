import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-1';
const PREVIEW_ID = 'preview-1';

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
  permissionMode: 'acceptEdits',
  activeSessionKey: SESSION_KEY,
  state: {},
  sessionStates: {},
};

const previewUrl = `data:text/html,${encodeURIComponent('<!doctype html><html><body><button id="save">Save changes</button></body></html>')}`;

test.describe('Workspace Web preview panel', () => {
  test('selects a preview component and sends it to the composer', async ({ launchElectronApp }) => {
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
            state: { artifactPanel: { workspaceView: 'web' } },
          }])]: { success: true },
          [stableStringify(['webPreview', 'status', { workspaceId: WORKSPACE_ID }])]: {
            success: true,
            running: true,
            status: 'running',
            mode: 'externalUrl',
            previewId: PREVIEW_ID,
            previewUrl,
            url: previewUrl,
            targetUrl: 'http://localhost:8082/',
            rootPath: '/workspace/demo',
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
      await page.getByRole('button', { name: 'Workspace' }).first().click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible();
      await sidePanel.getByRole('button', { name: 'Web' }).click();
      await expect(sidePanel.getByText('Web preview')).toBeVisible();

      await sidePanel.getByRole('button', { name: 'Pick component' }).click();

      const iframeHandle = await sidePanel.locator('iframe[title="Workspace preview"]').elementHandle();
      const frame = await iframeHandle?.contentFrame();
      expect(frame).toBeTruthy();
      await frame!.evaluate((previewId) => {
        window.parent.postMessage({
          type: 'clawx.preview.selection',
          version: 1,
          previewId,
          href: window.location.href,
          element: {
            href: window.location.href,
            tagName: 'button',
            id: 'save',
            className: 'primary',
            cssSelector: '#save',
            text: 'Save changes',
            role: 'button',
            ariaLabel: 'Save changes',
            attributes: { id: 'save', class: 'primary', 'aria-label': 'Save changes' },
            rect: { x: 24, y: 32, width: 120, height: 40 },
            outerHtmlPreview: '<button id="save" class="primary" aria-label="Save changes">Save changes</button>',
          },
        }, '*');
      }, PREVIEW_ID);

      await expect(sidePanel.getByText('#save')).toBeVisible();
      await sidePanel.getByRole('button', { name: 'Send to composer' }).click();

      const composer = page.getByTestId('chat-composer-input');
      await expect(composer).toContainText('Please adjust the component selected in the Web preview.');
      await expect(composer).toContainText('CSS selector: #save');
      await expect(composer).toContainText('Save changes');
    } finally {
      await closeElectronApp(app);
    }
  });
});
