import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hostApi } from '@/lib/host-api';
import type { KnowledgeEmbeddingSelection, KnowledgeEmbeddingStatus, KnowledgeEmbeddingStatusResult } from '@shared/knowledge/embedding';

export function KnowledgeEmbeddingSettings() {
  const { t } = useTranslation('settings');
  const [selection, setSelection] = useState<KnowledgeEmbeddingSelection>({ mode: 'remote', providerRef: 'siliconflow' });
  const [status, setStatus] = useState<KnowledgeEmbeddingStatus>();
  const [error, setError] = useState<string>();
  const [pollError, setPollError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const selectionEdited = useRef(false);
  const apply = useCallback((result: KnowledgeEmbeddingStatusResult) => {
    if (result.success && result.embedding) { setStatus(result.embedding); setError(undefined); }
    else setError(result.error || t('embedding.failed'));
  }, [t]);
  useEffect(() => {
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await hostApi.knowledge.embeddingStatus();
        if (active) {
          if (result.success && result.embedding) {
            setStatus(result.embedding); setPollError(undefined); setLoaded(true);
            if (!selectionEdited.current && result.embedding.mode !== 'disabled') {
              const mode = result.embedding.mode;
              const providerRef = result.embedding.providerRef;
              setSelection(current => ({ mode, providerRef: mode === 'remote' ? providerRef ?? current.providerRef : current.providerRef }));
            }
          }
          else setPollError(result.error || t('embedding.failed'));
        }
      } catch { if (active) setPollError(t('embedding.failed')); }
      finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [t]);
  const run = async (operation: () => Promise<KnowledgeEmbeddingStatusResult>) => {
    setBusy(true);
    try { const result = await operation(); apply(result); if (result.success) selectionEdited.current = false; }
    catch { setError(t('embedding.failed')); }
    finally { setBusy(false); }
  };
  const working = status?.status === 'installing' || status?.status === 'warming';
  return (
    <section data-testid="knowledge-embedding-settings" className="space-y-4 rounded-xl border border-border/60 bg-surface-modal p-5">
      <div>
        <h2 className="font-serif text-xl font-normal tracking-tight">{t('embedding.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('embedding.description')}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block">{t('embedding.mode')}</span>
          <select data-testid="embedding-mode" className="h-9 rounded-md border border-input bg-surface-input px-3" value={selection.mode}
            disabled={busy || working || !loaded} onChange={event => { selectionEdited.current = true; setSelection({ ...selection, mode: event.target.value as 'local' | 'remote' }); }}>
            <option value="local">{t('embedding.local')}</option>
            <option value="remote">{t('embedding.remote')}</option>
          </select>
        </label>
        {selection.mode === 'remote' && <label className="min-w-48 flex-1 space-y-1 text-sm">
          <span className="block">{t('embedding.provider')}</span>
          <Input data-testid="embedding-provider" value={selection.providerRef || ''} disabled={busy || working || !loaded}
            onChange={event => { selectionEdited.current = true; setSelection({ ...selection, providerRef: event.target.value }); }} />
        </label>}
        <Button data-testid="embedding-configure" disabled={busy || working || !loaded} onClick={() => void run(() => hostApi.knowledge.embeddingConfigure(selection))}>{t('embedding.configure')}</Button>
        <Button data-testid="embedding-retry" variant="outline" disabled={busy || working || !status || status.mode === 'disabled'} onClick={() => void run(() => hostApi.knowledge.embeddingRetry())}>{t('embedding.retry')}</Button>
        <Button data-testid="embedding-cancel" variant="outline" disabled={busy || !working} onClick={() => void run(() => hostApi.knowledge.embeddingCancel())}>{t('embedding.cancel')}</Button>
        <Button data-testid="embedding-disable" variant="ghost" disabled={busy || !status || status.mode === 'disabled'} onClick={() => void run(() => hostApi.knowledge.embeddingDisable())}>{t('embedding.disable')}</Button>
      </div>
      <p data-testid="embedding-status" data-state={status?.status || 'unavailable'} className="text-sm" aria-live="polite">
        {t('embedding.statusLabel')}: {t(`embedding.states.${status?.status || 'unavailable'}`)}
        {status?.model && <span className="ml-2 text-muted-foreground">{status.model}{status.dimensions ? ` · ${status.dimensions}` : ''}</span>}
      </p>
      {status?.progress && <progress className="w-full" value={status.progress.bytes} max={status.progress.total} aria-label={t('embedding.progress')} />}
      {(error || pollError || status?.error) && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error || pollError || t('embedding.failed')}</p>}
    </section>
  );
}
