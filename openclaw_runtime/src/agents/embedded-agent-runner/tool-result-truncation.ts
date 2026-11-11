/**
 * Truncates oversized tool-result content in messages and transcripts.
 */
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { formatErrorMessage } from "../../infra/errors.js";
import type { TextContent } from "../../llm/types.js";
import { emitSessionTranscriptUpdate } from "../../sessions/transcript-events.js";
import {
  createContextArchiveHandleForPayloadSync,
  createContextItemId,
  createTransformationLifecycleEvents,
  recordContextFamilyLifecycleEvents,
} from "../../context-engine/registry/context-item-registry.js";
import type { ArchiveHandle, LifecycleEvent } from "../../../../shared/types/context-family.js";
import { normalizeArchiveHandle } from "../../../../shared/types/context-item.js";
import { resolveAgentContextLimits } from "../agent-scope.js";
import {
  getRetainedArchiveRecalls,
  type ArchiveRecallRetentionOptions,
} from "../archive-recall-retention.js";
import type { RuntimeIntensityPolicy } from "../intensity-policy.js";
import type { AgentMessage } from "../runtime/index.js";
import {
  acquireSessionWriteLock,
  type SessionWriteLockAcquireTimeoutConfig,
  resolveSessionWriteLockOptions,
} from "../session-write-lock.js";
import { SessionManager } from "../sessions/index.js";
import { formatContextLimitTruncationNotice } from "./context-truncation-notice.js";
import { log } from "./logger.js";
import {
  persistTranscriptStateMutation,
  readTranscriptFileState,
  type TranscriptFileState,
} from "./transcript-file-state.js";
import {
  rewriteTranscriptEntriesInSessionManager,
  rewriteTranscriptEntriesInState,
} from "./transcript-rewrite.js";

/**
 * Maximum share of the context window a single tool result should occupy.
 * This is intentionally conservative – a single tool result should not
 * consume more than 30% of the context window even without other messages.
 */
const MAX_TOOL_RESULT_CONTEXT_SHARE = 0.3;

/**
 * Low-context default cap for a single live tool result text block.
 *
 * The session runtime already truncates tool results aggressively when serializing old history
 * for compaction summaries. For the live request path we still keep a bounded
 * request-local ceiling so oversized tool output cannot dominate the next turn.
 */
export const DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS = 16_000;
export const LARGE_CONTEXT_MAX_LIVE_TOOL_RESULT_CHARS = 32_000;
export const XL_CONTEXT_MAX_LIVE_TOOL_RESULT_CHARS = 64_000;
const LARGE_CONTEXT_TOOL_RESULT_TOKENS = 100_000;
const XL_CONTEXT_TOOL_RESULT_TOKENS = 200_000;

/**
 * Minimum characters to keep when truncating.
 * We always keep at least the first portion so the model understands
 * what was in the content.
 */
const MIN_KEEP_CHARS = 2_000;
const RECOVERY_MIN_KEEP_CHARS = 0;

export type ToolResultTruncationOptions = {
  suffix?: string | ((truncatedChars: number) => string);
  minKeepChars?: number;
};
/** A bounded, model-visible pointer back to an archived tool result. */
export function buildArchiveRecallTruncationSuffix(params: {
  truncatedChars: number;
  archiveHandle?: Pick<ArchiveHandle, "uri" | "checksum" | "byteLength">;
}): string {
  const truncatedChars = Math.max(1, Math.floor(params.truncatedChars));
  const handle = params.archiveHandle;
  if (!handle?.uri || !handle.checksum || !Number.isFinite(handle.byteLength)) {
    return formatContextLimitTruncationNotice(truncatedChars);
  }
  return [
    "[... " + truncatedChars + " characters truncated; original output archived]",
    "archive_uri: " + handle.uri,
    "checksum: " + handle.checksum,
    "byte_length: " + handle.byteLength,
    "Recall with context_archive_recall using archive_uri, checksum, byte_length, offset and max_chars.",
  ].join("\n");
}

const DEFAULT_SUFFIX = (truncatedChars: number) =>
  formatContextLimitTruncationNotice(truncatedChars);
const COMPACT_RECOVERY_SUFFIX = (truncatedChars: number) =>
  `[... ${Math.max(1, Math.floor(truncatedChars))} chars truncated; narrow args]`;
export const MIN_TRUNCATED_TEXT_CHARS = MIN_KEEP_CHARS + DEFAULT_SUFFIX(1).length;

function resolveSuffixFactory(
  suffix: ToolResultTruncationOptions["suffix"],
): (truncatedChars: number) => string {
  if (typeof suffix === "function") {
    return suffix;
  }
  if (typeof suffix === "string") {
    return () => suffix;
  }
  return DEFAULT_SUFFIX;
}

function resolveEffectiveMinKeepChars(params: {
  maxChars: number;
  minKeepChars: number;
  suffixFactory: (truncatedChars: number) => string;
}): number {
  const suffixFloor = params.suffixFactory(1).length;
  return Math.max(0, Math.min(params.minKeepChars, Math.max(0, params.maxChars - suffixFloor)));
}

function appendBoundedTruncationSuffix(params: {
  keptText: string;
  originalTextLength: number;
  maxChars: number;
  suffixFactory: (truncatedChars: number) => string;
}): string {
  const build = (keptText: string) =>
    keptText + params.suffixFactory(Math.max(1, params.originalTextLength - keptText.length));

  let keptText = params.keptText;
  while (true) {
    const finalText = build(keptText);
    if (finalText.length <= params.maxChars) {
      return finalText;
    }
    if (keptText.length === 0) {
      return finalText.slice(0, params.maxChars);
    }
    const overflow = finalText.length - params.maxChars;
    const nextKeptText = keptText.slice(0, Math.max(0, keptText.length - overflow));
    keptText = nextKeptText.length < keptText.length ? nextKeptText : keptText.slice(0, -1);
  }
}

/**
 * Marker inserted between head and tail when using head+tail truncation.
 */
const MIDDLE_OMISSION_MARKER =
  "\n\n⚠️ [... middle content omitted — showing head and tail ...]\n\n";

/**
 * Detect whether text likely contains error/diagnostic content near the end,
 * which should be preserved during truncation.
 */
function hasImportantTail(text: string): boolean {
  // Check last ~2000 chars for error-like patterns
  const tail = normalizeLowercaseStringOrEmpty(text.slice(-2000));
  return (
    /\b(error|exception|failed|fatal|traceback|panic|stack trace|errno|exit code)\b/.test(tail) ||
    // JSON closing — if the output is JSON, the tail has closing structure
    /\}\s*$/.test(tail.trim()) ||
    // Summary/result lines often appear at the end
    /\b(total|summary|result|complete|finished|done)\b/.test(tail)
  );
}

/**
 * Truncate a single text string to fit within maxChars.
 *
 * Uses a head+tail strategy when the tail contains important content
 * (errors, results, JSON structure), otherwise preserves the beginning.
 * This ensures error messages and summaries at the end of tool output
 * aren't lost during truncation.
 */
export function truncateToolResultText(
  text: string,
  maxChars: number,
  options: ToolResultTruncationOptions = {},
): string {
  const suffixFactory = resolveSuffixFactory(options.suffix);
  const minKeepChars = resolveEffectiveMinKeepChars({
    maxChars,
    minKeepChars: options.minKeepChars ?? MIN_KEEP_CHARS,
    suffixFactory,
  });
  if (text.length <= maxChars) {
    return text;
  }
  const defaultSuffix = suffixFactory(Math.max(1, text.length - maxChars));
  const budget = Math.max(minKeepChars, maxChars - defaultSuffix.length);

  // If tail looks important, split budget between head and tail
  if (hasImportantTail(text) && budget > minKeepChars * 2) {
    const tailBudget = Math.min(Math.floor(budget * 0.3), 4_000);
    const headBudget = budget - tailBudget - MIDDLE_OMISSION_MARKER.length;

    if (headBudget > minKeepChars) {
      // Find clean cut points at newline boundaries
      let headCut = headBudget;
      const headNewline = text.lastIndexOf("\n", headBudget);
      if (headNewline > headBudget * 0.8) {
        headCut = headNewline;
      }

      let tailStart = text.length - tailBudget;
      const tailNewline = text.indexOf("\n", tailStart);
      if (tailNewline !== -1 && tailNewline < tailStart + tailBudget * 0.2) {
        tailStart = tailNewline + 1;
      }

      const keptText = text.slice(0, headCut) + MIDDLE_OMISSION_MARKER + text.slice(tailStart);
      return appendBoundedTruncationSuffix({
        keptText,
        originalTextLength: text.length,
        maxChars,
        suffixFactory,
      });
    }
  }

  // Default: keep the beginning
  let cutPoint = budget;
  const lastNewline = text.lastIndexOf("\n", budget);
  if (lastNewline > budget * 0.8) {
    cutPoint = lastNewline;
  }
  const keptText = text.slice(0, cutPoint);
  return appendBoundedTruncationSuffix({
    keptText,
    originalTextLength: text.length,
    maxChars,
    suffixFactory,
  });
}

/**
 * Calculate the maximum allowed characters for a single tool result
 * based on the model's context window tokens.
 *
 * Uses a rough 4 chars ≈ 1 token heuristic (conservative for English text;
 * actual ratio varies by tokenizer).
 */
export function calculateMaxToolResultChars(contextWindowTokens: number): number {
  return calculateMaxToolResultCharsWithCap(
    contextWindowTokens,
    resolveAutoLiveToolResultMaxChars(contextWindowTokens),
  );
}

export function resolveAutoLiveToolResultMaxChars(contextWindowTokens: number): number {
  if (!Number.isFinite(contextWindowTokens)) {
    return DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS;
  }
  const tokens = Math.floor(contextWindowTokens);
  if (tokens >= XL_CONTEXT_TOOL_RESULT_TOKENS) {
    return XL_CONTEXT_MAX_LIVE_TOOL_RESULT_CHARS;
  }
  if (tokens >= LARGE_CONTEXT_TOOL_RESULT_TOKENS) {
    return LARGE_CONTEXT_MAX_LIVE_TOOL_RESULT_CHARS;
  }
  return DEFAULT_MAX_LIVE_TOOL_RESULT_CHARS;
}

export function calculateMaxToolResultCharsWithCap(
  contextWindowTokens: number,
  hardCapChars: number,
  contextShare = MAX_TOOL_RESULT_CONTEXT_SHARE,
): number {
  const normalizedShare =
    typeof contextShare === "number" && Number.isFinite(contextShare) && contextShare > 0
      ? Math.min(contextShare, MAX_TOOL_RESULT_CONTEXT_SHARE)
      : MAX_TOOL_RESULT_CONTEXT_SHARE;
  const maxTokens = Math.floor(contextWindowTokens * normalizedShare);
  // Rough conversion: ~4 chars per token on average
  const maxChars = maxTokens * 4;
  return Math.min(maxChars, Math.max(1, hardCapChars));
}

export function resolveLiveToolResultMaxChars(params: {
  contextWindowTokens: number;
  cfg?: OpenClawConfig;
  agentId?: string | null;
  intensityPolicy?: RuntimeIntensityPolicy;
}): number {
  const configuredCap = resolveAgentContextLimits(params.cfg, params.agentId)?.toolResultMaxChars;
  const cap = configuredCap ?? resolveAutoLiveToolResultMaxChars(params.contextWindowTokens);
  const contextShare =
    params.intensityPolicy?.toolResults.mode === "tighten"
      ? params.intensityPolicy.toolResults.singleToolResultContextShare
      : undefined;
  return calculateMaxToolResultCharsWithCap(params.contextWindowTokens, cap, contextShare);
}

/**
 * Get the total character count of text content blocks in a tool result message.
 */
export function getToolResultTextLength(msg: AgentMessage): number {
  if (!msg || (msg as { role?: string }).role !== "toolResult") {
    return 0;
  }
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return 0;
  }
  let totalLength = 0;
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const text = (block as TextContent).text;
      if (typeof text === "string") {
        totalLength += text.length;
      }
    }
  }
  return totalLength;
}

/**
 * Truncate a tool result message's text content blocks to fit within maxChars.
 * Returns a new message (does not mutate the original).
 */
export function truncateToolResultMessage(
  msg: AgentMessage,
  maxChars: number,
  options: ToolResultTruncationOptions = {},
): AgentMessage {
  const suffixFactory = resolveSuffixFactory(options.suffix);
  const minKeepChars = resolveEffectiveMinKeepChars({
    maxChars,
    minKeepChars: options.minKeepChars ?? MIN_KEEP_CHARS,
    suffixFactory,
  });
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return msg;
  }

  // Calculate total text size
  const totalTextChars = getToolResultTextLength(msg);
  if (totalTextChars <= maxChars) {
    return msg;
  }

  // Distribute the budget proportionally among text blocks
  const newContent = content.map((block: unknown) => {
    if (!block || typeof block !== "object" || (block as { type?: string }).type !== "text") {
      return block; // Keep non-text blocks (images) as-is
    }
    const textBlock = block as TextContent;
    if (typeof textBlock.text !== "string") {
      return block;
    }
    // Proportional budget for this block
    const blockShare = textBlock.text.length / totalTextChars;
    const defaultSuffix = suffixFactory(
      Math.max(1, textBlock.text.length - Math.floor(maxChars * blockShare)),
    );
    const proportionalBudget = Math.floor(maxChars * blockShare);
    const blockBudget = Math.max(
      1,
      Math.min(maxChars, Math.max(minKeepChars + defaultSuffix.length, proportionalBudget)),
    );
    return Object.assign({}, textBlock, {
      text: truncateToolResultText(textBlock.text, blockBudget, {
        suffix: suffixFactory,
        minKeepChars,
      }),
    });
  });

  return { ...msg, content: newContent } as AgentMessage;
}

/**
 * Truncate oversized tool results in an array of messages (in-memory).
 * Returns a new array with truncated messages.
 *
 * This is used as a pre-emptive guard before sending messages to the LLM,
 * without modifying the session file.
 */
export function truncateOversizedToolResultsInMessages(
  messages: AgentMessage[],
  contextWindowTokens: number,
  maxCharsOverride?: number,
  aggregateMaxCharsOverride?: number,
  options: { sessionId?: string; archiveRecallRetention?: boolean } = {},
): { messages: AgentMessage[]; truncatedCount: number; auditEvents?: LifecycleEvent[] } {
  const maxChars = Math.max(
    1,
    maxCharsOverride ?? calculateMaxToolResultChars(contextWindowTokens),
  );
  const aggregateBudgetChars = calculateRecoveryAggregateToolResultChars(
    contextWindowTokens,
    maxChars,
    aggregateMaxCharsOverride,
  );
  const branch = messages.map((message, index) => ({
    id: `message-${index}`,
    type: "message",
    message,
  }));
  const plan = buildToolResultReplacementPlan({
    branch,
    maxChars,
    aggregateBudgetChars,
    minKeepChars: RECOVERY_MIN_KEEP_CHARS,
    sessionId: options.sessionId,
    archiveRecallRetention: {
      enabled: options.archiveRecallRetention,
      sessionId: options.sessionId,
    },
  });
  if (plan.replacements.length === 0) {
    return { messages, truncatedCount: 0 };
  }

  const replacementIds = new Set(plan.replacements.map((replacement) => replacement.entryId));
  const replacedBranch = applyToolResultReplacementsToBranch(branch, plan.replacements);
  const auditEvents = buildToolResultTruncationLifecycleEvents({
    sessionId: options.sessionId,
    replacements: plan.replacements,
    maxChars,
    aggregateBudgetChars,
  });
  recordContextFamilyLifecycleEvents(auditEvents);
  return {
    messages: replacedBranch.map((entry) => entry.message as AgentMessage),
    truncatedCount: replacementIds.size,
    auditEvents,
  };
}

function calculateRecoveryAggregateToolResultChars(
  contextWindowTokens: number,
  maxCharsOverride?: number,
  aggregateMaxCharsOverride?: number,
): number {
  return Math.max(
    1,
    aggregateMaxCharsOverride ??
      maxCharsOverride ??
      calculateMaxToolResultChars(contextWindowTokens),
  );
}

export type ToolResultReductionPotential = {
  maxChars: number;
  aggregateBudgetChars: number;
  toolResultCount: number;
  totalToolResultChars: number;
  oversizedCount: number;
  oversizedReducibleChars: number;
  aggregateReducibleChars: number;
  maxReducibleChars: number;
};

type ToolResultBranchEntry = {
  id: string;
  type: string;
  message?: AgentMessage;
};

type ToolResultReplacement = {
  entryId: string;
  message: AgentMessage;
  originalChars?: number;
  projectedChars?: number;
  replacementKind?: "oversized" | "aggregate";
  archiveHandle?: ArchiveHandle;
};

function archiveOriginalToolResultPayload(params: {
  sessionId?: string;
  entryId: string;
  message: AgentMessage;
}): ArchiveHandle | undefined {
  const sessionId = params.sessionId?.trim();
  if (!sessionId) {
    return undefined;
  }
  const existing = (params.message as { details?: { archiveHandle?: unknown } }).details?.archiveHandle;
  if (existing !== undefined) {
    try {
      const handle = normalizeArchiveHandle(existing);
      if (handle.source?.sessionId === sessionId) return handle;
    } catch {
      // Fall through to archiving the available message content.
    }
  }
  try {
    return createContextArchiveHandleForPayloadSync({
      sessionId,
      itemId: createContextItemId(sessionId, "observation", params.entryId),
      payload: (params.message as { content?: unknown }).content ?? params.message,
      source: {
        type: "transcript",
        sessionId,
        entryId: params.entryId,
      },
    });
  } catch (error) {
    log.warn("[tool-result-truncation] failed to archive original tool result", {
      sessionId,
      entryId: params.entryId,
      errorMessage: formatErrorMessage(error),
    });
    return undefined;
  }
}

function buildAggregateToolResultReplacements(params: {
  branch: ToolResultBranchEntry[];
  aggregateBudgetChars: number;
  minKeepChars?: number;
  sessionId?: string;
  retainedEntryIds?: ReadonlySet<string>;
}): ToolResultReplacement[] {
  const minKeepChars = params.minKeepChars ?? MIN_KEEP_CHARS;
  const candidates = params.branch
    .map((entry, index) => ({ entry, index }))
    .filter(
      (
        item,
      ): item is {
        entry: { id: string; type: string; message: AgentMessage };
        index: number;
      } =>
        item.entry.type === "message" &&
        Boolean(item.entry.message) &&
        (item.entry.message as { role?: string }).role === "toolResult",
    )
    .map((item) => ({
      index: item.index,
      entryId: item.entry.id,
      message: item.entry.message,
      textLength: getToolResultTextLength(item.entry.message),
    }))
    .filter((item) => item.textLength > 0);

  if (candidates.length < 2) {
    return [];
  }

  const suffixFactory =
    minKeepChars === RECOVERY_MIN_KEEP_CHARS &&
    params.aggregateBudgetChars < candidates.length * DEFAULT_SUFFIX(1).length
      ? COMPACT_RECOVERY_SUFFIX
      : DEFAULT_SUFFIX;
  const minTruncatedTextChars = minKeepChars + suffixFactory(1).length;

  const totalChars = candidates.reduce((sum, item) => sum + item.textLength, 0);
  if (totalChars <= params.aggregateBudgetChars) {
    return [];
  }

  let remainingReduction = totalChars - params.aggregateBudgetChars;
  const replacements: ToolResultReplacement[] = [];

  // Spend aggregate reduction on older entries first so fresh tool output stays intact.
  for (const candidate of candidates.toSorted((a, b) => {
    if (a.index !== b.index) {
      return a.index - b.index;
    }
    return b.textLength - a.textLength;
  })) {
    if (params.retainedEntryIds?.has(candidate.entryId)) {
      continue;
    }
    if (remainingReduction <= 0) {
      break;
    }
    const reducibleChars = Math.max(0, candidate.textLength - minTruncatedTextChars);
    if (reducibleChars <= 0) {
      continue;
    }

    const requestedReduction = Math.min(reducibleChars, remainingReduction);
    const targetChars = Math.max(minTruncatedTextChars, candidate.textLength - requestedReduction);
    const archiveHandle = archiveOriginalToolResultPayload({
      sessionId: params.sessionId,
      entryId: candidate.entryId,
      message: candidate.message,
    });
    const archiveSuffixFactory = archiveHandle
      ? (truncatedChars: number) => buildArchiveRecallTruncationSuffix({ truncatedChars, archiveHandle })
      : suffixFactory;
    const archiveSuffixFits = targetChars >= minKeepChars + archiveSuffixFactory(1).length;
    const truncatedMessage = truncateToolResultMessage(candidate.message, targetChars, {
      minKeepChars,
      suffix: archiveSuffixFits ? archiveSuffixFactory : suffixFactory,
    });
    const newLength = getToolResultTextLength(truncatedMessage);
    const actualReduction = Math.max(0, candidate.textLength - newLength);
    if (actualReduction <= 0) {
      continue;
    }

    replacements.push({
      entryId: candidate.entryId,
      message: truncatedMessage,
      originalChars: candidate.textLength,
      projectedChars: newLength,
      replacementKind: "aggregate",
      archiveHandle,
    });
    remainingReduction -= actualReduction;
  }

  return replacements;
}

function buildOversizedToolResultReplacements(params: {
  branch: ToolResultBranchEntry[];
  maxChars: number;
  minKeepChars?: number;
  sessionId?: string;
}): ToolResultReplacement[] {
  const minKeepChars = params.minKeepChars ?? MIN_KEEP_CHARS;
  const replacements: ToolResultReplacement[] = [];

  for (const entry of params.branch) {
    if (entry.type !== "message" || !entry.message) {
      continue;
    }
    const msg = entry.message;
    if ((msg as { role?: string }).role !== "toolResult") {
      continue;
    }
    if (getToolResultTextLength(msg) <= params.maxChars) {
      continue;
    }
    const archiveHandle = archiveOriginalToolResultPayload({
      sessionId: params.sessionId,
      entryId: entry.id,
      message: msg,
    });
    const suffix = archiveHandle
      ? (truncatedChars: number) => buildArchiveRecallTruncationSuffix({ truncatedChars, archiveHandle })
      : undefined;
    const truncatedMessage = truncateToolResultMessage(msg, params.maxChars, {
      minKeepChars,
      ...(suffix ? { suffix } : {}),
    });
    replacements.push({
      entryId: entry.id,
      message: truncatedMessage,
      originalChars: getToolResultTextLength(msg),
      projectedChars: getToolResultTextLength(truncatedMessage),
      replacementKind: "oversized",
      archiveHandle,
    });
  }

  return replacements;
}

function buildToolResultTruncationLifecycleEvents(params: {
  sessionId?: string;
  replacements: ToolResultReplacement[];
  maxChars: number;
  aggregateBudgetChars: number;
}): LifecycleEvent[] {
  const sessionId = params.sessionId?.trim();
  if (!sessionId) {
    return [];
  }
  return params.replacements.flatMap((replacement) =>
    createTransformationLifecycleEvents({
      sessionId,
      itemId: createContextItemId(sessionId, "observation", replacement.entryId),
      from: "active",
      to: "evicted",
      reason: "tool_result_truncation",
      actor: "tool-result-truncation",
      source: {
        type: "transcript",
        sessionId,
        entryId: replacement.entryId,
      },
      metadata: {
        originalChars: replacement.originalChars,
        projectedChars: replacement.projectedChars,
        truncatedChars:
          typeof replacement.originalChars === "number" &&
          typeof replacement.projectedChars === "number"
            ? Math.max(0, replacement.originalChars - replacement.projectedChars)
            : undefined,
        maxChars: params.maxChars,
        aggregateBudgetChars: params.aggregateBudgetChars,
        replacementKind: replacement.replacementKind,
        archiveHandle: replacement.archiveHandle,
      },
    }),
  );
}

function calculateReplacementReduction(
  branch: ToolResultBranchEntry[],
  replacements: ToolResultReplacement[],
): number {
  if (replacements.length === 0) {
    return 0;
  }
  const branchById = new Map(branch.map((entry) => [entry.id, entry]));
  let reduction = 0;

  for (const replacement of replacements) {
    const entry = branchById.get(replacement.entryId);
    if (!entry?.message) {
      continue;
    }
    reduction += Math.max(
      0,
      getToolResultTextLength(entry.message) - getToolResultTextLength(replacement.message),
    );
  }

  return reduction;
}

function applyToolResultReplacementsToBranch(
  branch: ToolResultBranchEntry[],
  replacements: ToolResultReplacement[],
): ToolResultBranchEntry[] {
  if (replacements.length === 0) {
    return branch;
  }
  const replacementsById = new Map(
    replacements.map((replacement) => [replacement.entryId, replacement]),
  );
  return branch.map((entry) => {
    const replacement = replacementsById.get(entry.id);
    if (!replacement || entry.type !== "message") {
      return entry;
    }
    return {
      ...entry,
      message: replacement.message,
    };
  });
}

function buildToolResultReplacementPlan(params: {
  branch: ToolResultBranchEntry[];
  maxChars: number;
  aggregateBudgetChars: number;
  minKeepChars?: number;
  sessionId?: string;
  archiveRecallRetention?: ArchiveRecallRetentionOptions;
}): {
  replacements: ToolResultReplacement[];
  oversizedReplacementCount: number;
  aggregateReplacementCount: number;
  oversizedReducibleChars: number;
  aggregateReducibleChars: number;
} {
  const minKeepChars = params.minKeepChars ?? MIN_KEEP_CHARS;
  const retained = getRetainedArchiveRecalls(
    params.branch.map((entry) => (entry.type === "message" ? entry.message : undefined)),
    {
      ...params.archiveRecallRetention,
      maxChars: Math.min(
        params.aggregateBudgetChars,
        params.archiveRecallRetention?.maxChars ?? params.aggregateBudgetChars,
      ),
      maxResultChars: Math.min(
        params.maxChars,
        params.archiveRecallRetention?.maxResultChars ?? params.maxChars,
      ),
    },
  );
  const retainedEntryIds = new Set(retained.map((item) => params.branch[item.index]!.id));
  const oversizedReplacements = buildOversizedToolResultReplacements({
    branch: params.branch,
    maxChars: params.maxChars,
    minKeepChars,
    sessionId: params.sessionId,
  });
  const oversizedReducibleChars = calculateReplacementReduction(
    params.branch,
    oversizedReplacements,
  );
  const oversizedTrimmedBranch = applyToolResultReplacementsToBranch(
    params.branch,
    oversizedReplacements,
  );
  const aggregateParams = {
    branch: oversizedTrimmedBranch,
    aggregateBudgetChars: params.aggregateBudgetChars,
    minKeepChars,
    sessionId: params.sessionId,
    retainedEntryIds,
  };
  let aggregateReplacements = buildAggregateToolResultReplacements(aggregateParams);
  const aggregateCharsBefore = oversizedTrimmedBranch.reduce(
    (sum, entry) => sum + (entry.message ? getToolResultTextLength(entry.message) : 0),
    0,
  );
  for (const recall of retained.toReversed()) {
    if (aggregateCharsBefore - calculateReplacementReduction(oversizedTrimmedBranch, aggregateReplacements)
      <= params.aggregateBudgetChars) {
      break;
    }
    // Use actual block/suffix sizes, releasing the oldest retained page only
    // when necessary. The final iteration is the unchanged legacy plan.
    retainedEntryIds.delete(params.branch[recall.index]!.id);
    aggregateReplacements = buildAggregateToolResultReplacements(aggregateParams);
  }
  const aggregateReducibleChars = calculateReplacementReduction(
    oversizedTrimmedBranch,
    aggregateReplacements,
  );

  return {
    replacements: [...oversizedReplacements, ...aggregateReplacements],
    oversizedReplacementCount: oversizedReplacements.length,
    aggregateReplacementCount: aggregateReplacements.length,
    oversizedReducibleChars,
    aggregateReducibleChars,
  };
}
export function estimateToolResultReductionPotential(params: {
  messages: AgentMessage[];
  contextWindowTokens: number;
  maxCharsOverride?: number;
  aggregateMaxCharsOverride?: number;
  archiveRecallRetention?: ArchiveRecallRetentionOptions;
}): ToolResultReductionPotential {
  const { messages, contextWindowTokens } = params;
  const maxChars = Math.max(
    1,
    params.maxCharsOverride ?? calculateMaxToolResultChars(contextWindowTokens),
  );
  const aggregateBudgetChars = calculateRecoveryAggregateToolResultChars(
    contextWindowTokens,
    maxChars,
    params.aggregateMaxCharsOverride,
  );
  const branch = messages.map((message, index) => ({
    id: `message-${index}`,
    type: "message",
    message,
  }));

  let toolResultCount = 0;
  let totalToolResultChars = 0;
  for (const msg of messages) {
    if ((msg as { role?: string }).role !== "toolResult") {
      continue;
    }
    const textLength = getToolResultTextLength(msg);
    if (textLength <= 0) {
      continue;
    }
    toolResultCount += 1;
    totalToolResultChars += textLength;
  }
  const plan = buildToolResultReplacementPlan({
    branch,
    maxChars,
    aggregateBudgetChars,
    minKeepChars: RECOVERY_MIN_KEEP_CHARS,
    archiveRecallRetention: params.archiveRecallRetention,
  });
  const maxReducibleChars = plan.oversizedReducibleChars + plan.aggregateReducibleChars;

  return {
    maxChars,
    aggregateBudgetChars,
    toolResultCount,
    totalToolResultChars,
    oversizedCount: plan.oversizedReplacementCount,
    oversizedReducibleChars: plan.oversizedReducibleChars,
    aggregateReducibleChars: plan.aggregateReducibleChars,
    maxReducibleChars,
  };
}

function truncateOversizedToolResultsInExistingSessionManager(params: {
  sessionManager: SessionManager;
  contextWindowTokens: number;
  maxCharsOverride?: number;
  aggregateMaxCharsOverride?: number;
  archiveRecallRetention?: boolean;
  sessionFile?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
}): {
  truncated: boolean;
  truncatedCount: number;
  reason?: string;
  auditEvents?: LifecycleEvent[];
} {
  const { sessionManager, contextWindowTokens } = params;
  const maxChars = Math.max(
    1,
    params.maxCharsOverride ?? calculateMaxToolResultChars(contextWindowTokens),
  );
  const aggregateBudgetChars = calculateRecoveryAggregateToolResultChars(
    contextWindowTokens,
    maxChars,
    params.aggregateMaxCharsOverride,
  );
  const branch = sessionManager.getBranch() as ToolResultBranchEntry[];

  if (branch.length === 0) {
    return { truncated: false, truncatedCount: 0, reason: "empty session" };
  }

  const plan = buildToolResultReplacementPlan({
    branch,
    maxChars,
    aggregateBudgetChars,
    minKeepChars: RECOVERY_MIN_KEEP_CHARS,
    sessionId: params.sessionId,
    archiveRecallRetention: { enabled: params.archiveRecallRetention, sessionId: params.sessionId },
  });
  if (plan.replacements.length === 0) {
    return {
      truncated: false,
      truncatedCount: 0,
      reason: "no oversized or aggregate tool results",
    };
  }
  const rewriteResult = rewriteTranscriptEntriesInSessionManager({
    sessionManager,
    replacements: plan.replacements,
  });
  if (rewriteResult.changed && params.sessionFile) {
    emitSessionTranscriptUpdate({
      sessionFile: params.sessionFile,
      sessionKey: params.sessionKey,
      ...(params.agentId ? { agentId: params.agentId } : {}),
    });
  }

  log.info(
    `[tool-result-truncation] Truncated ${rewriteResult.rewrittenEntries} tool result(s) in session ` +
      `(contextWindow=${contextWindowTokens} maxChars=${maxChars} aggregateBudgetChars=${aggregateBudgetChars} ` +
      `oversized=${plan.oversizedReplacementCount} aggregate=${plan.aggregateReplacementCount}) ` +
      `sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
  );

  const auditEvents = buildToolResultTruncationLifecycleEvents({
    sessionId: params.sessionId,
    replacements: plan.replacements,
    maxChars,
    aggregateBudgetChars,
  });
  recordContextFamilyLifecycleEvents(auditEvents);
  return {
    truncated: rewriteResult.changed,
    truncatedCount: rewriteResult.rewrittenEntries,
    reason: rewriteResult.reason,
    auditEvents,
  };
}

async function truncateOversizedToolResultsInTranscriptState(params: {
  state: TranscriptFileState;
  sessionFile: string;
  contextWindowTokens: number;
  maxCharsOverride?: number;
  aggregateMaxCharsOverride?: number;
  archiveRecallRetention?: boolean;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  config?: SessionWriteLockAcquireTimeoutConfig;
}): Promise<{
  truncated: boolean;
  truncatedCount: number;
  reason?: string;
  auditEvents?: LifecycleEvent[];
}> {
  const { state, contextWindowTokens } = params;
  const maxChars = Math.max(
    1,
    params.maxCharsOverride ?? calculateMaxToolResultChars(contextWindowTokens),
  );
  const aggregateBudgetChars = calculateRecoveryAggregateToolResultChars(
    contextWindowTokens,
    maxChars,
    params.aggregateMaxCharsOverride,
  );
  const branch = state.getBranch() as ToolResultBranchEntry[];

  if (branch.length === 0) {
    return { truncated: false, truncatedCount: 0, reason: "empty session" };
  }

  const plan = buildToolResultReplacementPlan({
    branch,
    maxChars,
    aggregateBudgetChars,
    minKeepChars: RECOVERY_MIN_KEEP_CHARS,
    sessionId: params.sessionId,
    archiveRecallRetention: { enabled: params.archiveRecallRetention, sessionId: params.sessionId },
  });
  if (plan.replacements.length === 0) {
    return {
      truncated: false,
      truncatedCount: 0,
      reason: "no oversized or aggregate tool results",
    };
  }
  const rewriteResult = rewriteTranscriptEntriesInState({
    state,
    replacements: plan.replacements,
  });
  if (rewriteResult.changed) {
    await persistTranscriptStateMutation({
      sessionFile: params.sessionFile,
      state,
      appendedEntries: rewriteResult.appendedEntries,
    });
    emitSessionTranscriptUpdate({
      sessionFile: params.sessionFile,
      sessionKey: params.sessionKey,
      ...(params.agentId ? { agentId: params.agentId } : {}),
    });
  }

  log.info(
    `[tool-result-truncation] Truncated ${rewriteResult.rewrittenEntries} tool result(s) in session ` +
      `(contextWindow=${contextWindowTokens} maxChars=${maxChars} aggregateBudgetChars=${aggregateBudgetChars} ` +
      `oversized=${plan.oversizedReplacementCount} aggregate=${plan.aggregateReplacementCount}) ` +
      `sessionKey=${params.sessionKey ?? params.sessionId ?? "unknown"}`,
  );

  const auditEvents = buildToolResultTruncationLifecycleEvents({
    sessionId: params.sessionId,
    replacements: plan.replacements,
    maxChars,
    aggregateBudgetChars,
  });
  recordContextFamilyLifecycleEvents(auditEvents);
  return {
    truncated: rewriteResult.changed,
    truncatedCount: rewriteResult.rewrittenEntries,
    reason: rewriteResult.reason,
    auditEvents,
  };
}

export function truncateOversizedToolResultsInSessionManager(params: {
  sessionManager: SessionManager;
  contextWindowTokens: number;
  maxCharsOverride?: number;
  aggregateMaxCharsOverride?: number;
  archiveRecallRetention?: boolean;
  sessionFile?: string;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
}): {
  truncated: boolean;
  truncatedCount: number;
  reason?: string;
  auditEvents?: LifecycleEvent[];
} {
  try {
    return truncateOversizedToolResultsInExistingSessionManager(params);
  } catch (err) {
    const errMsg = formatErrorMessage(err);
    log.warn(`[tool-result-truncation] Failed to truncate: ${errMsg}`);
    return { truncated: false, truncatedCount: 0, reason: errMsg };
  }
}

export async function truncateOversizedToolResultsInSession(params: {
  sessionFile: string;
  contextWindowTokens: number;
  maxCharsOverride?: number;
  aggregateMaxCharsOverride?: number;
  archiveRecallRetention?: boolean;
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
  config?: SessionWriteLockAcquireTimeoutConfig;
}): Promise<{
  truncated: boolean;
  truncatedCount: number;
  reason?: string;
  auditEvents?: LifecycleEvent[];
}> {
  const { sessionFile, contextWindowTokens } = params;
  let sessionLock: Awaited<ReturnType<typeof acquireSessionWriteLock>> | undefined;

  try {
    sessionLock = await acquireSessionWriteLock({
      sessionFile,
      ...resolveSessionWriteLockOptions(params.config),
    });
    const state = await readTranscriptFileState(sessionFile);
    return await truncateOversizedToolResultsInTranscriptState({
      state,
      contextWindowTokens,
      maxCharsOverride: params.maxCharsOverride,
      aggregateMaxCharsOverride: params.aggregateMaxCharsOverride,
      archiveRecallRetention: params.archiveRecallRetention,
      sessionFile,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
    });
  } catch (err) {
    const errMsg = formatErrorMessage(err);
    log.warn(`[tool-result-truncation] Failed to truncate: ${errMsg}`);
    return { truncated: false, truncatedCount: 0, reason: errMsg };
  } finally {
    await sessionLock?.release();
  }
}

/**
 * Check if a tool result message exceeds the size limit for a given context window.
 */
export function isOversizedToolResult(
  msg: AgentMessage,
  contextWindowTokens: number,
  maxCharsOverride?: number,
): boolean {
  if ((msg as { role?: string }).role !== "toolResult") {
    return false;
  }
  const maxChars = Math.max(
    1,
    maxCharsOverride ?? calculateMaxToolResultChars(contextWindowTokens),
  );
  return getToolResultTextLength(msg) > maxChars;
}

export function sessionLikelyHasOversizedToolResults(params: {
  messages: AgentMessage[];
  contextWindowTokens: number;
  maxCharsOverride?: number;
}): boolean {
  const estimate = estimateToolResultReductionPotential(params);
  return estimate.oversizedCount > 0 || estimate.aggregateReducibleChars > 0;
}
