// Agent Core module implements compaction behavior.
import type {
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
  StreamFn,
  Usage,
} from "../../../../llm-core/src/index.js";
import {
  type AgentCoreCompletionRuntimeDeps,
  resolveAgentCoreCompleteFn,
} from "../../runtime-deps.js";
import type { AgentMessage, ThinkingLevel } from "../../types.js";
import {
  asAgentMessage,
  convertToLlm,
  createBranchSummaryMessage,
  createCompactionSummaryMessage,
  createCustomMessage,
  type HarnessMessage,
} from "../messages.js";
import { buildSessionContext } from "../session/session.js";
import {
  type CompactionEntry,
  CompactionError,
  err,
  ok,
  type Result,
  type SessionTreeEntry,
} from "../types.js";
import {
  computeFileLists,
  createFileOps,
  extractFileOpsFromMessage,
  type FileOperations,
  formatFileOperations,
  serializeConversation,
} from "./utils.js";
import {
  buildCompactionBudgetShadow,
  planCompression,
  type CompactionBudgetShadow,
  type CompressionTelemetry,
  type TierSchedule,
  type TokenPruningAdapter,
} from "./compression-planner.js";
import {
  buildDeterministicCompressionArtifact,
  normalizeCompressionArtifact,
  type CompressionArtifact,
} from "./compression-artifact.js";
import {
  renderCompactionSummaryShape,
  type RequiredCompactionSection,
} from "./summary-contract.js";

/** File-operation details stored on generated compaction entries. */
export interface CompactionDetails {
  /** Files read in the compacted history. */
  readFiles: string[];
  /** Files modified in the compacted history. */
  modifiedFiles: string[];
  /** Tiered compression telemetry for recovery and acceptance gates. */
  compression?: CompressionTelemetry;
  /** Evidence-backed recovery artifact stored with the checkpoint. */
  artifact?: CompressionArtifact;
  /** P5 diagnostics-only budget shadow; never carried by the artifact. */
  budgetShadow?: CompactionBudgetShadow;
}
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return "[unserializable]";
  }
}

function extractFileOperations(
  messages: AgentMessage[],
  entries: SessionTreeEntry[],
  prevCompactionIndex: number,
): FileOperations {
  const fileOps = createFileOps();
  if (prevCompactionIndex >= 0) {
    const prevCompaction = entries[prevCompactionIndex] as CompactionEntry;
    if (!prevCompaction.fromHook && prevCompaction.details) {
      const details = prevCompaction.details as CompactionDetails;
      if (Array.isArray(details.readFiles)) {
        for (const f of details.readFiles) {
          fileOps.read.add(f);
        }
      }
      if (Array.isArray(details.modifiedFiles)) {
        for (const f of details.modifiedFiles) {
          fileOps.edited.add(f);
        }
      }
    }
  }
  for (const msg of messages) {
    extractFileOpsFromMessage(msg, fileOps);
  }

  return fileOps;
}
function getMessageFromEntry(entry: SessionTreeEntry): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message;
  }
  if (entry.type === "custom_message") {
    return asAgentMessage(
      createCustomMessage(
        entry.customType,
        entry.content,
        entry.display,
        entry.details,
        entry.timestamp,
      ),
    );
  }
  if (entry.type === "branch_summary") {
    return asAgentMessage(createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp));
  }
  if (entry.type === "compaction") {
    return asAgentMessage(
      createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp),
    );
  }
  return undefined;
}

function getMessageFromEntryForCompaction(entry: SessionTreeEntry): AgentMessage | undefined {
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    return undefined;
  }
  return getMessageFromEntry(entry);
}

/** Generated compaction data ready to be persisted as a compaction entry. */
export interface CompactionResult<T = unknown> {
  /** Summary text that replaces compacted history in future context. */
  summary: string;
  /** Entry id where retained history starts. */
  firstKeptEntryId: string;
  /** Estimated context tokens before compaction. */
  tokensBefore: number;
  /** Optional implementation-specific details stored with the compaction entry. */
  details?: T;
}

/** Compaction thresholds and retention settings. */
export interface CompactionSettings {
  /** Enable automatic compaction decisions. */
  enabled: boolean;
  /** Tokens reserved for summary prompt and output. */
  reserveTokens: number;
  /** Approximate recent-context tokens to keep after compaction. */
  keepRecentTokens: number;
  /** Optional effective model context window used for tier selection. */
  contextWindow?: number;
  /** P5 optional task-class schedule; absent keeps the production ladder. */
  tierSchedule?: TierSchedule;
  /**
   * #178: force the retained tail to begin at this transcript entry id instead
   * of the token-budget cut point. Used by located ("summarize up to / from
   * here") compaction, which summarizes a prefix and keeps the newer side
   * verbatim. It must be an entry of the compactable branch; callers fail
   * closed rather than silently falling back to the default cut.
   */
  keepFromEntryId?: string;
}

/** Default compaction settings used by the harness. */
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

/** Calculate total context tokens from provider usage. */
export function calculateContextTokens(usage: Usage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}
function getAssistantUsage(msg: AgentMessage): Usage | undefined {
  if (msg.role === "assistant" && "usage" in msg) {
    const assistantMsg = msg;
    if (
      assistantMsg.stopReason !== "aborted" &&
      assistantMsg.stopReason !== "error" &&
      assistantMsg.usage
    ) {
      return assistantMsg.usage;
    }
  }
  return undefined;
}

/** Return usage from the last successful assistant message in session entries. */
export function getLastAssistantUsage(entries: SessionTreeEntry[]): Usage | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "message") {
      const usage = getAssistantUsage(entry.message);
      if (usage) {
        return usage;
      }
    }
  }
  return undefined;
}

/** Estimated context-token usage for a message list. */
export interface ContextUsageEstimate {
  /** Estimated total context tokens. */
  tokens: number;
  /** Tokens reported by the most recent assistant usage block. */
  usageTokens: number;
  /** Estimated tokens after the most recent assistant usage block. */
  trailingTokens: number;
  /** Index of the message that provided usage, or null when none exists. */
  lastUsageIndex: number | null;
}

function getLastAssistantUsageInfo(
  messages: AgentMessage[],
): { usage: Usage; index: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const usage = getAssistantUsage(messages[i]);
    if (usage) {
      return { usage, index: i };
    }
  }
  return undefined;
}

/** Estimate context tokens for messages using provider usage when available. */
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  const usageInfo = getLastAssistantUsageInfo(messages);

  if (!usageInfo) {
    let estimated = 0;
    for (const message of messages) {
      estimated += estimateTokens(message);
    }
    return {
      tokens: estimated,
      usageTokens: 0,
      trailingTokens: estimated,
      lastUsageIndex: null,
    };
  }

  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let i = usageInfo.index + 1; i < messages.length; i++) {
    trailingTokens += estimateTokens(messages[i]);
  }

  return {
    tokens: usageTokens + trailingTokens,
    usageTokens,
    trailingTokens,
    lastUsageIndex: usageInfo.index,
  };
}

/** Return whether context usage exceeds the configured compaction threshold. */
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  if (!settings.enabled) {
    return false;
  }
  return contextTokens > contextWindow - settings.reserveTokens;
}

/** Estimate token count for one message using a conservative character heuristic. */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;
  const harnessMessage = message as HarnessMessage;

  switch (harnessMessage.role) {
    case "user": {
      const content = (
        harnessMessage as { content: string | Array<{ type: string; text?: string }> }
      ).content;
      if (typeof content === "string") {
        chars = content.length;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            chars += block.text.length;
          }
        }
      }
      return Math.ceil(chars / 4);
    }
    case "assistant": {
      const assistant = harnessMessage;
      for (const block of assistant.content) {
        if (block.type === "text") {
          chars += block.text.length;
        } else if (block.type === "thinking") {
          chars += block.thinking.length;
        } else if (block.type === "toolCall") {
          chars += block.name.length + safeJsonStringify(block.arguments).length;
        }
      }
      return Math.ceil(chars / 4);
    }
    case "custom":
    case "toolResult": {
      if (typeof harnessMessage.content === "string") {
        chars = harnessMessage.content.length;
      } else {
        for (const block of harnessMessage.content) {
          if (block.type === "text" && block.text) {
            chars += block.text.length;
          }
          if (block.type === "image") {
            chars += 4800;
          }
        }
      }
      return Math.ceil(chars / 4);
    }
    case "bashExecution": {
      chars = harnessMessage.command.length + harnessMessage.output.length;
      return Math.ceil(chars / 4);
    }
    case "branchSummary":
    case "compactionSummary": {
      chars = harnessMessage.summary.length;
      return Math.ceil(chars / 4);
    }
  }

  return 0;
}
function findValidCutPoints(
  entries: SessionTreeEntry[],
  startIndex: number,
  endIndex: number,
): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const entry = entries[i];
    switch (entry.type) {
      case "message": {
        const role = (entry.message as HarnessMessage).role;
        switch (role) {
          case "bashExecution":
          case "custom":
          case "branchSummary":
          case "compactionSummary":
          case "user":
          case "assistant":
            cutPoints.push(i);
            break;
          case "toolResult":
            break;
        }
        break;
      }
      case "thinking_level_change":
      case "model_change":
      case "compaction":
      case "branch_summary":
      case "custom":
      case "custom_message":
      case "label":
      case "session_info":
      case "leaf":
        break;
    }
    if (entry.type === "branch_summary" || entry.type === "custom_message") {
      cutPoints.push(i);
    }
  }
  return cutPoints;
}

/** Find the user-visible message that starts the turn containing an entry. */
export function findTurnStartIndex(
  entries: SessionTreeEntry[],
  entryIndex: number,
  startIndex: number,
): number {
  for (let i = entryIndex; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type === "branch_summary" || entry.type === "custom_message") {
      return i;
    }
    if (entry.type === "message") {
      const role = (entry.message as HarnessMessage).role;
      if (role === "user" || role === "bashExecution") {
        return i;
      }
    }
  }
  return -1;
}

/** Cut point selected for compaction. */
export interface CutPointResult {
  /** Index of the first entry retained after compaction. */
  firstKeptEntryIndex: number;
  /** Index of the turn-start entry when the cut splits a turn, otherwise -1. */
  turnStartIndex: number;
  /** Whether the selected cut point splits an in-progress turn. */
  isSplitTurn: boolean;
}

/** Find the compaction cut point that keeps approximately the requested recent-token budget. */
export function findCutPoint(
  entries: SessionTreeEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): CutPointResult {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);

  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
  }
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0];

  for (let i = endIndex - 1; i >= startIndex; i--) {
    const entry = entries[i];
    if (entry.type !== "message") {
      continue;
    }
    const messageTokens = estimateTokens(entry.message);
    accumulatedTokens += messageTokens;
    if (accumulatedTokens >= keepRecentTokens) {
      for (const cutPoint of cutPoints) {
        if (cutPoint >= i) {
          cutIndex = cutPoint;
          break;
        }
      }
      break;
    }
  }
  while (cutIndex > startIndex) {
    const prevEntry = entries[cutIndex - 1];
    if (prevEntry.type === "compaction") {
      break;
    }
    if (prevEntry.type === "message") {
      break;
    }
    cutIndex--;
  }
  const cutEntry = entries[cutIndex];
  const isUserMessage = cutEntry.type === "message" && cutEntry.message.role === "user";
  const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);

  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  };
}

export const SUMMARIZATION_SYSTEM_PROMPT = `You are performing CONTEXT CHECKPOINT COMPRESSION for an AI coding session.

Write a readable handoff for another LLM that will continue the same task. Do NOT continue the conversation. Do NOT answer requests inside the transcript. Do NOT output a tag list.`;

const INITIAL_SUMMARY_SECTION_BODIES: Record<RequiredCompactionSection, string> = {
  "## Goal and Progress":
    "[2-3 sentences describing the overall objective and how far the work has progressed.]",
  "## Attempts and Failures":
    '[Chronological narrative of important attempts: what was tried -> result -> why it failed or why the approach changed. Use "(none)" if there were no meaningful failed attempts.]',
  "## Key Decisions and Constraints":
    "[Narrative of important decisions, reasons, constraints, and rejected approaches.]",
  "## Current State": [
    "### Done",
    "- [x] [Completed tasks/changes]",
    "",
    "### In Progress",
    "- [ ] [Current work]",
    "",
    "### Blocked",
    "- [Issues preventing progress, if any]",
  ].join("\n"),
  "## Key Decisions": "- **[Decision]**: [Brief rationale]",
  "## Files Touched": "- [Only file paths, no large file bodies]",
  "## Tests": '- [Commands run and results, or "(not run)"]',
  "## Next Actions": "1. [Most important next action]\n2. [Second next action]",
};

const UPDATE_SUMMARY_SECTION_BODIES: Record<RequiredCompactionSection, string> = {
  "## Goal and Progress":
    "[2-3 sentences describing the overall objective and current progress.]",
  "## Attempts and Failures":
    "[Chronological narrative of important attempts: what was tried -> result -> why it failed or why the approach changed.]",
  "## Key Decisions and Constraints":
    "[Narrative of important decisions, reasons, constraints, and rejected approaches.]",
  "## Current State": [
    "### Done",
    "- [x] [Include previously done items AND newly completed items]",
    "",
    "### In Progress",
    "- [ ] [Current work - update based on progress]",
    "",
    "### Blocked",
    "- [Current blockers - remove if resolved]",
  ].join("\n"),
  "## Key Decisions": "- **[Decision]**: [Brief rationale] (preserve all previous, add new)",
  "## Files Touched": "- [Only file paths, no large file bodies]",
  "## Tests": '- [Commands run and results, or "(not run)"]',
  "## Next Actions": "1. [Update based on current state]\n2. [Second next action]",
};

export const INITIAL_COMPACTION_SUMMARY_SHAPE = renderCompactionSummaryShape(
  INITIAL_SUMMARY_SECTION_BODIES,
);
export const UPDATE_COMPACTION_SUMMARY_SHAPE = renderCompactionSummaryShape(
  UPDATE_SUMMARY_SECTION_BODIES,
);

const SUMMARIZATION_PROMPT = `The messages above are the live conversation being compressed. Create a readable context checkpoint handoff that another LLM can use to continue the work without rereading the full transcript.

Evidence-fidelity rules:
- Preserve every still-valid user objective, explicit deliverable, completed task, and current goal state. Never claim work is unfinished when the transcript shows it completed.
- Preserve exact file paths, function/method names, command lines, error messages, exit codes, test counts, identifiers, and verification evidence.
- For failures, preserve the chain: what was tried -> exact failure -> evidenced root cause -> adjustment/fallback -> validation -> next action. Do not speculate beyond the transcript.
- Do not state numeric repetition counts or attempt numbers unless you counted each occurrence in the transcript and the count is exact; when uncertain write "repeatedly".
- Report counts, permissions, cost/risk, and intent only when explicitly evidenced in the transcript; otherwise omit them.
- Keep user-required numbered lists and "already analyzed files" lists intact.
- Do not invent facts, rationale, permissions, or causal claims that are not in the transcript.

Use this EXACT Markdown shape:

${INITIAL_COMPACTION_SUMMARY_SHAPE}

Keep it concise but readable. Preserve exact file paths, function names, command names, error messages, blockers, and causal chains. Exclude superseded stale branches and do not repeat old summaries verbatim.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Use the previous summary only as background. Produce a fresh readable handoff that incorporates new information without copying stale or superseded text forward.

Rules:
- Preserve still-valid objectives, decisions, constraints, blockers, file paths, test results, and causal chains.
- Remove or mark obsolete branches as superseded instead of presenting them as current.
- Preserve every explicit user deliverable and completed work item, including verification evidence and final report content.
- For failures, preserve the chain: attempt -> exact failure -> evidenced root cause -> adjustment -> validation -> next action.
- Do not state numeric repetition counts or attempt numbers unless you counted each occurrence in the transcript and the count is exact; when uncertain write "repeatedly".
- Report counts, permissions, cost/risk, and intent only when explicitly evidenced in the transcript; otherwise omit them.
- Prefer narrative handoff text over label extraction.
- Keep exact file paths, function names, command names, and error messages.

Use this EXACT Markdown shape:

${UPDATE_COMPACTION_SUMMARY_SHAPE}

Keep each section concise.`;

function createSummarizationOptions(
  model: Model,
  maxTokens: number,
  apiKey: string | undefined,
  headers: Record<string, string> | undefined,
  signal: AbortSignal | undefined,
  thinkingLevel: ThinkingLevel | undefined,
): SimpleStreamOptions {
  const options: SimpleStreamOptions = { maxTokens, signal, apiKey, headers };
  if (model.reasoning && thinkingLevel && thinkingLevel !== "off") {
    options.reasoning = thinkingLevel;
  }
  return options;
}

async function completeSummarization(
  model: Model,
  context: Context,
  options: SimpleStreamOptions,
  streamFn?: StreamFn,
  runtime?: AgentCoreCompletionRuntimeDeps,
): Promise<AssistantMessage> {
  if (streamFn) {
    return (await streamFn(model, context, options)).result();
  }
  return await resolveAgentCoreCompleteFn(runtime)(model, context, options);
}

/** Generate or update a conversation summary for compaction. */
export async function generateSummary(
  currentMessages: AgentMessage[],
  model: Model,
  reserveTokens: number,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  customInstructions?: string,
  previousSummary?: string,
  thinkingLevel?: ThinkingLevel,
  streamFn?: StreamFn,
  runtime?: AgentCoreCompletionRuntimeDeps,
): Promise<Result<string, CompactionError>> {
  const maxTokens = Math.min(
    Math.floor(0.8 * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  );
  let basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }
  const llmMessages = convertToLlm(currentMessages);
  const conversationText = serializeConversation(llmMessages);
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;

  const summarizationMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const response = await completeSummarization(
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    createSummarizationOptions(model, maxTokens, apiKey, headers, signal, thinkingLevel),
    streamFn,
    runtime,
  );
  if (response.stopReason === "aborted") {
    return err(new CompactionError("aborted", response.errorMessage || "Summarization aborted"));
  }
  if (response.stopReason === "error") {
    return err(
      new CompactionError(
        "summarization_failed",
        `Summarization failed: ${response.errorMessage || "Unknown error"}`,
      ),
    );
  }

  const textContent = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return ok(textContent);
}

/** Prepared inputs for a compaction run. */
export interface CompactionPreparation {
  /** Entry id where retained history starts. */
  firstKeptEntryId: string;
  /** Messages summarized into the history summary. */
  messagesToSummarize: AgentMessage[];
  /** Prefix messages summarized separately when compaction splits a turn. */
  turnPrefixMessages: AgentMessage[];
  /** Whether compaction splits a turn. */
  isSplitTurn: boolean;
  /** Estimated context tokens before compaction. */
  tokensBefore: number;
  /** Previous compaction summary used for iterative updates. */
  previousSummary?: string;
  /** Normalized artifact from the previous compaction, used for atom lineage. */
  previousArtifact?: CompressionArtifact;
  /** File operations extracted from summarized history. */
  fileOps: FileOperations;
  /** Settings used to prepare compaction. */
  settings: CompactionSettings;
  /** Branch summaries excluded as stale/superseded context. */
  staleExcludedCount: number;
}

/** Prepare session entries for compaction, or return undefined when compaction is not applicable. */
export function prepareCompaction(
  pathEntries: SessionTreeEntry[],
  settings: CompactionSettings,
): Result<CompactionPreparation | undefined, CompactionError> {
  if (pathEntries.length === 0 || pathEntries[pathEntries.length - 1].type === "compaction") {
    return ok(undefined);
  }

  let prevCompactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i].type === "compaction") {
      prevCompactionIndex = i;
      break;
    }
  }

  let previousSummary: string | undefined;
  let previousArtifact: CompressionArtifact | undefined;
  let boundaryStart = 0;
  if (prevCompactionIndex >= 0) {
    const prevCompaction = pathEntries[prevCompactionIndex] as CompactionEntry;
    previousSummary = prevCompaction.summary;
    if (prevCompaction.details) {
      const details = prevCompaction.details as CompactionDetails;
      previousArtifact = details.artifact
        ? normalizeCompressionArtifact(details.artifact)
        : undefined;
    }
    const firstKeptEntryIndex = pathEntries.findIndex(
      (entry) => entry.id === prevCompaction.firstKeptEntryId,
    );
    boundaryStart = firstKeptEntryIndex >= 0 ? firstKeptEntryIndex : prevCompactionIndex + 1;
  }
  const boundaryEnd = pathEntries.length;

  const tokensBefore = estimateContextTokens(buildSessionContext(pathEntries).messages).tokens;

  // #178: a located compaction pins the retained tail explicitly. The id must
  // be a real cut point on the compactable branch - otherwise fail closed
  // instead of silently summarizing a different range.
  let cutPoint: CutPointResult;
  if (settings.keepFromEntryId) {
    const keepIndex = pathEntries.findIndex(
      (entry) => entry.id === settings.keepFromEntryId,
    );
    if (keepIndex < 0) {
      return err(
        new CompactionError(
          "invalid_session",
          `keepFromEntryId ${settings.keepFromEntryId} is not on the session branch`,
        ),
      );
    }
    if (keepIndex < boundaryStart || keepIndex >= boundaryEnd) {
      return err(
        new CompactionError(
          "invalid_session",
          `keepFromEntryId ${settings.keepFromEntryId} is outside the compactable range`,
        ),
      );
    }
    if (!findValidCutPoints(pathEntries, boundaryStart, boundaryEnd).includes(keepIndex)) {
      return err(
        new CompactionError(
          "invalid_session",
          `keepFromEntryId ${settings.keepFromEntryId} is not a valid compaction cut point`,
        ),
      );
    }
    cutPoint = { firstKeptEntryIndex: keepIndex, turnStartIndex: -1, isSplitTurn: false };
  } else {
    cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens);
  }
  const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry?.id) {
    return err(
      new CompactionError(
        "invalid_session",
        "First kept entry has no UUID - session may need migration",
      ),
    );
  }
  const firstKeptEntryId = firstKeptEntry.id;

  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
  const messagesToSummarize: AgentMessage[] = [];
  let staleExcludedCount = 0;
  for (let i = boundaryStart; i < historyEnd; i++) {
    if (pathEntries[i].type === "branch_summary") {
      staleExcludedCount += 1;
    }
    const msg = getMessageFromEntryForCompaction(pathEntries[i]);
    if (msg) {
      messagesToSummarize.push(msg);
    }
  }
  const turnPrefixMessages: AgentMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i++) {
      if (pathEntries[i].type === "branch_summary") {
        staleExcludedCount += 1;
      }
      const msg = getMessageFromEntryForCompaction(pathEntries[i]);
      if (msg) {
        turnPrefixMessages.push(msg);
      }
    }
  }
  const fileOps = extractFileOperations(messagesToSummarize, pathEntries, prevCompactionIndex);
  if (cutPoint.isSplitTurn) {
    for (const msg of turnPrefixMessages) {
      extractFileOpsFromMessage(msg, fileOps);
    }
  }

  return ok({
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary,
    previousArtifact,
    fileOps,
    settings,
    staleExcludedCount,
  });
}

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn? Preserve the exact request and every explicit deliverable.]

## Early Progress
- [Key decisions, completed changes, and verification evidence done in the prefix. Preserve exact paths, commands, errors, exit codes, and test counts.]

## Context for Suffix
- [Information needed to understand the retained recent work, including any pending final report content the suffix must deliver.]

Evidence-fidelity rules:
- Do not add facts, rationale, permissions, cost/risk, or numeric repetition/attempt counts that are not explicitly counted in the prefix transcript; when uncertain write "repeatedly".
- Preserve the exact root cause, before/after code change, and verification evidence when present.
- Mark unverified work as unverified; never present an in-progress item as complete.

Be concise. Focus on what's needed to understand the kept suffix.`;

export { serializeConversation } from "./utils.js";

/** Generate compaction summary data from prepared session history. */
export async function compact(
  preparation: CompactionPreparation,
  model: Model,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  customInstructions?: string,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel,
  streamFn?: StreamFn,
  runtime?: AgentCoreCompletionRuntimeDeps,
  tokenPruningAdapter?: TokenPruningAdapter,
): Promise<Result<CompactionResult, CompactionError>> {
  const {
    firstKeptEntryId,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn,
    tokensBefore,
    previousSummary,
    previousArtifact,
    fileOps,
    settings,
    staleExcludedCount,
  } = preparation;

  if (!firstKeptEntryId) {
    return err(
      new CompactionError(
        "invalid_session",
        "First kept entry has no UUID - session may need migration",
      ),
    );
  }

  const { readFiles, modifiedFiles } = computeFileLists(fileOps);
  const plannedHistory = planCompression({
    tokensBefore,
    settings,
    messages: messagesToSummarize,
    staleExcludedCount,
    readFiles,
    modifiedFiles,
    tokenPruningAdapter,
    ...(settings.tierSchedule ? { tierSchedule: settings.tierSchedule } : {}),
  });
  const plannedTurnPrefix = planCompression({
    tokensBefore,
    settings,
    messages: turnPrefixMessages,
    staleExcludedCount: 0,
    readFiles,
    modifiedFiles,
    tokenPruningAdapter,
    ...(settings.tierSchedule ? { tierSchedule: settings.tierSchedule } : {}),
  });
  const budgetShadow = buildCompactionBudgetShadow({
    schedule: settings.tierSchedule,
    settings,
    tokensBefore,
    actualTier: plannedHistory.plan.tier,
  });

  let summary: string;

  if (isSplitTurn && turnPrefixMessages.length > 0) {
    const [historyResult, turnPrefixResult] = await Promise.all([
      plannedHistory.messages.length > 0
        ? generateSummary(
            plannedHistory.messages,
            model,
            settings.reserveTokens,
            apiKey,
            headers,
            signal,
            customInstructions,
            previousSummary,
            thinkingLevel,
            streamFn,
            runtime,
          )
        : Promise.resolve(ok<string, CompactionError>("No prior history.")),
      generateTurnPrefixSummary(
        plannedTurnPrefix.messages,
        model,
        settings.reserveTokens,
        apiKey,
        headers,
        signal,
        thinkingLevel,
        streamFn,
        runtime,
        customInstructions,
      ),
    ]);
    if (!historyResult.ok) {
      return err(historyResult.error);
    }
    if (!turnPrefixResult.ok) {
      return err(turnPrefixResult.error);
    }
    summary = `${historyResult.value}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult.value}`;
  } else {
    const summaryResult = await generateSummary(
      plannedHistory.messages,
      model,
      settings.reserveTokens,
      apiKey,
      headers,
      signal,
      customInstructions,
      previousSummary,
      thinkingLevel,
      streamFn,
      runtime,
    );
    if (!summaryResult.ok) {
      return err(summaryResult.error);
    }
    summary = summaryResult.value;
  }

  summary += formatFileOperations(readFiles, modifiedFiles);
  const artifact = buildDeterministicCompressionArtifact({
    messages: isSplitTurn
      ? [...plannedHistory.messages, ...plannedTurnPrefix.messages]
      : plannedHistory.messages,
    previousSummary,
    previousArtifact,
    summary,
    readFiles,
    modifiedFiles,
    telemetry: plannedHistory.telemetry,
  });

  return ok({
    summary,
    firstKeptEntryId,
    tokensBefore,
    details: {
      readFiles,
      modifiedFiles,
      compression: plannedHistory.telemetry,
      artifact,
      ...(budgetShadow ? { budgetShadow } : {}),
    } as CompactionDetails,
  });
}
async function generateTurnPrefixSummary(
  messages: AgentMessage[],
  model: Model,
  reserveTokens: number,
  apiKey: string | undefined,
  headers?: Record<string, string>,
  signal?: AbortSignal,
  thinkingLevel?: ThinkingLevel,
  streamFn?: StreamFn,
  runtime?: AgentCoreCompletionRuntimeDeps,
  customInstructions?: string,
): Promise<Result<string, CompactionError>> {
  const maxTokens = Math.min(
    Math.floor(0.5 * reserveTokens),
    model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY,
  );
  const llmMessages = convertToLlm(messages);
  const conversationText = serializeConversation(llmMessages);
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_SUMMARIZATION_PROMPT}${
    customInstructions ? `\n\nAdditional focus: ${customInstructions}` : ""
  }`;
  const summarizationMessages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: promptText }],
      timestamp: Date.now(),
    },
  ];

  const response = await completeSummarization(
    model,
    { systemPrompt: SUMMARIZATION_SYSTEM_PROMPT, messages: summarizationMessages },
    createSummarizationOptions(model, maxTokens, apiKey, headers, signal, thinkingLevel),
    streamFn,
    runtime,
  );
  if (response.stopReason === "aborted") {
    return err(
      new CompactionError("aborted", response.errorMessage || "Turn prefix summarization aborted"),
    );
  }
  if (response.stopReason === "error") {
    return err(
      new CompactionError(
        "summarization_failed",
        `Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`,
      ),
    );
  }

  return ok(
    response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n"),
  );
}
