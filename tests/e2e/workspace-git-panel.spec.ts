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
  { path: '/workspace/demo-feature-a', branch: 'feature/a', head: 'aaa111', locked: true, prunable: true },
];

const gitStashes = [
  { index: 0, selector: 'stash@{0}', branch: 'feature/git-panel', message: 'WIP demo changes' },
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

const pushApproval = {
  id: 'approval-push',
  workspaceId: WORKSPACE_ID,
  source: 'git',
  risk: 'dangerous',
  status: 'pending',
  mode: 'acceptEdits',
  requestedAt: 3,
  reason: 'Pushing changes requires approval.',
};

const prApproval = {
  id: 'approval-pr-create',
  workspaceId: WORKSPACE_ID,
  source: 'git',
  risk: 'dangerous',
  status: 'pending',
  mode: 'acceptEdits',
  requestedAt: 4,
  reason: 'Creating a pull request requires approval.',
};

const stashApplyApproval = {
  id: 'approval-stash-apply',
  workspaceId: WORKSPACE_ID,
  source: 'git',
  risk: 'dangerous',
  status: 'pending',
  mode: 'acceptEdits',
  requestedAt: 5,
  reason: 'Applying stash requires approval.',
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
          [stableStringify(['workspaces', 'create', {
            name: 'demo-feature-a',
            rootPath: '/workspace/demo-feature-a',
          }])]: {
            profiles: [
              workspace,
              {
                ...workspace,
                id: 'workspace-worktree-a',
                name: 'demo-feature-a',
                rootPath: '/workspace/demo-feature-a',
              },
            ],
            activeWorkspaceId: 'workspace-worktree-a',
            activeWorkspace: {
              ...workspace,
              id: 'workspace-worktree-a',
              name: 'demo-feature-a',
              rootPath: '/workspace/demo-feature-a',
            },
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
          [stableStringify(['git', 'capabilities', null])]: {
            ok: true,
            git: { available: true, version: 'git version 2.45.0' },
            gh: { available: true, version: 'gh version 2.56.0' },
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
          [stableStringify(['git', 'stashList', null])]: {
            success: true,
            stashes: gitStashes,
          },
          [stableStringify(['mcp', 'listTools', { serverId: 'clawx-git' }])]: {
            success: true,
            serverId: 'clawx-git',
            status: 'connected',
            tools: Array.from({ length: 27 }, (_, index) => ({
              name: `git_tool_${index + 1}`,
              description: 'Mock Git tool',
            })),
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
          [stableStringify(['git', 'checkoutBranch', { name: 'main' }])]: {
            success: true,
          },
          [stableStringify(['git', 'fetch', null])]: {
            success: true,
          },
          [stableStringify(['git', 'push', null])]: {
            success: false,
            blocked: true,
            approvalRequired: true,
            approval: pushApproval,
            reason: pushApproval.reason,
          },
          [stableStringify(['git', 'push', { approvalId: 'approval-push' }])]: {
            success: true,
          },
          [stableStringify(['git', 'worktreeAdd', { branch: 'feature/new-worktree', checkoutNewBranch: true }])]: {
            success: true,
          },
          [stableStringify(['git', 'stashPush', { includeUntracked: true, message: 'checkpoint' }])]: {
            success: true,
          },
          [stableStringify(['git', 'stashApply', { selector: 'stash@{0}' }])]: {
            success: false,
            blocked: true,
            approvalRequired: true,
            approval: stashApplyApproval,
            reason: stashApplyApproval.reason,
          },
          [stableStringify(['git', 'stashApply', { selector: 'stash@{0}', approvalId: 'approval-stash-apply' }])]: {
            success: true,
          },
          [stableStringify(['git', 'stashPop', { selector: 'stash@{0}' }])]: {
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
          [stableStringify(['permissions', 'decideApproval', { id: 'approval-push', decision: 'approved' }])]: {
            success: true,
          },
          [stableStringify(['permissions', 'decideApproval', { id: 'approval-stash-apply', decision: 'approved' }])]: {
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
      const workspaceToggle = page.getByTestId('chat-workspace-toggle');
      await expect(workspaceToggle).toBeVisible({ timeout: 30_000 });
      await expect(workspaceToggle).toBeEnabled({ timeout: 30_000 });
      await workspaceToggle.click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible({ timeout: 30_000 });
      await sidePanel.getByRole('button', { name: 'Git' }).click();

      const gitPanel = sidePanel.getByTestId('workspace-git-panel');
      await expect(gitPanel).toBeVisible();
      await expect(gitPanel.getByText('feature/git-panel', { exact: true }).first()).toBeVisible();
      await expect(gitPanel.getByText('Conflicts (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByText('Staged (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByText('Unstaged (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByText('Untracked (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByRole('button', { name: /src\/demo\.ts/ })).toBeVisible();
      await expect(gitPanel.getByText('git version 2.45.0')).toBeVisible();
      await expect(gitPanel.getByText('27 tools')).toBeVisible();
      await expect(gitPanel.getByTestId('workspace-git-readiness-score')).toHaveText(/3\/4 ready/);
      await expect(gitPanel.getByTestId('workspace-git-repo-metrics')).toContainText('Worktrees');
      await expect(gitPanel.getByTestId('workspace-git-repo-metrics')).toContainText('Stashes');
      await expect(gitPanel.getByTestId('workspace-git-repo-metrics')).toContainText('+4 -2');
      await expect(gitPanel.getByText('+2 -1').first()).toBeVisible();
      await expect(gitPanel.getByTestId('monaco-diff-viewer')).toBeVisible();
      await expect(gitPanel.locator('.monaco-editor-background').first()).toBeVisible();
      await page.setViewportSize({ width: 760, height: 720 });
      await expect(gitPanel.getByTestId('monaco-diff-viewer')).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(gitPanel.getByTestId('workspace-git-tool-tabs').getByRole('button', { name: 'Worktree' })).toBeVisible();
      await expect(gitPanel.getByTestId('workspace-git-tool-tabs').getByRole('button', { name: 'Stash' })).toBeVisible();
      await expect(gitPanel.getByText('demo-feature-a')).toBeVisible();
      await expect(gitPanel.getByText('Current')).toBeVisible();
      await expect(gitPanel.getByText('Locked')).toBeVisible();
      await expect(gitPanel.getByText('Prunable')).toBeVisible();
      await expect(gitPanel.getByText(/gh auth login/)).toBeVisible();
      await expect(gitPanel.getByText('Last operation')).toBeVisible();
      await expect(gitPanel.getByTestId('workspace-git-last-operation')).toContainText('No Git operation yet');

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
      await expect(page.getByText('Stage requires approval', { exact: true })).toBeVisible();

      await gitPanel.getByRole('button', { name: /src\/staged\.ts/ }).click();
      await gitPanel.getByRole('button', { name: /^Unstage$/ }).click();

      await gitPanel.getByRole('button', { name: /^Revert$/ }).click();
      await expect(page.getByText('Revert selected file?')).toBeVisible();
      await page.getByTestId('confirm-dialog-confirm-button').click();
      await expect(gitPanel.getByText('Revert needs approval')).toBeVisible();
      await expect(gitPanel.getByText('Reverting a file requires approval.', { exact: true })).toBeVisible();
      await gitPanel.getByRole('button', { name: 'Approve & retry' }).click();

      await gitPanel.getByTestId('workspace-git-tool-tabs').getByRole('button', { name: 'Commit' }).click();
      await gitPanel.getByPlaceholder('Commit message').fill('Update demo');
      await gitPanel.getByRole('button', { name: 'Commit staged changes' }).click();
      await expect(page.getByText('Commit requires approval', { exact: true })).toBeVisible();

      await gitPanel.getByTestId('workspace-git-tool-tabs').getByRole('button', { name: 'Branch' }).click();
      await gitPanel.getByRole('combobox', { name: 'Select branch' }).click();
      await page.getByRole('option', { name: 'main' }).click();
      await gitPanel.getByRole('button', { name: 'Checkout' }).click();
      await gitPanel.getByRole('button', { name: 'Fetch' }).click();
      await gitPanel.getByRole('button', { name: 'Push' }).click();
      await expect(gitPanel.getByText('Push needs approval')).toBeVisible();
      await expect(gitPanel.getByText('Pushing changes requires approval.', { exact: true })).toBeVisible();
      await expect(gitPanel.getByTestId('workspace-git-last-operation')).toContainText('Push');
      await gitPanel.getByRole('button', { name: 'Approve & retry' }).click();

      await gitPanel.getByTestId('workspace-git-tool-tabs').getByRole('button', { name: 'Worktree' }).click();
      await gitPanel.getByPlaceholder('Branch for worktree').fill('feature/new-worktree');
      await expect(gitPanel.getByTestId('workspace-git-worktree-target')).toContainText('/workspace/demo-feature-new-worktree');
      await gitPanel.getByRole('button', { name: 'Add worktree' }).click();

      await gitPanel.getByRole('button', { name: 'Remove' }).click();
      await expect(gitPanel.getByText('Remove needs approval')).toBeVisible();
      await expect(gitPanel.getByText('Removing a worktree requires approval.', { exact: true })).toBeVisible();
      await gitPanel.getByRole('button', { name: 'Approve & retry' }).click();

      await gitPanel.getByTestId('workspace-git-tool-tabs').getByRole('button', { name: 'Stash' }).click();
      await expect(gitPanel.getByTestId('workspace-git-stash-panel')).toContainText('WIP demo changes');
      await expect(gitPanel.getByTestId('workspace-git-stash-panel')).toContainText('stash@{0}');
      await gitPanel.getByPlaceholder('Optional stash message').fill('checkpoint');
      await gitPanel.getByRole('switch', { name: 'Include untracked' }).click();
      await gitPanel.getByRole('button', { name: 'Stash changes' }).click();
      await gitPanel.getByRole('button', { name: 'Apply stash@{0}' }).click();
      await expect(gitPanel.getByText('Apply needs approval')).toBeVisible();
      await expect(gitPanel.getByText('Applying stash requires approval.', { exact: true })).toBeVisible();
      await gitPanel.getByRole('button', { name: 'Approve & retry' }).click();
      await expect(gitPanel.getByTestId('workspace-git-last-operation')).toContainText('Apply');

      await gitPanel.getByTestId('workspace-git-tool-tabs').getByRole('button', { name: 'Worktree' }).click();
      await gitPanel.getByRole('button', { name: 'Switch' }).click();
      await expect(page.getByText('Workspace created for this worktree')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('creates a draft GitHub PR with explicit base and head through approval', async ({ launchElectronApp }) => {
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
          [stableStringify(['git', 'capabilities', null])]: {
            ok: true,
            git: { available: true, version: 'git version 2.45.0' },
            gh: { available: true, version: 'gh version 2.56.0' },
          },
          [stableStringify(['git', 'githubAuthStatus', null])]: {
            ok: true,
            available: true,
            authenticated: true,
            user: 'octocat',
            hosts: ['github.com'],
          },
          [stableStringify(['git', 'githubRepo', null])]: {
            ok: true,
            repository: {
              owner: 'octo',
              name: 'demo',
              url: 'https://github.com/octo/demo',
              defaultBranch: 'main',
            },
          },
          [stableStringify(['git', 'prList', { limit: 8, state: 'open' }])]: {
            success: true,
            pullRequests: [{
              number: 7,
              title: 'Existing PR',
              state: 'OPEN',
              headRefName: 'feature/old',
              baseRefName: 'main',
              isDraft: false,
            }],
          },
          [stableStringify(['git', 'branches', null])]: {
            success: true,
            branches: gitBranches,
          },
          [stableStringify(['git', 'worktrees', null])]: {
            success: true,
            worktrees: gitWorktrees,
          },
          [stableStringify(['git', 'stashList', null])]: {
            success: true,
            stashes: gitStashes,
          },
          [stableStringify(['mcp', 'listTools', { serverId: 'clawx-git' }])]: {
            success: true,
            serverId: 'clawx-git',
            status: 'connected',
            tools: Array.from({ length: 27 }, (_, index) => ({
              name: `git_tool_${index + 1}`,
              description: 'Mock Git tool',
            })),
          },
          [stableStringify(['git', 'fileDiff', { mode: 'unstaged', path: 'src/demo.ts' }])]: {
            ok: true,
            path: 'src/demo.ts',
            mode: 'unstaged',
            patch: 'diff --git a/src/demo.ts b/src/demo.ts\n-const value = 1;\n+const value = 2;\n',
            original: 'const value = 1;\n',
            modified: 'const value = 2;\n',
          },
          [stableStringify(['git', 'prCreate', {
            base: 'main',
            body: 'Ready for review',
            draft: true,
            head: 'feature/git-panel',
            title: 'Ship Git panel',
          }])]: {
            success: false,
            blocked: true,
            approvalRequired: true,
            approval: prApproval,
            reason: prApproval.reason,
          },
          [stableStringify(['permissions', 'decideApproval', { id: 'approval-pr-create', decision: 'approved' }])]: {
            success: true,
          },
          [stableStringify(['git', 'prCreate', {
            approvalId: 'approval-pr-create',
            base: 'main',
            body: 'Ready for review',
            draft: true,
            head: 'feature/git-panel',
            title: 'Ship Git panel',
          }])]: {
            success: true,
            pullRequest: {
              number: 8,
              title: 'Ship Git panel',
              state: 'OPEN',
              headRefName: 'feature/git-panel',
              baseRefName: 'main',
              isDraft: true,
            },
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
      const workspaceToggle = page.getByTestId('chat-workspace-toggle');
      await expect(workspaceToggle).toBeVisible({ timeout: 30_000 });
      await expect(workspaceToggle).toBeEnabled({ timeout: 30_000 });
      await workspaceToggle.click();

      const sidePanel = page.getByTestId('artifact-panel');
      await sidePanel.getByRole('button', { name: 'Git' }).click();
      const gitPanel = sidePanel.getByTestId('workspace-git-panel');
      await expect(gitPanel).toBeVisible();
      await gitPanel.getByTestId('workspace-git-tool-tabs').getByRole('button', { name: 'PR' }).click();

      await expect(gitPanel.getByText('octocat')).toBeVisible();
      await expect(gitPanel.getByText('feature/old -> main')).toBeVisible();
      await expect(gitPanel.getByLabel('Base branch')).toHaveValue('main');
      await expect(gitPanel.getByLabel('Head branch')).toHaveValue('feature/git-panel');

      await gitPanel.getByPlaceholder('PR title').fill('Ship Git panel');
      await gitPanel.getByPlaceholder('PR body').fill('Ready for review');
      await gitPanel.getByRole('switch', { name: 'Draft PR' }).click();
      await gitPanel.getByRole('button', { name: 'Create PR' }).click();

      await expect(gitPanel.getByText('Create PR needs approval')).toBeVisible();
      await expect(gitPanel.getByText('Creating a pull request requires approval.', { exact: true })).toBeVisible();
      await gitPanel.getByRole('button', { name: 'Approve & retry' }).click();
      await expect(gitPanel.getByTestId('workspace-git-last-operation')).toContainText('Create PR');
    } finally {
      await closeElectronApp(app);
    }
  });
});
