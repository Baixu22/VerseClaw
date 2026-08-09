/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via the Main-owned host API. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import { AlertTriangle, ArrowDownToLine, Check, ChevronDown, Folder, GitBranch, GitBranchPlus, Loader2, Pencil, RefreshCw, Users, Workflow, X } from 'lucide-react';
import { FileText, Laptop, ListChecks, Sparkles } from '@/components/icons/codex-icons';
import {
  AssistantRuntimeProvider,
  AuiProvider,
  Suggestions,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAui,
  useLocalRuntime,
  type ChatModelAdapter,
  type SuggestionConfig,
} from '@assistant-ui/react';
import type { CompressionArtifact, KnowledgeErrorGuardAdvisory, KnowledgeErrorGuardSignal, SessionHandoffResult, SessionCompactionStatus } from '@shared/host-api/contract';
import type { LongTaskControlStatus } from '@shared/types/long-task-control';
import { classifySessionActivity, retainRecentSessionActivity } from '@shared/types/session-activity';
import type { TaskLoopUpgradeSuggestion } from '@shared/product-semantics';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { isInternalMessage } from '@/stores/chat/helpers';
import { buildBaselineRunKey, getBaseline } from '@/stores/baseline-cache';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useProviderStore } from '@/stores/providers';
import { useSettingsStore } from '@/stores/settings';
import { useWorkspacesStore } from '@/stores/workspaces';
import {
  ARTIFACT_PANEL_MAX_WIDTH,
  ARTIFACT_PANEL_MIN_WIDTH,
  useArtifactPanel,
} from '@/stores/artifact-panel';
import { hostApi } from '@/lib/host-api';
import { getAgentResourceLimits, selectMessageRenderWindow } from '../../../shared/agent-resource-limits';
import { hostEvents } from '@/lib/host-events';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ShimmerBlock } from '@/components/ai-elements/shimmer';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { CompactionArtifactViewer } from './CompactionArtifactViewer';
import { ExecutionGraphCard } from './ExecutionGraphCard';
import { TeamOrchestrationCard } from './TeamOrchestrationCard';
import { ChatToolbar } from './ChatToolbar';
import { SessionActivityPanel } from './SessionActivityPanel';
import { useSessionActivityStore } from '@/stores/session-activity';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import {
  classifySessionContinuityError,
  resolveSessionContinuityPreflight,
  type SessionContinuityErrorKind,
  type SessionContinuityRecommendation,
} from './session-continuity';
import { startTaskLoopUpgradeRun } from './task-loop-upgrade';
import { extractText, extractThinking, extractToolUse, normalizeMessageRole } from './message-utils';
import { parseSubagentCompletionInfo } from './task-visualization';
import {
  buildReplyTextOverrides,
  buildStreamingRenderMessage,
  deriveExecutionStreamState,
  deriveNextUserMessageIndexes,
  deriveRunSegmentMessageIndices,
  deriveUserRunProjection,
  groupRunCardsByTriggerIndex,
  isRealUserMessage,
  mergeGraphStepCacheEntries,
  type GraphStepCacheEntry,
  type UserRunCard,
} from './execution-projection';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { buildConfiguredModelOptions } from '@/lib/model-options';
import {
  createFreshWorkspaceSessionKey,
  createWorkspaceScopedForkSession,
  createWorkspaceScopedHandoffSession,
  createWorkspaceScopedNewSession,
  getAgentIdFromSessionKey,
  getWorkspaceAgentSessionKey,
} from '@/lib/workspace-session';
import { useStickToBottomInstant } from '@/hooks/use-stick-to-bottom-instant';
import { extractGeneratedFiles, generatedFileHasDiffPayload, isHtmlPreviewExt, type GeneratedFile } from '@/lib/generated-files';
import { AssistantErrorCard, SelectionQuoteToolbar } from '@/components/assistant-render/AssistantRender';
import { OrbStatus, type OrbStatusState } from '@/components/assistant-ui/orb-status';
import { TurnSummaryCard } from '@/components/assistant-render/TurnSummaryCard';
import { WelcomeProjectPicker } from '@/components/chat/WelcomeProjectPicker';
import { WelcomeBranchPicker } from '@/components/chat/WelcomeBranchPicker';
import { WorkspacePickerMenu } from '@/components/chat/WorkspacePickerMenu';
import { GeneratedFilesPanel } from '@/components/file-preview/GeneratedFilesPanel';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { useUiVersion } from '@/components/layout/ui-overlay-context';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { FilePreviewTarget } from '@/components/file-preview/types';
import { buildPreviewTarget } from '@/components/file-preview/build-preview-target';
import type { AttachedFileMeta } from '@/stores/chat/types';
import type {
  KnowledgeInvocationMode,
  LiveTokenUsage,
  PromptCacheRiskAssessment,
  WorkspaceContextRange,
  WorkspaceArtifactPanelState,
  WorkspacePanelIntent,
  WorkspaceKnowledgeScope,
  WorkspacePermissionMode,
  WorkspaceProfile,
  WorkspaceUiState,
} from '@shared/types/workspace';
import type { WorkArtifact } from '@shared/types/work-artifact';
import type { ChatSession, ChatRuntimeRunState, ChatStartupPhase, SendOptions } from '@/stores/chat/types';
import { toast } from 'sonner';

const ArtifactPanelLazy = lazy(() =>
  import('@/components/file-preview/ArtifactPanel').then((m) => ({ default: m.ArtifactPanel })),
);
const PanelResizeDividerLazy = lazy(() =>
  import('@/components/file-preview/PanelResizeDivider').then((m) => ({ default: m.PanelResizeDivider })),
);

type ChatMessageRenderRow = {
  index: number;
  key: string;
  message: RawMessage;
  hidden: boolean;
  suppressAssistantText: boolean;
  suppressToolCards: boolean;
  textOverride?: string;
  runCards: UserRunCard[];
};

type KnowledgeAdvisorySource = {
  key: string;
  signal: KnowledgeErrorGuardSignal;
};

const USER_CORRECTION_SIGNAL_PATTERN = /(\u4e0d\u5bf9|\u91cd\u505a|\u6709\u95ee\u9898|\u91cd\u65b0\u6765|\u9519\u4e86|\u5931\u8d25|\u62a5\u9519|redo|wrong|not right|incorrect|try again|start over|this failed|failed again)/iu;

function classifyErrorGuardSignal(text: string): KnowledgeErrorGuardSignal['kind'] {
  const lower = text.toLowerCase();
  if (/\b(eslint|lint)\b/u.test(lower)) return 'lint-failure';
  if (/\b(playwright|vitest|jest|test failed|tests failed|expect\(|assertion)\b/u.test(lower)) return 'test-failure';
  if (/\b(vite|webpack|rollup|tsc|typecheck|typescript|build failed|compile)\b/u.test(lower)) return 'build-failure';
  if (USER_CORRECTION_SIGNAL_PATTERN.test(text)) return 'user-correction';
  return 'runtime-error';
}

function extractLikelyFilePaths(text: string): string[] {
  const matches = text.match(/(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8}(?::\d+)?/gu) ?? [];
  return Array.from(new Set(matches.map((match) => match.replace(/:\d+$/u, '')).filter((match) => match.includes('/') || match.includes('\\')))).slice(0, 12);
}

function buildAdvisoryComposerText(advisory: KnowledgeErrorGuardAdvisory, title: string): string {
  const steps = advisory.recommendedResolution.length > 0
    ? advisory.recommendedResolution.map((step, index) => `${index + 1}. ${step}`).join('\n')
    : advisory.summary;
  return `${title}\n\n${steps}`;
}

function formatTokenCountForToast(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const absolute = Math.abs(value);
  if (absolute < 1000) return `${Math.round(value)}`;
  if (absolute < 1_000_000) {
    const compact = value / 1000;
    return `${compact >= 10 ? compact.toFixed(0) : compact.toFixed(1)}k`;
  }
  const compact = value / 1_000_000;
  return `${compact >= 10 ? compact.toFixed(0) : compact.toFixed(1)}m`;
}

type QuestionDirectoryItem = {
  index: number;
  ordinal: number;
  title: string;
};

type SessionLineageOverride = {
  relation: 'forked_from';
  sourceSessionKey: string;
};

const QUESTION_DIRECTORY_RENDER_LIMIT = 300;

function buildQuestionDirectoryTitle(message: RawMessage, fallback: string): string {
  const normalized = extractText(message).replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 64 ? `${normalized.slice(0, 64)}…` : normalized;
}

function hasUserFacingImageAttachments(msg: RawMessage): boolean {
  return (msg._attachedFiles ?? []).some((file) => file.mimeType.startsWith('image/'));
}

function buildKnowledgeDraftBody(messages: RawMessage[]): string {
  const visibleTurns = messages
    .filter((msg) => !isInternalMessage(msg))
    .map((msg) => {
      const role = normalizeMessageRole(msg.role);
      if (role !== 'user' && role !== 'assistant') return null;
      const text = extractText(msg).replace(/\n{3,}/g, '\n\n').trim();
      if (!text) return null;
      return { role, text };
    })
    .filter((entry): entry is { role: string; text: string } => entry != null)
    .slice(-24);

  return visibleTurns
    .map((turn) => `### ${turn.role === 'user' ? 'User' : 'Assistant'}\n\n${turn.text}`)
    .join('\n\n');
}

function generatedFileToTarget(file: GeneratedFile): FilePreviewTarget {
  return {
    filePath: file.filePath,
    fileName: file.fileName,
    ext: file.ext,
    mimeType: file.mimeType,
    contentType: file.contentType,
    action: file.action,
    fullContent: file.fullContent,
    baseline: file.baseline,
    edits: file.edits,
  };
}

// Keep the last non-empty execution-graph snapshot per session/run outside
// React state so `loadHistory` refreshes can still fall back to the previous
// steps without tripping React's set-state-in-effect lint rule.
const _GRAPH_STEP_CACHE_MAX = 50;
const graphStepCacheStore = new Map<string, Record<string, GraphStepCacheEntry>>();

function gcGraphStepCache(): void {
  if (graphStepCacheStore.size <= _GRAPH_STEP_CACHE_MAX) return;
  const keys = Array.from(graphStepCacheStore.keys()).slice(0, graphStepCacheStore.size - _GRAPH_STEP_CACHE_MAX);
  for (const key of keys) graphStepCacheStore.delete(key);
}
const streamingTimestampStore = new Map<string, number>();

function getWorkspaceSessionState(
  workspace: WorkspaceProfile | null | undefined,
  sessionKey: string,
): WorkspaceUiState {
  if (!workspace) return {};
  if (workspace.sessionStates) {
    return workspace.sessionStates[sessionKey] ?? {};
  }
  return workspace.state ?? {};
}

function basenameFromPath(path: string | null | undefined): string {
  if (!path) return '';
  const normalized = path.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() || normalized;
}

function normalizeComparablePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function getSessionDisplayName(sessionKey: string, sessions: ChatSession[], labels: Record<string, string>): string {
  const session = sessions.find((entry) => entry.key === sessionKey);
  return labels[sessionKey] || session?.label || session?.displayName || formatNewSessionDisplayName(sessionKey);
}

export function resolveWorkspaceHeaderSessions({
  currentSessionKey,
  sessions,
  workspaceSessionKeys,
}: {
  currentSessionKey: string;
  sessions: ChatSession[];
  workspaceSessionKeys: string[];
}): ChatSession[] {
  const currentAgentId = getAgentIdFromSessionKey(currentSessionKey);
  const allowedSessionKeys = new Set([...workspaceSessionKeys, currentSessionKey]);
  const workspaceSessions = sessions.filter((session) => (
    getAgentIdFromSessionKey(session.key) === currentAgentId
    && allowedSessionKeys.has(session.key)
  ));
  const hasCurrent = workspaceSessions.some((session) => session.key === currentSessionKey);
  return (hasCurrent ? workspaceSessions : [{ key: currentSessionKey, displayName: formatNewSessionDisplayName(currentSessionKey) }, ...workspaceSessions])
    .slice(-12)
    .reverse();
}

function formatNewSessionDisplayName(sessionKey: string): string {
  const rawId = sessionKey.split(':').pop() || sessionKey;
  if (rawId.startsWith('session-')) {
    return `new session ${rawId.slice('session-'.length)}`;
  }
  return rawId;
}

export function resolveWorkspaceSessionTarget(workspace: WorkspaceProfile, currentAgentId = 'main'): {
  agentId: string;
  sessionKey: string;
  isFresh: boolean;
} {
  const agentId = currentAgentId || workspace.selectedAgentId || workspace.agentId || 'main';
  const target = getWorkspaceAgentSessionKey(workspace, agentId);
  return { agentId, ...target };
}

function getContinuityFallbackActionKind(kind: SessionContinuityErrorKind): 'prepareHandoff' | null {
  if (kind === 'gateway_unavailable' || kind === 'parent_too_large' || kind === 'transcript_unavailable') {
    return 'prepareHandoff';
  }
  return null;
}

function getContinuityErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const value of [record.error, record.message, record.reason]) {
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return fallback;
}

const HEADER_COMPLETED_STATUSES = new Set(['completed', 'success', 'done', 'finished']);
const HEADER_ERROR_STATUSES = new Set(['failed', 'error', 'killed', 'timeout']);
const HEADER_ABORTED_STATUSES = new Set(['aborted', 'cancelled', 'canceled']);
const HEADER_SESSION_DOT_LABEL_KEYS: Partial<Record<OrbStatusState, string>> = {
  streaming: 'sessionStatus.running',
  waiting: 'sessionStatus.waiting',
  success: 'sessionStatus.completed',
  error: 'sessionStatus.error',
  stopped: 'sessionStatus.aborted',
};

function getHeaderSessionDotState(input: {
  sessionKey: string;
  currentSessionKey: string;
  runtimeRuns?: Record<string, ChatRuntimeRunState>;
  activeRunId?: string | null;
  sending?: boolean;
  pendingFinal?: boolean;
  runError?: string | null;
}): OrbStatusState | null {
  const isCurrent = input.sessionKey === input.currentSessionKey;
  if (isCurrent && input.runError) return 'error';
  const runs = input.runtimeRuns ?? {};
  const sessionRuns = Object.values(runs).filter((r) => r.sessionKey === input.sessionKey);
  const latestRun = sessionRuns.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
  const currentRunActive = isCurrent && (input.sending || input.pendingFinal || input.activeRunId != null);
  const latestStatus = latestRun?.status?.toLowerCase();
  if (currentRunActive || latestStatus === 'running') {
    return (isCurrent && input.pendingFinal) ? 'waiting' : 'streaming';
  }
  if (HEADER_COMPLETED_STATUSES.has(latestStatus ?? '')) return 'success';
  if (HEADER_ERROR_STATUSES.has(latestStatus ?? '')) return 'error';
  if (HEADER_ABORTED_STATUSES.has(latestStatus ?? '')) return 'stopped';
  return null;
}

function ProjectSessionHeader({
  workspaceId,
  projectName,
  projectPath,
  workspaceProfiles,
  switchWorkspace,
  pickWorkspaceFolder,
  onOpenTaskLedger,
  onOpenClawGraph,
  sessions,
  currentSessionKey,
  sessionLabels,
  workspaceSessionKeys,
  switchSession,
  renameSession,
  onHandoffSession,
  onForkSession,
  forkDisabled,
  forkBusy,
  handoffDisabled,
  handoffBusy,
  continuityRecommendation,
  sessionLineage,
  runtimeRuns,
  activeRunId,
  sending,
  pendingFinal,
  runError,
}: {
  workspaceId?: string;
  projectName: string;
  projectPath?: string;
  workspaceProfiles: Array<{ id: string; name: string; rootPath: string; lastOpenedAt?: number }>;
  switchWorkspace: (id: string) => Promise<unknown>;
  pickWorkspaceFolder: () => Promise<void>;
  onOpenTaskLedger: () => void;
  onOpenClawGraph: () => void;
  sessions: ChatSession[];
  currentSessionKey: string;
  sessionLabels: Record<string, string>;
  workspaceSessionKeys: string[];
  switchSession: (key: string) => void;
  renameSession: (key: string, label: string) => Promise<void>;
  onHandoffSession: () => void | Promise<void>;
  onForkSession: () => void | Promise<void>;
  forkDisabled?: boolean;
  forkBusy?: boolean;
  handoffDisabled?: boolean;
  handoffBusy?: boolean;
  continuityRecommendation?: SessionContinuityRecommendation;
  sessionLineage?: Record<string, SessionLineageOverride>;
  runtimeRuns?: Record<string, ChatRuntimeRunState>;
  activeRunId?: string | null;
  sending?: boolean;
  pendingFinal?: boolean;
  runError?: string | null;
}) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState<'workspace' | 'session' | null>(null);
  const [editingSession, setEditingSession] = useState(false);
  const [sessionDraft, setSessionDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sessionName = getSessionDisplayName(currentSessionKey, sessions, sessionLabels);

  /* The empty state names the checkout under the composer (project · branch).
   * Once a conversation starts that row is gone, and the header was carrying
   * project / session only — so the branch you are about to have an agent
   * write to stopped being visible at exactly the point it starts mattering.
   * Same call the hero makes; the two are never mounted at once. */
  useEffect(() => {
    let cancelled = false;
    void hostApi.git.status().then((result) => {
      if (cancelled) return;
      const status = result.status;
      if (!status?.isRepository) {
        setBranch(null);
        return;
      }
      setBranch(status.detached ? 'detached' : status.branch || null);
    }).catch(() => {
      if (!cancelled) setBranch(null);
    });
    return () => { cancelled = true; };
  }, [projectPath]);

  const currentSessionDotState = getHeaderSessionDotState({
    sessionKey: currentSessionKey,
    currentSessionKey,
    runtimeRuns,
    activeRunId,
    sending,
    pendingFinal,
    runError,
  });
  const currentSessionDotLabel = currentSessionDotState
    ? t(HEADER_SESSION_DOT_LABEL_KEYS[currentSessionDotState] ?? 'sessionStatus.running')
    : '';
  const recentSessions = useMemo(() => {
    return resolveWorkspaceHeaderSessions({ currentSessionKey, sessions, workspaceSessionKeys });
  }, [currentSessionKey, sessions, workspaceSessionKeys]);
  const recommendedContinuityAction = continuityRecommendation?.disabled ? null : continuityRecommendation?.action;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const startRenameSession = () => {
    setOpen(null);
    setSessionDraft(sessionName);
    setEditingSession(true);
  };

  const finishRenameSession = async () => {
    const nextLabel = sessionDraft.trim();
    if (!nextLabel || nextLabel === sessionName) {
      setEditingSession(false);
      return;
    }
    setRenaming(true);
    try {
      await renameSession(currentSessionKey, nextLabel);
      setEditingSession(false);
    } catch (error) {
      toast.error(t('session.renameFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div ref={rootRef} className="flex min-w-0 items-center gap-1 text-sm" data-testid="chat-project-session-header">
      <Laptop className="order-1 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="relative order-4 hidden min-w-0 md:block" data-testid="chat-header-environment-project">
        {/* Project is the ancestor, not the subject — the session is what this
          * pane is showing, so it takes the weight and the project steps back
          * to breadcrumb strength. */}
        <Tooltip>
          <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-[200px] items-center gap-1 rounded-md px-1.5 py-1 text-xs font-normal text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          onClick={() => setOpen((current) => current === 'workspace' ? null : 'workspace')}
        >
          <Folder className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{projectName}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" collisionPadding={8} className="max-w-xs break-all text-xs">{projectPath}</TooltipContent>
        </Tooltip>
        {open === 'workspace' && (
          <WorkspacePickerMenu
            profiles={workspaceProfiles}
            activeWorkspaceId={workspaceId}
            onSelect={(id) => {
              setOpen(null);
              return switchWorkspace(id);
            }}
            onPickFolder={() => {
              setOpen(null);
              return pickWorkspaceFolder();
            }}
            menuTestId="chat-header-workspace-menu"
            className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:zoom-in-95 motion-safe:duration-150 motion-reduce:animate-none"
            extraActions={(
              <>
                <button type="button" className="codex-header-menu__item codex-header-menu__item--muted" onClick={() => { setOpen(null); onOpenTaskLedger(); }}>
                  <ListChecks className="h-4 w-4" />
                  {t('workspace.actions.openTaskLedger')}
                </button>
                <button type="button" className="codex-header-menu__item codex-header-menu__item--muted" onClick={() => { setOpen(null); onOpenClawGraph(); }}>
                  <Workflow className="h-4 w-4" />
                  {t('workspace.actions.openClawGraph')}
                </button>
              </>
            )}
          />
        )}
      </div>
      {/* Branch reads as a label, not a control — checking out from here would
        * be a destructive action one stray click away from the session menu.
        * The composer's git strip stays the place that switches branches. */}
      {branch && (
        <Tooltip>
          <TooltipTrigger asChild>
        <span
          className="order-5 hidden min-w-0 shrink items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground lg:inline-flex"
          data-testid="chat-header-branch"
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[160px] truncate font-mono">{branch}</span>
        </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" collisionPadding={8} className="max-w-xs break-all text-xs">{branch}</TooltipContent>
        </Tooltip>
      )}
      <span className="order-3 hidden text-foreground/25 md:inline" aria-hidden="true">/</span>
      <div className="relative order-2 min-w-0">
        {editingSession ? (
          <div className="inline-flex max-w-[380px] items-center gap-1 rounded-md bg-black/5 px-1 py-0.5 dark:bg-white/10">
            <input
              value={sessionDraft}
              autoFocus
              onChange={(event) => setSessionDraft(event.target.value)}
              onBlur={() => void finishRenameSession()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void finishRenameSession();
                if (event.key === 'Escape') setEditingSession(false);
              }}
              className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-sm font-semibold text-foreground outline-none"
            />
            {renaming ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
            )}
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex max-w-[460px] items-center gap-1 rounded-md px-1.5 py-1 font-medium text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setOpen((current) => current === 'session' ? null : 'session')}
            onDoubleClick={(event) => {
              event.preventDefault();
              startRenameSession();
            }}
            data-testid="chat-header-session-name"
          >
            {currentSessionDotState && (
              <OrbStatus
                state={currentSessionDotState}
                label={currentSessionDotLabel}
                className="size-3.5 shrink-0"
                data-testid="chat-current-session-status"
              />
            )}
            <span className="truncate">{sessionName}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" collisionPadding={8}>{t('session.renameHint')}</TooltipContent>
          </Tooltip>
        )}
        {open === 'session' && (
            <div className="codex-header-menu motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:zoom-in-95 motion-safe:duration-150 motion-reduce:animate-none">
            <button
              type="button"
              className="codex-header-menu__item codex-header-menu__item--muted"
              onClick={startRenameSession}
            >
              <Pencil className="h-4 w-4" />
              {t('session.renameCurrent')}
            </button>
            <button
              type="button"
              className="codex-header-menu__item codex-header-menu__item--muted"
              data-testid="chat-session-fork"
              disabled={forkDisabled || forkBusy}
              onClick={() => {
                setOpen(null);
                void onForkSession();
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                {forkBusy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <GitBranchPlus className="h-4 w-4 shrink-0" />}
                <span className="truncate">{t('composer.fork.action')}</span>
              </span>
              {recommendedContinuityAction === 'fork' && (
                <span
                  data-testid="chat-session-fork-recommended"
                  className="shrink-0 rounded bg-black/5 px-1 py-0.5 text-2xs font-medium text-muted-foreground dark:bg-white/10"
                >
                  {t('composer.continuity.recommended')}
                </span>
              )}
            </button>
            <button
              type="button"
              className="codex-header-menu__item codex-header-menu__item--muted"
              data-testid="chat-session-handoff"
              disabled={handoffDisabled || handoffBusy}
              onClick={() => {
                setOpen(null);
                void onHandoffSession();
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                {handoffBusy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <FileText className="h-4 w-4 shrink-0" />}
                <span className="truncate">{t('composer.handoff.action')}</span>
              </span>
              {recommendedContinuityAction === 'handoff' && (
                <span
                  data-testid="chat-session-handoff-recommended"
                  className="shrink-0 rounded bg-black/5 px-1 py-0.5 text-2xs font-medium text-muted-foreground dark:bg-white/10"
                >
                  {t('composer.continuity.recommended')}
                </span>
              )}
            </button>
            <hr className="codex-header-menu__sep" />
            {recentSessions.map((session) => {
              const forkSourceSessionKey = session.forkedFromParent && session.parentSessionKey
                ? session.parentSessionKey
                : sessionLineage?.[session.key]?.relation === 'forked_from'
                  ? sessionLineage[session.key].sourceSessionKey
                  : null;
              const dotState = getHeaderSessionDotState({
                sessionKey: session.key,
                currentSessionKey,
                runtimeRuns,
                activeRunId,
                sending,
                pendingFinal,
                runError,
              });
              return (
                <button
                  key={session.key}
                  type="button"
                  className="codex-header-menu__item"
                  onClick={() => {
                    setOpen(null);
                    switchSession(session.key);
                  }}
                >
                  {dotState ? (
                    <OrbStatus state={dotState} className="size-4 shrink-0" />
                  ) : (
                    <span className="size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {getSessionDisplayName(session.key, sessions, sessionLabels)}
                    </span>
                    <span className="block truncate font-mono text-2xs text-muted-foreground">{session.key}</span>
                    {forkSourceSessionKey && (
                      <span className="block truncate text-2xs text-muted-foreground">
                        {t('session.lineage.forkedFrom', { session: forkSourceSessionKey })}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function KnowledgeErrorAdvisoryCard({
  advisory,
  busy = false,
  onDismiss,
  onUse,
}: {
  advisory: KnowledgeErrorGuardAdvisory;
  busy?: boolean;
  onDismiss: () => void | Promise<void>;
  onUse: () => void | Promise<void>;
}) {
  const { t } = useTranslation('chat');
  const severityTone = advisory.severity === 'blocking' || advisory.severity === 'high'
    ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400'
    : advisory.severity === 'medium'
      ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
      : 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400';
  return (
    <div className="px-4 pt-2" data-testid="chat-knowledge-error-advisory">
      <div className="mx-auto max-w-4xl rounded-lg border border-yellow-500/20 bg-surface-modal p-3 shadow-sm dark:border-yellow-500/25">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-yellow-500/20 bg-yellow-500/10">
            <AlertTriangle className="h-4 w-4 text-yellow-700 dark:text-yellow-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate text-sm font-semibold text-foreground">{t('knowledgeGuard.title')}</div>
              <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase', severityTone)}>
                {t(`knowledgeGuard.severity.${advisory.severity}`)}
              </span>
              <span className="rounded-md border border-black/10 bg-surface-input px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:border-white/10">
                {t('knowledgeGuard.confidence', { confidence: Math.round(advisory.confidence * 100) })}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium text-foreground/90">{advisory.title}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{advisory.summary}</p>
            <div className="mt-2 grid gap-2 text-xs leading-5 md:grid-cols-2">
              <div className="rounded-md bg-surface-input px-2 py-1.5">
                <span className="font-medium text-foreground/80">{t('knowledgeGuard.rootCause')}</span>
                <span className="ml-1 text-muted-foreground">{advisory.rootCause}</span>
              </div>
              <div className="rounded-md bg-surface-input px-2 py-1.5">
                <span className="font-medium text-foreground/80">{t('knowledgeGuard.whyMatched')}</span>
                <span className="ml-1 text-muted-foreground">{advisory.whyMatched.slice(0, 2).join(', ') || t('knowledgeGuard.matchFallback')}</span>
              </div>
            </div>
            {advisory.recommendedResolution.length > 0 ? (
              <ol className="mt-2 list-inside list-decimal space-y-0.5 text-xs leading-5 text-muted-foreground">
                {advisory.recommendedResolution.slice(0, 3).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-md px-2 text-xs"
                onClick={() => void onDismiss()}
                disabled={busy}
                data-testid="chat-knowledge-error-advisory-dismiss"
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                {t('knowledgeGuard.dismiss')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-md border-black/10 px-2 text-xs shadow-none dark:border-white/10"
                onClick={() => void onUse()}
                disabled={busy}
                data-testid="chat-knowledge-error-advisory-use"
              >
                <Check className="mr-1.5 h-3.5 w-3.5" />
                {t('knowledgeGuard.use')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Chat() {
  const { t } = useTranslation(['chat', 'common']);
  const uiVersion = useUiVersion();
  const navigate = useNavigate();
  const location = useLocation();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const { messages, currentSessionKey, currentAgentId, sessions, sessionLabels, loading, historyRefreshing, loadingMoreHistory, hasMoreHistory, sending, error, runError, startupPhase, startupError, streamingMessage, streamingTools, pendingFinal, activeRunId, runtimeRuns, lastUserMessageAt } = useChatStore(useShallow((s) => ({
    messages: s.messages,
    currentSessionKey: s.currentSessionKey,
    currentAgentId: s.currentAgentId,
    sessions: s.sessions ?? [],
    sessionLabels: s.sessionLabels,
    loading: s.loading,
    historyRefreshing: s.historyRefreshing,
    loadingMoreHistory: s.loadingMoreHistory,
    hasMoreHistory: s.hasMoreHistory,
    sending: s.sending,
    error: s.error,
    runError: s.runError,
    startupPhase: s.startupPhase,
    startupError: s.startupError,
    streamingMessage: s.streamingMessage,
    streamingTools: s.streamingTools,
    pendingFinal: s.pendingFinal,
    activeRunId: s.activeRunId,
    runtimeRuns: s.runtimeRuns ?? {},
    lastUserMessageAt: s.lastUserMessageAt,
  })));
  const switchSession = useChatStore((s) => s.switchSession);
  const resetSessionView = useChatStore((s) => s.resetSessionView);
  const renameSession = useChatStore((s) => s.renameSession);
  const loadMoreHistory = useChatStore((s) => s.loadMoreHistory);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const resendUserMessage = useChatStore((s) => s.resendUserMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const hydrateStartup = useChatStore((s) => s.hydrateStartup);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const agents = useAgentsStore((s) => s.agents);
  const defaultModelRef = useAgentsStore((s) => s.defaultModelRef);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerDefaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const fetchWorkspaces = useWorkspacesStore((s) => s.fetchWorkspaces);
  const workspaceProfiles = useWorkspacesStore((s) => s.profiles);
  const activeWorkspace = useWorkspacesStore((s) => s.activeWorkspace);
  const activeWorkspaceId = activeWorkspace?.id;
  const switchWorkspace = useWorkspacesStore((s) => s.switchWorkspace);
  const createWorkspace = useWorkspacesStore((s) => s.createWorkspace);
  const saveWorkspaceState = useWorkspacesStore((s) => s.saveWorkspaceState);
  const setPermissionMode = useWorkspacesStore((s) => s.setPermissionMode);

  const [knowledgeScope, setKnowledgeScope] = useState<WorkspaceKnowledgeScope>('none');
  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeInvocationMode>('suggest');
  const [knowledgeDraftOpen, setKnowledgeDraftOpen] = useState(false);
  const [knowledgeDraftTitle, setKnowledgeDraftTitle] = useState('');
  const [knowledgeDraftBody, setKnowledgeDraftBody] = useState('');
  const [knowledgeDraftApplying, setKnowledgeDraftApplying] = useState(false);
  const [knowledgeErrorAdvisory, setKnowledgeErrorAdvisory] = useState<KnowledgeErrorGuardAdvisory | null>(null);
  const [knowledgeErrorAdvisoryBusy, setKnowledgeErrorAdvisoryBusy] = useState(false);
  const [dismissedKnowledgeAdvisoryKeys, setDismissedKnowledgeAdvisoryKeys] = useState<Set<string>>(() => new Set());
  const sessionActivitySnapshot = useSessionActivityStore((state) => state.snapshots[currentSessionKey]);
  const loadSessionActivity = useSessionActivityStore((state) => state.load);
  const sessionActivityPanelEnabled = useSettingsStore((state) => state.sessionActivityPanelEnabled);
  const sessionActivityAutoExpand = useSettingsStore((state) => state.sessionActivityAutoExpand);
  const sessionActivityShowGit = useSettingsStore((state) => state.sessionActivityShowGit);
  const sessionActivityShowCommands = useSettingsStore((state) => state.sessionActivityShowCommands);
  const sessionActivityRetentionMinutes = useSettingsStore((state) => state.sessionActivityRetentionMinutes);

  useEffect(() => {
    if (!currentSessionKey) return;
    void loadSessionActivity({ workspaceId: activeWorkspaceId, sessionKey: currentSessionKey });
  }, [activeWorkspaceId, currentSessionKey, loadSessionActivity]);


  // Refresh Task Ledger snapshot when workspace changes
  const refreshTaskLedger = useChatStore((s) => s.refreshTaskLedger);
  useEffect(() => {
    void refreshTaskLedger();
  }, [activeWorkspaceId, refreshTaskLedger]);

  const clearActiveTopicMarker = useCallback(async (rootPath: string | undefined) => {
    if (!rootPath) return;
    try {
      await hostApi.files.writeText(`${rootPath}/.clawx-active-topic`, '');
    } catch { /* best-effort */ }
  }, []);

  const agentsList = useAgentsStore((s) => s.agents);
  const currentAgent = useMemo(
    () => (agentsList ?? []).find((a) => a.id === currentAgentId) ?? null,
    [agentsList, currentAgentId],
  );
  const fallbackModelRef = useMemo(
    () => buildConfiguredModelOptions(providerAccounts, providerStatuses, providerDefaultAccountId)[0]?.modelRef ?? null,
    [providerAccounts, providerDefaultAccountId, providerStatuses],
  );
  const currentModelRef = currentAgent?.modelRef || defaultModelRef || fallbackModelRef || null;
  const panelOpen = useArtifactPanel((s) => s.open);
  const panelExpanded = useArtifactPanel((s) => s.expanded);
  const panelWidthPct = useArtifactPanel((s) => s.widthPct);
  const openWorkspacePanel = useArtifactPanel((s) => s.openWorkspacePanel);
  const artifactTabs = useArtifactPanel((s) => s.tabs);
  const artifactActiveTabId = useArtifactPanel((s) => s.activeTabId);
  const terminalPlacement = useArtifactPanel((s) => s.terminalPlacement);
  const setTerminalPlacement = useArtifactPanel((s) => s.setTerminalPlacement);
  const restoreArtifactPanelState = useArtifactPanel((s) => s.restoreSessionState);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [terminalBottomHeight, setTerminalBottomHeight] = useState(280);
  const lastObservedSessionKeyRef = useRef(currentSessionKey);
  const lastRestoredWorkspaceIdRef = useRef<string | null>(null);
  const workspaceSessionRestoreTargetRef = useRef<{ workspaceId: string; sessionKey: string } | null>(null);
  const workspaceStateRestoreRef = useRef<{ workspaceId: string | null; sessionKey: string | null }>({
    workspaceId: null,
    sessionKey: null,
  });
  const skipNextWorkspaceStateSaveRef = useRef(false);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKnowledgeAdvisorySignalKeyRef = useRef<string | null>(null);
  const knowledgeAdvisorySourceRef = useRef<KnowledgeAdvisorySource | null>(null);
  const [childTranscripts, setChildTranscripts] = useState<Record<string, RawMessage[]>>({});
  const [questionDirectoryOpenSessionKey, setQuestionDirectoryOpenSessionKey] = useState<string | null>(null);
  const [sessionActivityOpenOverrides, setSessionActivityOpenOverrides] = useState<Record<string, boolean>>({});
  const [sessionActivitySheetOpen, setSessionActivitySheetOpen] = useState(false);
  const [sessionActivityRetentionClock, setSessionActivityRetentionClock] = useState(() => Date.now());
  const [contextRange, setContextRange] = useState<WorkspaceContextRange | null>(null);
  const [liveUsage, setLiveUsage] = useState<LiveTokenUsage | null>(null);
  const [promptCacheStatus, setPromptCacheStatus] = useState<PromptCacheRiskAssessment | null>(null);
  const [compactionStatus, setCompactionStatus] = useState<SessionCompactionStatus | null>(null);
  const [compactionBusy, setCompactionBusy] = useState(false);
  const [compactionArtifactOpen, setCompactionArtifactOpen] = useState(false);
  const [compactionArtifactBusy, setCompactionArtifactBusy] = useState(false);
  const [compactionArtifact, setCompactionArtifact] = useState<CompressionArtifact | null>(null);
  const [compactionArtifactCheckpointId, setCompactionArtifactCheckpointId] = useState<string | null>(null);
  const [compactionArtifactWarnings, setCompactionArtifactWarnings] = useState<string[]>([]);
  const [longTaskControlStatus, setLongTaskControlStatus] = useState<LongTaskControlStatus | null>(null);
  const [queueDrainBusy, setQueueDrainBusy] = useState(false);
  const [taskLoopUpgradeBusy, setTaskLoopUpgradeBusy] = useState(false);
  const [forkBusy, setForkBusy] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffCreating, setHandoffCreating] = useState(false);
  const [handoffDialogOpen, setHandoffDialogOpen] = useState(false);
  const [handoffResult, setHandoffResult] = useState<SessionHandoffResult | null>(null);
  const [handoffDraft, setHandoffDraft] = useState('');
  const [sessionLineage, setSessionLineage] = useState<Record<string, SessionLineageOverride>>({});
  const [streamStatusNow, setStreamStatusNow] = useState(() => Date.now());
  const [composerDraft, setComposerDraft] = useState('');
  const [composerSlashRequest, setComposerSlashRequest] = useState(0);
  const messageAreaRef = useRef<HTMLDivElement | null>(null);
  const [runActivityExpandedOverrides, setRunActivityExpandedOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setSessionActivitySheetOpen(false);
  }, [currentSessionKey, panelOpen]);
  useEffect(() => {
    if (sessionActivityRetentionMinutes === 0) return;
    const timer = window.setInterval(() => setSessionActivityRetentionClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [sessionActivityRetentionMinutes]);
  const captureCurrentWorkspaceSessionState = useCallback((draft = composerDraft): WorkspaceUiState => {
    const previousArtifactPanel = getWorkspaceSessionState(activeWorkspace, currentSessionKey).artifactPanel ?? {};
    return {
      draftInput: draft,
      activeTopicId: null,
      knowledgeScope,
      knowledgeMode,
      artifactPanel: {
        ...previousArtifactPanel,
        open: panelOpen,
        expanded: panelExpanded,
        tabs: artifactTabs.map((tab) => ({ kind: tab.kind, title: tab.title })),
        activeTabKind: artifactTabs.find((tab) => tab.id === artifactActiveTabId)?.kind,
      },
      turnSummaryExpanded: runActivityExpandedOverrides,
    };
  }, [activeWorkspace, artifactActiveTabId, artifactTabs, composerDraft, currentSessionKey, knowledgeMode, knowledgeScope, panelExpanded, panelOpen, runActivityExpandedOverrides]);

  const persistCurrentWorkspaceSessionState = useCallback(async (options?: {
    activeSessionKey?: string;
    sessionKey?: string;
    draft?: string;
  }) => {
    if (!activeWorkspace?.id) return;
    await saveWorkspaceState({
      id: activeWorkspace.id,
      activeSessionKey: options?.activeSessionKey,
      sessionKey: options?.sessionKey ?? currentSessionKey,
      state: captureCurrentWorkspaceSessionState(options?.draft),
    });
  }, [activeWorkspace?.id, captureCurrentWorkspaceSessionState, currentSessionKey, saveWorkspaceState]);

  const handleSwitchWorkspace = useCallback(async (workspaceId: string) => {
    await persistCurrentWorkspaceSessionState({
      activeSessionKey: currentSessionKey,
      sessionKey: currentSessionKey,
    });
    const targetWorkspace = workspaceProfiles.find((profile) => profile.id === workspaceId) ?? null;
    if (targetWorkspace?.id) {
      const target = resolveWorkspaceSessionTarget(targetWorkspace, currentAgentId);
      workspaceSessionRestoreTargetRef.current = {
        workspaceId: targetWorkspace.id,
        sessionKey: target.sessionKey,
      };
      const nextWorkspace = await switchWorkspace(workspaceId) as WorkspaceProfile | null;
      lastRestoredWorkspaceIdRef.current = nextWorkspace?.id ?? targetWorkspace.id;
      lastObservedSessionKeyRef.current = target.sessionKey;
      workspaceStateRestoreRef.current = { workspaceId: null, sessionKey: null };
      setComposerDraft('');
      setRunActivityExpandedOverrides({});
      setContextRange(null);
      setLiveUsage(null);
      setKnowledgeScope('none');
      resetSessionView(target.sessionKey);
      await hostApi.workspaces.update(targetWorkspace.id, {
        agentId: target.agentId,
        activeSessionKey: target.sessionKey,
        sessionKey: target.sessionKey,
        state: target.isFresh ? { activeTopicId: null } : undefined,
      });
      await fetchWorkspaces();
      return;
    }
    const nextWorkspace = await switchWorkspace(workspaceId) as WorkspaceProfile | null;
    if (nextWorkspace?.id) {
      const target = resolveWorkspaceSessionTarget(nextWorkspace, currentAgentId);
      workspaceSessionRestoreTargetRef.current = {
        workspaceId: nextWorkspace.id,
        sessionKey: target.sessionKey,
      };
      lastRestoredWorkspaceIdRef.current = nextWorkspace.id;
      lastObservedSessionKeyRef.current = target.sessionKey;
      workspaceStateRestoreRef.current = { workspaceId: null, sessionKey: null };
      setComposerDraft('');
      setRunActivityExpandedOverrides({});
      setContextRange(null);
      setLiveUsage(null);
      setKnowledgeScope('none');
      resetSessionView(target.sessionKey);
      await hostApi.workspaces.update(nextWorkspace.id, {
        agentId: target.agentId,
        activeSessionKey: target.sessionKey,
        sessionKey: target.sessionKey,
        state: target.isFresh ? { activeTopicId: null } : undefined,
      });
      await fetchWorkspaces();
    }
  }, [currentAgentId, currentSessionKey, fetchWorkspaces, persistCurrentWorkspaceSessionState, resetSessionView, switchWorkspace, workspaceProfiles]);

  const handleSwitchAgent = useCallback(async (agentId: string) => {
    if (!activeWorkspace?.id || agentId === currentAgentId) return;
    await persistCurrentWorkspaceSessionState({
      activeSessionKey: currentSessionKey,
      sessionKey: currentSessionKey,
    });
    const target = getWorkspaceAgentSessionKey(activeWorkspace, agentId);
    const nextSessionKey = target.sessionKey;
    workspaceSessionRestoreTargetRef.current = {
      workspaceId: activeWorkspace.id,
      sessionKey: nextSessionKey,
    };
    await hostApi.workspaces.update(activeWorkspace.id, {
      agentId,
      activeSessionKey: nextSessionKey,
      sessionKey: nextSessionKey,
      state: target.isFresh ? { activeTopicId: null } : undefined,
    });
    await fetchWorkspaces();
    lastRestoredWorkspaceIdRef.current = activeWorkspace.id;
    lastObservedSessionKeyRef.current = nextSessionKey;
    workspaceStateRestoreRef.current = { workspaceId: null, sessionKey: null };
    setContextRange(null);
    setLiveUsage(null);
    resetSessionView(nextSessionKey);
    if (target.isFresh) {
      setComposerDraft('');
      setRunActivityExpandedOverrides({});
      setKnowledgeScope('none');
      void clearActiveTopicMarker(activeWorkspace.rootPath);
    }
  }, [
    activeWorkspace,
    currentAgentId,
    currentSessionKey,
    fetchWorkspaces,
    persistCurrentWorkspaceSessionState,
    resetSessionView,
    clearActiveTopicMarker,
  ]);

  const handleCreateNewSession = useCallback(async () => {
    await persistCurrentWorkspaceSessionState({
      activeSessionKey: currentSessionKey,
      sessionKey: currentSessionKey,
    });
    const nextSessionKey = await createWorkspaceScopedNewSession();
    workspaceSessionRestoreTargetRef.current = activeWorkspace?.id
      ? { workspaceId: activeWorkspace.id, sessionKey: nextSessionKey }
      : null;
    lastObservedSessionKeyRef.current = nextSessionKey;
    workspaceStateRestoreRef.current = { workspaceId: null, sessionKey: null };
    setComposerDraft('');
    setRunActivityExpandedOverrides({});
    setContextRange(null);
    setLiveUsage(null);
    setKnowledgeScope('none');
  }, [activeWorkspace?.id, activeWorkspace?.permissionMode, currentSessionKey, persistCurrentWorkspaceSessionState]);

  // Callback for file cards in chat messages - opens the in-app preview
  // panel instead of the system default editor.
  const handleOpenAttachedFile = useCallback((file: AttachedFileMeta) => {
    if (!file.filePath) return;
    if (file.mimeType === 'application/x-directory') {
      void hostApi.shell.openPath(file.filePath)
        .then((error) => {
          if (typeof error === 'string' && error) {
            toast.error(error);
          }
        })
        .catch(() => {
          toast.error(t('filePreview.errors.openInFinderFailed'));
        });
      return;
    }
    const target = buildPreviewTarget(file.filePath, file.fileName, file.fileSize);
    openWorkspacePanel({ panel: 'files', filePath: target.filePath });
  }, [openWorkspacePanel, t]);

  const handlePickWorkspaceFolder = useCallback(async () => {
    const result = await hostApi.dialog.open({
      title: t('toolbar.addWorkspaceDialogTitle'),
      buttonLabel: t('toolbar.addWorkspaceDialogButton'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return;
    const rootPath = result.filePaths[0];
    const normalizedRootPath = normalizeComparablePath(rootPath);
    const existing = workspaceProfiles.find((profile) => normalizeComparablePath(profile.rootPath) === normalizedRootPath);
    try {
      await persistCurrentWorkspaceSessionState({
        activeSessionKey: currentSessionKey,
        sessionKey: currentSessionKey,
      });
      if (existing) {
        await handleSwitchWorkspace(existing.id);
        toast.success(t('workspace.switched'));
      } else {
        const nextSessionKey = createFreshWorkspaceSessionKey(currentAgentId);
        const nextWorkspace = await createWorkspace({
          rootPath,
          agentId: currentAgentId,
          activeSessionKey: nextSessionKey,
        });
        workspaceSessionRestoreTargetRef.current = {
          workspaceId: nextWorkspace?.id ?? '',
          sessionKey: nextSessionKey,
        };
        lastRestoredWorkspaceIdRef.current = nextWorkspace?.id ?? null;
        lastObservedSessionKeyRef.current = nextSessionKey;
        workspaceStateRestoreRef.current = { workspaceId: null, sessionKey: null };
        setComposerDraft('');
        setRunActivityExpandedOverrides({});
        setContextRange(null);
        setLiveUsage(null);
        resetSessionView(nextSessionKey);
        toast.success(t('workspace.addedAndSwitched'));
      }
    } catch (error) {
      toast.error(t('workspace.switchFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
  }, [createWorkspace, currentAgentId, currentSessionKey, handleSwitchWorkspace, persistCurrentWorkspaceSessionState, resetSessionView, t, workspaceProfiles]);
  useEffect(() => {
    const previousSessionKey = lastObservedSessionKeyRef.current;
    if (previousSessionKey !== currentSessionKey) {
      void persistCurrentWorkspaceSessionState({ sessionKey: previousSessionKey });
      lastObservedSessionKeyRef.current = currentSessionKey;
    }
  }, [currentSessionKey, persistCurrentWorkspaceSessionState]);
  const graphStepCache: Record<string, GraphStepCacheEntry> = graphStepCacheStore.get(currentSessionKey) ?? {};
  const { contentRef, scrollRef, scrollToBottom, isAtBottom } = useStickToBottomInstant(currentSessionKey, sending);

  const startupPending = messages.length === 0 && startupPhase !== 'ready' && startupPhase !== 'error';
  const messageAreaLoading = startupPending || (loading && messages.length === 0);
  const [showStartupStatus, setShowStartupStatus] = useState(false);
  const [showSyncStatus, setShowSyncStatus] = useState(false);

  useEffect(() => {
    if (!messageAreaLoading) {
      setShowStartupStatus(false);
      return;
    }
    const timer = window.setTimeout(() => setShowStartupStatus(true), 600);
    return () => window.clearTimeout(timer);
  }, [messageAreaLoading]);

  useEffect(() => {
    if (!historyRefreshing || messageAreaLoading) {
      setShowSyncStatus(false);
      return;
    }
    const timer = window.setTimeout(() => setShowSyncStatus(true), 300);
    return () => window.clearTimeout(timer);
  }, [historyRefreshing, messageAreaLoading]);

  // Load data when gateway is running.
  // When the store already holds messages for this session (i.e. the user
  // is navigating *back* to Chat), use quiet mode so the existing messages
  // stay visible while fresh data loads in the background.  This avoids
  // an unnecessary messages → spinner → messages flicker.
  useEffect(() => {
    return () => {
      // If the user navigates away without sending any messages, remove the
      // empty session so it doesn't linger as a ghost entry in the sidebar.
      cleanupEmptySession();
    };
  }, [cleanupEmptySession]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  // Startup hydration is Main-owned through the chat store. Re-run when the
  // Gateway runtime changes so a page mounted before readiness can load once
  // the connection becomes available.
  useEffect(() => {
    void hydrateStartup();
  }, [
    gatewayStatus.connectedAt,
    gatewayStatus.gatewayReady,
    gatewayStatus.pid,
    gatewayStatus.port,
    gatewayStatus.state,
    hydrateStartup,
  ]);

  useEffect(() => {
    if (!activeWorkspace?.activeSessionKey) return;
    if (lastRestoredWorkspaceIdRef.current === activeWorkspace.id) return;
    lastRestoredWorkspaceIdRef.current = activeWorkspace.id;
    lastObservedSessionKeyRef.current = activeWorkspace.activeSessionKey;
    workspaceSessionRestoreTargetRef.current = {
      workspaceId: activeWorkspace.id,
      sessionKey: activeWorkspace.activeSessionKey,
    };
    setContextRange(null);
    setLiveUsage(null);
    resetSessionView(activeWorkspace.activeSessionKey);
  }, [activeWorkspace?.id, activeWorkspace?.activeSessionKey, currentSessionKey, resetSessionView]);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    const restored = workspaceStateRestoreRef.current;
    if (restored.workspaceId === activeWorkspace.id && restored.sessionKey === currentSessionKey) return;
    const sessionState = getWorkspaceSessionState(activeWorkspace, currentSessionKey);
    skipNextWorkspaceStateSaveRef.current = true;
    workspaceStateRestoreRef.current = {
      workspaceId: activeWorkspace.id,
      sessionKey: currentSessionKey,
    };
    setComposerDraft(sessionState.draftInput ?? '');
    setRunActivityExpandedOverrides({
      ...(sessionState.graphExpanded ?? {}),
      ...(sessionState.turnSummaryExpanded ?? {}),
    });
    setKnowledgeScope(sessionState.knowledgeScope ?? 'none');
    setKnowledgeMode(sessionState.knowledgeMode ?? 'suggest');
    void clearActiveTopicMarker(activeWorkspace.rootPath);
    restoreArtifactPanelState(sessionState.artifactPanel ?? { open: false });
  }, [activeWorkspace, clearActiveTopicMarker, currentSessionKey, restoreArtifactPanelState]);

  useEffect(() => {
    if (!activeWorkspace?.id || activeWorkspace.activeSessionKey === currentSessionKey) return;
    const restoreTarget = workspaceSessionRestoreTargetRef.current;
    if (restoreTarget?.workspaceId === activeWorkspace.id) {
      if (restoreTarget.sessionKey === currentSessionKey) {
        workspaceSessionRestoreTargetRef.current = null;
      }
      return;
    }
    void saveWorkspaceState({
      id: activeWorkspace.id,
      activeSessionKey: currentSessionKey,
    });
  }, [activeWorkspace?.id, activeWorkspace?.activeSessionKey, currentSessionKey, saveWorkspaceState]);

  const handleComposerDraftChange = useCallback((value: string) => {
    setComposerDraft(value);
    if (!activeWorkspace?.id) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      void saveWorkspaceState({
        id: activeWorkspace.id,
        sessionKey: currentSessionKey,
        state: captureCurrentWorkspaceSessionState(value),
      });
    }, 250);
  }, [activeWorkspace?.id, captureCurrentWorkspaceSessionState, currentSessionKey, saveWorkspaceState]);

  const handleKnowledgeScopeChange = useCallback((scope: WorkspaceKnowledgeScope) => {
    setKnowledgeScope(scope);
    if (!activeWorkspace?.id) return;
    void saveWorkspaceState({
      id: activeWorkspace.id,
      sessionKey: currentSessionKey,
      state: {
        ...captureCurrentWorkspaceSessionState(composerDraft),
        knowledgeScope: scope,
      },
    });
  }, [activeWorkspace?.id, captureCurrentWorkspaceSessionState, composerDraft, currentSessionKey, saveWorkspaceState]);

  const handleKnowledgeModeChange = useCallback((mode: KnowledgeInvocationMode) => {
    setKnowledgeMode(mode);
    if (!activeWorkspace?.id) return;
    void saveWorkspaceState({
      id: activeWorkspace.id,
      sessionKey: currentSessionKey,
      state: {
        ...captureCurrentWorkspaceSessionState(composerDraft),
        knowledgeMode: mode,
      },
    });
  }, [activeWorkspace?.id, captureCurrentWorkspaceSessionState, composerDraft, currentSessionKey, saveWorkspaceState]);

  // Send animation state for the verse-style empty-state transition. Declared
  // here rather than beside `isEmpty` because handleSendMessage below needs it,
  // and that callback is defined long before `isEmpty` exists.
  const [sendingAnimation, setSendingAnimation] = useState(false);

  const handleSendMessage = useCallback((
    text: string,
    opts?: SendOptions,
  ) => {
    const resolved: SendOptions = {
      ...opts,
      knowledgeMode: opts?.knowledgeMode ?? knowledgeMode,
    };

    // First message out of the empty state: slide the composer down and fade
    // the hero scaffolding out. Same predicate `isEmpty` uses, minus the
    // startup-phase terms, which cannot be false on a user-driven send.
    if (messages.length === 0 && !sending) {
      setSendingAnimation(true);
      window.setTimeout(() => setSendingAnimation(false), 800);
    }

    return sendMessage(text, resolved);
  }, [knowledgeMode, messages.length, sending, sendMessage]);

  const handleSubmitInteractionResponse = useCallback((responseText: string) => {
    void handleSendMessage(responseText);
  }, [handleSendMessage]);

  const handleOpenRecoveryMemoryDraft = useCallback(() => {
    const sessionLabel = getSessionDisplayName(currentSessionKey, sessions, sessionLabels);
    const body = buildKnowledgeDraftBody(messages);
    setKnowledgeDraftTitle(t('composer.rollbackPlan.memoryDraft.title', { session: sessionLabel }));
    setKnowledgeDraftBody([
      t('composer.rollbackPlan.memoryDraft.reviewNotice'),
      '',
      body.trim() || t('composer.rollbackPlan.memoryDraft.emptyBody', { sessionKey: currentSessionKey }),
    ].join('\n'));
    setKnowledgeDraftOpen(true);
  }, [currentSessionKey, messages, sessionLabels, sessions, t]);

  const handleApplyKnowledgeDraft = useCallback(async () => {
    const title = knowledgeDraftTitle.trim();
    const body = knowledgeDraftBody.trim();
    if (!title || !body) {
      toast.error(t('knowledgeDraft.invalid'));
      return;
    }
    setKnowledgeDraftApplying(true);
    try {
      const draftResult = await hostApi.knowledge.createDraft({
        title,
        body,
        type: 'synthesis',
        sourceIds: [currentSessionKey],
        sourceRefs: [{ id: currentSessionKey, kind: 'chat', label: title }],
        createdBy: 'user',
      });
      if (!draftResult.success || !draftResult.draft) throw new Error(draftResult.error || t('knowledgeDraft.applyFailed'));
      const proposalResult = await hostApi.knowledge.proposeChange({
        operation: 'create',
        draftId: draftResult.draft.id,
        reason: t('knowledgeDraft.proposalReason'),
        sources: [{ id: currentSessionKey, kind: 'chat', label: title }],
      });
      if (!proposalResult.success) throw new Error(proposalResult.error || t('knowledgeDraft.applyFailed'));
      toast.success(t('knowledgeDraft.applied'));
      setKnowledgeDraftOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setKnowledgeDraftApplying(false);
    }
  }, [currentSessionKey, knowledgeDraftBody, knowledgeDraftTitle, t]);

  const handleArtifactSessionStateChange = useCallback((patch: WorkspaceArtifactPanelState) => {
    if (!activeWorkspaceId) return;
    void saveWorkspaceState({
      id: activeWorkspaceId,
      sessionKey: currentSessionKey,
      state: {
        artifactPanel: patch,
      },
    });
  }, [activeWorkspaceId, currentSessionKey, saveWorkspaceState]);

  useEffect(() => {
    const routeState = location.state as { workspacePanelIntent?: WorkspacePanelIntent } | null;
    let intent = routeState?.workspacePanelIntent ?? null;
    const search = new URLSearchParams(location.search);
    const panel = search.get('workspacePanel');
    const view = search.get('view');

    if (!intent && panel === 'browser') {
      intent = {
        panel: 'browser',
        view: view === 'preview' ? 'preview' : 'live',
        url: search.get('url') ?? undefined,
        sessionId: search.get('sessionId') ?? undefined,
      };
    } else if (!intent && panel === 'review') {
      intent = {
        panel: 'review',
        view: view === 'changes' || view === 'pull-requests' ? view : 'ai-review',
        filePath: search.get('filePath') ?? undefined,
      };
    } else if (!intent && panel === 'files') {
      intent = { panel: 'files', filePath: search.get('filePath') ?? undefined };
    } else if (!intent && panel === 'terminal') {
      intent = { panel: 'terminal', placement: search.get('placement') === 'side' ? 'side' : 'bottom' };
    } else if (!intent && panel === 'artifact') {
      intent = { panel: 'artifact', artifactId: search.get('artifactId') ?? undefined };
    } else if (!intent && panel === 'audit') {
      intent = { panel: 'audit' };
    }

    if (!intent) return;
    openWorkspacePanel(intent);
    const state = useArtifactPanel.getState();
    handleArtifactSessionStateChange({
      open: true,
      activeTabKind: intent.panel,
      reviewView: state.reviewView,
      browserView: state.browserView,
      browserSessionId: state.browserSessionId,
      terminalPlacement: state.terminalPlacement,
      selectedPath: state.selectedPath,
    });

    ['workspacePanel', 'view', 'filePath', 'placement', 'sessionId', 'url', 'artifactId'].forEach((key) => search.delete(key));
    const nextSearch = search.toString();
    navigate(
      { pathname: '/', search: nextSearch ? `?${nextSearch}` : '', hash: location.hash },
      { replace: true, state: null },
    );
  }, [handleArtifactSessionStateChange, location.hash, location.search, location.state, navigate, openWorkspacePanel]);

  useEffect(() => {
    const enforceNarrowTerminalPlacement = () => {
      if (window.innerWidth > 960 || useArtifactPanel.getState().terminalPlacement === 'bottom') return;
      const activeKind = useArtifactPanel.getState().tabs.find(
        (tab) => tab.id === useArtifactPanel.getState().activeTabId,
      )?.kind;
      if (activeKind !== 'terminal') return;
      setTerminalPlacement('bottom');
      handleArtifactSessionStateChange({ terminalPlacement: 'bottom' });
    };
    enforceNarrowTerminalPlacement();
    window.addEventListener('resize', enforceNarrowTerminalPlacement);
    return () => window.removeEventListener('resize', enforceNarrowTerminalPlacement);
  }, [handleArtifactSessionStateChange, setTerminalPlacement]);

  /* Workspace capability entry points share the canonical intent contract. */
  const handleOpenWorkspaceWebView = useCallback(() => {
    openWorkspacePanel({ panel: 'browser', view: 'preview' });
    if (!activeWorkspaceId) return;
    void saveWorkspaceState({
      id: activeWorkspaceId,
      sessionKey: currentSessionKey,
      state: {
        artifactPanel: { open: true, activeTabKind: 'browser' },
      },
    });
  }, [activeWorkspaceId, currentSessionKey, openWorkspacePanel, saveWorkspaceState]);

  const handleOpenTaskLedger = useCallback(() => {
    const nodeId = longTaskControlStatus?.latestCheckpoint?.taskLedgerRootId;
    navigate(nodeId ? `/task-ledger?nodeId=${encodeURIComponent(nodeId)}` : '/task-ledger');
  }, [longTaskControlStatus?.latestCheckpoint?.taskLedgerRootId, navigate]);

  const handleOpenClawGraph = useCallback(() => {
    const runId = longTaskControlStatus?.latestCheckpoint?.clawGraphRunId;
    navigate(runId ? `/clawgraph?runId=${encodeURIComponent(runId)}` : '/clawgraph');
  }, [longTaskControlStatus?.latestCheckpoint?.clawGraphRunId, navigate]);

  const handleAppendComposerDraft = useCallback((text: string) => {
    const nextDraft = composerDraft.trim()
      ? `${composerDraft.trim()}\n\n${text}`
      : text;
    handleComposerDraftChange(nextDraft);
  }, [composerDraft, handleComposerDraftChange]);

  const handleOpenSlashCommands = useCallback(() => {
    setComposerSlashRequest((value) => value + 1);
  }, []);

  const handleQuoteSelection = useCallback((text: string) => {
    const clipped = text.replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (!clipped) return;
    handleAppendComposerDraft(`> ${clipped.replace(/\n/g, '\n> ')}\n\n`);
  }, [handleAppendComposerDraft]);

  const knowledgeAdvisorySource = useMemo<KnowledgeAdvisorySource | null>(() => {
    if (runError?.trim()) {
      const text = runError.trim();
      return {
        key: `run-error:${currentSessionKey}:${text}`,
        signal: {
          text,
          kind: classifyErrorGuardSignal(text),
          stackTrace: text,
          filePaths: extractLikelyFilePaths(text),
          sessionKey: currentSessionKey,
          workspaceId: activeWorkspaceId ?? null,
        },
      };
    }

    const latestUserMessage = [...messages].reverse().find((message) => isRealUserMessage(message));
    const text = latestUserMessage ? extractText(latestUserMessage).trim() : '';
    if (!text || !USER_CORRECTION_SIGNAL_PATTERN.test(text)) return null;
    return {
      key: `user-correction:${currentSessionKey}:${latestUserMessage?.id ?? latestUserMessage?.timestamp ?? text}`,
      signal: {
        text,
        kind: 'user-correction',
        filePaths: extractLikelyFilePaths(text),
        sessionKey: currentSessionKey,
        workspaceId: activeWorkspaceId ?? null,
      },
    };
  }, [activeWorkspaceId, currentSessionKey, messages, runError]);

  const knowledgeAdvisorySourceKey = knowledgeAdvisorySource?.key ?? null;

  useEffect(() => {
    knowledgeAdvisorySourceRef.current = knowledgeAdvisorySource;
  }, [knowledgeAdvisorySource]);

  useEffect(() => {
    if (!knowledgeAdvisorySourceKey) return;
    const source = knowledgeAdvisorySourceRef.current;
    if (!source || source.key !== knowledgeAdvisorySourceKey) return;
    if (lastKnowledgeAdvisorySignalKeyRef.current === source.key) return;
    lastKnowledgeAdvisorySignalKeyRef.current = source.key;
    const signalKey = source.key;
    const signal = source.signal;
    let cancelled = false;
    void hostApi.knowledge.matchErrorExperience({ signal, limit: 1 })
      .then((result) => {
        if (cancelled || !result.success) return;
        const advisory = result.advisories[0];
        if (!advisory) return;
        const dismissalKey = `${signalKey}:${advisory.id}`;
        if (dismissedKnowledgeAdvisoryKeys.has(dismissalKey)) return;
        setKnowledgeErrorAdvisory(advisory);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dismissedKnowledgeAdvisoryKeys, knowledgeAdvisorySourceKey]);

  const handleDismissKnowledgeErrorAdvisory = useCallback(async () => {
    const advisory = knowledgeErrorAdvisory;
    if (!advisory) return;
    const signalKey = knowledgeAdvisorySource?.key ?? currentSessionKey;
    setDismissedKnowledgeAdvisoryKeys((current) => new Set(current).add(`${signalKey}:${advisory.id}`));
    setKnowledgeErrorAdvisory(null);
    setKnowledgeErrorAdvisoryBusy(true);
    try {
      await hostApi.knowledge.updateErrorExperienceEffectiveness({
        targetKind: advisory.targetKind,
        targetId: advisory.targetId,
        action: 'dismissed',
        note: 'chat advisory dismissed',
      });
    } catch {
      // Best-effort effectiveness telemetry only; never affect Chat.
    } finally {
      setKnowledgeErrorAdvisoryBusy(false);
    }
  }, [currentSessionKey, knowledgeAdvisorySource?.key, knowledgeErrorAdvisory]);

  const handleUseKnowledgeErrorAdvisory = useCallback(async () => {
    const advisory = knowledgeErrorAdvisory;
    if (!advisory) return;
    handleAppendComposerDraft(buildAdvisoryComposerText(advisory, t('knowledgeGuard.composerPrefix', { title: advisory.title })));
    setKnowledgeErrorAdvisory(null);
    setKnowledgeErrorAdvisoryBusy(true);
    try {
      await hostApi.knowledge.updateErrorExperienceEffectiveness({
        targetKind: advisory.targetKind,
        targetId: advisory.targetId,
        action: 'accepted',
        note: 'chat advisory used',
      });
      toast.success(t('knowledgeGuard.usedToast'));
    } catch {
      // Best-effort effectiveness telemetry only; composer update already happened.
    } finally {
      setKnowledgeErrorAdvisoryBusy(false);
    }
  }, [handleAppendComposerDraft, knowledgeErrorAdvisory, t]);

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    if (skipNextWorkspaceStateSaveRef.current) {
      skipNextWorkspaceStateSaveRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void saveWorkspaceState({
        id: activeWorkspace.id,
        sessionKey: currentSessionKey,
        state: captureCurrentWorkspaceSessionState(),
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [activeWorkspace?.id, artifactActiveTabId, artifactTabs, captureCurrentWorkspaceSessionState, currentSessionKey, panelOpen, runActivityExpandedOverrides, saveWorkspaceState]);

  useEffect(() => () => {
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
  }, []);

  const contextRangeRef = useRef(contextRange);
  contextRangeRef.current = contextRange;
  const liveUsageRef = useRef(liveUsage);
  liveUsageRef.current = liveUsage;
  const compactionStatusRef = useRef(compactionStatus);
  compactionStatusRef.current = compactionStatus;
  const longTaskControlStatusRef = useRef(longTaskControlStatus);
  longTaskControlStatusRef.current = longTaskControlStatus;

  useEffect(() => {
    let cancelled = false;
    const timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      void hostApi.usage.contextRange({
        sessionKey: currentSessionKey,
        modelRef: currentModelRef,
        messageCount: messages.length,
        usedTokens: liveUsageRef.current?.totalTokens ?? null,
      })
        .then((result) => {
          if (!cancelled) setContextRange(result.range);
        })
        .catch(() => {
          if (!cancelled) setContextRange(null);
        });
    }, 500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [currentModelRef, currentSessionKey, messages.length]);

  useEffect(() => {
    let cancelled = false;
    const timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      void hostApi.usage.live(currentSessionKey, activeRunId, sending || pendingFinal || Boolean(streamingMessage))
        .then((result) => {
          if (!cancelled) setLiveUsage(result.usage);
        })
        .catch(() => {
          if (!cancelled) setLiveUsage(null);
        });
    }, 500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [currentSessionKey, activeRunId, sending, pendingFinal, streamingMessage]);

  useEffect(() => {
    let cancelled = false;
    const timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      void hostApi.usage.promptCacheStatus({
        sessionKey: currentSessionKey,
        modelRef: currentModelRef,
        usedTokens: liveUsage?.totalTokens ?? contextRange?.usedTokens ?? null,
      })
        .then((result) => {
          if (!cancelled) setPromptCacheStatus(result.success ? result.assessment : null);
        })
        .catch(() => {
          if (!cancelled) setPromptCacheStatus(null);
        });
    }, 650);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    contextRange?.usedTokens,
    currentModelRef,
    currentSessionKey,
    liveUsage?.cacheReadTokens,
    liveUsage?.cacheWriteTokens,
    liveUsage?.totalTokens,
  ]);

  const refreshCompactionStatus = useCallback(async () => {
    try {
      const result = await hostApi.sessions.compactionStatus({
        sessionKey: currentSessionKey,
        agentId: currentAgentId,
      });
      setCompactionStatus(result.success ? result : null);
    } catch {
      setCompactionStatus(null);
    }
  }, [currentAgentId, currentSessionKey]);

  const refreshLongTaskControlStatus = useCallback(async () => {
    try {
      const result = await hostApi.sessions.longTaskControlStatus({
        sessionKey: currentSessionKey,
        agentId: currentAgentId,
      });
      setLongTaskControlStatus(result.success ? result : null);
    } catch {
      setLongTaskControlStatus(null);
    }
  }, [currentAgentId, currentSessionKey]);

  const handleConfirmTaskLoopUpgrade = useCallback(async (suggestion: TaskLoopUpgradeSuggestion) => {
    setTaskLoopUpgradeBusy(true);
    try {
      const result = await startTaskLoopUpgradeRun({
        rpc: hostApi.gateway.rpc,
        suggestion,
        taskText: composerDraft,
        sessionKey: currentSessionKey,
        agentId: currentAgentId,
        workspaceId: activeWorkspace?.id ?? null,
      });
      toast.success(t('composer.taskLoopUpgrade.toastUpdated', {
        status: result.status || t('composer.taskLoopUpgrade.unknownStatus'),
      }));
      await Promise.all([
        refreshLongTaskControlStatus(),
        refreshTaskLedger(),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('composer.taskLoopUpgrade.toastFailed'));
      throw error;
    } finally {
      setTaskLoopUpgradeBusy(false);
    }
  }, [
    activeWorkspace?.id,
    composerDraft,
    currentAgentId,
    currentSessionKey,
    refreshLongTaskControlStatus,
    refreshTaskLedger,
    t,
  ]);

  useEffect(() => {
    let cancelled = false;
    const timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      void hostApi.sessions.compactionStatus({
        sessionKey: currentSessionKey,
        agentId: currentAgentId,
      })
        .then((result) => {
          if (!cancelled) setCompactionStatus(result.success ? result : null);
        })
        .catch(() => {
          if (!cancelled) setCompactionStatus(null);
        });
    }, 500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [currentAgentId, currentSessionKey, messages.length]);

  useEffect(() => {
    let cancelled = false;
    const timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      void hostApi.sessions.longTaskControlStatus({
        sessionKey: currentSessionKey,
        agentId: currentAgentId,
      })
        .then((result) => {
          if (!cancelled) setLongTaskControlStatus(result.success ? result : null);
        })
        .catch(() => {
          if (!cancelled) setLongTaskControlStatus(null);
        });
    }, 500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [currentAgentId, currentSessionKey, messages.length]);

  useEffect(() => {
    const unsubscribe = hostEvents.onChatQueueStatus((payload) => {
      if (payload.sessionKey === currentSessionKey) {
        void refreshLongTaskControlStatus();
      }
    });
    return unsubscribe;
  }, [currentSessionKey, refreshLongTaskControlStatus]);

  const handleDrainQueuedFollowup = useCallback(async () => {
    setQueueDrainBusy(true);
    try {
      const result = await hostApi.sessions.queueDrain({
        sessionKey: currentSessionKey,
        agentId: currentAgentId,
      });
      if (!result.success) {
        toast.error(result.error || t('composer.longTaskControl.drainFailed'));
        return;
      }
      if (result.drained) {
        toast.success(t('composer.longTaskControl.drainSuccess', {
          count: result.messageCount ?? 0,
        }));
      } else {
        toast.message(t(`composer.longTaskControl.reason.${result.reason ?? 'empty_queue'}`, {
          defaultValue: result.reason ?? t('composer.longTaskControl.reason.empty_queue'),
        }));
      }
      await refreshLongTaskControlStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('composer.longTaskControl.drainFailed'));
    } finally {
      setQueueDrainBusy(false);
    }
  }, [currentAgentId, currentSessionKey, refreshLongTaskControlStatus, t]);

  const handleManualCompact = useCallback(async (customInstructions?: string) => {
    setCompactionBusy(true);
    try {
      const result = await hostApi.sessions.compact({
        sessionKey: currentSessionKey,
        agentId: currentAgentId,
        customInstructions,
        force: true,
      });
      if (!result.success) {
        toast.error(result.error || t('composer.compaction.toastFailed'));
        return;
      }
      if (result.compacted) {
        const before = typeof result.tokensBefore === 'number'
          ? formatTokenCountForToast(result.tokensBefore)
          : null;
        const after = typeof result.tokensAfter === 'number'
          ? formatTokenCountForToast(result.tokensAfter)
          : null;
        toast.success(before && after
          ? t('composer.compaction.toastSuccessWithTokens', { before, after })
          : t('composer.compaction.toastSuccess'));
      } else {
        toast.message(t('composer.compaction.toastNoop', {
          reason: result.reason
            ? t(`composer.compaction.reason.${result.reason}`, { defaultValue: result.reason })
            : t('composer.compaction.reason.already_compacted'),
        }));
      }
      void (async () => {
        await Promise.all([
          loadHistory(true),
          loadSessions(),
        ]);
        await Promise.all([
          refreshCompactionStatus(),
          refreshLongTaskControlStatus(),
          hostApi.usage.contextRange({
            sessionKey: currentSessionKey,
            modelRef: currentModelRef,
            messageCount: messages.length,
            usedTokens: liveUsage?.totalTokens ?? null,
          }).then((contextResult) => setContextRange(contextResult.range)).catch(() => setContextRange(null)),
        ]);
      })().catch((refreshError) => {
        console.warn('[chat:manual-compaction] refresh failed', refreshError);
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('composer.compaction.toastFailed'));
    } finally {
      setCompactionBusy(false);
    }
  }, [currentAgentId, currentModelRef, currentSessionKey, liveUsage?.totalTokens, loadHistory, loadSessions, messages.length, refreshCompactionStatus, refreshLongTaskControlStatus, t]);

  const handleViewCompactionArtifact = useCallback(async () => {
    setCompactionArtifactOpen(true);
    setCompactionArtifactBusy(true);
    setCompactionArtifact(null);
    setCompactionArtifactCheckpointId(null);
    setCompactionArtifactWarnings([]);
    try {
      const result = await hostApi.sessions.compressionArtifact({
        sessionKey: currentSessionKey,
        agentId: currentAgentId,
      });
      setCompactionArtifact(result.artifact ?? null);
      setCompactionArtifactCheckpointId(result.checkpointId ?? null);
      setCompactionArtifactWarnings(result.warnings ?? []);
      if (!result.success) {
        toast.message(result.error || t('composer.compaction.artifactViewer.loadFailed'));
      }
    } catch (error) {
      setCompactionArtifactWarnings([
        error instanceof Error ? error.message : t('composer.compaction.artifactViewer.loadFailed'),
      ]);
      toast.message(error instanceof Error ? error.message : t('composer.compaction.artifactViewer.loadFailed'));
    } finally {
      setCompactionArtifactBusy(false);
    }
  }, [currentAgentId, currentSessionKey, t]);

  const continuityRunActive = sending || pendingFinal || Boolean(streamingMessage) || Boolean(activeRunId);
  const gatewayAvailable = isGatewayRunning && gatewayStatus.gatewayReady !== false;
  const continuityPreflight = useMemo(() => resolveSessionContinuityPreflight({
    gatewayAvailable,
    activeRun: continuityRunActive,
    contextRange,
    liveUsage,
    compactionStatus,
    longTaskControlStatus,
  }), [compactionStatus, contextRange, continuityRunActive, gatewayAvailable, liveUsage, longTaskControlStatus]);
  const continuityRecommendation = continuityPreflight.recommendation;
  const handoffDisabled = continuityPreflight.handoff.disabled;
  const forkDisabled = continuityPreflight.fork.disabled;
  const handleForkSessionRef = useRef<(() => Promise<void>) | null>(null);
  const handlePrepareHandoffRef = useRef<(() => Promise<void>) | null>(null);

  const persistCurrentContinuitySourceSession = useCallback(async () => {
    await persistCurrentWorkspaceSessionState({
      activeSessionKey: currentSessionKey,
      sessionKey: currentSessionKey,
    });
  }, [currentSessionKey, persistCurrentWorkspaceSessionState]);

  const showContinuityFailureToast = useCallback(({
    action,
    kind,
    message,
    fallback,
  }: {
    action: 'fork' | 'handoff';
    kind: SessionContinuityErrorKind;
    message: string;
    fallback?: {
      kind: 'prepareHandoff' | 'tryFork';
      onClick: () => void | Promise<void>;
    };
  }) => {
    const fallbackTitle = action === 'fork' ? t('composer.fork.toastFailed') : t('composer.handoff.toastPrepareFailed');
    const toastOptions: Parameters<typeof toast.error>[1] = {
      description: t(`composer.continuity.failure.${action}.${kind}.description`, { defaultValue: message }),
    };
    if (fallback) {
      toastOptions.action = {
        label: t(`composer.continuity.failure.action.${fallback.kind}`),
        onClick: () => {
          void fallback.onClick();
        },
      };
    }
    toast.error(t(`composer.continuity.failure.${action}.${kind}.title`, { defaultValue: fallbackTitle }), toastOptions);
  }, [t]);

  const handleForkSession = useCallback(async () => {
    if (forkDisabled || forkBusy) return;
    const sourceSessionKey = currentSessionKey;
    setForkBusy(true);
    try {
      await persistCurrentContinuitySourceSession();
      const nextSessionKey = await createWorkspaceScopedForkSession(sourceSessionKey);
      workspaceSessionRestoreTargetRef.current = activeWorkspace?.id
        ? { workspaceId: activeWorkspace.id, sessionKey: nextSessionKey }
        : null;
      setSessionLineage((current) => ({
        ...current,
        [nextSessionKey]: {
          relation: 'forked_from',
          sourceSessionKey,
        },
      }));
      lastRestoredWorkspaceIdRef.current = activeWorkspace?.id ?? null;
      lastObservedSessionKeyRef.current = nextSessionKey;
      workspaceStateRestoreRef.current = { workspaceId: null, sessionKey: null };
      resetSessionView(nextSessionKey);
      setContextRange(null);
      setLiveUsage(null);
      setCompactionStatus(null);
      await loadSessions();
      await loadHistory();
      toast.success(t('composer.fork.toastCreated'));
    } catch (error) {
      const kind = classifySessionContinuityError(error);
      const fallbackKind = getContinuityFallbackActionKind(kind);
      showContinuityFailureToast({
        action: 'fork',
        kind,
        message: getContinuityErrorMessage(error, t('composer.fork.toastFailed')),
        fallback: fallbackKind
          ? {
            kind: fallbackKind,
            onClick: () => handlePrepareHandoffRef.current?.(),
          }
          : undefined,
      });
    } finally {
      setForkBusy(false);
    }
  }, [
    activeWorkspace?.id,
    currentSessionKey,
    forkBusy,
    forkDisabled,
    loadHistory,
    loadSessions,
    persistCurrentContinuitySourceSession,
    resetSessionView,
    showContinuityFailureToast,
    t,
  ]);

  const handlePrepareHandoff = useCallback(async () => {
    if (handoffDisabled || handoffBusy) return;
    setHandoffBusy(true);
    try {
      const result = await hostApi.sessions.prepareHandoff({
        sessionKey: currentSessionKey,
        agentId: currentAgentId,
        workspaceId: activeWorkspace?.id ?? null,
      });
      if (!result.success || !result.draft) {
        const kind = classifySessionContinuityError(result);
        showContinuityFailureToast({
          action: 'handoff',
          kind,
          message: result.error || t('composer.handoff.toastPrepareFailed'),
          fallback: gatewayAvailable && kind !== 'active_run'
            ? {
              kind: 'tryFork',
              onClick: () => handleForkSessionRef.current?.(),
            }
            : undefined,
        });
        return;
      }
      setHandoffResult(result);
      setHandoffDraft(result.draft);
      setHandoffDialogOpen(true);
    } catch (error) {
      const kind = classifySessionContinuityError(error);
      showContinuityFailureToast({
        action: 'handoff',
        kind,
        message: getContinuityErrorMessage(error, t('composer.handoff.toastPrepareFailed')),
        fallback: gatewayAvailable && kind !== 'active_run'
          ? {
            kind: 'tryFork',
            onClick: () => handleForkSessionRef.current?.(),
          }
          : undefined,
      });
    } finally {
      setHandoffBusy(false);
    }
  }, [
    activeWorkspace?.id,
    currentAgentId,
    currentSessionKey,
    gatewayAvailable,
    handoffBusy,
    handoffDisabled,
    showContinuityFailureToast,
    t,
  ]);

  handleForkSessionRef.current = handleForkSession;
  handlePrepareHandoffRef.current = handlePrepareHandoff;

  const handleCreateHandoffSession = useCallback(async () => {
    const draft = handoffDraft.trim();
    if (!draft || handoffCreating) return;
    setHandoffCreating(true);
    const sourceSessionKey = currentSessionKey;
    try {
      await persistCurrentContinuitySourceSession();
      const nextSessionKey = await createWorkspaceScopedHandoffSession(draft);
      workspaceSessionRestoreTargetRef.current = activeWorkspace?.id
        ? { workspaceId: activeWorkspace.id, sessionKey: nextSessionKey }
        : null;
      lastRestoredWorkspaceIdRef.current = activeWorkspace?.id ?? null;
      lastObservedSessionKeyRef.current = nextSessionKey;
      workspaceStateRestoreRef.current = { workspaceId: null, sessionKey: null };
      resetSessionView(nextSessionKey);
      setComposerDraft(draft);
      setRunActivityExpandedOverrides({});
      setContextRange(null);
      setLiveUsage(null);
      setKnowledgeScope('none');
      setHandoffDialogOpen(false);
      toast.success(t('composer.handoff.toastCreated'));
      if (activeWorkspace?.id) {
        void hostApi.taskLedger.linkSession({
          workspaceId: activeWorkspace.id,
          sessionKey: nextSessionKey,
          agentId: currentAgentId,
          relation: 'handoff_from',
          sourceSessionKey,
          summary: t('composer.handoff.ledgerSummary', { source: sourceSessionKey }),
          idempotencyKey: `handoff:${sourceSessionKey}:${nextSessionKey}`,
        }).catch((error) => {
          console.warn('[chat:handoff] failed to link task ledger session', error);
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('composer.handoff.toastCreateFailed'));
    } finally {
      setHandoffCreating(false);
    }
  }, [
    activeWorkspace?.id,
    activeWorkspace?.permissionMode,
    currentAgentId,
    currentSessionKey,
    handoffCreating,
    handoffDraft,
    persistCurrentContinuitySourceSession,
    resetSessionView,
    t,
  ]);

  const handlePermissionModeChange = useCallback((mode: WorkspacePermissionMode) => {
    if (!activeWorkspace?.id) return;
    void setPermissionMode(activeWorkspace.id, mode)
      .then(() => toast.success(t('workspace.permissionModeUpdated')))
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  }, [activeWorkspace?.id, setPermissionMode, t]);

  useEffect(() => {
    const completions = messages
      .map((message) => parseSubagentCompletionInfo(message))
      .filter((value): value is NonNullable<typeof value> => value != null);
    const missing = completions.filter((completion) => !childTranscripts[completion.sessionId]);
    if (missing.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missing.map(async (completion) => {
        try {
          const result = await hostApi.sessions.history({
            agentId: completion.agentId,
            sessionId: completion.sessionId,
          });
          if (!result.success) {
            console.warn('Failed to load child transcript:', {
              agentId: completion.agentId,
              sessionId: completion.sessionId,
              result,
            });
            return null;
          }
          return { sessionId: completion.sessionId, messages: result.messages || [] };
        } catch (error) {
          console.warn('Failed to load child transcript:', {
            agentId: completion.agentId,
            sessionId: completion.sessionId,
            error,
          });
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setChildTranscripts((current) => {
        const next = { ...current };
        for (const result of results) {
          if (!result) continue;
          next[result.sessionId] = result.messages;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [messages, childTranscripts]);

  const streamState = useMemo(
    () => deriveExecutionStreamState({ streamingMessage, streamingTools, sending }),
    [sending, streamingMessage, streamingTools],
  );
  const {
    streamTimestamp,
    streamTools,
    hasStreamText,
    hasRunningStreamToolStatus,
    shouldRenderStreaming,
    hasAnyStreamContent,
  } = streamState;
  useEffect(() => {
    if (!sending) {
      streamingTimestampStore.delete(currentSessionKey);
      return;
    }
    if (!streamingTimestampStore.has(currentSessionKey)) {
      streamingTimestampStore.set(currentSessionKey, streamTimestamp || Date.now() / 1000);
    }
  }, [currentSessionKey, sending, streamTimestamp]);

  const streamingTimestamp = sending
    ? (streamingTimestampStore.get(currentSessionKey) ?? streamTimestamp)
    : 0;

  const isEmpty = startupPhase === 'ready' && !messageAreaLoading && messages.length === 0 && !sending;
  const showScrollToLatest = !isEmpty && !isAtBottom;
  const subagentCompletionInfos = useMemo(
    () => messages.map((message) => parseSubagentCompletionInfo(message)),
    [messages],
  );
  const nextUserMessageIndexes = useMemo(
    () => deriveNextUserMessageIndexes(messages, subagentCompletionInfos),
    [messages, subagentCompletionInfos],
  );

  const questionDirectoryItems = useMemo<QuestionDirectoryItem[]>(() => {
    const items: QuestionDirectoryItem[] = [];
    let questionOrdinal = 0;
    messages.forEach((message, index) => {
      if (!isRealUserMessage(message) || subagentCompletionInfos[index]) return;
      questionOrdinal += 1;
      items.push({
        index,
        ordinal: questionOrdinal,
        title: buildQuestionDirectoryTitle(message, t('questionDirectory.fallback', { number: questionOrdinal })),
      });
    });
    return items;
  }, [messages, subagentCompletionInfos, t]);

  const questionDirectoryRequested = questionDirectoryOpenSessionKey === currentSessionKey && questionDirectoryItems.length > 1;
  const chatAssistiveRailVisible = !panelOpen;
  // Keep the startup skeleton in a single centered column. `isEmpty` is
  // intentionally false until history is confirmed, so it cannot decide
  // whether a side rail should participate in the flex layout.
  const canShowChatSideRail = !messageAreaLoading && startupPhase === 'ready';
  const questionDirectoryVisible = canShowChatSideRail
    && chatAssistiveRailVisible
    && questionDirectoryRequested;
  const boundedPanelWidthPct = Math.min(
    ARTIFACT_PANEL_MAX_WIDTH,
    Math.max(ARTIFACT_PANEL_MIN_WIDTH, panelWidthPct),
  );
  const activeArtifactTabKind = artifactTabs.find((tab) => tab.id === artifactActiveTabId)?.kind ?? null;
  const terminalBottomOpen = panelOpen
    && activeArtifactTabKind === 'terminal'
    && terminalPlacement === 'bottom';

  const beginTerminalBottomResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = terminalBottomHeight;
    const onMove = (moveEvent: PointerEvent) => {
      const maxHeight = Math.max(220, (splitContainerRef.current?.clientHeight ?? window.innerHeight) * 0.7);
      setTerminalBottomHeight(Math.round(Math.min(maxHeight, Math.max(180, startHeight + startY - moveEvent.clientY))));
    };
    const onEnd = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onEnd);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
  }, [terminalBottomHeight]);

  const runSegmentMessageIndices = useMemo(
    () => deriveRunSegmentMessageIndices(messages, nextUserMessageIndexes, subagentCompletionInfos),
    [messages, nextUserMessageIndexes, subagentCompletionInfos],
  );

  const executionProjection = useMemo(() => deriveUserRunProjection({
    messages,
    subagentCompletionInfos,
    currentSessionKey,
    currentAgentId,
    agents,
    sessionLabels,
    nextUserMessageIndexes,
    streamingMessage,
    streamingTools,
    pendingFinal,
    sending,
    stream: streamState,
    childTranscripts,
    graphStepCache,
    runError,
    activeRunId,
    runtimeRuns,
  }), [
    messages,
    subagentCompletionInfos,
    currentSessionKey,
    currentAgentId,
    agents,
    sessionLabels,
    nextUserMessageIndexes,
    streamingMessage,
    streamingTools,
    pendingFinal,
    sending,
    streamState,
    childTranscripts,
    graphStepCache,
    runError,
    activeRunId,
    runtimeRuns,
  ]);
  const userRunCards = executionProjection.cards;
  const foldedNarrationIndices = executionProjection.foldedNarrationIndices;
  const hasActiveExecutionGraph = executionProjection.hasActiveExecutionGraph;
  const pendingImageGeneration = executionProjection.pendingImageGeneration;
  const shouldClearStoreLifecycleFromHistory = executionProjection.shouldClearStoreLifecycleFromHistory;
  const inputRunActive = executionProjection.inputRunActive;
  const hasRunningRuntimeToolStatus = executionProjection.hasRunningRuntimeToolStatus;
  const handleResendUserMessage = useCallback((input: {
    messageText: string;
    messageId?: string;
    messageIndex: number;
  }) => {
    if (!isGatewayRunning || inputRunActive) return;
    void resendUserMessage({
      text: input.messageText,
      messageId: input.messageId,
      messageIndex: input.messageIndex,
      sessionKey: currentSessionKey,
    }).catch((error) => {
      console.warn('[chat:resendUserMessage] failed', error);
      toast.error(t('messageActions.resendFailed'));
    });
  }, [currentSessionKey, inputRunActive, isGatewayRunning, resendUserMessage, t]);
  const mockModeActive = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('mock') === '1';
  const visibleSessionActivitySnapshot = useMemo(
    () => sessionActivitySnapshot
      ? retainRecentSessionActivity(sessionActivitySnapshot, sessionActivityRetentionMinutes, sessionActivityRetentionClock)
      : undefined,
    [sessionActivityRetentionClock, sessionActivityRetentionMinutes, sessionActivitySnapshot],
  );
  const sessionActivityLevel = visibleSessionActivitySnapshot
    ? classifySessionActivity(visibleSessionActivitySnapshot, {
      showGit: sessionActivityShowGit,
      showCommands: sessionActivityShowCommands,
    })
    : 'none';
  const hasSessionActivityEntry = canShowChatSideRail
    && sessionActivityPanelEnabled
    && Boolean(visibleSessionActivitySnapshot)
    && (!isEmpty || mockModeActive)
    && sessionActivityLevel !== 'none';
  const shouldAutoExpandSessionActivity = sessionActivityAutoExpand === 'active'
    ? sessionActivityLevel === 'active' || sessionActivityLevel === 'attention'
    : sessionActivityAutoExpand === 'attention' && sessionActivityLevel === 'attention';
  const sessionActivityRailOpen = sessionActivityOpenOverrides[currentSessionKey]
    ?? shouldAutoExpandSessionActivity;
  const handleToggleSessionActivity = useCallback(() => {
    setQuestionDirectoryOpenSessionKey(null);
    setSessionActivityOpenOverrides((current) => ({
      ...current,
      [currentSessionKey]: !(current[currentSessionKey] ?? shouldAutoExpandSessionActivity),
    }));
  }, [currentSessionKey, shouldAutoExpandSessionActivity]);
  const handleOpenSessionActivitySheet = useCallback(() => {
    setQuestionDirectoryOpenSessionKey(null);
    setSessionActivitySheetOpen(true);
  }, []);
  const showSessionActivityRail = hasSessionActivityEntry
    && sessionActivityRailOpen
    && chatAssistiveRailVisible
    && !questionDirectoryVisible;
  const showChatAssistiveRail = canShowChatSideRail
    && chatAssistiveRailVisible
    && !isEmpty
    && !questionDirectoryVisible
    && showSessionActivityRail;
  const showChatSideRail = questionDirectoryVisible || showChatAssistiveRail;

  useEffect(() => {
    if (!shouldClearStoreLifecycleFromHistory) return;
    useChatStore.setState({
      sending: false,
      activeRunId: null,
      pendingFinal: false,
      lastUserMessageAt: null,
      streamingText: '',
      streamingMessage: null,
      streamingTools: [],
      pendingToolImages: [],
      runError: null,
    });
  }, [shouldClearStoreLifecycleFromHistory]);

  const replyTextOverrides = useMemo(
    () => buildReplyTextOverrides(messages, userRunCards),
    [messages, userRunCards],
  );
  const streamingReplyText = executionProjection.streamingReplyText;
  const userRunCardsByTriggerIndex = useMemo(
    () => groupRunCardsByTriggerIndex(userRunCards),
    [userRunCards],
  );

  const messageRenderRows = useMemo<ChatMessageRenderRow[]>(() => messages.map((msg, idx) => {
    const hasUserFacingImages = hasUserFacingImageAttachments(msg);
    const suppressAssistantText = foldedNarrationIndices.has(idx);
    const suppressToolCards = runSegmentMessageIndices.has(idx);
    const hidden = isInternalMessage(msg) && !hasUserFacingImages
      ? true
      : suppressAssistantText && !hasUserFacingImages
        ? true
        : (() => {
      const isToolOnlyAssistant = normalizeMessageRole(msg.role) === 'assistant'
        && extractToolUse(msg).length > 0
        && extractText(msg).trim().length === 0
        && !extractThinking(msg);
      return suppressToolCards && isToolOnlyAssistant && !(msg._attachedFiles?.length);
    })();

    return {
      index: idx,
      key: msg.id || `msg-${idx}`,
      message: msg,
      hidden,
      suppressAssistantText,
      suppressToolCards,
      textOverride: replyTextOverrides.get(idx),
      runCards: userRunCardsByTriggerIndex.get(idx) ?? [],
    };
  }), [
    foldedNarrationIndices,
    messages,
    replyTextOverrides,
    runSegmentMessageIndices,
    userRunCardsByTriggerIndex,
  ]);
  const windowedMessageRenderRows = useMemo(() => {
    const maxDom = getAgentResourceLimits().maxDomRenderMessages;
    const { start, end, windowed } = selectMessageRenderWindow(messageRenderRows.length, { maxDomNodes: maxDom });
    return { rows: messageRenderRows.slice(start, end), start, windowed, total: messageRenderRows.length };
  }, [messageRenderRows]);

  const streamingToolsForMessage = useMemo(
    () => (streamingReplyText != null || hasActiveExecutionGraph ? [] : streamingTools),
    [hasActiveExecutionGraph, streamingReplyText, streamingTools],
  );
  const activeRuntimeRun = activeRunId ? runtimeRuns[activeRunId] : null;
  const activeRuntimeRunStartedAt = activeRuntimeRun?.startedAt ?? lastUserMessageAt ?? null;
  const shouldRenderAssistantStreamMessage = shouldRenderStreaming || streamingReplyText != null;
  const assistantStreamStatus = inputRunActive
    ? {
      active: true,
      startedAt: activeRuntimeRunStartedAt,
      now: streamStatusNow,
      tokenCount: liveUsage?.totalTokens ?? null,
      state: (pendingFinal || streamingTools.length > 0 || hasRunningRuntimeToolStatus
        ? 'syncing'
        : streamingReplyText != null || hasAnyStreamContent
          ? 'streaming'
          : 'thinking') as 'thinking' | 'streaming' | 'syncing',
    }
    : null;
  const showStandaloneStreamStatus = inputRunActive && streamingReplyText == null && !pendingImageGeneration;

  useEffect(() => {
    if (!assistantStreamStatus?.active) return;
    setStreamStatusNow(Date.now());
    const timer = window.setInterval(() => setStreamStatusNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [assistantStreamStatus?.active, activeRuntimeRunStartedAt]);

  // Cache generated files per run so the activity receipt and artifact panel share one projection.
  const filesByRun = useMemo(() => {
    const map = new Map<number, GeneratedFile[]>();
    for (const card of userRunCards) {
      const userTurnOrdinal = messages
        .slice(0, card.triggerIndex + 1)
        .filter((msg) => msg.role === 'user' && (!Array.isArray(msg.content) || !(msg.content as Array<{ type?: string }>).every((b) => b.type === 'tool_result' || b.type === 'toolResult')))
        .length;
      const runKey = buildBaselineRunKey(currentSessionKey, userTurnOrdinal);
      const raw = extractGeneratedFiles(
        messages,
        card.triggerIndex,
        card.segmentEnd,
        runKey ? (filePath) => getBaseline(runKey, filePath) : undefined,
      );
      map.set(card.triggerIndex, raw.filter(generatedFileHasDiffPayload));
    }
    return map;
  }, [currentSessionKey, userRunCards, messages]);
  const allGeneratedFiles = useMemo(() => {
    const all: GeneratedFile[] = [];
    for (const files of filesByRun.values()) all.push(...files);
    return all;
  }, [filesByRun]);

  // Derive WorkArtifacts from generated files (docx/xlsx/pdf/html/csv/md)
  const artifacts = useMemo(() => {
    return allGeneratedFiles
      .filter((f) => {
        const ext = f.ext.toLowerCase();
        return ['.docx','.xlsx','.xls','.pdf','.html','.htm','.csv','.md','.pptx','.txt'].includes(ext);
      })
      .map((f, idx) => {
        const ext = f.ext.toLowerCase();
        const kind = ext === '.docx' ? 'document.write'
          : ext === '.xlsx' || ext === '.xls' ? 'sheet.write'
          : ext === '.pdf' ? 'pdf.validate'
          : ext === '.html' || ext === '.htm' ? 'html.generate'
          : ext === '.csv' ? 'csv.read'
          : ext === '.pptx' ? 'slide.write'
          : 'document.write';
        return {
          id: `artifact-${idx}`,
          kind,
          title: f.fileName,
          filePath: f.filePath,
          fileName: f.fileName,
          ext: f.ext,
          mimeType: f.mimeType,
          status: 'ready' as const,
          createdAt: Date.now(),
          size: f.size,
          htmlContent: (ext === '.html' || ext === '.htm' || ext === '.md') ? f.fullContent : undefined,
        } satisfies WorkArtifact;
      });
  }, [allGeneratedFiles]);

  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);

  const refreshSignal = useMemo(() => {
    if (sending) return undefined;
    return lastUserMessageAt ?? 0;
  }, [sending, lastUserMessageAt]);

  useEffect(() => {
    if (userRunCards.length === 0) return;
    const current = graphStepCacheStore.get(currentSessionKey) ?? {};
    const { cache: next, changed } = mergeGraphStepCacheEntries(current, userRunCards);
    if (changed) {
      graphStepCacheStore.set(currentSessionKey, next);
      gcGraphStepCache();
    }
  }, [userRunCards, currentSessionKey]);

  const platform = window.electron?.platform;
  const isMac = platform === 'darwin';
  const isUiV2 = uiVersion === 'v2';

  return (
    <TooltipProvider>
    <div
      ref={splitContainerRef}
      data-testid="chat-page"
      className={cn(
        'relative flex min-h-0 overflow-hidden transition-colors duration-180 motion-reduce:transition-none',
        isUiV2 ? '-m-5' : '-m-6',
        'bg-background',
        // Stack above MainLayout's mac-main-drag-region (z-10) so the right-hand
        // artifact/preview pane stays clickable; window drag is handled by the
        // sidebar + chat-toolbar drag strips instead.
        isMac && !isUiV2 && 'z-20 rounded-tl-2xl shadow-[inset_1px_1px_0_hsl(var(--border)/0.55)]',
        isUiV2 && 'bg-material-canvas',
      )}
      style={{ height: isUiV2 ? 'calc(100% + 2.5rem)' : isMac ? 'calc(100vh - 1px)' : 'calc(100vh - 2.5rem)' }}
    >
      {/* Left column: chat */}
      <div
        data-testid="chat-conversation-column"
        className="flex min-w-0 flex-1 flex-col"
        style={terminalBottomOpen ? { paddingBottom: terminalBottomHeight } : undefined}
      >
      {/* Toolbar */}
      <div className={cn(
        'relative flex shrink-0 items-center justify-between gap-3 px-4 py-2',
        isUiV2 && 'min-h-11 border-b border-border bg-material-panel',
      )}>
        <div data-testid="chat-toolbar-drag-region" className="drag-region absolute inset-0 z-0" aria-hidden="true" />
        <div className="no-drag relative z-10 min-w-0">
          {!isEmpty && (
            <div className="flex items-center gap-1.5">
              <ProjectSessionHeader
                workspaceId={activeWorkspaceId}
                projectName={activeWorkspace?.name || basenameFromPath(activeWorkspace?.rootPath) || 'clawx'}
                projectPath={activeWorkspace?.rootPath}
                workspaceProfiles={workspaceProfiles}
                switchWorkspace={handleSwitchWorkspace}
                 pickWorkspaceFolder={handlePickWorkspaceFolder}
                 onOpenTaskLedger={handleOpenTaskLedger}
                 onOpenClawGraph={handleOpenClawGraph}
                sessions={sessions}
                currentSessionKey={currentSessionKey}
                sessionLabels={sessionLabels}
                workspaceSessionKeys={Object.keys(activeWorkspace?.sessionStates ?? {})}
                switchSession={switchSession}
                renameSession={renameSession}
                onForkSession={handleForkSession}
                forkDisabled={forkDisabled}
                forkBusy={forkBusy}
                onHandoffSession={handlePrepareHandoff}
                handoffDisabled={handoffDisabled}
                handoffBusy={handoffBusy}
                continuityRecommendation={continuityRecommendation}
                sessionLineage={sessionLineage}
                runtimeRuns={runtimeRuns}
                activeRunId={activeRunId}
                sending={sending}
                pendingFinal={pendingFinal}
                runError={runError}
              />
            </div>
          )}
        </div>
        <div data-testid="chat-toolbar-actions" className="no-drag relative z-10 flex items-center gap-2">
          {showSyncStatus && (
            <div
              data-testid="chat-history-sync-status"
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              role="status"
            >
              <OrbStatus state="syncing" label={t('startup.syncing')} className="size-3.5" />
              <span>{t('startup.syncing')}</span>
            </div>
          )}
          <ChatToolbar
            questionDirectoryOpen={questionDirectoryVisible}
            questionDirectoryCount={questionDirectoryItems.length}
            promptCacheStatus={promptCacheStatus}
            onToggleQuestionDirectory={() =>
              setQuestionDirectoryOpenSessionKey((openSessionKey) =>
                openSessionKey === currentSessionKey ? null : currentSessionKey,
              )
            }
            sessionActivityAvailable={hasSessionActivityEntry && chatAssistiveRailVisible}
            sessionActivityOpen={showChatAssistiveRail || sessionActivitySheetOpen}
            sessionActivityNeedsAttention={sessionActivityLevel === 'attention'}
            onToggleSessionActivity={handleToggleSessionActivity}
            onOpenSessionActivity={handleOpenSessionActivitySheet}
            onOpenSlashCommands={handleOpenSlashCommands}
          />
        </div>
      </div>

      {/* Messages Area */}
      <div ref={messageAreaRef} className="relative min-h-0 flex-1 overflow-hidden px-4 py-3">
        {/* verse-style background: grid, glows, noise — empty state only */}
        <div
          className={cn(
            'codex-welcome-bg',
            isEmpty && !sendingAnimation && 'codex-welcome-bg--visible',
            sendingAnimation && 'codex-welcome-bg--sending',
          )}
          aria-hidden="true"
          data-testid="chat-welcome-bg"
        >
          <div className="codex-welcome-bg__grid" />
          <div className="codex-welcome-bg__glow codex-welcome-bg__glow--a" />
          <div className="codex-welcome-bg__glow codex-welcome-bg__glow--b" />
          <div className="codex-welcome-bg__noise" />
        </div>
        {isEmpty && (
          <div
            className={cn(
              'codex-welcome-watermark',
              !sendingAnimation && 'codex-welcome-watermark--visible',
              sendingAnimation && 'codex-welcome-watermark--sending',
            )}
            aria-hidden="true"
            data-testid="chat-welcome-watermark"
          >
            verse
          </div>
        )}
        <SelectionQuoteToolbar containerRef={messageAreaRef} onQuote={handleQuoteSelection} />
        <div
          className={cn(
            'mx-auto flex h-full min-h-0 w-full flex-col gap-4 xl:items-stretch',
            showChatSideRail ? 'max-w-7xl xl:flex-row' : 'max-w-5xl',
          )}
          data-testid="chat-message-layout"
        >
          <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-testid="chat-scroll-container">
            <div
              ref={contentRef}
              className={cn(
                "mx-auto space-y-4",
                // Empty state fills the pane so the scroll area does not collapse
                // around the recovery panel and let the watermark reflow.
                isEmpty ? "h-full w-full max-w-[820px]" : "max-w-[820px]",
              )}
            >
              {messageAreaLoading ? (
                <ChatLoadingSkeleton
                  phase={startupPhase}
                  showStatus={showStartupStatus}
                />
              ) : startupPhase === 'error' ? (
                <ChatStartupError
                  message={startupError}
                  onRetry={() => void hydrateStartup()}
                />
              ) : isEmpty ? (
                /* The empty state's own scaffolding — context row and chips —
                 * is rendered below the composer, not here: the reference
                 * stacks them under the input. Recovery now lives in
                 * Settings > Session & Recovery, so the scroll area stays
                 * empty and the watermark is unobstructed. */
                null
              ) : (
                <>
                  {hasMoreHistory && (
                    <div className="flex justify-center pt-2">
                      <button
                        type="button"
                        onClick={() => void loadMoreHistory()}
                        disabled={loadingMoreHistory}
                        className="inline-flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid="chat-load-more-history"
                      >
                        {loadingMoreHistory && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {loadingMoreHistory ? t('loadingMoreHistory') : t('loadMoreHistory')}
                      </button>
                    </div>
                  )}
                  {windowedMessageRenderRows.rows.map((row) => {
                    if (row.hidden) return null;
                    return (
                    <div
                      key={row.key}
                      className="space-y-3"
                      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }}
                      id={`chat-message-${row.index}`}
                      data-testid={`chat-message-${row.index}`}
                    >
                      <ChatMessage
                        message={row.message}
                        agent={currentAgent}
                        textOverride={row.textOverride}
                        suppressAssistantText={row.suppressAssistantText}
                        suppressToolCards={row.suppressToolCards}
                        suppressProcessAttachments={row.suppressToolCards}
                        onOpenFile={handleOpenAttachedFile}
                        canSubmitInteractionResponse={isGatewayRunning && !inputRunActive}
                        onSubmitInteractionResponse={handleSubmitInteractionResponse}
                        onDraftInteractionResponse={handleAppendComposerDraft}
                        canResendUserMessage={isGatewayRunning && !inputRunActive}
                        onResendUserMessage={(messageText) => handleResendUserMessage({
                          messageText,
                          messageId: row.message.id,
                          messageIndex: row.index,
                        })}
                      />
                      {row.runCards.map((card) => {
                        const runKey = card.runKey;
                        const defaultExpanded = card.status === 'error'
                          || card.status === 'aborted'
                          || (card.active && card.streamingReplyText == null)
                          || !card.hasVisibleReply;
                        const expanded = runActivityExpandedOverrides[runKey] ?? defaultExpanded;
                        const generatedFiles = filesByRun.get(card.triggerIndex) ?? [];
                        const hasActivity = card.active
                          || card.steps.length > 0
                          || generatedFiles.length > 0
                          || card.orchestrations.length > 0
                          || Boolean(card.traceId);
                        if (!hasActivity) return null;

                        return (
                          <div key={`run-${currentSessionKey}:${card.triggerIndex}`}>
                            <TurnSummaryCard
                              status={card.status}
                              startedAt={card.startedAt}
                              endedAt={card.endedAt}
                              now={streamStatusNow}
                              expanded={expanded}
                              onExpandedChange={(next) =>
                                setRunActivityExpandedOverrides((prev) => ({ ...prev, [runKey]: next }))
                              }
                            >
                              {generatedFiles.length > 0 && (
                                <GeneratedFilesPanel
                                  files={generatedFiles}
                                  onOpen={(file) => {
                                    const target = generatedFileToTarget(file);
                                    if (isHtmlPreviewExt(file.ext)) {
                                      openWorkspacePanel({ panel: 'files', filePath: target.filePath });
                                      return;
                                    }
                                    openWorkspacePanel({ panel: 'review', view: 'changes', filePath: target.filePath });
                                  }}
                                />
                              )}
                              <ExecutionGraphCard
                                key={`graph-${currentSessionKey}:${card.triggerIndex}`}
                                agentLabel={card.agentLabel}
                                steps={card.steps}
                                active={card.active}
                                suppressThinking={card.suppressThinking}
                                traceId={card.traceId}
                              />
                              {card.orchestrations.map((orchestration) => (
                                <TeamOrchestrationCard
                                  key={`team-orchestration-${orchestration.id}`}
                                  orchestration={orchestration}
                                  embedded
                                />
                              ))}
                            </TurnSummaryCard>
                          </div>
                        );
                      })}
                    </div>
                    );
                  })}

                  {/* Streaming message — render when reply text is separated from graph,
                      OR when there's streaming content without an active graph */}
                  {showStandaloneStreamStatus && (
                    <ChatMessage
                      agent={currentAgent}
                      message={{
                        role: 'assistant',
                        content: '',
                        timestamp: activeRuntimeRunStartedAt ?? Date.now(),
                      }}
                      isStreaming
                      streamStatus={assistantStreamStatus}
                      liveUsage={liveUsage}
                      onOpenFile={handleOpenAttachedFile}
                    />
                  )}

                  {shouldRenderAssistantStreamMessage && (
                    streamingReplyText != null
                    || !hasActiveExecutionGraph
                    || (hasStreamText && streamTools.length === 0 && !hasRunningStreamToolStatus && !hasRunningRuntimeToolStatus)
                  ) && (
                    <ChatMessage
                      agent={currentAgent}
                      suppressToolCards={hasActiveExecutionGraph || runSegmentMessageIndices.size > 0}
                      message={buildStreamingRenderMessage({
                        stream: streamState,
                        streamingReplyText,
                        streamingTimestamp,
                      })}
                      textOverride={streamingReplyText ?? undefined}
                      isStreaming
                      streamStatus={assistantStreamStatus}
                      streamingTools={streamingToolsForMessage}
                      liveUsage={liveUsage}
                      onOpenFile={handleOpenAttachedFile}
                      canSubmitInteractionResponse={false}
                      onSubmitInteractionResponse={handleSubmitInteractionResponse}
                      onDraftInteractionResponse={handleAppendComposerDraft}
                    />
                  )}

                  {/* Activity indicator: waiting for next AI turn after tool execution */}
                  {pendingImageGeneration && (
                    <ImageGeneratingIndicator />
                  )}

                  {/* Typing indicator when sending but no stream content yet */}
                </>
              )}
            </div>
          </div>
          {showScrollToLatest && (
            <Tooltip>
              <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => void scrollToBottom({ animation: 'smooth', ignoreEscapes: true })}
              className="absolute bottom-4 right-4 z-20 inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg shadow-black/10 backdrop-blur transition-colors hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:shadow-black/30"
              aria-label={t('scrollToLatest')}
              data-testid="chat-scroll-to-latest"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              <span>{t('scrollToLatest')}</span>
            </button>
              </TooltipTrigger>
              <TooltipContent side="left" collisionPadding={8}>{t('scrollToLatest')}</TooltipContent>
            </Tooltip>
          )}

          {chatAssistiveRailVisible && !isEmpty && questionDirectoryVisible && (
            <QuestionDirectory items={questionDirectoryItems} />
          )}
          {showChatAssistiveRail && (
            <aside
            data-testid="chat-assistive-rail"
            className="flex w-full shrink-0 flex-col gap-3 xl:w-72"
          >
              {visibleSessionActivitySnapshot && (
                <SessionActivityPanel
                  snapshot={visibleSessionActivitySnapshot}
                  compact
                  showGit={sessionActivityShowGit}
                  showCommands={sessionActivityShowCommands}
                  onOpenRecovery={() => navigate(`/settings/recovery?sessionKey=${encodeURIComponent(currentSessionKey)}`)}
                  onCreateMemoryDraft={handleOpenRecoveryMemoryDraft}
                />
              )}
            </aside>
          )}

        </div>
      </div>

      {/* Run error callout */}
      {runError && (
        <div className="px-4 pt-2" data-testid="chat-run-error">
          <div className="mx-auto max-w-4xl">
            <AssistantErrorCard title={t('runError.title')} message={runError} />
          </div>
        </div>
      )}

      {knowledgeErrorAdvisory ? (
        <KnowledgeErrorAdvisoryCard
          advisory={knowledgeErrorAdvisory}
          busy={knowledgeErrorAdvisoryBusy}
          onDismiss={handleDismissKnowledgeErrorAdvisory}
          onUse={handleUseKnowledgeErrorAdvisory}
        />
      ) : null}

      {/* Error bar */}
      {error && startupPhase === 'ready' && (
        <div className="px-4 py-2" data-testid="chat-error">
          <div className="mx-auto max-w-4xl">
            <AssistantErrorCard title={t('assistantRender.error.title')} message={error} onDismiss={clearError} />
          </div>
        </div>
      )}

      {/* Input Area */}
      <ChatInput
        onSend={handleSendMessage}
        onStop={abortRun}
        disabled={!isGatewayRunning}
        sending={inputRunActive}
        workspace={activeWorkspace}
        contextRange={contextRange}
        liveUsage={liveUsage}
        messageCount={messages.length}
        hero={isEmpty}
        draftValue={composerDraft}
        slashRequest={composerSlashRequest}
        onDraftChange={handleComposerDraftChange}
        onPermissionModeChange={handlePermissionModeChange}
        onPickWorkspaceFolder={handlePickWorkspaceFolder}
        onSwitchAgent={handleSwitchAgent}
        onNewSession={handleCreateNewSession}
        onForkSession={handleForkSession}
        continuityRecommendation={continuityRecommendation}
        continuityPreflight={continuityPreflight}
        forkDisabled={forkDisabled}
        forkBusy={forkBusy}
        onHandoffSession={handlePrepareHandoff}
        handoffDisabled={handoffDisabled}
        handoffBusy={handoffBusy}
        knowledgeScope={knowledgeScope}
        onKnowledgeScopeChange={handleKnowledgeScopeChange}
        knowledgeMode={knowledgeMode}
        onKnowledgeModeChange={handleKnowledgeModeChange}
        compactionStatus={compactionStatus}
        compactionBusy={compactionBusy}
        onManualCompact={handleManualCompact}
        onViewCompactionArtifact={handleViewCompactionArtifact}
        longTaskControlStatus={longTaskControlStatus}
        queueDrainBusy={queueDrainBusy}
        onDrainQueuedFollowup={handleDrainQueuedFollowup}
        taskLoopUpgradeBusy={taskLoopUpgradeBusy}
        onConfirmTaskLoopUpgrade={handleConfirmTaskLoopUpgrade}
        className={cn(sendingAnimation && 'codex-composer-host--sending')}
      />
      {/* Reference stacking under the stage is composer → context → chips, then
        * a spacer that grows like the message area above it; the two spacers
        * together centre the group without the composer leaving its slot. */}
      {isEmpty && (
        <>
          <div className={cn(sendingAnimation && 'codex-welcome-context--sending')}>
            <WelcomeScreen
              onPickFolder={handlePickWorkspaceFolder}
              disabled={!isGatewayRunning}
            />
          </div>
          <div className={cn(sendingAnimation && 'codex-welcome-chips--sending')}>
            <WelcomeChips
              onSend={handleSendMessage}
              disabled={!isGatewayRunning}
              retracted={composerDraft.trim().length > 0}
            />
          </div>
          <div className="codex-welcome-tail-spacer" aria-hidden="true" />
        </>
      )}
      <CompactionArtifactViewer
        open={compactionArtifactOpen}
        onOpenChange={setCompactionArtifactOpen}
        sessionKey={currentSessionKey}
        checkpointId={compactionArtifactCheckpointId}
        artifact={compactionArtifact}
        warnings={compactionArtifactWarnings}
        onPrepareRecovery={handlePrepareHandoff}
        onForkSession={handleForkSession}
        prepareRecoveryBusy={handoffBusy || compactionArtifactBusy}
        forkBusy={forkBusy}
      />
      <Dialog open={handoffDialogOpen} onOpenChange={setHandoffDialogOpen}>
        <DialogContent
          className="max-w-3xl rounded-lg border border-black/10 bg-surface-modal p-5 shadow-xl dark:border-white/10"
          data-testid="chat-handoff-dialog"
        >
          <DialogTitle className="font-serif text-xl font-normal tracking-tight text-foreground">
            {t('composer.handoff.dialogTitle')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {t('composer.handoff.dialogDescription')}
          </DialogDescription>
          {continuityRecommendation.action === 'handoff' && !continuityRecommendation.disabled && (
            <div
              className="mt-3 rounded-md border border-black/5 bg-black/5 px-3 py-2 text-xs text-muted-foreground dark:border-white/10 dark:bg-white/10"
              data-testid="chat-handoff-recommendation-note"
            >
              {t(`composer.continuity.dialogHint.${continuityRecommendation.reason}`, {
                defaultValue: t('composer.continuity.dialogHint.default'),
              })}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {(handoffResult?.sources ?? []).map((source) => (
              <Tooltip key={source.id}>
                <TooltipTrigger asChild>
              <span
                className={cn(
                  'inline-flex items-center rounded-md border px-2 py-1 text-xs',
                  source.available
                    ? 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                )}
              >
                {source.label}
              </span>
                </TooltipTrigger>
                {(source.summary || source.warning) && (
                  <TooltipContent side="top" className="max-w-xs text-xs">{source.summary || source.warning}</TooltipContent>
                )}
              </Tooltip>
            ))}
          </div>
          {(handoffResult?.warnings?.length ?? 0) > 0 && (
            <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {(handoffResult?.warnings ?? []).slice(0, 4).map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          )}
          <Label className="mt-4 block text-sm font-medium text-foreground" htmlFor="chat-handoff-draft">
            {t('composer.handoff.draftLabel')}
          </Label>
          <Textarea
            id="chat-handoff-draft"
            data-testid="chat-handoff-draft"
            value={handoffDraft}
            onChange={(event) => setHandoffDraft(event.target.value)}
            className="mt-2 min-h-[340px] resize-y bg-surface-input font-mono text-xs"
          />
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setHandoffDialogOpen(false)}
              disabled={handoffCreating}
            >
              {t('composer.handoff.cancel')}
            </Button>
            <Button
              type="button"
              data-testid="chat-handoff-create"
              onClick={() => void handleCreateHandoffSession()}
              disabled={handoffCreating || !handoffDraft.trim()}
            >
              {handoffCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('composer.handoff.create')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>

      {/* Right column: artifact / file preview panel (WorkBuddy-style) */}
      {panelOpen && (
        <>
          {!terminalBottomOpen && (
            <Suspense fallback={null}>
              <PanelResizeDividerLazy containerRef={splitContainerRef} />
            </Suspense>
          )}
          <aside
            data-testid="artifact-panel-aside"
            data-expanded={panelExpanded ? 'true' : 'false'}
            data-placement={terminalBottomOpen ? 'bottom' : 'side'}
            className={cn(
              'flex shrink-0 flex-col bg-surface-modal',
              terminalBottomOpen
                ? 'absolute z-30 inset-x-0 bottom-0 border-t border-black/5 dark:border-white/10 shadow-2xl'
                : 'relative border-l border-black/5 dark:border-white/10',
              !terminalBottomOpen && 'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-150 motion-reduce:transition-none',
              'no-drag',
            )}
            style={terminalBottomOpen
              ? { width: '100%', height: terminalBottomHeight }
              : { width: `min(100%, clamp(22rem, ${boundedPanelWidthPct}%, 44rem))` }}
          >
            {terminalBottomOpen && (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={t('workspace.terminal.resize')}
                data-testid="workspace-terminal-bottom-resize"
                className="absolute inset-x-0 -top-1 z-40 h-2 cursor-row-resize"
                onPointerDown={beginTerminalBottomResize}
              />
            )}
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <LoadingSpinner size="md" />
                </div>
              }
            >
              <ArtifactPanelLazy
                files={allGeneratedFiles}
                agent={currentAgent}
                runStartedAt={lastUserMessageAt ?? null}
                refreshSignal={refreshSignal}
                sessionState={getWorkspaceSessionState(activeWorkspace, currentSessionKey).artifactPanel}
                onSessionStateChange={handleArtifactSessionStateChange}
                onOpenWorkspaceWebView={handleOpenWorkspaceWebView}
                onAppendComposerDraft={handleAppendComposerDraft}
                artifacts={artifacts}
                selectedArtifactId={selectedArtifactId}
                onArtifactSelect={setSelectedArtifactId}
                onArtifactValidate={async (id) => {
                  const artifact = artifacts.find((a) => a.id === id);
                  if (!artifact) return;
                  setSelectedArtifactId(id);
                  try {
                    await hostApi.workProviders.validateArtifact({ path: artifact.filePath });
                  } catch {
                    // validateArtifact best-effort
                  }
                }}
              />
            </Suspense>
          </aside>
        </>
      )}

      <Dialog open={knowledgeDraftOpen} onOpenChange={setKnowledgeDraftOpen}>
        <DialogContent
          data-testid="knowledge-draft-dialog"
          className="w-[min(720px,calc(100vw-2rem))] max-w-none border border-black/10 bg-surface-modal p-0 shadow-2xl dark:border-white/10"
        >
          <div className="space-y-5 p-6">
            <div>
              <DialogTitle className="font-serif text-2xl font-normal tracking-tight text-foreground">
                {t('knowledgeDraft.title')}
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm text-muted-foreground">
                {t('knowledgeDraft.description')}
              </DialogDescription>
            </div>
            <div className="space-y-2">
              <Label htmlFor="knowledge-draft-title">{t('knowledgeDraft.titleLabel')}</Label>
              <Input
                id="knowledge-draft-title"
                data-testid="knowledge-draft-title"
                value={knowledgeDraftTitle}
                onChange={(event) => setKnowledgeDraftTitle(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="knowledge-draft-body">{t('knowledgeDraft.bodyLabel')}</Label>
              <Textarea
                id="knowledge-draft-body"
                data-testid="knowledge-draft-body"
                value={knowledgeDraftBody}
                onChange={(event) => setKnowledgeDraftBody(event.target.value)}
                className="min-h-[320px] resize-y bg-surface-input font-mono text-xs leading-relaxed"
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setKnowledgeDraftOpen(false)}
                disabled={knowledgeDraftApplying}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                type="button"
                data-testid="knowledge-draft-apply"
                onClick={() => void handleApplyKnowledgeDraft()}
                disabled={knowledgeDraftApplying || !knowledgeDraftTitle.trim() || !knowledgeDraftBody.trim()}
              >
                {knowledgeDraftApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('knowledgeDraft.apply')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet
        open={sessionActivitySheetOpen && hasSessionActivityEntry && chatAssistiveRailVisible}
        onOpenChange={setSessionActivitySheetOpen}
      >
        <SheetContent
          side="right"
          className="w-[min(22rem,calc(100vw-1rem))] overflow-y-auto p-0 sm:max-w-sm xl:hidden [&_header]:pr-12"
          data-testid="chat-session-activity-sheet"
        >
          <SheetTitle className="sr-only">{t('sessionActivity.title')}</SheetTitle>
          <SheetDescription className="sr-only">{t('sessionActivity.description')}</SheetDescription>
          {visibleSessionActivitySnapshot && (
            <SessionActivityPanel
              snapshot={visibleSessionActivitySnapshot}
              className="min-h-full border-0 shadow-none"
              showGit={sessionActivityShowGit}
              showCommands={sessionActivityShowCommands}
              onOpenRecovery={() => {
                setSessionActivitySheetOpen(false);
                navigate(`/settings/recovery?sessionKey=${encodeURIComponent(currentSessionKey)}`);
              }}
              onCreateMemoryDraft={() => {
                setSessionActivitySheetOpen(false);
                handleOpenRecoveryMemoryDraft();
              }}
            />
          )}
        </SheetContent>
      </Sheet>

    </div>
    </TooltipProvider>
  );
}

// ── Question Directory ─────────────────────────────────────────

function ChatLoadingSkeleton({
  phase,
  showStatus,
}: {
  phase: ChatStartupPhase;
  showStatus: boolean;
}) {
  const { t } = useTranslation('chat');
  const statusKey = phase === 'waiting-for-gateway'
    ? 'startup.waitingForGateway'
    : phase === 'loading-sessions'
      ? 'startup.loadingSessions'
      : 'startup.loadingHistory';

  return (
    <div
      data-testid="chat-startup-skeleton"
      data-startup-phase={phase}
      className="mx-auto flex min-h-[50vh] w-full max-w-4xl flex-col gap-7 px-1 pt-4"
      aria-busy="true"
    >
      {showStatus && (
        <div
          data-testid="chat-startup-status"
          className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <OrbStatus state="connecting" label={t(statusKey)} className="size-4 text-primary" />
          <span>{t(statusKey)}</span>
        </div>
      )}
      <div className="flex items-start gap-3">
        <ShimmerBlock className="h-8 w-8 shrink-0 rounded-full" />
        <div className="w-full max-w-xl space-y-2 rounded-2xl bg-black/[0.025] px-4 py-4 dark:bg-white/[0.035]">
          <ShimmerBlock className="h-3 w-4/5" />
          <ShimmerBlock className="h-3 w-3/5" />
        </div>
      </div>
      <div className="ml-auto flex w-full max-w-2xl items-start justify-end gap-3">
        <div className="w-full max-w-lg space-y-2 rounded-2xl bg-black/[0.04] px-4 py-4 dark:bg-white/[0.06]">
          <ShimmerBlock className="h-3 w-11/12" />
          <ShimmerBlock className="h-3 w-2/3" />
          <ShimmerBlock className="h-3 w-1/2" />
        </div>
        <ShimmerBlock className="h-8 w-8 shrink-0 rounded-full" />
      </div>
      <div className="flex items-start gap-3">
        <ShimmerBlock className="h-8 w-8 shrink-0 rounded-full" />
        <div className="w-full max-w-2xl space-y-2 rounded-2xl bg-black/[0.025] px-4 py-4 dark:bg-white/[0.035]">
          <ShimmerBlock className="h-3 w-5/6" />
          <ShimmerBlock className="h-3 w-full" />
          <ShimmerBlock className="h-3 w-3/4" />
        </div>
      </div>
    </div>
  );
}

function ChatStartupError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const { t } = useTranslation('chat');
  return (
    <div
      data-testid="chat-startup-error"
      className="mx-auto flex min-h-[45vh] w-full max-w-xl items-center justify-center px-4"
    >
      <div className="w-full rounded-2xl border border-red-200/70 bg-red-50/70 p-5 text-left dark:border-red-900/60 dark:bg-red-950/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium text-foreground">{t('startup.errorTitle')}</h2>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {message || t('startup.errorDescription')}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-4"
              data-testid="chat-startup-retry"
              onClick={onRetry}
            >
              {t('startup.retry')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuestionDirectory({ items }: { items: QuestionDirectoryItem[] }) {
  const { t } = useTranslation('chat');
  const scrollRef = useRef<HTMLElement | null>(null);
  const visibleItems = items.slice(0, QUESTION_DIRECTORY_RENDER_LIMIT);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }, [visibleItems.length]);

  const handleJumpToMessage = (index: number) => {
    document.getElementById(`chat-message-${index}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  return (
    <aside
      data-testid="chat-question-directory"
      className="w-full shrink-0 lg:w-64 xl:w-72"
      aria-label={t('questionDirectory.title')}
    >
      <div className="sticky top-2 max-h-full overflow-hidden rounded-2xl border border-black/5 bg-black/[0.02] p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('questionDirectory.title')}
          </h2>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:bg-white/10">
            {items.length}
          </span>
        </div>
        <nav ref={scrollRef} className="max-h-[calc(100vh-13rem)] space-y-1 overflow-y-auto pr-1">
          {visibleItems.map((item) => (
            <Tooltip key={item.index}>
              <TooltipTrigger asChild>
            <button
              type="button"
              data-testid={`chat-question-directory-item-${item.index}`}
              onClick={() => handleJumpToMessage(item.index)}
              className={cn(
                'group flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition-colors',
                'text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
              )}
            >
              <span className="line-clamp-2 min-w-0 text-xs leading-5">
                {item.title}
              </span>
            </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs text-xs">{item.title}</TooltipContent>
            </Tooltip>
          ))}
          {hiddenCount > 0 && (
            <div className="px-2 py-2 text-xs leading-5 text-muted-foreground">
              {t('questionDirectory.moreHint', { count: hiddenCount })}
            </div>
          )}
        </nav>
      </div>
    </aside>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────

type WelcomeScreenProps = {
  onSend: (text: string) => void | Promise<unknown>;
  onPickFolder?: () => void | Promise<unknown>;
  disabled?: boolean;
};

type WelcomeSuggestionRuntimeProps = {
  children: ReactNode;
  onSend: (text: string) => void | Promise<unknown>;
  suggestions: SuggestionConfig[];
};

function getAssistantUiTextPart(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const candidate = part as { text?: unknown; type?: unknown };
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      return candidate.text;
    }
  }
  return '';
}

function WelcomeSuggestionRuntime({ children, onSend, suggestions }: WelcomeSuggestionRuntimeProps) {
  const suggestionsKey = useMemo(
    () => suggestions.map((suggestion) => (typeof suggestion === 'string'
      ? suggestion
      : `${suggestion.title}\u001f${suggestion.label}\u001f${suggestion.prompt}`)).join('\u001e'),
    [suggestions],
  );
  const chatModel = useMemo<ChatModelAdapter>(() => ({
    async run({ abortSignal, messages }) {
      const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
      const latestUserText = getAssistantUiTextPart(latestUserMessage?.content).trim();

      if (latestUserText && !abortSignal.aborted) {
        await onSend(latestUserText);
      }

      return { content: [] };
    },
  }), [onSend]);
  const runtime = useLocalRuntime(chatModel, {
    adapters: {
      suggestion: {
        generate: async () => suggestions.map((suggestion) => ({ prompt: typeof suggestion === 'string' ? suggestion : suggestion.prompt })),
      },
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <WelcomeSuggestionScope key={suggestionsKey} suggestions={suggestions}>
        {children}
      </WelcomeSuggestionScope>
    </AssistantRuntimeProvider>
  );
}

function WelcomeSuggestionScope({ children, suggestions }: Omit<WelcomeSuggestionRuntimeProps, 'onSend'>) {
  const parentAui = useAui();
  const aui = useAui(
    {
      suggestions: Suggestions(suggestions),
    },
    { parent: parentAui },
  );

  return <AuiProvider value={aui}>{children}</AuiProvider>;
}

/**
 * Empty-state scaffolding: the project/branch context row under the composer.
 *
 * There is deliberately no heading here. The reference's empty state has one
 * piece of display type — the giant `verse` watermark behind the composer —
 * and adding a second ("what should we build in X?") gave the screen two
 * competing focal points and pushed the composer off centre. The watermark is
 * the heading; this row is the caption under it.
 *
 * That leaves the context row as the only place the workspace can be switched
 * from, so the project token is the picker rather than a static label.
 */
function WelcomeScreen({ disabled = false, onPickFolder }: Omit<WelcomeScreenProps, 'onSend'>) {
  const activeWorkspace = useWorkspacesStore((s) => s.activeWorkspace);
  const hasWorkspace = Boolean(activeWorkspace);
  const [gitStatus, setGitStatus] = useState<
    { workspaceId: string; branch: string; detached: boolean } | null
  >(null);

  const refreshGitStatus = useCallback(async () => {
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId) return;
    try {
      const result = await hostApi.git.status();
      const status = result.status;
      setGitStatus(status?.isRepository && status.branch
        ? { workspaceId, branch: status.branch, detached: status.detached ?? false }
        : null);
    } catch {
      setGitStatus(null);
    }
  }, [activeWorkspace?.id]);

  useEffect(() => {
    let cancelled = false;
    const loadGitStatus = async () => {
      const workspaceId = activeWorkspace?.id;
      if (!workspaceId) return;
      try {
        const result = await hostApi.git.status();
        const status = result.status;
        if (!cancelled) {
          setGitStatus(status?.isRepository && status.branch
            ? { workspaceId, branch: status.branch, detached: status.detached ?? false }
            : null);
        }
      } catch {
        if (!cancelled) setGitStatus(null);
      }
    };
    void loadGitStatus();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id]);

  /* A result from the workspace we just left is dropped here rather than
   * cleared in the effect body: clearing it there is a synchronous setState
   * inside an effect, which costs a second render pass on every workspace
   * switch. Tagging the result with the workspace it was read from is enough
   * to know it is stale. */
  const branch = gitStatus?.workspaceId === activeWorkspace?.id ? gitStatus : null;

  return (
    <div className="codex-welcome-stage">
      {hasWorkspace && (
        <div className="codex-welcome-context" data-testid="chat-welcome-context">
          <div className="codex-welcome-context__group" data-testid="chat-welcome-environment-group">
            <WelcomeProjectPicker disabled={disabled} onPickFolder={onPickFolder} />
            {branch && (
              <WelcomeBranchPicker
                branch={branch.branch}
                detached={branch.detached}
                disabled={disabled}
                onChanged={refreshGitStatus}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Quick-action chips. Rendered *below* the composer to match the reference
 * ordering — above, a row of suggestions reads as a menu the input belongs to;
 * below, it reads as shortcuts you may ignore.
 *
 * They retract while the composer holds text: once you have said what you want,
 * three canned openers are noise sitting between you and the send button. The
 * retraction is staggered left-to-right and reverses on the way back, and the
 * row keeps its height throughout so the composer never moves.
 */
function WelcomeChips({
  disabled = false,
  onSend,
  retracted = false,
}: Pick<WelcomeScreenProps, 'disabled' | 'onSend'> & { retracted?: boolean }) {
  const { t } = useTranslation('chat');
  const quickActions = useMemo<SuggestionConfig[]>(() => [
    {
      title: t('welcome.askQuestions'),
      label: t('welcome.askQuestionsDesc'),
      prompt: t('welcome.askQuestions'),
    },
    {
      title: t('welcome.creativeTasks'),
      label: t('welcome.creativeTasksDesc'),
      prompt: t('welcome.creativeTasks'),
    },
    {
      title: t('welcome.brainstorming'),
      label: t('welcome.brainstormingDesc'),
      prompt: t('welcome.brainstorming'),
    },
  ], [t]);

  const actionIcons = [ListChecks, RefreshCw, Users] as const;

  return (
    <WelcomeSuggestionRuntime onSend={onSend} suggestions={quickActions}>
      <div
        className={cn('codex-welcome-chips', retracted && 'codex-welcome-chips--retracted')}
        data-testid="chat-welcome-suggestions"
        data-retracted={retracted ? 'true' : undefined}
        // Retracted chips are gone as far as the pointer and the tab order are
        // concerned; `inert` is what keeps a mid-fade chip from being clicked.
        inert={retracted || undefined}
      >
        <ThreadPrimitive.Suggestions>
          {({ suggestion }) => {
            const index = quickActions.findIndex((action) => (
              typeof action === 'string' ? action === suggestion.title : action.title === suggestion.title
            ));
            return <SuggestionItem disabled={disabled} Icon={actionIcons[index] ?? ListChecks} />;
          }}
        </ThreadPrimitive.Suggestions>
      </div>
    </WelcomeSuggestionRuntime>
  );
}

function SuggestionItem({ disabled = false, Icon = ListChecks }: { disabled?: boolean; Icon?: typeof ListChecks }) {
  return (
    <SuggestionPrimitive.Trigger send disabled={disabled} className="codex-welcome-chip">
      <Icon className="codex-welcome-chip__icon" aria-hidden="true" />
      <span className="codex-welcome-chip__label">
        <SuggestionPrimitive.Title />
      </span>
      {/* The reference chip is a single short phrase, so the description is not
        * drawn — but it is still the only thing that says what the action does,
        * so it stays in the accessibility tree rather than being deleted. */}
      <span className="codex-welcome-chip__desc">
        <SuggestionPrimitive.Description />
      </span>
    </SuggestionPrimitive.Trigger>
  );
}

// ── Typing Indicator ────────────────────────────────────────────


// ── Activity Indicator (shown between tool cycles) ─────────────

function ImageGeneratingIndicator() {
  const { t } = useTranslation('chat');
  return (
    <div className="flex gap-3" data-testid="chat-image-generating-indicator">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <OrbStatus state="loading" label={t('imageGeneration.generating')} className="size-4 text-primary" />
          <span>{t('imageGeneration.generating')}</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
