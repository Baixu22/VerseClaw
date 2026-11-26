import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { RESOURCE_METRICS_TTL_MS } from '@shared/types/resources';
import type { SessionCollaborationResources as Resources, SessionCollaborationResourceQuery } from '@shared/types/session-collaboration-resources';

export function SessionCollaborationResources({ requester, target }: SessionCollaborationResourceQuery) {
  const { t, i18n } = useTranslation('agents');
  const [result, setResult] = useState<Resources | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const sequence = useRef(0);
  const inventory = result?.inventory;
  const capturedAt = inventory ? Date.parse(inventory.capturedAt) : null;
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => {
    if (!inventory || capturedAt === null) return;
    const timestamps = [capturedAt, ...inventory.owners.map(owner => owner.sampledAt ?? capturedAt)];
    const deadline = Math.min(...timestamps.map(at => at + RESOURCE_METRICS_TTL_MS).filter(at => at > clock));
    if (!Number.isFinite(deadline)) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(1, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [inventory, capturedAt, clock]);
  const read = async () => {
    const id = ++sequence.current;
    setLoading(true);
    setFailed(false);
    try {
      const response = await hostApi.sessionActivity.resources({ requester, target });
      if (id === sequence.current) {
        setResult(response.success ? response.resources : null);
        setFailed(!response.success);
        setClock(Date.now());
      }
    } catch {
      if (id === sequence.current) { setResult(null); setFailed(true); }
    } finally { if (id === sequence.current) setLoading(false); }
  };
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const money = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
  const unknown = t('collaboration.sources.unknown');
  const observed = (value: number, incomplete: number, format: (value: number) => string) =>
    incomplete && value === 0 ? unknown : format(value);
  const status = loading ? t('collaboration.loading') : failed ? t('collaboration.sources.unavailable')
    : result && result.state !== 'ready' ? t(`collaboration.sources.${result.state}`) : '';
  return <details className="min-w-0 rounded-md border border-border p-3" data-testid="collaboration-resources"
    onToggle={event => { if (event.currentTarget.open && !result && !loading) void read(); }}>
    <summary className="cursor-pointer rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('collaboration.resources')}</summary>
    <div className="space-y-3 pt-3">
      <Button type="button" variant="outline" className="h-9" onClick={() => void read()} disabled={loading}>{t('collaboration.refresh')}</Button>
      <p role="status" className="text-xs text-muted-foreground">{status}</p>
      {inventory && capturedAt !== null && <ul className="divide-y divide-border rounded-md border border-border">
        {inventory.owners.map(owner => {
          const sampledAt = owner.sampledAt ?? capturedAt;
          const state = sampledAt > clock || clock - sampledAt >= RESOURCE_METRICS_TTL_MS ? 'stale' : owner.state === 'known' ? 'ready' : 'unknown';
          const shared = owner.observationScope === 'shared';
          const label = owner.reservedPorts ? t('collaboration.resourceDetails.reservations') : t(`collaboration.resourceDetails.kinds.${owner.kind}`);
          return <li className="space-y-1 p-2 text-xs" key={`${owner.kind}:${owner.owner}`}
            data-testid={`collaboration-resource-${owner.kind}`} data-owner={owner.owner} data-state={state}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h4 className="text-sm font-medium">{label}</h4>
              <span className="text-muted-foreground">
                {shared ? `${t('collaboration.resourceDetails.shared')} · ` : ''}{t(`collaboration.sources.${state}`)}
              </span>
            </div>
            <p className="break-words text-muted-foreground">{owner.owner} · <time dateTime={new Date(sampledAt).toISOString()}>{new Date(sampledAt).toLocaleString(i18n.language)}</time></p>
            {state === 'ready' && <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
              {owner.kind !== 'provider' && owner.count !== null && <><dt>{t('collaboration.resourceDetails.count')}</dt><dd>{number.format(owner.count)}</dd></>}
              {owner.kind === 'process' && <>
                <dt>{t('collaboration.resourceDetails.rss')}</dt><dd>{owner.rssKb === null ? t('collaboration.sources.unknown') : `${number.format(owner.rssKb / 1024)} MiB`}</dd>
                <dt>{t('collaboration.resourceDetails.cpu')}</dt><dd>{owner.cpuPercent === null ? t('collaboration.sources.unknown') : `${number.format(owner.cpuPercent)}%`}</dd>
              </>}
              {owner.kind !== 'provider' && owner.activePermits !== null && <><dt>{t('collaboration.resourceDetails.activePermits')}</dt><dd>{number.format(owner.activePermits)}</dd></>}
              {owner.waiters !== null && <><dt>{t('collaboration.resourceDetails.waiters')}</dt><dd>{number.format(owner.waiters)}</dd></>}
              {owner.admission && <>
                <dt>{t('collaboration.budget.admission')}</dt>
                <dd data-testid="collaboration-admission-state">{t(`collaboration.budget.admissionStates.${owner.admission.fenced ? 'fenced'
                  : (owner.waiters ?? 0) > 0 ? 'waiting' : (owner.activePermits ?? 0) > 0 ? 'active' : 'idle'}`)}</dd>
                <dt>{t('collaboration.budget.rejectedWhileFenced')}</dt>
                <dd>{owner.admission.rejectedWhileFenced === null ? unknown : number.format(owner.admission.rejectedWhileFenced)}</dd>
              </>}
            </dl>}
            {state === 'ready' && !!(owner.processTreePids?.length || owner.pids?.length) && <p className="break-all">
              {t('collaboration.resourceDetails.pids')} · {(owner.processTreePids ?? owner.pids)?.join(', ')}
            </p>}
            {state === 'ready' && owner.reservedPorts?.length ? <p className="break-all">{owner.reservedPorts.join(', ')}</p> : null}
            {state === 'ready' && owner.worktreeIds?.length ? <p className="break-all">{owner.worktreeIds.join(', ')}</p> : null}
            {state === 'ready' && owner.kind === 'provider' && (owner.budgetEnabled === false
              ? <p className="text-muted-foreground">{t('collaboration.budget.disabled')}</p>
              : <div className="grid gap-2 lg:grid-cols-3">
                {(['host', 'project', 'session'] as const).map(scope => {
                  const spend = owner.spend?.find(item => item.scope === scope);
                  return <section key={scope} className="min-w-0 space-y-1 rounded-md border border-border p-2"
                    data-testid={`collaboration-budget-${scope}`}>
                    <h5 className="text-xs font-medium">{t(`collaboration.budget.scopes.${scope}`)}</h5>
                    {spend ? <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
                      <dt>{t('collaboration.budget.spentTokens')}</dt><dd>{observed(spend.spentTokens, spend.unknownTokenCalls, number.format)}</dd>
                      <dt>{t('collaboration.budget.heldTokens')}</dt><dd>{number.format(spend.heldTokens)}</dd>
                      <dt>{t('collaboration.budget.spentCost')}</dt><dd>{observed(spend.spentCostMicros, spend.unknownCostCalls, value => money.format(value / 1e6))}</dd>
                      <dt>{t('collaboration.budget.heldCost')}</dt><dd>{observed(spend.heldCostMicros, spend.unknownCostCalls, value => money.format(value / 1e6))}</dd>
                      <dt>{t('collaboration.budget.activeCalls')}</dt><dd>{number.format(spend.activeCalls)}</dd>
                      <dt>{t('collaboration.budget.unknownUsage')}</dt><dd>{number.format(spend.unknownTokenCalls)}</dd>
                      <dt>{t('collaboration.budget.unknownCost')}</dt><dd>{number.format(spend.unknownCostCalls)}</dd>
                    </dl> : <p className="text-muted-foreground">{unknown}</p>}
                  </section>;
                })}
              </div>)}
          </li>;
        })}
      </ul>}
    </div>
  </details>;
}
