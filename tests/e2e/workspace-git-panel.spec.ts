import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-1';

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
  name: 'Demo Workspace',
  rootPath: '/workspace/demo',
  permissionMode: 'acceptEdits',
  activeSessionKey: SESSION_KEY,
  state: {},
  sessionStates: {},
};

const gitStatus = {
  isRepository: true,
  workspaceRoot: '/workspace/demo',
  repoRoot: '/workspace/demo',
  branch: 'feature/git-panel',
  upstream: 'origin/feature/git-panel',
  ahead: 1,
  behind: 0,
  clean: false,
  detached: false,
  hasConflicts: false,
  stagedCount: 0,
  unstagedCount: 1,
  untrackedCount: 0,
  conflictedCount: 0,
  changes: [{
    path: 'src/demo.ts',
    absolutePath: '/workspace/demo/src/demo.ts',
    status: 'M',
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    bucket: 'unstaged',
    additions: 2,
    deletions: 1,
    binary: false,
  }],
};

test.describe('Workspace Git panel', () => {
  test('renders status, diff, auth guidance, and approval-blocked write actions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            agents: [{
              id: 'main',
              name: 'Main',
              isDefault: true,
              workspace: '/workspace/demo',
              mainSessionKey: SESSION_KEY,
              channelTypes: [],
            }],
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
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
          [stableStringify(['workspaces', 'saveState', {
            id: WORKSPACE_ID,
            sessionKey: SESSION_KEY,
            state: { artifactPanel: { workspaceView: 'git' } },
          }])]: { success: true },
          [stableStringify(['workspaces', 'saveState', {
            id: WORKSPACE_ID,
            sessionKey: SESSION_KEY,
            state: { artifactPanel: { gitSelectedPath: 'src/demo.ts' } },
          }])]: { success: true },
          [stableStringify(['git', 'status', null])]: {
            ok: true,
            status: gitStatus,
          },
          [stableStringify(['git', 'githubAuthStatus', null])]: {
            ok: true,
            available: true,
            authenticated: false,
            hosts: [],
          },
          [stableStringify(['git', 'fileDiff', { mode: 'unstaged', path: 'src/demo.ts' }])]: {
            ok: true,
            path: 'src/demo.ts',
            mode: 'unstaged',
            patch: 'diff --git a/src/demo.ts b/src/demo.ts\n-const value = 1;\n+const value = 2;\n',
          },
          [stableStringify(['git', 'stage', { paths: ['src/demo.ts'] }])]: {
            success: false,
            blocked: true,
            reason: 'Stage requires approval',
          },
          [stableStringify(['git', 'commit', { message: 'Update demo' }])]: {
            success: false,
            blocked: true,
            reason: 'Commit requires approval',
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.getByRole('button', { name: 'Workspace' }).first().click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible();
      await sidePanel.getByRole('button', { name: 'Git' }).click();

      const gitPanel = sidePanel.getByTestId('workspace-git-panel');
      await expect(gitPanel).toBeVisible();
      await expect(gitPanel.getByText('feature/git-panel', { exact: true })).toBeVisible();
      await expect(gitPanel.getByRole('button', { name: /src\/demo\.ts/ })).toBeVisible();
      await expect(gitPanel.getByText(/const value = 2/)).toBeVisible();
      await expect(gitPanel.getByText(/gh auth login/)).toBeVisible();

      await gitPanel.getByRole('button', { name: /^Stage$/ }).click();
      await expect(page.getByText('Stage requires approval')).toBeVisible();

      await gitPanel.getByPlaceholder('Commit message').fill('Update demo');
      await gitPanel.getByRole('button', { name: 'Commit staged changes' }).click();
      await expect(page.getByText('Commit requires approval')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
