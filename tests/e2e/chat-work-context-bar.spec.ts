import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-context-bar';
const fixedTimestamp = 1_772_100_000_000;

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const workspace = {
  id: WORKSPACE_ID,
  name: 'Context Workspace',
  rootPath: '/workspace/context',
  agentId: 'main',
  selectedAgentId: 'main',
  activeSessionKey: SESSION_KEY,
  permissionMode: 'acceptEdits',
  createdAt: fixedTimestamp,
  updatedAt: fixedTimestamp,
  lastOpenedAt: fixedTimestamp,
  agentBindings: {},
  state: {
    chatFooter: { workContextVisible: true },
  },
  sessionStates: {
    [SESSION_KEY]: {
      chatFooter: { workContextVisible: true },
    },
  },
};

const seededHistory = [
  {
    id: 'user-work-context',
    role: 'user',
    content: [{ type: 'text', text: 'Research the docs and write a short report.' }],
    timestamp: fixedTimestamp,
  },
  {
    id: 'assistant-work-context-tools',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: 'I will fetch the source and prepare the report.',
      },
      {
        type: 'tool_use',
        id: 'tool-web',
        name: 'web_fetch',
        input: { url: 'https://example.com/docs/rendering' },
      },
      {
        type: 'tool_use',
        id: 'tool-write',
        name: 'Write',
        input: {
          file_path: '/workspace/context/work-context-report.md',
          content: '# Rendering report\n\nSource: https://example.com/docs/rendering\n',
        },
      },
    ],
    timestamp: fixedTimestamp + 1000,
  },
  {
    id: 'assistant-work-context-final',
    role: 'assistant',
    content: [{ type: 'text', text: 'The report is ready and includes the referenced website.' }],
    timestamp: fixedTimestamp + 2000,
  },
];

const gitStatus = {
  isRepository: true,
  workspaceRoot: '/workspace/context',
  repoRoot: '/workspace/context',
  branch: 'feature/work-context-bar-with-a-long-name',
  upstream: 'origin/feature/work-context-bar-with-a-long-name',
  ahead: 1,
  behind: 0,
  clean: false,
  detached: false,
  hasConflicts: false,
  stagedCount: 1,
  unstagedCount: 1,
  untrackedCount: 1,
  conflictedCount: 0,
  changes: [
    {
      path: 'src/pages/Chat/index.tsx',
      absolutePath: '/workspace/context/src/pages/Chat/index.tsx',
      status: 'M',
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      bucket: 'unstaged',
      additions: 12,
      deletions: 3,
      binary: false,
    },
    {
      path: 'src/components/assistant-render/WorkContextBar.tsx',
      absolutePath: '/workspace/context/src/components/assistant-render/WorkContextBar.tsx',
      status: 'A',
      staged: true,
      unstaged: false,
      untracked: false,
      conflicted: false,
      bucket: 'staged',
      additions: 80,
      deletions: 0,
      binary: false,
    },
    {
      path: 'tests/e2e/chat-work-context-bar.spec.ts',
      absolutePath: '/workspace/context/tests/e2e/chat-work-context-bar.spec.ts',
      status: '??',
      staged: false,
      unstaged: false,
      untracked: true,
      conflicted: false,
      bucket: 'untracked',
      additions: 40,
      deletions: 0,
      binary: false,
    },
  ],
};

const taskLedgerSnapshot = {
  schemaVersion: 1,
  workspaceId: WORKSPACE_ID,
  generatedAt: '2026-07-06T00:00:00.000Z',
  nodes: [
    {
      id: 'goal-context',
      title: 'Ship top work context',
      kind: 'goal',
      status: 'doing',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    },
    {
      id: 'review-context',
      title: 'Review visual states',
      kind: 'review',
      status: 'review',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    },
    {
      id: 'blocked-context',
      title: 'Validate narrow layout',
      kind: 'risk',
      status: 'blocked',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    },
  ],
  edges: [],
  sessionLinks: [],
  rootNodeIds: ['goal-context'],
  reviewNodeIds: ['review-context'],
  activeNodeIds: ['goal-context'],
  blockedNodeIds: ['blocked-context'],
  currentGoalId: 'goal-context',
  recentDecisions: [],
  eventsCount: 3,
  warnings: [],
};

async function installWorkContextMocks(app: Parameters<typeof installIpcMocks>[0]) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
        success: true,
        result: { messages: seededHistory },
      },
      [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
        success: true,
        result: { messages: seededHistory },
      },
    },
    hostApi: {
      [stableStringify(['/api/gateway/status', 'GET'])]: {
        ok: true,
        data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345 } },
      },
      [stableStringify(['agents', 'list', null])]: {
        success: true,
        agents: [{
          id: 'main',
          name: 'Main',
          isDefault: true,
          workspace: '/workspace/context',
          mainSessionKey: SESSION_KEY,
          channelTypes: [],
        }],
        defaultAgentId: 'main',
        configuredChannelTypes: [],
        channelOwners: {},
        channelAccountOwners: {},
      },
      [stableStringify(['/api/agents', 'GET'])]: {
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: { success: true, agents: [{ id: 'main', name: 'Main', workspace: '/workspace/context' }] },
        },
      },
      [stableStringify(['workspaces', 'list', null])]: {
        profiles: [workspace],
        activeWorkspaceId: WORKSPACE_ID,
        activeWorkspace: workspace,
      },
      [stableStringify(['workspaces', 'getActive', null])]: {
        activeWorkspaceId: WORKSPACE_ID,
        activeWorkspace: workspace,
      },
      [stableStringify(['workspaces', 'saveState', null])]: { success: true },
      [stableStringify(['taskLedger', 'snapshot', { workspaceId: WORKSPACE_ID }])]: {
        success: true,
        snapshot: taskLedgerSnapshot,
      },
      [stableStringify(['git', 'status', null])]: {
        success: true,
        status: gitStatus,
      },
      [stableStringify(['git', 'capabilities', null])]: {
        success: true,
        git: { available: true, version: 'git version 2.45.0' },
        gh: { available: true, version: 'gh version 2.56.0' },
      },
      [stableStringify(['git', 'githubAuthStatus', null])]: {
        success: true,
        available: true,
        authenticated: true,
        user: 'octocat',
        hosts: ['github.com'],
      },
      [stableStringify(['git', 'githubRepo', null])]: {
        success: true,
        repository: { owner: 'octo', name: 'context', defaultBranch: 'main' },
      },
      [stableStringify(['git', 'branches', null])]: {
        success: true,
        branches: [
          { name: 'feature/work-context-bar-with-a-long-name', current: true },
          { name: 'main', current: false },
        ],
      },
      [stableStringify(['git', 'worktrees', null])]: {
        success: true,
        worktrees: [{ path: '/workspace/context', branch: 'feature/work-context-bar-with-a-long-name', head: 'abc123' }],
      },
      [stableStringify(['git', 'stashList', null])]: {
        success: true,
        stashes: [],
      },
      [stableStringify(['git', 'prList', { limit: 8, state: 'open' }])]: {
        success: true,
        pullRequests: [],
      },
      [stableStringify(['mcp', 'listTools', { serverId: 'clawx-git' }])]: {
        success: true,
        serverId: 'clawx-git',
        status: 'connected',
        tools: [],
      },
      [stableStringify(['shell', 'openExternal', { url: 'https://example.com/docs/rendering' }])]: { success: true },
    },
  });
}

async function stabilizeVisuals(page: Awaited<ReturnType<typeof getStableWindow>>) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
}

test.describe('Verse Claw work context bar', () => {
  test('renders above chat, toggles, opens artifacts and sources, and routes Git actions to the panel only', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installWorkContextMocks(app);
      const page = await getStableWindow(app);
      await page.setViewportSize({ width: 1440, height: 860 });
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }
      await stabilizeVisuals(page);
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      });

      await expect(page.getByTestId('chat-page')).toBeVisible();
      const bar = page.getByTestId('work-context-bar');
      await expect(bar).toBeVisible({ timeout: 30_000 });
      await expect(bar).toContainText('Task log / plan');
      await expect(bar).toContainText('web_fetch');
      await expect(bar).toContainText('Write');
      await expect(bar).toContainText('Artifacts');
      await expect(bar).toContainText('Sources');
      await expect(bar).toContainText('Context Workspace');
      await expect(bar).toContainText('feature/work-context-bar-with-a-long-name');
      await expect(bar).toContainText('3 changes');
      await expect(bar).toContainText('+132 -3');
      await expect(bar).not.toContainText('Ship top work context');
      await expect(page.getByTestId('turn-work-panel')).toHaveCount(0);
      await expect(page.getByTestId('chat-scroll-container')).toBeVisible();

      await expect(bar).toHaveScreenshot('work-context-bar-light.png', {
        animations: 'disabled',
        caret: 'hide',
      });

      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
      });
      await expect(bar).toHaveScreenshot('work-context-bar-dark.png', {
        animations: 'disabled',
        caret: 'hide',
      });

      await page.setViewportSize({ width: 430, height: 760 });
      await expect(bar).toBeVisible();
      const bounds = await bar.boundingBox();
      expect(bounds?.width ?? 0).toBeLessThanOrEqual(430);
      await expect(bar).toHaveScreenshot('work-context-bar-narrow.png', {
        animations: 'disabled',
        caret: 'hide',
      });
      await page.setViewportSize({ width: 1440, height: 860 });
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark');
      });

      await page.getByTestId('chat-work-context-toggle').click();
      await expect(page.getByTestId('work-context-bar')).toHaveCount(0);
      await page.getByTestId('chat-work-context-toggle').click();
      await expect(page.getByTestId('work-context-bar')).toBeVisible();

      await page.getByTestId('work-context-source-tool-web:https://example.com/docs/rendering:0').click();
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> })
          .__verseClawE2eHostCalls ?? []
      ))).toContainEqual(expect.objectContaining({
        module: 'shell',
        action: 'openExternal',
        payload: { url: 'https://example.com/docs/rendering' },
      }));

      await page.getByRole('button', { name: /work-context-report\.md/ }).click();
      await expect(page.getByTestId('artifact-panel')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('work-context-view-changes').click();
      await expect(page.getByTestId('artifact-panel-aside')).toBeVisible();
      await expect(page.getByTestId('workspace-git-panel')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('work-context-commit-push').click();
      await page.getByTestId('work-context-create-pr').click();

      const calls = await app.evaluate(() => (
        (globalThis as typeof globalThis & { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> })
          .__verseClawE2eHostCalls ?? []
      ));
      expect(calls).toContainEqual(expect.objectContaining({
        module: 'workspaces',
        action: 'saveState',
        payload: expect.objectContaining({
          id: WORKSPACE_ID,
          sessionKey: SESSION_KEY,
          state: expect.objectContaining({
            artifactPanel: expect.objectContaining({ workspaceView: 'git' }),
          }),
        }),
      }));
      expect(calls.filter((call) =>
        call.module === 'git'
        && ['commit', 'push', 'prCreate'].includes(String(call.action))
      )).toHaveLength(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
