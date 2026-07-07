import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-recovery-assist';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Chat recovery assist', () => {
  test('shows evidence-backed recovery suggestions through existing handoff, queue, and compaction actions', async ({ launchElectronApp }) => {
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
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                result: {
                  messages: [{
                    id: 'assistant-failure',
                    role: 'assistant',
                    content: 'The previous task failed during validation.',
                    timestamp: new Date(1).toISOString(),
                  }],
                },
              },
            },
          },
          [stableStringify(['/api/workspaces', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                workspaces: [{
                  id: WORKSPACE_ID,
                  name: 'Recovery Assist Workspace',
                  rootPath: 'C:\\Users\\27933\\Desktop\\clawx\\ClawX-knowledge-ux-polish',
                  activeSessionKey: SESSION_KEY,
                  permissionMode: 'workspace-write',
                  state: {},
                  sessionStates: {},
                }],
                activeWorkspaceId: WORKSPACE_ID,
              },
            },
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [{
              id: WORKSPACE_ID,
              name: 'Recovery Assist Workspace',
              rootPath: 'C:\\Users\\27933\\Desktop\\clawx\\ClawX-knowledge-ux-polish',
              activeSessionKey: SESSION_KEY,
              permissionMode: 'workspace-write',
              state: {},
              sessionStates: {},
            }],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: {
              id: WORKSPACE_ID,
              name: 'Recovery Assist Workspace',
              rootPath: 'C:\\Users\\27933\\Desktop\\clawx\\ClawX-knowledge-ux-polish',
              activeSessionKey: SESSION_KEY,
              permissionMode: 'workspace-write',
              state: {},
              sessionStates: {},
            },
          },
          [stableStringify(['usage', 'live', {
            runId: null,
            sessionKey: SESSION_KEY,
            streaming: false,
          }])]: { success: true, usage: null },
          [stableStringify(['usage', 'contextRange', {
            messageCount: 1,
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
            warnings: [],
          },
          [stableStringify(['sessions', 'longTaskControlStatus', {
            agentId: 'main',
            sessionKey: SESSION_KEY,
          }])]: {
            success: true,
            available: true,
            queueCount: 1,
            warnings: [],
            latestCheckpoint: {
              id: 'ltcp-recovery-e2e',
              sessionKey: SESSION_KEY,
              trigger: 'audit_fail',
              status: 'active',
              checkpoint: {
                schemaVersion: 1,
                trigger: 'audit_fail',
                openBlockers: [],
                decisions: [],
                deviations: [],
                filesTouched: ['src/pages/Chat/rollback-plan.ts'],
                testsRun: ['pnpm exec vitest run tests/unit/rollback-plan.test.ts'],
                reviewNeededItems: [],
                evidenceRefs: [{ type: 'session', ref: SESSION_KEY }],
                createdAt: new Date(1).toISOString(),
                metadata: {
                  fileHashes: { 'src/pages/Chat/rollback-plan.ts': 'a'.repeat(64) },
                  toolResults: [{ callId: 'task_loop.subagent:run_recovery', status: 'success' }],
                },
              },
              createdAt: 1,
              updatedAt: 1,
            },
          },
        },
      });

      await app.evaluate(({ ipcMain }) => {
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const handoffCalls: unknown[] = [];
        const queueDrainCalls: unknown[] = [];
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
          if (request?.module === 'sessions' && request.action === 'prepareHandoff') {
            handoffCalls.push(request.payload);
            return makeResponse(request.id, {
              success: true,
              draft: 'Review audit_fail checkpoint evidence before continuing.',
              evidence: { recoveryContext: true },
            });
          }
          if (request?.module === 'sessions' && request.action === 'queueDrain') {
            queueDrainCalls.push(request.payload);
            return makeResponse(request.id, {
              success: true,
              available: true,
              drained: true,
              sessionKey: SESSION_KEY,
              messageCount: 1,
              queueCount: 0,
            });
          }
          if (request?.module === 'sessions' && request.action === 'compact') {
            compactCalls.push(request.payload);
            return makeResponse(request.id, {
              success: true,
              checkpointId: 'compact-recovery-e2e',
              beforeTokens: 96000,
              afterTokens: 42000,
              quality: { score: 0.82 },
            });
          }
          return originalHostInvoke?.(event, request) ?? makeResponse(request?.id, {});
        });

        (globalThis as typeof globalThis & { __recoveryAssistHandoffCalls?: unknown[] }).__recoveryAssistHandoffCalls = handoffCalls;
        (globalThis as typeof globalThis & { __recoveryAssistQueueDrainCalls?: unknown[] }).__recoveryAssistQueueDrainCalls = queueDrainCalls;
        (globalThis as typeof globalThis & { __recoveryAssistCompactCalls?: unknown[] }).__recoveryAssistCompactCalls = compactCalls;
      });

      const page = await getStableWindow(app);
      await page.waitForLoadState('domcontentloaded');

      const panel = page.getByTestId('chat-rollback-plan');
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel).toContainText('Recovery assist');
      await expect(panel).toContainText('1 file fingerprint(s)');
      await expect(panel).toContainText('1 tool result(s)');
      await expect(panel).toContainText('Risky Git, file, or terminal actions are suggestions only');
      await expect(panel).not.toContainText(/lossless|automatic full|full rollback|all side effects|completely equivalent/i);
      await expect(panel.getByTestId('chat-rollback-action-checkpoint-handoff')).toBeVisible();
      await expect(panel.getByTestId('chat-rollback-action-drain-queue')).toBeVisible();
      await expect(panel.getByTestId('chat-rollback-action-manual-compact')).toBeVisible();

      await panel.getByTestId('chat-rollback-run-handoff').click();
      await expect(page.getByTestId('chat-handoff-dialog')).toBeVisible();
      await expect(page.getByText('Review audit_fail checkpoint evidence before continuing.')).toBeVisible();
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __recoveryAssistHandoffCalls?: unknown[] }).__recoveryAssistHandoffCalls?.length ?? 0
      ))).toBe(1);
      await page.getByTestId('chat-handoff-dialog').getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByTestId('chat-handoff-dialog')).toBeHidden();

      await panel.getByTestId('chat-rollback-run-queueDrain').click();
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __recoveryAssistQueueDrainCalls?: unknown[] }).__recoveryAssistQueueDrainCalls?.length ?? 0
      ))).toBe(1);

      await panel.getByTestId('chat-rollback-run-compact').click();
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __recoveryAssistCompactCalls?: unknown[] }).__recoveryAssistCompactCalls?.length ?? 0
      ))).toBe(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});
