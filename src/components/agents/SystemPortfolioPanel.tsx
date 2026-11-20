import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSystemPortfolioStore } from '@/stores/system-portfolio';
import { hostApi } from '@/lib/host-api';
import type { SystemControlState } from '@shared/types/system-control';
import type { SystemProjectSnapshot } from '@shared/types/system-portfolio';

export function SystemPortfolioPanel() {
  const { t, i18n } = useTranslation('agents');
  const [search, setSearch] = useSearchParams();
  const filter = search.get('q') ?? '';
  const { entries, loading, unavailable, refresh } = useSystemPortfolioStore();
  const [control, setControl] = useState<SystemControlState | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState(false);
  const [dispatches, setDispatches] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    void refresh();
    void hostApi.workspaces.systemControl().then(state => { if (!cancelled) setControl(state); })
      .catch(() => { if (!cancelled) setControlError(true); });
    return () => { cancelled = true; };
  }, [refresh]);
  const refreshAll = async () => {
    void refresh();
    try { setControl(await hostApi.workspaces.systemControl()); setControlError(false); }
    catch { setControlError(true); }
  };
  const pause = async () => {
    if (!control) return;
    setControlBusy(true);
    try {
      setControl(await hostApi.workspaces.setSystemControl({ paused: !control.paused,
        expectedRevision: control.revision, requestId: crypto.randomUUID() }));
      setControlError(false);
    } catch { setControlError(true); }
    finally { setControlBusy(false); }
  };
  const dispatch = async (snapshot: SystemProjectSnapshot) => {
    if (!control || !snapshot.plan?.nextTaskNodeId || !snapshot.coordinator.sessionKey || !snapshot.coordinator.generation) return;
    setDispatches(rows => ({ ...rows, [snapshot.workspaceId]: 'pending' }));
    try {
      const result = await hostApi.sessions.dispatchSystemProject({ workspaceId: snapshot.workspaceId,
        sessionKey: snapshot.coordinator.sessionKey, expectedSessionGeneration: snapshot.coordinator.generation,
        planId: snapshot.plan.taskNodeId, expectedRevision: snapshot.plan.revision, expectedChildId: snapshot.plan.nextTaskNodeId,
        expectedPolicyRevision: control.revision });
      setDispatches(rows => ({ ...rows, [snapshot.workspaceId]: result.status }));
    } catch { setDispatches(rows => ({ ...rows, [snapshot.workspaceId]: 'outcome-unknown' })); }
    finally { await refreshAll(); }
  };
  const projects = Object.values(entries).filter(entry => entry.profile.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <section className="h-full overflow-y-auto p-4 sm:p-6" data-testid="system-portfolio" data-scope="system">
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-normal tracking-tight">{t('portfolio.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('portfolio.systemScope')}</p>
        </div>
        <Button variant="outline" onClick={() => void refreshAll()} data-testid="portfolio-refresh">
          <RefreshCw className="mr-2 h-4 w-4" />{t('portfolio.refresh')}
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
        <Button variant="outline" data-testid="system-pause" disabled={!control || controlBusy} onClick={() => void pause()}>
          {t(control?.paused ? 'portfolio.resumeSystem' : 'portfolio.pauseSystem')}
        </Button>
        <p role="status" className="text-sm" data-testid="system-control-state">{t(!control ? 'portfolio.controlUnknown' : control.paused ? 'portfolio.systemPaused' : 'portfolio.systemRunning')}</p>
        {control?.paused && <p className="text-xs text-muted-foreground">{t('portfolio.inFlightPolicy')}</p>}
        {controlError && <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">{t('portfolio.controlError')}</p>}
      </div>
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
                <div className="space-y-1">
                  <Button variant="outline" data-testid={`portfolio-dispatch-${profile.id}`}
                    disabled={!control || control.paused || reading || failed || snapshot.coordinator.state !== 'ready'
                      || !snapshot.plan.nextTaskNodeId || dispatches[profile.id] === 'pending'} onClick={() => void dispatch(snapshot)}>
                    {t('portfolio.runNext')}
                  </Button>
                  {dispatches[profile.id] && <p role="status" data-testid={`portfolio-dispatch-status-${profile.id}`}>
                    {t(`portfolio.dispatchStatus.${dispatches[profile.id]}`)}
                  </p>}
                </div>
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
