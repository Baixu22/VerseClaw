import type { ObservabilitySpan, ObservabilityTrace } from '@shared/types/observability';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { spanKindTone, roleTone, toneClasses } from '@/lib/role-visuals';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Computes the nesting depth of a span by walking its parentSpanId chain.
 * Depth 0 = top-level span; each level of parentship adds 1.
 */
function spanDepth(spans: ObservabilitySpan[], span: ObservabilitySpan): number {
  const byId = new Map(spans.map((s) => [s.id, s]));
  let depth = 0;
  let current = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;
  const guard = new Set<string>();
  while (current && current.id !== span.id && !guard.has(current.id)) {
    guard.add(current.id);
    depth += 1;
    current = current.parentSpanId ? byId.get(current.parentSpanId) : undefined;
  }
  return depth;
}

/**
 * Renders a trace's spans as a horizontal waterfall: each bar is positioned by
 * its offset from the trace start and sized by its duration, so the critical
 * path and overlaps are visible at a glance. Spans are colored by kind and
 * indented by parentSpanId depth so orchestration → subagent → tool nesting
 * is visually clear.
 */
export function TraceWaterfall({ trace }: { trace: ObservabilityTrace }) {
  const { t } = useTranslation('observability');
  // Track a ticking "now" for running traces (no endedAt). Date.now() must not
  // be called during render per react-hooks/purity, so seed via state + effect.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (trace.endedAt) return; // only tick while running
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [trace.endedAt]);

  const { start, end, total } = useMemo(() => {
    const s = trace.startedAt;
    const spanEnds = trace.spans.map((span) => span.endedAt ?? span.startedAt);
    const e = trace.endedAt ?? Math.max(s, ...spanEnds, nowTick);
    return { start: s, end: e, total: Math.max(1, e - s) };
  }, [trace.startedAt, trace.endedAt, trace.spans, nowTick]);

  const spans = useMemo(() => [...trace.spans].sort((a, b) => a.startedAt - b.startedAt), [trace.spans]);

  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-3">
      {/* Header: name + status + duration + span count + tokens */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{trace.name}</span>
          {trace.mode && (
            <Badge variant="secondary" className="rounded-full text-2xs">{trace.mode}</Badge>
          )}
          <Badge variant="outline" className="rounded-full text-2xs">{trace.status}</Badge>
          <span className="font-mono">{formatDuration(trace.durationMs ?? total)}</span>
          <span>·</span>
          <span>{trace.spans.length} {t('spanUnit', 'span(s)')}</span>
          {trace.tokenUsage.totalTokens > 0 && (
            <>
              <span>·</span>
              <span className="font-mono">{trace.tokenUsage.totalTokens.toLocaleString()} tok</span>
            </>
          )}
        </div>
        {trace.task && (
          <p className="text-xs text-muted-foreground line-clamp-1">{trace.task}</p>
        )}
      </div>

      {spans.length === 0 ? (
        <p className="text-2xs text-muted-foreground italic">{t('noSpans', 'No spans recorded for this trace.')}</p>
      ) : (
        <div className="space-y-1">
          {spans.map((span) => {
            const offset = Math.min(100, Math.max(0, ((span.startedAt - start) / total) * 100));
            const rawDuration = span.durationMs ?? (span.endedAt ?? end) - span.startedAt;
            const width = Math.min(100 - offset, Math.max(1.5, (rawDuration / total) * 100));
            const depth = spanDepth(spans, span);
            const kindTone = spanKindTone(span.kind);
            const kindClasses = toneClasses(kindTone);
            // If the span carries a roleName, blend it into the bar color too.
            const roleClasses = span.roleName ? toneClasses(roleTone(span.roleName)) : null;
            const tooltip = [
              `${span.name} · ${span.kind}${span.roleName ? ` · ${span.roleName}` : ''}`,
              span.input ? `in: ${span.input.slice(0, 200)}` : null,
              span.output ? `out: ${span.output.slice(0, 200)}` : null,
              span.error ? `error: ${span.error.slice(0, 200)}` : null,
            ]
              .filter(Boolean)
              .join('\n');
            return (
              <div
                key={span.id}
                className="flex items-center gap-3 text-2xs"
                style={{ paddingLeft: `${depth * 12}px` }}
                title={tooltip}
              >
                <div className="w-44 shrink-0 flex items-center gap-1.5 min-w-0">
                  {depth > 0 && <span className="text-muted-foreground/40 shrink-0">└</span>}
                  <span className="truncate text-foreground">{span.name}</span>
                  <Badge
                    variant="secondary"
                    className={cn('rounded-full text-2xs px-1.5 py-0 shrink-0 border', kindClasses.tint)}
                  >
                    {span.kind}
                  </Badge>
                  {span.roleName && (
                    <span className={cn('text-2xs shrink-0 truncate max-w-[80px]', roleClasses?.text)}>
                      {span.roleName}
                    </span>
                  )}
                </div>
                <div className="flex-1 relative h-4 rounded bg-black/[0.04] dark:bg-white/[0.04]">
                  <div
                    className={cn(
                      'absolute top-0 h-full rounded border',
                      roleClasses ? roleClasses.bar : kindClasses.bar,
                    )}
                    style={{ left: `${offset}%`, width: `${width}%` }}
                  />
                </div>
                <div className="w-14 shrink-0 text-right font-mono text-muted-foreground">
                  {formatDuration(rawDuration)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {trace.error && (
        <p className="text-2xs text-red-500 font-mono break-words">{trace.error}</p>
      )}
    </div>
  );
}
