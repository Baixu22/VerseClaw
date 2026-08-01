import { expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}

function commonHostApi() {
  return {
    [stableStringify(['agents', 'list', null])]: {
      success: true,
      agents: [{ id: 'main', name: 'main', isDefault: true, mainSessionKey: SESSION_KEY, channelTypes: [] }],
      defaultAgentId: 'main',
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    },
    [stableStringify(['workspaces', 'list', null])]: {
      profiles: [],
      activeWorkspaceId: null,
      activeWorkspace: null,
    },
    [stableStringify(['workspaces', 'getActive', null])]: {
      activeWorkspaceId: null,
      activeWorkspace: null,
    },
  };
}

test.describe('System maturity Phase 4/5 runtime gates', () => {
  test('shows localized budget denial and rolls back the optimistic message', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: { success: true, result: { sessions: [{ key: SESSION_KEY }] } },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: { success: true, result: { messages: [] } },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: { success: true, result: { messages: [] } },
        },
        hostApi: {
          ...commonHostApi(),
          [stableStringify(['chat', 'sendWithMedia', null])]: {
            success: false,
            error: 'TOKEN_BUDGET_EXCEEDED',
            denial: { code: 'TOKEN_BUDGET_EXCEEDED', used: 1000, limit: 1000 },
          },
        },
      });
      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-composer-input')).toBeVisible();
      await page.getByTestId('chat-composer-input').fill('must not be sent');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByText(/reached its token budget/i)).toBeVisible();
      await expect(page.getByText('must not be sent')).toHaveCount(0);
      const calls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: { method?: string } }> })
          .__verseClawE2eHostCalls ?? []
      ));
      expect(calls.filter((call) => call.module === 'chat' && call.action === 'sendWithMedia')).toHaveLength(1);
      expect(calls.some((call) => (
        call.module === 'gateway' && call.action === 'rpc' && call.payload?.method === 'chat.send'
      ))).toBe(false);
    } finally {
      await app.close();
    }
  });

  test('bounds large history DOM projection', async ({ launchElectronApp }) => {
    const history = Array.from({ length: 1000 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `bounded-history-${index}`,
      timestamp: 1_700_000_000 + index,
      id: `history-${index}`,
    }));
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: { success: true, result: { sessions: [{ key: SESSION_KEY }] } },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: { success: true, result: { messages: history } },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: { success: true, result: { messages: history } },
        },
        hostApi: commonHostApi(),
      });
      const page = await getStableWindow(app);
      await expect(page.getByText('bounded-history-999')).toBeVisible();
      await expect.poll(async () => page.locator('[data-testid^="chat-message-"]:not([data-testid="chat-message-layout"])').count()).toBeLessThanOrEqual(120);
    } finally {
      await app.close();
    }
  });

  test('cancels the underlying run, clears UI state, and permits the next turn', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: { success: true, result: { sessions: [{ key: SESSION_KEY }] } },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: { success: true, result: { messages: [] } },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: { success: true, result: { messages: [] } },
          [stableStringify(['chat.abort', { sessionKey: SESSION_KEY }])]: { success: true, result: { aborted: true } },
        },
        hostApi: {
          ...commonHostApi(),
          [stableStringify(['chat', 'sendWithMedia', null])]: { success: true, runId: 'run-p45' },
        },
      });
      const page = await getStableWindow(app);
      const input = page.getByTestId('chat-composer-input');
      const primaryAction = page.getByTestId('chat-composer-send');

      await input.fill('cancel this turn');
      await primaryAction.click();
      await expect(primaryAction).toHaveAttribute('title', /stop/i);
      await primaryAction.click();
      await expect(input).toBeEnabled();

      await input.fill('next turn works');
      await primaryAction.click();
      const calls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: { method?: string } }> })
          .__verseClawE2eHostCalls ?? []
      ));
      expect(calls.some((call) => call.module === 'gateway' && call.action === 'rpc' && call.payload?.method === 'chat.abort')).toBe(true);
      expect(calls.filter((call) => call.module === 'chat' && call.action === 'sendWithMedia')).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  test('hard timeout aborts the underlying run and releases the next turn', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: { success: true, result: { sessions: [{ key: SESSION_KEY }] } },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: { success: true, result: { messages: [] } },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: { success: true, result: { messages: [] } },
          [stableStringify(['chat.abort', { sessionKey: SESSION_KEY }])]: { success: true, result: { aborted: true } },
        },
        hostApi: {
          ...commonHostApi(),
          [stableStringify(['chat', 'sendWithMedia', null])]: { success: true, runId: 'run-timeout-p45' },
        },
      });
      const page = await getStableWindow(app);
      await page.clock.install();
      const input = page.getByTestId('chat-composer-input');
      const primaryAction = page.getByTestId('chat-composer-send');
      await input.fill('timeout this turn');
      await primaryAction.click();
      await expect(primaryAction).toHaveAttribute('title', /stop/i);
      await page.clock.fastForward(30 * 60 * 1000 + 1);
      await expect(page.getByText(/turn timed out/i)).toBeVisible();
      await expect(input).toBeEnabled();
      await input.fill('after timeout');
      await primaryAction.click();
      const calls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: { method?: string } }> })
          .__verseClawE2eHostCalls ?? []
      ));
      expect(calls.some((call) => call.module === 'gateway' && call.action === 'rpc' && call.payload?.method === 'chat.abort')).toBe(true);
      expect(calls.filter((call) => call.module === 'chat' && call.action === 'sendWithMedia')).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  test('keeps browser profile sessions visibly isolated', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installIpcMocks(app, {
        hostApi: {
          ...commonHostApi(),
          [stableStringify(['agentBrowser', 'status', null])]: {
            success: true,
            sessions: [
              { id: 'tab-work', profile: 'work', mode: 'headless', url: 'https://work.example', title: 'Work tab' },
              { id: 'tab-personal', profile: 'personal', mode: 'headless', url: 'https://personal.example', title: 'Personal tab' },
            ],
          },
          [stableStringify(['agentBrowser', 'tasks', null])]: { success: true, tasks: [] },
          [stableStringify(['agentBrowser', 'profiles', null])]: {
            success: true,
            profiles: [
              { profile: 'work', label: 'Work', activeSessions: 1, source: 'metadata' },
              { profile: 'personal', label: 'Personal', activeSessions: 1, source: 'metadata' },
            ],
          },
          [stableStringify(['agentBrowser', 'vault', null])]: { success: true, credentials: [] },
        },
      });
      const page = await getStableWindow(app);
      await page.getByTestId('sidebar-footer-menu-trigger').click();
      await page.getByTestId('sidebar-more-browser').click();
      await expect(page.getByText('Work tab')).toBeVisible();
      await expect(page.getByText('Personal tab')).toBeVisible();
      await expect(page.getByText('https://work.example')).toBeVisible();
      await expect(page.getByText('https://personal.example')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
