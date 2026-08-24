// R2: session activity panel git error semantics in a real Electron window.
// The panel is the single session-status sidebar and only renders when the
// session has activity; a rejected git host route must never leak the honest
// opposite state ("not a repository") — the git section simply stays hidden.
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

const HISTORY_MESSAGE = {
  id: 'r2-user-1',
  role: 'user',
  content: [{ type: 'text', text: 'hello from r2' }],
  timestamp: 1,
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

function historyRpc() {
  return {
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
      result: { messages: [HISTORY_MESSAGE] },
    },
    [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
      success: true,
      result: { messages: [HISTORY_MESSAGE] },
    },
  };
}

test.describe('R2 renderer error semantics (session activity panel)', () => {
  test('a rejected git status route hides the git section without leaking "not a repository"', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: historyRpc(),
        hostApi: { ...baseMocks() },
      });
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
          if (req?.module === 'sessionActivity' && req?.action === 'snapshot') {
            return fail(req.id, 'E2E injected session activity snapshot failure');
          }
          return originalHostInvoke?.(event, request) ?? { id: req?.id, ok: true, data: {} };
        });
      });
      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.getByTestId('chat-composer-input').waitFor({ state: 'visible', timeout: 30_000 });

      // The git section must not render from a failed route...
      await expect(page.getByTestId('session-activity-git')).toHaveCount(0);
      // ...and the honest opposite state must NOT leak.
      await expect(page.getByText('This project is not a Git repository')).toHaveCount(0);
      await expect(page.getByText('Git status is temporarily unavailable.')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows the git section when the git status route succeeds with a dirty repo', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: historyRpc(),
        hostApi: {
          ...baseMocks(),
          [stableStringify(['sessionActivity', 'snapshot', { workspaceId: 'workspace-a', sessionKey: SESSION_KEY }])]: {
            success: true,
            snapshot: {
              session: { sessionKey: SESSION_KEY, runId: null, status: 'idle', startedAt: null, endedAt: null, error: null, updatedAt: 0 },
              git: {
                isRepository: true,
                branch: 'main',
                clean: false,
                stagedCount: 1,
                unstagedCount: 0,
                untrackedCount: 0,
                conflictedCount: 0,
                ahead: 0,
                behind: 0,
                changes: [{ path: 'a.ts', additions: 2, deletions: 1 }],
              },
              tasks: [{ id: 't1', kind: 'task', title: 'Running task', status: 'running', updatedAt: Date.now(), source: 'snapshot' }],
              subagents: [],
              terminals: [],
              goals: [],
              processes: [],
              lineage: [],
              continuity: { queueCount: 0, contextPressure: null, checkpoint: false, blockedReason: null },
              availability: { git: true, tasks: false, subagents: true, terminals: false, continuity: true },
              capturedAt: Date.now(),
            },
          },
        },
      });
      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.getByTestId('chat-composer-input').waitFor({ state: 'visible', timeout: 30_000 });

      // The activity entry makes the toolbar toggle available; opening it shows
      // the single session-status sidebar with the git section.
      await page.getByTestId('chat-session-activity-toggle').waitFor({ state: 'visible', timeout: 30_000 });
      // The rail may already be auto-expanded (active activity) or collapsed
      // (passive + manual preference) — open it only when needed.
      const panelLocator = page.getByTestId('session-activity-panel');
      const alreadyOpen = await panelLocator.isVisible().catch(() => false);
      if (!alreadyOpen) {
        await page.getByTestId('chat-session-activity-toggle').click();
      }
      await expect(panelLocator).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('session-activity-git')).toBeVisible();
      await expect(page.getByText('Git status is temporarily unavailable.')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
