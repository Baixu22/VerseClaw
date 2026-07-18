/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown and images. Tool steps render in ExecutionGraphCard;
 * streaming runs may show a compact ToolStatusBar. Thinking output is
 * surfaced via ExecutionGraphCard, not inside message bubbles.
 */
import { useState, useCallback, useEffect, memo, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Copy, Check, Wrench, X, FolderOpen, ZoomIn, AlertCircle, Pencil, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActionBarPrimitive, MessageProvider, TextMessagePartProvider, type ThreadMessage } from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import type { CodeHeaderProps } from '@assistant-ui/react-markdown';
import 'katex/dist/katex.min.css';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { statFile } from '@/lib/file-preview-client';
import { hostApi } from '@/lib/host-api';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { AgentInteractionRenderer, parseToolUiContent, parseToolUiToolUses } from '@/components/tool-ui/agent-interactions';
import { BranchPicker, ReasoningPanel, ToolFallbackCard } from '@/components/assistant-render/AssistantRender';
import { TokenUsageBadge } from '@/components/assistant-render/TokenUsageBadge';
import { extractAssistantBranches, extractAssistantReasoning, extractAssistantToolFallbacks } from '@/components/assistant-render/model';
import { KnowledgeDirectiveChip } from '@/components/assistant-render/KnowledgeDirectiveChip';
import { GitHubCard, isGitHubUrl } from '@/components/assistant-render/GitHubCard';
import { DotMatrix } from '@/components/assistant-ui/dot-matrix';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { NumberRoll } from '@/components/assistant-ui/number-roll';
import { AttachmentName, AttachmentRoot, AttachmentThumb, DIRECTORY_MIME_TYPE, FileIcon, formatFileSize } from '@/components/assistant-ui/attachment';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { useUiOverlay } from '@/components/layout/ui-overlay-context';
import type { AgentSummary } from '@/types/agent';

import { extractText, extractImages, extractToolUse, formatTimestamp, isUnresolvableImageUrl } from './message-utils';
import { copyImageToClipboard, type ImageCopyTarget } from './copy-image';

interface ChatMessageProps {
  message: RawMessage;
  agent?: Pick<AgentSummary, 'id' | 'name' | 'avatar'> | null;
  textOverride?: string;
  suppressToolCards?: boolean;
  suppressProcessAttachments?: boolean;
  /**
   * When true, hides the assistant text bubble (and any thinking block that
   * would be shown above it). Used when the message's text is being folded
   * into an ExecutionGraphCard as a narration step, to prevent the same text
   * from appearing both inside the graph and as an orphan bubble in the chat
   * stream.
   */
  suppressAssistantText?: boolean;
  isStreaming?: boolean;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
  /**
   * Optional callback invoked when a non-image file card is clicked.
   * When provided, the file opens in the in-app preview panel instead of
   * the system default editor.
   */
  onOpenFile?: (file: AttachedFileMeta) => void;
  onSubmitInteractionResponse?: (text: string) => void;
  onDraftInteractionResponse?: (text: string) => void;
  canSubmitInteractionResponse?: boolean;
  onResendUserMessage?: (text: string) => void;
  canResendUserMessage?: boolean;
  streamStatus?: {
    active: boolean;
    startedAt?: number | null;
    now?: number;
    tokenCount?: number | null;
    state?: 'thinking' | 'streaming' | 'syncing';
  } | null;
  /**
   * Live token usage for the current streaming run. Passed to the
   * TokenUsageBadge so the most recent assistant message can animate
   * the counter as tokens arrive. Ignored for non-streaming messages.
   */
  liveUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
  } | null;
}

interface ExtractedImage { url?: string; data?: string; mimeType: string; }

function isChatPreviewDocument(file: AttachedFileMeta): boolean {
  const name = file.fileName.toLowerCase();
  const mime = file.mimeType.toLowerCase();
  return (
    mime === 'application/pdf'
    || mime === 'application/vnd.ms-excel'
    || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || name.endsWith('.pdf')
    || name.endsWith('.xls')
    || name.endsWith('.xlsx')
  );
}

function isDirectoryAttachment(file: AttachedFileMeta): boolean {
  return file.mimeType === DIRECTORY_MIME_TYPE;
}

function isSkillFileAttachment(file: AttachedFileMeta): boolean {
  const path = file.filePath ?? '';
  return (
    /(?:^|[\\/])\.openclaw[\\/]skills[\\/][^\\/]+[\\/].+\.[A-Za-z0-9]+$/i.test(path)
    || /(?:^|[\\/])skills[\\/][^\\/]+[\\/]SKILL\.md$/i.test(path)
  );
}

function isHtmlOrMarkdownPreview(file: AttachedFileMeta): boolean {
  const name = file.fileName.toLowerCase();
  const mime = file.mimeType.toLowerCase();
  return (
    mime === 'text/html'
    || mime === 'text/markdown'
    || name.endsWith('.html')
    || name.endsWith('.htm')
    || name.endsWith('.md')
    || name.endsWith('.markdown')
  );
}

/** User-facing artifacts that must stay visible when process output is folded into the graph. */
function isUserFacingAttachmentWhenFolded(file: AttachedFileMeta): boolean {
  if (file.mimeType.startsWith('image/')) return true;
  if (isDirectoryAttachment(file)) return true;
  if (isSkillFileAttachment(file)) return true;
  if (isChatPreviewDocument(file)) return true;
  // Paths parsed from the assistant reply (e.g. "/workspace/demo.html") are
  // intentional user-facing links. Generic tool-result markdown attachments
  // (e.g. CHECKLIST.md emitted mid-run) stay folded into the execution graph.
  if (file.source === 'message-ref' && isHtmlOrMarkdownPreview(file)) return true;
  return false;
}

function validationKindForAttachment(file: AttachedFileMeta): 'file' | 'dir' | null {
  if (!file.filePath) return null;
  // User-selected uploads and already enriched attachments are trusted enough
  // for immediate display. Regex-derived message refs start at size 0/null and
  // are validated through main-process stat before becoming clickable cards.
  if (file.source !== 'message-ref' && file.source !== 'tool-result') return null;
  if (file.fileSize > 0 || file.preview) return null;
  return isDirectoryAttachment(file) ? 'dir' : 'file';
}

function previewMimeFromPath(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return null;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || 'file';
}

function trimPathTerminators(filePath: string): string {
  return filePath.replace(/[，。；;,.!?]+$/u, '');
}

function extractPreviewDocumentPaths(text: string): AttachedFileMeta[] {
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
  // Deliberately narrow this render-layer fallback to user-facing artifacts:
  // HTML / Markdown / PDF / spreadsheet previews and OpenClaw skill directories.
  // The store-level extractor still handles broad file categories; this keeps
  // visible outputs clickable even before history enrichment runs.
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
 * Normalize LaTeX delimiters so `remark-math` can detect them.
 *
 * Many LLMs emit LaTeX using `\(` / `\)` for inline math and `\[` / `\]`
 * for block math (OpenAI style), which are NOT recognized by remark-math.
 * remark-math only parses `$...$` and `$$...$$`.
 *
 * We convert the backslash-paren/bracket forms to dollar-sign forms so the
 * math is rendered regardless of which convention the model uses.
 *
 * Transformations are skipped inside fenced/inline code spans to avoid
 * clobbering code samples that legitimately contain `\(` etc.
 */
function normalizeLatexDelimiters(input: string): string {
  if (!input || (input.indexOf('\\(') === -1 && input.indexOf('\\[') === -1)) {
    return input;
  }

  const parts = input.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (part.startsWith('```') || part.startsWith('`')) continue;
    let next = part.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`);
    next = next.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body}$`);
    parts[i] = next;
  }
  return parts.join('');
}

/** Resolve an ExtractedImage to a displayable src string, or null if not possible. */
function imageSrc(img: ExtractedImage): string | null {
  if (img.url) return isUnresolvableImageUrl(img.url) ? null : img.url;
  if (img.data) return `data:${img.mimeType};base64,${img.data}`;
  return null;
}

export const ChatMessage = memo(function ChatMessage({
  message,
  agent,
  textOverride,
  suppressToolCards = false,
  suppressProcessAttachments = false,
  suppressAssistantText = false,
  isStreaming = false,
  streamingTools = [],
  onOpenFile,
  onSubmitInteractionResponse,
  onDraftInteractionResponse,
  canSubmitInteractionResponse = true,
  onResendUserMessage,
  canResendUserMessage = true,
  streamStatus,
  liveUsage,
}: ChatMessageProps) {
  const { t } = useTranslation('chat');
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  const rawText = useMemo(() => textOverride ?? extractText(message), [message, textOverride]);
  const toolUiContent = useMemo(
    () => (!isUser ? parseToolUiContent(rawText) : { displayText: rawText, interactions: [] }),
    [isUser, rawText],
  );
  const branches = useMemo(
    () => (!isUser ? extractAssistantBranches(message) : []),
    [isUser, message],
  );
  const [selectedBranchText, setSelectedBranchText] = useState<string | null>(null);
  const text = selectedBranchText ?? toolUiContent.displayText;
  const reasoning = useMemo(
    () => (!isUser ? extractAssistantReasoning(message) : []),
    [isUser, message],
  );
  const toolFallbacks = useMemo(
    () => (!isUser && !suppressToolCards ? extractAssistantToolFallbacks(message) : []),
    [isUser, message, suppressToolCards],
  );
  // When text is folded into an ExecutionGraphCard, treat the message as
  // having no text for rendering purposes. Keeping this behind a flag (vs
  // blanking `text` outright) lets future hover affordances still read the
  // original content without surfacing the bubble.
  const hideAssistantText = suppressAssistantText && !isUser;
  const hasText = !hideAssistantText && text.trim().length > 0;
  const images = useMemo(() => extractImages(message), [message]);
  const resolvableContentImages = useMemo(
    () => images.filter((img) => imageSrc(img) != null),
    [images],
  );
  const tools = useMemo(() => extractToolUse(message), [message]);
  const visibleTools = useMemo(
    () => (suppressToolCards ? [] : tools),
    [suppressToolCards, tools],
  );
  const toolUiInteractions = useMemo(
    () => (!isUser && !suppressToolCards
      ? [...toolUiContent.interactions, ...parseToolUiToolUses(visibleTools)]
      : toolUiContent.interactions),
    [isUser, suppressToolCards, toolUiContent.interactions, visibleTools],
  );
  const [validatedPaths, setValidatedPaths] = useState<Record<string, boolean>>({});
  const rawAttachedFiles = useMemo(() => message._attachedFiles || [], [message._attachedFiles]);
  const knowledgeRefs = useMemo(() => message._knowledgeRefs || [], [message._knowledgeRefs]);
  const textPreviewFiles = useMemo(
    () => (isUser ? [] : extractPreviewDocumentPaths(text)),
    [isUser, text],
  );
  const rawAttachedPaths = useMemo(
    () => new Set(rawAttachedFiles.map((file) => file.filePath).filter(Boolean)),
    [rawAttachedFiles],
  );
  const derivedAttachedFiles = useMemo(
    () => [
      ...rawAttachedFiles,
      ...textPreviewFiles.filter((file) => !file.filePath || !rawAttachedPaths.has(file.filePath)),
    ],
    [rawAttachedFiles, rawAttachedPaths, textPreviewFiles],
  );
  const validationTargets = useMemo(
    () => derivedAttachedFiles
      .map((file) => {
        const kind = validationKindForAttachment(file);
        return kind && file.filePath ? { filePath: file.filePath, kind } : null;
      })
      .filter((target): target is { filePath: string; kind: 'file' | 'dir' } => !!target),
    [derivedAttachedFiles],
  );
  const validationKey = useMemo(
    () => validationTargets
      .map((target) => `${target.kind}:${target.filePath}`)
      .sort()
      .join('\n'),
    [validationTargets],
  );
  useEffect(() => {
    if (!validationKey) return;
    const pendingTargets = validationTargets.filter((target) => validatedPaths[target.filePath] === undefined);
    if (pendingTargets.length === 0) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all(
        pendingTargets.map(async (target) => {
          try {
            const stat = await statFile(target.filePath);
            return {
              filePath: target.filePath,
              exists: !!stat.ok && (target.kind === 'dir' ? !!stat.isDir : !!stat.isFile),
            };
          } catch {
            return { filePath: target.filePath, exists: false };
          }
        }),
      ).then((results) => {
        if (cancelled) return;
        setValidatedPaths((current) => {
          const next = { ...current };
          for (const result of results) next[result.filePath] = result.exists;
          return next;
        });
      });
    }, 100);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [validationKey, validationTargets, validatedPaths]);
  const existingDerivedAttachedFiles = useMemo(
    () => derivedAttachedFiles.filter((file) => {
      const kind = validationKindForAttachment(file);
      if (!kind || !file.filePath) return true;
      return validatedPaths[file.filePath] === true;
    }),
    [derivedAttachedFiles, validatedPaths],
  );
  const filteredProcessAttachments = useMemo(
    () => derivedAttachedFiles.filter((file) => {
      if (file.source !== 'tool-result' && file.source !== 'message-ref') return true;
      // Runtime-produced user-facing artifacts (images, HTML/Markdown/PDF/XLSX,
      // skill directories, ...) must remain visible in the reply bubble even
      // when generic process attachments are folded into the execution graph.
      // The graph card itself does not render `_attachedFiles`, so dropping
      // them here would leave the user with no way to open previews from chat.
      return isUserFacingAttachmentWhenFolded(file);
    }),
    [derivedAttachedFiles],
  );
  // When a message is attachment-only, keep those attachments visible even if
  // process attachments are generally suppressed for this run segment —
  // otherwise the reply disappears entirely.
  const processVisibleAttachments = useMemo(
    () => filteredProcessAttachments.filter((file) => {
      const kind = validationKindForAttachment(file);
      if (!kind || !file.filePath) return true;
      return validatedPaths[file.filePath] === true;
    }),
    [filteredProcessAttachments, validatedPaths],
  );
  const attachedFiles = useMemo(
    () => (suppressProcessAttachments && (hasText || resolvableContentImages.length > 0 || visibleTools.length > 0)
      ? processVisibleAttachments
      : existingDerivedAttachedFiles),
    [
      existingDerivedAttachedFiles,
      hasText,
      processVisibleAttachments,
      resolvableContentImages.length,
      suppressProcessAttachments,
      visibleTools.length,
    ],
  );
  const imageCopyTarget = useMemo(
    () => resolvePrimaryImageCopyTarget(resolvableContentImages, attachedFiles),
    [attachedFiles, resolvableContentImages],
  );
  const handleOpenToolUiFilePath = useCallback((filePath: string) => {
    const file: AttachedFileMeta = {
      fileName: fileNameFromPath(filePath),
      mimeType: previewMimeFromPath(filePath) ?? 'text/plain',
      fileSize: 0,
      preview: null,
      filePath,
      source: 'message-ref',
    };
    if (onOpenFile) {
      onOpenFile(file);
      return;
    }
    void hostApi.shell.openPath(filePath);
  }, [onOpenFile]);
  const showAssistantHoverBar = !isUser && (hasText || imageCopyTarget != null);
  const showUserHoverBar = isUser && hasText;
  const [isEditingUserMessage, setIsEditingUserMessage] = useState(false);
  const [userEditDraft, setUserEditDraft] = useState(text);
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);

  const handleStartUserMessageEdit = useCallback(() => {
    setUserEditDraft(text);
    setIsEditingUserMessage(true);
  }, [text]);

  const handleCancelUserMessageEdit = useCallback(() => {
    setUserEditDraft(text);
    setIsEditingUserMessage(false);
  }, [text]);

  const handleSubmitUserMessageEdit = useCallback(() => {
    const nextText = userEditDraft.trim();
    if (!nextText || !canResendUserMessage || !onResendUserMessage) return;
    setIsEditingUserMessage(false);
    onResendUserMessage(nextText);
  }, [canResendUserMessage, onResendUserMessage, userEditDraft]);

  // Never render tool result messages in chat UI
  if (isToolResult) return null;

  const hasStreamingToolStatus = isStreaming && streamingTools.length > 0;
  const showStreamStatus = !isUser && !!streamStatus?.active;
  if (!hasText && resolvableContentImages.length === 0 && visibleTools.length === 0 && toolUiInteractions.length === 0 && attachedFiles.length === 0 && knowledgeRefs.length === 0 && reasoning.length === 0 && toolFallbacks.length === 0 && !hasStreamingToolStatus && !showStreamStatus) return null;

  return (
    <div
      className={cn(
        'flex gap-3 group',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {/* Avatar — vertical center aligned with the first line of the reply.
          The outer slot is sized to one prose-sm line (h-6 = 24px) so its
          midpoint coincides with the first text line's midpoint; the 32px
          avatar inside is centered within that slot and intentionally
          overflows ±4px above/below the line, which mirrors how chat avatars
          sit alongside a single line of text. */}
      {!isUser && (
        <div className="mt-0.5" data-testid="chat-assistant-avatar">
          <AgentAvatar
            agentId={agent?.id ?? 'main'}
            name={agent?.name ?? 'Verse'}
            avatar={agent?.avatar ?? { kind: 'brand', source: 'default', revision: 'verse-brand-v1' }}
            size={32}
          />
        </div>
      )}

      {/* Content */}
      <div
        className={cn(
          'flex flex-col w-full min-w-0 space-y-2',
          isUser && isEditingUserMessage ? 'max-w-full' : 'max-w-[80%]',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {isStreaming && !isUser && streamingTools.length > 0 && (
          <ToolStatusBar tools={streamingTools} />
        )}

        {!isUser && branches.length > 1 && (
          <BranchPicker
            branches={branches}
            storageKey={`assistant-branch:${message.id ?? message.timestamp ?? rawText.slice(0, 32)}`}
            onSelect={(branch) => setSelectedBranchText(branch?.text ?? null)}
          />
        )}

        {!isUser && reasoning.length > 0 && (
          <ReasoningPanel items={reasoning} />
        )}

        {/* Images — rendered ABOVE text bubble for user messages */}
        {/* Images from content blocks (Gateway session data / channel push photos) */}
        {isUser && resolvableContentImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {resolvableContentImages.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImageThumbnail
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — images above text for user, file cards below */}
        {isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              // Skip image attachments if we already have images from content blocks
              if (isImage && resolvableContentImages.length > 0) return null;
              if (isImage) {
                return file.preview ? (
                  <ImageThumbnail
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                ) : (
                  <ImagePreviewPlaceholder key={`local-${i}`} file={file} />
                );
              }
              // Non-image files → file card
              return <FileCard key={`local-${i}`} file={file} onOpen={onOpenFile} />;
            })}
          </div>
        )}

        {isUser && knowledgeRefs.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5" data-testid="chat-message-knowledge-refs">
            {knowledgeRefs.map((reference) => (
                <KnowledgeDirectiveChip key={reference.id} reference={reference} />
              ))}
          </div>
        )}

        {/* Main text */}
        {hasText && (
          isUser ? (
            isEditingUserMessage ? (
              <UserMessageEditor
                value={userEditDraft}
                onChange={setUserEditDraft}
                onCancel={handleCancelUserMessageEdit}
                onSubmit={handleSubmitUserMessageEdit}
                canSubmit={canResendUserMessage && userEditDraft.trim().length > 0}
                inputLabel={t('messageActions.editInputLabel')}
                cancelLabel={t('messageActions.cancelEdit')}
                sendLabel={t('messageActions.sendEdit')}
              />
            ) : (
              <UserMessageBubble text={text} />
            )
          ) : (
            <AssistantMarkdown text={text} isStreaming={isStreaming} />
          )
        )}

        {showStreamStatus && (
          <AssistantStreamStatusBar status={streamStatus} />
        )}

        {!isUser && toolUiInteractions.length > 0 && (
          <AgentInteractionRenderer
            interactions={toolUiInteractions}
            canSubmit={canSubmitInteractionResponse}
            onSubmitResponse={onSubmitInteractionResponse}
            onDraftResponse={onDraftInteractionResponse}
            onOpenFilePath={handleOpenToolUiFilePath}
          />
        )}

        {!isUser && toolFallbacks.length > 0 && (
          <ToolFallbackCard tools={toolFallbacks} />
        )}

        {/* Images from content blocks — assistant messages (below text) */}
        {!isUser && resolvableContentImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {resolvableContentImages.map((img, i) => {
              const src = imageSrc(img);
              if (!src) return null;
              return (
                <ImagePreviewCard
                  key={`content-${i}`}
                  src={src}
                  fileName="image"
                  base64={img.data}
                  mimeType={img.mimeType}
                  onPreview={() => setLightboxImg({ src, fileName: 'image', base64: img.data, mimeType: img.mimeType })}
                />
              );
            })}
          </div>
        )}

        {/* File attachments — assistant messages (below text) */}
        {!isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              if (isImage && resolvableContentImages.length > 0) return null;
              if (isImage && file.preview) {
                return (
                  <ImagePreviewCard
                    key={`local-${i}`}
                    src={file.preview}
                    fileName={file.fileName}
                    filePath={file.filePath}
                    mimeType={file.mimeType}
                    onPreview={() => setLightboxImg({ src: file.preview!, fileName: file.fileName, filePath: file.filePath, mimeType: file.mimeType })}
                  />
                );
              }
              if (isImage && !file.preview) {
                return <ImagePreviewPlaceholder key={`local-${i}`} file={file} />;
              }
              return <FileCard key={`local-${i}`} file={file} onOpen={onOpenFile} />;
            })}
          </div>
        )}

        {/* Token usage badge — animated counter at the end of assistant messages */}
        {!isUser && !showStreamStatus && (
          <TokenUsageBadge message={message} liveUsage={liveUsage} isStreaming={isStreaming} />
        )}

        {/* Hover row for user messages */}
        {showUserHoverBar && !isEditingUserMessage && (
          <UserMessageActions
            text={text}
            timestamp={message.timestamp}
            canEdit={Boolean(onResendUserMessage) && canResendUserMessage}
            onEdit={handleStartUserMessageEdit}
          />
        )}

        {/* Hover row for assistant messages */}
        {showAssistantHoverBar && (
          <AssistantHoverBar text={text} timestamp={message.timestamp} imageCopyTarget={imageCopyTarget} />
        )}
      </div>

      {/* Image lightbox portal */}
      {lightboxImg && (
        <ImageLightbox
          src={lightboxImg.src}
          fileName={lightboxImg.fileName}
          filePath={lightboxImg.filePath}
          base64={lightboxImg.base64}
          mimeType={lightboxImg.mimeType}
          onClose={() => setLightboxImg(null)}
        />
      )}
    </div>
  );
});

function formatElapsedSeconds(startedAt?: number | null, now = Date.now()): string {
  if (!startedAt || !Number.isFinite(startedAt)) return '0s';
  const elapsedMs = Math.max(0, now - startedAt);
  return `${Math.max(0, Math.round(elapsedMs / 1000))}s`;
}

function AssistantStreamStatusBar({
  status,
}: {
  status: NonNullable<ChatMessageProps['streamStatus']>;
}) {
  const { t, i18n } = useTranslation('chat');
  const elapsed = formatElapsedSeconds(status.startedAt, status.now);
  const tokenCount = status.tokenCount ?? 0;
  const dotState = status.state === 'syncing'
    ? 'syncing'
    : status.state === 'streaming'
      ? 'streaming'
      : 'thinking';

  return (
    <div
      className="flex min-h-6 items-center gap-2 text-sm font-medium leading-6 text-muted-foreground"
      data-testid="assistant-stream-status"
    >
      {dotState === 'thinking' ? (
        <Shimmer
          className="text-sm font-medium text-primary"
          data-testid="assistant-stream-status-dot"
          data-state="thinking"
        >
          {t('assistantRender.activity.thinking')}
        </Shimmer>
      ) : (
        <DotMatrix
          state={dotState}
          label={t('assistantRender.activity.thinking')}
          className="size-4 shrink-0 text-primary"
          data-testid="assistant-stream-status-dot"
        />
      )}
      <span className="tabular-nums" data-testid="assistant-stream-status-elapsed">
        {elapsed}
      </span>
      {tokenCount > 0 && (
        <>
          <span className="text-muted-foreground/55">·</span>
          <span className="inline-flex items-baseline gap-1 tabular-nums" data-testid="assistant-stream-status-tokens">
            <NumberRoll
              value={tokenCount}
              locales={i18n.language}
              format={{ notation: 'compact', maximumFractionDigits: 1 }}
              trend="up"
            />
            <span>{t('assistantRender.usage.tokens')}</span>
          </span>
        </>
      )}
    </div>
  );
}

function formatDuration(durationMs?: number): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function ToolStatusBar({
  tools,
}: {
  tools: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    status: 'running' | 'completed' | 'error';
    durationMs?: number;
    summary?: string;
  }>;
}) {
  return (
    <div className="w-full space-y-1" data-testid="chat-streaming-tool-status-bar">
      {tools.map((tool) => {
        const duration = formatDuration(tool.durationMs);
        const isRunning = tool.status === 'running';
        const isError = tool.status === 'error';
        return (
          <div
            key={tool.toolCallId || tool.id || tool.name}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors',
              isRunning && 'border-primary/30 bg-primary/5 text-foreground',
              !isRunning && !isError && 'border-border/50 bg-surface-input/20 text-muted-foreground',
              isError && 'border-destructive/30 bg-destructive/5 text-destructive',
            )}
          >
            {isRunning && <DotMatrix state="syncing" label={tool.name} className="size-3.5 text-primary" />}
            {!isRunning && !isError && <DotMatrix state="success" label={tool.name} className="size-3.5" />}
            {isError && <DotMatrix state="error" label={tool.name} className="size-3.5" />}
            <Wrench className="h-3 w-3 shrink-0 opacity-60" />
            <span className="font-mono text-xs font-medium">{tool.name}</span>
            {duration && <span className="text-tiny opacity-60">{tool.summary ? `(${duration})` : duration}</span>}
            {tool.summary && (
              <span className="truncate text-tiny opacity-70">{tool.summary}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function resolvePrimaryImageCopyTarget(
  images: Array<{ mimeType: string; data?: string; url?: string }>,
  attachedFiles: AttachedFileMeta[],
): ImageCopyTarget | null {
  for (const file of attachedFiles) {
    if (!file.mimeType.startsWith('image/')) continue;
    if (file.filePath || file.preview?.startsWith('data:')) {
      return {
        filePath: file.filePath,
        preview: file.preview,
        mimeType: file.mimeType,
      };
    }
  }

  for (const image of images) {
    if (image.data) {
      return { base64: image.data, mimeType: image.mimeType };
    }
    if (image.url?.startsWith('data:')) {
      return { preview: image.url, mimeType: image.mimeType };
    }
  }

  return null;
}

// ── Assistant hover bar (timestamp + copy, shown on group hover) ─

function normalizeAssistantUiTimestamp(timestamp?: number): Date {
  if (!timestamp || !Number.isFinite(timestamp)) return new Date();
  return new Date(timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000);
}

function createAssistantUiActionMessage({
  role,
  text,
  timestamp,
}: {
  role: 'assistant' | 'user';
  text: string;
  timestamp?: number;
}): ThreadMessage {
  const createdAt = normalizeAssistantUiTimestamp(timestamp);
  const id = `${role}:${createdAt.getTime()}:${text.slice(0, 48) || 'empty'}`;
  const content = [{ type: 'text' as const, text }];

  if (role === 'user') {
    return {
      id,
      role: 'user',
      createdAt,
      content,
      attachments: [],
      metadata: { custom: {} },
    };
  }

  return {
    id,
    role: 'assistant',
    createdAt,
    content,
    status: { type: 'complete', reason: 'stop' },
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
}

function AssistantUiGhostActionBar({
  role,
  text,
  timestamp,
  className,
  testId,
  children,
}: {
  role: 'assistant' | 'user';
  text: string;
  timestamp?: number;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const actionMessage = useMemo(
    () => createAssistantUiActionMessage({ role, text, timestamp }),
    [role, text, timestamp],
  );

  return (
    <MessageProvider message={actionMessage} index={0} isLast>
      <ActionBarPrimitive.Root
        autohide="never"
        className={className}
        data-testid={testId}
      >
        {children}
      </ActionBarPrimitive.Root>
    </MessageProvider>
  );
}

function AssistantHoverBar({
  text,
  timestamp,
  imageCopyTarget,
}: {
  text: string;
  timestamp?: number;
  imageCopyTarget?: ImageCopyTarget | null;
}) {
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(async () => {
    if (imageCopyTarget) {
      const copiedImage = await copyImageToClipboard(imageCopyTarget);
      if (copiedImage) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }
    }
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text, imageCopyTarget]);

  return (
    <AssistantUiGhostActionBar
      role="assistant"
      text={text}
      timestamp={timestamp}
      testId="chat-assistant-message-actions"
      className="flex h-6 w-full translate-y-0.5 items-center justify-between px-1 opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
    >
      <span className="text-xs text-muted-foreground">
        {timestamp ? formatTimestamp(timestamp) : ''}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={copyContent}
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </Button>
    </AssistantUiGhostActionBar>
  );
}

// ── User Message Bubble ─────────────────────────────────────────

function UserMessageActions({
  text,
  timestamp,
  canEdit,
  onEdit,
}: {
  text: string;
  timestamp?: number;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(async () => {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [text]);

  return (
    <AssistantUiGhostActionBar
      role="user"
      text={text}
      timestamp={timestamp}
      testId="chat-user-message-actions"
      className="flex h-6 translate-y-0.5 items-center justify-end gap-1 px-1 opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100"
    >
      {timestamp && (
        <span className="mr-1 select-none text-[11px] leading-none text-muted-foreground/80">
          {formatTimestamp(timestamp)}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground/75 transition-transform active:scale-95"
        onClick={() => void copyContent()}
        aria-label={copied ? t('messageActions.copied') : t('messageActions.copy')}
        title={copied ? t('messageActions.copied') : t('messageActions.copy')}
        data-testid="chat-user-message-copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-700 dark:text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
      {canEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground/75 transition-transform active:scale-95"
          onClick={onEdit}
          aria-label={t('messageActions.edit')}
          title={t('messageActions.edit')}
          data-testid="chat-user-message-edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
    </AssistantUiGhostActionBar>
  );
}

function UserMessageEditor({
  value,
  onChange,
  onCancel,
  onSubmit,
  canSubmit,
  inputLabel,
  cancelLabel,
  sendLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
  inputLabel: string;
  cancelLabel: string;
  sendLabel: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    }
  }, [onCancel, onSubmit]);

  return (
    <form
      className="w-[min(72vw,48rem)] max-w-full rounded-2xl border border-black/10 bg-surface-input px-3 py-2.5 transition-colors duration-150 focus-within:border-black/20 dark:border-white/10 dark:focus-within:border-white/20"
      data-testid="chat-user-message-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        aria-label={inputLabel}
        data-testid="chat-user-message-editor-input"
        className="block min-h-[72px] w-full resize-none border-0 bg-transparent p-0 text-sm leading-6 text-foreground shadow-none outline-none placeholder:text-muted-foreground/60 focus:ring-0"
      />
      <div className="mt-2 flex h-6 items-center justify-end gap-1" data-testid="chat-user-message-editor-actions">
        <button
          type="button"
          onClick={onCancel}
          aria-label={cancelLabel}
          title={cancelLabel}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/75 transition-[background-color,color,transform] duration-150 hover:bg-black/5 hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
          data-testid="chat-user-message-edit-cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label={sendLabel}
          title={sendLabel}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/75 transition-[background-color,color,transform] duration-150 hover:bg-black/5 hover:text-foreground active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
          data-testid="chat-user-message-edit-send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </form>
  );
}

function UserMessageBubble({
  text,
}: {
  text: string;
}) {
  const { uiVersion } = useUiOverlay();
  const isUiV2 = uiVersion === 'v2' && window.electron?.platform === 'win32';
  return (
    <div
      className={cn(
        'relative px-3.5 py-2.5 text-foreground transition-colors duration-150',
        isUiV2
          ? 'rounded-[16px] border border-primary/10 bg-primary/[0.07] shadow-sm backdrop-blur-sm dark:border-primary/15 dark:bg-primary/10'
          : 'rounded-2xl bg-surface-input',
      )}
      data-testid="chat-user-message-bubble"
    >
      <p className="whitespace-pre-wrap break-words text-sm">{text}</p>
    </div>
  );
}

// ── Assistant Markdown ──────────────────────────────────────────

function MarkdownCodeHeader({ language, code }: CodeHeaderProps) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const label = language && language !== 'unknown' ? language : t('markdown.codeBlock');

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div
      className="mt-4 flex items-center justify-between gap-3 rounded-t-lg border border-black/5 bg-black/[0.04] px-3 py-2 text-xs text-muted-foreground dark:border-white/10 dark:bg-white/[0.06]"
      data-testid="assistant-code-header"
    >
      <span className="min-w-0 truncate font-mono uppercase tracking-wide">{label}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
        aria-label={copied ? t('markdown.copiedCode') : t('markdown.copyCode')}
        title={copied ? t('markdown.copiedCode') : t('markdown.copyCode')}
        data-testid="assistant-code-copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function AssistantMarkdown({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  return (
    <>
      <TextMessagePartProvider text={text} isRunning={isStreaming}>
        <MarkdownTextPrimitive
          className="prose prose-sm dark:prose-invert w-full max-w-none break-words text-foreground"
          smooth={false}
          defer={isStreaming}
          preprocess={normalizeLatexDelimiters}
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false, output: 'html' }]]}
          components={{
              a({ href, children, ...props }) {
                if (href && isGitHubUrl(href)) {
                  return <GitHubCard url={href} />;
                }
                return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline decoration-primary/30 hover:decoration-primary transition-colors" {...props}>{children}</a>;
              },
              code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const isInline = !match && !className;
              if (isInline) {
                return (
                  <code className="bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded text-sm font-mono break-words break-all" {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <code className={cn('text-sm font-mono', className)} {...props}>
                  {children}
                </code>
              );
            },
            pre({ children, className, style, ...props }) {
              return (
                <pre
                  {...props}
                  style={{
                    ...style,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'break-word',
                  }}
                  className={cn(
                    'rounded-b-lg rounded-t-none border border-t-0 border-black/5 bg-black/5 p-4 overflow-x-auto whitespace-pre-wrap break-words dark:border-white/10 dark:bg-white/5',
                    className,
                  )}
                >
                  {children}
                </pre>
              );
            },
            img({ src, alt }) {
              if (!src || isUnresolvableImageUrl(String(src))) return null;
              return (
                <img src={String(src)} alt={typeof alt === 'string' ? alt : 'image'} className="max-w-full rounded-lg" />
              );
            },
            CodeHeader: MarkdownCodeHeader,
            h1({ children, ...props }) {
              return <h1 className="mb-3 mt-4 font-serif text-2xl font-normal tracking-tight text-foreground first:mt-0" {...props}>{children}</h1>;
            },
            h2({ children, ...props }) {
              return <h2 className="mb-2.5 mt-4 font-serif text-xl font-normal tracking-tight text-foreground first:mt-0" {...props}>{children}</h2>;
            },
            h3({ children, ...props }) {
              return <h3 className="mb-2 mt-3 text-base font-semibold text-foreground first:mt-0" {...props}>{children}</h3>;
            },
            blockquote({ children, ...props }) {
              return (
                <blockquote
                  className="my-3 border-l-2 border-primary/40 bg-black/[0.025] py-2 pl-4 pr-3 text-muted-foreground dark:bg-white/[0.035]"
                  {...props}
                >
                  {children}
                </blockquote>
              );
            },
            table({ children, ...props }) {
              return (
                <div className="my-4 max-w-full overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
                  <table className="my-0 w-full min-w-max border-collapse text-sm" {...props}>
                    {children}
                  </table>
                </div>
              );
            },
            th({ children, ...props }) {
              return (
                <th className="border-b border-black/10 bg-black/[0.035] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground dark:border-white/10 dark:bg-white/[0.05]" {...props}>
                  {children}
                </th>
              );
            },
            td({ children, ...props }) {
              return (
                <td className="border-t border-black/5 px-3 py-2 align-top text-foreground dark:border-white/10" {...props}>
                  {children}
                </td>
              );
            },
            hr(props) {
              return <hr className="my-5 border-black/10 dark:border-white/10" {...props} />;
            },
            input({ type, checked, ...props }) {
              if (type !== 'checkbox') return <input type={type} checked={checked} {...props} />;
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="mr-2 h-3.5 w-3.5 rounded border-black/20 align-[-2px] accent-primary dark:border-white/20"
                  {...props}
                />
              );
            },
          }}
        />
      </TextMessagePartProvider>
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5" />
      )}
    </>
  );
}

// ── File Card (for user-uploaded non-image files) ───────────────

function FileCard({ file, onOpen }: { file: AttachedFileMeta; onOpen?: (file: AttachedFileMeta) => void }) {
  const { t } = useTranslation('chat');
  const handleOpen = useCallback(() => {
    if (!file.filePath) return;
    if (onOpen) {
      onOpen(file);
    } else {
      void hostApi.shell.openPath(file.filePath);
    }
  }, [file, onOpen]);

  const sublabel =
    file.mimeType === DIRECTORY_MIME_TYPE
      ? t('assistantRender.attachment.folder', { defaultValue: '\u6587\u4ef6\u5939' })
      : file.fileSize > 0
        ? formatFileSize(file.fileSize)
        : t('assistantRender.attachment.file', { defaultValue: 'File' });

  return (
    <AttachmentRoot
      className={cn(
        'flex min-h-14 w-[min(260px,100%)] items-center gap-3 rounded-lg border border-border bg-background/70 px-3 py-2.5 shadow-sm',
        file.filePath && 'cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/10',
      )}
      onClick={handleOpen}
      title={file.filePath ? t('assistantRender.attachment.open', { defaultValue: 'Open file' }) : undefined}
      data-testid="assistant-attachment-card"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-black/5 text-muted-foreground dark:bg-white/10">
        <FileIcon mimeType={file.mimeType} className="h-4 w-4" />
      </div>
      <AttachmentName name={file.fileName} sublabel={sublabel} />
    </AttachmentRoot>
  );
}

function ImagePreviewPlaceholder({ file }: { file: AttachedFileMeta }) {
  const { t } = useTranslation('chat');
  const unavailable = file.previewStatus === 'unavailable';
  const label = unavailable
    ? t('imageGeneration.previewUnavailable')
    : t('imageGeneration.previewLoading');

  return (
    <div
      className={cn(
        'flex h-36 w-36 flex-col items-center justify-center gap-2 rounded-xl border border-black/10 bg-black/5 px-3 text-center text-muted-foreground dark:border-white/10 dark:bg-white/5',
        unavailable && 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
      )}
      data-testid={unavailable ? 'image-preview-unavailable' : 'image-preview-loading'}
      title={file.fileName}
    >
      {unavailable ? (
        <AlertCircle className="h-5 w-5 shrink-0" />
      ) : (
        <DotMatrix state="loading" label={label} className="size-5 text-primary" />
      )}
      <span className="text-xs leading-4">{label}</span>
    </div>
  );
}

// ── Image Thumbnail (user bubble — square crop with zoom hint) ──

function ImageThumbnail({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <AttachmentRoot
      className="w-36 h-36 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 cursor-zoom-in"
      onClick={onPreview}
    >
      <AttachmentThumb src={src} alt={fileName} className="h-full w-full" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </AttachmentRoot>
  );
}

// ── Image Preview Card (assistant bubble — natural size with overlay actions) ──

function ImagePreviewCard({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onPreview,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onPreview: () => void;
}) {
  void filePath; void base64; void mimeType;
  return (
    <AttachmentRoot
      className="max-w-xs rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 cursor-zoom-in"
      onClick={onPreview}
    >
      <AttachmentThumb src={src} alt={fileName} className="block w-full" />
      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover/img:opacity-100 transition-opacity drop-shadow" />
      </div>
    </AttachmentRoot>
  );
}

// ── Image Lightbox ───────────────────────────────────────────────

function ImageLightbox({
  src,
  fileName,
  filePath,
  base64,
  mimeType,
  onClose,
}: {
  src: string;
  fileName: string;
  filePath?: string;
  base64?: string;
  mimeType?: string;
  onClose: () => void;
}) {
  void src; void base64; void mimeType; void fileName;
  const { t } = useTranslation('chat');

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleShowInFolder = useCallback(() => {
    if (filePath) {
      void hostApi.shell.showItemInFolder(filePath);
    }
  }, [filePath]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Image + buttons stacked */}
      <div
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={fileName}
          className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl object-contain"
        />

        {/* Action buttons below image */}
        <div className="flex items-center gap-2">
          {filePath && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
              onClick={handleShowInFolder}
              title={t('filePreview.actions.openInFinder')}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={onClose}
            title={t('filePreview.actions.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
