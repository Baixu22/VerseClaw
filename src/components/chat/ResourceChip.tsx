/**
 * ResourceChip shows running resource count in the chat toolbar.
 * Click opens a popover with the full resource list and stop controls.
 */
import { useEffect, useState } from 'react';
import { Loader2, Server, StopCircle, Trash2, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useResourceStore } from '@/stores/resource-tracker';
import { useTranslation } from 'react-i18next';
import type { TrackedResource } from '@shared/types/resource-tracker';

export function ResourceChip() {
  const { t } = useTranslation('common');
  const {
    resources,
    idleCount,
    unreachableCount,
    idleTimeoutMinutes,
    isInitialized,
    init,
    stopResource,
    stopAll,
  } = useResourceStore();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [stoppingAll, setStoppingAll] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const totalCount = resources.length;
  const hasWarnings = idleCount > 0 || unreachableCount > 0;
  const warningCount = idleCount + unreachableCount;

  if (!isInitialized) return null;
  if (totalCount === 0 && !popoverOpen) return null;

  const handleStop = async (resourceId: string) => {
    setStoppingId(resourceId);
    await stopResource(resourceId);
    setStoppingId(null);
  };

  const handleStopAll = async () => {
    setStoppingAll(true);
    await stopAll();
    setStoppingAll(false);
    setPopoverOpen(false);
  };

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-testid="resource-chip"
            type="button"
            onClick={() => setPopoverOpen((prev) => !prev)}
            aria-label={t('resourceTracker.chip.ariaLabel', { count: totalCount })}
            aria-haspopup="menu"
            aria-expanded={popoverOpen}
            className={cn(
              'inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg px-2 text-2xs font-medium text-muted-foreground transition-colors',
              'hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:hover:bg-white/10',
              popoverOpen && 'bg-black/5 text-foreground dark:bg-white/10',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                totalCount === 0
                  ? 'bg-muted-foreground/40'
                  : hasWarnings
                    ? 'bg-amber-500'
                    : 'bg-emerald-500',
              )}
              aria-hidden="true"
            />
            <Server className="h-4 w-4" />
            <span className="min-w-3 text-center tabular-nums">{totalCount}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('resourceTracker.chip.tooltip', { count: totalCount })}</p>
        </TooltipContent>
      </Tooltip>

      {popoverOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setPopoverOpen(false)}
          />
          <div
            data-testid="resource-popover"
            className={cn(
              'absolute right-0 top-full z-50 mt-2 flex max-h-[min(70vh,30rem)] w-72 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg border border-black/10 bg-surface-modal p-1 shadow-xl dark:border-white/10',
            )}
          >
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <div className="flex min-w-0 items-center gap-2">
                <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <h3 className="truncate text-xs font-medium text-foreground">
                  {t('resourceTracker.popover.title')}
                </h3>
                {warningCount > 0 && (
                  <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-400">
                    {t('resourceTracker.chip.warningCount', { count: warningCount })}
                  </span>
                )}
              </div>
              <button
                type="button"
                data-testid="resource-popover-close"
                onClick={() => setPopoverOpen(false)}
                aria-label={t('resourceTracker.popover.close')}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
              {resources.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {t('resourceTracker.popover.empty')}
                </p>
              ) : (
                <div className="space-y-1">
                  {resources.map((resource) => (
                    <ResourceRow
                      key={resource.id}
                      resource={resource}
                      nowMs={nowMs}
                      stopping={stoppingId === resource.id}
                      onStop={() => handleStop(resource.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-black/5 px-2 py-1 dark:border-white/10">
              <p className="min-w-0 truncate text-[10px] text-muted-foreground">
                {t('resourceTracker.popover.autoCleanup', { minutes: idleTimeoutMinutes })}
              </p>
              {resources.length > 1 && (
                <button
                  type="button"
                  data-testid="resource-popover-stop-all"
                  onClick={handleStopAll}
                  disabled={stoppingAll}
                  className={cn(
                    'flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-2xs font-medium text-red-600 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 dark:text-red-400',
                    stoppingAll && 'opacity-60',
                  )}
                >
                  {stoppingAll ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <StopCircle className="h-3.5 w-3.5" />
                  )}
                  {t('resourceTracker.popover.stopAll')}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ResourceRow({
  resource,
  nowMs,
  stopping,
  onStop,
}: {
  resource: TrackedResource;
  nowMs: number;
  stopping: boolean;
  onStop: () => void;
}) {
  const { t } = useTranslation('common');

  const statusLabel = resource.status === 'healthy'
    ? t('resourceTracker.status.healthy')
    : resource.status === 'idle'
      ? t('resourceTracker.status.idle')
      : t('resourceTracker.status.unreachable');
  const statusTone = resource.status === 'healthy'
    ? {
        dot: 'bg-emerald-500',
        text: 'text-emerald-700 dark:text-emerald-400',
      }
    : resource.status === 'idle'
      ? {
          dot: 'bg-amber-500',
          text: 'text-amber-700 dark:text-amber-400',
        }
      : {
          dot: 'bg-red-500',
          text: 'text-red-700 dark:text-red-400',
        };

  const elapsed = resource.startedAt && nowMs > 0
    ? Math.floor((nowMs - new Date(resource.startedAt).getTime()) / 60_000)
    : 0;

  const elapsedLabel = elapsed < 1
    ? t('resourceTracker.timeAgo.justNow')
    : elapsed < 60
      ? t('resourceTracker.timeAgo.m', { count: elapsed })
      : t('resourceTracker.timeAgo.h', { count: Math.floor(elapsed / 60) });

  const fallbackLabel = `localhost:${resource.port}`;
  const label = resource.label || fallbackLabel;

  return (
    <div
      data-testid={`resource-row-${resource.id}`}
      className="group flex items-start gap-2 rounded-md px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
    >
      <span
        className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', statusTone.dot)}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium leading-tight text-foreground">
            {label}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            :{resource.port}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-tight text-muted-foreground">
          <span>{t('resourceTracker.pid', { pid: resource.pid })}</span>
          <span aria-hidden="true">/</span>
          <span className={cn('font-medium', statusTone.text)}>{statusLabel}</span>
          <span aria-hidden="true">/</span>
          <span>{elapsedLabel}</span>
        </div>
        {resource.sessionLabel && (
          <div className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground/70">
            {t('resourceTracker.fromSession', { session: resource.sessionLabel })}
          </div>
        )}
      </div>
      <button
        type="button"
        data-testid={`resource-row-stop-${resource.id}`}
        onClick={(event) => {
          event.stopPropagation();
          onStop();
        }}
        disabled={stopping}
        aria-label={t('resourceTracker.stopResource', { label })}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-colors group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
          'hover:bg-red-500/10 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30',
          stopping && 'opacity-60',
        )}
        title={t('resourceTracker.stop')}
      >
        {stopping ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
