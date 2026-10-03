/**
 * R3-2.4 proposeFacts manual-confirm queue.
 *
 * Reuses the knowledge-confirmation pattern (AgencyRolePromotionPanel): a
 * reviewer sees pending runtime-memory fact candidates and confirms them one by
 * one. Confirm routes through hostApi.memory.proposeFactsConfirm, which on the
 * runtime runs the SINGLE approved composition — assertRuntimeMemoryOwnerConvergence
 * (R3-1 E-1 gate) -> promoteRuntimeMemoryFactCandidate -> P0-B appendFact. No new
 * write authority is created here.
 *
 * Default-off: the list RPC returns enabled=false unless the runtime
 * shadow + proposeFacts flags are on, so this panel shows a disabled notice and
 * confirming is impossible. It never touches productApproved / liveReady /
 * default-on.
 *
 * A confirm returning confirmed=false (owner convergence blocked, or persistence
 * disabled) is a legitimate outcome, surfaced as a warning — distinct from an RPC
 * error.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BadgeCheck, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { MemoryProposeFactsCandidate } from '@shared/host-api/contract';

function formatConfidence(confidence: number | null): string | null {
  if (confidence == null || !Number.isFinite(confidence)) return null;
  return `${Math.round(confidence * 100)}%`;
}

export function ProposeFactsConfirmQueue() {
  const { t } = useTranslation('agents');
  const [candidates, setCandidates] = useState<MemoryProposeFactsCandidate[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.memory.proposeFactsList({});
      if (!result.success) {
        throw new Error(result.error ?? t('proposeFacts.errorLoad'));
      }
      setEnabled(result.enabled);
      setCandidates(result.candidates ?? []);
      setLoaded(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirm = useCallback(
    async (candidate: MemoryProposeFactsCandidate) => {
      setConfirmingId(candidate.factId);
      try {
        const result = await hostApi.memory.proposeFactsConfirm({ factId: candidate.factId });
        if (!result.success) {
          throw new Error(result.error ?? t('proposeFacts.errorConfirm'));
        }
        if (result.confirmed) {
          toast.success(t('proposeFacts.confirmed'));
          setCandidates((current) => current.filter((entry) => entry.factId !== candidate.factId));
        } else {
          // Owner-convergence blocked or persistence disabled — a legitimate
          // "not persisted" outcome, not an RPC error. Keep the row.
          toast.warning(result.message || t('proposeFacts.notConfirmed'));
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setConfirmingId(null);
      }
    },
    [t],
  );

  return (
    <section
      className="space-y-4 border-t border-border/60 pt-4"
      data-testid="propose-facts-confirm-queue"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium">{t('proposeFacts.title')}</h3>
          </div>
          <p className="max-w-2xl text-xs text-muted-foreground">{t('proposeFacts.description')}</p>
        </div>
        <Button
          data-testid="propose-facts-refresh"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => void load()}
          disabled={loading}
          aria-label={t('proposeFacts.refresh')}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
        </Button>
      </div>

      {loading && !loaded && (
        <div
          className="flex items-center gap-2 py-6 text-xs text-muted-foreground"
          data-testid="propose-facts-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('proposeFacts.loading')}
        </div>
      )}

      {loaded && !enabled && (
        <p
          className="rounded-md bg-surface-input px-3 py-2.5 text-xs text-muted-foreground"
          data-testid="propose-facts-disabled"
        >
          {t('proposeFacts.disabled')}
        </p>
      )}

      {loaded && enabled && candidates.length === 0 && (
        <div
          className="flex flex-col items-center gap-2 py-6 text-center text-xs text-muted-foreground"
          data-testid="propose-facts-empty"
        >
          <CheckCircle2 className="h-5 w-5 opacity-60" aria-hidden="true" />
          <p>{t('proposeFacts.empty')}</p>
        </div>
      )}

      {enabled && candidates.length > 0 && (
        <ul className="space-y-2" data-testid="propose-facts-list">
          {candidates.map((candidate) => {
            const confidence = formatConfidence(candidate.confidence);
            return (
              <li
                key={candidate.factId}
                className="rounded-lg border border-border/60 bg-surface-input px-3 py-2.5"
                data-testid="propose-facts-candidate"
                data-fact-id={candidate.factId}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm text-foreground">
                      <span className="font-medium">{candidate.subject}</span>{' '}
                      <span className="text-muted-foreground">{candidate.predicate}</span>{' '}
                      <span>{candidate.objectSummary}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                      <span className="font-mono">{candidate.source}</span>
                      {confidence && <span>{t('proposeFacts.confidence', { value: confidence })}</span>}
                    </div>
                  </div>
                  <Button
                    data-testid="propose-facts-confirm"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={confirmingId === candidate.factId}
                    onClick={() => void confirm(candidate)}
                  >
                    {confirmingId === candidate.factId ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <BadgeCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {t('proposeFacts.confirm')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default ProposeFactsConfirmQueue;
