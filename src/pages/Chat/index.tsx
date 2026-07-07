/**
 * Chat Page
 * Native React implementation communicating with OpenClaw Gateway
 * via the Main-owned host API. Session selector, thinking toggle, and refresh
 * are in the toolbar; messages render with markdown + streaming.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { ArrowDownToLine, Check, ChevronDown, FileText, Folder, FolderPlus, GitBranchPlus, Laptop, Loader2, Pencil, Sparkles } from 'lucide-react';
import type { SessionHandoffResult, SessionCompactionStatus } from '@shared/host-api/contract';
import type { LongTaskControlStatus, LongTaskInputMode } from '@shared/types/long-task-control';
import { useChatStore, type RawMessage } from '@/stores/chat';
import { isInternalMessage } from '@/stores/chat/helpers';
import { buildBaselineRunKey, getBaseline } from '@/stores/baseline-cache';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useProviderStore } from '@/stores/providers';
import { useWorkspacesStore } from '@/stores/workspaces';
import {
  ARTIFACT_PANEL_MAX_WIDTH,
  ARTIFACT_PANEL_MIN_WIDTH,
  useArtifactPanel,
} from '@/stores/artifact-panel';
import { hostApi, type ChatKnowledgeReference } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ExecutionGraphCard } from './ExecutionGraphCard';
import { TeamOrchestrationCard } from './TeamOrchestrationCard';
import { ChatToolbar } from './ChatToolbar';
import { RollbackPlanPanel } from './RollbackPlanPanel';
import {
  classifySessionContinuityError,
  resolveSessionContinuityPreflight,
  type SessionContinuityErrorKind,
  type SessionContinuityRecommendation,
} from './session-continuity';
import { buildRollbackPlan } from './rollback-plan';
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
import { useNavigate } from 'react-router-dom';
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
import { useMinLoading } from '@/hooks/use-min-loading';
import { extractGeneratedFiles, generatedFileHasDiffPayload, isHtmlPreviewExt, type GeneratedFile } from '@/lib/generated-files';
import { AssistantErrorCard, AssistantStatusIndicator, SelectionQuoteToolbar, TokenUsageRoll } from '@/components/assistant-render/AssistantRender';
import { buildStatusDimensions, buildUsageModel } from '@/components/assistant-render/model';
import { DotMatrix, type DotMatrixState } from '@/components/assistant-ui/dot-matrix';
import { WorkContextBar } from '@/components/assistant-render/WorkContextBar';
import { buildTurnWorkModel } from '@/components/assistant-render/turn-work-model';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
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
  WorkspaceContextRange,
  WorkspaceArtifactPanelState,
  WorkspaceKnowledgeScope,
  WorkspacePermissionMode,
  WorkspaceProfile,
  WorkspaceUiState,
} from '@shared/types/workspace';
import type { WorkArtifact } from '@shared/types/work-artifact';
import type { GitRepositoryStatus } from '@shared/types/git';
import type { ChatSession, ChatRuntimeRunState } from '@/stores/chat/types';
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

function buildKnowledgeDraftTitle(sessionLabel: string, messages: RawMessage[]): string {
  const firstUserText = messages
    .find((msg) => isRealUserMessage(msg))
    ? extractText(messages.find((msg) => isRealUserMessage(msg))!).replace(/\s+/g, ' ').trim()
    : '';
  const base = firstUserText || sessionLabel || 'Chat synthesis';
  return base.length > 72 ? `${base.slice(0, 72)}...` : base;
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

function getHeaderSessionDotState(input: {
  sessionKey: string;
  currentSessionKey: string;
  runtimeRuns?: Record<string, ChatRuntimeRunState>;
  activeRunId?: string | null;
  sending?: boolean;
  pendingFinal?: boolean;
  runError?: string | null;
}): DotMatrixState | null {
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
  projectName,
  projectPath,
  workspaceProfiles,
  switchWorkspace,
  pickWorkspaceFolder,
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
  projectName: string;
  projectPath?: string;
  workspaceProfiles: Array<{ id: string; name: string; rootPath: string; lastOpenedAt?: number }>;
  switchWorkspace: (id: string) => Promise<unknown>;
  pickWorkspaceFolder: () => Promise<void>;
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sessionName = getSessionDisplayName(currentSessionKey, sessions, sessionLabels);
  const sortedWorkspaces = useMemo(
    () => [...workspaceProfiles].sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0)),
    [workspaceProfiles],
  );
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
    <div ref={rootRef} className="flex min-w-0 items-center gap-1.5 text-sm" data-testid="chat-project-session-header">
      <Laptop className="h-4 w-4 shrink-0 text-foreground/80" />
      <div className="relative min-w-0">
        <button
          type="button"
          className="inline-flex max-w-[220px] items-center gap-1 rounded-md px-1.5 py-1 font-semibold text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          title={projectPath}
          onClick={() => setOpen((current) => current === 'workspace' ? null : 'workspace')}
        >
          <span className="truncate">{projectName}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
        {open === 'workspace' && (
          <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-black/10 bg-surface-modal p-1 shadow-md dark:border-white/10">
            <div className="px-2 pb-0.5 pt-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground/60">{t('workspace.recent')}</div>
            {sortedWorkspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => {
                  setOpen(null);
                  void switchWorkspace(workspace.id);
                }}
              >
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">{workspace.name}</span>
                  <span className="block truncate font-mono text-2xs text-muted-foreground">{workspace.rootPath}</span>
                </span>
              </button>
            ))}
            {sortedWorkspaces.length === 0 && (
              <div className="px-2 py-2 text-2xs text-muted-foreground">{t('workspace.noRecent')}</div>
            )}
            <div className="mt-1 border-t border-black/5 pt-1 dark:border-white/5">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                onClick={() => {
                  setOpen(null);
                  void pickWorkspaceFolder();
                }}
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {t('workspace.chooseNew')}
              </button>
            </div>
          </div>
        )}
      </div>
      <span className="text-foreground/35">/</span>
      <div className="relative min-w-0">
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
          <button
            type="button"
            className="inline-flex max-w-[360px] items-center gap-1 rounded-md px-1.5 py-1 font-semibold text-foreground/80 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            onClick={() => setOpen((current) => current === 'session' ? null : 'session')}
            onDoubleClick={(event) => {
              event.preventDefault();
              startRenameSession();
            }}
            title={t('session.renameHint')}
          >
            <span className="truncate">{sessionName}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
        {open === 'session' && (
          <div className="absolute left-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-lg border border-black/10 bg-surface-modal p-1 shadow-md dark:border-white/10">
            <button
              type="button"
              className="mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              onClick={startRenameSession}
            >
              <Pencil className="h-3.5 w-3.5" />
              {t('session.renameCurrent')}
            </button>
            <button
              type="button"
              className="mb-0.5 flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
              data-testid="chat-session-fork"
              disabled={forkDisabled || forkBusy}
              onClick={() => {
                setOpen(null);
                void onForkSession();
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                {forkBusy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <GitBranchPlus className="h-3.5 w-3.5 shrink-0" />}
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
              className="mb-0.5 flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
              data-testid="chat-session-handoff"
              disabled={handoffDisabled || handoffBusy}
              onClick={() => {
                setOpen(null);
                void onHandoffSession();
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                {handoffBusy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
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
            <div className="mb-0.5 border-t border-black/5 dark:border-white/5" />
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
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => {
                    setOpen(null);
                    switchSession(session.key);
                  }}
                >
                  {dotState ? (
                    <DotMatrix state={dotState} className="size-3.5 shrink-0" />
                  ) : (
                    <span className="size-3.5 shrink-0" />
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

export function Chat() {
  const { t } = useTranslation(['chat', 'common']);
  const navigate = useNavigate();
  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const { messages, currentSessionKey, currentAgentId, sessions, sessionLabels, loading, loadingMoreHistory, hasMoreHistory, sending, error, runError, streamingMessage, streamingTools, pendingFinal, activeRunId, runtimeRuns, lastUserMessageAt, taskLedgerSnapshot } = useChatStore(useShallow((s) => ({
    messages: s.messages,
    currentSessionKey: s.currentSessionKey,
    currentAgentId: s.currentAgentId,
    sessions: s.sessions ?? [],
    sessionLabels: s.sessionLabels,
    loading: s.loading,
    loadingMoreHistory: s.loadingMoreHistory,
    hasMoreHistory: s.hasMoreHistory,
    sending: s.sending,
    error: s.error,
    runError: s.runError,
    streamingMessage: s.streamingMessage,
    streamingTools: s.streamingTools,
    pendingFinal: s.pendingFinal,
    activeRunId: s.activeRunId,
    runtimeRuns: s.runtimeRuns ?? {},
    lastUserMessageAt: s.lastUserMessageAt,
    taskLedgerSnapshot: s.taskLedgerSnapshot,
  })));
  const switchSession = useChatStore((s) => s.switchSession);
  const resetSessionView = useChatStore((s) => s.resetSessionView);
  const renameSession = useChatStore((s) => s.renameSession);
  const loadMoreHistory = useChatStore((s) => s.loadMoreHistory);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abortRun = useChatStore((s) => s.abortRun);
  const clearError = useChatStore((s) => s.clearError);
  const cleanupEmptySession = useChatStore((s) => s.cleanupEmptySession);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const loadSessions = useChatStore((s) => s.loadSessions);
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
  const [workContextVisible, setWorkContextVisible] = useState(true);
  const [gitStatus, setGitStatus] = useState<GitRepositoryStatus | null>(null);

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
  const panelWidthPct = useArtifactPanel((s) => s.widthPct);
  const openChanges = useArtifactPanel((s) => s.openChanges);
  const openPreview = useArtifactPanel((s) => s.openPreview);
  const openBrowser = useArtifactPanel((s) => s.openBrowser);
  const artifactTab = useArtifactPanel((s) => s.tab);
  const restoreArtifactPanelState = useArtifactPanel((s) => s.restoreSessionState);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const lastObservedSessionKeyRef = useRef(currentSessionKey);
  const lastRestoredWorkspaceIdRef = useRef<string | null>(null);
  const workspaceSessionRestoreTargetRef = useRef<{ workspaceId: string; sessionKey: string } | null>(null);
  const workspaceStateRestoreRef = useRef<{ workspaceId: string | null; sessionKey: string | null }>({
    workspaceId: null,
    sessionKey: null,
  });
  const skipNextWorkspaceStateSaveRef = useRef(false);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [childTranscripts, setChildTranscripts] = useState<Record<string, RawMessage[]>>({});
  const [questionDirectoryOpenSessionKey, setQuestionDirectoryOpenSessionKey] = useState<string | null>(null);
  const [contextRange, setContextRange] = useState<WorkspaceContextRange | null>(null);
  const [liveUsage, setLiveUsage] = useState<LiveTokenUsage | null>(null);
  const [compactionStatus, setCompactionStatus] = useState<SessionCompactionStatus | null>(null);
  const [compactionBusy, setCompactionBusy] = useState(false);
  const [longTaskControlStatus, setLongTaskControlStatus] = useState<LongTaskControlStatus | null>(null);
  const [queueDrainBusy, setQueueDrainBusy] = useState(false);
  const [forkBusy, setForkBusy] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffCreating, setHandoffCreating] = useState(false);
  const [handoffDialogOpen, setHandoffDialogOpen] = useState(false);
  const [handoffResult, setHandoffResult] = useState<SessionHandoffResult | null>(null);
  const [handoffDraft, setHandoffDraft] = useState('');
  const [sessionLineage, setSessionLineage] = useState<Record<string, SessionLineageOverride>>({});
  const [composerDraft, setComposerDraft] = useState('');
  const messageAreaRef = useRef<HTMLDivElement | null>(null);
  // Persistent per-run override for the Execution Graph's expanded/collapsed
  // state. Keyed by a stable run id (trigger message id, or a fallback of
  // `${sessionKey}:${triggerIdx}`) so user toggles survive the `loadHistory`
  // refresh that runs after every final event — otherwise the card would
  // remount and reset. `undefined` values mean "user hasn't toggled, let the
  // card pick a default from its own `active` prop."
  const [graphExpandedOverrides, setGraphExpandedOverrides] = useState<Record<string, boolean>>({});
  const captureCurrentWorkspaceSessionState = useCallback((draft = composerDraft): WorkspaceUiState => {
    const previousSessionState = getWorkspaceSessionState(activeWorkspace, currentSessionKey);
    const previousArtifactPanel = previousSessionState.artifactPanel ?? {};
    const previousChatFooter = previousSessionState.chatFooter ?? {};
    return {
      draftInput: draft,
      activeTopicId: null,
      knowledgeScope,
      knowledgeMode,
      artifactPanel: {
        ...previousArtifactPanel,
        open: panelOpen,
        activeTab: artifactTab,
      },
      chatFooter: {
        ...previousChatFooter,
        workContextVisible,
      },
      graphExpanded: graphExpandedOverrides,
    };
  }, [activeWorkspace, artifactTab, composerDraft, currentSessionKey, graphExpandedOverrides, knowledgeMode, knowledgeScope, panelOpen, workContextVisible]);

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
      setGraphExpandedOverrides({});
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
      setGraphExpandedOverrides({});
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
      setGraphExpandedOverrides({});
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
    setGraphExpandedOverrides({});
    setContextRange(null);
    setLiveUsage(null);
    setKnowledgeScope('none');
  }, [activeWorkspace?.id, activeWorkspace?.permissionMode, currentSessionKey, persistCurrentWorkspaceSessionState]);

  // Callback for file cards in chat messages 鈥?opens the in-app preview
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
    openPreview(target);
  }, [openPreview, t]);

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
        setGraphExpandedOverrides({});
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
  const minLoading = useMinLoading(loading && messages.length > 0);
  const { contentRef, scrollRef, scrollToBottom, isAtBottom } = useStickToBottomInstant(currentSessionKey, sending);

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

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

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
    setGraphExpandedOverrides(sessionState.graphExpanded ?? {});
    setKnowledgeScope(sessionState.knowledgeScope ?? 'none');
    setKnowledgeMode(sessionState.knowledgeMode ?? 'suggest');
    setWorkContextVisible(sessionState.chatFooter?.workContextVisible ?? true);
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

  const handleSendMessage = useCallback((
    text: string,
    attachments?: Parameters<typeof sendMessage>[1],
    targetAgentId?: string | null,
    scope?: WorkspaceKnowledgeScope,
    mode?: KnowledgeInvocationMode,
    knowledgeReferences?: ChatKnowledgeReference[],
    activeTaskNodeId?: string | null,
    inputMode?: LongTaskInputMode,
  ) => {
    return sendMessage(text, attachments, targetAgentId, scope, mode ?? knowledgeMode, inputMode, knowledgeReferences, activeTaskNodeId);
  }, [knowledgeMode, sendMessage]);

  const handleSubmitInteractionResponse = useCallback((responseText: string) => {
    void handleSendMessage(responseText);
  }, [handleSendMessage]);

  const handleOpenKnowledgeDraft = useCallback(() => {
    const body = buildKnowledgeDraftBody(messages);
    if (!body.trim()) {
      toast.error(t('knowledgeDraft.empty'));
      return;
    }
    const sessionLabel = getSessionDisplayName(currentSessionKey, sessions, sessionLabels);
    setKnowledgeDraftTitle(buildKnowledgeDraftTitle(sessionLabel, messages));
    setKnowledgeDraftBody(body);
    setKnowledgeDraftOpen(true);
  }, [currentSessionKey, messages, sessionLabels, sessions, t]);

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

  const handleOpenWorkspaceWebView = useCallback(() => {
    openBrowser();
    if (!activeWorkspaceId) return;
    void saveWorkspaceState({
      id: activeWorkspaceId,
      sessionKey: currentSessionKey,
      state: {
        artifactPanel: { open: true, activeTab: 'browser', workspaceView: 'web' },
      },
    });
  }, [activeWorkspaceId, currentSessionKey, openBrowser, saveWorkspaceState]);

  const handleOpenGitPanel = useCallback(() => {
    openBrowser();
    if (!activeWorkspaceId) return;
    void saveWorkspaceState({
      id: activeWorkspaceId,
      sessionKey: currentSessionKey,
      state: {
        artifactPanel: { open: true, activeTab: 'browser', workspaceView: 'git' },
      },
    });
  }, [activeWorkspaceId, currentSessionKey, openBrowser, saveWorkspaceState]);

  const handleToggleWorkContext = useCallback(() => {
    const nextVisible = !workContextVisible;
    setWorkContextVisible(nextVisible);
    if (!activeWorkspaceId) return;
    const previousChatFooter = getWorkspaceSessionState(activeWorkspace, currentSessionKey).chatFooter ?? {};
    void saveWorkspaceState({
      id: activeWorkspaceId,
      sessionKey: currentSessionKey,
      state: {
        ...captureCurrentWorkspaceSessionState(composerDraft),
        chatFooter: {
          ...previousChatFooter,
          workContextVisible: nextVisible,
        },
      },
    });
  }, [
    activeWorkspace,
    activeWorkspaceId,
    captureCurrentWorkspaceSessionState,
    composerDraft,
    currentSessionKey,
    saveWorkspaceState,
    workContextVisible,
  ]);

  const handleOpenWorkReport = useCallback((report: { file: GeneratedFile }) => {
    const target = generatedFileToTarget(report.file);
    if (isHtmlPreviewExt(report.file.ext)) {
      openPreview(target);
      return;
    }
    openChanges(target);
  }, [openChanges, openPreview]);

  const handleInterruptTerminal = useCallback(async () => {
    openBrowser();
    if (!activeWorkspaceId) return;
    void saveWorkspaceState({
      id: activeWorkspaceId,
      sessionKey: currentSessionKey,
      state: {
        artifactPanel: { open: true, activeTab: 'browser', workspaceView: 'terminal' },
      },
    });
    try {
      const status = await hostApi.terminal.status({ workspaceId: activeWorkspaceId, sessionKey: currentSessionKey });
      if (status.sessionId && status.status === 'running') {
        const result = await hostApi.terminal.interrupt({ sessionId: status.sessionId });
        if (!result.success) {
          toast.error(result.error || t('composer.rollbackPlan.terminal.interruptFailed'));
          return;
        }
        toast.success(t('composer.rollbackPlan.terminal.interrupted'));
        return;
      }
      toast.message(t('composer.rollbackPlan.terminal.opened'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [activeWorkspaceId, currentSessionKey, openBrowser, saveWorkspaceState, t]);

  const handleOpenTaskLedger = useCallback(() => {
    navigate('/task-ledger');
  }, [navigate]);

  const handleAppendComposerDraft = useCallback((text: string) => {
    const nextDraft = composerDraft.trim()
      ? `${composerDraft.trim()}\n\n${text}`
      : text;
    handleComposerDraftChange(nextDraft);
  }, [composerDraft, handleComposerDraftChange]);

  const handleQuoteSelection = useCallback((text: string) => {
    const clipped = text.replace(/\s+/g, ' ').trim().slice(0, 1200);
    if (!clipped) return;
    handleAppendComposerDraft(`> ${clipped.replace(/\n/g, '\n> ')}\n\n`);
  }, [handleAppendComposerDraft]);

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
  }, [activeWorkspace?.id, artifactTab, captureCurrentWorkspaceSessionState, currentSessionKey, graphExpandedOverrides, panelOpen, saveWorkspaceState]);

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
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
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
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
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

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
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
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
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
  const rollbackPlan = useMemo(() => buildRollbackPlan({
    activeRun: continuityRunActive,
    gatewayAvailable,
    queueDrainBusy,
    compactionBusy,
    handoffDisabled,
    contextRange,
    compactionStatus,
    longTaskControlStatus,
  }), [
    compactionBusy,
    compactionStatus,
    contextRange,
    continuityRunActive,
    gatewayAvailable,
    handoffDisabled,
    longTaskControlStatus,
    queueDrainBusy,
  ]);
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
      setGraphExpandedOverrides({});
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

  const isEmpty = messages.length === 0 && !sending;
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
  const questionDirectoryVisible = chatAssistiveRailVisible && questionDirectoryRequested;
  const boundedPanelWidthPct = Math.min(
    ARTIFACT_PANEL_MAX_WIDTH,
    Math.max(ARTIFACT_PANEL_MIN_WIDTH, panelWidthPct),
  );

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
  const showRollbackPlanPanel = rollbackPlan.actions.length > 0
    && (!isEmpty || !!longTaskControlStatus || !!compactionStatus);
  const showChatAssistiveRail = chatAssistiveRailVisible
    && !isEmpty
    && !questionDirectoryVisible
    && showRollbackPlanPanel;

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
  const streamingToolsForMessage = useMemo(
    () => (streamingReplyText != null || hasActiveExecutionGraph ? [] : streamingTools),
    [hasActiveExecutionGraph, streamingReplyText, streamingTools],
  );

  // Derive the set of run keys that should be auto-collapsed (run finished
  // streaming or has a reply override) during render instead of in an effect,
  // so we don't violate react-hooks/set-state-in-effect. Explicit user toggles
  // still win via `graphExpandedOverrides` and are merged in at the call site.
  // Pre-compute generated files per run (memoised so the cards and the
  // ArtifactPanel can both read them without re-parsing tool calls every
  // render).
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
  const workContextRunCard = useMemo(
    () => userRunCards.find((card) => card.active) ?? userRunCards[userRunCards.length - 1] ?? null,
    [userRunCards],
  );
  const workContextModel = useMemo(() => {
    if (!workContextRunCard) return null;
    const generatedFiles = filesByRun.get(workContextRunCard.triggerIndex) ?? [];
    return buildTurnWorkModel({
      id: workContextRunCard.runKey,
      active: workContextRunCard.active,
      steps: workContextRunCard.steps,
      reports: generatedFiles,
    });
  }, [filesByRun, workContextRunCard]);

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
    let cancelled = false;
    if (!activeWorkspaceId) {
      setGitStatus(null);
      return () => {
        cancelled = true;
      };
    }
    void hostApi.git.status()
      .then((result) => {
        if (cancelled) return;
        setGitStatus(result.status?.isRepository ? result.status : null);
      })
      .catch(() => {
        if (!cancelled) setGitStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, activeWorkspace?.rootPath, refreshSignal]);

  const autoCollapsedRunKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const card of userRunCards) {
      // Auto-collapse once the run is complete and a final reply exists.
      // Don't collapse while the reply is still streaming.
      const isStillStreaming = card.streamingReplyText != null;
      const shouldCollapse = !isStillStreaming && !card.active && card.replyIndex != null;
      if (!shouldCollapse) continue;
      keys.add(card.runKey);
    }
    return keys;
  }, [userRunCards]);

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
  const isWindows = platform === 'win32';
  const assistantUsageModel = buildUsageModel(liveUsage, contextRange);
  const assistantStatusDimensions = buildStatusDimensions({
    gatewayState: gatewayStatus.state,
    sending,
    pendingFinal,
    activeRunId,
    streamingToolCount: streamingTools.length,
    contextRange,
    workspaceName: activeWorkspace?.name || activeWorkspace?.rootPath,
    permissionMode: activeWorkspace?.permissionMode,
  });

  return (
    <TooltipProvider>
    <div
      ref={splitContainerRef}
      data-testid="chat-page"
      className={cn(
        'relative flex min-h-0 -m-6 overflow-hidden transition-colors duration-500',
        'bg-background',
        // Stack above MainLayout's mac-main-drag-region (z-10) so the right-hand
        // artifact/preview pane stays clickable; window drag is handled by the
        // sidebar + chat-toolbar drag strips instead.
        isMac && 'z-20 rounded-tl-2xl shadow-[inset_1px_1px_0_hsl(var(--border)/0.55)]',
        isWindows && 'rounded-tl-2xl',
      )}
      style={{ height: isMac ? 'calc(100vh - 1px)' : 'calc(100vh - 2.5rem)' }}
    >
      {/* Left column: chat */}
      <div className="flex min-w-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="relative flex shrink-0 items-center justify-between gap-3 px-4 py-2">
        <div data-testid="chat-toolbar-drag-region" className="drag-region absolute inset-0 z-0" aria-hidden="true" />
        <div className="no-drag relative z-10 min-w-0">
          {!isEmpty && (
            <div className="flex items-center gap-1.5">
              <ProjectSessionHeader
                projectName={activeWorkspace?.name || basenameFromPath(activeWorkspace?.rootPath) || 'clawx'}
                projectPath={activeWorkspace?.rootPath}
                workspaceProfiles={workspaceProfiles}
                switchWorkspace={handleSwitchWorkspace}
                pickWorkspaceFolder={handlePickWorkspaceFolder}
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
        <div data-testid="chat-toolbar-actions" className="no-drag relative z-10">
          <ChatToolbar
            workContextVisible={workContextVisible}
            onToggleWorkContext={handleToggleWorkContext}
            questionDirectoryOpen={questionDirectoryVisible}
            questionDirectoryCount={questionDirectoryItems.length}
            onSaveToKnowledge={handleOpenKnowledgeDraft}
            onToggleQuestionDirectory={() =>
              setQuestionDirectoryOpenSessionKey((openSessionKey) =>
                openSessionKey === currentSessionKey ? null : currentSessionKey,
              )
            }
          />
        </div>
      </div>

      {/* Messages Area */}
      <div ref={messageAreaRef} className="relative min-h-0 flex-1 overflow-hidden px-4 py-4">
        <SelectionQuoteToolbar containerRef={messageAreaRef} onQuote={handleQuoteSelection} />
        <WorkContextBar
          visible={workContextVisible}
          workspace={activeWorkspace ? { name: activeWorkspace.name, rootPath: activeWorkspace.rootPath } : null}
          gitStatus={gitStatus}
          workModel={workContextModel}
          taskLedgerSnapshot={taskLedgerSnapshot}
          onOpenGit={handleOpenGitPanel}
          onOpenReport={handleOpenWorkReport}
        />
        <div
          className={cn(
            'mx-auto flex h-full min-h-0 w-full flex-col gap-4 xl:items-stretch',
            chatAssistiveRailVisible ? 'max-w-7xl xl:flex-row' : 'max-w-5xl',
          )}
          data-testid="chat-message-layout"
        >
          <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-testid="chat-scroll-container">
            <div
              ref={contentRef}
              className={cn(
                "mx-auto space-y-4",
                isEmpty ? "w-full max-w-3xl" : "max-w-4xl",
              )}
            >
              {isEmpty ? (
                <>
                  <WelcomeScreen />
                  {showRollbackPlanPanel && (
                    <RollbackPlanPanel
                      plan={rollbackPlan}
                      className="mx-auto w-full max-w-3xl"
                      onPrepareHandoff={handlePrepareHandoff}
                      onDrainQueue={handleDrainQueuedFollowup}
                      onCompact={handleManualCompact}
                      onOpenGit={handleOpenGitPanel}
                      onOpenTaskLedger={handleOpenTaskLedger}
                      onInterruptTerminal={handleInterruptTerminal}
                      onCreateMemoryDraft={handleOpenRecoveryMemoryDraft}
                    />
                  )}
                </>
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
                  {messageRenderRows.map((row) => {
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
                        textOverride={row.textOverride}
                        suppressAssistantText={row.suppressAssistantText}
                        suppressToolCards={row.suppressToolCards}
                        suppressProcessAttachments={row.suppressToolCards}
                        onOpenFile={handleOpenAttachedFile}
                        canSubmitInteractionResponse={isGatewayRunning && !inputRunActive}
                        onSubmitInteractionResponse={handleSubmitInteractionResponse}
                        onDraftInteractionResponse={handleAppendComposerDraft}
                      />
                      {row.runCards.map((card) => {
                          const runKey = card.runKey;
                          const userOverride = graphExpandedOverrides[runKey];
                          // Always use the controlled expanded prop instead of
                          // relying on ExecutionGraphCard's uncontrolled state.
                          // Uncontrolled state is lost on remount (key changes
                          // when loadHistory replaces message ids), causing
                          // spurious collapse.  The controlled prop survives
                          // remounts because it's computed fresh each render.
                          const expanded = userOverride != null
                            ? userOverride
                            : !autoCollapsedRunKeys.has(runKey);
                          return (
                            <div key={`run-${currentSessionKey}:${card.triggerIndex}`} className="space-y-3">
                              <ExecutionGraphCard
                                key={`graph-${currentSessionKey}:${card.triggerIndex}`}
                                agentLabel={card.agentLabel}
                                steps={card.steps}
                                active={card.active}
                                suppressThinking={card.suppressThinking}
                                traceId={card.traceId}
                                expanded={expanded}
                                onExpandedChange={(next) =>
                                  setGraphExpandedOverrides((prev) => ({ ...prev, [runKey]: next }))
                                }
                              />
                              {card.orchestrations.map((orchestration) => (
                                <TeamOrchestrationCard
                                  key={`team-orchestration-${orchestration.id}`}
                                  orchestration={orchestration}
                                />
                              ))}
                            </div>
                          );
                        })}
                    </div>
                    );
                  })}

                  {/* Streaming message — render when reply text is separated from graph,
                      OR when there's streaming content without an active graph */}
                  {shouldRenderStreaming && (
                    streamingReplyText != null
                    || !hasActiveExecutionGraph
                    || (hasStreamText && streamTools.length === 0 && !hasRunningStreamToolStatus && !hasRunningRuntimeToolStatus)
                  ) && (
                    <ChatMessage
                      suppressToolCards={hasActiveExecutionGraph || runSegmentMessageIndices.size > 0}
                      message={buildStreamingRenderMessage({
                        stream: streamState,
                        streamingReplyText,
                        streamingTimestamp,
                      })}
                      textOverride={streamingReplyText ?? undefined}
                      isStreaming
                      streamingTools={streamingToolsForMessage}
                      liveUsage={liveUsage}
                      onOpenFile={handleOpenAttachedFile}
                      canSubmitInteractionResponse={false}
                      onSubmitInteractionResponse={handleSubmitInteractionResponse}
                      onDraftInteractionResponse={handleAppendComposerDraft}
                    />
                  )}

                  {/* Activity indicator: waiting for next AI turn after tool execution */}
                  {inputRunActive && pendingFinal && !shouldRenderStreaming && !hasActiveExecutionGraph && (
                    <ActivityIndicator phase="tool_processing" />
                  )}

                  {pendingImageGeneration && (
                    <ImageGeneratingIndicator />
                  )}

                  {/* Typing indicator when sending but no stream content yet */}
                  {inputRunActive && !pendingFinal && !hasAnyStreamContent && !hasActiveExecutionGraph && !pendingImageGeneration && (
                    <TypingIndicator />
                  )}
                </>
              )}
            </div>
          </div>
          {showScrollToLatest && (
            <button
              type="button"
              onClick={() => void scrollToBottom({ animation: 'smooth', ignoreEscapes: true })}
              className="absolute bottom-4 right-4 z-20 inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg shadow-black/10 backdrop-blur transition-colors hover:bg-black/5 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:shadow-black/30"
              aria-label={t('scrollToLatest')}
              title={t('scrollToLatest')}
              data-testid="chat-scroll-to-latest"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              <span>{t('scrollToLatest')}</span>
            </button>
          )}

          {chatAssistiveRailVisible && !isEmpty && questionDirectoryVisible && (
            <QuestionDirectory items={questionDirectoryItems} />
          )}
          {showChatAssistiveRail && (
            <aside
            data-testid="chat-assistive-rail"
            className="flex w-full shrink-0 flex-col gap-3 xl:w-72"
          >
              {showRollbackPlanPanel && (
                <RollbackPlanPanel
                  plan={rollbackPlan}
                  compact
                  className="w-full lg:w-full xl:w-full"
                  onPrepareHandoff={handlePrepareHandoff}
                  onDrainQueue={handleDrainQueuedFollowup}
                  onCompact={handleManualCompact}
                  onOpenGit={handleOpenGitPanel}
                  onOpenTaskLedger={handleOpenTaskLedger}
                  onInterruptTerminal={handleInterruptTerminal}
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

      {/* Error bar */}
      {error && (
        <div className="px-4 py-2">
          <div className="mx-auto max-w-4xl">
            <AssistantErrorCard title={t('assistantRender.error.title')} message={error} onDismiss={clearError} />
          </div>
        </div>
      )}

      {!isEmpty && (
        <div className="px-4 pb-2" data-testid="assistant-chat-status-footer">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
            <TokenUsageRoll usage={assistantUsageModel} />
            <AssistantStatusIndicator dimensions={assistantStatusDimensions} />
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
        draftValue={composerDraft}
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
        longTaskControlStatus={longTaskControlStatus}
        queueDrainBusy={queueDrainBusy}
        onDrainQueuedFollowup={handleDrainQueuedFollowup}
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
              <span
                key={source.id}
                className={cn(
                  'inline-flex items-center rounded-md border px-2 py-1 text-xs',
                  source.available
                    ? 'border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                )}
                title={source.summary || source.warning}
              >
                {source.label}
              </span>
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
          <Suspense fallback={null}>
            <PanelResizeDividerLazy containerRef={splitContainerRef} />
          </Suspense>
          <aside
            data-testid="artifact-panel-aside"
            className={cn(
              'absolute inset-y-0 right-0 z-30 flex shrink-0 flex-col border-l border-black/5 shadow-2xl dark:border-white/10 xl:relative xl:z-20 xl:shadow-none',
              isMac && 'no-drag',
            )}
            style={{ width: `min(100%, clamp(22rem, ${boundedPanelWidthPct}%, 44rem))` }}
          >
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

      {/* Transparent loading overlay */}
      {minLoading && !sending && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/20 backdrop-blur-[1px] rounded-xl pointer-events-auto">
          <div className="bg-background shadow-lg rounded-full p-2.5 border border-border">
            <LoadingSpinner size="md" />
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

// ── Question Directory ─────────────────────────────────────────

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
            <button
              key={item.index}
              type="button"
              data-testid={`chat-question-directory-item-${item.index}`}
              onClick={() => handleJumpToMessage(item.index)}
              className={cn(
                'group flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition-colors',
                'text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
              )}
              title={item.title}
            >
              <span className="line-clamp-2 min-w-0 text-xs leading-5">
                {item.title}
              </span>
            </button>
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

function WelcomeScreen() {
  const { t } = useTranslation('chat');
  const quickActions = [
    { key: 'askQuestions', label: t('welcome.askQuestions') },
    { key: 'creativeTasks', label: t('welcome.creativeTasks') },
    { key: 'brainstorming', label: t('welcome.brainstorming') },
  ];

  return (
    <div className="flex flex-col items-center justify-center text-center h-[60vh]">
      <h1 className="text-4xl md:text-5xl font-serif text-foreground/80 mb-8 font-normal tracking-tight">
        {t('welcome.subtitle')}
      </h1>

      <div className="flex flex-wrap items-center justify-center gap-2.5 max-w-lg w-full">
        {quickActions.map(({ key, label }) => (
          <button 
            key={key}
            className="px-4 py-1.5 rounded-full border border-black/10 dark:border-white/10 text-meta font-medium text-foreground/70 hover:bg-black/5 dark:hover:bg-white/5 transition-colors bg-black/[0.02]"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Typing Indicator ────────────────────────────────────────────

function TypingIndicator() {
  const { t } = useTranslation('chat');
  return (
    <div className="flex gap-3" data-testid="chat-typing-indicator">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <DotMatrix state="thinking" label={t('assistantRender.activity.thinking')} className="size-4 text-primary" />
          <span>{t('assistantRender.activity.thinking')}</span>
        </div>
      </div>
    </div>
  );
}

// ── Activity Indicator (shown between tool cycles) ─────────────

function ActivityIndicator({ phase }: { phase: 'tool_processing' }) {
  const { t } = useTranslation('chat');
  void phase;
  return (
    <div className="flex gap-3" data-testid="chat-activity-indicator">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <DotMatrix state="syncing" label={t('assistantRender.activity.processingToolResults')} className="size-4 text-primary" />
          <span>{t('assistantRender.activity.processingToolResults')}</span>
        </div>
      </div>
    </div>
  );
}

function ImageGeneratingIndicator() {
  const { t } = useTranslation('chat');
  return (
    <div className="flex gap-3" data-testid="chat-image-generating-indicator">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-1 bg-black/5 dark:bg-white/5 text-foreground">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="bg-black/5 dark:bg-white/5 text-foreground rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <DotMatrix state="loading" label={t('imageGeneration.generating')} className="size-4 text-primary" />
          <span>{t('imageGeneration.generating')}</span>
        </div>
      </div>
    </div>
  );
}

export default Chat;
