import type { ChatRuntimeRunState, RawMessage, ToolStatus } from '@/stores/chat';
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
  suppressThinking: boolean;
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

export function sanitizeGraphSteps(steps: TaskStep[]): TaskStep[] {
  return steps.filter((step) => {
    if (step.kind === 'thinking') return false;
    if (step.kind === 'message' && step.detail && isInternalProcessNarration(step.detail)) return false;
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
}): Pick<UserRunCard, 'status' | 'startedAt' | 'endedAt' | 'hasVisibleReply'> {
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

  return { status, startedAt, endedAt, hasVisibleReply: input.hasVisibleReply };
}

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
}): UserRunProjection {
  const foldedNarrationIndices = new Set<number>();
  const cards: UserRunCard[] = [];
  const currentRuntimeRun = activeRunId ? runtimeRuns[activeRunId] ?? null : null;
  const currentRuntimeRunActive = currentRuntimeRun?.status === 'running';
  const currentRuntimeHasToolActivity = runtimeRunHasToolActivity(currentRuntimeRun);
  const hasRunningRuntimeToolStatus = hasRunningRuntimeTool(currentRuntimeRun);
  let latestRunSegmentCompletion = { hasFinalReply: false, hasToolActivity: false };
  let latestPendingImageGeneration = false;
  let latestImageGenerationSettledInHistory = false;

  messages.forEach((message, idx) => {
    if (!isRealUserMessage(message) || subagentCompletionInfos[idx]) return;

    const runKey = createRunKey(currentSessionKey, idx, message);
    const nextUserIndex = nextUserMessageIndexes[idx];
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
      ? sanitizeGraphSteps(deriveRuntimeTaskSteps(activeRuntimeRun))
      : sanitizeGraphSteps(buildSteps(rawStreamingReplyCandidate));
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
          ? sanitizeGraphSteps(deriveRuntimeTaskSteps(activeRuntimeRun))
          : sanitizeGraphSteps(buildSteps(false));
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

    if (steps.length === 0) {
      if (isLatestOpenRun && streamingReplyText != null) {
        cards.push({
          runKey,
          triggerIndex: idx,
          replyIndex,
          active: true,
          ...deriveRunLifecycle({
            runtimeRun: activeRuntimeRun,
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
          suppressThinking: false,
        });
        return;
      }
      if (isLatestOpenRun && streamingReplyText == null) {
        const historyReplyOffset = findReplyMessageIndex(postTriggerMessages, false);
        if (historyReplyOffset >= 0 && !hasActiveStreamingReply && !currentRuntimeRunActive) {
          return;
        }
        cards.push({
          runKey,
          triggerIndex: idx,
          replyIndex,
          active: true,
          ...deriveRunLifecycle({
            runtimeRun: activeRuntimeRun,
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
          suppressThinking: false,
        });
        return;
      }

      const cached = graphStepCache[runKey];
      if (!cached) return;
      const cleanedSteps = sanitizeGraphSteps(cached.steps.filter(
        (s) => !(s.kind === 'message' && s.id.startsWith('stream-message')),
      ));
      const cachedReplyIndex = cached.replyIndex;
      cards.push({
        runKey,
        triggerIndex: idx,
        replyIndex: cachedReplyIndex,
        active: false,
        ...deriveRunLifecycle({
          runtimeRun: activeRuntimeRun,
          active: false,
          steps: cleanedSteps,
          triggerMessage: message,
          replyMessage: cachedReplyIndex == null ? undefined : messages[cachedReplyIndex],
          hasVisibleReply: cachedReplyIndex != null,
          hasRunError: Boolean(runError),
        }),
        agentLabel: cached.agentLabel,
        sessionLabel: cached.sessionLabel,
        segmentEnd: displaySegmentEnd,
        steps: cleanedSteps,
        orchestrations: teamOrchestrations,
        messageStepTexts: getPrimaryMessageStepTexts(cleanedSteps),
        streamingReplyText: null,
        suppressThinking: false,
      });
      return;
    }

    const segmentReplyOffset = findReplyMessageIndex(postTriggerMessages, hasActiveStreamingReply);
    for (let offset = 0; offset < postTriggerMessages.length; offset += 1) {
      if (offset === segmentReplyOffset) continue;
      if (shouldFoldNarrationMessage(postTriggerMessages[offset])) {
        foldedNarrationIndices.add(idx + 1 + offset);
      }
    }

    const streamVisiblyActiveInGraph = stream.hasStreamText
      || stream.hasStreamThinking
      || stream.hasStreamImages;
    const suppressThinking = isLatestOpenRun
      && streamingReplyText == null
      && streamVisiblyActiveInGraph;

    cards.push({
      runKey,
      triggerIndex: idx,
      replyIndex,
      active: isLatestOpenRun,
      ...deriveRunLifecycle({
        runtimeRun: activeRuntimeRun,
        active: isLatestOpenRun,
        steps,
        triggerMessage: message,
        replyMessage: replyIndex == null ? undefined : messages[replyIndex],
        hasVisibleReply: streamingReplyText != null || replyIndex != null,
        hasRunError: Boolean(runError),
      }),
      agentLabel: segmentAgentLabel,
      sessionLabel: segmentSessionLabel,
      segmentEnd: displaySegmentEnd,
      steps,
      orchestrations: teamOrchestrations,
      messageStepTexts: getPrimaryMessageStepTexts(steps),
      streamingReplyText,
      traceId,
      suppressThinking,
    });
  });

  const hasActiveExecutionGraph = cards.some((card) => card.active);
  const hasAssistiveWorkContext = cards.some((card) =>
    card.active || card.steps.length > 0 || card.orchestrations.length > 0 || !!card.traceId,
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
