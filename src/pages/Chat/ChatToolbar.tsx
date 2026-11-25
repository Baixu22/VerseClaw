import { Activity, Gauge, MessagesSquare, Loader2, MoreHorizontal, PackageOpen, RefreshCw, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
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
import { FileText, ListChecks, PanelRightOpen } from '@/components/icons/codex-icons';
import { useDismissOnOutside, usePopover } from '@/components/settings/primitives/usePopover';
import { useOverlayPortalContainer } from '@/components/ui/overlay-portal';
import { ExecutionMigrationControl } from './ExecutionMigrationControl';
import type { PromptCacheRiskAssessment } from '@shared/types/workspace';
import type { SessionContinuityRecommendation } from './session-continuity';

type ChatToolbarProps = {
  workspaceId?: string;
  sessionGeneration?: string;
  promptCacheStatus?: PromptCacheRiskAssessment | null;
  sessionActivityAvailable?: boolean;
  /** Reflects the rail's EFFECTIVE state, passive layer included. */
  sessionActivityOpen?: boolean;
  sessionActivityNeedsAttention?: boolean;
  onToggleSessionActivity?: () => void;
  onCheckpoints?: () => void;
  checkpointsDisabled?: boolean;
  onForkSession?: () => void | Promise<void>;
  forkDisabled?: boolean;
  forkDisabledReason?: string;
  forkBusy?: boolean;
  onHandoffSession?: () => void | Promise<void>;
  handoffDisabled?: boolean;
  handoffDisabledReason?: string;
  handoffBusy?: boolean;
  continuityRecommendation?: SessionContinuityRecommendation;
};

/** Shared with the sidebar's `.icon-button`: 30px, radius-md, secondary ink, row-hover wash. */
const CHROME_ICON = 'h-[30px] w-[30px] rounded-md text-[color:var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-row-hover)] hover:text-foreground dark:hover:bg-[var(--color-background-row-hover)]';
const CHROME_ICON_ACTIVE = 'bg-[var(--color-background-row-hover)] text-foreground';

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

// A recovered cache returns to the quiet state even when its history retains a risk event.
function shouldShowPromptCacheChip(status?: PromptCacheRiskAssessment | null): status is PromptCacheRiskAssessment {
  return status?.status === 'at-risk';
}

export function ChatToolbar({
  workspaceId,
  sessionGeneration,
  promptCacheStatus,
  sessionActivityAvailable = false,
  sessionActivityOpen = false,
  sessionActivityNeedsAttention = false,
  onToggleSessionActivity,
  onCheckpoints,
  checkpointsDisabled,
  onForkSession,
  forkDisabled,
  forkDisabledReason,
  forkBusy,
  onHandoffSession,
  handoffDisabled,
  handoffDisabledReason,
  handoffBusy,
  continuityRecommendation,
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
  const navigate = useNavigate();
  const { triggerRef: moreTriggerRef, layerRef: moreLayerRef, open: moreOpen, setOpen: setMoreOpen, style: moreStyle } = usePopover<HTMLButtonElement>({ gap: 4 });
  const overlayContainer = useOverlayPortalContainer();
  useDismissOnOutside({ open: moreOpen, onDismiss: () => setMoreOpen(false), refs: [moreTriggerRef, moreLayerRef] });
  useEffect(() => {
    if (moreOpen && moreStyle.visibility === 'visible') moreLayerRef.current?.focus({ preventScroll: true });
  }, [moreOpen, moreStyle.visibility, moreLayerRef]);
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );

  // The toggle opens/closes the whole panel now — the tab strip inside it owns
  // which view is showing, so there is no single "browser tab is active" state.
  const browserActive = WORKSPACE_BROWSER_ENABLED && panelOpen;
  const showPromptCacheChip = shouldShowPromptCacheChip(promptCacheStatus);
  const promptCacheReason = promptCacheStatus?.reason ?? promptCacheStatus?.lastRiskEvent?.reason;
  const recommendHandoff = !continuityRecommendation?.disabled && continuityRecommendation?.reason === 'high_pressure';

  return (
    <div className="flex min-w-0 items-center gap-1">
      <ResourceChip />
      {showPromptCacheChip && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              data-testid="chat-prompt-cache-status"
              tabIndex={0}
              role="status"
              className="inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-xs text-amber-700 dark:text-amber-400"
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
              className={cn(CHROME_ICON, browserActive && CHROME_ICON_ACTIVE)}
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
        <span className="chat-session-activity-control" data-testid="chat-session-activity-control">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="chat-session-activity-toggle"
                variant="ghost"
                size="icon"
                className={cn(CHROME_ICON, sessionActivityOpen && CHROME_ICON_ACTIVE)}
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
      )}
      <MemoryInjectionPanel
        open={memoryInjectionOpen}
        onOpenChange={setMemoryInjectionOpen}
        sessionKey={currentSessionKey}
      />
      <span className="relative inline-flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button ref={moreTriggerRef} data-testid="chat-toolbar-more" variant="ghost" size="icon"
              className={cn(CHROME_ICON, moreOpen && CHROME_ICON_ACTIVE)} aria-label={t('toolbar.moreActions')} aria-haspopup="menu" aria-expanded={moreOpen}
              onClick={() => setMoreOpen(value => !value)}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('toolbar.moreActions')}</TooltipContent>
        </Tooltip>
        {/* Keep dialog owners mounted when the menu closes. */}
        {createPortal(
          <div ref={moreLayerRef} role="menu" tabIndex={-1} aria-label={t('toolbar.moreActions')}
            style={{ ...moreStyle, display: moreOpen ? undefined : 'none' }}
            data-testid="chat-toolbar-more-menu" className="codex-header-menu chat-toolbar-more-menu"
            onKeyDown={event => {
              if (!moreOpen || !event.currentTarget.contains(event.target as Node)) return;
              if (event.key === 'Escape') { setMoreOpen(false); moreTriggerRef.current?.focus(); }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                : index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }}>
          {onCheckpoints && <button type="button" role="menuitem" data-testid="chat-session-checkpoints" className="codex-header-menu__item"
            disabled={checkpointsDisabled} onClick={() => { setMoreOpen(false); onCheckpoints(); }}>
            <ListChecks className="h-4 w-4" aria-hidden="true" />{t('filePreview.checkpoints.title')}
          </button>}
          {onHandoffSession && <button type="button" role="menuitem" data-testid="chat-session-handoff" className="codex-header-menu__item chat-continuity-menu-item"
            disabled={handoffDisabled || handoffBusy} title={handoffDisabledReason}
            onClick={() => { setMoreOpen(false); void onHandoffSession(); }}>
            {handoffBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
            <span className="min-w-0 flex-1"><span>{t('composer.handoff.action')}</span><small>{handoffDisabledReason ?? t('composer.continuity.handoffDescription')}</small></span>
            {recommendHandoff && <span data-testid="chat-session-handoff-recommended" className="text-2xs text-muted-foreground">{t('composer.continuity.recommended')}</span>}
          </button>}
          {onForkSession && <button type="button" role="menuitem" data-testid="chat-session-fork" className="codex-header-menu__item chat-continuity-menu-item" title={forkDisabledReason}
            disabled={forkDisabled || forkBusy} onClick={() => { setMoreOpen(false); void onForkSession(); }}>
            {forkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessagesSquare className="h-4 w-4" aria-hidden="true" />}
            <span className="min-w-0 flex-1"><span>{t('composer.fork.action')}</span><small>{forkDisabledReason ?? t('composer.continuity.forkDescription')}</small></span>
          </button>}
          {(onCheckpoints || onForkSession || onHandoffSession) && <hr className="codex-header-menu__sep" />}
          <button type="button" role="menuitem" data-testid="chat-toolbar-refresh" disabled={loading}
            className="codex-header-menu__item disabled:opacity-40"
            onClick={() => { setMoreOpen(false); void refresh(); }}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('toolbar.refresh')}
          </button>
          <button type="button" role="menuitem" data-testid="chat-session-settings" className="codex-header-menu__item"
            onClick={() => { setMoreOpen(false); navigate(`/settings/recovery?sessionKey=${encodeURIComponent(currentSessionKey)}`); }}>
            <Settings2 className="h-4 w-4" aria-hidden="true" />{t('settings:navigation.recovery.title')}
          </button>
          <ExecutionMigrationControl workspaceId={workspaceId} sessionKey={currentSessionKey} generation={sessionGeneration}
            menuItem onOpen={() => setMoreOpen(false)} returnFocusRef={moreTriggerRef} />
          <hr className="codex-header-menu__sep" />
          <button type="button" role="menuitem" data-testid="chat-memory-injection-toggle" className="codex-header-menu__item"
            onClick={() => { setMoreOpen(false); setMemoryInjectionOpen(true); }}>
            <PackageOpen className="h-4 w-4" aria-hidden="true" />{t('memoryInjection.title')}
          </button>
          </div>, overlayContainer ?? document.body,
        )}
      </span>
    </div>
  );
}
