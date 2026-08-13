/**
 * SessionFolderTree — folder mutation dispatch.
 *
 * Regression guard for the audit's F2: `FolderRow` renders its children
 * recursively, so a rename/delete callback pre-bound to a node's own id used to
 * follow the subtree down and land on the ANCESTOR folder. Renaming a
 * grandchild renamed its grandparent; deleting one deleted the grandparent and
 * everything under it.
 *
 * These tests assert the dispatched folderId, not the UI copy — the id is what
 * reaches the host API and what made the old behaviour destructive.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SessionFolder, WorkspaceProfile } from '@shared/types/workspace';
import type { SidebarSessionEntry } from '@/components/layout/session-buckets';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown> | string) => (typeof params === 'string' ? params : key),
  }),
}));

function folder(id: string, name: string, parentId: string | null, order: number): SessionFolder {
  return { id, name, parentId, order, createdAt: 1000 + order, kind: 'workgroup' } as SessionFolder;
}

/** root-a → child-a1 → grandchild-a2, plus a flat sibling root-b. */
const FOLDERS: SessionFolder[] = [
  folder('root-a', 'Root A', null, 0),
  folder('child-a1', 'Child A1', 'root-a', 1),
  folder('grandchild-a2', 'Grandchild A2', 'child-a1', 2),
  folder('root-b', 'Root B', null, 3),
];

const WORKSPACE = {
  id: 'ws-1',
  name: 'repo',
  rootPath: '/repo',
  activeSessionKey: 'agent:main:main',
  sessionStates: {},
  sessionFolders: FOLDERS,
  sessionFolderAssignments: { 'agent:main:nested': 'grandchild-a2' },
} as unknown as WorkspaceProfile;

const SESSIONS: SidebarSessionEntry[] = [
  { session: { key: 'agent:main:nested', displayName: 'nested session' }, activityMs: 2000 },
  { session: { key: 'agent:main:loose', displayName: 'loose session' }, activityMs: 1000 },
] as SidebarSessionEntry[];

async function renderTree(overrides?: {
  onRenameFolder?: ReturnType<typeof vi.fn>;
  onDeleteFolder?: ReturnType<typeof vi.fn>;
  onMoveSession?: ReturnType<typeof vi.fn>;
}) {
  const { SessionFolderTree } = await import('@/components/layout/SessionFolderTree');
  const onRenameFolder = overrides?.onRenameFolder ?? vi.fn().mockResolvedValue(undefined);
  const onDeleteFolder = overrides?.onDeleteFolder ?? vi.fn().mockResolvedValue(undefined);
  const onMoveSession = overrides?.onMoveSession ?? vi.fn().mockResolvedValue(undefined);

  render(
    <SessionFolderTree
      workspace={WORKSPACE}
      sessions={SESSIONS}
      collapsedFolders={{}}
      sessionStatusKinds={{}}
      onToggleFolder={vi.fn()}
      onCreateFolder={vi.fn().mockResolvedValue(undefined)}
      onRenameFolder={onRenameFolder}
      onDeleteFolder={onDeleteFolder}
      onMoveSession={onMoveSession}
      renderSessionRow={(entry, options) => (
        <div key={entry.session.key} data-testid={`session-row-${entry.session.key}`}>
          {entry.session.displayName}
          {/* Mirrors SessionRowMemo: leading actions live in the row's action
              strip. Dropping them here would hide the move affordance the F3
              tests are about. */}
          {options?.leadingActions}
        </div>
      )}
    />,
  );

  return { onRenameFolder, onDeleteFolder, onMoveSession };
}

describe('SessionFolderTree folder mutation dispatch', () => {
  it('renders the full nesting depth', async () => {
    await renderTree();
    for (const id of ['root-a', 'child-a1', 'grandchild-a2', 'root-b']) {
      expect(screen.getByTestId(`sidebar-folder-${id}`)).toBeInTheDocument();
    }
  });

  it('deletes the grandchild folder, not its ancestor', async () => {
    const { onDeleteFolder } = await renderTree();

    fireEvent.click(screen.getByTestId('sidebar-folder-delete-grandchild-a2'));

    await waitFor(() => expect(onDeleteFolder).toHaveBeenCalledTimes(1));
    expect(onDeleteFolder).toHaveBeenCalledWith('ws-1', 'grandchild-a2');
    // The pre-fix behaviour dispatched the ancestor id here.
    expect(onDeleteFolder).not.toHaveBeenCalledWith('ws-1', 'root-a');
    expect(onDeleteFolder).not.toHaveBeenCalledWith('ws-1', 'child-a1');
  });

  it('deletes the mid-level folder with its own id', async () => {
    const { onDeleteFolder } = await renderTree();

    fireEvent.click(screen.getByTestId('sidebar-folder-delete-child-a1'));

    await waitFor(() => expect(onDeleteFolder).toHaveBeenCalledTimes(1));
    expect(onDeleteFolder).toHaveBeenCalledWith('ws-1', 'child-a1');
    expect(onDeleteFolder).not.toHaveBeenCalledWith('ws-1', 'root-a');
  });

  it('renames the grandchild folder, not its ancestor', async () => {
    const { onRenameFolder } = await renderTree();

    // The rename affordance is the pencil button inside the grandchild's row.
    const row = screen.getByTestId('sidebar-folder-grandchild-a2');
    const renameButton = row.querySelector<HTMLButtonElement>('button[aria-label="chat:workgroups.rename"]');
    expect(renameButton).not.toBeNull();
    fireEvent.click(renameButton!);

    const input = row.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: 'Renamed Grandchild' } });
    fireEvent.keyDown(input!, { key: 'Enter' });

    await waitFor(() => expect(onRenameFolder).toHaveBeenCalledTimes(1));
    expect(onRenameFolder).toHaveBeenCalledWith('ws-1', 'grandchild-a2', 'Renamed Grandchild');
    expect(onRenameFolder).not.toHaveBeenCalledWith('ws-1', 'root-a', expect.anything());
    expect(onRenameFolder).not.toHaveBeenCalledWith('ws-1', 'child-a1', expect.anything());
  });
});

/**
 * Regression guard for the audit's F3: the move menu used to be attached only
 * to `groups.rootSessions`, so a session dragged into a workgroup had no UI
 * left to move it back out — a one-way door.
 */
describe('SessionFolderTree session move affordance', () => {
  it('offers the move menu to a session nested inside a folder', async () => {
    await renderTree();
    expect(screen.getByTestId('sidebar-session-move-agent:main:nested')).toBeInTheDocument();
  });

  it('still offers it to an ungrouped session', async () => {
    await renderTree();
    expect(screen.getByTestId('sidebar-session-move-agent:main:loose')).toBeInTheDocument();
  });

  it('moves a nested session back out to the workspace root', async () => {
    const { onMoveSession } = await renderTree();

    fireEvent.click(screen.getByTestId('sidebar-session-move-agent:main:nested'));
    fireEvent.click(await screen.findByTestId('sidebar-session-move-none'));

    await waitFor(() => expect(onMoveSession).toHaveBeenCalledTimes(1));
    expect(onMoveSession).toHaveBeenCalledWith('ws-1', 'agent:main:nested', null);
  });

  it('moves a nested session into a sibling folder', async () => {
    const { onMoveSession } = await renderTree();

    fireEvent.click(screen.getByTestId('sidebar-session-move-agent:main:nested'));
    fireEvent.click(await screen.findByTestId('sidebar-session-move-to-root-b'));

    await waitFor(() => expect(onMoveSession).toHaveBeenCalledTimes(1));
    expect(onMoveSession).toHaveBeenCalledWith('ws-1', 'agent:main:nested', 'root-b');
  });

  it('portals the menu out of the clipped sidebar scroller', async () => {
    await renderTree();
    fireEvent.click(screen.getByTestId('sidebar-session-move-agent:main:nested'));

    const menu = await screen.findByTestId('sidebar-session-move-menu-agent:main:nested');
    // `.project-tasks` carries `overflow: hidden` for the collapse animation, so
    // an in-tree menu would be clipped. Portalling to <body> is what keeps a
    // deeply nested session's menu reachable.
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveClass('fixed');
  });
});
