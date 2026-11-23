import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitOperationResult } from '@shared/types/git';
const mocks = vi.hoisted(() => ({
  status: vi.fn(), trees: vi.fn(), branches: vi.fn(), add: vi.fn(), checkout: vi.fn(), select: vi.fn(), before: vi.fn(),
  state: { activeWorkspace: { id: 'main', name: 'Demo', rootPath: 'D:/demo' }, profiles: [], switchWorkspace: vi.fn() },
}));
vi.mock('@/lib/host-api', () => ({ hostApi: { git: { status: mocks.status, worktrees: mocks.trees, branches: mocks.branches, worktreeAdd: mocks.add, checkoutBranch: mocks.checkout } } }));
vi.mock('@/lib/host-events', () => ({ hostEvents: { onChatRuntimeEvent: () => () => {} } }));
vi.mock('@/stores/workspaces', () => ({ useWorkspacesStore: Object.assign((select: (state: typeof mocks.state) => unknown) => select(mocks.state), { getState: () => mocks.state }) }));
import { SessionWorkspacePicker } from '@/components/chat/SessionWorkspacePicker';

const mount = (disabled = false) => render(<SessionWorkspacePicker sessionKey="chat-a" disabled={disabled} onSelect={mocks.select} onBeforeChange={mocks.before}>
  <input aria-label="retained draft" defaultValue="Keep the current draft" />
</SessionWorkspacePicker>);
const open = async () => {
  fireEvent.click(screen.getByTestId('composer-context-more'));
  await waitFor(() => expect(mocks.branches).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('Loading working directories…')).toBeNull());
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.activeWorkspace = { id: 'main', name: 'Demo', rootPath: 'D:/demo' };
  mocks.status.mockResolvedValue({ success: true, status: { isRepository: true, workspaceRoot: 'D:/demo', repoRoot: 'D:/demo', branch: 'main', clean: true, changes: [] } });
  mocks.trees.mockResolvedValue({ success: true, worktrees: [{ path: 'D:/demo', branch: 'main' }, { path: 'D:/demo-existing', branch: 'feature/existing' }] });
  mocks.branches.mockResolvedValue({ success: true, branches: [{ name: 'main', current: true }, { name: 'feature/next', current: false }] });
  mocks.add.mockResolvedValue({ success: true, worktree: { path: 'D:/demo-new', branch: 'codex/new' } });
  mocks.checkout.mockResolvedValue({ success: true });
  mocks.select.mockResolvedValue(undefined); mocks.before.mockResolvedValue(undefined);
});
afterEach(cleanup);
describe('composer execution settings', () => {
  it('creates with two clicks and no typed configuration, saving before Git and opening the returned path', async () => {
    const order: string[] = [];
    mocks.before.mockImplementation(async () => { order.push('save'); });
    mocks.add.mockImplementation(async () => { order.push('create'); return { success: true, worktree: { path: 'D:/demo-new', branch: 'codex/new' } }; });
    mocks.select.mockImplementation(async () => { order.push('open'); });
    mount(); await open();
    const button = screen.getByTestId('session-worktree-submit');
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByTestId('session-worktree-branch')).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(mocks.select).toHaveBeenCalledWith({ path: 'D:/demo-new', branch: 'codex/new' }));
    expect(mocks.add).toHaveBeenCalledWith({ branch: expect.stringMatching(/^codex\/task-/), startPoint: 'main', checkoutNewBranch: true });
    expect(order).toEqual(['save', 'create', 'open']);
    expect(screen.getByLabelText('retained draft')).toHaveValue('Keep the current draft');
  });
  it('keeps a failed creation editable without changing the current draft', async () => {
    mocks.add.mockResolvedValue({ success: false, blocked: true, reason: 'Branch already exists' });
    mount(); await open();
    await waitFor(() => expect(screen.getByTestId('session-worktree-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('session-worktree-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Branch already exists');
    expect(screen.getByTestId('session-worktree-branch')).toBeVisible();
    expect(screen.getByLabelText('retained draft')).toHaveValue('Keep the current draft');
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it('retries opening an already created tree without creating another', async () => {
    mocks.select.mockRejectedValueOnce(new Error('Activation failed'));
    mount(); await open();
    await waitFor(() => expect(screen.getByTestId('session-worktree-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('session-worktree-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Activation failed');
    const retry = screen.getByTestId('session-worktree-submit');
    await waitFor(() => expect(retry).toBeEnabled());
    expect(retry).toHaveTextContent('Open worktree'); fireEvent.click(retry);
    await waitFor(() => expect(mocks.select).toHaveBeenCalledTimes(2));
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });
  it('ignores an old creation after moving to another session and prevents duplicate submits', async () => {
    let finish!: (result: GitOperationResult) => void;
    mocks.add.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = mount(); await open();
    await waitFor(() => expect(screen.getByTestId('session-worktree-submit')).toBeEnabled());
    fireEvent.click(screen.getByTestId('session-worktree-submit')); fireEvent.click(screen.getByTestId('session-worktree-submit'));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { finish({ success: true, worktree: { path: 'D:/late', branch: 'codex/late' } }); });
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it('allows inspection during a run while disabling all mutations', async () => {
    mount(true); await open();
    expect(screen.getByTestId('session-worktree-submit')).toBeDisabled();
    expect(screen.getByTestId('session-worktree-option-1')).toBeDisabled();
    fireEvent.click(screen.getByTestId('composer-context-branches-toggle'));
    expect(screen.getByTestId('composer-context-checkout-feature/next')).toBeDisabled();
    expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.checkout).not.toHaveBeenCalled();
  });
  it('opens branches directly in the same panel and invokes the existing checkout action', async () => {
    mount(); await waitFor(() => expect(screen.getByTestId('composer-context-branch')).toBeVisible());
    fireEvent.click(screen.getByTestId('composer-context-branch'));
    const next = screen.getByTestId('composer-context-checkout-feature/next');
    await waitFor(() => expect(next).toBeEnabled()); fireEvent.click(next);
    await waitFor(() => expect(mocks.checkout).toHaveBeenCalledWith({ name: 'feature/next' }));
    expect(mocks.before).toHaveBeenCalledTimes(1);
  });
});
