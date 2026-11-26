import { Collapsible } from '@/components/ui/collapsible';
import { useId, type ReactNode } from 'react';
import { useTickingNow } from '@/hooks/use-ticking-now';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { assistantPhaseLabels, type AssistantOutputPhase, type UserRunStatus } from '@/pages/Chat/execution-projection';
import { OrbStatus } from '@/components/assistant-ui/orb-status';
import { ThinkingReasoning } from './ThinkingReasoning';
import type { AssistantReasoning } from './model';

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

export type TurnSummaryCounts = {
  tools?: number;
  thoughts?: number;
  plan?: number;
  files?: number;
  diffs?: number;
  agents?: number;
  terminals?: number;
  approvals?: number;
};

/** Order is deliberate: the most consequential artifact leads. */
const BADGE_ORDER = ['approvals', 'diffs', 'files', 'agents', 'tools', 'terminals', 'plan'] as const;

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
    .filter((entry) => entry.value > 0)
    .slice(0, 2);
  if (entries.length === 0) return null;

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="chat-turn-summary-badges">
      {entries.map((entry) => (
        <span
          key={entry.key}
          data-testid={`chat-turn-summary-badge-${entry.key}`}
          className={cn(
            'inline-flex items-center whitespace-nowrap text-xs font-normal leading-5',
            entry.key === 'approvals'
              ? 'rounded px-1.5 bg-destructive/10 text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {t(`turnSummary.badge.${entry.key}`, { count: entry.value })}
        </span>
      ))}
    </span>
  );
}

/** The final answer and actionable approvals are siblings of this disclosure. */
export function TurnSummaryCard({
  status,
  startedAt,
  endedAt,
  now,
  expanded,
  summary,
  activity,
  reasoning,
  reasoningStreaming = false,
  waitingForInput = false,
  showStatusIndicator = true,
  phase,
  onExpandedChange,
  children,
}: {
  status: UserRunStatus;
  startedAt?: number;
  endedAt?: number;
  /** Optional externally-supplied clock. When omitted the card ticks its own 1 Hz clock while the turn is still running (endedAt unset). */
  now?: number;
  expanded: boolean;
  summary?: TurnSummaryCounts;
  /** Only the current tool stays visible while the full process is folded. */
  activity?: ReactNode;
  /** Reasoning adopted from the turn's reply message (or the live run). */
  reasoning?: AssistantReasoning[];
  /** True while thinking is still arriving — keeps the stream open + shimmering. */
  reasoningStreaming?: boolean;
  waitingForInput?: boolean;
  showStatusIndicator?: boolean;
  phase?: AssistantOutputPhase;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('chat');
  const detailsId = useId();
  // Tick locally while the turn is live so the elapsed-time label advances
  // without forcing the whole Chat page to re-render every second.
  const tickingNow = useTickingNow(status === 'running' && !waitingForInput);
  const effectiveNow = now ?? tickingNow;
  const duration = formatDuration(startedAt, endedAt, effectiveNow, t);
  const label = waitingForInput ? t('composerRequests.title') : status === 'running'
    ? phase && phase !== 'working' ? t(assistantPhaseLabels[phase]) : duration
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
      className="group/run-activity min-w-0 border-b border-border/50 pb-2 text-sm text-muted-foreground"
      data-testid="chat-turn-summary-card"
      data-status={status}
      data-phase={status === 'running' ? (waitingForInput ? 'waiting' : phase) : undefined}
    >
      <Collapsible
        variant="plain"
        open={expanded}
        onOpenChange={onExpandedChange}
        buttonTestId="chat-turn-summary-toggle"
        contentId={detailsId}
        contentTestId="chat-turn-summary-details"
        contentClassName="flex min-w-0 flex-col gap-1.5"
        title={
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 font-normal text-[var(--color-transcript-activity)]">
            {showStatusIndicator && status === 'running' && !activity && !expanded && (
              <span data-testid="chat-turn-summary-orb"><OrbStatus state={waitingForInput ? 'waiting' : phase === 'tools' ? 'working' : phase ?? 'working'} size={20} label={label} /></span>
            )}
            <span className={cn(status === 'error' && 'text-destructive')}>{label}</span>
            {status === 'running' && !waitingForInput && phase && phase !== 'working' && duration && <span className="text-xs tabular-nums">{duration}</span>}
            {!expanded && summary && <TurnSummaryBadges counts={summary} />}
          </span>
        }
      >
        {reasoning && reasoning.length > 0 && <ThinkingReasoning items={reasoning} streaming={reasoningStreaming} />}
        {children}
      </Collapsible>
      {!expanded && activity && (
        <div className="mt-0.5 min-w-0 pl-1" data-testid="chat-turn-current-activity">{activity}</div>
      )}
    </section>
  );
}
