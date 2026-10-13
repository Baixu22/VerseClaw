/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown and images. Tool steps render in ExecutionGraphCard;
 * streaming runs may show a compact ToolStatusBar. Thinking output is
 * surfaced via ExecutionGraphCard, not inside message bubbles.
 */
import { useState, useCallback, useEffect, memo, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Copy, Check, Wrench, X, FolderOpen, ZoomIn, AlertCircle, Pencil, Send, GitFork, ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { statFile } from '@/lib/file-preview-client';
import { hostApi } from '@/lib/host-api';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { AgentInteractionRenderer } from '@/components/tool-ui/agent-interactions';
import { ThinkingReasoning } from '@/components/assistant-render/ThinkingReasoning';
import { TokenUsageBadge } from '@/components/assistant-render/TokenUsageBadge';
import type { AssistantReasoning } from '@/components/assistant-render/model';
import { KnowledgeDirectiveChip } from '@/components/assistant-render/KnowledgeDirectiveChip';
import { GitHubCard, isGitHubUrl } from '@/components/assistant-render/GitHubCard';
import { OrbStatus } from '@/components/assistant-ui/orb-status';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { NumberRoll } from '@/components/assistant-ui/number-roll';
import { AttachmentName, AttachmentRoot, AttachmentThumb, DIRECTORY_MIME_TYPE, FileIcon, formatFileSize } from '@/components/assistant-ui/attachment';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import type { AgentSummary } from '@/types/agent';

import { formatTimestamp, isUnresolvableImageUrl } from './message-utils';
import {
  fileNameFromPath,
  imageSrc,
  previewMimeFromPath,
  projectMessageRender,
} from './message-render-projection';
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
  /**
   * The turn's process disclosure (`TurnSummaryCard`) adopted this turn's
   * reasoning, so this message must not render it again. Wins over
   * `reasoningOverride` — one owner per turn, and the card is it.
   */
  suppressReasoning?: boolean;
  isStreaming?: boolean;
  /**
   * Reasoning to show instead of whatever the message itself carries. Used for
   * the streaming turn, whose thinking lives on the runtime run
   * (`ChatRuntimeRunState.thinkingText`) rather than on a message.
   */
  reasoningOverride?: AssistantReasoning[];
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
  /**
   * #180: fork a new session from this message's transcript entry. Only offered
   * when the message carries an entry id (the `fromLeafId` the fork RPC needs).
   */
  onForkFromMessage?: (messageId: string) => void;
  /**
   * #178: summarize a located stretch around this message's transcript entry.
   * 'from' keeps the message (and everything after) verbatim and summarizes the
   * older entries; 'to' folds the head (through the message) into the summary
   * and keeps the newer entries verbatim. Only offered when an entry id exists.
   */
  onCompactRange?: (messageId: string, boundary: 'from' | 'to') => void;
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

/** Stable identity so `suppressReasoning` never churns downstream memos. */
const EMPTY_REASONING: AssistantReasoning[] = [];

export const ChatMessage = memo(function ChatMessage({
  message,
  agent,
  textOverride,
  suppressToolCards = false,
  suppressProcessAttachments = false,
  suppressAssistantText = false,
  suppressReasoning = false,
  isStreaming = false,
  reasoningOverride,
  streamingTools = [],
  onOpenFile,
  onSubmitInteractionResponse,
  onDraftInteractionResponse,
  canSubmitInteractionResponse = true,
  onResendUserMessage,
  canResendUserMessage = true,
  onForkFromMessage,
  onCompactRange,
  streamStatus,
  liveUsage,
}: ChatMessageProps) {
  const { t } = useTranslation('chat');
  const isUser = message.role === 'user';
  const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
  const isToolResult = role === 'toolresult' || role === 'tool_result';
  // One projection, shared with Chat/index.tsx's row-visibility decision. See
  // message-render-projection.ts for why these two must not derive separately.
  const projection = useMemo(
    () => projectMessageRender(message, {
      isUser,
      suppressAssistantText,
      suppressToolCards,
      suppressReasoning,
      textOverride,
    }),
    [isUser, message, suppressAssistantText, suppressReasoning, suppressToolCards, textOverride],
  );
  const text = projection.displayText;
  const reasoning = suppressReasoning ? EMPTY_REASONING : reasoningOverride ?? projection.reasoning;
  const hasText = projection.hasText;
  const resolvableContentImages = projection.contentImages;
  const visibleTools = projection.visibleTools;
  const toolUiInteractions = projection.toolUiInteractions;
  const [validatedPaths, setValidatedPaths] = useState<Record<string, boolean>>({});
  const knowledgeRefs = projection.knowledgeRefs;
  const derivedAttachedFiles = projection.candidateAttachments;
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
  // Same authority index.tsx uses for `row.hidden` — see
  // message-render-projection.ts. Reasoning may also arrive as an override on
  // the streaming turn, which the projection cannot know about.
  const hasProjectedContent = projection.hasRenderableContent || reasoning.length > 0;
  if (!hasProjectedContent && !hasStreamingToolStatus && !showStreamStatus) return null;

  /**
   * Second gate, over what will ACTUALLY paint.
   *
   * `hasProjectedContent` is deliberately an over-approximation: it counts
   * `candidateAttachments`, the pre-validation list, because path existence is
   * async and cannot live in a pure projection. When every candidate then fails
   * validation, the row survives with an empty content column — and for an
   * assistant turn that is a bare avatar floating in the transcript.
   *
   * That used to be invisible: a folded narration turn still had its reasoning
   * panel to fill the row. Now that the turn's reasoning belongs to the process
   * disclosure, the empty row has nothing left to hide behind, so it has to be
   * dropped here rather than shipped as a stray avatar.
   */
  const hasPaintableBody = hasText
    || reasoning.length > 0
    || resolvableContentImages.length > 0
    || attachedFiles.length > 0
    || visibleTools.length > 0
    || toolUiInteractions.length > 0
    || knowledgeRefs.length > 0;
  if (!hasPaintableBody && !hasStreamingToolStatus && !showStreamStatus) return null;

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
        <div className="mt-0.5 h-8 w-8 shrink-0 overflow-hidden rounded-full" data-testid="chat-assistant-avatar">
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
          isUser && isEditingUserMessage ? 'max-w-full' : isUser ? 'max-w-[77%]' : 'max-w-full',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {isStreaming && !isUser && streamingTools.length > 0 && (
          <ToolStatusBar tools={streamingTools} />
        )}

        {!isUser && reasoning.length > 0 && (
          <ThinkingReasoning
            items={reasoning}
            streaming={isStreaming && streamStatus?.state === 'thinking'}
          />
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

        {/* Token usage is kept in the hover action row so it does not compete with the reply. */}
        {/* Hover row for user messages */}
        {showUserHoverBar && !isEditingUserMessage && (
          <UserMessageActions
            text={text}
            timestamp={message.timestamp}
            canEdit={Boolean(onResendUserMessage) && canResendUserMessage}
            onEdit={handleStartUserMessageEdit}
            canFork={Boolean(message.id) && Boolean(onForkFromMessage)}
            onFork={() => {
              if (message.id) onForkFromMessage?.(message.id);
            }}
            canCompact={Boolean(message.id) && Boolean(onCompactRange)}
            onCompactFrom={() => {
              if (message.id) onCompactRange?.(message.id, 'from');
            }}
            onCompactTo={() => {
              if (message.id) onCompactRange?.(message.id, 'to');
            }}
          />
        )}

        {/* Hover row for assistant messages */}
        {showAssistantHoverBar && (
          <AssistantHoverBar
            text={text}
            timestamp={message.timestamp}
            imageCopyTarget={imageCopyTarget}
            usage={showStreamStatus ? null : { message, liveUsage, isStreaming }}
          />
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
        <OrbStatus
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
              'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
              isRunning && 'border-primary/25 bg-primary/[0.04] text-foreground',
              !isRunning && !isError && 'border-border/50 text-muted-foreground',
              isError && 'border-destructive/25 text-destructive',
            )}
          >
            {isRunning && <OrbStatus state="syncing" label={tool.name} className="size-3.5 text-primary" />}
            {!isRunning && !isError && <OrbStatus state="success" label={tool.name} className="size-3.5" />}
            {isError && <OrbStatus state="error" label={tool.name} className="size-3.5" />}
            <Wrench className="h-3 w-3 shrink-0 opacity-60" />
            <span className="font-mono text-sm font-medium">{tool.name}</span>
            {duration && <span className="text-xs opacity-60">{tool.summary ? `(${duration})` : duration}</span>}
            {tool.summary && (
              <span className="truncate text-xs opacity-70">{tool.summary}</span>
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
  usage,
}: {
  text: string;
  timestamp?: number;
  imageCopyTarget?: ImageCopyTarget | null;
  usage?: {
    message: RawMessage;
    liveUsage?: ChatMessageProps['liveUsage'];
    isStreaming?: boolean;
  } | null;
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
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate text-xs text-muted-foreground">
          {timestamp ? formatTimestamp(timestamp) : ''}
        </span>
        {usage && (
          <TokenUsageBadge
            message={usage.message}
            liveUsage={usage.liveUsage}
            isStreaming={usage.isStreaming}
          />
        )}
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
  canFork,
  onFork,
  canCompact,
  onCompactFrom,
  onCompactTo,
}: {
  text: string;
  timestamp?: number;
  canEdit: boolean;
  onEdit: () => void;
  canFork: boolean;
  onFork: () => void;
  canCompact: boolean;
  onCompactFrom: () => void;
  onCompactTo: () => void;
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
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-muted-foreground/75 transition-colors duration-150"
        onClick={() => void copyContent()}
        aria-label={copied ? t('messageActions.copied') : t('messageActions.copy')}
        data-testid="chat-user-message-copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-700 dark:text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{copied ? t('messageActions.copied') : t('messageActions.copy')}</TooltipContent>
      </Tooltip>
      {canEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground/75 transition-colors duration-150"
          onClick={onEdit}
          aria-label={t('messageActions.edit')}
          data-testid="chat-user-message-edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{t('messageActions.edit')}</TooltipContent>
        </Tooltip>
      )}
      {canFork && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground/75 transition-colors duration-150"
                onClick={onFork}
                aria-label={t('messageActions.forkFromHere')}
                data-testid="chat-user-message-fork"
              >
                <GitFork className="h-3.5 w-3.5" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{t('messageActions.forkFromHere')}</TooltipContent>
        </Tooltip>
      )}
      {canCompact && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground/75 transition-colors duration-150"
                  onClick={onCompactTo}
                  aria-label={t('messageActions.summarizeUpToHere')}
                  data-testid="chat-user-message-summarize-to"
                >
                  <ArrowUpToLine className="h-3.5 w-3.5" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{t('messageActions.summarizeUpToHere')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground/75 transition-colors duration-150"
                  onClick={onCompactFrom}
                  aria-label={t('messageActions.summarizeFromHere')}
                  data-testid="chat-user-message-summarize-from"
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{t('messageActions.summarizeFromHere')}</TooltipContent>
          </Tooltip>
        </>
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
      className="w-[min(72vw,48rem)] max-w-full rounded-2xl border border-conversation bg-surface-input px-3 py-2.5 shadow-subtle transition-colors duration-150 focus-within:border-conversation-strong"
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
        <Tooltip>
          <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onCancel}
          aria-label={cancelLabel}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/75 transition-[background-color,color] duration-150 hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
          data-testid="chat-user-message-edit-cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
          </TooltipTrigger>
          <TooltipContent side="top">{cancelLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
        <button
          type="submit"
          disabled={!canSubmit}
          aria-label={sendLabel}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/75 transition-[background-color,color] duration-150 hover:bg-black/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
          data-testid="chat-user-message-edit-send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
          </TooltipTrigger>
          <TooltipContent side="top">{sendLabel}</TooltipContent>
        </Tooltip>
      </div>
    </form>
  );
}

/*
 * User bubble. Reference (FakeCoding web/src/components/Conversation.tsx:1110):
 *   `bg-token-foreground/5 max-w-[77%] rounded-2xl px-3 py-2 text-left`
 * — a flat 5% ink wash with no border and no shadow, 12px/8px padding rather
 * than 16px/10px. The v2 branch keeps its tinted glass treatment because that
 * is a deliberate Windows-material divergence, but adopts the same geometry.
 */
function UserMessageBubble({
  text,
}: {
  text: string;
}) {
  return (
    <div
      className={cn(
        'relative min-w-0 overflow-hidden rounded-2xl px-3 py-2 text-left text-foreground transition-colors duration-150',
        'border border-primary/10 bg-primary/[0.07] backdrop-blur-sm dark:border-primary/15 dark:bg-primary/10',
      )}
      data-testid="chat-user-message-bubble"
    >
      <p className="whitespace-pre-wrap break-words text-[14px] font-[445] leading-[22px]">{text}</p>
    </div>
  );
}

// ── Assistant Markdown ──────────────────────────────────────────

/*
 * Code block header. Ported from the reference `markdown-code-toolbar`
 * (FakeCoding web/src/styles.css:8264-8288): 32px min-height, a lowercase
 * language label rather than an uppercase tracked one, and a 24px ghost button.
 * The header and the <pre> below it together form the radius-10 bordered block
 * described by `.markdown-code-block`.
 */
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
      className="mt-3.5 flex min-h-8 items-center justify-between gap-3 rounded-t-[10px] border border-b-0 border-conversation-strong bg-black/[0.02] px-2.5 text-xs lowercase text-conversation-tertiary dark:bg-white/[0.02]"
      data-testid="assistant-code-header"
    >
      <span className="min-w-0 truncate font-mono">{label}</span>
      <Tooltip>
        <TooltipTrigger asChild>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-conversation-tertiary transition-colors hover:bg-black/[0.06] hover:text-foreground dark:hover:bg-white/[0.06]"
        aria-label={copied ? t('markdown.copiedCode') : t('markdown.copyCode')}
        data-testid="assistant-code-copy"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
        </TooltipTrigger>
        <TooltipContent side="top">{copied ? t('markdown.copiedCode') : t('markdown.copyCode')}</TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * Memoized so the markdown tree (including `.prose table`) is rebuilt only when
 * `text` / `isStreaming` actually change. `ChatMessage` re-renders on every
 * periodic status / usage update; without this memo those re-renders rebuild the
 * markdown table element and detach it mid-action, which is the
 * `scrollIntoViewIfNeeded` / screenshot "Element is not attached to the DOM"
 * failure tracked as issue #45. Both props are primitives, so the default
 * shallow comparison is exact.
 */
const AssistantMarkdown = memo(function AssistantMarkdown({
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
          className={cn(
            /* `prose` is retained purely as a locator: eight e2e specs find
             * assistant replies through `.prose`. The visual rules now come from
             * `codex-markdown` (styles/codex-conversation.css), whose two-class
             * descendant selectors outrank the `.prose x` rules in globals.css. */
            'prose w-full max-w-none break-words text-foreground codex-markdown',
            isStreaming && 'codex-markdown-streaming',
          )}
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
                /* Underline styling is inherited from `.codex-markdown a` —
                 * the reference keeps transcript links monochrome. */
                return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
              },
              code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const isInline = !match && !className;
              if (isInline) {
                /* Inline code chrome lives in `.codex-markdown :not(pre) > code`. */
                return <code {...props}>{children}</code>;
              }
              return (
                <code className={cn('font-mono', className)} {...props}>
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
                    /* Bottom half of `.markdown-code-block`: radius 10 to match
                     * the header above, 10px/12px padding, no fill of its own. */
                    'mb-3.5 overflow-x-auto whitespace-pre-wrap break-words rounded-b-[10px] rounded-t-none border border-t-0 border-conversation-strong bg-black/[0.02] px-3 py-2.5 text-conversation-body dark:bg-white/[0.02]',
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
            /* Headings, blockquote, hr, th and td are fully described by
             * codex-conversation.css; overriding them here would only re-open
             * the gap the port closes. The table keeps a wrapper because the
             * reference scrolls wide tables in a `markdown-table-scroll`
             * container (styles.css:8231-8236) rather than clipping them. */
            table({ children, ...props }) {
              return (
                <div className="my-2.5 mb-[18px] max-w-full overflow-x-auto">
                  <table {...props}>{children}</table>
                </div>
              );
            },
            input({ type, checked, ...props }) {
              if (type !== 'checkbox') return <input type={type} checked={checked} {...props} />;
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="mt-1 h-3.5 w-3.5 rounded border-black/20 accent-primary dark:border-white/20"
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
});

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
    <Tooltip>
      <TooltipTrigger asChild>
    <AttachmentRoot
      className={cn(
        'flex min-h-14 w-[min(260px,100%)] items-center gap-3 rounded-lg border border-border bg-background/70 px-3 py-2.5 shadow-sm',
        file.filePath && 'cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/10',
      )}
      onClick={handleOpen}
      data-testid="assistant-attachment-card"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-black/5 text-muted-foreground dark:bg-white/10">
        <FileIcon mimeType={file.mimeType} className="h-4 w-4" />
      </div>
      <AttachmentName name={file.fileName} sublabel={sublabel} />
    </AttachmentRoot>
      </TooltipTrigger>
      {file.filePath && (
        <TooltipContent side="top">{t('assistantRender.attachment.open', { defaultValue: 'Open file' })}</TooltipContent>
      )}
    </Tooltip>
  );
}

function ImagePreviewPlaceholder({ file }: { file: AttachedFileMeta }) {
  const { t } = useTranslation('chat');
  const unavailable = file.previewStatus === 'unavailable';
  const label = unavailable
    ? t('imageGeneration.previewUnavailable')
    : t('imageGeneration.previewLoading');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
    <div
      className={cn(
        'flex h-36 w-36 flex-col items-center justify-center gap-2 rounded-xl border border-black/10 bg-black/5 px-3 text-center text-muted-foreground dark:border-white/10 dark:bg-white/5',
        unavailable && 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
      )}
      data-testid={unavailable ? 'image-preview-unavailable' : 'image-preview-loading'}
    >
      {unavailable ? (
        <AlertCircle className="h-5 w-5 shrink-0" />
      ) : (
        <OrbStatus state="loading" label={label} className="size-5 text-primary" />
      )}
      <span className="text-xs leading-4">{label}</span>
    </div>
      </TooltipTrigger>
      <TooltipContent side="top">{file.fileName}</TooltipContent>
    </Tooltip>
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
            <Tooltip>
              <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
              onClick={handleShowInFolder}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('filePreview.actions.openInFinder')}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('filePreview.actions.close')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>,
    document.body,
  );
}
