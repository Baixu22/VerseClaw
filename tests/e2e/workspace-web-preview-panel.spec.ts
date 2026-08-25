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
  agentId: 'main',
  permissionMode: 'acceptEdits',
  activeSessionKey: SESSION_KEY,
  state: {
    webPreview: {
      mode: 'devServer',
      targetUrl: 'http://localhost:8082/',
    },
  },
  sessionStates: {
    [SESSION_KEY]: {
      webPreview: {
        mode: 'devServer',
        targetUrl: 'http://localhost:8082/',
      },
    },
  },
};

const previewUrl = `data:text/html,${encodeURIComponent('<!doctype html><html><body><button id="save">Save changes</button></body></html>')}`;

test.describe('Workspace Web preview panel', () => {
  test('selects a preview component and sends it to the composer', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true });

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
          [stableStringify(['workspaces', 'saveState', null])]: { success: true },
          [stableStringify(['git', 'status', null])]: {
            success: true,
            status: { isRepository: false },
          },
          [stableStringify(['webPreview', 'status', { workspaceId: WORKSPACE_ID }])]: {
            success: true,
            running: true,
            status: 'running',
            mode: 'devServer',
            previewId: PREVIEW_ID,
            previewUrl,
            url: previewUrl,
            targetUrl: 'http://localhost:8082/',
            rootPath: '/workspace/demo',
          },
          [stableStringify(['agentBrowser', 'open', null])]: {
            success: true,
            session: {
              id: 'agent-browser-1',
              profile: 'workspace-workspace-1-agent-main-main',
              mode: 'visible',
              url: 'http://localhost:8082/',
              title: 'Demo Agent Browser',
              createdAt: '2026-07-04T00:00:00.000Z',
              updatedAt: '2026-07-04T00:00:00.000Z',
            },
          },
          [stableStringify(['agentBrowser', 'focus', null])]: {
            success: true,
            session: {
              id: 'agent-browser-1',
              profile: 'workspace-workspace-1-agent-main-main',
              mode: 'visible',
              url: 'http://localhost:8082/',
              title: 'Demo Agent Browser',
              createdAt: '2026-07-04T00:00:00.000Z',
              updatedAt: '2026-07-04T00:00:01.000Z',
            },
          },
          [stableStringify(['agentBrowser', 'status', null])]: {
            success: true,
            sessions: [{
              id: 'agent-browser-1',
              profile: 'workspace-workspace-1-agent-main-main',
              mode: 'visible',
              url: 'http://localhost:8082/',
              title: 'Demo Agent Browser',
              createdAt: '2026-07-04T00:00:00.000Z',
              updatedAt: '2026-07-04T00:00:01.000Z',
            }],
          },
          [stableStringify(['agentBrowser', 'profiles', null])]: {
            success: true,
            profiles: [{ profile: 'workspace-workspace-1-agent-main-main', label: 'Demo workspace', source: 'metadata' }],
          },
          [stableStringify(['agentBrowser', 'createTask', {
            name: 'Check current page',
            url: 'http://localhost:8082/',
            objective: 'Read the current page and verify it is available',
            profile: 'workspace-workspace-1-agent-main-main',
            mode: 'headless',
            allowedDomains: ['localhost'],
            steps: [{ action: 'wait-for-selector', selector: 'body' }],
            successCriteria: { kind: 'text-includes', value: 'Save changes' },
            workspaceId: WORKSPACE_ID,
            sessionKey: SESSION_KEY,
            agentId: 'main',
          }])]: {
            success: true,
            task: { id: 'browser-task-1', status: 'waiting-approval' },
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

      await page.setViewportSize({ width: 1280, height: 820 });
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            caret-color: transparent !important;
          }
          [data-sonner-toaster] {
            display: none !important;
          }
        `,
      });

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.getByTestId('chat-workspace-toggle').click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible();
      await expect(sidePanel.getByTestId('artifact-panel-tab-files')).toBeVisible();
      await sidePanel.getByTestId('artifact-panel-new-tab').click();
      await page.getByTestId('artifact-panel-new-tab-browser').click();
      const webPreview = sidePanel.getByTestId('ai-web-preview');
      await expect(webPreview).toBeVisible();
      await expect(webPreview.getByTestId('ai-web-preview-toolbar')).toHaveCount(0);
      await expect(webPreview.getByTestId('ai-web-preview-mode-tabs')).toHaveCount(0);
      await webPreview.getByTestId('ai-web-preview-browser-menu').click();
      await expect(page.getByTestId('ai-web-preview-configuration')).toBeVisible();
      await expect(page.getByTestId('ai-web-preview-mode-externalUrl')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(webPreview.getByTestId('ai-web-preview-browser')).toBeVisible();
      await expect(webPreview.locator('iframe[title="Workspace preview"]')).toBeVisible();
      await webPreview.getByTestId('ai-web-preview-browser-menu').click();
      await page.getByTestId('ai-web-preview-mode-externalUrl').click();
      await page.keyboard.press('Escape');
      await expect(sidePanel.getByRole('button', { name: 'Pick component' })).toHaveCount(0);
      await webPreview.getByTestId('ai-web-preview-browser-menu').click();
      await page.getByTestId('ai-web-preview-mode-devServer').click();
      await page.keyboard.press('Escape');
      await expect(sidePanel.getByRole('button', { name: 'Pick component' })).toBeVisible();

      await webPreview.getByTestId('ai-web-preview-browser-menu').click();
      await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Open externally' })).toBeVisible();
      await expect(page).toHaveScreenshot('workspace-web-preview-browser-menu.png', {
        animations: 'disabled',
        caret: 'hide',
        /*
         * The brand logo is picked at random from three images on every app
         * launch (src/components/brand/BrandLogo.tsx) — deliberate product
         * delight, and fatal to a whole-page baseline: a third of runs draw a
         * different mascot and the shot fails by ~500px on the logo alone.
         * This is the only full-page screenshot in the suite, so masking it
         * here is enough; everything else captures a scoped locator.
         */
        mask: [page.getByAltText('Verse')],
      });
      await page.keyboard.press('Escape');

      await webPreview.getByTestId('ai-web-preview-agent-browser-open').click();
      await expect.poll(async () => {
        const calls = await app.evaluate(() => (
          (globalThis as unknown as {
            __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> | null }>;
          }).__verseClawE2eHostCalls ?? []
        ));
        return calls.filter((call) => call.module === 'agentBrowser').map((call) => call.action).join(',');
      }).toContain('open');
      const hostCalls = await app.evaluate(() => (
        (globalThis as unknown as {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> | null }>;
        }).__verseClawE2eHostCalls ?? []
      ));
      const agentBrowserOpen = hostCalls.find((call) => call.module === 'agentBrowser' && call.action === 'open');
      expect(agentBrowserOpen?.payload).toMatchObject({
        url: 'http://localhost:8082/',
        mode: 'visible',
        profile: 'workspace-workspace-1-agent-main-main',
        authPersistence: 'profile',
        workspaceId: WORKSPACE_ID,
        sessionKey: SESSION_KEY,
        agentId: 'main',
      });
      const agentBrowserFocus = hostCalls.find((call) => call.module === 'agentBrowser' && call.action === 'focus');
      expect(agentBrowserFocus?.payload).toMatchObject({
        sessionId: 'agent-browser-1',
      });
      await expect(webPreview.getByTestId('ai-web-preview-agent-browser-status')).toContainText('Agent');

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
      await expect(webPreview.getByTestId('ai-web-preview-selection')).toContainText('#save');
      await expect(webPreview).toHaveScreenshot('workspace-web-preview-ai-elements-selected.png', {
        animations: 'disabled',
        caret: 'hide',
      });
      await sidePanel.getByRole('button', { name: 'Send to composer' }).click();

      const composer = page.getByTestId('chat-composer-input');
      await expect(composer).toContainText('Please adjust the component selected in the Web preview.');
      await expect(composer).toContainText('CSS selector: #save');
      await expect(composer).toContainText('Save changes');

      await sidePanel.getByTestId('workspace-browser-view-live').click();
      const liveBrowser = sidePanel.getByTestId('workspace-browser-live');
      await expect(liveBrowser).toBeVisible();
      await liveBrowser.getByLabel('More browser actions').click();
      await expect(liveBrowser.getByRole('button', { name: 'Focus browser' })).toBeVisible();
      await expect(liveBrowser.getByRole('button', { name: 'Take screenshot' })).toBeVisible();
      await page.getByText('Automate this page', { exact: true }).click();
      await expect(liveBrowser.getByTestId('workspace-browser-automation')).toBeVisible();
      await liveBrowser.getByLabel('Success text to verify').fill('Save changes');
      await liveBrowser.getByRole('button', { name: 'Submit for approval' }).click();
      await expect.poll(async () => {
        const calls = await app.evaluate(() => (
          (globalThis as unknown as {
            __verseClawE2eHostCalls?: Array<{ module?: string; action?: string }>;
          }).__verseClawE2eHostCalls ?? []
        ));
        return calls.filter((call) => call.module === 'agentBrowser' && call.action === 'createTask').length;
      }).toBe(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});
