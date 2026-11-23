import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';
import { installWorkspaceOwnerMocks, readWorkspaceOwnerMocks } from './fixtures/workspace-owner';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-user-message-actions';
const FORK_SESSION_KEY = 'agent:main:fork-user-message-question';
const FORK_QUESTION_TEXT = '基于已有上下文，解释下一步。';
const EDITED_TRANSCRIPT_ENTRY_ID = 'user-message-actions-edited-entry';
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
    id: 'assistant-message-actions-prior-context',
    role: 'assistant',
    content: '上下文已准备，继续提问。',
    timestamp: (FIXED_TIME_MS - 1000) / 1000,
  },
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
  const contextRange = (messageCount: number) => ({
    success: true,
    range: {
      sessionKey: SESSION_KEY,
      modelRef: null,
      maxTokens: 8000,
      usedTokens: 0,
      visibleMessageStartIndex: 0,
      visibleMessageEndIndex: messageCount - 1,
      retainedMessageCount: messageCount,
      truncatedMessageCount: 0,
      summarizedMessageCount: 0,
      status: 'bestEffort',
    },
  });

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
        messageCount: 3,
        usedTokens: null,
      }])]: contextRange(3),
      [stableStringify(['usage', 'contextRange', {
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 3,
        usedTokens: 0,
      }])]: contextRange(3),
      [stableStringify(['usage', 'contextRange', {
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 2,
        usedTokens: null,
      }])]: contextRange(2),
      [stableStringify(['usage', 'contextRange', {
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 2,
        usedTokens: 0,
      }])]: contextRange(2),
      [stableStringify(['usage', 'contextRange', {
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 1,
        usedTokens: null,
      }])]: contextRange(1),
      [stableStringify(['usage', 'contextRange', {
        sessionKey: SESSION_KEY,
        modelRef: null,
        messageCount: 1,
        usedTokens: 0,
      }])]: contextRange(1),
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
        retainedLineCount: 2,
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
      await installWorkspaceOwnerMocks(app, workspace, [SESSION_KEY, FORK_SESSION_KEY]);
      await app.evaluate(({ ipcMain }, seed) => {
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        let transcript = seed.history;
        let childTranscript: typeof transcript = [];
        let forked = false;
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string; module?: string; action?: string; payload?: Record<string, unknown>;
        }) => {
          const payload = request.payload ?? {};
          const respond = (data: unknown) => {
            (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: unknown[] })
              .__verseClawE2eHostCalls?.push({ module: request.module, action: request.action, payload });
            return { id: request.id, ok: true, data };
          };
          if (request.module === 'sessions' && request.action === 'truncate') {
            if (payload.sessionKey !== seed.parentKey || payload.messageId !== seed.history[1].id) {
              return { id: request.id, ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Unexpected transcript boundary.' } };
            }
            transcript = [seed.history[0]];
            return respond({ success: true, sessionKey: seed.parentKey, messageId: seed.history[1].id,
              truncated: true, removedMessageCount: 2, retainedLineCount: 2 });
          }
          if (request.module === 'chat' && request.action === 'sendWithMedia' && payload.sessionKey === seed.parentKey) {
            if (payload.message !== seed.updatedText) {
              return { id: request.id, ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Unexpected edited message.' } };
            }
            transcript = [seed.history[0], { id: seed.editedEntryId, role: 'user', content: seed.updatedText, timestamp: seed.timestamp },
              { id: 'assistant-message-actions-edited-ack', role: 'assistant', content: seed.ack, timestamp: seed.timestamp + 1 }];
            return respond({ success: true, result: { runId: 'run-user-message-actions', source: 'mock',
              message: { content: [{ type: 'text', text: seed.ack }] } } });
          }
          if (request.module === 'sessions' && request.action === 'fork') {
            if (payload.sessionKey !== seed.parentKey || payload.workspaceId !== seed.workspaceId
              || payload.fromLeafId !== seed.editedEntryId) {
              return respond({ success: false, error: 'Question fork fixture requires its bound parent and transcript entry.' });
            }
            const boundary = transcript.findIndex((entry) => entry.id === seed.editedEntryId);
            if (boundary < 0) return respond({ success: false, error: 'The fixture transcript does not contain this entry.' });
            const ancestor = transcript.slice(0, boundary).findLastIndex((entry) => entry.role === 'assistant');
            if (ancestor < 0) return respond({ success: false, error: 'The fixture transcript has no preceding assistant.' });
            childTranscript = transcript.slice(0, ancestor + 1);
            forked = true;
            return respond({ success: true, sessionKey: seed.childKey });
          }
          if (request.module === 'gateway' && request.action === 'rpc') {
            const params = payload.params as Record<string, unknown> | undefined;
            if (forked && payload.method === 'sessions.list') {
              return respond({ sessions: [{ key: seed.parentKey, displayName: 'main' },
                { key: seed.childKey, displayName: 'Question branch', parentSessionKey: seed.parentKey, forkedFromParent: true }] });
            }
            if (payload.method === 'chat.history' && params?.sessionKey === seed.parentKey) {
              return respond({ messages: transcript });
            }
            if (forked && payload.method === 'chat.history' && params?.sessionKey === seed.childKey) {
              return respond({ messages: childTranscript });
            }
          }
          return originalHostInvoke?.(event, request) ?? respond({});
        });
      }, { workspaceId: WORKSPACE_ID, parentKey: SESSION_KEY, childKey: FORK_SESSION_KEY,
        history: seededHistory, updatedText: UPDATED_MESSAGE_TEXT, editedEntryId: EDITED_TRANSCRIPT_ENTRY_ID,
        ack: MOCK_ASSISTANT_ACK, timestamp: (FIXED_TIME_MS + 2000) / 1000 });
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1136, height: 520 });
      await openSeededChat(page);

      const messageRow = page.locator('[id^="chat-message-"]').filter({ hasText: USER_MESSAGE_TEXT });
      const messageBubble = page.getByTestId('chat-user-message-bubble');
      const messageText = messageRow.locator('p').filter({ hasText: USER_MESSAGE_TEXT });
      await expect(messageText).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(OLD_ASSISTANT_TEXT)).toBeVisible();

      await messageText.hover();
      const actions = page.getByTestId('chat-user-message-actions');
      await expect(actions).toHaveCSS('opacity', '1');
      await expect(page.getByTestId('chat-user-message-copy')).toHaveAttribute('aria-label', '复制消息');
      await expect(page.getByTestId('chat-user-message-edit')).toHaveAttribute('aria-label', '编辑');
      // The message action opens a question draft in a derived conversation.
      await expect(page.getByTestId('chat-user-message-fork')).toHaveAttribute(
        'aria-label',
        '在新会话中提问',
      );
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

      // The question draft keeps this message's transcript entry as its fork boundary.
      await openSeededChat(page);
      await expect(messageText).toContainText(UPDATED_MESSAGE_TEXT);
      await messageText.hover();
      await page.getByTestId('chat-user-message-fork').click();
      const questionDialog = page.getByTestId('question-fork-dialog');
      const questionDraft = page.getByTestId('question-fork-draft');
      await expect(questionDialog).toBeVisible();
      await expect(questionDraft).toHaveValue(UPDATED_MESSAGE_TEXT);
      await questionDraft.fill(FORK_QUESTION_TEXT);
      await page.getByTestId('question-fork-create').click();
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }>;
        }).__verseClawE2eHostCalls?.some((call) => call?.module === 'sessions' && call?.action === 'fork') ?? false
      ))).toBe(true);
      const forkCall = await app.evaluate(() => (
        (globalThis as typeof globalThis & {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }>;
        }).__verseClawE2eHostCalls?.findLast((call) => call?.module === 'sessions' && call?.action === 'fork') ?? null
      ));
      expect(forkCall).toEqual(expect.objectContaining({
        module: 'sessions',
        action: 'fork',
        payload: expect.objectContaining({
          sessionKey: SESSION_KEY,
          // The reload reads the edited entry's fixed backend identity.
          fromLeafId: expect.any(String),
        }),
      }));
      const forkLeafId = (forkCall as { payload?: { fromLeafId?: string } } | null)?.payload?.fromLeafId;
      expect(forkLeafId?.trim()).not.toBe('');
      expect(forkLeafId).toBe(EDITED_TRANSCRIPT_ENTRY_ID);
      await expect(questionDialog).toBeHidden();
      await expect(page.getByTestId('chat-composer-input')).toHaveValue(FORK_QUESTION_TEXT);
      await openSeededChat(page);
      await expect(page.getByTestId('chat-composer-input')).toHaveValue(FORK_QUESTION_TEXT);
      await expect(page.getByText('上下文已准备，继续提问。')).toBeVisible();
      await expect(page.getByText(UPDATED_MESSAGE_TEXT, { exact: true })).toHaveCount(0);
      const finalHostCalls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }> })
          .__verseClawE2eHostCalls ?? []
      ));
      expect(finalHostCalls).toContainEqual(expect.objectContaining({
        module: 'workspaces', action: 'saveState',
        payload: expect.objectContaining({ id: WORKSPACE_ID, sessionKey: FORK_SESSION_KEY,
          state: expect.objectContaining({ draftInput: FORK_QUESTION_TEXT }) }),
      }));
      expect(finalHostCalls).toContainEqual(expect.objectContaining({
        module: 'gateway', action: 'rpc', payload: expect.objectContaining({ method: 'chat.history',
          params: expect.objectContaining({ sessionKey: FORK_SESSION_KEY, limit: 200, maxChars: 500000 }) }),
      }));
      const owner = await readWorkspaceOwnerMocks(app);
      expect(owner.profile.activeSessionKey).toBe(FORK_SESSION_KEY);
      expect(owner.profile.agentBindings?.main?.sessionKey).toBe(FORK_SESSION_KEY);
      expect(owner.profile.sessionStates?.[FORK_SESSION_KEY]?.draftInput).toBe(FORK_QUESTION_TEXT);
      expect(owner.readCalls).toContainEqual(expect.objectContaining({ action: 'list', activeSessionKey: FORK_SESSION_KEY }));
      await expect(page.getByText(MOCK_ASSISTANT_ACK)).toHaveCount(0);
      await testInfo.attach('user-message-actions-host-calls', {
        body: JSON.stringify(finalHostCalls, null, 2),
        contentType: 'application/json',
      });
      await testInfo.attach('question-fork-owner', {
        body: JSON.stringify({ driven_by: 'agent', actor: 'codex-g2-question-fork-e2e',
          parentSessionKey: SESSION_KEY, childSessionKey: FORK_SESSION_KEY, forkLeafId,
          draft: FORK_QUESTION_TEXT, forkCall, owner }, null, 2),
        contentType: 'application/json',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
