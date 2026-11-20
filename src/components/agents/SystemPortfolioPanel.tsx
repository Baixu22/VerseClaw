import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSystemPortfolioStore } from '@/stores/system-portfolio';

export function SystemPortfolioPanel() {
  const { t, i18n } = useTranslation('agents');
  const [search, setSearch] = useSearchParams();
  const filter = search.get('q') ?? '';
  const { entries, loading, unavailable, refresh } = useSystemPortfolioStore();
  useEffect(() => { void refresh(); }, [refresh]);
  const projects = Object.values(entries).filter(entry => entry.profile.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <section className="h-full overflow-y-auto p-4 sm:p-6" data-testid="system-portfolio" data-scope="system">
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-normal tracking-tight">{t('portfolio.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('portfolio.readOnly')}</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} data-testid="portfolio-refresh">
          <RefreshCw className="mr-2 h-4 w-4" />{t('portfolio.refresh')}
        </Button>
      </header>
      <label className="block text-sm">
        {t('portfolio.filter')}
        <Input className="mt-1" value={filter} data-testid="portfolio-filter" onChange={event => {
          const next = new URLSearchParams(search);
          if (event.target.value) next.set('q', event.target.value); else next.delete('q');
          setSearch(next, { replace: true });
        }} />
      </label>
      {loading && <p role="status">{t('portfolio.loading')}</p>}
      {unavailable && <p role="status" className="text-amber-700 dark:text-amber-400">{t('portfolio.listUnavailable')}</p>}
      {!loading && !unavailable && projects.length === 0 && <p role="status">{t('portfolio.empty')}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {projects.map(({ profile, snapshot, loading: reading, unavailable: failed }) => {
          const canOpen = !failed && snapshot && ['ready', 'paused'].includes(snapshot.coordinator.state);
          return <article key={profile.id} className="min-w-0 rounded-xl border border-border bg-surface-modal p-4"
            data-testid={`portfolio-project-${profile.id}`} data-state={reading ? 'loading' : failed ? 'unavailable' : 'observed'}>
            <h2 className="break-words font-serif text-xl font-normal tracking-tight">
              {canOpen ? <Link className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2"
                data-testid={`portfolio-open-${profile.id}`} to={`/projects/${encodeURIComponent(profile.id)}`}>{profile.name}</Link> : profile.name}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('portfolio.projectScope')}</p>
            {reading && <p role="status" className="mt-2 text-sm">{t('portfolio.loading')}</p>}
            {failed && <p role="status" className="mt-2 text-sm text-amber-700 dark:text-amber-400">{t(snapshot ? 'portfolio.stale' : 'portfolio.unavailable')}</p>}
            {snapshot && <div className="mt-3 space-y-3 text-sm">
              <p>{t('portfolio.coordinator')}: {t(`portfolio.coordinatorState.${snapshot.coordinator.state}`)}</p>
              <p className="text-xs text-muted-foreground">{t('portfolio.observedAt', { time: new Date(snapshot.observedAt).toLocaleString(i18n.language) })}</p>
              {snapshot.plan ? <>
                <p className="break-words font-medium" data-testid={`portfolio-goal-${profile.id}`}>{snapshot.plan.objective}</p>
                <p className="break-words">{t('portfolio.nextAction')}: {snapshot.plan.nextAction || t('portfolio.unknown')}</p>
                <Link className="underline underline-offset-4" to={`/task-ledger?workspaceId=${encodeURIComponent(profile.id)}&nodeId=${encodeURIComponent(snapshot.plan.taskNodeId)}`}>
                  {t('portfolio.tasks', { done: snapshot.plan.tasks.filter(task => task.state === 'done').length, total: snapshot.plan.tasks.length })}
                </Link>
                {snapshot.plan.pendingDecisions.length > 0 && <div>
                  <p>{t('portfolio.decisions')}</p>
                  <ul className="list-disc space-y-1 pl-5">{snapshot.plan.pendingDecisions.map((decision, index) => <li key={index} className="break-words">{decision}</li>)}</ul>
                </div>}
              </> : <p>{t('portfolio.noPlan')}</p>}
              <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
                <dt>{t('portfolio.activeClaims')}</dt><dd>{snapshot.resources.activeTaskClaims ?? t('portfolio.unknown')}</dd>
                <dt>{t('portfolio.pendingEffects')}</dt><dd>{snapshot.resources.pendingEffects ?? t('portfolio.unknown')}</dd>
                <dt>{t('portfolio.cost')}</dt><dd>{snapshot.resources.costUsd ?? t('portfolio.unknown')}</dd>
                <dt>{t('portfolio.resources')}</dt><dd>{snapshot.resources.observations.length ? snapshot.resources.observations.reduce((sum, entry) => sum + entry.activeSlots, 0) : t('portfolio.unknown')}</dd>
              </dl>
              <details className="rounded-md border border-border p-2" data-testid={`portfolio-evidence-${profile.id}`}>
                <summary className="cursor-pointer">{t('portfolio.references')}</summary>
                <div className="mt-2 space-y-2 break-all text-xs">
                  <p>{t('portfolio.session')}: {snapshot.coordinator.sessionKey ?? t('portfolio.unknown')}</p>
                  <p>{t('portfolio.generation')}: {snapshot.coordinator.generation ?? t('portfolio.unknown')}</p>
                  {snapshot.plan && <p>{t('portfolio.task')}: {snapshot.plan.taskNodeId} · {t('portfolio.revision', { revision: snapshot.plan.revision })}</p>}
                  {snapshot.evidence.map(receipt => <p key={receipt.receiptId}>{receipt.taskNodeId} · {receipt.receiptId} · {receipt.candidate} · {receipt.sha256}</p>)}
                  {snapshot.evidence.length === 0 && <p>{t('portfolio.noEvidence')}</p>}
                  {snapshot.resources.observations.map(entry => <p key={entry.id}>{entry.owner} · {entry.id} · {entry.kind}</p>)}
                </div>
              </details>
            </div>}
          </article>;
        })}
      </div>
    </div>
  </section>;
}
