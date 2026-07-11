import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApprovalCard } from '@/components/tool-ui/approval-card';
import type { PermissionApprovalDecision, PermissionApprovalEvent } from '@shared/types/workspace';

type PendingRunApprovalsProps = {
  approvals: PermissionApprovalEvent[];
  onDecision: (id: string, decision: PermissionApprovalDecision) => Promise<void>;
};

type ApprovalUiState = {
  busy: boolean;
  choice?: PermissionApprovalDecision;
};

export function PendingRunApprovals({ approvals, onDecision }: PendingRunApprovalsProps) {
  const { t } = useTranslation('chat');
  const [states, setStates] = useState<Record<string, ApprovalUiState>>({});

  if (approvals.length === 0) return null;

  const decide = async (approval: PermissionApprovalEvent, decision: PermissionApprovalDecision) => {
    if (states[approval.id]?.busy || states[approval.id]?.choice) return;
    setStates((current) => ({
      ...current,
      [approval.id]: { ...current[approval.id], busy: true },
    }));
    try {
      await onDecision(approval.id, decision);
      setStates((current) => ({
        ...current,
        [approval.id]: { busy: false, choice: decision },
      }));
    } catch {
      setStates((current) => ({
        ...current,
        [approval.id]: { ...current[approval.id], busy: false },
      }));
    }
  };

  return (
    <section
      className="space-y-2"
      data-testid="chat-run-pending-approvals"
      aria-label={t('toolUi.approval.host.title')}
    >
      {approvals.map((approval) => {
        const state = states[approval.id];
        const metadata = [
          { key: t(`approvals.source.${approval.source}`), value: approval.cwd ?? approval.source },
          { key: t(`approvals.risk.${approval.risk}`), value: approval.command ?? approval.paths?.join(', ') ?? '' },
        ].filter((item) => item.value);

        return (
          <div key={approval.id} className="space-y-1.5">
            <fieldset disabled={state?.busy || Boolean(state?.choice)} className="min-w-0">
              <ApprovalCard
                id={approval.id}
                title={t('toolUi.approval.host.title')}
                description={approval.reason || approval.command || approval.paramsPreview}
                icon="shield-alert"
                metadata={metadata}
                variant={approval.risk === 'dangerous' ? 'destructive' : 'default'}
                confirmLabel={t('toolUi.approval.host.approve')}
                cancelLabel={t('toolUi.approval.host.deny')}
                choice={state?.choice}
                onConfirm={() => decide(approval, 'approved')}
                onCancel={() => decide(approval, 'denied')}
                className="max-w-none"
              />
            </fieldset>
            {state?.choice && (
              <p className="px-1 text-xs text-muted-foreground" role="status">
                {t('toolUi.approval.host.retryRequired')}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}
