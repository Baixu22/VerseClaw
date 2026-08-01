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

const sessionHistory = [
  {
    id: 'user-1',
    role: 'user',
    content: [{ type: 'text', text: 'Set up the release pipeline.' }],
    timestamp: 1711111110000,
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    content: [{ type: 'text', text: 'Release pipeline is ready.' }],
    timestamp: 1711111111000,
  },
];

const sourceWorkspace = {
  id: 'workspace-a',
  name: 'Workspace A',
  rootPath: 'C:/workspace-a',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: SESSION_KEY,
  agentBindings: {
    main: {
      workspaceId: 'workspace-a',
      agentId: 'main',
      sessionKey: SESSION_KEY,
    },
  },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
};

function baseHostApiMocks() {
  return {
    [stableStringify(['gateway', 'status', null])]: {
      state: 'running',
      port: 18789,
      pid: 12345,
      gatewayReady: true,
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
        json: { success: true, workspaces: [sourceWorkspace], activeWorkspaceId: 'workspace-a' },
      },
    },
    [stableStringify(['workspaces', 'getActive', null])]: {
      success: true,
      activeWorkspaceId: 'workspace-a',
      activeWorkspace: sourceWorkspace,
    },
    [stableStringify(['workspaces', 'list', null])]: {
      success: true,
      profiles: [sourceWorkspace],
      activeWorkspaceId: 'workspace-a',
      activeWorkspace: sourceWorkspace,
    },
    [stableStringify(['sessions', 'list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
      success: true,
      sessions: [{ key: SESSION_KEY, displayName: 'main' }],
    },
    [stableStringify(['sessions', 'rename', { id: SESSION_KEY, title: 'Release pipeline' }])]: {
      success: true,
    },
  };
}

test('slash /rename renames the current session through the host API', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });

  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {
        [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
          success: true,
          result: { messages: sessionHistory },
        },
      },
      hostApi: baseHostApiMocks(),
    });

    const window = await getStableWindow(app);

    // Open the composer and type /rename with a label.
    await window.getByTestId('chat-composer-input').fill('/rename Release pipeline');
    await window.getByTestId('chat-composer-input').press('Enter');

    // The rename toast confirms the action.
    await expect(
      window.getByText('Session renamed to "Release pipeline".'),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await closeElectronApp(app);
  }
});

test('slash /clear resets the local message view', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });

  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
      gatewayRpc: {
        [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
          success: true,
          result: { messages: sessionHistory },
        },
      },
      hostApi: baseHostApiMocks(),
    });

    const window = await getStableWindow(app);

    // Wait for the loaded history to render.
    await expect(window.getByText('Release pipeline is ready.')).toBeVisible({ timeout: 15_000 });

    await window.getByTestId('chat-composer-input').fill('/clear');
    await window.getByTestId('chat-composer-input').press('Enter');

    await expect(window.getByText('Session history cleared.')).toBeVisible({ timeout: 15_000 });
    await expect(window.getByText('Release pipeline is ready.')).not.toBeVisible();
  } finally {
    await closeElectronApp(app);
  }
});
