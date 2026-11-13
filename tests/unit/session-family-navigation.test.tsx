import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProfile } from '@shared/types/workspace';
import type { TaskLedgerSnapshot } from '@shared/types/task-ledger';
import { SessionFolderTree } from '@/components/layout/SessionFolderTree';
import { SessionFamilyNavigation } from '@/components/chat/SessionFamilyNavigation';
import { TaskLedgerSummaryPanel } from '@/components/task-ledger/TaskLedgerSummaryPanel';

const host = vi.hoisted(() => ({ snapshot: vi.fn(), selectSessionTask: vi.fn() }));
vi.mock('@/lib/host-api', () => ({ hostApi: { taskLedger: host, workspaces: host } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const sessions = [{ key: 'parent', displayName: 'Parent' }, { key: 'child', displayName: 'Child', spawnedBy: 'parent', parentSessionKey: 'parent' }];
const workspace = { id: 'workspace-a', sessionFolders: [], sessionFolderAssignments: {} } as unknown as WorkspaceProfile;
const actions = { onToggleFolder: vi.fn(), onCreateFolder: vi.fn(), onRenameFolder: vi.fn(), onDeleteFolder: vi.fn(), onDropSession: vi.fn() };

function tree(currentSessionKey?: string) {
  return <SessionFolderTree workspace={workspace} sessions={sessions.map((session) => ({ session, activityMs: 1 }))}
    currentSessionKey={currentSessionKey} collapsedFolders={{}} sessionStatusKinds={{}} sessionSort="newest" {...actions}
    renderSessionRow={(entry) => <button>{entry.session.displayName}</button>} />;
}
function ledger(title: string): TaskLedgerSnapshot {
  return { schemaVersion: 1, workspaceId: 'opaque-owner-key', sourceWorkspaceId: title === 'Task B' ? 'workspace-b' : 'workspace-a', generatedAt: new Date().toISOString(),
    nodes: [{ id: title, title, kind: 'task', status: 'todo', createdAt: '', updatedAt: '' }],
    sessionLinks: [{ id: title, nodeId: title, sessionKey: 'parent', createdAt: '' }],
    edges: [], activeNodeIds: [], rootNodeIds: [title], blockedNodeIds: [], reviewNodeIds: [], currentGoalId: null,
    recentDecisions: [], warnings: [], eventsCount: 2 };
}
beforeEach(() => { vi.clearAllMocks(); });

it('keeps an empty header task scope available and surfaces a failed read', async () => {
  const snapshot = { ...ledger('Task A'), nodes: [], sessionLinks: [], rootNodeIds: [] };
  host.snapshot.mockResolvedValue({ success: true, snapshot });
  const view = render(<MemoryRouter><TaskLedgerSummaryPanel workspaceId="workspace-a" session={sessions[0]} mode="bar" hideWhenEmpty /></MemoryRouter>);
  await waitFor(() => expect(host.snapshot).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId('session-task-container')).toHaveAttribute('data-state', 'empty'));
  host.snapshot.mockRejectedValue(new Error('Snapshot unavailable'));
  view.rerender(<MemoryRouter><TaskLedgerSummaryPanel workspaceId="workspace-a" session={sessions[0]} mode="bar" hideWhenEmpty refreshKey="retry" /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('session-task-container')).toHaveAttribute('data-state', 'unavailable'));
});

it('keeps an empty non-header task view hidden when requested', async () => {
  host.snapshot.mockResolvedValue({ success: true, snapshot: { ...ledger('Task A'), nodes: [], sessionLinks: [], rootNodeIds: [] } });
  const view = render(<MemoryRouter><TaskLedgerSummaryPanel workspaceId="workspace-a" session={sessions[0]} hideWhenEmpty /></MemoryRouter>);
  await waitFor(() => expect(host.snapshot).toHaveBeenCalled());
  await act(async () => { await host.snapshot.mock.results[0].value; });
  expect(view.container).toBeEmptyDOMElement();
});

describe('family navigation', () => {
  it('explicitly expands newly loaded children while retaining the order of other roots', () => {
    const renderTree = (loaded: boolean) => <SessionFolderTree workspace={workspace} currentSessionKey="parent"
      sessions={[{ session: sessions[0], activityMs: 3 }, { session: { key: 'other', displayName: 'Other' }, activityMs: 2 },
        ...(loaded ? [{ session: sessions[1], activityMs: 4 }] : [])]}
      collapsedFolders={{}} sessionStatusKinds={{}} sessionSort="newest" {...actions}
      renderSessionRow={entry => <button data-order-key={entry.session.key}>{entry.session.displayName}</button>} />;
    const view = render(renderTree(false));
    fireEvent.pointerEnter(view.container.querySelector('.ws-tree')!);
    view.rerender(renderTree(true));
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
    const toggle = screen.getByTestId('session-family-toggle-parent');
    fireEvent.keyDown(toggle, { key: 'ArrowRight' });
    expect(screen.getByText('Child')).toBeVisible();
    expect(Array.from(view.container.querySelectorAll('[data-order-key]')).map(row => row.getAttribute('data-order-key')))
      .toEqual(['parent', 'child', 'other']);
    fireEvent.keyDown(screen.getByTestId('session-family-toggle-parent'), { key: 'ArrowLeft' });
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
  });
  it('keeps interacted rows ordered while live status and child counts update', () => {
    const entries=[sessions[0],{key:'older',displayName:'Older',parentSessionKey:'parent'},sessions[1]];
    const renderTree=(updated=false)=><SessionFolderTree workspace={workspace} currentSessionKey="parent"
      sessions={[...entries,...(updated?[{key:'new',displayName:'New',parentSessionKey:'parent'}]:[])].map((session,index)=>({session,
        activityMs:updated&&session.key==='older'?10:index}))} collapsedFolders={{}} sessionStatusKinds={updated?{older:'error'}:{}}
      sessionSort="newest" {...actions} renderSessionRow={entry=><button data-order-key={entry.session.key}>
        {entry.session.displayName}{updated&&entry.session.key==='older'?':error':''}</button>}/>;
    const view=render(renderTree());fireEvent.click(screen.getByTestId('session-family-toggle-parent'));
    const treeNode=view.container.querySelector('.ws-tree')!;
    const order=()=>Array.from(treeNode.querySelectorAll('[data-order-key]')).map(row=>row.getAttribute('data-order-key'));
    const before=order();fireEvent.pointerEnter(treeNode);
    // Focus may leave the disclosure while the pointer still targets a child.
    fireEvent.blur(screen.getByTestId('session-family-toggle-parent'),{relatedTarget:document.body});
    view.rerender(renderTree(true));
    expect(order()).toEqual(before);expect(screen.getByText('Older:error')).toBeVisible();
    expect(screen.getByTestId('session-family-toggle-parent')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('sidebar-session-family-parent').querySelector('.session-family__count')).toHaveTextContent('3');
    expect(screen.queryByText('New')).not.toBeInTheDocument();
    fireEvent.pointerLeave(treeNode,{relatedTarget:null});
    fireEvent.blur(screen.getByTestId('session-family-toggle-parent'),{relatedTarget:null});
    expect(order()).toEqual(before);expect(screen.queryByText('New')).not.toBeInTheDocument();
    fireEvent.pointerMove(document.body);expect(screen.getByText('New')).toBeVisible();
    expect(order()).not.toEqual(before);
  });
  it('uses keyboard disclosure without moving or selecting sessions', () => {
    render(tree());
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
    const toggle = screen.getByTestId('session-family-toggle-parent');
    fireEvent.keyDown(toggle, { key: 'ArrowRight' });
    expect(screen.getByText('Child')).toBeVisible();
    expect(screen.getByTestId('sidebar-session-family-parent').querySelector('.session-family__count')).toHaveTextContent('1');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(toggle, { key: 'ArrowLeft' });
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar-session-family-parent').querySelector('.session-family__count')).toHaveTextContent('1');
    expect(actions.onDropSession).not.toHaveBeenCalled();
  });
  it('reveals a selected child and leaves an explicit collapse intact on later renders', async () => {
    const view = render(tree('child'));
    await waitFor(() => expect(screen.getByText('Child')).toBeVisible());
    fireEvent.click(screen.getByTestId('session-family-toggle-parent'));
    view.rerender(tree('child'));
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
  });
  it('navigates to the real spawn parent and exposes unloaded sources separately', () => {
    const navigate = vi.fn(); const refresh = vi.fn();
    const view = render(<SessionFamilyNavigation session={sessions[1]} sessions={sessions} onNavigate={navigate} onRefresh={refresh} />);
    fireEvent.click(screen.getByTestId('session-family-source'));
    expect(navigate).toHaveBeenCalledWith('parent');
    view.rerender(<SessionFamilyNavigation session={sessions[1]} sessions={[sessions[1]]} onNavigate={navigate} onRefresh={refresh} />);
    fireEvent.click(screen.getByTestId('session-family-source-unloaded'));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByTestId('session-family-source-unloaded')).toHaveTextContent('sessionFamily.unloaded');
  });
  it('keeps every actual parent in a multi-generation relation view', () => {
    const navigate = vi.fn();
    const family = [...sessions, { key: 'grandchild', displayName: 'Grandchild', parentSessionKey: 'child' }];
    render(<SessionFamilyNavigation session={family[2]} sessions={family} onNavigate={navigate} onRefresh={vi.fn()} />);
    const relations = screen.getByTestId('session-family-relations');
    expect(relations.querySelectorAll('li')).toHaveLength(2);
    expect(relations).toHaveTextContent('Grandchild');
    expect(relations).toHaveTextContent('Child');
    expect(relations).toHaveTextContent('Parent');
    fireEvent.click(relations.querySelector('button[title="parent"]')!);
    expect(navigate).toHaveBeenCalledWith('parent');
  });
});

it('does not show a late Task Ledger response from another project', async () => {
  let resolveFirst!: (result: unknown) => void;
  host.snapshot.mockImplementation(({ workspaceId }: { workspaceId: string }) => workspaceId === 'workspace-a'
    ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve({ success: true, snapshot: ledger('Task B') }));
  const view = render(<MemoryRouter><TaskLedgerSummaryPanel workspaceId="workspace-a" session={sessions[0]} mode="bar" /></MemoryRouter>);
  view.rerender(<MemoryRouter><TaskLedgerSummaryPanel workspaceId="workspace-b" session={sessions[0]} mode="bar" /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('session-task-container')).toHaveAttribute('data-state', 'ready'));
  fireEvent.click(screen.getByTestId('session-tasks-toggle'));
  // The scope list is an anchored popover, shown once it is measured.
  await waitFor(() => expect(screen.getByText('Task B')).toBeVisible());
  await act(async () => { resolveFirst({ success: true, snapshot: ledger('Task A') }); });
  expect(screen.queryByText('Task A')).not.toBeInTheDocument();
  expect(screen.getByTestId('session-task-ledger-open')).toHaveAttribute('href', '/task-ledger?workspaceId=workspace-b&sessionKey=parent');
});

it('does not carry task selection busy state into a different session scope', async () => {
  let finish!: (value: unknown) => void;
  host.selectSessionTask.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  host.snapshot.mockImplementation(async ({ workspaceId }: { workspaceId: string }) => ({ snapshot: ledger(workspaceId === 'workspace-a' ? 'Task A' : 'Task B') }));
  const view = render(<MemoryRouter><TaskLedgerSummaryPanel workspaceId="workspace-a" session={sessions[0]} mode="bar" /></MemoryRouter>);
  fireEvent.click(screen.getByTestId('session-tasks-toggle'));
  const taskA = await screen.findByTestId('session-task-select-Task A');
  fireEvent.click(taskA);
  expect(taskA).toBeDisabled();
  view.rerender(<MemoryRouter><TaskLedgerSummaryPanel workspaceId="workspace-b" session={sessions[0]} mode="bar" /></MemoryRouter>);
  expect(await screen.findByTestId('session-task-select-Task B')).not.toBeDisabled();
  await act(async () => { finish({ success: true }); });
  expect(screen.getByTestId('session-task-select-Task B')).not.toBeDisabled();
});
