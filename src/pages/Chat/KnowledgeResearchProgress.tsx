import { useTranslation } from 'react-i18next';
import type { ResearchResultV1 } from '@shared/knowledge/research';

export function KnowledgeResearchProgress({ result, onCancel }: { result: ResearchResultV1; onCancel: () => void }) {
  const { t } = useTranslation('knowledge');
  const reason = (value: string) => t(`research.gapReasons.${value}`, { defaultValue: value });
  return <div className="mx-2 mb-2 rounded-xl border border-border bg-surface-input p-3 text-xs" data-testid="chat-research-progress" data-phase={result.phase} role="status" aria-live="polite">
    <div className="flex items-center justify-between gap-2">
      <span className="font-medium" data-testid="chat-research-status">{t(`research.status.${result.status}`)}</span>
      {result.phase !== 'finished' && <button type="button" onClick={onCancel} className="rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/5" data-testid="chat-research-cancel">{t('research.cancel')}</button>}
    </div>
    <p className="mt-1 text-muted-foreground" data-testid="chat-research-counts">{t('research.progress', {
      round: result.usage.rounds, maxRounds: result.plan.budget.maxRounds,
      queries: result.usage.queries, maxQueries: result.plan.budget.maxQueries,
    })}</p>
    {result.stopReason && <p className="mt-1 text-muted-foreground">{t(`research.stop.${result.stopReason}`)}</p>}
    {result.conflicts.length > 0 && <div className="mt-2 text-amber-700 dark:text-amber-400" data-testid="chat-research-conflicts">
      <span className="font-medium">{t('research.conflicts')}</span>
      {result.conflicts.map((conflict, index) => <p key={index} className="mt-1">{conflict.description}</p>)}
    </div>}
    {result.inferences.length > 0 && <div className="mt-2" data-testid="chat-research-inferences">
      <span className="font-medium">{t('research.inferences')}</span>
      {result.inferences.map((inference, index) => <p key={index} className="mt-1 text-muted-foreground">{inference}</p>)}
    </div>}
    {result.gaps.length > 0 && <details className="mt-2" data-testid="chat-research-gaps" open={result.phase === 'finished'}>
      <summary className="cursor-pointer font-medium">{t('research.gaps', { count: result.gaps.length })}</summary>
      {result.gaps.map((gap, index) => <p key={index} className="mt-1 text-muted-foreground">{gap.question}: {reason(gap.reason)}</p>)}
    </details>}
  </div>;
}
