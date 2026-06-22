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
  hasConflicts: true,
  stagedCount: 1,
  unstagedCount: 1,
  untrackedCount: 1,
  conflictedCount: 1,
  changes: [
    {
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
    },
    {
      path: 'src/staged.ts',
      absolutePath: '/workspace/demo/src/staged.ts',
      status: 'M',
      staged: true,
      unstaged: false,
      untracked: false,
      conflicted: false,
      bucket: 'staged',
      additions: 1,
      deletions: 1,
      binary: false,
    },
    {
      path: 'src/new.ts',
      absolutePath: '/workspace/demo/src/new.ts',
      status: '??',
      staged: false,
      unstaged: false,
      untracked: true,
      conflicted: false,
      bucket: 'untracked',
      additions: 1,
      deletions: 0,
      binary: false,
    },
    {
      path: 'src/conflict.ts',
      absolutePath: '/workspace/demo/src/conflict.ts',
      status: 'UU',
      staged: false,
      unstaged: false,
      untracked: false,
      conflicted: true,
      bucket: 'conflicted',
      additions: null,
      deletions: null,
      binary: false,
    },
  ],
};

const gitBranches = [
  { name: 'feature/git-panel', current: true, upstream: 'origin/feature/git-panel', commit: 'abc123' },
  { name: 'main', current: false, upstream: 'origin/main', commit: 'def456' },
];

const gitWorktrees = [
  { path: '/workspace/demo', branch: 'feature/git-panel', head: 'abc123' },
  { path: '/workspace/demo-feature-a', branch: 'feature/a', head: 'aaa111' },
];

const removeApproval = {
  id: 'approval-remove-worktree',
  workspaceId: WORKSPACE_ID,
  source: 'git',
  risk: 'dangerous',
  status: 'pending',
  mode: 'acceptEdits',
  requestedAt: 1,
  reason: 'Removing a worktree requires approval.',
};

const revertApproval = {
  id: 'approval-revert-file',
  workspaceId: WORKSPACE_ID,
  source: 'git',
  risk: 'dangerous',
  status: 'pending',
  mode: 'acceptEdits',
  requestedAt: 2,
  reason: 'Reverting a file requires approval.',
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
          [stableStringify(['workspaces', 'saveState', null])]: { success: true },
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
          [stableStringify(['git', 'branches', null])]: {
            success: true,
            branches: gitBranches,
          },
          [stableStringify(['git', 'worktrees', null])]: {
            success: true,
            worktrees: gitWorktrees,
          },
          [stableStringify(['git', 'fileDiff', { mode: 'unstaged', path: 'src/demo.ts' }])]: {
            ok: true,
            path: 'src/demo.ts',
            mode: 'unstaged',
            patch: 'diff --git a/src/demo.ts b/src/demo.ts\n-const value = 1;\n+const value = 2;\n',
            original: 'const value = 1;\n',
            modified: 'const value = 2;\n',
          },
          [stableStringify(['git', 'fileDiff', { mode: 'staged', path: 'src/staged.ts' }])]: {
            ok: true,
            path: 'src/staged.ts',
            mode: 'staged',
            patch: 'diff --git a/src/staged.ts b/src/staged.ts\n-const staged = false;\n+const staged = true;\n',
            original: 'const staged = false;\n',
            modified: 'const staged = true;\n',
          },
          [stableStringify(['git', 'fileDiff', { mode: 'unstaged', path: 'src/new.ts' }])]: {
            ok: true,
            path: 'src/new.ts',
            mode: 'unstaged',
            patch: 'diff --git a/src/new.ts b/src/new.ts\n+export const fresh = true;\n',
            original: '',
            modified: 'export const fresh = true;\n',
          },
          [stableStringify(['git', 'fileDiff', { mode: 'unstaged', path: 'src/conflict.ts' }])]: {
            ok: true,
            path: 'src/conflict.ts',
            mode: 'unstaged',
            patch: 'diff --git a/src/conflict.ts b/src/conflict.ts\n<<<<<<< HEAD\n=======\n>>>>>>> feature\n',
          },
          [stableStringify(['git', 'stage', { paths: ['src/demo.ts'] }])]: {
            success: false,
            blocked: true,
            reason: 'Stage requires approval',
          },
          [stableStringify(['git', 'unstage', { paths: ['src/staged.ts'] }])]: {
            success: true,
          },
          [stableStringify(['git', 'revertFile', { path: 'src/staged.ts' }])]: {
            success: false,
            blocked: true,
            approvalRequired: true,
            approval: revertApproval,
            reason: revertApproval.reason,
          },
          [stableStringify(['git', 'revertFile', { path: 'src/staged.ts', approvalId: 'approval-revert-file' }])]: {
            success: true,
          },
          [stableStringify(['git', 'commit', { message: 'Update demo' }])]: {
            success: false,
            blocked: true,
            reason: 'Commit requires approval',
          },
          [stableStringify(['git', 'worktreeAdd', { branch: 'feature/new-worktree', checkoutNewBranch: true }])]: {
            success: true,
          },
          [stableStringify(['git', 'worktreeRemove', { path: '/workspace/demo-feature-a' }])]: {
            success: false,
            blocked: true,
            approvalRequired: true,
            approval: removeApproval,
            reason: removeApproval.reason,
          },
          [stableStringify(['permissions', 'decideApproval', { id: 'approval-remove-worktree', decision: 'approved' }])]: {
            success: true,
          },
          [stableStringify(['permissions', 'decideApproval', { id: 'approval-revert-file', decision: 'approved' }])]: {
            success: true,
          },
          [stableStringify(['git', 'worktreeRemove', { path: '/workspace/demo-feature-a', approvalId: 'approval-remove-worktree' }])]: {
            success: true,
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
      await expect(gitPanel.getByText('feature/git-panel', { exact: true }).first()).toBeVisible();
      await expect(gitPanel.getByText('Conflicts (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByText('Staged (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByText('Unstaged (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByText('Untracked (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByRole('button', { name: /src\/demo\.ts/ })).toBeVisible();
      await expect(gitPanel.getByTestId('monaco-diff-viewer')).toBeVisible();
      await expect(gitPanel.locator('.monaco-editor-background').first()).toBeVisible();
      await page.setViewportSize({ width: 760, height: 720 });
      await expect(gitPanel.getByTestId('monaco-diff-viewer')).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(gitPanel.getByText('Worktrees')).toBeVisible();
      await expect(gitPanel.getByText('demo-feature-a')).toBeVisible();
      await expect(gitPanel.getByText('Current')).toBeVisible();
      await expect(gitPanel.getByText(/gh auth login/)).toBeVisible();
      await expect(gitPanel.getByText('Last validation')).toBeVisible();

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (value: string) => {
              (window as typeof window & { __copiedPatch?: string }).__copiedPatch = value;
            },
          },
        });
      });
      await gitPanel.getByRole('button', { name: 'Copy patch' }).click();
      await expect.poll(async () => page.evaluate(() => (window as typeof window & { __copiedPatch?: string }).__copiedPatch ?? '')).toContain('src/demo.ts');

      await gitPanel.getByRole('button', { name: /^Stage$/ }).click();
      await expect(page.getByText('Stage requires approval')).toBeVisible();

      await gitPanel.getByRole('button', { name: /src\/staged\.ts/ }).click();
      await gitPanel.getByRole('button', { name: /^Unstage$/ }).click();

      await gitPanel.getByRole('button', { name: /^Revert$/ }).click();
      await expect(page.getByText('Revert selected file?')).toBeVisible();
      await page.getByTestId('confirm-dialog-confirm-button').click();
      await expect(gitPanel.getByText('Revert needs approval')).toBeVisible();
      await expect(gitPanel.getByText('Reverting a file requires approval.')).toBeVisible();
      await gitPanel.getByRole('button', { name: 'Approve & retry' }).click();

      await gitPanel.getByPlaceholder('Commit message').fill('Update demo');
      await gitPanel.getByRole('button', { name: 'Commit staged changes' }).click();
      await expect(page.getByText('Commit requires approval')).toBeVisible();

      await gitPanel.getByPlaceholder('Branch for worktree').fill('feature/new-worktree');
      await gitPanel.getByRole('button', { name: 'Add worktree' }).click();

      await gitPanel.getByRole('button', { name: 'Remove' }).click();
      await expect(gitPanel.getByText('Remove needs approval')).toBeVisible();
      await expect(gitPanel.getByText('Removing a worktree requires approval.')).toBeVisible();
      await gitPanel.getByRole('button', { name: 'Approve & retry' }).click();
    } finally {
      await closeElectronApp(app);
    }
  });
});
