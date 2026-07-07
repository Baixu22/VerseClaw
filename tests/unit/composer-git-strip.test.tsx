import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { ComposerGitStrip } from '@/pages/Chat/ComposerGitStrip';
import type { WorkspaceProfile } from '@shared/types/workspace';

const hostApiMock = vi.hoisted(() => ({
  git: {
    status: vi.fn(),
    branches: vi.fn(),
    worktrees: vi.fn(),
    checkoutBranch: vi.fn(),
    createBranch: vi.fn(),
    worktreeAdd: vi.fn(),
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: hostApiMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'composer.git.loading': 'Loading Git',
        'composer.git.branchLabel': 'Branch',
        'composer.git.worktreeLabel': 'Worktree',
        'composer.git.clean': 'Clean',
        'composer.git.dirty': `${String(options?.count)} changes`,
        'composer.git.conflicts': `${String(options?.count)} conflicts`,
        'composer.git.detached': 'Detached',
        'composer.git.unknownBranch': 'Unknown branch',
        'composer.git.openPanel': 'Open Git Panel',
        'composer.git.refresh': 'Refresh',
        'composer.git.branches': 'Branches',
        'composer.git.searchBranches': 'Search branches',
        'composer.git.createBranch': 'Create branch',
        'composer.git.branchName': 'Branch name',
        'composer.git.startPoint': 'Start point',
        'composer.git.checkout': 'Checkout',
        'composer.git.worktrees': 'Worktrees',
        'composer.git.current': 'Current',
        'composer.git.locked': 'Locked',
        'composer.git.prunable': 'Prunable',
        'composer.git.switchWorktree': 'Switch',
        'composer.git.addWorktree': 'Add worktree',
        'composer.git.newBranch': 'New branch',
        'composer.git.existingBranch': 'Existing branch',
        'composer.git.defaultPath': 'Default path',
        'composer.git.defaultPathUnavailable': 'Enter a branch to preview the path',
        'composer.git.branchExists': 'Branch already exists',
        'composer.git.branchCheckedOut': `Branch checked out at ${String(options?.path)}`,
        'composer.git.operationBlocked': String(options?.reason),
        'composer.git.operationFailed': String(options?.error),
        'composer.git.operationSuccess': String(options?.action),
        'composer.git.sync': `ahead ${String(options?.ahead)} / behind ${String(options?.behind)}`,
      };
      return translations[key] ?? key;
    },
  }),
}));

function workspace(): WorkspaceProfile {
  return {
    id: 'workspace-1',
    name: 'Demo',
    rootPath: '/workspace/demo',
    permissionMode: 'acceptEdits',
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
  };
}

function mockGitContext() {
  hostApiMock.git.status.mockResolvedValue({
    status: {
      isRepository: true,
      workspaceRoot: '/workspace/demo',
      repoRoot: '/workspace/demo',
      branch: 'feature/current',
      upstream: 'origin/feature/current',
      ahead: 2,
      behind: 1,
      clean: false,
      hasConflicts: false,
      stagedCount: 1,
      unstagedCount: 2,
      untrackedCount: 0,
      conflictedCount: 0,
      changes: [],
    },
  });
  hostApiMock.git.branches.mockResolvedValue({
    branches: [
      { name: 'feature/current', current: true },
      { name: 'main', current: false },
      { name: 'feature/existing', current: false },
    ],
  });
  hostApiMock.git.worktrees.mockResolvedValue({
    worktrees: [
      { path: '/workspace/demo', branch: 'feature/current', head: 'abcdef123456' },
      { path: '/workspace/demo-feature-existing', branch: 'feature/existing', head: '123456789abc' },
    ],
  });
}

describe('ComposerGitStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGitContext();
  });

  it('renders branch, dirty state, sync state, and current worktree context', async () => {
    render(
      <ComposerGitStrip
        workspace={workspace()}
        onOpenGitPanel={vi.fn()}
        onSwitchWorktreeWorkspace={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('composer-git-strip')).toHaveTextContent('feature/current');
    expect(screen.getByTestId('composer-git-strip')).toHaveTextContent('3 changes');
    expect(screen.getByTestId('composer-git-strip')).toHaveTextContent('ahead 2 / behind 1');
    expect(screen.getByTestId('composer-git-strip')).toHaveTextContent('demo');
  });

  it('hides when the active workspace is not a repository', async () => {
    hostApiMock.git.status.mockResolvedValueOnce({
      status: {
        isRepository: false,
        workspaceRoot: '/workspace/demo',
        ahead: 0,
        behind: 0,
        clean: true,
        hasConflicts: false,
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        conflictedCount: 0,
        changes: [],
      },
    });

    render(
      <ComposerGitStrip
        workspace={workspace()}
        onOpenGitPanel={vi.fn()}
        onSwitchWorktreeWorkspace={vi.fn()}
      />,
    );

    await waitFor(() => expect(hostApiMock.git.status).toHaveBeenCalled());
    expect(screen.queryByTestId('composer-git-strip')).not.toBeInTheDocument();
  });

  it('checks out a branch through the host Git API and refreshes context', async () => {
    hostApiMock.git.checkoutBranch.mockResolvedValue({ success: true });
    render(
      <ComposerGitStrip
        workspace={workspace()}
        onOpenGitPanel={vi.fn()}
        onSwitchWorktreeWorkspace={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId('composer-git-trigger'));
    fireEvent.change(screen.getByTestId('composer-git-branch-search'), { target: { value: 'main' } });
    const callsBeforeCheckout = hostApiMock.git.status.mock.calls.length;
    fireEvent.click(await screen.findByTestId('composer-git-checkout-main'));

    await waitFor(() => expect(hostApiMock.git.checkoutBranch).toHaveBeenCalledWith({ name: 'main' }));
    await waitFor(() => expect(hostApiMock.git.status.mock.calls.length).toBeGreaterThan(callsBeforeCheckout));
  });

  it('reports blocked branch checkouts and refreshes context afterward', async () => {
    hostApiMock.git.checkoutBranch.mockResolvedValue({
      success: false,
      blocked: true,
      reason: 'Dirty worktree',
    });
    render(
      <ComposerGitStrip
        workspace={workspace()}
        onOpenGitPanel={vi.fn()}
        onSwitchWorktreeWorkspace={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId('composer-git-trigger'));
    const callsBeforeCheckout = hostApiMock.git.status.mock.calls.length;
    fireEvent.click(await screen.findByTestId('composer-git-checkout-main'));

    await waitFor(() => expect(hostApiMock.git.checkoutBranch).toHaveBeenCalledWith({ name: 'main' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Dirty worktree'));
    await waitFor(() => expect(hostApiMock.git.status.mock.calls.length).toBeGreaterThan(callsBeforeCheckout));
  });

  it('creates a branch with checkout enabled', async () => {
    hostApiMock.git.createBranch.mockResolvedValue({ success: true });
    render(
      <ComposerGitStrip
        workspace={workspace()}
        onOpenGitPanel={vi.fn()}
        onSwitchWorktreeWorkspace={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId('composer-git-trigger'));
    fireEvent.change(screen.getByTestId('composer-git-new-branch'), { target: { value: 'feature/new-ui' } });
    fireEvent.click(screen.getByTestId('composer-git-create-branch'));

    await waitFor(() => expect(hostApiMock.git.createBranch).toHaveBeenCalledWith({
      name: 'feature/new-ui',
      checkout: true,
    }));
  });

  it('blocks duplicate worktree branches and adds valid worktrees', async () => {
    hostApiMock.git.worktreeAdd.mockResolvedValue({ success: true });
    render(
      <ComposerGitStrip
        workspace={workspace()}
        onOpenGitPanel={vi.fn()}
        onSwitchWorktreeWorkspace={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId('composer-git-trigger'));
    fireEvent.change(screen.getByTestId('composer-git-worktree-branch'), { target: { value: 'feature/current' } });
    expect(screen.getByTestId('composer-git-worktree-blocked')).toHaveTextContent('Branch already exists');
    expect(screen.getByTestId('composer-git-add-worktree')).toBeDisabled();

    fireEvent.change(screen.getByTestId('composer-git-worktree-branch'), { target: { value: 'feature/new-worktree' } });
    expect(screen.getByTestId('composer-git-worktree-target')).toHaveTextContent('/workspace/demo-feature-new-worktree');
    fireEvent.click(screen.getByTestId('composer-git-add-worktree'));

    await waitFor(() => expect(hostApiMock.git.worktreeAdd).toHaveBeenCalledWith({
      branch: 'feature/new-worktree',
      checkoutNewBranch: true,
    }));
  });

  it('switches worktree workspace through the parent callback', async () => {
    const onSwitchWorktreeWorkspace = vi.fn().mockResolvedValue(undefined);
    render(
      <ComposerGitStrip
        workspace={workspace()}
        onOpenGitPanel={vi.fn()}
        onSwitchWorktreeWorkspace={onSwitchWorktreeWorkspace}
      />,
    );

    fireEvent.click(await screen.findByTestId('composer-git-trigger'));
    const menu = await screen.findByTestId('composer-git-menu');
    fireEvent.click(within(menu).getByTestId('composer-git-switch-worktree-/workspace/demo-feature-existing'));

    await waitFor(() => expect(onSwitchWorktreeWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/demo-feature-existing' }),
    ));
  });

  it('labels worktrees by folder, branch, and short commit', async () => {
    render(
      <ComposerGitStrip
        workspace={workspace()}
        onOpenGitPanel={vi.fn()}
        onSwitchWorktreeWorkspace={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByTestId('composer-git-trigger'));

    expect(await screen.findByTestId('composer-git-menu')).toHaveTextContent(
      'demo-feature-existing · feature/existing · 1234567',
    );
  });
});
