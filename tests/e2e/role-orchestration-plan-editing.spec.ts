import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-plan-editing';

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
  name: 'Plan Editing Workspace',
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

test.describe('Role orchestration plan editing', () => {
  test('saves lightweight plan edits to Task Ledger without exposing an edge editor', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['roles.list', null])]: {
            roles: [{
              name: 'planner',
              displayName: 'Planner',
              description: 'Plans the work.',
              rolePrompt: 'Plan the work.',
              tools: ['read'],
              effort: 'medium',
              origin: 'built-in',
            }],
          },
          [stableStringify(['orchestrator.plan', { task: 'Stabilize smoke tests', agentId: 'main' }])]: {
            plan: {
              mode: 'lead-workers',
              leadRole: 'planner',
              workers: [{ roleName: 'planner', task: 'Plan the work', effort: 'medium' }],
              reasons: ['explicit-workers'],
              taskGraph: {
                graphRunId: 'plan-edit-e2e',
                status: 'planned',
                nodes: [{
                  taskNodeId: 'planner-1',
                  roleName: 'planner',
                  task: 'Plan the work',
                  phase: 'planning',
                  dependsOn: [],
                }],
                edges: [],
              },
            },
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
          [stableStringify(['taskLedger', 'appendEvents', null])]: {
            success: true,
            snapshot: { nodes: [], edges: [], eventsCount: 0 },
          },
        },
      });

      const page = await getStableWindow(app);
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-agents').click();
      await page.getByTestId('role-orchestration-toggle').click();
      await page.getByTestId('role-orchestration-task-input').fill('Stabilize smoke tests');
      await page.getByRole('button', { name: 'Plan', exact: true }).click();

      await page.getByTestId('orchestration-plan-edit-toggle').click();
      await page.getByTestId('orchestration-plan-disable-planner-1').click();
      await page.getByTestId('orchestration-plan-save-edits').click();

      const appendPayload = await app.evaluate(() => {
        const calls = (globalThis as unknown as {
          __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }>;
        }).__verseClawE2eHostCalls ?? [];
        return calls.findLast((call) => call.module === 'taskLedger' && call.action === 'appendEvents')?.payload ?? null;
      });
      expect(appendPayload).toMatchObject({
        events: expect.arrayContaining([
          expect.objectContaining({
            type: 'node_updated',
            payload: expect.objectContaining({
              patch: expect.objectContaining({
                metadata: expect.objectContaining({
                  projectionEdit: expect.objectContaining({
                    disabled: true,
                    baseProjectionId: 'plan-edit-e2e',
                  }),
                }),
              }),
            }),
          }),
        ]),
      });
      await expect(page.getByTestId('orchestration-plan-edge-editor')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
