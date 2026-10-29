import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/components/tool-ui/shared/use-copy-to-clipboard';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import type { RuntimeApprovalRequestedEvent } from '@shared/host-events/contract';

/**
 * The active conversation's composer replacement for runtime exec approvals.
 *
 * The runtime raises `exec.approval.requested` when its exec policy gates a
 * command, and waits. Without an answer the turn hangs (J-04). This prompt shows
 * the pending request and sends back exactly one decision the runtime already
 * offered for it. The original composer stays mounted while hidden, preserving
 * its draft and staged attachments. Other sessions remain usable.
 */

const FALLBACK_DECISIONS = ['allow-once', 'deny'];
const DECISION_ORDER: Record<string, number> = { deny: 0, 'allow-always': 1, 'allow-once': 2 };

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

export function RuntimeApprovalPrompt({
  sessionKey,
  agentId,
  hero = false,
  children,
}: {
  sessionKey: string;
  agentId?: string;
  hero?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation('chat');
  const [pending, setPending] = useState<RuntimeApprovalRequestedEvent[]>([]);
  const [decisionsById, setDecisionsById] = useState<Record<string, { busy: boolean; error: string | null }>>({});
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const previousRequestRef = useRef<string | undefined>(undefined);
  const titleId = useId();
  const descriptionId = useId();
  const { copiedId, copy } = useCopyToClipboard();

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

  const request = pending.find((entry) => entry.sessionKey
    ? entry.sessionKey === sessionKey
    : !entry.agentId || entry.agentId === agentId);
  const requestId = request?.approvalId;
  useLayoutEffect(() => {
    if (requestId && (document.activeElement === document.body || inputRef.current?.contains(document.activeElement))) {
      titleRef.current?.focus({ preventScroll: true });
    } else if (!requestId && previousRequestRef.current && document.activeElement === document.body) {
      inputRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
    }
    previousRequestRef.current = requestId;
  }, [requestId]);

  const decisions = [...(request?.allowedDecisions.length ? request.allowedDecisions : FALLBACK_DECISIONS)]
    .sort((left, right) => (DECISION_ORDER[left] ?? 1) - (DECISION_ORDER[right] ?? 1));
  const copied = copiedId === requestId;
  const busy = requestId ? Boolean(decisionsById[requestId]?.busy) : false;
  const error = requestId ? decisionsById[requestId]?.error : null;

  const decide = async (decision: string) => {
    if (!request || busy) return;
    const approvalId = request.approvalId;
    setDecisionsById((current) => ({ ...current, [approvalId]: { busy: true, error: null } }));
    try {
      const result = await hostApi.runtimeApprovals.resolve({
        approvalId,
        decision,
      });
      if (!result.success) {
        setDecisionsById((current) => ({ ...current, [approvalId]: { busy: false, error: result.error ?? t('runtimeApprovals.resolveFailed') } }));
        return;
      }
      setPending((current) => current.filter((entry) => entry.approvalId !== approvalId));
    } catch (cause) {
      setDecisionsById((current) => ({ ...current, [approvalId]: { busy: false, error: cause instanceof Error ? cause.message : String(cause) } }));
    } finally {
      setDecisionsById((current) => ({ ...current, [approvalId]: { ...current[approvalId], busy: false } }));
    }
  };

  return (
    <div className="relative shrink-0" data-testid="chat-composer-slot">
      <div ref={inputRef} hidden={Boolean(request)} inert={Boolean(request)}>
        {children}
      </div>
      {request && (
      <div className={cn('codex-composer-host mx-auto w-full max-w-[768px] px-4 pb-5 pt-2', hero && 'codex-composer-host--hero')}>
      <section
        className="flex max-h-[min(60dvh,420px)] flex-col overflow-hidden rounded-[25px] border border-border bg-surface-modal shadow-lg"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="runtime-approval-prompt"
        data-session-key={request.sessionKey ?? sessionKey}
      >
        <div className="flex shrink-0 items-start gap-3 px-4 pb-2 pt-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-input text-muted-foreground" aria-hidden="true">
            <ShieldQuestion className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="font-sans text-sm font-semibold leading-5 tracking-normal outline-none">
              {t('runtimeApprovals.title')}
            </h2>
            <p id={descriptionId} className="mt-1 text-xs leading-5 text-muted-foreground">
              {t('runtimeApprovals.description')}
            </p>
          </div>
        </div>

        <dl className="min-h-0 space-y-3 overflow-y-auto px-4 pb-3" data-testid="runtime-approval-details">
          <div className="min-w-0">
            <dt className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
              {t('runtimeApprovals.commandLabel')}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={!request.command}
                aria-label={t(copied ? 'runtimeApprovals.commandCopied' : 'runtimeApprovals.copyCommand')}
                title={t(copied ? 'runtimeApprovals.commandCopied' : 'runtimeApprovals.copyCommand')}
                onClick={() => void copy(request.command, request.approvalId)}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </dt>
            <dd className="mt-1">
              <pre
                tabIndex={0}
                aria-label={t('runtimeApprovals.commandLabel')}
                data-testid="runtime-approval-command"
                className="max-h-32 overflow-auto overscroll-contain whitespace-pre rounded-lg border border-border/60 bg-surface-input px-3 py-2 font-mono text-xs leading-5 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {request.command || t('runtimeApprovals.unknownCommand')}
              </pre>
            </dd>
          </div>
          {request.cwd ? (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">
                {t('runtimeApprovals.cwdLabel')}
              </dt>
              <dd className="mt-2 break-words font-mono text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{request.cwd}</dd>
            </div>
          ) : null}
        </dl>

        <div className="shrink-0 space-y-2 border-t border-border/70 px-4 py-3">
          {error ? (
            <p className="break-words text-xs leading-5 text-red-700 dark:text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2" aria-busy={busy}>
            {decisions.map((decision) => {
              const labelKey = DECISION_LABEL_KEYS[decision];
              const deny = decision === 'deny';
              return (
                <Button
                  key={decision}
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(decision)}
                  data-testid={`runtime-approval-${decision}`}
                  variant={decision === 'allow-once' ? 'default' : deny ? 'ghost' : 'outline'}
                  className={deny ? 'mr-auto' : undefined}
                >
                  {labelKey ? t(labelKey) : decision}
                </Button>
              );
            })}
          </div>

          {busy ? (
            <p className="text-right text-xs text-muted-foreground" role="status">
              {t('runtimeApprovals.busy')}
            </p>
          ) : null}
        </div>
      </section>
      </div>
      )}
    </div>
  );
}
