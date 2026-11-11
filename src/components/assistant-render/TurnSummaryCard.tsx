import { ChevronRight } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTickingNow } from '@/hooks/use-ticking-now';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { UserRunStatus } from '@/pages/Chat/execution-projection';
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

/**
 * The turn's process disclosure — the single owner of everything the agent did
 * on the way to its answer.
 *
 * It used to own only the tool-side work (execution graph, terminals, diffs,
 * plan, approvals) while the reasoning stream rendered separately, at the top of
 * the assistant message. That put thinking, tool work and the final answer at
 * one flat level: on a reasoning model the first two dwarf the third, and
 * scrolling back to the prompt meant scrolling past all of it. `reasoning` moved
 * in here so a turn reads as prompt → one folded line → answer.
 *
 * The final answer deliberately stays OUTSIDE: this component never wraps the
 * reply text, so collapsing can never hide the thing the user asked for.
 */
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
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('chat');
  const detailsId = useId();
  // Tick locally while the turn is live so the elapsed-time label advances
  // without forcing the whole Chat page to re-render every second.
  const tickingNow = useTickingNow(status === 'running');
  const effectiveNow = now ?? tickingNow;
  const duration = formatDuration(startedAt, endedAt, effectiveNow, t);
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
      className="group/run-activity min-w-0 border-b border-border/50 pb-2 text-sm text-muted-foreground"
      data-testid="chat-turn-summary-card"
      data-status={status}
    >
      <div className="flex min-w-0 items-start">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className={cn(
              'flex w-full min-w-0 items-start gap-2 rounded-md py-1.5 text-left text-[13px] leading-5',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2',
              'transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
              status === 'error' && 'text-destructive hover:text-destructive',
            )}
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => onExpandedChange(!expanded)}
            data-testid="chat-turn-summary-toggle"
          >
            <ChevronRight
              className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60 transition-[transform,opacity] duration-150 motion-reduce:transition-none',
                'group-hover/run-activity:opacity-100 group-focus-within/run-activity:opacity-100',
                expanded && 'rotate-90 opacity-100',
              )}
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              {status === 'running' && !activity && !expanded ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="shrink-0" data-testid="chat-turn-summary-orb">
                    <OrbStatus state="working" size={20} label={label} />
                  </span>
                  <span>{label}</span>
                </span>
              ) : (
                <span>{label}</span>
              )}
              {!expanded && summary && <TurnSummaryBadges counts={summary} />}
            </span>
          </button>

          {!expanded && activity && (
            <div className="mt-1 min-w-0 pl-5" data-testid="chat-turn-current-activity">
              {activity}
            </div>
          )}

          {expanded && (
            <div
              id={detailsId}
              className="ml-3 flex min-w-0 flex-col gap-3 border-l border-border/70 py-2 pl-3"
              data-testid="chat-turn-summary-details"
            >
              {/* Reasoning leads: it is what the agent did BEFORE reaching for a
                  tool, so the disclosure reads in the order the work happened. */}
              {reasoning && reasoning.length > 0 && (
                <ThinkingReasoning
                  items={reasoning}
                  streaming={reasoningStreaming}
                  defaultOpen
                />
              )}
              {children}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
