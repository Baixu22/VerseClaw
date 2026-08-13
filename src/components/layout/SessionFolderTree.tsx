/**
 * Session workstreams — the sidebar's session grouping surface.
 *
 * Design: docs/dev/session-workstreams-design.md. Three orthogonal layers:
 *   1. Workstreams — folders rendered as ONE flat level, each with a stable
 *      accent color; a 2px member rail replaces the folder-tree grammar.
 *      Legacy nested folders flatten with a muted path prefix; the data model
 *      (sessionFolders / assignments) is untouched.
 *   2. Lineage — fork/handoff descendants attach beneath their origin session
 *      automatically (parentSessionKey is already on sessions.list): the
 *      "where did this exploration come from" answer costs zero filing.
 *   3. Time slices — unfiled sessions fall into today / this week / earlier.
 *
 * The move menu files a session in one step, including "create a NEW stream
 * and file it there" from the same panel. It portals to <body> because the
 * sidebar scroller clips absolutely-positioned popovers.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
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
  flattenFolderNodes,
  sliceSessionsByTime,
  threadSessionsByLineage,
  workstreamColorIndex,
  type FlatWorkstream,
  type LineageRow,
  type SidebarSessionEntry,
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

function workgroupStatusDot(status: WorkgroupStatusKind): string {
  if (status === 'attention') return 'bg-red-500';
  if (status === 'waiting') return 'bg-amber-500';
  if (status === 'running') return 'bg-blue-500';
  if (status === 'done') return 'bg-emerald-500';
  return 'bg-muted-foreground/50';
}

/** LineageRow enriched with the rendered session row (kept out of session-buckets — pure data there). */
type RenderedLineageRow = LineageRow & { rendered: React.ReactNode };

interface WorkstreamSectionProps {
  stream: FlatWorkstream;
  rows: RenderedLineageRow[];
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
  /** Origin display names for lineage tooltips, keyed by session key. */
  sessionNameByKey: Map<string, string>;
}

function WorkstreamSection({
  stream,
  rows,
  collapsed,
  sessionStatusKinds,
  onToggleFolder,
  onRenameFolder,
  onDeleteFolder,
  sessionNameByKey,
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
      className="space-y-0.5"
      data-testid={`sidebar-folder-${folder.id}`}
      style={{ '--ws-accent': accent } as React.CSSProperties}
    >
      {isEditing ? (
        <div className="flex items-center gap-1 px-1.5 py-1" style={{ paddingLeft: 8 }}>
          <span className="ws-dot" aria-hidden />
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
            className="task-select"
          >
            {rows.length > 0
              ? (
                /* One rotating chevron rather than two swapped glyphs — the
                   rotation animates, a glyph swap cannot. */
                <ChevronDown
                  className={cn('ws-chevron size-3 shrink-0', collapsed && 'is-collapsed')}
                  aria-hidden
                />
              )
              : <span className="size-3 shrink-0" />}
            <span className="ws-dot" data-testid={`sidebar-stream-dot-${folder.id}`} aria-hidden />
            {/* Legacy nested folders keep their ancestry visible: the NEAREST
                ancestor inline (the informative one), the full chain in the
                tooltip. The tree is gone, the provenance is not. */}
            {stream.pathPrefix.length > 0 && (
              <span
                className="ws-path-prefix min-w-0 truncate"
                data-testid={`sidebar-stream-path-${folder.id}`}
                title={[...stream.pathPrefix, folder.name].join(' ⧸ ')}
              >
                {stream.pathPrefix.length > 1 ? '… ⧸ ' : ''}{stream.pathPrefix[stream.pathPrefix.length - 1]}&thinsp;⧸
              </span>
            )}
            <span className="ws-name min-w-0 truncate">{folder.name}</span>
            <span
              data-testid={`sidebar-workgroup-status-${folder.id}`}
              title={workgroupStatusLabel}
              aria-label={workgroupStatusLabel}
              className="ws-status-slot flex shrink-0 items-center"
            >
              <span className={cn('size-1.5 shrink-0 rounded-full', workgroupStatusDot(workgroupStatus))} />
            </span>
            {memberKeys.length > 0 && (
              <span
                data-testid={`sidebar-workgroup-count-${folder.id}`}
                aria-label={t('chat:workgroups.sessionCount', { count: memberKeys.length })}
                className="ws-count shrink-0 text-xs text-[color:var(--cdx-text-4)]"
              >
                {memberKeys.length}
              </span>
            )}
          </button>
          </SidebarRow>
        </div>
      )}
      {rows.length > 0 && (
        /* Members stay mounted and fold via grid-rows so the collapse can
           animate; `aria-hidden` keeps a collapsed stream out of the
           accessibility tree the way the workspace group does. */
        <div className={cn('ws-members-outer', !collapsed && 'open')} aria-hidden={collapsed}>
          <div className="ws-members space-y-0.5">
            {rows.map((row) => {
              if (row.lineageDepth === 0) return row.rendered;
              const originName = row.originKey ? sessionNameByKey.get(row.originKey) : undefined;
              return (
                <div
                  key={`lineage-${row.entry.session.key}`}
                  className="ws-lineage-row"
                  data-testid={`sidebar-lineage-${row.entry.session.key}`}
                  title={originName ? t('chat:workgroups.origin', { name: originName }) : undefined}
                >
                  {row.rendered}
                </div>
              );
            })}
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
  onToggleFolder: (folderId: string) => void;
  /** Returns the created folder when the host provides it — the move menu's
   *  one-step "create stream and file here" flow needs the new id. */
  onCreateFolder: (workspaceId: string, name: string, parentId: string | null) => Promise<SessionFolder | null | void>;
  onRenameFolder: (workspaceId: string, folderId: string, name: string) => Promise<void>;
  onDeleteFolder: (workspaceId: string, folderId: string) => Promise<void>;
  onMoveSession: (workspaceId: string, sessionKey: string, folderId: string | null) => Promise<void>;
  renderSessionRow: (entry: SidebarSessionEntry, options?: RenderSessionRowOptions) => React.ReactNode;
}

function SessionFolderTreeInner({
  workspace,
  sessions,
  collapsedFolders,
  sessionStatusKinds,
  onToggleFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveSession,
  renderSessionRow,
}: SessionFolderTreeMemoProps) {
  const { t } = useTranslation(['chat', 'common']);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [moveMenu, setMoveMenu] = useState<{ sessionKey: string; top: number; left: number } | null>(null);
  const [menuStreamDraft, setMenuStreamDraft] = useState<string | null>(null);

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
  }), [sessions, workspace.sessionFolders, workspace.sessionFolderAssignments]);

  /** Legacy nested folders flatten to one level, parents adjacent to children. */
  const streams = useMemo(() => flattenFolderNodes(groups.folders), [groups.folders]);

  const sessionNameByKey = useMemo(() => new Map(
    sessions.map((entry) => [
      entry.session.key,
      entry.session.displayName || entry.session.derivedTitle || entry.session.label || entry.session.key,
    ]),
  ), [sessions]);

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
   * The menu portals to `document.body`: `.project-tasks` carries
   * `overflow: hidden` for the collapse animation, which would clip it.
   */
  const renderSessionWithMoveMenu = useCallback((entry: SidebarSessionEntry) => {
    const isMenuOpen = moveMenu?.sessionKey === entry.session.key;
    const moveAction = (
      <button
        type="button"
        data-testid={`sidebar-session-move-${entry.session.key}`}
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
            sessionKey: entry.session.key,
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
    return (
      <div key={entry.session.key} className="relative">
        {renderSessionRow(entry, {
          leadingActions: moveAction,
          forceActionsVisible: isMenuOpen,
        })}
      </div>
    );
  }, [moveMenu, renderSessionRow, t, workspace.sessionFolders]);

  const toRenderedRows = useCallback((entries: SidebarSessionEntry[]): RenderedLineageRow[] => (
    threadSessionsByLineage(entries).map((row) => ({
      ...row,
      rendered: renderSessionWithMoveMenu(row.entry),
    }))
  ), [renderSessionWithMoveMenu]);

  /* Unfiled sessions: lineage threads first (children ride with their origin),
   * then the top-level rows slice into today / this week / earlier. The clock
   * is sampled once per mount — slices don't need to tick, and render purity
   * forbids Date.now() inside the memo. */
  const [sliceNowMs] = useState(() => Date.now());
  const unfiledView = useMemo(() => {
    const threaded = threadSessionsByLineage(groups.rootSessions);
    const childrenByOrigin = new Map<string, LineageRow[]>();
    for (const row of threaded) {
      if (row.lineageDepth === 1 && row.originKey) {
        const list = childrenByOrigin.get(row.originKey) ?? [];
        list.push(row);
        childrenByOrigin.set(row.originKey, list);
      }
    }
    const topLevel = threaded.filter((row) => row.lineageDepth === 0).map((row) => row.entry);
    const slices = sliceSessionsByTime(topLevel, sliceNowMs);
    return { slices, childrenByOrigin };
  }, [groups.rootSessions, sliceNowMs]);

  const showSliceLabels = unfiledView.slices.length > 1
    || (unfiledView.slices.length === 1 && unfiledView.slices[0].key !== 'today');

  const currentAssignment = moveMenu ? workspace.sessionFolderAssignments?.[moveMenu.sessionKey] : undefined;
  const menuFolders = useMemo(() => (
    [...(workspace.sessionFolders ?? [])].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  ), [workspace.sessionFolders]);

  return (
    <div className="space-y-0.5">
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
          sessionNameByKey={sessionNameByKey}
        />
      ))}
      {groups.rootSessions.length > 0 && streams.length > 0 && (
        <div
          data-testid={`sidebar-workgroup-ungrouped-${workspace.id}`}
          /* Quiet divider label, matching the restrained `.empty-sidebar-row`
             treatment rather than an uppercase section header. */
          className="empty-sidebar-row justify-between"
        >
          <span>{t('chat:workgroups.ungrouped')}</span>
          <span>{groups.rootSessions.length}</span>
        </div>
      )}
      {unfiledView.slices.map((slice) => (
        <div key={slice.key} className="space-y-0.5">
          {showSliceLabels && (
            <div className="ws-time-slice" data-testid={`sidebar-time-slice-${slice.key}`}>
              {t(`chat:workgroups.timeSlice.${slice.key}`)}
            </div>
          )}
          {slice.entries.map((entry) => {
            const children = unfiledView.childrenByOrigin.get(entry.session.key) ?? [];
            return (
              <div key={entry.session.key} className="space-y-0.5">
                {renderSessionWithMoveMenu(entry)}
                {children.map((row) => (
                  <div
                    key={`lineage-${row.entry.session.key}`}
                    className="ws-lineage-row"
                    data-testid={`sidebar-lineage-${row.entry.session.key}`}
                    title={t('chat:workgroups.origin', { name: sessionNameByKey.get(entry.session.key) ?? entry.session.key })}
                  >
                    {renderSessionWithMoveMenu(row.entry)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
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
