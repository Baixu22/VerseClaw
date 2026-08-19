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

const TEST_WORKSPACE = {
  id: 'workspace-session-activity',
  name: 'Session Activity Workspace',
  rootPath: 'C:/project',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: MAIN_SESSION_KEY,
  agentBindings: {
    main: { workspaceId: 'workspace-session-activity', agentId: 'main', sessionKey: MAIN_SESSION_KEY },
  },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: {
    [MAIN_SESSION_KEY]: {},
  },
};

const ACTIVITY_SNAPSHOT = {
  session: {
    sessionKey: MAIN_SESSION_KEY,
    runId: null,
    status: 'idle',
    startedAt: null,
    endedAt: null,
    error: null,
    updatedAt: 0,
  },
  git: null,
  tasks: [],
  subagents: [],
  terminals: [],
  goals: [
    {
      id: 'mission-phase5-e2e',
      kind: 'mission',
      label: 'Mission mission-phase5-e2e',
      status: 'running',
      phase: 'execute',
      progress: 0.4,
      updatedAt: Date.now() - 1_000,
    },
    {
      id: 'flow-phase5-e2e',
      kind: 'flow',
      label: 'Goal wait flow-phase5-e2e',
      status: 'waiting',
      digest: 'sha256:e2edigest00000000000000000000000000000000',
      updatedAt: Date.now() - 2_000,
    },
  ],
  processes: [
    {
      id: 'bash-phase5-e2e',
      kind: 'bash',
      label: 'Process bash-phase5-e2e',
      status: 'running',
      pid: 4242,
      updatedAt: Date.now() - 1_000,
    },
    {
      id: 'goal-owned-phase5-e2e',
      kind: 'goalOwned',
      label: 'Goal process goal-owned-phase5-e2e',
      status: 'completed',
      digest: 'e2edigest00000000',
      updatedAt: Date.now() - 4_000,
    },
  ],
  lineage: [
    {
      id: 'child-phase5-e2e',
      kind: 'child',
      sessionKey: 'agent:explorer:child-phase5-e2e',
      role: 'explorer',
      status: 'started',
      updatedAt: Date.now() - 500,
    },
  ],
  continuity: {
    queueCount: 0,
    contextPressure: null,
    checkpoint: false,
    blockedReason: null,
  },
  availability: {
    git: false,
    tasks: true,
    subagents: true,
    terminals: false,
    continuity: true,
  },
  capturedAt: Date.now(),
};

test.describe('session activity panel', () => {
  test('renders goal, process, and lineage states from the read-only snapshot', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'Main' }],
            },
          },
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'Main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: MAIN_SESSION_KEY, limit: 200, maxChars: 500_000 }])]: {
            success: true,
            result: {
              messages: [{ role: 'user', id: 'opening', timestamp: Date.now() / 1000, content: [{ type: 'text', text: 'Phase 5 read model E2E' }] }],
              thinkingLevel: null,
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [{ id: 'main', name: 'Main', isDefault: true, modelDisplay: 'gpt-5', modelRef: 'openai/gpt-5', overrideModelRef: null, inheritedModel: true, workspace: 'C:/project', agentDir: 'C:/openclaw/agents/main/agent', mainSessionKey: MAIN_SESSION_KEY, channelTypes: [] }],
                defaultAgentId: 'main',
                configuredChannelTypes: [],
                channelOwners: {},
                channelAccountOwners: {},
              },
            },
          },
          [stableStringify(['channels', 'accounts', null])]: { success: true, channels: [] },
          [stableStringify(['workspaces', 'list', null])]: {
            success: true,
            profiles: [TEST_WORKSPACE],
            activeWorkspaceId: TEST_WORKSPACE.id,
            activeWorkspace: TEST_WORKSPACE,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            success: true,
            activeWorkspaceId: TEST_WORKSPACE.id,
            activeWorkspace: TEST_WORKSPACE,
          },
          [stableStringify(['sessionActivity', 'snapshot', { sessionKey: MAIN_SESSION_KEY, workspaceId: TEST_WORKSPACE.id }])]: {
            success: true,
            snapshot: ACTIVITY_SNAPSHOT,
            runtimeAvailable: true,
          },
          [stableStringify(['sessionActivity', 'snapshot', { sessionKey: MAIN_SESSION_KEY, workspaceId: null }])]: {
            success: true,
            snapshot: ACTIVITY_SNAPSHOT,
            runtimeAvailable: true,
          },
        },
      });

      const page = await getStableWindow(app);
      await page.waitForLoadState('domcontentloaded');

      const mainRow = page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`);
      await expect(mainRow).toBeVisible({ timeout: 30_000 });
      await mainRow.click();
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const activityToggle = page.getByTestId('chat-session-activity-toggle');
      await expect(activityToggle).toBeVisible({ timeout: 15_000 });
      await activityToggle.click();

      const panel = page.getByTestId('session-activity-panel');
      await expect(panel).toBeVisible();

      const goals = page.getByTestId('session-activity-goals');
      const processes = page.getByTestId('session-activity-processes');
      const lineage = page.getByTestId('session-activity-lineage');
      await expect(goals).toBeVisible();
      await expect(processes).toBeVisible();
      await expect(lineage).toBeVisible();

      await expect(goals).toContainText('Goals & waits');
      await expect(goals).toContainText('Mission mission-phase5-e2e');
      await expect(goals).toContainText('Running');
      await expect(goals).toContainText('Goal wait flow-phase5-e2e');
      await expect(goals).toContainText('Waiting');

      await expect(processes).toContainText('Processes');
      await expect(processes).toContainText('Process bash-phase5-e2e');
      await expect(processes).toContainText('Goal process goal-owned-phase5-e2e');
      await expect(processes).toContainText('Done');

      await expect(lineage).toContainText('Lineage');
      await expect(lineage).toContainText('explorer');
      await expect(lineage).toContainText('Running');

      // Phase 5 is read-only: the projection sections expose no lifecycle buttons or actions.
      await expect(goals.getByRole('button')).toHaveCount(0);
      await expect(processes.getByRole('button')).toHaveCount(0);
      await expect(lineage.getByRole('button')).toHaveCount(0);

      await page.setViewportSize({ width: 700, height: 800 });
      await expect(activityToggle).toHaveCount(0);
      await expect(panel).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
