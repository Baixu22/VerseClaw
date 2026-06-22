/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Network,
  Bot,
  Puzzle,
  Clock,
  ChevronDown,
  ChevronRight,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Folder,
  Terminal,
  ExternalLink,
  Trash2,
  Pencil,
  Check,
  X,
  Cpu,
  ImagePlus,
  Moon,
  Loader2,
  Activity,
  BookOpen,
  CheckSquare,
  Workflow,
  GitCompare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { DotMatrix, type DotMatrixState } from '@/components/assistant-ui/dot-matrix';
import { isGatewayRestarting } from '@/lib/gateway-status';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { useSettingsStore } from '@/stores/settings';
import { useChatStore, type ChatRuntimeRunState, type ChatSession } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useWorkspacesStore } from '@/stores/workspaces';
import {
  buildSidebarTimeSessions,
  buildSidebarWorkspaceSessionGroups,
  type SidebarSessionEntry,
} from './session-buckets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { hostApi } from '@/lib/host-api';
import { SIDEBAR_COLLAPSED_WIDTH, MAC_SIDEBAR_CHROME_HEIGHT } from '@shared/sidebar-layout';
import { useTranslation } from 'react-i18next';
import logoSvg from '@/assets/logo.svg';
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
      className={({ isActive }) =>
        cn(
          'sidebar-nav-text flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors',
          'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
          isActive
            ? 'bg-black/5 dark:bg-white/10 text-foreground'
            : '',
          collapsed && 'justify-center px-0'
        )
      }
    >
      <>
        <div className="flex shrink-0 items-center justify-center text-current [&_svg]:size-4">
          {icon}
        </div>
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

function getRuntimeRunActivityMs(run: ChatRuntimeRunState): number {
  const lastEventTs = run.events.reduce((latest, event) => {
    const ts = typeof event.ts === 'number' && Number.isFinite(event.ts) ? event.ts : 0;
    return Math.max(latest, ts);
  }, 0);
  return Math.max(run.endedAt ?? 0, run.startedAt ?? 0, lastEventTs);
}

function getLatestRuntimeRunForSession(
  runtimeRuns: Record<string, ChatRuntimeRunState>,
  sessionKey: string,
): ChatRuntimeRunState | null {
  let latest: ChatRuntimeRunState | null = null;
  let latestActivity = -1;
  for (const run of Object.values(runtimeRuns)) {
    if (run.sessionKey !== sessionKey) continue;
    const activity = getRuntimeRunActivityMs(run);
    if (activity >= latestActivity) {
      latest = run;
      latestActivity = activity;
    }
  }
  return latest;
}

function runHasWaitingApproval(run: ChatRuntimeRunState | null): boolean {
  if (!run) return false;
  const latestApproval = [...run.events].reverse().find((event) => event.type === 'approval.updated');
  if (!latestApproval || latestApproval.type !== 'approval.updated') return false;
  const status = `${latestApproval.status ?? ''} ${latestApproval.phase ?? ''}`.toLowerCase();
  return /\b(wait|waiting|pending|approval|input|confirm)\b/.test(status);
}

function buildSidebarSessionStatus(input: {
  session: ChatSession;
  runtimeRuns: Record<string, ChatRuntimeRunState>;
  currentSessionKey: string;
  activeRunId: string | null;
  sending: boolean;
  pendingFinal: boolean;
  runError: string | null;
  dismissedCompletedSignature?: string;
}): SidebarSessionStatus | null {
  const latestRun = getLatestRuntimeRunForSession(input.runtimeRuns, input.session.key);
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
}: SessionRowProps) {
  const { t } = useTranslation(['common', 'chat']);
  const sessionStatusLabel = sessionStatus ? t(`chat:${sessionStatus.labelKey}`) : '';
  return (
    <div className="group relative flex items-center">
      {isEditing ? (
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
      ) : (
        <>
          <button
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
            className={cn(
              'w-full text-left rounded-lg px-2.5 py-1.5 text-meta transition-colors',
              sessionStatus ? 'pr-20' : 'pr-16',
              'hover:bg-black/5 dark:hover:bg-white/5',
              isOnChat && currentSessionKey === s.key
                ? 'bg-black/5 dark:bg-white/10 text-foreground font-medium'
                : 'text-foreground/75',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded-full bg-black/[0.04] px-2 py-0.5 text-2xs font-medium text-foreground/70 dark:bg-white/[0.08]">
                {agentName}
              </span>
              <span className="truncate">{sessionLabel}</span>
            </div>
          </button>
          {sessionStatus && (
            <button
              type="button"
              data-testid={`sidebar-session-status-${s.key}`}
              data-state={sessionStatus.kind}
              aria-label={sessionStatus.dismissible
                ? t('chat:sessionStatus.dismissCompleted')
                : sessionStatusLabel}
              title={sessionStatus.dismissible
                ? t('chat:sessionStatus.dismissCompleted')
                : sessionStatusLabel}
              onClick={(event) => {
                event.stopPropagation();
                if (sessionStatus.dismissible) {
                  onDismissSessionStatus(s.key, sessionStatus.signature);
                  return;
                }
                if (currentSessionKey === s.key) {
                  void onLoadHistory(false);
                } else {
                  onSwitch(s.key);
                }
                navigate('/');
              }}
              className={cn(
                'absolute right-11 top-1/2 flex -translate-y-1/2 items-center justify-center rounded p-0.5',
                'text-muted-foreground transition-colors',
                sessionStatus.dismissible
                  ? 'hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10'
                  : 'cursor-default',
              )}
            >
              <DotMatrix state={sessionStatus.matrixState} label={sessionStatusLabel} className="size-3.5" />
            </button>
          )}
          <div className={cn(
            'absolute right-1 flex items-center gap-0.5 transition-opacity',
            'opacity-0 group-hover:opacity-100',
          )}>
            <button
              aria-label={t('common:sidebar.renameSession', { ns: 'common' })}
              onClick={(e) => {
                e.stopPropagation();
                onStartRename(s.key, sessionLabel);
              }}
              className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              data-testid={`sidebar-session-delete-${s.key}`}
              aria-label={t('common:sidebar.deleteSession', { ns: 'common' })}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteClick(s.key, sessionLabel);
              }}
              className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
});

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
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

  const { sessions, currentSessionKey, sessionLabels, sessionLastActivity, runtimeRuns, activeRunId, sending, pendingFinal, runError } = useChatStore(useShallow((s) => ({
    sessions: s.sessions,
    currentSessionKey: s.currentSessionKey,
    sessionLabels: s.sessionLabels,
    sessionLastActivity: s.sessionLastActivity,
    runtimeRuns: s.runtimeRuns,
    activeRunId: s.activeRunId,
    sending: s.sending,
    pendingFinal: s.pendingFinal,
    runError: s.runError,
  })));
  const switchSession = useChatStore((s) => s.switchSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const handleNewChat = useNewChatAction();
  const workspaceProfiles = useWorkspacesStore((s) => s.profiles);
  const [dismissedCompletedStatuses, setDismissedCompletedStatuses] = useState<Record<string, string>>({});

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';
  const isGatewayReady = isGatewayRunning && gatewayStatus.gatewayReady !== false;
  const gatewayRestarting = isGatewayRestarting(gatewayStatus);
  const gatewayRuntimeKey = `${gatewayStatus.pid ?? 'none'}:${gatewayStatus.connectedAt ?? 'none'}:${gatewayStatus.port}`;

  const hasLoadedCurrentRuntimeRef = useRef(false);

  useEffect(() => {
    hasLoadedCurrentRuntimeRef.current = false;
  }, [gatewayRuntimeKey]);

  useEffect(() => {
    if (!isGatewayReady) return;
    let cancelled = false;
    (async () => {
      await loadSessions();
      if (cancelled) return;
      if (hasLoadedCurrentRuntimeRef.current) return;
      hasLoadedCurrentRuntimeRef.current = true;
      await loadHistory(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [gatewayRuntimeKey, isGatewayReady, loadHistory, loadSessions]);
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
      const result = await hostApi.gateway.controlUi(view);
      if (result.success && result.url) {
        await window.electron.openExternal(result.url);
      } else {
        console.error(`Failed to get ${label} URL:`, result.error);
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
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

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
    { to: '/models', icon: <Cpu className="h-4 w-4" strokeWidth={2} />, label: t('sidebar.models'), testId: 'sidebar-nav-models' },
    { to: '/agents', icon: <Bot className="h-4 w-4" strokeWidth={2} />, label: t('sidebar.agents'), testId: 'sidebar-nav-agents' },
    { to: '/channels', icon: <Network className="h-4 w-4" strokeWidth={2} />, label: t('sidebar.channels'), testId: 'sidebar-nav-channels' },
    { to: '/skills', icon: <Puzzle className="h-4 w-4" strokeWidth={2} />, label: t('sidebar.skills'), testId: 'sidebar-nav-skills' },
    { to: '/cron', icon: <Clock className="h-4 w-4" strokeWidth={2} />, label: t('sidebar.cronTasks'), testId: 'sidebar-nav-cron' },
    { to: '/task-ledger', icon: <CheckSquare className="h-4 w-4" strokeWidth={2} />, label: t('taskLedger:nav'), testId: 'sidebar-nav-task-ledger' },
    { to: '/clawgraph', icon: <Workflow className="h-4 w-4" strokeWidth={2} />, label: t('clawGraph:nav'), testId: 'sidebar-nav-clawgraph' },
    { to: '/code-review', icon: <GitCompare className="h-4 w-4" strokeWidth={2} />, label: t('codeReview:nav'), testId: 'sidebar-nav-code-review' },
    { to: '/knowledge', icon: <BookOpen className="h-4 w-4" strokeWidth={2} />, label: t('knowledge:nav'), testId: 'sidebar-nav-knowledge' },
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

  const sessionStatuses = useMemo(() => {
    const entries = sessions
      .map((session) => [
        session.key,
        buildSidebarSessionStatus({
          session,
          runtimeRuns,
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
    pendingFinal,
    runError,
    runtimeRuns,
    sending,
    sessions,
  ]);

  const handleDismissSessionStatus = useCallback((key: string, signature: string) => {
    setDismissedCompletedStatuses((current) => ({
      ...current,
      [key]: signature,
    }));
  }, []);

  const renderSessionRow = useCallback(({ session: s }: SidebarSessionEntry) => {
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
    />;
  }, [
    agentNameById, editingSessionKey, editingLabel, sessionLabels, sessionStatuses,
    currentSessionKey, isOnChat, switchSession, loadHistory, navigate,
    handleStartRename, handleRenameSubmit, handleRenameCancel, handleRenameKeyDown,
    handleDismissSessionStatus,
  ]);

  return (
    <aside
      data-testid="sidebar"
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface-sidebar',
        isResizing ? 'transition-none' : 'transition-[width] duration-300',
      )}
      style={{ width: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth }}
    >
      {isMac && (
        <div
          aria-hidden="true"
          data-testid="mac-sidebar-chrome"
          className="drag-region shrink-0"
          style={{ height: MAC_SIDEBAR_CHROME_HEIGHT }}
        />
      )}

      {/* Top Header Toggle */}
      <div
        className={cn(
          'flex shrink-0 items-center p-2 h-8',
          sidebarCollapsed ? 'justify-center' : 'justify-between',
        )}
      >
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2 px-2 overflow-hidden">
            <img src={logoSvg} alt="ClawX" className="h-5 w-auto shrink-0" />
            <span className="text-sm font-semibold truncate whitespace-nowrap text-foreground/90">
              ClawX
            </span>
          </div>
        )}
        <Button
          data-testid="sidebar-collapse-toggle"
          variant="ghost"
          size="icon"
          className={cn(
            'no-drag h-8 w-8 shrink-0 rounded-lg text-foreground/80',
            'hover:bg-black/5 hover:text-foreground/80 dark:hover:bg-white/5',
          )}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="h-[18px] w-[18px]" />
          ) : (
            <PanelLeftClose className="h-[18px] w-[18px]" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-2">
        <button
          type="button"
          data-testid="sidebar-new-chat"
          onClick={handleNewChat}
          className={cn(
            'sidebar-nav-text flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors',
            'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
            sidebarCollapsed && 'justify-center px-0',
          )}
        >
          <div className="flex shrink-0 items-center justify-center text-current [&_svg]:size-4">
            <Plus className="h-4 w-4" strokeWidth={2} />
          </div>
          {!sidebarCollapsed && <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.newChat')}</span>}
        </button>

        {navItems.map((item) => (
          <NavItem
            key={item.to}
            {...item}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>

      {/* Session list below nav, only when expanded */}
      {!sidebarCollapsed && sessions.length > 0 && (
        <>
          {/* Session grouping toggle */}
          <div className="mx-2 mt-3 flex rounded-lg bg-black/[0.03] p-0.5 dark:bg-white/[0.04]">
            {(['project', 'time'] as const).map((view) => (
              <button
                key={view}
                type="button"
                data-testid={`sidebar-session-view-${view}`}
                onClick={() => setSessionView(view)}
                className={cn(
                  'flex-1 rounded-md py-1 text-2xs font-medium transition-colors',
                  sessionView === view
                    ? 'bg-white text-foreground shadow-sm dark:bg-white/10'
                    : 'text-muted-foreground/60 hover:text-muted-foreground',
                )}
              >
                {t(`chat:sessionView.${view}`)}
              </button>
            ))}
          </div>

          {/* Session list */}
          <div className="mt-1 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2 space-y-0.5" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 36px' }}>
            {sessionView === 'project'
              ? workspaceSessionGroups.map((group) => {
                const collapsed = collapsedWorkspaceIds[group.workspace.id] ?? false;
                return (
                  <div
                    key={group.workspace.id}
                    data-testid={`sidebar-session-project-${group.workspace.id}`}
                    data-state={collapsed ? 'collapsed' : 'expanded'}
                    className="space-y-0.5"
                  >
                    <button
                      type="button"
                      data-testid={`sidebar-session-project-toggle-${group.workspace.id}`}
                      aria-expanded={!collapsed}
                      onClick={() => toggleWorkspaceGroup(group.workspace.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                        'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
                      )}
                    >
                      <Folder className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium tracking-normal">
                        {group.workspace.name}
                      </span>
                      {collapsed
                        ? <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                    {!collapsed && group.sessions.map((entry) => renderSessionRow(entry))}
                  </div>
                );
              })
              : timeSessions.map((entry) => renderSessionRow(entry))}
          </div>
        </>
      )}

      {/* Footer */}
      <div className="mt-auto flex flex-col gap-1 p-2">
        <div
          data-testid="sidebar-gateway-restarting"
          data-state={gatewayRestarting ? 'visible' : 'hidden'}
          aria-hidden={!gatewayRestarting}
          className={cn(
            'overflow-hidden transition-[max-height,opacity,transform] duration-200 ease-out',
            gatewayRestarting ? 'max-h-12 translate-y-0 opacity-100' : 'max-h-0 translate-y-1 opacity-0',
          )}
        >
          <div
            aria-live="polite"
            aria-label={t('common:gateway.restarting')}
            title={t('common:gateway.restarting')}
            className={cn(
              'sidebar-nav-text flex items-center gap-2 rounded-lg px-2.5 py-1.5',
              'border border-yellow-500/20 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
              sidebarCollapsed && 'justify-center px-0',
            )}
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            {!sidebarCollapsed && (
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {t('common:gateway.restarting')}
              </span>
            )}
          </div>
        </div>

        <NavLink
            to="/settings"
            data-testid="sidebar-nav-settings"
            className={({ isActive }) =>
              cn(
                'sidebar-nav-text flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors',
                'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
                isActive && 'bg-black/5 dark:bg-white/10 text-foreground',
                sidebarCollapsed ? 'justify-center px-0' : ''
              )
            }
          >
          <>
            <div className="flex shrink-0 items-center justify-center text-current [&_svg]:size-4">
              <SettingsIcon className="h-4 w-4" strokeWidth={2} />
            </div>
            {!sidebarCollapsed && <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t('sidebar.settings')}</span>}
          </>
        </NavLink>

        {devModeUnlocked && (
          <Button
            data-testid="sidebar-open-dev-console"
            variant="ghost"
            className={cn(
              'sidebar-nav-text flex h-auto w-full items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors',
              'hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80',
              sidebarCollapsed ? 'justify-center px-0' : 'justify-start'
            )}
            onClick={openDevConsole}
          >
            <div className="flex shrink-0 items-center justify-center text-current [&_svg]:size-4">
              <Terminal className="h-4 w-4" strokeWidth={2} />
            </div>
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">{t('common:sidebar.openClawPage')}</span>
                <ExternalLink className="ml-auto h-3 w-3 shrink-0 opacity-50 text-current" />
              </>
            )}
          </Button>
        )}
      </div>

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

      <ConfirmDialog
        open={deleteDialogOpen}
        title={t('common:actions.confirm')}
        message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label ?? '' })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          const targetSession = sessionToDelete;
          if (!targetSession) return;
          await deleteSession(targetSession.key);
          if (currentSessionKey === targetSession.key) navigate('/');
          setDeleteDialogOpen(false);
        }}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </aside>
  );
}
