// driven_by: agent; requested_route: ccs-workbuddy/deepseek-v4.1-flash
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskPage, TaskView } from '@shared/task-system/types';
import type { TaskId, SessionKey } from '@shared/types/identity-scope';
import type { WorkspaceProfile } from '@shared/types/workspace';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';
import chat from '@shared/i18n/locales/en/chat.json';
import ledger from '@shared/i18n/locales/en/taskLedger.json';
import zhChat from '@shared/i18n/locales/zh/chat.json';
import jaChat from '@shared/i18n/locales/ja/chat.json';
import ruChat from '@shared/i18n/locales/ru/chat.json';
import zhLedger from '@shared/i18n/locales/zh/taskLedger.json';
import jaLedger from '@shared/i18n/locales/ja/taskLedger.json';
import ruLedger from '@shared/i18n/locales/ru/taskLedger.json';

const host = vi.hoisted(() => ({ snapshot: vi.fn(), queryTasks: vi.fn(), command: vi.fn(), selectSessionTask: vi.fn(),
  activate: vi.fn(), fetchWorkspaces: vi.fn(), profiles: [] as WorkspaceProfile[], activeWorkspaceId: 'project-a' }));
vi.mock('@/lib/host-api', () => ({ hostApi: { taskLedger: host, workspaces: host } }));
vi.mock('@/lib/workspace-session', () => ({ activateWorkspaceScopedSession: host.activate }));
vi.mock('@/stores/workspaces', () => ({ useWorkspacesStore: Object.assign(
  (selector: (value: typeof host) => unknown) => selector(host), { getState: () => host },
) }));
vi.mock('@/stores/chat', () => ({ useChatStore: (selector: (value: unknown) => unknown) => selector({ currentSessionKey: 'session-a' }) }));
vi.mock('@/pages/Chat', () => ({ Chat: () => <main data-testid="project-chat" /> }));
vi.mock('react-i18next', () => ({ useTranslation: (namespace: string) => ({
  t: (key: string, values?: Record<string, unknown>) => {
    const text = key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)?.[part], namespace === 'chat' ? chat : ledger);
    return String(text ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''));
  },
}) }));

import ProjectPage from '@/pages/Projects';
import { TaskLedgerSummaryPanel } from '@/components/task-ledger/TaskLedgerSummaryPanel';
import { ManagedTasks } from '@/pages/TaskLedger/ManagedTasks';

function task(id: string, state: TaskView['contract']['state'] = 'ready', dependencies: string[] = []): TaskView {
  return { contract: { taskNodeId: id as TaskId, objective: `Task ${id}`, state, dependencies, target: `${id}.txt`,
    constraints: [], acceptance: [], domain: 'test', revision: 1, digest: 'hash', createdAt: 1, updatedAt: 1,
    origin: { source: 'test', requestId: id } }, claim: null, checkpoint: null, pendingOperations: 0 };
}
function card(title: string) { return screen.getByRole('heading', { name: title }).closest('article')!; }
function project() {
  return render(<MemoryRouter initialEntries={['/projects/project-a']}><Routes>
    <Route path="/projects/:workspaceId" element={<ProjectPage />} />
  </Routes></MemoryRouter>);
}
function summary(workspaceId = 'project-a') {
  return <MemoryRouter><TaskLedgerSummaryPanel mode="bar" workspaceId={workspaceId}
    projectWide session={{ key: 'session-a', sessionId: 'generation-a' }} /></MemoryRouter>;
}
function snapshot(workspaceId = 'project-a'): TaskLedgerSnapshot {
  return { schemaVersion: 1, workspaceId, sourceWorkspaceId: workspaceId, generatedAt: '',
    nodes: [{ id: 'task-a', title: 'Recorded task', kind: 'task', status: 'todo', createdAt: '', updatedAt: '' }],
    sessionLinks: [], edges: [], rootNodeIds: ['task-a'], activeNodeIds: [], blockedNodeIds: [], reviewNodeIds: [],
    recentDecisions: [], warnings: [], eventsCount: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
  host.queryTasks.mockReset(); host.command.mockReset(); host.snapshot.mockReset(); host.activate.mockReset();
  host.profiles = [{ id: 'project-a', name: 'Project A', activeSessionKey: 'session-a', agentId: 'main',
    rootPath:'D:/tmp/project-a',permissionMode:'fullAccess',state:{},createdAt:1,updatedAt:1,lastOpenedAt:1,
    agentBindings: { main: { workspaceId:'project-a',agentId:'main',sessionKey: 'session-a' } } }];
  host.activate.mockResolvedValue(true);
  host.fetchWorkspaces.mockResolvedValue(undefined);
  host.command.mockResolvedValue({ success: true });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(cleanup);

describe('U2 project and Ledger causes', () => {
  it('names an unbound coordinator without activating the default session', () => {
    project();
    expect(screen.getByTestId('project-entry-unavailable')).toHaveTextContent(chat.projectEntry.unbound);
    expect(host.activate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('project-chat')).not.toBeInTheDocument();
  });

  it('keeps an archived coordinator distinct from an unbound coordinator', () => {
    host.profiles[0] = { ...host.profiles[0], projectCoordinatorSessionKey: 'session-a', archivedSessionKeys: ['session-a'] };
    project();
    expect(screen.getByTestId('project-entry-unavailable')).toHaveTextContent(chat.projectEntry.unavailable);
    expect(host.activate).not.toHaveBeenCalled();
  });

  it('normalizes a permission rejection, hides selection and refreshes the same owner after a held read', async () => {
    let reject!: (reason: unknown) => void;
    host.snapshot.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }))
      .mockResolvedValue({ snapshot: snapshot() });
    render(summary());
    expect(screen.getByTestId('session-task-container')).toHaveAttribute('data-state', 'loading');
    await act(async () => { reject({ code: 'FORBIDDEN', message: 'opaque diagnostic' }); });
    expect(screen.getByRole('status')).toHaveTextContent(ledger.summary.permissionDenied);
    expect(screen.getByTestId('session-task-container')).toHaveAttribute('data-state', 'unavailable');
    fireEvent.click(screen.getByTestId('session-tasks-toggle'));
    expect(screen.getByTestId('session-task-list')).toHaveTextContent(ledger.summary.permissionDenied);
    expect(screen.queryByTestId('session-task-select-task-a')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: ledger.summary.refresh }));
    await waitFor(() => expect(screen.getByTestId('session-task-container')).toHaveAttribute('data-state', 'ready'));
    expect(screen.getByTestId('session-task-list')).toHaveTextContent('Recorded task');
    expect(host.snapshot.mock.calls).toEqual([[{ workspaceId: 'project-a' }], [{ workspaceId: 'project-a' }]]);
    expect(host.selectSessionTask).not.toHaveBeenCalled();
  });

  it('keeps a late permission rejection scoped to its original workspace', async () => {
    let reject!: (reason: unknown) => void;
    host.snapshot.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }))
      .mockResolvedValue({ snapshot: snapshot('project-b') });
    const view = render(summary());
    view.rerender(summary('project-b'));
    await waitFor(() => expect(screen.getByTestId('session-task-container')).toHaveAttribute('data-state', 'ready'));
    await act(async () => { reject({ code: 'PERMISSION_DENIED' }); });
    expect(screen.getByRole('status')).not.toHaveTextContent(ledger.summary.permissionDenied);
    expect(screen.getByTestId('session-task-container')).toHaveAttribute('data-state', 'ready');
  });
});

describe('U2 dependency navigation uses the existing task owner', () => {
  it('shows unfinished titles and states, focuses the prerequisite, then calls the original claim action', async () => {
    const rows = [task('dependent', 'ready', ['input', 'review', 'cancelled', 'done']), task('input'), task('review', 'review'),
      task('cancelled', 'cancelled'), task('done', 'done')];
    host.queryTasks.mockImplementation(async () => ({ success: true, tasks: rows }));
    host.command.mockImplementation(async () => {
      rows[1] = { ...rows[1], contract: { ...rows[1].contract, state: 'doing' }, claim: {
        taskNodeId: 'input' as TaskId, sessionKey: 'session-a' as SessionKey, generation: 'g', epoch: 1, attemptId: 'claim', worktree: 'test',
        contractRevision: 1, expiresAt: 9999999999999, state: 'active',
      } };
      return { success: true };
    });
    render(<ManagedTasks workspaceId="project-a" sessionKey="session-a" />);
    await screen.findByRole('heading', { name: 'Task dependent' });
    const dependent = within(card('Task dependent'));
    fireEvent.click(dependent.getByTestId('managed-task-details').querySelector('summary')!);
    expect(dependent.getByText(ledger.managed.waitingDependency)).toBeVisible();
    expect(dependent.getByText('Awaiting acceptance')).toBeVisible();
    expect(dependent.getByText('Cancelled')).toBeVisible();
    expect(dependent.queryByRole('button', { name: 'Open dependency: Task done' })).not.toBeInTheDocument();
    expect(dependent.getByRole('button', { name: ledger.managed.claim })).toBeDisabled();
    fireEvent.click(dependent.getByRole('button', { name: 'Open dependency: Task input' }));
    await waitFor(() => expect(card('Task input')).toHaveFocus());
    expect(host.queryTasks).toHaveBeenCalledTimes(1);
    const inputDetails = card('Task input').querySelector<HTMLDetailsElement>('details')!;
    if (!inputDetails.open) fireEvent.click(inputDetails.querySelector('summary')!);
    fireEvent.click(within(card('Task input')).getByRole('button', { name: ledger.managed.claim }));
    await waitFor(() => expect(host.command).toHaveBeenCalledWith({ workspaceId: 'project-a',
      command: { action: 'claim', taskNodeId: 'input', sessionKey: 'session-a', requestId: expect.any(String) } }));
    await waitFor(() => expect(within(card('Task input')).getByRole('button', { name: ledger.managed.pause })).toBeVisible());
  });

  it('reads one unfiltered page per click and keeps only the exact dependency before focusing it', async () => {
    host.queryTasks.mockResolvedValueOnce({ success: true, tasks: [task('dependent', 'ready', ['input'])], nextCursor: 'list-next' })
      .mockResolvedValueOnce({ success: true, tasks: [task('unrelated')], nextCursor: 'dependency-next' })
      .mockResolvedValueOnce({ success: true, tasks: [task('input'), task('extra')] });
    render(<ManagedTasks workspaceId="project-a" sessionKey="session-a" />);
    await screen.findByRole('heading', { name: 'Task dependent' });
    expect(host.queryTasks).toHaveBeenCalledTimes(1);
    expect(within(card('Task dependent')).getByRole('button', { name: ledger.managed.claim })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: ledger.managed.findDependency }));
    await screen.findByRole('button', { name: ledger.managed.findDependencyMore });
    expect(host.queryTasks).toHaveBeenCalledTimes(2);
    expect(host.queryTasks.mock.calls[1][0]).toEqual({ workspaceId: 'project-a', limit: 50, cursor: undefined });
    expect(screen.queryByRole('heading', { name: 'Task unrelated' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: ledger.managed.findDependencyMore }));
    await waitFor(() => expect(card('Task input')).toHaveFocus());
    expect(host.queryTasks.mock.calls[2][0]).toEqual({ workspaceId: 'project-a', limit: 50, cursor: 'dependency-next' });
    expect(screen.queryByRole('heading', { name: 'Task extra' })).not.toBeInTheDocument();
    expect(host.command).not.toHaveBeenCalled();
  });

  it('keeps an absent dependency blocked after exhausting pages and allows a new read', async () => {
    host.queryTasks.mockResolvedValueOnce({ success: true, tasks: [task('dependent', 'ready', ['missing'])] })
      .mockResolvedValueOnce({ success: true, tasks: [] })
      .mockResolvedValueOnce({ success: true, tasks: [task('missing', 'done')] });
    render(<ManagedTasks workspaceId="project-a" sessionKey="session-a" />);
    await screen.findByRole('button', { name: ledger.managed.findDependency });
    fireEvent.click(screen.getByRole('button', { name: ledger.managed.findDependency }));
    await screen.findByText(ledger.managed.dependencyMissing);
    expect(within(card('Task dependent')).getByRole('button', { name: ledger.managed.claim })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: ledger.managed.findDependency }));
    await waitFor(() => expect(within(card('Task dependent')).getByRole('button', { name: ledger.managed.claim })).toBeEnabled());
    expect(within(card('Task dependent')).queryByText(ledger.managed.waitingDependency)).not.toBeInTheDocument();
    expect(host.queryTasks.mock.calls[2][0].cursor).toBeUndefined();
  });

  it('keeps a failed dependency read unresolved and retries the same owner cursor', async () => {
    host.queryTasks.mockResolvedValueOnce({ success: true, tasks: [task('dependent', 'ready', ['input'])] })
      .mockResolvedValueOnce({ success: true, tasks: [], nextCursor: 'next' })
      .mockRejectedValueOnce(new Error('owner read failed'))
      .mockResolvedValueOnce({ success: true, tasks: [task('input')] });
    render(<ManagedTasks workspaceId="project-a" sessionKey="session-a" />);
    fireEvent.click(await screen.findByRole('button', { name: ledger.managed.findDependency }));
    fireEvent.click(await screen.findByRole('button', { name: ledger.managed.findDependencyMore }));
    await screen.findByText(ledger.managed.dependencyReadFailed);
    expect(within(card('Task dependent')).getByRole('button', { name: ledger.managed.claim })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: ledger.managed.findDependency }));
    await waitFor(() => expect(card('Task input')).toHaveFocus());
    expect(host.queryTasks.mock.calls.slice(2).map(([payload]) => payload.cursor)).toEqual(['next', 'next']);
  });

  it('discards an in-flight dependency read when the workspace changes', async () => {
    let finish!: (page: TaskPage) => void;
    host.queryTasks.mockResolvedValueOnce({ success: true, tasks: [task('dependent', 'ready', ['input'])] })
      .mockReturnValueOnce(new Promise<TaskPage>((resolve) => { finish = resolve; }))
      .mockResolvedValue({ success: true, tasks: [task('other-project')] });
    const view = render(<ManagedTasks workspaceId="project-a" sessionKey="session-a" />);
    fireEvent.click(await screen.findByRole('button', { name: ledger.managed.findDependency }));
    view.rerender(<ManagedTasks workspaceId="project-b" sessionKey="session-b" />);
    await screen.findByRole('heading', { name: 'Task other-project' });
    await act(async () => { finish({ tasks: [task('input')] }); });
    expect(screen.queryByRole('heading', { name: 'Task input' })).not.toBeInTheDocument();
    expect(host.command).not.toHaveBeenCalled();
  });
});

it('provides all new state messages and title interpolation in four locales', () => {
  for (const messages of [chat, zhChat, jaChat, ruChat]) expect(messages.projectEntry.unbound).toBeTruthy();
  for (const messages of [ledger, zhLedger, jaLedger, ruLedger]) {
    expect(messages.summary.permissionDenied).toBeTruthy();
    for (const key of ['waitingDependency', 'openDependency', 'dependencyNotLoaded', 'dependencyMissing',
      'dependencyReadFailed', 'readingDependency', 'findDependency', 'findDependencyMore'] as const) {
      expect(messages.managed[key]).toBeTruthy();
    }
    expect(messages.managed.openDependency).toContain('{{title}}');
  }
});
