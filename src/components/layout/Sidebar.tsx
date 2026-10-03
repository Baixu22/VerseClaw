/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/shallow';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Settings as SettingsIcon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeft,
  Trash2,
  Archive as ArchiveIcon,
  Pencil,
  Check,
  X,
  Loader2,
  AlertTriangle,
  Activity,
  GitCompare,
  ImagePlus,
  Moon,
  Workflow,
  Plus,
  FolderPlus,
  MoreVertical,
  Clock3,
  Folder,
  GitBranch,
  Pin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrbStatus, type OrbStatusState } from '@/components/assistant-ui/orb-status';
import { isGatewayRestarting } from '@/lib/gateway-status';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { useSettingsStore } from '@/stores/settings';
import { useUiOverlay } from './ui-overlay-context';
import { useChatStore, type ChatRuntimeRunState, type ChatSession } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useWorkspacesStore } from '@/stores/workspaces';
import { useStorageHealthStore } from '@/stores/storage-health';
import { isInboxItemActionable, useInboxStore } from '@/stores/inbox';
import {
  buildLatestRuntimeRunBySession,
  buildSidebarTimeSessions,
  buildSidebarWorkspaceSessionGroups,
  compareSidebarSessionEntries,
  type SidebarSessionSort,
  type SidebarSessionEntry,
} from './session-buckets';
import { SessionSearchModal } from './SessionSearchModal';
import { SessionFolderTree } from './SessionFolderTree';
import { SessionContextMenu, type SessionContextMenuTarget } from './SessionContextMenu';
import { SidebarRow } from './SidebarRow';
import {
  OfficialArchiveIcon,
  OfficialFolderClosedIcon,
  OfficialFolderOpenIcon,
  OfficialMenuCheckIcon,
  OfficialMoreIcon,
  OfficialSearchIcon,
  OfficialSectionChevron,
} from './codex-sidebar-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { hostApi } from '@/lib/host-api';
import type { WorkspaceSessionListState } from '@shared/types/workspace';
import { MAC_SIDEBAR_CHROME_HEIGHT } from '@shared/sidebar-layout';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { useNewChatAction } from './use-new-chat-action';
import { CalendarDays, FileText, Inbox as CodexInbox, Laptop, ListChecks, PenLine } from '@/components/icons/codex-icons';
import { toast } from 'sonner';
import { useSessionIntentStore } from '@/stores/session-intent';
import { createFreshWorkspaceSessionKey, createWorkspaceScopedForkSession } from '@/lib/workspace-session';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  collapsed?: boolean;
  onClick?: () => void;
  testId?: string;
}

function NavItem({ to, icon, label, badge, collapsed, onClick, testId }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      data-testid={testId}
      className={() => cn(collapsed && 'justify-center px-0')}
    >
      <>
        {icon}
        {!collapsed && (
          <>
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
            {badge && (
              <Badge data-testid={testId ? `${testId}-badge` : undefined} variant="secondary" className="ml-auto shrink-0">
                {badge}
              </Badge>
            )}
          </>
        )}
      </>
    </NavLink>
  );
}

interface SessionRowProps {
  session: ChatSession;
  agentName: string;
  workspaceName?: string;
  branch?: string;
  activityMs: number;
  isEditing: boolean;
  sessionLabel: string;
  sessionStatus?: SidebarSessionStatus | null;
  isPinned: boolean;
  isUnread: boolean;
  editingLabel: string;
  currentSessionKey: string;
  isOnChat: boolean;
  onEditLabel: (value: string) => void;
  onStartRename: (key: string, label: string) => void;
  onRenameSubmit: () => Promise<void>;
  onRenameCancel: () => void;
  onRenameKeyDown: (e: React.KeyboardEvent) => void;
  onSwitch: (key: string) => void;
  onLoadHistory: (force: boolean) => Promise<void>;
  navigate: (to: string) => void;
  onDeleteClick: (key: string, label: string) => void;
  onDismissSessionStatus: (key: string, signature: string) => void;
  onMarkRead: (key: string) => void;
  onTogglePinned: (key: string) => void;
  /** Right-click opens the full action menu (SessionContextMenu). */
  onOpenContextMenu: (key: string, x: number, y: number) => void;
  leadingActions?: React.ReactNode;
  forceActionsVisible?: boolean;
}

type SidebarSessionStatusKind = 'running' | 'waiting' | 'completed' | 'error' | 'aborted';

type SidebarSessionStatus = {
  kind: SidebarSessionStatusKind;
  matrixState: OrbStatusState;
  labelKey: string;
  signature: string;
  dismissible: boolean;
};

const COMPLETED_SESSION_STATUSES = new Set(['completed', 'success', 'done', 'finished']);
const ERROR_SESSION_STATUSES = new Set(['failed', 'error', 'killed', 'timeout']);
const ABORTED_SESSION_STATUSES = new Set(['aborted', 'cancelled', 'canceled']);
const WAITING_SESSION_STATUSES = new Set([
  'waiting',
  'waiting_approval',
  'awaiting_input',
  'awaiting-input',
  'needs_input',
  'needs-input',
  'pending_approval',
  'pending-approval',
]);

function runHasWaitingApproval(run: ChatRuntimeRunState | null): boolean {
  if (!run) return false;
  const latestApproval = [...run.events].reverse().find((event) => event.type === 'approval.updated');
  if (!latestApproval || latestApproval.type !== 'approval.updated') return false;
  const status = `${latestApproval.status ?? ''} ${latestApproval.phase ?? ''}`.toLowerCase();
  return /\b(wait|waiting|pending|approval|input|confirm)\b/.test(status);
}

function buildSidebarSessionStatus(input: {
  session: ChatSession;
  latestRun: ChatRuntimeRunState | null;
  currentSessionKey: string;
  activeRunId: string | null;
  sending: boolean;
  pendingFinal: boolean;
  runError: string | null;
  dismissedCompletedSignature?: string;
}): SidebarSessionStatus | null {
  const latestRun = input.latestRun;
  const isCurrentSession = input.session.key === input.currentSessionKey;
  const currentRunActive = isCurrentSession && (input.sending || input.pendingFinal || input.activeRunId != null);
  const sessionStatus = input.session.status?.toLowerCase();
  const latestRunStatus = latestRun?.status?.toLowerCase();
  const waitingForInput = (isCurrentSession && input.pendingFinal)
    || runHasWaitingApproval(latestRun)
    || WAITING_SESSION_STATUSES.has(sessionStatus ?? '')
    || WAITING_SESSION_STATUSES.has(latestRunStatus ?? '');

  let kind: SidebarSessionStatusKind | null = null;
  if (isCurrentSession && input.runError) {
    kind = 'error';
  } else if (waitingForInput || currentRunActive || input.session.hasActiveRun === true || sessionStatus === 'running' || latestRunStatus === 'running') {
    kind = waitingForInput ? 'waiting' : 'running';
  } else if (COMPLETED_SESSION_STATUSES.has(latestRunStatus ?? '') || COMPLETED_SESSION_STATUSES.has(sessionStatus ?? '')) {
    kind = 'completed';
  } else if (ERROR_SESSION_STATUSES.has(latestRunStatus ?? '') || ERROR_SESSION_STATUSES.has(sessionStatus ?? '')) {
    kind = 'error';
  } else if (ABORTED_SESSION_STATUSES.has(latestRunStatus ?? '') || ABORTED_SESSION_STATUSES.has(sessionStatus ?? '')) {
    kind = 'aborted';
  }

  if (!kind) return null;

  const signature = [
    kind,
    input.session.key,
    latestRun?.runId ?? 'session',
    latestRun?.endedAt ?? latestRun?.startedAt ?? input.session.updatedAt ?? 0,
  ].join(':');

  if (kind === 'completed' && input.dismissedCompletedSignature === signature) {
    return null;
  }

  const matrixStateByKind: Record<SidebarSessionStatusKind, OrbStatusState> = {
    running: 'streaming',
    waiting: 'waiting',
    completed: 'success',
    error: 'error',
    aborted: 'stopped',
  };

  return {
    kind,
    matrixState: matrixStateByKind[kind],
    labelKey: `sessionStatus.${kind}`,
    signature,
    dismissible: kind === 'completed',
  };
}

const SessionRowMemo = memo(function SessionRow({
  session: s,
  agentName,
  workspaceName,
  branch,
  activityMs,
  isEditing,
  sessionLabel,
  sessionStatus,
  isPinned,
  isUnread,
  editingLabel,
  currentSessionKey,
  isOnChat,
  onEditLabel,
  onStartRename,
  onRenameSubmit,
  onRenameCancel,
  onRenameKeyDown,
  onSwitch,
  onLoadHistory,
  navigate,
  onDeleteClick,
  onDismissSessionStatus,
  onMarkRead,
  onTogglePinned,
  onOpenContextMenu,
  leadingActions,
  forceActionsVisible = false,
}: SessionRowProps) {
  const { t } = useTranslation(['common', 'chat']);
  const sessionStatusLabel = sessionStatus ? t(`chat:${sessionStatus.labelKey}`) : '';
  const isSelected = isOnChat && currentSessionKey === s.key;

  /* Long-title marquee: on row hover, measure how far the title overflows past
     the action strip and pan it left so the full name scrolls into view. The
     three hover buttons are absolute-positioned over the right edge; reserving
     their width keeps the title from sliding under them. The outer `.marquee-
     text` span stays fixed (overflow clip + fade mask); only the inner span
     translates, so the text scrolls inside the clipped frame. */
  const taskSelectRef = useRef<HTMLButtonElement>(null);

  const handleRowHoverStart = useCallback(() => {
    const btn = taskSelectRef.current;
    if (!btn) return;
    const wrapper = btn.querySelector<HTMLElement>('.marquee-text');
    const inner = wrapper?.querySelector<HTMLElement>('.marquee-text__inner');
    if (!wrapper || !inner) return;
    const row = btn.closest('.sidebar-row');
    const actionsEl = row?.querySelector<HTMLElement>('.sidebar-row__actions');
    /* actions is absolute; offsetWidth is layout-stable even at opacity 0.
       +8px breathes between the title end and the first button. */
    const actionsWidth = actionsEl ? actionsEl.offsetWidth + 8 : 72;
    const available = wrapper.clientWidth - actionsWidth;
    const overflow = inner.scrollWidth - available;
    if (overflow > 4) {
      inner.style.setProperty('--marquee-distance', `-${overflow}px`);
      /* Expose the measured action-strip width to CSS so the fade mask can
         terminate exactly at the buttons' left edge — the panning text stays
         legible up to that point and never slides under the buttons. */
      wrapper.style.setProperty('--marquee-actions-width', `${actionsWidth}px`);
      wrapper.classList.add('is-marqueeing');
    }
  }, []);

  const handleRowHoverEnd = useCallback(() => {
    const btn = taskSelectRef.current;
    if (!btn) return;
    const wrapper = btn.querySelector<HTMLElement>('.marquee-text');
    const inner = wrapper?.querySelector<HTMLElement>('.marquee-text__inner');
    if (!wrapper || !inner) return;
    wrapper.classList.remove('is-marqueeing');
    inner.style.removeProperty('--marquee-distance');
    wrapper.style.removeProperty('--marquee-actions-width');
  }, []);

  if (isEditing) {
    return (
      <div className="flex w-full items-center gap-1 px-1.5 py-1">
        <Input
          autoFocus
          value={editingLabel}
          onChange={(e) => onEditLabel(e.target.value)}
          onKeyDown={onRenameKeyDown}
          onBlur={() => void onRenameSubmit()}
          className="h-7 min-w-0 flex-1 text-meta"
          aria-label={t('common:sidebar.renameSessionPlaceholder', { ns: 'common' })}
        />
        <button
          aria-label={t('common:sidebar.saveSessionRename', { ns: 'common' })}
          onMouseDown={(e) => { e.preventDefault(); void onRenameSubmit(); }}
          className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          aria-label={t('common:sidebar.cancelSessionRename', { ns: 'common' })}
          onMouseDown={(e) => { e.preventDefault(); onRenameCancel(); }}
          className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const tooltipWorkspace = workspaceName || agentName;
  const tooltipTime = activityMs > 0
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(activityMs)
    : '';

  return (
    <Tooltip>
    <SidebarRow
      className="task-row"
      selected={isSelected}
      actionsClassName="task-hover-actions"
      onMouseEnter={handleRowHoverStart}
      onMouseLeave={handleRowHoverEnd}
      /* Right-click anywhere on the row — including its hover controls — opens
         the action menu. Everything that is not worth a permanent 22px button
         lives there (migrate, fork, hand off, copy paths, unread). */
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenContextMenu(s.key, event.clientX, event.clientY);
      }}
      actions={(
        <>
          <button
            type="button"
            data-testid={`sidebar-session-pin-${s.key}`}
            aria-label={t(isPinned ? 'chat:sidebar.unpinSession' : 'chat:sidebar.pinSession')}
            title={t(isPinned ? 'chat:sidebar.unpinSession' : 'chat:sidebar.pinSession')}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePinned(s.key);
            }}
            className={cn('task-hover-btn', isPinned && 'task-hover-btn--active')}
          >
            <Pin />
          </button>
          {leadingActions}
          <button
            type="button"
            data-testid={`sidebar-session-rename-${s.key}`}
            aria-label={t('common:sidebar.renameSession', { ns: 'common' })}
            onClick={(e) => {
              e.stopPropagation();
              onStartRename(s.key, sessionLabel);
            }}
            className="task-hover-btn"
          >
            <Pencil />
          </button>
          <button
            type="button"
            data-testid={`sidebar-session-delete-${s.key}`}
            aria-label={t('common:sidebar.deleteSession', { ns: 'common' })}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteClick(s.key, sessionLabel);
            }}
            className="task-hover-btn hover:!text-destructive"
          >
            <Trash2 />
          </button>
        </>
      )}
      /* While a row's move-menu is open the controls must not fade out from
         under the open popover; `.sidebar-row[data-force-actions]` pins them. */
      data-force-actions={forceActionsVisible ? 'true' : undefined}
    >
      <TooltipTrigger asChild>
        <button
        ref={taskSelectRef}
        type="button"
        data-testid={`sidebar-session-${s.key}`}
        onClick={() => {
          onMarkRead(s.key);
          if (currentSessionKey === s.key) {
            void onLoadHistory(false);
          } else {
            onSwitch(s.key);
          }
          navigate('/');
        }}
        onDoubleClick={() => onStartRename(s.key, sessionLabel)}
        className="task-select"
      >
        {/* One line, one title. The project name used to ride here as a
            subtitle, which doubled every row's height for a fact that is
            identical for every session in the group — it now lives in the
            pinned project header (and in this row's tooltip). */}
        <div className="task-title-block">
          <span className={cn('marquee-text', isUnread && 'task-title--unread')}>
            <span className="marquee-text__inner">{sessionLabel}</span>
          </span>
        </div>
        {isPinned && (
          <Pin
            className="task-pinned-marker"
            data-testid={`sidebar-session-pinned-${s.key}`}
            aria-label={t('chat:sidebar.pinnedSession')}
          />
        )}
        {isUnread && (
          <span
            className="task-unread-dot"
            data-testid={`sidebar-session-unread-${s.key}`}
            aria-label={t('chat:sidebar.unreadSession')}
          />
        )}
        {sessionStatus && (
          <span
            data-testid={`sidebar-session-status-${s.key}`}
            data-state={sessionStatus.kind}
            role="status"
            aria-label={sessionStatusLabel}
            onClick={(event) => {
              if (!sessionStatus.dismissible) return;
              event.stopPropagation();
              event.preventDefault();
              onDismissSessionStatus(s.key, sessionStatus.signature);
            }}
            className={cn(
              'task-status-slot',
              sessionStatus.dismissible && 'task-status-slot--dismissible',
            )}
          >
            <OrbStatus state={sessionStatus.matrixState} label={sessionStatusLabel} className="size-3.5" />
          </span>
        )}
        </button>
      </TooltipTrigger>
    </SidebarRow>
      <TooltipContent
        side="right"
        align="start"
        collisionPadding={10}
        className="w-64 overflow-hidden rounded-xl border-border/80 bg-elevated p-0 text-foreground shadow-xl"
        data-testid={`sidebar-session-tooltip-${s.key}`}
      >
        <div className="grid gap-2 px-3 py-2.5">
          <div className="min-w-0 truncate text-sm font-medium leading-5">{sessionLabel}</div>
          {tooltipTime && (
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{tooltipTime}</span>
            </div>
          )}
          {tooltipWorkspace && (
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{tooltipWorkspace}</span>
            </div>
          )}
          {branch?.trim() && (
            <div
              className="flex min-w-0 items-center gap-2 border-t border-border/60 pt-2 text-xs text-muted-foreground"
              data-testid={`sidebar-session-tooltip-branch-${s.key}`}
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate font-mono">{branch.trim()}</span>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
});

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function SidebarSettingsNavItem({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const { settingsOpen, openSettings } = useUiOverlay();

  return (
    <NavLink
      to="/settings/general"
      data-testid="sidebar-nav-settings"
      aria-label={t('sidebar.settings')}
      onClick={(event) => {
        event.preventDefault();
        openSettings('/settings/general');
      }}
      className={({ isActive }) =>
        cn(
          'profile-menu-trigger',
          (isActive || settingsOpen) && 'open',
          collapsed && 'justify-center px-0',
        )
      }
    >
      <span className="profile-menu-trigger-icon"><SettingsIcon strokeWidth={1.8} /></span>
      {!collapsed && <span className="profile-menu-trigger-label">{t('sidebar.settings')}</span>}
      {!collapsed && <span className="profile-menu-shortcut">Ctrl+,</span>}
    </NavLink>
  );
}

export function Sidebar() {
  const isMac = window.electron?.platform === 'darwin';
  const { sidebarCollapsed, setSidebarCollapsed, sidebarWidth, setSidebarWidth, devModeUnlocked } = useSettingsStore(useShallow((state) => ({
    sidebarCollapsed: state.sidebarCollapsed,
    setSidebarCollapsed: state.setSidebarCollapsed,
    sidebarWidth: state.sidebarWidth,
    setSidebarWidth: state.setSidebarWidth,
    devModeUnlocked: state.devModeUnlocked,
  })));
  const [isResizing, setIsResizing] = useState(false);
  const stopResizeRef = useRef<(() => void) | null>(null);

  const { sessions, messages, currentSessionKey, sessionLabels, sessionLastActivity, runtimeRuns, activeRunId, sending, pendingFinal, runError, startupPhase } = useChatStore(useShallow((s) => ({
    sessions: s.sessions,
    messages: s.messages,
    currentSessionKey: s.currentSessionKey,
    sessionLabels: s.sessionLabels,
    sessionLastActivity: s.sessionLastActivity,
    runtimeRuns: s.runtimeRuns,
    activeRunId: s.activeRunId,
    sending: s.sending,
    pendingFinal: s.pendingFinal,
    runError: s.runError,
    startupPhase: s.startupPhase,
  })));
  const switchSession = useChatStore((s) => s.switchSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const archiveSession = useChatStore((s) => s.archiveSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const hydrateStartup = useChatStore((s) => s.hydrateStartup);
  const handleNewChat = useNewChatAction();
  const workspaceProfiles = useWorkspacesStore((s) => s.profiles);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const workspacesLoading = useWorkspacesStore((s) => s.loading);
  const workspacesError = useWorkspacesStore((s) => s.error);
  const fetchWorkspaces = useWorkspacesStore((s) => s.fetchWorkspaces);
  const createWorkspace = useWorkspacesStore((s) => s.createWorkspace);
  const switchWorkspace = useWorkspacesStore((s) => s.switchWorkspace);
  const createWorkspaceFolder = useWorkspacesStore((s) => s.createFolder);
  const renameWorkspaceFolder = useWorkspacesStore((s) => s.renameFolder);
  const deleteWorkspaceFolder = useWorkspacesStore((s) => s.deleteFolder);
  const moveSessionToFolder = useWorkspacesStore((s) => s.moveSessionToFolder);
  const groupSessions = useWorkspacesStore((s) => s.groupSessions);
  const saveWorkspaceState = useWorkspacesStore((s) => s.saveWorkspaceState);
  const inboxItems = useInboxStore((state) => state.items);
  const refreshInbox = useInboxStore((state) => state.refresh);
  const [dismissedCompletedStatuses, setDismissedCompletedStatuses] = useState<Record<string, string>>({});
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Record<string, boolean>>({});

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const isGatewayReady = isGatewayRunning && gatewayStatus.gatewayReady !== false;
  const gatewayRestarting = isGatewayRestarting(gatewayStatus);
  const storageRamLow = useStorageHealthStore((s) => s.ramLow);
  const storageDiskLow = useStorageHealthStore((s) => s.diskLow);
  const storageHealthLow = storageRamLow || storageDiskLow;
  const gatewayRuntimeKey = `${gatewayStatus.pid ?? 'none'}:${gatewayStatus.connectedAt ?? 'none'}:${gatewayStatus.port}`;

  useEffect(() => {
    void hydrateStartup();
  }, [gatewayRuntimeKey, isGatewayReady, hydrateStartup]);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  useEffect(() => {
    if (!isMac) return;
    void hostApi.window.syncTrafficLightPosition(sidebarCollapsed);
  }, [isMac, sidebarCollapsed]);

  const navigate = useNavigate();
  const location = useLocation();
  const isOnChat = location.pathname === '/';
  const inboxPendingCount = useMemo(
    () => inboxItems.filter(isInboxItemActionable).length,
    [inboxItems],
  );

  const sidebarSessions = useMemo(() => sessions.filter((session) => {
    // A newly created workspace session is intentionally invisible until its
    // first message. The store may still receive a synthetic "current" row
    // from a gateway refresh, so keep that implementation detail out of the
    // sidebar while preserving real history-backed session rows.
    const isFreshCurrent = session.key === currentSessionKey
      && /:session-\d/.test(session.key)
      && messages.length === 0;
    return !isFreshCurrent;
  }), [currentSessionKey, messages.length, sessions]);

  useEffect(() => {
    void refreshInbox();
    const intervalId = window.setInterval(() => void refreshInbox(), 30_000);
    return () => window.clearInterval(intervalId);
  }, [location.pathname, refreshInbox]);

  const { t } = useTranslation(['common', 'chat', 'taskLedger', 'clawGraph', 'codeReview']);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingSessionKey, setEditingSessionKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [sessionView, setSessionView] = useState<'project' | 'time'>('project');
  const [sessionSort, setSessionSort] = useState<SidebarSessionSort>('newest');
  /* Official sections are collapsible; conversations default to open so the
     restored session list is visible without an extra click. */
  const [sessionSectionOpen, setSessionSectionOpen] = useState(true);
  const [sessionOrganizeMenu, setSessionOrganizeMenu] = useState<{ top: number; left: number } | null>(null);
  const [footerMenu, setFooterMenu] = useState<{ bottom: number; left: number; maxHeight: number } | null>(null);
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Record<string, boolean>>({});
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState<{ workspaceId: string; top: number; left: number } | null>(null);
  /* Right-click target for the conversation action menu. Kept as the anchor
     only: everything the menu renders is derived at render time, so a session
     that changes while the menu is open cannot show stale state. */
  const [sessionContextMenu, setSessionContextMenu] = useState<{ sessionKey: string; x: number; y: number } | null>(null);
  const requestSessionIntent = useSessionIntentStore((state) => state.request);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (!sessionOrganizeMenu && !footerMenu && !projectMenu) return;
    const close = (event: PointerEvent) => {
      if ((event.target as Element).closest?.('.sidebar-session-organize-menu,.sidebar-session-organize-trigger,.sidebar-footer-menu,.sidebar-footer-menu-trigger,.sidebar-project-menu,.sidebar-project-menu-trigger')) return;
      setSessionOrganizeMenu(null);
      setFooterMenu(null);
      setProjectMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSessionOrganizeMenu(null);
        setFooterMenu(null);
        setProjectMenu(null);
      }
    };
    addEventListener('pointerdown', close);
    addEventListener('keydown', escape);
    return () => {
      removeEventListener('pointerdown', close);
      removeEventListener('keydown', escape);
    };
  }, [footerMenu, projectMenu, sessionOrganizeMenu]);

  useEffect(() => {
    if (deleteDialogOpen || !sessionToDelete) return;
    const timer = window.setTimeout(() => setSessionToDelete(null), 160);
    return () => window.clearTimeout(timer);
  }, [deleteDialogOpen, sessionToDelete]);

  /*
   * These four are `useCallback` because `renderSessionRow` depends on them and
   * is itself a prop of the memoized `SessionFolderTree` / `SessionRowMemo`.
   * As plain function declarations they got a new identity every render, which
   * invalidated `renderSessionRow`, which invalidated both memos — so every
   * session row re-rendered on every sidebar render. Combined with the runtime
   * subscription below, that meant a full list re-render per streamed token.
   */
  const handleStartRename = useCallback((key: string, currentLabel: string) => {
    setEditingSessionKey(key);
    setEditingLabel(currentLabel);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!editingSessionKey || !editingLabel.trim()) {
      setEditingSessionKey(null);
      return;
    }
    try {
      await renameSession(editingSessionKey, editingLabel.trim());
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
    setEditingSessionKey(null);
  }, [editingLabel, editingSessionKey, renameSession]);

  const handleRenameCancel = useCallback(() => {
    setEditingSessionKey(null);
  }, []);

  const toggleWorkspaceGroup = useCallback((workspaceId: string) => {
    setCollapsedWorkspaceIds((current) => ({
      ...current,
      [workspaceId]: !current[workspaceId],
    }));
  }, []);

  const handlePickWorkspaceFolder = useCallback(async () => {
    try {
      const result = await hostApi.dialog.open({
        title: t('chat:toolbar.addWorkspaceDialogTitle'),
        buttonLabel: t('chat:toolbar.addWorkspaceDialogButton'),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) return;
      const rootPath = result.filePaths[0];
      const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      const existing = workspaceProfiles.find((profile) => normalize(profile.rootPath) === normalize(rootPath));
      if (existing) {
        await switchWorkspace(existing.id);
        toast.success(t('chat:workspace.switched'));
      } else {
        const agentId = getAgentIdFromSessionKey(currentSessionKey);
        const nextSessionKey = createFreshWorkspaceSessionKey(agentId);
        await createWorkspace({ rootPath, agentId, activeSessionKey: nextSessionKey });
        toast.success(t('chat:workspace.addedAndSwitched'));
      }
    } catch (error) {
      toast.error(t('chat:workspace.switchFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
  }, [createWorkspace, currentSessionKey, switchWorkspace, t, workspaceProfiles]);

  const handleNewSessionInWorkspace = useCallback(async (workspaceId: string) => {
    try {
      await switchWorkspace(workspaceId);
      handleNewChat();
    } catch (error) {
      toast.error(String(error instanceof Error ? error.message : error));
    }
  }, [handleNewChat, switchWorkspace]);

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolderIds((current) => ({
      ...current,
      [folderId]: !current[folderId],
    }));
  }, []);

  const handleCreateFolder = useCallback(async (workspaceId: string, name: string, parentId: string | null) => {
    // Return the created folder — the move menu's one-step "create stream and
    // file this session there" flow needs the new id.
    return createWorkspaceFolder(workspaceId, name, parentId);
  }, [createWorkspaceFolder]);

  const handleRenameFolder = useCallback(async (workspaceId: string, folderId: string, name: string) => {
    await renameWorkspaceFolder(workspaceId, folderId, name);
  }, [renameWorkspaceFolder]);

  const handleDeleteFolder = useCallback(async (workspaceId: string, folderId: string) => {
    await deleteWorkspaceFolder(workspaceId, folderId);
  }, [deleteWorkspaceFolder]);

  const handleMoveSessionToFolder = useCallback(async (workspaceId: string, sessionKey: string, folderId: string | null) => {
    await moveSessionToFolder(workspaceId, sessionKey, folderId);
  }, [moveSessionToFolder]);

  const handleDropSessionToGroup = useCallback(async (
    workspaceId: string,
    sourceSessionKey: string,
    targetSessionKey: string,
    autoGroupName: string,
  ) => {
    await groupSessions(workspaceId, sourceSessionKey, targetSessionKey, autoGroupName);
  }, [groupSessions]);

  const findWorkspaceForSession = useCallback((sessionKey: string) => (
    workspaceProfiles.find((profile) => (
      profile.activeSessionKey === sessionKey
      || Boolean(profile.sessionStates?.[sessionKey])
      || Object.values(profile.agentBindings ?? {}).some((binding) => binding.sessionKey === sessionKey)
    )) ?? null
  ), [workspaceProfiles]);

  const updateSessionListState = useCallback((sessionKey: string, patch: WorkspaceSessionListState) => {
    const workspace = findWorkspaceForSession(sessionKey);
    if (!workspace) return;
    const current = workspace.sessionStates?.[sessionKey]?.sessionList ?? {};
    void saveWorkspaceState({
      id: workspace.id,
      sessionKey,
      state: { sessionList: { ...current, ...patch } },
    });
  }, [findWorkspaceForSession, saveWorkspaceState]);

  const markSessionRead = useCallback((sessionKey: string) => {
    updateSessionListState(sessionKey, { unread: false, lastReadAt: Date.now() });
  }, [updateSessionListState]);

  const toggleSessionUnread = useCallback((sessionKey: string) => {
    const workspace = findWorkspaceForSession(sessionKey);
    const current = workspace?.sessionStates?.[sessionKey]?.sessionList ?? {};
    updateSessionListState(sessionKey, current.unread
      ? { unread: false, lastReadAt: Date.now() }
      : { unread: true });
  }, [findWorkspaceForSession, updateSessionListState]);

  const toggleSessionPinned = useCallback((sessionKey: string) => {
    const workspace = findWorkspaceForSession(sessionKey);
    const current = workspace?.sessionStates?.[sessionKey]?.sessionList ?? {};
    updateSessionListState(sessionKey, { pinned: !current.pinned });
  }, [findWorkspaceForSession, updateSessionListState]);

  /*
   * Conversation action menu (right-click).
   *
   * `openSessionContextMenu` MUST keep a stable identity: it is threaded into
   * `renderSessionRow`, which is a prop of the memoized `SessionFolderTree`.
   * Closing over the menu's own state here would re-render every session row on
   * open/close — the exact regression `sidebar-render-containment` locks down.
   */
  const openSessionContextMenu = useCallback((sessionKey: string, x: number, y: number) => {
    setSessionContextMenu({ sessionKey, x, y });
  }, []);

  const closeSessionContextMenu = useCallback(() => setSessionContextMenu(null), []);

  const copyTextToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('chat:sidebar.copied'));
    } catch {
      toast.error(t('chat:sidebar.copyFailed'));
    }
  }, [t]);

  const handleCopySessionWorkPath = useCallback((sessionKey: string) => {
    const workspace = findWorkspaceForSession(sessionKey);
    if (!workspace?.rootPath) {
      toast.error(t('chat:sidebar.noWorkPath'));
      return;
    }
    void copyTextToClipboard(workspace.rootPath);
  }, [copyTextToClipboard, findWorkspaceForSession, t]);

  const handleMoveSessionFromMenu = useCallback(async (sessionKey: string, folderId: string | null) => {
    const workspace = findWorkspaceForSession(sessionKey);
    if (!workspace) return;
    try {
      await moveSessionToFolder(workspace.id, sessionKey, folderId);
    } catch (error) {
      toast.error(String(error instanceof Error ? error.message : error));
    }
  }, [findWorkspaceForSession, moveSessionToFolder]);

  /** One step, as in the move menu: create the stream, then file the session. */
  const handleCreateStreamAndMoveFromMenu = useCallback(async (sessionKey: string, name: string) => {
    const workspace = findWorkspaceForSession(sessionKey);
    const trimmed = name.trim();
    if (!workspace || !trimmed) return;
    try {
      const folder = await createWorkspaceFolder(workspace.id, trimmed, null);
      if (folder?.id) await moveSessionToFolder(workspace.id, sessionKey, folder.id);
    } catch (error) {
      toast.error(String(error instanceof Error ? error.message : error));
    }
  }, [createWorkspaceFolder, findWorkspaceForSession, moveSessionToFolder]);

  /**
   * Fork from the sidebar. `createWorkspaceScopedForkSession` files the branch
   * into the ACTIVE workspace, so a session belonging to another project must
   * become active first — otherwise the fork lands in the wrong project.
   */
  const handleForkSessionFromMenu = useCallback(async (sessionKey: string) => {
    try {
      const workspace = findWorkspaceForSession(sessionKey);
      if (workspace && workspace.id !== activeWorkspaceId) {
        await switchWorkspace(workspace.id);
      }
      await createWorkspaceScopedForkSession(sessionKey);
      await loadSessions();
      await loadHistory();
      navigate('/');
      toast.success(t('chat:composer.fork.toastCreated'));
    } catch (error) {
      toast.error(error instanceof Error && error.message
        ? error.message
        : t('chat:composer.fork.toastFailed'));
    }
  }, [activeWorkspaceId, findWorkspaceForSession, loadHistory, loadSessions, navigate, switchWorkspace, t]);

  /**
   * Handoff needs the draft dialog, which the chat page owns. Switch to the
   * session, then park a one-shot intent the chat page picks up once the switch
   * has landed (src/stores/session-intent.ts).
   */
  const handleHandoffSessionFromMenu = useCallback((sessionKey: string) => {
    requestSessionIntent('handoff', sessionKey);
    if (currentSessionKey !== sessionKey) switchSession(sessionKey);
    navigate('/');
  }, [currentSessionKey, navigate, requestSessionIntent, switchSession]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleRenameSubmit();
    } else if (e.key === 'Escape') {
      handleRenameCancel();
    }
  }, [handleRenameCancel, handleRenameSubmit]);

  const stopResizing = useCallback(() => {
    stopResizeRef.current?.();
    stopResizeRef.current = null;
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (sidebarCollapsed) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners below keep dragging reliable even if capture is unavailable.
      }

      const onMove = (moveEvent: PointerEvent) => {
        setSidebarWidth(moveEvent.clientX);
      };
      const onUp = () => stopResizing();

      stopResizeRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      setIsResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [setSidebarWidth, sidebarCollapsed, stopResizing],
  );

  useEffect(() => stopResizing, [stopResizing]);

  const agentNameById = useMemo(
    () => Object.fromEntries((agents ?? []).map((agent) => [agent.id, agent.name])),
    [agents],
  );

  const timeSessions = useMemo(() => buildSidebarTimeSessions({
    sessions: sidebarSessions,
    currentSessionKey,
    sessionLastActivity,
    workspaces: workspaceProfiles,
  }), [currentSessionKey, sessionLastActivity, sidebarSessions, workspaceProfiles]);

  const workspaceSessionGroups = useMemo(() => buildSidebarWorkspaceSessionGroups({
    sessions: sidebarSessions,
    currentSessionKey,
    sessionLastActivity,
    workspaces: workspaceProfiles,
    includeSyntheticCurrent: messages.length > 0 || !/:session-\d/.test(currentSessionKey),
  }), [currentSessionKey, messages.length, sessionLastActivity, sidebarSessions, workspaceProfiles]);

  const hiddenRoutes = rendererExtensionRegistry.getHiddenRoutes();
  const extraNavItems = rendererExtensionRegistry.getExtraNavItems();

  const coreNavItems = [
    {
      to: '/inbox',
      icon: <CodexInbox className="h-4 w-4" strokeWidth={2} />,
      label: t('sidebar.inbox'),
      badge: inboxPendingCount > 0 ? (inboxPendingCount > 99 ? '99+' : String(inboxPendingCount)) : undefined,
      testId: 'sidebar-nav-inbox',
    },
    { to: '/cron', icon: <CalendarDays className="h-4 w-4" strokeWidth={2} />, label: t('sidebar.scheduled'), testId: 'sidebar-nav-cron' },
    { to: '/knowledge', icon: <FileText className="h-4 w-4" strokeWidth={2} />, label: t('sidebar.knowledge'), testId: 'sidebar-nav-knowledge' },
  ];

  const navItems = coreNavItems.filter((item) => !hiddenRoutes.has(item.to));

  const latestRuntimeRunBySession = useMemo(
    () => buildLatestRuntimeRunBySession(runtimeRuns),
    [runtimeRuns],
  );

  /*
   * Runtime events land on `runtimeRuns` continuously while a run streams, so
   * `buildSidebarSessionStatus` produces a fresh status object per event even
   * when nothing a row displays has changed. `SessionRowMemo` compares
   * `sessionStatus` by SIGNATURE rather than identity (see its comparator), so
   * that churn stops here instead of re-rendering every row per token.
   */
  const rawSessionStatuses = useMemo(() => {
    const next: Record<string, SidebarSessionStatus> = {};
    for (const session of sidebarSessions) {
      const status = buildSidebarSessionStatus({
        session,
        latestRun: latestRuntimeRunBySession.get(session.key) ?? null,
        currentSessionKey,
        activeRunId,
        sending,
        pendingFinal,
        runError,
        dismissedCompletedSignature: dismissedCompletedStatuses[session.key],
      });
      if (!status) continue;
      next[session.key] = status;
    }
    return next;
  }, [
    activeRunId,
    currentSessionKey,
    dismissedCompletedStatuses,
    latestRuntimeRunBySession,
    pendingFinal,
    runError,
    sending,
    sidebarSessions,
  ]);

  const handleSessionDeleteClick = useCallback((key: string, label: string) => {
    setSessionToDelete({ key, label });
    setDeleteDialogOpen(true);
  }, []);

  const handleDismissSessionStatus = useCallback((key: string, signature: string) => {
    setDismissedCompletedStatuses((current) => ({
      ...current,
      [key]: signature,
    }));
  }, []);

  /*
   * Freeze the status map on VALUE, not on how often it was rebuilt.
   *
   * `buildSidebarSessionStatus` allocates a new object per runtime event even
   * when nothing a row displays changed, and `renderSessionRow` closes over
   * this map — so a fresh container per token invalidated `renderSessionRow`,
   * which is a prop of the memoized `SessionFolderTree`, which re-rendered
   * every session row. `signature` already encodes everything a row shows
   * (kind + session + run + timestamp), so a digest over it is exactly the
   * "did anything visible change" question, and `useMemo` keyed on that digest
   * hands back the same object until the answer is yes.
   */
  const sessionStatusDigest = Object.entries(rawSessionStatuses)
    .map(([key, status]) => `${key}=${status.signature}`)
    .sort()
    .join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- digest is the value identity; rawSessionStatuses churns per event by design
  const sessionStatuses = useMemo(() => rawSessionStatuses, [sessionStatusDigest]);

  const sessionStatusKinds = useMemo(() => Object.fromEntries(
    Object.entries(sessionStatuses).map(([key, status]) => [key, status.kind]),
  ) as Record<string, SidebarSessionStatus['kind'] | undefined>, [sessionStatuses]);

  const decorateSessionEntry = useCallback((entry: SidebarSessionEntry): SidebarSessionEntry => {
    const workspace = findWorkspaceForSession(entry.session.key);
    const listState = workspace?.sessionStates?.[entry.session.key]?.sessionList;
    const isUnread = entry.session.key !== currentSessionKey && (
      listState?.unread === true
      || (typeof listState?.lastReadAt === 'number' && entry.activityMs > listState.lastReadAt)
    );
    return {
      ...entry,
      isPinned: listState?.pinned === true,
      isUnread,
      isPriority: isUnread || sessionStatuses[entry.session.key]?.kind === 'waiting',
    };
  }, [currentSessionKey, findWorkspaceForSession, sessionStatuses]);

  const sortedTimeSessions = useMemo(
    () => timeSessions.map(decorateSessionEntry).sort((left, right) => compareSidebarSessionEntries(left, right, sessionSort)),
    [decorateSessionEntry, sessionSort, timeSessions],
  );

  const sortedWorkspaceSessionGroups = useMemo(() => (
    workspaceSessionGroups.map((group) => ({
      ...group,
      sessions: group.sessions.map(decorateSessionEntry).sort((left, right) => compareSidebarSessionEntries(left, right, sessionSort)),
    }))
  ), [decorateSessionEntry, sessionSort, workspaceSessionGroups]);

  const renderSessionRow = useCallback((entry: SidebarSessionEntry, options?: {
    leadingActions?: React.ReactNode;
    forceActionsVisible?: boolean;
  }) => {
    const { session: s } = entry;
    const workspace = findWorkspaceForSession(s.key);
    const sessionBranch = (s as ChatSession & { branch?: string; gitBranch?: string }).branch
      ?? (s as ChatSession & { branch?: string; gitBranch?: string }).gitBranch;
    const workspaceBranch = (workspace as (typeof workspace & { branch?: string; gitBranch?: string }))?.branch
      ?? (workspace as (typeof workspace & { branch?: string; gitBranch?: string }))?.gitBranch;
    return <SessionRowMemo
      key={s.key}
      session={s}
      agentName={agentNameById[getAgentIdFromSessionKey(s.key)] || getAgentIdFromSessionKey(s.key)}
      workspaceName={workspace?.name}
      branch={sessionBranch ?? workspaceBranch}
      activityMs={entry.activityMs}
      isEditing={editingSessionKey === s.key}
      sessionLabel={sessionLabels[s.key] ?? s.label ?? s.displayName ?? s.key}
      sessionStatus={sessionStatuses[s.key] ?? null}
      isPinned={entry.isPinned === true}
      isUnread={entry.isUnread === true}
      editingLabel={editingLabel}
      currentSessionKey={currentSessionKey}
      isOnChat={isOnChat}
      onEditLabel={setEditingLabel}
      onStartRename={handleStartRename}
      onRenameSubmit={handleRenameSubmit}
      onRenameCancel={handleRenameCancel}
      onRenameKeyDown={handleRenameKeyDown}
      onSwitch={switchSession}
      onLoadHistory={loadHistory}
      navigate={navigate}
      onDeleteClick={handleSessionDeleteClick}
      onDismissSessionStatus={handleDismissSessionStatus}
      onMarkRead={markSessionRead}
      onTogglePinned={toggleSessionPinned}
      onOpenContextMenu={openSessionContextMenu}
      leadingActions={options?.leadingActions}
      forceActionsVisible={options?.forceActionsVisible}
    />;
  }, [
    agentNameById, editingSessionKey, editingLabel, sessionLabels, sessionStatuses,
    currentSessionKey, isOnChat, switchSession, loadHistory, navigate,
    handleStartRename, handleRenameSubmit, handleRenameCancel, handleRenameKeyDown,
    handleSessionDeleteClick, handleDismissSessionStatus, findWorkspaceForSession,
    markSessionRead, openSessionContextMenu, toggleSessionPinned,
  ]);

  const sidebarSessionEntries = sessionView === 'time' || (workspaceProfiles.length === 0 && !workspacesLoading)
    ? sortedTimeSessions
    : null;
  /* The heading names what the section is a list OF. In project view that is
     projects — each one is a pinned header with its own conversations under it —
     so the project name never has to be repeated on every row. */
  const isProjectView = sidebarSessionEntries == null;
  const sessionPanelState = startupPhase === 'error'
    ? 'chat-error'
    : workspacesError
      ? 'workspace-error'
      : startupPhase !== 'ready' || workspacesLoading
        ? 'loading'
        : 'empty';
  const sessionPanelMessage = sessionPanelState === 'chat-error'
    ? t('chat:startup.errorTitle')
    : sessionPanelState === 'workspace-error'
      ? t('chat:sidebar.workspaceError')
      : sessionPanelState === 'loading'
        ? t(startupPhase === 'waiting-for-gateway' ? 'chat:startup.waitingForGateway' : 'chat:startup.loadingSessions')
        : t('chat:sidebar.empty');

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        // `codex-sidebar` scopes the ported Codex sidebar recipe
        // (src/styles/codex-sidebar.css) to this subtree.
        'codex-sidebar codex-sidebar-surface relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface-sidebar',
        isResizing ? 'transition-none' : 'transition-[width] duration-180 ease-out',
      )}
      style={{ width: sidebarCollapsed ? 64 : Math.min(360, Math.max(240, sidebarWidth)) }}
    >
      {isMac && (
        <div
          aria-hidden="true"
          data-testid="mac-sidebar-chrome"
          className="drag-region shrink-0"
          style={{ height: MAC_SIDEBAR_CHROME_HEIGHT }}
        />
      )}

      {/* Top Header Toggle — `.sidebar-heading` recipe (50px strip). */}
      <div
        className={cn(
          'sidebar-heading',
          sidebarCollapsed && 'justify-center',
        )}
      >
        {!sidebarCollapsed && (
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <BrandLogo size="sidebar" />
            <span className="truncate whitespace-nowrap text-[17px] font-semibold leading-6 text-foreground/90">
              Verse
            </span>
          </div>
        )}
        <button
          type="button"
          data-testid="sidebar-collapse-toggle"
          aria-label={t(sidebarCollapsed ? 'sidebar.expandSidebar' : 'sidebar.collapseSidebar')}
          className="icon-button no-drag shrink-0"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation — `.primary-nav` recipe: 32px rows, 13.5px/430 labels,
          hover-revealed shortcut hints. */}
      <nav className="primary-nav">
        <button
          type="button"
          data-testid="sidebar-new-chat"
          onClick={handleNewChat}
          className={cn(sidebarCollapsed && 'justify-center px-0')}
        >
          <PenLine className="h-4 w-4" strokeWidth={2} />
          {!sidebarCollapsed && (
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
              {t('sidebar.newTask')}
            </span>
          )}
        </button>

        {navItems.map((item) => (
          <NavItem
            key={item.to}
            {...item}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>

      {/* Session list stays structurally present while the gateway and workspace data hydrate. */}
      {!sidebarCollapsed && (
        <div className="sidebar-scroll">
          <section className={cn('sidebar-section', !sessionSectionOpen && 'section-collapsed')}>
            {/* Official section heading: the label itself is the collapse
                control (`aria-expanded` + trailing chevron), and the organize
                and search actions live in hover-only 22x22 slots. */}
            <div className="section-heading">
              <button
                type="button"
                className="section-label-button"
                data-testid="sidebar-session-section-toggle"
                aria-expanded={sessionSectionOpen}
                onClick={() => setSessionSectionOpen((open) => !open)}
              >
                <span>{t(isProjectView ? 'chat:sidebar.sectionProjects' : 'chat:sidebar.sectionConversations')}</span>
                <OfficialSectionChevron open={sessionSectionOpen} />
              </button>
              <div className="section-heading-actions">
                <button
                  type="button"
                  data-testid="sidebar-session-organize"
                  aria-expanded={sessionOrganizeMenu != null}
                  aria-haspopup="menu"
                  aria-label={t('chat:sidebar.organizeSessions')}
                  title={t('chat:sidebar.organizeSessions')}
                  className="sidebar-session-organize-trigger"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setSessionOrganizeMenu((current) => current ? null : {
                      top: Math.min(window.innerHeight - 8, rect.bottom + 2),
                      left: Math.min(window.innerWidth - 180, Math.max(8, rect.right - 172)),
                    });
                  }}
                >
                  <OfficialMoreIcon />
                </button>
                <button
                  type="button"
                  data-testid="sidebar-add-project"
                  aria-label={t('chat:sidebar.addProject')}
                  title={t('chat:sidebar.addProject')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => void handlePickWorkspaceFolder()}
                >
                  <FolderPlus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-testid="sidebar-session-search"
                  aria-label={t('chat:sidebar.searchSessions')}
                  title={t('chat:sidebar.searchSessions')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setSearchModalOpen(true)}
                >
                  <OfficialSearchIcon />
                </button>
              </div>
            </div>

            {/* Session list.
                No `content-visibility: auto` here: skipping/restoring the whole
                list's layout is what made the scroll height jump when a project
                folded, and it also disables `position: sticky` for the project
                headers inside. Row count in this list is bounded by the session
                list itself, so there is nothing to virtualize away. */}
            <div className={cn('section-list-outer', sessionSectionOpen && 'open')} aria-hidden={!sessionSectionOpen}>
            <div className="task-collection-list">
              {sidebarSessionEntries
                ? sidebarSessionEntries.length > 0
                  ? sidebarSessionEntries.map((entry) => renderSessionRow(entry))
                  : <p className="px-2 py-2 text-xs text-muted-foreground">{sessionPanelMessage}</p>
                 : sortedWorkspaceSessionGroups.length > 0
                   ? sortedWorkspaceSessionGroups.map((group) => {
                  const collapsed = collapsedWorkspaceIds[group.workspace.id] ?? false;
                  // Keep the project as an explicit parent even when there is
                  // only one project. Workgroups belong to this boundary and
                  // should never read as global sidebar groups.
                   const showWorkspaceRow = true;
                  const workspaceCollapsed = showWorkspaceRow && collapsed;
                  return (
                    <div
                      key={group.workspace.id}
                      data-testid={`sidebar-session-project-${group.workspace.id}`}
                      data-state={workspaceCollapsed ? 'collapsed' : 'expanded'}
                    >
                      {showWorkspaceRow && (
                      <SidebarRow
                        className="project-row-wrap"
                        actionsClassName="project-hover-actions"
                        actions={(
                          <>
                            <button
                              type="button"
                              data-testid={`sidebar-project-new-session-${group.workspace.id}`}
                              aria-label={t('chat:sidebar.newSessionInProject', { name: group.workspace.name })}
                              title={t('chat:sidebar.newSessionInProject', { name: group.workspace.name })}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleNewSessionInWorkspace(group.workspace.id);
                              }}
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              data-testid={`sidebar-project-menu-${group.workspace.id}`}
                              aria-label={t('chat:sidebar.projectOptions', { name: group.workspace.name })}
                              title={t('chat:sidebar.projectOptions', { name: group.workspace.name })}
                              className="sidebar-project-menu-trigger"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                setProjectMenu((current) => (current?.workspaceId === group.workspace.id ? null : {
                                  workspaceId: group.workspace.id,
                                  top: Math.min(window.innerHeight - 200, rect.bottom + 2),
                                  left: Math.min(window.innerWidth - 200, Math.max(8, rect.right - 196)),
                                }));
                              }}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      >
                        <button
                          type="button"
                          data-testid={`sidebar-session-project-toggle-${group.workspace.id}`}
                          aria-expanded={!collapsed}
                          onClick={() => toggleWorkspaceGroup(group.workspace.id)}
                          className="project-row"
                        >
                          {collapsed
                            ? <OfficialFolderClosedIcon size={19} />
                            : <OfficialFolderOpenIcon size={19} />}
                          <span>{group.workspace.name}</span>
                        </button>
                      </SidebarRow>
                      )}
                      <div
                        className={cn('project-tasks-outer', !workspaceCollapsed && 'open')}
                        aria-hidden={workspaceCollapsed}
                      >
                        {/* `flat` drops the indent the workspace row's icon
                            column reserved, so group labels can sit on the
                            sidebar's own left edge. */}
                        <div className="project-tasks" data-flat={showWorkspaceRow ? undefined : 'true'}>
                          <SessionFolderTree
                            workspace={group.workspace}
                            sessions={group.sessions}
                            collapsedFolders={collapsedFolderIds}
                            sessionStatusKinds={sessionStatusKinds}
                            sessionSort={sessionSort}
                            onToggleFolder={toggleFolder}
                            onCreateFolder={handleCreateFolder}
                            onRenameFolder={handleRenameFolder}
                            onDeleteFolder={handleDeleteFolder}
                            onMoveSession={handleMoveSessionToFolder}
                            onDropSession={handleDropSessionToGroup}
                            renderSessionRow={renderSessionRow}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
                  : <div className="empty-sidebar-row" role="status" aria-live="polite">
                    {sessionPanelState === 'loading' && <OrbStatus state="loading" label={sessionPanelMessage} className="size-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1">{sessionPanelMessage}</span>
                    {(sessionPanelState === 'chat-error' || sessionPanelState === 'workspace-error') && (
                      <button
                        type="button"
                        className="empty-sidebar-row__action"
                        onClick={() => {
                          if (sessionPanelState === 'chat-error') void hydrateStartup();
                          else void fetchWorkspaces();
                        }}
                      >
                        {t('chat:startup.retry')}
                      </button>
                    )}
                    {sessionPanelState === 'empty' && (
                      <button type="button" className="empty-sidebar-row__action" onClick={handleNewChat}>
                        {t('chat:sidebar.emptyAction')}
                      </button>
                    )}
                  </div>}
            </div>
            </div>
          </section>
        </div>
      )}

      {sessionOrganizeMenu && createPortal(
        <div
          role="menu"
          className="codex-dropdown codex-dropdown--compact sidebar-session-organize-menu"
          style={{ top: sessionOrganizeMenu.top, left: sessionOrganizeMenu.left }}
        >
          <div className="codex-dropdown__label">{t('chat:sidebar.viewBy')}</div>
          {(['project', 'time'] as const).map((view) => {
            const checked = sessionView === view;
            return <button
              key={view}
              type="button"
              role="menuitemradio"
              aria-checked={checked}
              className={cn('codex-dropdown__item radio-item', checked && 'checked')}
              onClick={() => {
                setSessionView(view);
                setSessionOrganizeMenu(null);
              }}
            >
              <span className={cn('codex-dropdown__check', !checked && 'invisible')}><OfficialMenuCheckIcon /></span>
              <span className="codex-dropdown__text">{t(`chat:sessionView.${view}`)}</span>
            </button>;
          })}
          <div className="codex-dropdown__sep" />
          <div className="codex-dropdown__label">{t('chat:sidebar.sortBy')}</div>
          {(['newest', 'active', 'priority'] as const).map((sort) => {
            const checked = sessionSort === sort;
            return <button
              key={sort}
              type="button"
              role="menuitemradio"
              data-testid={`sidebar-session-sort-${sort}`}
              aria-checked={checked}
              className={cn('codex-dropdown__item radio-item', checked && 'checked')}
              onClick={() => {
                setSessionSort(sort);
                setSessionOrganizeMenu(null);
              }}
            >
              <span className={cn('codex-dropdown__check', !checked && 'invisible')}><OfficialMenuCheckIcon /></span>
              <span className="codex-dropdown__text">{t(`chat:sidebar.sort${sort[0].toUpperCase()}${sort.slice(1)}`)}</span>
            </button>;
          })}
        </div>,
        document.body,
      )}

      {projectMenu && createPortal(
        <div
          role="menu"
          className="codex-dropdown codex-dropdown--compact sidebar-project-menu"
          style={{ top: projectMenu.top, left: projectMenu.left }}
        >
          {(() => {
            const ws = workspaceProfiles.find((p) => p.id === projectMenu.workspaceId);
            if (!ws) return null;
            return (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="codex-dropdown__item"
                  onClick={() => {
                    setProjectMenu(null);
                    void handleNewSessionInWorkspace(ws.id);
                  }}
                >
                  <span className="codex-dropdown__icon"><Plus className="h-4 w-4" /></span>
                  <span className="codex-dropdown__text">{t('chat:sidebar.newSessionInProject', { name: ws.name })}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="codex-dropdown__item"
                  onClick={() => {
                    setProjectMenu(null);
                    void handleCreateFolder(ws.id, t('chat:sidebar.untitledFolder'), null);
                  }}
                >
                  <span className="codex-dropdown__icon"><OfficialFolderClosedIcon size={16} /></span>
                  <span className="codex-dropdown__text">{t('chat:sidebar.createFolder')}</span>
                </button>
                <div className="codex-dropdown__sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="codex-dropdown__item"
                  onClick={() => {
                    setProjectMenu(null);
                    void switchWorkspace(ws.id).then(() => navigate('/'));
                  }}
                >
                  <span className="codex-dropdown__icon"><OfficialFolderOpenIcon size={16} /></span>
                  <span className="codex-dropdown__text">{t('chat:sidebar.switchToProject', { name: ws.name })}</span>
                </button>
              </>
            );
          })()}
        </div>,
        document.body,
      )}

      {sessionContextMenu && (() => {
        const workspace = findWorkspaceForSession(sessionContextMenu.sessionKey);
        const listState = workspace?.sessionStates?.[sessionContextMenu.sessionKey]?.sessionList;
        const assignedFolderId = workspace?.sessionFolderAssignments?.[sessionContextMenu.sessionKey] ?? null;
        const folders = workspace?.sessionFolders ?? [];
        const target: SessionContextMenuTarget = {
          sessionKey: sessionContextMenu.sessionKey,
          label: sessionLabels[sessionContextMenu.sessionKey]
            ?? sidebarSessions.find((session) => session.key === sessionContextMenu.sessionKey)?.displayName
            ?? sessionContextMenu.sessionKey,
          x: sessionContextMenu.x,
          y: sessionContextMenu.y,
          isPinned: listState?.pinned === true,
          isUnread: listState?.unread === true,
          workspaceId: workspace?.id ?? null,
          workspacePath: workspace?.rootPath,
          folders,
          currentFolderId: folders.some((folder) => folder.id === assignedFolderId) ? assignedFolderId : null,
        };
        return (
          <SessionContextMenu
            target={target}
            onClose={closeSessionContextMenu}
            onRename={handleStartRename}
            onTogglePinned={toggleSessionPinned}
            onToggleUnread={toggleSessionUnread}
            onMoveToFolder={(sessionKey, folderId) => void handleMoveSessionFromMenu(sessionKey, folderId)}
            onCreateFolderAndMove={(sessionKey, name) => void handleCreateStreamAndMoveFromMenu(sessionKey, name)}
            onFork={(sessionKey) => void handleForkSessionFromMenu(sessionKey)}
            onHandoff={handleHandoffSessionFromMenu}
            onCopyWorkPath={handleCopySessionWorkPath}
            onCopySessionId={(sessionKey) => void copyTextToClipboard(sessionKey)}
            onDelete={handleSessionDeleteClick}
          />
        );
      })()}

      <footer className="sidebar-footer">
        <span data-testid="sidebar-gateway-restarting" data-state={gatewayRestarting ? 'visible' : 'hidden'} className="sr-only" aria-live="polite">
          {gatewayRestarting ? t('common:gateway.restarting') : ''}
        </span>
        <span data-testid="sidebar-storage-low" data-state={storageHealthLow ? 'visible' : 'hidden'} className="sr-only" aria-live="polite">
          {storageHealthLow ? t('common:storageHealth.bannerLow') : ''}
        </span>
        <div className="sidebar-account-control">
          <SidebarSettingsNavItem collapsed={sidebarCollapsed} />
        </div>
        {!sidebarCollapsed && (
          <button
            type="button"
            data-testid="sidebar-footer-menu-trigger"
            className="sidebar-footer-menu-trigger"
            aria-label={t('common:actions.show')}
            aria-haspopup="menu"
            aria-expanded={footerMenu != null}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const menuWidth = 259;
              const maxHeight = Math.max(180, rect.top - 14);
              setFooterMenu((current) => current ? null : {
                bottom: Math.max(12, window.innerHeight - rect.top + 6),
                left: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth)),
                maxHeight,
              });
            }}
          >
            {gatewayRestarting ? <Loader2 className="animate-spin text-yellow-500" /> : storageHealthLow ? <AlertTriangle className="text-red-500" /> : <MoreHorizontal />}
          </button>
        )}
      </footer>

      {footerMenu && createPortal(
        <div role="menu" className="codex-dropdown sidebar-account-menu sidebar-footer-menu" style={{ bottom: footerMenu.bottom, left: footerMenu.left, maxHeight: footerMenu.maxHeight }}>
          <div className="codex-dropdown__item profile-menu-user" role="presentation">
            <span className="codex-dropdown__text">Verse Claw</span>
          </div>
          <button
            type="button"
            role="menuitem"
            data-testid="sidebar-archive"
            className="codex-dropdown__item"
            onClick={() => { setFooterMenu(null); navigate('/settings/archived'); }}
          >
            <span className="codex-dropdown__icon"><OfficialArchiveIcon /></span>
            <span className="codex-dropdown__text">{t('chat:archive.open')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="sidebar-more-browser"
            className="codex-dropdown__item"
            onClick={() => { setFooterMenu(null); navigate('/browser'); }}
          >
            <span className="codex-dropdown__icon"><Laptop /></span>
            <span className="codex-dropdown__text">{t('common:sidebar.browser')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="sidebar-more-code-review"
            className="codex-dropdown__item"
            onClick={() => { setFooterMenu(null); navigate('/code-review'); }}
          >
            <span className="codex-dropdown__icon"><GitCompare /></span>
            <span className="codex-dropdown__text">{t('codeReview:nav')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="sidebar-more-task-ledger"
            className="codex-dropdown__item"
            onClick={() => { setFooterMenu(null); navigate('/task-ledger'); }}
          >
            <span className="codex-dropdown__icon"><ListChecks /></span>
            <span className="codex-dropdown__text">{t('taskLedger:nav')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="sidebar-more-clawgraph"
            className="codex-dropdown__item"
            onClick={() => { setFooterMenu(null); navigate('/clawgraph'); }}
          >
            <span className="codex-dropdown__icon"><Workflow /></span>
            <span className="codex-dropdown__text">{t('clawGraph:nav')}</span>
          </button>
          {extraNavItems.map((item) => (
            <button
              key={item.to}
              type="button"
              role="menuitem"
              data-testid={item.testId}
              className="codex-dropdown__item"
              onClick={() => { setFooterMenu(null); navigate(item.to); }}
            >
              <span className="codex-dropdown__icon"><item.icon /></span>
              <span className="codex-dropdown__text">{item.labelI18nKey ? t(item.labelI18nKey) : item.label}</span>
            </button>
          ))}
          {gatewayRestarting && (
            <div data-state="visible" className="codex-dropdown__item profile-menu-user text-yellow-500" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="codex-dropdown__text">{t('common:gateway.restarting')}</span>
            </div>
          )}
          {storageHealthLow && (
            <button
              type="button"
              role="menuitem"
              data-state="visible"
              className="codex-dropdown__item text-red-500"
              onClick={() => { setFooterMenu(null); navigate('/settings/storage'); }}
            >
              <AlertTriangle className="h-4 w-4" />
              <span className="codex-dropdown__text">{t('common:storageHealth.bannerLow')}</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            data-testid="sidebar-more-observability"
            className="codex-dropdown__item"
            onClick={() => { setFooterMenu(null); navigate('/observability'); }}
          >
            <Activity className="h-4 w-4" />
            <span className="codex-dropdown__text">{t('common:sidebar.observability')}</span>
          </button>
          {devModeUnlocked && (
            <>
              <button
                type="button"
                role="menuitem"
                data-testid="sidebar-more-image-generation"
                className="codex-dropdown__item"
                onClick={() => { setFooterMenu(null); navigate('/image-generation'); }}
              >
                <ImagePlus className="h-4 w-4" />
                <span className="codex-dropdown__text">{t('common:sidebar.imageGeneration')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="sidebar-more-dreams"
                className="codex-dropdown__item"
                onClick={() => { setFooterMenu(null); navigate('/dreams'); }}
              >
                <Moon className="h-4 w-4" />
                <span className="codex-dropdown__text">{t('common:sidebar.openClawDreams')}</span>
              </button>
            </>
          )}
        </div>,
        document.body,
      )}

      {!sidebarCollapsed && (
        <div
          data-testid="sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={220}
          aria-valuemax={420}
          aria-valuenow={sidebarWidth}
          title="Drag to resize sidebar"
          onPointerDown={handleResizePointerDown}
          className="no-drag group absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize select-none"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary/40"
          />
        </div>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={(next) => { if (!next) setDeleteDialogOpen(false); }}>
        <DialogContent
          data-testid="session-delete-dialog"
          className="w-[calc(100%-2rem)] max-w-md rounded-lg border bg-surface-modal p-6 shadow-lg"
        >
          <DialogTitle className="text-lg font-semibold">
            {t('chat:archive.deleteTitle')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {t('chat:archive.deleteMessage', { label: sessionToDelete?.label ?? '' })}
          </DialogDescription>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              data-testid="session-delete-dialog-cancel"
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              data-testid="session-delete-dialog-archive"
              variant="default"
              onClick={async () => {
                const target = sessionToDelete;
                if (!target) return;
                setDeleteDialogOpen(false);
                try {
                  await archiveSession(target.key);
                  if (currentSessionKey === target.key) navigate('/');
                } catch (error) {
                  console.warn('[sidebar] archiveSession failed:', error);
                }
              }}
            >
              <ArchiveIcon className="mr-1 h-3.5 w-3.5" />
              {t('chat:archive.archiveAction')}
            </Button>
            <Button
              data-testid="session-delete-dialog-permanent"
              variant="destructive"
              onClick={async () => {
                const target = sessionToDelete;
                if (!target) return;
                setDeleteDialogOpen(false);
                try {
                  await deleteSession(target.key);
                  if (currentSessionKey === target.key) navigate('/');
                } catch (error) {
                  console.warn('[sidebar] deleteSession failed:', error);
                }
              }}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {t('chat:archive.deletePermanently')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SessionSearchModal
        key={`session-search-${searchModalOpen ? 'open' : 'closed'}`}
        open={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        sessions={sidebarSessions}
        currentSessionKey={currentSessionKey}
        sessionLabels={sessionLabels}
        sessionLastActivity={sessionLastActivity}
        workspaces={workspaceProfiles}
        agentNameById={agentNameById}
        onSwitch={(key) => {
          void switchSession(key);
          void loadHistory(false);
          if (!isOnChat) navigate('/');
        }}
      />
    </aside>
  );
}
