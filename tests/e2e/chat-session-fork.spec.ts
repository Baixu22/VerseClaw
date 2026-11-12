import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SOURCE_SESSION_KEY = 'agent:main:main';
const FORK_SESSION_KEY = 'agent:main:fork-1711111111111';
const SOURCE_DRAFT = 'unsent fork draft';
/** #180: the fork row's parent-message timestamp drives the lineage line. */
const FORK_FORKED_FROM_TIMESTAMP = 1711111111000;
const HANDOFF_DRAFT = [
  '# Handoff: continue this Verse Claw conversation',
  '',
  'Fork failed because the parent context is too large.',
].join('\n');

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const sourceHistory = [
  {
    id: 'source-user-1',
    role: 'user',
    content: [{ type: 'text', text: 'Design the runtime-backed fork flow.' }],
    timestamp: 1711111110000,
  },
  {
    id: 'source-assistant-1',
    role: 'assistant',
    content: [{ type: 'text', text: 'Fork should preserve the active transcript branch.' }],
    timestamp: 1711111111000,
  },
];

const forkHistory = [
  ...sourceHistory,
  {
    id: 'fork-system-1',
    role: 'system',
    content: [{ type: 'text', text: '[Forked from parent session]' }],
    timestamp: 1711111112000,
  },
];

const sourceWorkspace = {
  id: 'workspace-a',
  name: 'Workspace A',
  rootPath: 'C:/workspace-a',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: SOURCE_SESSION_KEY,
  agentBindings: {
    main: {
      workspaceId: 'workspace-a',
      agentId: 'main',
      sessionKey: SOURCE_SESSION_KEY,
    },
  },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {
    activeTopicId: null,
    draftInput: SOURCE_DRAFT,
  },
  sessionStates: {
    [SOURCE_SESSION_KEY]: {
      activeTopicId: null,
      draftInput: SOURCE_DRAFT,
      workMode: 'build',
      selectedModelRef: 'openai:gpt-test',
      knowledgeScope: 'memory',
      recentFiles: ['src/pages/Chat/index.tsx'],
    },
  },
};

function buildForkWorkspace() {
  return {
    ...sourceWorkspace,
    activeSessionKey: FORK_SESSION_KEY,
    agentBindings: {
      main: {
        workspaceId: 'workspace-a',
        agentId: 'main',
        sessionKey: FORK_SESSION_KEY,
      },
    },
    state: {
      activeTopicId: null,
      draftInput: SOURCE_DRAFT,
      workMode: 'build',
      selectedModelRef: 'openai:gpt-test',
      knowledgeScope: 'memory',
      recentFiles: ['src/pages/Chat/index.tsx'],
    },
    sessionStates: {
      ...sourceWorkspace.sessionStates,
      [FORK_SESSION_KEY]: {
        activeTopicId: null,
        draftInput: SOURCE_DRAFT,
        workMode: 'build',
        selectedModelRef: 'openai:gpt-test',
        knowledgeScope: 'memory',
        recentFiles: ['src/pages/Chat/index.tsx'],
      },
    },
  };
}

function baseHostApiMocks() {
  return {
    [stableStringify(['providers', 'accounts', null])]: [{
      id: 'test-provider',
      name: 'Test Provider',
      type: 'custom',
      vendorId: 'custom',
      enabled: true,
      authMode: 'api_key',
      createdAt: 1,
      updatedAt: 1,
    }],
    [stableStringify(['providers', 'accountKeyInfo', null])]: [{
      accountId: 'test-provider',
      hasKey: true,
      keyMasked: 'sk-***',
    }],
    [stableStringify(['providers', 'vendors', null])]: [],
    [stableStringify(['providers', 'getDefaultAccount', null])]: { accountId: 'test-provider' },
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
        json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
      },
    },
    [stableStringify(['/api/workspaces', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, workspaces: [sourceWorkspace], activeWorkspaceId: 'workspace-a' },
      },
    },
    [stableStringify(['workspaces', 'getActive', null])]: {
      success: true,
      activeWorkspaceId: 'workspace-a',
      activeWorkspace: sourceWorkspace,
    },
    [stableStringify(['workspaces', 'list', null])]: {
      success: true,
      profiles: [sourceWorkspace],
      activeWorkspaceId: 'workspace-a',
      activeWorkspace: sourceWorkspace,
    },
    [stableStringify(['sessions', 'fork', {
      sessionKey: SOURCE_SESSION_KEY,
      agentId: 'main',
      workspaceId: 'workspace-a',
    }])]: {
      success: true,
      sourceSessionKey: SOURCE_SESSION_KEY,
      sessionKey: FORK_SESSION_KEY,
      agentId: 'main',
      workspaceId: 'workspace-a',
      forkedFromParent: true,
      warnings: [],
    },
    [stableStringify(['sessions', 'compactionStatus', {
      sessionKey: SOURCE_SESSION_KEY,
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
    [stableStringify(['sessions', 'compactionStatus', {
      sessionKey: FORK_SESSION_KEY,
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
      sessionKey: SOURCE_SESSION_KEY,
      modelRef: null,
      messageCount: 2,
      usedTokens: null,
    }])]: {
      success: true,
      range: {
        sessionKey: SOURCE_SESSION_KEY,
        usedTokens: 12000,
        maxTokens: 128000,
        truncatedMessageCount: 0,
        status: 'bestEffort',
      },
    },
    [stableStringify(['usage', 'contextRange', {
      sessionKey: FORK_SESSION_KEY,
      modelRef: null,
      messageCount: 2,
      usedTokens: null,
    }])]: {
      success: true,
      range: {
        sessionKey: FORK_SESSION_KEY,
        usedTokens: 12000,
        maxTokens: 128000,
        truncatedMessageCount: 0,
        status: 'bestEffort',
      },
    },
    [stableStringify(['usage', 'live', {
      sessionKey: SOURCE_SESSION_KEY,
      runId: null,
      streaming: false,
    }])]: {
      success: true,
      usage: null,
    },
    [stableStringify(['usage', 'live', {
      sessionKey: FORK_SESSION_KEY,
      runId: null,
      streaming: false,
    }])]: {
      success: true,
      usage: null,
    },
    [stableStringify(['taskLedger', 'linkSession', {
      workspaceId: 'workspace-a',
      sessionKey: FORK_SESSION_KEY,
      agentId: 'main',
      relation: 'forked_from',
      sourceSessionKey: SOURCE_SESSION_KEY,
      summary: 'Forked conversation branch',
      idempotencyKey: `session-fork:${SOURCE_SESSION_KEY}:${FORK_SESSION_KEY}`,
    }])]: {
      success: true,
      nodes: [],
      edges: [],
      events: [],
      warnings: [],
      sessionLinks: [],
      recentDecisions: [],
      blockedNodeIds: [],
      reviewNodeIds: [],
      exportedAt: new Date(0).toISOString(),
      workspaceId: 'workspace-a',
    },
  };
}

test.describe('Verse Claw chat session fork', () => {
  test('creates and selects a forked session with inherited history and copied draft without auto-send', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SOURCE_SESSION_KEY, sessionId: 'fork-source-generation', displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SOURCE_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: sourceHistory },
          },
          [stableStringify(['chat.history', { sessionKey: FORK_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: forkHistory },
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
          chatSend: 0,
          workspaceUpdate: [] as unknown[],
          workspaceSaveState: [] as unknown[],
          sourceHistoryLoads: 0,
          forkHistoryLoads: 0,
        };
        const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
        let savedSourceDraft = params.sourceDraft;
        const buildWorkspace = () => ({
          ...params.forkWorkspace,
          state: {
            ...params.forkWorkspace.state,
            draftInput: savedSourceDraft,
          },
          sessionStates: {
            ...params.forkWorkspace.sessionStates,
            [params.sourceSessionKey]: {
              ...(params.forkWorkspace.sessionStates as Record<string, object>)[params.sourceSessionKey],
              draftInput: savedSourceDraft,
            },
            [params.forkSessionKey]: {
              ...(params.forkWorkspace.sessionStates as Record<string, object>)[params.forkSessionKey],
              draftInput: savedSourceDraft,
            },
          },
        });

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          if (request.module === 'workspaces' && request.action === 'update') {
            calls.workspaceUpdate.push(request.payload);
            const state = request.payload?.state;
            if (
              request.payload?.sessionKey === params.sourceSessionKey
              && state
              && typeof state === 'object'
              && typeof (state as Record<string, unknown>).draftInput === 'string'
            ) {
              savedSourceDraft = String((state as Record<string, unknown>).draftInput);
            }
            return respond(request.id, {
              success: true,
              profiles: [buildWorkspace()],
              activeWorkspaceId: 'workspace-a',
              activeWorkspace: buildWorkspace(),
            });
          }
          if (request.module === 'workspaces' && request.action === 'saveState') {
            calls.workspaceSaveState.push(request.payload);
            const state = request.payload?.state;
            if (
              request.payload?.sessionKey === params.sourceSessionKey
              && state
              && typeof state === 'object'
              && typeof (state as Record<string, unknown>).draftInput === 'string'
            ) {
              savedSourceDraft = String((state as Record<string, unknown>).draftInput);
            }
            return respond(request.id, { success: true });
          }
          if (request.module === 'workspaces' && request.action === 'list') {
            return respond(request.id, {
              success: true,
              profiles: calls.workspaceSaveState.some((value) => (value as { sessionKey?: string }).sessionKey === params.forkSessionKey) ? [buildWorkspace()] : [params.sourceWorkspace],
              activeWorkspaceId: 'workspace-a',
              activeWorkspace: calls.workspaceSaveState.some((value) => (value as { sessionKey?: string }).sessionKey === params.forkSessionKey) ? buildWorkspace() : params.sourceWorkspace,
            });
          }
          if (request.module === 'workspaces' && request.action === 'getActive') {
            return respond(request.id, {
              success: true,
              activeWorkspaceId: 'workspace-a',
              activeWorkspace: calls.workspaceSaveState.some((value) => (value as { sessionKey?: string }).sessionKey === params.forkSessionKey) ? buildWorkspace() : params.sourceWorkspace,
            });
          }
          if (request.module === 'gateway' && request.action === 'rpc') {
            const payload = request.payload ?? {};
            if (payload.method === 'sessions.list' && calls.workspaceSaveState.some((value) => (value as { sessionKey?: string }).sessionKey === params.forkSessionKey)) {
              return respond(request.id, {
                sessions: [
                  { key: params.sourceSessionKey, sessionId: 'fork-source-generation', displayName: 'main' },
                  {
                    key: params.forkSessionKey,
                    sessionId: 'fork-child-generation',
                    displayName: 'Forked main',
                    parentSessionKey: params.sourceSessionKey,
                    forkedFromParent: true,
                    forkedFromTimestamp: params.forkedFromTimestamp,
                  },
                ],
              });
            }
            if (payload.method === 'chat.history') {
              const rpcParams = payload.params as { sessionKey?: string } | undefined;
              if (rpcParams?.sessionKey === params.sourceSessionKey) calls.sourceHistoryLoads += 1;
              if (rpcParams?.sessionKey === params.forkSessionKey) calls.forkHistoryLoads += 1;
              if (rpcParams?.sessionKey === params.forkSessionKey) {
                return respond(request.id, { messages: params.forkHistory });
              }
              return respond(request.id, { messages: params.sourceHistory });
            }
          }
          if (request.module === 'chat' && request.action === 'sendWithMedia') {
            calls.chatSend += 1;
            return respond(request.id, { success: true, result: { runId: 'unexpected' } });
          }
          if (request.module === 'sessions' && request.action === 'fork') {
            return respond(request.id, { success: true, sourceSessionKey: params.sourceSessionKey,
              sessionKey: params.forkSessionKey, forkedFromParent: true });
          }
          return originalHostInvoke?.(event, request) ?? respond(request.id, {});
        });
        (globalThis as typeof globalThis & { __forkCalls?: typeof calls }).__forkCalls = calls;
      }, {
        sourceSessionKey: SOURCE_SESSION_KEY,
        forkSessionKey: FORK_SESSION_KEY,
        sourceDraft: SOURCE_DRAFT,
        sourceWorkspace,
        sourceHistory,
        forkHistory,
        forkWorkspace: buildForkWorkspace(),
        forkedFromTimestamp: FORK_FORKED_FROM_TIMESTAMP,
      });

      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText('Design the runtime-backed fork flow.')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill(SOURCE_DRAFT);

      await page.getByTestId('chat-toolbar-more').click();
      await expect(page.getByTestId('chat-session-fork')).toBeVisible();
      await expect(page.getByTestId('chat-session-handoff')).toBeVisible();
      await expect(page.getByTestId('chat-session-fork-recommended')).toBeVisible();
      await expect(page.getByTestId('chat-session-handoff-recommended')).toHaveCount(0);
      await page.getByTestId('chat-session-fork').click();

      await expect.poll(async () => app.evaluate(() => {
        const calls = (globalThis as typeof globalThis & {
          __forkCalls?: { workspaceSaveState: Array<{ activeSessionKey?: string }>; forkHistoryLoads: number };
        }).__forkCalls;
        return {
          workspaceActivationCount: calls?.workspaceSaveState.filter((value) => value.activeSessionKey === "agent:main:fork-1711111111111").length ?? 0,
          forkHistoryLoads: calls?.forkHistoryLoads ?? 0,
        };
      }), { timeout: 30_000 }).toEqual({
        workspaceActivationCount: 1,
        forkHistoryLoads: expect.any(Number),
      });
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __forkCalls?: { forkHistoryLoads: number } }).__forkCalls?.forkHistoryLoads ?? 0
      )), { timeout: 30_000 }).toBeGreaterThan(0);
      await expect(page.getByText('Fork should preserve the active transcript branch.')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-input')).toHaveValue(SOURCE_DRAFT);
      await page.getByTestId('chat-toolbar-more').click();
      // #180: the lineage line names the parent by its display name, not the raw
      // session key (the key is already shown on the line above it).
      const lineageLine = page.getByTestId('chat-session-lineage');
      await expect(lineageLine).toBeVisible();
      await expect(lineageLine).toContainText('main');
      await expect(lineageLine).not.toContainText(SOURCE_SESSION_KEY);
      // #180: the fork row carries the parent-message timestamp, so the lineage
      // line shows where in the parent's transcript the branch was cut.
      const expectedForkTime = await page.evaluate((ms) => new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(ms)), FORK_FORKED_FROM_TIMESTAMP);
      await expect(lineageLine).toContainText(expectedForkTime);
      await page.keyboard.press('Escape');
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __forkCalls?: { chatSend: number } }).__forkCalls?.chatSend ?? 0
      ))).toBe(0);
      const calls = await app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __forkCalls?: {
            workspaceUpdate: unknown[];
            workspaceSaveState: unknown[];
            sourceHistoryLoads: number;
            forkHistoryLoads: number;
          };
        }).__forkCalls
      ));
      expect(calls?.workspaceSaveState).toContainEqual(expect.objectContaining({
        id: 'workspace-a',
        sessionKey: SOURCE_SESSION_KEY,
        state: expect.objectContaining({
          draftInput: SOURCE_DRAFT,
        }),
      }));
      expect(calls?.workspaceSaveState).toContainEqual(expect.objectContaining({
        id: 'workspace-a',
        sessionKey: FORK_SESSION_KEY,
        state: expect.objectContaining({
          draftInput: SOURCE_DRAFT,
          selectedModelRef: 'openai:gpt-test',
          knowledgeScope: 'memory',
        }),
      }));
      expect(calls?.sourceHistoryLoads).toBeGreaterThan(0);
      expect(calls?.forkHistoryLoads).toBeGreaterThan(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('offers handoff preparation when fork fails because the parent is too large', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SOURCE_SESSION_KEY, sessionId: 'fork-source-generation', displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SOURCE_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: sourceHistory },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['sessions', 'fork', {
            sessionKey: SOURCE_SESSION_KEY,
            agentId: 'main',
            workspaceId: 'workspace-a',
          }])]: {
            success: false,
            sourceSessionKey: SOURCE_SESSION_KEY,
            sessionKey: null,
            forkedFromParent: false,
            error: 'Parent context is too large to fork',
          },
          [stableStringify(['sessions', 'prepareHandoff', {
            sessionKey: SOURCE_SESSION_KEY,
            agentId: 'main',
            workspaceId: 'workspace-a',
          }])]: {
            success: true,
            checkpoint: {
              trigger: 'session_rotation',
              sessionKey: SOURCE_SESSION_KEY,
              agentId: 'main',
              workspaceId: 'workspace-a',
              objective: 'continue after large parent fork failure',
              filesTouched: [],
              testsRun: [],
              evidenceRefs: [],
            },
            draft: HANDOFF_DRAFT,
            sources: [
              { id: 'transcript', label: 'Recent transcript', available: true, summary: '2 recent messages' },
            ],
            warnings: ['Fork parent exceeded the runtime fork limit.'],
          },
        },
      });
      await app.evaluate(() => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const calls = { workspaceUpdate: [] as unknown[] };
        const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          if (request.module === 'sessions' && request.action === 'fork') return respond(request.id, {
            success: false, sessionKey: null, error: 'Parent context is too large to fork',
          });
          if (request.module === 'workspaces' && request.action === 'saveState') return respond(request.id, { success: true });
          if (request.module === 'workspaces' && request.action === 'update') {
            calls.workspaceUpdate.push(request.payload);
          }
          return originalHostInvoke?.(event, request) ?? respond(request.id, {});
        });
        (globalThis as typeof globalThis & { __forkFailureCalls?: typeof calls }).__forkFailureCalls = calls;
      });

      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      await page.getByTestId('chat-toolbar-more').click();
      await page.getByTestId('chat-session-fork').click();
      await expect(page.getByText('Transcript is too large to fork')).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Prepare handoff' }).click();

      await expect(page.getByTestId('chat-handoff-dialog')).toBeVisible();
      await expect(page.getByTestId('chat-handoff-draft')).toHaveValue(HANDOFF_DRAFT);
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __forkFailureCalls?: { workspaceUpdate: unknown[] } }).__forkFailureCalls?.workspaceUpdate.length ?? 0
      ))).toBe(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('disables fork entry points while a run is active', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: SOURCE_SESSION_KEY, sessionId: 'fork-source-generation', displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SOURCE_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.send', null])]: {
            success: true,
            result: { runId: 'run-fork-e2e' },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['/api/chat/send', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, result: { runId: 'run-fork-e2e' } },
            },
          },
        },
      });
      await app.evaluate(() => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          if (request.module === 'chat' && request.action === 'sendWithMedia') {
            return respond(request.id, { success: true, result: { runId: 'run-fork-e2e' } });
          }
          return originalHostInvoke?.(event, request) ?? respond(request.id, {});
        });
      });

      const page = await getStableWindow(app);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('run long task');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('chat-composer-fork')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-handoff')).toHaveCount(0);

      await page.getByTestId('chat-toolbar-more').click();
      await expect(page.getByTestId('chat-session-fork')).toBeDisabled();
      await expect(page.getByTestId('chat-session-handoff')).toBeDisabled();
    } finally {
      await closeElectronApp(app);
    }
  });
});
