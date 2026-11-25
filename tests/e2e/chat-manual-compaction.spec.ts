import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const EXPECTED_SESSION_ID = 'manual-compaction-session-generation';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Verse Claw chat manual compaction', () => {
  test('opens confirmation dialog and calls the session compaction Host API', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        // loadSessions reads the Gateway owner, not the legacy HTTP manifest.
        // Keep the mocked generation on that path so compaction carries it.
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: { sessions: [{ key: MAIN_SESSION_KEY, sessionId: EXPECTED_SESSION_ID, displayName: 'main' }] },
          },
        },
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
                result: { sessions: [{ key: MAIN_SESSION_KEY, sessionId: EXPECTED_SESSION_ID, displayName: 'main' }] },
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
            data: { status: 200, ok: true, json: { success: true, workspaces: [], activeWorkspaceId: null } },
          },
          [stableStringify(['usage', 'contextRange', {
            sessionKey: MAIN_SESSION_KEY,
            expectedSessionId: EXPECTED_SESSION_ID,
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
          [stableStringify(['usage', 'live', {
            sessionKey: MAIN_SESSION_KEY,
            runId: null,
            streaming: false,
          }])]: {
            success: true,
            usage: null,
          },
          // Manual compaction now passes through a prompt-cache-risk gate
          // (confirmPromptCacheRisk -> usage.promptCacheStatus). Without a mock
          // the call falls through to the real assessment, which warns at high
          // pressure and blocks on a toast decision the test never makes. Stub a
          // no-warning assessment so the confirm proceeds to the Host API call.
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
        },
      });
      await app.evaluate(({ ipcMain }, { sessionKey, expectedSessionId }) => {
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const compactCalls: unknown[] = [];
        const makeResponse = (id: unknown, data: unknown) => ({
          id: typeof id === 'string' ? id : undefined,
          ok: true,
          data,
        });

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string;
          module?: string;
          action?: string;
          payload?: Record<string, unknown>;
        }) => {
          if (request?.module === 'sessions' && request.action === 'compact') {
            if (request.payload?.expectedSessionId !== expectedSessionId) {
              throw new Error(`Unexpected compact expectedSessionId: ${String(request.payload?.expectedSessionId)}`);
            }
            compactCalls.push(request.payload);
            return makeResponse(request.id, {
              success: true,
              compacted: true,
              tokensBefore: 64000,
              tokensAfter: 18000,
              sessionKey,
            });
          }
          return originalHostInvoke?.(event, request) ?? makeResponse(request?.id, {});
        });
        (globalThis as typeof globalThis & { __manualCompactionCalls?: unknown[] }).__manualCompactionCalls = compactCalls;
      }, { sessionKey: MAIN_SESSION_KEY, expectedSessionId: EXPECTED_SESSION_ID });

      const page = await getStableWindow(app);
      // Discard status requests started before the Host API fixture was installed.
      await page.reload();
      await expect(page.getByTestId('chat-page')).toHaveAttribute('data-session-generation', EXPECTED_SESSION_ID, { timeout: 30_000 });

      // The composer compact icon was removed; the slash palette is the entry
      // point now (see tests/unit/chat-input.test.tsx). Open the dialog via /compact.
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('/compact');
      const compact = page.getByTestId('chat-slash-command-option-compact');
      await expect(compact).toContainText('64k / 128k tokens');
      await compact.click();
      await expect(page.getByTestId('chat-compaction-dialog')).toBeVisible();
      await expect(page.getByTestId('chat-compaction-details')).not.toHaveAttribute('open');
      await expect(page.getByTestId('chat-compaction-truncated')).toContainText('3');
      await expect(page.getByTestId('chat-compaction-dialog').getByText('64k / 128k tokens', { exact: true })).toHaveCount(1);
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await expect(page.getByTestId('chat-compaction-dialog')).toHaveCSS('opacity', '1');
      await expect(page.getByTestId('chat-compaction-dialog')).toHaveCSS('background-color', 'rgb(36, 36, 36)');
      await page.screenshot({ path: testInfo.outputPath('compact-dark.png') });
      await page.setViewportSize({ width: 480, height: 800 });
      await expect(page.getByTestId('chat-compaction-confirm')).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath('compact-narrow-dark.png') });
      await page.getByTestId('chat-compaction-instructions').fill('Keep the deployment decision.');
      await expect(page.getByTestId('chat-compaction-confirm')).toBeEnabled();
      await page.getByTestId('chat-compaction-confirm').click();
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __manualCompactionCalls?: unknown[] }).__manualCompactionCalls?.length ?? 0
      ))).toBe(1);
      const calls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __manualCompactionCalls?: unknown[] }).__manualCompactionCalls ?? []
      ));
      expect(calls).toContainEqual({
        sessionKey: MAIN_SESSION_KEY,
        expectedSessionId: EXPECTED_SESSION_ID,
        agentId: 'main',
        customInstructions: 'Keep the deployment decision.',
        force: true,
      });
      await expect(page.getByTestId('chat-compaction-dialog')).toBeHidden();
    } finally {
      await closeElectronApp(app);
    }
  });
});
