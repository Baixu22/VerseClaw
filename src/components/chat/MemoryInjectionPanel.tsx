/**
 * R3-2.2 "本轮注入了什么" — memory-injection receipt panel.
 *
 * Reads the sanitized COMPASS pre-reply injection receipts persisted through the
 * approved ReceiptStore (openclaw_runtime context-engine) and renders them the way
 * Claude Code `/context` does: grouped by producer source, with each group showing
 * what was selected into the prompt, what the char budget trimmed (omitted), and
 * the applied-vs-requested budget.
 *
 * The receipt contract is refs/counts/source only — never raw injected content —
 * so this panel can never leak memory text. Data comes solely from the receipt
 * read (hostApi.memory.injectionReceipts); there is no separate channel.
 *
 * Three states the E2E spec pins:
 *   injected — at least one receipt with selected refs.
 *   none     — the read succeeded but returned zero receipts (retrieval was off
 *              this round, or nothing was injected).
 *   timeout  — the read failed (gateway unavailable / RPC timeout); the panel
 *              shows a retryable error rather than a silent empty state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, PackageOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { MemoryInjectionReceiptEntry } from '@shared/host-api/contract';

type MemoryInjectionPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionKey: string;
};

type SourceGroup = {
  source: string;
  receipts: MemoryInjectionReceiptEntry[];
  selectedCount: number;
  omittedCount: number;
  charsApplied: number;
  charsRequested: number;
};

function groupBySource(receipts: MemoryInjectionReceiptEntry[]): SourceGroup[] {
  const bySource = new Map<string, SourceGroup>();
  for (const receipt of receipts) {
    const key = receipt.source || 'unknown';
    const group = bySource.get(key) ?? {
      source: key,
      receipts: [],
      selectedCount: 0,
      omittedCount: 0,
      charsApplied: 0,
      charsRequested: 0,
    };
    group.receipts.push(receipt);
    group.selectedCount += receipt.selected.length;
    group.omittedCount += receipt.omitted.length;
    group.charsApplied += receipt.budgetCharsApplied;
    group.charsRequested += receipt.budgetCharsRequested;
    bySource.set(key, group);
  }
  return [...bySource.values()];
}

function formatReceiptTime(createdAt: number): string {
  try {
    return new Date(createdAt).toLocaleString();
  } catch {
    return String(createdAt);
  }
}

export function MemoryInjectionPanel({ open, onOpenChange, sessionKey }: MemoryInjectionPanelProps) {
  const { t } = useTranslation('chat');
  const [receipts, setReceipts] = useState<MemoryInjectionReceiptEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!open || !sessionKey) return;
    setLoading(true);
    setError(null);
    try {
      const result = await hostApi.memory.injectionReceipts({ sessionKey });
      if (!result.success) {
        throw new Error(result.error ?? t('memoryInjection.errorGeneric'));
      }
      setReceipts(result.receipts ?? []);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [open, sessionKey, t]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const groups = useMemo(() => groupBySource(receipts), [receipts]);
  const totalSelected = useMemo(
    () => receipts.reduce((sum, receipt) => sum + receipt.selected.length, 0),
    [receipts],
  );
  const totalOmitted = useMemo(
    () => receipts.reduce((sum, receipt) => sum + receipt.omitted.length, 0),
    [receipts],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden bg-surface-modal p-0">
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="min-w-0 space-y-1">
            <DialogTitle className="flex items-center gap-2 text-sm font-medium">
              <PackageOpen className="h-4 w-4 text-primary" />
              {t('memoryInjection.title')}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t('memoryInjection.description')}
            </DialogDescription>
          </div>
          <Button
            data-testid="memory-injection-refresh"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => void load()}
            disabled={loading}
            aria-label={t('memoryInjection.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4" data-testid="memory-injection-body">
          {loading && !loaded && (
            <div
              className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground"
              data-testid="memory-injection-loading"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('memoryInjection.loading')}
            </div>
          )}

          {error && (
            <div
              className="flex flex-col items-center gap-3 py-10 text-center"
              data-testid="memory-injection-error"
            >
              <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              <p className="max-w-md text-xs text-amber-700 dark:text-amber-400">
                {t('memoryInjection.errorTimeout')}
              </p>
              <p className="max-w-md break-words text-2xs text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                {t('memoryInjection.retry')}
              </Button>
            </div>
          )}

          {!error && loaded && receipts.length === 0 && (
            <div
              className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground"
              data-testid="memory-injection-empty"
            >
              <PackageOpen className="h-5 w-5 opacity-60" aria-hidden="true" />
              <p className="max-w-md">{t('memoryInjection.empty')}</p>
            </div>
          )}

          {!error && receipts.length > 0 && (
            <div className="space-y-4" data-testid="memory-injection-groups">
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">
                {t('memoryInjection.summary', { selected: totalSelected, omitted: totalOmitted })}
              </p>
              {groups.map((group) => (
                <section
                  key={group.source}
                  className="rounded-lg border border-border/60 bg-surface-input"
                  data-testid="memory-injection-source-group"
                  data-source={group.source}
                >
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
                    <span className="font-mono text-xs text-foreground">{group.source}</span>
                    <span className="flex items-center gap-3 text-2xs text-muted-foreground">
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {t('memoryInjection.selectedCount', { count: group.selectedCount })}
                      </span>
                      {group.omittedCount > 0 && (
                        <span className="text-amber-700 dark:text-amber-400">
                          {t('memoryInjection.omittedCount', { count: group.omittedCount })}
                        </span>
                      )}
                      <span>
                        {t('memoryInjection.budget', {
                          applied: group.charsApplied,
                          requested: group.charsRequested,
                        })}
                      </span>
                    </span>
                  </header>
                  <div className="space-y-2 px-3 py-2">
                    {group.receipts.map((receipt, index) => (
                      <div
                        key={`${group.source}-${receipt.createdAt}-${index}`}
                        className="space-y-1.5 rounded-md bg-black/5 px-2.5 py-2 dark:bg-white/10"
                        data-testid="memory-injection-receipt"
                      >
                        <div className="flex items-center justify-between text-2xs text-muted-foreground">
                          <span>{formatReceiptTime(receipt.createdAt)}</span>
                          {receipt.budgetCharsRequested > receipt.budgetCharsApplied && (
                            <span className="text-amber-700 dark:text-amber-400">
                              {t('memoryInjection.trimmed')}
                            </span>
                          )}
                        </div>
                        {receipt.selected.length > 0 && (
                          <ul className="space-y-0.5" data-testid="memory-injection-selected">
                            {receipt.selected.map((ref) => (
                              <li key={ref} className="truncate font-mono text-2xs text-foreground" title={ref}>
                                {ref}
                              </li>
                            ))}
                          </ul>
                        )}
                        {receipt.omitted.length > 0 && (
                          <details data-testid="memory-injection-omitted">
                            <summary className="cursor-pointer text-2xs text-amber-700 dark:text-amber-400">
                              {t('memoryInjection.omittedToggle', { count: receipt.omitted.length })}
                            </summary>
                            <ul className="mt-1 space-y-0.5">
                              {receipt.omitted.map((ref) => (
                                <li
                                  key={ref}
                                  className="truncate font-mono text-2xs text-muted-foreground line-through"
                                  title={ref}
                                >
                                  {ref}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
