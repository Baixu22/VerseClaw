import { closeElectronApp, expect, getStableWindow, installIpcMocks, revealSectionHeadingActionsFor, test } from './fixtures/electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SESSION_KEY = 'agent:main:main';
const OTHER_SESSION_KEY = 'agent:main:other-project';

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
  selectedAgentId: 'main',
  activeSessionKey: SESSION_KEY,
  agentBindings: {
    main: {
      workspaceId: 'workspace-1',
      agentId: 'main',
      sessionKey: SESSION_KEY,
    },
  },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: {
    [SESSION_KEY]: {},
  },
};

const OTHER_WORKSPACE = {
  id: 'workspace-2',
  name: 'Other Workspace',
  rootPath: '/tmp/other-workspace',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: OTHER_SESSION_KEY,
  agentBindings: {
    main: {
      workspaceId: 'workspace-2',
      agentId: 'main',
      sessionKey: OTHER_SESSION_KEY,
    },
  },
  permissionMode: 'acceptEdits',
  createdAt: 2,
  updatedAt: 2,
  lastOpenedAt: 2,
  state: {},
  sessionStates: {
    [OTHER_SESSION_KEY]: {},
  },
};

const MAIN_HISTORY = [
  { role: 'user', content: 'Keep this workspace visible', timestamp: 1773281731 },
  { role: 'assistant', content: 'Workspace header is visible.', timestamp: 1773281732 },
];

test.describe('Verse Claw chat workspace header', () => {
  test('shows workspace and conversation without the legacy topic selector', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: SESSION_KEY, displayName: 'main', updatedAt: 1773281732000 },
                { key: OTHER_SESSION_KEY, displayName: 'Other project', updatedAt: 1773281733000 },
              ],
            },
          },
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [
                { key: SESSION_KEY, displayName: 'main', updatedAt: 1773281732000 },
                { key: OTHER_SESSION_KEY, displayName: 'Other project', updatedAt: 1773281733000 },
              ],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: MAIN_HISTORY },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: MAIN_HISTORY },
          },
        },
        hostApi: {
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
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [WORKSPACE, OTHER_WORKSPACE],
            activeWorkspaceId: WORKSPACE.id,
            activeWorkspace: WORKSPACE,
          },
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

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-project-session-header')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-project-session-header')).toContainText('Demo Workspace');
      await expect(page.getByTestId('chat-topic-selector')).toHaveCount(0);
      await revealSectionHeadingActionsFor(page.getByTestId('sidebar-session-organize'));
      await expect(page.getByTestId('sidebar-session-organize')).toBeVisible();
      await expect(page.getByTestId('sidebar-session-search')).toBeVisible();
      await expect(page.getByTestId('sidebar-session-project-workspace-1')).toContainText('Demo Workspace');
      await expect(page.getByTestId('sidebar-session-project-workspace-2')).toContainText('Other Workspace');
      await expect(page.getByTestId('sidebar-session-project-workspace-1')).not.toContainText('/tmp/demo-workspace');
      await expect(page.getByTestId('sidebar-session-project-workspace-2')).not.toContainText('/tmp/other-workspace');

      await expect(page.getByTestId('sidebar-session-project-toggle-workspace-1')).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toBeVisible();

      await app.evaluate(({ BrowserWindow }, sessionKey) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.started',
            runId: 'sidebar-status-run',
            sessionKey,
            startedAt: Date.now(),
          });
        }
      }, SESSION_KEY);
      await expect(page.getByTestId(`sidebar-session-status-${SESSION_KEY}`)).toHaveAttribute('data-state', 'running');
      await expect(page.getByTestId('chat-current-session-status')).toHaveAttribute('data-state', 'streaming');
      await expect(page.getByTestId('assistant-stream-status-dot')).toHaveAttribute('data-state', 'thinking');
      await expect(page.getByTestId('assistant-status-dot-matrix')).toHaveCount(0);

      const screenshotPath = testInfo.outputPath('chat-dot-matrix-running-status.png');
      await page.screenshot({ path: screenshotPath, fullPage: false });
      await testInfo.attach('chat-dot-matrix-running-status', {
        path: screenshotPath,
        contentType: 'image/png',
      });
      const screenshotDir = process.env.CLAWX_DOT_MATRIX_SCREENSHOT_DIR;
      if (screenshotDir) {
        const resolvedDir = join(process.cwd(), screenshotDir);
        mkdirSync(resolvedDir, { recursive: true });
        await page.screenshot({ path: join(resolvedDir, 'chat-dot-matrix-running-status.png'), fullPage: false });
      }

      await app.evaluate(({ BrowserWindow }, sessionKey) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.ended',
            runId: 'sidebar-status-run',
            sessionKey,
            status: 'completed',
            endedAt: Date.now(),
          });
        }
      }, SESSION_KEY);
      await expect(page.getByTestId(`sidebar-session-status-${SESSION_KEY}`)).toHaveAttribute('data-state', 'completed');
      await page.getByTestId(`sidebar-session-status-${SESSION_KEY}`).click();
      await expect(page.getByTestId(`sidebar-session-status-${SESSION_KEY}`)).toHaveCount(0);

      await page.getByTestId('sidebar-session-project-toggle-workspace-1').click();
      await expect(page.getByTestId('sidebar-session-project-workspace-1')).toHaveAttribute('data-state', 'collapsed');
      await expect(page.getByTestId('sidebar-session-project-toggle-workspace-1')).toHaveAttribute('aria-expanded', 'false');
      // The official collapse animates grid-template-rows 1fr→0fr, so rows stay
      // mounted and are clipped to zero height rather than unmounting.
      const collapsedList = page
        .getByTestId('sidebar-session-project-workspace-1')
        .locator('.project-tasks-outer');
      await expect(collapsedList).toHaveAttribute('aria-hidden', 'true');
      // Fully clipped: only the reference's 4px `.project-tasks` top padding
      // survives the 0fr track, so no session row remains on screen.
      await expect
        .poll(() => collapsedList.evaluate((el) => Math.round(el.getBoundingClientRect().height)))
        .toBeLessThanOrEqual(4);
      await page.getByTestId('sidebar-session-project-toggle-workspace-1').click();
      await expect(page.getByTestId(`sidebar-session-${SESSION_KEY}`)).toBeVisible();

      await revealSectionHeadingActionsFor(page.getByTestId('sidebar-session-organize'));
      await page.getByTestId('sidebar-session-organize').click();
      await page.getByRole('menuitemradio', { name: 'Time' }).click();
      await expect(page.getByTestId('sidebar-session-project-workspace-1')).toHaveCount(0);
      await expect(page.getByText('Other project')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps sidebar new chat scoped to the active workspace', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: SESSION_KEY, displayName: 'main', updatedAt: 1773281732000 },
                { key: OTHER_SESSION_KEY, displayName: 'Other project', updatedAt: 1773281733000 },
              ],
            },
          },
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [
                { key: SESSION_KEY, displayName: 'main', updatedAt: 1773281732000 },
                { key: OTHER_SESSION_KEY, displayName: 'Other project', updatedAt: 1773281733000 },
              ],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: MAIN_HISTORY },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: MAIN_HISTORY },
          },
        },
        hostApi: {
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
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [WORKSPACE, OTHER_WORKSPACE],
            activeWorkspaceId: WORKSPACE.id,
            activeWorkspace: WORKSPACE,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: WORKSPACE.id,
            activeWorkspace: WORKSPACE,
          },
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

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-project-session-header')).toContainText('Demo Workspace', { timeout: 30_000 });

      await app.evaluate((_, params) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const calls = {
          workspaceUpdate: [] as Record<string, unknown>[],
          workspaceSaveState: [] as Record<string, unknown>[],
        };
        let activeWorkspace = params.workspace;
        const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
        const buildSnapshot = () => ({
          success: true,
          profiles: [activeWorkspace, params.otherWorkspace],
          activeWorkspaceId: activeWorkspace.id,
          activeWorkspace,
        });

        (globalThis as typeof globalThis & {
          __workspaceNewChatCalls?: typeof calls;
        }).__workspaceNewChatCalls = calls;

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          if (request.module === 'workspaces' && request.action === 'update') {
            calls.workspaceUpdate.push(request.payload ?? {});
            const payload = request.payload ?? {};
            const agentId = String(payload.agentId ?? activeWorkspace.selectedAgentId);
            const sessionKey = String(payload.sessionKey ?? activeWorkspace.activeSessionKey);
            activeWorkspace = {
              ...activeWorkspace,
              agentId,
              selectedAgentId: agentId,
              activeSessionKey: String(payload.activeSessionKey ?? sessionKey),
              agentBindings: {
                ...activeWorkspace.agentBindings,
                [agentId]: {
                  workspaceId: activeWorkspace.id,
                  agentId,
                  sessionKey,
                },
              },
              state: payload.state ?? {},
              sessionStates: {
                ...activeWorkspace.sessionStates,
                [sessionKey]: payload.state ?? {},
              },
              updatedAt: Date.now(),
              lastOpenedAt: Date.now(),
            };
            return respond(request.id, buildSnapshot());
          }
          if (request.module === 'workspaces' && request.action === 'saveState') {
            calls.workspaceSaveState.push(request.payload ?? {});
            return respond(request.id, { success: true });
          }
          if (request.module === 'workspaces' && request.action === 'list') {
            return respond(request.id, buildSnapshot());
          }
          if (request.module === 'workspaces' && request.action === 'getActive') {
            return respond(request.id, {
              success: true,
              activeWorkspaceId: activeWorkspace.id,
              activeWorkspace,
            });
          }
          if (request.module === 'files' && request.action === 'writeText') {
            return respond(request.id, { success: true });
          }
          return originalHostInvoke?.(event, request) ?? respond(request.id, {});
        });
      }, { workspace: WORKSPACE, otherWorkspace: OTHER_WORKSPACE });

      await page.getByTestId('sidebar-new-chat').click();

      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __workspaceNewChatCalls?: { workspaceUpdate: unknown[] };
        }).__workspaceNewChatCalls?.workspaceUpdate.length ?? 0
      ))).toBe(1);

      const calls = await app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __workspaceNewChatCalls?: {
            workspaceUpdate: Record<string, unknown>[];
            workspaceSaveState: Record<string, unknown>[];
          };
        }).__workspaceNewChatCalls
      ));
      expect(calls?.workspaceSaveState[0]).toEqual(expect.objectContaining({
        id: WORKSPACE.id,
        sessionKey: SESSION_KEY,
      }));
      expect(calls?.workspaceUpdate[0]).toEqual(expect.objectContaining({
        id: WORKSPACE.id,
        agentId: 'main',
        state: { activeTopicId: null },
      }));
      expect(calls?.workspaceUpdate[0]?.sessionKey).toEqual(expect.stringMatching(/^agent:main:session-\d+-[a-z0-9]+$/));
      expect(calls?.workspaceUpdate[0]?.activeSessionKey).toBe(calls?.workspaceUpdate[0]?.sessionKey);
    } finally {
      await closeElectronApp(app);
    }
  });
});
