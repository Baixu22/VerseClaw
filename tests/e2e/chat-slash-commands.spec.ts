import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-slash';

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
  name: 'Slash Workspace',
  rootPath: '/tmp/slash-workspace',
  agentId: 'main',
  activeSessionKey: SESSION_KEY,
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: {},
};

const emptyLedgerSnapshot = {
  schemaVersion: 1,
  workspaceId: WORKSPACE_ID,
  generatedAt: '2026-06-21T00:00:00.000Z',
  nodes: [],
  edges: [],
  sessionLinks: [],
  rootNodeIds: [],
  reviewNodeIds: [],
  activeNodeIds: [],
  blockedNodeIds: [],
  recentDecisions: [],
  eventsCount: 0,
  warnings: [],
};

function baseHostApiMocks() {
  return {
    [stableStringify(['gateway', 'status', null])]: {
      state: 'running',
      port: 18789,
      pid: 12345,
      gatewayReady: true,
    },
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, agents: [{ id: 'main', name: 'main' }] },
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
    [stableStringify(['workspaces', 'saveState', {
      id: WORKSPACE_ID,
      sessionKey: SESSION_KEY,
      state: {},
    }])]: { success: true },
    [stableStringify(['sessions', 'compactionStatus', {
      sessionKey: SESSION_KEY,
      agentId: 'main',
    }])]: {
      success: true,
      available: true,
      canCompact: true,
      inProgress: false,
      pressure: 'low',
      truncatedMessageCount: 0,
      warnings: [],
    },
    [stableStringify(['usage', 'contextRange', {
      sessionKey: SESSION_KEY,
      modelRef: null,
      messageCount: 0,
      usedTokens: null,
    }])]: {
      success: true,
      range: {
        sessionKey: SESSION_KEY,
        usedTokens: 0,
        maxTokens: 128000,
        truncatedMessageCount: 0,
        status: 'bestEffort',
      },
    },
    [stableStringify(['usage', 'live', {
      sessionKey: SESSION_KEY,
      runId: null,
      streaming: false,
    }])]: { success: true, usage: null },
    [stableStringify(['taskLedger', 'snapshot', { workspaceId: WORKSPACE_ID }])]: {
      success: true,
      snapshot: emptyLedgerSnapshot,
    },
  };
}

test.describe('Verse Claw chat slash commands', () => {
  test('discovers and dispatches quick actions from the composer', async ({ launchElectronApp }) => {
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
        hostApi: baseHostApiMocks(),
      });

      await app.evaluate((_, params) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const calls = {
          chatSend: [] as unknown[],
          ledgerCreate: [] as unknown[],
          ledgerLink: [] as unknown[],
          fork: [] as unknown[],
          knowledgeSearch: [] as unknown[],
          knowledgeReference: [] as unknown[],
        };
        const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          if (request.module === 'chat' && request.action === 'sendWithMedia') {
            calls.chatSend.push(request.payload);
            return respond(request.id, { success: true, result: {} });
          }
          if (request.module === 'taskLedger' && request.action === 'createNode') {
            calls.ledgerCreate.push(request.payload);
            return respond(request.id, {
              success: true,
              snapshot: {
                ...params.emptyLedgerSnapshot,
                nodes: [{
                  id: 'ledger-node-slash',
                  title: String(request.payload?.node && (request.payload.node as Record<string, unknown>).title),
                  kind: 'task',
                  status: 'todo',
                  updatedAt: '2026-06-21T00:00:00.000Z',
                }],
              },
            });
          }
          if (request.module === 'taskLedger' && request.action === 'linkSession') {
            calls.ledgerLink.push(request.payload);
            return respond(request.id, { success: true, snapshot: params.emptyLedgerSnapshot });
          }
          if (request.module === 'knowledge' && request.action === 'search') {
            calls.knowledgeSearch.push(request.payload);
            return respond(request.id, {
              success: true,
              results: [{
                id: 'wiki-context-page',
                title: 'Context Palette Notes',
                pagePath: 'knowledge/context-palette.md',
                snippet: 'Use slash commands to keep the composer clean.',
              }],
            });
          }
          if (request.module === 'knowledge' && request.action === 'recordKnowledgeReference') {
            calls.knowledgeReference.push(request.payload);
            return respond(request.id, { success: true });
          }
          if (request.module === 'sessions' && request.action === 'fork') {
            calls.fork.push(request.payload);
            return respond(request.id, {
              success: true,
              sourceSessionKey: params.sessionKey,
              sessionKey: 'agent:main:fork-slash',
              agentId: 'main',
              workspaceId: params.workspaceId,
              forkedFromParent: true,
              warnings: [],
            });
          }
          if (request.module === 'workspaces' && request.action === 'update') {
            return respond(request.id, {
              success: true,
              profiles: [params.workspace],
              activeWorkspaceId: params.workspaceId,
              activeWorkspace: params.workspace,
            });
          }
          return originalHostInvoke?.(event, request) ?? respond(request.id, {});
        });
        (globalThis as typeof globalThis & { __slashCalls?: typeof calls }).__slashCalls = calls;
      }, {
        emptyLedgerSnapshot,
        sessionKey: SESSION_KEY,
        workspace,
        workspaceId: WORKSPACE_ID,
      });

      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-input').fill('/');
      await expect(page.getByTestId('chat-slash-command-menu')).toBeVisible();
      await expect(page.getByTestId('chat-slash-command-menu')).toContainText('Pick an action for this message or session');
      await expect(page.getByTestId('chat-slash-command-option-wiki')).toContainText('Find source-backed wiki pages');
      await expect(page.getByTestId('chat-slash-command-option-review')).toContainText('/review');

      await page.getByTestId('chat-composer-input').fill('/wiki context palette');
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('chat-knowledge-scope-menu')).toBeVisible();
      await expect(page.getByTestId('chat-knowledge-search-input')).toHaveValue('context palette');
      await expect(page.getByTestId('chat-knowledge-search-result')).toContainText('Context Palette Notes');
      await page.getByTestId('chat-knowledge-search-result').click();
      await expect(page.getByTestId('chat-knowledge-selected')).toContainText('Context Palette Notes');

      await page.getByTestId('chat-composer-input').fill('/review auth flow');
      await page.keyboard.press('Enter');
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __slashCalls?: { chatSend: Array<{ message?: string }> } }).__slashCalls?.chatSend[0]?.message ?? ''
      )), { timeout: 30_000 }).toContain('Review the current changes as a code reviewer');

      await page.getByTestId('chat-composer-input').fill('/ledger Add release tests');
      await page.keyboard.press('Enter');
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __slashCalls?: { ledgerCreate: unknown[]; ledgerLink: unknown[] } }).__slashCalls
      )), { timeout: 30_000 }).toMatchObject({
        ledgerCreate: [expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          node: expect.objectContaining({ title: 'Add release tests' }),
        })],
        ledgerLink: [expect.objectContaining({
          sessionKey: SESSION_KEY,
          nodeId: 'ledger-node-slash',
        })],
      });
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/task-ledger');

      await page.evaluate(() => { window.location.hash = '/'; });
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('/mission');
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/settings/agents');

    } finally {
      await closeElectronApp(app);
    }
  });

  test('runs the existing fork flow from /fork', async ({ launchElectronApp }) => {
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
          [stableStringify(['chat.history', { sessionKey: 'agent:main:fork-slash', limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: baseHostApiMocks(),
      });

      await app.evaluate((_, params) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const calls = { fork: [] as unknown[] };
        const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          if (request.module === 'sessions' && request.action === 'fork') {
            calls.fork.push(request.payload);
            return respond(request.id, {
              success: true,
              sourceSessionKey: params.sessionKey,
              sessionKey: 'agent:main:fork-slash',
              agentId: 'main',
              workspaceId: params.workspaceId,
              forkedFromParent: true,
              warnings: [],
            });
          }
          if (request.module === 'workspaces' && (request.action === 'update' || request.action === 'saveState')) {
            return respond(request.id, {
              success: true,
              profiles: [params.workspace],
              activeWorkspaceId: params.workspaceId,
              activeWorkspace: params.workspace,
            });
          }
          if (request.module === 'taskLedger' && request.action === 'linkSession') {
            return respond(request.id, { success: true, snapshot: params.emptyLedgerSnapshot });
          }
          return originalHostInvoke?.(event, request) ?? respond(request.id, {});
        });
        (globalThis as typeof globalThis & { __slashForkCalls?: typeof calls }).__slashForkCalls = calls;
      }, {
        emptyLedgerSnapshot,
        sessionKey: SESSION_KEY,
        workspace,
        workspaceId: WORKSPACE_ID,
      });

      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-input').fill('/fork');
      await page.keyboard.press('Enter');

      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __slashForkCalls?: { fork: unknown[] } }).__slashForkCalls?.fork.length ?? 0
      )), { timeout: 30_000 }).toBeGreaterThan(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps the slash menu above the composer on a narrow viewport', async ({ launchElectronApp }) => {
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
        hostApi: baseHostApiMocks(),
      });

      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 390, height: 720 });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-input').fill('/');
      const menu = page.getByTestId('chat-slash-command-menu');
      await expect(menu).toBeVisible();

      const boxes = await page.evaluate(() => {
        const menuEl = document.querySelector('[data-testid="chat-slash-command-menu"]');
        const inputEl = document.querySelector('[data-testid="chat-composer-input"]');
        if (!(menuEl instanceof HTMLElement) || !(inputEl instanceof HTMLElement)) return null;
        const menuBox = menuEl.getBoundingClientRect();
        const inputBox = inputEl.getBoundingClientRect();
        return {
          menuBottom: menuBox.bottom,
          inputTop: inputBox.top,
          menuLeft: menuBox.left,
          menuRight: menuBox.right,
          viewportWidth: window.innerWidth,
        };
      });

      expect(boxes).not.toBeNull();
      expect(boxes!.menuBottom).toBeLessThanOrEqual(boxes!.inputTop + 2);
      expect(boxes!.menuLeft).toBeGreaterThanOrEqual(0);
      expect(boxes!.menuRight).toBeLessThanOrEqual(boxes!.viewportWidth);
    } finally {
      await closeElectronApp(app);
    }
  });
});
