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
  Clock,
  Settings as SettingsIcon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Terminal,
  ExternalLink,
  Trash2,
  Archive as ArchiveIcon,
  Pencil,
  Check,
  X,
  ImagePlus,
  Moon,
  Loader2,
  Activity,
  BookOpen,
  CheckSquare,
  Workflow,
  GitCompare,
  Inbox,
  AlertTriangle,
  Globe2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DotMatrix, type DotMatrixState } from '@/components/assistant-ui/dot-matrix';
import { isGatewayRestarting } from '@/lib/gateway-status';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { useSettingsStore } from '@/stores/settings';
import { useUiOverlay, useUiVersion } from './ui-overlay-context';
import { useChatStore, type ChatRuntimeRunState, type ChatSession } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useWorkspacesStore } from '@/stores/workspaces';
import { useStorageHealthStore } from '@/stores/storage-health';
import {
  buildLatestRuntimeRunBySession,
  buildSidebarTimeSessions,
  buildSidebarWorkspaceSessionGroups,
  type SidebarSessionEntry,
} from './session-buckets';
import { SessionSearchModal } from './SessionSearchModal';
import { SessionFolderTree } from './SessionFolderTree';
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
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { hostApi } from '@/lib/host-api';
import { SIDEBAR_COLLAPSED_WIDTH, MAC_SIDEBAR_CHROME_HEIGHT } from '@shared/sidebar-layout';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { useNewChatAction } from './use-new-chat-action';

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
              <Badge variant="secondary" className="ml-auto shrink-0">
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
  isEditing: boolean;
  sessionLabel: string;
  sessionStatus?: SidebarSessionStatus | null;
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
  leadingActions?: React.ReactNode;
  forceActionsVisible?: boolean;
}

type SidebarSessionStatusKind = 'running' | 'waiting' | 'completed' | 'error' | 'aborted';

type SidebarSessionStatus = {
  kind: SidebarSessionStatusKind;
  matrixState: DotMatrixState;
  labelKey: string;
  signature: string;
  dismissible: boolean;
};

const COMPLETED_SESSION_STATUSES = new Set(['completed', 'success', 'done', 'finished']);
const ERROR_SESSION_STATUSES = new Set(['failed', 'error', 'killed', 'timeout']);
const ABORTED_SESSION_STATUSES = new Set(['aborted', 'cancelled', 'canceled']);

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

  let kind: SidebarSessionStatusKind | null = null;
  if (isCurrentSession && input.runError) {
    kind = 'error';
  } else if (currentRunActive || input.session.hasActiveRun === true || sessionStatus === 'running' || latestRunStatus === 'running') {
    kind = (isCurrentSession && input.pendingFinal) || runHasWaitingApproval(latestRun) ? 'waiting' : 'running';
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

  const matrixStateByKind: Record<SidebarSessionStatusKind, DotMatrixState> = {
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
  isEditing,
  sessionLabel,
  sessionStatus,
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
  leadingActions,
  forceActionsVisible = false,
}: SessionRowProps) {
  const { t } = useTranslation(['common', 'chat']);
  const sessionStatusLabel = sessionStatus ? t(`chat:${sessionStatus.labelKey}`) : '';
  const isSelected = isOnChat && currentSessionKey === s.key;

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

  return (
    <SidebarRow
      className="task-row"
      selected={isSelected}
      actionsClassName="task-hover-actions"
      actions={(
        <>
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
      <button
        type="button"
        data-testid={`sidebar-session-${s.key}`}
        onClick={() => {
          if (currentSessionKey === s.key) {
            void onLoadHistory(false);
          } else {
            onSwitch(s.key);
          }
          navigate('/');
        }}
        onDoubleClick={() => onStartRename(s.key, sessionLabel)}
        className="task-select"
        /* Agent name is not inline chrome in the official row; it rides the
           row tooltip so the title keeps the full width. */
        title={`${sessionLabel} — ${agentName}`}
      >
        {/* Official row: the title is the first child so it receives the
            flex/ellipsis/fade contract. Runtime state trails it, replacing the
            reference's task-progress spinner slot, and is only present when a
            session actually has state — idle rows reserve nothing. */}
        <span>{sessionLabel}</span>
        {sessionStatus && (
          <span
            data-testid={`sidebar-session-status-${s.key}`}
            data-state={sessionStatus.kind}
            role="status"
            aria-label={sessionStatusLabel}
            title={sessionStatus.dismissible
              ? t('chat:sessionStatus.dismissCompleted')
              : sessionStatusLabel}
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
            <DotMatrix state={sessionStatus.matrixState} label={sessionStatusLabel} className="size-3.5" />
          </span>
        )}
      </button>
    </SidebarRow>
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
  const uiVersion = useUiVersion();
  const isUiV2 = uiVersion === 'v2' && window.electron?.platform === 'win32';
  const { sidebarCollapsed, setSidebarCollapsed, sidebarWidth, setSidebarWidth, devModeUnlocked } = useSettingsStore(useShallow((state) => ({
    sidebarCollapsed: state.sidebarCollapsed,
    setSidebarCollapsed: state.setSidebarCollapsed,
    sidebarWidth: state.sidebarWidth,
    setSidebarWidth: state.setSidebarWidth,
    devModeUnlocked: state.devModeUnlocked,
  })));
  const [isResizing, setIsResizing] = useState(false);
  const stopResizeRef = useRef<(() => void) | null>(null);

  const { sessions, currentSessionKey, sessionLabels, sessionLastActivity, runtimeRuns, activeRunId, sending, pendingFinal, runError, startupPhase } = useChatStore(useShallow((s) => ({
    sessions: s.sessions,
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
  const hydrateStartup = useChatStore((s) => s.hydrateStartup);
  const handleNewChat = useNewChatAction();
  const workspaceProfiles = useWorkspacesStore((s) => s.profiles);
  const workspacesLoading = useWorkspacesStore((s) => s.loading);
  const workspacesError = useWorkspacesStore((s) => s.error);
  const fetchWorkspaces = useWorkspacesStore((s) => s.fetchWorkspaces);
  const createWorkspaceFolder = useWorkspacesStore((s) => s.createFolder);
  const renameWorkspaceFolder = useWorkspacesStore((s) => s.renameFolder);
  const deleteWorkspaceFolder = useWorkspacesStore((s) => s.deleteFolder);
  const moveSessionToFolder = useWorkspacesStore((s) => s.moveSessionToFolder);
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
  const isOnChat = useLocation().pathname === '/';

  const openControlUi = async (view?: 'dreams', label = 'OpenClaw Page') => {
    try {
      // P4-001: Main opens Control UI with token in-process; Renderer never receives plaintext token/URL.
      const result = await hostApi.gateway.controlUi(view ? { view, open: true } : { open: true });
      if (!result.success || result.opened === false) {
        console.error(`Failed to open ${label}:`, result.error);
      }
    } catch (err) {
      console.error(`Error opening ${label}:`, err);
    }
  };

  const openDevConsole = async () => {
    await openControlUi(undefined, 'OpenClaw Page');
  };

  const { t } = useTranslation(['common', 'chat', 'taskLedger', 'clawGraph', 'knowledge', 'codeReview']);
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingSessionKey, setEditingSessionKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [sessionView, setSessionView] = useState<'project' | 'time'>('project');
  /* Official sections are collapsible; conversations default to open so the
     restored session list is visible without an extra click. */
  const [sessionSectionOpen, setSessionSectionOpen] = useState(true);
  const [sessionOrganizeMenu, setSessionOrganizeMenu] = useState<{ top: number; left: number } | null>(null);
  const [footerMenu, setFooterMenu] = useState<{ top: number; left: number } | null>(null);
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Record<string, boolean>>({});
  const [searchModalOpen, setSearchModalOpen] = useState(false);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (!sessionOrganizeMenu && !footerMenu) return;
    const close = (event: PointerEvent) => {
      if ((event.target as Element).closest?.('.sidebar-session-organize-menu,.sidebar-session-organize-trigger,.sidebar-footer-menu,.sidebar-footer-menu-trigger')) return;
      setSessionOrganizeMenu(null);
      setFooterMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSessionOrganizeMenu(null);
        setFooterMenu(null);
      }
    };
    addEventListener('pointerdown', close);
    addEventListener('keydown', escape);
    return () => {
      removeEventListener('pointerdown', close);
      removeEventListener('keydown', escape);
    };
  }, [footerMenu, sessionOrganizeMenu]);

  useEffect(() => {
    if (deleteDialogOpen || !sessionToDelete) return;
    const timer = window.setTimeout(() => setSessionToDelete(null), 160);
    return () => window.clearTimeout(timer);
  }, [deleteDialogOpen, sessionToDelete]);

  const handleStartRename = (key: string, currentLabel: string) => {
    setEditingSessionKey(key);
    setEditingLabel(currentLabel);
  };

  const handleRenameSubmit = async () => {
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
  };

  const handleRenameCancel = () => {
    setEditingSessionKey(null);
  };

  const toggleWorkspaceGroup = useCallback((workspaceId: string) => {
    setCollapsedWorkspaceIds((current) => ({
      ...current,
      [workspaceId]: !current[workspaceId],
    }));
  }, []);

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolderIds((current) => ({
      ...current,
      [folderId]: !current[folderId],
    }));
  }, []);

  const handleCreateFolder = useCallback(async (workspaceId: string, name: string, parentId: string | null) => {
    await createWorkspaceFolder(workspaceId, name, parentId);
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

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleRenameSubmit();
    } else if (e.key === 'Escape') {
      handleRenameCancel();
    }
  };

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
    sessions,
    currentSessionKey,
    sessionLastActivity,
    workspaces: workspaceProfiles,
  }), [currentSessionKey, sessions, sessionLastActivity, workspaceProfiles]);

  const workspaceSessionGroups = useMemo(() => buildSidebarWorkspaceSessionGroups({
    sessions,
    currentSessionKey,
    sessionLastActivity,
    workspaces: workspaceProfiles,
  }), [currentSessionKey, sessions, sessionLastActivity, workspaceProfiles]);

  const hiddenRoutes = rendererExtensionRegistry.getHiddenRoutes();
  const extraNavItems = rendererExtensionRegistry.getExtraNavItems();

  const coreNavItems = [
    { to: '/cron', icon: <Clock className="h-4 w-4" strokeWidth={2} />, label: t('sidebar.cronTasks'), testId: 'sidebar-nav-cron' },
    { to: '/remote-tasks', icon: <Inbox className="h-4 w-4" strokeWidth={2} />, label: t('sidebar.remoteTasks'), testId: 'sidebar-nav-remote-tasks' },
    { to: '/task-ledger', icon: <CheckSquare className="h-4 w-4" strokeWidth={2} />, label: t('taskLedger:nav'), testId: 'sidebar-nav-task-ledger' },
    { to: '/clawgraph', icon: <Workflow className="h-4 w-4" strokeWidth={2} />, label: t('clawGraph:nav'), testId: 'sidebar-nav-clawgraph' },
    { to: '/code-review', icon: <GitCompare className="h-4 w-4" strokeWidth={2} />, label: t('codeReview:nav'), testId: 'sidebar-nav-code-review' },
    { to: '/knowledge', icon: <BookOpen className="h-4 w-4" strokeWidth={2} />, label: t('knowledge:nav'), testId: 'sidebar-nav-knowledge' },
    { to: '/browser', icon: <Globe2 className="h-4 w-4" strokeWidth={2} />, label: t('common:sidebar.browser'), testId: 'sidebar-nav-browser' },
    ...(devModeUnlocked
      ? [
        { to: '/observability', icon: <Activity className="h-4 w-4" strokeWidth={2} />, label: 'Observability', testId: 'sidebar-nav-observability' },
        { to: '/image-generation', icon: <ImagePlus className="h-4 w-4" strokeWidth={2} />, label: t('common:sidebar.imageGeneration'), testId: 'sidebar-nav-image-generation' },
        { to: '/dreams', icon: <Moon className="h-4 w-4" strokeWidth={2} />, label: t('common:sidebar.openClawDreams'), testId: 'sidebar-nav-dreams' },
      ]
      : []),
  ];

  const navItems = [
    ...coreNavItems.filter((item) => !hiddenRoutes.has(item.to)),
    ...extraNavItems.map((item) => ({
      to: item.to,
      icon: <item.icon className="h-4 w-4" strokeWidth={2} />,
      label: item.labelI18nKey ? t(item.labelI18nKey) : item.label,
      testId: item.testId,
    })),
  ];

  const latestRuntimeRunBySession = useMemo(
    () => buildLatestRuntimeRunBySession(runtimeRuns),
    [runtimeRuns],
  );

  const sessionStatuses = useMemo(() => {
    const entries = sessions
      .map((session) => [
        session.key,
        buildSidebarSessionStatus({
          session,
          latestRun: latestRuntimeRunBySession.get(session.key) ?? null,
          currentSessionKey,
          activeRunId,
          sending,
          pendingFinal,
          runError,
          dismissedCompletedSignature: dismissedCompletedStatuses[session.key],
        }),
      ] as const)
      .filter((entry): entry is readonly [string, SidebarSessionStatus] => entry[1] != null);
    return Object.fromEntries(entries);
  }, [
    activeRunId,
    currentSessionKey,
    dismissedCompletedStatuses,
    latestRuntimeRunBySession,
    pendingFinal,
    runError,
    sending,
    sessions,
  ]);

  const handleDismissSessionStatus = useCallback((key: string, signature: string) => {
    setDismissedCompletedStatuses((current) => ({
      ...current,
      [key]: signature,
    }));
  }, []);

  const sessionStatusKinds = useMemo(() => Object.fromEntries(
    Object.entries(sessionStatuses).map(([key, status]) => [key, status.kind]),
  ) as Record<string, SidebarSessionStatus['kind'] | undefined>, [sessionStatuses]);

  const renderSessionRow = useCallback((entry: SidebarSessionEntry, options?: {
    leadingActions?: React.ReactNode;
    forceActionsVisible?: boolean;
  }) => {
    const { session: s } = entry;
    return <SessionRowMemo
      key={s.key}
      session={s}
      agentName={agentNameById[getAgentIdFromSessionKey(s.key)] || getAgentIdFromSessionKey(s.key)}
      isEditing={editingSessionKey === s.key}
      sessionLabel={sessionLabels[s.key] ?? s.label ?? s.displayName ?? s.key}
      sessionStatus={sessionStatuses[s.key] ?? null}
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
      onDeleteClick={(key: string, label: string) => {
        setSessionToDelete({ key, label });
        setDeleteDialogOpen(true);
      }}
      onDismissSessionStatus={handleDismissSessionStatus}
      leadingActions={options?.leadingActions}
      forceActionsVisible={options?.forceActionsVisible}
    />;
  }, [
    agentNameById, editingSessionKey, editingLabel, sessionLabels, sessionStatuses,
    currentSessionKey, isOnChat, switchSession, loadHistory, navigate,
    handleStartRename, handleRenameSubmit, handleRenameCancel, handleRenameKeyDown,
    handleDismissSessionStatus,
  ]);

  const sidebarSessionEntries = sessionView === 'time' || (workspaceProfiles.length === 0 && sessions.length > 0 && !workspacesLoading)
    ? timeSessions
    : null;
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
        isUiV2 && 'bg-surface-sidebar/90 backdrop-blur-[24px] backdrop-saturate-[1.3] dark:bg-surface-sidebar/76',
        isResizing ? 'transition-none' : 'transition-[width] duration-200 ease-out',
      )}
      style={{ width: sidebarCollapsed ? (isUiV2 ? 64 : SIDEBAR_COLLAPSED_WIDTH) : (isUiV2 ? Math.min(360, Math.max(240, sidebarWidth)) : sidebarWidth) }}
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
          <Plus strokeWidth={2} />
          {!sidebarCollapsed && (
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
              {t('sidebar.newChat')}
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
                <span>{t('chat:sidebar.sectionConversations')}</span>
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

            {/* Session list */}
            <div className={cn('section-list-outer', sessionSectionOpen && 'open')} aria-hidden={!sessionSectionOpen}>
            <div className="task-collection-list" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 31px' }}>
              {sidebarSessionEntries
                ? sidebarSessionEntries.length > 0
                  ? sidebarSessionEntries.map((entry) => renderSessionRow(entry))
                  : <p className="px-2 py-2 text-xs text-muted-foreground">{sessionPanelMessage}</p>
                : workspaceSessionGroups.length > 0
                  ? workspaceSessionGroups.map((group) => {
                  const collapsed = collapsedWorkspaceIds[group.workspace.id] ?? false;
                  return (
                    <div
                      key={group.workspace.id}
                      data-testid={`sidebar-session-project-${group.workspace.id}`}
                      data-state={collapsed ? 'collapsed' : 'expanded'}
                    >
                      <SidebarRow className="project-row-wrap">
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
                      <div
                        className={cn('project-tasks-outer', !collapsed && 'open')}
                        aria-hidden={collapsed}
                      >
                        <div className="project-tasks">
                          <SessionFolderTree
                            workspace={group.workspace}
                            sessions={group.sessions}
                            collapsedFolders={collapsedFolderIds}
                            sessionStatusKinds={sessionStatusKinds}
                            onToggleFolder={toggleFolder}
                            onCreateFolder={handleCreateFolder}
                            onRenameFolder={handleRenameFolder}
                            onDeleteFolder={handleDeleteFolder}
                            onMoveSession={handleMoveSessionToFolder}
                            renderSessionRow={renderSessionRow}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
                  : <div className="empty-sidebar-row" role="status" aria-live="polite">
                    {sessionPanelState === 'loading' && <DotMatrix state="loading" label={sessionPanelMessage} className="size-3.5 shrink-0" />}
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
        </div>,
        document.body,
      )}

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
              const menuHeight = devModeUnlocked ? 154 : 121;
              setFooterMenu((current) => current ? null : {
                top: Math.max(8, rect.top - menuHeight - 6),
                left: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth)),
              });
            }}
          >
            {gatewayRestarting ? <Loader2 className="animate-spin text-yellow-500" /> : storageHealthLow ? <AlertTriangle className="text-red-500" /> : <MoreHorizontal />}
          </button>
        )}
      </footer>

      {footerMenu && createPortal(
        <div role="menu" className="codex-dropdown sidebar-account-menu sidebar-footer-menu" style={{ top: footerMenu.top, left: footerMenu.left }}>
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
          {devModeUnlocked && (
            <button
              type="button"
              role="menuitem"
              data-testid="sidebar-open-dev-console"
              className="codex-dropdown__item"
              onClick={() => { setFooterMenu(null); void openDevConsole(); }}
            >
              <Terminal className="h-4 w-4" />
              <span className="codex-dropdown__text">{t('common:sidebar.openClawPage')}</span>
              <ExternalLink className="h-3 w-3 opacity-50" />
            </button>
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
                await archiveSession(target.key);
                if (currentSessionKey === target.key) navigate('/');
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
                await deleteSession(target.key);
                if (currentSessionKey === target.key) navigate('/');
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
        sessions={sessions}
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
