import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-compact-range';
const USER_MESSAGE_ID = 'compact-range-user-1';
const USER_MESSAGE_TEXT = 'Turn one: set up the workspace.';
const ASSISTANT_REPLY = 'Workspace ready.';
const FIXED_TIME_MS = new Date('2026-06-28T23:55:00+08:00').getTime();

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
  name: 'Compact Range Workspace',
  rootPath: 'C:/workspace-compact-range',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: SESSION_KEY,
  permissionMode: 'acceptEdits' as const,
  createdAt: FIXED_TIME_MS,
  updatedAt: FIXED_TIME_MS,
  lastOpenedAt: FIXED_TIME_MS,
  state: {},
  sessionStates: {
    [SESSION_KEY]: {},
  },
};

const seededHistory = [
  { id: USER_MESSAGE_ID, role: 'user', content: USER_MESSAGE_TEXT, timestamp: FIXED_TIME_MS / 1000 },
  {
    id: 'compact-range-assistant-1',
    role: 'assistant',
    content: [{ type: 'text', text: ASSISTANT_REPLY }],
    timestamp: (FIXED_TIME_MS + 1000) / 1000,
  },
];

function compactRangeMocks() {
  const contextRange = {
    success: true,
    range: {
      sessionKey: SESSION_KEY,
      modelRef: null,
      maxTokens: 128000,
      usedTokens: 12000,
      visibleMessageStartIndex: 0,
      visibleMessageEndIndex: 1,
      retainedMessageCount: 2,
      truncatedMessageCount: 0,
      summarizedMessageCount: 0,
      status: 'bestEffort',
    },
  };
  return {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    gatewayRpc: {
      [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
        success: true,
        result: { sessions: [{ key: SESSION_KEY, displayName: 'main', updatedAt: FIXED_TIME_MS }] },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages: seededHistory },
      },
    },
    hostApi: {
      [stableStringify(['/api/settings', 'GET'])]: {
        ok: true,
        data: { status: 200, ok: true, json: { language: 'en', theme: 'dark', setupComplete: true } },
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
        data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'main' }] } },
      },
      [stableStringify(['agents', 'list', null])]: {
        success: true,
        agents: [{ id: 'main', name: 'main' }],
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
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 2,
        usedTokens: null,
      }])]: contextRange,
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
      [stableStringify(['sessions', 'compactRange', {
        sessionKey: SESSION_KEY,
        agentId: 'main',
        fromLeafId: USER_MESSAGE_ID,
      }])]: {
        success: true,
        key: SESSION_KEY,
        compacted: true,
        reason: 'manual',
        result: { summary: 'Summarized the earlier turn.', tokensBefore: 12000, tokensAfter: 4000, firstKeptEntryId: USER_MESSAGE_ID },
      },
    },
  };
}

test.describe('Verse Claw located (range) compaction', () => {
  test('summarizes from a chosen message through the host-api, keeping the newer side', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, compactRangeMocks());
      const page = await getStableWindow(app);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      const messageRow = page.getByTestId('chat-message-0');
      const messageText = messageRow.locator('p').filter({ hasText: USER_MESSAGE_TEXT });
      await expect(messageText).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(ASSISTANT_REPLY)).toBeVisible();

      await messageText.hover();
      const actions = page.getByTestId('chat-user-message-actions');
      await expect(actions).toHaveCSS('opacity', '1');
      await expect(page.getByTestId('chat-user-message-summarize-to')).toHaveAttribute(
        'aria-label',
        'Summarize up to here',
      );
      await expect(page.getByTestId('chat-user-message-summarize-from')).toHaveAttribute(
        'aria-label',
        'Summarize from here',
      );

      await page.getByTestId('chat-user-message-summarize-from').click();

      await expect.poll(async () => app.evaluate((_electron, target) => {
        const calls = (globalThis as typeof globalThis & {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }>;
        }).__verseClawE2eHostCalls ?? [];
        return calls.some((call) => {
          if (call?.module !== 'sessions' || call?.action !== 'compactRange') return false;
          const payload = (call.payload ?? {}) as Record<string, unknown>;
          return payload.sessionKey === target.sessionKey && payload.fromLeafId === target.messageId;
        });
      }, { sessionKey: SESSION_KEY, messageId: USER_MESSAGE_ID }), { timeout: 30_000 }).toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});