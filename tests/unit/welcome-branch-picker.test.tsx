import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WelcomeBranchPicker } from '@/components/chat/WelcomeBranchPicker';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({ branches: vi.fn(), checkoutBranch: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/host-api', () => ({ hostApi: { git: mocks } }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function picker(props: Partial<React.ComponentProps<typeof WelcomeBranchPicker>> = {}) {
  return render(<TooltipProvider><WelcomeBranchPicker branch="main" {...props} /></TooltipProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.branches.mockResolvedValue({ success: true, branches: [{ name: 'main', current: true }, { name: 'feature/layout', current: false }] });
  mocks.checkoutBranch.mockResolvedValue({ success: true });
});

describe('WelcomeBranchPicker', () => {
  it('loads only on demand, searches and checks out through the existing host route', async () => {
    const onChanged = vi.fn();
    picker({ onChanged });
    expect(mocks.branches).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('welcome-branch-trigger'));
    const search = screen.getByRole('textbox', { name: 'welcome.branchSearch' });
    expect(search).toHaveFocus();
    expect(await screen.findByTestId('welcome-branch-item-main')).toBeDisabled();
    fireEvent.change(search, { target: { value: 'layout' } });
    expect(screen.queryByTestId('welcome-branch-item-main')).toBeNull();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    const branch = screen.getByTestId('welcome-branch-item-feature-layout');
    expect(branch).toHaveFocus();
    fireEvent.click(branch);
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(mocks.checkoutBranch).toHaveBeenCalledWith({ name: 'feature/layout' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a failed branch read with retry instead of an empty list', async () => {
    mocks.branches.mockRejectedValueOnce(new Error('offline'));
    picker();
    fireEvent.click(screen.getByTestId('welcome-branch-trigger'));
    expect(await screen.findByRole('alert')).toHaveTextContent('welcome.branchLoadFailed');
    expect(screen.queryByText('welcome.branchEmpty')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(await screen.findByTestId('welcome-branch-item-feature-layout')).toBeEnabled();
  });

  it('keeps the current branch and menu when checkout is blocked', async () => {
    mocks.checkoutBranch.mockResolvedValue({ success: false, blocked: true, reason: 'Working tree has changes' });
    const onChanged = vi.fn();
    picker({ onChanged });
    fireEvent.click(screen.getByTestId('welcome-branch-trigger'));
    fireEvent.click(await screen.findByTestId('welcome-branch-item-feature-layout'));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId('welcome-branch-trigger')).toHaveTextContent('main');
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('does not accept a late branch response after closing and reopening', async () => {
    let finish!: (value: unknown) => void;
    mocks.branches.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    picker();
    const trigger = screen.getByTestId('welcome-branch-trigger');
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByTestId('welcome-branch-item-feature-layout')).toBeVisible());
    await act(async () => finish({ success: true, branches: [{ name: 'stale', current: false }] }));
    expect(screen.queryByTestId('welcome-branch-item-stale')).toBeNull();
  });

  it('keeps branch selection available for detached HEAD and honors disabled state', () => {
    picker({ branch: '', detached: true, disabled: true });
    const trigger = screen.getByTestId('welcome-branch-trigger');
    expect(trigger).toHaveTextContent('composer.git.detached');
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(mocks.branches).not.toHaveBeenCalled();
  });
});
