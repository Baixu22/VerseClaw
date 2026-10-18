import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HookTrustEntryView } from '@shared/host-api/contract';
import { hostApi } from '@/lib/host-api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function shortHash(value: string | null): string {
  return value ? `${value.slice(0, 10)}…` : '—';
}

export function HooksTrustPanel() {
  const { t } = useTranslation('settings');
  const [hooks, setHooks] = useState<HookTrustEntryView[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.hooks.list();
      setHooks(result.hooks);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(async (hookKey: string, patch: { trusted?: boolean; enabled?: boolean }) => {
    setLoading(true);
    try {
      const result = await hostApi.hooks.setTrusted({ hookKey, ...patch });
      setHooks(result.hooks);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="rounded-xl border border-black/5 p-3 dark:border-white/5" data-testid="settings-hooks-trust-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{t('sandbox.hooks.title')}</p>
          <p className="mt-0.5 text-2xs text-muted-foreground">{t('sandbox.hooks.description')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          {t('sandbox.refresh')}
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {hooks.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('sandbox.hooks.empty')}</p>
        ) : hooks.map((hook) => (
          <div key={hook.hookKey} className="rounded-lg bg-black/[0.03] p-2.5 dark:bg-white/[0.04]" data-testid={`settings-hook-${hook.hookKey}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-foreground">{hook.name}</span>
              <Badge variant="outline" className="rounded-full text-2xs">{hook.source}</Badge>
              <Badge variant={hook.trustState === 'trusted' ? 'secondary' : 'destructive'} className="rounded-full text-2xs">
                {hook.trustState}
              </Badge>
              {hook.managed && <Badge variant="outline" className="rounded-full text-2xs">{t('sandbox.hooks.managed')}</Badge>}
            </div>
            <p className="mt-1 font-mono text-2xs text-muted-foreground">sha256: {shortHash(hook.hash)}</p>
            <p className="mt-1 text-2xs text-muted-foreground">{hook.reason}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hook.source === 'openclaw-workspace' && (
                <Button
                  type="button"
                  size="sm"
                  variant={hook.trustState === 'trusted' ? 'outline' : 'default'}
                  disabled={loading}
                  onClick={() => void update(hook.hookKey, { trusted: hook.trustState !== 'trusted' })}
                  data-testid={`settings-hook-trust-${hook.hookKey}`}
                >
                  {hook.trustState === 'trusted' ? t('sandbox.hooks.untrust') : t('sandbox.hooks.trust')}
                </Button>
              )}
              {!hook.managed && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onClick={() => void update(hook.hookKey, { enabled: !hook.enabled })}
                  data-testid={`settings-hook-enable-${hook.hookKey}`}
                >
                  {hook.enabled ? t('sandbox.hooks.disable') : t('sandbox.hooks.enable')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
