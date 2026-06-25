import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceGitPanel } from '@/components/file-preview/WorkspaceGitPanel';

const hostApiMock = vi.hoisted(() => ({
  git: {
    status: vi.fn(),
    branches: vi.fn(),
    worktrees: vi.fn(),
    stashList: vi.fn(),
    githubAuthStatus: vi.fn(),
    githubRepo: vi.fn(),
    capabilities: vi.fn(),
    prList: vi.fn(),
    fileDiff: vi.fn(),
    stage: vi.fn(),
    unstage: vi.fn(),
    revertFile: vi.fn(),
    commit: vi.fn(),
    checkoutBranch: vi.fn(),
    createBranch: vi.fn(),
    fetch: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
    stashPush: vi.fn(),
    stashApply: vi.fn(),
    stashPop: vi.fn(),
    worktreeAdd: vi.fn(),
    worktreeRemove: vi.fn(),
    worktreePrune: vi.fn(),
    prCreate: vi.fn(),
  },
  mcp: {
    listTools: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
  workspaces: {
    list: vi.fn(),
    create: vi.fn(),
    switch: vi.fn(),
  },
  permissions: {
    decideApproval: vi.fn(),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: hostApiMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'workspace.git.loading': 'Loading Git status',
        'workspace.git.state.clean': 'Clean',
        'workspace.git.state.dirty': 'Dirty',
        'workspace.git.state.conflict': 'Conflicts',
        'workspace.git.actions.refresh': 'Refresh',
        'workspace.git.actions.checkoutBranch': 'Checkout',
        'workspace.git.actions.fetch': 'Fetch',
        'workspace.git.actions.pull': 'Pull',
        'workspace.git.actions.push': 'Push',
        'workspace.git.actions.openWorktree': 'Open',
        'workspace.git.actions.switchWorktree': 'Switch',
        'workspace.git.actions.stashPush': 'Stash changes',
        'workspace.git.actions.stashApply': 'Apply',
        'workspace.git.actions.stashPop': 'Pop',
        'workspace.git.actions.approveRetry': 'Approve & retry',
        'workspace.git.approval.title': `${String(options?.action)} needs approval`,
        'workspace.git.readiness.repository': 'Repository',
        'workspace.git.readiness.activeRepository': 'Active repo',
        'workspace.git.readiness.gitCli': 'Git CLI',
        'workspace.git.readiness.agentTools': 'Agent tools',
        'workspace.git.readiness.github': 'GitHub',
        'workspace.git.readiness.summaryLabel': 'Git readiness',
        'workspace.git.readiness.summaryHelp': 'Active repository, local Git, Agent tools, and GitHub auth',
        'workspace.git.readiness.ready': 'Ready',
        'workspace.git.readiness.missing': 'Missing',
        'workspace.git.readiness.unavailable': 'Unavailable',
        'workspace.git.readiness.githubLogin': 'gh auth login',
        'workspace.git.operation.title': 'Last operation',
        'workspace.git.operation.empty': 'No Git operation yet',
        'workspace.git.operation.ready': 'Ready',
        'workspace.git.operation.success': 'Done',
        'workspace.git.operation.blocked': 'Blocked',
        'workspace.git.operation.failed': 'Failed',
        'workspace.git.operation.completed': 'Completed',
        'workspace.git.toast.blocked': 'Approval required',
        'workspace.git.toast.failed': 'Git operation failed',
        'workspace.git.toast.approvalFailed': 'Approval failed',
        'workspace.git.toast.worktreeWorkspaceCreated': 'Workspace created for this worktree',
        'workspace.git.toast.worktreeWorkspaceSwitched': 'Switched to worktree workspace',
        'workspace.git.toast.worktreeWorkspaceSwitchFailed': `Failed to switch worktree workspace: ${String(options?.error)}`,
        'workspace.git.metrics.changes': 'Changes',
        'workspace.git.metrics.delta': 'Delta',
        'workspace.git.metrics.staged': 'Staged',
        'workspace.git.metrics.conflicts': 'Conflicts',
        'workspace.git.metrics.sync': 'Sync',
        'workspace.git.metrics.worktrees': 'Worktrees',
        'workspace.git.metrics.stashes': 'Stashes',
        'workspace.git.metrics.unknown': 'Unknown',
        'workspace.git.clean': 'Working tree clean',
        'workspace.git.diff.empty': 'No diff for the selected file.',
        'workspace.git.diff.unstaged': 'Unstaged',
        'workspace.git.diff.staged': 'Staged',
        'workspace.git.validation.title': 'Last validation',
        'workspace.git.validation.empty': 'No validation run yet',
        'workspace.git.validation.status': 'Ready',
        'workspace.git.toolTabs.worktrees': 'Worktree',
        'workspace.git.toolTabs.commit': 'Commit',
        'workspace.git.toolTabs.branch': 'Branch',
        'workspace.git.toolTabs.stash': 'Stash',
        'workspace.git.toolTabs.github': 'PR',
        'workspace.git.toolTabs.compactHint': 'Compact tools',
        'workspace.git.branch.title': 'Branch',
        'workspace.git.branch.checkoutTitle': 'Checkout branch',
        'workspace.git.branch.checkoutSelect': 'Select branch',
        'workspace.git.branch.current': 'current',
        'workspace.git.branch.createTitle': 'Create branch',
        'workspace.git.worktrees.title': 'Worktrees',
        'workspace.git.worktrees.empty': 'No worktrees found',
        'workspace.git.worktrees.current': 'Current',
        'workspace.git.worktrees.newBranch': 'New branch',
        'workspace.git.worktrees.existingBranch': 'Existing',
        'workspace.git.worktrees.startPointPlaceholder': 'Start point, default HEAD',
        'workspace.git.worktrees.locked': 'Locked',
        'workspace.git.worktrees.prunable': 'Prunable',
        'workspace.git.worktrees.defaultPath': 'Default path',
        'workspace.git.worktrees.defaultPathUnavailable': 'Enter a branch to preview the sibling worktree path',
        'workspace.git.worktrees.branchExists': 'Branch exists',
        'workspace.git.worktrees.branchCheckedOut': `Branch checked out at ${String(options?.path)}`,
        'workspace.git.branchWorktree.worktreePlaceholder': 'Branch for worktree',
        'workspace.git.actions.addWorktree': 'Add worktree',
        'workspace.git.actions.pruneWorktrees': 'Prune',
        'workspace.git.actions.createPr': 'Create PR',
        'workspace.git.stash.title': 'Stashes',
        'workspace.git.stash.empty': 'No stashes saved',
        'workspace.git.stash.messagePlaceholder': 'Optional stash message',
        'workspace.git.stash.includeUntrackedLabel': 'Include untracked',
        'workspace.git.stash.includeUntrackedHelp': 'Also save new files that are not tracked yet.',
        'workspace.git.github.title': 'GitHub PRs',
        'workspace.git.github.noPrs': 'No open pull requests',
        'workspace.git.github.titlePlaceholder': 'PR title',
        'workspace.git.github.bodyPlaceholder': 'PR body',
        'workspace.git.github.baseLabel': 'Base branch',
        'workspace.git.github.basePlaceholder': 'Base',
        'workspace.git.github.headLabel': 'Head branch',
        'workspace.git.github.headPlaceholder': 'Head',
        'workspace.git.github.draftLabel': 'Draft PR',
        'workspace.git.github.draftHelp': 'Create the pull request as a draft.',
        'artifactPanel.tabs.changes': 'Changes',
      };
      if (key === 'workspace.git.summary') {
        return `${String(options?.count)} changes`;
      }
      if (key === 'workspace.git.readiness.agentToolsReady') {
        return `${String(options?.count)} tools`;
      }
      if (key === 'workspace.git.readiness.summaryValue') {
        return `${String(options?.ready)}/${String(options?.total)} ready`;
      }
      if (key === 'workspace.git.operation.detail') {
        return `${String(options?.action)}: ${String(options?.detail)}`;
      }
      if (key === 'workspace.git.stash.count') {
        return `${String(options?.count)} saved`;
      }
      if (key === 'workspace.git.stash.applyLabel') {
        return `Apply ${String(options?.selector)}`;
      }
      if (key === 'workspace.git.stash.popLabel') {
        return `Pop ${String(options?.selector)}`;
      }
      if (key === 'workspace.git.github.prRefs') {
        return `${String(options?.head)} -> ${String(options?.base)}`;
      }
      if (key === 'workspace.git.metrics.aheadBehind') {
        return `ahead ${String(options?.ahead)} / behind ${String(options?.behind)}`;
      }
      if (key.startsWith('workspace.git.groups.')) {
        return `${key.split('.').pop()} (${String(options?.count)})`;
      }
      return translations[key] ?? key;
    },
  }),
}));

describe('WorkspaceGitPanel', () => {
  it('quantifies Git CLI, Agent MCP tools, worktrees, and GitHub readiness through host APIs', async () => {
    hostApiMock.git.status.mockResolvedValue({
      status: {
        isRepository: true,
        workspaceRoot: '/workspace/demo',
        repoRoot: '/workspace/demo',
        branch: 'feature/git-panel',
        upstream: 'origin/feature/git-panel',
        ahead: 1,
        behind: 0,
        clean: false,
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
        }],
      },
    });
    hostApiMock.git.branches.mockResolvedValue({
      branches: [
        { name: 'feature/git-panel', current: true },
        { name: 'main', current: false },
      ],
    });
    hostApiMock.git.worktrees.mockResolvedValue({
      worktrees: [
        { path: '/workspace/demo', branch: 'feature/git-panel', head: 'abc123' },
        { path: '/workspace/demo-feature-a', branch: 'feature/a', head: 'def456', locked: true, prunable: true },
      ],
    });
    hostApiMock.git.stashList.mockResolvedValue({
      stashes: [
        { index: 0, selector: 'stash@{0}', branch: 'feature/git-panel', message: 'WIP demo changes' },
      ],
    });
    hostApiMock.git.githubAuthStatus.mockResolvedValue({
      available: true,
      authenticated: true,
      user: 'octocat',
      hosts: ['github.com'],
    });
    hostApiMock.git.githubRepo.mockResolvedValue({
      repository: {
        owner: 'octo',
        name: 'demo',
        defaultBranch: 'main',
      },
    });
    hostApiMock.git.capabilities.mockResolvedValue({
      git: { available: true, version: 'git version 2.45.0' },
      gh: { available: true, version: 'gh version 2.56.0' },
    });
    hostApiMock.git.prList.mockResolvedValue({ pullRequests: [] });
    hostApiMock.git.fileDiff.mockResolvedValue({
      path: 'src/demo.ts',
      mode: 'unstaged',
      patch: 'diff --git a/src/demo.ts b/src/demo.ts\n',
    });
    hostApiMock.git.fetch.mockResolvedValue({ success: true });
    hostApiMock.git.pull.mockResolvedValue({ success: true });
    hostApiMock.git.push.mockResolvedValue({ success: true });
    hostApiMock.git.stashPush.mockResolvedValue({ success: true });
    hostApiMock.git.stashApply
      .mockResolvedValueOnce({
        success: false,
        blocked: true,
        approvalRequired: true,
        approval: {
          id: 'approval-stash-apply',
          workspaceId: 'workspace-demo',
          source: 'git',
          risk: 'dangerous',
          status: 'pending',
          mode: 'acceptEdits',
          requestedAt: 1,
          reason: 'Applying stash requires approval.',
        },
        reason: 'Applying stash requires approval.',
      })
      .mockResolvedValueOnce({ success: true });
    hostApiMock.git.stashPop.mockResolvedValue({ success: true });
    hostApiMock.git.prCreate.mockResolvedValue({ success: true });
    hostApiMock.permissions.decideApproval.mockResolvedValue({ success: true });
    hostApiMock.mcp.listTools.mockResolvedValue({
      success: true,
      serverId: 'clawx-git',
      status: 'connected',
      tools: Array.from({ length: 27 }, (_, index) => ({ name: `git_tool_${index + 1}` })),
    });
    hostApiMock.workspaces.list.mockResolvedValue({
      profiles: [{ id: 'workspace-demo', name: 'demo', rootPath: '/workspace/demo' }],
      activeWorkspaceId: 'workspace-demo',
      activeWorkspace: { id: 'workspace-demo', name: 'demo', rootPath: '/workspace/demo' },
    });
    hostApiMock.workspaces.create.mockResolvedValue({
      profiles: [
        { id: 'workspace-demo', name: 'demo', rootPath: '/workspace/demo' },
        { id: 'demo-feature-a', name: 'demo-feature-a', rootPath: '/workspace/demo-feature-a' },
      ],
      activeWorkspaceId: 'demo-feature-a',
      activeWorkspace: { id: 'demo-feature-a', name: 'demo-feature-a', rootPath: '/workspace/demo-feature-a' },
    });
    hostApiMock.workspaces.switch.mockResolvedValue({
      activeWorkspaceId: 'demo-feature-a',
      activeWorkspace: { id: 'demo-feature-a', name: 'demo-feature-a', rootPath: '/workspace/demo-feature-a' },
    });

    render(<WorkspaceGitPanel />);

    await waitFor(() => {
      expect(hostApiMock.git.capabilities).toHaveBeenCalledTimes(1);
      expect(hostApiMock.mcp.listTools).toHaveBeenCalledWith({ serverId: 'clawx-git' });
    });

    expect(await screen.findByText('git version 2.45.0')).toBeInTheDocument();
    expect(screen.getByText('Active repo')).toBeInTheDocument();
    expect(screen.getByText('27 tools')).toBeInTheDocument();
    expect(screen.getByText('octocat')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-git-readiness-score')).toHaveTextContent('4/4 ready');
    const metrics = screen.getByTestId('workspace-git-repo-metrics');
    expect(within(metrics).getByText('Delta')).toBeInTheDocument();
    expect(within(metrics).getByText('+2 -1')).toBeInTheDocument();
    expect(within(metrics).getByText('Worktrees')).toBeInTheDocument();
    expect(within(metrics).getByText('2')).toBeInTheDocument();
    expect(within(metrics).getByText('Stashes')).toBeInTheDocument();
    expect(within(metrics).getAllByText('1').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('+2 -1').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Prunable')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-git-tool-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-git-last-operation')).toHaveTextContent('No Git operation yet');

    fireEvent.change(screen.getByPlaceholderText('Branch for worktree'), {
      target: { value: 'feature/score' },
    });
    expect(screen.getByTestId('workspace-git-worktree-target')).toHaveTextContent('/workspace/demo-feature-score');

    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));
    await waitFor(() => {
      expect(screen.getByTestId('workspace-git-last-operation')).toHaveTextContent('Fetch: Completed');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
    fireEvent.click(screen.getByRole('button', { name: 'Push' }));

    await waitFor(() => {
      expect(hostApiMock.git.fetch).toHaveBeenCalledTimes(1);
      expect(hostApiMock.git.pull).toHaveBeenCalledTimes(1);
      expect(hostApiMock.git.push).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stash' }));
    expect(screen.getByTestId('workspace-git-stash-panel')).toHaveTextContent('WIP demo changes');
    expect(screen.getByTestId('workspace-git-stash-panel')).toHaveTextContent('1 saved');
    fireEvent.change(screen.getByPlaceholderText('Optional stash message'), {
      target: { value: 'checkpoint' },
    });
    fireEvent.click(screen.getByLabelText('Include untracked'));
    fireEvent.click(screen.getByRole('button', { name: 'Stash changes' }));
    await waitFor(() => {
      expect(hostApiMock.git.stashPush).toHaveBeenCalledWith({
        message: 'checkpoint',
        includeUntracked: true,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply stash@{0}' }));
    await waitFor(() => {
      expect(screen.getByText('Apply needs approval')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve & retry' }));
    await waitFor(() => {
      expect(hostApiMock.permissions.decideApproval).toHaveBeenCalledWith({
        id: 'approval-stash-apply',
        decision: 'approved',
      });
      expect(hostApiMock.git.stashApply).toHaveBeenLastCalledWith({
        selector: 'stash@{0}',
        approvalId: 'approval-stash-apply',
      });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pop stash@{0}' }));
    await waitFor(() => {
      expect(hostApiMock.git.stashPop).toHaveBeenCalledWith({ selector: 'stash@{0}' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'PR' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Base branch')).toHaveValue('main');
      expect(screen.getByLabelText('Head branch')).toHaveValue('feature/git-panel');
    });
    fireEvent.change(screen.getByPlaceholderText('PR title'), {
      target: { value: 'Ship Git panel' },
    });
    fireEvent.change(screen.getByPlaceholderText('PR body'), {
      target: { value: 'Ready for review' },
    });
    fireEvent.click(screen.getByLabelText('Draft PR'));
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }));
    await waitFor(() => {
      expect(hostApiMock.git.prCreate).toHaveBeenCalledWith({
        title: 'Ship Git panel',
        body: 'Ready for review',
        base: 'main',
        head: 'feature/git-panel',
        draft: true,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Worktree' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    await waitFor(() => {
      expect(hostApiMock.workspaces.create).toHaveBeenCalledWith({
        name: 'demo-feature-a',
        rootPath: '/workspace/demo-feature-a',
      });
    });
    expect(screen.getByTestId('workspace-git-last-operation')).toHaveTextContent('Switch: Workspace created for this worktree');
  });
});
