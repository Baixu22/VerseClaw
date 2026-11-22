import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, ListChecks, ShieldQuestion } from 'lucide-react';
import { ComposerDecisionSurface } from '@/components/chat/ComposerDecisionSurface';
import { AgentInteractionRenderer, type ToolUiInteraction } from '@/components/tool-ui/agent-interactions';
import { PendingRunApprovals } from '@/components/tool-ui/PendingRunApprovals';
import { isIrreversibleApproval } from '@/lib/permission-approval-display';
import type { PermissionApprovalDecision, PermissionApprovalEvent } from '@shared/types/workspace';

export function ComposerRequestDock({ approvals, interactions, canSubmit, onDecision, onSubmit }: {
  approvals: PermissionApprovalEvent[];
  interactions: ToolUiInteraction[];
  canSubmit: boolean;
  onDecision: (id: string, decision: PermissionApprovalDecision) => Promise<void>;
  onSubmit: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation('chat');
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousRequest = useRef<string | undefined>(undefined);
  const requestId = approvals[0]?.id ?? interactions[0]?.id;
  useLayoutEffect(() => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-composer-input"]');
    if (requestId && requestId !== previousRequest.current
      && (document.activeElement === document.body || document.activeElement === input)) {
      titleRef.current?.focus({ preventScroll: true });
    } else if (!requestId && previousRequest.current && document.activeElement === document.body) {
      input?.focus({ preventScroll: true });
    }
    previousRequest.current = requestId;
  }, [requestId]);
  const count = approvals.length + interactions.length;
  const hasHostApproval = approvals.length > 0;
  const isPermission = hasHostApproval || interactions[0]?.type === 'approval-card';
  const isPlan = interactions[0]?.type === 'plan';
  if (!count) return null;
  const submit = async (text: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try { await onSubmit(text); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return (
    <ComposerDecisionSurface
      title={!hasHostApproval && interactions[0]?.type === 'approval-card' ? interactions[0].title
        : t(isPermission ? 'toolUi.approval.host.title' : isPlan ? 'composerRequests.planTitle' : 'composerRequests.questionTitle')}
      description={t('composerRequests.resumeHint')}
      icon={isPermission ? ShieldQuestion : isPlan ? ListChecks : HelpCircle}
      tone={hasHostApproval ? (isIrreversibleApproval(approvals[0]) ? 'danger' : 'warning')
        : interactions[0]?.type === 'approval-card' && interactions[0].variant === 'destructive' ? 'danger' : undefined}
      kind={isPermission ? 'permission' : isPlan ? 'plan' : 'question'} count={count} titleRef={titleRef} testId="chat-composer-requests"
    >
        <PendingRunApprovals approvals={approvals.slice(0, 1)} onDecision={onDecision} presentation="composer" />
        {interactions.length > 0 && (
          <fieldset disabled={busy} hidden={hasHostApproval} inert={hasHostApproval} className="min-w-0" aria-busy={busy}>
            <AgentInteractionRenderer presentation="composer" interactions={[interactions[0]]} canSubmit={canSubmit} onSubmitResponse={(text) => void submit(text)} />
          </fieldset>
        )}
      {error && !hasHostApproval && <p className="composer-decision-error" role="alert">{error}</p>}
    </ComposerDecisionSurface>
  );
}
