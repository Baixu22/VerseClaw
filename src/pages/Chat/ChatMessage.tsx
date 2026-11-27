import { AssistantMarkdown } from '@/components/assistant-render/AssistantMarkdown';
import { assistantPhaseLabels, type AssistantOutputPhase } from './execution-projection';
import { UserMessageBubble } from '@/components/assistant-render/UserMessageBubble';
import { BookOpen } from 'lucide-react';
import { maskChatSecrets } from '@/lib/chat-display-text';
import { UsedKnowledge } from './UsedKnowledge';
/**
 * Chat Message Component
 * Renders user / assistant / system / toolresult messages
 * with markdown and images. Tool steps render in ExecutionGraphCard;
 * streaming runs may show a compact ToolStatusBar. Thinking output is
 * surfaced via ExecutionGraphCard, not inside message bubbles.
 */
import { useState, useCallback, useEffect, memo, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Copy, Check, X, ZoomIn, AlertCircle, Pencil, Send, GitFork, Quote, ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActionBarPrimitive, MessageProvider, type ThreadMessage } from '@assistant-ui/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getTranscriptEntryId } from '@/lib/session-read-model';
import { useTickingNow } from '@/hooks/use-ticking-now';
import { statFile } from '@/lib/file-preview-client';
import { hostApi } from '@/lib/host-api';
import type { RawMessage, AttachedFileMeta } from '@/stores/chat';
import { AgentInteractionRenderer } from '@/components/tool-ui/agent-interactions';
import { CallChip, inferCallChipIcon } from '@/components/tool-ui/shared/call-chip';
import { ThinkingReasoning } from '@/components/assistant-render/ThinkingReasoning';
import { TokenUsageBadge } from '@/components/assistant-render/TokenUsageBadge';
import type { AssistantReasoning } from '@/components/assistant-render/model';
import { KnowledgeDirectiveChip } from '@/components/assistant-render/KnowledgeDirectiveChip';
import { OrbStatus } from '@/components/assistant-ui/orb-status';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { NumberRoll } from '@/components/assistant-ui/number-roll';
import { AttachmentName, AttachmentRoot, AttachmentThumb, DIRECTORY_MIME_TYPE, FileIcon, formatFileSize } from '@/components/assistant-ui/attachment';
import { ConversationImage } from '@/components/assistant-render/resources/ConversationImage';
import { ConversationMediaCard } from '@/components/assistant-render/resources/ConversationMediaCard';
import { ConversationResourceList } from '@/components/assistant-render/resources/ResourceCards';
import { ImageLightbox } from '@/components/assistant-render/resources/ImageLightbox';
import type { AgentSummary } from '@/types/agent';

import { isProducedThisTurn, mediaKindOf, resolveWorkspaceRelativeFiles } from './conversation-resources';
import { formatTimestamp } from './message-utils';
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
  showActions?: boolean;
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
  suppressComposerInteractions?: boolean;
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
  /** Root for artifacts the reply names by relative path. Without one they stay text. */
  workspaceRoot?: string | null;
  onSubmitInteractionResponse?: (text: string) => void;
  onDraftInteractionResponse?: (text: string) => void;
  onQuoteResponse?: (text: string) => void;
  onAskKnowledge?: (text: string) => void;
  canSubmitInteractionResponse?: boolean;
  onResendUserMessage?: (text: string) => void;
  requestUserEdit?: () => boolean;
  canResendUserMessage?: boolean;
  canForkFromMessage?: boolean;
  /**
   * #180: fork from this message's owner transcript entry. Missing identity keeps
   * the action visible but disabled; it never falls back to a provider id or tip.
   */
  onForkFromMessage?: (messageId: string) => void;
  /**
   * #178: summarize a located stretch around this message's transcript entry.
   * 'from' keeps the message (and everything after) verbatim and summarizes the
   * older entries; 'to' folds the head (through the message) into the summary
   * and keeps the newer entries verbatim. Only offered when an entry id exists.
   */
  onCompactRange?: (messageId: string, boundary: 'from' | 'to') => void;
  compactDisabledReason?: string;
  streamStatus?: {
    active: boolean;
    startedAt?: number | null;
    now?: number;
    tokenCount?: number | null;
    state?: AssistantOutputPhase;
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

/**
 * Bounds a batch run: past this, further media in a message are file cards. The
 * player reads bytes into memory, so it is not free to mount dozens of them.
 */
const MAX_INLINE_PLAYERS_PER_MESSAGE = 6;

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
  // Whether a found path is this turn's output is decided after stat; see
  // `isAttachmentConfirmed`. An artifact may come from any tool the turn ran.
  if (mediaKindOf(file)) return true;
  if (isDirectoryAttachment(file)) return true;
  if (isSkillFileAttachment(file)) return true;
  if (isChatPreviewDocument(file)) return true;
  // Paths parsed from the assistant reply (e.g. "/workspace/demo.html") are
  // intentional user-facing links. Generic tool-result markdown attachments
  // (e.g. CHECKLIST.md emitted mid-run) stay folded into the execution graph.
  if (file.source === 'message-ref' && isHtmlOrMarkdownPreview(file)) return true;
  if (file.source === 'message-ref' && /\.(?:docx?|pptx?)$/i.test(file.fileName)) return true;
  return false;
}

function validationKindForAttachment(file: AttachedFileMeta): 'file' | 'dir' | null {
  if (!file.filePath) return null;
  // User-selected uploads and already enriched attachments are trusted enough
  // for immediate display. Regex-derived message refs start at size 0/null and
  // are validated through main-process stat before becoming clickable cards.
  if (file.source !== 'message-ref' && file.source !== 'tool-result') return null;
  // Found audio and video always need the stat: its mtime says whether this turn wrote them.
  const needsProductionCheck = file.source === 'tool-result' && mediaKindOf(file) != null;
  if (!needsProductionCheck && (file.fileSize > 0 || file.preview)) return null;
  return isDirectoryAttachment(file) ? 'dir' : 'file';
}

type PathValidation = { exists: boolean; mtime?: number };

function isAttachmentConfirmed(file: AttachedFileMeta, validated: Record<string, PathValidation>): boolean {
  const kind = validationKindForAttachment(file);
  if (!kind || !file.filePath) return true;
  const result = validated[file.filePath];
  if (!result?.exists) return false;
  return !mediaKindOf(file) || isProducedThisTurn(file, result.mtime);
}

/** Stable identity so `suppressReasoning` never churns downstream memos. */
const EMPTY_REASONING: AssistantReasoning[] = [];

export const ChatMessage = memo(function ChatMessage({
  message,
  textOverride,
  suppressToolCards = false,
  showActions = true,
  suppressProcessAttachments = false,
  suppressAssistantText = false,
  suppressReasoning = false,
  suppressComposerInteractions = false,
  isStreaming = false,
  reasoningOverride,
  streamingTools = [],
  onOpenFile,
  workspaceRoot,
  onSubmitInteractionResponse,
  onDraftInteractionResponse,
  onQuoteResponse,
  onAskKnowledge,
  canForkFromMessage = false,
  canSubmitInteractionResponse = true,
  onResendUserMessage,
  requestUserEdit,
  canResendUserMessage = true,
  onForkFromMessage,
  onCompactRange,
  compactDisabledReason,
  streamStatus,
  liveUsage,
}: ChatMessageProps) {
  const { t } = useTranslation('chat');
  const transcriptEntryId = getTranscriptEntryId(message);
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
      suppressComposerInteractions,
      isStreaming,
      textOverride,
    }),
    [isUser, isStreaming, message, suppressAssistantText, suppressReasoning, suppressToolCards, suppressComposerInteractions, textOverride],
  );
  const text = projection.displayText;
  const actionText = useMemo(() => maskChatSecrets(text), [text]);
  const reasoning = suppressReasoning ? EMPTY_REASONING : reasoningOverride ?? projection.reasoning;
  const hasText = projection.hasText;
  const resolvableContentImages = projection.contentImages;
  const visibleTools = projection.visibleTools;
  const toolUiInteractions = projection.toolUiInteractions;
  const [validatedPaths, setValidatedPaths] = useState<Record<string, PathValidation>>({});
  const knowledgeRefs = projection.knowledgeRefs;
  const derivedAttachedFiles = useMemo(
    () => resolveWorkspaceRelativeFiles(projection.candidateAttachments, workspaceRoot),
    [projection.candidateAttachments, workspaceRoot],
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
              mtime: stat.mtime,
            };
          } catch {
            return { filePath: target.filePath, exists: false };
          }
        }),
      ).then((results) => {
        if (cancelled) return;
        setValidatedPaths((current) => {
          const next = { ...current };
          for (const { filePath, ...result } of results) next[filePath] = result;
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
    () => derivedAttachedFiles.filter((file) => isAttachmentConfirmed(file, validatedPaths)),
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
    () => filteredProcessAttachments.filter((file) => isAttachmentConfirmed(file, validatedPaths)),
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
  const storeAttachedPaths = useMemo(
    () => new Set((message._attachedFiles ?? []).map((file) => file.filePath)),
    [message._attachedFiles],
  );
  const inlinePlayerFiles = useMemo(
    () => new Set(attachedFiles.filter((file) => mediaKindOf(file)).slice(0, MAX_INLINE_PLAYERS_PER_MESSAGE)),
    [attachedFiles],
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
  const showAssistantHoverBar = showActions && !isUser && (hasText || imageCopyTarget != null);
  const showUserHoverBar = isUser && hasText;
  const [isEditingUserMessage, setIsEditingUserMessage] = useState(false);
  const [userEditDraft, setUserEditDraft] = useState(text);
  const [lightboxImg, setLightboxImg] = useState<{ src: string; fileName: string; filePath?: string; base64?: string; mimeType?: string } | null>(null);

  const resendAtEditStart = useRef(onResendUserMessage);
  const handleStartUserMessageEdit = useCallback(() => {
    resendAtEditStart.current = onResendUserMessage;
    setUserEditDraft(text);
    setIsEditingUserMessage(true);
  }, [onResendUserMessage, text]);
  useEffect(() => {
    if (!isUser || !canResendUserMessage || !onResendUserMessage || !requestUserEdit) return;
    const timer = setTimeout(() => { if (requestUserEdit()) handleStartUserMessageEdit(); }, 0);
    return () => clearTimeout(timer);
  }, [canResendUserMessage, handleStartUserMessageEdit, isUser, onResendUserMessage, requestUserEdit]);

  const handleCancelUserMessageEdit = useCallback(() => {
    setUserEditDraft(text);
    setIsEditingUserMessage(false);
  }, [text]);

  const handleSubmitUserMessageEdit = useCallback(() => {
    const nextText = userEditDraft.trim();
    if (!nextText || !canResendUserMessage || !resendAtEditStart.current) return;
    setIsEditingUserMessage(false);
    resendAtEditStart.current(nextText);
  }, [canResendUserMessage, userEditDraft]);

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
    || projection.resources.length > 0
    || visibleTools.length > 0
    || toolUiInteractions.length > 0
    || knowledgeRefs.length > 0;
  if (!hasPaintableBody && !hasStreamingToolStatus && !showStreamStatus) return null;

  return (
    <div
      className={cn(
        'flex min-w-0 group',
        isUser ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {/* Content */}
      <div
        className={cn(
          'flex flex-col w-full min-w-0 space-y-1.5',
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
              if (inlinePlayerFiles.has(file)) {
                return <ConversationMediaCard key={`local-${i}`} file={file} onOpen={onOpenFile} />;
              }
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

        {isUser && <ConversationResourceList resources={projection.resources} />}

        {isUser && knowledgeRefs.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5" data-testid="chat-message-knowledge-refs">
            {knowledgeRefs.map((reference) => (
                <KnowledgeDirectiveChip key={reference.id} reference={reference} />
              ))}
          </div>
        )}
        {isUser && <UsedKnowledge runId={message._knowledgeRunId} references={knowledgeRefs} requestedCount={message._knowledgeRequestedCount} />}

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
              <UserMessageBubble text={text} allowSidePreview />
            )
          ) : (
            <AssistantMarkdown text={text} isStreaming={isStreaming} allowSidePreview />
          )
        )}

        {showStreamStatus && (
          <AssistantStreamStatusBar status={streamStatus} />
        )}

        {!isUser && toolUiInteractions.length > 0 && (
          <AgentInteractionRenderer
            interactions={toolUiInteractions}
            compactProcess
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
          <div className="flex w-full flex-wrap gap-2">
            {attachedFiles.map((file, i) => {
              const isImage = file.mimeType.startsWith('image/');
              if (inlinePlayerFiles.has(file)) {
                return <ConversationMediaCard key={`local-${i}`} file={file} onOpen={onOpenFile} />;
              }
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
                // A relative mention never reached the store's preview loader, so
                // there is nothing to wait for: resolve it here.
                return file.filePath && !storeAttachedPaths.has(file.filePath)
                  ? <ConversationImage key={`local-${i}`} url={file.filePath} alt={file.fileName} mimeType={file.mimeType} />
                  : <ImagePreviewPlaceholder key={`local-${i}`} file={file} />;
              }
              return <FileCard key={`local-${i}`} file={file} onOpen={onOpenFile} />;
            })}
          </div>
        )}

        {!isUser && (
          <ConversationResourceList
            resources={projection.resources}
            onOpenFilePath={handleOpenToolUiFilePath}
            allowSidePreview
          />
        )}

        {/* Token usage is kept in the hover action row so it does not compete with the reply. */}
        {/* Hover row for user messages */}
        {showUserHoverBar && !isEditingUserMessage && (
          <UserMessageActions
            text={actionText}
            timestamp={message.timestamp}
            canEdit={Boolean(onResendUserMessage) && canResendUserMessage}
            onEdit={handleStartUserMessageEdit}
            showFork={Boolean(onForkFromMessage)}
            canFork={Boolean(transcriptEntryId) && Boolean(onForkFromMessage) && canResendUserMessage && !isStreaming}
            forkDisabledReason={!transcriptEntryId ? t('messageActions.forkMissingBoundary')
              : !canResendUserMessage || isStreaming ? t('messageActions.forkUnavailable') : undefined}
            onFork={() => {
              if (transcriptEntryId && canResendUserMessage && !isStreaming) onForkFromMessage?.(transcriptEntryId);
            }}
            canCompact={Boolean(transcriptEntryId) && Boolean(onCompactRange)}
            compactDisabledReason={compactDisabledReason}
            onCompactFrom={() => {
              if (transcriptEntryId) onCompactRange?.(transcriptEntryId, 'from');
            }}
            onCompactTo={() => {
              if (transcriptEntryId) onCompactRange?.(transcriptEntryId, 'to');
            }}
          />
        )}

        {/* Hover row for assistant messages */}
        {showAssistantHoverBar && (
          <AssistantHoverBar
            text={actionText}
            timestamp={message.timestamp}
            imageCopyTarget={imageCopyTarget}
            usage={showStreamStatus ? null : { message, liveUsage, isStreaming }}
            onQuoteResponse={!isStreaming ? onQuoteResponse : undefined}
            onAskKnowledge={!isStreaming ? onAskKnowledge : undefined}
            onFork={
              canForkFromMessage && transcriptEntryId && onForkFromMessage && canResendUserMessage && !isStreaming
                ? () => onForkFromMessage(transcriptEntryId)
                : undefined
            }
          />
        )}
      </div>

      {/* Image lightbox portal */}
      {lightboxImg && (
        <ImageLightbox
          src={lightboxImg.src}
          fileName={lightboxImg.fileName}
          filePath={lightboxImg.filePath}
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
  // Keep the 1 Hz clock inside the small status bar. Previously the page held
  // this state, so every tick re-rendered the whole Chat tree.
  const now = useTickingNow(status.active);
  const elapsed = formatElapsedSeconds(status.startedAt, now);
  const tokenCount = status.tokenCount ?? 0;
  const phase = status.state ?? 'working';
  const label = t(assistantPhaseLabels[phase]);
  const dotState = phase === 'tools' ? 'working' : phase;

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
          {label}
        </Shimmer>
      ) : (
        <>
          <OrbStatus
            state={dotState}
            label={label}
            className="size-4 shrink-0 text-primary"
            data-testid="assistant-stream-status-dot"
          />
          <span>{label}</span>
        </>
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
  const { t } = useTranslation('chat');
  return (
    <div className="w-full space-y-1" data-testid="chat-streaming-tool-status-bar">
      {tools.map((tool) => {
        const chipStatus = tool.status === 'completed'
          ? 'done' as const
          : tool.status === 'error'
            ? 'error' as const
            : 'running' as const;
        return (
          <CallChip
            key={tool.toolCallId || tool.id || tool.name}
            name={tool.name}
            argument={tool.summary}
            status={chipStatus}
            icon={inferCallChipIcon(tool.name)}
            durationMs={tool.durationMs}
            statusLabel={t(`taskPanel.stepStatus.${tool.status}`)}
          />
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

// ── Assistant response actions ─

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
  onQuoteResponse,
  onAskKnowledge,
  onFork,
}: {
  text: string;
  timestamp?: number;
  imageCopyTarget?: ImageCopyTarget | null;
  onQuoteResponse?: (text: string) => void;
  onAskKnowledge?: (text: string) => void;
  onFork?: () => void;
  usage?: {
    message: RawMessage;
    liveUsage?: ChatMessageProps['liveUsage'];
    isStreaming?: boolean;
  } | null;
}) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(async () => {
    try {
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
    } catch {
      toast.error(t('messageActions.copyFailed'));
    }
  }, [text, imageCopyTarget, t]);

  return (
    <AssistantUiGhostActionBar
      role="assistant"
      text={text}
      timestamp={timestamp}
      testId="chat-assistant-message-actions"
      className="flex h-6 w-fit max-w-full min-w-0 translate-y-0.5 items-center justify-start gap-1 px-1 opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 [@media(hover:none)]:!translate-y-0 [@media(hover:none)]:!opacity-100 motion-reduce:transition-none"
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground/75"
              onClick={copyContent}
              aria-label={copied ? t('messageActions.copied') : t('messageActions.copy')}
              data-testid="chat-assistant-message-copy"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-700 dark:text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{copied ? t('messageActions.copied') : t('messageActions.copy')}</TooltipContent>
        </Tooltip>
        {onQuoteResponse && text.trim() && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground/75"
                onClick={() => onQuoteResponse(text)}
                aria-label={t('messageActions.quoteResponse')}
                data-testid="chat-assistant-message-quote"
              >
                <Quote className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('messageActions.quoteResponse')}</TooltipContent>
          </Tooltip>
        )}
        {onAskKnowledge && text.trim() && <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground/75"
              data-testid="chat-ask-knowledge-about-reply" onClick={() => onAskKnowledge(text)}
              aria-label={t('conversation.askReply', { ns: 'knowledge' })}><BookOpen className="h-3.5 w-3.5" /></Button>
          </TooltipTrigger>
          <TooltipContent>{t('conversation.askReply', { ns: 'knowledge' })}</TooltipContent>
        </Tooltip>}
        {onFork && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground/75"
                onClick={onFork}
                aria-label={t('messageActions.forkFromResponse')}
                data-testid="chat-assistant-message-fork"
              >
                <GitFork className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('messageActions.forkFromResponse')}</TooltipContent>
          </Tooltip>
        )}
      </div>
      {(timestamp || usage) && (
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {timestamp ? <span className="truncate">{formatTimestamp(timestamp)}</span> : null}
          {usage && (
            <TokenUsageBadge
              message={usage.message}
              liveUsage={usage.liveUsage}
              isStreaming={usage.isStreaming}
            />
          )}
        </span>
      )}
    </AssistantUiGhostActionBar>
  );
}

// ── User Message Bubble ─────────────────────────────────────────

function UserMessageActions({
  text,
  timestamp,
  canEdit,
  onEdit,
  showFork,
  canFork,
  forkDisabledReason,
  onFork,
  canCompact,
  compactDisabledReason,
  onCompactFrom,
  onCompactTo,
}: {
  text: string;
  timestamp?: number;
  canEdit: boolean;
  onEdit: () => void;
  showFork: boolean;
  canFork: boolean;
  forkDisabledReason?: string;
  onFork: () => void;
  canCompact: boolean;
  compactDisabledReason?: string;
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
      {showFork && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex" tabIndex={!canFork ? 0 : undefined}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground/75 transition-colors duration-150"
                disabled={!canFork}
                aria-description={forkDisabledReason}
                onClick={onFork}
                aria-label={t('messageActions.forkFromHere')}
                data-testid="chat-user-message-fork"
              >
                <GitFork className="h-3.5 w-3.5" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{forkDisabledReason ?? t('messageActions.forkFromHere')}</TooltipContent>
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
                  disabled={Boolean(compactDisabledReason)}
                  title={compactDisabledReason}
                  aria-label={t('messageActions.summarizeUpToHere')}
                  data-testid="chat-user-message-summarize-to"
                >
                  <ArrowUpToLine className="h-3.5 w-3.5" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{compactDisabledReason ?? t('messageActions.summarizeUpToHere')}</TooltipContent>
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
                  disabled={Boolean(compactDisabledReason)}
                  title={compactDisabledReason}
                  aria-label={t('messageActions.summarizeFromHere')}
                  data-testid="chat-user-message-summarize-from"
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{compactDisabledReason ?? t('messageActions.summarizeFromHere')}</TooltipContent>
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
