import { Activity, Gauge, PackageOpen, RefreshCw } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MemoryInjectionPanel } from '@/components/chat/MemoryInjectionPanel';
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
  promptCacheStatus?: PromptCacheRiskAssessment | null;
  sessionActivityAvailable?: boolean;
  /** Reflects the rail's EFFECTIVE state, passive layer included. */
  sessionActivityOpen?: boolean;
  sessionActivityNeedsAttention?: boolean;
  onToggleSessionActivity?: () => void;
};

/**
 * A control the incoming workspace panel wipes away.
 *
 * The panel's leading edge crosses the toolbar as it slides in, and the controls
 * it passes over go with it. They stay mounted and collapse their own width to
 * zero from the right instead of unmounting, because unmounting would re-flow
 * the row and drag the surviving button sideways — the one thing that has to
 * hold still, since it is the switch the user is about to click again to close.
 *
 * `order` is the distance from the panel's edge: 1 is the rightmost control and
 * leads the wipe, 2 follows a beat later. See codex-workspace-panel.css.
 */
function ToolbarWipe({
  wiped,
  order,
  children,
}: {
  wiped: boolean;
  order: 1 | 2;
  children: ReactNode;
}) {
  return (
    <span
      className="codex-toolbar-wipe"
      data-wiped={wiped ? 'true' : 'false'}
      data-wipe-order={order}
      aria-hidden={wiped || undefined}
    >
      {children}
    </span>
  );
}

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
  promptCacheStatus,
  sessionActivityAvailable = false,
  sessionActivityOpen = false,
  sessionActivityNeedsAttention = false,
  onToggleSessionActivity,
}: ChatToolbarProps = {}) {
  const refresh = useChatStore((state) => state.refresh);
  const loading = useChatStore((state) => state.loading);
  const currentAgentId = useChatStore((state) => state.currentAgentId);
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const agents = useAgentsStore((state) => state.agents);
  const [memoryInjectionOpen, setMemoryInjectionOpen] = useState(false);
  const openWorkspacePanel = useArtifactPanel((state) => state.openWorkspacePanel);
  const panelOpen = useArtifactPanel((state) => state.open);
  const togglePanel = useArtifactPanel((state) => state.toggle);
  const hasPanelTabs = useArtifactPanel((state) => state.tabs.length > 0);
  const { t } = useTranslation('chat');
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );

  // The toggle opens/closes the whole panel now — the tab strip inside it owns
  // which view is showing, so there is no single "browser tab is active" state.
  const browserActive = WORKSPACE_BROWSER_ENABLED && panelOpen;
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
              aria-expanded={browserActive}
              onClick={() => (browserActive || hasPanelTabs ? togglePanel() : openWorkspacePanel({ panel: 'files' }))}
              disabled={!currentAgent?.workspace}
              aria-label={t('toolbar.workspace')}
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" collisionPadding={8}><p>{t('toolbar.workspace')}</p></TooltipContent>
        </Tooltip>
      )}
      {sessionActivityAvailable && onToggleSessionActivity && (
        <ToolbarWipe wiped={panelOpen} order={2}>
        {/* Toggle only — the panel itself is the chat page's status rail, not a
            dropdown owned by this button. A Radix dropdown would have re-parented
            it into a portal, where it could not inset the transcript for the
            passive layer, and its open state would have been the menu's rather
            than the rail's. */}
        <span className="chat-session-activity-control" data-testid="chat-session-activity-control">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="chat-session-activity-toggle"
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8 hover:bg-foreground/5 hover:text-foreground',
                  sessionActivityOpen && 'bg-foreground/10 text-foreground',
                )}
                aria-label={t('sessionActivity.title')}
                aria-expanded={sessionActivityOpen}
                onClick={onToggleSessionActivity}
              >
                <Activity className={cn('h-4 w-4', sessionActivityNeedsAttention && 'text-red-700 dark:text-red-400')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" collisionPadding={8}><p>{t('sessionActivity.title')}</p></TooltipContent>
          </Tooltip>
        </span>
        </ToolbarWipe>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid="chat-memory-injection-toggle"
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8 hover:bg-foreground/5 hover:text-foreground',
              memoryInjectionOpen && 'bg-foreground/10 text-foreground',
            )}
            aria-label={t('memoryInjection.title')}
            aria-expanded={memoryInjectionOpen}
            onClick={() => setMemoryInjectionOpen(true)}
          >
            <PackageOpen className="h-4 w-4" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" collisionPadding={8}><p>{t('memoryInjection.title')}</p></TooltipContent>
      </Tooltip>
      <MemoryInjectionPanel
        open={memoryInjectionOpen}
        onOpenChange={setMemoryInjectionOpen}
        sessionKey={currentSessionKey}
      />
      <ToolbarWipe wiped={panelOpen} order={1}>
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
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" collisionPadding={8}><p>{t('toolbar.refresh')}</p></TooltipContent>
        </Tooltip>
      </ToolbarWipe>
    </div>
  );
}
