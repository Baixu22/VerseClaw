import { BookOpenCheck, Gauge, RefreshCw, FolderTree, ListTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { WORKSPACE_BROWSER_ENABLED } from '@/components/file-preview/workspace-browser-config';
import { useMemo } from 'react';
import { ResourceChip } from '@/components/chat/ResourceChip';
import type { PromptCacheRiskAssessment, PromptCacheStatus } from '@shared/types/workspace';

type ChatToolbarProps = {
  questionDirectoryOpen?: boolean;
  questionDirectoryCount?: number;
  onToggleQuestionDirectory?: () => void;
  onSaveToKnowledge?: () => void;
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

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 0.01 ? 2 : 4)}`;
}

function statusTone(status: PromptCacheStatus): string {
  switch (status) {
    case 'warm':
      return 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400';
    case 'warming':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400';
    case 'at-risk':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
    case 'cold':
      return 'border-zinc-400/30 bg-black/5 text-muted-foreground dark:bg-white/10';
    case 'ineligible':
      return 'border-zinc-300/30 bg-transparent text-muted-foreground';
    case 'unknown':
    default:
      return 'border-zinc-300/30 bg-transparent text-muted-foreground';
  }
}

function shouldShowPromptCacheChip(status?: PromptCacheRiskAssessment | null): status is PromptCacheRiskAssessment {
  if (!status) return false;
  if (status.lastRiskEvent) return true;
  if (status.cacheReadTokens > 0 || status.cacheWriteTokens > 0) return true;
  return status.status !== 'unknown' && status.promptTokens > 0;
}

export function ChatToolbar({
  questionDirectoryOpen = false,
  questionDirectoryCount = 0,
  onToggleQuestionDirectory,
  onSaveToKnowledge,
  promptCacheStatus,
}: ChatToolbarProps = {}) {
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const agents = useAgentsStore((s) => s.agents);
  const openBrowser = useArtifactPanel((s) => s.openBrowser);
  const panelOpen = useArtifactPanel((s) => s.open);
  const panelTab = useArtifactPanel((s) => s.tab);
  const closePanel = useArtifactPanel((s) => s.close);
  const { t } = useTranslation('chat');
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );

  const browserActive = WORKSPACE_BROWSER_ENABLED && panelOpen && panelTab === 'browser';
  const questionDirectoryAvailable = questionDirectoryCount > 1 && !!onToggleQuestionDirectory;
  const showPromptCacheChip = shouldShowPromptCacheChip(promptCacheStatus);
  const promptCacheReason = promptCacheStatus?.reason ?? promptCacheStatus?.lastRiskEvent?.reason;

  return (
    <div className="flex items-center gap-2">
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
              <span className="hidden sm:inline">
                {t(`toolbar.promptCache.short.${promptCacheStatus.status}`)}
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            <div className="space-y-1 text-xs">
              <p className="font-medium text-foreground">
                {t('toolbar.promptCache.title', {
                  status: t(`toolbar.promptCache.status.${promptCacheStatus.status}`),
                })}
              </p>
              <p>
                {t('toolbar.promptCache.hitRate', {
                  value: formatCacheHitRate(promptCacheStatus.hitRate),
                })}
              </p>
              {promptCacheStatus.lastTurnHitRate != null && (
                <p>
                  {t('toolbar.promptCache.lastTurnHitRate', {
                    value: formatCacheHitRate(promptCacheStatus.lastTurnHitRate),
                  })}
                </p>
              )}
              {promptCacheStatus.warmTurnHitRate != null && (
                <p>
                  {t('toolbar.promptCache.warmTurnHitRate', {
                    value: formatCacheHitRate(promptCacheStatus.warmTurnHitRate),
                  })}
                </p>
              )}
              <p>
                {t('toolbar.promptCache.tokens', {
                  read: formatCacheTokens(promptCacheStatus.cacheReadTokens),
                  write: formatCacheTokens(promptCacheStatus.cacheWriteTokens),
                })}
              </p>
              <p>
                {t('toolbar.promptCache.confidence', {
                  value: t(`toolbar.promptCache.confidenceValue.${promptCacheStatus.confidence}`),
                })}
              </p>
              {promptCacheReason && (
                <p>
                  {t('toolbar.promptCache.reason', {
                    reason: t(`toolbar.promptCache.reasonValue.${promptCacheReason}`, {
                      defaultValue: promptCacheReason,
                    }),
                  })}
                </p>
              )}
              {promptCacheStatus.warningCount > 0 && (
                <p>
                  {t('toolbar.promptCache.ledger', {
                    warnings: promptCacheStatus.warningCount,
                    cancelled: promptCacheStatus.cancelledBreakCount,
                  })}
                </p>
              )}
              {promptCacheStatus.costEstimateReliable && promptCacheStatus.estimatedSavedUsd != null && (
                <p>
                  {t('toolbar.promptCache.saved', {
                    value: formatUsd(promptCacheStatus.estimatedSavedUsd),
                  })}
                </p>
              )}
              {promptCacheStatus.costEstimateReliable && promptCacheStatus.estimatedExtraCostUsd != null && (
                <p>
                  {t('toolbar.promptCache.extraCost', {
                    value: formatUsd(promptCacheStatus.estimatedExtraCostUsd),
                  })}
                </p>
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
                'h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                browserActive && 'bg-foreground/10 text-foreground',
              )}
              onClick={() => (browserActive ? closePanel() : openBrowser())}
              disabled={!currentAgent?.workspace}
              aria-label={t('toolbar.workspace')}
            >
              <FolderTree className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('toolbar.workspace')}</p>
          </TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="chat-save-knowledge"
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            onClick={onSaveToKnowledge}
            disabled={!onSaveToKnowledge}
            aria-label={t('toolbar.saveToKnowledge')}
          >
            <BookOpenCheck className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.saveToKnowledge')}</p>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="chat-question-directory-toggle"
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
              questionDirectoryOpen && 'bg-foreground/10 text-foreground',
            )}
            onClick={onToggleQuestionDirectory}
            disabled={!questionDirectoryAvailable}
            aria-label={t('questionDirectory.title')}
          >
            <ListTree className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('questionDirectory.title')}</p>
        </TooltipContent>
      </Tooltip>
      {/* Refresh */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            onClick={() => refresh()}
            disabled={loading}
            aria-label={t('toolbar.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
