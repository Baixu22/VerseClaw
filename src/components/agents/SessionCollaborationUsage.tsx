import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import type { CollaborationUsageTotals, SessionCollaborationUsage as Usage, SessionCollaborationUsageQuery } from '@shared/types/session-collaboration-usage';

export function SessionCollaborationUsage({ requester, target }: SessionCollaborationUsageQuery) {
  const { t, i18n } = useTranslation('agents');
  const [result, setResult] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  const read = async () => {
    const id = ++sequence.current;
    setLoading(true);
    setFailed(false);
    try {
      const response = await hostApi.sessionActivity.modelUsage({ requester, target });
      if (id === sequence.current) {
        setResult(response.success ? response.usage : null);
        setFailed(!response.success);
      }
    } catch {
      if (id === sequence.current) { setResult(null); setFailed(true); }
    } finally { if (id === sequence.current) setLoading(false); }
  };
  const number = new Intl.NumberFormat(i18n.language);
  const money = new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'USD', maximumFractionDigits: 8 });
  const totalsView = (totals: CollaborationUsageTotals) => <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">
    <dt>{t('collaboration.usage.calls')}</dt><dd>{number.format(totals.calls)}</dd>
    <dt>{t(totals.totalTokens === null && totals.knownTokens ? 'collaboration.usage.knownTokens' : 'collaboration.usage.tokens')}</dt>
    <dd>{totals.knownTokens ? number.format(totals.knownTokens.total) : t('collaboration.sources.unknown')}</dd>
    {totals.knownTokens && <>
      <dt>{t('collaboration.usage.cacheRead')}</dt><dd>{number.format(totals.knownTokens.cacheRead)}</dd>
      <dt>{t('collaboration.usage.cacheWrite')}</dt><dd>{number.format(totals.knownTokens.cacheWrite)}</dd>
    </>}
    <dt>{t(totals.totalUsd === null && totals.knownSubtotalUsd !== null ? 'collaboration.usage.subtotal' : 'collaboration.usage.cost')}</dt>
    <dd>{totals.knownSubtotalUsd === null ? t('collaboration.sources.unknown') : money.format(totals.knownSubtotalUsd)}</dd>
    {totals.unknownUsageCalls > 0 && <><dt>{t('collaboration.usage.missingUsage')}</dt><dd>{number.format(totals.unknownUsageCalls)}</dd></>}
    {totals.unknownPriceCalls > 0 && <><dt>{t('collaboration.usage.missingPrice')}</dt><dd>{number.format(totals.unknownPriceCalls)}</dd></>}
    {totals.conflicts > 0 && <><dt>{t('collaboration.usage.conflict')}</dt><dd>{number.format(totals.conflicts)}</dd></>}
  </dl>;
  return <details className="min-w-0 rounded-md border border-border p-3" data-testid="collaboration-model-usage"
    onToggle={event => { if (event.currentTarget.open && !result && !loading) void read(); }}>
    <summary className="cursor-pointer rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {t('collaboration.usage.title')}
    </summary>
    <div className="space-y-3 pt-3">
      <Button type="button" variant="outline" className="h-9" onClick={() => void read()} disabled={loading}>
        {t('collaboration.refresh')}
      </Button>
      <p role="status" className="text-xs text-muted-foreground">{loading ? t('collaboration.loading') : failed ? t('collaboration.sources.unavailable') : ''}</p>
      {result && <div className="grid gap-2 lg:grid-cols-3">
        {(['session', 'task', 'run'] as const).map(scope => {
          const source = result[scope];
          const value = source.value;
          return <section key={scope} data-testid={`collaboration-model-usage-${scope}`}
            className="min-w-0 space-y-2 rounded-md border border-border p-2">
            <h4 className="text-sm font-medium">{t(`collaboration.usage.${scope}`)}</h4>
            {value ? <>
              {'run' in value && <p className="break-all text-xs text-muted-foreground">{value.run.runId}</p>}
              {totalsView('totals' in value ? value.totals : value)}
              {'totals' in value && value.totals.priceVersions.length > 0 && <details className="text-xs">
                <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t('collaboration.usage.priceVersions')}
                </summary>
                <ul className="break-all pt-1">{value.totals.priceVersions.map(version => <li key={version}>{version}</li>)}</ul>
              </details>}
              {'coordination' in value && value.coordination.calls > 0 && <>
                <p className="border-t border-border pt-2 text-xs">{t('collaboration.usage.coordination')}</p>
                {totalsView(value.coordination)}
              </>}
            </> : <p className="text-xs text-muted-foreground">{t(`collaboration.sources.${source.state}`)}</p>}
          </section>;
        })}
      </div>}
      {result && result.calls.length > 0 && <details className="min-w-0 rounded-md border border-border p-2">
        <summary className="cursor-pointer rounded-sm text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('collaboration.usage.observations')}
        </summary>
        <ul className="divide-y divide-border">
          {result.calls.map(call => <li key={call.id} className="space-y-1 break-all py-2 text-xs" data-testid="collaboration-model-call">
            <p>{call.provider} / {call.model}{call.category === 'coordination' ? ` · ${t('collaboration.usage.coordination')}` : ''}</p>
            <p className="text-muted-foreground">{call.run.runId} · {t('collaboration.usage.attempt', {
              attempt: call.attemptIndex === null ? t('collaboration.sources.unknown') : number.format(call.attemptIndex + 1),
            })}</p>
            <p>{call.tokens ? t('collaboration.usage.callTokens', { tokens: number.format(call.tokens.total) })
              : t(call.state === 'conflict' ? 'collaboration.usage.conflict' : 'collaboration.sources.unknown')}
              {call.costUsd === null ? '' : ` · ${money.format(call.costUsd)}`}</p>
            {call.priceVersion && <p className="text-muted-foreground">{t('collaboration.usage.priceVersion')} · {call.priceVersion}</p>}
          </li>)}
        </ul>
      </details>}
    </div>
  </details>;
}
