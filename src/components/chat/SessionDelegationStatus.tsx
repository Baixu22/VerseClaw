import { useTranslation } from 'react-i18next';
import type { SessionDelegationReceipt } from '@shared/types/session-delegation';
import type { SessionActivitySnapshot, SessionActivitySubagent } from '@shared/types/session-activity';

export function SessionDelegationStatus({ workspaceId, sessionKey, generation, receipt, snapshot, worker }: {
  workspaceId?: string;
  sessionKey: string;
  generation?: string | null;
  receipt?: SessionDelegationReceipt | null;
  snapshot?: SessionActivitySnapshot;
  worker?: SessionActivitySubagent;
}) {
  const { t } = useTranslation('chat');
  const currentReceipt = receipt && receipt.coordinator.workspaceId === workspaceId && receipt.coordinator.sessionKey === sessionKey
    && receipt.coordinator.sessionGeneration === generation
    && (!worker?.childSessionKey || receipt.children.some((child) => child.childSessionKey === worker.childSessionKey)) ? receipt : null;
  const batch = snapshot?.completionBatches.filter((entry) => entry.requesterSessionKey === sessionKey
    && (!worker?.childSessionKey || entry.members.some((member) => member.childSessionKey === worker.childSessionKey)))
    .toSorted((left, right) => right.acceptedAt - left.acceptedAt)[0];
  const matchingBatch = batch && batch.requesterSessionGeneration === generation && batch.generationState === 'matching' ? batch : null;
  const stages = {
    admission: currentReceipt?.status ?? 'unavailable',
    execution: worker?.status ?? 'unavailable',
    report: matchingBatch?.delivery.state ?? (batch ? 'fenced' : 'unavailable'),
    acceptance: 'unavailable',
    continuation: matchingBatch?.delivery.waitingForRequesterTurn ? 'waiting' : batch?.generationState === 'mismatch' ? 'fenced' : 'unavailable',
  };
  if (!receipt && !worker && !batch) return null;
  return <dl data-testid="session-delegation-stages" className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded bg-surface-input p-2 text-xs">
    {Object.entries(stages).map(([stage, status]) => <div key={stage} className="contents">
      <dt className="text-muted-foreground">{t(`delegationStages.label.${stage}`)}</dt>
      <dd data-stage={stage} data-status={status} className="min-w-0 break-words">{t(`delegationStages.status.${status}`)}</dd>
    </div>)}
  </dl>;
}
