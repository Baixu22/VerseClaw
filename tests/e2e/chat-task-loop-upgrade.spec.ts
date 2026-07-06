import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-task-loop-upgrade';
const TASK_TEXT = '请按照顺序修复鉴权矩阵问题，补充单元测试和 e2e，跑 typecheck，失败要修复到通过再继续。';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const WORKSPACE = {
  id: WORKSPACE_ID,
  name: 'Task Loop Workspace',
  rootPath: 'C:\\Users\\27933\\Desktop\\clawx\\ClawX',
  agentId: 'main',
  activeSessionKey: SESSION_KEY,
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: {
    [SESSION_KEY]: {},
  },
};

const EMPTY_TASK_LEDGER = {
  snapshot: {
    workspaceId: WORKSPACE_ID,
    nodes: [],
    edges: [],
    eventsCount: 0,
    activeNodeIds: [],
    blockedNodeIds: [],
    reviewNodeIds: [],
    recentDecisions: [],
  },
};

test.describe('Chat Task Loop upgrade', () => {
  test('suggests but only starts task_loop.run after explicit confirmation', async ({ launchElectronApp }) => {
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
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['task_loop.run', {
            task: TASK_TEXT,
            sessionKey: SESSION_KEY,
            agentId: 'main',
            workspaceId: WORKSPACE_ID,
          }])]: {
            loop: {
              loopRunId: 'loop-chat-upgrade',
              status: 'running',
              phase: 'started',
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { language: 'en', setupComplete: true },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'Main' }],
              },
            },
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [WORKSPACE],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: WORKSPACE,
          },
          [stableStringify(['workspaces', 'saveState', null])]: { success: true },
          [stableStringify(['taskLedger', 'snapshot', { workspaceId: WORKSPACE_ID }])]: EMPTY_TASK_LEDGER,
          [stableStringify(['/api/skills/quick-access', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, skills: [] },
            },
          },
          [stableStringify(['usage', 'live', {
            sessionKey: SESSION_KEY,
            runId: null,
            streaming: false,
          }])]: {
            success: true,
            usage: null,
          },
          [stableStringify(['usage', 'contextRange', {
            sessionKey: SESSION_KEY,
            modelRef: null,
            messageCount: 0,
            usedTokens: null,
          }])]: {
            success: true,
            range: null,
          },
          [stableStringify(['sessions', 'longTaskControlStatus', {
            sessionKey: SESSION_KEY,
            agentId: 'main',
          }])]: {
            success: true,
            available: true,
            queueCount: 0,
            warnings: [],
          },
        },
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('chat-composer-input').fill(TASK_TEXT);
      await expect(page.getByTestId('chat-task-loop-upgrade-suggestion')).toBeVisible();

      let taskLoopCalls = await app.evaluate(() => (
        ((globalThis as unknown as { __verseClawE2eHostCalls?: Array<Record<string, unknown>> }).__verseClawE2eHostCalls ?? [])
          .filter((call) => call.module === 'gateway'
            && call.action === 'rpc'
            && (call.payload as { method?: string } | null)?.method === 'task_loop.run')
      ));
      expect(taskLoopCalls).toHaveLength(0);

      await page.getByTestId('chat-task-loop-upgrade-confirm').click();

      await expect.poll(async () => await app.evaluate(() => (
        ((globalThis as unknown as { __verseClawE2eHostCalls?: Array<Record<string, unknown>> }).__verseClawE2eHostCalls ?? [])
          .filter((call) => call.module === 'gateway'
            && call.action === 'rpc'
            && (call.payload as { method?: string } | null)?.method === 'task_loop.run').length
      ))).toBe(1);

      taskLoopCalls = await app.evaluate(() => (
        ((globalThis as unknown as { __verseClawE2eHostCalls?: Array<Record<string, unknown>> }).__verseClawE2eHostCalls ?? [])
          .filter((call) => call.module === 'gateway'
            && call.action === 'rpc'
            && (call.payload as { method?: string } | null)?.method === 'task_loop.run')
      ));
      expect(taskLoopCalls[0]?.payload).toMatchObject({
        method: 'task_loop.run',
        params: {
          task: TASK_TEXT,
          sessionKey: SESSION_KEY,
          agentId: 'main',
          workspaceId: WORKSPACE_ID,
        },
      });
      await expect(page.getByTestId('chat-composer-input')).toHaveValue('');
    } finally {
      await closeElectronApp(app);
    }
  });
});
