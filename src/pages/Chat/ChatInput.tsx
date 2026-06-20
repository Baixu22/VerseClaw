/**
 * Chat Input Component
 * Textarea with send button and universal file upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged to disk via IPC — only lightweight path references
 * are sent with the message (no base64 over WebSocket).
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Archive,
  AtSign,
  BookOpen,
  Briefcase,
  Check,
  ChevronDown,
  File,
  FileArchive,
  FileText,
  Film,
  FolderOpen,
  FolderPlus,
  GitBranchPlus,
  Loader2,
  MessageSquarePlus,
  Music,
  Paperclip,
  Search,
  SendHorizontal,
  Shield,
  Square,
  Wrench,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { buildPreviewTarget } from '@/components/file-preview/build-preview-target';
import { useProviderStore } from '@/stores/providers';
import { buildConfiguredModelOptions, formatModelRefLabel } from '@/lib/model-options';
import type { AgentSummary } from '@/types/agent';
import type { QuickAccessSkill } from '@/types/skill';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { collectDroppedFiles } from '@/lib/collect-dropped-files';
import { fetchQuickAccessSkills } from '@/lib/quick-access-skills';
import { ChatAgentEffortButton } from '@/components/chat/ChatAgentEffortPopover';
import {
  buildCapabilityActionMessage,
  executeChatCapabilityActions,
  hasSuccessfulCapabilityResult,
  resolveChatCapabilityActions,
  shouldRunChatCapabilityPreflight,
  type ChatCapabilityPlanResolution,
} from '@/lib/chat-capability-actions';
import { isCapabilityAuditBlocked } from '@/lib/capability-audit';
import type { LiveTokenUsage, WorkspaceContextRange, WorkspaceKnowledgeScope, WorkspacePermissionMode, WorkspaceProfile } from '@shared/types/workspace';
import type { WorkModeId } from '@shared/types/work-mode';
import type { ChatCapabilityActionPlan, ChatCapabilityActionResult, SessionCompactionStatus } from '@shared/host-api/contract';
import type { LongTaskControlStatus } from '@shared/types/long-task-control';
import type { SessionContinuityRecommendation } from './session-continuity';

// ── Types ────────────────────────────────────────────────────────

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;        // disk path for gateway
  preview: string | null;    // data URL for images, null for others
  status: 'staging' | 'ready' | 'error';
  error?: string;
}

interface ChatInputProps {
  onSend: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null, knowledgeScope?: WorkspaceKnowledgeScope, workMode?: WorkModeId) => void;
  onStop?: () => void;
  disabled?: boolean;
  sending?: boolean;
  workspace?: WorkspaceProfile | null;
  contextRange?: WorkspaceContextRange | null;
  liveUsage?: LiveTokenUsage | null;
  messageCount?: number;
  draftValue?: string;
  onDraftChange?: (value: string) => void;
  onPermissionModeChange?: (mode: WorkspacePermissionMode) => void;
  onPickWorkspaceFolder?: () => void;
  onSwitchAgent?: (agentId: string) => void | Promise<void>;
  onNewSession?: () => void | Promise<void>;
  onForkSession?: () => void | Promise<void>;
  onHandoffSession?: () => void | Promise<void>;
  continuityRecommendation?: SessionContinuityRecommendation;
  forkDisabled?: boolean;
  forkBusy?: boolean;
  handoffDisabled?: boolean;
  handoffBusy?: boolean;
  knowledgeScope?: WorkspaceKnowledgeScope;
  onKnowledgeScopeChange?: (scope: WorkspaceKnowledgeScope) => void | Promise<void>;
  workMode?: WorkModeId;
  compactionStatus?: SessionCompactionStatus | null;
  compactionBusy?: boolean;
  onManualCompact?: (customInstructions?: string) => Promise<void>;
  longTaskControlStatus?: LongTaskControlStatus | null;
  queueDrainBusy?: boolean;
  onDrainQueuedFollowup?: () => Promise<void>;
}

type PendingCapabilitySend = {
  text: string;
  attachments?: FileAttachment[];
  targetAgentId: string | null;
  knowledgeScope: WorkspaceKnowledgeScope;
  workMode: WorkModeId;
  plan: ChatCapabilityActionPlan[];
  results: ChatCapabilityActionResult[];
};

// ── Helpers ──────────────────────────────────────────────────────

const DIRECTORY_MIME_TYPE = 'application/x-directory';
const WORKSPACE_PERMISSION_MODES: WorkspacePermissionMode[] = ['readOnly', 'plan', 'acceptEdits', 'fullAccess'];
const KNOWLEDGE_SCOPES: WorkspaceKnowledgeScope[] = ['none', 'memory', 'wiki', 'all'];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const absolute = Math.abs(value);
  if (absolute < 1000) return `${Math.round(value)}`;
  if (absolute < 1_000_000) {
    const compact = value / 1000;
    return `${compact >= 10 ? compact.toFixed(0) : compact.toFixed(1)}k`;
  }
  const compact = value / 1_000_000;
  return `${compact >= 10 ? compact.toFixed(0) : compact.toFixed(1)}m`;
}

function formatCompactionDate(value?: number): string {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

function getSkillPrefix(skillName: string): string {
  return `/${skillName}  `;
}

function needsLeadingSkillSpace(value: string, position: number): boolean {
  return position > 0 && !/\s/.test(value[position - 1] ?? '');
}

type SkillTokenRange = { start: number; end: number };

function findSkillTokenRange(value: string, skillName: string): SkillTokenRange | null {
  const token = getSkillPrefix(skillName);
  const start = value.indexOf(token);
  if (start === -1) return null;
  return { start, end: start + token.length };
}

function findSkillTokenRanges(value: string): SkillTokenRange[] {
  const ranges: SkillTokenRange[] = [];
  const skillTokenPattern = /\/[^\s]+ {2}/g;
  let match: RegExpExecArray | null;
  while ((match = skillTokenPattern.exec(value)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function removeSkillToken(value: string, skillName: string): string {
  const range = findSkillTokenRange(value, skillName);
  if (!range) return value;
  return `${value.slice(0, range.start)}${value.slice(range.end)}`;
}

const SKILL_TOKEN_BUTTON_CLASS =
  'rounded-md bg-skill-bg/14 text-skill-fg [-webkit-box-decoration-break:clone] [box-decoration-break:clone] [text-shadow:0_0_10px_rgba(47,107,255,0.38)] dark:bg-skill-bg/18 dark:text-skill-fg-dark dark:[text-shadow:0_0_12px_rgba(37,99,235,0.42)]';

function renderHighlightedComposerText(
  value: string,
  tokenRanges: SkillTokenRange[],
  options: { onPreviewSkill: (skillName: string) => void; previewTooltip: string },
) {
  if (tokenRanges.length === 0) {
    return <>{value}{value.endsWith('\n') ? '\n' : '\u200b'}</>;
  }

  const chunks: React.ReactNode[] = [];
  let cursor = 0;

  for (const tokenRange of tokenRanges) {
    const token = value.slice(tokenRange.start, tokenRange.end);
    const tokenLabel = token.trimEnd();
    const tokenTrailingSpace = token.slice(tokenLabel.length);
    const skillName = tokenLabel.startsWith('/') ? tokenLabel.slice(1) : tokenLabel;

    if (tokenRange.start > cursor) {
      chunks.push(value.slice(cursor, tokenRange.start));
    }
    chunks.push(
      <button
        key={`skill-token-${tokenRange.start}`}
        type="button"
        data-testid="chat-composer-skill-token"
        data-skill-name={skillName}
        title={options.previewTooltip}
        className={cn(
          'inline h-auto border-0 p-0 font-inherit leading-inherit',
          'pointer-events-auto cursor-pointer underline-offset-2 hover:underline',
          'text-left align-baseline shadow-none transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-0',
          SKILL_TOKEN_BUTTON_CLASS,
        )}
        onMouseDown={(event) => {
          // Keep focus in the textarea while still receiving the click.
          event.preventDefault();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          options.onPreviewSkill(skillName);
        }}
      >
        {tokenLabel}
      </button>,
      tokenTrailingSpace,
    );
    cursor = tokenRange.end;
  }

  if (cursor < value.length) {
    chunks.push(value.slice(cursor));
  }
  chunks.push(value.endsWith('\n') ? '\n' : '\u200b');

  return <>{chunks}</>;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType === DIRECTORY_MIME_TYPE) return <FolderOpen className={className} />;
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

/**
 * Read a browser File object as base64 string (without the data URL prefix).
 */
function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────────────────

export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  sending = false,
  contextRange,
  liveUsage,
  messageCount,
  draftValue,
  onDraftChange,
  workspace,
  onPermissionModeChange,
  onPickWorkspaceFolder,
  onSwitchAgent,
  onNewSession,
  onForkSession,
  onHandoffSession,
  continuityRecommendation,
  forkDisabled = false,
  forkBusy = false,
  handoffDisabled = false,
  handoffBusy = false,
  knowledgeScope = 'none',
  onKnowledgeScopeChange,
  workMode = 'build',
  compactionStatus,
  compactionBusy = false,
  onManualCompact,
  longTaskControlStatus,
  queueDrainBusy = false,
  onDrainQueuedFollowup,
}: ChatInputProps) {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState(() => draftValue ?? '');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false);
  const [workspaceActionsOpen, setWorkspaceActionsOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [quickSkills, setQuickSkills] = useState<QuickAccessSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<QuickAccessSkill | null>(null);
  const [switchingModelRef, setSwitchingModelRef] = useState<string | null>(null);
  const [optimisticModelRef, setOptimisticModelRef] = useState<string | null>(null);
  const [compactionDialogOpen, setCompactionDialogOpen] = useState(false);
  const [compactionInstructions, setCompactionInstructions] = useState('');
  const [pendingCapabilitySend, setPendingCapabilitySend] = useState<PendingCapabilitySend | null>(null);
  const [capabilityExecuting, setCapabilityExecuting] = useState(false);
  const pendingCapabilityAuditBlocked = useMemo(
    () => pendingCapabilitySend?.plan.some((action) => isCapabilityAuditBlocked(action.auditResult)) ?? false,
    [pendingCapabilitySend],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const knowledgePickerRef = useRef<HTMLDivElement>(null);
  const workspaceActionsRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const lastDraftValueRef = useRef(draftValue);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const agents = useAgentsStore((s) => s.agents);
  const updateAgentModel = useAgentsStore((s) => s.updateAgentModel);
  const defaultModelRef = useAgentsStore((s) => s.defaultModelRef);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerDefaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const currentAgentName = useMemo(
    () => currentAgent?.name ?? currentAgentId,
    [currentAgent, currentAgentId],
  );
  const modelOptions = useMemo(
    () => buildConfiguredModelOptions(providerAccounts, providerStatuses, providerDefaultAccountId),
    [providerAccounts, providerDefaultAccountId, providerStatuses],
  );
  const effectiveModelRef = optimisticModelRef || currentAgent?.modelRef || defaultModelRef || modelOptions[0]?.modelRef || null;
  const currentModelLabel = formatModelRefLabel(effectiveModelRef);
  const mentionableAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  );
  const selectedTarget = useMemo(
    () => (agents ?? []).find((agent) => agent.id === targetAgentId) ?? null,
    [agents, targetAgentId],
  );
  const filteredQuickSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return quickSkills;
    return quickSkills.filter((skill) =>
      skill.name.toLowerCase().includes(query)
      || skill.description.toLowerCase().includes(query)
      || skill.sourceLabel.toLowerCase().includes(query),
    );
  }, [quickSkills, skillQuery]);
  const showAgentPicker = mentionableAgents.length > 0;
  const showModelPicker = modelOptions.length > 1;
  const showWorkspaceActions = Boolean(
    workspace
    || onPickWorkspaceFolder
    || onPermissionModeChange
    || onSwitchAgent
    || onNewSession,
  );
  const chatComposerStatusComponents = rendererExtensionRegistry.getChatComposerStatusComponents();
  const isGatewayUsable = gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false;
  const inputDisabled = disabled || !isGatewayUsable;
  const skillTokenRanges = useMemo(() => findSkillTokenRanges(input), [input]);
  const openArtifactPreview = useArtifactPanel((s) => s.openPreview);

  const updateInput = useCallback((value: string) => {
    setInput(value);
    onDraftChange?.(value);
  }, [onDraftChange]);

  const composerContextParts = useMemo(() => {
    const parts: string[] = [];
    const normalizedMessageCount = messageCount ?? 0;
    if (normalizedMessageCount > 0) {
      parts.push(t('composer.messageCount', { count: normalizedMessageCount }));
    }

    const usedTokens = liveUsage?.totalTokens ?? contextRange?.usedTokens ?? null;
    const maxTokens = contextRange?.maxTokens ?? null;
    if (usedTokens != null && usedTokens > 0) {
      parts.push(maxTokens != null && maxTokens > 0
        ? t('composer.tokenUsageWithLimit', {
          used: formatCompactNumber(usedTokens),
          max: formatCompactNumber(maxTokens),
        })
        : t('composer.tokenUsage', {
          tokens: formatCompactNumber(usedTokens),
        }));
    }

    const truncatedMessages = contextRange?.truncatedMessageCount ?? 0;
    if (truncatedMessages > 0) {
      parts.push(t('composer.contextHidden', { count: truncatedMessages }));
    }

    return parts;
  }, [contextRange?.maxTokens, contextRange?.truncatedMessageCount, contextRange?.usedTokens, liveUsage?.totalTokens, messageCount, t]);

  const compactionUsedTokens = compactionStatus?.usedTokens ?? liveUsage?.totalTokens ?? contextRange?.usedTokens ?? null;
  const compactionMaxTokens = compactionStatus?.maxTokens ?? contextRange?.maxTokens ?? null;
  const compactionHiddenCount = compactionStatus?.truncatedMessageCount ?? contextRange?.truncatedMessageCount ?? 0;
  const compactionLastDate = formatCompactionDate(compactionStatus?.lastCompaction?.timestamp);
  const compactDisabledReason = useMemo(() => {
    if (!onManualCompact) return t('composer.compaction.unavailable');
    if (compactionBusy || compactionStatus?.inProgress) return t('composer.compaction.inProgress');
    if (sending) return t('composer.compaction.activeRun');
    if (!compactionStatus?.available) return t('composer.compaction.unavailable');
    if (compactionStatus.canCompact === false) {
      const reason = compactionStatus.reason ? t(`composer.compaction.reason.${compactionStatus.reason}`, { defaultValue: compactionStatus.reason }) : t('composer.compaction.unavailable');
      return reason;
    }
    return null;
  }, [compactionBusy, compactionStatus?.available, compactionStatus?.canCompact, compactionStatus?.inProgress, compactionStatus?.reason, onManualCompact, sending, t]);
  const compactDisabled = Boolean(compactDisabledReason);
  const compactAttention = compactionStatus?.pressure === 'high';
  const queuedFollowupCount = longTaskControlStatus?.queueCount ?? 0;
  const recommendedContinuityAction = continuityRecommendation?.action ?? 'fork';
  const composerContinuityAction = recommendedContinuityAction === 'handoff' && onHandoffSession
    ? {
      id: 'handoff' as const,
      testId: 'chat-composer-handoff',
      busy: handoffBusy,
      disabled: handoffDisabled,
      onClick: onHandoffSession,
      icon: FileText,
    }
    : onForkSession
      ? {
        id: 'fork' as const,
        testId: 'chat-composer-fork',
        busy: forkBusy,
        disabled: forkDisabled,
        onClick: onForkSession,
        icon: GitBranchPlus,
      }
      : onHandoffSession
        ? {
          id: 'handoff' as const,
          testId: 'chat-composer-handoff',
          busy: handoffBusy,
          disabled: handoffDisabled,
          onClick: onHandoffSession,
          icon: FileText,
        }
        : null;
  const composerContinuityTooltip = composerContinuityAction
    ? composerContinuityAction.disabled
      ? t(`composer.${composerContinuityAction.id}.disabledActiveRun`)
      : t(`composer.continuity.tooltip.${composerContinuityAction.id}.${continuityRecommendation?.reason ?? 'default'}`, {
        defaultValue: t(`composer.${composerContinuityAction.id}.tooltip`),
      })
    : '';
  const ComposerContinuityIcon = composerContinuityAction?.icon ?? GitBranchPlus;
  const wikiQuickActive = knowledgeScope === 'wiki';

  const handleQuickWikiToggle = useCallback(() => {
    if (!onKnowledgeScopeChange) return;
    void onKnowledgeScopeChange(wikiQuickActive ? 'none' : 'wiki');
    setKnowledgePickerOpen(false);
    setPickerOpen(false);
    setSkillPickerOpen(false);
    setWorkspaceActionsOpen(false);
    setModelPickerOpen(false);
    textareaRef.current?.focus();
  }, [onKnowledgeScopeChange, wikiQuickActive]);

  const handleConfirmCompaction = useCallback(async () => {
    if (!onManualCompact || compactDisabled) return;
    await onManualCompact(compactionInstructions.trim() || undefined);
    setCompactionInstructions('');
    setCompactionDialogOpen(false);
  }, [compactDisabled, compactionInstructions, onManualCompact]);

  useEffect(() => {
    if (draftValue === lastDraftValueRef.current) return;
    lastDraftValueRef.current = draftValue;
    setInput(draftValue ?? '');
  }, [draftValue]);

  useEffect(() => {
    void refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    if (gatewayStatus.state === 'running') return;
    let cancelled = false;
    hostApi.gateway.status()
      .then((status) => {
        if (cancelled) return;
        if (status.state === 'running') {
          void refreshProviderSnapshot();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gatewayStatus.state, refreshProviderSnapshot]);

  useEffect(() => {
    setOptimisticModelRef(null);
  }, [currentAgent?.modelRef, currentAgentId]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
    }
  }, [input]);

  // Focus textarea on mount (avoids Windows focus loss after session delete + native dialog)
  useEffect(() => {
    if (!inputDisabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [inputDisabled]);

  useEffect(() => {
    if (!targetAgentId) return;
    if (targetAgentId === currentAgentId) {
      setTargetAgentId(null);
      setPickerOpen(false);
      return;
    }
    if (!(agents ?? []).some((agent) => agent.id === targetAgentId)) {
      setTargetAgentId(null);
      setPickerOpen(false);
    }
  }, [agents, currentAgentId, targetAgentId]);

  useEffect(() => {
    if (!pickerOpen && !skillPickerOpen && !modelPickerOpen && !workspaceActionsOpen && !knowledgePickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideAgentPicker = pickerRef.current?.contains(target);
      const insideSkillPicker = skillPickerRef.current?.contains(target);
      const insideModelPicker = modelPickerRef.current?.contains(target);
      const insideKnowledgePicker = knowledgePickerRef.current?.contains(target);
      const insideWorkspaceActions = workspaceActionsRef.current?.contains(target);
      if (!insideAgentPicker && !insideSkillPicker && !insideModelPicker && !insideKnowledgePicker && !insideWorkspaceActions) {
        setPickerOpen(false);
        setSkillPickerOpen(false);
        setModelPickerOpen(false);
        setKnowledgePickerOpen(false);
        setWorkspaceActionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [knowledgePickerOpen, modelPickerOpen, pickerOpen, skillPickerOpen, workspaceActionsOpen]);

  useEffect(() => {
    setSelectedSkill((prev) => {
      if (prev) {
        setInput((currentInput) => removeSkillToken(currentInput, prev.name));
      }
      return null;
    });
    setSkillPickerOpen(false);
    setSkillQuery('');
    setQuickSkills([]);
    setSkillsError(null);
  }, [currentAgentId]);

  useEffect(() => {
    if (!selectedSkill) return;
    const tokenRange = findSkillTokenRange(input, selectedSkill.name);
    if (!tokenRange) {
      setSelectedSkill(null);
    }
  }, [input, selectedSkill]);

  const handleInputChange = useCallback((value: string) => {
    updateInput(value);
  }, [updateInput]);

  const moveCaretTo = useCallback((position: number) => {
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(position, position);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    });
  }, []);

  const normalizeSelectionAroundSkill = useCallback(() => {
    if (skillTokenRanges.length === 0) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? 0;
    if (selectionStart !== selectionEnd) return;
    const tokenRange = skillTokenRanges.find((range) => selectionStart > range.start && selectionStart < range.end);
    if (tokenRange) {
      moveCaretTo(tokenRange.end);
    }
  }, [moveCaretTo, skillTokenRanges]);

  const loadQuickSkills = useCallback(async (): Promise<QuickAccessSkill[]> => {
    if (!currentAgent) {
      setQuickSkills([]);
      setSkillsError(null);
      return [];
    }
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const result = await fetchQuickAccessSkills({
        workspace: currentAgent.workspace,
        agentDir: currentAgent.agentDir,
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to load skills');
      }
      const list = result.skills || [];
      setQuickSkills(list);
      return list;
    } catch (error) {
      setQuickSkills([]);
      setSkillsError(String(error));
      return [];
    } finally {
      setSkillsLoading(false);
    }
  }, [currentAgent]);

  const handleSkillTokenPreview = useCallback(async (skillName: string) => {
    let list = quickSkills;
    if (list.length === 0 && currentAgent) {
      list = await loadQuickSkills();
    }
    const skill = list.find((entry) => entry.name === skillName);
    if (!skill) {
      toast.error(
        t('composer.skillPreviewNotFound', 'Could not find this skill. Open the skill picker to refresh the list.'),
      );
      return;
    }
    openArtifactPreview(buildPreviewTarget(skill.manifestPath));
  }, [quickSkills, currentAgent, loadQuickSkills, openArtifactPreview, t]);

  useEffect(() => {
    if (!skillPickerOpen) return;
    void loadQuickSkills();
  }, [skillPickerOpen, loadQuickSkills]);

  const handleSelectModel = useCallback(async (modelRef: string) => {
    if (!currentAgent || switchingModelRef) return;
    if (modelRef === effectiveModelRef) {
      setModelPickerOpen(false);
      textareaRef.current?.focus();
      return;
    }

    const previousModelRef = effectiveModelRef;
    const desiredOverride = modelRef === (defaultModelRef || '').trim() ? null : modelRef;
    setSwitchingModelRef(modelRef);
    setOptimisticModelRef(modelRef);
    setModelPickerOpen(false);
    try {
      await updateAgentModel(currentAgent.id, desiredOverride);
    } catch (error) {
      setOptimisticModelRef(previousModelRef);
      toast.error(t('composer.modelSwitchFailed', { error: String(error) }));
    } finally {
      setSwitchingModelRef(null);
      textareaRef.current?.focus();
    }
  }, [currentAgent, defaultModelRef, effectiveModelRef, switchingModelRef, t, updateAgentModel]);

  const handleWorkspaceAction = useCallback((action: () => void | Promise<void>) => {
    setWorkspaceActionsOpen(false);
    void Promise.resolve(action()).catch((error) => {
      toast.error(t('composer.workspaceActionFailed', { error: String(error) }));
    });
  }, [t]);

  // ── File staging via native dialog / Electron drag-drop paths ──

  const stagePathFiles = useCallback(async (filePaths: string[]) => {
    if (filePaths.length === 0) return;

    const tempIds: string[] = [];
    for (const filePath of filePaths) {
      const tempId = crypto.randomUUID();
      tempIds.push(tempId);
      const fileName = filePath.split(/[\\/]/).pop() || 'file';
      setAttachments(prev => [...prev, {
        id: tempId,
        fileName,
        mimeType: '',
        fileSize: 0,
        stagedPath: '',
        preview: null,
        status: 'staging' as const,
      }]);
    }

    try {
      console.log('[stagePathFiles] Staging files:', filePaths);
      const staged = await hostApi.files.stagePaths({ filePaths });
      console.log('[stagePathFiles] Stage result:', staged?.map(s => ({ id: s?.id, fileName: s?.fileName, mimeType: s?.mimeType, fileSize: s?.fileSize, stagedPath: s?.stagedPath, hasPreview: !!s?.preview })));

      setAttachments(prev => {
        let updated = [...prev];
        for (let i = 0; i < tempIds.length; i++) {
          const tempId = tempIds[i];
          const data = staged[i];
          if (data) {
            updated = updated.map(a =>
              a.id === tempId
                ? { ...data, status: 'ready' as const }
                : a,
            );
          } else {
            console.warn(`[stagePathFiles] No staged data for tempId=${tempId} at index ${i}`);
            updated = updated.map(a =>
              a.id === tempId
                ? { ...a, status: 'error' as const, error: 'Staging failed' }
                : a,
            );
          }
        }
        return updated;
      });
    } catch (err) {
      console.error('[stagePathFiles] Failed to stage files:', err);
      setAttachments(prev => prev.map(a =>
        a.status === 'staging'
          ? { ...a, status: 'error' as const, error: String(err) }
          : a,
      ));
    }
  }, []);

  const pickFiles = useCallback(async () => {
    try {
      const result = await hostApi.dialog.open({
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled || !result.filePaths?.length) return;
      await stagePathFiles(result.filePaths);
    } catch (err) {
      console.error('[pickFiles] Failed to open file dialog:', err);
    }
  }, [stagePathFiles]);

  // ── Stage browser File objects (paste / drag-drop) ─────────────

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    for (const file of files) {
      const tempId = crypto.randomUUID();
      setAttachments(prev => [...prev, {
        id: tempId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        stagedPath: '',
        preview: null,
        status: 'staging' as const,
      }]);

      try {
        console.log(`[stageBuffer] Reading file: ${file.name} (${file.type}, ${file.size} bytes)`);
        const base64 = await readFileAsBase64(file);
        console.log(`[stageBuffer] Base64 length: ${base64?.length ?? 'null'}`);
        const staged = await hostApi.files.stageBuffer({
          base64,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        });
        console.log(`[stageBuffer] Staged: id=${staged?.id}, path=${staged?.stagedPath}, size=${staged?.fileSize}`);
        setAttachments(prev => prev.map(a =>
          a.id === tempId ? { ...staged, status: 'ready' as const } : a,
        ));
      } catch (err) {
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        setAttachments(prev => prev.map(a =>
          a.id === tempId
            ? { ...a, status: 'error' as const, error: String(err) }
            : a,
        ));
      }
    }
  }, []);

  // ── Attachment management ──────────────────────────────────────

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const allReady = attachments.length === 0 || attachments.every(a => a.status === 'ready');
  const hasFailedAttachments = attachments.some((a) => a.status === 'error');
  const canSend = (input.trim() || attachments.length > 0) && allReady && !inputDisabled && !sending && !capabilityExecuting;
  const canStop = sending && !inputDisabled && !!onStop;

  const completeSend = useCallback(async (
    textToSend: string,
    attachmentsToSend: FileAttachment[] | undefined,
    sendTargetAgentId: string | null,
    sendKnowledgeScope: WorkspaceKnowledgeScope,
    sendWorkMode: WorkModeId,
  ): Promise<boolean> => {
    const safeAttachments = attachmentsToSend && attachmentsToSend.length > 0 ? attachmentsToSend : undefined;

    if (rendererExtensionRegistry.hasChatBeforeSendHooks()) {
      const guard = await rendererExtensionRegistry.runChatBeforeSend({
        text: textToSend,
        attachments: safeAttachments,
        targetAgentId: sendTargetAgentId,
      });
      if (!guard.ok) {
        if (guard.message) {
          toast.error(guard.message);
        }
        return false;
      }
    }

    console.log(`[handleSend] text="${textToSend.substring(0, 50)}", attachments=${safeAttachments?.length ?? 0}, sending=${!!safeAttachments}`);
    if (safeAttachments) {
      console.log('[handleSend] Attachment details:', safeAttachments.map(a => ({
        id: a.id, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize,
        stagedPath: a.stagedPath, status: a.status, hasPreview: !!a.preview,
      })));
    }
    updateInput('');
    setAttachments([]);
    setSelectedSkill(null);
    setSkillQuery('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSend(textToSend, safeAttachments, sendTargetAgentId, sendKnowledgeScope, sendWorkMode);
    setTargetAgentId(null);
    setPickerOpen(false);
    setSkillPickerOpen(false);
    return true;
  }, [onSend, updateInput]);

  const handleUnsupportedCapabilityRequest = useCallback((resolution: ChatCapabilityPlanResolution): boolean => {
    if (!resolution.unsupportedReason) return false;
    toast.message(t(`composer.capability.unsupported.${resolution.unsupportedReason}`, {
      defaultValue: t('composer.capability.unsupported.generic'),
    }));
    return true;
  }, [t]);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const readyAttachments = attachments.filter(a => a.status === 'ready');
    const textToSend = input.trim();
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;

    if (shouldRunChatCapabilityPreflight(textToSend)) {
      let resolution: ChatCapabilityPlanResolution = { actions: [] };
      try {
        resolution = await resolveChatCapabilityActions(textToSend);
      } catch (error) {
        console.warn('[handleSend] Capability preflight failed:', error);
      }

      if (resolution.actions.length > 0) {
        setPendingCapabilitySend({
          text: textToSend,
          attachments: attachmentsToSend,
          targetAgentId,
          knowledgeScope,
          workMode,
          plan: resolution.actions,
          results: [],
        });
        setPickerOpen(false);
        setSkillPickerOpen(false);
        setModelPickerOpen(false);
        setWorkspaceActionsOpen(false);
        setKnowledgePickerOpen(false);
        return;
      }

      if (handleUnsupportedCapabilityRequest(resolution)) return;
    }

    if (rendererExtensionRegistry.hasChatBeforeSendHooks()) {
      const guard = await rendererExtensionRegistry.runChatBeforeSend({
        text: textToSend,
        attachments: attachmentsToSend,
        targetAgentId,
      });
      if (!guard.ok) {
        if (guard.message) {
          toast.error(guard.message);
        }
        return;
      }
    }

    // Capture values before clearing — clear input immediately for snappy UX,
    // but keep attachments available for the async send
    console.log(`[handleSend] text="${textToSend.substring(0, 50)}", attachments=${attachments.length}, ready=${readyAttachments.length}, sending=${!!attachmentsToSend}`);
    if (attachmentsToSend) {
      console.log('[handleSend] Attachment details:', attachmentsToSend.map(a => ({
        id: a.id, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize,
        stagedPath: a.stagedPath, status: a.status, hasPreview: !!a.preview,
      })));
    }
    updateInput('');
    setAttachments([]);
    setSelectedSkill(null);
    setSkillQuery('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSend(textToSend, attachmentsToSend, targetAgentId, knowledgeScope, workMode);
    setTargetAgentId(null);
    setPickerOpen(false);
    setSkillPickerOpen(false);
  }, [input, attachments, canSend, onSend, targetAgentId, updateInput, knowledgeScope, workMode, handleUnsupportedCapabilityRequest]);

  const handleCancelCapabilityActions = useCallback(() => {
    if (capabilityExecuting) return;
    setPendingCapabilitySend(null);
  }, [capabilityExecuting]);

  const handleConfirmCapabilityActions = useCallback(async () => {
    if (!pendingCapabilitySend || capabilityExecuting) return;
    if (pendingCapabilitySend.plan.some((action) => isCapabilityAuditBlocked(action.auditResult))) return;
    setCapabilityExecuting(true);
    try {
      const results = await executeChatCapabilityActions(pendingCapabilitySend.plan, {
        workspaceId: workspace?.id ?? null,
        agentId: pendingCapabilitySend.targetAgentId || currentAgentId || null,
      });
      setPendingCapabilitySend((current) => current ? { ...current, results } : current);
      if (!hasSuccessfulCapabilityResult(results)) {
        toast.error(t('composer.capability.allFailed'));
        return;
      }
      const enhancedMessage = buildCapabilityActionMessage(pendingCapabilitySend.text, results);
      const sent = await completeSend(
        enhancedMessage,
        pendingCapabilitySend.attachments,
        pendingCapabilitySend.targetAgentId,
        pendingCapabilitySend.knowledgeScope,
        pendingCapabilitySend.workMode,
      );
      if (sent) {
        toast.success(t('composer.capability.applied'));
        setPendingCapabilitySend(null);
      }
    } catch (error) {
      toast.error(t('composer.capability.failed', { error: String(error) }));
    } finally {
      setCapabilityExecuting(false);
    }
  }, [capabilityExecuting, completeSend, currentAgentId, pendingCapabilitySend, t, workspace?.id]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Backspace') {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) =>
          selectionStart === selectionEnd
          && selectionStart > range.start
          && selectionStart <= range.end,
        );

        if (
          tokenRange
        ) {
          e.preventDefault();
          const valueWithoutToken = `${input.slice(0, tokenRange.start)}${input.slice(tokenRange.end)}`;
          updateInput(valueWithoutToken);
          setSelectedSkill(null);
          moveCaretTo(tokenRange.start);
          return;
        }

        if (!input) {
          if (selectedSkill) {
            setSelectedSkill(null);
            return;
          }
          setTargetAgentId(null);
          return;
        }
      }
      if (e.key === 'ArrowLeft' && skillTokenRanges.length > 0) {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) => selectionStart === selectionEnd && selectionStart === range.end);
        if (tokenRange) {
          e.preventDefault();
          moveCaretTo(tokenRange.start);
          return;
        }
      }
      if (e.key === 'ArrowRight' && skillTokenRanges.length > 0) {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) => selectionStart === selectionEnd && selectionStart === range.start);
        if (tokenRange) {
          e.preventDefault();
          moveCaretTo(tokenRange.end);
          return;
        }
      }
      if (e.key === 'Escape') {
        setPickerOpen(false);
        setSkillPickerOpen(false);
        setModelPickerOpen(false);
        setWorkspaceActionsOpen(false);
        setKnowledgePickerOpen(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, input, moveCaretTo, selectedSkill, skillTokenRanges, updateInput],
  );

  // Handle paste (Ctrl/Cmd+V with files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: globalThis.File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        stageBufferFiles(pastedFiles);
      }
    },
    [stageBufferFiles],
  );

  // Handle drag & drop
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (!e.dataTransfer) return;

      const { pathFiles, bufferFiles } = collectDroppedFiles(e.dataTransfer);
      if (pathFiles.length === 0 && bufferFiles.length === 0) {
        toast.error(t('composer.folderDropUnsupported'));
        return;
      }
      if (pathFiles.length > 0) void stagePathFiles(pathFiles);
      if (bufferFiles.length > 0) void stageBufferFiles(bufferFiles);
    },
    [stageBufferFiles, stagePathFiles, t],
  );

  return (
    <div
      className={cn(
        "p-4 pb-6 w-full mx-auto max-w-3xl"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full">
        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {attachments.map((att) => (
              <AttachmentPreview
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {/* Input Container */}
        <div className={`relative bg-surface-modal rounded-2xl shadow-sm border px-3 pt-2.5 pb-1.5 transition-all ${dragOver ? 'border-primary ring-1 ring-primary' : 'border-black/10 dark:border-white/10'}`}>
          {selectedTarget && (
            <div className="flex flex-wrap gap-2 pb-1.5">
              <button
                type="button"
                onClick={() => setTargetAgentId(null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-primary/10"
                title={t('composer.clearTarget')}
              >
                <span>{t('composer.targetChip', { agent: selectedTarget.name })}</span>
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          )}

          {/* Text Row — flush-left */}
          <div className="relative min-h-[48px]">
            {skillTokenRanges.length > 0 && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-20 overflow-hidden whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground"
              >
                {renderHighlightedComposerText(input, skillTokenRanges, {
                  onPreviewSkill: (name) => {
                    void handleSkillTokenPreview(name);
                  },
                  previewTooltip: t('composer.skillPreviewTooltip', 'Preview SKILL.md'),
                })}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onSelect={normalizeSelectionAroundSkill}
              onClick={normalizeSelectionAroundSkill}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onPaste={handlePaste}
              placeholder={inputDisabled ? t('composer.gatewayDisconnectedPlaceholder') : ''}
              disabled={inputDisabled}
              data-testid="chat-composer-input"
              className={cn(
                'relative min-h-[48px] max-h-[240px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none bg-transparent p-0 text-sm leading-relaxed placeholder:text-muted-foreground/60',
                skillTokenRanges.length > 0 ? 'z-0 text-transparent caret-foreground selection:bg-primary/20' : 'z-10',
              )}
              rows={1}
            />
          </div>

          {/* Action Row — icons on their own line */}
          <div className="mt-1.5 flex items-center gap-1">
            {/* Attach Button */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors"
              onClick={pickFiles}
              disabled={inputDisabled || sending}
              title={t('composer.attachFiles')}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>

            {showWorkspaceActions && (
              <div ref={workspaceActionsRef} className="relative shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="chat-composer-workspace-actions"
                  className={cn(
                    'h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors',
                    workspaceActionsOpen && 'bg-black/5 text-foreground dark:bg-white/10',
                  )}
                  onClick={() => {
                  setPickerOpen(false);
                  setSkillPickerOpen(false);
                  setModelPickerOpen(false);
                  setKnowledgePickerOpen(false);
                  setWorkspaceActionsOpen((open) => !open);
                  }}
                  disabled={inputDisabled || sending}
                  title={t('composer.workspaceActions')}
                >
                  <Briefcase className="h-3.5 w-3.5" />
                </Button>
                {workspaceActionsOpen && (
                  <div
                    className="absolute left-0 bottom-full z-20 mb-2 w-80 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10"
                    data-testid="chat-composer-workspace-actions-menu"
                  >
                    <div className="border-b border-black/5 px-3 py-2 dark:border-white/10">
                      <div className="truncate text-xs font-medium text-foreground">
                        {workspace?.name || t('composer.workspaceActions')}
                      </div>
                      {workspace?.rootPath && (
                        <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                          {workspace.rootPath}
                        </div>
                      )}
                    </div>

                    {workspace && onPermissionModeChange && (
                      <div className="py-1.5">
                        <div className="flex items-center gap-1.5 px-3 py-1 text-tiny font-medium text-muted-foreground/80">
                          <Shield className="h-3 w-3" />
                          <span>{t('composer.permissionModeTitle')}</span>
                        </div>
                        {WORKSPACE_PERMISSION_MODES.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            className={cn(
                              'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors',
                              workspace.permissionMode === mode ? 'bg-black/5 text-foreground dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5',
                            )}
                            data-testid={`chat-composer-permission-option-${mode}`}
                            onClick={() => handleWorkspaceAction(() => onPermissionModeChange(mode))}
                          >
                            <span>{t(`composer.permissionMode.${mode}`)}</span>
                            {workspace.permissionMode === mode && <Check className="h-3.5 w-3.5 text-primary" />}
                          </button>
                        ))}
                      </div>
                    )}

                    {(onPickWorkspaceFolder || onNewSession) && (
                      <div className="border-t border-black/5 py-1.5 dark:border-white/10">
                        {onPickWorkspaceFolder && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                            data-testid="chat-composer-pick-workspace"
                            onClick={() => handleWorkspaceAction(onPickWorkspaceFolder)}
                          >
                            <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{t('composer.pickWorkspaceFolder')}</span>
                          </button>
                        )}
                        {onNewSession && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                            data-testid="chat-composer-new-session"
                            onClick={() => handleWorkspaceAction(onNewSession)}
                          >
                            <MessageSquarePlus className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{t('composer.newWorkspaceSession')}</span>
                          </button>
                        )}
                      </div>
                    )}

                    {onSwitchAgent && (agents ?? []).length > 0 && (
                      <div className="border-t border-black/5 py-1.5 dark:border-white/10">
                        <div className="flex items-center gap-1.5 px-3 py-1 text-tiny font-medium text-muted-foreground/80">
                          <Users className="h-3 w-3" />
                          <span>{t('composer.workspaceAgentTitle')}</span>
                        </div>
                        {(agents ?? []).map((agent) => {
                          const selected = agent.id === currentAgentId;
                          return (
                            <button
                              key={agent.id}
                              type="button"
                              className={cn(
                                'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors',
                                selected ? 'bg-black/5 text-foreground dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5',
                              )}
                              data-testid={`chat-composer-switch-agent-${agent.id}`}
                              disabled={selected}
                              onClick={() => handleWorkspaceAction(() => onSwitchAgent(agent.id))}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{agent.name}</span>
                                <span className="block truncate text-tiny text-muted-foreground">{agent.modelDisplay}</span>
                              </span>
                              {selected && <Check className="h-3.5 w-3.5 text-primary" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {showAgentPicker && (
              <div ref={pickerRef} className="relative shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="chat-composer-agent"
                  className={cn(
                    'h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors',
                    (pickerOpen || selectedTarget) && 'bg-primary/10 text-primary hover:bg-primary/20'
                  )}
                  onClick={() => {
                    setSkillPickerOpen(false);
                    setWorkspaceActionsOpen(false);
                    setModelPickerOpen(false);
                    setKnowledgePickerOpen(false);
                    setPickerOpen((open) => !open);
                  }}
                  disabled={inputDisabled || sending}
                  title={t('composer.pickAgent')}
                >
                  <AtSign className="h-3.5 w-3.5" />
                </Button>
                {pickerOpen && (
                  <div className="absolute left-0 bottom-full z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10">
                    <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                      {t('composer.agentPickerTitle', { currentAgent: currentAgentName })}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {mentionableAgents.map((agent) => (
                        <AgentPickerItem
                          key={agent.id}
                          agent={agent}
                          selected={agent.id === targetAgentId}
                          onSelect={() => {
                            setTargetAgentId(agent.id);
                            setPickerOpen(false);
                            textareaRef.current?.focus();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div ref={skillPickerRef} className="relative shrink-0">
              <button
                type="button"
                data-testid="chat-composer-skill"
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50',
                  (skillPickerOpen || selectedSkill) && 'text-foreground',
                )}
                onClick={() => {
                  setPickerOpen(false);
                  setWorkspaceActionsOpen(false);
                  setModelPickerOpen(false);
                  setKnowledgePickerOpen(false);
                  setSkillPickerOpen((open) => !open);
                }}
                disabled={inputDisabled || sending}
                title={t('composer.pickSkill')}
              >
                <span>{t('composer.skillButton')}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', skillPickerOpen && 'rotate-180')} />
              </button>
              {skillPickerOpen && (
                <div className="absolute left-0 bottom-full z-20 mb-2 w-80 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10">
                  <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      value={skillQuery}
                      onChange={(event) => setSkillQuery(event.target.value)}
                      placeholder={t('composer.skillSearchPlaceholder')}
                      className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground/70"
                      autoFocus
                    />
                  </div>
                  <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                    {t('composer.skillPickerTitle', { agent: currentAgentName })}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {skillsLoading ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground">
                        {t('composer.skillLoading')}
                      </div>
                    ) : skillsError ? (
                      <div className="px-3 py-4 text-xs text-destructive">
                        {skillsError}
                      </div>
                    ) : filteredQuickSkills.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground">
                        {t('composer.skillEmpty')}
                      </div>
                    ) : (
                      filteredQuickSkills.map((skill) => (
                        <SkillPickerItem
                          key={`${skill.source}:${skill.name}`}
                          skill={skill}
                          selected={false}
                          onSelect={() => {
                            const textarea = textareaRef.current;
                            const nextToken = getSkillPrefix(skill.name);
                            const selectionStart = textarea?.selectionStart ?? input.length;
                            const selectionEnd = textarea?.selectionEnd ?? input.length;
                            let nextValue = input;
                            let adjustedStart = selectionStart;
                            let adjustedEnd = selectionEnd;

                            const leadingSpace = needsLeadingSkillSpace(nextValue, adjustedStart) ? ' ' : '';
                            nextValue = `${nextValue.slice(0, adjustedStart)}${leadingSpace}${nextToken}${nextValue.slice(adjustedEnd)}`;
                            setSelectedSkill(null);
                            updateInput(nextValue);
                            setSkillPickerOpen(false);
                            setSkillQuery('');
                            requestAnimationFrame(() => {
                              textareaRef.current?.focus();
                              const cursorPosition = adjustedStart + leadingSpace.length + nextToken.length;
                              textareaRef.current?.setSelectionRange(cursorPosition, cursorPosition);
                            });
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid="chat-knowledge-quick-toggle"
                  className={cn(
                    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/10',
                    wikiQuickActive && 'bg-black/5 text-foreground dark:bg-white/10',
                  )}
                  onClick={handleQuickWikiToggle}
                  disabled={inputDisabled || sending || !onKnowledgeScopeChange}
                  title={t(wikiQuickActive ? 'composer.knowledgeQuick.disable' : 'composer.knowledgeQuick.enable')}
                  aria-label={t(wikiQuickActive ? 'composer.knowledgeQuick.disable' : 'composer.knowledgeQuick.enable')}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {t(wikiQuickActive ? 'composer.knowledgeQuick.disable' : 'composer.knowledgeQuick.enable')}
              </TooltipContent>
            </Tooltip>

            <div ref={knowledgePickerRef} className="relative shrink-0">
              <button
                type="button"
                data-testid="chat-knowledge-scope-button"
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50',
                  (knowledgePickerOpen || knowledgeScope !== 'none') && 'text-foreground',
                )}
                onClick={() => {
                  setPickerOpen(false);
                  setSkillPickerOpen(false);
                  setWorkspaceActionsOpen(false);
                  setModelPickerOpen(false);
                  setKnowledgePickerOpen((open) => !open);
                }}
                disabled={inputDisabled || sending || !onKnowledgeScopeChange}
                title={t('composer.knowledgeScopeTitle')}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>{t(`composer.knowledgeScope.${knowledgeScope}`)}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', knowledgePickerOpen && 'rotate-180')} />
              </button>
              {knowledgePickerOpen && (
                <div
                  className="absolute left-0 bottom-full z-20 mb-2 w-80 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10"
                  data-testid="chat-knowledge-scope-menu"
                >
                  <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                    {t('composer.knowledgeScopeTitle')}
                  </div>
                  {KNOWLEDGE_SCOPES.map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors',
                        scope === knowledgeScope ? 'bg-black/5 text-foreground dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5',
                      )}
                      data-testid={`chat-knowledge-scope-${scope}`}
                      onClick={() => {
                        void onKnowledgeScopeChange?.(scope);
                        setKnowledgePickerOpen(false);
                        textareaRef.current?.focus();
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{t(`composer.knowledgeScope.${scope}`)}</span>
                        <span className="mt-0.5 block text-tiny text-muted-foreground">{t(`composer.knowledgeScopeDescription.${scope}`)}</span>
                      </span>
                      {scope === knowledgeScope && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {currentAgent && (
              <div className="shrink-0">
                <ChatAgentEffortButton
                  agentId={currentAgent.id}
                  disabled={inputDisabled || sending}
                />
              </div>
            )}

            {showModelPicker && (
              <div ref={modelPickerRef} className="relative shrink-0">
                <button
                  type="button"
                  data-testid="chat-model-picker-button"
                  className={cn(
                    'inline-flex h-8 max-w-[220px] items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50',
                    (modelPickerOpen || switchingModelRef) && 'text-foreground',
                  )}
                  onClick={() => {
                    setPickerOpen(false);
                    setSkillPickerOpen(false);
                    setWorkspaceActionsOpen(false);
                    setKnowledgePickerOpen(false);
                    setModelPickerOpen((open) => !open);
                  }}
                  disabled={inputDisabled || sending || !currentAgent || !!switchingModelRef}
                  title={t('composer.pickModel')}
                >
                  {switchingModelRef ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : null}
                  <span className="truncate">{currentModelLabel}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', modelPickerOpen && 'rotate-180')} />
                </button>
                {modelPickerOpen && (
                  <div
                    className="absolute left-0 bottom-full z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10"
                    data-testid="chat-model-picker-menu"
                  >
                    <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                      {t('composer.modelPickerTitle')}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {modelOptions.map((option) => (
                        <button
                          key={option.modelRef}
                          type="button"
                          onClick={() => void handleSelectModel(option.modelRef)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
                            option.modelRef === effectiveModelRef ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5'
                          )}
                          data-testid={`chat-model-picker-option-${option.label}`}
                        >
                          <span className="truncate">{option.label}</span>
                          {option.modelRef === effectiveModelRef && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Send Button — pushed to the right */}
            <Button
              onClick={sending ? handleStop : handleSend}
              disabled={sending ? !canStop : !canSend}
              size="icon"
              data-testid="chat-composer-send"
              className={`ml-auto shrink-0 h-8 w-8 rounded-lg transition-colors ${
                (sending || canSend)
                  ? 'bg-black/5 dark:bg-white/10 text-foreground hover:bg-black/10 dark:hover:bg-white/20'
                  : 'text-muted-foreground/50 hover:bg-transparent bg-transparent'
              }`}
              variant="ghost"
              title={sending ? t('composer.stop') : t('composer.send')}
            >
              {sending ? (
                <Square className="h-3.5 w-3.5" fill="currentColor" />
              ) : (
                <SendHorizontal className="h-4 w-4" strokeWidth={2} />
              )}
            </Button>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-tiny text-muted-foreground/60 px-4">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className={cn(
              "w-1.5 h-1.5 rounded-full",
              isGatewayUsable ? "bg-green-500/80" : "bg-red-500/80",
            )} />
            <span className="truncate">
              {t('composer.gatewayStatus', {
                state: isGatewayUsable
                  ? t('composer.gatewayConnected')
                  : gatewayStatus.state === 'running'
                    ? 'starting'
                    : gatewayStatus.state,
                port: gatewayStatus.port,
                pid: gatewayStatus.pid ? `| pid: ${gatewayStatus.pid}` : '',
              })}
            </span>
            {chatComposerStatusComponents.map((Component, index) => (
              <Component key={`${index}`} gatewayStatus={gatewayStatus} />
            ))}
          </div>
          {(composerContextParts.length > 0 || longTaskControlStatus || onManualCompact || onForkSession || onHandoffSession) && (
            <div
              className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 text-right"
              data-testid="chat-composer-context-status"
              title={t('composer.contextStatusTitle')}
            >
              {composerContextParts.map((part, index) => (
                <span key={`${index}:${part}`} className="inline-flex items-center gap-1.5">
                  {index > 0 && <span aria-hidden="true" className="text-muted-foreground/35">|</span>}
                  <span>{part}</span>
                </span>
              ))}
              {longTaskControlStatus && (
                <>
                  {queuedFollowupCount > 0 && (
                    <Badge
                      variant="outline"
                      className="h-6 rounded-md border-amber-500/30 bg-amber-500/10 px-2 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                      data-testid="chat-long-task-queue-count"
                    >
                      {t('composer.longTaskControl.queued', { count: queuedFollowupCount })}
                    </Badge>
                  )}
                  {longTaskControlStatus.latestCheckpoint?.trigger && (
                    <Badge
                      variant="outline"
                      className="h-6 rounded-md px-2 text-[11px] font-medium text-muted-foreground"
                      data-testid="chat-long-task-checkpoint"
                    >
                      {t('composer.longTaskControl.checkpoint', {
                        trigger: t(`composer.longTaskControl.trigger.${longTaskControlStatus.latestCheckpoint.trigger}`, {
                          defaultValue: longTaskControlStatus.latestCheckpoint.trigger,
                        }),
                      })}
                    </Badge>
                  )}
                  {longTaskControlStatus.latestIntervention && (
                    <Badge
                      variant="outline"
                      className="h-6 rounded-md px-2 text-[11px] font-medium text-muted-foreground"
                      data-testid="chat-long-task-intervention"
                    >
                      {t('composer.longTaskControl.intervention', {
                        mode: longTaskControlStatus.latestIntervention.mode
                          ? t(`composer.longTaskControl.mode.${longTaskControlStatus.latestIntervention.mode}`, { defaultValue: longTaskControlStatus.latestIntervention.mode })
                          : t('composer.longTaskControl.mode.unknown'),
                        status: t(`composer.longTaskControl.status.${longTaskControlStatus.latestIntervention.status}`, {
                          defaultValue: longTaskControlStatus.latestIntervention.status,
                        }),
                      })}
                    </Badge>
                  )}
                  {(longTaskControlStatus.warnings?.length ?? 0) > 0 && (
                    <Badge
                      variant="outline"
                      className="h-6 rounded-md border-amber-500/30 px-2 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                      data-testid="chat-long-task-warnings"
                    >
                      {t('composer.longTaskControl.warnings', { count: longTaskControlStatus.warnings?.length ?? 0 })}
                    </Badge>
                  )}
                  {queuedFollowupCount > 0 && onDrainQueuedFollowup && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            data-testid="chat-long-task-drain"
                            disabled={sending || queueDrainBusy}
                            onClick={() => void onDrainQueuedFollowup()}
                            className="h-6 w-6 rounded-md text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={t('composer.longTaskControl.drainNow')}
                          >
                            {queueDrainBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <MessageSquarePlus className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">
                        {sending
                          ? t('composer.longTaskControl.drainActiveRun')
                          : t('composer.longTaskControl.drainTooltip')}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </>
              )}
              {onManualCompact && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        data-testid="chat-composer-compact"
                        disabled={compactDisabled}
                        onClick={() => setCompactionDialogOpen(true)}
                        className={cn(
                          'h-6 w-6 rounded-md text-muted-foreground transition-colors',
                          compactAttention && !compactDisabled && 'text-amber-700 hover:bg-amber-500/10 dark:text-amber-400',
                        )}
                        aria-label={t('composer.compaction.compress')}
                      >
                        {compactionBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Archive className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {compactDisabledReason ?? t('composer.compaction.compressTooltip')}
                  </TooltipContent>
                </Tooltip>
              )}
              {composerContinuityAction && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        data-testid={composerContinuityAction.testId}
                        disabled={composerContinuityAction.disabled || composerContinuityAction.busy}
                        onClick={() => void composerContinuityAction.onClick()}
                        className="h-6 w-6 rounded-md text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={t(`composer.${composerContinuityAction.id}.action`)}
                      >
                        {composerContinuityAction.busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ComposerContinuityIcon className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {composerContinuityTooltip}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          {hasFailedAttachments && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-tiny"
              onClick={() => {
                setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
                void pickFiles();
              }}
            >
              {t('composer.retryFailedAttachments')}
            </Button>
          )}
        </div>
      </div>
      <Dialog
        open={Boolean(pendingCapabilitySend)}
        onOpenChange={(open) => {
          if (!open) handleCancelCapabilityActions();
        }}
      >
        <DialogContent
          className="max-w-xl rounded-lg border border-black/10 bg-surface-modal p-5 shadow-xl dark:border-white/10"
          data-testid="chat-capability-dialog"
        >
          <DialogTitle className="flex items-center gap-2 font-serif text-xl font-normal tracking-tight text-foreground">
            <Wrench className="h-5 w-5 text-primary" />
            {t('composer.capability.dialogTitle')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {t('composer.capability.dialogDescription')}
          </DialogDescription>

          <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
            {pendingCapabilitySend?.plan.map((action) => {
              const result = pendingCapabilitySend.results.find((entry) => entry.id === action.id);
              const riskVariant = action.risk === 'medium' ? 'warning' : action.risk === 'high' ? 'destructive' : 'outline';
              const auditStatus = action.auditResult?.status ?? 'unknown';
              const auditVariant = auditStatus === 'blocked'
                ? 'destructive'
                : auditStatus === 'warning' || auditStatus === 'unknown'
                  ? 'warning'
                  : 'success';
              const findings = action.auditResult?.findings.slice(0, 3) ?? [];
              return (
                <div
                  key={action.id}
                  className="rounded-md bg-surface-input p-3 text-sm"
                  data-testid={`chat-capability-action-${action.kind}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{action.label}</span>
                        <Badge variant={riskVariant}>
                          {t(`composer.capability.risk.${action.risk ?? 'low'}`)}
                        </Badge>
                      </div>
                      {action.summary && (
                        <p className="mt-1 break-all text-xs text-muted-foreground">{action.summary}</p>
                      )}
                      {action.mcpServer && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('composer.capability.mcpScope', {
                            scope: action.mcpServer.scope ?? 'global',
                            transport: action.mcpServer.transport,
                          })}
                        </p>
                      )}
                      {action.auditResult && (
                        <div className="mt-2 rounded-md border border-black/10 bg-background/60 p-2 dark:border-white/10">
                          <div className="flex flex-wrap items-center gap-2">
                            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium text-foreground">
                              {t('composer.capability.audit.title')}
                            </span>
                            <Badge variant={auditVariant}>
                              {t(`composer.capability.audit.status.${auditStatus}`)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {action.auditResult.summary}
                          </p>
                          {findings.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                              {findings.map((finding) => (
                                <li key={finding.id} className="break-words">
                                  <span className={cn(
                                    'font-medium',
                                    finding.severity === 'blocked'
                                      ? 'text-red-700 dark:text-red-400'
                                      : finding.severity === 'warning'
                                        ? 'text-yellow-700 dark:text-yellow-400'
                                        : 'text-muted-foreground',
                                  )}>
                                    {finding.title}
                                  </span>
                                  {finding.detail ? `: ${finding.detail}` : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                    {capabilityExecuting && !result ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : result?.success ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-400" />
                    ) : result ? (
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" />
                    ) : null}
                  </div>
                  {result && (
                    <p className={cn(
                      'mt-2 text-xs',
                      result.success ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400',
                    )}>
                      {result.success
                        ? result.message || t('composer.capability.resultSuccess')
                        : result.error || t('composer.capability.resultFailed')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {pendingCapabilityAuditBlocked
              ? t('composer.capability.audit.blockedHint')
              : t('composer.capability.localOnlyHint')}
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCancelCapabilityActions}
              disabled={capabilityExecuting}
              data-testid="chat-capability-cancel"
            >
              {t('composer.capability.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirmCapabilityActions()}
              disabled={capabilityExecuting || !pendingCapabilitySend?.plan.length || pendingCapabilityAuditBlocked}
              data-testid="chat-capability-confirm"
            >
              {capabilityExecuting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('composer.capability.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={compactionDialogOpen} onOpenChange={setCompactionDialogOpen}>
        <DialogContent
          className="max-w-lg rounded-lg border border-black/10 bg-surface-modal p-5 shadow-xl dark:border-white/10"
          data-testid="chat-compaction-dialog"
        >
          <DialogTitle className="font-serif text-xl font-normal tracking-tight text-foreground">
            {t('composer.compaction.dialogTitle')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {t('composer.compaction.dialogDescription')}
          </DialogDescription>
          <div className="mt-4 grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-4 rounded-md bg-surface-input px-3 py-2">
              <span className="text-muted-foreground">{t('composer.compaction.tokenUsage')}</span>
              <span className="font-medium text-foreground">
                {compactionUsedTokens != null
                  ? compactionMaxTokens != null
                    ? t('composer.tokenUsageWithLimit', {
                      used: formatCompactNumber(compactionUsedTokens),
                      max: formatCompactNumber(compactionMaxTokens),
                    })
                    : t('composer.tokenUsage', { tokens: formatCompactNumber(compactionUsedTokens) })
                  : t('composer.compaction.unknown')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md bg-surface-input px-3 py-2">
              <span className="text-muted-foreground">{t('composer.compaction.hiddenMessages')}</span>
              <span className="font-medium text-foreground">{compactionHiddenCount}</span>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md bg-surface-input px-3 py-2">
              <span className="text-muted-foreground">{t('composer.compaction.lastCompaction')}</span>
              <span className="font-medium text-foreground">
                {compactionLastDate || t('composer.compaction.neverCompacted')}
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {t('composer.compaction.expectedEffect')}
          </p>
          <label className="mt-4 block text-sm font-medium text-foreground" htmlFor="chat-compaction-instructions">
            {t('composer.compaction.instructionsLabel')}
          </label>
          <Textarea
            id="chat-compaction-instructions"
            data-testid="chat-compaction-instructions"
            value={compactionInstructions}
            onChange={(event) => setCompactionInstructions(event.target.value)}
            placeholder={t('composer.compaction.instructionsPlaceholder')}
            className="mt-2 min-h-24 resize-none bg-surface-input"
          />
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCompactionDialogOpen(false)}
              disabled={compactionBusy}
            >
              {t('composer.compaction.cancel')}
            </Button>
            <Button
              type="button"
              data-testid="chat-compaction-confirm"
              onClick={() => void handleConfirmCompaction()}
              disabled={compactDisabled || compactionBusy}
            >
              {compactionBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('composer.compaction.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Attachment Preview ───────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const { t } = useTranslation('chat');
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;

  return (
    <div className="relative group rounded-lg overflow-hidden border border-border">
      {isImage ? (
        // Image thumbnail
        <div className="w-16 h-16">
          <img
            src={attachment.preview!}
            alt={attachment.fileName}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        // Generic file card
        <div className="flex items-center gap-2 px-3 py-2 bg-surface-input/50 max-w-[200px]">
          <FileIcon mimeType={attachment.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 overflow-hidden">
            <p className="text-xs font-medium truncate">{attachment.fileName}</p>
            <p className="text-2xs text-muted-foreground">
              {attachment.mimeType === DIRECTORY_MIME_TYPE
                ? t('composer.folderAttachment')
                : attachment.fileSize > 0
                  ? formatFileSize(attachment.fileSize)
                  : '...'}
            </p>
          </div>
        </div>
      )}

      {/* Staging overlay */}
      {attachment.status === 'staging' && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="h-4 w-4 text-white animate-spin" />
        </div>
      )}

      {/* Error overlay */}
      {attachment.status === 'error' && (
        <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
          <span className="text-2xs text-destructive font-medium px-1">Error</span>
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function AgentPickerItem({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5'
      )}
    >
      <span className="text-sm font-medium text-foreground">{agent.name}</span>
      <span className="text-tiny text-muted-foreground">
        {agent.modelDisplay}
      </span>
    </button>
  );
}

function SkillPickerItem({
  skill,
  selected,
  onSelect,
}: {
  skill: QuickAccessSkill;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`chat-composer-skill-option-${skill.name}`}
          onClick={onSelect}
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors',
            selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-meta font-semibold text-foreground">
              <span className="font-mono">/{skill.name}</span>
            </div>
            <div className="truncate text-tiny text-muted-foreground">
              {skill.sourceLabel}
            </div>
          </div>
          <span className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
            {skill.sourceLabel}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
        {skill.description}
      </TooltipContent>
    </Tooltip>
  );
}
