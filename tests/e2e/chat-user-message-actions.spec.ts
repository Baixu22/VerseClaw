import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-user-message-actions';
const USER_MESSAGE_TEXT = '连接测试';
const UPDATED_MESSAGE_TEXT = '连接测试，更新一下';
const OLD_ASSISTANT_TEXT = '旧回复应在重发前被移除。';
const MOCK_ASSISTANT_ACK = '收到更新后的消息。';
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
  name: 'Message Actions Workspace',
  rootPath: 'C:/workspace-user-message-actions',
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
  {
    id: 'user-message-actions-seed',
    role: 'user',
    content: USER_MESSAGE_TEXT,
    timestamp: FIXED_TIME_MS / 1000,
  },
  {
    id: 'assistant-message-actions-old-reply',
    role: 'assistant',
    content: OLD_ASSISTANT_TEXT,
    timestamp: (FIXED_TIME_MS + 1000) / 1000,
  },
];

function chatMessageActionMocks() {
  const contextRange = {
    success: true,
    range: {
      sessionKey: SESSION_KEY,
      modelRef: null,
      maxTokens: 8000,
      usedTokens: 0,
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
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: { sessions: [{ key: SESSION_KEY, displayName: 'main', updatedAt: FIXED_TIME_MS }] },
      },
      [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
        success: true,
        result: { sessions: [{ key: SESSION_KEY, displayName: 'main', updatedAt: FIXED_TIME_MS }] },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages: seededHistory },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
        success: true,
        result: { messages: seededHistory },
      },
    },
    hostApi: {
      // Set the theme through settings rather than relying on the manual
      // classList flip below: App's theme effect calls applyDocumentTheme on
      // mount, which rewrites `light`/`dark` on <html> and would otherwise race
      // the test's own toggle.
      [stableStringify(['/api/settings', 'GET'])]: {
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: { language: 'zh', theme: 'dark', setupComplete: true },
        },
      },
      [stableStringify(['settings', 'getAll', null])]: {
        language: 'zh',
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
        activeWorkspace: workspace,
      },
      [stableStringify(['workspaces', 'list', null])]: {
        profiles: [workspace],
        activeWorkspaceId: WORKSPACE_ID,
        activeWorkspace: workspace,
      },
      [stableStringify(['workspaces', 'saveState', { id: WORKSPACE_ID, sessionKey: SESSION_KEY, state: {} }])]: {
        success: true,
      },
      [stableStringify(['usage', 'contextRange', {
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 2,
        usedTokens: null,
      }])]: contextRange,
      [stableStringify(['usage', 'contextRange', {
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 2,
        usedTokens: 0,
      }])]: contextRange,
      [stableStringify(['usage', 'contextRange', {
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 1,
        usedTokens: null,
      }])]: contextRange,
      [stableStringify(['usage', 'contextRange', {
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 1,
        usedTokens: 0,
      }])]: contextRange,
      [stableStringify(['sessions', 'truncate', {
        agentId: 'main',
        messageId: 'user-message-actions-seed',
        sessionKey: SESSION_KEY,
      }])]: {
        success: true,
        sessionKey: SESSION_KEY,
        messageId: 'user-message-actions-seed',
        truncated: true,
        removedMessageCount: 2,
        retainedLineCount: 1,
      },
      [stableStringify(['chat', 'sendWithMedia', null])]: {
        success: true,
        result: {
          runId: 'run-user-message-actions',
          source: 'mock',
          message: {
            content: [{ type: 'text', text: MOCK_ASSISTANT_ACK }],
          },
        },
      },
    },
  };
}

async function openSeededChat(page: Awaited<ReturnType<typeof getStableWindow>>) {
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
      throw error;
    }
  }

  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
      [data-testid="chat-assistive-rail"] {
        display: none !important;
      }
      [data-testid="chat-toolbar-drag-region"] {
        pointer-events: none !important;
      }
    `,
  });
  await page.evaluate(() => {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
    const target = window as typeof window & { __copiedUserMessages?: string[] };
    target.__copiedUserMessages = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          target.__copiedUserMessages?.push(value);
        },
      },
    });
  });
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
}

test.describe('Verse Claw user message hover actions', () => {
  test('shows copy and edit controls, opens the inline editor, and resends through chat send', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, chatMessageActionMocks());
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1136, height: 520 });
      await openSeededChat(page);

      const messageRow = page.getByTestId('chat-message-0');
      const messageBubble = page.getByTestId('chat-user-message-bubble');
      const messageText = messageRow.locator('p').filter({ hasText: USER_MESSAGE_TEXT });
      await expect(messageText).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(OLD_ASSISTANT_TEXT)).toBeVisible();

      await messageText.hover();
      const actions = page.getByTestId('chat-user-message-actions');
      await expect(actions).toHaveCSS('opacity', '1');
      await expect(page.getByTestId('chat-user-message-copy')).toHaveAttribute('aria-label', '复制消息');
      await expect(page.getByTestId('chat-user-message-edit')).toHaveAttribute('aria-label', '编辑');
      const bubbleBox = await messageBubble.boundingBox();
      const actionsBox = await actions.boundingBox();
      expect(bubbleBox).not.toBeNull();
      expect(actionsBox).not.toBeNull();
      expect(actionsBox!.y).toBeGreaterThanOrEqual(bubbleBox!.y + bubbleBox!.height - 1);
      await actions.evaluate((element) => {
        const bar = element as HTMLElement;
        // The bar starts at `opacity-0 translate-y-0.5` and is revealed by
        // `group-hover:opacity-100 group-hover:translate-y-0`. Forcing only the
        // opacity left the 2px offset in place whenever the pointer was not over
        // the row at capture time, which shifted the icons and produced a stable
        // 252-pixel diff (region x731..810 y53..67) against the golden. Pin both
        // halves of the revealed state so the capture does not depend on hover.
        bar.style.opacity = '1';
        bar.style.transform = 'translateY(0)';
      });
      // Capture the settled hover state. The reveal is a CSS transition, and
      // sampling it mid-flight is what made this golden image flaky on a loaded
      // machine: 252 pixels differed against a 128-pixel budget. Same class of
      // fix as chat-layout-cdp's hover settle.
      await messageRow.evaluate(async (element) => {
        await Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => undefined)),
        );
      });
      await expect(messageRow).toHaveScreenshot('user-message-actions-hover-dark.png', {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixels: 128,
      });

      await page.getByTestId('chat-user-message-copy').click();
      await expect.poll(async () => page.evaluate(() => (
        (window as typeof window & { __copiedUserMessages?: string[] }).__copiedUserMessages ?? []
      ))).toEqual([USER_MESSAGE_TEXT]);

      await page.getByTestId('chat-user-message-edit').click();
      const editor = page.getByTestId('chat-user-message-editor');
      await expect(editor).toBeVisible();
      await expect(page.getByTestId('chat-user-message-editor-input')).toHaveValue(USER_MESSAGE_TEXT);
      await expect(page.getByTestId('chat-user-message-edit-cancel')).toHaveAttribute('aria-label', '取消');
      await expect(page.getByTestId('chat-user-message-edit-send')).toHaveAttribute('aria-label', '发送');
      const editorInputBox = await page.getByTestId('chat-user-message-editor-input').boundingBox();
      const editorActionsBox = await page.getByTestId('chat-user-message-editor-actions').boundingBox();
      expect(editorInputBox).not.toBeNull();
      expect(editorActionsBox).not.toBeNull();
      expect(editorActionsBox!.y).toBeGreaterThanOrEqual(editorInputBox!.y + editorInputBox!.height - 1);
      await expect(editor).toHaveScreenshot('user-message-editor-dark.png', {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixels: 128,
      });

      await page.getByTestId('chat-user-message-editor-input').fill(UPDATED_MESSAGE_TEXT);
      await page.getByTestId('chat-user-message-edit-send').click();
      await expect(editor).toHaveCount(0);
      await expect(
        page.locator('[data-testid^="chat-message-"]:not([data-testid="chat-message-layout"])').filter({ hasText: UPDATED_MESSAGE_TEXT }),
      ).toBeVisible();
      await expect(page.getByText(OLD_ASSISTANT_TEXT)).toHaveCount(0);

      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }> }).__verseClawE2eHostCalls
          ?.filter((call) => call?.module === 'chat' && call?.action === 'sendWithMedia').length ?? 0
      ))).toBeGreaterThanOrEqual(1);

      const hostCalls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }> }).__verseClawE2eHostCalls ?? []
      ));
      const truncateCallIndex = hostCalls.findIndex((call) => call?.module === 'sessions' && call?.action === 'truncate');
      const sendCallIndex = hostCalls.findIndex((call) => call?.module === 'chat' && call?.action === 'sendWithMedia');
      expect(truncateCallIndex).toBeGreaterThanOrEqual(0);
      expect(sendCallIndex).toBeGreaterThan(truncateCallIndex);
      expect(hostCalls[truncateCallIndex]).toEqual(expect.objectContaining({
        module: 'sessions',
        action: 'truncate',
        payload: expect.objectContaining({
          sessionKey: SESSION_KEY,
          messageId: 'user-message-actions-seed',
        }),
      }));

      const sendCalls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }> }).__verseClawE2eHostCalls
          ?.filter((call) => call?.module === 'chat' && call?.action === 'sendWithMedia') ?? []
      ));
      expect(sendCalls.at(-1)).toEqual(expect.objectContaining({
        module: 'chat',
        action: 'sendWithMedia',
        payload: expect.objectContaining({
          sessionKey: SESSION_KEY,
          message: UPDATED_MESSAGE_TEXT,
        }),
      }));

      await testInfo.attach('user-message-actions-host-calls', {
        body: JSON.stringify(hostCalls, null, 2),
        contentType: 'application/json',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
