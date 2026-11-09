import { useTranslation } from 'react-i18next';
import type { SessionDelegationReceipt } from '@shared/types/session-delegation';
import type { SessionActivitySnapshot, SessionActivitySubagent } from '@shared/types/session-activity';

const reasonKeys: Record<string, string> = {
  'concurrency-cap': 'concurrencyCap',
  'write-set-conflict': 'writeSetConflict',
  'insufficient-writeSet-proof': 'writeSetProof',
  'tool-contention': 'toolContention',
};

export function SessionDelegationStatus({ workspaceId, sessionKey, generation, receipt, snapshot, worker, onOpenResources }: {
  workspaceId?: string;
  sessionKey: string;
  generation?: string | null;
  receipt?: SessionDelegationReceipt | null;
  /** Consumers select this owner snapshot by workspace and session. */
  snapshot?: SessionActivitySnapshot;
  worker?: SessionActivitySubagent;
  onOpenResources?: () => void;
}) {
  const { t } = useTranslation('chat');
  const currentReceipt = workspaceId && generation && receipt && receipt.coordinator.workspaceId === workspaceId && receipt.coordinator.sessionKey === sessionKey
    && receipt.coordinator.sessionGeneration === generation
    && (!worker?.childSessionKey || receipt.children.some((child) => child.childSessionKey === worker.childSessionKey)) ? receipt : null;
  const currentSnapshot = workspaceId && generation && snapshot?.session.sessionKey === sessionKey
    && snapshot.session.sessionId === generation
    && (!snapshot.policy || snapshot.policy.scope.workspaceId === workspaceId) ? snapshot : undefined;
  const currentQueue = currentSnapshot?.availability.continuity
    && Number.isSafeInteger(currentSnapshot.continuity.queueCount) && currentSnapshot.continuity.queueCount >= 0
    ? currentSnapshot.continuity.queueCount : null;
  const waitingWorker = currentSnapshot?.availability.subagents && worker
    ? currentSnapshot.subagents.find(entry => entry.id === worker.id && entry.childSessionKey === worker.childSessionKey && entry.status === 'yielded')
    : undefined;
  const waves = currentReceipt?.scheduler?.executionWaves ?? [];
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
  if (!receipt && !worker && !batch && currentQueue === null) return null;
  return <div data-testid="session-delegation-stages" className="space-y-2 rounded bg-surface-input p-2 text-xs">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      {Object.entries(stages).map(([stage, status]) => <div key={stage} className="contents">
        <dt className="text-muted-foreground">{t('delegationStages.label.' + stage)}</dt>
        <dd data-stage={stage} data-status={status} className="min-w-0 break-words">{t('delegationStages.status.' + status)}</dd>
      </div>)}
    </dl>
    {waves.length > 0 && <section data-testid="delegation-receipt-plan" data-plan-time="receipt">
      <p className="font-medium">{t('delegationStages.capacity.planTitle')}</p>
      <p className="text-muted-foreground">{t('delegationStages.capacity.planDescription')}</p>
      {currentReceipt?.acceptedAt && <p className="text-muted-foreground">{t('delegationStages.capacity.recordedAt', { at: currentReceipt.acceptedAt })}</p>}
      <ul className="mt-1 space-y-1">
        {waves.map(wave => <li key={wave.wave} data-testid={'delegation-plan-wave-' + wave.wave} className="break-words">
          <span className="font-medium">{t('delegationStages.capacity.wave', { wave: wave.wave, roles: wave.roles.join(', ') })}</span>
          <p data-testid={'delegation-plan-reason-' + wave.wave}>{wave.reason || t('delegationStages.capacity.reasonUnavailable')}</p>
          {wave.deferredReasons?.map((reason, index) => <span key={reason + ':' + index} data-deferred-reason={reason} className="mr-2 inline-block text-muted-foreground">
            {reasonKeys[reason] ? t('delegationStages.capacity.reason.' + reasonKeys[reason]) : t('delegationStages.capacity.otherReason', { reason })}
          </span>)}
        </li>)}
      </ul>
    </section>}
    {(currentQueue !== null || waitingWorker) && <section data-testid="delegation-current-wait">
      <p className="font-medium">{t('delegationStages.capacity.currentTitle')}</p>
      {currentQueue !== null && <p data-testid="delegation-current-queue" data-count={currentQueue}>
        {t('delegationStages.capacity.currentQueue', { count: currentQueue })}
      </p>}
      {waitingWorker && <p data-testid="delegation-current-worker-wait">{t('delegationStages.capacity.workerWaiting')}</p>}
      {currentQueue !== null && currentSnapshot?.continuity.blockedReason && <p>{currentSnapshot.continuity.blockedReason}</p>}
    </section>}
    {onOpenResources && (waves.length > 0 || currentQueue !== null || waitingWorker) && <button
      type="button" data-testid="delegation-open-resources" onClick={onOpenResources}
      className="underline underline-offset-2">{t('delegationStages.capacity.openResources')}</button>}
  </div>;
}
