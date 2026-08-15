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
          [stableStringify(['git', 'status', null])]: {
            ok: false,
            error: { code: 'INTERNAL', message: 'E2E injected git status failure' },
          },
        },
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

  test('keeps the ordinary git section when the git status host route succeeds', async ({ launchElectronApp }) => {
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
            status: { isRepository: true, branch: 'main', clean: true, stagedCount: 0, unstagedCount: 0, untrackedCount: 0, conflictedCount: 0, ahead: 0, behind: 0, changes: [] },
          },
        },
      });
      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByTestId('session-status-rail-git')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('session-status-rail-git-error')).toHaveCount(0);
      await expect(page.getByTestId('session-status-rail-changes')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
