import { useCallback, useEffect, useState } from 'react';
import { Braces, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { hostApi } from '@/lib/host-api';
import { toUserMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';
import type { VtokenStatusResult } from '@shared/vtoken/types';

function tone(ok: boolean): string {
  return ok
    ? 'border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
    : 'border-amber-500/30 text-amber-700 dark:text-amber-400';
}

export function VtokenBridgePanel() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<VtokenStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const next = await hostApi.vtoken.getStatus();
      setStatus(next);
    } catch (error) {
      toast.error(
        t('developer.vtokenBridge.loadFailed', {
          error: toUserMessage(error) || String(error),
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const onToggleEnabled = useCallback(
    async (enabled: boolean) => {
      setBusy(true);
      try {
        const result = await hostApi.vtoken.setEnabled({ enabled });
        if (!result.success) {
          toast.error(t('developer.vtokenBridge.toggleFailed'));
          return;
        }
        toast.success(
          enabled
            ? t('developer.vtokenBridge.enabledToast')
            : t('developer.vtokenBridge.disabledToast'),
        );
        await loadStatus();
      } catch (error) {
        toast.error(
          t('developer.vtokenBridge.toggleFailedDetail', {
            error: toUserMessage(error) || String(error),
          }),
        );
      } finally {
        setBusy(false);
      }
    },
    [loadStatus, t],
  );

  const onEnsureStarted = useCallback(async () => {
    setBusy(true);
    try {
      const result = await hostApi.vtoken.ensureStarted();
      setStatus(result);
      if (!result.success || result.disabled) {
        toast.error(result.error || t('developer.vtokenBridge.startFailed'));
        return;
      }
      toast.success(t('developer.vtokenBridge.startedToast'));
    } catch (error) {
      toast.error(
        t('developer.vtokenBridge.startFailedDetail', {
          error: toUserMessage(error) || String(error),
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [t]);

  const onSmokeAssemble = useCallback(async () => {
    setBusy(true);
    try {
      const enabled = await hostApi.vtoken.setEnabled({ enabled: true });
      if (!enabled.success) {
        toast.error(t('developer.vtokenBridge.toggleFailed'));
        return;
      }
      await hostApi.vtoken.ensureStarted();
      await hostApi.vtoken.open({});
      await hostApi.vtoken.ingestMarkdown({
        text: '# Smoke\n\n## Working context\n\n- sample rule for VT assemble\n',
        sourcePath: 'vtoken-smoke.md',
      });
      const assembled = await hostApi.vtoken.assemble({
        taskHint: 'working context sample',
        budgetTokens: 300,
        renderMode: 'compact',
      });
      if (!assembled.success || !assembled.result) {
        toast.error(assembled.error || t('developer.vtokenBridge.assembleFailed'));
        await loadStatus();
        return;
      }
      toast.success(
        t('developer.vtokenBridge.assembleOk', {
          used: assembled.result.tokens_used,
          budget: assembled.result.tokens_budget,
        }),
      );
      await loadStatus();
    } catch (error) {
      toast.error(
        t('developer.vtokenBridge.assembleFailedDetail', {
          error: toUserMessage(error) || String(error),
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [loadStatus, t]);

  const enabled = Boolean(status?.enabled);
  const running = Boolean(status?.running);

  return (
    <div
      className="space-y-4 rounded-lg border border-black/10 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]"
      data-testid="settings-vtoken-bridge"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Label className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Braces className="h-4 w-4" />
            {t('developer.vtokenBridge.title')}
          </Label>
          <p className="mt-1 text-meta text-muted-foreground">
            {t('developer.vtokenBridge.description')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn('w-fit text-tiny font-normal', tone(enabled))}
            data-testid="settings-vtoken-bridge-enabled-badge"
          >
            {enabled
              ? t('developer.vtokenBridge.badgeEnabled')
              : t('developer.vtokenBridge.badgeDisabled')}
          </Badge>
          <Badge
            variant="outline"
            className={cn('w-fit text-tiny font-normal', tone(running))}
            data-testid="settings-vtoken-bridge-running-badge"
          >
            {running
              ? t('developer.vtokenBridge.badgeRunning')
              : t('developer.vtokenBridge.badgeStopped')}
          </Badge>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-black/10 bg-surface-modal px-3 py-2.5 dark:border-white/10">
        <div>
          <p className="text-sm font-medium text-foreground">
            {t('developer.vtokenBridge.enableLabel')}
          </p>
          <p className="text-meta text-muted-foreground">
            {t('developer.vtokenBridge.enableHelp')}
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={busy}
          onCheckedChange={(checked) => {
            void onToggleEnabled(checked);
          }}
          data-testid="settings-vtoken-bridge-enable-switch"
        />
      </div>

      <div
        className="grid gap-2 rounded-lg border border-black/10 bg-surface-modal p-4 text-meta text-muted-foreground dark:border-white/10 sm:grid-cols-2"
        data-testid="settings-vtoken-bridge-status"
      >
        <p>
          <span className="font-medium text-foreground/80">
            {t('developer.vtokenBridge.version')}:
          </span>{' '}
          {status?.version || '—'}
        </p>
        <p>
          <span className="font-medium text-foreground/80">
            {t('developer.vtokenBridge.pid')}:
          </span>{' '}
          {status?.workerPid ?? '—'}
        </p>
        <p>
          <span className="font-medium text-foreground/80">
            {t('developer.vtokenBridge.opened')}:
          </span>{' '}
          {status?.opened
            ? t('developer.vtokenBridge.yes')
            : t('developer.vtokenBridge.no')}
        </p>
        <p>
          <span className="font-medium text-foreground/80">
            {t('developer.vtokenBridge.packageRoot')}:
          </span>{' '}
          <span className="break-all font-mono text-tiny">
            {status?.packageRoot || '—'}
          </span>
        </p>
        {status?.lastAssemble && (
          <p className="sm:col-span-2" data-testid="settings-vtoken-bridge-last-assemble">
            <span className="font-medium text-foreground/80">
              {t('developer.vtokenBridge.lastAssemble')}:
            </span>{' '}
            {t('developer.vtokenBridge.lastAssembleDetail', {
              used: status.lastAssemble.tokens_used,
              budget: status.lastAssemble.tokens_budget,
              included: status.lastAssemble.nodes_included,
              evicted: status.lastAssemble.nodes_evicted,
              ms: status.lastAssemble.durationMs,
            })}
          </p>
        )}
        {status?.error && (
          <p
            className="sm:col-span-2 text-amber-700 dark:text-amber-400"
            data-testid="settings-vtoken-bridge-error"
          >
            <span className="font-medium">{t('developer.vtokenBridge.error')}:</span>{' '}
            {status.error}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy || loading}
          onClick={() => {
            void loadStatus();
          }}
          data-testid="settings-vtoken-bridge-refresh"
          className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
        >
          <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
          {t('common:actions.refresh')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !enabled}
          onClick={() => {
            void onEnsureStarted();
          }}
          data-testid="settings-vtoken-bridge-ensure"
          className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
        >
          {t('developer.vtokenBridge.ensureStarted')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            void onSmokeAssemble();
          }}
          data-testid="settings-vtoken-bridge-smoke"
          className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
        >
          {t('developer.vtokenBridge.smokeAssemble')}
        </Button>
      </div>

      <p className="text-tiny text-muted-foreground">
        {t('developer.vtokenBridge.boundaryNote')}
      </p>
    </div>
  );
}