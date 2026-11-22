import type { ElectronApplication } from '@playwright/test';
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
  { path: '/workspace/protected-checkout', branch: 'feature/protected', head: 'bbb222', locked: true, prunable: true },
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

const driveRootWorkspace = {
  ...workspace,
  rootPath: 'C:/repo',
};

const driveRootGitStatus = {
  ...gitStatus,
  workspaceRoot: 'C:/repo',
  repoRoot: 'C:/repo',
  changes: [gitStatus.changes[0]],
  stagedCount: 0,
  unstagedCount: 1,
  untrackedCount: 0,
  conflictedCount: 0,
  hasConflicts: false,
};

const driveRootWorktreeApproval = {
  id: 'approval-drive-root-worktree',
  workspaceId: WORKSPACE_ID,
  source: 'git',
  risk: 'dangerous',
  status: 'pending',
  mode: 'acceptEdits',
  requestedAt: 6,
  reason: 'Drive-root worktree target requires approval.',
};

const auditApproval = {
  id: 'approval-audit',
  workspaceId: WORKSPACE_ID,
  source: 'git',
  risk: 'external-write',
  status: 'pending',
  mode: 'acceptEdits',
  requestedAt: 7,
  command: 'git commit -m private-secret',
  cwd: 'C:/private/repository',
  paths: ['C:/private/repository/output.txt'],
  paramsPreview: '{"token":"SECRET_VALUE"}',
  reason: 'Publish private-secret with SECRET_VALUE.',
};

async function installAuditReflogModeSwitch(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const handlers = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers;
    const original = handlers?.get('host:invoke');
    if (!original) throw new Error('host:invoke handler is not registered');

    const state = globalThis as typeof globalThis & { __workspaceGitAuditReflogMode?: 'fail' | 'success' };
    state.__workspaceGitAuditReflogMode = 'fail';
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: {
      id?: string;
      module?: string;
      action?: string;
    }) => {
      if (
        request.module === 'git'
        && request.action === 'reflog'
        && state.__workspaceGitAuditReflogMode === 'fail'
      ) {
        return {
          id: request.id,
          ok: false,
          error: { code: 'INTERNAL', message: 'E2E injected reflog failure' },
        };
      }
      return original(event, request);
    });
  });
}

async function setAuditReflogMode(
  app: ElectronApplication,
  mode: 'fail' | 'success',
): Promise<void> {
  await app.evaluate((_electron, nextMode: 'fail' | 'success') => {
    (globalThis as typeof globalThis & { __workspaceGitAuditReflogMode?: 'fail' | 'success' })
      .__workspaceGitAuditReflogMode = nextMode;
  }, mode);
}

test.describe('Workspace Git panel', () => {
  test('renders status, diff, auth guidance, and approval-blocked write actions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true, visualMode: true });

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
          [stableStringify(['git', 'reflog', { limit: 300 }])]: {
            success: true,
            entries: [{
              hash: 'abc123def456',
              shortHash: 'abc123d',
              selector: 'HEAD@{0}',
              subject: 'checkout: moving from main to feature/git-panel',
              date: 1710000000000,
            }],
          },
          [stableStringify(['permissions', 'approvals', {
            includeExpired: true,
            limit: 200,
            workspaceId: WORKSPACE_ID,
          }])]: {
            success: true,
            approvals: [pushApproval],
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

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            caret-color: transparent !important;
          }
          [data-sonner-toaster] {
            display: none !important;
          }
        `,
      });

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const workspaceToggle = page.getByTestId('chat-workspace-toggle');
      await expect(workspaceToggle).toBeVisible({ timeout: 30_000 });
      await expect(workspaceToggle).toBeEnabled({ timeout: 30_000 });
      await workspaceToggle.click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel).toBeVisible({ timeout: 30_000 });
      await expect(sidePanel.getByTestId('artifact-panel-tab-files')).toBeVisible();
      await sidePanel.getByTestId('artifact-panel-new-tab').click();
      await page.getByTestId('artifact-panel-new-tab-review').click();

      const gitPanel = sidePanel.getByTestId('workspace-git-panel');
      await expect(gitPanel).toBeVisible();
      await expect(gitPanel.getByText('feature/git-panel', { exact: true }).first()).toBeVisible();
      await expect(gitPanel.getByText('Conflicts (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByText('Staged (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByText('Unstaged (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByText('Untracked (1)', { exact: true })).toBeVisible();
      await expect(gitPanel.getByRole('button', { name: /src\/demo\.ts/ })).toBeVisible();
      await expect(gitPanel.getByText('+2 -1').first()).toBeVisible();
      await expect(gitPanel.getByTestId('monaco-diff-viewer')).toBeVisible();
      await expect(gitPanel.locator('.monaco-editor-background').first()).toBeVisible();
      await page.setViewportSize({ width: 760, height: 720 });
      await expect(gitPanel.getByTestId('monaco-diff-viewer')).toBeVisible();
      await page.setViewportSize({ width: 1280, height: 800 });

      const toolDrawer = gitPanel.getByTestId('workspace-git-tool-drawer');
      await toolDrawer.locator(':scope > summary').click();
      const toolTabs = gitPanel.getByTestId('workspace-git-tool-tabs');
      await expect(toolTabs.getByRole('button', { name: 'Worktree' })).toBeVisible();
      await expect(toolTabs.getByRole('button', { name: 'Stash' })).toBeVisible();
      await expect(toolTabs.getByRole('button', { name: 'Commit' })).toBeVisible();
      await expect(gitPanel.getByText('/workspace/demo-feature-a', { exact: true })).toBeVisible();
      await expect(gitPanel.getByText('Current')).toBeVisible();
      await expect(gitPanel.getByText('Locked')).toBeVisible();
      await expect(gitPanel.getByText('Prunable')).toBeVisible();

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

      await toolTabs.getByRole('button', { name: 'Commit' }).click();
      const commitCard = gitPanel.getByTestId('ai-commit-card');
      await expect(commitCard).toBeVisible();
      await expect(commitCard.getByTestId('ai-commit-summary')).toContainText('staged');
      await expect(commitCard.getByTestId('ai-commit-summary')).toContainText('unstaged');
      await expect(commitCard.getByTestId('ai-commit-operation')).toContainText('Done');
      await expect(commitCard).toHaveScreenshot('workspace-git-commit-card.png', {
        animations: 'disabled',
        caret: 'hide',
        // This card is text heavy and its render is not bit-stable: the
        // 2026-09-25 RC-09 run differed by 198 of 127,022 pixels (ratio 0.01) at
        // an identical 422x301 size, with the drift spread across text columns
        // and both borders, and the same test then passed three times in a row.
        // That is anti-aliasing jitter, not a content or layout change -- the DOM
        // assertions above still pin staged/unstaged/Done. Absorbing up to 1%
        // keeps a real layout shift (which moves whole regions) failing.
        maxDiffPixelRatio: 0.01,
      });
      await gitPanel.getByPlaceholder('Commit message').fill('Update demo');
      await gitPanel.getByRole('button', { name: 'Commit staged changes' }).click();
      await expect(commitCard.getByTestId('ai-commit-operation')).toContainText('Commit requires approval');
      await expect(commitCard.getByTestId('ai-commit-operation')).toContainText('Blocked');

      await toolTabs.getByRole('button', { name: 'Branch' }).click();
      await gitPanel.getByRole('combobox', { name: 'Select branch' }).click();
      await page.getByRole('option', { name: 'main' }).click();
      await gitPanel.getByRole('button', { name: 'Checkout' }).click();
      await gitPanel.getByRole('button', { name: 'Fetch' }).click();
      await gitPanel.getByRole('button', { name: 'Push' }).click();
      await expect(gitPanel.getByText('Push needs approval')).toBeVisible();
      await expect(gitPanel.getByText('Pushing changes requires approval.', { exact: true })).toBeVisible();
      await gitPanel.getByRole('button', { name: 'Approve & retry' }).click();

      await toolTabs.getByRole('button', { name: 'Worktree' }).click();
      await gitPanel.getByTestId('workspace-git-create-worktree').locator('summary').click();
      await gitPanel.getByPlaceholder('Branch for worktree').fill('feature/new-worktree');
      await expect(gitPanel.getByTestId('workspace-git-worktree-target')).toContainText('/workspace/demo-feature-new-worktree');
      await gitPanel.getByRole('button', { name: 'Add worktree' }).click();

      await gitPanel.getByTestId('workspace-git-worktree-row').filter({ hasText: '/workspace/demo-feature-a' }).getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(gitPanel.getByText('Remove needs approval')).toBeVisible();
      await expect(gitPanel.getByText('Removing a worktree requires approval.', { exact: true })).toBeVisible();
      await gitPanel.getByRole('button', { name: 'Approve & retry' }).click();

      await toolTabs.getByRole('button', { name: 'Stash' }).click();
      await expect(gitPanel.getByTestId('workspace-git-stash-panel')).toContainText('WIP demo changes');
      await expect(gitPanel.getByTestId('workspace-git-stash-panel')).toContainText('stash@{0}');
      await gitPanel.getByPlaceholder('Optional stash message').fill('checkpoint');
      await gitPanel.getByRole('switch', { name: 'Include untracked' }).click();
      await gitPanel.getByRole('button', { name: 'Stash changes' }).click();
      await gitPanel.getByRole('button', { name: 'Apply stash@{0}' }).click();
      await expect(gitPanel.getByText('Apply needs approval')).toBeVisible();
      await expect(gitPanel.getByText('Applying stash requires approval.', { exact: true })).toBeVisible();
      await gitPanel.getByRole('button', { name: 'Approve & retry' }).click();

      await toolTabs.getByRole('button', { name: 'Worktree' }).click();
      await gitPanel.getByTestId('workspace-git-worktree-row').filter({ hasText: '/workspace/demo-feature-a' }).getByRole('button', { name: 'Switch', exact: true }).click();
      await expect.poll(async () => app.evaluate(() => {
        const calls = (globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string; payload?: unknown }> }).__verseClawE2eHostCalls ?? [];
        return calls.some((call) => call.module === 'workspaces' && call.action === 'create');
      })).toBe(true);

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

      await page.addStyleTag({
        content: '[data-sonner-toaster], [data-sonner-toast] { display: none !important; }',
      });

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const workspaceToggle = page.getByTestId('chat-workspace-toggle');
      await expect(workspaceToggle).toBeVisible({ timeout: 30_000 });
      await expect(workspaceToggle).toBeEnabled({ timeout: 30_000 });
      await workspaceToggle.click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel.getByTestId('artifact-panel-tab-files')).toBeVisible();
      await sidePanel.getByTestId('artifact-panel-new-tab').click();
      await page.getByTestId('artifact-panel-new-tab-review').click();
      const gitPanel = sidePanel.getByTestId('workspace-git-panel');
      await expect(gitPanel).toBeVisible();
      const toolDrawer = gitPanel.getByTestId('workspace-git-tool-drawer');
      await toolDrawer.locator(':scope > summary').click();
      const toolTabs = gitPanel.getByTestId('workspace-git-tool-tabs');
      await expect(toolTabs).toBeVisible();
      await toolTabs.getByRole('button', { name: 'PR' }).click();

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
      await expect(gitPanel.getByText('Create PR needs approval')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('anchors audit partial failure, truncation, and drive-root worktree approval', async ({ launchElectronApp }) => {
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
              workspace: 'C:/repo',
              mainSessionKey: SESSION_KEY,
              channelTypes: [],
            }],
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [driveRootWorkspace],
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: driveRootWorkspace,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: WORKSPACE_ID,
            activeWorkspace: driveRootWorkspace,
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
            status: driveRootGitStatus,
          },
          [stableStringify(['git', 'branches', null])]: {
            success: true,
            branches: gitBranches,
          },
          [stableStringify(['git', 'worktrees', null])]: {
            success: true,
            worktrees: [
              { path: 'C:/repo', branch: 'feature/git-panel', head: 'abc123' },
            ],
          },
          [stableStringify(['git', 'stashList', null])]: {
            success: true,
            stashes: [],
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
          [stableStringify(['git', 'log', { ref: 'feature/git-panel', limit: 20 }])]: {
            success: true,
            ref: 'feature/git-panel',
            commits: [],
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
          [stableStringify(['git', 'reflog', { limit: 300 }])]: {
            success: true,
            entries: [{
              hash: 'abc123def456',
              shortHash: 'abc123d',
              selector: 'HEAD@{0}',
              subject: 'checkout: moving from main to feature/git-panel',
              date: 1710000000000,
            }],
            truncated: true,
          },
          [stableStringify(['permissions', 'approvals', {
            includeExpired: true,
            limit: 200,
            workspaceId: WORKSPACE_ID,
          }])]: {
            success: true,
            approvals: [auditApproval],
          },
          [stableStringify(['git', 'worktreeAdd', { branch: 'feature/root', checkoutNewBranch: true }])]: {
            success: false,
            blocked: true,
            approvalRequired: true,
            approval: driveRootWorktreeApproval,
            reason: driveRootWorktreeApproval.reason,
          },
          [stableStringify(['permissions', 'decideApproval', {
            id: 'approval-drive-root-worktree',
            decision: 'approved',
          }])]: {
            success: true,
          },
          [stableStringify(['git', 'worktreeAdd', {
            branch: 'feature/root',
            checkoutNewBranch: true,
            approvalId: 'approval-drive-root-worktree',
          }])]: {
            success: true,
          },
        },
      });
      await installAuditReflogModeSwitch(app);

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await page.addStyleTag({
        content: '[data-sonner-toaster], [data-sonner-toast] { display: none !important; }',
      });

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const workspaceToggle = page.getByTestId('chat-workspace-toggle');
      await expect(workspaceToggle).toBeVisible({ timeout: 30_000 });
      await expect(workspaceToggle).toBeEnabled({ timeout: 30_000 });
      await workspaceToggle.click();

      const sidePanel = page.getByTestId('artifact-panel');
      await expect(sidePanel.getByTestId('artifact-panel-tab-files')).toBeVisible();
      await sidePanel.getByTestId('artifact-panel-new-tab').click();
      await page.getByTestId('artifact-panel-new-tab-review').click();
      const gitPanel = sidePanel.getByTestId('workspace-git-panel');
      await expect(gitPanel).toBeVisible();
      const toolDrawer = gitPanel.getByTestId('workspace-git-tool-drawer');
      await toolDrawer.locator(':scope > summary').click();
      const toolTabs = gitPanel.getByTestId('workspace-git-tool-tabs');
      await toolTabs.getByRole('button', { name: 'Worktree' }).click();

      await gitPanel.getByTestId('workspace-git-create-worktree').locator('summary').click();
      await gitPanel.getByPlaceholder('Branch for worktree').fill('feature/root');
      await expect(gitPanel.getByTestId('workspace-git-worktree-target')).toContainText('C:/repo-feature-root');
      await gitPanel.getByRole('button', { name: 'Add worktree' }).click();
      await expect(gitPanel.getByText('Add worktree needs approval')).toBeVisible();
      await expect(gitPanel.getByText('Drive-root worktree target requires approval.', { exact: true })).toBeVisible();
      await gitPanel.getByRole('button', { name: 'Approve & retry' }).click();
      await expect(gitPanel.getByText('Add worktree needs approval')).toHaveCount(0);

      await sidePanel.getByTestId('artifact-panel-new-tab').click();
      await page.getByTestId('artifact-panel-new-tab-audit').click();
      const auditPanel = sidePanel.getByTestId('workspace-audit-panel');
      await expect(auditPanel).toBeVisible();
      await expect(auditPanel.getByText('Git history is unavailable')).toBeVisible();
      await expect(auditPanel.getByText('Some audit sources are unavailable')).toBeVisible();

      await setAuditReflogMode(app, 'success');
      await auditPanel.getByRole('button', { name: /refresh/i }).click();
      await expect(auditPanel.getByText('Older entries hidden (limit reached)')).toBeVisible();
      await expect(auditPanel.getByText('Some audit sources are unavailable')).toHaveCount(0);
      await expect(auditPanel.getByTestId('workspace-audit-git-row')).toContainText(
        'checkout: moving from main to feature/git-panel',
      );
      const auditApprovalRow = auditPanel.getByTestId('workspace-audit-approval-row');
      await expect(auditApprovalRow).toContainText('External process write (details withheld)');
      await auditApprovalRow.locator('summary').click();
      await expect(auditApprovalRow).toContainText('Outside the ClawX write journal; no automatic rollback.');
      await expect(auditApprovalRow).not.toContainText('git commit -m private-secret');
      await expect(auditApprovalRow).not.toContainText('SECRET_VALUE');
      await expect(auditApprovalRow).not.toContainText('C:/private/repository');
    } finally {
      await closeElectronApp(app);
    }
  });
});
