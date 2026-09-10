/**
 * Session workstreams — the sidebar's session grouping surface.
 *
 * Design: docs/dev/session-workstreams-design.md. Workgroups are scoped to the
 * current project and rendered as one flat level. Unfiled sessions remain a
 * simple activity-sorted list; parentSessionKey never creates a second visual
 * tree inside a workgroup.
 *
 * The move menu files a session in one step, including "create a NEW stream
 * and file it there" from the same panel. It portals to <body> because the
 * sidebar scroller clips absolutely-positioned popovers.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  FolderPlus,
  FolderInput,
  Pencil,
  Plus,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { SidebarRow } from './SidebarRow';
import type { SessionFolder, WorkspaceProfile } from '@shared/types/workspace';
import {
  buildSidebarWorkspaceFolderGroups,
  workstreamColorIndex,
  type FlatWorkstream,
  type SidebarSessionEntry,
  type SidebarSessionSort,
} from './session-buckets';

type SidebarSessionStatusKind = 'running' | 'waiting' | 'completed' | 'error' | 'aborted';
type WorkgroupStatusKind = 'running' | 'waiting' | 'attention' | 'done' | 'stopped' | 'idle';
type RenderSessionRowOptions = {
  leadingActions?: React.ReactNode;
  forceActionsVisible?: boolean;
};

/** Fixed width so the portalled move menu can be flipped inside the viewport. */
const MOVE_MENU_WIDTH = 200;

/**
 * Workstream accent palette — 8 hues picked to sit quietly on both themes
 * (mid lightness, restrained chroma). Index comes from workstreamColorIndex,
 * so a stream keeps its color across sessions and machines.
 */
const WS_PALETTE = [
  '#8B7CF6', // violet
  '#2FB8A6', // teal
  '#D9A03F', // amber
  '#E0688C', // rose
  '#4FA8E0', // sky
  '#4CB782', // emerald
  '#98A1B3', // slate
  '#E07856', // coral
] as const;

function workstreamAccent(folderId: string): string {
  return WS_PALETTE[workstreamColorIndex(folderId)];
}

function getWorkgroupStatus(
  sessionKeys: string[],
  sessionStatusKinds: Record<string, SidebarSessionStatusKind | undefined>,
): WorkgroupStatusKind {
  if (sessionKeys.length === 0) return 'idle';
  const kinds = sessionKeys.map((key) => sessionStatusKinds[key]).filter(Boolean);
  if (kinds.includes('error')) return 'attention';
  if (kinds.includes('waiting')) return 'waiting';
  if (kinds.includes('running')) return 'running';
  if (kinds.length === sessionKeys.length && kinds.every((kind) => kind === 'completed')) return 'done';
  if (kinds.includes('aborted')) return 'stopped';
  return 'idle';
}


/** Session entry enriched with its row so group status and rendering share one list. */
type RenderedSessionRow = { entry: SidebarSessionEntry; rendered: React.ReactNode };

interface WorkstreamSectionProps {
  stream: FlatWorkstream;
  rows: RenderedSessionRow[];
  collapsed: boolean;
  sessionStatusKinds: Record<string, SidebarSessionStatusKind | undefined>;
  onToggleFolder: (folderId: string) => void;
  /**
   * Stream mutations are dispatched BY ID rather than as pre-bound closures —
   * the flat view keeps the invariant that made nested renames land on the
   * right node (the audit's F2), and the regression tests still hold it.
   */
  onRenameFolder: (folderId: string, name: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
}

function WorkstreamSection({
  stream,
  rows,
  collapsed,
  sessionStatusKinds,
  onToggleFolder,
  onRenameFolder,
  onDeleteFolder,
}: WorkstreamSectionProps) {
  const { t } = useTranslation(['chat', 'common']);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(stream.node.folder.name);
  const folder = stream.node.folder;
  const accent = workstreamAccent(folder.id);

  const submitRename = async () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === folder.name) {
      setIsEditing(false);
      return;
    }
    try {
      await onRenameFolder(folder.id, trimmed);
      setIsEditing(false);
    } catch {
      // keep editing on failure
    }
  };

  const memberKeys = useMemo(() => rows.map((row) => row.entry.session.key), [rows]);
  const workgroupStatus = useMemo(
    () => getWorkgroupStatus(memberKeys, sessionStatusKinds),
    [memberKeys, sessionStatusKinds],
  );
  const workgroupStatusLabel = t(`chat:workgroups.status.${workgroupStatus}`);

  return (
    <div
      className="ws-stream"
      data-testid={`sidebar-folder-${folder.id}`}
      style={{ '--ws-accent': accent } as React.CSSProperties}
    >
      {isEditing ? (
        <div className="ws-rename-row">
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void submitRename(); }
              if (e.key === 'Escape') { setIsEditing(false); setDraftName(folder.name); }
            }}
            onBlur={() => void submitRename()}
            className="h-6 min-w-0 flex-1 text-meta"
          />
          <button
            aria-label={t('common:actions.save')}
            onMouseDown={(e) => { e.preventDefault(); void submitRename(); }}
            className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            aria-label={t('common:actions.cancel')}
            onMouseDown={(e) => { e.preventDefault(); setIsEditing(false); setDraftName(folder.name); }}
            className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        /* Bare wrapper kept for the hover-reveal CSS contract:
           `[data-testid^='sidebar-folder-']:hover > div > .sidebar-row:first-child`. */
        <div>
          <SidebarRow
            className="folder-row-wrap"
            actionsClassName="task-hover-actions"
          actions={(
            <>
              <button
                type="button"
                aria-label={t('chat:workgroups.rename')}
                onClick={(e) => {
                  e.stopPropagation();
                  setDraftName(folder.name);
                  setIsEditing(true);
                }}
                className="task-hover-btn"
              >
                <Pencil />
              </button>
              <button
                type="button"
                data-testid={`sidebar-folder-delete-${folder.id}`}
                aria-label={t('chat:workgroups.delete')}
                onClick={(e) => {
                  e.stopPropagation();
                  void onDeleteFolder(folder.id);
                }}
                className="task-hover-btn hover:!text-destructive"
              >
                <Trash2 />
              </button>
            </>
          )}
        >
          <button
            type="button"
            data-testid={`sidebar-folder-toggle-${folder.id}`}
            aria-expanded={!collapsed}
            onClick={() => onToggleFolder(folder.id)}
            className="ws-label-select"
          >
            {/* A LABEL, not a node: no leading glyph, flush with the section
                heading above it. The row itself is the toggle, the same way the
                "Sessions" heading works, so nothing has to sit left of the text
                and push every session further right than its own group. */}
            <span className="ws-name min-w-0 truncate">{folder.name}</span>
            {/* Trailing slot shares the right edge with the absolutely
                positioned hover controls, so it yields to them. The count only
                answers "what am I hiding?" — with the group open its members are
                right there, so it would be restating the obvious. */}
            <span className="ws-trailing">
              {collapsed && memberKeys.length > 0 && (
                <span
                  data-testid={`sidebar-workgroup-count-${folder.id}`}
                  /* One mark, two facts. The aggregate state used to be a second
                     dot beside the count; a shut group is the only place that
                     state is not already visible on the sessions themselves, so
                     it rides the count as a tint rather than adding a glyph. */
                  data-status={workgroupStatus}
                  aria-label={`${t('chat:workgroups.sessionCount', { count: memberKeys.length })} · ${workgroupStatusLabel}`}
                  className="ws-count"
                >
                  {memberKeys.length}
                </span>
              )}
            </span>
          </button>
          </SidebarRow>
        </div>
      )}
      {rows.length > 0 && (
        /* Members stay mounted and fold via grid-rows so the collapse can
           animate; `aria-hidden` keeps a collapsed stream out of the
           accessibility tree the way the workspace group does. */
        <div className={cn('ws-members-outer', !collapsed && 'open')} aria-hidden={collapsed}>
          <div className="ws-members">
            {rows.map((row) => row.rendered)}
          </div>
        </div>
      )}
    </div>
  );
}

interface SessionFolderTreeMemoProps {
  workspace: WorkspaceProfile;
  sessions: SidebarSessionEntry[];
  collapsedFolders: Record<string, boolean>;
  sessionStatusKinds: Record<string, SidebarSessionStatusKind | undefined>;
  sessionSort: SidebarSessionSort;
  onToggleFolder: (folderId: string) => void;
  /** Returns the created folder when the host provides it — the move menu's
   *  one-step "create stream and file here" flow needs the new id. */
  onCreateFolder: (workspaceId: string, name: string, parentId: string | null) => Promise<SessionFolder | null | void>;
  onRenameFolder: (workspaceId: string, folderId: string, name: string) => Promise<void>;
  onDeleteFolder: (workspaceId: string, folderId: string) => Promise<void>;
  onMoveSession: (workspaceId: string, sessionKey: string, folderId: string | null) => Promise<void>;
  /** Drop a dragged session after another session to auto-group them. */
  onDropSession: (workspaceId: string, sourceSessionKey: string, targetSessionKey: string, autoGroupName: string) => Promise<void>;
  renderSessionRow: (entry: SidebarSessionEntry, options?: RenderSessionRowOptions) => React.ReactNode;
}

function SessionFolderTreeInner({
  workspace,
  sessions,
  collapsedFolders,
  sessionStatusKinds,
  sessionSort,
  onToggleFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveSession,
  onDropSession,
  renderSessionRow,
}: SessionFolderTreeMemoProps) {
  const { t } = useTranslation(['chat', 'common']);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [moveMenu, setMoveMenu] = useState<{ sessionKey: string; top: number; left: number } | null>(null);
  const [menuStreamDraft, setMenuStreamDraft] = useState<string | null>(null);
  const [draggedSessionKey, setDraggedSessionKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  /**
   * `dragOver` can fire in the same native gesture before React has committed
   * the drag-start state update. The ref keeps the active drag key available
   * synchronously, while the state copy only drives the visual classes.
   */
  const draggedSessionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!moveMenu) return;
    const close = (event: PointerEvent) => {
      if ((event.target as Element).closest?.('.sidebar-session-move-menu,.sidebar-session-move-trigger')) return;
      setMoveMenu(null);
      setMenuStreamDraft(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoveMenu(null);
        setMenuStreamDraft(null);
      }
    };
    addEventListener('pointerdown', close);
    addEventListener('keydown', escape);
    return () => {
      removeEventListener('pointerdown', close);
      removeEventListener('keydown', escape);
    };
  }, [moveMenu]);

  const groups = useMemo(() => buildSidebarWorkspaceFolderGroups({
    sessions,
    folders: workspace.sessionFolders ?? [],
    assignments: workspace.sessionFolderAssignments ?? {},
    sort: sessionSort,
  }), [sessions, sessionSort, workspace.sessionFolders, workspace.sessionFolderAssignments]);

  /** The bucket helper normalizes every folder to the project root. */
  const streams = useMemo<FlatWorkstream[]>(() => groups.folders.map((node) => ({
    node,
    pathPrefix: [],
  })), [groups.folders]);

  const sessionNameByKey = useMemo(() => new Map(
    sessions.map((entry) => [
      entry.session.key,
      entry.session.displayName || entry.session.derivedTitle || entry.session.label || entry.session.key,
    ]),
  ), [sessions]);

  const getAutoGroupName = useCallback((targetSessionKey: string) => {
    const targetName = sessionNameByKey.get(targetSessionKey) ?? targetSessionKey;
    return t('chat:workgroups.autoGroupName', { name: targetName });
  }, [sessionNameByKey, t]);

  const handleDropSession = useCallback(async (sourceSessionKey: string, targetSessionKey: string) => {
    if (!sourceSessionKey || !targetSessionKey || sourceSessionKey === targetSessionKey) return;
    try {
      await onDropSession(workspace.id, sourceSessionKey, targetSessionKey, getAutoGroupName(targetSessionKey));
    } catch (error) {
      console.error('Failed to group session by drag and drop:', error);
    }
  }, [getAutoGroupName, onDropSession, workspace.id]);

  const submitCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setCreatingFolder(false);
      return;
    }
    try {
      await onCreateFolder(workspace.id, trimmed, null);
      setNewFolderName('');
      setCreatingFolder(false);
    } catch {
      // keep editing on failure
    }
  };

  const handleRenameFolder = useCallback(async (folderId: string, name: string) => {
    await onRenameFolder(workspace.id, folderId, name);
  }, [onRenameFolder, workspace.id]);

  const handleDeleteFolder = useCallback(async (folderId: string) => {
    await onDeleteFolder(workspace.id, folderId);
  }, [onDeleteFolder, workspace.id]);

  const handleMoveSession = useCallback(async (sessionKey: string, folderId: string | null) => {
    setMoveMenu(null);
    setMenuStreamDraft(null);
    await onMoveSession(workspace.id, sessionKey, folderId);
  }, [onMoveSession, workspace.id]);

  /** One step: create the stream, then file the session into it. */
  const handleCreateStreamAndMove = useCallback(async (sessionKey: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const folder = await onCreateFolder(workspace.id, trimmed, null);
    if (folder && typeof folder === 'object' && 'id' in folder) {
      await handleMoveSession(sessionKey, folder.id);
    } else {
      setMoveMenu(null);
      setMenuStreamDraft(null);
    }
  }, [handleMoveSession, onCreateFolder, workspace.id]);

  /**
   * Session rows render the move affordance at EVERY depth, not just at the
   * workspace root — a session filed into a workstream must keep its way out.
   * The same wrapper is the HTML5 drag handle: drop a session onto another
   * session row and both are filed into the same workgroup. The menu portals
   * to `document.body`: `.project-tasks` carries `overflow: hidden` for the
   * collapse animation, which would clip it.
   */
  const renderSessionWithMoveMenu = useCallback((entry: SidebarSessionEntry) => {
    const sessionKey = entry.session.key;
    const isMenuOpen = moveMenu?.sessionKey === sessionKey;
    const isDragging = draggedSessionKey === sessionKey;
    const isDropTarget = dropTargetKey === sessionKey;
    const moveAction = (
      <button
        type="button"
        data-testid={`sidebar-session-move-${sessionKey}`}
        aria-label={t('chat:workgroups.moveTo')}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        className="sidebar-session-move-trigger flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (isMenuOpen) {
            setMoveMenu(null);
            setMenuStreamDraft(null);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          // Estimate the panel height (rows are ~24px + separator + footer) and
          // flip ABOVE the trigger when the space below cannot fit it — a
          // bottom-of-sidebar session must still reach the whole menu.
          const estimatedHeight = Math.min(
            window.innerHeight - 16,
            10 + ((workspace.sessionFolders?.length ?? 0) + 2) * 24 + 34,
          );
          const fitsBelow = rect.bottom + 4 + estimatedHeight <= window.innerHeight - 8;
          setMoveMenu({
            sessionKey,
            top: fitsBelow
              ? rect.bottom + 4
              : Math.max(8, rect.top - 4 - estimatedHeight),
            left: Math.min(window.innerWidth - MOVE_MENU_WIDTH - 8, Math.max(8, rect.right - MOVE_MENU_WIDTH)),
          });
        }}
      >
        <FolderInput className="h-3.5 w-3.5" />
      </button>
    );

    const readDraggedSessionKey = (event: React.DragEvent<HTMLDivElement>): string | null => {
      if (draggedSessionKeyRef.current) return draggedSessionKeyRef.current;
      if (draggedSessionKey) return draggedSessionKey;
      const raw = event.dataTransfer.getData('application/x-verse-sidebar-session');
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { workspaceId?: string; sessionKey?: string };
          if (parsed.workspaceId === workspace.id && parsed.sessionKey) return parsed.sessionKey;
        } catch {
          // fall through to the plain-text payload
        }
      }
      const plain = event.dataTransfer.getData('text/plain');
      return plain || null;
    };

    return (
      <div
        key={sessionKey}
        data-testid={`sidebar-session-drag-${sessionKey}`}
        data-session-key={sessionKey}
        className={cn(
          'relative',
          isDragging && 'ws-drag-source',
          isDropTarget && 'ws-drop-target',
        )}
        title={isDropTarget ? t('chat:workgroups.dropHint') : undefined}
        draggable
        onDragStart={(event) => {
          // Close the move menu before the browser captures the ghost image.
          setMoveMenu(null);
          setMenuStreamDraft(null);
          draggedSessionKeyRef.current = sessionKey;
          setDraggedSessionKey(sessionKey);
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(
            'application/x-verse-sidebar-session',
            JSON.stringify({ workspaceId: workspace.id, sessionKey }),
          );
          event.dataTransfer.setData('text/plain', sessionKey);
        }}
        onDragEnd={() => {
          draggedSessionKeyRef.current = null;
          setDraggedSessionKey(null);
          setDropTargetKey(null);
        }}
        onDragOver={(event) => {
          // Only local, same-workspace drops are meaningful: grouping is a
          // workspace-internal filing operation.
          if (!draggedSessionKeyRef.current || draggedSessionKeyRef.current === sessionKey) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          setDropTargetKey((current) => (current === sessionKey ? current : sessionKey));
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropTargetKey((current) => (current === sessionKey ? null : current));
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const sourceSessionKey = readDraggedSessionKey(event);
          draggedSessionKeyRef.current = null;
          setDraggedSessionKey(null);
          setDropTargetKey(null);
          if (sourceSessionKey && sourceSessionKey !== sessionKey) {
            void handleDropSession(sourceSessionKey, sessionKey);
          }
        }}
      >
        {isDropTarget && (
          <span
            className="ws-drop-guide"
            data-testid={`sidebar-session-drop-guide-${sessionKey}`}
            aria-hidden="true"
          />
        )}
        {renderSessionRow(entry, {
          leadingActions: moveAction,
          forceActionsVisible: isMenuOpen,
        })}
      </div>
    );
  }, [
    draggedSessionKey,
    dropTargetKey,
    handleDropSession,
    moveMenu,
    renderSessionRow,
    t,
    workspace.id,
    workspace.sessionFolders,
  ]);

  const toRenderedRows = useCallback((entries: SidebarSessionEntry[]): RenderedSessionRow[] => (
    entries.map((entry) => ({
      entry,
      rendered: renderSessionWithMoveMenu(entry),
    }))
  ), [renderSessionWithMoveMenu]);

  const currentAssignment = moveMenu ? workspace.sessionFolderAssignments?.[moveMenu.sessionKey] : undefined;
  const menuFolders = useMemo(() => (
    [...(workspace.sessionFolders ?? [])].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  ), [workspace.sessionFolders]);

  return (
    /* Not `space-y-0.5`: the base sidebar rule neutralizes that utility by
       forcing `margin-bottom: 0` on every sibling after the first, which silently
       ate the whitespace rhythm that now carries grouping. Spacing is owned by
       `.ws-stream` / `.ws-time-slice` in codex-sidebar.css instead. */
    <div className="ws-tree">
      {streams.map((stream) => (
        <WorkstreamSection
          key={stream.node.folder.id}
          stream={stream}
          rows={toRenderedRows(stream.node.sessions)}
          collapsed={collapsedFolders[stream.node.folder.id] ?? false}
          sessionStatusKinds={sessionStatusKinds}
          onToggleFolder={onToggleFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
        />
      ))}
      {groups.rootSessions.length > 0 && streams.length > 0 && (
        <div
          data-testid={`sidebar-workgroup-ungrouped-${workspace.id}`}
          /* A PEER of the group labels, not their container: same left edge, same
             size, same dimness. It used to sit 24px right of the time slices it
             introduces — the indent claimed it was their child while the count
             claimed it was their parent. Now the edge says "sibling of the
             groups" and the time slices below it are visibly quieter. */
          className="ws-unfiled-label"
        >
          <span>{t('chat:workgroups.ungrouped')}</span>
        </div>
      )}
      {/* Root sessions already arrive activity-sorted from the bucket helper.
          Keep them as direct rows: no date headings and no second-level lineage. */}
      {groups.rootSessions.map((entry) => renderSessionWithMoveMenu(entry))}
      {moveMenu && createPortal(
        <div
          role="menu"
          data-testid={`sidebar-session-move-menu-${moveMenu.sessionKey}`}
          className="sidebar-session-move-menu fixed z-50 overflow-y-auto rounded-md border border-black/10 bg-surface-modal py-1 shadow-md dark:border-white/10"
          style={{ top: moveMenu.top, left: moveMenu.left, width: MOVE_MENU_WIDTH, maxHeight: 'calc(100vh - 16px)' }}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="sidebar-session-move-none"
            onClick={() => void handleMoveSession(moveMenu.sessionKey, null)}
            className={cn(
              'flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs hover:bg-black/5 dark:hover:bg-white/10',
              !currentAssignment && 'font-medium text-foreground',
            )}
          >
            <span className="size-1.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('chat:workgroups.noWorkgroup')}</span>
            {!currentAssignment && <Check className="size-3 shrink-0 text-muted-foreground" />}
          </button>
          {menuFolders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              role="menuitem"
              data-testid={`sidebar-session-move-to-${folder.id}`}
              onClick={() => void handleMoveSession(moveMenu.sessionKey, folder.id)}
              className={cn(
                'flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs hover:bg-black/5 dark:hover:bg-white/10',
                currentAssignment === folder.id && 'font-medium text-foreground',
              )}
              style={{ '--ws-accent': workstreamAccent(folder.id) } as React.CSSProperties}
            >
              <span className="ws-menu-dot" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              {currentAssignment === folder.id && <Check className="size-3 shrink-0 text-muted-foreground" />}
            </button>
          ))}
          <div className="mx-2 my-1 border-t border-black/10 dark:border-white/10" />
          {menuStreamDraft == null ? (
            <button
              type="button"
              role="menuitem"
              data-testid="sidebar-stream-new-inline"
              onClick={() => setMenuStreamDraft('')}
              className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            >
              <Plus className="size-3 shrink-0" />
              <span className="min-w-0 truncate">{t('chat:workgroups.newStream')}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 px-2 py-1">
              <Input
                autoFocus
                value={menuStreamDraft}
                placeholder={t('chat:workgroups.namePlaceholder')}
                onChange={(e) => setMenuStreamDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreateStreamAndMove(moveMenu.sessionKey, menuStreamDraft);
                  }
                  if (e.key === 'Escape') setMenuStreamDraft(null);
                }}
                data-testid="sidebar-stream-new-input"
                className="h-6 min-w-0 flex-1 text-2xs"
              />
              <button
                aria-label={t('common:actions.save')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void handleCreateStreamAndMove(moveMenu.sessionKey, menuStreamDraft);
                }}
                className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <Check className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
      {creatingFolder ? (
        <div className="flex items-center gap-1 px-1.5 py-1">
          <FolderPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={newFolderName}
            placeholder={t('chat:workgroups.namePlaceholder')}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void submitCreateFolder(); }
              if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); }
            }}
            onBlur={() => void submitCreateFolder()}
            className="h-6 min-w-0 flex-1 text-meta"
          />
          <button
            aria-label={t('common:actions.save')}
            onMouseDown={(e) => { e.preventDefault(); void submitCreateFolder(); }}
            className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            aria-label={t('common:actions.cancel')}
            onMouseDown={(e) => { e.preventDefault(); setCreatingFolder(false); setNewFolderName(''); }}
            className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          data-testid={`sidebar-folder-create-${workspace.id}`}
          onClick={() => setCreatingFolder(true)}
          /* Management affordance, not list content: it stays in the DOM for
             keyboard reach but only paints once the workspace group is hovered,
             so the resting list is as quiet as the reference. */
          className={cn(
            'sidebar-create-workgroup',
            'flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors',
            'text-2xs text-muted-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
          )}
        >
          <FolderPlus className="h-3 w-3 shrink-0" />
          {t('chat:workgroups.create')}
        </button>
      )}
    </div>
  );
}

export const SessionFolderTree = memo(SessionFolderTreeInner);
