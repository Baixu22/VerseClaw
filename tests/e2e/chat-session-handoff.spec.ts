import { closeElectronApp, expect, getAgentDevHostCalls, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const SESSION_GENERATION_UNAVAILABLE_REASON = 'The session identity is unavailable. Refresh before continuing.';
const HANDOFF_DRAFT = [
  '# Handoff: continue this Verse Claw conversation',
  '',
  '## Resume checkpoint',
  'Objective: implement the handoff MVP.',
  '',
  '## Read-only context recall',
  'Verified archive recall restored the last compacted observation.',
].join('\n');

const handoffHistory = [
  {
    id: 'handoff-user-1',
    role: 'user',
    content: [{ type: 'text', text: 'Continue the handoff MVP implementation.' }],
    timestamp: 1711111110000,
  },
  {
    id: 'handoff-assistant-1',
    role: 'assistant',
    content: [{ type: 'text', text: 'The next step is verifying continuity UX behavior.' }],
    timestamp: 1711111111000,
  },
];

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const activeWorkspace = {
  id: 'workspace-a',
  name: 'Workspace A',
  rootPath: 'C:/workspace-a',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: MAIN_SESSION_KEY,
  agentBindings: {
    main: {
      workspaceId: 'workspace-a',
      agentId: 'main',
      sessionKey: MAIN_SESSION_KEY,
    },
  },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: {},
};

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
    [stableStringify(['/api/chat/sessions', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: {
          success: true,
          result: { sessions: [{ key: MAIN_SESSION_KEY, sessionId: 'main-generation', displayName: 'main' }] },
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
        json: { success: true, workspaces: [activeWorkspace], activeWorkspaceId: 'workspace-a' },
      },
    },
    [stableStringify(['workspaces', 'getActive', null])]: {
      success: true,
      activeWorkspaceId: 'workspace-a',
      activeWorkspace,
    },
    [stableStringify(['sessions', 'prepareHandoff', {
      sessionKey: MAIN_SESSION_KEY,
      agentId: 'main',
      workspaceId: 'workspace-a',
    }])]: {
      success: true,
      checkpoint: {
        trigger: 'session_rotation',
        sessionKey: MAIN_SESSION_KEY,
        agentId: 'main',
        workspaceId: 'workspace-a',
        objective: 'implement the handoff MVP',
        filesTouched: ['src/pages/Chat/index.tsx'],
        testsRun: [],
        evidenceRefs: [{ type: 'session', ref: MAIN_SESSION_KEY, label: 'Source conversation' }],
      },
      draft: HANDOFF_DRAFT,
      sources: [
        { id: 'runtime_checkpoint', label: 'Runtime checkpoint', available: true, summary: 'session_rotation checkpoint' },
        { id: 'context_recall', label: 'Context recall', available: true, summary: 'Verified archive recall' },
        { id: 'transcript', label: 'Recent transcript', available: true, summary: '2 recent messages' },
        { id: 'task_ledger', label: 'Task Ledger', available: true, summary: '1 node' },
        { id: 'git', label: 'Git status', available: true, summary: 'main: clean' },
        { id: 'observability', label: 'Recent run/trace', available: true, summary: 'No recent trace data.' },
      ],
      warnings: [],
    },
    [stableStringify(['sessions', 'compactionStatus', {
      sessionKey: MAIN_SESSION_KEY,
      agentId: 'main',
    }])]: {
      success: true,
      available: true,
      canCompact: true,
      inProgress: false,
      pressure: 'high',
      truncatedMessageCount: 0,
      warnings: [],
    },
    [stableStringify(['usage', 'contextRange', {
      sessionKey: MAIN_SESSION_KEY,
      modelRef: null,
      messageCount: 0,
      usedTokens: null,
    }])]: {
      success: true,
      range: {
        sessionKey: MAIN_SESSION_KEY,
        usedTokens: 120000,
        maxTokens: 128000,
        truncatedMessageCount: 0,
        status: 'bestEffort',
      },
    },
    [stableStringify(['usage', 'contextRange', {
      sessionKey: MAIN_SESSION_KEY,
      modelRef: null,
      messageCount: 2,
      usedTokens: null,
    }])]: {
      success: true,
      range: {
        sessionKey: MAIN_SESSION_KEY,
        usedTokens: 120000,
        maxTokens: 128000,
        truncatedMessageCount: 0,
        status: 'bestEffort',
      },
    },
    [stableStringify(['usage', 'live', {
      sessionKey: MAIN_SESSION_KEY,
      runId: null,
      streaming: false,
    }])]: {
      success: true,
      usage: null,
    },
    [stableStringify(['taskLedger', 'linkSession', {
      workspaceId: 'workspace-a',
      sessionKey: 'agent:main:session-1711111111111-4fzyo8',
      agentId: 'main',
      relation: 'handoff_from',
      sourceSessionKey: MAIN_SESSION_KEY,
      summary: 'Handoff session created from agent:main:main',
      idempotencyKey: 'handoff:agent:main:main:agent:main:session-1711111111111-4fzyo8',
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

test.describe('Verse Claw chat session handoff', () => {
  test('keeps a sidebar handoff intent until a cold session generation hydrates', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpcByMethod: {
          'sessions.list': { sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }] },
        },
        gatewayRpc: {
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: { success: true, result: { messages: handoffHistory } },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['sessions', 'history', null])]: { messages: handoffHistory, hasMore: false },
        },
      });

      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('chat-project-session-header')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-toolbar-more').click();
      const headerHandoff = page.getByTestId('chat-session-handoff');
      await expect(headerHandoff).toBeDisabled();
      await expect(headerHandoff).toHaveAttribute('title', SESSION_GENERATION_UNAVAILABLE_REASON);
      await page.keyboard.press('Escape');

      await page.getByTestId('chat-composer-actions').click();
      await page.getByTestId('chat-composer-action-more').click();
      const composerHandoff = page.getByTestId('chat-composer-action-handoff');
      await composerHandoff.scrollIntoViewIfNeeded();
      await expect(composerHandoff).toBeVisible();
      await expect(composerHandoff).toBeDisabled();
      await expect(composerHandoff).toHaveAttribute('title', SESSION_GENERATION_UNAVAILABLE_REASON);
      await expect(composerHandoff).toContainText(SESSION_GENERATION_UNAVAILABLE_REASON);
      await page.screenshot({ path: testInfo.outputPath('handoff-generation-pending.png') });
      await page.getByTestId('chat-composer-actions').click();

      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click({ button: 'right' });
      await page.getByTestId('sidebar-session-context-handoff').click();
      await expect(page.getByTestId('chat-handoff-dialog')).toHaveCount(0);
      expect((await getAgentDevHostCalls(page)).filter((value) => {
        const call = value as { module?: string; action?: string };
        return call.module === 'sessions' && call.action === 'prepareHandoff';
      })).toHaveLength(0);

      await page.waitForTimeout(1_300);
      await installIpcMocks(app, { gatewayRpcByMethod: {
        'sessions.list': { sessions: [{ key: MAIN_SESSION_KEY, sessionId: 'main-generation', displayName: 'main' }] },
      } });
      await page.getByTestId('chat-toolbar-more').click(); await page.getByTestId('chat-toolbar-refresh').click();
      await expect(page.getByTestId('chat-handoff-dialog')).toBeVisible();
      await expect(page.getByTestId('chat-handoff-draft')).toHaveValue(HANDOFF_DRAFT);
      await page.screenshot({ path: testInfo.outputPath('handoff-generation-ready.png') });
      await expect.poll(async () => (await getAgentDevHostCalls(page)).filter((value) => {
        const call = value as { module?: string; action?: string; payload?: { sessionKey?: string } };
        return call.module === 'sessions' && call.action === 'prepareHandoff' && call.payload?.sessionKey === MAIN_SESSION_KEY;
      }).length).toBe(1);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('keeps the current handoff draft when an old conversation responds late', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    const otherKey = 'agent:main:session-isolation-b';
    const isolationWorkspace = { ...activeWorkspace, sessionStates: { [MAIN_SESSION_KEY]: {}, [otherKey]: {} } };
    const sessions = [{ key: MAIN_SESSION_KEY, sessionId: 'conversation-a-generation', displayName: 'Conversation A', workspaceId: 'workspace-a', updatedAt: Date.now(), messageCount: 2 }, { key: otherKey, sessionId: 'conversation-b-generation', displayName: 'Conversation B', workspaceId: 'workspace-a', updatedAt: Date.now(), messageCount: 2 }];
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: { success: true, result: { sessions } },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: { success: true, result: { messages: handoffHistory } },
          [stableStringify(['chat.history', { sessionKey: otherKey, limit: 200, maxChars: 500000 }])]: { success: true, result: { messages: handoffHistory } },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['sessions', 'history', null])]: { messages: handoffHistory, hasMore: false },
          [stableStringify(['workspaces', 'list', null])]: { success: true, profiles: [isolationWorkspace], activeWorkspaceId: 'workspace-a', activeWorkspace: isolationWorkspace },
          [stableStringify(['workspaces', 'getActive', null])]: { success: true, activeWorkspaceId: 'workspace-a', activeWorkspace: isolationWorkspace },
          [stableStringify(['/api/workspaces', 'GET'])]: { ok: true, data: { status: 200, ok: true, json: { success: true, workspaces: [isolationWorkspace], activeWorkspaceId: 'workspace-a' } } },
          [stableStringify(['/api/chat/sessions', 'GET'])]: { ok: true, data: { status: 200, ok: true, json: { success: true, result: { sessions } } } },
        },
      });
      await app.evaluate(({ ipcMain }, { sourceKey, workspace }) => {
        const original = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers.get('host:invoke');
        const state = { requested: false, release: () => {} };
        (globalThis as typeof globalThis & { __handoffIsolation?: typeof state }).__handoffIsolation = state;
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event, request: { id?: string; module?: string; action?: string;
          payload?: { sessionKey?: string; activeSessionKey?: string; state?: Record<string, unknown> } }) => {
          if (request.module === 'workspaces' && request.action === 'saveState') {
            const key = request.payload?.sessionKey ?? request.payload?.activeSessionKey ?? workspace.activeSessionKey;
            const sessionStates = workspace.sessionStates as Record<string, Record<string, unknown>>;
            sessionStates[key] = { ...sessionStates[key], ...request.payload?.state };
            if (request.payload?.activeSessionKey) workspace.activeSessionKey = request.payload.activeSessionKey;
            return { id: request.id, ok: true, data: { success: true } };
          }
          if (request.module === 'workspaces' && ['list', 'getActive'].includes(request.action ?? '')) {
            return { id: request.id, ok: true, data: { success: true, profiles: [workspace],
              activeWorkspaceId: workspace.id, activeWorkspace: workspace } };
          }
          if (request.module === 'sessions' && request.action === 'prepareHandoff') {
            const old = request.payload?.sessionKey === sourceKey;
            if (old) {
              state.requested = true;
              await new Promise<void>(resolve => { state.release = resolve; });
            }
            return { id: request.id, ok: true, data: { success: true, draft: old ? 'Late draft from A' : 'Current draft from B', sources: [], warnings: [] } };
          }
          return original?.(event, request);
        });
      }, { sourceKey: MAIN_SESSION_KEY, workspace: isolationWorkspace });
      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('chat-composer-input')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('handoff-isolation-ready.png') });
      await page.getByTestId('chat-toolbar-more').click();
      await page.getByTestId('chat-session-handoff').click();
      await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { __handoffIsolation?: { requested: boolean } }).__handoffIsolation?.requested)).toBe(true);
      await page.getByTestId(`sidebar-session-${otherKey}`).click();
      await expect(page.getByTestId(`sidebar-session-${otherKey}`).locator('xpath=ancestor::div[contains(@class, "sidebar-row")][1]')).toHaveClass(/\bselected\b/);
      await page.getByTestId('chat-toolbar-more').click();
      await expect(page.getByTestId('chat-session-handoff')).toBeEnabled();
      await page.getByTestId('chat-session-handoff').click();
      await expect(page.getByTestId('chat-handoff-draft')).toHaveValue('Current draft from B');
      await app.evaluate(() => (globalThis as typeof globalThis & { __handoffIsolation?: { release: () => void } }).__handoffIsolation?.release());
      await expect.poll(async () => (await getAgentDevHostCalls(page)).some(value => {
        const call = value as { module?: string; action?: string; payload?: { sessionKey?: string }; endedAt?: number };
        return call.module === 'sessions' && call.action === 'prepareHandoff' && call.payload?.sessionKey === MAIN_SESSION_KEY && typeof call.endedAt === 'number';
      })).toBe(true);
      await expect(page.getByTestId('chat-handoff-draft')).toHaveValue('Current draft from B');
    } finally {
      await app.evaluate(() => (globalThis as typeof globalThis & { __handoffIsolation?: { release: () => void } }).__handoffIsolation?.release()).catch(() => {});
      await closeElectronApp(app);
    }
  });

  test('previews, edits, creates and sends the reviewed handoff with a recoverable child draft', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: MAIN_SESSION_KEY, sessionId: 'main-generation', displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: handoffHistory },
          },
        },
        hostApi: baseHostApiMocks(),
      });
      await app.evaluate(() => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const calls = { chatSend: 0, createHandoff: [] as unknown[], taskLedgerLink: [] as unknown[], workspaceUpdate: [] as unknown[], draftInput: '', operationId: '', activated: false };
        const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
        const buildWorkspace = (draftInput: string) => {
          const sessionKey = 'agent:main:session-1711111111111-4fzyo8';
          return {
            id: 'workspace-a',
            name: 'Workspace A',
            rootPath: 'C:/workspace-a',
            agentId: 'main',
            selectedAgentId: 'main',
            activeSessionKey: calls.activated ? sessionKey : 'agent:main:main',
            agentBindings: { main: { workspaceId: 'workspace-a', agentId: 'main', sessionKey: calls.activated ? sessionKey : 'agent:main:main' } },
            permissionMode: 'acceptEdits',
            createdAt: 1,
            updatedAt: 1,
            lastOpenedAt: 1,
            state: { activeTopicId: null, draftInput },
            sessionStates: { [sessionKey]: { activeTopicId: null, draftInput } },
          };
        };

        Date.now = () => 1711111111111;
        Math.random = () => 0.123456;
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          if (request.module === 'sessions' && request.action === 'createHandoff') {
            calls.createHandoff.push(request.payload);
            calls.draftInput = String(request.payload?.draftInput ?? '');
            calls.operationId = String(request.payload?.operationId ?? '');
            const sessionKey = 'agent:main:session-1711111111111-4fzyo8';
            calls.workspaceUpdate.push({ id: 'workspace-a', activeSessionKey: sessionKey, sessionKey, state: { activeTopicId: null, draftInput: calls.draftInput } });
            return respond(request.id, { success: true, sessionKey, handoffDepth: 1 });
          }
          if (request.module === 'workspaces' && request.action === 'saveState') {
            if (request.payload?.activeSessionKey === 'agent:main:session-1711111111111-4fzyo8') calls.activated = true;
            return respond(request.id, { success: true });
          }
          if (request.module === 'sessions' && request.action === 'handoffOperation' && calls.operationId) {
            return respond(request.id, { success: true, operation: { id: calls.operationId,
              sessionKey: 'agent:main:session-1711111111111-4fzyo8', phase: calls.chatSend ? 'accepted' : 'created' } });
          }
          if (request.module === 'gateway' && request.action === 'rpc' && request.payload?.method === 'sessions.list' && calls.draftInput) {
            return respond(request.id, { sessions: [{ key: 'agent:main:main', sessionId: 'source-generation', displayName: 'main' },
              { key: 'agent:main:session-1711111111111-4fzyo8', sessionId: 'child-generation', parentSessionKey: 'agent:main:main' }] });
          }
          if (request.module === 'workspaces' && request.action === 'update') {
            calls.workspaceUpdate.push(request.payload);
            const state = request.payload?.state;
            if (state && typeof state === 'object' && typeof (state as Record<string, unknown>).draftInput === 'string') {
              calls.draftInput = String((state as Record<string, unknown>).draftInput);
            }
            const workspace = buildWorkspace(calls.draftInput);
            return respond(request.id, {
              success: true,
              profiles: [workspace],
              activeWorkspaceId: 'workspace-a',
              activeWorkspace: workspace,
            });
          }
          if (request.module === 'workspaces' && request.action === 'list' && calls.draftInput) {
            const workspace = buildWorkspace(calls.draftInput);
            return respond(request.id, {
              success: true,
              profiles: [workspace],
              activeWorkspaceId: 'workspace-a',
              activeWorkspace: workspace,
            });
          }
          if (request.module === 'workspaces' && request.action === 'getActive' && calls.draftInput) {
            const workspace = buildWorkspace(calls.draftInput);
            return respond(request.id, {
              success: true,
              activeWorkspaceId: 'workspace-a',
              activeWorkspace: workspace,
            });
          }
          if (request.module === 'chat' && request.action === 'sendWithMedia') {
            calls.chatSend += 1;
            return respond(request.id, { success: true, result: { runId: 'unexpected' } });
          }
          if (request.module === 'taskLedger' && request.action === 'linkSession') {
            calls.taskLedgerLink.push(request.payload);
          }
          return originalHostInvoke?.(event, request) ?? respond(request.id, {});
        });
        (globalThis as typeof globalThis & { __handoffCalls?: typeof calls }).__handoffCalls = calls;
      });

      const page = await getStableWindow(app);
      await page.addInitScript(() => {
        Date.now = () => 1711111111111;
        Math.random = () => 0.123456;
      });
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      await page.getByTestId('chat-toolbar-more').click();
      await expect(page.getByTestId('chat-session-fork')).toBeVisible();
      await expect(page.getByTestId('chat-session-handoff')).toBeVisible();
      await expect(page.getByTestId('chat-session-handoff-recommended')).toBeVisible();
      await expect(page.getByTestId('chat-session-fork-recommended')).toHaveCount(0);
      await page.getByTestId('chat-session-handoff').click();
      await expect(page.getByTestId('chat-handoff-dialog')).toBeVisible();
      await expect(page.getByTestId('chat-handoff-recommendation-note')).toBeVisible();
      await expect(page.getByTestId('chat-handoff-dialog').getByText('Runtime checkpoint', { exact: true }))
        .toBeVisible();
      await expect(page.getByTestId('chat-handoff-dialog').getByText('Context recall', { exact: true }))
        .toBeVisible();
      await expect(page.getByTestId('chat-handoff-dialog').getByText('Recent transcript', { exact: true }))
        .toBeVisible();
      await expect(page.getByTestId('chat-handoff-dialog').getByText('Task Ledger', { exact: true }))
        .toBeVisible();
      await expect(page.getByTestId('chat-handoff-draft'))
        .toHaveValue(/Handoff: continue this Verse Claw conversation/);
      await expect(page.getByTestId('chat-handoff-draft'))
        .toHaveValue(/Verified archive recall restored the last compacted observation/);

      const editedDraft = `${HANDOFF_DRAFT}\n\nContinue by running the targeted tests.`;
      await page.getByTestId('chat-handoff-draft').fill(editedDraft);
      await page.getByTestId('chat-handoff-create').click();

      await expect(page.getByTestId('chat-handoff-dialog')).toBeHidden();
      await expect(page.getByTestId('chat-composer-input')).toHaveValue('');
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __handoffCalls?: { chatSend: number } }).__handoffCalls?.chatSend ?? 0
      ))).toBeGreaterThan(0);
      const workspaceUpdates = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __handoffCalls?: { workspaceUpdate: unknown[] } }).__handoffCalls?.workspaceUpdate ?? []
      ));
      expect(workspaceUpdates).toContainEqual(expect.objectContaining({
        id: expect.any(String),
        activeSessionKey: 'agent:main:session-1711111111111-4fzyo8',
        sessionKey: 'agent:main:session-1711111111111-4fzyo8',
        state: { activeTopicId: null, draftInput: editedDraft },
      }));
      const creations = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __handoffCalls?: { createHandoff: unknown[] } }).__handoffCalls?.createHandoff ?? []
      ));
      expect(creations).toEqual([expect.objectContaining({ sessionKey: MAIN_SESSION_KEY, workspaceId: 'workspace-a', draftInput: editedDraft })]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('disables handoff entry points while a run is active', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: MAIN_SESSION_KEY, sessionId: 'main-generation', displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.send', null])]: {
            success: true,
            result: { runId: 'run-handoff-e2e' },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['/api/chat/send', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, result: { runId: 'run-handoff-e2e' } },
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
            return respond(request.id, { success: true, result: { runId: 'run-handoff-e2e' } });
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

  test('refuses a relay once the handoff depth limit is reached (#179)', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: MAIN_SESSION_KEY, sessionId: 'main-generation', displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: handoffHistory },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['sessions', 'prepareHandoff', {
            sessionKey: MAIN_SESSION_KEY,
            agentId: 'main',
            workspaceId: 'workspace-a',
          }])]: {
            success: false,
            error: 'Handoff depth 4 exceeds the configured maximum of 3. Converge in the current session instead of relaying again.',
            handoffDepth: 4,
            handoffMaxDepth: 3,
          },
        },
      });

      const page = await getStableWindow(app);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByTestId('chat-project-session-header')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-toolbar-more').click();
      await page.getByTestId('chat-session-handoff').click();

      // The refusal is surfaced with an actionable, localized message, and no draft dialog opens.
      await expect(page.getByText('Handoff depth limit reached')).toBeVisible();
      await expect(page.getByTestId('chat-handoff-dialog')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
  test('keeps the editable draft and session when creation rejects changed ancestry', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: MAIN_SESSION_KEY, sessionId: 'main-generation', displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: handoffHistory },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['sessions', 'history', null])]: { messages: handoffHistory, hasMore: false },
        },
      });
      await app.evaluate(() => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const original = (ipcMain as unknown as { _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>> })._invokeHandlers?.get('host:invoke');
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', (event, request) => {
          if (request.module === 'sessions' && request.action === 'createHandoff') {
            return { id: request.id, ok: true, data: { success: false, error: 'Handoff ancestry unavailable or inconsistent.' } };
          }
          if (request.module === 'workspaces' && request.action === 'saveState') return { id: request.id, ok: true, data: { success: true } };
          return original?.(event, request);
        });
      });
      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-session-generation', 'main-generation', { timeout: 30_000 });
      await expect(page.getByTestId('chat-project-session-header')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-toolbar-more').click();
      await page.getByTestId('chat-session-handoff').click();
      await expect(page.getByTestId('chat-handoff-dialog')).toBeVisible();
      await page.getByTestId('chat-handoff-create').click();
      await expect(page.getByText('Handoff history is unavailable')).toBeVisible();
      await expect(page.getByTestId('chat-handoff-dialog')).toBeVisible();
      await expect(page.getByTestId('chat-handoff-draft')).toHaveValue(HANDOFF_DRAFT);
    } finally { await closeElectronApp(app); }
  });

});
