import { ChevronRight } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { UserRunStatus } from '@/pages/Chat/execution-projection';
import { OrbStatus, type OrbStatusState } from '@/components/assistant-ui/orb-status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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

/** Run lifecycle → orb state (thinking-orbs shape) + semantic dot. */
const RUN_TO_ORB: Record<UserRunStatus, OrbStatusState> = {
  running: 'working',
  completed: 'success',
  error: 'error',
  aborted: 'stopped',
};

export type TurnSummaryCounts = {
  plan?: number;
  files?: number;
  diffs?: number;
  agents?: number;
  terminals?: number;
  approvals?: number;
};

/** Order is deliberate: the most consequential artifact leads. */
const BADGE_ORDER = ['approvals', 'plan', 'agents', 'diffs', 'files', 'terminals'] as const;

/**
 * Collapsed turns used to say only "Worked for 12s", so a plan, three
 * sub-agents and five changed files were indistinguishable from an empty run.
 * These counts are the collapsed header's contents label — enough to tell the
 * user whether opening it is worth it, without reproducing what is inside.
 */
function TurnSummaryBadges({ counts }: { counts: TurnSummaryCounts }) {
  const { t } = useTranslation('chat');
  const entries = BADGE_ORDER
    .map((key) => ({ key, value: counts[key] ?? 0 }))
    .filter((entry) => entry.value > 0);
  if (entries.length === 0) return null;

  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1" data-testid="chat-turn-summary-badges">
      {entries.map((entry) => (
        <span
          key={entry.key}
          data-testid={`chat-turn-summary-badge-${entry.key}`}
          className={cn(
            'inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4',
            entry.key === 'approvals'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-black/[0.05] text-muted-foreground dark:bg-white/[0.07]',
          )}
        >
          {t(`turnSummary.badge.${entry.key}`, { count: entry.value })}
        </span>
      ))}
    </span>
  );
}

export function TurnSummaryCard({
  status,
  startedAt,
  endedAt,
  now,
  expanded,
  summary,
  onExpandedChange,
  children,
}: {
  status: UserRunStatus;
  startedAt?: number;
  endedAt?: number;
  now: number;
  expanded: boolean;
  summary?: TurnSummaryCounts;
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
  const orbState = RUN_TO_ORB[status];

  return (
    <section
      className="group/run-activity min-w-0 text-sm text-muted-foreground"
      data-testid="chat-turn-summary-card"
      data-status={status}
    >
      <div className="flex min-w-0 items-start gap-2">
        {/* Leading orb — the run's visible status, full thinking-orbs shape.
            Hovering reveals the state label + duration. */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <span
              className="shrink-0"
              data-testid="chat-turn-summary-orb"
              data-status={status}
            >
              <OrbStatus state={orbState} size="md" dotSize="lg" label={label} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" align="start">
            {label}
          </TooltipContent>
        </Tooltip>

        <div className="min-w-0 flex-1">
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
            {/* Only while collapsed — once open the contents speak for
                themselves and the chips would just be a second index. */}
            {!expanded && summary && <TurnSummaryBadges counts={summary} />}
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
              className="flex min-w-0 flex-col gap-2 pb-1 pt-1"
              data-testid="chat-turn-summary-details"
            >
              {children}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
