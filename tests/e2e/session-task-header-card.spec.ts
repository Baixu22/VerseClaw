import { expect, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const workspace = {
  id: 'workspace-a',
  name: 'Workspace A',
  rootPath: 'C:/workspace-a',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: SESSION_KEY,
  agentBindings: { main: { workspaceId: 'workspace-a', agentId: 'main', sessionKey: SESSION_KEY } },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: { activeTopicId: null, draftInput: '' },
  sessionStates: { [SESSION_KEY]: { activeTopicId: null, draftInput: '' } },
  sessionFolderAssignments: {},
  sessionFolders: [],
};

function baseHostApiMocks(): Record<string, unknown> {
  return {
    [stableStringify(['gateway', 'status', null])]: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    [stableStringify(['providers', 'accounts', null])]: [],
    [stableStringify(['providers', 'vendors', null])]: [],
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: { status: 200, ok: true, json: { success: true, agents: [{ id: 'main', name: 'Main' }] } },
    },
    [stableStringify(['/api/workspaces', 'GET'])]: {
      ok: true,
      data: { status: 200, ok: true, json: { success: true, workspaces: [workspace], activeWorkspaceId: 'workspace-a' } },
    },
    [stableStringify(['workspaces', 'getActive', null])]: { success: true, activeWorkspaceId: 'workspace-a', activeWorkspace: workspace },
    [stableStringify(['workspaces', 'list', null])]: { success: true, profiles: [workspace], activeWorkspaceId: 'workspace-a', activeWorkspace: workspace },
    [stableStringify(['sessions', 'describe', null])]: {
      success: true,
      session: {
        key: SESSION_KEY,
        label: 'Labeled session',
        goal: { objective: 'Build the thing', status: 'active', tokenBudget: 1000, tokensUsed: 250 },
        parentSessionKey: null,
        forkedFromParent: false,
        childSessions: [],
        compactionCheckpointCount: 1,
      },
    },
    [stableStringify(['sessions', 'compactionStatus', null])]: {
      success: true,
      available: true,
      canCompact: true,
      inProgress: false,
      pressure: 'low',
      truncatedMessageCount: 3,
      warnings: [],
    },
    [stableStringify(['sessions', 'longTaskControlStatus', null])]: { success: true, available: false, queueCount: 0, warnings: [] },
    [stableStringify(['chat', 'sendWithMedia', null])]: { success: true, result: { runId: 'run-goal-e2e' } },
  };
}

test('renders the session task card with goal state and user goal actions', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {
        [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
          success: true,
          result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
        },
        [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
          success: true,
          result: { messages: [] },
        },
      },
      hostApi: baseHostApiMocks(),
    });

    const card = app.windows()[0].getByTestId('session-task-header-card');
    await expect(card).toBeVisible();
    await expect(card.getByText('Active', { exact: true })).toBeVisible();

    await app.windows()[0].getByTestId('session-task-header-expand').click();
    await expect(app.windows()[0].getByText('Build the thing').first()).toBeVisible();
    await expect(app.windows()[0].getByTestId('session-task-goal-start')).toBeEnabled();

    await app.windows()[0].getByTestId('session-task-goal-start').click();
    await expect(card).toBeVisible();
  } finally {
    await app.close();
  }
});