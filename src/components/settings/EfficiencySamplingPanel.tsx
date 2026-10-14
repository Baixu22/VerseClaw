import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { hostApi } from '@/lib/host-api';
import { toUserMessage } from '@/lib/error-message';
import type { RuntimeEfficiencyState } from '@shared/host-api/contract';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${exponent === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * P2 #161: user-visible runtime efficiency sampling control.
 *
 * Reads only through host-api. The readout fails closed: before the first real
 * sample it shows an explicit "not sampled" state rather than a healthy-looking
 * zero, and it never estimates or interpolates a value.
 */
export function EfficiencySamplingPanel() {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<RuntimeEfficiencyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setState(await hostApi.efficiency.getState());
    } catch (error) {
      setState(null);
      toast.error(toUserMessage(error) || t('developer.efficiencySampling.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (enabled: boolean) => {
      setSaving(true);
      try {
        setState(await hostApi.efficiency.setEnabled(enabled));
        toast.success(
          enabled ? t('developer.efficiencySampling.enabledToast') : t('developer.efficiencySampling.disabledToast'),
        );
      } catch (error) {
        toast.error(toUserMessage(error) || t('developer.efficiencySampling.saveFailed'));
        void refresh();
      } finally {
        setSaving(false);
      }
    },
    [refresh, t],
  );

  const summary = state?.summary ?? null;
  const latest = summary?.latest ?? null;
  const measured = Boolean(state?.measured && latest);
  const shed = state?.shed ?? null;
  const backgroundWork = state?.backgroundWork ?? null;

  return (
    <section className="border-y border-border py-4" data-testid="settings-efficiency-sampling">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-medium text-foreground">
              {t('developer.efficiencySampling.title')}
            </h3>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            {t('developer.efficiencySampling.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={state?.enabled ?? false}
            disabled={loading || saving || !state}
            onCheckedChange={(next) => {
              void toggle(next);
            }}
            aria-label={t('developer.efficiencySampling.toggleAria')}
            data-testid="settings-efficiency-toggle"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void refresh();
            }}
            disabled={loading || saving}
            className="rounded-xl h-8 px-3 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
            data-testid="settings-efficiency-refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {measured && latest && summary ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span data-testid="settings-efficiency-sample-count">
              {t('developer.efficiencySampling.sampleCount', { count: summary.sampleCount })}
            </span>
            <span data-testid="settings-efficiency-cpu">
              {t('developer.efficiencySampling.cpu', { value: latest.cpuPercent.toFixed(1) })}
            </span>
            <span data-testid="settings-efficiency-rss">
              {t('developer.efficiencySampling.rss', { value: formatBytes(latest.rssBytes) })}
            </span>
            {shed?.shedding ? (
              <Badge variant="secondary" data-testid="settings-efficiency-shedding">
                {t('developer.efficiencySampling.shedding')}
              </Badge>
            ) : null}
            {backgroundWork ? (
              <span data-testid="settings-efficiency-background-work">
                {backgroundWork.deferring
                  ? t('developer.efficiencySampling.backgroundDeferred', {
                      reason: backgroundWork.lastDeferReason ?? 'resource-pressure',
                    })
                  : t('developer.efficiencySampling.backgroundSummary', {
                      deferred: backgroundWork.deferredCount,
                      resumed: backgroundWork.resumeCount,
                    })}
              </span>
            ) : null}
          </div>
        ) : (
          <p
            className="text-xs leading-5 text-muted-foreground"
            data-testid="settings-efficiency-not-sampled"
          >
            {state?.enabled === false
              ? t('developer.efficiencySampling.disabledHint')
              : t('developer.efficiencySampling.notSampled')}
          </p>
        )}
      </div>
    </section>
  );
}
