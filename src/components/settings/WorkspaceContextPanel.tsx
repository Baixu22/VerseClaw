import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { SettingsButton, SettingsRow, SettingsSection, SettingsSwitch } from '@/components/settings/primitives';
import { hostApi } from '@/lib/host-api';
import { toUserMessage } from '@/lib/error-message';
import type { WorkspaceContextSetResult, WorkspaceContextState } from '@shared/dcs/prod-flags-control';

function statusLabel(
  t: (key: string) => string,
  result: WorkspaceContextSetResult | null,
  state: WorkspaceContextState | null,
): string {
  if (result?.status === 'applied') return t('workspaceContext.status.applied');
  if (result?.status === 'runtime-acknowledged') return t('workspaceContext.status.acknowledged');
  if (result?.status === 'pending-restart' || result?.status === 'saved' || result?.status === 'restarting') {
    return t('workspaceContext.status.pending');
  }
  if (result?.status === 'failed' || result?.status === 'error') return t('workspaceContext.status.failed');
  if (state?.enabled) return t('workspaceContext.status.applied');
  if (state?.partial) return t('workspaceContext.status.partial');
  return t('workspaceContext.status.off');
}

export function WorkspaceContextPanel() {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<WorkspaceContextState | null>(null);
  const [result, setResult] = useState<WorkspaceContextSetResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await hostApi.dcsProdFlags.getWorkspaceContext();
      setState(next);
      setError(null);
    } catch (cause) {
      setError(toUserMessage(cause) || t('workspaceContext.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await hostApi.dcsProdFlags.setWorkspaceContext({ enabled });
      setResult(next);
      if (!next.success) setError(next.error || t('workspaceContext.setFailed'));
      await refresh();
    } catch (cause) {
      setError(toUserMessage(cause) || t('workspaceContext.setFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title={t('workspaceContext.title')}>
      <SettingsRow
        title={t('workspaceContext.label')}
        description={t('workspaceContext.description')}
        control={(
          <SettingsSwitch
            ariaLabel={t('workspaceContext.label')}
            checked={state?.enabled ?? false}
            disabled={busy || !state}
            testId="settings-workspace-context-switch"
            onChange={(enabled) => void setEnabled(enabled)}
          />
        )}
      />
      <div className="space-y-3 px-5 py-4" data-testid="settings-workspace-context">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" data-testid="settings-workspace-context-status">
            {statusLabel(t, result, state)}
          </Badge>
          {state?.partial ? (
            <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
              {t('workspaceContext.status.partial')}
            </Badge>
          ) : null}
          <SettingsButton
            variant="secondary"
            testId="settings-workspace-context-refresh"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            {t('workspaceContext.refresh')}
          </SettingsButton>
        </div>
        <p className="text-meta text-muted-foreground" data-testid="settings-workspace-context-model-summary">
          {state?.modelSummary ?? t('workspaceContext.loading')}
        </p>
        {result?.ackTrail?.length ? (
          <p className="text-tiny text-muted-foreground" data-testid="settings-workspace-context-ack-trail">
            {result.ackTrail.join(' → ')}
          </p>
        ) : null}
        {error ? (
          <p className="text-meta text-red-700 dark:text-red-400" data-testid="settings-workspace-context-error">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsSection>
  );
}