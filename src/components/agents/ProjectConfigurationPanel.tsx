import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hostApi } from '@/lib/host-api';
import type { ProjectConfigurationApply, ProjectConfigurationPreview, ProjectConfigurationResult, ProjectConfigurationValues } from '@shared/project-configuration';

export function ProjectConfigurationPanel({ workspaceId, ownerKey }: { workspaceId: string; ownerKey: string }) {
  const { t } = useTranslation('agents');
  const [model, setModel] = useState(''), [deny, setDeny] = useState(''), [context, setContext] = useState('');
  const [preview, setPreview] = useState<ProjectConfigurationPreview | null>(null);
  const [request, setRequest] = useState<ProjectConfigurationApply | null>(null);
  const [result, setResult] = useState<ProjectConfigurationResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const scope = useRef(''); scope.current = JSON.stringify([workspaceId, ownerKey]);
  const values = (v: ProjectConfigurationValues) => t('configuration.values', { model: v.modelRef ?? t('configuration.unavailable'),
    tools: v.denyTools.join(', ') || t('configuration.none'), tokens: v.contextTokens ?? t('configuration.unavailable') });
  useEffect(() => {
    let cancelled = false;
    setPreview(null); setRequest(null); setResult(null); setBusy(false); setError('');
    void hostApi.workspaces.configurationOperations(workspaceId).then(operations => {
      if (!cancelled) setResult(operations.find(operation => ['pending', 'degraded'].includes(operation.phase)) ?? operations.at(-1) ?? null);
    }).catch(() => { if (!cancelled) setError('CONFIG_HISTORY_UNAVAILABLE'); });
    return () => { cancelled = true; };
  }, [workspaceId, ownerKey]);
  const prepare = async () => {
    const identity = scope.current;
    setBusy(true); setError(''); setResult(null);
    try {
      const patch = { ...(model.trim() ? { modelRef: model.trim() } : {}),
        ...(deny.trim() ? { denyTools: deny.split(',').map(v => v.trim()).filter(Boolean) } : {}),
        ...(context.trim() ? { contextTokens: Number(context) } : {}) };
      const input = { workspaceId, ownerKey, patch };
      const checked = await hostApi.workspaces.previewConfiguration(input);
      if (identity !== scope.current) return;
      setPreview(checked); setRequest({ ...input, requestId: crypto.randomUUID(), digest: checked.digest, configRevision: checked.configRevision });
    } catch (cause) { if (identity === scope.current) { setPreview(null); setRequest(null); setError(String(cause)); } }
    finally { if (identity === scope.current) setBusy(false); }
  };
  const apply = async () => {
    const identity = scope.current;
    if (!request) return; setBusy(true); setError('');
    try { const value = await hostApi.workspaces.applyConfiguration(request); if (identity === scope.current) setResult(value); }
    catch (cause) { if (identity === scope.current) setError(String(cause)); }
    finally { if (identity === scope.current) setBusy(false); }
  };
  const recover = async () => {
    if (!result) return;
    const identity = scope.current; setBusy(true); setError('');
    try {
      const recovered = await hostApi.workspaces.reconcileConfiguration({ workspaceId, ownerKey, requestId: result.requestId });
      if (identity === scope.current) setResult(recovered);
    } catch (cause) { if (identity === scope.current) setError(String(cause)); }
    finally { if (identity === scope.current) setBusy(false); }
  };
  const field = (set: (value: string) => void, value: string) => { set(value); setPreview(null); setRequest(null); setResult(null); };
  return <details className="rounded-md border border-border p-2" data-testid={`project-config-${workspaceId}`}>
    <summary className="cursor-pointer text-sm">{t('configuration.title')}</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">{t('configuration.policy')}</p>
      <label className="block">{t('configuration.model')}<Input disabled={busy} value={model} onChange={e => field(setModel, e.target.value)} data-testid={`project-config-model-${workspaceId}`} /></label>
      <label className="block">{t('configuration.tools')}<Input disabled={busy} value={deny} onChange={e => field(setDeny, e.target.value)} data-testid={`project-config-tools-${workspaceId}`} /></label>
      <label className="block">{t('configuration.context')}<Input disabled={busy} inputMode="numeric" value={context} onChange={e => field(setContext, e.target.value)} data-testid={`project-config-context-${workspaceId}`} /></label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void prepare()} data-testid={`project-config-preview-${workspaceId}`}>{t('configuration.preview')}</Button>
        <Button disabled={!request || busy} onClick={() => void apply()} data-testid={`project-config-apply-${workspaceId}`}>{t('configuration.apply')}</Button>
        {result && ['pending', 'degraded'].includes(result.phase) && <Button disabled={busy} onClick={() => void recover()} data-testid={`project-config-recover-${workspaceId}`}>{t('configuration.recover')}</Button>}
      </div>
      {error && <p role="alert" className="break-words text-amber-700 dark:text-amber-400">{t('configuration.error')}: {error.match(/CONFIG_[A-Z_]+/)?.[0] ?? t('configuration.unavailable')}</p>}
      {(preview || result) && <dl className="space-y-2 break-all" data-testid={`project-config-values-${workspaceId}`}>
        <dt>{t('configuration.desired')}</dt><dd>{values(result?.desired ?? preview!.desired)}</dd>
        <dt>{t('configuration.configured')}</dt><dd>{result ? result.configured ? values(result.configured) : t('configuration.unverified') : values(preview!.before)}</dd>
        <dt>{t('configuration.effective')}</dt><dd>{result?.effective ? values(result.effective) : t('configuration.unverified')}</dd>
        <dt>{t('configuration.generation')}</dt><dd>{result?.runtimeGeneration ?? t('configuration.unverified')}</dd>
      </dl>}
      {result && <p role="status" data-testid={`project-config-result-${workspaceId}`}>{t(`configuration.phase.${result.phase}`)}</p>}
    </div>
  </details>;
}
