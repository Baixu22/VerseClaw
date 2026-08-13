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
import {
  parseToolUiContent,
  parseToolUiToolUses,
  type ToolUiInteraction,
} from '@/components/tool-ui/agent-interactions';
import {
  extractAssistantReasoning,
  type AssistantReasoning,
} from '@/components/assistant-render/model';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';
import type { ChatKnowledgeReference } from '@shared/host-api/contract';
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

const projectionCache = new WeakMap<RawMessage, Map<string, MessageRenderProjection>>();

function flagKey(flags: MessageRenderFlags): string {
  return [
    flags.isUser ? 'u' : 'a',
    flags.suppressAssistantText ? 'T' : 't',
    flags.suppressToolCards ? 'C' : 'c',
    flags.textOverride ?? '',
  ].join('\u0000');
}

function computeProjection(message: RawMessage, flags: MessageRenderFlags): MessageRenderProjection {
  const { isUser, suppressAssistantText, suppressToolCards } = flags;
  const rawText = flags.textOverride ?? extractText(message);
  const parsed = isUser
    ? { displayText: rawText, interactions: [] as ToolUiInteraction[] }
    : parseToolUiContent(rawText);

  const reasoning = isUser ? [] : extractAssistantReasoning(message);

  const displayText = parsed.displayText;
  // A folded narration turn keeps its text in the execution graph, so the
  // bubble is suppressed — but that must not take the rest of the row with it.
  const hideAssistantText = suppressAssistantText && !isUser;
  const hasText = !hideAssistantText && displayText.trim().length > 0;

  const tools = extractToolUse(message);
  const visibleTools = suppressToolCards ? [] : tools;
  const toolUiInteractions = isUser
    ? parsed.interactions
    : [...parsed.interactions, ...parseToolUiToolUses(tools.filter(isMessageCardTool))];

  const contentImages = extractImages(message).filter((img) => imageSrc(img) != null);

  const rawAttachedFiles = message._attachedFiles ?? [];
  const knowledgeRefs = message._knowledgeRefs ?? [];
  const textPreviewFiles = isUser ? [] : extractPreviewDocumentPaths(displayText);
  const rawAttachedPaths = new Set(rawAttachedFiles.map((file) => file.filePath).filter(Boolean));
  const candidateAttachments = [
    ...rawAttachedFiles,
    ...textPreviewFiles.filter((file) => !file.filePath || !rawAttachedPaths.has(file.filePath)),
  ];

  const hasRenderableContent = hasText
    || contentImages.length > 0
    || visibleTools.length > 0
    || toolUiInteractions.length > 0
    || candidateAttachments.length > 0
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
    knowledgeRefs,
    hasRenderableContent,
  };
}

/**
 * Project a message into everything the transcript can render from it.
 *
 * Cached per (message identity, flags) so `index.tsx` and `ChatMessage` calling
 * it for the same row costs one parse, not two. The cache is a WeakMap keyed on
 * the message object, so it drains with the transcript.
 */
export function projectMessageRender(
  message: RawMessage,
  flags: MessageRenderFlags,
): MessageRenderProjection {
  let byFlags = projectionCache.get(message);
  if (!byFlags) {
    byFlags = new Map();
    projectionCache.set(message, byFlags);
  }
  const key = flagKey(flags);
  const cached = byFlags.get(key);
  if (cached) return cached;

  const projection = computeProjection(message, flags);
  byFlags.set(key, projection);
  return projection;
}
