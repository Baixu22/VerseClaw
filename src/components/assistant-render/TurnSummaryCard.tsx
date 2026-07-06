import { CheckCircle2, ChevronDown, FileText, Globe, ListChecks, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { TurnSummaryHighlight, TurnSummaryModel } from './turn-summary-model';

function HighlightIcon({ kind }: { kind: TurnSummaryHighlight['kind'] }) {
  if (kind === 'report') return <FileText className="h-3.5 w-3.5" />;
  if (kind === 'source') return <Globe className="h-3.5 w-3.5" />;
  return <ListChecks className="h-3.5 w-3.5" />;
}

function CountPill({ label, value }: { label: string; value: number }) {
  if (value <= 0) return null;
  return (
    <span className="inline-flex h-6 items-center rounded-md border border-border/70 bg-surface-input px-2 text-2xs font-medium text-muted-foreground">
      {label}
    </span>
  );
}

export function TurnSummaryCard({
  model,
  expanded,
  onExpandedChange,
  children,
}: {
  model: TurnSummaryModel;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('chat');
  const statusTone = model.status === 'error'
    ? 'text-red-700 dark:text-red-400'
    : 'text-green-700 dark:text-green-400';
  const title = model.title || t('turnSummary.titleFallback');

  return (
    <section
      className="rounded-md border border-border/70 bg-background/60 text-xs shadow-sm"
      data-testid="chat-turn-summary-card"
    >
      <button
        type="button"
        className="flex w-full min-w-0 items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10"
        aria-expanded={expanded}
        aria-label={t('turnSummary.toggle')}
        onClick={() => onExpandedChange(!expanded)}
        data-testid="chat-turn-summary-toggle"
      >
        <span className={cn('mt-0.5 shrink-0', statusTone)}>
          {model.status === 'error'
            ? <TriangleAlert className="h-4 w-4" />
            : <CheckCircle2 className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-foreground">{title}</span>
          <span className={cn('mt-0.5 block text-2xs font-medium', statusTone)}>
            {t(`turnSummary.status.${model.status}`)}
          </span>
          <span className="mt-2 flex flex-wrap gap-1.5">
            <CountPill label={t('turnSummary.counts.tasks', { count: model.counts.tasks })} value={model.counts.tasks} />
            <CountPill label={t('turnSummary.counts.reports', { count: model.counts.reports })} value={model.counts.reports} />
            <CountPill label={t('turnSummary.counts.sources', { count: model.counts.sources })} value={model.counts.sources} />
            <CountPill label={t('turnSummary.counts.orchestrations', { count: model.counts.orchestrations })} value={model.counts.orchestrations} />
          </span>
        </span>
        <ChevronDown className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
      </button>

      {model.highlights.length > 0 && !expanded && (
        <div className="border-t border-border/70 px-3 py-2" data-testid="chat-turn-summary-highlights">
          <div className="flex flex-wrap gap-1.5">
            {model.highlights.map((highlight, index) => (
              <span
                key={`${highlight.kind}:${highlight.label}:${index}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-input px-2 py-1 text-2xs text-muted-foreground"
                title={highlight.detail || highlight.label}
              >
                <HighlightIcon kind={highlight.kind} />
                <span className="truncate">{highlight.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {expanded && (
        <div className="space-y-3 border-t border-border/70 px-3 py-3" data-testid="chat-turn-summary-details">
          {children}
        </div>
      )}
    </section>
  );
}
