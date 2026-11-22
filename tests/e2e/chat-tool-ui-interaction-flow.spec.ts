import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function toolUiBlock(payload: Record<string, unknown>): string {
  return ['```tool-ui', JSON.stringify(payload), '```'].join('\n');
}

const MOCK_ASSISTANT_ACK = 'Acknowledged your selection. Continuing the rollout.';

/**
 * Assistant message that carries two interactive tool-ui cards:
 *
 *  1. option-list (single mode) — user picks one path, then Send.
 *  2. question-flow (2 steps) — user navigates Next, then Send on the last step.
 *
 * Both cards expose ActionFooter with the Send button when canSubmit is true
 * (gateway running, no active run). The Send button triggers
 * handleSubmitInteractionResponse → handleSendMessage → sendMessage, which
 * optimistically adds the "Tool UI response:" text as a user message and
 * calls chat.sendWithMedia. The mock returns source:'mock' so the store
 * resolves sending=false and appends a mock assistant acknowledgement.
 */
const seededHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'Show me the interactive cards I can respond to.' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    content: [{
      type: 'text',
      text: [
        'Pick a path and answer the follow-up questions:',
        '',
        toolUiBlock({
          type: 'option-list',
          id: 'options-flow-e2e',
          title: 'Choose a rollout path',
          selectionMode: 'single',
          options: [
            { id: 'simple', label: 'Simple path' },
            { id: 'guided', label: 'Guided path' },
          ],
        }),
        '',
        toolUiBlock({
          type: 'question-flow',
          id: 'question-flow-e2e',
          steps: [
            {
              id: 'scope',
              title: 'Which scope should be optimized?',
              selectionMode: 'single',
              options: [
                { id: 'rendering', label: 'Rendering only' },
                { id: 'runtime', label: 'Runtime protocol' },
              ],
            },
            {
              id: 'depth',
              title: 'How aggressive should the optimization be?',
              selectionMode: 'single',
              options: [
                { id: 'conservative', label: 'Conservative' },
                { id: 'aggressive', label: 'Aggressive' },
              ],
            },
          ],
        }),
      ].join('\n'),
    }],
    timestamp: Date.now(),
  },
];

test.describe('Verse Claw Tool UI interaction flow — option-list and question-flow send response', () => {
  test('option-list: select option, send response, verify user message and mock assistant reply', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
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
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
          // Fallback for chat.sendWithMedia — matches any payload.
          // Returns source:'mock' so sendMessage resolves sending=false
          // and appends the mock assistant acknowledgement.
          [stableStringify(['chat', 'sendWithMedia', null])]: {
            success: true,
            result: {
              runId: 'run-option-flow-e2e',
              source: 'mock',
              message: {
                content: [{ type: 'text', text: MOCK_ASSISTANT_ACK }],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();

      // ── OptionListCard: select an option ──
      const optionList = page.getByTestId('chat-tool-ui-option-list').filter({ hasText: 'Choose a rollout path' });
      await expect(optionList).toBeVisible({ timeout: 30_000 });

      const simpleOption = optionList.getByTestId('chat-tool-ui-option-simple');
      await expect(simpleOption).toBeVisible();
      // Before clicking, the option should not be selected.
      await expect(simpleOption).toHaveAttribute('aria-selected', 'false');

      await simpleOption.click();

      // After clicking, the option should be selected (single mode).
      await expect(simpleOption).toHaveAttribute('aria-selected', 'true');
      // The other option should remain unselected.
      await expect(optionList.getByTestId('chat-tool-ui-option-guided')).toHaveAttribute('aria-selected', 'false');

      // ── ActionFooter: Send button should appear (canSubmit=true) ──
      const sendButton = optionList.getByTestId('chat-tool-ui-action-send');
      await expect(sendButton).toBeVisible();

      // ── Click Send → triggers handleSubmitInteractionResponse ──
      await sendButton.click();

      // ── Verify the optimistic user message appears with the Tool UI response text ──
      // The responseText is "Tool UI response:\n{...\"value\":\"simple\"...}"
      // Exclude chat-message-layout (the container) so we match only the message row.
      const userResponse = page.locator('[data-testid^="chat-message-"]:not([data-testid="chat-message-layout"])').filter({ hasText: 'Tool UI response:' }).filter({ hasText: 'options-flow-e2e' });
      await expect(userResponse).toBeVisible({ timeout: 30_000 });
      await expect(userResponse).toContainText('simple');

      // ── Verify the mock assistant acknowledgement appears ──
      await expect(page.locator('.prose').filter({ hasText: MOCK_ASSISTANT_ACK }).last()).toBeVisible({ timeout: 30_000 });

      // ── Verify chat.sendWithMedia was called with the response text ──
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }> }).__verseClawE2eHostCalls
          ?.filter((call) => call?.module === 'chat' && call?.action === 'sendWithMedia').length ?? 0
      ))).toBeGreaterThanOrEqual(1);

      const sendCalls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }> }).__verseClawE2eHostCalls
          ?.filter((call) => call?.module === 'chat' && call?.action === 'sendWithMedia') ?? []
      ));
      expect(sendCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          module: 'chat',
          action: 'sendWithMedia',
          payload: expect.objectContaining({
            message: expect.stringContaining('Tool UI response:'),
          }),
        }),
      ]));
    } finally {
      await closeElectronApp(app);
    }
  });

  test('question-flow: navigate steps, send response, verify user message and mock assistant reply', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
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
              json: {
                success: true,
                agents: [{ id: 'main', name: 'main' }],
              },
            },
          },
          [stableStringify(['chat', 'sendWithMedia', null])]: {
            success: true,
            result: {
              runId: 'run-question-flow-e2e',
              source: 'mock',
              message: {
                content: [{ type: 'text', text: MOCK_ASSISTANT_ACK }],
              },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();

      // ── QuestionFlowCard: step 1 of 2 ──
      const precedingChoice = page.getByTestId('chat-composer-requests').getByTestId('chat-tool-ui-option-list');
      await expect(precedingChoice).toBeVisible();
      await precedingChoice.getByTestId('chat-tool-ui-option-simple').click();
      await precedingChoice.getByTestId('chat-tool-ui-action-send').click();
      // Only one question-flow card in the seeded history, so no text filter needed.
      const questionFlow = page.getByTestId('chat-tool-ui-question-flow');
      await expect(questionFlow).toBeVisible({ timeout: 30_000 });

      // Step indicator should show "Step 1 of 2" (i18n: toolUi.questionFlow.step).
      await expect(questionFlow).toContainText('Step 1 of 2');
      await expect(questionFlow).toContainText('Which scope should be optimized?');

      // Select an option on step 1.
      const scopeOption = questionFlow.getByTestId('chat-tool-ui-question-option-rendering');
      await expect(scopeOption).toBeVisible();
      await scopeOption.click();

      // On step 1 (not last), the Next button should be enabled (selection made).
      const nextButton = questionFlow.getByTestId('chat-tool-ui-question-next');
      await expect(nextButton).toBeVisible();
      await expect(nextButton).toBeEnabled();

      // Navigate to step 2.
      await nextButton.click();

      // ── Step 2 of 2 ──
      await expect(questionFlow).toContainText('Step 2 of 2');
      await expect(questionFlow).toContainText('How aggressive should the optimization be?');

      // Back button should be enabled on step 2.
      const backButton = questionFlow.getByTestId('chat-tool-ui-question-back');
      await expect(backButton).toBeEnabled();

      // Select an option on step 2.
      const depthOption = questionFlow.getByTestId('chat-tool-ui-question-option-aggressive');
      await expect(depthOption).toBeVisible();
      await depthOption.click();
      await expect(depthOption).toHaveAttribute('aria-pressed', 'true');

      // On the last step, ActionFooter replaces the Next button.
      const sendButton = questionFlow.getByTestId('chat-tool-ui-action-send');
      await expect(sendButton).toBeVisible();

      // ── Click Send ──
      await sendButton.click();

      // ── Verify the optimistic user message appears with the Tool UI response text ──
      // The responseText contains answers for both steps.
      // Exclude chat-message-layout (the container) so we match only the message row.
      const userResponse = page.locator('[data-testid^="chat-message-"]:not([data-testid="chat-message-layout"])').filter({ hasText: 'Tool UI response:' }).filter({ hasText: 'question-flow-e2e' });
      await expect(userResponse).toBeVisible({ timeout: 30_000 });
      await expect(userResponse).toContainText('rendering');
      await expect(userResponse).toContainText('aggressive');

      // ── Verify the mock assistant acknowledgement appears ──
      await expect(page.locator('.prose').filter({ hasText: MOCK_ASSISTANT_ACK }).last()).toBeVisible({ timeout: 30_000 });

      // ── Verify chat.sendWithMedia was called ──
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }> }).__verseClawE2eHostCalls
          ?.filter((call) => call?.module === 'chat' && call?.action === 'sendWithMedia').length ?? 0
      ))).toBeGreaterThanOrEqual(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});

test('one question stays visible as the terminal reply is replaced by history', async ({ launchElectronApp }) => {
  const runId = 'question-final-before-history';
  const prompt = 'Ask me about paper.';
  const content = toolUiBlock({
    type: 'question-flow', id: 'paper-finish', steps: [{
      id: 'finish', title: 'Which finish?', selectionMode: 'single',
      options: [{ id: 'matte', label: 'Matte' }, { id: 'glossy', label: 'Glossy' }],
    }],
  });
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const mocks = (messages: unknown[]) => ({
      gatewayStatus: { state: 'running' as const, port: 18789, gatewayReady: true },
      gatewayRpcByMethod: {
        'sessions.list': { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
        'chat.history': { messages },
        'chat.send': { runId },
      },
      hostApi: {
        [stableStringify(['providers', 'accounts', null])]: [{ id: 'question-provider', vendorId: 'openai', label: 'Question fixture', authMode: 'oauth_browser', enabled: true }],
        [stableStringify(['providers', 'accountKeyInfo', null])]: [],
        [stableStringify(['providers', 'vendors', null])]: [],
        [stableStringify(['providers', 'getDefaultAccount', null])]: { accountId: 'question-provider' },
        [stableStringify(['chat', 'sendWithMedia', null])]: { success: true, result: { runId } },
      },
    });
    await installIpcMocks(app, mocks([]));
    const page = await getStableWindow(app);
    await page.reload();
    const input = page.getByTestId('chat-composer-input');
    await expect(input).toBeEnabled();
    const at = Date.now();
    await input.fill(prompt);
    await page.getByTestId('chat-composer-send').click();
    await expect(input).toHaveValue('');
    const publish = (state: 'delta' | 'final', text = content) => app.evaluate(({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('gateway:chat-message', { message: payload });
    }, { sessionKey: SESSION_KEY, runId, state, message: { role: 'assistant', content: text, timestamp: at + 1 } });
    for (const length of [20, 45, 90, content.length - 2]) {
      await publish('delta', `Preparing question ${length}\n${content.slice(0, length)}`);
      await expect(page.getByText(`Preparing question ${length}`, { exact: true })).toBeVisible();
      await expect(page.locator('pre').filter({ hasText: '"type"' })).toHaveCount(0);
    }
    await publish('delta');
    const cards = page.getByTestId('chat-tool-ui-question-flow');
    await expect(cards).toHaveCount(1);
    await installIpcMocks(app, mocks([
      { role: 'user', content: prompt, timestamp: at, __openclaw: { id: 'question-user' } },
      {
        role: 'assistant', stopReason: 'stop', timestamp: at + 1, __openclaw: { id: 'question-reply' },
        content: [{ type: 'text', text: `${content}\n\nSaved in conversation history.` }],
      },
    ]));
    await publish('final');
    await expect(page.getByText('Saved in conversation history.')).toBeVisible();
    await expect(cards).toHaveCount(1);
    await cards.getByTestId('chat-tool-ui-question-option-matte').click();
    await expect(cards.getByTestId('chat-tool-ui-action-send')).toBeEnabled();
  } finally {
    await closeElectronApp(app);
  }
});
