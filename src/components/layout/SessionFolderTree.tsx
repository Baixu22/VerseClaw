/**
 * Session folder tree - renders the folder hierarchy inside a workspace
 * group in the sidebar. Each folder is a collapsible section with rename
 * and delete actions; sessions assigned to a folder render under it.
 *
 * Session-to-folder assignment is exposed via a small inline menu on each
 * session row's shared action strip (a FolderInput icon button that toggles
 * a lightweight list of available folders). The menu is intentionally minimal - no nested
 * popovers or portals - so it stays inside the sidebar's overflow scroller.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  FolderInput,
  ListChecks,
  Pencil,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { SidebarRow } from './SidebarRow';
import type { WorkspaceProfile } from '@shared/types/workspace';
import {
  buildSidebarWorkspaceFolderGroups,
  collectFolderSessionKeys,
  type SidebarFolderNode,
  type SidebarSessionEntry,
} from './session-buckets';

type SidebarSessionStatusKind = 'running' | 'waiting' | 'completed' | 'error' | 'aborted';
type WorkgroupStatusKind = 'running' | 'waiting' | 'attention' | 'done' | 'stopped' | 'idle';
type RenderSessionRowOptions = {
  leadingActions?: React.ReactNode;
  forceActionsVisible?: boolean;
};

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

interface FolderRowProps {
  node: SidebarFolderNode;
  collapsedFolders: Record<string, boolean>;
  sessionStatusKinds: Record<string, SidebarSessionStatusKind | undefined>;
  onToggleFolder: (folderId: string) => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  renderSessionRow: (entry: SidebarSessionEntry, options?: RenderSessionRowOptions) => React.ReactNode;
}

function FolderRow({
  node,
  collapsedFolders,
  sessionStatusKinds,
  onToggleFolder,
  onRename,
  onDelete,
  renderSessionRow,
}: FolderRowProps) {
  const { t } = useTranslation(['chat', 'common']);
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState(node.folder.name);
  const collapsed = collapsedFolders[node.folder.id] ?? false;

  const submitRename = async () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === node.folder.name) {
      setIsEditing(false);
      return;
    }
    try {
      await onRename(trimmed);
      setIsEditing(false);
    } catch {
      // keep editing on failure
    }
  };

  const allSessionKeys = useMemo(() => collectFolderSessionKeys(node), [node]);
  const workgroupStatus = useMemo(
    () => getWorkgroupStatus(allSessionKeys, sessionStatusKinds),
    [allSessionKeys, sessionStatusKinds],
  );
  const workgroupStatusLabel = t(`chat:workgroups.status.${workgroupStatus}`);
  const hasChildren = node.children.length > 0 || node.sessions.length > 0;

  return (
    <div className="space-y-0.5" data-testid={`sidebar-folder-${node.folder.id}`}>
      {isEditing ? (
        <div className="flex items-center gap-1 px-1.5 py-1" style={{ paddingLeft: 8 }}>
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void submitRename(); }
              if (e.key === 'Escape') { setIsEditing(false); setDraftName(node.folder.name); }
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
            onMouseDown={(e) => { e.preventDefault(); setIsEditing(false); setDraftName(node.folder.name); }}
            className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
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
                    setDraftName(node.folder.name);
                    setIsEditing(true);
                  }}
                  className="task-hover-btn"
                >
                  <Pencil />
                </button>
                <button
                  type="button"
                  data-testid={`sidebar-folder-delete-${node.folder.id}`}
                  aria-label={t('chat:workgroups.delete')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDelete();
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
              data-testid={`sidebar-folder-toggle-${node.folder.id}`}
              aria-expanded={!collapsed}
              onClick={() => onToggleFolder(node.folder.id)}
              className="task-select"
            >
              {/* One leading glyph only: the chevron carries both the folder
                  affordance and its expand state, so the row stays as quiet as
                  the session rows it groups. */}
              {hasChildren
                ? (collapsed
                  ? <ChevronRight className="size-3 shrink-0" />
                  : <ChevronDown className="size-3 shrink-0" />)
                : <span className="size-3 shrink-0" />}
              <span>{node.folder.name}</span>
              {/* Status is a bare dot; its wording rides the tooltip so it can
                  never crowd the workgroup name out of the row. */}
              <span
                data-testid={`sidebar-workgroup-status-${node.folder.id}`}
                title={workgroupStatusLabel}
                aria-label={workgroupStatusLabel}
                className="flex shrink-0 items-center"
              >
                <span className={cn('size-1.5 shrink-0 rounded-full', workgroupStatusDot(workgroupStatus))} />
              </span>
              {allSessionKeys.length > 0 && (
                <span
                  data-testid={`sidebar-workgroup-count-${node.folder.id}`}
                  aria-label={t('chat:workgroups.sessionCount', { count: allSessionKeys.length })}
                  className="shrink-0 text-xs text-[color:var(--cdx-text-4)]"
                >
                  {allSessionKeys.length}
                </span>
              )}
            </button>
          </SidebarRow>
        </div>
      )}
      {!collapsed && hasChildren && (
        /* Children indent relative to this folder, so a nested session always
           sits to the right of the workgroup title that owns it. */
        <div className="folder-children">
          {node.sessions.map((entry) => renderSessionRow(entry))}
          {node.children.map((child) => (
            <FolderRow
              key={child.folder.id}
              node={child}
              collapsedFolders={collapsedFolders}
              sessionStatusKinds={sessionStatusKinds}
              onToggleFolder={onToggleFolder}
              onRename={onRename}
              onDelete={onDelete}
              renderSessionRow={renderSessionRow}
            />
          ))}
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
  onCreateFolder: (workspaceId: string, name: string, parentId: string | null) => Promise<void>;
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
  const [moveMenuForSession, setMoveMenuForSession] = useState<string | null>(null);

  const groups = useMemo(() => buildSidebarWorkspaceFolderGroups({
    sessions,
    folders: workspace.sessionFolders ?? [],
    assignments: workspace.sessionFolderAssignments ?? {},
  }), [sessions, workspace.sessionFolders, workspace.sessionFolderAssignments]);

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

  const renderFolderNode = useCallback((node: SidebarFolderNode): React.ReactNode => {
    return (
      <FolderRow
        key={node.folder.id}
        node={node}
        collapsedFolders={collapsedFolders}
        sessionStatusKinds={sessionStatusKinds}
        onToggleFolder={onToggleFolder}
        onRename={(name) => handleRenameFolder(node.folder.id, name)}
        onDelete={() => handleDeleteFolder(node.folder.id)}
        renderSessionRow={renderSessionRow}
      />
    );
  }, [collapsedFolders, handleRenameFolder, handleDeleteFolder, onToggleFolder, renderSessionRow, sessionStatusKinds]);

  const renderSessionWithMoveMenu = useCallback((entry: SidebarSessionEntry) => {
    const assignedFolderId = workspace.sessionFolderAssignments?.[entry.session.key];
    const isMenuOpen = moveMenuForSession === entry.session.key;
    const handleMove = async (folderId: string | null) => {
      setMoveMenuForSession(null);
      await onMoveSession(workspace.id, entry.session.key, folderId);
    };
    const moveAction = (
      <button
        data-testid={`sidebar-session-move-${entry.session.key}`}
        aria-label={t('chat:workgroups.moveTo')}
        onClick={(e) => {
          e.stopPropagation();
          setMoveMenuForSession(isMenuOpen ? null : entry.session.key);
        }}
        className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
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
        {isMenuOpen && (
          <div
            data-testid={`sidebar-session-move-menu-${entry.session.key}`}
            className="absolute right-1 top-full z-20 mt-0.5 min-w-[140px] rounded-md border border-black/10 bg-surface-modal py-1 shadow-md dark:border-white/10"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handleMove(null);
              }}
              className={cn(
                'flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs hover:bg-black/5 dark:hover:bg-white/10',
                !assignedFolderId && 'font-medium text-foreground',
              )}
            >
              <span className="size-3.5 shrink-0" />
              {t('chat:workgroups.noWorkgroup')}
            </button>
            {(workspace.sessionFolders ?? []).map((folder) => (
              <button
                key={folder.id}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleMove(folder.id);
                }}
                className={cn(
                  'flex w-full items-center gap-1.5 px-2 py-1 text-left text-2xs hover:bg-black/5 dark:hover:bg-white/10',
                  assignedFolderId === folder.id && 'font-medium text-foreground',
                )}
              >
                <ListChecks className="size-3 shrink-0" />
                {folder.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }, [moveMenuForSession, onMoveSession, renderSessionRow, t, workspace.id, workspace.sessionFolderAssignments, workspace.sessionFolders]);

  return (
    <div className="space-y-0.5">
      {groups.folders.map(renderFolderNode)}
      {groups.rootSessions.length > 0 && groups.folders.length > 0 && (
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
      {groups.rootSessions.map(renderSessionWithMoveMenu)}
      {creatingFolder ? (
        <div className="flex items-center gap-1 px-1.5 py-1">
          <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
