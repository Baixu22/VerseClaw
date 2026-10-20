import { Check, CircleStop, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ScheduledRowFrame } from '@/components/loading/DataListFrames';
import { cn } from '@/lib/utils';
import type { BrowserScheduledAction, BrowserScheduledItem } from '@/stores/scheduled';
import { CronBrowserTaskIcon, CronCloseIcon } from './cron-icons';

const statusStyles: Record<BrowserScheduledItem['task']['status'], string> = {
  queued: 'text-zinc-700 dark:text-zinc-300',
  running: 'text-blue-700 dark:text-blue-400',
  'waiting-approval': 'text-amber-700 dark:text-amber-400',
  interrupted: 'text-amber-700 dark:text-amber-400',
  paused: 'text-amber-700 dark:text-amber-400',
  completed: 'text-emerald-700 dark:text-emerald-400',
  failed: 'text-red-700 dark:text-red-400',
  cancelled: 'text-muted-foreground',
};

export function BrowserTaskRow({
  item,
  selected,
  onSelect,
}: {
  item: BrowserScheduledItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation(['cron', 'browser']);
  const task = item.task;
  return (
    <ScheduledRowFrame
      role="button"
      tabIndex={0}
      data-testid={`browser-task-card-${task.id}`}
      className={cn(
        selected ? 'bg-black/5 dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5',
      )}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      icon={(
      <span className={statusStyles[task.status]}>
        <CronBrowserTaskIcon />
      </span>
      )}
      title={(
        <>
          <span className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">{task.name}</span>
          <span className={cn('shrink-0 text-meta leading-5', statusStyles[task.status])}>
            {t(`browser:status.${task.status}`)}
          </span>
        </>
      )}
      detail={task.objective}
      meta={<span className="font-mono">{task.url}</span>}
      actions={(
      <span className="shrink-0 text-xs text-muted-foreground">
        {t('cron:scheduled.browserSource')}
      </span>
      )}
    />
  );
}

function DetailRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="grid min-h-11 grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] items-center gap-4 border-b border-border/70 px-4 py-2 text-sm last:border-b-0"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-foreground">{value}</span>
    </div>
  );
}

export function BrowserTaskDetailsPanel({
  item,
  busy,
  onClose,
  onAction,
}: {
  item: BrowserScheduledItem;
  busy: boolean;
  onClose: () => void;
  onAction: (action: BrowserScheduledAction) => void;
}) {
  const { t } = useTranslation(['cron', 'browser']);
  const task = item.task;
  const successCriterion = task.successCriteria
    ? `${t(`browser:criteria.${task.successCriteria.kind}`)}: ${task.successCriteria.value}`
    : task.successCondition || t('cron:workbench.notSet');
  const actions = new Set(item.actions);

  return (
    <aside
      data-testid="browser-task-detail-panel"
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-none flex-col border-l border-border bg-background shadow-2xl lg:static lg:z-auto lg:w-[min(42vw,36rem)] lg:min-w-[22rem] lg:max-w-xl lg:shadow-none"
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
        <span className={cn('text-xs font-medium', statusStyles[task.status])}>
          {t(`browser:status.${task.status}`)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-md"
          onClick={onClose}
          aria-label={t('cron:workbench.closeDetails')}
          title={t('cron:workbench.closeDetails')}
          data-testid="scheduled-detail-back"
        >
          <CronCloseIcon />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <h2 className="break-words text-xl font-medium leading-7 text-foreground">{task.name}</h2>
        <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{task.objective}</p>

        <section className="mt-6 overflow-hidden rounded-lg border border-border bg-surface-modal">
          <DetailRow label={t('browser:approval.target')} value={task.url} testId="browser-detail-target" />
          <DetailRow label={t('browser:approval.domains')} value={task.allowedDomains.join(', ') || t('cron:workbench.notSet')} testId="browser-detail-domains" />
          <DetailRow label={t('browser:tasks.profile')} value={task.profile} testId="browser-detail-profile" />
          <DetailRow label={t('browser:approval.mode')} value={t(`browser:modes.${task.mode}`)} testId="browser-detail-mode" />
          <DetailRow label={t('browser:approval.scope')} value={task.permissionScope.map((scope) => t(`browser:permissionScope.${scope}`)).join(', ')} testId="browser-detail-scope" />
          <DetailRow label={t('browser:approval.success')} value={successCriterion} testId="browser-detail-success" />
          <DetailRow label={t('cron:scheduled.updatedAt')} value={new Date(task.updatedAt).toLocaleString()} />
        </section>

        <section className="mt-6">
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">{t('browser:tasks.steps')}</h3>
          <ol className="divide-y divide-border/70 border-y border-border" data-testid="browser-detail-steps">
            {task.steps.map((step, index) => (
              <li key={step.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-2 py-2.5 text-sm">
                <span className="text-xs text-muted-foreground">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block text-foreground">{t(`browser:stepActions.${step.action}`)}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{step.url ?? step.selector}</span>
                  {step.error ? <span className="mt-1 block text-xs text-red-700 dark:text-red-400">{step.error}</span> : null}
                </span>
                <span className={cn(
                  'text-xs',
                  step.status === 'passed'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : step.status === 'failed'
                      ? 'text-red-700 dark:text-red-400'
                      : step.status === 'running'
                        ? 'text-blue-700 dark:text-blue-400'
                        : 'text-muted-foreground',
                )}>
                  {t(`browser:stepStatus.${step.status}`)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {task.verification ? (
          <section className="mt-6 border-l-2 border-border pl-3" data-testid="browser-detail-verification">
            <h3 className="text-sm font-medium text-foreground">{t(`browser:verification.${task.verification.status}`)}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{task.verification.reasonCode}</p>
            <p className="mt-1 break-words text-sm text-muted-foreground">{task.verification.message}</p>
          </section>
        ) : null}

        {task.statusExplain || task.error ? (
          <p className="mt-6 break-words text-sm text-red-700 dark:text-red-400" data-testid="browser-detail-error">
            {task.statusExplain || task.error} {task.errorCode ? `[${task.errorCode}]` : ''}
          </p>
        ) : null}
      </div>

      {item.actions.length > 0 ? (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
          {actions.has('reject') ? (
            <Button variant="ghost" disabled={busy} onClick={() => onAction('reject')}>
              <X className="mr-2 h-4 w-4" />{t('browser:actions.reject')}
            </Button>
          ) : null}
          {actions.has('cancel') ? (
            <Button variant="ghost" disabled={busy} onClick={() => onAction('cancel')}>
              <CircleStop className="mr-2 h-4 w-4" />{t('browser:actions.cancel')}
            </Button>
          ) : null}
          {actions.has('retry') ? (
            <Button disabled={busy} onClick={() => onAction('retry')}>
              <RefreshCw className="mr-2 h-4 w-4" />{t('browser:actions.retry')}
            </Button>
          ) : null}
          {actions.has('approve-and-run') ? (
            <Button disabled={busy} onClick={() => onAction('approve-and-run')} data-testid="browser-detail-approve">
              <Check className="mr-2 h-4 w-4" />{t('browser:actions.approve')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
