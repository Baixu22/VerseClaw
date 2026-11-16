import type { ChatRuntimeRunState, RawMessage, ToolStatus } from '@/stores/chat';
import { createChatContentCache } from '@/stores/chat/content-cache';
import type { PermissionApprovalEvent } from '@shared/types/workspace';
import {
  createCodingRunView,
  displayCompletionStatus,
  resolveProjectIdForWorkspace,
  type CodingRunView,
  type CompletionAuthority,
  type ScopedRunId,
  type WorkspaceId,
} from '@shared/product-semantics';
import { isInternalMessage } from '@/stores/chat/helpers';
import {
  extractImages,
  extractText,
  extractThinking,
  extractToolUse,
  isInternalAssistantReplyText,
  isInternalProcessNarration,
  normalizeMessageRole,
  stripProcessMessagePrefix,
} from './message-utils';
import {
  buildRunSegmentMessageIndices,
  deriveRuntimeTaskSteps,
  deriveTaskSteps,
  findReplyMessageIndex,
  getPostTriggerSegmentMessages,
  getRunSegmentMessages,
  hasActiveStreamingReplyInRun,
  segmentHasFinalReply,
  type SubagentCompletionInfo,
  type TaskStep,
} from './task-visualization';
import { deriveTeamOrchestrationViews, type TeamOrchestrationView } from './team-orchestration-visualization';
import { hasDeliveredImageGenerationResult, isImageGenerationPending } from './image-generation-status';
import {
  isPlanToolName,
  promoteRunSurfaces,
  type PromotedRunSurfaces,
} from './run-surface-promotion';

type AgentLike = {
  id: string;
  name?: string;
};

export type GraphStepCacheEntry = {
  steps: TaskStep[];
  agentLabel: string;
  sessionLabel: string;
  segmentEnd: number;
  replyIndex: number | null;
  triggerIndex: number;
};

export type UserRunStatus = 'running' | 'completed' | 'error' | 'aborted';

export type UserRunCard = {
  runKey: string;
  triggerIndex: number;
  replyIndex: number | null;
  active: boolean;
  status: UserRunStatus;
  startedAt?: number;
  endedAt?: number;
  hasVisibleReply: boolean;
  agentLabel: string;
  sessionLabel: string;
  segmentEnd: number;
  steps: TaskStep[];
  orchestrations: TeamOrchestrationView[];
  messageStepTexts: string[];
  streamingReplyText: string | null;
  traceId?: string;
  /**
   * Runtime run this card renders. Only the latest segment can know it today —
   * history carries no run id — so it is how `assignApprovalsToRunCards` tells
   * "this approval belongs to the turn you are looking at" from "this approval
   * is older than anything we can place".
   */
  /** The bare runtime token is route-local and is never persisted as identity. */
  runId?: string;
  /** Completion is a presentation capability from the run owner, not a bare label. */
  completionAuthority?: CompletionAuthority;
  /** Only set when the owning workspace is known; a session cannot supply it. */
  scopedRunId?: ScopedRunId;
  /** Read-only association view shared by Chat and export surfaces. */
  codingRunView?: CodingRunView;
  suppressThinking: boolean;
  /**
   * Runtime events promoted out of the execution graph into rich Tool UI cards.
   * The graph never renders these — see run-surface-promotion.ts.
   */
  surfaces: PromotedRunSurfaces;
};

export type ExecutionStreamMessage = {
  role?: string;
  content?: unknown;
  timestamp?: number;
} & Record<string, unknown>;

export type ExecutionStreamState = {
  streamMsg: ExecutionStreamMessage | null;
  streamTimestamp: number;
  streamText: string;
  streamThinking: string | null;
  streamTools: ReturnType<typeof extractToolUse>;
  streamImages: ReturnType<typeof extractImages>;
  hasStreamText: boolean;
  hasStreamThinking: boolean;
  hasStreamTools: boolean;
  hasStreamImages: boolean;
  hasStreamToolStatus: boolean;
  hasRunningStreamToolStatus: boolean;
  shouldRenderStreaming: boolean;
  hasAnyStreamContent: boolean;
  hasHistoryCompletionBlockingStream: boolean;
};

export type UserRunProjection = {
  cards: UserRunCard[];
  foldedNarrationIndices: Set<number>;
  hasActiveExecutionGraph: boolean;
  hasAssistiveWorkContext: boolean;
  streamingReplyText: string | null;
  pendingImageGeneration: boolean;
  imageGenerationSettledInHistory: boolean;
  runSettledInHistory: boolean;
  shouldClearStoreLifecycleFromHistory: boolean;
  inputRunActive: boolean;
  currentRuntimeHasToolActivity: boolean;
  hasRunningRuntimeToolStatus: boolean;
};

export function getPrimaryMessageStepTexts(steps: TaskStep[]): string[] {
  return steps
    .filter((step) => step.kind === 'message' && step.parentId === 'agent-run' && !!step.detail)
    .map((step) => step.detail!);
}

export function sanitizeGraphSteps(steps: TaskStep[], promotedStepIds?: ReadonlySet<string>): TaskStep[] {
  return steps.filter((step) => {
    if (step.kind === 'message' && step.detail && isInternalProcessNarration(step.detail)) return false;
    // Rows already rendered by a rich card — see run-surface-promotion.ts for
    // the promotion table. Plan tools are filtered by name because the history
    // path derives its step ids from message ids rather than runtime ids.
    if (step.kind === 'tool' && isPlanToolName(step.label)) return false;
    if (promotedStepIds?.has(step.id)) return false;
    return true;
  });
}

export function isRealUserMessage(msg: RawMessage): boolean {
  if (normalizeMessageRole(msg.role) !== 'user') return false;
  if (isInternalMessage(msg)) return false;
  const content = msg.content;
  if (!Array.isArray(content)) return true;
  const blocks = content as Array<{ type?: string }>;
  return blocks.length === 0 || !blocks.every((b) => b.type === 'tool_result' || b.type === 'toolResult');
}

export function createRunKey(
  currentSessionKey: string,
  triggerIndex: number,
  triggerMessage?: RawMessage,
): string {
  return triggerMessage?.id
    ? `msg-${triggerMessage.id}`
    : `${currentSessionKey}:trigger-${triggerIndex}`;
}

/**
 * Key for the turn's disclosure (expand/collapse) state.
 *
 * Deliberately NOT `runKey`: a turn's trigger message is created optimistically
 * with a client UUID and then replaced in place by the Gateway echo carrying the
 * persisted id (see `mergePendingOptimisticUserMessages` in stores/chat), so
 * `runKey` (`msg-<id>`) flips mid-turn and orphans any override the user set
 * against the old id. The trigger's position survives that swap — the echo lands
 * at the same index — so the disclosure state keys off it and outlives the id
 * change. Cache/approval routing keep `runKey`; only the user's fold preference
 * needs the stable anchor.
 */
export function turnDisclosureKey(
  currentSessionKey: string,
  card: Pick<UserRunCard, 'triggerIndex'>,
): string {
  return `${currentSessionKey}:trigger-${card.triggerIndex}`;
}

export function runtimeRunHasToolActivity(run: ChatRuntimeRunState | null | undefined): boolean {
  return Boolean(run?.events.some((event) =>
    event.type === 'tool.started'
    || event.type === 'tool.updated'
    || event.type === 'tool.completed'
    || event.type === 'command.output'
    || event.type === 'patch.completed'
    || event.type === 'approval.updated',
  ));
}

export function hasRunningRuntimeTool(run: ChatRuntimeRunState | null | undefined): boolean {
  if (!run) return false;
  const toolStatuses = new Map<string, 'running' | 'completed' | 'error'>();
  for (const event of run.events) {
    if (event.type === 'tool.started' || event.type === 'tool.updated') {
      toolStatuses.set(event.toolCallId, 'running');
      continue;
    }
    if (event.type === 'tool.completed') {
      toolStatuses.set(event.toolCallId, event.isError ? 'error' : 'completed');
    }
  }
  return Array.from(toolStatuses.values()).some((status) => status === 'running');
}

function runtimeRunHasImageGenerationActivity(run: ChatRuntimeRunState | null | undefined): boolean {
  return Boolean(run?.events.some((event) =>
    (event.type === 'tool.started' || event.type === 'tool.updated' || event.type === 'tool.completed')
    && event.name === 'image_generate',
  ));
}

function segmentHasDeliveredImage(segmentMessages: RawMessage[]): boolean {
  return segmentMessages.some((message) =>
    normalizeMessageRole(message.role) === 'assistant'
    && (
      (message._attachedFiles ?? []).some((file) => file.mimeType.startsWith('image/'))
      || extractImages(message).length > 0
    ),
  );
}

export function deriveExecutionStreamState({
  streamingMessage,
  streamingTools,
  sending,
}: {
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  sending: boolean;
}): ExecutionStreamState {
  const streamMsg = streamingMessage && typeof streamingMessage === 'object'
    ? streamingMessage as ExecutionStreamMessage
    : null;
  const streamTimestamp = typeof streamMsg?.timestamp === 'number' ? streamMsg.timestamp : 0;
  const streamText = streamMsg ? extractText(streamMsg) : (typeof streamingMessage === 'string' ? streamingMessage : '');
  const hasStreamText = streamText.trim().length > 0;
  const streamThinking = streamMsg ? extractThinking(streamMsg) : null;
  const hasStreamThinking = !!streamThinking && streamThinking.trim().length > 0;
  const streamTools = streamMsg ? extractToolUse(streamMsg) : [];
  const hasStreamTools = streamTools.length > 0;
  const streamImages = streamMsg ? extractImages(streamMsg) : [];
  const hasStreamImages = streamImages.length > 0;
  const hasStreamToolStatus = streamingTools.length > 0;
  const hasRunningStreamToolStatus = streamingTools.some((tool) => tool.status === 'running');

  return {
    streamMsg,
    streamTimestamp,
    streamText,
    streamThinking,
    streamTools,
    streamImages,
    hasStreamText,
    hasStreamThinking,
    hasStreamTools,
    hasStreamImages,
    hasStreamToolStatus,
    hasRunningStreamToolStatus,
    shouldRenderStreaming: sending && (hasStreamText || hasStreamTools || hasStreamImages || hasStreamToolStatus),
    hasAnyStreamContent: hasStreamText || hasStreamThinking || hasStreamTools || hasStreamImages || hasStreamToolStatus,
    hasHistoryCompletionBlockingStream: hasStreamText
      || hasStreamImages
      || hasRunningStreamToolStatus
      || streamTools.length > 0,
  };
}

export function deriveNextUserMessageIndexes(
  messages: RawMessage[],
  subagentCompletionInfos: Array<SubagentCompletionInfo | null | undefined>,
): number[] {
  const indexes = new Array<number>(messages.length).fill(-1);
  let nextUserMessageIndex = -1;
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    indexes[idx] = nextUserMessageIndex;
    if (isRealUserMessage(messages[idx]) && !subagentCompletionInfos[idx]) {
      nextUserMessageIndex = idx;
    }
  }
  return indexes;
}

export function deriveRunSegmentMessageIndices(
  messages: RawMessage[],
  nextUserMessageIndexes: number[],
  subagentCompletionInfos: Array<SubagentCompletionInfo | null | undefined>,
): Set<number> {
  return buildRunSegmentMessageIndices(
    messages,
    nextUserMessageIndexes,
    (message, index) => isRealUserMessage(message) && !subagentCompletionInfos[index],
  );
}

function buildRunSteps({
  segmentMessages,
  completionInfos,
  childTranscripts,
  isLatestOpenRun,
  streamingMessage,
  streamingTools,
  omitLastStreamingMessageSegment,
}: {
  segmentMessages: RawMessage[];
  completionInfos: SubagentCompletionInfo[];
  childTranscripts: Record<string, RawMessage[]>;
  isLatestOpenRun: boolean;
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  omitLastStreamingMessageSegment: boolean;
}): TaskStep[] {
  let builtSteps = deriveTaskSteps({
    messages: segmentMessages,
    streamingMessage: isLatestOpenRun ? streamingMessage : null,
    streamingTools: isLatestOpenRun ? streamingTools : [],
    omitLastStreamingMessageSegment: isLatestOpenRun ? omitLastStreamingMessageSegment : false,
  });

  for (const completion of completionInfos) {
    const childMessages = childTranscripts[completion.sessionId];
    if (!childMessages || childMessages.length === 0) continue;
    const branchRootId = `subagent:${completion.sessionId}`;
    const childSteps = deriveTaskSteps({
      messages: childMessages,
      streamingMessage: null,
      streamingTools: [],
    }).map((step) => ({
      ...step,
      id: `${completion.sessionId}:${step.id}`,
      depth: step.depth + 1,
      parentId: branchRootId,
    }));

    builtSteps = [
      ...builtSteps,
      {
        id: branchRootId,
        label: `${completion.agentId} subagent`,
        status: 'completed',
        kind: 'system' as const,
        detail: completion.sessionKey,
        depth: 1,
        parentId: 'agent-run',
      },
      ...childSteps,
    ];
  }

  return builtSteps;
}

function getAgentLabel(agents: AgentLike[], agentId: string): string {
  return agents.find((agent) => agent.id === agentId)?.name || agentId;
}

function shouldFoldNarrationMessage(
  message: RawMessage | undefined,
): boolean {
  if (!message || message.role !== 'assistant') return false;
  const hasNarrationText = extractText(message).trim().length > 0;
  const hasThinking = !!extractThinking(message);
  return hasNarrationText || hasThinking;
}

function normalizeRunTimestamp(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
}

function deriveRunLifecycle(input: {
  runtimeRun: ChatRuntimeRunState | null;
  active: boolean;
  steps: TaskStep[];
  triggerMessage: RawMessage;
  replyMessage?: RawMessage;
  hasVisibleReply: boolean;
  hasRunError: boolean;
}): Pick<UserRunCard, 'status' | 'startedAt' | 'endedAt' | 'hasVisibleReply' | 'completionAuthority'> {
  const runtimeStatus = input.runtimeRun?.status;
  const status: UserRunStatus = runtimeStatus === 'aborted'
    ? 'aborted'
    : runtimeStatus === 'error' || input.hasRunError || input.steps.some((step) => step.status === 'error')
      ? 'error'
      : input.active || runtimeStatus === 'running'
        ? 'running'
        : 'completed';
  const startedAt = normalizeRunTimestamp(input.runtimeRun?.startedAt)
    ?? normalizeRunTimestamp(input.triggerMessage.timestamp);
  const endedAt = status === 'running'
    ? undefined
    : normalizeRunTimestamp(input.runtimeRun?.endedAt)
      ?? normalizeRunTimestamp(input.replyMessage?.timestamp);
  // This projection never invents task authority: a settled ordinary turn is at most run-level.
  const completionAuthority: CompletionAuthority | undefined = status === 'completed' ? 'run' : undefined;
  const displayedStatus = displayCompletionStatus({ status, authority: completionAuthority });

  return {
    status: (displayedStatus === 'unavailable' ? status : displayedStatus) as UserRunStatus,
    startedAt,
    endedAt,
    hasVisibleReply: input.hasVisibleReply,
    completionAuthority,
  };
}

function latestRuntimeRunForSession(
  runtimeRuns: Record<string, ChatRuntimeRunState>,
  sessionKey: string,
): ChatRuntimeRunState | null {
  let latest: ChatRuntimeRunState | null = null;
  for (const run of Object.values(runtimeRuns)) {
    if (run.sessionKey && run.sessionKey !== sessionKey) continue;
    const startedAt = normalizeRunTimestamp(run.startedAt) ?? 0;
    const latestStartedAt = latest ? normalizeRunTimestamp(latest.startedAt) ?? 0 : -1;
    if (startedAt >= latestStartedAt) latest = run;
  }
  return latest;
}

function codingRunForCard(input: {
  runKey: string;
  scopedRunId?: ScopedRunId;
  traceId?: string;
  status: UserRunStatus;
  completionAuthority?: CompletionAuthority;
  objective?: string;
}): CodingRunView {
  const sessionKey = input.scopedRunId?.scope.sessionKey;
  return createCodingRunView({
    codingRunId: input.runKey,
    objective: input.objective,
    sessionIds: sessionKey === undefined ? [] : [sessionKey],
    scope: input.scopedRunId?.scope ?? null,
    runIds: input.scopedRunId === undefined ? [] : [input.scopedRunId],
    traceId: input.traceId,
    completion: {
      turnStatus: input.status,
      runStatus: input.status,
      verification: 'unavailable',
      taskStatus: 'unavailable',
      completionAuthority: input.completionAuthority ?? null,
    },
  });
}

function scopedRunForCard(input: {
  workspaceId: WorkspaceId | null;
  sessionKey: string;
  runId?: string;
}): ScopedRunId | undefined {
  if (!input.workspaceId || !input.runId) return undefined;
  return {
    runId: input.runId as ScopedRunId['runId'],
    scope: {
      workspaceId: input.workspaceId,
      projectId: resolveProjectIdForWorkspace(input.workspaceId),
      sessionKey: input.sessionKey as ScopedRunId['scope']['sessionKey'],
    },
  };
}

const historyProjectionIds = new WeakMap<RawMessage[], number>();
let nextHistoryProjectionId = 0;
const completedProjectionCache = createChatContentCache<{
  inputs: unknown[];
  cards: Map<number, { card?: UserRunCard; folded: number[]; graph: GraphStepCacheEntry | undefined }>;
}>('history-projection', 20);

export function deriveUserRunProjection({
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
  stream,
  childTranscripts,
  graphStepCache,
  runError,
  activeRunId,
  runtimeRuns,
  workspaceId = null,
}: {
  messages: RawMessage[];
  subagentCompletionInfos: Array<SubagentCompletionInfo | null | undefined>;
  currentSessionKey: string;
  currentAgentId: string;
  agents: AgentLike[];
  sessionLabels: Record<string, string>;
  nextUserMessageIndexes: number[];
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  pendingFinal: boolean;
  sending: boolean;
  stream: ExecutionStreamState;
  childTranscripts: Record<string, RawMessage[]>;
  graphStepCache: Record<string, GraphStepCacheEntry>;
  runError: string | null;
  activeRunId: string | null;
  runtimeRuns: Record<string, ChatRuntimeRunState>;
  workspaceId?: string | null;
}): UserRunProjection {
  const foldedNarrationIndices = new Set<number>();
  const cards: UserRunCard[] = [];
  const workspaceIdValue = workspaceId?.trim() ? workspaceId.trim() as WorkspaceId : null;
  const currentRuntimeRun = activeRunId ? runtimeRuns[activeRunId] ?? null : null;
  const currentRuntimeRunActive = currentRuntimeRun?.status === 'running';
  const currentRuntimeHasToolActivity = runtimeRunHasToolActivity(currentRuntimeRun);
  const hasRunningRuntimeToolStatus = hasRunningRuntimeTool(currentRuntimeRun);
  let latestRunSegmentCompletion = { hasFinalReply: false, hasToolActivity: false };
  let latestPendingImageGeneration = false;
  let latestImageGenerationSettledInHistory = false;
  const completedInputs = [subagentCompletionInfos, currentSessionKey, currentAgentId, agents,
    sessionLabels, nextUserMessageIndexes, childTranscripts, workspaceId];
  let projectionId = historyProjectionIds.get(messages);
  if (projectionId === undefined) { projectionId = ++nextHistoryProjectionId; historyProjectionIds.set(messages, projectionId); }
  const projectionKey = String(projectionId);
  let completedCache = completedProjectionCache.get(projectionKey);
  let completedCacheChanged = false;
  const previousInputs = completedCache?.inputs;
  if (!completedCache || completedInputs.some((value, index) => value !== previousInputs?.[index])) {
    completedCache = { inputs: completedInputs, cards: new Map() };
    completedCacheChanged = true;
  }

  messages.forEach((message, idx) => {
    if (!isRealUserMessage(message) || subagentCompletionInfos[idx]) return;

    const runKey = createRunKey(currentSessionKey, idx, message);
    const nextUserIndex = nextUserMessageIndexes[idx];
    const completed = nextUserIndex !== -1;
    const cachedProjection = completedCache.cards.get(idx);
    if (completed && cachedProjection && cachedProjection.graph === graphStepCache[runKey]) {
      if (cachedProjection.card) cards.push(cachedProjection.card);
      cachedProjection.folded.forEach(index => foldedNarrationIndices.add(index));
      return;
    }
    // Store empty as well as visible completed segments, avoiding repeated parsing.
    const completedProjection: { card?: UserRunCard; folded: number[]; graph: GraphStepCacheEntry | undefined }
      = { folded: [], graph: graphStepCache[runKey] };
    if (completed) { completedCache.cards.set(idx, completedProjection); completedCacheChanged = true; }
    const appendCard = (card: UserRunCard) => {
      cards.push(card);
      if (completed) completedProjection.card = card;
    };
    const segmentEnd = nextUserIndex === -1 ? messages.length : nextUserIndex;
    const displaySegmentEnd = nextUserIndex === -1 ? messages.length - 1 : nextUserIndex - 1;
    const postTriggerMessages = getPostTriggerSegmentMessages(messages, idx, nextUserIndex);
    const segmentMessages = getRunSegmentMessages(
      messages,
      idx,
      nextUserIndex,
      (candidate, index) => isRealUserMessage(candidate) && !subagentCompletionInfos[index],
    );
    const completionInfos = subagentCompletionInfos
      .slice(idx + 1, segmentEnd)
      .filter((value): value is SubagentCompletionInfo => value != null);
    const isLatestRunSegment = nextUserIndex === -1;
    const activeRuntimeRun = isLatestRunSegment && activeRunId ? runtimeRuns[activeRunId] ?? null : null;
    const traceId = isLatestRunSegment && activeRunId ? `trace_${activeRunId}` : undefined;
    const runtimeHasToolActivity = runtimeRunHasToolActivity(activeRuntimeRun);
    const runtimeHasRunningTool = hasRunningRuntimeTool(activeRuntimeRun);
    const teamOrchestrations = deriveTeamOrchestrationViews(segmentMessages, activeRuntimeRun);
    // Rich cards outlive `activeRunId`: once a run ends the store keeps its
    // event log, and a completed turn must still show the terminal output and
    // plan it produced. Lifecycle decisions below deliberately keep using
    // `activeRuntimeRun` so ending a run still collapses the graph.
    const surfaceRuntimeRun = isLatestRunSegment
      ? activeRuntimeRun ?? latestRuntimeRunForSession(runtimeRuns, currentSessionKey)
      : null;
    const surfaces = promoteRunSurfaces({
      runState: surfaceRuntimeRun,
      segmentMessages: postTriggerMessages,
    });
    /**
     * Lifecycle reads the run that is still active, plus — once it is not — the
     * TERMINAL status of the run we just watched. Without the fallback, hitting
     * Stop clears `activeRunId` and the turn settles as "completed" instead of
     * "stopped", because the aborted status only ever lived on the run object.
     * Only terminal statuses are adopted: a stale `running` must never
     * resurrect a turn the rest of the projection considers finished.
     */
    const lifecycleRuntimeRun = activeRuntimeRun
      ?? (surfaceRuntimeRun && surfaceRuntimeRun.status !== 'running' ? surfaceRuntimeRun : null);
    const hasToolActivity = runtimeHasToolActivity || postTriggerMessages.some((m) =>
      m.role === 'assistant' && extractToolUse(m).length > 0,
    );
    const hasFinalReply = segmentHasFinalReply(postTriggerMessages);
    const pendingImageGeneration = isLatestRunSegment
      && isImageGenerationPending(postTriggerMessages, streamingTools);
    const runtimeImageGenerationSettledInHistory = isLatestRunSegment
      && runtimeRunHasImageGenerationActivity(activeRuntimeRun)
      && segmentHasDeliveredImage(postTriggerMessages);
    const imageGenerationSettledInHistory = isLatestRunSegment
      && (hasDeliveredImageGenerationResult(postTriggerMessages) || runtimeImageGenerationSettledInHistory)
      && !pendingImageGeneration;
    const runStillExecutingTools = hasToolActivity && !hasFinalReply;
    const streamBlocksHistoryCompletion = stream.hasHistoryCompletionBlockingStream && !imageGenerationSettledInHistory;
    const runCompletedInHistory = imageGenerationSettledInHistory || (!currentRuntimeRunActive && (hasFinalReply
      && !pendingImageGeneration
      && !streamBlocksHistoryCompletion
      && (hasToolActivity || !sending)));
    const isLatestOpenRun = isLatestRunSegment
      && !runError
      && !runCompletedInHistory
      && (
        sending
        || pendingFinal
        || pendingImageGeneration
        || currentRuntimeRunActive
        || stream.hasAnyStreamContent
        || (runStillExecutingTools && !!activeRunId)
      );

    if (isLatestRunSegment) {
      latestRunSegmentCompletion = { hasFinalReply, hasToolActivity };
      latestPendingImageGeneration = pendingImageGeneration;
      latestImageGenerationSettledInHistory = imageGenerationSettledInHistory;
    }

    const buildSteps = (omitLastStreamingMessageSegment: boolean): TaskStep[] => buildRunSteps({
      segmentMessages,
      completionInfos,
      childTranscripts,
      isLatestOpenRun,
      streamingMessage,
      streamingTools,
      omitLastStreamingMessageSegment,
    });

    const allToolsCompleted = streamingTools.length > 0 && !stream.hasRunningStreamToolStatus;
    const runtimeReplyText = activeRuntimeRun?.assistantText ?? '';
    const hasRuntimeReplyText = runtimeReplyText.trim().length > 0
      && !isInternalAssistantReplyText(runtimeReplyText);
    const canPromoteStreamToBubble = pendingFinal
      || allToolsCompleted
      || hasToolActivity
      || (!hasToolActivity && (stream.hasStreamText || stream.hasStreamImages || hasRuntimeReplyText));
    const rawStreamingReplyCandidate = isLatestOpenRun
      && canPromoteStreamToBubble
      && (stream.hasStreamText || stream.hasStreamImages || hasRuntimeReplyText)
      && stream.streamTools.length === 0
      && !stream.hasRunningStreamToolStatus
      && !runtimeHasRunningTool;

    let steps = activeRuntimeRun && runtimeHasToolActivity
      ? sanitizeGraphSteps(deriveRuntimeTaskSteps(activeRuntimeRun), surfaces.promotedStepIds)
      : sanitizeGraphSteps(buildSteps(rawStreamingReplyCandidate), surfaces.promotedStepIds);
    let streamingReplyText: string | null = null;
    if (rawStreamingReplyCandidate) {
      const candidateReplyText = stream.hasStreamText ? stream.streamText : runtimeReplyText;
      const trimmedReplyText = stripProcessMessagePrefix(candidateReplyText, getPrimaryMessageStepTexts(steps));
      const hasReplyText = trimmedReplyText.trim().length > 0
        && !isInternalAssistantReplyText(trimmedReplyText);
      if (hasReplyText || stream.hasStreamImages) {
        streamingReplyText = hasReplyText ? trimmedReplyText : '';
      } else {
        steps = activeRuntimeRun && runtimeHasToolActivity
          ? sanitizeGraphSteps(deriveRuntimeTaskSteps(activeRuntimeRun), surfaces.promotedStepIds)
          : sanitizeGraphSteps(buildSteps(false), surfaces.promotedStepIds);
      }
    }

    const hasActiveStreamingReply = hasActiveStreamingReplyInRun(
      isLatestOpenRun,
      stream.hasAnyStreamContent,
      streamingReplyText,
    );
    const replyIndexOffset = findReplyMessageIndex(postTriggerMessages, hasActiveStreamingReply);
    const replyIndex = replyIndexOffset === -1 ? null : idx + 1 + replyIndexOffset;

    const segmentAgentLabel = getAgentLabel(agents, currentAgentId);
    const segmentSessionLabel = sessionLabels[currentSessionKey] || currentSessionKey;

    // A run whose only output was promoted to a rich card (e.g. a single
    // `command.output`) has no graph rows left — it must still render.
    //
    // Reasoning counts the same way. A turn that only thought — no tools, no
    // files, the ordinary shape on a reasoning model — used to produce no card
    // at all, which left its thinking with nowhere to live but the assistant
    // message, at the same level as the answer. That is precisely the turn whose
    // thinking is longest, so it is the one that most needs the disclosure.
    const segmentHasReasoning = postTriggerMessages.some((segmentMessage) => !!extractThinking(segmentMessage));
    const hasSurfaceContent = surfaces.terminals.length > 0 || surfaces.plan != null || segmentHasReasoning;

    if (steps.length === 0 && !hasSurfaceContent) {
      if (isLatestOpenRun && streamingReplyText != null) {
        const card: UserRunCard = {
          runKey,
          triggerIndex: idx,
          replyIndex,
          active: true,
          ...deriveRunLifecycle({
            runtimeRun: lifecycleRuntimeRun,
            active: true,
            steps: [],
            triggerMessage: message,
            replyMessage: replyIndex == null ? undefined : messages[replyIndex],
            hasVisibleReply: true,
            hasRunError: isLatestRunSegment && Boolean(runError),
          }),
          agentLabel: segmentAgentLabel,
          sessionLabel: segmentSessionLabel,
          segmentEnd: displaySegmentEnd,
          steps: [],
          orchestrations: teamOrchestrations,
          messageStepTexts: [],
          streamingReplyText,
          traceId,
          runId: surfaceRuntimeRun?.runId,
          scopedRunId: scopedRunForCard({
            workspaceId: workspaceIdValue,
            sessionKey: currentSessionKey,
            runId: surfaceRuntimeRun?.runId,
          }),
          codingRunView: undefined,
          suppressThinking: false,
          surfaces,
        };
        card.codingRunView = codingRunForCard({
          runKey,
          scopedRunId: card.scopedRunId,
          traceId: card.traceId,
          status: card.status,
          completionAuthority: card.completionAuthority,
          objective: typeof message.content === 'string' ? message.content : undefined,
        });
        appendCard(card);
        return;
      }
      if (isLatestOpenRun && streamingReplyText == null) {
        const historyReplyOffset = findReplyMessageIndex(postTriggerMessages, false);
        if (historyReplyOffset >= 0 && !hasActiveStreamingReply && !currentRuntimeRunActive) {
          return;
        }
        const card: UserRunCard = {
          runKey,
          triggerIndex: idx,
          replyIndex,
          active: true,
          ...deriveRunLifecycle({
            runtimeRun: lifecycleRuntimeRun,
            active: true,
            steps: [],
            triggerMessage: message,
            replyMessage: replyIndex == null ? undefined : messages[replyIndex],
            hasVisibleReply: false,
            hasRunError: isLatestRunSegment && Boolean(runError),
          }),
          agentLabel: segmentAgentLabel,
          sessionLabel: segmentSessionLabel,
          segmentEnd: displaySegmentEnd,
          steps: [],
          orchestrations: teamOrchestrations,
          messageStepTexts: [],
          streamingReplyText: null,
          traceId,
          runId: surfaceRuntimeRun?.runId,
          scopedRunId: scopedRunForCard({
            workspaceId: workspaceIdValue,
            sessionKey: currentSessionKey,
            runId: surfaceRuntimeRun?.runId,
          }),
          codingRunView: undefined,
          suppressThinking: false,
          surfaces,
        };
        card.codingRunView = codingRunForCard({
          runKey,
          scopedRunId: card.scopedRunId,
          traceId: card.traceId,
          status: card.status,
          completionAuthority: card.completionAuthority,
          objective: typeof message.content === 'string' ? message.content : undefined,
        });
        appendCard(card);
        return;
      }

      const cached = graphStepCache[runKey];
      if (!cached) return;
      const cleanedSteps = sanitizeGraphSteps(cached.steps.filter(
        (s) => !(s.kind === 'message' && s.id.startsWith('stream-message')),
      ), surfaces.promotedStepIds);
      const cachedReplyIndex = cached.replyIndex;
      const card: UserRunCard = {
        runKey,
        triggerIndex: idx,
        replyIndex: cachedReplyIndex,
        active: false,
        ...deriveRunLifecycle({
          runtimeRun: lifecycleRuntimeRun,
          active: false,
          steps: cleanedSteps,
          triggerMessage: message,
          replyMessage: cachedReplyIndex == null ? undefined : messages[cachedReplyIndex],
          hasVisibleReply: cachedReplyIndex != null,
          hasRunError: isLatestRunSegment && Boolean(runError),
        }),
        agentLabel: cached.agentLabel,
        sessionLabel: cached.sessionLabel,
        segmentEnd: displaySegmentEnd,
        steps: cleanedSteps,
        orchestrations: teamOrchestrations,
        messageStepTexts: getPrimaryMessageStepTexts(cleanedSteps),
        streamingReplyText: null,
        runId: surfaceRuntimeRun?.runId,
          scopedRunId: scopedRunForCard({
            workspaceId: workspaceIdValue,
            sessionKey: currentSessionKey,
            runId: surfaceRuntimeRun?.runId,
          }),
        codingRunView: undefined,
        suppressThinking: false,
        surfaces,
      };
      card.codingRunView = codingRunForCard({
        runKey,
        scopedRunId: card.scopedRunId,
        traceId: card.traceId,
        status: card.status,
        completionAuthority: card.completionAuthority,
        objective: typeof message.content === 'string' ? message.content : undefined,
      });
      appendCard(card);
      return;
    }

    const segmentReplyOffset = findReplyMessageIndex(postTriggerMessages, hasActiveStreamingReply);
    for (let offset = 0; offset < postTriggerMessages.length; offset += 1) {
      if (offset === segmentReplyOffset) continue;
      if (shouldFoldNarrationMessage(postTriggerMessages[offset])) {
        foldedNarrationIndices.add(idx + 1 + offset);
        if (completed) completedProjection.folded.push(idx + 1 + offset);
      }
    }

    const streamVisiblyActiveInGraph = stream.hasStreamText
      || stream.hasStreamThinking
      || stream.hasStreamImages;
    const suppressThinking = isLatestOpenRun
      && streamingReplyText == null
      && streamVisiblyActiveInGraph;

    const card: UserRunCard = {
      runKey,
      triggerIndex: idx,
      replyIndex,
      active: isLatestOpenRun,
      ...deriveRunLifecycle({
        runtimeRun: lifecycleRuntimeRun,
        active: isLatestOpenRun,
        steps,
        triggerMessage: message,
        replyMessage: replyIndex == null ? undefined : messages[replyIndex],
        hasVisibleReply: streamingReplyText != null || replyIndex != null,
        hasRunError: isLatestRunSegment && Boolean(runError),
      }),
      agentLabel: segmentAgentLabel,
      sessionLabel: segmentSessionLabel,
      segmentEnd: displaySegmentEnd,
      steps,
      orchestrations: teamOrchestrations,
      messageStepTexts: getPrimaryMessageStepTexts(steps),
      streamingReplyText,
      traceId,
      runId: surfaceRuntimeRun?.runId,
          scopedRunId: scopedRunForCard({
            workspaceId: workspaceIdValue,
            sessionKey: currentSessionKey,
            runId: surfaceRuntimeRun?.runId,
          }),
      codingRunView: undefined,
      suppressThinking,
      surfaces,
    };
    card.codingRunView = codingRunForCard({
      runKey,
      scopedRunId: card.scopedRunId,
      traceId: card.traceId,
      status: card.status,
      completionAuthority: card.completionAuthority,
      objective: typeof message.content === 'string' ? message.content : undefined,
    });
    appendCard(card);
  });

  if (completedCacheChanged) completedProjectionCache.set(projectionKey, completedCache);
  const hasActiveExecutionGraph = cards.some((card) => card.active);
  const hasAssistiveWorkContext = cards.some((card) =>
    card.active
    || card.steps.length > 0
    || card.orchestrations.length > 0
    || card.surfaces.terminals.length > 0
    || card.surfaces.plan != null
    || !!card.traceId,
  );
  const streamBlocksHistoryCompletion = stream.hasHistoryCompletionBlockingStream && !latestImageGenerationSettledInHistory;
  const runSettledInHistory = latestImageGenerationSettledInHistory || (!currentRuntimeRunActive && (latestRunSegmentCompletion.hasFinalReply
    && !latestPendingImageGeneration
    && !streamBlocksHistoryCompletion
    && (
      latestRunSegmentCompletion.hasToolActivity
      || currentRuntimeHasToolActivity
      || !sending
    )));
  const shouldClearStoreLifecycleFromHistory = sending
    && runSettledInHistory
    && (
      latestImageGenerationSettledInHistory
      || (!hasRunningRuntimeToolStatus && !stream.hasRunningStreamToolStatus)
    );

  return {
    cards,
    foldedNarrationIndices,
    hasActiveExecutionGraph,
    hasAssistiveWorkContext,
    streamingReplyText: cards.find((card) => card.streamingReplyText != null)?.streamingReplyText ?? null,
    pendingImageGeneration: latestPendingImageGeneration,
    imageGenerationSettledInHistory: latestImageGenerationSettledInHistory,
    runSettledInHistory,
    shouldClearStoreLifecycleFromHistory,
    inputRunActive: sending || latestPendingImageGeneration || currentRuntimeRunActive || (hasActiveExecutionGraph && !runSettledInHistory),
    currentRuntimeHasToolActivity,
    hasRunningRuntimeToolStatus,
  };
}

function sameCachedSteps(existing: GraphStepCacheEntry | undefined, card: UserRunCard): boolean {
  return !!existing
    && existing.steps.length === card.steps.length
    && existing.steps.every((step, index) => {
      const nextStep = card.steps[index];
      return nextStep
        && step.id === nextStep.id
        && step.label === nextStep.label
        && step.status === nextStep.status
        && step.kind === nextStep.kind
        && step.detail === nextStep.detail
        && step.depth === nextStep.depth
        && step.parentId === nextStep.parentId;
    });
}

export function mergeGraphStepCacheEntries(
  current: Record<string, GraphStepCacheEntry>,
  cards: UserRunCard[],
): { cache: Record<string, GraphStepCacheEntry>; changed: boolean } {
  if (cards.length === 0) return { cache: current, changed: false };
  let changed = false;
  const next = { ...current };

  for (const card of cards) {
    if (card.steps.length === 0) continue;
    const existing = current[card.runKey];
    if (
      sameCachedSteps(existing, card)
      && existing?.agentLabel === card.agentLabel
      && existing?.sessionLabel === card.sessionLabel
      && existing?.segmentEnd === card.segmentEnd
      && existing?.replyIndex === card.replyIndex
      && existing?.triggerIndex === card.triggerIndex
    ) {
      continue;
    }
    next[card.runKey] = {
      steps: card.steps,
      agentLabel: card.agentLabel,
      sessionLabel: card.sessionLabel,
      segmentEnd: card.segmentEnd,
      replyIndex: card.replyIndex,
      triggerIndex: card.triggerIndex,
    };
    changed = true;
  }

  return changed ? { cache: next, changed } : { cache: current, changed: false };
}

export function buildReplyTextOverrides(messages: RawMessage[], cards: UserRunCard[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const card of cards) {
    if (card.replyIndex == null) continue;
    const replyMessage = messages[card.replyIndex];
    if (!replyMessage || replyMessage.role !== 'assistant') continue;
    const fullReplyText = extractText(replyMessage);
    const trimmedReplyText = stripProcessMessagePrefix(fullReplyText, card.messageStepTexts);
    if (trimmedReplyText !== fullReplyText) {
      map.set(card.replyIndex, trimmedReplyText);
    }
  }
  return map;
}

export function groupRunCardsByTriggerIndex(cards: UserRunCard[]): Map<number, UserRunCard[]> {
  const map = new Map<number, UserRunCard[]>();
  for (const card of cards) {
    const existing = map.get(card.triggerIndex);
    if (existing) {
      existing.push(card);
    } else {
      map.set(card.triggerIndex, [card]);
    }
  }
  return map;
}

/**
 * Decide which turn shows each pending approval, keyed by `runKey`.
 *
 * Two rules, in order:
 *
 *   1. An approval whose `runId` matches a card's `runId` belongs to that turn.
 *      This is the honest attribution — the user sees the request next to the
 *      work that raised it.
 *   2. Everything else lands on the newest turn. That covers approvals raised
 *      before the host learned a run id, and approvals left undecided when the
 *      user moved on to the next message. They are still actionable, so they
 *      must appear somewhere; the newest turn is where the user is looking.
 *
 * Rule 2 is what makes an undecided approval survive the next turn. Dropping it
 * would leave the host holding a request the UI no longer offers any way to
 * answer.
 */
export function assignApprovalsToRunCards(
  cards: UserRunCard[],
  approvals: PermissionApprovalEvent[],
): Map<string, PermissionApprovalEvent[]> {
  const byRunKey = new Map<string, PermissionApprovalEvent[]>();
  if (cards.length === 0 || approvals.length === 0) return byRunKey;

  const runKeyByRunId = new Map<string, string>();
  for (const card of cards) {
    if (card.runId) runKeyByRunId.set(card.runId, card.runKey);
  }
  const fallbackRunKey = cards[cards.length - 1].runKey;

  for (const approval of approvals) {
    const runKey = (approval.runId && runKeyByRunId.get(approval.runId)) || fallbackRunKey;
    const existing = byRunKey.get(runKey);
    if (existing) existing.push(approval);
    else byRunKey.set(runKey, [approval]);
  }
  return byRunKey;
}

export function buildStreamingRenderMessage({
  stream,
  streamingReplyText,
  streamingTimestamp,
}: {
  stream: ExecutionStreamState;
  streamingReplyText: string | null;
  streamingTimestamp: number;
}): RawMessage {
  const base = stream.streamMsg
    ? {
        ...stream.streamMsg,
        role: (typeof stream.streamMsg.role === 'string' ? stream.streamMsg.role : 'assistant') as RawMessage['role'],
        content: stream.streamMsg.content ?? stream.streamText,
        timestamp: stream.streamMsg.timestamp ?? streamingTimestamp,
      }
    : {
        role: 'assistant' as const,
        content: stream.streamText,
        timestamp: streamingTimestamp,
      };

  if (streamingReplyText != null && Array.isArray(base.content)) {
    return {
      ...base,
      content: (base.content as Array<{ type?: string }>).filter(
        (block) => block.type !== 'thinking',
      ),
    } as RawMessage;
  }

  return base as RawMessage;
}
