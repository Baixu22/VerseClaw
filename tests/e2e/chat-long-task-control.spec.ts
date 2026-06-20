import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('ClawX chat long-task recovery controls', () => {
  test('shows recovery status and drains queued follow-up through Host API', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

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
            data: {
              status: 200,
              ok: true,
              json: { success: true, workspaces: [], activeWorkspaceId: null },
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
          [stableStringify(['usage', 'contextRange', {
            sessionKey: MAIN_SESSION_KEY,
            modelRef: null,
            messageCount: 0,
            usedTokens: null,
          }])]: {
            success: true,
            range: {
              sessionKey: MAIN_SESSION_KEY,
              usedTokens: 1200,
              maxTokens: 128000,
              truncatedMessageCount: 0,
              status: 'bestEffort',
            },
          },
          [stableStringify(['sessions', 'longTaskControlStatus', {
            sessionKey: MAIN_SESSION_KEY,
            agentId: 'main',
          }])]: {
            success: true,
            available: true,
            queueCount: 2,
            latestCheckpoint: {
              id: 'ltcp-e2e',
              sessionKey: MAIN_SESSION_KEY,
              trigger: 'queue_drain',
              status: 'active',
              checkpoint: {
                schemaVersion: 1,
                trigger: 'queue_drain',
                openBlockers: [],
                decisions: [],
                deviations: [],
                filesTouched: [],
                testsRun: [],
                reviewNeededItems: [],
                evidenceRefs: [{ type: 'session', ref: MAIN_SESSION_KEY }],
                createdAt: new Date(1).toISOString(),
              },
              createdAt: 1,
              updatedAt: 1,
            },
            latestIntervention: {
              id: 'ltie-e2e',
              sessionKey: MAIN_SESSION_KEY,
              mode: 'queue',
              trigger: 'queue_drain',
              status: 'queued',
              payload: {},
              createdAt: 2,
              updatedAt: 2,
            },
            warnings: ['gateway_unavailable'],
          },
        },
      });

      await app.evaluate(({ ipcMain }, sessionKey) => {
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const queueDrainCalls: unknown[] = [];
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
          if (request?.module === 'sessions' && request.action === 'queueDrain') {
            queueDrainCalls.push(request.payload);
            return makeResponse(request.id, {
              success: true,
              available: true,
              drained: true,
              sessionKey,
              messageCount: 2,
              queueCount: 0,
            });
          }
          return originalHostInvoke?.(event, request) ?? makeResponse(request?.id, {});
        });
        (globalThis as typeof globalThis & { __longTaskQueueDrainCalls?: unknown[] }).__longTaskQueueDrainCalls = queueDrainCalls;
      }, MAIN_SESSION_KEY);

      const page = await getStableWindow(app);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByTestId('chat-long-task-queue-count')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-long-task-checkpoint')).toBeVisible();
      await expect(page.getByTestId('chat-long-task-intervention')).toBeVisible();
      await expect(page.getByTestId('chat-long-task-warnings')).toBeVisible();

      await page.getByTestId('chat-long-task-drain').click();

      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __longTaskQueueDrainCalls?: unknown[] }).__longTaskQueueDrainCalls?.length ?? 0
      ))).toBe(1);
      const calls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __longTaskQueueDrainCalls?: unknown[] }).__longTaskQueueDrainCalls ?? []
      ));
      expect(calls).toContainEqual({
        sessionKey: MAIN_SESSION_KEY,
        agentId: 'main',
      });
    } finally {
      await closeElectronApp(app);
    }
  });
});
