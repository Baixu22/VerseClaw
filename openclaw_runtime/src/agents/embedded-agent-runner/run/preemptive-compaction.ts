/**
 * Estimates prompt pressure and decides pre-prompt compaction routing.
 */
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import type { SessionContextBudgetStatus } from "../../../config/sessions.js";
import {
  createContextArchiveHandleForPayload,
  createContextItemId,
  createTransformationLifecycleEvents,
  verifyContextArchiveHandle,
} from "../../../context-engine/registry/context-item-registry.js";
import { estimateStringChars } from "../../../utils/cjk-chars.js";
import type { ArchiveHandle, LifecycleEvent } from "../../../../../shared/types/context-family.js";
import {
  MIN_PROMPT_BUDGET_RATIO,
  MIN_PROMPT_BUDGET_TOKENS,
} from "../../agent-compaction-constants.js";
import { SAFETY_MARGIN } from "../../compaction.js";
import { isRealConversationMessage } from "../../compaction-real-conversation.js";
import type { AgentMessage } from "../../runtime/index.js";
import { estimateToolResultReductionPotential } from "../tool-result-truncation.js";
import type { PreemptiveCompactionRoute } from "./preemptive-compaction.types.js";

export const PREEMPTIVE_OVERFLOW_ERROR_TEXT =
  "Context overflow: prompt too large for the model (precheck).";

const ESTIMATED_CHARS_PER_TOKEN = 4;
const TOOL_RESULT_CHARS_PER_TOKEN = 2;
const JSON_PAYLOAD_CHARS_PER_TOKEN = 3;
const MESSAGE_BOUNDARY_OVERHEAD_TOKENS = 12;
const CONTENT_BLOCK_OVERHEAD_TOKENS = 6;
const IMAGE_BLOCK_TOKENS = 2_000;
const TRUNCATION_ROUTE_BUFFER_TOKENS = 512;

export type { PreemptiveCompactionRoute } from "./preemptive-compaction.types.js";

/** Pre-prompt routing decision plus the budget facts used to explain it in logs and session state. */
export type PreemptiveCompactionDecision = {
  route: PreemptiveCompactionRoute;
  shouldCompact: boolean;
  estimatedPromptTokens: number;
  pressureSource?: string;
  promptBudgetBeforeReserve: number;
  overflowTokens: number;
  toolResultReducibleChars: number;
  effectiveReserveTokens: number;
  observationMasking?: {
    verifiedMaskedCount: number;
    projectedPromptTokens: number;
    tokenReduction: number;
  };
};

/** Token pressure reported by the rendered provider-boundary prompt when available. */
export type LlmBoundaryTokenPressure = {
  estimatedPromptTokens: number;
  source: string;
  renderedChars?: number;
};

export type ObservationMaskingRouteInput = {
  enabled: boolean;
  verifiedMaskedCount: number;
  projectedPromptTokens: number;
};

export type ObservationMaskingProjectionResult = {
  messages: AgentMessage[];
  maskedCount: number;
  estimatedTokenReduction: number;
  diagnostics: string[];
  archiveHandles: ArchiveHandle[];
};

export type ContextFamilyPolicyPromotionMetrics = {
  behavior: "observation_masking_projection";
  rollbackFlag: "runtime.contextFamily.observationMasking.enabled=false";
  baselineRoute: PreemptiveCompactionRoute;
  promotedRoute: PreemptiveCompactionRoute;
  tokenReduction: {
    baselinePromptTokens: number;
    projectedPromptTokens: number;
    reductionTokens: number;
    reductionRatio: number;
  };
  evidenceRetention: {
    archivedHandleCount: number;
    verifiedMaskedCount: number;
  };
  recoveryFidelity: {
    recallable: boolean;
    diagnostics: string[];
  };
  failureModes: string[];
};

function estimateStringTokenPressure(text: string, charsPerToken = ESTIMATED_CHARS_PER_TOKEN) {
  return Math.ceil(estimateStringChars(text) / charsPerToken);
}

function estimateJsonPayloadTokenPressure(
  value: unknown,
  charsPerToken = JSON_PAYLOAD_CHARS_PER_TOKEN,
): number {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string"
      ? Math.ceil(estimateStringChars(serialized) / charsPerToken)
      : 1;
  } catch {
    return 256;
  }
}

function estimateIdentifierTokenPressure(
  value: unknown,
  charsPerToken = JSON_PAYLOAD_CHARS_PER_TOKEN,
): number {
  if (value == null) {
    return 0;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return estimateStringTokenPressure(String(value), charsPerToken);
  }
  return estimateJsonPayloadTokenPressure(value, charsPerToken);
}

function estimateContentBlockTokenPressure(
  block: unknown,
  charsPerToken = ESTIMATED_CHARS_PER_TOKEN,
): number {
  if (typeof block === "string") {
    return estimateStringTokenPressure(block, charsPerToken);
  }
  if (!isRecord(block)) {
    return estimateJsonPayloadTokenPressure(block, charsPerToken);
  }

  const type = block.type;
  if (type === "text" && typeof block.text === "string") {
    return CONTENT_BLOCK_OVERHEAD_TOKENS + estimateStringTokenPressure(block.text, charsPerToken);
  }
  if (type === "thinking" && typeof block.thinking === "string") {
    return (
      CONTENT_BLOCK_OVERHEAD_TOKENS + estimateStringTokenPressure(block.thinking, charsPerToken)
    );
  }
  if (type === "image") {
    return IMAGE_BLOCK_TOKENS;
  }
  return CONTENT_BLOCK_OVERHEAD_TOKENS + estimateJsonPayloadTokenPressure(block, charsPerToken);
}

function estimateToolResultContentTokenPressure(content: unknown): number {
  if (typeof content === "string") {
    return estimateStringTokenPressure(content, TOOL_RESULT_CHARS_PER_TOKEN);
  }
  if (Array.isArray(content)) {
    return content.reduce(
      (sum, block) => sum + estimateContentBlockTokenPressure(block, TOOL_RESULT_CHARS_PER_TOKEN),
      0,
    );
  }
  if (content !== undefined) {
    return estimateJsonPayloadTokenPressure(content, TOOL_RESULT_CHARS_PER_TOKEN);
  }
  return 0;
}

function estimateAssistantToolCallTokenPressure(block: Record<string, unknown>): number {
  const args = block.arguments ?? block.input ?? block.args ?? {};
  return (
    CONTENT_BLOCK_OVERHEAD_TOKENS +
    estimateIdentifierTokenPressure(block.name, JSON_PAYLOAD_CHARS_PER_TOKEN) +
    estimateJsonPayloadTokenPressure(args, JSON_PAYLOAD_CHARS_PER_TOKEN)
  );
}

function estimateContentTokenPressure(content: unknown): number {
  if (typeof content === "string") {
    return estimateStringTokenPressure(content);
  }
  if (Array.isArray(content)) {
    return content.reduce((sum, block) => sum + estimateContentBlockTokenPressure(block), 0);
  }
  if (content !== undefined) {
    return estimateJsonPayloadTokenPressure(content);
  }
  return 0;
}

function isToolResultMessage(message: AgentMessage): boolean {
  const record = message as unknown as { role?: unknown; type?: unknown };
  return record.role === "toolResult" || record.role === "tool" || record.type === "toolResult";
}

function getToolResultTextLength(message: AgentMessage): number {
  const content = (message as unknown as { content?: unknown }).content;
  if (typeof content === "string") {
    return content.length;
  }
  if (!Array.isArray(content)) {
    return 0;
  }
  return content.reduce((sum, block) => {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      return sum + block.text.length;
    }
    return sum;
  }, 0);
}

function getMessageStableId(message: AgentMessage, index: number): string {
  const record = message as unknown as Record<string, unknown>;
  const value =
    record.id ?? record.toolCallId ?? record.tool_call_id ?? record.callId ?? record.toolUseId;
  return typeof value === "string" && value.trim() ? value.trim() : `message-${index}`;
}

function replaceToolResultTextWithPlaceholder(
  message: AgentMessage,
  placeholder: string,
): AgentMessage {
  const content = (message as unknown as { content?: unknown }).content;
  if (typeof content === "string") {
    return {
      ...(message as unknown as Record<string, unknown>),
      content: placeholder,
    } as AgentMessage;
  }
  if (!Array.isArray(content)) {
    return message;
  }
  let replaced = false;
  const nextContent = content.map((block) => {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
      return block;
    }
    if (replaced) {
      return { ...block, text: "" };
    }
    replaced = true;
    return { ...block, text: placeholder };
  });
  return {
    ...(message as unknown as Record<string, unknown>),
    content: nextContent,
  } as AgentMessage;
}

function formatObservationMaskPlaceholder(params: {
  itemId: string;
  archiveHandle: ArchiveHandle;
  originalChars: number;
}): string {
  return [
    "[Context observation masked]",
    `itemId: ${params.itemId}`,
    `archive: ${params.archiveHandle.uri}`,
    `checksum: ${params.archiveHandle.checksum}`,
    `originalChars: ${params.originalChars}`,
    "Recall through the read-only Context Family recall surface before relying on omitted details.",
  ].join("\n");
}

export async function buildObservationMaskingProjection(params: {
  enabled: boolean;
  messages: AgentMessage[];
  sessionId?: string;
  minChars?: number;
  preserveNewestObservationCount?: number;
  archiveRoot?: string;
}): Promise<ObservationMaskingProjectionResult> {
  if (!params.enabled) {
    return {
      messages: params.messages,
      maskedCount: 0,
      estimatedTokenReduction: 0,
      diagnostics: [],
      archiveHandles: [],
    };
  }
  const sessionId = params.sessionId?.trim();
  if (!sessionId) {
    return {
      messages: params.messages,
      maskedCount: 0,
      estimatedTokenReduction: 0,
      diagnostics: ["missing_session_id"],
      archiveHandles: [],
    };
  }
  const minChars = Math.max(1, Math.floor(params.minChars ?? 8_000));
  const preserveNewestObservationCount = Math.max(
    0,
    Math.floor(params.preserveNewestObservationCount ?? 1),
  );
  const candidates = params.messages
    .map((message, index) => ({
      message,
      index,
      textLength: getToolResultTextLength(message),
    }))
    .filter(
      (candidate) => isToolResultMessage(candidate.message) && candidate.textLength >= minChars,
    );
  const maskable = candidates.slice(
    0,
    Math.max(0, candidates.length - preserveNewestObservationCount),
  );
  if (maskable.length === 0) {
    return {
      messages: params.messages,
      maskedCount: 0,
      estimatedTokenReduction: 0,
      diagnostics: [],
      archiveHandles: [],
    };
  }

  const replacements = new Map<number, AgentMessage>();
  const diagnostics: string[] = [];
  const archiveHandles: ArchiveHandle[] = [];
  let estimatedTokenReduction = 0;

  for (const candidate of maskable) {
    const entryId = getMessageStableId(candidate.message, candidate.index);
    const itemId = createContextItemId(sessionId, "observation", entryId);
    const archiveHandle = await createContextArchiveHandleForPayload({
      sessionId,
      itemId,
      payload: (candidate.message as unknown as { content?: unknown }).content ?? candidate.message,
      archiveRoot: params.archiveRoot,
      source: {
        type: "transcript",
        sessionId,
        entryId,
      },
    });
    const verified = await verifyContextArchiveHandle(archiveHandle);
    if (!verified.ok) {
      diagnostics.push(`archive_${verified.reason}:${entryId}`);
      continue;
    }
    const placeholder = formatObservationMaskPlaceholder({
      itemId,
      archiveHandle,
      originalChars: candidate.textLength,
    });
    replacements.set(
      candidate.index,
      replaceToolResultTextWithPlaceholder(candidate.message, placeholder),
    );
    archiveHandles.push(archiveHandle);
    estimatedTokenReduction += Math.max(
      0,
      estimateToolResultContentTokenPressure(
        (candidate.message as unknown as { content?: unknown }).content,
      ) - estimateToolResultContentTokenPressure([{ type: "text", text: placeholder }]),
    );
  }

  if (replacements.size === 0) {
    return {
      messages: params.messages,
      maskedCount: 0,
      estimatedTokenReduction: 0,
      diagnostics,
      archiveHandles: [],
    };
  }

  return {
    messages: params.messages.map((message, index) => replacements.get(index) ?? message),
    maskedCount: replacements.size,
    estimatedTokenReduction,
    diagnostics,
    archiveHandles,
  };
}

export function buildContextFamilyPolicyPromotionMetrics(params: {
  behavior: "observation_masking_projection";
  baseline: PreemptiveCompactionDecision;
  promoted: PreemptiveCompactionDecision;
  projection: ObservationMaskingProjectionResult;
}): ContextFamilyPolicyPromotionMetrics {
  const baselinePromptTokens = Math.max(0, Math.ceil(params.baseline.estimatedPromptTokens));
  const projectedPromptTokens = Math.max(
    0,
    Math.ceil(
      params.promoted.observationMasking?.projectedPromptTokens ??
        params.baseline.estimatedPromptTokens - params.projection.estimatedTokenReduction,
    ),
  );
  const reductionTokens = Math.max(0, baselinePromptTokens - projectedPromptTokens);
  const failureModes = [...params.projection.diagnostics];
  const recallable =
    params.projection.maskedCount > 0 &&
    params.projection.archiveHandles.length >= params.projection.maskedCount &&
    failureModes.length === 0;
  return {
    behavior: params.behavior,
    rollbackFlag: "runtime.contextFamily.observationMasking.enabled=false",
    baselineRoute: params.baseline.route,
    promotedRoute: params.promoted.route,
    tokenReduction: {
      baselinePromptTokens,
      projectedPromptTokens,
      reductionTokens,
      reductionRatio:
        baselinePromptTokens > 0 ? Number((reductionTokens / baselinePromptTokens).toFixed(4)) : 0,
    },
    evidenceRetention: {
      archivedHandleCount: params.projection.archiveHandles.length,
      verifiedMaskedCount: params.projection.maskedCount,
    },
    recoveryFidelity: {
      recallable,
      diagnostics: failureModes,
    },
    failureModes,
  };
}

function estimateMessageTokenPressure(message: AgentMessage): number {
  const record = message as unknown as Record<string, unknown>;
  let tokens = MESSAGE_BOUNDARY_OVERHEAD_TOKENS;

  if (isToolResultMessage(message)) {
    tokens += estimateToolResultContentTokenPressure(record.content);
    tokens += estimateIdentifierTokenPressure(record.toolName ?? record.tool_name);
    return tokens;
  }

  if (record.role === "assistant") {
    const content = record.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (isRecord(block) && (block.type === "toolCall" || block.type === "tool_use")) {
          tokens += estimateAssistantToolCallTokenPressure(block);
        } else {
          tokens += estimateContentBlockTokenPressure(block);
        }
      }
    } else {
      tokens += estimateContentTokenPressure(content);
    }

    const toolCalls = record.toolCalls ?? record.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const toolCall of toolCalls) {
        tokens += isRecord(toolCall)
          ? estimateAssistantToolCallTokenPressure(toolCall)
          : estimateJsonPayloadTokenPressure(toolCall);
      }
    }
    return tokens;
  }

  tokens += estimateContentTokenPressure(record.content);
  return tokens;
}

/**
 * Estimates the prompt pressure at the LLM boundary from transcript messages,
 * optional system prompt, and current prompt text. The result intentionally
 * includes a safety margin because this path runs before provider tokenization.
 */
export function estimateLlmBoundaryTokenPressure(params: {
  messages: AgentMessage[];
  systemPrompt?: string;
  prompt: string;
}): number {
  const historyTokens = params.messages.reduce(
    (sum, message) => sum + estimateMessageTokenPressure(message),
    0,
  );
  const systemTokens =
    typeof params.systemPrompt === "string" && params.systemPrompt.trim().length > 0
      ? MESSAGE_BOUNDARY_OVERHEAD_TOKENS + estimateStringTokenPressure(params.systemPrompt)
      : 0;
  const promptTokens =
    MESSAGE_BOUNDARY_OVERHEAD_TOKENS + estimateStringTokenPressure(params.prompt);
  return Math.max(0, Math.ceil((historyTokens + systemTokens + promptTokens) * SAFETY_MARGIN));
}

/** Estimates only the rendered prompt/system portion when history has already been accounted for. */
export function estimateRenderedLlmBoundaryTokenPressure(params: {
  systemPrompt?: string;
  prompt: string;
}): number {
  const systemTokens =
    typeof params.systemPrompt === "string" && params.systemPrompt.trim().length > 0
      ? MESSAGE_BOUNDARY_OVERHEAD_TOKENS + estimateStringTokenPressure(params.systemPrompt)
      : 0;
  const promptTokens =
    MESSAGE_BOUNDARY_OVERHEAD_TOKENS + estimateStringTokenPressure(params.prompt);
  return Math.max(0, Math.ceil((systemTokens + promptTokens) * SAFETY_MARGIN));
}

/**
 * Backward-compatible alias for callers that still name this a pre-prompt estimate.
 *
 * @deprecated Use estimateLlmBoundaryTokenPressure.
 */
export function estimatePrePromptTokens(params: {
  messages: AgentMessage[];
  systemPrompt?: string;
  prompt: string;
}): number {
  return estimateLlmBoundaryTokenPressure(params);
}

function normalizeLlmBoundaryTokenPressure(
  pressure: LlmBoundaryTokenPressure | undefined,
): LlmBoundaryTokenPressure | undefined {
  if (!pressure || !Number.isFinite(pressure.estimatedPromptTokens)) {
    return undefined;
  }
  const estimatedPromptTokens = Math.max(0, Math.ceil(pressure.estimatedPromptTokens));
  return {
    estimatedPromptTokens,
    source: pressure.source.trim() || "rendered_llm_boundary",
    ...(typeof pressure.renderedChars === "number" && Number.isFinite(pressure.renderedChars)
      ? { renderedChars: Math.max(0, Math.ceil(pressure.renderedChars)) }
      : {}),
  };
}

/**
 * Decides whether a run should compact before submitting the prompt, and
 * whether reducible tool results can avoid or follow compaction. Rendered LLM
 * boundary pressure wins over local transcript estimates when supplied.
 */
export function shouldPreemptivelyCompactBeforePrompt(params: {
  messages: AgentMessage[];
  unwindowedMessages?: AgentMessage[];
  systemPrompt?: string;
  prompt: string;
  contextTokenBudget: number;
  reserveTokens: number;
  toolResultMaxChars?: number;
  llmBoundaryTokenPressure?: LlmBoundaryTokenPressure;
  observationMasking?: ObservationMaskingRouteInput;
}): PreemptiveCompactionDecision {
  let messagesForPressure = params.messages;
  const conversationMessages = params.unwindowedMessages ?? params.messages;
  const hasRealConversation = conversationMessages.some((message, index, messages) =>
    isRealConversationMessage(message, messages, index),
  );
  const llmBoundaryTokenPressure = normalizeLlmBoundaryTokenPressure(
    params.llmBoundaryTokenPressure,
  );
  let estimatedPromptTokens =
    llmBoundaryTokenPressure?.estimatedPromptTokens ??
    estimatePrePromptTokens({
      messages: params.messages,
      systemPrompt: params.systemPrompt,
      prompt: params.prompt,
    });
  let pressureSource = llmBoundaryTokenPressure?.source ?? "transcript_estimate";
  if (params.unwindowedMessages && params.unwindowedMessages !== params.messages) {
    const unwindowedEstimatedPromptTokens = estimatePrePromptTokens({
      messages: params.unwindowedMessages,
      systemPrompt: params.systemPrompt,
      prompt: params.prompt,
    });
    if (unwindowedEstimatedPromptTokens > estimatedPromptTokens) {
      estimatedPromptTokens = unwindowedEstimatedPromptTokens;
      messagesForPressure = params.unwindowedMessages;
      pressureSource = "unwindowed_transcript_estimate";
    }
  }
  const contextTokenBudget = Math.max(1, Math.floor(params.contextTokenBudget));
  const requestedReserveTokens = Math.max(0, Math.floor(params.reserveTokens));
  const minPromptBudget = Math.min(
    MIN_PROMPT_BUDGET_TOKENS,
    Math.max(1, Math.floor(contextTokenBudget * MIN_PROMPT_BUDGET_RATIO)),
  );
  // Keep a minimum prompt budget even when reserveTokens asks for most of the context window.
  const effectiveReserveTokens = Math.min(
    requestedReserveTokens,
    Math.max(0, contextTokenBudget - minPromptBudget),
  );
  const promptBudgetBeforeReserve = Math.max(1, contextTokenBudget - effectiveReserveTokens);
  const overflowTokens = Math.max(0, estimatedPromptTokens - promptBudgetBeforeReserve);
  const toolResultPotential = estimateToolResultReductionPotential({
    messages: messagesForPressure,
    contextWindowTokens: params.contextTokenBudget,
    maxCharsOverride: params.toolResultMaxChars,
  });
  const overflowChars = overflowTokens * ESTIMATED_CHARS_PER_TOKEN;
  const truncationBufferChars = TRUNCATION_ROUTE_BUFFER_TOKENS * ESTIMATED_CHARS_PER_TOKEN;
  const truncateOnlyThresholdChars = Math.max(
    overflowChars + truncationBufferChars,
    Math.ceil(overflowChars * 1.5),
  );
  const toolResultReducibleChars = toolResultPotential.maxReducibleChars;

  let route: PreemptiveCompactionRoute = "fits";
  let observationMaskingDecision: PreemptiveCompactionDecision["observationMasking"];
  // A bootstrap-only prompt cannot be compacted: the compaction boundary has
  // no real conversation to summarize. Let the provider enforce its own hard
  // limit once, instead of retrying the same empty transcript indefinitely.
  if (overflowTokens > 0 && hasRealConversation) {
    const masking = params.observationMasking;
    if (
      masking?.enabled &&
      masking.verifiedMaskedCount > 0 &&
      Number.isFinite(masking.projectedPromptTokens) &&
      Math.max(0, Math.ceil(masking.projectedPromptTokens)) <= promptBudgetBeforeReserve
    ) {
      route = "observation_masking";
      observationMaskingDecision = {
        verifiedMaskedCount: Math.max(0, Math.floor(masking.verifiedMaskedCount)),
        projectedPromptTokens: Math.max(0, Math.ceil(masking.projectedPromptTokens)),
        tokenReduction: Math.max(
          0,
          estimatedPromptTokens - Math.max(0, Math.ceil(masking.projectedPromptTokens)),
        ),
      };
      // Choose truncate-only only when available reduction comfortably exceeds the overflow.
    } else if (toolResultReducibleChars <= 0) {
      route = "compact_only";
    } else if (toolResultReducibleChars >= truncateOnlyThresholdChars) {
      route = "truncate_tool_results_only";
    } else {
      route = "compact_then_truncate";
    }
  }
  return {
    route,
    shouldCompact: route === "compact_only" || route === "compact_then_truncate",
    estimatedPromptTokens,
    pressureSource,
    promptBudgetBeforeReserve,
    overflowTokens,
    toolResultReducibleChars,
    effectiveReserveTokens,
    ...(observationMaskingDecision ? { observationMasking: observationMaskingDecision } : {}),
  };
}

/** Formats the compact operator log line for one pre-prompt budget check. */
export function formatPrePromptPrecheckLog(params: {
  result: PreemptiveCompactionDecision;
  sessionKey?: string;
  sessionId?: string;
  provider: string;
  modelId: string;
  messageCount: number;
  unwindowedMessageCount?: number;
  contextTokenBudget: number;
  reserveTokens: number;
  sessionFile?: string;
}): string {
  const { result } = params;
  return (
    `[context-overflow-precheck] pre-prompt check ` +
    `sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"} ` +
    `provider=${params.provider}/${params.modelId} ` +
    `route=${result.route} ` +
    `estimatedPromptTokens=${result.estimatedPromptTokens} ` +
    `pressureSource=${result.pressureSource ?? "unknown"} ` +
    `promptBudgetBeforeReserve=${result.promptBudgetBeforeReserve} ` +
    `overflowTokens=${result.overflowTokens} ` +
    `toolResultReducibleChars=${result.toolResultReducibleChars} ` +
    `reserveTokens=${params.reserveTokens} ` +
    `effectiveReserveTokens=${result.effectiveReserveTokens} ` +
    `contextTokenBudget=${params.contextTokenBudget} ` +
    `messages=${params.messageCount} ` +
    `unwindowedMessages=${params.unwindowedMessageCount ?? params.messageCount} ` +
    `sessionFile=${params.sessionFile}`
  );
}

/** Converts the pre-prompt decision into the persisted session context-budget status record. */
export function buildPrePromptContextBudgetStatus(params: {
  result: PreemptiveCompactionDecision;
  provider: string;
  modelId: string;
  messageCount: number;
  unwindowedMessageCount?: number;
  contextTokenBudget: number;
  reserveTokens: number;
  sessionId?: string;
  now?: number;
}): SessionContextBudgetStatus {
  const { result } = params;
  const remainingPromptBudgetTokens = Math.max(
    0,
    result.promptBudgetBeforeReserve - result.estimatedPromptTokens,
  );
  return {
    schemaVersion: 1,
    source: "pre-prompt-estimate",
    updatedAt: params.now ?? Date.now(),
    provider: params.provider,
    model: params.modelId,
    route: result.route,
    shouldCompact: result.shouldCompact,
    estimatedPromptTokens: result.estimatedPromptTokens,
    contextTokenBudget: Math.max(1, Math.floor(params.contextTokenBudget)),
    promptBudgetBeforeReserve: result.promptBudgetBeforeReserve,
    reserveTokens: Math.max(0, Math.floor(params.reserveTokens)),
    effectiveReserveTokens: result.effectiveReserveTokens,
    remainingPromptBudgetTokens,
    overflowTokens: result.overflowTokens,
    toolResultReducibleChars: result.toolResultReducibleChars,
    messageCount: Math.max(0, Math.floor(params.messageCount)),
    unwindowedMessageCount: Math.max(
      0,
      Math.floor(params.unwindowedMessageCount ?? params.messageCount),
    ),
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
  };
}

export function buildPreemptiveRouteLifecycleEvents(params: {
  result: PreemptiveCompactionDecision;
  sessionId?: string;
  provider: string;
  modelId: string;
  messageCount: number;
  unwindowedMessageCount?: number;
  contextTokenBudget: number;
  reserveTokens: number;
}): LifecycleEvent[] {
  const sessionId = params.sessionId?.trim();
  if (!sessionId) {
    return [];
  }
  return createTransformationLifecycleEvents({
    sessionId,
    itemId: createContextItemId(sessionId, "ledger", "preemptive-route"),
    to: "active",
    reason: "preemptive_route_decision",
    actor: "preemptive-compaction",
    source: {
      type: "other",
      sessionId,
      label: "pre-prompt-estimate",
    },
    metadata: {
      route: params.result.route,
      shouldCompact: params.result.shouldCompact,
      estimatedPromptTokens: params.result.estimatedPromptTokens,
      pressureSource: params.result.pressureSource,
      promptBudgetBeforeReserve: params.result.promptBudgetBeforeReserve,
      overflowTokens: params.result.overflowTokens,
      toolResultReducibleChars: params.result.toolResultReducibleChars,
      effectiveReserveTokens: params.result.effectiveReserveTokens,
      provider: params.provider,
      modelId: params.modelId,
      messageCount: Math.max(0, Math.floor(params.messageCount)),
      unwindowedMessageCount: Math.max(
        0,
        Math.floor(params.unwindowedMessageCount ?? params.messageCount),
      ),
      contextTokenBudget: Math.max(1, Math.floor(params.contextTokenBudget)),
      reserveTokens: Math.max(0, Math.floor(params.reserveTokens)),
    },
  });
}
