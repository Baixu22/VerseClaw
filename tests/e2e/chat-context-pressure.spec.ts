import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

/**
 * TF-0450: the session context pressure indicator must be visible in the Chat
 * composer and must reflect real usage reported by the runtime, not invented
 * numbers. Driven by agent; no human interaction is required to run it.
 */

const MAIN_SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Verse Claw chat context pressure', () => {
  test('shows session context, cache-served tokens and warm hit rate in the composer', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
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
                result: { sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }] },
              },
            },
          },
          [stableStringify(['/api/chat/history', 'POST'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, result: { messages: [] } } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main' }] } },
          },
          [stableStringify(['/api/workspaces', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, workspaces: [], activeWorkspaceId: null } },
          },
          // The window ceiling lives on the context range.
          [stableStringify(['usage', 'contextRange', {
            sessionKey: MAIN_SESSION_KEY,
            modelRef: null,
            messageCount: 0,
            usedTokens: null,
          }])]: {
            success: true,
            range: {
              sessionKey: MAIN_SESSION_KEY,
              usedTokens: 64000,
              maxTokens: 128000,
              truncatedMessageCount: 3,
              status: 'bestEffort',
            },
          },
          // The session-level usage the indicator is meant to surface.
          [stableStringify(['usage', 'live', {
            sessionKey: MAIN_SESSION_KEY,
            runId: null,
            streaming: false,
          }])]: {
            success: true,
            usage: {
              sessionKey: MAIN_SESSION_KEY,
              inputTokens: 4200,
              outputTokens: 800,
              cacheReadTokens: 59000,
              cacheWriteTokens: 0,
              warmTurnHitRate: 0.82,
              lastTurnHitRate: 0.64,
              totalTokens: 64000,
              estimatedCostUsd: 0.0123,
              updatedAt: 1,
              status: 'final',
            },
          },
          [stableStringify(['sessions', 'compactionStatus', {
            sessionKey: MAIN_SESSION_KEY,
            agentId: 'main',
          }])]: {
            success: true,
            available: true,
            canCompact: true,
            inProgress: false,
            usedTokens: 64000,
            maxTokens: 128000,
            remainingTokens: 64000,
            pressure: 'high',
            truncatedMessageCount: 3,
            warnings: [],
          },
          [stableStringify(['usage', 'promptCacheStatus', null])]: {
            success: true,
            assessment: {
              sessionKey: MAIN_SESSION_KEY,
              shouldWarn: false,
              severity: 'none',
              status: 'unknown',
              confidence: 'unknown',
              providerStrategy: 'unknown',
              hitRate: null,
              promptTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costEstimateReliable: false,
              warningCount: 0,
              cancelledBreakCount: 0,
              updatedAt: 0,
            },
          },
        },
      });

      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

      // Open the compaction dialog via the slash palette, which is the current
      // entry point for session-level context controls.
      await page.getByTestId('chat-composer-input').fill('/compact');
      const compact = page.getByTestId('chat-slash-command-option-compact');
      await expect(compact).toBeVisible();
      await compact.click();

      const pressure = page.getByTestId('chat-context-pressure');
      await expect(pressure).toBeVisible();

      // Session context: used against the window ceiling.
      await expect(pressure).toContainText('64k / 128k tokens');
      // Cache-served tokens for the session.
      await expect(pressure).toContainText('59k');
      // Warm hit rate and last-turn hit rate, both from real usage.
      await expect(pressure).toContainText('82%');
      await expect(pressure).toContainText('64%');
      // Estimated cost when the runtime reports one.
      await expect(pressure).toContainText('$0.0123');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows the session row but omits optional metrics the runtime did not report', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
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
              json: { success: true, result: { sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }] } },
            },
          },
          [stableStringify(['/api/chat/history', 'POST'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, result: { messages: [] } } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main' }] } },
          },
          [stableStringify(['/api/workspaces', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, workspaces: [], activeWorkspaceId: null } },
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
              usedTokens: 64000,
              maxTokens: 128000,
              truncatedMessageCount: 0,
              status: 'exact',
            },
          },
          [stableStringify(['usage', 'live', {
            sessionKey: MAIN_SESSION_KEY,
            runId: null,
            streaming: false,
          }])]: {
            success: true,
            usage: {
              sessionKey: MAIN_SESSION_KEY,
              inputTokens: 64000,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 64000,
              updatedAt: 1,
              status: 'final',
            },
          },
          [stableStringify(['sessions', 'compactionStatus', {
            sessionKey: MAIN_SESSION_KEY,
            agentId: 'main',
          }])]: {
            success: true,
            available: true,
            canCompact: true,
            inProgress: false,
            usedTokens: 64000,
            maxTokens: 128000,
            remainingTokens: 64000,
            pressure: 'high',
            truncatedMessageCount: 3,
            warnings: [],
          },
          [stableStringify(['usage', 'promptCacheStatus', null])]: {
            success: true,
            assessment: {
              sessionKey: MAIN_SESSION_KEY,
              shouldWarn: false,
              severity: 'none',
              status: 'unknown',
              confidence: 'unknown',
              providerStrategy: 'unknown',
              hitRate: null,
              promptTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costEstimateReliable: false,
              warningCount: 0,
              cancelledBreakCount: 0,
              updatedAt: 0,
            },
          },
        },
      });

      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('/compact');
      const compact = page.getByTestId('chat-slash-command-option-compact');
      await expect(compact).toBeVisible();
      await compact.click();

      // Partial measurement: the session row is shown, but the optional cache
      // and hit-rate rows must be omitted rather than fabricated as 0%.
      await expect(page.getByTestId('chat-compaction-dialog')).toBeVisible();
      const pressure = page.getByTestId('chat-context-pressure');
      await expect(pressure).toBeVisible();
      await expect(pressure).toContainText('64k / 128k tokens');
      await expect(pressure).not.toContainText('%');
      await expect(pressure).not.toContainText('$');
    } finally {
      await closeElectronApp(app);
    }
  });
});
