/**
 * message-render-projection.ts — the single source of truth for "what does this
 * message still contribute to the transcript?"
 *
 * ## Why this file exists
 *
 * Two places decide whether a message is worth rendering, and they used to
 * decide it independently:
 *
 *   1. `Chat/index.tsx` computes `row.hidden` and, when true, returns `null`
 *      BEFORE `<ChatMessage>` is ever mounted.
 *   2. `ChatMessage` computes its own early-return over the content it derived.
 *
 * (1) fired first and was coarser: any assistant message inside a run segment
 * that carried a `tool_use` block was dropped whole — either because it was
 * tool-only, or because its narration text had been folded into the execution
 * graph. `ChatMessage` meanwhile carried a comment promising that Tool UI cards
 * "must survive inside a run segment" and deliberately routed them around
 * `suppressToolCards`. Both were sincere; they simply never met. The result was
 * that all 24 Tool UI card types were unreachable whenever the model emitted
 * them as tool calls rather than as ```tool-ui fences in its final reply — most
 * damagingly `question-flow`, which left a run blocked on a question the user
 * could not see.
 *
 * This module collapses the two into one projection. `index.tsx` may only hide
 * a row when `hasRenderableContent` is false, and `ChatMessage` renders from
 * the same object — so the two can no longer disagree.
 *
 * This mirrors the pattern `run-surface-promotion.ts` already uses to keep the
 * execution graph and the rich cards from rendering the same runtime event
 * twice: name one owner, make both sides read it.
 *
 * ## Deliberate over-approximation
 *
 * `candidateAttachments` is the PRE-validation attachment list. `ChatMessage`
 * additionally stats regex-derived paths through the main process and drops the
 * ones that do not exist, which is async and therefore cannot live in a pure
 * projection. Counting an attachment that later disappears keeps a row alive
 * that renders nothing — visually inert. The opposite error dropped live cards,
 * which is what this file exists to prevent.
 */
import { DIRECTORY_MIME_TYPE } from '@/components/assistant-ui/attachment';
import { createChatContentCache } from '@/stores/chat/content-cache';
import {
  parseToolUiContent,
  parseToolUiInteraction,
  parseToolUiToolUses,
  type ToolUiInteraction,
} from '@/components/tool-ui/agent-interactions';
import {
  extractAssistantReasoning,
  type AssistantReasoning,
} from '@/components/assistant-render/model';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';
import type { ChatKnowledgeReference } from '@shared/host-api/contract';
import {
  extractRelativeArtifactPaths,
  mediaKindOf,
  mediaResourceKey,
  projectContentBlockResources,
  type ConversationResource,
} from './conversation-resources';
import { extractImages, extractText, extractToolUse, isUnresolvableImageUrl } from './message-utils';
import { isPlanToolName, MESSAGE_CARD_EXCLUDED_TOOL_UI_TYPES } from './run-surface-promotion';

export type ExtractedImage = { url?: string; data?: string; mimeType: string };

export type MessageToolUse = { id: string; name: string; input: unknown };

export type MessageRenderFlags = {
  isUser: boolean;
  /** Text was folded into the execution graph as narration — hide the bubble. */
  suppressAssistantText: boolean;
  /** Message belongs to a run segment — hide the flat tool list. */
  suppressToolCards: boolean;
  /**
   * The turn's process disclosure adopted this message's reasoning, so the
   * message must not render it a second time.
   *
   * This is a PROJECTION flag rather than a render-time skip on purpose: a reply
   * that carried nothing but `thinking` blocks contributes nothing once its
   * reasoning moves into the card, and `hasRenderableContent` has to see that or
   * the row survives as an empty gap between the folded process and the answer.
   */
  suppressReasoning?: boolean;
  textOverride?: string;
};

export type MessageRenderProjection = {
  /** Reply text with any ```tool-ui fences stripped out. */
  displayText: string;
  hasText: boolean;
  reasoning: AssistantReasoning[];
  toolUiInteractions: ToolUiInteraction[];
  visibleTools: MessageToolUse[];
  contentImages: ExtractedImage[];
  candidateAttachments: AttachedFileMeta[];
  /** Images needing the resolver, website links, and unrecognized structured resources. */
  resources: ConversationResource[];
  knowledgeRefs: ChatKnowledgeReference[];
  /**
   * The authority for row visibility. `index.tsx` may only drop a row when this
   * is false; `ChatMessage` returns null on the same condition.
   */
  hasRenderableContent: boolean;
};

/** Resolve an ExtractedImage to a displayable src string, or null if not possible. */
export function imageSrc(img: ExtractedImage): string | null {
  if (img.url) return isUnresolvableImageUrl(img.url) ? null : img.url;
  if (img.data) return `data:${img.mimeType};base64,${img.data}`;
  return null;
}

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || 'file';
}

export function previewMimeFromPath(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return null;
}

function trimPathTerminators(filePath: string): string {
  return filePath.replace(/[，。；;,.!?]+$/u, '');
}

/**
 * Render-layer fallback that keeps user-facing artifacts clickable before
 * history enrichment runs. Deliberately narrow: HTML / Markdown / PDF /
 * spreadsheet previews and OpenClaw skill directories only. The store-level
 * extractor still handles the broad file categories.
 */
export function extractPreviewDocumentPaths(text: string): AttachedFileMeta[] {
  if (!text) return [];
  const refs: AttachedFileMeta[] = [];
  const seen = new Set<string>();
  const pushRef = (filePath: string, mimeType: string) => {
    const normalizedPath = trimPathTerminators(filePath);
    if (!normalizedPath || seen.has(normalizedPath)) return;
    seen.add(normalizedPath);
    refs.push({
      fileName: fileNameFromPath(normalizedPath),
      mimeType,
      fileSize: 0,
      preview: null,
      filePath: normalizedPath,
      source: 'message-ref',
    });
  };

  const exts = 'html?|md|markdown|pdf|xlsx?|HTML?|MD|MARKDOWN|PDF|XLSX?';
  const taggedRegex = new RegExp(`(?:^|[\\s(\\[{>])(?:MEDIA|media):((?:\\/|~\\/)[^\\s\\n"'()\\[\\],<>]*?\\.(?:${exts}))`, 'g');
  const unixRegex = new RegExp('(?<![\\w./:])((?:\\/|~\\/)[^\\s\\n"\'`()\\[\\],<>]*?\\.(?:' + exts + '))', 'g');
  const skillPathBoundary = '(?=$|\\s|[\\x5b\\x5d"\'`(),<>，。；;,.!?])';
  const skillPathPart = '[^\\\\/\\s\\n"\'`()\\x5b\\x5d,<>]+';
  const skillPathTail = '[^\\s\\n"\'`()\\x5b\\x5d,<>]*?';
  const skillDirRegex = new RegExp(
    `(?<![\\w./:])((?:~[\\\\/]\\.openclaw[\\\\/]skills[\\\\/]${skillPathPart})|(?:(?:\\/|[A-Za-z]:\\\\)${skillPathTail}[\\\\/]\\.openclaw[\\\\/]skills[\\\\/]${skillPathPart}))${skillPathBoundary}`,
    'gi',
  );
  const skillMarkdownRegex = new RegExp(
    `(?<![\\w./:])((?:~[\\\\/]\\.openclaw[\\\\/]skills[\\\\/]${skillPathTail}\\.md)|(?:(?:\\/|[A-Za-z]:\\\\)${skillPathTail}[\\\\/]\\.openclaw[\\\\/]skills[\\\\/]${skillPathTail}\\.md))${skillPathBoundary}`,
    'gi',
  );

  let workingText = text;
  let taggedMatch: RegExpExecArray | null;
  while ((taggedMatch = taggedRegex.exec(text)) !== null) {
    const filePath = taggedMatch[1];
    const mimeType = previewMimeFromPath(filePath);
    if (mimeType) pushRef(filePath, mimeType);
    const start = taggedMatch.index;
    const end = start + taggedMatch[0].length;
    workingText = workingText.slice(0, start) + ' '.repeat(end - start) + workingText.slice(end);
  }

  for (const regex of [unixRegex, skillMarkdownRegex, skillDirRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(workingText)) !== null) {
      const filePath = match[1];
      const mimeType = regex === skillDirRegex ? DIRECTORY_MIME_TYPE : previewMimeFromPath(filePath);
      if (mimeType) pushRef(filePath, mimeType);
    }
  }

  return refs;
}

/**
 * Tool calls that must NOT become a card on the message itself, because some
 * other surface is already their single owner:
 *
 *   - plan tools     → the turn summary's `ToolUiPlanView`, fed by
 *                      `promoteRunSurfaces` (run-surface-promotion.ts).
 *   - approval cards → `PendingRunApprovals`, fed by the authoritative host
 *                      approval store (use-run-approvals.ts). A model-authored
 *                      ```tool-ui approval fence is still rendered — that is
 *                      narration, not a permission gate.
 */
function isMessageCardTool(tool: MessageToolUse): boolean {
  if (isPlanToolName(tool.name)) return false;
  const parsed = parseToolUiToolUses([tool]);
  if (parsed.length === 0) return false;
  return !parsed.some((interaction) => MESSAGE_CARD_EXCLUDED_TOOL_UI_TYPES.has(interaction.type));
}

const WEB_SEARCH_TOOL_NAME = /(?:^|[_-])(?:web[_-]?search|tavily[_-]?search)$|^websearch$/i;

function isWebSearchToolName(name: string | undefined): boolean {
  return typeof name === 'string' && WEB_SEARCH_TOOL_NAME.test(name.trim());
}

function parseSearchResultPayload(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^\uFEFF/, '');
    if (!trimmed) return null;
    const withoutFence = trimmed.replace(/^\s*\u0060\u0060\u0060(?:json)?\s*/i, '').replace(/\u0060\u0060\u0060\s*$/, '');
    try {
      return parseSearchResultPayload(JSON.parse(withoutFence) as unknown, depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    const text = value
      .map((entry) => (typeof entry === 'string' ? entry : ''))
      .join('\n')
      .trim();
    return text ? parseSearchResultPayload(text, depth + 1) : null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.results)) return record;
  for (const key of ['result', 'data', 'payload', 'details'] as const) {
    const nested = record[key];
    if (nested && typeof nested === 'object') {
      const parsed = parseSearchResultPayload(nested, depth + 1);
      if (parsed) return parsed;
    }
  }
  return record;
}

/**
 * Runtime `web_search` results are folded onto the assistant turn as
 * `_toolResults`, not as message.toolAttachments. Promote only the searches
 * that carry real provider output so a rich source card never shows a
 * fabricated/empty state; the compact execution-graph chip still owns the
 * in-flight call row.
 */
function projectWebSearchInteractions(message: RawMessage, tools: MessageToolUse[]): ToolUiInteraction[] {
  const results = message._toolResults;
  if (!results || results.length === 0) return [];
  const toolById = new Map(tools.map((tool) => [tool.id, tool]));
  const seen = new Set<string>();
  const interactions: ToolUiInteraction[] = [];
  results.forEach((entry, index) => {
    const tool = entry.toolCallId ? toolById.get(entry.toolCallId) : undefined;
    const toolName = entry.toolName ?? tool?.name;
    if (!isWebSearchToolName(toolName)) return;
    const payload = parseSearchResultPayload(entry.result);
    if (!payload) return;
    const id = 'web-search-' + (entry.toolCallId || index + 1);
    if (seen.has(id)) return;
    seen.add(id);
    const input = tool?.input && typeof tool.input === 'object' ? tool.input as Record<string, unknown> : undefined;
    const raw = entry.result && typeof entry.result === 'object' && !Array.isArray(entry.result)
      ? entry.result as Record<string, unknown>
      : undefined;
    const interaction = parseToolUiInteraction({
      ...payload,
      type: 'web-search',
      id,
      query: payload.query ?? raw?.query ?? input?.query,
      provider: payload.provider ?? raw?.provider,
      answer: payload.answer ?? raw?.answer,
      truncated: payload.truncated ?? raw?.truncated,
      results: Array.isArray(payload.results)
        ? payload.results
        : Array.isArray(payload.sources)
          ? payload.sources
          : [],
      status: 'done',
    }, id);
    if (interaction?.type === 'web-search') interactions.push(interaction);
  });
  return interactions;
}

/**
 * Merge block-derived resources with what enrichment already attached. A block
 * whose bytes were dropped from history is only reported when nothing else shows
 * that kind of media, because uploads keep their file on `_attachedFiles`.
 */
function mergeContentBlockResources(
  message: RawMessage,
  isUser: boolean,
  contentImageCount: number,
  rawAttachedFiles: AttachedFileMeta[],
): { attachedFiles: AttachedFileMeta[]; blockAttachments: AttachedFileMeta[]; blockResources: ConversationResource[] } {
  const { attachments, resources } = projectContentBlockResources(message, { isUser });
  const attachedKeys = new Set(rawAttachedFiles.map(mediaResourceKey).filter(Boolean));
  const hasAttachedMedia = rawAttachedFiles.some((file) => mediaKindOf(file));
  const hasImage = contentImageCount > 0 || rawAttachedFiles.some((file) => file.mimeType.startsWith('image/'));
  const attachedLocations = new Set(
    rawAttachedFiles.flatMap((file) => [file.gatewayUrl, file.filePath]).filter(Boolean),
  );
  const voiceNoteKeys = new Set(attachments.filter((file) => file.isVoiceNote).map(mediaResourceKey));
  return {
    attachedFiles: rawAttachedFiles.map((file) => (
      !file.isVoiceNote && voiceNoteKeys.has(mediaResourceKey(file)) ? { ...file, isVoiceNote: true } : file
    )),
    blockAttachments: attachments.filter((file) => {
      const key = mediaResourceKey(file);
      return key ? !attachedKeys.has(key) : !hasAttachedMedia;
    }),
    blockResources: resources.filter((resource) => {
      if (resource.kind !== 'image') return true;
      if (resource.omitted) return !hasImage;
      return !resource.url || !attachedLocations.has(resource.url);
    }),
  };
}

const projectionIds = new WeakMap<RawMessage, number>();
let nextProjectionId = 0;
const projectionCache = createChatContentCache<MessageRenderProjection>('message-projection', 1200);

function flagKey(flags: MessageRenderFlags): string {
  return [
    flags.isUser ? 'u' : 'a',
    flags.suppressAssistantText ? 'T' : 't',
    flags.suppressToolCards ? 'C' : 'c',
    flags.suppressReasoning ? 'R' : 'r',
    flags.textOverride ?? '',
  ].join('\u0000');
}

function computeProjection(message: RawMessage, flags: MessageRenderFlags): MessageRenderProjection {
  const { isUser, suppressAssistantText, suppressToolCards, suppressReasoning } = flags;
  const rawText = flags.textOverride ?? extractText(message);
  const parsed = isUser
    ? { displayText: rawText, interactions: [] as ToolUiInteraction[], unknownResources: [] as ConversationResource[] }
    : parseToolUiContent(rawText);

  const reasoning = isUser || suppressReasoning ? [] : extractAssistantReasoning(message);

  const displayText = parsed.displayText;
  // A folded narration turn keeps its text in the execution graph, so the
  // bubble is suppressed — but that must not take the rest of the row with it.
  const hideAssistantText = suppressAssistantText && !isUser;
  const hasText = !hideAssistantText && displayText.trim().length > 0;

  const tools = extractToolUse(message);
  const visibleTools = suppressToolCards ? [] : tools;
  const projectedToolUiInteractions = isUser
    ? parsed.interactions
    : [
        ...parsed.interactions,
        ...parseToolUiToolUses(tools.filter(isMessageCardTool)),
        ...projectWebSearchInteractions(message, tools),
      ];
  const toolUiInteractions = Array.from(
    new Map(projectedToolUiInteractions.map((interaction) => [interaction.type + ':' + interaction.id, interaction])).values(),
  );

  const contentImages = extractImages(message).filter((img) => imageSrc(img) != null);

  const rawAttachedFiles = message._attachedFiles ?? [];
  const knowledgeRefs = message._knowledgeRefs ?? [];
  const { attachedFiles, blockAttachments, blockResources } = mergeContentBlockResources(
    message,
    isUser,
    contentImages.length,
    rawAttachedFiles,
  );
  // Folded narration names paths too; only text the user can read may add a relative card.
  const textPreviewFiles = isUser
    ? []
    : [
        ...extractPreviewDocumentPaths(displayText),
        ...(hideAssistantText ? [] : extractRelativeArtifactPaths(displayText)),
      ];
  const knownAttachedPaths = new Set(
    [...attachedFiles, ...blockAttachments].map((file) => file.filePath).filter(Boolean),
  );
  const candidateAttachments = [
    ...attachedFiles,
    ...blockAttachments,
    ...textPreviewFiles.filter((file) => !file.filePath || !knownAttachedPaths.has(file.filePath)),
  ];
  const resources = [...blockResources, ...parsed.unknownResources];

  const hasRenderableContent = hasText
    || contentImages.length > 0
    || visibleTools.length > 0
    || toolUiInteractions.length > 0
    || candidateAttachments.length > 0
    || resources.length > 0
    || knowledgeRefs.length > 0
    || reasoning.length > 0;

  return {
    displayText,
    hasText,
    reasoning,
    toolUiInteractions,
    visibleTools,
    contentImages,
    candidateAttachments,
    resources,
    knowledgeRefs,
    hasRenderableContent,
  };
}

/**
 * Project a message into everything the transcript can render from it.
 *
 * Cached per (message identity, flags) so `index.tsx` and `ChatMessage` calling
 * it for the same row costs one parse, not two. Payloads share the chat byte
 * budget; object identities are weak and an evicted projection is recomputed.
 */
export function projectMessageRender(
  message: RawMessage,
  flags: MessageRenderFlags,
): MessageRenderProjection {
  let id = projectionIds.get(message);
  if (id === undefined) { id = ++nextProjectionId; projectionIds.set(message, id); }
  const key = `${id}:${flagKey(flags)}`;
  const cached = projectionCache.get(key);
  if (cached) return cached;

  const projection = computeProjection(message, flags);
  projectionCache.set(key, projection);
  return projection;
}
