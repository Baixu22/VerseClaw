/**
 * Session workstreams — the sidebar's session grouping surface.
 *
 * Design: docs/dev/session-workstreams-design.md. Workgroups are scoped to the
 * current project and rendered as one flat level. Unfiled sessions remain a
 * activity-sorted family list; family disclosure never changes filing.
 *
 * Filing a session into a workstream is NOT this tree's job any more: every
 * session row carries the same ⋯ menu (SessionContextMenu), whose move page
 * offers "no workgroup", every stream, and "create and file here". One menu
 * means one place to manage a session, at every depth. The tree keeps the
 * drag-to-group gesture, which is spatial and has no menu equivalent.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FolderPlus,
  Pencil,
  Trash2,
  Check,
  X,
  ChevronRight,
  GitFork,
  CornerDownRight,
  Bot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { SidebarRow } from './SidebarRow';
import type { SessionFolder, WorkspaceProfile } from '@shared/types/workspace';
import {
  buildSidebarWorkspaceFolderGroups,
  threadSessionsByLineage,
  workstreamAccent,
  type FlatWorkstream,
  type LineageRow,
  type SidebarSessionEntry,
  type SidebarSessionSort,
} from './session-buckets';

type SidebarSessionStatusKind = 'running' | 'waiting' | 'completed' | 'error' | 'aborted';
type WorkgroupStatusKind = 'running' | 'waiting' | 'attention' | 'done' | 'stopped' | 'idle';
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
      {!collapsed && rows.length > 0 && (
        <div className={cn('ws-members-outer', !collapsed && 'open')} aria-hidden={collapsed} inert={collapsed}>
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
  currentSessionKey?: string;
  renderLimit?: number;
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
  /** Drop a dragged session after another session to auto-group them. */
  onDropSession: (workspaceId: string, sourceSessionKey: string, targetSessionKey: string, autoGroupName: string) => Promise<void>;
  renderSessionRow: (entry: SidebarSessionEntry) => React.ReactNode;
}

function SessionFolderTreeInner({
  workspace,
  currentSessionKey,
  renderLimit = Number.POSITIVE_INFINITY,
  sessions,
  collapsedFolders,
  sessionStatusKinds,
  sessionSort,
  onToggleFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDropSession,
  renderSessionRow,
}: SessionFolderTreeMemoProps) {
  const { t } = useTranslation(['chat', 'common']);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [draggedSessionKey, setDraggedSessionKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({});
  const [interactionOrder, setInteractionOrder] = useState<string[] | null>(null);
  const pointerInside = useRef(false);
  const treeElement = useRef<HTMLDivElement>(null);
  const revealedSelection = useRef<string | undefined>(undefined);
  /**
   * `dragOver` can fire in the same native gesture before React has committed
   * the drag-start state update. The ref keeps the active drag key available
   * synchronously, while the state copy only drives the visual classes.
   */
  const draggedSessionKeyRef = useRef<string | null>(null);

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
  const liveRowGroups = useMemo(() => {
    const knownSessions = sessions.map((entry) => entry.session);
    return [
      ...streams.map((stream) => ({ folderId: stream.node.folder.id,
        rows: threadSessionsByLineage(stream.node.sessions, { knownSessions }) })),
      { folderId: null, rows: threadSessionsByLineage(groups.rootSessions, { knownSessions }) },
    ];
  }, [streams, groups.rootSessions, sessions]);
  const rowGroups = useMemo(() => {
    if (!interactionOrder) return liveRowGroups;
    const rank = new Map(interactionOrder.map((key, index) => [key, index]));
    return liveRowGroups.map(group => ({ ...group, rows: group.rows
      .filter(row => rank.has(row.entry.session.key))
      .sort((left, right) => rank.get(left.entry.session.key)! - rank.get(right.entry.session.key)!) }));
  }, [liveRowGroups, interactionOrder]);
  const familyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { rows } of liveRowGroups) for (const row of rows)
      if (row.originKey) counts.set(row.originKey, (counts.get(row.originKey) ?? 0) + 1);
    return counts;
  }, [liveRowGroups]);
  const holdOrder = () => {
    const keys = rowGroups.flatMap(group => group.rows.map(row => row.entry.session.key));
    if (keys.length) setInteractionOrder(current => current ?? keys);
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect -- A navigation or sort intent ends the prior pointer-order hold once.
  useEffect(() => { setInteractionOrder(null); }, [workspace.id, currentSessionKey, sessionSort]);
  useEffect(() => {
    if (!interactionOrder) return;
    const releaseOutside = (event: PointerEvent) => {
      const tree = treeElement.current;
      if (tree && !tree.contains(event.target as Node) && !tree.querySelector(':focus-visible')) {
        pointerInside.current = false;setInteractionOrder(null);
      }
    };
    document.addEventListener('pointermove',releaseOutside,true);
    document.addEventListener('pointerdown',releaseOutside,true);
    return () => {
      document.removeEventListener('pointermove',releaseOutside,true);
      document.removeEventListener('pointerdown',releaseOutside,true);
    };
  },[interactionOrder]);
  const visibleKeys = useMemo(() => {
    const available = rowGroups.flatMap(({ folderId, rows }) => folderId && collapsedFolders[folderId] ? [] : rows)
      .filter((row) => !row.originKey || expandedFamilies[row.originKey] === true);
    const availableKeys = new Set(available.map((row) => row.entry.session.key));
    const byKey = new Map(rowGroups.flatMap(({ rows }) => rows).map((row) => [row.entry.session.key, row]));
    const priorityKeys = new Set<string>();
    const visited = new Set<string>();
    let ancestor = currentSessionKey ? byKey.get(currentSessionKey) : undefined;
    if (currentSessionKey) priorityKeys.add(currentSessionKey);
    if (ancestor?.originKey) priorityKeys.add(ancestor.originKey);
    while (ancestor && !visited.has(ancestor.entry.session.key)) {
      const key = ancestor.entry.session.key;
      visited.add(key); priorityKeys.add(key);
      ancestor = ancestor.relation?.parentSessionKey ? byKey.get(ancestor.relation.parentSessionKey) : undefined;
    }
    // Selection and visible ancestors take slots from the same workspace budget.
    const visible = new Set([...priorityKeys].filter((key) => availableKeys.has(key)).slice(0, renderLimit));
    for (const row of available) {
      if (visible.size >= renderLimit) break;
      visible.add(row.entry.session.key);
    }
    return visible;
  }, [rowGroups, collapsedFolders, expandedFamilies, currentSessionKey, renderLimit]);
  useEffect(() => {
    if (!currentSessionKey || revealedSelection.current === currentSessionKey) return;
    const group = [groups.rootSessions, ...groups.folders.map((folder) => folder.sessions)]
      .find((entries) => entries.some((entry) => entry.session.key === currentSessionKey));
    if (!group) return;
    revealedSelection.current = currentSessionKey;
    const row = threadSessionsByLineage(group).find((entry) => entry.entry.session.key === currentSessionKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reveal an externally selected child once; revealedSelection prevents reopening after an explicit collapse.
    if (row?.originKey) setExpandedFamilies((current) => ({ ...current, [row.originKey!]: true }));
  }, [currentSessionKey, groups]);

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

  /**
   * Every session row is wrapped in the HTML5 drag handle: drop a session onto
   * another session row and both are filed into the same workgroup. Moving by
   * menu is the row's own ⋯ menu (see the header comment), so the wrapper adds
   * no controls to the row.
   */
  const renderDraggableSession = useCallback((entry: SidebarSessionEntry) => {
    const sessionKey = entry.session.key;
    const isDragging = draggedSessionKey === sessionKey;
    const isDropTarget = dropTargetKey === sessionKey;

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
        {renderSessionRow(entry)}
      </div>
    );
  }, [
    draggedSessionKey,
    dropTargetKey,
    handleDropSession,
    renderSessionRow,
    t,
    workspace.id,
  ]);

  const toRenderedRows = useCallback((rows: LineageRow[]): RenderedSessionRow[] => {
    const childrenByOrigin = new Map<string, LineageRow[]>();
    for (const row of rows) {
      if (!row.originKey) continue;
      const children = childrenByOrigin.get(row.originKey) ?? [];
      children.push(row);
      childrenByOrigin.set(row.originKey, children);
    }
    const renderRow = (row: LineageRow) => {
      const { entry, relation } = row;
      const key = entry.session.key;
      if (!visibleKeys.has(key)) return null;
      const count = familyCounts.get(key) ?? 0;
      const expanded = expandedFamilies[key] === true;
      const Icon = relation?.kind === 'fork' ? GitFork : relation?.kind === 'spawn' ? Bot : CornerDownRight;
      const toggle = (open = !expanded) => {
        if (open) setInteractionOrder(current => {
          if (!current) return current;
          const children = liveRowGroups.flatMap(group => group.rows)
            .filter(child => child.originKey === key).map(child => child.entry.session.key);
          if (children.every(child => current.includes(child))) return current;
          const childKeys = new Set(children);
          const next = current.filter(child => !childKeys.has(child));
          const parentIndex = next.indexOf(key);
          if (parentIndex < 0) return current;
          next.splice(parentIndex + 1, 0, ...children);
          return next;
        });
        setExpandedFamilies(current => ({ ...current, [key]: open }));
      };
      return (
        <div key={key} className={cn('ws-family-row', count > 0 && 'session-family__parent', row.originKey && 'session-family__child')}
          data-lineage-depth={row.lineageDepth} data-source-status={row.sourceStatus}
          data-parent-session={row.originKey ? relation?.parentSessionKey : undefined}>
          {count > 0 ? (
            <button type="button" className="session-family__toggle" data-testid={`session-family-toggle-${key}`}
              aria-expanded={expanded} aria-label={t('chat:sessionFamily.toggle', { count })}
              onClick={() => toggle()} onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); toggle(event.key === 'ArrowRight'); }
              }}>
              <ChevronRight aria-hidden="true" />
            </button>
          ) : row.originKey ? (
            <>
              <CornerDownRight className="session-family__connector" aria-hidden="true" />
              <span className="ws-family-kind" title={t(`chat:sessionFamily.kind.${relation?.kind ?? 'unknown'}`)}><Icon /></span>
            </>
          ) : relation?.kind !== 'unknown' || row.sourceStatus === 'source-unavailable' ? (
            <span className="ws-family-kind" title={t(`chat:sessionFamily.kind.${relation?.kind ?? 'unknown'}`)}><Icon /></span>
          ) : null}
          {count > 0 && <span className="session-family__count" aria-hidden="true">{count}</span>}
          {renderDraggableSession(entry)}
        </div>
      );
    };
    return rows.map((row) => {
      const key = row.entry.session.key;
      // Keep every entry for group counts, but render each descendant once under its existing origin.
      if (row.originKey) return { entry: row.entry, rendered: null };
      const children = childrenByOrigin.get(key);
      if (!children?.length) return { entry: row.entry, rendered: renderRow(row) };
      const visibleChildren = children.filter((child) => visibleKeys.has(child.entry.session.key));
      if (!visibleKeys.has(key)) return { entry: row.entry, rendered: null };
      return { entry: row.entry, rendered: (
        <div key={key} className="session-family" data-hook-static data-testid={`sidebar-session-family-${key}`}>
          {renderRow(row)}
          {expandedFamilies[key] === true && visibleChildren.length > 0 && (
            <div className="session-family__children">{visibleChildren.map(renderRow)}</div>
          )}
        </div>
      ) };
    });
  }, [expandedFamilies, renderDraggableSession, visibleKeys, t, familyCounts, liveRowGroups]);

  return (
    /* Not `space-y-0.5`: the base sidebar rule neutralizes that utility by
       forcing `margin-bottom: 0` on every sibling after the first, which silently
       ate the whitespace rhythm that now carries grouping. Spacing is owned by
       `.ws-stream` / `.ws-time-slice` in codex-sidebar.css instead. */
    <div ref={treeElement} className="ws-tree" data-has-groups={streams.length > 0 ? 'true' : undefined} data-order-held={interactionOrder!==null}
      onPointerEnter={()=>{pointerInside.current=true;holdOrder();}}
      onPointerMove={()=>{pointerInside.current=true;holdOrder();}}
      onPointerLeave={event => {
        pointerInside.current=false;
        // A window losing focus reports no destination. Keep the user's anchor
        // until an actual outside pointer gesture or explicit navigation.
        if(event.relatedTarget instanceof Node && !event.currentTarget.querySelector(':focus-visible'))setInteractionOrder(null);
      }}
      onFocusCapture={event => { if (event.target.matches(':focus-visible')) holdOrder(); }}
      onBlurCapture={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !pointerInside.current) setInteractionOrder(null);
      }}>
      {streams.map((stream, index) => (
        <WorkstreamSection
          key={stream.node.folder.id}
          stream={stream}
          rows={toRenderedRows(rowGroups[index].rows)}
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
      {toRenderedRows(rowGroups[rowGroups.length - 1].rows).map((row) => row.rendered)}
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
