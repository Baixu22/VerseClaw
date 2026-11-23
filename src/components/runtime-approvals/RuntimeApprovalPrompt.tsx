import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ComposerDecisionSurface } from '@/components/chat/ComposerDecisionSurface';
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
  requestContent,
  requestPending = false,
}: {
  sessionKey: string;
  agentId?: string;
  hero?: boolean;
  children?: ReactNode;
  requestContent?: ReactNode;
  requestPending?: boolean;
}) {
  const { t } = useTranslation('chat');
  const [pending, setPending] = useState<RuntimeApprovalRequestedEvent[]>([]);
  const [decisionsById, setDecisionsById] = useState<Record<string, { busy: boolean; error: string | null }>>({});
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const previousRequestRef = useRef<string | undefined>(undefined);
  const requestRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(new Set<string>());
  const eventRevision = useRef(0);
  const snapshotSequence = useRef(0);
  const { copiedId, copy } = useCopyToClipboard();

  const refreshPending = useCallback(async () => {
    const revision = eventRevision.current;
    const sequence = ++snapshotSequence.current;
    const result = await hostApi.runtimeApprovals.list();
    // A newer broadcast owns state; a late list must not resurrect a resolved request.
    if (revision === eventRevision.current && sequence === snapshotSequence.current) {
      setPending(result.pending.filter(entry => !entry.expiresAtMs || entry.expiresAtMs > Date.now()));
    }
  }, []);

  useEffect(() => {
    const revision = eventRevision;
    void refreshPending().catch(() => {});
    const off = hostEvents.onGatewayStatus(() => { void refreshPending().catch(() => {}); });
    return () => { revision.current++; off(); };
  }, [refreshPending]);

  useEffect(() => hostEvents.onRuntimeApprovalRequested((event) => {
    eventRevision.current++;
    if (event.expiresAtMs && event.expiresAtMs <= Date.now()) return;
    setPending((current) => mergePendingApprovals(current, [event]));
  }), []);

  useEffect(() => hostEvents.onRuntimeApprovalResolved((event) => {
    eventRevision.current++;
    setPending((current) => current.filter((entry) => entry.approvalId !== event.approvalId));
  }), []);

  useEffect(() => {
    const expires = pending.map(entry => entry.expiresAtMs).filter((value): value is number => typeof value === 'number' && value > 0);
    if (!expires.length) return;
    const timer = setTimeout(() => {
      eventRevision.current++;
      setPending(current => current.filter(entry => !entry.expiresAtMs || entry.expiresAtMs > Date.now()));
      void refreshPending().catch(() => {});
    }, Math.min(2_147_483_647, Math.max(0, Math.min(...expires) - Date.now())));
    return () => clearTimeout(timer);
  }, [pending, refreshPending]);

  const request = pending.find((entry) => entry.sessionKey
    ? entry.sessionKey === sessionKey
    : !entry.agentId || entry.agentId === agentId);
  const requestId = request?.approvalId;
  useLayoutEffect(() => {
    if (requestId && (document.activeElement === document.body || inputRef.current?.contains(document.activeElement) || requestRef.current?.contains(document.activeElement))) {
      titleRef.current?.focus({ preventScroll: true });
    } else if (!requestId && previousRequestRef.current && document.activeElement === document.body) {
      const next = requestPending ? requestRef.current?.querySelector<HTMLElement>('h2') : inputRef.current?.querySelector('textarea');
      next?.focus({ preventScroll: true });
    }
    previousRequestRef.current = requestId;
  }, [requestId, requestPending]);

  const decisions = [...(request?.allowedDecisions.length ? request.allowedDecisions : FALLBACK_DECISIONS)]
    .sort((left, right) => (DECISION_ORDER[left] ?? 1) - (DECISION_ORDER[right] ?? 1));
  const copied = copiedId === requestId;
  const busy = requestId ? Boolean(decisionsById[requestId]?.busy) : false;
  const error = requestId ? decisionsById[requestId]?.error : null;

  const decide = async (decision: string) => {
    if (!request || busy || submitting.current.has(request.approvalId)) return;
    const approvalId = request.approvalId;
    submitting.current.add(approvalId);
    setDecisionsById((current) => ({ ...current, [approvalId]: { busy: true, error: null } }));
    try {
      const result = await hostApi.runtimeApprovals.resolve({
        approvalId,
        decision,
      });
      if (!result.success) {
        void refreshPending().catch(() => {});
        setDecisionsById((current) => ({ ...current, [approvalId]: { busy: false, error: result.error ?? t('runtimeApprovals.resolveFailed') } }));
        return;
      }
      setPending((current) => current.filter((entry) => entry.approvalId !== approvalId));
    } catch (cause) {
      void refreshPending().catch(() => {});
      setDecisionsById((current) => ({ ...current, [approvalId]: { busy: false, error: cause instanceof Error ? cause.message : String(cause) } }));
    } finally {
      submitting.current.delete(approvalId);
      setDecisionsById((current) => ({ ...current, [approvalId]: { ...current[approvalId], busy: false } }));
    }
  };

  return (
    <div className="relative shrink-0" data-testid="chat-composer-slot" data-composer-decision-active={Boolean(request) || requestPending}>
      <div ref={requestRef} hidden={Boolean(request)} inert={Boolean(request)}>{requestContent}</div>
      <div ref={inputRef} hidden={Boolean(request) || requestPending} inert={Boolean(request) || requestPending}>
        {children}
      </div>
      {request && (
      <ComposerDecisionSurface title={t('runtimeApprovals.title')} description={t('runtimeApprovals.description')}
        icon={ShieldQuestion} titleRef={titleRef} hero={hero} testId="runtime-approval-prompt" kind="runtime-approval"
        count={pending.filter(entry => entry.sessionKey ? entry.sessionKey === sessionKey : !entry.agentId || entry.agentId === agentId).length}
        footer={<>
          {error && <p className="composer-decision-error" role="alert">{error}</p>}
          <div className="composer-decision-actions" aria-busy={busy}>
            {decisions.map(decision => <Button key={decision} type="button" disabled={busy} onClick={() => void decide(decision)}
              data-testid={`runtime-approval-${decision}`} variant={decision === 'allow-once' ? 'default' : 'ghost'}
              className={decision === 'deny' ? 'composer-decision-deny mr-auto' : undefined}>
              {DECISION_LABEL_KEYS[decision] ? t(DECISION_LABEL_KEYS[decision]) : decision}
            </Button>)}
          </div>
          {busy && <p className="composer-decision-description text-right" role="status">{t('runtimeApprovals.busy')}</p>}
        </>}
      >
        <dl className="space-y-3" data-testid="runtime-approval-details" data-session-key={request.sessionKey ?? sessionKey}>
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
                className="composer-decision-command"
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

      </ComposerDecisionSurface>
      )}
    </div>
  );
}
