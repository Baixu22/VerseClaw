import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-rollback';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Verse Claw chat long-task recovery controls', () => {
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
              json: {
                success: true,
                workspaces: [{
                  id: WORKSPACE_ID,
                  name: 'Rollback Workspace',
                  rootPath: 'C:\\Users\\27933\\Desktop\\clawx\\ClawX',
                  activeSessionKey: MAIN_SESSION_KEY,
                  permissionMode: 'workspace-write',
                  state: {},
                  sessionStates: {},
                }],
                activeWorkspaceId: WORKSPACE_ID,
                activeWorkspace: {
                  id: WORKSPACE_ID,
                  name: 'Rollback Workspace',
                  rootPath: 'C:\\Users\\27933\\Desktop\\clawx\\ClawX',
                  activeSessionKey: MAIN_SESSION_KEY,
                  permissionMode: 'workspace-write',
                  state: {},
                  sessionStates: {},
                },
              },
            },
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [{
              id: WORKSPACE_ID,
              name: 'Rollback Workspace',
              rootPath: 'C:\\Users\\27933\\Desktop\\clawx\\ClawX',
              activeSessionKey: MAIN_SESSION_KEY,
              permissionMode: 'workspace-write',
              state: {},
              sessionStates: {},
            }],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: {
              id: WORKSPACE_ID,
              name: 'Rollback Workspace',
              rootPath: 'C:\\Users\\27933\\Desktop\\clawx\\ClawX',
              activeSessionKey: MAIN_SESSION_KEY,
              permissionMode: 'workspace-write',
              state: {},
              sessionStates: {},
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
          /*
           * A validated provider is a PRECONDITION for sending: the composer
           * blocks the send and opens `chat-provider-gate-dialog` when no
           * account can serve it (FP-P1-01). Without these four the first send
           * in this test never reaches `chat.sendWithMedia`, and every
           * assertion past it — the intervention strip, queueing, steering —
           * is unreachable behind a modal.
           */
          [stableStringify(['providers', 'accounts', null])]: [{
            id: 'acct-long-task-e2e',
            vendorId: 'openai',
            label: 'Long task E2E provider',
            authMode: 'oauth_browser',
            enabled: true,
          }],
          [stableStringify(['providers', 'accountKeyInfo', null])]: [],
          [stableStringify(['providers', 'vendors', null])]: [],
          [stableStringify(['providers', 'getDefaultAccount', null])]: { accountId: 'acct-long-task-e2e' },
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
          [stableStringify(['workspaces', 'saveState', {
            id: WORKSPACE_ID,
            sessionKey: MAIN_SESSION_KEY,
            state: { artifactPanel: { open: true, activeTab: 'browser', workspaceView: 'git' } },
          }])]: {
            success: true,
          },
        },
      });

      await app.evaluate(({ ipcMain }, sessionKey) => {
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const queueDrainCalls: unknown[] = [];
        const chatSendCalls: unknown[] = [];
        const taskLedgerAppendCalls: unknown[] = [];
        const terminalInterruptCalls: unknown[] = [];
        const knowledgeDraftCalls: unknown[] = [];
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
          if (request?.module === 'workspaces' && request.action === 'saveState') {
            return makeResponse(request.id, { success: true });
          }
          if (request?.module === 'chat' && request.action === 'sendWithMedia') {
            chatSendCalls.push(request.payload);
            if (request.payload?.inputMode) {
              return makeResponse(request.id, {
                success: true,
                result: { runId: `run-${request.payload.inputMode}` },
              });
            }
            return new Promise(() => {});
          }
          if (request?.module === 'taskLedger' && request.action === 'appendEvents') {
            taskLedgerAppendCalls.push(request.payload);
            return makeResponse(request.id, {
              success: true,
              snapshot: {
                schemaVersion: 1,
                workspaceId: 'workspace-rollback',
                generatedAt: new Date(1).toISOString(),
                nodes: [],
                edges: [],
                sessionLinks: [],
                rootNodeIds: [],
                reviewNodeIds: [],
                activeNodeIds: [],
                blockedNodeIds: [],
                recentDecisions: [],
                eventsCount: taskLedgerAppendCalls.length,
                warnings: [],
              },
            });
          }
          if (request?.module === 'terminal' && request.action === 'status') {
            return makeResponse(request.id, {
              success: true,
              status: 'running',
              sessionId: 'terminal-e2e',
            });
          }
          if (request?.module === 'terminal' && request.action === 'interrupt') {
            terminalInterruptCalls.push(request.payload);
            return makeResponse(request.id, { success: true });
          }
          if (request?.module === 'knowledge' && request.action === 'createDraft') {
            knowledgeDraftCalls.push(request.payload);
            return makeResponse(request.id, {
              success: true,
              draft: {
                id: 'recovery-draft-e2e',
                title: request.payload?.title,
                body: request.payload?.body,
                type: 'synthesis',
                status: 'draft',
                sourceIds: [sessionKey],
                sourceRefs: [],
                createdBy: 'user',
                createdAt: new Date(1).toISOString(),
                updatedAt: new Date(1).toISOString(),
              },
            });
          }
          if (request?.module === 'knowledge' && request.action === 'proposeChange') {
            return makeResponse(request.id, {
              success: true,
              proposal: { id: 'proposal-e2e', draftId: request.payload?.draftId },
            });
          }
          return originalHostInvoke?.(event, request) ?? makeResponse(request?.id, {});
        });
        (globalThis as typeof globalThis & { __longTaskQueueDrainCalls?: unknown[] }).__longTaskQueueDrainCalls = queueDrainCalls;
        (globalThis as typeof globalThis & { __longTaskChatSendCalls?: unknown[] }).__longTaskChatSendCalls = chatSendCalls;
        (globalThis as typeof globalThis & { __longTaskLedgerAppendCalls?: unknown[] }).__longTaskLedgerAppendCalls = taskLedgerAppendCalls;
        (globalThis as typeof globalThis & { __longTaskTerminalInterruptCalls?: unknown[] }).__longTaskTerminalInterruptCalls = terminalInterruptCalls;
        (globalThis as typeof globalThis & { __longTaskKnowledgeDraftCalls?: unknown[] }).__longTaskKnowledgeDraftCalls = knowledgeDraftCalls;
      }, MAIN_SESSION_KEY);

      const page = await getStableWindow(app);
      await page.waitForLoadState('domcontentloaded');

      await expect(page.getByTestId('chat-long-task-queue-count')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-long-task-checkpoint')).toBeVisible();
      await expect(page.getByTestId('chat-long-task-intervention')).toBeVisible();
      await expect(page.getByTestId('chat-long-task-warnings')).toBeVisible();
      // Long-task control stays in Chat; recovery recommendations do not. The
      // recovery rail moved to Settings > Session & Recovery.
      await expect(page.getByTestId('chat-rollback-plan')).toHaveCount(0);

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

      // Terminal interrupt, Git review, and the recovery memory draft are no
      // longer reachable from the Chat message flow. Terminal and Git recovery
      // are Settings actions; the memory draft is triggered from the session
      // activity panel, which owns its own coverage.

      await page.getByTestId('chat-composer-input').fill('start a long validation run');
      await page.getByTestId('chat-composer-send').click();
      /*
       * The intervention strip is the composer's "a run is in flight AND there
       * is a draft to intervene WITH" surface — every button in it (steer,
       * queue, interrupt-and-replace) consumes the draft, which is why it is
       * gated on `hasComposerDraft`. Sending clears the composer, so the strip
       * appears with the NEXT draft rather than on send.
       */
      await expect(page.getByTestId('chat-intervention-controls')).toHaveCount(0);
      await page.getByTestId('chat-composer-input').fill('queue this after the active validation run');
      await expect(page.getByTestId('chat-intervention-controls')).toBeVisible();
      await expect(page.getByTestId('chat-intervention-guide')).toBeVisible();
      await expect(page.getByTestId('chat-intervention-interrupt')).toBeVisible();
      await expect(page.getByTestId('chat-intervention-queue')).toBeVisible();
      /* The button's label lives on `aria-label` (the visible hint is a
         Tooltip, not a `title` attribute). */
      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('aria-label', 'Queue');
      await page.getByTestId('chat-composer-send').click();
      await expect.poll(async () => (
        (await app.evaluate(() => (
          (globalThis as typeof globalThis & { __longTaskChatSendCalls?: Array<Record<string, unknown>> }).__longTaskChatSendCalls
            ?.filter((call) => call?.inputMode === 'queue').length ?? 0
        )))
      )).toBe(1);
      await page.getByTestId('chat-composer-input').fill('preserve the validation evidence before continuing');
      await page.keyboard.press('Control+Enter');

      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __longTaskChatSendCalls?: Array<Record<string, unknown>> }).__longTaskChatSendCalls
          ?.filter((call) => call?.inputMode === 'guide').length ?? 0
      ))).toBe(1);
      const chatCalls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __longTaskChatSendCalls?: Array<Record<string, unknown>> }).__longTaskChatSendCalls ?? []
      ));
      expect(chatCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          message: 'preserve the validation evidence before continuing',
          inputMode: 'guide',
          sessionKey: MAIN_SESSION_KEY,
        }),
      ]));
      await page.getByTestId('chat-composer-input').fill('stop and replace the active validation plan');
      await page.keyboard.press('Shift+Enter');
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __longTaskChatSendCalls?: Array<Record<string, unknown>> }).__longTaskChatSendCalls
          ?.filter((call) => call?.inputMode === 'interrupt').length ?? 0
      ))).toBe(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});
