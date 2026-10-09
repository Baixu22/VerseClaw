/**
 * #121 — Session Activity must show "unknown" instead of an empty card when the
 * background read failed, and must not report a successful empty read as a
 * failure.
 *
 * SCOPE OF THIS SPEC: it pins the renderer half of the pipeline — the host-api
 * result (`sessionActivity.snapshot`) → renderer store → Session Activity panel.
 * The Main-process derivation of `backgroundRead.state` (RPC timeout, owner read
 * exception, missing projection fields, successful empty projection) is pinned
 * by `tests/unit/session-activity-background-read.test.ts`, because the gateway
 * transport is not reachable from the mocked E2E harness and a real gateway RPC
 * would make these assertions environment-dependent.
 *
 * driven_by: agent; actor: p2-issues-batch2.
 */
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-session-activity';
const READ_AT = 1_760_000_000_000;

const PERSISTED_TURN = [
  {
    role: 'user',
    id: 'background-read-user-turn',
    content: [{ type: 'text', text: 'Keep the background read honest' }],
    timestamp: 1_760_000_000,
  },
];

const WORKSPACE = {
  id: WORKSPACE_ID,
  name: 'Session Activity Workspace',
  rootPath: 'C:/workspace-session-activity',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: SESSION_KEY,
  agentBindings: {
    main: { workspaceId: WORKSPACE_ID, agentId: 'main', sessionKey: SESSION_KEY },
  },
  permissionMode: 'acceptEdits',
  createdAt: 1,
  updatedAt: 1,
  lastOpenedAt: 1,
  state: {},
  sessionStates: { [SESSION_KEY]: {} },
};

/** The shape `electron/services/session-activity-api.ts` returns to the store. */
function sessionActivitySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      sessionKey: SESSION_KEY,
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
    goals: [],
    processes: [],
    lineage: [],
    continuity: { queueCount: 0, contextPressure: null, checkpoint: false, blockedReason: null },
    availability: { git: true, tasks: true, subagents: true, terminals: true, continuity: true },
    backgroundRead: { state: 'unknown', readAt: null, failedAt: null },
    capturedAt: READ_AT,
    ...overrides,
  };
}

const CLEAN_REPOSITORY = {
  isRepository: true,
  workspaceRoot: 'C:/workspace-session-activity',
  branch: 'main',
  ahead: 0,
  behind: 0,
  clean: true,
  hasConflicts: false,
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  conflictedCount: 0,
  changes: [],
};

function baseHostApiMocks(activityResult: unknown) {
  return {
    [stableStringify(['gateway', 'status', null])]: {
      state: 'running',
      port: 18789,
      pid: 12345,
      gatewayReady: true,
    },
    [stableStringify(['settings', 'getAll', null])]: { success: true, data: {} },
    [stableStringify(['workspaces', 'list', null])]: {
      success: true,
      profiles: [WORKSPACE],
      activeWorkspaceId: WORKSPACE_ID,
      activeWorkspace: WORKSPACE,
    },
    [stableStringify(['workspaces', 'getActive', null])]: {
      success: true,
      activeWorkspaceId: WORKSPACE_ID,
      activeWorkspace: WORKSPACE,
    },
    [stableStringify(['/api/workspaces', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, workspaces: [WORKSPACE], activeWorkspaceId: WORKSPACE_ID },
      },
    },
    [stableStringify(['agents', 'list', null])]: {
      success: true,
      agents: [{ id: 'main', name: 'main', canonicalSessionKey: SESSION_KEY }],
      defaultAgentId: 'main',
      defaultModelRef: null,
    },
    [stableStringify(['/api/agents', 'GET'])]: {
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true, agents: [{ id: 'main', name: 'main' }] },
      },
    },
    [stableStringify(['sessions', 'history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
      messages: PERSISTED_TURN,
      hasMore: false,
    },
    [stableStringify(['git', 'status', null])]: { success: true, status: CLEAN_REPOSITORY },
    /* Null payload = wildcard for this module/action; the store sends the
     * active workspace id, which this spec does not need to pin. */
    [stableStringify(['sessionActivity', 'snapshot', null])]: activityResult,
  };
}

function gatewayRpcMocks() {
  return {
    [stableStringify(['sessions.list', {}])]: {
      success: true,
      result: { sessions: [{ key: SESSION_KEY, displayName: 'Background read' }] },
    },
    [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
      success: true,
      result: { sessions: [{ key: SESSION_KEY, displayName: 'Background read' }] },
    },
    [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500_000 }])]: {
      success: true,
      result: { messages: PERSISTED_TURN },
    },
    [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200 }])]: {
      success: true,
      result: { messages: PERSISTED_TURN },
    },
  };
}

test.describe('Session activity background read state', () => {
  test('shows the unknown state and its retry when the background read failed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: gatewayRpcMocks(),
        hostApi: baseHostApiMocks({
          success: true,
          runtimeAvailable: false,
          snapshot: sessionActivitySnapshot({
            backgroundRead: { state: 'unknown', readAt: null, failedAt: READ_AT },
          }),
        }),
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Keep the background read honest')).toBeVisible({ timeout: 30_000 });

      const toggle = page.getByTestId('chat-session-activity-toggle');
      await expect(toggle).toBeVisible();
      await toggle.click();

      await expect(page.getByTestId('session-activity-panel')).toBeVisible();
      const unknown = page.getByTestId('session-activity-background-unknown');
      await expect(unknown).toBeVisible();
      await expect(unknown).toContainText(/unknown/i);
      /* The unknown state reuses the card's existing retry affordance. */
      await expect(page.getByTestId('session-activity-retry')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not report a successful empty read as a failure', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: gatewayRpcMocks(),
        hostApi: baseHostApiMocks({
          success: true,
          runtimeAvailable: true,
          snapshot: sessionActivitySnapshot({
            git: CLEAN_REPOSITORY,
            backgroundRead: { state: 'known', readAt: READ_AT, failedAt: null },
          }),
        }),
      });

      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Keep the background read honest')).toBeVisible({ timeout: 30_000 });

      const toggle = page.getByTestId('chat-session-activity-toggle');
      await expect(toggle).toBeVisible();
      await toggle.click();

      /* A known read still renders the sections it does have ... */
      await expect(page.getByTestId('session-activity-environment')).toBeVisible();
      /* ... and says nothing about an unknown background status. */
      await expect(page.getByTestId('session-activity-background-unknown')).toHaveCount(0);
      await expect(page.getByTestId('session-activity-background-stale')).toHaveCount(0);
      await expect(page.getByTestId('session-activity-alert')).toHaveCount(0);
      await expect(page.getByTestId('session-activity-retry')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
