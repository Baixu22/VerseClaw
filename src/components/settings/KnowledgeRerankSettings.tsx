import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hostApi } from '@/lib/host-api';
import { RERANK_MODEL_MANIFEST, type KnowledgeRerankSelection, type KnowledgeRerankStatus } from '@shared/knowledge/rerank';

export function KnowledgeRerankSettings() {
  const { t } = useTranslation('settings');
  const [selection, setSelection] = useState<KnowledgeRerankSelection>({ mode: 'remote', providerRef: 'siliconflow', model: RERANK_MODEL_MANIFEST[0].model });
  const [status, setStatus] = useState<KnowledgeRerankStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const edited = useRef(false);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const result = await hostApi.knowledge.rerankStatus();
      if (!active) return;
      if (result.success && result.rerank) {
        setStatus(result.rerank);
        if (!edited.current && result.rerank.mode !== 'disabled') setSelection({ mode: result.rerank.mode,
          providerRef: result.rerank.providerRef, model: result.rerank.model, endpoint: result.rerank.endpoint });
      } else setError(result.error || t('rerank.failed'));
    };
    void refresh();
    return () => { active = false; };
  }, [t]);
  const run = async (operation: () => Promise<Awaited<ReturnType<typeof hostApi.knowledge.rerankStatus>>>) => {
    setBusy(true);
    try {
      const result = await operation();
      if (result.success && result.rerank) { setStatus(result.rerank); setError(undefined); edited.current = false; }
      else setError(result.error || t('rerank.failed'));
    } catch { setError(t('rerank.failed')); }
    finally { setBusy(false); }
  };
  return <section data-testid="knowledge-rerank-settings" className="space-y-4 rounded-xl border border-border/60 bg-surface-modal p-5">
    <div><h2 className="font-serif text-xl font-normal tracking-tight">{t('rerank.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('rerank.description')}</p></div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-sm"><span className="block">{t('rerank.mode')}</span>
        <select data-testid="rerank-mode" className="h-9 rounded-md border border-input bg-surface-input px-3" value={selection.mode}
          disabled={busy} onChange={event => { edited.current = true; setSelection({ ...selection, mode: event.target.value as 'local' | 'remote' }); }}>
          <option value="local">{t('rerank.local')}</option><option value="remote">{t('rerank.remote')}</option>
        </select></label>
      <label className="min-w-64 space-y-1 text-sm"><span className="block">{t('rerank.model')}</span>
        <select data-testid="rerank-model" className="h-9 w-full rounded-md border border-input bg-surface-input px-3" value={selection.model}
          disabled={busy} onChange={event => { edited.current = true; setSelection({ ...selection, model: event.target.value }); }}>
          {RERANK_MODEL_MANIFEST.map(entry => <option key={entry.model} value={entry.model}>{entry.model}</option>)}
        </select></label>
      {selection.mode === 'remote' ? <label className="min-w-48 space-y-1 text-sm"><span className="block">{t('rerank.provider')}</span>
        <Input data-testid="rerank-provider" value={selection.providerRef || ''} disabled={busy}
          onChange={event => { edited.current = true; setSelection({ ...selection, providerRef: event.target.value }); }} /></label> :
        <label className="min-w-64 space-y-1 text-sm"><span className="block">{t('rerank.endpoint')}</span>
          <Input data-testid="rerank-endpoint" value={selection.endpoint || ''} placeholder="http://127.0.0.1:9931" disabled={busy}
            onChange={event => { edited.current = true; setSelection({ ...selection, endpoint: event.target.value }); }} /></label>}
      <Button data-testid="rerank-configure" disabled={busy} onClick={() => void run(() => hostApi.knowledge.rerankConfigure(selection))}>{t('rerank.configure')}</Button>
      <Button data-testid="rerank-retry" variant="outline" disabled={busy || !status || status.mode === 'disabled'} onClick={() => void run(() => hostApi.knowledge.rerankRetry())}>{t('rerank.retry')}</Button>
      <Button data-testid="rerank-cancel" variant="outline" disabled={busy || !status || status.mode === 'disabled'} onClick={() => void run(() => hostApi.knowledge.rerankCancel())}>{t('rerank.cancel')}</Button>
      <Button data-testid="rerank-disable" variant="ghost" disabled={busy || !status || status.mode === 'disabled'} onClick={() => void run(() => hostApi.knowledge.rerankDisable())}>{t('rerank.disable')}</Button>
    </div>
    <p data-testid="rerank-status" data-state={status?.status || 'unavailable'} className="text-sm" aria-live="polite">
      {t('rerank.status')}: {t(`rerank.states.${status?.status || 'unavailable'}`)}
      {status?.model && <span className="ml-2 text-muted-foreground">{status.model}</span>}
    </p>
    {(error || status?.error) && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error || t('rerank.failed')}</p>}
  </section>;
}
