import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ObservabilityTraceGraphResult } from '@shared/types/observability';
import { cn } from '@/lib/utils';
import { TraceNodeIcon } from './AgentTraceGraph';
import { formatTraceTime } from './trace-time';

const reasoningEvent = /^(?:(?:agent|assistant|model)[./_-])?(?:thinking|reasoning)(?:[./_ -]|$)/i;

export function TraceSteps({ result, onSelectNode }: {
  result: ObservabilityTraceGraphResult;
  onSelectNode: (id: string) => void;
}) {
  const { t } = useTranslation('observability');
  const [showEvents, setShowEvents] = useState(false);
  const { steps, spans, secondaryCount } = useMemo(() => {
    const spans = new Map(result.trace.spans.map(span => [span.id, span]));
    const steps = result.graph.nodes.filter(node => node.kind !== 'root').map(node => {
      const transcript = node.spanId?.startsWith('transcript:');
      const reasoning = reasoningEvent.test(node.subtitle ?? '') || reasoningEvent.test(node.label);
      const secondary = node.kind === 'event' && (!node.phase || node.phase === 'event') && !transcript && !reasoning
        && node.status === 'completed' && !node.error && !node.warningCount && !node.retryCount;
      return { node, secondary, reasoning };
    }).sort((a, b) => (a.node.startedAt ?? Infinity) - (b.node.startedAt ?? Infinity)
      || (a.node.sequence ?? Infinity) - (b.node.sequence ?? Infinity));
    return { steps, spans, secondaryCount: steps.filter(step => step.secondary).length };
  }, [result.graph.nodes, result.trace.spans]);
  const useAll = showEvents || secondaryCount === steps.length;
  return (
    <section aria-label={t('views.steps')} className="px-3 py-2 sm:px-5" data-testid="observability-steps">
      <ol className="divide-y divide-border/60">
        {steps.filter(step => useAll || !step.secondary).map(({ node, reasoning }) => {
          const span = node.spanId ? spans.get(node.spanId) : undefined;
          const isReceipt = node.spanId?.startsWith('transcript:tool-result:');
          const isPrompt = node.spanId?.startsWith('transcript:user:');
          const isReply = node.spanId?.startsWith('transcript:assistant-final:');
          const category = reasoning ? t('steps.reasoning') : isReceipt ? t('steps.toolResult') : isPrompt ? t('phases.input') : isReply ? t('phases.output')
            : node.phase ? t(`phases.${node.phase}`) : t(`nodeKinds.${node.kind}`);
          const reasoningSummary = reasoning && node.summary && !node.summary.startsWith('redacted-preview:') ? node.summary : undefined;
          const title = reasoningSummary || (isPrompt ? t('steps.prompt') : isReply ? t('steps.reply')
            : isReceipt ? node.label.replace(/^Tool Result:\s*/u, '')
            : node.kind === 'model' ? node.modelRef || node.label : node.kind === 'tool' ? span?.name || node.label : node.label);
          const summary = node.error || node.summary;
          return (
            <li key={node.id}>
              <button type="button" onClick={() => onSelectNode(node.id)}
                className="flex w-full min-w-0 items-start gap-2.5 rounded-md px-1 py-2.5 text-left hover:bg-black/5 focus-visible:outline-ring dark:hover:bg-white/10">
                <TraceNodeIcon kind={node.kind} className={cn('mt-1 size-4 shrink-0 text-muted-foreground', node.status === 'error' && 'text-red-700 dark:text-red-400')} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs text-muted-foreground">{category}</span>
                    <span className="line-clamp-2 break-words text-sm font-medium [overflow-wrap:anywhere]">{title}</span>
                  </span>
                  {summary && summary !== title && !summary.startsWith('redacted-preview:') &&
                    <span className={cn('mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground', node.status === 'error' && 'text-red-700 dark:text-red-400')}>{summary}</span>}
                </span>
                <span className="shrink-0 text-right text-xs">
                  <span className={cn(node.status === 'error' ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground')}>{t(`status.${node.status}`)}</span>
                  {node.startedAt != null && <time className="mt-0.5 block tabular-nums text-muted-foreground">{formatTraceTime(node.startedAt)}</time>}
                </span>
                <ChevronRight aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          );
        })}
      </ol>
      {steps.length === 0 && <p className="py-5 text-sm text-muted-foreground">{t('steps.empty')}</p>}
      {secondaryCount > 0 && secondaryCount < steps.length &&
        <button type="button" onClick={() => setShowEvents(!showEvents)} aria-expanded={showEvents}
          className="my-2 rounded py-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
          {t(showEvents ? 'steps.hideEvents' : 'steps.showEvents', { count: secondaryCount })}
        </button>}
    </section>
  );
}
