/**
 * Chat Input Component
 * Textarea with send button and universal file upload support.
 * Five states: targeted no message, has message, message just sent,
 * system overall hot start, session running, session temporarily paused
 * (SVG style preserved for paused sessions due to state save).
 * Enter to send (queue default), Ctrl+Enter for guide.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged to disk via IPC — only lightweight path references
 * are sent with the message (no base64 over WebSocket).
 */
import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, type ReactNode, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArrowUp,
  AtSign,
  BookOpen,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Copy,
  Database,
  Eye,
  FilePlus,
  FileText,
  Flame,
  FolderPlus,
  Gauge,
  GitBranchPlus,
  History,
  Loader2,
  ListPlus,
  MessageSquarePlus,
  Paperclip,
  PencilLine,
  Plus,
  RotateCcw,
  Search,
  Navigation,
  Play,
  Shield,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  Trash2,
  Wrench,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Hand as CodexHand, Lightbulb as CodexLightbulb, ShieldAlert as CodexShieldAlert } from '@/components/icons/codex-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { hostApi, type ChatKnowledgeReference, type KnowledgeRouteCandidate, type KnowledgeRouteCandidateGroupKey, type KnowledgeSearchResult } from '@/lib/host-api';
import { errorMessageFrom, toastUserError } from '@/lib/user-error';
import type { SendOptions } from '@shared/chat/types';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { TaskNodeSelector } from '@/components/task-ledger/TaskNodeSelector';
import { buildPreviewTarget } from '@/components/file-preview/build-preview-target';
import { AttachmentRemove, AttachmentRoot, AttachmentThumb, DIRECTORY_MIME_TYPE } from '@/components/assistant-ui/attachment';
import { useProviderStore } from '@/stores/providers';
import { buildConfiguredModelOptions, formatModelRefLabel } from '@/lib/model-options';
import type { AgentReasoningEffort, AgentSummary } from '@/types/agent';
import type { QuickAccessSkill } from '@/types/skill';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { collectDroppedFiles } from '@/lib/collect-dropped-files';
import { fetchQuickAccessSkills } from '@/lib/quick-access-skills';
import { ChatAgentEffortPanel, getAgentEffortLabelKey } from '@/components/chat/ChatAgentEffortPopover';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import {
  buildCapabilityActionMessage,
  executeChatCapabilityActions,
  hasSuccessfulCapabilityResult,
  resolveChatCapabilityActions,
  shouldRunChatCapabilityPreflight,
  type ChatCapabilityPlanResolution,
} from '@/lib/chat-capability-actions';
import { isCapabilityAuditBlocked } from '@/lib/capability-audit';
import type {
  KnowledgeInvocationMode,
  LiveTokenUsage,
  PromptCacheRiskAction,
  PromptCacheRiskAssessment,
  PromptCacheRiskDecision,
  WorkspaceContextRange,
  WorkspaceKnowledgeScope,
  WorkspacePermissionMode,
  WorkspaceProfile,
} from '@shared/types/workspace';
import { normalizeWorkspacePermissionMode } from '@shared/types/workspace';
import type { ChatCapabilityActionPlan, ChatCapabilityActionResult, SessionCompactionStatus } from '@shared/host-api/contract';
import type { LongTaskControlStatus, LongTaskInputMode } from '@shared/types/long-task-control';
import type { TaskLoopUpgradeSuggestion } from '@shared/product-semantics';
import { useResolvedTheme } from '@/lib/theme';
import { BorderBeam } from 'border-beam';
import { PlusMenuMorph } from '@/components/ui/plus-menu-morph';
import { SmokyDissolve } from '@/components/ui/smoky-dissolve';
import MaterialFileTypeIcon from '@lobehub/ui/es/MaterialFileTypeIcon/index';
import LobeConfigProvider from '@lobehub/ui/es/ConfigProvider/index';
import type { MotionComponentType } from '@lobehub/ui/es/MotionProvider/index';
import { OFFICE_ACTIONS, findOfficeSkill, type OfficeAction } from './composer-actions';
import { detectTaskLoopUpgradeSuggestion } from './task-loop-upgrade';
import { isProviderRuntimeReady } from '@/lib/setup-provider';

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
  onSend: (text: string, opts?: SendOptions) => void;
  disabled?: boolean;
  sending?: boolean;
  /** A checkpointed stop keeps its affordance when the session is reopened. */
  paused?: boolean;
  onPauseSession?: () => void | Promise<void>;
  onResumeSession?: () => void | Promise<void>;
  workspace?: WorkspaceProfile | null;
  contextRange?: WorkspaceContextRange | null;
  liveUsage?: LiveTokenUsage | null;
  /**
   * Empty-state presentation. The composer is the same component in both
   * states — remounting it on first send would drop the draft, the caret and
   * any in-flight attachment — so the hero look is a prop, not a second copy.
   */
  hero?: boolean;
  draftValue?: string;
  onDraftChange?: (value: string) => void;
  onPermissionModeChange?: (mode: WorkspacePermissionMode) => void;
  onPickWorkspaceFolder?: () => void;
  onSwitchAgent?: (agentId: string) => void | Promise<void>;
  onNewSession?: () => void | Promise<void>;
  onForkSession?: () => void | Promise<void>;
  onHandoffSession?: () => void | Promise<void>;
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
  taskLoopUpgradeBusy?: boolean;
  onConfirmTaskLoopUpgrade?: (suggestion: TaskLoopUpgradeSuggestion) => Promise<void> | void;
  /** Extra classes on the composer host — used for the empty-state send transition. */
  className?: string;
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

// 主按钮交互策略（详见 docs/dev/send-button-states-design.md）：
//   idle                无内容，禁用
//   ready               有内容，点击发送
//   starting            热启动缓冲；有内容时点击立即中止发送，无内容时降级为暂停当前运行
//   running             运行中且无草稿，点击暂停（保存可恢复检查点）
//   running-with-draft  运行中且有草稿：单击默认排队（防抖），双击仍可暂停
//   paused              会话已暂停，点击恢复
type ComposerSendState =
  | 'idle'
  | 'ready'
  | 'starting'
  | 'running'
  | 'running-with-draft'
  | 'paused';

type ComposerSendStateMeta = {
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
  disabled: boolean;
  labelKey: string;
  tooltipKey: string;
};

const SEND_CLICK_DEBOUNCE_MS = 260;

/**
 * How long the composer may claim a run is starting before the run itself has
 * to take over. It is a ceiling on optimism, not a schedule: a rejected send
 * cancels it immediately (see `cancelOptimisticRunStart`).
 */
const RUN_START_AFFORDANCE_MS = 620;

function getComposerSendStateMeta(
  state: ComposerSendState,
  options: { queueable: boolean; resumable: boolean },
): ComposerSendStateMeta {
  switch (state) {
    case 'ready':
      return {
        icon: ArrowUp,
        iconClassName: 'h-5 w-5',
        disabled: false,
        labelKey: 'composer.send',
        tooltipKey: 'composer.send',
      };
    case 'starting':
      return {
        icon: Loader2,
        iconClassName: 'h-4 w-4 animate-spin',
        disabled: false,
        labelKey: 'composer.stop',
        tooltipKey: 'composer.startingTooltip',
      };
    case 'running':
      return {
        icon: Square,
        iconClassName: 'h-3.5 w-3.5 fill-current',
        disabled: false,
        labelKey: 'composer.stop',
        tooltipKey: 'composer.pauseTooltip',
      };
    case 'running-with-draft':
      return options.queueable
        ? {
            icon: ArrowUp,
            iconClassName: 'h-5 w-5',
            disabled: false,
            labelKey: 'composer.intervention.queue',
            tooltipKey: 'composer.queueTooltip',
          }
        : {
            icon: Square,
            iconClassName: 'h-3.5 w-3.5 fill-current',
            disabled: false,
            labelKey: 'composer.stop',
            tooltipKey: 'composer.pauseTooltip',
          };
    case 'paused':
      return options.resumable
        ? {
            icon: Play,
            iconClassName: 'ml-0.5 h-4 w-4 fill-current',
            disabled: false,
            labelKey: 'composer.resume',
            tooltipKey: 'composer.resumeTooltip',
          }
        : {
            icon: Play,
            iconClassName: 'ml-0.5 h-4 w-4 fill-current',
            disabled: true,
            labelKey: 'composer.resume',
            tooltipKey: 'composer.resumeDisabled',
          };
    case 'idle':
    default:
      return {
        icon: ArrowUp,
        iconClassName: 'h-5 w-5',
        disabled: true,
        labelKey: 'composer.send',
        tooltipKey: 'composer.send',
      };
  }
}

type KnowledgeSearchRow = Record<string, unknown>;

const WORKSPACE_PERMISSION_MODES: WorkspacePermissionMode[] = ['readOnly', 'plan', 'acceptEdits', 'fullAccess'];
const LOBE_FILE_ICON_MOTION = {} as MotionComponentType;
// Codex-alignment: each mode maps to a specific glyph (no colour tinting except
// fullAccess, which carries the orange warning). Mirrors the FakeCoding
// approvalOptions icon set — hand/lightbulb/ShieldCheck/shield-alert.
type PermissionModeIcon = ComponentType<{ className?: string }>;
const PERMISSION_MODE_ICONS: Record<WorkspacePermissionMode, PermissionModeIcon> = {
  readOnly: CodexHand as unknown as PermissionModeIcon,
  plan: CodexLightbulb as unknown as PermissionModeIcon,
  acceptEdits: ShieldCheck as unknown as PermissionModeIcon,
  fullAccess: CodexShieldAlert as unknown as PermissionModeIcon,
};
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
  { id: 'goal', group: 'workflow', kind: 'mission', aliases: ['mission'] },
  { id: 'ledger', group: 'workflow', kind: 'ledger', aliases: ['task'] },
  { id: 'compact', group: 'session', kind: 'compact', aliases: ['compress'] },
  { id: 'fork', group: 'session', kind: 'fork' },
  { id: 'handoff', group: 'session', kind: 'handoff' },
  { id: 'new', group: 'session', kind: 'newSession', aliases: ['new-chat'] },
  { id: 'resume', group: 'session', kind: 'resumeSession' },
  { id: 'rename', group: 'session', kind: 'renameSession' },
  { id: 'archive', group: 'session', kind: 'archiveSession' },
  { id: 'delete', group: 'session', kind: 'deleteSession' },
  { id: 'clear', group: 'session', kind: 'clearSession' },
  { id: 'copy', group: 'session', kind: 'copySession' },
] as const;

type SlashCommand = (typeof SLASH_COMMANDS)[number];
type SlashCommandGroup = SlashCommand['group'];

const SLASH_COMMAND_GROUP_ORDER: SlashCommandGroup[] = ['knowledge', 'coding', 'workflow', 'session'];
type SlashPaletteGroup = SlashCommandGroup | 'skills';
type SlashPaletteCommandItem = {
  id: string;
  type: 'command';
  group: SlashCommandGroup;
  command: SlashCommand;
};
type SlashPaletteSkillItem = {
  id: string;
  type: 'skill';
  group: 'skills';
  skill: QuickAccessSkill;
};
type SlashPaletteItem = SlashPaletteCommandItem | SlashPaletteSkillItem;

const SLASH_PALETTE_GROUP_ORDER: SlashPaletteGroup[] = ['skills', ...SLASH_COMMAND_GROUP_ORDER];
const EMPTY_QUERY_SKILL_LIMIT = 6;
const FILTERED_SKILL_LIMIT = 20;

type SlashInputState = {
  active: boolean;
  commandText: string;
  args: string;
  allowsCommands: boolean;
  replacementStart: number;
  replacementEnd: number;
};

type SlashCommandTranslate = (key: string, options?: Record<string, unknown>) => string;

function parseSlashInput(value: string): SlashInputState {
  const inactive: SlashInputState = {
    active: false,
    commandText: '',
    args: '',
    allowsCommands: false,
    replacementStart: 0,
    replacementEnd: 0,
  };

  if (!/^\s*\//u.test(value)) {
    const inlineMatch = /(^|\s)\/([^\s]*)$/u.exec(value);
    if (!inlineMatch) return inactive;
    return {
      active: true,
      commandText: (inlineMatch[2] ?? '').trim().toLowerCase(),
      args: '',
      allowsCommands: false,
      replacementStart: inlineMatch.index + (inlineMatch[1]?.length ?? 0),
      replacementEnd: value.length,
    };
  }
  const body = value.trimStart().slice(1);
  if (/^[^\s]+\s{2}/u.test(body)) {
    const inlineMatch = /(^|\s)\/([^\s]*)$/u.exec(value);
    if (!inlineMatch) return inactive;
    return {
      active: true,
      commandText: (inlineMatch[2] ?? '').trim().toLowerCase(),
      args: '',
      allowsCommands: false,
      replacementStart: inlineMatch.index + (inlineMatch[1]?.length ?? 0),
      replacementEnd: value.length,
    };
  }
  const replacementStart = value.match(/^\s*/u)?.[0].length ?? 0;
  const separator = body.search(/\s/u);
  if (separator === -1) {
    return {
      active: true,
      commandText: body.trim().toLowerCase(),
      args: '',
      allowsCommands: true,
      replacementStart,
      replacementEnd: value.length,
    };
  }
  const bodyStart = replacementStart + 1;
  let replacementEnd = bodyStart + separator;
  while (replacementEnd < value.length && /\s/u.test(value[replacementEnd] ?? '')) {
    replacementEnd += 1;
  }
  return {
    active: true,
    commandText: body.slice(0, separator).trim().toLowerCase(),
    args: body.slice(separator + 1).trim(),
    allowsCommands: true,
    replacementStart,
    replacementEnd,
  };
}

function slashCommandNames(command: SlashCommand): string[] {
  return [command.id, ...('aliases' in command ? command.aliases : [])];
}

function slashCommandMatchesQuery(command: SlashCommand, query: string): boolean {
  if (!query) return true;
  return slashCommandNames(command).some((name) => name.startsWith(query));
}

function findExactSlashCommand(commandText: string): SlashCommand | null {
  const normalized = commandText.trim().toLowerCase();
  if (!normalized) return null;
  return SLASH_COMMANDS.find((command) => slashCommandNames(command).includes(normalized)) ?? null;
}

function slashSkillMatchesQuery(skill: QuickAccessSkill, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  return [
    skill.name,
    skill.description,
    skill.sourceLabel,
  ].some((value) => value.toLowerCase().includes(normalized));
}

function slashSkillSortScore(skill: QuickAccessSkill, query: string): number {
  if (!query) return 3;
  const name = skill.name.toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  return 2;
}

function SlashCommandIcon({ command }: { command: SlashCommand }) {
  const className = 'h-3.5 w-3.5';
  switch (command.id) {
    case 'wiki':
      return <BookOpen className={className} />;
    case 'memory':
      return <Database className={className} />;
    case 'all':
      return <BookOpen className={className} />;
    case 'none':
      return <CircleSlash className={className} />;
    case 'scope':
      return <Search className={className} />;
    case 'knowledge-mode':
      return <Gauge className={className} />;
    case 'save':
      return <FileText className={className} />;
    case 'steward':
      return <Users className={className} />;
    case 'steward-audit':
      return <Shield className={className} />;
    case 'review':
      return <Search className={className} />;
    case 'fix-ci':
      return <Wrench className={className} />;
    case 'write-tests':
      return <Check className={className} />;
    case 'explain-diff':
      return <FileText className={className} />;
    case 'commit':
    case 'pr-summary':
      return <GitBranchPlus className={className} />;
    case 'goal':
      return <Target className={className} />;
    case 'ledger':
      return <Check className={className} />;
    case 'compact':
      return <Archive className={className} />;
    case 'fork':
      return <GitBranchPlus className={className} />;
    case 'handoff':
      return <MessageSquarePlus className={className} />;
    case 'new':
      return <FilePlus className={className} />;
    case 'resume':
      return <History className={className} />;
    case 'rename':
      return <PencilLine className={className} />;
    case 'archive':
      return <Archive className={className} />;
    case 'delete':
      return <Trash2 className={className} />;
    case 'clear':
      return <RotateCcw className={className} />;
    case 'copy':
      return <Copy className={className} />;
    default:
      return <Wrench className={className} />;
  }
}

function SlashCommandPalette({
  items,
  getCommandStatus,
  onHover,
  onSelect,
  selectedIndex,
  skillsError,
  skillsLoading,
  slashInput,
  t,
}: {
  items: SlashPaletteItem[];
  getCommandStatus: (command: SlashCommand) => string;
  onHover: (index: number) => void;
  onSelect: (item: SlashPaletteItem) => void;
  selectedIndex: number;
  skillsError: string | null;
  skillsLoading: boolean;
  slashInput: SlashInputState;
  t: SlashCommandTranslate;
}) {
  const hasItems = items.length > 0;
  const showSkillFeedback = skillsLoading || Boolean(skillsError);

  return (
    <div
      role="listbox"
      aria-label={t('composer.slashCommands.menuLabel')}
      data-testid="chat-slash-command-menu"
      data-layout="compact-command-list"
      className="absolute bottom-full -left-px -right-px z-30 mb-2 max-h-[320px] overflow-hidden rounded-xl border border-black/[0.08] bg-surface-modal shadow-lg shadow-black/[0.1] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150 motion-reduce:animate-none dark:border-white/[0.08] dark:shadow-black/40"
    >
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] px-3 py-2 dark:border-white/[0.06]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-black/[0.06] bg-black/[0.03] text-muted-foreground shadow-sm dark:border-white/[0.08] dark:bg-white/[0.06]">
              <Wrench className="h-3.5 w-3.5" />
            </span>
            <p className="truncate text-xs font-medium text-foreground">{t('composer.slashCommands.title')}</p>
          </div>
          <p className="mt-0.5 truncate text-2xs leading-4 text-muted-foreground">
            {t('composer.slashCommands.subtitle')}
          </p>
        </div>
        <code className="shrink-0 rounded-md border border-black/[0.06] bg-black/[0.03] px-1.5 py-1 font-mono text-2xs text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.06]">
          /{slashInput.commandText || ''}
        </code>
      </div>

      {!hasItems && !showSkillFeedback ? (
        <div className="px-3 py-3" data-testid="chat-slash-command-empty">
          <p className="text-xs font-medium text-foreground">{t('composer.slashCommands.unknownTitle')}</p>
          <p className="mt-0.5 text-2xs leading-4 text-muted-foreground">
            {t('composer.slashCommands.unknownDescription', { command: `/${slashInput.commandText}` })}
          </p>
        </div>
      ) : (
        <div className="max-h-[398px] overflow-y-auto p-1.5 [scrollbar-gutter:stable]">
          {showSkillFeedback && (
            <div>
              <div className="px-2 pb-1 pt-2" data-testid="chat-slash-command-group-skills">
                <div className="text-tiny font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {t('composer.slashCommands.groups.skills')}
                </div>
                <div className="mt-0.5 truncate text-2xs leading-4 text-muted-foreground/55">
                  {t('composer.slashCommands.groupDescriptions.skills')}
                </div>
              </div>
              <div
                className={cn(
                  'mx-1 rounded-md px-2 py-2 text-xs',
                  skillsError ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {skillsError || t('composer.skillLoading')}
              </div>
            </div>
          )}

          {items.map((item, index) => {
            const previous = items[index - 1];
            const showGroup = !previous || previous.group !== item.group;
            const selected = index === selectedIndex;

            return (
              <div key={item.id}>
                {showGroup && (
                  <div className="sticky top-0 z-10 bg-surface-modal/95 px-2 pb-1 pt-2 backdrop-blur-sm" data-testid={`chat-slash-command-group-${item.group}`}>
                    <div className="text-tiny font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {t(`composer.slashCommands.groups.${item.group}`)}
                    </div>
                    <div className="sr-only">
                      {t(`composer.slashCommands.groupDescriptions.${item.group}`)}
                    </div>
                  </div>
                )}

                {item.type === 'command' ? (() => {
                  const { command } = item;
                  const status = getCommandStatus(command);
                  const argumentHint = t(`composer.slashCommands.commands.${command.id}.argumentHint`);

                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-testid={`chat-slash-command-option-${command.id}`}
                      className="codex-composer-menu__item codex-composer-menu__item--compact"
                      data-selected={selected ? 'true' : undefined}
                      onMouseEnter={() => onHover(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onSelect(item)}
                    >
                      <span
                        data-testid={`chat-slash-command-icon-${command.id}`}
                        className="codex-composer-menu__icon"
                      >
                        <SlashCommandIcon command={command} />
                      </span>
                      <span className="codex-composer-menu__text">{t(`composer.slashCommands.commands.${command.id}.label`)}</span>
                      <span className="codex-composer-menu__hint">/{command.id}</span>
                      {argumentHint && <span className="codex-composer-menu__hint hidden sm:inline">{argumentHint}</span>}
                      <span className="codex-composer-menu__desc">{t(`composer.slashCommands.commands.${command.id}.description`)}</span>
                      {status && (
                        <span className="codex-composer-menu__hint max-w-[120px] truncate">{status}</span>
                      )}
                    </button>
                  );
                })() : (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-testid={`chat-composer-skill-option-${item.skill.name}`}
                    className="codex-composer-menu__item codex-composer-menu__item--compact"
                    data-selected={selected ? 'true' : undefined}
                    onMouseEnter={() => onHover(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSelect(item)}
                  >
                    <span
                      data-testid={`chat-slash-skill-icon-${item.skill.name}`}
                      className="codex-composer-menu__icon"
                    >
                      <Wrench />
                    </span>
                    <span className="codex-composer-menu__text">/{item.skill.name}</span>
                    <span className="codex-composer-menu__desc">{item.skill.description}</span>
                    <span className="codex-composer-menu__hint max-w-[120px] truncate">{item.skill.sourceLabel}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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

const KNOWLEDGE_PREFLIGHT_GROUP_ORDER: KnowledgeRouteCandidateGroupKey[] = ['docs', 'pitfalls', 'rules'];

function routeGroupForCandidate(candidate: KnowledgeRouteCandidate): KnowledgeRouteCandidateGroupKey {
  if (candidate.routeGroup === 'pitfalls' || candidate.routeGroup === 'rules' || candidate.routeGroup === 'docs') {
    return candidate.routeGroup;
  }
  const status = `${candidate.matchedClaimStatus ?? ''} ${candidate.freshnessLevel ?? ''}`.toLowerCase();
  const lookup = `${candidate.lookup} ${candidate.pagePath ?? ''} ${candidate.sourcePath ?? ''}`.toLowerCase();
  if (/rule|agents\.md|harness\/specs|convention/u.test(status) || /rule|agents\.md|harness\/specs|convention/u.test(lookup)) {
    return 'rules';
  }
  if (/error|failure|pitfall|troubleshoot|incident|unreviewed/u.test(status) || /error|failure|pitfall|troubleshoot|incident/u.test(lookup)) {
    return 'pitfalls';
  }
  return 'docs';
}

function groupKnowledgePreflightCandidates(candidates: KnowledgeRouteCandidate[]) {
  return KNOWLEDGE_PREFLIGHT_GROUP_ORDER
    .map((key) => ({
      key,
      candidates: candidates.filter((candidate) => routeGroupForCandidate(candidate) === key),
    }))
    .filter((group) => group.candidates.length > 0);
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

function formatPromptCacheHitRate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
}

function promptCacheRiskActionForCapabilityPlan(plan: ChatCapabilityActionPlan[]): PromptCacheRiskAction | null {
  for (const action of plan) {
    if (action.kind === 'skill.enable' && !action.skillAlreadyEnabled) return 'skill-enable';
    if (action.kind === 'mcp.register') return 'mcp-register';
    if (action.kind === 'mcp.reload') return 'mcp-reload';
  }
  return null;
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

function findSkillTokenRanges(value: string): SkillTokenRange[] {
  const ranges: SkillTokenRange[] = [];
  const skillTokenPattern = /\/[^\s]+ {2}/g;
  let match: RegExpExecArray | null;
  while ((match = skillTokenPattern.exec(value)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
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
      <Tooltip key={`skill-token-${tokenRange.start}`}>
        <TooltipTrigger asChild>
      <button
        type="button"
        data-testid="chat-composer-skill-token"
        data-skill-name={skillName}
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
      </button>
        </TooltipTrigger>
        <TooltipContent side="top">{options.previewTooltip}</TooltipContent>
      </Tooltip>,
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
  disabled = false,
  sending = false,
  paused = false,
  onPauseSession,
  onResumeSession,
  contextRange,
  liveUsage,
  hero = false,
  draftValue,
  onDraftChange,
  workspace,
  onPermissionModeChange,
  onPickWorkspaceFolder,
  onSwitchAgent,
  onNewSession,
  onForkSession,
  onHandoffSession,
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
  taskLoopUpgradeBusy = false,
  onConfirmTaskLoopUpgrade,
  className,
}: ChatInputProps) {
  const resolvedTheme = useResolvedTheme();
  const { t } = useTranslation('chat');
  const [input, setInput] = useState(() => draftValue ?? '');
  const [runStarting, setRunStarting] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  /** Area 2 §3.1: turn-scoped model override; cleared after each send. */
  const [pendingTurnModelRef, setPendingTurnModelRef] = useState<string | null>(null);
  const [modelScope, setModelScope] = useState<'turn' | 'session' | 'persistent'>('persistent');
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [morphOpen, setMorphOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [executionSettingsSection, setExecutionSettingsSection] = useState<'model' | 'effort' | null>(null);
  const [executionEffortPreview, setExecutionEffortPreview] = useState<AgentReasoningEffort>('auto');
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false);
  const [knowledgeQuery, setKnowledgeQuery] = useState('');
  const [knowledgeSearchResult, setKnowledgeSearchResult] = useState<KnowledgeSearchResult | null>(null);
  const [knowledgeSearching, setKnowledgeSearching] = useState(false);
  const [knowledgeSearchError, setKnowledgeSearchError] = useState<string | null>(null);
  const [selectedKnowledgeRefs, setSelectedKnowledgeRefs] = useState<ChatKnowledgeReference[]>([]);
  const [suggestedKnowledgeRefs, setSuggestedKnowledgeRefs] = useState<KnowledgeRouteCandidate[]>([]);
  const [knowledgePreflightExpanded, setKnowledgePreflightExpanded] = useState(false);
  const [knowledgeRoutingBusy, setKnowledgeRoutingBusy] = useState(false);
  const dismissedRouteKeysRef = useRef<Map<string, number>>(new Map());
  const [quickSkills, setQuickSkills] = useState<QuickAccessSkill[]>([]);
  const [dynamicSkillCommands, setDynamicSkillCommands] = useState<QuickAccessSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [switchingModelRef, setSwitchingModelRef] = useState<string | null>(null);
  const [optimisticModelRef, setOptimisticModelRef] = useState<string | null>(null);
  const [compactionDialogOpen, setCompactionDialogOpen] = useState(false);
  const [compactionInstructions, setCompactionInstructions] = useState('');
  const sessionGenerationRef = useRef(0);
  const cancelCacheConfirmationsRef = useRef(new Set<() => void>());
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
  const runStartTimerRef = useRef<number | null>(null);
  const runStartingRef = useRef(false);
  const sendClickTimerRef = useRef<number | null>(null);
  const previousSendingRef = useRef(sending);
  /**
   * Latest `sending`, readable from async callbacks.
   *
   * `handleSend` can bail out long after the click (provider gate, capability
   * preflight, an extension's before-send hook), and the optimistic "starting"
   * affordance has to know whether a run actually began before it rolls itself
   * back. Reading the prop from the closure would give the value at click time,
   * which is always `false`.
   */
  const sendingRef = useRef(sending);
  const composerHostRef = useRef<HTMLDivElement>(null);
  const heroComposerRectRef = useRef<{ top: number } | null>(null);
  const composerTransitionRef = useRef<Animation | null>(null);
  const composerTransitionFrameRef = useRef<number | null>(null);
  const composerTransitionTimerRef = useRef<number | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const knowledgePickerRef = useRef<HTMLDivElement>(null);
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
  const currentSession = useChatStore((s) => s.sessions.find((session) => session.key === s.currentSessionKey));
  const pendingMessages = useChatStore((s) => s.pendingMessages);
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const currentAgentName = useMemo(
    () => currentAgent?.name ?? currentAgentId,
    [currentAgent, currentAgentId],
  );
  useEffect(() => {
    setExecutionEffortPreview(currentAgent?.reasoningEffort ?? 'auto');
  }, [currentAgent?.id, currentAgent?.reasoningEffort]);
  const modelOptions = useMemo(
    () => buildConfiguredModelOptions(providerAccounts, providerStatuses, providerDefaultAccountId),
    [providerAccounts, providerDefaultAccountId, providerStatuses],
  );
  // FP-P1-01: first-send gate. When no usable provider exists (e.g. Setup was
  // skipped), intercept the send with guidance instead of failing downstream.
  const providerRuntimeReady = useMemo(
    () =>
      isProviderRuntimeReady({
        accounts: providerAccounts,
        statuses: providerStatuses,
        defaultAccountId: providerDefaultAccountId,
      }),
    [providerAccounts, providerStatuses, providerDefaultAccountId],
  );
  const [providerGateOpen, setProviderGateOpen] = useState(false);
  const navigate = useNavigate();
  const sessionModelRef = currentSession?.modelRefOverride;
  const effectiveModelRef = pendingTurnModelRef || optimisticModelRef || sessionModelRef || currentAgent?.modelRef || defaultModelRef || modelOptions[0]?.modelRef || null;
  const effectiveModelLabel = effectiveModelRef
    ? formatModelRefLabel(effectiveModelRef)
    : t('composer.modelSourceDefault');
  const currentEffortLabel = t(getAgentEffortLabelKey(executionEffortPreview));
  const mentionableAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  );
  const selectedTarget = useMemo(
    () => (agents ?? []).find((agent) => agent.id === targetAgentId) ?? null,
    [agents, targetAgentId],
  );
  const knowledgeCorpus = knowledgeCorpusForScope(knowledgeScope);
  const knowledgeRows = useMemo(() => getKnowledgeSearchRows(knowledgeSearchResult), [knowledgeSearchResult]);
  const selectedKnowledgeIds = useMemo(() => new Set(selectedKnowledgeRefs.map((reference) => reference.id)), [selectedKnowledgeRefs]);
  const suggestedKnowledgeGroups = useMemo(() => groupKnowledgePreflightCandidates(suggestedKnowledgeRefs), [suggestedKnowledgeRefs]);
  const suggestedKnowledgeCounts = useMemo(() => {
    const counts: Record<KnowledgeRouteCandidateGroupKey, number> = { docs: 0, pitfalls: 0, rules: 0 };
    for (const group of suggestedKnowledgeGroups) counts[group.key] = group.candidates.length;
    return counts;
  }, [suggestedKnowledgeGroups]);
  const showAgentPicker = mentionableAgents.length > 0;
  // Keep model choice discoverable even when only one configured model exists.
  // The current agent model is also a valid fallback while provider accounts
  // are still hydrating, so the control never vanishes during startup.
  const pickerModelOptions = modelOptions.length > 0
    ? modelOptions
    : effectiveModelRef
      ? [{ modelRef: effectiveModelRef, label: formatModelRefLabel(effectiveModelRef) }]
      : [];
  const showModelPicker = pickerModelOptions.length > 0;
  const showWorkspaceMenu = Boolean(
    workspace
    || onPickWorkspaceFolder
    || onPermissionModeChange
    || onSwitchAgent
    || onNewSession,
  );
  const activePermissionMode = normalizeWorkspacePermissionMode(workspace?.permissionMode);
  const workspaceMenuTitle = workspace && onPermissionModeChange
    ? t('composer.permissionModeTitle')
    : t('composer.workspaceActions');
  const chatComposerStatusComponents = rendererExtensionRegistry.getChatComposerStatusComponents();
  const isGatewayUsable = gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false;
  const inputDisabled = disabled || !isGatewayUsable;
  const skillTokenRanges = useMemo(() => findSkillTokenRanges(input), [input]);
  const openWorkspacePanel = useArtifactPanel((s) => s.openWorkspacePanel);

  /**
   * The optimistic "starting" affordance.
   *
   * Two things can raise it: the send button (instantly, so the click has a
   * visible consequence before the store has done any async work) and the
   * `sending` transition itself. Both hand it to the same timer, and
   * `cancelOptimisticRunStart` is the one way down — a send that is REJECTED
   * (no provider, unsupported capability, an extension veto) must drop the
   * affordance the moment it is rejected rather than leave a Stop icon sitting
   * over the composer while a modal explains why nothing was sent.
   */
  const beginOptimisticRunStart = useCallback(() => {
    if (runStartTimerRef.current != null) window.clearTimeout(runStartTimerRef.current);
    runStartingRef.current = true;
    setRunStarting(true);
    runStartTimerRef.current = window.setTimeout(() => {
      runStartingRef.current = false;
      setRunStarting(false);
      runStartTimerRef.current = null;
    }, RUN_START_AFFORDANCE_MS);
  }, []);

  const cancelOptimisticRunStart = useCallback(() => {
    if (runStartTimerRef.current != null) {
      window.clearTimeout(runStartTimerRef.current);
      runStartTimerRef.current = null;
    }
    runStartingRef.current = false;
    setRunStarting(false);
  }, []);

  useEffect(() => {
    sendingRef.current = sending;
    const wasSending = previousSendingRef.current;
    previousSendingRef.current = sending;
    if (!sending || wasSending) return;
    beginOptimisticRunStart();
    return cancelOptimisticRunStart;
  }, [beginOptimisticRunStart, cancelOptimisticRunStart, sending]);

  useEffect(() => () => {
    if (runStartTimerRef.current != null) {
      window.clearTimeout(runStartTimerRef.current);
    }
    if (sendClickTimerRef.current != null) {
      window.clearTimeout(sendClickTimerRef.current);
    }
  }, []);

  // The first optimistic message changes the page from a centered hero layout
  // to the docked conversation layout. Animate that real layout delta so the
  // composer lands directly at its final position without an added overshoot.
  useLayoutEffect(() => {
    const host = composerHostRef.current;
    if (!host) return;

    const nextRect = host.getBoundingClientRect();
    if (hero) {
      composerTransitionRef.current?.cancel();
      heroComposerRectRef.current = { top: nextRect.top };
      return;
    }

    const previousRect = heroComposerRectRef.current;
    if (!previousRect) return;
    heroComposerRectRef.current = null;

    const deltaY = previousRect.top - nextRect.top;
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (Math.abs(deltaY) < 1 || reducedMotion) return;

    composerTransitionRef.current?.cancel();
    if (typeof host.animate === 'function') {
      composerTransitionRef.current = host.animate(
        [
          { transform: `translate3d(0, ${deltaY}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: 520,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
      );
      return;
    }

    // Browser-only mock mode does not expose Element.animate. Use the same
    // FLIP delta with a CSS transition so the visual behavior stays identical.
    host.style.transition = 'none';
    host.style.transform = `translate3d(0, ${deltaY}px, 0)`;
    if (composerTransitionFrameRef.current != null) {
      window.cancelAnimationFrame(composerTransitionFrameRef.current);
    }
    if (composerTransitionTimerRef.current != null) {
      window.clearTimeout(composerTransitionTimerRef.current);
    }
    composerTransitionFrameRef.current = window.requestAnimationFrame(() => {
      composerTransitionFrameRef.current = null;
      host.style.transition = 'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)';
      host.style.transform = 'translate3d(0, 0, 0)';
      composerTransitionTimerRef.current = window.setTimeout(() => {
        composerTransitionTimerRef.current = null;
        host.style.transition = '';
        host.style.transform = '';
      }, 540);
    });
  });

  useEffect(() => () => {
    composerTransitionRef.current?.cancel();
    if (composerTransitionFrameRef.current != null) window.cancelAnimationFrame(composerTransitionFrameRef.current);
    if (composerTransitionTimerRef.current != null) window.clearTimeout(composerTransitionTimerRef.current);
  }, []);

  const captureHeroComposerPosition = useCallback(() => {
    if (!hero || !composerHostRef.current) return;
    heroComposerRectRef.current = {
      top: composerHostRef.current.getBoundingClientRect().top,
    };
  }, [hero]);

  const updateInput = useCallback((value: string) => {
    setInput(value);
    onDraftChange?.(value);
  }, [onDraftChange]);

  const recordPromptCacheDecision = useCallback((
    assessment: PromptCacheRiskAssessment,
    decision: PromptCacheRiskDecision,
  ) => {
    void hostApi.usage.recordPromptCacheRiskEvent({
      sessionKey: currentSessionKey,
      action: assessment.action ?? 'context-reset',
      severity: assessment.severity,
      status: assessment.status,
      decision,
      hitRate: assessment.hitRate,
      promptTokens: assessment.promptTokens,
      ...(assessment.estimatedExtraCostUsd != null
        ? { estimatedExtraCostUsd: assessment.estimatedExtraCostUsd }
        : {}),
      ...(assessment.reason ? { reason: assessment.reason } : {}),
    }).catch(() => {
      // Best-effort ledger; the user action should not fail because telemetry did.
    });
  }, [currentSessionKey]);

  const confirmPromptCacheRisk = useCallback(async (
    action: PromptCacheRiskAction,
    targetModelRef?: string | null,
  ): Promise<boolean> => {
    const generation = sessionGenerationRef.current;
    const isCurrentSession = () => generation === sessionGenerationRef.current
      && useChatStore.getState().currentSessionKey === currentSessionKey;
    let assessment: PromptCacheRiskAssessment | null = null;
    try {
      const result = await hostApi.usage.promptCacheStatus({
        sessionKey: currentSessionKey,
        modelRef: effectiveModelRef,
        targetModelRef,
        action,
        usedTokens: liveUsage?.totalTokens ?? contextRange?.usedTokens ?? null,
      });
      assessment = result.success ? result.assessment : null;
    } catch {
      assessment = null;
    }

    if (!isCurrentSession()) return false;
    if (!assessment?.shouldWarn) {
      return true;
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const toastRef: { id: string | number | undefined } = { id: undefined };
      const settle = (decision: PromptCacheRiskDecision) => {
        if (settled) return;
        settled = true;
        if (toastRef.id !== undefined) toast.dismiss(toastRef.id);
        cancelCacheConfirmationsRef.current.delete(cancel);
        const current = isCurrentSession();
        recordPromptCacheDecision(assessment, current ? decision : 'cancelled');
        resolve(current && decision === 'continued');
      };
      const cancel = () => settle('cancelled');
      cancelCacheConfirmationsRef.current.add(cancel);

      const actionLabel = t(`composer.promptCacheGuard.action.${action}`, {
        defaultValue: action,
      });
      const reasonLabel = assessment.reason
        ? t(`composer.promptCacheGuard.reason.${assessment.reason}`, {
          defaultValue: assessment.reason,
        })
        : t('composer.promptCacheGuard.reason.default');
      toastRef.id = toast.warning(t('composer.promptCacheGuard.title'), {
        description: t('composer.promptCacheGuard.description', {
          action: actionLabel,
          tokens: formatCompactNumber(assessment.promptTokens),
          hitRate: formatPromptCacheHitRate(assessment.hitRate),
          reason: reasonLabel,
        }),
        duration: Infinity,
        closeButton: true,
        testId: 'prompt-cache-risk-toast',
        action: {
          label: t('composer.promptCacheGuard.continue'),
          onClick: () => settle('continued'),
        },
        cancel: {
          label: t('composer.promptCacheGuard.cancel'),
          onClick: () => settle('cancelled'),
        },
        onDismiss: () => settle('cancelled'),
        onAutoClose: () => settle('cancelled'),
      });
    });
  }, [
    contextRange?.usedTokens,
    currentSessionKey,
    effectiveModelRef,
    liveUsage?.totalTokens,
    recordPromptCacheDecision,
    t,
  ]);

  const closeComposerPopovers = useCallback(() => {
    setActionMenuOpen(false);
    setMorphOpen(false);
    setPickerOpen(false);
    setModelPickerOpen(false);
    setKnowledgePickerOpen(false);
    setWorkspaceMenuOpen(false);
  }, []);

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
  const queuedFollowupCount = longTaskControlStatus?.queueCount ?? 0;
  const hasLongTaskControlDetails = queuedFollowupCount > 0
    || Boolean(longTaskControlStatus?.latestCheckpoint?.trigger)
    || Boolean(longTaskControlStatus?.latestIntervention)
    || (longTaskControlStatus?.warnings?.length ?? 0) > 0;
  const slashInput = useMemo(() => parseSlashInput(input), [input]);
  const slashItems = useMemo<SlashPaletteItem[]>(() => {
    if (!slashInput.active) return [];
    const query = slashInput.commandText;
    const commands = !slashInput.allowsCommands
      ? []
      : !query
        ? [...SLASH_COMMANDS]
        : SLASH_COMMANDS.filter((command) => slashCommandMatchesQuery(command, query));
    const commandItems = [...commands].sort((left: SlashCommand, right: SlashCommand) => {
      if (query) {
        const leftExact = slashCommandNames(left).includes(query);
        const rightExact = slashCommandNames(right).includes(query);
        if (leftExact !== rightExact) return leftExact ? -1 : 1;
        const leftPrefix = slashCommandNames(left).some((name) => name.startsWith(query));
        const rightPrefix = slashCommandNames(right).some((name) => name.startsWith(query));
        if (leftPrefix !== rightPrefix) return leftPrefix ? -1 : 1;
      }
      return SLASH_COMMAND_GROUP_ORDER.indexOf(left.group) - SLASH_COMMAND_GROUP_ORDER.indexOf(right.group);
    }).map((command): SlashPaletteCommandItem => ({
      id: `command:${command.id}`,
      type: 'command',
      group: command.group,
      command,
    }));

    const skillItems = [...quickSkills, ...dynamicSkillCommands]
      .filter((skill) => slashSkillMatchesQuery(skill, query))
      .sort((left, right) => {
        const scoreDelta = slashSkillSortScore(left, query) - slashSkillSortScore(right, query);
        if (scoreDelta !== 0) return scoreDelta;
        return left.name.localeCompare(right.name);
      })
      .slice(0, query ? FILTERED_SKILL_LIMIT : EMPTY_QUERY_SKILL_LIMIT)
      .map((skill): SlashPaletteSkillItem => ({
        id: `skill:${skill.source}:${skill.name}`,
        type: 'skill',
        group: 'skills',
        skill,
      }));

    return [...skillItems, ...commandItems].sort((left, right) => {
      const groupDelta = SLASH_PALETTE_GROUP_ORDER.indexOf(left.group) - SLASH_PALETTE_GROUP_ORDER.indexOf(right.group);
      if (groupDelta !== 0) return groupDelta;
      return 0;
    });
  }, [dynamicSkillCommands, quickSkills, slashInput.active, slashInput.allowsCommands, slashInput.commandText]);
  const slashMenuOpen = slashInput.active && !slashMenuDismissed;
  const selectedSlashItem = slashItems[Math.min(slashSelectedIndex, Math.max(0, slashItems.length - 1))] ?? null;
  const taskLoopUpgradeSuggestion = useMemo(
    () => detectTaskLoopUpgradeSuggestion({ text: input, sessionId: currentSessionKey }),
    [currentSessionKey, input],
  );
  const showTaskLoopUpgradeSuggestion = Boolean(
    onConfirmTaskLoopUpgrade
    && taskLoopUpgradeSuggestion
    && !inputDisabled
    && !sending
    && !slashInput.active,
  );

  const handleConfirmTaskLoopUpgrade = useCallback(async () => {
    if (!taskLoopUpgradeSuggestion || !onConfirmTaskLoopUpgrade || taskLoopUpgradeBusy) return;
    const generation = sessionGenerationRef.current;
    try {
      await onConfirmTaskLoopUpgrade(taskLoopUpgradeSuggestion);
      if (generation !== sessionGenerationRef.current) return;
      updateInput('');
    } catch {
      // The parent surface owns the user-facing failure toast; keep the draft intact.
    }
  }, [onConfirmTaskLoopUpgrade, taskLoopUpgradeBusy, taskLoopUpgradeSuggestion, updateInput]);

  useEffect(() => {
    if (slashMenuOpen && workspaceMenuOpen) {
      setWorkspaceMenuOpen(false);
    }
  }, [slashMenuOpen, workspaceMenuOpen]);

  const getSlashCommandStatus = useCallback((command: SlashCommand) => {
    if (command.kind === 'scope') {
      return t(`composer.knowledgeScope.${command.scope}`);
    }
    if (command.kind === 'scopePicker') {
      return t(`composer.knowledgeScope.${knowledgeScope}`);
    }
    if (command.kind === 'knowledgeMode') {
      return t(`composer.knowledgeMode.${knowledgeMode}`);
    }
    if (command.kind === 'wikiSearch') {
      return selectedKnowledgeRefs.length > 0
        ? t('composer.knowledgeAttach.selected', { count: selectedKnowledgeRefs.length })
        : t('composer.knowledgeScope.wiki');
    }
    if (command.kind === 'compact') {
      if (compactDisabledReason) return compactDisabledReason;
      if (compactionUsedTokens != null && compactionMaxTokens != null && compactionMaxTokens > 0) {
        return t('composer.tokenUsageWithLimit', {
          used: formatCompactNumber(compactionUsedTokens),
          max: formatCompactNumber(compactionMaxTokens),
        });
      }
      if (compactionHiddenCount > 0) {
        return t('composer.contextHidden', { count: compactionHiddenCount });
      }
    }
    if (command.kind === 'fork' && forkDisabled) {
      return t('composer.slashCommands.toasts.forkUnavailable');
    }
    if (command.kind === 'handoff' && handoffDisabled) {
      return t('composer.handoff.disabledActiveRun');
    }
    return t(`composer.slashCommands.groups.${command.group}`);
  }, [
    compactDisabledReason,
    compactionHiddenCount,
    compactionMaxTokens,
    compactionUsedTokens,
    forkDisabled,
    handoffDisabled,
    knowledgeMode,
    knowledgeScope,
    selectedKnowledgeRefs.length,
    t,
  ]);

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashInput.commandText, slashItems.length]);

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
      const message = errorMessageFrom(error);
      setKnowledgeSearchError(message);
      toastUserError(error);
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
      const inboxTargetId = reference.lookup.startsWith('inbox:') ? reference.lookup.slice('inbox:'.length) : '';
      void hostApi.knowledge.recordKnowledgeReference({
        targetId: inboxTargetId || reference.lookup,
        targetKind: inboxTargetId ? 'inbox' : 'wiki-page',
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
    if (dismissedAt && Date.now() - dismissedAt < 10 * 60 * 1000) {
      setSuggestedKnowledgeRefs([]);
      setKnowledgePreflightExpanded(false);
      return [];
    }

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
      const routedCandidates = result.candidates.length > 0
        ? result.candidates
        : (result.candidateGroups ?? []).flatMap((group) => group.candidates);
      if (result.decision === 'suggest') {
        setSuggestedKnowledgeRefs(routedCandidates);
        setKnowledgePreflightExpanded(false);
        return [];
      }
      if (result.decision === 'auto_attach') {
        setSuggestedKnowledgeRefs([]);
        setKnowledgePreflightExpanded(false);
        return routedCandidates;
      }
      setSuggestedKnowledgeRefs([]);
      setKnowledgePreflightExpanded(false);
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
    setKnowledgePreflightExpanded(false);
    if (knowledgeScope === 'none') void onKnowledgeScopeChange?.('wiki');
  }, [knowledgeScope, onKnowledgeScopeChange, suggestedKnowledgeRefs]);

  const dismissSuggestedKnowledge = useCallback(() => {
    const routeKey = `${currentSessionKey}:${knowledgeScope}:${input.trim().slice(0, 120).toLowerCase()}`;
    dismissedRouteKeysRef.current.set(routeKey, Date.now());
    setSuggestedKnowledgeRefs([]);
    setKnowledgePreflightExpanded(false);
  }, [currentSessionKey, input, knowledgeScope]);

  const handleConfirmCompaction = useCallback(async () => {
    if (!onManualCompact || compactDisabled) return;
    const generation = sessionGenerationRef.current;
    const allowed = await confirmPromptCacheRisk('manual-compaction');
    if (!allowed || generation !== sessionGenerationRef.current) return;
    await onManualCompact(compactionInstructions.trim() || undefined);
    if (generation !== sessionGenerationRef.current) return;
    setCompactionInstructions('');
    setCompactionDialogOpen(false);
  }, [compactDisabled, compactionInstructions, confirmPromptCacheRisk, onManualCompact]);

  useEffect(() => {
    if (draftValue === lastDraftValueRef.current) return;
    lastDraftValueRef.current = draftValue;
    setInput(draftValue ?? '');
  }, [draftValue]);

  useEffect(() => {
    if (knowledgeMode !== 'suggest' || knowledgeScope === 'none' || selectedKnowledgeRefs.length > 0 || slashInput.active) {
      setSuggestedKnowledgeRefs([]);
      setKnowledgePreflightExpanded(false);
      return;
    }
    const text = input.trim();
    if (text.length < 18) {
      setSuggestedKnowledgeRefs([]);
      setKnowledgePreflightExpanded(false);
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
  useEffect(() => {
    setPendingTurnModelRef(null);
    setOptimisticModelRef(null);
    setModelScope('persistent');
    setCompactionDialogOpen(false);
    setCompactionInstructions('');
    const cancellations = cancelCacheConfirmationsRef.current;
    return () => {
      sessionGenerationRef.current++;
      for (const cancel of cancellations) cancel();
      cancellations.clear();
    };
  }, [currentSessionKey]);

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
    if (!actionMenuOpen && !workspaceMenuOpen && !pickerOpen && !modelPickerOpen && !knowledgePickerOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideActionMenu = actionMenuRef.current?.contains(target);
      const insideWorkspaceMenu = workspaceMenuRef.current?.contains(target);
      const insideAgentPicker = pickerRef.current?.contains(target);
      const insideModelPicker = modelPickerRef.current?.contains(target);
      const insideKnowledgePicker = knowledgePickerRef.current?.contains(target);
      if (!insideActionMenu && !insideWorkspaceMenu && !insideAgentPicker && !insideModelPicker && !insideKnowledgePicker) {
        closeComposerPopovers();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [actionMenuOpen, closeComposerPopovers, knowledgePickerOpen, modelPickerOpen, pickerOpen, workspaceMenuOpen]);

  useEffect(() => {
    if (!modelPickerOpen) setExecutionSettingsSection(null);
  }, [modelPickerOpen]);

  useEffect(() => {
    if (!actionMenuOpen && !workspaceMenuOpen && !pickerOpen && !modelPickerOpen && !knowledgePickerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeComposerPopovers();
      textareaRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [actionMenuOpen, closeComposerPopovers, knowledgePickerOpen, modelPickerOpen, pickerOpen, workspaceMenuOpen]);

  useEffect(() => {
    setQuickSkills([]);
    setDynamicSkillCommands([]);
    setSkillsError(null);
  }, [currentAgentId]);

  const handleInputChange = useCallback((value: string) => {
    updateInput(value);
    setSlashMenuDismissed(false);
    if (parseSlashInput(value).active) {
      setActionMenuOpen(false);
      setPickerOpen(false);
      setModelPickerOpen(false);
      setWorkspaceMenuOpen(false);
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

  const insertSkillToken = useCallback((skill: QuickAccessSkill, options: { replaceSlashInput?: boolean } = {}) => {
    const textarea = textareaRef.current;
    const nextToken = getSkillPrefix(skill.name);
    let adjustedStart = textarea?.selectionStart ?? input.length;
    let adjustedEnd = textarea?.selectionEnd ?? input.length;

    if (options.replaceSlashInput) {
      if (slashInput.active) {
        adjustedStart = slashInput.replacementStart;
        adjustedEnd = slashInput.replacementEnd;
      }
    }

    const leadingSpace = needsLeadingSkillSpace(input, adjustedStart) ? ' ' : '';
    const nextValue = `${input.slice(0, adjustedStart)}${leadingSpace}${nextToken}${input.slice(adjustedEnd)}`;
    updateInput(nextValue);
    setSlashMenuDismissed(true);
    setSlashSelectedIndex(0);
    setActionMenuOpen(false);
    setPickerOpen(false);
    setModelPickerOpen(false);
    setWorkspaceMenuOpen(false);
    setKnowledgePickerOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const cursorPosition = adjustedStart + leadingSpace.length + nextToken.length;
      textareaRef.current?.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, [input, slashInput, updateInput]);

  const insertSkillPrompt = useCallback((skill: QuickAccessSkill, prompt: string) => {
    const textarea = textareaRef.current;
    const adjustedStart = textarea?.selectionStart ?? input.length;
    const adjustedEnd = textarea?.selectionEnd ?? input.length;
    const nextToken = getSkillPrefix(skill.name);
    const leadingSpace = needsLeadingSkillSpace(input, adjustedStart) ? ' ' : '';
    const body = prompt.trim();
    const inserted = `${leadingSpace}${nextToken}${body}`;
    const nextValue = `${input.slice(0, adjustedStart)}${inserted}${input.slice(adjustedEnd)}`;
    updateInput(nextValue);
    setSlashMenuDismissed(true);
    setSlashSelectedIndex(0);
    closeComposerPopovers();
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const cursorPosition = adjustedStart + inserted.length;
      textareaRef.current?.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, [closeComposerPopovers, input, updateInput]);

  const loadQuickSkills = useCallback(async (): Promise<QuickAccessSkill[]> => {
    if (!currentAgent) {
      setQuickSkills([]);
      setDynamicSkillCommands([]);
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
      // commands.list exposes skill-contributed chat commands (/skill-name)
      // that the local quick-access scan may not surface. Merge them as
      // additional skill entries so they appear in the slash palette.
      try {
        const commandsResult = await hostApi.gateway.rpc<{ commands?: Array<{
          name: string;
          description?: string;
          source?: string;
        }> }>('commands.list', {
          agentId: currentAgent.id,
          scope: 'text',
        });
        const skillCommands = (commandsResult?.commands ?? [])
          .filter((entry) => entry?.source === 'skill' && typeof entry.name === 'string')
          .map((entry) => ({
            name: entry.name,
            description: entry.description ?? '',
            source: 'openclaw' as const,
            sourceLabel: 'skill command',
            manifestPath: '',
            baseDir: '',
          }));
        setDynamicSkillCommands(skillCommands);
        return [...list, ...skillCommands];
      } catch {
        // commands.list is best-effort; fall back to local skills only.
        setDynamicSkillCommands([]);
        return list;
      }
    } catch (error) {
      setQuickSkills([]);
      setDynamicSkillCommands([]);
      setSkillsError(String(error));
      return [];
    } finally {
      setSkillsLoading(false);
    }
  }, [currentAgent]);

  const officeActionEntries = useMemo(
    () => OFFICE_ACTIONS.map((action) => ({ action, skill: findOfficeSkill(action, quickSkills) })),
    [quickSkills],
  );

  const handleOfficeAction = useCallback((action: OfficeAction, skill: QuickAccessSkill | null) => {
    if (!skill) {
      setActionMenuOpen(false);
      window.location.hash = '#/settings/skills?tab=packs';
      toast.info(t('composer.office.setupRequired', { action: t(action.labelKey) }));
      return;
    }
    insertSkillPrompt(skill, t(action.promptKey));
  }, [insertSkillPrompt, t]);

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
    openWorkspacePanel({ panel: 'files', filePath: buildPreviewTarget(skill.manifestPath).filePath });
  }, [quickSkills, currentAgent, loadQuickSkills, openWorkspacePanel, t]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    void loadQuickSkills();
  }, [loadQuickSkills, slashMenuOpen]);

  const handleSelectModel = useCallback(async (modelRef: string) => {
    if (!currentAgent || switchingModelRef) return;

    if (modelRef !== effectiveModelRef) {
      const allowed = await confirmPromptCacheRisk('model-switch', modelRef);
      if (!allowed) {
        setModelPickerOpen(false);
        textareaRef.current?.focus();
        return;
      }
    }

    if (modelScope === 'turn') {
      setPendingTurnModelRef(modelRef);
      setModelPickerOpen(false);
      textareaRef.current?.focus();
      return;
    }
    if (modelScope === 'session') {
      setSwitchingModelRef(modelRef);
      try {
        const result = await hostApi.sessions.patchRuntimeModel({ sessionKey: currentSessionKey, modelRef });
        if (!result.success) throw new Error(result.error || t('composer.modelSwitchFailed', { error: modelRef }));
        useChatStore.setState((state) => ({ sessions: state.sessions.map((session) => session.key === currentSessionKey ? { ...session, modelRefOverride: modelRef } : session) }));
        setOptimisticModelRef(null);
        setPendingTurnModelRef(null);
        setModelPickerOpen(false);
      } catch (error) {
        toast.error(t('composer.modelSwitchFailed', { error: String(error) }));
      } finally {
        setSwitchingModelRef(null);
        textareaRef.current?.focus();
      }
      return;
    }
    const desiredOverride = modelRef === (defaultModelRef || '').trim() ? null : modelRef;
    let persistentSaved = false;
    setSwitchingModelRef(modelRef);
    setOptimisticModelRef(modelRef);
    setModelPickerOpen(false);
    try {
      await updateAgentModel(currentAgent.id, desiredOverride);
      persistentSaved = true;
      if (useChatStore.getState().currentSessionKey === currentSessionKey) setPendingTurnModelRef(null);
      // Choosing Always also resets this session's explicit runtime override.
      const result = await hostApi.sessions.patchRuntimeModel({ sessionKey: currentSessionKey, modelRef: null });
      if (!result.success) throw new Error(result.error || t('composer.modelSwitchFailed', { error: modelRef }));
      useChatStore.setState((state) => ({ sessions: state.sessions.map((session) => session.key === currentSessionKey ? { ...session, modelRefOverride: undefined } : session) }));
      setOptimisticModelRef(null);
      setPendingTurnModelRef(null);
    } catch (error) {
      if (useChatStore.getState().currentSessionKey === currentSessionKey) setOptimisticModelRef(null);
      if (persistentSaved) await useChatStore.getState().loadSessions();
      toast.error(t(persistentSaved ? 'composer.modelSwitchSessionResetFailed' : 'composer.modelSwitchFailed', { error: String(error) }));
    } finally {
      setSwitchingModelRef(null);
      textareaRef.current?.focus();
    }
  }, [confirmPromptCacheRisk, currentAgent, currentSessionKey, modelScope, defaultModelRef, effectiveModelRef, switchingModelRef, t, updateAgentModel]);

  const handleWorkspaceAction = useCallback((action: () => void | Promise<void>) => {
    setWorkspaceMenuOpen(false);
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
  const hasComposerDraft = Boolean(input.trim() || attachments.length > 0 || selectedKnowledgeRefs.length > 0);
  const canSend = (input.trim() || attachments.length > 0 || selectedKnowledgeRefs.length > 0) && allReady && !inputDisabled && !sending && !capabilityExecuting;
  // 干预门禁（对齐 P1-4）：无 /loop Task Ledger root（available:false）时
  // 运行时会对显式 inputMode 返回 INVALID_REQUEST——禁用并提示，避免"按钮可点但不可用"。
  const longTaskAvailable = longTaskControlStatus?.available !== false;
  const canIntervene = sending && hasComposerDraft && allReady && !inputDisabled && !hasFailedAttachments && !capabilityExecuting && longTaskAvailable;
  // 排队默认动作与干预按钮同门禁：有草稿但附件未就绪/存在失败附件时，运行中的
  // 主按钮保持纯暂停语义，避免误触一次排队行为。
  const canQueueDraft = sending && hasComposerDraft && !inputDisabled && !capabilityExecuting && longTaskAvailable && allReady && !hasFailedAttachments;
  const composerSendState = paused
    ? 'paused'
    : runStarting
      ? 'starting'
      : sending
        ? hasComposerDraft
          ? 'running-with-draft'
          : 'running'
        : canSend
          ? 'ready'
          : 'idle';
  const sendButtonMeta = getComposerSendStateMeta(composerSendState, {
    queueable: canQueueDraft,
    resumable: !paused || Boolean(onResumeSession),
  });
  const SendButtonIcon = sendButtonMeta.icon ?? ArrowUp;
  const showInlineComposerStatus = !isGatewayUsable
    || chatComposerStatusComponents.length > 0
    || pendingMessages.length > 0
    || hasLongTaskControlDetails
    || hasFailedAttachments;

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
    captureHeroComposerPosition();
    updateInput('');
    setAttachments([]);
    setSelectedKnowledgeRefs([]);
    setSuggestedKnowledgeRefs([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    recordKnowledgeReferences(sendKnowledgeReferences);
    if (inputMode) {
      onSend(
        textToSend,
        {
          attachments: safeAttachments,
          targetAgentId: sendTargetAgentId,
          knowledgeScope: sendKnowledgeScope,
          knowledgeMode: sendKnowledgeMode,
          knowledgeReferences: sendKnowledgeReferences.length > 0 ? sendKnowledgeReferences : undefined,
          activeTaskNodeId,
          inputMode,
          ...(pendingTurnModelRef ? { modelRefOverride: pendingTurnModelRef } : {}),
        },
      );
    } else {
      onSend(
        textToSend,
        {
          attachments: safeAttachments,
          targetAgentId: sendTargetAgentId,
          knowledgeScope: sendKnowledgeScope,
          knowledgeMode: sendKnowledgeMode,
          knowledgeReferences: sendKnowledgeReferences.length > 0 ? sendKnowledgeReferences : undefined,
          activeTaskNodeId,
          ...(pendingTurnModelRef ? { modelRefOverride: pendingTurnModelRef } : {}),
        },
      );
    }
    setPendingTurnModelRef(null);
    setTargetAgentId(null);
    setPickerOpen(false);
    setKnowledgePickerOpen(false);
    return true;
  }, [activeTaskNodeId, captureHeroComposerPosition, onSend, pendingTurnModelRef, recordKnowledgeReferences, updateInput]);

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
    sending,
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
      setModelPickerOpen(false);
      setWorkspaceMenuOpen(false);
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
      setModelPickerOpen(false);
      setWorkspaceMenuOpen(false);
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
        toastUserError(error);
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
      return;
    }

    if (command.kind === 'newSession') {
      if (!onNewSession) {
        toast.message(t('composer.slashCommands.toasts.sendUnavailable'));
        return;
      }
      clearComposer();
      await onNewSession();
      toast.success(t('composer.slashCommands.toasts.newSessionCreated'));
      return;
    }

    if (command.kind === 'resumeSession') {
      clearComposer();
      const store = useChatStore.getState();
      const query = trimmedArgs.toLowerCase();
      if (!query) {
        toast.message(t('composer.slashCommands.toasts.resumeSessionNoArgs'));
        return;
      }
      const candidates = store.sessions
        .filter((session) => {
          const label =
            store.sessionLabels[session.key] ??
            session.label ??
            session.displayName ??
            session.derivedTitle ??
            '';
          return (
            session.key.toLowerCase().includes(query) ||
            label.toLowerCase().includes(query)
          );
        })
        .sort(
          (left, right) =>
            (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
        );
      if (candidates.length === 0) {
        toast.message(
          t('composer.slashCommands.toasts.resumeSessionNotFound', { query: trimmedArgs }),
        );
        return;
      }
      const target = candidates[0];
      const targetLabel =
        store.sessionLabels[target.key] ?? target.label ?? target.displayName ?? target.key;
      await store.switchSession(target.key);
      toast.success(
        t('composer.slashCommands.toasts.resumeSessionResumed', { label: targetLabel }),
      );
      return;
    }

    if (command.kind === 'renameSession') {
      const label = trimmedArgs.trim();
      if (!label) {
        toast.message(t('composer.slashCommands.toasts.renameNoArgs'));
        return;
      }
      clearComposer();
      try {
        await useChatStore.getState().renameSession(currentSessionKey, label);
        toast.success(t('composer.slashCommands.toasts.renameDone', { label }));
      } catch (error) {
        toast.error(t('composer.slashCommands.toasts.renameFailed', { error: String(error) }));
      }
      return;
    }

    if (command.kind === 'archiveSession') {
      clearComposer();
      try {
        await useChatStore.getState().archiveSession(currentSessionKey);
        toast.success(t('composer.slashCommands.toasts.archiveDone'));
      } catch (error) {
        toast.error(t('composer.slashCommands.toasts.archiveFailed', { error: String(error) }));
      }
      return;
    }

    if (command.kind === 'deleteSession') {
      const confirmed = window.confirm(t('composer.slashCommands.toasts.deleteConfirm'));
      if (!confirmed) {
        clearComposer();
        return;
      }
      clearComposer();
      try {
        await useChatStore.getState().deleteSession(currentSessionKey);
        toast.success(t('composer.slashCommands.toasts.deleteDone'));
      } catch (error) {
        toast.error(t('composer.slashCommands.toasts.deleteFailed', { error: String(error) }));
      }
      return;
    }

    if (command.kind === 'clearSession') {
      clearComposer();
      useChatStore.getState().clearSessionView();
      toast.success(t('composer.slashCommands.toasts.clearDone'));
      return;
    }

    if (command.kind === 'copySession') {
      clearComposer();
      const messages = useChatStore.getState().messages;
      // 对齐 Codex `/copy`（"copy last response as markdown"）：复制最后一条
      // assistant 响应，而非整个会话 transcript。
      const lastResponse = [...messages].reverse().find((message) => message.role === 'assistant');
      if (!lastResponse) {
        toast.message(t('composer.slashCommands.toasts.copyEmpty'));
        return;
      }
      const text =
        typeof lastResponse.content === 'string'
          ? lastResponse.content
          : Array.isArray(lastResponse.content)
            ? lastResponse.content
                .filter((block): block is { type: string; text?: string } =>
                  typeof block === 'object' && block !== null && 'text' in block,
                )
                .map((block) => block.text ?? '')
                .filter(Boolean)
                .join('\n')
            : '';
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t('composer.slashCommands.toasts.copyDone'));
      } catch (error) {
        toast.error(t('composer.slashCommands.toasts.copyFailed', { error: String(error) }));
      }
      return;
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
    onNewSession,
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

  const findExactSlashItem = useCallback((): SlashPaletteItem | null => {
    const exactCommand = slashInput.allowsCommands ? findExactSlashCommand(slashInput.commandText) : null;
    if (exactCommand) {
      return {
        id: `command:${exactCommand.id}`,
        type: 'command',
        group: exactCommand.group,
        command: exactCommand,
      };
    }
    const normalized = slashInput.commandText.trim().toLowerCase();
    if (!normalized) return null;
    const exactSkill = quickSkills.find((skill) => skill.name.toLowerCase() === normalized);
    if (!exactSkill) return null;
    return {
      id: `skill:${exactSkill.source}:${exactSkill.name}`,
      type: 'skill',
      group: 'skills',
      skill: exactSkill,
    };
  }, [quickSkills, slashInput.allowsCommands, slashInput.commandText]);

  const selectSlashItem = useCallback((item: SlashPaletteItem | null) => {
    if (!item) {
      toast.message(t('composer.slashCommands.unknownToast', { command: `/${slashInput.commandText}` }));
      return;
    }
    if (item.type === 'skill') {
      insertSkillToken(item.skill, { replaceSlashInput: true });
      return;
    }
    void executeSlashCommand(item.command, slashInput.args);
  }, [executeSlashCommand, insertSkillToken, slashInput.args, slashInput.commandText, t]);

  const handleUnsupportedCapabilityRequest = useCallback((resolution: ChatCapabilityPlanResolution): boolean => {
    if (!resolution.unsupportedReason) return false;
    toast.message(t(`composer.capability.unsupported.${resolution.unsupportedReason}`, {
      defaultValue: t('composer.capability.unsupported.generic'),
    }));
    return true;
  }, [t]);

  const handleSend = useCallback(async () => {
    if (slashInput.active) {
      selectSlashItem(findExactSlashItem() ?? selectedSlashItem);
      return;
    }

    if (!canSend) {
      // P0-2: while a run is active, plain Enter used to silently drop the
      // draft (canSend includes !sending). Instead queue it and surface that it
      // will be sent when the run finishes.
      if (sending && !inputDisabled && !capabilityExecuting && !allReady) {
        if (input.trim() || attachments.some((a) => a.status === 'ready') || selectedKnowledgeRefs.length > 0) {
          const readyAttachments = attachments.filter((a) => a.status === 'ready');
          useChatStore.getState().queuePendingMessage(
            input.trim() || (selectedKnowledgeRefs.length > 0 ? t('composer.knowledgeAttach.defaultPrompt') : ''),
            {
              attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
              targetAgentId,
              knowledgeScope: knowledgeScope === 'none' && selectedKnowledgeRefs.length > 0 ? 'wiki' : knowledgeScope,
              knowledgeMode,
              knowledgeReferences: selectedKnowledgeRefs.length > 0 ? selectedKnowledgeRefs : undefined,
            },
          );
          updateInput('');
          setAttachments([]);
          setSelectedKnowledgeRefs([]);
          setSuggestedKnowledgeRefs([]);
          toast.success(t('composer.queueQueued'));
        }
      }
      return;
    }
    // FP-P1-01: block the send when no provider can actually serve it and
    // guide the user to configuration (Setup skip must not fail silently).
    if (!providerRuntimeReady) {
      setProviderGateOpen(true);
      void refreshProviderSnapshot();
      return;
    }
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
        setModelPickerOpen(false);
        setWorkspaceMenuOpen(false);
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
    captureHeroComposerPosition();
    updateInput('');
    setAttachments([]);
    setSelectedKnowledgeRefs([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    recordKnowledgeReferences(knowledgeReferencesToSend);
    onSend(
      textToSend,
      {
        attachments: attachmentsToSend,
        targetAgentId,
        knowledgeScope: sendKnowledgeScope,
        knowledgeMode,
        knowledgeReferences: knowledgeReferencesToSend.length > 0 ? knowledgeReferencesToSend : undefined,
        activeTaskNodeId,
        ...(pendingTurnModelRef ? { modelRefOverride: pendingTurnModelRef } : {}),
      },
    );
    setPendingTurnModelRef(null);
    setTargetAgentId(null);
    setPickerOpen(false);
    setKnowledgePickerOpen(false);
  }, [input, attachments, canSend, captureHeroComposerPosition, onSend, pendingTurnModelRef, targetAgentId, updateInput, knowledgeMode, knowledgeScope, selectedKnowledgeRefs, t, recordKnowledgeReferences, handleUnsupportedCapabilityRequest, slashInput.active, activeTaskNodeId, routeKnowledgeForMessage, selectSlashItem, findExactSlashItem, selectedSlashItem, providerRuntimeReady, refreshProviderSnapshot]);

  const handleCancelCapabilityActions = useCallback(() => {
    if (capabilityExecuting) return;
    setPendingCapabilitySend(null);
  }, [capabilityExecuting]);

  const handleConfirmCapabilityActions = useCallback(async () => {
    if (!pendingCapabilitySend || capabilityExecuting) return;
    if (pendingCapabilitySend.plan.some((action) => isCapabilityAuditBlocked(action.auditResult))) return;
    const promptCacheAction = promptCacheRiskActionForCapabilityPlan(pendingCapabilitySend.plan);
    if (promptCacheAction && !(await confirmPromptCacheRisk(promptCacheAction))) return;
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
  }, [capabilityExecuting, completeSend, confirmPromptCacheRisk, currentAgentId, pendingCapabilitySend, t, workspace?.id]);

  const cancelQueuedSendClick = useCallback(() => {
    if (sendClickTimerRef.current != null) {
      window.clearTimeout(sendClickTimerRef.current);
      sendClickTimerRef.current = null;
    }
  }, []);

  const handlePrimaryComposerAction = useCallback(() => {
    cancelQueuedSendClick();
    if (paused) {
      void onResumeSession?.();
      return;
    }
    if (composerSendState === 'running-with-draft' && canQueueDraft) {
      // 运行中且有可排队草稿：单击默认排队（防抖），双击落到暂停。
      sendClickTimerRef.current = window.setTimeout(() => {
        sendClickTimerRef.current = null;
        void handleInterventionSend('queue');
      }, SEND_CLICK_DEBOUNCE_MS);
      return;
    }
    if (composerSendState === 'running-with-draft' || sending) {
      void onPauseSession?.();
      return;
    }
    if (!canSend) return;
    beginOptimisticRunStart();
    /*
     * `handleSend` returns without dispatching whenever a precondition fails —
     * no validated provider (FP-P1-01), an unsupported capability, an extension
     * before-send veto. In those cases no run ever starts, so `sending` stays
     * false and the button must stop pretending: roll the affordance back as
     * soon as the attempt settles instead of waiting out the timer with a Stop
     * icon on screen behind the dialog that says nothing was sent.
     */
    void handleSend().finally(() => {
      if (!sendingRef.current) cancelOptimisticRunStart();
    });
  }, [
    beginOptimisticRunStart,
    cancelOptimisticRunStart,
    cancelQueuedSendClick,
    canQueueDraft,
    canSend,
    composerSendState,
    handleInterventionSend,
    handleSend,
    onPauseSession,
    onResumeSession,
    paused,
    sending,
  ]);

  const handlePrimaryComposerDoubleClick = useCallback(() => {
    // 在排队防抖窗口内的第二次点击：取消排队，直接暂停当前运行。
    if (sendClickTimerRef.current == null) return;
    cancelQueuedSendClick();
    void onPauseSession?.();
  }, [cancelQueuedSendClick, onPauseSession]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (sending && e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.shiftKey)) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        if (!canIntervene) return;
        void handleInterventionSend(e.shiftKey ? 'interrupt' : 'guide');
        return;
      }

      if (slashMenuOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashSelectedIndex((index) => Math.min(index + 1, Math.max(0, slashItems.length - 1)));
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
          selectSlashItem(findExactSlashItem() ?? selectedSlashItem);
          return;
        }
      }

      if (slashInput.active && e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        selectSlashItem(findExactSlashItem() ?? selectedSlashItem);
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
          moveCaretTo(tokenRange.start);
          return;
        }

        if (!input) {
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
        setModelPickerOpen(false);
        setWorkspaceMenuOpen(false);
        setKnowledgePickerOpen(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        if (sending) {
          if (canIntervene) void handleInterventionSend('queue');
          return;
        }
        handleSend();
      }
    },
    [
      canIntervene,
      findExactSlashItem,
      handleInterventionSend,
      handleSend,
      input,
      moveCaretTo,
      selectSlashItem,
      selectedSlashItem,
      sending,
      skillTokenRanges,
      slashItems.length,
      slashInput,
      slashMenuOpen,
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
      ref={composerHostRef}
      className={cn(
        'codex-composer-host',
        hero && 'codex-composer-host--hero',
        'mx-auto w-full max-w-[768px] px-4 pb-5 pt-2',
        className,
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full">
        {/* Input Container */}
        {/* Geometry stays here (asserted by chat-layout-cdp.spec.ts); surface,
          * border and elevation come from .codex-composer-shell so the card and
          * the menus that open out of it read from the same tokens.
          *
          * BorderBeam: animated sunset beam that runs along the INNER edge of
          * the composer while a run is active (`sending`). It sits as an
          * absolutely-positioned overlay inside the shell (not wrapping it), so
          * the library's overflow:hidden clips the glow to the rounded inner
          * wall — an inner ring, not an outer halo — and the slash/action
          * menus, being siblings, are never clipped by it. */}
        <div
          data-testid="chat-composer-shell"
          data-drag-over={dragOver ? 'true' : undefined}
          className={cn(
            'relative rounded-[25px] px-3 pb-1.5 pt-2.5 min-h-[98px]',
            'transition-[border-color,box-shadow,background-color,transform] duration-180',
            'codex-composer-shell',
          )}
        >
          <BorderBeam
            size="sm"
            colorVariant="sunset"
            strength={0.3}
            theme={resolvedTheme}
            borderRadius={25}
            active={sending}
            className="codex-composer-beam"
            data-testid="chat-composer-beam"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <span aria-hidden />
          </BorderBeam>
          {attachments.length > 0 && (
            <div
              className="codex-composer-attachments relative flex flex-wrap gap-2 pb-3"
              data-testid="chat-composer-attachments"
            >
              {attachments.map((att) => (
                <AttachmentPreview
                  key={att.id}
                  attachment={att}
                  onRemove={() => removeAttachment(att.id)}
                />
              ))}
            </div>
          )}
          {slashMenuOpen && (
            <SlashCommandPalette
              items={slashItems}
              getCommandStatus={getSlashCommandStatus}
              onHover={setSlashSelectedIndex}
              onSelect={selectSlashItem}
              selectedIndex={slashSelectedIndex}
              skillsError={skillsError}
              skillsLoading={skillsLoading && !slashItems.some((item) => item.type === 'skill')}
              slashInput={slashInput}
              t={t}
            />
          )}

          {(selectedTarget || pendingTurnModelRef) && (
            <div className="flex flex-wrap gap-2 pb-1.5">
              {pendingTurnModelRef && (
                <Tooltip>
                  <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setPendingTurnModelRef(null)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-primary/10"
                  data-testid="chat-turn-model-chip"
                >
                  <span>{t('composer.turnModelChip', { model: formatModelRefLabel(pendingTurnModelRef) })}</span>
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('composer.clearTurnModel')}</TooltipContent>
                </Tooltip>
              )}
              {selectedTarget && (
                <Tooltip>
                  <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setTargetAgentId(null)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-primary/10"
                >
                  <span>{t('composer.targetChip', { agent: selectedTarget.name })}</span>
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{t('composer.clearTarget')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}

          {/* Text Row — flush-left */}
          {selectedKnowledgeRefs.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-2" data-testid="chat-knowledge-selected">
              {selectedKnowledgeRefs.map((reference) => (
                <Tooltip key={reference.id}>
                  <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => removeKnowledgeReference(reference.id)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-meta font-medium text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400"
                  data-testid="chat-knowledge-selected-item"
                >
                  <BookOpen className="h-3 w-3 shrink-0" />
                  <span className="max-w-[220px] truncate">{reference.title}</span>
                  <X className="h-3 w-3 shrink-0" />
                </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {t('composer.knowledgeAttach.remove', { title: reference.title })}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}

          {suggestedKnowledgeRefs.length > 0 && selectedKnowledgeRefs.length === 0 && (
            <div
              className="mb-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2 text-meta text-emerald-700 dark:text-emerald-400"
              data-testid="chat-knowledge-suggestion"
            >
              <div className="flex flex-wrap items-center gap-2" data-testid="chat-knowledge-preflight">
                <BookOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="font-semibold text-foreground">{t('composer.knowledgePreflight.title')}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {t('composer.knowledgePreflight.summary', {
                    docs: suggestedKnowledgeCounts.docs,
                    pitfalls: suggestedKnowledgeCounts.pitfalls,
                    rules: suggestedKnowledgeCounts.rules,
                  })}
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
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-tiny font-semibold hover:bg-emerald-500/10"
                  onClick={() => setKnowledgePreflightExpanded((open) => !open)}
                  data-testid="chat-knowledge-suggestion-open"
                >
                  <Eye className="h-3 w-3" />
                  {t('composer.knowledgeRoute.inspect')}
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
              {knowledgePreflightExpanded && (
                <div className="mt-2 grid gap-2 border-t border-emerald-500/15 pt-2" data-testid="chat-knowledge-preflight-inspect">
                  {suggestedKnowledgeGroups.map((group) => (
                    <div key={group.key} className="rounded-md bg-background/60 p-2 dark:bg-white/[0.04]" data-testid={`chat-knowledge-preflight-group-${group.key}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {t(`composer.knowledgePreflight.groups.${group.key}`)}
                        </span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">{group.candidates.length}</span>
                      </div>
                      <div className="mt-1.5 grid gap-1.5">
                        {group.candidates.map((candidate) => {
                          const source = candidate.sourcePath || candidate.pagePath || candidate.lookup;
                          return (
                            <div key={candidate.id} className="rounded-md border border-black/10 bg-surface-input px-2 py-1.5 dark:border-white/10" data-testid="chat-knowledge-preflight-item">
                              <div className="flex min-w-0 items-center justify-between gap-2">
                                <span className="min-w-0 truncate text-xs font-medium text-foreground">{candidate.title}</span>
                                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                  {t('composer.knowledgePreflight.confidence', { confidence: Math.round(candidate.confidence * 100) })}
                                </span>
                              </div>
                              <div className="mt-1 grid gap-0.5 text-[11px] leading-4 text-muted-foreground">
                                <span className="truncate">
                                  {t('composer.knowledgePreflight.whyMatched', { reason: candidate.routingReason })}
                                </span>
                                <span className="truncate">
                                  {t('composer.knowledgePreflight.source', { corpus: candidate.corpus ?? knowledgeCorpus, source })}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="justify-self-start rounded-md px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                    onClick={() => {
                      setKnowledgePickerOpen(true);
                      setKnowledgeSearchResult({ success: true, results: suggestedKnowledgeRefs } as KnowledgeSearchResult);
                    }}
                    data-testid="chat-knowledge-preflight-open-picker"
                  >
                    {t('composer.knowledgeRoute.open')}
                  </button>
                </div>
              )}
            </div>
          )}

          {showTaskLoopUpgradeSuggestion && taskLoopUpgradeSuggestion && (
            <div
              className="mb-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-2.5 py-2 text-meta text-sky-700 dark:text-sky-400"
              data-testid="chat-task-loop-upgrade-suggestion"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Target className="h-3.5 w-3.5 shrink-0" />
                <span className="font-semibold text-foreground">{t('composer.taskLoopUpgrade.title')}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {t('composer.taskLoopUpgrade.summary')}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-tiny font-semibold hover:bg-sky-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void handleConfirmTaskLoopUpgrade()}
                  disabled={taskLoopUpgradeBusy}
                  data-testid="chat-task-loop-upgrade-confirm"
                >
                  {taskLoopUpgradeBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                  {taskLoopUpgradeBusy
                    ? t('composer.taskLoopUpgrade.starting')
                    : t('composer.taskLoopUpgrade.confirm')}
                </button>
              </div>
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
              placeholder={inputDisabled ? t('composer.gatewayDisconnectedPlaceholder') : t('composer.placeholder')}
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
          <div className="codex-composer-actions-row mt-1.5 flex min-w-0 items-center gap-1">
            <div ref={actionMenuRef} className="contents">
              {/* Plus menu morph — the composer's primary add affordance.
                  The compact circle morphs its own container into the measured
                  action panel (manba #20 "Plus menu morph"): plus fades out,
                  actions fade in. Clicking outside / Esc morphs it back.
                  It occupies its own layout slot, so neighbouring controls do
                  not shift while the panel opens. */}
              <PlusMenuMorph
                disabled={inputDisabled || sending}
                open={morphOpen}
                triggerTestId="chat-composer-actions"
                containerTestId="chat-composer-morph"
                onOpenChange={(next) => {
                  setMorphOpen(next);
                  if (next) {
                    setWorkspaceMenuOpen(false);
                    setPickerOpen(false);
                    setModelPickerOpen(false);
                    setKnowledgePickerOpen(false);
                    setActionMenuOpen(false);
                    void loadQuickSkills();
                  }
                }}
                items={[
                  {
                    key: 'attach',
                    label: t('composer.actions.attachFiles'),
                    icon: <Paperclip className="h-3.5 w-3.5" />,
                    testId: 'chat-composer-action-attach-files',
                    onSelect: () => void pickFiles(),
                  },
                  {
                    key: 'knowledge',
                    label: t('composer.actions.knowledge'),
                    icon: <BookOpen className="h-3.5 w-3.5" />,
                    testId: 'chat-composer-action-knowledge',
                    onSelect: () => {
                      setKnowledgePickerOpen(true);
                      requestAnimationFrame(() => textareaRef.current?.focus());
                    },
                  },
                  ...(showModelPicker
                    ? [{
                        key: 'model',
                        label: t('composer.actions.model'),
                        icon: <Gauge className="h-3.5 w-3.5" />,
                        testId: 'chat-composer-action-model',
                        onSelect: () => {
                          setExecutionSettingsSection('model');
                          setModelPickerOpen(true);
                        },
                      }]
                    : []),
                  {
                    key: 'more',
                    label: t('composer.actions.more'),
                    icon: <Plus className="h-3.5 w-3.5" />,
                    testId: 'chat-composer-action-more',
                    onSelect: () => setActionMenuOpen(true),
                  },
                ]}
              />
              {actionMenuOpen && (
                <div
                  className="absolute bottom-full -left-px -right-px z-30 mb-2 max-h-[320px] overflow-y-auto rounded-[20px] border border-border bg-surface-modal p-1.5 shadow-xl backdrop-blur-[8px] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150 motion-reduce:animate-none [scrollbar-gutter:stable]"
                  data-testid="chat-composer-actions-menu"
                  data-layout="compact-command-list"
                >
                  <ComposerActionGroup title={t('composer.actions.context')} testId="chat-composer-action-group-context">
                    <ComposerActionButton
                      icon={Paperclip}
                      label={t('composer.actions.attachFiles')}
                      testId="chat-composer-action-attach-files"
                      onClick={() => {
                        setActionMenuOpen(false);
                        void pickFiles();
                      }}
                    />
                    <ComposerActionButton
                      icon={BookOpen}
                      label={t('composer.actions.knowledge')}
                      testId="chat-composer-action-knowledge"
                      onClick={() => {
                        setActionMenuOpen(false);
                        setKnowledgePickerOpen(true);
                        requestAnimationFrame(() => textareaRef.current?.focus());
                      }}
                    />
                    {showModelPicker && (
                      <ComposerActionButton
                        icon={Gauge}
                        label={t('composer.actions.model')}
                        testId="chat-composer-action-model"
                        onClick={() => {
                          setActionMenuOpen(false);
                          setExecutionSettingsSection('model');
                          setModelPickerOpen(true);
                        }}
                      />
                    )}
                    <TaskNodeSelector
                      selectedTaskNodeId={activeTaskNodeId}
                      onSelect={setActiveTaskNodeId}
                    />
                  </ComposerActionGroup>

                  <ComposerActionGroup title={t('composer.actions.skills')} testId="chat-composer-action-group-skills">
                    {skillsLoading && quickSkills.length === 0 ? (
                      <div className="px-2.5 py-2 text-xs text-muted-foreground">{t('composer.skillLoading')}</div>
                    ) : quickSkills.length === 0 ? (
                      <div className="px-2.5 py-2 text-xs text-muted-foreground">
                        {skillsError || t('composer.skillEmpty')}
                      </div>
                    ) : (
                      quickSkills.slice(0, 8).map((skill) => (
                        <ComposerActionButton
                          key={`${skill.source}:${skill.name}`}
                          icon={Sparkles}
                          label={`/${skill.name}`}
                          description={skill.description}
                          testId={`chat-composer-action-skill-${skill.name}`}
                          onClick={() => insertSkillToken(skill)}
                        />
                      ))
                    )}
                  </ComposerActionGroup>

                  <ComposerActionGroup title={t('composer.actions.office')} testId="chat-composer-action-group-office">
                    {officeActionEntries.map(({ action, skill }) => (
                      <ComposerActionButton
                        key={action.id}
                        icon={action.icon}
                        label={t(action.labelKey)}
                        testId={`chat-composer-action-office-${action.id}`}
                        onClick={() => handleOfficeAction(action, skill)}
                      />
                    ))}
                  </ComposerActionGroup>

                  {(onManualCompact || onForkSession || onHandoffSession) && (
                    <ComposerActionGroup title={t('composer.actions.session')} testId="chat-composer-action-group-session">
                      {onManualCompact && (
                        <ComposerActionButton
                          icon={Archive}
                          label={t('composer.actions.compact')}
                          testId="chat-composer-action-compact"
                          disabled={compactDisabled}
                          onClick={() => {
                            setActionMenuOpen(false);
                            setCompactionDialogOpen(true);
                          }}
                        />
                      )}
                      {onForkSession && (
                        <ComposerActionButton
                          icon={GitBranchPlus}
                          label={t('composer.actions.fork')}
                          testId="chat-composer-action-fork"
                          disabled={forkDisabled || forkBusy}
                          title={t('composer.fork.boundaryNote')}
                          onClick={() => {
                            setActionMenuOpen(false);
                            void onForkSession();
                          }}
                        />
                      )}
                      {onHandoffSession && (
                        <ComposerActionButton
                          icon={MessageSquarePlus}
                          label={t('composer.actions.handoff')}
                          testId="chat-composer-action-handoff"
                          disabled={handoffDisabled || handoffBusy}
                          onClick={() => {
                            setActionMenuOpen(false);
                            void onHandoffSession();
                          }}
                        />
                      )}
                    </ComposerActionGroup>
                  )}
                </div>
              )}
            </div>

            {showWorkspaceMenu && (
              <div ref={workspaceMenuRef} className="relative shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    {workspace && onPermissionModeChange ? (
                      <button
                        type="button"
                        data-testid="chat-composer-permission-mode"
                        className={cn(
                          'codex-composer-control codex-permission-trigger codex-permission-control',
                          workspaceMenuOpen && 'is-active',
                          activePermissionMode === 'fullAccess' && 'codex-permission-trigger--warning',
                        )}
                        onClick={() => {
                          setSlashMenuDismissed(true);
                          setPickerOpen(false);
                          setModelPickerOpen(false);
                          setKnowledgePickerOpen(false);
                          setWorkspaceMenuOpen((open) => !open);
                        }}
                        disabled={inputDisabled || sending}
                        aria-label={workspaceMenuTitle}
                        aria-expanded={workspaceMenuOpen}
                      >
                        <span className="codex-permission-trigger__icon">
                          {(() => {
                            const Icon = PERMISSION_MODE_ICONS[activePermissionMode] ?? CodexHand;
                            return <Icon className="h-4 w-4" />;
                          })()}
                        </span>
                        <span className="codex-permission-trigger__label">
                          {t(`composer.permissionMode.${activePermissionMode}`)}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="chat-composer-permission-mode"
                        className={cn(
                          'codex-composer-control w-8 justify-center px-0',
                          workspaceMenuOpen && 'is-active',
                        )}
                        onClick={() => {
                          setSlashMenuDismissed(true);
                          setPickerOpen(false);
                          setModelPickerOpen(false);
                          setKnowledgePickerOpen(false);
                          setWorkspaceMenuOpen((open) => !open);
                        }}
                        disabled={inputDisabled || sending}
                        aria-label={workspaceMenuTitle}
                        aria-expanded={workspaceMenuOpen}
                      >
                        <Briefcase className="h-3.5 w-3.5 shrink-0" />
                      </button>
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="top" collisionPadding={8} className="max-w-xs text-xs">
                    {workspaceMenuTitle}
                  </TooltipContent>
                </Tooltip>

                {workspaceMenuOpen && (
                  <div
                    data-testid="chat-composer-permission-menu"
                    className="codex-composer-menu codex-composer-menu--approval"
                  >
                    {workspace && (
                      <div className="codex-composer-menu__label codex-composer-menu__label--divider">
                        <span className="truncate text-foreground">
                          {workspace.name || t('composer.workspaceActions')}
                        </span>
                        {workspace.rootPath && (
                          <span className="truncate font-mono text-[11px] text-muted-foreground">
                            {workspace.rootPath}
                          </span>
                        )}
                      </div>
                    )}

                    {workspace && onPermissionModeChange && (
                      <>
                        <div className="codex-composer-menu__label">
                          <span>{t('composer.permissionMenuTitle')}</span>
                          <button
                            type="button"
                            className="codex-composer-menu__label-action"
                            onClick={() => handleWorkspaceAction(() => setWorkspaceMenuOpen(false))}
                          >
                            {t('composer.permissionLearnMore')}
                          </button>
                        </div>
                        {WORKSPACE_PERMISSION_MODES.map((mode) => {
                          const selected = activePermissionMode === mode;
                          const isFull = mode === 'fullAccess';
                          const Icon = PERMISSION_MODE_ICONS[mode];
                          return (
                            <button
                              key={mode}
                              type="button"
                              className={cn(
                                'codex-composer-menu__item codex-composer-menu__option',
                                isFull && 'codex-composer-menu__option--warning',
                              )}
                              data-testid={`chat-composer-permission-option-${mode}`}
                              onClick={() => handleWorkspaceAction(() => onPermissionModeChange(mode))}
                            >
                              <span className="codex-composer-menu__icon">
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="codex-composer-menu__option-text">
                                <b>{t(`composer.permissionMode.${mode}`)}</b>
                                <small>{t(`composer.permissionModeDescription.${mode}`)}</small>
                              </span>
                              <span
                                className="codex-composer-menu__check"
                                data-hidden={selected ? undefined : 'true'}
                              >
                                <Check className="h-4 w-4" />
                              </span>
                            </button>
                          );
                        })}
                      </>
                    )}

                    {(onPickWorkspaceFolder || onNewSession) && (
                      <div className="border-t border-black/5 py-1.5 dark:border-white/10">
                        {onPickWorkspaceFolder && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                            data-testid="chat-composer-pick-workspace"
                            onClick={() => handleWorkspaceAction(onPickWorkspaceFolder)}
                          >
                            <FolderPlus className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{t('composer.pickWorkspaceFolder')}</span>
                          </button>
                        )}
                        {onNewSession && (
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                            data-testid="chat-composer-new-session"
                            onClick={() => handleWorkspaceAction(onNewSession)}
                          >
                            <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{t('composer.newWorkspaceSession')}</span>
                          </button>
                        )}
                      </div>
                    )}

                    {onSwitchAgent && (agents ?? []).length > 0 && (
                      <div className="border-t border-black/5 py-1.5 dark:border-white/10">
                        <div className="flex items-center gap-1.5 px-2.5 pb-1 text-tiny font-medium text-muted-foreground/80">
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
                                'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                                selected ? 'bg-black/5 text-foreground dark:bg-white/10' : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
                              )}
                              data-testid={`chat-composer-switch-agent-${agent.id}`}
                              disabled={selected}
                              onClick={() => handleWorkspaceAction(() => onSwitchAgent(agent.id))}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <AgentAvatar agentId={agent.id} name={agent.name} avatar={agent.avatar} size={28} />
                                <span className="min-w-0">
                                <span className="block truncate font-medium">{agent.name}</span>
                                <span className="block truncate text-tiny text-muted-foreground">
                                  {t('composer.modelSourceDefault')}: {agent.modelDisplay}
                                </span>
                                </span>
                              </span>
                              {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="chat-composer-agent"
                  className={cn(
                    'h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors',
                    (pickerOpen || selectedTarget) && 'bg-primary/10 text-primary hover:bg-primary/20'
                  )}
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                    setModelPickerOpen(false);
                    setKnowledgePickerOpen(false);
                    setPickerOpen((open) => !open);
                  }}
                  disabled={inputDisabled || sending}
                  aria-label={t('composer.pickAgent')}
                >
                  <AtSign className="h-3.5 w-3.5" />
                </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" collisionPadding={8}>{t('composer.pickAgent')}</TooltipContent>
                </Tooltip>
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

            <div ref={knowledgePickerRef} className="relative shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'codex-composer-control codex-knowledge-trigger max-w-[152px]',
                  (knowledgePickerOpen || knowledgeScope !== 'none' || selectedKnowledgeRefs.length > 0)
                    && 'is-active',
                )}
                data-testid="chat-knowledge-scope-button"
                aria-label={t('composer.knowledgeScopeTitle')}
                aria-expanded={knowledgePickerOpen}
                disabled={inputDisabled || sending}
                onClick={() => {
                  const nextOpen = !knowledgePickerOpen;
                  setActionMenuOpen(false);
                  setWorkspaceMenuOpen(false);
                  setPickerOpen(false);
                  setModelPickerOpen(false);
                  setKnowledgePickerOpen(nextOpen);
                }}
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t(`composer.knowledgeScope.${knowledgeScope}`)}</span>
                <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', knowledgePickerOpen && 'rotate-180')} />
              </button>
                </TooltipTrigger>
                <TooltipContent side="top" collisionPadding={8}>{t('composer.knowledgeScopeTitle')}</TooltipContent>
              </Tooltip>
              {knowledgePickerOpen && (
                <div
                  className="codex-composer-menu codex-composer-menu--approval codex-composer-menu--knowledge"
                  data-testid="chat-knowledge-scope-menu"
                >
                  <div className="codex-composer-menu__label">
                    <span>{t('composer.knowledgeScopeTitle')}</span>
                  </div>
                  {KNOWLEDGE_SCOPES.map((scope) => {
                    const isActive = scope === knowledgeScope;
                    return (
                    <button
                      key={scope}
                      type="button"
                      className={cn(
                        'codex-composer-menu__item codex-composer-menu__option',
                        !isActive && 'opacity-80',
                      )}
                      data-testid={`chat-knowledge-scope-${scope}`}
                      onClick={() => {
                        void onKnowledgeScopeChange?.(scope);
                        setKnowledgePickerOpen(false);
                        textareaRef.current?.focus();
                      }}
                    >
                      <span className="codex-composer-menu__icon">
                        {isActive && <Check className="h-4 w-4" />}
                      </span>
                      <span className="codex-composer-menu__option-text">
                        <b>{t(`composer.knowledgeScope.${scope}`)}</b>
                        <small>{t(`composer.knowledgeScopeDescription.${scope}`)}</small>
                      </span>
                    </button>
                    );
                  })}
                  <div className="codex-composer-menu__label codex-composer-menu__label--divider">
                    <span>{t('composer.knowledgeModeTitle')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 px-2 pb-2">
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

            <div className="codex-composer-control-group ml-auto flex min-w-0 shrink-0 items-center gap-1">
            {(showModelPicker || currentAgentId) && (
              <div ref={modelPickerRef} className="relative shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                <button
                  type="button"
                  data-testid="chat-model-picker-button"
                  className={cn('codex-composer-control codex-model-picker-trigger', modelPickerOpen && 'is-active')}
                  aria-label={`${t('composer.actions.model')} / ${t('composer.effortTitle')}`}
                  aria-expanded={modelPickerOpen}
                  disabled={inputDisabled || sending}
                  onClick={() => setModelPickerOpen((open) => !open)}
                >
                  <span
                    data-testid="chat-agent-effort-button"
                    className={cn(
                      'codex-execution-settings__effort-shortcut',
                      executionEffortPreview === 'max' && 'is-max',
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      setModelPickerOpen(true);
                      setExecutionSettingsSection('effort');
                    }}
                  >
                    <Flame className="h-3.5 w-3.5 shrink-0" />
                  </span>
                  <span className="codex-model-picker-label max-w-[138px] truncate">{effectiveModelLabel}</span>
                  <ChevronDown className={cn('codex-model-picker-chevron h-3.5 w-3.5 transition-transform', modelPickerOpen && 'rotate-180')} />
                </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" collisionPadding={8}>{`${t('composer.actions.model')} / ${t('composer.effortTitle')}`}</TooltipContent>
                </Tooltip>
                {modelPickerOpen && (
                  <div
                    className="codex-composer-menu codex-composer-menu--model codex-execution-settings"
                    data-testid="chat-model-picker-menu"
                  >
                    <div className="flex gap-1 p-2" data-testid="chat-model-scope-selector">
                      {(['turn', 'session', 'persistent'] as const).map((scope) => (
                        <button key={scope} type="button" data-testid={`chat-model-scope-${scope}`} aria-pressed={modelScope === scope}
                          className={cn('rounded-md px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10', modelScope === scope && 'bg-black/5 dark:bg-white/10')}
                          onClick={() => { setModelScope(scope); setExecutionSettingsSection('model'); }}>
                          {t(`composer.modelScope.${scope}`)}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="codex-execution-settings__row"
                      aria-expanded={executionSettingsSection === 'model'}
                      onClick={() => setExecutionSettingsSection((section) => section === 'model' ? null : 'model')}
                    >
                      <span>{t('composer.actions.model')}</span>
                      <span className="codex-execution-settings__value">{effectiveModelLabel}</span>
                      <ChevronRight className={cn('codex-execution-settings__chevron', executionSettingsSection === 'model' && 'rotate-90')} />
                    </button>
                    {executionSettingsSection === 'model' && (
                      <div className="codex-execution-settings__section" data-testid="chat-model-options">
                        {pickerModelOptions.map((option) => {
                          const isActive = option.modelRef === effectiveModelRef;
                          return (
                            <button
                              key={option.modelRef}
                              type="button"
                              onClick={() => void handleSelectModel(option.modelRef)}
                              className={cn('codex-composer-menu__item', isActive && 'is-active')}
                              data-testid={`chat-model-picker-option-${option.label}`}
                            >
                              <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate">{option.label}</span>
                              <span className="codex-composer-menu__check" data-hidden={isActive ? undefined : 'true'}>
                                <Check className="h-3.5 w-3.5" />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button
                      type="button"
                      className="codex-execution-settings__row"
                      aria-expanded={executionSettingsSection === 'effort'}
                      onClick={() => setExecutionSettingsSection((section) => section === 'effort' ? null : 'effort')}
                    >
                      <span>{t('composer.effortTitle')}</span>
                      <span className={cn(
                        'codex-execution-settings__value',
                        executionEffortPreview === 'max' && 'is-max',
                      )}>
                        {currentEffortLabel}
                      </span>
                      <ChevronRight className={cn('codex-execution-settings__chevron', executionSettingsSection === 'effort' && 'rotate-90')} />
                    </button>
                    {executionSettingsSection === 'effort' && currentAgentId && (
                      <div className="codex-execution-settings__section codex-execution-settings__section--effort">
                        <ChatAgentEffortPanel
                          agentId={currentAgent?.id ?? currentAgentId}
                          disabled={inputDisabled || sending}
                          onEffortChange={setExecutionEffortPreview}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {sending && !paused && hasComposerDraft && (
              <div className="composer-intervention-controls" data-testid="chat-intervention-controls">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        data-testid="chat-intervention-guide"
                        className="composer-intervention-button"
                        disabled={!canIntervene}
                        onClick={() => void handleInterventionSend('guide')}
                        aria-label={t('composer.intervention.guide')}
                      >
                        <Navigation className="h-4 w-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" collisionPadding={8}>{t('composer.intervention.guideTooltip')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        data-testid="chat-intervention-revise-goal"
                        className="composer-intervention-button"
                        disabled={!canIntervene}
                        onClick={() => void handleInterventionSend('revise-goal')}
                        aria-label={t('composer.intervention.reviseGoal')}
                      >
                        <PencilLine className="h-4 w-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" collisionPadding={8}>{t('composer.intervention.reviseGoalTooltip')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        data-testid="chat-intervention-queue"
                        className="composer-intervention-button composer-intervention-button--queue"
                        disabled={!canIntervene}
                        onClick={() => void handleInterventionSend('queue')}
                        aria-label={t('composer.intervention.queue')}
                      >
                        <ListPlus className="h-4 w-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" collisionPadding={8}>{t('composer.intervention.queueTooltip')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        data-testid="chat-intervention-interrupt"
                        className="composer-intervention-button composer-intervention-button--interrupt"
                        disabled={!canIntervene}
                        onClick={() => void handleInterventionSend('interrupt')}
                        aria-label={t('composer.intervention.interrupt')}
                      >
                        <Square className="h-3.5 w-3.5 fill-current" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" collisionPadding={8}>{t('composer.intervention.interruptTooltip')}</TooltipContent>
                </Tooltip>
              </div>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
              <Button
                onClick={handlePrimaryComposerAction}
                onDoubleClick={handlePrimaryComposerDoubleClick}
                disabled={sendButtonMeta.disabled}
                size="icon"
                data-testid="chat-composer-send"
                data-send-state={composerSendState}
                className="composer-send-button"
                variant="ghost"
                aria-label={t(sendButtonMeta.labelKey)}
              >
                <SendButtonIcon className={sendButtonMeta.iconClassName} />
              </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" collisionPadding={8}>
                {t(sendButtonMeta.tooltipKey)}
              </TooltipContent>
            </Tooltip>
            </div>
          </div>
        </div>
        <div
          hidden={!showInlineComposerStatus}
          className={cn(
            'mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 text-tiny text-muted-foreground/60',
            !showInlineComposerStatus && 'hidden',
          )}
        >
          {(!isGatewayUsable || chatComposerStatusComponents.length > 0) && (
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
          )}
          {(pendingMessages.length > 0 || hasLongTaskControlDetails) && (
            <div
              className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 text-right"
              data-testid="chat-composer-context-status"
            >
              {pendingMessages.length > 0 && (
                <Badge
                  variant="outline"
                  className="h-6 rounded-md border-sky-500/30 bg-sky-500/10 px-2 text-[11px] font-medium text-sky-700 dark:text-sky-400"
                  data-testid="chat-pending-messages-count"
                >
                  {t('composer.queueCount', { count: pendingMessages.length })}
                </Badge>
              )}
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
      {/* FP-P1-01: first-send provider gate — no usable provider configured. */}
      <Dialog open={providerGateOpen} onOpenChange={setProviderGateOpen}>
        <DialogContent
          className="max-w-md rounded-lg border border-black/10 bg-surface-modal p-5 shadow-xl dark:border-white/10"
          data-testid="chat-provider-gate-dialog"
        >
          <DialogTitle className="font-serif text-xl font-normal tracking-tight text-foreground">
            {t('composer.providerGate.title')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {t('composer.providerGate.desc')}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setProviderGateOpen(false)}>
              {t('composer.providerGate.dismiss')}
            </Button>
            <Button
              data-testid="chat-provider-gate-configure"
              onClick={() => {
                setProviderGateOpen(false);
                navigate('/settings/models');
              }}
            >
              {t('composer.providerGate.configure')}
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

function ComposerActionGroup({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border py-1.5 last:border-b-0" data-testid={testId}>
      <div className="sticky top-0 z-10 bg-surface-modal/95 px-2.5 pb-1 pt-0.5 text-2xs font-medium text-muted-foreground backdrop-blur-sm">{title}</div>
      <div className="grid gap-0.5">{children}</div>
    </section>
  );
}

function ComposerActionButton({
  icon: Icon,
  label,
  description,
  testId,
  disabled = false,
  title,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  description?: string;
  testId: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex min-h-10 w-full items-center gap-3 rounded-[12.5px] px-2.5 py-1.5 text-left text-xs font-medium transition-[background-color,color] duration-150',
        disabled
          ? 'cursor-not-allowed text-muted-foreground/40'
          : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
      )}
      data-testid={testId}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="inline truncate text-sm text-foreground">{label}</span>
        {description && <span className="ml-2 inline truncate text-xs font-normal text-muted-foreground">{description}</span>}
      </span>
    </button>
  );
}

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const { t } = useTranslation('chat');
  const isImage = !!attachment.mimeType.startsWith('image/') && !!attachment.preview;
  const [dissolving, setDissolving] = useState(false);

  const handleRemove = () => {
    if (dissolving) return;
    setDissolving(true);
  };

  return (
    <SmokyDissolve
      dissolving={dissolving}
      onDissolved={onRemove}
      isImage={isImage}
      // Match the reference card's compact smoky-dissolve profile. The
      // wrapper leaves layout immediately; only the fixed canvas runs here.
      durationMs={550}
      gravity={150}
      warp={30}
      maxBlur={12}
      sway={0}
      spin={3}
      churn={30}
      spread={0}
      className="shrink-0"
    >
      <Tooltip>
        <TooltipTrigger asChild>
      <AttachmentRoot
        className="h-[88px] w-[88px] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/20 dark:bg-white/[0.92]"
        data-testid="chat-composer-attachment"
      >
        {isImage ? (
          <AttachmentThumb
            src={attachment.preview!}
            alt={attachment.fileName}
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white dark:bg-white/[0.92]">
            <span className="sr-only">{attachment.fileName}</span>
            <LobeConfigProvider
              config={{
                proxy: 'custom',
                customCdnFn: () => new URL('./lobe-icons', window.location.href).toString(),
              }}
              motion={LOBE_FILE_ICON_MOTION}
            >
              <MaterialFileTypeIcon
                filename={attachment.fileName}
                type={attachment.mimeType === DIRECTORY_MIME_TYPE ? 'folder' : 'file'}
                size={40}
                className="pointer-events-none shrink-0"
              />
            </LobeConfigProvider>
          </div>
        )}

        {/* Staging overlay */}
        {attachment.status === 'staging' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35">
            <Loader2 className="h-4 w-4 text-white animate-spin" />
          </div>
        )}

        {/* Error overlay */}
        {attachment.status === 'error' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-destructive/20">
            <span className="text-2xs text-destructive font-medium px-1">Error</span>
          </div>
        )}

        <AttachmentRemove
          onRemove={handleRemove}
          aria-label={t('composer.removeAttachment', { fileName: attachment.fileName })}
          data-testid="chat-composer-attachment-remove"
          className="right-1.5 top-1.5 z-20 grid h-6 w-6 place-items-center bg-white/95 p-0 text-[#17181c] opacity-100 shadow-[0_1px_3px_rgba(0,0,0,0.25)] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#17181c]"
        />
      </AttachmentRoot>
        </TooltipTrigger>
        <TooltipContent side="top">{attachment.fileName}</TooltipContent>
      </Tooltip>
    </SmokyDissolve>
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
        'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5'
      )}
    >
      <AgentAvatar agentId={agent.id} name={agent.name} avatar={agent.avatar} size={30} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{agent.name}</span>
        <span className="block truncate text-tiny text-muted-foreground">{agent.modelDisplay}</span>
      </span>
    </button>
  );
}
