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
    t: (key: string, params?: Record<string, unknown> | string) => {
      if (typeof params === 'string') return params;
      if (params && typeof params === 'object' && typeof params.name === 'string') {
        return `${key}:${params.name}`;
      }
      return key;
    },
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
  sessions?: SidebarSessionEntry[];
  currentSessionKey?: string;
  onRenameFolder?: (workspaceId: string, folderId: string, name: string) => Promise<void>;
  onDeleteFolder?: (workspaceId: string, folderId: string) => Promise<void>;
  onDropSession?: (workspaceId: string, sourceSessionKey: string, targetSessionKey: string, autoGroupName: string) => Promise<void>;
}) {
  const { SessionFolderTree } = await import('@/components/layout/SessionFolderTree');
  const onRenameFolder = overrides?.onRenameFolder
    ?? vi.fn<(workspaceId: string, folderId: string, name: string) => Promise<void>>().mockResolvedValue(undefined);
  const onDeleteFolder = overrides?.onDeleteFolder
    ?? vi.fn<(workspaceId: string, folderId: string) => Promise<void>>().mockResolvedValue(undefined);
  const onDropSession = overrides?.onDropSession
    ?? vi.fn<(workspaceId: string, sourceSessionKey: string, targetSessionKey: string, autoGroupName: string) => Promise<void>>().mockResolvedValue(undefined);

  const view = render(
    <SessionFolderTree
      workspace={WORKSPACE}
      sessions={overrides?.sessions ?? SESSIONS}
      currentSessionKey={overrides?.currentSessionKey}
      collapsedFolders={{}}
      sessionSort="newest"
      sessionStatusKinds={{}}
      onToggleFolder={vi.fn()}
      onCreateFolder={vi.fn().mockResolvedValue(undefined)}
      onRenameFolder={onRenameFolder}
      onDeleteFolder={onDeleteFolder}
      onDropSession={onDropSession}
      renderSessionRow={(entry) => (
        <div key={entry.session.key} data-testid={`session-row-${entry.session.key}`}>
          {entry.session.displayName}
        </div>
      )}
    />,
  );

  return { ...view, onRenameFolder, onDeleteFolder, onDropSession };
}

describe('SessionFolderTree folder mutation dispatch', () => {
  it('discloses multiple children without duplicating them or filing them in a different group', async () => {
    const sessions = [
      { session: { key: 'parent', displayName: 'Parent' }, activityMs: 1 },
      { session: { key: 'child-a', displayName: 'Child A', parentSessionKey: 'parent' }, activityMs: 3 },
      { session: { key: 'child-b', displayName: 'Child B', parentSessionKey: 'parent' }, activityMs: 2 },
      { session: { key: 'agent:main:nested', displayName: 'Other group', parentSessionKey: 'parent' }, activityMs: 4 },
    ];
    await renderTree({ sessions, currentSessionKey: 'parent' });
    const toggle = screen.getByTestId('session-family-toggle-parent');
    expect(toggle).toHaveTextContent('2');
    expect(screen.queryByTestId('session-row-child-a')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getAllByTestId('session-row-child-a')).toHaveLength(1);
    expect(screen.getAllByTestId('session-row-child-b')).toHaveLength(1);
    expect(screen.getByTestId('sidebar-folder-grandchild-a2')).toContainElement(screen.getByTestId('session-row-agent:main:nested'));
    fireEvent.click(toggle);
    expect(screen.queryByTestId('session-row-child-a')).toBeNull();
  });

  it('reveals the selected child when its family initially mounts', async () => {
    await renderTree({ currentSessionKey: 'child', sessions: [
      { session: { key: 'parent', displayName: 'Parent' }, activityMs: 1 },
      { session: { key: 'child', displayName: 'Child', parentSessionKey: 'parent' }, activityMs: 2 },
    ] });
    expect(screen.getByTestId('session-family-toggle-parent')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('session-row-child')).toBeVisible();
  });
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
 * The audit's F3 (a session filed into a workgroup had no UI left to move it
 * back out) is now held one level up: every session row carries the same ⋯
 * menu, whose move page offers "no workgroup" — see
 * sidebar-session-context-menu.test.tsx. What the tree must guarantee is that
 * it renders every session, grouped or not, through the shared row renderer
 * and does not grow a second, competing move control of its own.
 */
describe('SessionFolderTree session rows', () => {
  it('renders grouped and ungrouped sessions through the shared row renderer', async () => {
    await renderTree();
    expect(screen.getByTestId('session-row-agent:main:nested')).toBeInTheDocument();
    expect(screen.getByTestId('session-row-agent:main:loose')).toBeInTheDocument();
  });

  it('adds no move control of its own next to the row', async () => {
    await renderTree();
    expect(screen.queryByTestId('sidebar-session-move-agent:main:nested')).toBeNull();
    expect(screen.queryByTestId('sidebar-session-move-agent:main:loose')).toBeNull();
    expect(document.querySelector('.sidebar-session-move-menu')).toBeNull();
  });

  it('marks the tree as grouped so filed sessions step in under their group label', async () => {
    const { container } = await renderTree();
    expect(container.querySelector('.ws-tree')).toHaveAttribute('data-has-groups', 'true');
  });
});

/**
 * Drag-and-drop auto-grouping: the wrapper is both the drag handle and the
 * drop target, and dropping one session after another dispatches a single
 * semantic group request with the generated group name.
 */
describe('SessionFolderTree drag-and-drop auto grouping', () => {
  function makeDataTransfer() {
    const store = new Map<string, string>();
    return {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
    };
  }

  it('shows the after-target guide line and dispatches the group request on drop', async () => {
    const { onDropSession } = await renderTree();
    const source = screen.getByTestId('sidebar-session-drag-agent:main:loose');
    const target = screen.getByTestId('sidebar-session-drag-agent:main:nested');
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });

    expect(screen.getByTestId('sidebar-session-drop-guide-agent:main:nested')).toBeInTheDocument();

    fireEvent.drop(target, { dataTransfer });

    await waitFor(() => expect(onDropSession).toHaveBeenCalledTimes(1));
    expect(onDropSession).toHaveBeenCalledWith(
      'ws-1',
      'agent:main:loose',
      'agent:main:nested',
      'chat:workgroups.autoGroupName:nested session',
    );
  });

  it('ignores dropping a session onto itself', async () => {
    const { onDropSession } = await renderTree();
    const row = screen.getByTestId('sidebar-session-drag-agent:main:loose');
    const dataTransfer = makeDataTransfer();

    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.dragOver(row, { dataTransfer });
    fireEvent.drop(row, { dataTransfer });

    await waitFor(() => expect(onDropSession).not.toHaveBeenCalled());
  });

  /**
   * Membership is carried by CONTAINMENT (and, in CSS, by the indent and
   * whitespace rhythm that follow from it) — not by a drawn connector.
   *
   * The rail and elbow connectors this used to assert were half-drawn: they
   * appeared beside some members and not others, which added speckle without
   * ever completing the figure. They are gone deliberately; the second half of
   * this test guards against a well-meaning reintroduction.
   */
  it('nests grouped members in the stream container and leaves ungrouped rows outside it', async () => {
    const { container } = await renderTree();
    const members = container.querySelector('.ws-members');

    expect(members).not.toBeNull();
    expect(members).toContainElement(screen.getByTestId('sidebar-session-drag-agent:main:nested'));
    expect(members).not.toContainElement(screen.getByTestId('sidebar-session-drag-agent:main:loose'));
  });

  it('draws no tree connectors', async () => {
    const { container } = await renderTree();
    expect(container.querySelector('.ws-member-slot')).toBeNull();
  });

  /** Group names are labels, not nodes: no leading glyph to push members right. */
  it('renders the group header as a label with no leading glyph', async () => {
    const { container } = await renderTree();
    const label = container.querySelector('.ws-label-select');

    expect(label).not.toBeNull();
    expect(label?.querySelector('svg')).toBeNull();
    expect(container.querySelector('.ws-dot')).toBeNull();
  });
});
