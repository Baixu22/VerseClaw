import { Gauge, ListTree, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ResourceChip } from '@/components/chat/ResourceChip';
import { WORKSPACE_BROWSER_ENABLED } from '@/components/file-preview/workspace-browser-config';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { useChatStore } from '@/stores/chat';
import { PanelRightOpen } from '@/components/icons/codex-icons';
import type { PromptCacheRiskAssessment, PromptCacheStatus } from '@shared/types/workspace';

type ChatToolbarProps = {
  questionDirectoryOpen?: boolean;
  questionDirectoryCount?: number;
  onToggleQuestionDirectory?: () => void;
  promptCacheStatus?: PromptCacheRiskAssessment | null;
};

function formatCacheTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return `${Math.round(value)}`;
  if (value < 1_000_000) {
    const compact = value / 1000;
    return `${compact >= 10 ? compact.toFixed(0) : compact.toFixed(1)}k`;
  }
  const compact = value / 1_000_000;
  return `${compact >= 10 ? compact.toFixed(0) : compact.toFixed(1)}m`;
}

function formatCacheHitRate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
}

function statusTone(status: PromptCacheStatus): string {
  if (status === 'at-risk') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  if (status === 'warm' || status === 'warming') return 'border-border/60 bg-foreground/[0.035] text-muted-foreground';
  return 'border-border/50 bg-transparent text-muted-foreground';
}

/* A healthy prompt cache is the normal case, so reporting it earns the user
 * nothing but another lit chip in the toolbar. Surface the chip only when the
 * cache actually needs attention: the current assessment says `at-risk`, or a
 * risk event fired earlier this session and is still worth explaining. Warm,
 * warming, and unknown states stay silent — the details remain reachable
 * through the same tooltip once the chip has a reason to appear. */
function shouldShowPromptCacheChip(status?: PromptCacheRiskAssessment | null): status is PromptCacheRiskAssessment {
  if (!status) return false;
  if (status.status === 'at-risk') return true;
  return Boolean(status.lastRiskEvent);
}

export function ChatToolbar({
  questionDirectoryOpen = false,
  questionDirectoryCount = 0,
  onToggleQuestionDirectory,
  promptCacheStatus,
}: ChatToolbarProps = {}) {
  const refresh = useChatStore((state) => state.refresh);
  const loading = useChatStore((state) => state.loading);
  const currentAgentId = useChatStore((state) => state.currentAgentId);
  const agents = useAgentsStore((state) => state.agents);
  const openWorkspacePanel = useArtifactPanel((state) => state.openWorkspacePanel);
  const panelOpen = useArtifactPanel((state) => state.open);
  const closePanel = useArtifactPanel((state) => state.close);
  const { t } = useTranslation('chat');
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );

  // The toggle opens/closes the whole panel now — the tab strip inside it owns
  // which view is showing, so there is no single "browser tab is active" state.
  const browserActive = WORKSPACE_BROWSER_ENABLED && panelOpen;
  const questionDirectoryAvailable = questionDirectoryCount > 1 && Boolean(onToggleQuestionDirectory);
  const showPromptCacheChip = shouldShowPromptCacheChip(promptCacheStatus);
  const promptCacheReason = promptCacheStatus?.reason ?? promptCacheStatus?.lastRiskEvent?.reason;

  return (
    <div className="flex min-w-0 items-center gap-1">
      <ResourceChip />
      {showPromptCacheChip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              data-testid="chat-prompt-cache-status"
              className={cn(
                'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium',
                statusTone(promptCacheStatus.status),
              )}
              aria-label={t('toolbar.promptCache.ariaLabel', {
                status: t(`toolbar.promptCache.status.${promptCacheStatus.status}`),
              })}
            >
              <Gauge className="h-4 w-4" />
              <span className="hidden lg:inline">{t(`toolbar.promptCache.short.${promptCacheStatus.status}`)}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" collisionPadding={8} className="max-w-72">
            <div className="space-y-1 text-xs">
              <p className="font-medium text-foreground">
                {t('toolbar.promptCache.title', {
                  status: t(`toolbar.promptCache.status.${promptCacheStatus.status}`),
                })}
              </p>
              <p>{t('toolbar.promptCache.hitRate', { value: formatCacheHitRate(promptCacheStatus.hitRate) })}</p>
              <p>{t('toolbar.promptCache.tokens', {
                read: formatCacheTokens(promptCacheStatus.cacheReadTokens),
                write: formatCacheTokens(promptCacheStatus.cacheWriteTokens),
              })}</p>
              {promptCacheStatus.status === 'at-risk' && promptCacheReason && (
                <p>{t('toolbar.promptCache.reason', {
                  reason: t(`toolbar.promptCache.reasonValue.${promptCacheReason}`, { defaultValue: promptCacheReason }),
                })}</p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
      {WORKSPACE_BROWSER_ENABLED && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-testid="chat-workspace-toggle"
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-8 hover:bg-foreground/5 hover:text-foreground',
                browserActive && 'bg-foreground/10 text-foreground',
              )}
              onClick={() => (browserActive ? closePanel() : openWorkspacePanel({ panel: 'files' }))}
              disabled={!currentAgent?.workspace}
              aria-label={t('toolbar.workspace')}
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" collisionPadding={8}><p>{t('toolbar.workspace')}</p></TooltipContent>
        </Tooltip>
      )}
      {questionDirectoryAvailable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-testid="chat-question-directory-toggle"
              variant="ghost"
              size="icon"
              className={cn(
                'h-8 w-8 hover:bg-foreground/5 hover:text-foreground',
                questionDirectoryOpen && 'bg-foreground/10 text-foreground',
              )}
              onClick={onToggleQuestionDirectory}
              aria-label={t('questionDirectory.title')}
            >
              <ListTree className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" collisionPadding={8}><p>{t('questionDirectory.title')}</p></TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="chat-toolbar-refresh"
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-foreground/5 hover:text-foreground"
            onClick={() => refresh()}
            disabled={loading}
            aria-label={t('toolbar.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" collisionPadding={8}><p>{t('toolbar.refresh')}</p></TooltipContent>
      </Tooltip>
    </div>
  );
}
