import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-orchestration-diagnostics';

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
  name: 'Orchestration Diagnostics Workspace',
  rootPath: 'C:\\Users\\27933\\Desktop\\clawx\\ClawX',
  agentId: 'main',
  activeSessionKey: SESSION_KEY,
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: { [SESSION_KEY]: {} },
};

const orchestrationResult = {
  status: 'partial',
  orchestrationRunId: 'orch-diagnostics-e2e',
  graphStatus: 'partial',
  taskGraph: {
    graphRunId: 'orch-diagnostics-e2e',
    mode: 'staged',
    status: 'partial',
    nodes: [{
      taskNodeId: 'reviewer-1',
      roleName: 'reviewer',
      phase: 'review',
      task: 'Review the failed worker path.',
      status: 'failed',
      dependsOn: [],
    }],
    edges: [],
  },
  executionWaves: [{ wave: 1, taskNodeIds: ['reviewer-1'], roles: ['reviewer'] }],
  failures: [{ roleName: 'reviewer', status: 'forbidden', error: 'max children reached' }],
  orchestrationDiagnostics: {
    kind: 'ordinary-orchestration-diagnostics',
    boundary: 'diagnostics-only',
    status: 'needs_attention',
    summary: '1 worker did not start. Ordinary orchestration is showing diagnostics only.',
    failedWorkerCount: 1,
    taskLoopUpgradeAvailable: true,
    recommendations: [{
      code: 'worker-spawn-failed',
      roleName: 'reviewer',
      message: 'Worker failed before acceptance: max children reached',
      recommendedAction: 'Review worker limits or permissions before retrying ordinary orchestration.',
    }],
    nextSteps: ['Explicitly start Task Loop only if a governed long-run retry is needed'],
  },
};

test.describe('Role orchestration diagnostics', () => {
  test('shows diagnostics for ordinary orchestration failure without automatic Task Loop RPC', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: {
              messages: [
                { role: 'user', content: 'Coordinate a failing ordinary orchestration' },
                {
                  role: 'assistant',
                  id: 'team-tool-turn',
                  content: [{
                    type: 'tool_use',
                    id: 'team-1',
                    name: 'team_orchestrate',
                    input: { task: 'Coordinate a failing ordinary orchestration', graphMode: 'staged' },
                  }],
                },
                {
                  role: 'toolresult',
                  toolCallId: 'team-1',
                  content: JSON.stringify(orchestrationResult),
                },
              ],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { language: 'en', setupComplete: true } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main' }] } },
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [WORKSPACE],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: WORKSPACE,
          },
          [stableStringify(['workspaces', 'saveState', null])]: { success: true },
          [stableStringify(['usage', 'live', { sessionKey: SESSION_KEY, runId: null, streaming: false }])]: {
            success: true,
            usage: null,
          },
          [stableStringify(['usage', 'contextRange', {
            sessionKey: SESSION_KEY,
            modelRef: null,
            messageCount: 3,
            usedTokens: null,
          }])]: {
            success: true,
            range: null,
          },
          [stableStringify(['sessions', 'longTaskControlStatus', { sessionKey: SESSION_KEY, agentId: 'main' }])]: {
            success: true,
            available: true,
            queueCount: 0,
            warnings: [],
          },
        },
      });

      const page = await getStableWindow(app);
      const summaryToggle = page.getByTestId('chat-turn-summary-toggle');
      await expect(summaryToggle).toBeVisible({ timeout: 30_000 });
      if (await summaryToggle.getAttribute('aria-expanded') === 'false') {
        await summaryToggle.click();
      }
      await expect(page.getByTestId('chat-team-orchestration-card')).toBeVisible();
      const diagnosticsPanel = page.getByTestId('chat-team-orchestration-diagnostics');
      await expect(diagnosticsPanel.getByText('Worker failed before acceptance: max children reached')).toBeVisible();
      await expect(diagnosticsPanel.getByText('Review worker limits or permissions before retrying ordinary orchestration.')).toBeVisible();
      await expect(diagnosticsPanel.getByText('Explicitly start Task Loop only if a governed long-run retry is needed')).toBeVisible();

      const taskLoopCalls = await app.evaluate(() => (
        ((globalThis as unknown as { __verseClawE2eHostCalls?: Array<Record<string, unknown>> }).__verseClawE2eHostCalls ?? [])
          .filter((call) => call.module === 'gateway'
            && call.action === 'rpc'
            && (call.payload as { method?: string } | null)?.method === 'task_loop.run')
      ));
      expect(taskLoopCalls).toHaveLength(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows Routing Memo shadow dashboard without claiming active routing', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['roles.list', null])]: {
            roles: [{
              name: 'reviewer',
              displayName: 'Reviewer',
              description: 'Reviews implementation quality.',
              rolePrompt: 'Review the change.',
              tools: ['read'],
              effort: 'medium',
              origin: 'built-in',
            }],
          },
          [stableStringify(['roles.get', null])]: { soul: '' },
          [stableStringify(['routing_memo.summary', { workspaceDir: WORKSPACE.rootPath }])]: {
            pilotMode: 'shadow',
            authority: 'shadow',
            authorityReason: 'pilot-shadow',
            sampleCount: 2,
            outcomes: {
              graphStatus: { pending: 0, completed: 1, partial: 1, failed: 0 },
              qualityOverall: { good: 1, needs_attention: 1, poor_attempt: 0 },
            },
            shadow: {
              sampleCount: 2,
              divergenceCount: 1,
              outcomes: { same: 1, memo_better: 0, memo_worse: 1, unknown: 0 },
              divergenceSuccessRate: 0,
            },
            activeGate: {
              eligible: false,
              reasons: ['shadow-sample-count-below-threshold'],
              minShadowSamples: 20,
              minDivergenceSuccessRate: 0.7,
              shadowSampleCount: 2,
              divergenceCount: 1,
              divergenceSuccessRate: 0,
            },
            recentSamples: [{
              id: 'memo-shadow-same',
              leadRole: 'reviewer',
              graphStatus: 'partial',
              shadow: {
                actualLeadRole: 'reviewer',
                memoLeadRole: 'reviewer',
                diverged: false,
                outcome: 'same',
                similarity: 0.91,
              },
            }],
          },
        },
        hostApi: {
          [stableStringify(['/api/settings', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { language: 'en', setupComplete: true } },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main' }] } },
          },
          [stableStringify(['channels', 'accounts', null])]: { success: true, channels: [] },
          [stableStringify(['providers', 'accounts', null])]: { success: true, accounts: [] },
          [stableStringify(['providers', 'vendors', null])]: { success: true, vendors: [] },
          [stableStringify(['providers', 'getDefaultAccount', null])]: { success: true, accountId: null },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [WORKSPACE],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: WORKSPACE,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            profiles: [WORKSPACE],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: WORKSPACE,
          },
          [stableStringify(['workspaces', 'saveState', null])]: { success: true },
        },
      });

      const page = await getStableWindow(app);
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-agents').click();
      await page.getByTestId('role-orchestration-toggle').click();

      await expect(page.getByTestId('routing-memo-dashboard')).toBeVisible();
      await expect(page.getByTestId('routing-memo-authority')).toContainText('shadow');
      await expect(page.getByTestId('routing-memo-samples')).toContainText('2');
      await expect(page.getByTestId('routing-memo-divergence')).toContainText('1');
      await expect(page.getByTestId('routing-memo-outcomes')).toContainText('1 complete / 1 partial');
      await expect(page.getByTestId('routing-memo-active-gate')).toContainText('Gate not met');
      await expect(page.getByTestId('routing-memo-recent-sample')).toContainText('same');

      const summaryCalls = await app.evaluate(() => (
        ((globalThis as unknown as { __verseClawE2eHostCalls?: Array<Record<string, unknown>> }).__verseClawE2eHostCalls ?? [])
          .filter((call) => call.module === 'gateway'
            && call.action === 'rpc'
            && (call.payload as { method?: string } | null)?.method === 'routing_memo.summary')
      ));
      expect(summaryCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});
