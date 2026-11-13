import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSIONS_LIST_PAYLOAD = {
  includeDerivedTitles: true,
  includeLastMessage: true,
};

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Verse Claw chat session date grouping', () => {
  test('lists every conversation newest-first, with no collapsible date buckets', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const nowMs = Date.now();
    const sessions = [
      { key: MAIN_SESSION_KEY, displayName: 'Today conversation', updatedAt: nowMs - 60 * 60 * 1000 },
      { key: `agent:main:session-${nowMs - 2 * DAY_MS}`, displayName: 'Week conversation', updatedAt: nowMs - 2 * DAY_MS },
      { key: `agent:main:session-${nowMs - 10 * DAY_MS}`, displayName: 'Month conversation', updatedAt: nowMs - 10 * DAY_MS },
      { key: `agent:main:session-${nowMs - 40 * DAY_MS}`, displayName: 'Older conversation', updatedAt: nowMs - 40 * DAY_MS },
    ];
    /*
     * The sidebar lists conversations a PROJECT claims (plus the current one) —
     * an unclaimed transcript is history the workspace knows nothing about. So
     * the fixture needs a project that owns all four, or three of them are
     * filtered out before any ordering question is even asked.
     */
    const workspace = {
      id: 'workspace-history',
      name: 'History Workspace',
      rootPath: 'C:/history',
      agentId: 'main',
      activeSessionKey: MAIN_SESSION_KEY,
      permissionMode: 'acceptEdits',
      state: {},
      sessionStates: Object.fromEntries(sessions.map((session) => [session.key, {}])),
      sessionFolders: [],
      sessionFolderAssignments: {},
    };

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: nowMs },
        gatewayRpc: {
          [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
            success: true,
            result: { sessions },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['workspaces', 'list', null])]: {
            success: true,
            profiles: [workspace],
            activeWorkspaceId: workspace.id,
            activeWorkspace: workspace,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            success: true,
            activeWorkspaceId: workspace.id,
            activeWorkspace: workspace,
          },
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, connectedAt: nowMs },
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

      /*
       * Date buckets are gone (docs/dev/session-workstreams-design.md, the
       * 2026-08-18 revision): the sidebar answers "which project / which
       * workstream", and time is expressed as ORDER, not as four collapsible
       * containers that hid two thirds of the history behind a click. The
       * fixture still spans today → 40 days ago, so this now locks the
       * replacement contract: everything is present, newest first.
       */
      await expect(page.locator('[data-testid^="session-bucket-"]')).toHaveCount(0);
      for (const name of ['Today conversation', 'Week conversation', 'Month conversation', 'Older conversation']) {
        await expect(page.locator('[data-testid^="sidebar-session-agent:main:"]').filter({ hasText: name })).toBeVisible();
      }

      const orderedLabels = await page
        .locator('[data-testid^="sidebar-session-agent:main:"]')
        .evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''));
      expect(orderedLabels).toEqual([
        'Today conversation',
        'Week conversation',
        'Month conversation',
        'Older conversation',
      ]);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('new chat appears in Today only after the first message and lands without overshoot', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const oldTimestampMs = Date.now() - 35 * 24 * 60 * 60 * 1000;
    const seededHistory = [
      { role: 'user', content: 'Existing conversation', timestamp: oldTimestampMs },
      { role: 'assistant', content: 'Existing reply', timestamp: oldTimestampMs + 1000 },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
            success: true,
            result: {
              sessions: [{
                key: MAIN_SESSION_KEY,
                displayName: 'main',
                updatedAt: oldTimestampMs,
              }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: seededHistory },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
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
              json: { state: 'running', port: 18789, pid: 12345 },
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
          [stableStringify(['providers', 'accounts', null])]: [{
            id: 'e2e-provider',
            vendorId: 'anthropic',
            label: 'E2E Provider',
            authMode: 'api_key',
            model: 'claude-sonnet-4',
            enabled: true,
            isDefault: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }],
          [stableStringify(['providers', 'accountKeyInfo', null])]: [{
            accountId: 'e2e-provider',
            hasKey: true,
          }],
          [stableStringify(['providers', 'getDefaultAccount', null])]: {
            accountId: 'e2e-provider',
          },
          [stableStringify(['providers', 'vendors', null])]: [],
          [stableStringify(['chat', 'sendWithMedia', null])]: {
            success: true,
            result: { runId: 'new-session-run', sessionKey: MAIN_SESSION_KEY },
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

      await expect(page.getByText('Existing conversation')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('sidebar-new-chat').click();

      await expect(page.getByText(/agent:main:session-/)).toHaveCount(0);
      const sessionRows = page.locator('[data-testid^="sidebar-session-agent"]');
      const emptySessionRowCount = await sessionRows.count();

      const composerHost = page.locator('.codex-composer-host');
      const startTop = await composerHost.evaluate((element) => element.getBoundingClientRect().top);
      await page.getByTestId('chat-composer-input').fill('First message creates the session');
      await page.getByTestId('chat-composer-send').click();

      const transitionTops: number[] = [];
      for (const delay of [40, 80, 120, 160]) {
        await page.waitForTimeout(delay);
        transitionTops.push(await composerHost.evaluate((element) => element.getBoundingClientRect().top));
      }
      await page.waitForTimeout(600);
      const finalTop = await composerHost.evaluate((element) => element.getBoundingClientRect().top);

      const lowerBound = Math.min(startTop, finalTop) - 1;
      const upperBound = Math.max(startTop, finalTop) + 1;
      expect(transitionTops.every((top) => top >= lowerBound && top <= upperBound)).toBe(true);
      await expect(page.getByTestId('chat-user-message-bubble').getByText('First message creates the session')).toBeVisible();
      await expect.poll(() => sessionRows.count()).toBeGreaterThan(emptySessionRowCount);
    } finally {
      await closeElectronApp(app);
    }
  });
});
