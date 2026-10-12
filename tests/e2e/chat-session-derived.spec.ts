import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const PARENT_SESSION_KEY = 'agent:main:main';
const CHILD_SESSION_KEY = 'agent:main:fork-1711111111111';
const WORKSPACE_ID = 'workspace-derived-sessions';
const FIXED_TIME_MS = new Date('2026-06-28T23:55:00+08:00').getTime();

const PARENT_USER_TEXT = 'Plan the runtime-backed fork flow.';
const PARENT_ASSISTANT_TEXT = 'Fork should preserve the active transcript branch.';
const CHILD_MARKER_TEXT = 'Exploring an alternative branch from here.';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const parentHistory = [
  {
    id: 'derived-parent-user-1',
    role: 'user',
    content: PARENT_USER_TEXT,
    timestamp: FIXED_TIME_MS / 1000,
  },
  {
    id: 'derived-parent-assistant-1',
    role: 'assistant',
    content: PARENT_ASSISTANT_TEXT,
    timestamp: (FIXED_TIME_MS + 1000) / 1000,
  },
];

const childHistory = [
  ...parentHistory,
  {
    id: 'derived-child-assistant-1',
    role: 'assistant',
    content: CHILD_MARKER_TEXT,
    timestamp: (FIXED_TIME_MS + 2000) / 1000,
  },
];

/**
 * #180: the on-screen session is the fork *parent*. The Gateway's sessions.list
 * already carries the derived child row (`parentSessionKey` + `forkedFromParent`),
 * so the header can list every derived session without a new query.
 */
const parentWorkspace = {
  id: WORKSPACE_ID,
  name: 'Derived Sessions Workspace',
  rootPath: 'C:/workspace-derived-sessions',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: PARENT_SESSION_KEY,
  permissionMode: 'acceptEdits' as const,
  createdAt: FIXED_TIME_MS,
  updatedAt: FIXED_TIME_MS,
  lastOpenedAt: FIXED_TIME_MS,
  state: {},
  sessionStates: {
    [PARENT_SESSION_KEY]: {},
  },
};

function contextRange(sessionKey: string, messageCount: number) {
  return {
    success: true,
    range: {
      sessionKey,
      modelRef: null,
      maxTokens: 128000,
      usedTokens: 12000,
      visibleMessageStartIndex: 0,
      visibleMessageEndIndex: messageCount - 1,
      retainedMessageCount: messageCount,
      truncatedMessageCount: 0,
      summarizedMessageCount: 0,
      status: 'bestEffort',
    },
  };
}

function derivedSessionMocks() {
  const sessions = [
    { key: PARENT_SESSION_KEY, displayName: 'main', updatedAt: FIXED_TIME_MS },
    {
      key: CHILD_SESSION_KEY,
      displayName: 'fork-1711111111111',
      updatedAt: FIXED_TIME_MS + 1000,
      parentSessionKey: PARENT_SESSION_KEY,
      forkedFromParent: true,
    },
  ];

  return {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: { sessions },
      },
      [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
        success: true,
        result: { sessions },
      },
      [stableStringify(['chat.history', { sessionKey: PARENT_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages: parentHistory },
      },
      [stableStringify(['chat.history', { sessionKey: CHILD_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages: childHistory },
      },
      // Non-main sessions get a label hydrated from their first user message;
      // that fetch uses the 1000-message page.
      [stableStringify(['chat.history', { sessionKey: CHILD_SESSION_KEY, limit: 1000 }])]: {
        success: true,
        result: { messages: childHistory },
      },
    },
    hostApi: {
      [stableStringify(['/api/settings', 'GET'])]: {
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: { language: 'en', theme: 'dark', setupComplete: true },
        },
      },
      [stableStringify(['settings', 'getAll', null])]: {
        language: 'en',
        theme: 'dark',
        setupComplete: true,
      },
      [stableStringify(['/api/gateway/status', 'GET'])]: {
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        },
      },
      [stableStringify(['/api/agents', 'GET'])]: {
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: { success: true, agents: [{ id: 'main', name: 'main' }] },
        },
      },
      [stableStringify(['agents', 'list', null])]: {
        success: true,
        agents: [{ id: 'main', name: 'main' }],
      },
      [stableStringify(['workspaces', 'getActive', null])]: {
        success: true,
        activeWorkspaceId: WORKSPACE_ID,
        activeWorkspace: parentWorkspace,
      },
      [stableStringify(['workspaces', 'list', null])]: {
        profiles: [parentWorkspace],
        activeWorkspaceId: WORKSPACE_ID,
        activeWorkspace: parentWorkspace,
      },
      [stableStringify(['workspaces', 'saveState', { id: WORKSPACE_ID, sessionKey: PARENT_SESSION_KEY, state: {} }])]: {
        success: true,
      },
      [stableStringify(['usage', 'contextRange', {
        sessionKey: PARENT_SESSION_KEY,
        modelRef: null,
        messageCount: 2,
        usedTokens: null,
      }])]: contextRange(PARENT_SESSION_KEY, 2),
      [stableStringify(['sessions', 'compactionStatus', {
        sessionKey: PARENT_SESSION_KEY,
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
        sessionKey: CHILD_SESSION_KEY,
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
    },
  };
}

test.describe('Verse Claw derived-session listing', () => {
  test('lists the sessions derived from the current one and switches to the child', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, derivedSessionMocks());
      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByText(PARENT_ASSISTANT_TEXT)).toBeVisible({ timeout: 30_000 });
      // The child row is not part of the workspace's known sessions, so it can
      // only appear through the derived-session section.
      await expect(page.getByText(CHILD_MARKER_TEXT)).toHaveCount(0);

      await page.getByTestId('chat-header-session-name').click();

      const derivedTitle = page.getByTestId('chat-derived-sessions-title');
      await expect(derivedTitle).toBeVisible();
      await expect(derivedTitle).toHaveText('Derived sessions (1)');

      const childRow = page.getByTestId(`chat-session-derived-${CHILD_SESSION_KEY}`);
      await expect(childRow).toBeVisible();
      await expect(childRow).toContainText('fork-1711111111111');
      await expect(childRow).toContainText(CHILD_SESSION_KEY);

      await childRow.click();

      // The child's transcript page (limit 200) is fetched and rendered; the
      // parent's derived list collapses because the child has no children.
      await expect(page.getByText(CHILD_MARKER_TEXT)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-derived-sessions-title')).toHaveCount(0);
      await expect.poll(async () => app.evaluate((_electron, childKey) => {
        const calls = (globalThis as typeof globalThis & {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }>;
        }).__verseClawE2eHostCalls ?? [];
        return calls.some((call) => {
          if (call?.module !== 'gateway' || call?.action !== 'rpc') return false;
          const payload = (call.payload ?? {}) as Record<string, unknown>;
          const params = (payload.params ?? {}) as Record<string, unknown>;
          return payload.method === 'chat.history'
            && params.sessionKey === childKey
            && params.limit === 200;
        });
      }, CHILD_SESSION_KEY), { timeout: 30_000 }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});