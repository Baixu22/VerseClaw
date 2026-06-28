import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_A_KEY = 'agent:main:main';
const SESSION_B_KEY = 'agent:main:session-secondary';
const WORKSPACE_ID = 'workspace-draft';

const DRAFT_A = 'Drafting the onboarding notes for session A.';
const DRAFT_B = 'Drafting the migration checklist for session B.';

// Session B has a single prior exchange so switchSession's "leavingEmpty"
// guard doesn't drop it from the sidebar when navigating away from it.
const SESSION_B_HISTORY = [
  { role: 'user', content: [{ type: 'text', text: 'Prior question for session B.' }], timestamp: 1000 },
  { role: 'assistant', content: [{ type: 'text', text: 'Prior answer for session B.' }], timestamp: 1001 },
];

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function buildWorkspace(sessionStates: Record<string, { draftInput?: string }>) {
  return {
    id: WORKSPACE_ID,
    name: 'Draft Workspace',
    rootPath: 'C:/workspace-draft',
    agentId: 'main',
    selectedAgentId: 'main',
    activeSessionKey: SESSION_A_KEY,
    agentBindings: {
      main: {
        workspaceId: WORKSPACE_ID,
        agentId: 'main',
        sessionKey: SESSION_A_KEY,
      },
    },
    permissionMode: 'acceptEdits' as const,
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    state: {},
    sessionStates,
  };
}

function baseHostApiMocks(sessionStates: Record<string, { draftInput?: string }>) {
  const workspace = buildWorkspace(sessionStates);
  return {
    [stableStringify(['gateway', 'status', null])]: {
      state: 'running',
      port: 18789,
      pid: 12345,
      gatewayReady: true,
    },
    [stableStringify(['/api/chat/sessions', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          result: {
            sessions: [
              { key: SESSION_A_KEY, displayName: 'main' },
              { key: SESSION_B_KEY, displayName: 'session-secondary', updatedAt: 1001 },
            ],
          },
        },
      },
    },
    [stableStringify(['/api/chat/history', 'POST'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, result: { messages: [] } },
      },
    },
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
      },
    },
    [stableStringify(['/api/workspaces', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, workspaces: [workspace], activeWorkspaceId: WORKSPACE_ID },
      },
    },
    [stableStringify(['workspaces', 'getActive', null])]: {
      success: true,
      activeWorkspaceId: WORKSPACE_ID,
      activeWorkspace: workspace,
    },
    [stableStringify(['workspaces', 'list', null])]: {
      profiles: [workspace],
      activeWorkspaceId: WORKSPACE_ID,
      activeWorkspace: workspace,
    },
    [stableStringify(['usage', 'contextRange', {
      sessionKey: SESSION_A_KEY,
      modelRef: null,
      messageCount: 0,
      usedTokens: null,
    }])]: {
      success: true,
      range: {
        sessionKey: SESSION_A_KEY,
        usedTokens: 1000,
        maxTokens: 128000,
        truncatedMessageCount: 0,
        status: 'bestEffort',
      },
    },
    [stableStringify(['usage', 'contextRange', {
      sessionKey: SESSION_B_KEY,
      modelRef: null,
      messageCount: 0,
      usedTokens: null,
    }])]: {
      success: true,
      range: {
        sessionKey: SESSION_B_KEY,
        usedTokens: 1000,
        maxTokens: 128000,
        truncatedMessageCount: 0,
        status: 'bestEffort',
      },
    },
    [stableStringify(['usage', 'live', {
      sessionKey: SESSION_A_KEY,
      runId: null,
      streaming: false,
    }])]: {
      success: true,
      usage: null,
    },
    [stableStringify(['usage', 'live', {
      sessionKey: SESSION_B_KEY,
      runId: null,
      streaming: false,
    }])]: {
      success: true,
      usage: null,
    },
  };
}

test.describe('Verse Claw chat draft preservation across session switches', () => {
  test('preserves composer drafts when switching between sessions and back', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [
                { key: SESSION_A_KEY, displayName: 'main' },
                { key: SESSION_B_KEY, displayName: 'session-secondary', updatedAt: 1001 },
              ],
            },
          },
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: SESSION_A_KEY, displayName: 'main' },
                { key: SESSION_B_KEY, displayName: 'session-secondary', updatedAt: 1001 },
              ],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_A_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_A_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_B_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: {
              messages: SESSION_B_HISTORY,
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_B_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: {
              messages: SESSION_B_HISTORY,
            },
          },
        },
        hostApi: baseHostApiMocks({}),
      });

      // Dynamic override: track per-session draftInput so switching back restores
      // the previously saved draft. Mirrors the renderer's sessionStates contract.
      // Seed both session keys so both appear in the sidebar from the start
      // (sidebar groups sessions by workspace.sessionStates keys).
      await app.evaluate((_context, { sessionA, sessionB, workspaceId }: { sessionA: string; sessionB: string; workspaceId: string }) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const sessionStates: Record<string, { draftInput?: string; activeTopicId: null }> = {
          [sessionA]: { activeTopicId: null },
          [sessionB]: { activeTopicId: null },
        };
        const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
        const buildWorkspace = (activeSessionKey: string) => ({
          id: workspaceId,
          name: 'Draft Workspace',
          rootPath: 'C:/workspace-draft',
          agentId: 'main',
          selectedAgentId: 'main',
          activeSessionKey,
          agentBindings: {
            main: {
              workspaceId,
              agentId: 'main',
              sessionKey: sessionA,
            },
          },
          permissionMode: 'acceptEdits',
          createdAt: 1,
          updatedAt: 1,
          lastOpenedAt: 1,
          state: {},
          sessionStates,
        });

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          if (request.module === 'workspaces' && (request.action === 'update' || request.action === 'saveState')) {
            const payload = request.payload ?? {};
            const sessionKey = typeof payload.sessionKey === 'string' ? payload.sessionKey : null;
            const state = payload.state;
            if (sessionKey && state && typeof state === 'object' && typeof (state as Record<string, unknown>).draftInput === 'string') {
              sessionStates[sessionKey] = {
                draftInput: String((state as Record<string, unknown>).draftInput),
                activeTopicId: null,
              };
            }
            const activeSessionKey = typeof payload.activeSessionKey === 'string' ? payload.activeSessionKey : sessionKey ?? sessionA;
            const workspace = buildWorkspace(activeSessionKey);
            return respond(request.id, {
              success: true,
              profiles: [workspace],
              activeWorkspaceId: workspaceId,
              activeWorkspace: workspace,
            });
          }
          if (request.module === 'workspaces' && (request.action === 'list' || request.action === 'getActive')) {
            const workspace = buildWorkspace(sessionA);
            if (request.action === 'list') {
              return respond(request.id, {
                success: true,
                profiles: [workspace],
                activeWorkspaceId: workspaceId,
                activeWorkspace: workspace,
              });
            }
            return respond(request.id, {
              success: true,
              activeWorkspaceId: workspaceId,
              activeWorkspace: workspace,
            });
          }
          return originalHostInvoke?.(event, request) ?? respond(request.id, {});
        });
        (globalThis as typeof globalThis & { __draftSessionStates?: typeof sessionStates }).__draftSessionStates = sessionStates;
      }, { sessionA: SESSION_A_KEY, sessionB: SESSION_B_KEY, workspaceId: WORKSPACE_ID });

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
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

      // Sanity: both sessions appear in the sidebar.
      await expect(page.getByTestId(`sidebar-session-${SESSION_A_KEY}`)).toBeVisible();
      await expect(page.getByTestId(`sidebar-session-${SESSION_B_KEY}`)).toBeVisible();

      const composer = page.getByTestId('chat-composer-input');

      // Step 1: type draft in session A, wait for the 250ms debounced save.
      await composer.fill(DRAFT_A);
      await expect.poll(async () => app.evaluate((_ctx, sessionKey: string) => (
        (globalThis as typeof globalThis & { __draftSessionStates?: Record<string, { draftInput?: string }> }).__draftSessionStates?.[sessionKey]?.draftInput ?? ''
      ), SESSION_A_KEY)).toBe(DRAFT_A);

      // Step 2: switch to session B. Composer must be cleared (B has no saved draft).
      await page.getByTestId(`sidebar-session-${SESSION_B_KEY}`).click();
      await expect(composer).toHaveValue('');

      // Step 3: type draft in session B, wait for save.
      await composer.fill(DRAFT_B);
      await expect.poll(async () => app.evaluate((_ctx, sessionKey: string) => (
        (globalThis as typeof globalThis & { __draftSessionStates?: Record<string, { draftInput?: string }> }).__draftSessionStates?.[sessionKey]?.draftInput ?? ''
      ), SESSION_B_KEY)).toBe(DRAFT_B);

      // Step 4: switch back to session A. Draft A must be restored.
      await page.getByTestId(`sidebar-session-${SESSION_A_KEY}`).click();
      await expect(composer).toHaveValue(DRAFT_A);

      // Step 5: switch back to session B. Draft B must be restored.
      await page.getByTestId(`sidebar-session-${SESSION_B_KEY}`).click();
      await expect(composer).toHaveValue(DRAFT_B);

      // Final assertion: both sessions retained their respective drafts in the
      // Main-process mock store, proving the renderer persisted them per session.
      const persisted = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __draftSessionStates?: Record<string, { draftInput?: string }> }).__draftSessionStates ?? {}
      ));
      expect(persisted[SESSION_A_KEY]?.draftInput).toBe(DRAFT_A);
      expect(persisted[SESSION_B_KEY]?.draftInput).toBe(DRAFT_B);
    } finally {
      await closeElectronApp(app);
    }
  });
});
