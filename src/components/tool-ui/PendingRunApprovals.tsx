import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApprovalCard } from '@/components/tool-ui/approval-card';
import { approvalDisplayDetails, isExternalWriteApproval, isIrreversibleApproval } from '@/lib/permission-approval-display';
import type { PermissionApprovalDecision, PermissionApprovalEvent } from '@shared/types/workspace';

type PendingRunApprovalsProps = {
  presentation?: 'card' | 'composer';
  approvals: PermissionApprovalEvent[];
  onDecision: (id: string, decision: PermissionApprovalDecision) => Promise<void>;
};

type ApprovalUiState = {
  busy: boolean;
  choice?: PermissionApprovalDecision;
  error?: string;
};

export function PendingRunApprovals({ approvals, onDecision, presentation = 'card' }: PendingRunApprovalsProps) {
  const { t } = useTranslation('chat');
  const [states, setStates] = useState<Record<string, ApprovalUiState>>({});
  const submitting = useRef(new Set<string>());

  if (approvals.length === 0) return null;

  const decide = async (approval: PermissionApprovalEvent, decision: PermissionApprovalDecision) => {
    if (submitting.current.has(approval.id) || states[approval.id]?.choice) return;
    submitting.current.add(approval.id);
    setStates((current) => ({
      ...current,
      [approval.id]: { ...current[approval.id], busy: true, error: undefined },
    }));
    try {
      await onDecision(approval.id, decision);
      setStates((current) => ({
        ...current,
        [approval.id]: { busy: false, choice: decision },
      }));
    } catch (cause) {
      setStates((current) => ({
        ...current,
        [approval.id]: { ...current[approval.id], busy: false, error: cause instanceof Error ? cause.message : String(cause) },
      }));
    } finally {
      submitting.current.delete(approval.id);
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
        const externalWrite = isExternalWriteApproval(approval);
        const display = approvalDisplayDetails(approval);
        const metadata = externalWrite
          ? [
            { key: t('approvals.sourceLabel'), value: t(`approvals.source.${approval.source}`) },
            { key: t('approvals.riskLabel'), value: t(`approvals.risk.${approval.risk}`) },
            { key: t('toolUi.approval.host.externalWriteEffectLabel'), value: t('toolUi.approval.host.externalWriteEffect') },
            { key: t('toolUi.approval.host.externalWriteRollbackLabel'), value: t('toolUi.approval.host.externalWriteNoRollback') },
            { key: t('toolUi.approval.host.externalWriteSnapshotLabel'), value: t('toolUi.approval.host.externalWriteSnapshot') },
          ]
          : [
            // Read through `display`, not `approval`: the ternary above already
            // guards this branch, but a positional guard breaks the moment the
            // branches are reordered. `display` is empty for an external write.
            { key: t(`approvals.source.${approval.source}`), value: display.cwd ?? approval.source },
            { key: t(`approvals.risk.${approval.risk}`), value: display.command ?? display.paths?.join(', ') ?? '' },
          ].filter((item) => item.value);

        return (
          <div key={approval.id} className="space-y-1.5">
            <fieldset disabled={state?.busy || Boolean(state?.choice)} className="min-w-0" aria-busy={state?.busy || undefined}>
              <ApprovalCard
                presentation={presentation}
                id={approval.id}
                title={externalWrite ? t('toolUi.approval.host.externalWriteTitle') : t('toolUi.approval.host.title')}
                description={externalWrite
                  ? t('toolUi.approval.host.externalWriteWarning')
                  : display.reason || display.command || display.paramsPreview}
                icon="shield-alert"
                metadata={metadata}
                // An external write is the one class with no automatic
                // rollback, so it must not render milder than `dangerous`.
                variant={isIrreversibleApproval(approval) ? 'destructive' : 'default'}
                confirmLabel={t('toolUi.approval.host.approve')}
                cancelLabel={t('toolUi.approval.host.deny')}
                choice={state?.choice}
                onConfirm={() => decide(approval, 'approved')}
                onCancel={() => decide(approval, 'denied')}
                className="max-w-none"
              />
            </fieldset>
            {state?.error && <p className="px-1 text-xs text-red-700 dark:text-red-400" role="alert">{state.error}</p>}
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
