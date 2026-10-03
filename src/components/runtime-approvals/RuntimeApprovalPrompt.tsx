import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import type { RuntimeApprovalRequestedEvent } from '@shared/host-events/contract';

/**
 * TF-0240: the in-app entry point for the runtime exec-approval boundary.
 *
 * The runtime raises `exec.approval.requested` when its exec policy gates a
 * command, and waits. Without an answer the turn hangs (J-04). This prompt shows
 * the pending request and sends back exactly one decision the runtime already
 * offered for it — it never decides on its own, never invents a decision, and
 * never dismisses a request that is still open.
 */

const FALLBACK_DECISIONS = ['allow-once', 'deny'];

const DECISION_LABEL_KEYS: Record<string, string> = {
  'allow-once': 'runtimeApprovals.allowOnce',
  'allow-always': 'runtimeApprovals.allowAlways',
  deny: 'runtimeApprovals.deny',
};

export function mergePendingApprovals(
  current: RuntimeApprovalRequestedEvent[],
  incoming: RuntimeApprovalRequestedEvent[],
): RuntimeApprovalRequestedEvent[] {
  const byId = new Map(current.map((entry) => [entry.approvalId, entry]));
  for (const entry of incoming) {
    if (entry.approvalId) byId.set(entry.approvalId, entry);
  }
  return [...byId.values()];
}

export function RuntimeApprovalPrompt() {
  const { t } = useTranslation('chat');
  const [pending, setPending] = useState<RuntimeApprovalRequestedEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The broadcast only covers requests raised while the renderer is listening;
  // seed from the runtime's own pending list so a reload does not orphan a request.
  useEffect(() => {
    let cancelled = false;
    void hostApi.runtimeApprovals.list()
      .then((result) => {
        if (!cancelled && result.pending.length > 0) {
          setPending((current) => mergePendingApprovals(current, result.pending));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => hostEvents.onRuntimeApprovalRequested((event) => {
    setPending((current) => mergePendingApprovals(current, [event]));
  }), []);

  useEffect(() => hostEvents.onRuntimeApprovalResolved((event) => {
    setPending((current) => current.filter((entry) => entry.approvalId !== event.approvalId));
  }), []);

  const request = pending[0];
  if (!request) return null;

  const decisions = request.allowedDecisions.length > 0 ? request.allowedDecisions : FALLBACK_DECISIONS;

  const decide = async (decision: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await hostApi.runtimeApprovals.resolve({
        approvalId: request.approvalId,
        decision,
      });
      if (!result.success) {
        setError(result.error ?? t('runtimeApprovals.resolveFailed'));
        return;
      }
      setPending((current) => current.filter((entry) => entry.approvalId !== request.approvalId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => { /* the runtime owns the decision; the prompt stays until it is answered */ }}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-lg rounded-3xl border-0 bg-surface-modal shadow-2xl"
        data-testid="runtime-approval-prompt"
      >
        <DialogTitle className="font-serif text-xl font-normal tracking-tight">
          {t('runtimeApprovals.title')}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('runtimeApprovals.description')}
        </DialogDescription>

        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('runtimeApprovals.commandLabel')}
            </dt>
            <dd className="mt-1 break-all rounded-xl bg-surface-input px-3 py-2 font-mono text-xs">
              {request.command || t('runtimeApprovals.unknownCommand')}
            </dd>
          </div>
          {request.cwd ? (
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('runtimeApprovals.cwdLabel')}
              </dt>
              <dd className="mt-1 break-all text-xs text-muted-foreground">{request.cwd}</dd>
            </div>
          ) : null}
        </dl>

        {error ? (
          <p className="mt-3 text-xs text-red-700 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {decisions.map((decision) => {
            const labelKey = DECISION_LABEL_KEYS[decision];
            const deny = decision === 'deny';
            return (
              <button
                key={decision}
                type="button"
                disabled={busy}
                onClick={() => void decide(decision)}
                data-testid={`runtime-approval-${decision}`}
                className={deny
                  ? 'rounded-xl px-3 py-1.5 text-sm text-foreground hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5'
                  : 'rounded-xl bg-black/5 px-3 py-1.5 text-sm text-foreground hover:bg-black/10 disabled:opacity-50 dark:bg-white/10 dark:hover:bg-white/15'}
              >
                {labelKey ? t(labelKey) : decision}
              </button>
            );
          })}
        </div>

        {busy ? (
          <p className="mt-2 text-right text-xs text-muted-foreground" role="status">
            {t('runtimeApprovals.busy')}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
