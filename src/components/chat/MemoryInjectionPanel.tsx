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
import { AlertTriangle, PackageOpen, RefreshCw } from 'lucide-react';
import { X } from '@/components/icons/codex-icons';
import { OrbStatus } from '@/components/assistant-ui/orb-status';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
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

  // The raw error is technical detail; show it only when it adds something
  // beyond the sentence the panel already says.
  const errorDetail = error && error !== t('memoryInjection.errorGeneric') ? error : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Same floating-card material as the session environment card: raised
          surface, 20px corner, hairline + soft shadow, one header recipe. */}
      <DialogContent
        className="memory-injection-card flex max-h-[min(640px,calc(100vh-4rem))] w-[calc(100%-2rem)] max-w-[560px] flex-col overflow-hidden rounded-2xl border-0 bg-surface-modal p-0 text-foreground"
        data-testid="memory-injection-panel"
      >
        <header className="flex items-start gap-3 border-b border-border px-4 pb-3 pt-4">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground" aria-hidden="true">
            <PackageOpen className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <DialogTitle className="text-sm font-medium leading-5">
              {t('memoryInjection.title')}
            </DialogTitle>
            <DialogDescription className="text-xs leading-[18px] text-muted-foreground">
              {t('memoryInjection.description')}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              data-testid="memory-injection-refresh"
              className="memory-injection-card__action"
              onClick={() => void load()}
              disabled={loading}
              aria-label={t('memoryInjection.refresh')}
              title={t('memoryInjection.refresh')}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden="true" />
            </button>
            <DialogClose className="memory-injection-card__action" aria-label={t('common:actions.close')} title={t('common:actions.close')}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </DialogClose>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" data-testid="memory-injection-body">
          {loading && !loaded && (
            <div
              className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground"
              data-testid="memory-injection-loading"
            >
              <OrbStatus state="loading" label={t('memoryInjection.loading')} className="size-3.5" />
              {t('memoryInjection.loading')}
            </div>
          )}

          {error && (
            <div
              className="flex flex-col items-center gap-2 px-6 py-10 text-center"
              data-testid="memory-injection-error"
            >
              <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <p className="max-w-sm text-xs leading-[18px] text-foreground/80">
                {t('memoryInjection.errorTimeout')}
              </p>
              {errorDetail && (
                <p className="max-w-sm break-words font-mono text-2xs text-muted-foreground">{errorDetail}</p>
              )}
              <button
                type="button"
                className="memory-injection-card__pill mt-1"
                onClick={() => void load()}
                disabled={loading}
              >
                {t('memoryInjection.retry')}
              </button>
            </div>
          )}

          {!error && loaded && receipts.length === 0 && (
            <div
              className="flex flex-col items-center gap-2 px-6 py-10 text-center text-xs leading-[18px] text-muted-foreground"
              data-testid="memory-injection-empty"
            >
              <PackageOpen className="h-4 w-4 opacity-70" aria-hidden="true" />
              <p className="max-w-sm">{t('memoryInjection.empty')}</p>
            </div>
          )}

          {!error && receipts.length > 0 && (
            <div className="space-y-1" data-testid="memory-injection-groups">
              <p className="px-2 pb-1 pt-0.5 text-xs text-muted-foreground">
                {t('memoryInjection.summary', { selected: totalSelected, omitted: totalOmitted })}
              </p>
              {groups.map((group) => (
                <section
                  key={group.source}
                  className="memory-injection-card__group"
                  data-testid="memory-injection-source-group"
                  data-source={group.source}
                >
                  <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-2 py-1.5">
                    <span className="min-w-0 truncate font-mono text-xs text-foreground" title={group.source}>{group.source}</span>
                    <span className="flex items-center gap-2 text-2xs tabular-nums text-muted-foreground">
                      <span>{t('memoryInjection.selectedCount', { count: group.selectedCount })}</span>
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
                  <div>
                    {group.receipts.map((receipt, index) => (
                      <div
                        key={`${group.source}-${receipt.createdAt}-${index}`}
                        className="memory-injection-card__receipt"
                        data-testid="memory-injection-receipt"
                      >
                        <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                          <span className="tabular-nums">{formatReceiptTime(receipt.createdAt)}</span>
                          {receipt.budgetCharsRequested > receipt.budgetCharsApplied && (
                            <span className="text-amber-700 dark:text-amber-400">
                              {t('memoryInjection.trimmed')}
                            </span>
                          )}
                        </div>
                        {receipt.selected.length > 0 && (
                          <ul className="space-y-0.5" data-testid="memory-injection-selected">
                            {receipt.selected.map((ref) => (
                              <li key={ref} className="truncate font-mono text-2xs text-foreground/90" title={ref}>
                                {ref}
                              </li>
                            ))}
                          </ul>
                        )}
                        {receipt.omitted.length > 0 && (
                          <details data-testid="memory-injection-omitted">
                            <summary className="cursor-pointer text-2xs text-muted-foreground hover:text-foreground">
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
