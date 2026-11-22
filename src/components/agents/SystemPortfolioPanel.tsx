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
import { ProjectConfigurationPanel } from './ProjectConfigurationPanel';

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
  return <section className="h-full overflow-y-auto p-4 sm:p-5" data-testid="system-portfolio" data-scope="system">
    <div className="mx-auto max-w-7xl space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-sans text-2xl font-normal tracking-normal">{t('portfolio.title')}</h1>
          <p className="mt-1 text-meta text-muted-foreground">{t('portfolio.systemScope')}</p>
        </div>
        <Button className="h-8" variant="outline" onClick={() => void refreshAll()} data-testid="portfolio-refresh">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{t('portfolio.refresh')}
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <label className="min-w-48 flex-1">
          <span className="sr-only">{t('portfolio.filter')}</span>
          <Input className="h-8 text-sm" placeholder={t('portfolio.filter')} value={filter} data-testid="portfolio-filter" onChange={event => {
            const next = new URLSearchParams(search);
            if (event.target.value) next.set('q', event.target.value); else next.delete('q');
            setSearch(next, { replace: true });
          }} />
        </label>
        <Button className="h-8" variant="outline" data-testid="system-pause" disabled={!control || controlBusy} onClick={() => void pause()}>
          {t(control?.paused ? 'portfolio.resumeSystem' : 'portfolio.pauseSystem')}
        </Button>
        <p role="status" className="text-xs text-muted-foreground" data-testid="system-control-state">{t(!control ? 'portfolio.controlUnknown' : control.paused ? 'portfolio.systemPaused' : 'portfolio.systemRunning')}</p>
      </div>
      {control?.paused && <p className="text-xs text-muted-foreground">{t('portfolio.inFlightPolicy')}</p>}
      {controlError && <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">{t('portfolio.controlError')}</p>}
      {loading && <p role="status">{t('portfolio.loading')}</p>}
      {unavailable && <p role="status" className="text-amber-700 dark:text-amber-400">{t('portfolio.listUnavailable')}</p>}
      {!loading && !unavailable && projects.length === 0 && <p role="status">{t('portfolio.empty')}</p>}
      <div className="divide-y divide-border rounded-lg border border-border bg-background">
        {projects.map(({ profile, snapshot, loading: reading, unavailable: failed }) => {
          const canOpen = !failed && snapshot && ['ready', 'paused'].includes(snapshot.coordinator.state);
          return <article key={profile.id} className="min-w-0 space-y-3 px-3 py-3"
            data-testid={`portfolio-project-${profile.id}`} data-state={reading ? 'loading' : failed ? 'unavailable' : 'observed'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="min-w-0 break-words font-sans text-sm font-medium tracking-normal">
                {canOpen ? <Link className="rounded-sm transition-colors hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-blue-400"
                  data-testid={`portfolio-open-${profile.id}`} to={`/projects/${encodeURIComponent(profile.id)}`}>{profile.name}</Link> : profile.name}
              </h2>
              {snapshot && <span className={snapshot.coordinator.state === 'paused' ? 'text-xs text-amber-700 dark:text-amber-400' : 'text-xs text-muted-foreground'} title={t('portfolio.coordinator')}>
                {t(`portfolio.coordinatorState.${snapshot.coordinator.state}`)}
              </span>}
            </div>
            {reading && <p role="status" className="text-xs text-muted-foreground">{t('portfolio.loading')}</p>}
            {failed && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{t(snapshot ? 'portfolio.stale' : 'portfolio.unavailable')}</p>}
            {snapshot && <>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 space-y-1">
                  {snapshot.plan ? <>
                    <p className="break-words text-sm font-medium text-foreground" data-testid={`portfolio-goal-${profile.id}`}>{snapshot.plan.objective}</p>
                    {snapshot.plan.nextAction && <p className="break-words text-meta text-muted-foreground">{t('portfolio.nextAction')}: {snapshot.plan.nextAction}</p>}
                    <Link className="inline-flex rounded-sm text-xs text-muted-foreground transition-colors hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-blue-400" to={`/task-ledger?workspaceId=${encodeURIComponent(profile.id)}&nodeId=${encodeURIComponent(snapshot.plan.taskNodeId)}`}>
                      {t('portfolio.tasks', { done: snapshot.plan.tasks.filter(task => task.state === 'done').length, total: snapshot.plan.tasks.length })}
                    </Link>
                  </> : <p className="text-sm text-muted-foreground">{t('portfolio.noPlan')}</p>}
                </div>
                {snapshot.plan && <div className="shrink-0 space-y-1">
                  <Button className="h-8" variant="outline" data-testid={`portfolio-dispatch-${profile.id}`}
                    disabled={!control || control.paused || reading || failed || snapshot.coordinator.state !== 'ready'
                      || !snapshot.plan.nextTaskNodeId || dispatches[profile.id] === 'pending'} onClick={() => void dispatch(snapshot)}>
                    {t('portfolio.runNext')}
                  </Button>
                  {dispatches[profile.id] && <p role="status" className="text-xs" data-testid={`portfolio-dispatch-status-${profile.id}`}>
                    {t(`portfolio.dispatchStatus.${dispatches[profile.id]}`)}
                  </p>}
                </div>}
              </div>
              {snapshot.plan && snapshot.plan.pendingDecisions.length > 0 && <div className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
                <p>{t('portfolio.decisions')}</p>
                <ul className="list-disc space-y-1 pl-5">{snapshot.plan.pendingDecisions.map((decision, index) => <li key={index} className="break-words">{decision}</li>)}</ul>
              </div>}
              {(snapshot.resources.activeTaskClaims !== null || (snapshot.resources.pendingEffects !== null && snapshot.resources.pendingEffects > 0) || snapshot.resources.observations.length > 0) && <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {snapshot.resources.activeTaskClaims !== null && <span>{t('portfolio.activeClaims')}: <span className="tabular-nums text-foreground">{snapshot.resources.activeTaskClaims}</span></span>}
                {snapshot.resources.pendingEffects !== null && snapshot.resources.pendingEffects > 0 && <span>{t('portfolio.pendingEffects')}: <span className="tabular-nums text-foreground">{snapshot.resources.pendingEffects}</span></span>}
                {snapshot.resources.observations.length > 0 && <span>{t('portfolio.resources')}: <span className="tabular-nums text-foreground">{snapshot.resources.observations.reduce((sum, entry) => sum + entry.activeSlots, 0)}</span></span>}
              </div>}
              <div>
                <details className="border-t border-border/70 py-1" data-testid={`portfolio-evidence-${profile.id}`}>
                  <summary className="min-h-8 cursor-pointer rounded-md py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('portfolio.references')}</summary>
                  <div className="space-y-2 break-all pb-2 text-xs text-muted-foreground">
                    <p>{t('portfolio.projectScope')}</p>
                    <p>{t('portfolio.observedAt', { time: new Date(snapshot.observedAt).toLocaleString(i18n.language) })}</p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                      <dt>{t('portfolio.activeClaims')}</dt><dd>{snapshot.resources.activeTaskClaims ?? t('portfolio.unknown')}</dd>
                      <dt>{t('portfolio.pendingEffects')}</dt><dd>{snapshot.resources.pendingEffects ?? t('portfolio.unknown')}</dd>
                      <dt>{t('portfolio.cost')}</dt><dd>{snapshot.resources.costUsd ?? t('portfolio.unknown')}</dd>
                      <dt>{t('portfolio.resources')}</dt><dd>{snapshot.resources.observations.length ? snapshot.resources.observations.reduce((sum, entry) => sum + entry.activeSlots, 0) : t('portfolio.unknown')}</dd>
                    </dl>
                    <p>{t('portfolio.session')}: {snapshot.coordinator.sessionKey ?? t('portfolio.unknown')}</p>
                    <p>{t('portfolio.generation')}: {snapshot.coordinator.generation ?? t('portfolio.unknown')}</p>
                    {snapshot.plan && <p>{t('portfolio.task')}: {snapshot.plan.taskNodeId} · {t('portfolio.revision', { revision: snapshot.plan.revision })}</p>}
                    {snapshot.evidence.map(receipt => <p key={receipt.receiptId}>{receipt.taskNodeId} · {receipt.receiptId} · {receipt.candidate} · {receipt.sha256}</p>)}
                    {snapshot.evidence.length === 0 && <p>{t('portfolio.noEvidence')}</p>}
                    {snapshot.resources.observations.map(entry => <p key={entry.id}>{entry.owner} · {entry.id} · {entry.kind}</p>)}
                  </div>
                </details>
                <ProjectConfigurationPanel workspaceId={profile.id} ownerKey={snapshot.ownerKey} />
              </div>
            </>}
          </article>;
        })}
      </div>
    </div>
  </section>;
}
