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
  FileText,
  FolderPlus,
  GitBranchPlus,
  Loader2,
  MessageSquarePlus,
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
import { hostApi, type ChatKnowledgeReference, type KnowledgeRouteCandidate, type KnowledgeSearchResult } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { TaskNodeSelector } from '@/components/task-ledger/TaskNodeSelector';
import { buildPreviewTarget } from '@/components/file-preview/build-preview-target';
import { AttachmentName, AttachmentRemove, AttachmentRoot, AttachmentThumb, DIRECTORY_MIME_TYPE, FileIcon, formatFileSize } from '@/components/assistant-ui/attachment';
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
import type { KnowledgeInvocationMode, LiveTokenUsage, WorkspaceContextRange, WorkspaceKnowledgeScope, WorkspacePermissionMode, WorkspaceProfile } from '@shared/types/workspace';
import type { ChatCapabilityActionPlan, ChatCapabilityActionResult, SessionCompactionStatus } from '@shared/host-api/contract';
import type { LongTaskControlStatus, LongTaskInputMode } from '@shared/types/long-task-control';
import type { SessionContinuityPreflight, SessionContinuityRecommendation } from './session-continuity';

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
  onSend: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null, knowledgeScope?: WorkspaceKnowledgeScope, knowledgeMode?: KnowledgeInvocationMode, knowledgeReferences?: ChatKnowledgeReference[], activeTaskNodeId?: string | null, inputMode?: LongTaskInputMode) => void;
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
  continuityPreflight?: SessionContinuityPreflight;
  forkDisabled?: boolean;
  forkBusy?: boolean;
  handoffDisabled?: boolean;
  handoffBusy?: boolean;
  knowledgeScope?: WorkspaceKnowledgeScope;
  onKnowledgeScopeChange?: (scope: WorkspaceKnowledgeScope) => void | Promise<void>;
  knowledgeMode?: KnowledgeInvocationMode;
  onKnowledgeModeChange?: (mode: KnowledgeInvocationMode) => void | Promise<void>;
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
  knowledgeMode: KnowledgeInvocationMode;
  inputMode?: LongTaskInputMode;
  knowledgeReferences?: ChatKnowledgeReference[];
  plan: ChatCapabilityActionPlan[];
  results: ChatCapabilityActionResult[];
};

// ── Helpers ──────────────────────────────────────────────────────

type KnowledgeSearchRow = Record<string, unknown>;

const WORKSPACE_PERMISSION_MODES: WorkspacePermissionMode[] = ['readOnly', 'plan', 'acceptEdits', 'fullAccess'];
const KNOWLEDGE_SCOPES: WorkspaceKnowledgeScope[] = ['none', 'memory', 'wiki', 'all'];
const KNOWLEDGE_MODES: KnowledgeInvocationMode[] = ['manual', 'suggest', 'auto-read'];

const SLASH_COMMANDS = [
  { id: 'wiki', group: 'knowledge', kind: 'wikiSearch', aliases: ['knowledge', 'kb'] },
  { id: 'memory', group: 'knowledge', kind: 'scope', scope: 'memory', aliases: ['mem'] },
  { id: 'all', group: 'knowledge', kind: 'scope', scope: 'all' },
  { id: 'none', group: 'knowledge', kind: 'scope', scope: 'none', aliases: ['no-knowledge'] },
  { id: 'scope', group: 'knowledge', kind: 'scopePicker' },
  { id: 'knowledge-mode', group: 'knowledge', kind: 'knowledgeMode', aliases: ['kmode'] },
  { id: 'save', group: 'knowledge', kind: 'prompt', aliases: ['draft-knowledge'] },
  { id: 'steward', group: 'knowledge', kind: 'prompt', aliases: ['knowledge-steward'] },
  { id: 'steward-audit', group: 'knowledge', kind: 'stewardAudit', aliases: ['audit-knowledge'] },
  { id: 'review', group: 'coding', kind: 'prompt', aliases: ['code-review'] },
  { id: 'fix-ci', group: 'coding', kind: 'prompt', aliases: ['ci'] },
  { id: 'write-tests', group: 'coding', kind: 'prompt', aliases: ['tests', 'test'] },
  { id: 'explain-diff', group: 'coding', kind: 'prompt', aliases: ['diff'] },
  { id: 'commit', group: 'coding', kind: 'prompt', aliases: ['commit-summary'] },
  { id: 'pr-summary', group: 'coding', kind: 'prompt', aliases: ['pr'] },
  { id: 'mission', group: 'workflow', kind: 'mission' },
  { id: 'ledger', group: 'workflow', kind: 'ledger', aliases: ['task'] },
  { id: 'compact', group: 'session', kind: 'compact', aliases: ['compress'] },
  { id: 'fork', group: 'session', kind: 'fork' },
  { id: 'handoff', group: 'session', kind: 'handoff' },
] as const;

type SlashCommand = (typeof SLASH_COMMANDS)[number];
type SlashCommandGroup = SlashCommand['group'];

const SLASH_COMMAND_GROUP_ORDER: SlashCommandGroup[] = ['knowledge', 'coding', 'workflow', 'session'];

type SlashInputState = {
  active: boolean;
  commandText: string;
  args: string;
};

function parseSlashInput(value: string): SlashInputState {
  if (!/^\s*\//u.test(value)) {
    return { active: false, commandText: '', args: '' };
  }
  const body = value.trimStart().slice(1);
  if (/^[^\s]+\s{2}/u.test(body)) {
    return { active: false, commandText: '', args: '' };
  }
  const separator = body.search(/\s/u);
  if (separator === -1) {
    return { active: true, commandText: body.trim().toLowerCase(), args: '' };
  }
  return {
    active: true,
    commandText: body.slice(0, separator).trim().toLowerCase(),
    args: body.slice(separator + 1).trim(),
  };
}

function slashCommandNames(command: SlashCommand): string[] {
  return [command.id, ...('aliases' in command ? command.aliases : [])];
}

function findExactSlashCommand(commandText: string): SlashCommand | null {
  const normalized = commandText.trim().toLowerCase();
  if (!normalized) return null;
  return SLASH_COMMANDS.find((command) => slashCommandNames(command).includes(normalized)) ?? null;
}

function resolveSlashScope(value: string): WorkspaceKnowledgeScope | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'none' || normalized === 'memory' || normalized === 'wiki' || normalized === 'all') {
    return normalized;
  }
  return null;
}

function resolveSlashKnowledgeMode(value: string): KnowledgeInvocationMode | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'manual' || normalized === 'off') return 'manual';
  if (normalized === 'suggest' || normalized === 'suggestions') return 'suggest';
  if (normalized === 'auto' || normalized === 'auto-read' || normalized === 'autoread') return 'auto-read';
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function getKnowledgeSearchRows(result: KnowledgeSearchResult | null): KnowledgeSearchRow[] {
  if (!result) return [];
  if (Array.isArray(result.results)) return result.results.filter((entry): entry is KnowledgeSearchRow => !!asRecord(entry));
  for (const key of ['items', 'matches', 'pages']) {
    const value = (result as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.filter((entry): entry is KnowledgeSearchRow => !!asRecord(entry));
  }
  return [];
}

function knowledgeCorpusForScope(scope: WorkspaceKnowledgeScope): 'wiki' | 'memory' | 'all' {
  if (scope === 'memory') return 'memory';
  if (scope === 'all') return 'all';
  return 'wiki';
}

function knowledgeReferenceFromRow(row: KnowledgeSearchRow, corpus: 'wiki' | 'memory' | 'all'): ChatKnowledgeReference | null {
  const lookup = getString(row, ['lookup', 'pagePath', 'path', 'relativePath', 'id', 'pageId', 'sourcePath']);
  if (!lookup) return null;
  const title = getString(row, ['title', 'pageTitle', 'name', 'pageId', 'pagePath', 'path']) || lookup;
  const pagePath = getString(row, ['pagePath', 'path', 'relativePath']);
  const pageId = getString(row, ['pageId', 'id']);
  const sourcePath = getString(row, ['sourcePath', 'source', 'filePath']);
  const snippet = getString(row, ['snippet', 'excerpt', 'summary', 'text']);
  const score = getNumber(row, ['score', 'rank']);
  return {
    id: pageId || pagePath || lookup,
    title,
    lookup,
    corpus,
    ...(pageId ? { pageId } : {}),
    ...(pagePath ? { pagePath } : {}),
    ...(sourcePath ? { sourcePath } : {}),
    ...(snippet ? { snippet } : {}),
    ...(score !== undefined ? { score } : {}),
  };
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
  continuityPreflight,
  forkDisabled = false,
  forkBusy = false,
  handoffDisabled = false,
  handoffBusy = false,
  knowledgeScope = 'none',
  onKnowledgeScopeChange,
  knowledgeMode = 'suggest',
  onKnowledgeModeChange,
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
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeSearchResult, setKnowledgeSearchResult] = useState<KnowledgeSearchResult | null>(null);
  const [knowledgeSearching, setKnowledgeSearching] = useState(false);
  const [knowledgeSearchError, setKnowledgeSearchError] = useState<string | null>(null);
  const [selectedKnowledgeRefs, setSelectedKnowledgeRefs] = useState<ChatKnowledgeReference[]>([]);
  const [suggestedKnowledgeRefs, setSuggestedKnowledgeRefs] = useState<KnowledgeRouteCandidate[]>([]);
  const [knowledgeRoutingBusy, setKnowledgeRoutingBusy] = useState(false);
  const dismissedRouteKeysRef = useRef<Map<string, number>>(new Map());
  const [workspaceActionsOpen, setWorkspaceActionsOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [quickSkills, setQuickSkills] = useState<QuickAccessSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<QuickAccessSkill | null>(null);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [switchingModelRef, setSwitchingModelRef] = useState<string | null>(null);
  const [optimisticModelRef, setOptimisticModelRef] = useState<string | null>(null);
  const [compactionDialogOpen, setCompactionDialogOpen] = useState(false);
  const [compactionInstructions, setCompactionInstructions] = useState('');
  const [activeTaskNodeId, setActiveTaskNodeIdState] = useState<string | null>(null);
  const [pendingCapabilitySend, setPendingCapabilitySend] = useState<PendingCapabilitySend | null>(null);
  const [capabilityExecuting, setCapabilityExecuting] = useState(false);
  const pendingCapabilityAuditBlocked = useMemo(
    () => pendingCapabilitySend?.plan.some((action) => isCapabilityAuditBlocked(action.auditResult)) ?? false,
    [pendingCapabilitySend],
  );
  const setActiveTaskNodeId = useCallback((nodeId: string | null) => {
    setActiveTaskNodeIdState(nodeId);
    useChatStore.setState({ activeTaskNodeId: nodeId });
  }, []);
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
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
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
  const knowledgeCorpus = knowledgeCorpusForScope(knowledgeScope);
  const knowledgeRows = useMemo(() => getKnowledgeSearchRows(knowledgeSearchResult), [knowledgeSearchResult]);
  const selectedKnowledgeIds = useMemo(() => new Set(selectedKnowledgeRefs.map((reference) => reference.id)), [selectedKnowledgeRefs]);
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
  const compactionQuality = compactionStatus?.lastCompaction?.quality;
  const queuedFollowupCount = longTaskControlStatus?.queueCount ?? 0;
  const effectiveContinuityRecommendation = continuityPreflight?.recommendation ?? continuityRecommendation;
  const continuityHealth = continuityPreflight?.health;
  const recommendedContinuityAction = effectiveContinuityRecommendation?.action ?? 'fork';
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
      : [
        continuityHealth
          ? t(`composer.continuity.health.${continuityHealth.status}`, {
            defaultValue: t('composer.continuity.health.healthy'),
          })
          : '',
        t(`composer.continuity.tooltip.${composerContinuityAction.id}.${effectiveContinuityRecommendation?.reason ?? 'default'}`, {
          defaultValue: t(`composer.${composerContinuityAction.id}.tooltip`),
        }),
      ].filter(Boolean).join(' - ')
    : '';
  const ComposerContinuityIcon = composerContinuityAction?.icon ?? GitBranchPlus;
  const wikiQuickActive = knowledgeScope === 'wiki';
  const slashInput = useMemo(() => parseSlashInput(input), [input]);
  const slashCommands = useMemo(() => {
    if (!slashInput.active) return [];
    const query = slashInput.commandText;
    const commands = !query
      ? [...SLASH_COMMANDS]
      : SLASH_COMMANDS.filter((command) => {
        const label = t(`composer.slashCommands.commands.${command.id}.label`).toLowerCase();
        const description = t(`composer.slashCommands.commands.${command.id}.description`).toLowerCase();
        return slashCommandNames(command).some((name) => name.startsWith(query))
          || label.includes(query)
          || description.includes(query);
      });
    return [...commands].sort((left: SlashCommand, right: SlashCommand) => {
      if (query) {
        const leftExact = slashCommandNames(left).includes(query);
        const rightExact = slashCommandNames(right).includes(query);
        if (leftExact !== rightExact) return leftExact ? -1 : 1;
        const leftPrefix = slashCommandNames(left).some((name) => name.startsWith(query));
        const rightPrefix = slashCommandNames(right).some((name) => name.startsWith(query));
        if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
      }
      return SLASH_COMMAND_GROUP_ORDER.indexOf(left.group) - SLASH_COMMAND_GROUP_ORDER.indexOf(right.group);
    });
  }, [slashInput.active, slashInput.commandText, t]);
  const slashMenuOpen = slashInput.active && !slashMenuDismissed;
  const selectedSlashCommand = slashCommands[Math.min(slashSelectedIndex, Math.max(0, slashCommands.length - 1))] ?? null;

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashInput.commandText, slashCommands.length]);

  const runKnowledgeSearch = useCallback(async (
    rawQuery: string,
    corpus: 'wiki' | 'memory' | 'all' = knowledgeCorpus,
  ) => {
    const query = rawQuery.trim();
    if (!query) return;
    setKnowledgeSearching(true);
    setKnowledgeSearchError(null);
    try {
      const result = await hostApi.knowledge.search({
        query,
        maxResults: 8,
        corpus,
      });
      if (!result.success) throw new Error(result.error || t('composer.knowledgeAttach.searchFailed'));
      setKnowledgeSearchResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setKnowledgeSearchError(message);
      toast.error(message);
    } finally {
      setKnowledgeSearching(false);
    }
  }, [knowledgeCorpus, t]);

  const searchKnowledge = useCallback(async () => {
    await runKnowledgeSearch(knowledgeQuery);
  }, [knowledgeQuery, runKnowledgeSearch]);

  const addKnowledgeReference = useCallback((row: KnowledgeSearchRow) => {
    const reference = knowledgeReferenceFromRow(row, knowledgeCorpus);
    if (!reference) {
      toast.error(t('composer.knowledgeAttach.missingLookup'));
      return;
    }
    setSelectedKnowledgeRefs((current) => (
      current.some((item) => item.id === reference.id)
        ? current
        : [...current, reference].slice(0, 6)
    ));
    if (knowledgeScope === 'none') {
      void onKnowledgeScopeChange?.('wiki');
    }
    textareaRef.current?.focus();
  }, [knowledgeCorpus, knowledgeScope, onKnowledgeScopeChange, t]);

  const removeKnowledgeReference = useCallback((id: string) => {
    setSelectedKnowledgeRefs((current) => current.filter((reference) => reference.id !== id));
  }, []);

  const recordKnowledgeReferences = useCallback((references: ChatKnowledgeReference[]) => {
    if (references.length === 0) return;
    for (const reference of references) {
      void hostApi.knowledge.recordKnowledgeReference({
        targetId: reference.lookup,
        targetKind: 'wiki-page',
        title: reference.title,
        reference: {
          kind: 'chat',
          sessionKey: currentSessionKey,
          agentId: currentAgentId,
          lookup: reference.lookup,
          note: 'Attached from Chat composer',
        },
        metadata: {
          surface: 'chat-composer',
          corpus: reference.corpus,
          pageId: reference.pageId,
          pagePath: reference.pagePath,
          sourcePath: reference.sourcePath,
        },
      }).catch((error) => {
        console.warn('[knowledge] Failed to record chat reference:', error);
      });
    }
  }, [currentAgentId, currentSessionKey]);

  const routeKnowledgeForMessage = useCallback(async (
    message: string,
    mode: KnowledgeInvocationMode = knowledgeMode,
  ): Promise<KnowledgeRouteCandidate[]> => {
    if (knowledgeScope === 'none' || mode === 'manual' || selectedKnowledgeRefs.length > 0 || message.trim().startsWith('/')) {
      setSuggestedKnowledgeRefs([]);
      return [];
    }
    const routeKey = `${currentSessionKey}:${knowledgeScope}:${message.trim().slice(0, 120).toLowerCase()}`;
    const dismissedAt = dismissedRouteKeysRef.current.get(routeKey);
    if (dismissedAt && Date.now() - dismissedAt < 10 * 60 * 1000) return [];

    setKnowledgeRoutingBusy(true);
    try {
      const result = await hostApi.knowledge.routeContext({
        message,
        scope: knowledgeScope,
        mode,
        selectedReferences: selectedKnowledgeRefs,
        sessionKey: currentSessionKey,
        workspaceId: workspace?.id ?? null,
      });
      if (!result.success) return [];
      if (result.decision === 'suggest') {
        setSuggestedKnowledgeRefs(result.candidates);
        return [];
      }
      if (result.decision === 'auto_attach') {
        setSuggestedKnowledgeRefs([]);
        return result.candidates;
      }
      setSuggestedKnowledgeRefs([]);
      return [];
    } catch (error) {
      console.warn('[knowledge] routeContext failed:', error);
      return [];
    } finally {
      setKnowledgeRoutingBusy(false);
    }
  }, [currentSessionKey, knowledgeMode, knowledgeScope, selectedKnowledgeRefs, workspace?.id]);

  const attachSuggestedKnowledge = useCallback(() => {
    if (suggestedKnowledgeRefs.length === 0) return;
    setSelectedKnowledgeRefs((current) => {
      const existing = new Set(current.map((reference) => reference.id));
      const next = [...current];
      for (const reference of suggestedKnowledgeRefs) {
        if (!existing.has(reference.id)) next.push(reference);
      }
      return next.slice(0, 6);
    });
    setSuggestedKnowledgeRefs([]);
    if (knowledgeScope === 'none') void onKnowledgeScopeChange?.('wiki');
  }, [knowledgeScope, onKnowledgeScopeChange, suggestedKnowledgeRefs]);

  const dismissSuggestedKnowledge = useCallback(() => {
    const routeKey = `${currentSessionKey}:${knowledgeScope}:${input.trim().slice(0, 120).toLowerCase()}`;
    dismissedRouteKeysRef.current.set(routeKey, Date.now());
    setSuggestedKnowledgeRefs([]);
  }, [currentSessionKey, input, knowledgeScope]);

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

  const handleOpenSlashPalette = useCallback(() => {
    if (input.trim().length > 0 && !slashInput.active) {
      toast.message(t('composer.slashCommands.toasts.typeSlash'));
      textareaRef.current?.focus();
      return;
    }
    if (!slashInput.active) {
      updateInput('/');
    }
    setSlashMenuDismissed(false);
    setPickerOpen(false);
    setSkillPickerOpen(false);
    setModelPickerOpen(false);
    setWorkspaceActionsOpen(false);
    setKnowledgePickerOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [input, slashInput.active, t, updateInput]);

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
    if (knowledgeMode !== 'suggest' || knowledgeScope === 'none' || selectedKnowledgeRefs.length > 0 || slashInput.active) {
      setSuggestedKnowledgeRefs([]);
      return;
    }
    const text = input.trim();
    if (text.length < 18) {
      setSuggestedKnowledgeRefs([]);
      return;
    }
    const timer = setTimeout(() => {
      void routeKnowledgeForMessage(text, 'suggest');
    }, 650);
    return () => clearTimeout(timer);
  }, [input, knowledgeMode, knowledgeScope, routeKnowledgeForMessage, selectedKnowledgeRefs.length, slashInput.active]);

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
    setSlashMenuDismissed(false);
    if (parseSlashInput(value).active) {
      setPickerOpen(false);
      setSkillPickerOpen(false);
      setModelPickerOpen(false);
      setWorkspaceActionsOpen(false);
      setKnowledgePickerOpen(false);
    }
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
  const canSend = (input.trim() || attachments.length > 0 || selectedKnowledgeRefs.length > 0) && allReady && !inputDisabled && !sending && !capabilityExecuting;
  const canStop = sending && !inputDisabled && !!onStop;
  const canIntervene = sending && (input.trim() || selectedKnowledgeRefs.length > 0) && allReady && !inputDisabled && !hasFailedAttachments && !capabilityExecuting;

  const completeSend = useCallback(async (
    textToSend: string,
    attachmentsToSend: FileAttachment[] | undefined,
    sendTargetAgentId: string | null,
    sendKnowledgeScope: WorkspaceKnowledgeScope,
    sendKnowledgeMode: KnowledgeInvocationMode,
    sendKnowledgeReferences: ChatKnowledgeReference[] = [],
    inputMode?: LongTaskInputMode,
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
    setSelectedKnowledgeRefs([]);
    setSuggestedKnowledgeRefs([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    recordKnowledgeReferences(sendKnowledgeReferences);
    if (inputMode) {
      onSend(
        textToSend,
        safeAttachments,
        sendTargetAgentId,
        sendKnowledgeScope,
        sendKnowledgeMode,
        sendKnowledgeReferences.length > 0 ? sendKnowledgeReferences : undefined,
        activeTaskNodeId,
        inputMode,
      );
    } else {
      onSend(
        textToSend,
        safeAttachments,
        sendTargetAgentId,
        sendKnowledgeScope,
        sendKnowledgeMode,
        sendKnowledgeReferences.length > 0 ? sendKnowledgeReferences : undefined,
        activeTaskNodeId,
      );
    }
    setTargetAgentId(null);
    setPickerOpen(false);
    setSkillPickerOpen(false);
    setKnowledgePickerOpen(false);
    return true;
  }, [activeTaskNodeId, onSend, recordKnowledgeReferences, updateInput]);

  const handleInterventionSend = useCallback(async (inputMode: LongTaskInputMode) => {
    if (!sending) return;
    const readyAttachments = attachments.filter(a => a.status === 'ready');
    const knowledgeReferencesToSend: ChatKnowledgeReference[] = selectedKnowledgeRefs;
    const textToSend = input.trim() || (knowledgeReferencesToSend.length > 0 ? t('composer.knowledgeAttach.defaultPrompt') : '');
    if (!textToSend || !allReady || hasFailedAttachments || capabilityExecuting) return;

    const sendKnowledgeScope: WorkspaceKnowledgeScope = knowledgeScope === 'none' && knowledgeReferencesToSend.length > 0 ? 'wiki' : knowledgeScope;
    await completeSend(
      textToSend,
      readyAttachments.length > 0 ? readyAttachments : undefined,
      targetAgentId,
      sendKnowledgeScope,
      knowledgeMode,
      knowledgeReferencesToSend,
      inputMode,
    );
  }, [
    allReady,
    attachments,
    capabilityExecuting,
    completeSend,
    hasFailedAttachments,
    input,
    knowledgeMode,
    knowledgeScope,
    selectedKnowledgeRefs,
    t,
    targetAgentId,
  ]);

  const executeSlashCommand = useCallback(async (command: SlashCommand, args: string) => {
    const trimmedArgs = args.trim();
    const closeSlashMenu = () => {
      setSlashMenuDismissed(true);
      setSlashSelectedIndex(0);
    };
    const clearComposer = () => {
      updateInput('');
      closeSlashMenu();
    };
    const promptArgs = trimmedArgs
      ? t('composer.slashCommands.promptArgs', { args: trimmedArgs })
      : '';

    if (command.kind === 'wikiSearch') {
      clearComposer();
      setKnowledgeQuery(trimmedArgs);
      setKnowledgeSearchResult(null);
      setKnowledgeSearchError(null);
      setKnowledgePickerOpen(true);
      setPickerOpen(false);
      setSkillPickerOpen(false);
      setModelPickerOpen(false);
      setWorkspaceActionsOpen(false);
      if (onKnowledgeScopeChange) {
        await onKnowledgeScopeChange('wiki');
      }
      toast.success(t('composer.slashCommands.toasts.wikiOpened'));
      if (trimmedArgs) {
        await runKnowledgeSearch(trimmedArgs, 'wiki');
      }
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (command.kind === 'scope') {
      if (!onKnowledgeScopeChange) return;
      clearComposer();
      await onKnowledgeScopeChange(command.scope);
      toast.success(t('composer.slashCommands.toasts.scopeChanged', {
        scope: t(`composer.knowledgeScope.${command.scope}`),
      }));
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (command.kind === 'scopePicker') {
      const scope = resolveSlashScope(trimmedArgs);
      if (scope && onKnowledgeScopeChange) {
        clearComposer();
        await onKnowledgeScopeChange(scope);
        toast.success(t('composer.slashCommands.toasts.scopeChanged', {
          scope: t(`composer.knowledgeScope.${scope}`),
        }));
        requestAnimationFrame(() => textareaRef.current?.focus());
        return;
      }
      clearComposer();
      setKnowledgePickerOpen(true);
      setPickerOpen(false);
      setSkillPickerOpen(false);
      setModelPickerOpen(false);
      setWorkspaceActionsOpen(false);
      toast.message(t('composer.slashCommands.toasts.scopeOpened'));
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (command.kind === 'knowledgeMode') {
      const mode = resolveSlashKnowledgeMode(trimmedArgs);
      clearComposer();
      if (mode && onKnowledgeModeChange) {
        await onKnowledgeModeChange(mode);
        toast.success(t('composer.slashCommands.toasts.knowledgeModeChanged', {
          mode: t(`composer.knowledgeMode.${mode}`),
        }));
      } else {
        toast.message(t('composer.slashCommands.toasts.knowledgeModeOpened'));
      }
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    if (command.kind === 'stewardAudit') {
      clearComposer();
      try {
        await hostApi.knowledge.governanceAudit();
        toast.success(t('composer.slashCommands.toasts.stewardAuditStarted'));
      } catch (error) {
        toast.error(String(error));
      }
      window.location.hash = '#/knowledge?tab=governance';
      return;
    }

    if (command.kind === 'prompt') {
      if (inputDisabled || sending || capabilityExecuting || !allReady) {
        toast.message(t('composer.slashCommands.toasts.sendUnavailable'));
        return;
      }
      const prompt = t(`composer.slashCommands.prompts.${command.id}`, { argsDetail: promptArgs }).trim();
      const readyAttachments = attachments.filter((attachment) => attachment.status === 'ready');
      const knowledgeReferencesToSend = selectedKnowledgeRefs;
      const sendKnowledgeScope: WorkspaceKnowledgeScope = knowledgeScope === 'none' && knowledgeReferencesToSend.length > 0 ? 'wiki' : knowledgeScope;
      await completeSend(
        prompt,
        readyAttachments.length > 0 ? readyAttachments : undefined,
        targetAgentId,
        sendKnowledgeScope,
        knowledgeMode,
        knowledgeReferencesToSend,
      );
      closeSlashMenu();
      return;
    }

    if (command.kind === 'mission') {
      if (trimmedArgs) {
        if (inputDisabled || sending || capabilityExecuting || !allReady) {
          toast.message(t('composer.slashCommands.toasts.sendUnavailable'));
          return;
        }
        const prompt = t('composer.slashCommands.prompts.mission', { argsDetail: promptArgs }).trim();
        await completeSend(prompt, undefined, targetAgentId, knowledgeScope, knowledgeMode);
        closeSlashMenu();
        return;
      }
      clearComposer();
      window.location.hash = '#/settings/agents';
      toast.success(t('composer.slashCommands.toasts.missionOpened'));
      return;
    }

    if (command.kind === 'ledger') {
      if (!trimmedArgs) {
        clearComposer();
        window.location.hash = '#/task-ledger';
        toast.success(t('composer.slashCommands.toasts.ledgerOpened'));
        return;
      }
      if (!workspace?.id) {
        toast.error(t('composer.slashCommands.toasts.ledgerFailed', {
          error: t('composer.workspaceUnavailable', 'No active workspace'),
        }));
        return;
      }
      try {
        const result = await hostApi.taskLedger.createNode({
          workspaceId: workspace.id,
          node: {
            title: trimmedArgs,
            kind: 'task',
            status: 'todo',
            description: t('composer.slashCommands.ledgerNodeDescription'),
          },
          idempotencyKey: `chat-slash-ledger:${currentSessionKey}:${trimmedArgs}:${Date.now()}`,
        });
        if (!result?.success) {
          throw new Error('success' in result && typeof result.error === 'string' ? result.error : 'create failed');
        }
        const nodes = Array.isArray(result.snapshot?.nodes) ? result.snapshot.nodes : [];
        const createdNode = [...nodes]
          .reverse()
          .find((node: { title?: string }) => node.title === trimmedArgs) ?? nodes[nodes.length - 1];
        const nodeId = typeof createdNode?.id === 'string' ? createdNode.id : null;
        if (nodeId) {
          void hostApi.taskLedger.linkSession({
            workspaceId: workspace.id,
            sessionKey: currentSessionKey,
            agentId: currentAgentId ?? undefined,
            nodeId,
            relation: 'related',
            summary: t('composer.slashCommands.ledgerSessionSummary', { title: trimmedArgs }),
            idempotencyKey: `chat-slash-ledger-link:${currentSessionKey}:${nodeId}`,
          }).catch((error) => {
            console.warn('[chat:slash] failed to link task ledger session', error);
          });
        }
        clearComposer();
        window.location.hash = '#/task-ledger';
        toast.success(t('composer.slashCommands.toasts.ledgerCreated', { title: trimmedArgs }));
      } catch (error) {
        toast.error(t('composer.slashCommands.toasts.ledgerFailed', { error: String(error) }));
      }
      return;
    }

    if (command.kind === 'compact') {
      if (compactDisabled) {
        toast.message(compactDisabledReason ?? t('composer.compaction.unavailable'));
        return;
      }
      clearComposer();
      setCompactionDialogOpen(true);
      return;
    }

    if (command.kind === 'fork') {
      if (!onForkSession || forkDisabled || forkBusy) {
        toast.message(t('composer.slashCommands.toasts.forkUnavailable'));
        return;
      }
      clearComposer();
      await onForkSession();
      return;
    }

    if (command.kind === 'handoff') {
      if (!onHandoffSession || handoffDisabled || handoffBusy) {
        toast.message(t('composer.handoff.disabledActiveRun'));
        return;
      }
      clearComposer();
      await onHandoffSession();
    }
  }, [
    allReady,
    attachments,
    capabilityExecuting,
    compactDisabled,
    compactDisabledReason,
    completeSend,
    currentAgentId,
    currentSessionKey,
    forkBusy,
    forkDisabled,
    handoffBusy,
    handoffDisabled,
    inputDisabled,
    knowledgeMode,
    knowledgeScope,
    onForkSession,
    onHandoffSession,
    onKnowledgeModeChange,
    onKnowledgeScopeChange,
    runKnowledgeSearch,
    selectedKnowledgeRefs,
    sending,
    t,
    targetAgentId,
    updateInput,
    workspace?.id,
  ]);

  const handleUnsupportedCapabilityRequest = useCallback((resolution: ChatCapabilityPlanResolution): boolean => {
    if (!resolution.unsupportedReason) return false;
    toast.message(t(`composer.capability.unsupported.${resolution.unsupportedReason}`, {
      defaultValue: t('composer.capability.unsupported.generic'),
    }));
    return true;
  }, [t]);

  const handleSend = useCallback(async () => {
    if (slashInput.active) {
      const exactCommand = findExactSlashCommand(slashInput.commandText);
      if (!exactCommand) {
        toast.message(t('composer.slashCommands.unknownToast', { command: `/${slashInput.commandText}` }));
        return;
      }
      await executeSlashCommand(exactCommand, slashInput.args);
      return;
    }

    if (!canSend) return;
    const readyAttachments = attachments.filter(a => a.status === 'ready');
    let knowledgeReferencesToSend: ChatKnowledgeReference[] = selectedKnowledgeRefs;
    const baseTextToSend = input.trim() || (knowledgeReferencesToSend.length > 0 ? t('composer.knowledgeAttach.defaultPrompt') : '');
    if (knowledgeMode === 'auto-read' && knowledgeReferencesToSend.length === 0 && baseTextToSend) {
      const routedReferences = await routeKnowledgeForMessage(baseTextToSend, 'auto-read');
      if (routedReferences.length > 0) {
        knowledgeReferencesToSend = routedReferences;
      }
    }
    const sendKnowledgeScope: WorkspaceKnowledgeScope = knowledgeScope === 'none' && knowledgeReferencesToSend.length > 0 ? 'wiki' : knowledgeScope;
    const textToSend = baseTextToSend;
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
          knowledgeScope: sendKnowledgeScope,
          knowledgeMode,
          inputMode: undefined,
          knowledgeReferences: knowledgeReferencesToSend,
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
    setSelectedKnowledgeRefs([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    recordKnowledgeReferences(knowledgeReferencesToSend);
    onSend(
      textToSend,
      attachmentsToSend,
      targetAgentId,
      sendKnowledgeScope,
      knowledgeMode,
      knowledgeReferencesToSend.length > 0 ? knowledgeReferencesToSend : undefined,
      activeTaskNodeId,
    );
    setTargetAgentId(null);
    setPickerOpen(false);
    setSkillPickerOpen(false);
    setKnowledgePickerOpen(false);
  }, [input, attachments, canSend, onSend, targetAgentId, updateInput, knowledgeMode, knowledgeScope, selectedKnowledgeRefs, t, recordKnowledgeReferences, handleUnsupportedCapabilityRequest, executeSlashCommand, slashInput, activeTaskNodeId, routeKnowledgeForMessage]);

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
        pendingCapabilitySend.knowledgeMode,
        pendingCapabilitySend.knowledgeReferences ?? [],
        pendingCapabilitySend.inputMode,
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
      if (slashMenuOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashSelectedIndex((index) => Math.min(index + 1, Math.max(0, slashCommands.length - 1)));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashSelectedIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSlashMenuDismissed(true);
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          const nativeEvent = e.nativeEvent as KeyboardEvent;
          if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
            return;
          }
          e.preventDefault();
          const commandToRun = findExactSlashCommand(slashInput.commandText) ?? selectedSlashCommand;
          if (!commandToRun) {
            toast.message(t('composer.slashCommands.unknownToast', { command: `/${slashInput.commandText}` }));
            return;
          }
          void executeSlashCommand(commandToRun, slashInput.args);
          return;
        }
      }

      if (slashInput.active && e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        const exactCommand = findExactSlashCommand(slashInput.commandText);
        if (!exactCommand) {
          toast.message(t('composer.slashCommands.unknownToast', { command: `/${slashInput.commandText}` }));
          return;
        }
        void executeSlashCommand(exactCommand, slashInput.args);
        return;
      }

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
    [
      executeSlashCommand,
      handleSend,
      input,
      moveCaretTo,
      selectedSkill,
      selectedSlashCommand,
      skillTokenRanges,
      slashCommands.length,
      slashInput,
      slashMenuOpen,
      t,
      updateInput,
    ],
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
          {slashMenuOpen && (
            <div
              role="listbox"
              aria-label={t('composer.slashCommands.menuLabel')}
              data-testid="chat-slash-command-menu"
              className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[min(420px,calc(100vh-190px))] overflow-hidden rounded-lg border border-black/10 bg-surface-modal shadow-md dark:border-white/10 sm:right-auto sm:w-[520px]"
            >
              <div className="border-b border-black/5 px-3 py-2 dark:border-white/10">
                <div className="flex items-center gap-2">
                  <Wrench className="h-3.5 w-3.5 text-primary" />
                  <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('composer.slashCommands.title')}</p>
                </div>
                <p className="mt-0.5 text-2xs leading-4 text-muted-foreground/70">
                  {t('composer.slashCommands.subtitle')}
                </p>
              </div>

              {slashCommands.length === 0 ? (
                <div className="px-3 py-3" data-testid="chat-slash-command-empty">
                  <p className="text-xs font-medium text-foreground">{t('composer.slashCommands.unknownTitle')}</p>
                  <p className="mt-0.5 text-2xs leading-4 text-muted-foreground">
                    {t('composer.slashCommands.unknownDescription', { command: `/${slashInput.commandText}` })}
                  </p>
                </div>
              ) : (
                <div className="max-h-[340px] overflow-y-auto p-1">
                  {slashCommands.map((command, index) => {
                    const previous = slashCommands[index - 1];
                    const showGroup = !previous || previous.group !== command.group;
                    const selected = index === slashSelectedIndex;
                    const icon = command.group === 'knowledge'
                      ? <BookOpen className="h-3.5 w-3.5" />
                      : command.group === 'coding'
                        ? <Wrench className="h-3.5 w-3.5" />
                        : command.group === 'workflow'
                          ? <Briefcase className="h-3.5 w-3.5" />
                          : <MessageSquarePlus className="h-3.5 w-3.5" />;
                    return (
                      <div key={command.id}>
                        {showGroup && (
                          <div className="px-2 pb-0.5 pt-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground/60">
                            {t(`composer.slashCommands.groups.${command.group}`)}
                          </div>
                        )}
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          data-testid={`chat-slash-command-option-${command.id}`}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                            selected ? 'bg-black/5 text-foreground dark:bg-white/10' : 'text-foreground hover:bg-black/5 dark:hover:bg-white/5',
                          )}
                          onMouseEnter={() => setSlashSelectedIndex(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void executeSlashCommand(command, slashInput.args)}
                        >
                          <span className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-input text-muted-foreground',
                            selected && 'text-primary',
                          )}>
                            {icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                              <code className="rounded bg-surface-input px-1 py-0.5 font-mono text-2xs text-foreground">
                                /{command.id}
                              </code>
                              <span className="text-xs font-medium text-foreground">
                                {t(`composer.slashCommands.commands.${command.id}.label`)}
                              </span>
                              {t(`composer.slashCommands.commands.${command.id}.argumentHint`) && (
                                <span className="font-mono text-2xs text-muted-foreground">
                                  {t(`composer.slashCommands.commands.${command.id}.argumentHint`)}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block text-2xs leading-4 text-muted-foreground">
                              {t(`composer.slashCommands.commands.${command.id}.description`)}
                            </span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

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
          {selectedKnowledgeRefs.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2" data-testid="chat-knowledge-selected">
              {selectedKnowledgeRefs.map((reference) => (
                <button
                  key={reference.id}
                  type="button"
                  onClick={() => removeKnowledgeReference(reference.id)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-meta font-medium text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400"
                  title={t('composer.knowledgeAttach.remove', { title: reference.title })}
                  data-testid="chat-knowledge-selected-item"
                >
                  <BookOpen className="h-3 w-3 shrink-0" />
                  <span className="max-w-[220px] truncate">{reference.title}</span>
                  <X className="h-3 w-3 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {suggestedKnowledgeRefs.length > 0 && selectedKnowledgeRefs.length === 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 text-meta text-emerald-700 dark:text-emerald-400" data-testid="chat-knowledge-suggestion">
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {t('composer.knowledgeRoute.suggestion', { count: suggestedKnowledgeRefs.length })}
              </span>
              {knowledgeRoutingBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <button
                type="button"
                className="rounded-md px-2 py-1 text-tiny font-semibold hover:bg-emerald-500/10"
                onClick={attachSuggestedKnowledge}
                data-testid="chat-knowledge-suggestion-attach"
              >
                {t('composer.knowledgeRoute.attach')}
              </button>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-tiny font-semibold hover:bg-emerald-500/10"
                onClick={() => {
                  setKnowledgePickerOpen(true);
                  setKnowledgeSearchResult({ success: true, results: suggestedKnowledgeRefs } as KnowledgeSearchResult);
                }}
                data-testid="chat-knowledge-suggestion-open"
              >
                {t('composer.knowledgeRoute.open')}
              </button>
              <button
                type="button"
                className="rounded-md p-1 hover:bg-emerald-500/10"
                onClick={dismissSuggestedKnowledge}
                data-testid="chat-knowledge-suggestion-dismiss"
                aria-label={t('composer.knowledgeRoute.dismiss')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

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

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-testid="chat-slash-command-trigger"
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-2xs font-medium text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/10',
                    slashMenuOpen && 'bg-black/5 text-foreground dark:bg-white/10',
                  )}
                  onClick={handleOpenSlashPalette}
                  disabled={inputDisabled || sending}
                  title={t('composer.slashCommands.contextButton')}
                  aria-label={t('composer.slashCommands.contextButton')}
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span>{t('composer.slashCommands.contextButtonShort')}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {t('composer.slashCommands.contextButtonTooltip')}
              </TooltipContent>
            </Tooltip>

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
                    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/10',
                    wikiQuickActive && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 dark:bg-emerald-500/15',
                  )}
                  onClick={handleQuickWikiToggle}
                  disabled={inputDisabled || sending || !onKnowledgeScopeChange}
                  title={t(wikiQuickActive ? 'composer.knowledgeQuick.disable' : 'composer.knowledgeQuick.enable')}
                  aria-label={t(wikiQuickActive ? 'composer.knowledgeQuick.disable' : 'composer.knowledgeQuick.enable')}
                >
                  <BookOpen className={cn('h-3.5 w-3.5 transition-transform', wikiQuickActive && 'scale-110')} />
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
                  'inline-flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-all duration-200 hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/5',
                  (knowledgePickerOpen || knowledgeScope !== 'none') && 'text-foreground',
                  knowledgeScope !== 'none' && knowledgeScope !== 'memory' && 'bg-emerald-500/5',
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
                <BookOpen className={cn('h-3.5 w-3.5', knowledgeScope !== 'none' && knowledgeScope !== 'memory' && 'text-emerald-700 dark:text-emerald-400')} />
                <span>{t(`composer.knowledgeScope.${knowledgeScope}`)}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', knowledgePickerOpen && 'rotate-180')} />
              </button>
              {knowledgePickerOpen && (
                <div
                  className="absolute left-0 bottom-full z-20 mb-2 w-[360px] overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10"
                  data-testid="chat-knowledge-scope-menu"
                >
                  <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                    {t('composer.knowledgeScopeTitle')}
                  </div>
                  {KNOWLEDGE_SCOPES.map((scope) => {
                    const isActive = scope === knowledgeScope;
                    return (
                    <button
                      key={scope}
                      type="button"
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-200',
                        isActive
                          ? 'bg-primary/5 text-foreground font-medium'
                          : 'hover:bg-black/5 dark:hover:bg-white/5',
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
                        <span className="mt-0.5 block text-tiny leading-4 text-muted-foreground">{t(`composer.knowledgeScopeDescription.${scope}`)}</span>
                      </span>
                      {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                    );
                  })}
                  <div className="mx-3 my-2 rounded-xl border border-black/10 bg-surface-input p-1 dark:border-white/10">
                    <div className="px-2 pb-1 text-tiny font-medium text-muted-foreground/80">
                      {t('composer.knowledgeModeTitle')}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {KNOWLEDGE_MODES.map((mode) => {
                        const isActive = mode === knowledgeMode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            className={cn(
                              'h-8 rounded-lg px-2 text-tiny font-medium transition-colors',
                              isActive
                                ? 'bg-black/5 text-foreground dark:bg-white/10'
                                : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
                            )}
                            data-testid={`chat-knowledge-mode-${mode}`}
                            onClick={() => {
                              void onKnowledgeModeChange?.(mode);
                              textareaRef.current?.focus();
                            }}
                          >
                            {t(`composer.knowledgeMode.${mode}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="my-1.5 h-px bg-border/70" />
                  <div className="px-3 py-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-tiny font-medium text-muted-foreground/80">{t('composer.knowledgeAttach.title')}</span>
                      {selectedKnowledgeRefs.length > 0 && (
                        <Badge variant="outline" className="rounded-full border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-2xs font-semibold text-emerald-700 dark:text-emerald-400">
                          {selectedKnowledgeRefs.length}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04] focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-200">
                      <Search className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <input
                        value={knowledgeQuery}
                        onChange={(event) => setKnowledgeQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void searchKnowledge();
                          }
                        }}
                        placeholder={t('composer.knowledgeAttach.placeholder')}
                        className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground/70"
                        data-testid="chat-knowledge-search-input"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-lg px-2 text-2xs"
                        disabled={knowledgeSearching || !knowledgeQuery.trim()}
                        onClick={() => void searchKnowledge()}
                        data-testid="chat-knowledge-search-submit"
                      >
                        {knowledgeSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('composer.knowledgeAttach.search')}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto px-1 pb-1">
                    {knowledgeSearchError ? (
                      <div className="rounded-xl px-3 py-3 text-xs text-destructive">
                        {knowledgeSearchError}
                      </div>
                    ) : knowledgeRows.length === 0 ? (
                      <div className="rounded-xl px-3 py-3 text-xs leading-5 text-muted-foreground">
                        {t('composer.knowledgeAttach.empty')}
                      </div>
                    ) : (
                      knowledgeRows.map((row, index) => {
                        const reference = knowledgeReferenceFromRow(row, knowledgeCorpus);
                        if (!reference) return null;
                        const selected = selectedKnowledgeIds.has(reference.id);
                        return (
                          <button
                            key={`${reference.id}:${index}`}
                            type="button"
                            className={cn(
                              'flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors',
                              selected ? 'bg-emerald-500/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
                            )}
                            onClick={() => addKnowledgeReference(row)}
                            data-testid="chat-knowledge-search-result"
                          >
                            <FileText className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', selected ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{reference.title}</span>
                              <span className="mt-0.5 block truncate font-mono text-tiny text-muted-foreground">{reference.pagePath || reference.lookup}</span>
                              {reference.snippet && <span className="mt-1 line-clamp-2 block text-tiny leading-4 text-muted-foreground">{reference.snippet}</span>}
                            </span>
                            {selected ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" /> : null}
                          </button>
                        );
                      })
                    )}
                  </div>
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
            {sending && (
              <div
                className="ml-auto flex shrink-0 items-center gap-1"
                data-testid="chat-intervention-controls"
              >
                {(['guide', 'queue', 'interrupt'] as const).map((mode) => (
                  <Tooltip key={mode}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          data-testid={`chat-intervention-${mode}`}
                          disabled={!canIntervene}
                          onClick={() => void handleInterventionSend(mode)}
                          className={cn(
                            'h-7 rounded-md px-2 text-[11px] font-medium',
                            mode === 'interrupt'
                              ? 'text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400'
                              : mode === 'queue'
                                ? 'text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-400'
                                : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                          )}
                        >
                          {t(`composer.intervention.${mode}`)}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      {t(`composer.intervention.${mode}Tooltip`)}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}

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
              {compactionQuality && (
                <Badge
                  variant="outline"
                  className={cn(
                    'h-6 rounded-md px-2 text-[11px] font-medium',
                    compactionQuality.level === 'high' && 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400',
                    compactionQuality.level === 'medium' && 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                    compactionQuality.level === 'low' && 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
                  )}
                  data-testid="chat-compaction-quality"
                  title={t('composer.compaction.qualityTitle', {
                    evidence: Math.round(compactionQuality.evidenceCoverage * 100),
                    fields: Math.round(compactionQuality.fieldCoverage * 100),
                    tokens: compactionQuality.projectionTokens,
                    unverified: compactionStatus?.lastCompaction?.unverifiedCount ?? 0,
                  })}
                >
                  {t('composer.compaction.quality', {
                    level: t(`composer.compaction.qualityLevel.${compactionQuality.level}`),
                    score: Math.round(compactionQuality.score * 100),
                  })}
                </Badge>
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
          <TaskNodeSelector
            selectedTaskNodeId={activeTaskNodeId}
            onSelect={setActiveTaskNodeId}
          />
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

  const sublabel =
    attachment.mimeType === DIRECTORY_MIME_TYPE
      ? t('composer.folderAttachment')
      : attachment.fileSize > 0
        ? formatFileSize(attachment.fileSize)
        : '...';

  return (
    <AttachmentRoot className="rounded-lg overflow-hidden border border-border">
      {isImage ? (
        <AttachmentThumb
          src={attachment.preview!}
          alt={attachment.fileName}
          className="w-16 h-16"
        />
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 bg-surface-input/50 max-w-[200px]">
          <FileIcon mimeType={attachment.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
          <AttachmentName name={attachment.fileName} sublabel={sublabel} />
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

      <AttachmentRemove onRemove={onRemove} />
    </AttachmentRoot>
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
