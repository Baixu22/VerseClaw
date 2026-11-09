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
  Check,
  X,
  Loader2,
  Activity,
  GitCompare,
  Workflow,
  Plus,
  FolderPlus,
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
import { useTitleMarquee } from './use-title-marquee';
import { HookSidebar } from '@/components/rareui/HookSidebar';
import { CompletionActivityMenu } from '@/components/rareui/CompletionActivityMenu';
import type { LiveSessionActivity } from '@/components/rareui/completion-activity';
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
import i18n from 'i18next';
import { useSessionIntentStore } from '@/stores/session-intent';
import { activateWorkspaceScopedSession, createFreshWorkspaceSessionKey, createWorkspaceScopedForkSession } from '@/lib/workspace-session';

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
  onSwitch: (key: string) => Promise<boolean>;
  onLoadHistory: (force: boolean) => Promise<void>;
  navigate: (to: string) => void;
  onDismissSessionStatus: (key: string, signature: string) => void;
  onMarkRead: (key: string) => void;
  onTogglePinned: (key: string) => void;
  /**
   * Opens the row's action menu (SessionContextMenu) — from a right-click at
   * the pointer, or from the ⋯ button anchored under it. `onClose` lets the
   * row keep its own "menu open" state without the Sidebar re-rendering every
   * row on open/close.
   */
  onOpenContextMenu: (key: string, x: number, y: number, options?: SessionContextMenuAnchor) => void;
  onCloseContextMenu: () => void;
}

/** How a menu opened from a row is anchored, beyond its x/y. */
type SessionContextMenuAnchor = {
  /** `end`: x is the menu's RIGHT edge (opened from the trailing ⋯ button). */
  align?: 'start' | 'end';
  /** When the menu flips above its anchor, its bottom edge goes here. */
  flipY?: number;
  onClose?: () => void;
};

/** The info card waits for a deliberate dwell, so a passing hover only scrolls the title. */
const SESSION_TOOLTIP_DELAY_MS = 700;

type SidebarSessionStatusKind = 'running' | 'waiting' | 'completed' | 'error' | 'aborted';

type SidebarSessionStatus = {
  kind: SidebarSessionStatusKind;
  matrixState: OrbStatusState;
  labelKey: string;
  signature: string;
  dismissible: boolean;
  /** Start of the run in flight (running/waiting only) — feeds the bell's live clock. */
  startedAt: number | null;
};

/** TF-0423: rows mounted per incremental chunk (bounded DOM for long-lived sidebars). */
const SIDEBAR_SESSION_RENDER_CHUNK = 80;

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
  if (!run || run.status !== 'running') return false;
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
  lastUserMessageAt: number | null;
  runError: string | null;
  dismissedCompletedSignature?: string;
}): SidebarSessionStatus | null {
  const latestRun = input.latestRun;
  const isCurrentSession = input.session.key === input.currentSessionKey;
  const terminalAt = latestRun && latestRun.status !== 'running' && Number.isFinite(latestRun.endedAt)
    ? latestRun.endedAt! : null;
  // A receipt closes its own run, not a newer send or another active run ID.
  const newerSend = isCurrentSession && input.lastUserMessageAt != null
    && (terminalAt == null || input.lastUserMessageAt > terminalAt);
  const currentRunActive = isCurrentSession && (input.sending || input.pendingFinal || input.activeRunId != null)
    && !(terminalAt != null && input.activeRunId === latestRun!.runId && !newerSend);
  // sessions.list can finish before run.ended and leave its running projection cached.
  // Only suppress an older, timestamped projection; a newer owner snapshot still wins.
  const staleSessionProjection = terminalAt != null && Number.isFinite(input.session.updatedAt)
    && input.session.updatedAt! <= terminalAt;
  const sessionStatus = staleSessionProjection ? undefined : input.session.status?.toLowerCase();
  const sessionHasActiveRun = !staleSessionProjection && input.session.hasActiveRun === true;
  const latestRunStatus = latestRun?.status?.toLowerCase();
  const waitingForInput = (currentRunActive && input.pendingFinal)
    || runHasWaitingApproval(latestRun)
    || WAITING_SESSION_STATUSES.has(sessionStatus ?? '')
    || WAITING_SESSION_STATUSES.has(latestRunStatus ?? '');

  let kind: SidebarSessionStatusKind | null = null;
  if (isCurrentSession && input.runError) {
    kind = 'error';
  } else if (waitingForInput || currentRunActive || sessionHasActiveRun || sessionStatus === 'running' || latestRunStatus === 'running') {
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
    // Only a run that is still open has a meaningful start: a stale completed
    // run would make the live clock count from the previous turn.
    startedAt: (kind === 'running' || kind === 'waiting') && latestRun?.status === 'running'
      ? latestRun.startedAt ?? null
      : null,
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
  onDismissSessionStatus,
  onMarkRead,
  onTogglePinned,
  onOpenContextMenu,
  onCloseContextMenu,
}: SessionRowProps) {
  const { t } = useTranslation(['common', 'chat']);
  const sessionStatusLabel = sessionStatus ? t(`chat:${sessionStatus.labelKey}`) : '';
  const isSelected = isOnChat && currentSessionKey === s.key;
  /* Long titles scroll as a seamless loop while the row is hovered (or reached
     by keyboard); see use-title-marquee.ts. */
  const {
    clipRef: titleClipRef,
    textRef: titleTextRef,
    start: startTitleMarquee,
    stop: stopTitleMarquee,
  } = useTitleMarquee();
  /* The row owns whether ITS menu is open, so opening one never re-renders the
     whole list. The Sidebar calls `onClose` back when the menu goes away. */
  const [menuOpen, setMenuOpen] = useState(false);

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
  const closeMenu = () => setMenuOpen(false);

  return (
    <Tooltip delayDuration={SESSION_TOOLTIP_DELAY_MS}>
    <SidebarRow
      className="task-row"
      hookKey={s.key}
      selected={isSelected}
      actionsClassName="task-hover-actions"
      onPointerEnter={startTitleMarquee}
      onPointerLeave={stopTitleMarquee}
      /* Right-click anywhere on the row opens the same menu as the ⋯ button,
         at the pointer. Everything not worth a permanent button lives there. */
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuOpen(true);
        onOpenContextMenu(s.key, event.clientX, event.clientY, { onClose: closeMenu });
      }}
      /* Two controls, one job each: pin is the only action worth a single
         click; ⋯ is the visible way into everything else (rename, move,
         unread, fork, handoff, copy, archive, delete). */
      actions={(
        <>
          <button
            type="button"
            data-testid={`sidebar-session-pin-${s.key}`}
            aria-label={t(isPinned ? 'chat:sidebar.unpinSession' : 'chat:sidebar.pinSession')}
            aria-pressed={isPinned}
            title={t(isPinned ? 'chat:sidebar.unpinSession' : 'chat:sidebar.pinSession')}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePinned(s.key);
            }}
            className={cn('task-hover-btn', isPinned && 'task-hover-btn--active')}
          >
            <Pin />
          </button>
          <button
            type="button"
            data-testid={`sidebar-session-more-${s.key}`}
            aria-label={t('chat:sidebar.moreActions')}
            title={t('chat:sidebar.moreActions')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              if (menuOpen) {
                onCloseContextMenu();
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              setMenuOpen(true);
              onOpenContextMenu(s.key, rect.right, rect.bottom + 4, {
                align: 'end',
                flipY: rect.top - 4,
                onClose: closeMenu,
              });
            }}
            className="task-hover-btn sidebar-session-more-trigger"
          >
            <OfficialMoreIcon size={16} />
          </button>
        </>
      )}
      /* While this row's menu is open its controls must not fade out from under
         the popover, and the row keeps its highlight so the menu's target is
         unambiguous. */
      data-force-actions={menuOpen ? 'true' : undefined}
    >
      <TooltipTrigger asChild>
        <button
        type="button"
        data-testid={`sidebar-session-${s.key}`}
        onClick={async () => {
          onMarkRead(s.key);
          if (currentSessionKey === s.key) {
            void onLoadHistory(false);
          } else if (!await onSwitch(s.key)) return;
          navigate('/');
        }}
        onDoubleClick={() => onStartRename(s.key, sessionLabel)}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) startTitleMarquee();
        }}
        onBlur={stopTitleMarquee}
        className="task-select"
      >
        {/* One line, one title. `task-title` is the layout box (it starts at
            the row's indent, aligned with the project name); `__clip` reaches
            a few px further left so a scrolling title fades out instead of
            being cut, and `__text` is the layer that moves. */}
        <span className={cn('task-title', isUnread && 'task-title--unread')}>
          <span ref={titleClipRef} className="task-title__clip">
            <span ref={titleTextRef} className="task-title__text" data-text={sessionLabel}>{sessionLabel}</span>
          </span>
        </span>
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
            title={sessionStatus.dismissible ? t('chat:sessionStatus.dismissCompleted') : sessionStatusLabel}
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
          <div className="min-w-0 break-words text-sm font-medium leading-5">{sessionLabel}</div>
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
  const { sidebarCollapsed, setSidebarCollapsed, sidebarWidth, setSidebarWidth } = useSettingsStore(useShallow((state) => ({
    sidebarCollapsed: state.sidebarCollapsed,
    setSidebarCollapsed: state.setSidebarCollapsed,
    sidebarWidth: state.sidebarWidth,
    setSidebarWidth: state.setSidebarWidth,
  })));
  const [isResizing, setIsResizing] = useState(false);
  const stopResizeRef = useRef<(() => void) | null>(null);

  const { sessions, messages, currentSessionKey, sessionLabels, sessionLastActivity, runtimeRuns, activeRunId, sending, pendingFinal, lastUserMessageAt, runError, startupPhase } = useChatStore(useShallow((s) => ({
    sessions: s.sessions,
    messages: s.messages,
    currentSessionKey: s.currentSessionKey,
    sessionLabels: s.sessionLabels,
    sessionLastActivity: s.sessionLastActivity,
    runtimeRuns: s.runtimeRuns,
    activeRunId: s.activeRunId,
    sending: s.sending,
    pendingFinal: s.pendingFinal,
    lastUserMessageAt: s.lastUserMessageAt,
    runError: s.runError,
    startupPhase: s.startupPhase,
  })));
  const switchSession = useChatStore((s) => s.switchSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const archiveSession = useChatStore((s) => s.archiveSession);
  const restoreSession = useChatStore((s) => s.restoreSession);
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
        && !session.sessionId
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
  /* The delete target outlives the dialog on purpose: the closing animation
     still shows its name, and the next request replaces it. It used to be
     cleared by a 160ms timer, which raced the 130ms exit animation under load
     and blanked the dialog's text mid-close. The actions read it only while the
     dialog is open. */
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingSessionKey, setEditingSessionKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [sessionView, setSessionView] = useState<'project' | 'time'>('project');
  const [sessionSort, setSessionSort] = useState<SidebarSessionSort>('newest');
  /* Official sections are collapsible; conversations default to open so the
     restored session list is visible without an extra click. */
  const [sessionSectionOpen, setSessionSectionOpen] = useState(true);
  /*
   * TF-0423: mounting hundreds of session rows made the renderer produce >50 ms
   * long tasks while idle and when opening a session (measured: 6-8 tasks per
   * 2.5 s with 333 rows vs 0-1 with 20 rows; CSS, content-visibility, memo
   * comparators and object identity were all ruled out). Mount rows
   * incrementally instead: a chunk per scroll-to-bottom, so the mounted DOM
   * stays bounded while every session remains reachable.
   */
  const [sessionRenderLimit, setSessionRenderLimit] = useState(SIDEBAR_SESSION_RENDER_CHUNK);
  const sessionRenderResetKey = `${sessionView}:${activeWorkspaceId ?? ''}:${sessions.length}:${currentSessionKey}`;
  useEffect(() => {
    setSessionRenderLimit(SIDEBAR_SESSION_RENDER_CHUNK);
  }, [sessionRenderResetKey]);
  const handleSessionListScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight < element.scrollHeight - 160) return;
    setSessionRenderLimit((current) => Math.min(current + SIDEBAR_SESSION_RENDER_CHUNK, sessions.length));
  }, [sessions.length]);
  const [sessionOrganizeMenu, setSessionOrganizeMenu] = useState<{ top: number; left: number } | null>(null);
  const [footerMenu, setFooterMenu] = useState<{ bottom: number; left: number; maxHeight: number } | null>(null);
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Record<string, boolean>>({});
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState<{ workspaceId: string; top: number; left: number } | null>(null);
  /* Anchor for the conversation action menu (right-click or the row's ⋯).
     Kept as the anchor only: everything the menu renders is derived at render
     time, so a session that changes while the menu is open cannot show stale
     state. */
  const [sessionContextMenu, setSessionContextMenu] = useState<{
    sessionKey: string;
    x: number;
    y: number;
    align?: 'start' | 'end';
    flipY?: number;
  } | null>(null);
  /* The open row's "my menu closed" callback. A ref, not state: it is only
     ever called from event handlers, and storing it must not re-render. */
  const sessionContextMenuCloseRef = useRef<(() => void) | null>(null);
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
      || Object.hasOwn(profile.coordinatorBindings ?? {}, sessionKey)
      || Object.values(profile.agentBindings ?? {}).some((binding) => binding.sessionKey === sessionKey)
    )) ?? null
  ), [workspaceProfiles]);

  const selectSidebarSession = useCallback(async (sessionKey: string) => {
    const workspace = findWorkspaceForSession(sessionKey);
    try {
      if (workspace) return await activateWorkspaceScopedSession(workspace.id, sessionKey);
      switchSession(sessionKey);
      return true;
    } catch {
      toast.error(i18n.t('chat:projectEntry.unavailable'));
      return false;
    }
  }, [findWorkspaceForSession, switchSession]);

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
   * Conversation action menu (right-click, or the row's ⋯ button).
   *
   * Both callbacks MUST keep a stable identity: they are threaded into
   * `renderSessionRow`, which is a prop of the memoized `SessionFolderTree`.
   * Closing over the menu's own state here would re-render every session row on
   * open/close — the exact regression `sidebar-render-containment` locks down.
   * The row that opened the menu is told it closed through its own callback.
   */
  const openSessionContextMenu = useCallback((
    sessionKey: string,
    x: number,
    y: number,
    options?: { align?: 'start' | 'end'; flipY?: number; onClose?: () => void },
  ) => {
    // Opening a menu for another row closes the previous row's state first.
    sessionContextMenuCloseRef.current?.();
    sessionContextMenuCloseRef.current = options?.onClose ?? null;
    setSessionContextMenu({ sessionKey, x, y, align: options?.align, flipY: options?.flipY });
  }, []);

  const closeSessionContextMenu = useCallback(() => {
    sessionContextMenuCloseRef.current?.();
    sessionContextMenuCloseRef.current = null;
    setSessionContextMenu(null);
  }, []);

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

  /**
   * Archive is reversible (Settings › Archived, or the toast's Undo), so it is a
   * single click in the menu. Permanent deletion keeps its confirmation dialog.
   */
  const handleArchiveSessionFromMenu = useCallback(async (sessionKey: string, label: string) => {
    // Record where the session lived, so the archive lists it under its project
    // and workgroup and the host scopes its resource cleanup to that project.
    const workspace = findWorkspaceForSession(sessionKey);
    try {
      await archiveSession(sessionKey, {
        workspaceId: workspace?.id ?? null,
        folderId: workspace?.sessionFolderAssignments?.[sessionKey] ?? null,
      });
    } catch {
      toast.error(t('chat:sidebar.archiveFailed'));
      return;
    }
    if (currentSessionKey === sessionKey) navigate('/');
    toast.success(t('chat:sidebar.archivedToast', { label }), {
      action: {
        label: t('chat:sidebar.undo'),
        onClick: () => void restoreSession(sessionKey),
      },
    });
  }, [archiveSession, currentSessionKey, findWorkspaceForSession, navigate, restoreSession, t]);

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
        lastUserMessageAt,
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
    lastUserMessageAt,
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

  const renderSessionRow = useCallback((entry: SidebarSessionEntry) => {
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
      onSwitch={selectSidebarSession}
      onLoadHistory={loadHistory}
      navigate={navigate}
      onDismissSessionStatus={handleDismissSessionStatus}
      onMarkRead={markSessionRead}
      onTogglePinned={toggleSessionPinned}
      onOpenContextMenu={openSessionContextMenu}
      onCloseContextMenu={closeSessionContextMenu}
    />;
  }, [
    agentNameById, editingSessionKey, editingLabel, sessionLabels, sessionStatuses,
    currentSessionKey, isOnChat, selectSidebarSession, loadHistory, navigate,
    handleStartRename, handleRenameSubmit, handleRenameCancel, handleRenameKeyDown,
    handleDismissSessionStatus, findWorkspaceForSession,
    markSessionRead, openSessionContextMenu, closeSessionContextMenu, toggleSessionPinned,
  ]);

  /*
   * What the header bell shows as "running now". Derived from the same
   * value-frozen status map as the row orbs, so it changes only when a row's
   * visible state does — not once per streamed token.
   */
  const liveSessionActivity = useMemo<LiveSessionActivity[]>(() => {
    const labelOf = (key: string) => {
      const session = sidebarSessions.find((entry) => entry.key === key);
      return sessionLabels[key] ?? session?.label ?? session?.displayName ?? key;
    };
    return Object.entries(sessionStatuses)
      .filter(([, status]) => status.kind === 'running' || status.kind === 'waiting')
      .map(([sessionKey, status]) => ({
        sessionKey,
        label: labelOf(sessionKey),
        state: status.kind === 'waiting' ? 'waiting' as const : 'running' as const,
        startedAt: status.startedAt,
      }))
      // Sessions waiting on the user first, then the most recently started.
      .sort((left, right) => (left.state === right.state
        ? (right.startedAt ?? 0) - (left.startedAt ?? 0)
        : left.state === 'waiting' ? -1 : 1));
  }, [sessionLabels, sessionStatuses, sidebarSessions]);

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
          sidebarCollapsed && 'sidebar-heading--collapsed justify-center',
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
        <div className="sidebar-heading-actions ml-auto flex shrink-0 items-center gap-[2px]">
          <CompletionActivityMenu liveSessions={liveSessionActivity} />
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
        <div className="sidebar-scroll" onScroll={handleSessionListScroll}>
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
                headers inside. Each workspace shares a mount budget across its
                workgroups and grows it on scroll-to-bottom. */}
            <div className={cn('section-list-outer', sessionSectionOpen && 'open')} aria-hidden={!sessionSectionOpen}>
            <HookSidebar className="task-collection-list" activeKey={currentSessionKey}>
              {sidebarSessionEntries
                ? sidebarSessionEntries.length > 0
                  ? sidebarSessionEntries.slice(0, sessionRenderLimit).map((entry) => renderSessionRow(entry))
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
                      /* The selection hook branches out of this project's
                         folder icon into its current session (HookSidebar). */
                      data-hook-scope="true"
                    >
                      {showWorkspaceRow && (
                      <SidebarRow
                        className="project-row-wrap"
                        data-hook-origin="true"
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
                              <OfficialMoreIcon size={16} />
                            </button>
                          </>
                        )}
                      >
                        <div className="project-row">
                          <button type="button" data-testid={`sidebar-session-project-toggle-${group.workspace.id}`}
                            aria-expanded={!collapsed} aria-label={t('chat:projectEntry.toggle', { name: group.workspace.name })}
                            onClick={() => toggleWorkspaceGroup(group.workspace.id)} className="project-disclosure">
                          {collapsed
                            ? <OfficialFolderClosedIcon size={19} />
                            : <OfficialFolderOpenIcon size={19} />}
                          </button>
                          <button type="button" className="project-name" data-testid={`sidebar-project-open-${group.workspace.id}`}
                            onClick={() => navigate(`/projects/${encodeURIComponent(group.workspace.id)}`)}>{group.workspace.name}</button>
                        </div>
                      </SidebarRow>
                      )}
                      <div
                        className={cn('project-tasks-outer', !workspaceCollapsed && 'open')}
                        aria-hidden={workspaceCollapsed}
                        inert={workspaceCollapsed}
                      >
                        {/* `flat` drops the indent the workspace row's icon
                            column reserved, so group labels can sit on the
                            sidebar's own left edge. */}
                        <div className="project-tasks" data-flat={showWorkspaceRow ? undefined : 'true'}>
                          <SessionFolderTree
                            workspace={group.workspace}
                            currentSessionKey={currentSessionKey}
                            sessions={group.sessions}
                            renderLimit={workspaceCollapsed ? 0 : Math.min(sessionRenderLimit, group.sessions.length)}
                            collapsedFolders={collapsedFolderIds}
                            sessionStatusKinds={sessionStatusKinds}
                            sessionSort={sessionSort}
                            onToggleFolder={toggleFolder}
                            onCreateFolder={handleCreateFolder}
                            onRenameFolder={handleRenameFolder}
                            onDeleteFolder={handleDeleteFolder}
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
            </HookSidebar>
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
          align: sessionContextMenu.align,
          flipY: sessionContextMenu.flipY,
          isPinned: listState?.pinned === true,
          isUnread: listState?.unread === true,
          workspaceId: workspace?.id ?? null,
          workspacePath: workspace?.rootPath,
          folders,
          currentFolderId: folders.some((folder) => folder.id === assignedFolderId) ? assignedFolderId : null,
        };
        return (
          <SessionContextMenu
            /* A new target is a new menu: page and draft state never carry over. */
            key={sessionContextMenu.sessionKey}
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
            onArchive={(sessionKey, label) => void handleArchiveSessionFromMenu(sessionKey, label)}
            onDelete={handleSessionDeleteClick}
          />
        );
      })()}

      <footer className="sidebar-footer">
        <span data-testid="sidebar-gateway-restarting" data-state={gatewayRestarting ? 'visible' : 'hidden'} className="sr-only" aria-live="polite">
          {gatewayRestarting ? t('common:gateway.restarting') : ''}
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
            {gatewayRestarting ? <Loader2 className="animate-spin text-yellow-500" /> : <MoreHorizontal />}
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
          void selectSidebarSession(key).then((selected) => {
            if (selected && !isOnChat) navigate('/');
          });
        }}
      />
    </aside>
  );
}
