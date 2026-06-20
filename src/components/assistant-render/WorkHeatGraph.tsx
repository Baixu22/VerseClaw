import { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { buildHeatGraphDays } from './model';

function toneFor(count: number, max: number): string {
  if (count <= 0) return 'bg-black/5 dark:bg-white/10';
  const ratio = max > 0 ? count / max : 0;
  if (ratio > 0.75) return 'bg-green-600';
  if (ratio > 0.45) return 'bg-green-500/80';
  if (ratio > 0.2) return 'bg-green-500/50';
  return 'bg-green-500/25';
}

export function WorkHeatGraph() {
  const { t } = useTranslation('settings');
  const [entries, setEntries] = useState<Array<{ timestamp: string; totalTokens?: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    void hostApi.usage.recentTokenHistory(500)
      .then((result) => {
        if (!cancelled && Array.isArray(result)) {
          setEntries(result.map((entry) => ({ timestamp: entry.timestamp, totalTokens: entry.totalTokens })));
        }
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => buildHeatGraphDays(entries, 35), [entries]);
  const max = Math.max(1, ...days.map((day) => day.count));
  const totalRuns = days.reduce((sum, day) => sum + day.count, 0);
  const totalTokens = days.reduce((sum, day) => sum + day.tokens, 0);

  return (
    <section
      className="rounded-lg border border-border bg-black/[0.025] p-4 dark:bg-white/[0.035]"
      data-testid="settings-work-heatgraph"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-foreground/70" />
            <h2 className="font-serif text-lg font-normal tracking-tight text-foreground">
              {t('workHeatGraph.title')}
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('workHeatGraph.description')}</p>
        </div>
        <div className="flex gap-2 text-xs text-muted-foreground">
          <span className="rounded-md bg-black/5 px-2 py-1 dark:bg-white/10">
            {t('workHeatGraph.runs', { count: totalRuns })}
          </span>
          <span className="rounded-md bg-black/5 px-2 py-1 dark:bg-white/10">
            {t('workHeatGraph.tokens', { count: totalTokens.toLocaleString() })}
          </span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1" aria-label={t('workHeatGraph.title')}>
        {days.map((day) => (
          <div
            key={day.date}
            className={cn('aspect-square rounded-[3px]', toneFor(day.count, max))}
            title={t('workHeatGraph.dayTitle', { date: day.date, count: day.count, tokens: day.tokens.toLocaleString() })}
            data-testid="settings-work-heatgraph-day"
          />
        ))}
      </div>
    </section>
  );
}
