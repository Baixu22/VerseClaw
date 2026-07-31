import { ChevronRight } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { UserRunStatus } from '@/pages/Chat/execution-projection';

function formatDuration(
  startedAt: number | undefined,
  endedAt: number | undefined,
  now: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (!startedAt) return null;
  const durationSeconds = Math.max(0, Math.round(((endedAt ?? now) - startedAt) / 1000));
  if (durationSeconds < 1) return null;
  if (durationSeconds < 60) {
    return t('turnSummary.duration.seconds', { count: durationSeconds });
  }
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return seconds > 0
    ? t('turnSummary.duration.minutesSeconds', { minutes, seconds })
    : t('turnSummary.duration.minutes', { count: minutes });
}

export function TurnSummaryCard({
  status,
  startedAt,
  endedAt,
  now,
  expanded,
  onExpandedChange,
  children,
}: {
  status: UserRunStatus;
  startedAt?: number;
  endedAt?: number;
  now: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('chat');
  const detailsId = useId();
  const duration = formatDuration(startedAt, endedAt, now, t);
  const label = status === 'running'
    ? duration
      ? t('turnSummary.workingFor', { duration })
      : t('turnSummary.working')
    : status === 'aborted'
      ? duration
        ? t('turnSummary.stoppedAfter', { duration })
        : t('turnSummary.stopped')
      : status === 'error'
        ? t('turnSummary.needsAttention')
        : duration
          ? t('turnSummary.workedFor', { duration })
          : t('turnSummary.workDetails');

  return (
    <section
      className="group/run-activity min-w-0 text-sm text-muted-foreground"
      data-testid="chat-turn-summary-card"
      data-status={status}
    >
      <button
        type="button"
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-sm py-1 text-left',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2',
          'hover:text-foreground',
          status === 'error' && 'text-destructive hover:text-destructive',
        )}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => onExpandedChange(!expanded)}
        data-testid="chat-turn-summary-toggle"
      >
        <span className="shrink-0 whitespace-nowrap">{label}</span>
        <span className="h-px min-w-4 flex-1 bg-border/70" aria-hidden="true" />
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 opacity-0 transition-[transform,opacity,color] duration-150',
            'group-hover/run-activity:opacity-100 group-focus-within/run-activity:opacity-100',
            expanded && 'rotate-90 opacity-100',
          )}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div
          id={detailsId}
          className="flex min-w-0 flex-col gap-2 pb-1 pl-6 pt-1"
          data-testid="chat-turn-summary-details"
        >
          {children}
        </div>
      )}
    </section>
  );
}
