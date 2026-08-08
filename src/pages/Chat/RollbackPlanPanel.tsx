import { RotateCcw, ShieldAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RollbackPlan } from './rollback-plan';

type RollbackPlanPanelProps = {
  plan: RollbackPlan;
  compact?: boolean;
  className?: string;
  onPrepareHandoff?: () => void | Promise<void>;
  onDrainQueue?: () => void | Promise<void>;
  onCompact?: () => void | Promise<void>;
  onOpenGit?: () => void | Promise<void>;
  onOpenTaskLedger?: () => void | Promise<void>;
  onInterruptTerminal?: () => void | Promise<void>;
  onCreateMemoryDraft?: () => void | Promise<void>;
  onDismiss?: () => void;
};

function riskClass(risk: 'safe' | 'review' | 'dangerous'): string {
  if (risk === 'safe') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (risk === 'dangerous') return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400';
  return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400';
}

export function RollbackPlanPanel({
  plan,
  compact = false,
  className,
  onPrepareHandoff,
  onDrainQueue,
  onCompact,
  onOpenGit,
  onOpenTaskLedger,
  onInterruptTerminal,
  onCreateMemoryDraft,
  onDismiss,
}: RollbackPlanPanelProps) {
  const { t } = useTranslation('chat');
  if (!plan.available) return null;

  const runCommand = (command: string | undefined) => {
    if (command === 'handoff') return onPrepareHandoff?.();
    if (command === 'queueDrain') return onDrainQueue?.();
    if (command === 'compact') return onCompact?.();
    if (command === 'openGit') return onOpenGit?.();
    if (command === 'openTaskLedger') return onOpenTaskLedger?.();
    if (command === 'interruptTerminal') return onInterruptTerminal?.();
    if (command === 'createMemoryDraft') return onCreateMemoryDraft?.();
    return undefined;
  };

  return (
    <section
      data-testid="chat-rollback-plan"
      className={cn(
        'rounded-lg border border-border/70 bg-background p-3 shadow-sm',
        compact && 'p-2.5',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <span className="rounded-md bg-black/5 p-1.5 text-muted-foreground dark:bg-white/10">
          <RotateCcw className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={cn('font-medium text-foreground', compact ? 'text-xs' : 'text-sm')}>
            {t('composer.rollbackPlan.title')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t(plan.summaryKey, plan.summaryValues)}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            data-testid="chat-rollback-dismiss"
            aria-label={t('composer.rollbackPlan.dismiss', 'Dismiss recovery assist')}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            onClick={onDismiss}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div
        data-testid="chat-rollback-risk-summary"
        className="mt-2 flex flex-wrap items-center gap-1.5"
      >
        {(['safe', 'review', 'dangerous'] as const).map((risk) => (
          <span
            key={risk}
            data-testid={`chat-rollback-risk-${risk}`}
            className={cn('rounded-full border px-1.5 py-0.5 text-[10px] leading-none', riskClass(risk))}
          >
            {t(`composer.rollbackPlan.riskCount.${risk}`, { count: plan.riskCounts[risk] })}
          </span>
        ))}
      </div>

      <div className={cn('mt-2 grid gap-1.5', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4')}>
        {plan.signals.map((signal) => (
          <div
            key={signal.kind}
            data-testid={`chat-rollback-signal-${signal.kind}`}
            className={cn(
              'rounded-md border px-2 py-1 text-xs',
              signal.active
                ? riskClass(signal.risk)
                : 'border-border/60 bg-black/[0.02] text-muted-foreground dark:bg-white/[0.03]',
            )}
          >
            <span className="font-medium">{t(signal.titleKey)}</span>
            <span className="ml-1 opacity-80">
              {t(signal.active ? 'composer.rollbackPlan.signalState.active' : 'composer.rollbackPlan.signalState.ready')}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2 space-y-2">
        {plan.actions.slice(0, compact ? 4 : 8).map((action) => (
          <article
            key={action.kind}
            data-testid={`chat-rollback-action-${action.kind}`}
            className="rounded-md border border-border/60 bg-black/[0.02] p-2 dark:bg-white/[0.03]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground">{t(action.titleKey, action.detailValues)}</span>
                  <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px] leading-none', riskClass(action.risk))}>
                    {t(`composer.rollbackPlan.risk.${action.risk}`)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t(action.detailKey, action.detailValues)}</p>
              </div>
              {action.command && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  data-testid={`chat-rollback-run-${action.command}`}
                  onClick={() => void runCommand(action.command)}
                >
                  {t('composer.rollbackPlan.open')}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
        <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
        <span>{t('composer.rollbackPlan.destructiveWarning')}</span>
      </div>
    </section>
  );
}
