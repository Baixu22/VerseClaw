// R2: SessionStatusRail error semantics in a real Electron window.
// Host-reject is injected at the IPC boundary via installIpcMocks — the
// renderer sees a genuine invokeHost rejection (ok:false envelope), the same
// path a downed host route produces in production.
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const SESSION_KEY = 'agent:main:main';
const WORKSPACE = {
  id: 'workspace-a',
  name: 'Workspace A',
  rootPath: 'C:/workspace-a',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: SESSION_KEY,
  agentBindings: {
    main: { workspaceId: 'workspace-a', agentId: 'main', sessionKey: SESSION_KEY },
  },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: { activeTopicId: null, draftInput: '' },
};

function baseMocks() {
  return {
    [stableStringify(['/api/workspaces', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, workspaces: [WORKSPACE], activeWorkspaceId: 'workspace-a' },
      },
    },
    [stableStringify(['workspaces', 'getActive', null])]: {
      success: true,
      activeWorkspaceId: 'workspace-a',
      activeWorkspace: WORKSPACE,
    },
    [stableStringify(['workspaces', 'list', null])]: {
      success: true,
      profiles: [WORKSPACE],
      activeWorkspaceId: 'workspace-a',
      activeWorkspace: WORKSPACE,
    },
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main' }] } },
    },
    [stableStringify(['providers', 'accounts', null])]: [],
    [stableStringify(['providers', 'accountKeyInfo', null])]: [],
    [stableStringify(['providers', 'vendors', null])]: [],
  };
}

test.describe('R2 renderer error semantics (SessionStatusRail)', () => {
  test('shows failed+retry instead of "not a repository" when the git status host route rejects', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          ...baseMocks(),
        },
      });
      // The fixture's hostApi values always ride an ok:true envelope, so a
      // host REJECTION needs a custom host:invoke that fails the route — the
      // same ok:false envelope a downed Main route produces in production.
      await app.evaluate(() => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const fail = (id: unknown, message: string) => ({
          id: typeof id === 'string' ? id : undefined,
          ok: false,
          error: { code: 'INTERNAL', message },
        });
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: unknown) => {
          const req = request as { id?: string; module?: string; action?: string };
          if (req?.module === 'git' && req?.action === 'status') {
            return fail(req.id, 'E2E injected git status failure');
          }
          return originalHostInvoke?.(event, request) ?? { id: req?.id, ok: true, data: {} };
        });
      });
      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      const error = page.getByTestId('session-status-rail-git-error');
      await expect(error).toBeVisible({ timeout: 30_000 });
      await expect(error).toContainText('Git status is temporarily unavailable.');
      await expect(page.getByTestId('session-status-rail-git-retry')).toBeVisible();
      // The honest opposite state must NOT leak: no "not a repository" claim.
      await expect(page.getByText('This project is not a Git repository')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps status and refresh aligned, and gives the commit dialog an opaque surface', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          ...baseMocks(),
          [stableStringify(['git', 'status', null])]: {
            success: true,
            status: {
              isRepository: true,
              branch: 'main',
              clean: false,
              stagedCount: 1,
              unstagedCount: 0,
              untrackedCount: 0,
              conflictedCount: 0,
              ahead: 0,
              behind: 0,
              changes: [{ path: 'src/example.ts', additions: 2, deletions: 0, bucket: 'staged' }],
            },
          },
        },
      });
      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByTestId('session-status-rail-git')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('session-status-rail-git-error')).toHaveCount(0);
      await expect(page.getByTestId('session-status-rail-changes')).toBeVisible();

      const statusToggle = page.getByTestId('chat-session-status-toggle');
      const refreshButton = page.getByTestId('chat-toolbar-refresh');
      await expect(statusToggle).toBeVisible();
      await expect(refreshButton).toBeVisible();
      await expect(page.getByTestId('chat-toolbar-more')).toHaveCount(0);
      await expect(statusToggle.locator('svg.lucide-chart-no-axes-column-increasing')).toBeVisible();
      const chatPageEdge = await page.getByTestId('chat-page').evaluate((element) => {
        const styles = getComputedStyle(element);
        return {
          radius: styles.borderTopLeftRadius,
          shadow: styles.boxShadow,
        };
      });
      expect(Number.parseFloat(chatPageEdge.radius)).toBeGreaterThan(0);
      // The divider is an inset shadow on the rounded chat surface. A shell
      // border would continue above the curve as a detached vertical line.
      expect(chatPageEdge.shadow).toContain('inset');
      const shellBorders = await page.evaluate(() => {
        const border = (testId: string) => {
          const styles = getComputedStyle(document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!);
          return {
            left: styles.borderLeftWidth,
            right: styles.borderRightWidth,
            bottom: styles.borderBottomWidth,
          };
        };
        return {
          titlebar: border('windows-titlebar'),
          sidebar: border('sidebar'),
          main: border('main-content'),
          toolbar: border('chat-toolbar-shell'),
        };
      });
      expect(shellBorders.titlebar.bottom).toBe('0px');
      expect(shellBorders.sidebar.right).toBe('0px');
      expect(shellBorders.main.left).toBe('0px');
      expect(shellBorders.toolbar.bottom).toBe('0px');
      const toolbarGeometry = await Promise.all([
        statusToggle.boundingBox(),
        refreshButton.boundingBox(),
      ]);
      expect(toolbarGeometry[0]).not.toBeNull();
      expect(toolbarGeometry[1]).not.toBeNull();
      expect(Math.abs(toolbarGeometry[0]!.y - toolbarGeometry[1]!.y)).toBeLessThanOrEqual(1);
      expect(toolbarGeometry[0]!.x + toolbarGeometry[0]!.width).toBeLessThanOrEqual(toolbarGeometry[1]!.x);

      await page.getByTestId('session-status-rail-git-commit').click();
      const commitDialog = page.getByTestId('session-status-rail-commit-dialog');
      await expect(commitDialog).toBeVisible();
      await expect(commitDialog).toHaveCSS('opacity', '1');
      const dialogSurface = await commitDialog.evaluate((element) => {
        const styles = getComputedStyle(element);
        return { backgroundColor: styles.backgroundColor, opacity: styles.opacity };
      });
      expect(dialogSurface.backgroundColor).not.toBe('transparent');
      expect(dialogSurface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(dialogSurface.opacity).toBe('1');

      await page.keyboard.press('Escape');
      await expect(commitDialog).toHaveCount(0);
      await statusToggle.click();
      await expect(statusToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('session-status-rail')).toHaveCount(0);
      await statusToggle.click();
      await expect(statusToggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('session-status-rail')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
