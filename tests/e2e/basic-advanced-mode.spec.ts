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

test.describe('Basic and advanced UI depth mode', () => {
  test('toggles diagnostic depth without changing chat dispatch payload shape', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        hostApi: {
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { language: 'en', setupComplete: true } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main' }] } },
          },
          [stableStringify(['/api/chat/sessions', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] } },
            },
          },
          [stableStringify(['/api/chat/history', 'POST'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, result: { messages: [] } } },
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [],
            activeWorkspaceId: null,
            activeWorkspace: null,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            profiles: [],
            activeWorkspaceId: null,
            activeWorkspace: null,
          },
          [stableStringify(['usage', 'contextRange', {
            messageCount: 0,
            modelRef: null,
            sessionKey: SESSION_KEY,
            usedTokens: null,
          }])]: {
            success: true,
            range: {
              sessionKey: SESSION_KEY,
              usedTokens: 96000,
              maxTokens: 128000,
              truncatedMessageCount: 2,
              status: 'bestEffort',
            },
          },
          [stableStringify(['usage', 'live', {
            runId: null,
            sessionKey: SESSION_KEY,
            streaming: false,
          }])]: { success: true, usage: null },
          [stableStringify(['sessions', 'compactionStatus', {
            agentId: 'main',
            sessionKey: SESSION_KEY,
          }])]: {
            success: true,
            available: true,
            canCompact: true,
            inProgress: false,
            pressure: 'high',
            usedTokens: 96000,
            maxTokens: 128000,
            remainingTokens: 32000,
            truncatedMessageCount: 2,
            warnings: ['review current state before continuing'],
            lastCompaction: {
              checkpointId: 'checkpoint-42',
              quality: {
                score: 0.91,
                evidenceCoverage: 0.8,
                fieldCoverage: 0.86,
                projectionTokens: 1440,
                level: 'high',
              },
              unverifiedCount: 1,
              reviewNeededCount: 1,
            },
          },
          [stableStringify(['chat', 'sendWithMedia', null])]: {
            success: true,
            result: { runId: 'run-ui-depth', sessionKey: SESSION_KEY },
            source: 'mock',
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-composer-compact')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-compaction-view-artifact')).toHaveCount(0);

      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-general').click();
      await expect(page.getByTestId('settings-ui-depth-mode')).toBeVisible();
      await page.getByTestId('settings-ui-depth-advanced').click();

      const settingsCalls = await app.evaluate(() => (
        (globalThis as unknown as {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }>;
        }).__verseClawE2eHostCalls ?? []
      ));
      expect(settingsCalls).not.toContainEqual(expect.objectContaining({
        module: 'settings',
        action: 'set',
        payload: expect.objectContaining({ key: 'uiDepthMode' }),
      }));

      await page.evaluate(() => {
        window.location.hash = '#/';
      });
      await expect(page.getByTestId('chat-compaction-view-artifact')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-compaction-quality')).toBeVisible();

      await page.getByTestId('chat-composer-input').fill('dispatch payload unchanged');
      await page.getByTestId('chat-composer-send').click();

      await expect.poll(async () => app.evaluate(() => {
        const calls = (globalThis as unknown as {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }>;
        }).__verseClawE2eHostCalls ?? [];
        return calls.findLast((call) => call.module === 'chat' && call.action === 'sendWithMedia')?.payload ?? null;
      })).not.toBeNull();
      const sendPayload = await app.evaluate(() => {
        const calls = (globalThis as unknown as {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: Record<string, unknown> }>;
        }).__verseClawE2eHostCalls ?? [];
        return calls.findLast((call) => call.module === 'chat' && call.action === 'sendWithMedia')?.payload ?? null;
      });

      expect(sendPayload).toMatchObject({
        sessionKey: SESSION_KEY,
        message: 'dispatch payload unchanged',
        deliver: false,
        knowledgeScope: 'none',
        knowledgeMode: 'suggest',
      });
      expect(sendPayload).not.toHaveProperty('uiDepthMode');
      expect(sendPayload).not.toHaveProperty('advanced');
    } finally {
      await closeElectronApp(app);
    }
  });
});
