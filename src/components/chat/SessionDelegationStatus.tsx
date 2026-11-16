import { useTranslation } from 'react-i18next';
import type { SessionDelegationReceipt } from '@shared/types/session-delegation';
import type { SessionActivitySnapshot, SessionActivitySubagent } from '@shared/types/session-activity';
import type { TaskEvidence, TaskView } from '@shared/task-system/types';

const reasonKeys: Record<string, string> = {
  'concurrency-cap': 'concurrencyCap',
  'write-set-conflict': 'writeSetConflict',
  'insufficient-writeSet-proof': 'writeSetProof',
  'tool-contention': 'toolContention',
};

export function SessionDelegationStatus({ workspaceId, sessionKey, generation, receipt, snapshot, worker, task, verificationReceipts, childSessionKey, onOpenResources }: {
  workspaceId?: string;
  sessionKey: string;
  generation?: string | null;
  receipt?: SessionDelegationReceipt | null;
  snapshot?: SessionActivitySnapshot;
  worker?: SessionActivitySubagent;
  task?: TaskView | null;
  verificationReceipts?: TaskEvidence[];
  childSessionKey?: string;
  onOpenResources?: () => void;
}) {
  const { t } = useTranslation('chat');
  const childKey = childSessionKey ?? worker?.childSessionKey;
  const childView = Boolean(worker || childSessionKey);
  const currentReceipt = workspaceId && generation && receipt && receipt.coordinator.workspaceId === workspaceId && receipt.coordinator.sessionKey === sessionKey
    && receipt.coordinator.sessionGeneration === generation
    && ((!worker && !childSessionKey) || Boolean(childKey && receipt.children.some((child) => child.childSessionKey === childKey))) ? receipt : null;
  const workspaceSnapshot = workspaceId && snapshot?.session.sessionKey === sessionKey
    && (!snapshot.policy || snapshot.policy.scope.workspaceId === workspaceId) ? snapshot : undefined;
  const currentSnapshot = generation && workspaceSnapshot?.session.sessionId === generation ? workspaceSnapshot : undefined;
  const currentQueue = currentSnapshot?.availability.continuity
    && Number.isSafeInteger(currentSnapshot.continuity.queueCount) && currentSnapshot.continuity.queueCount >= 0
    ? currentSnapshot.continuity.queueCount : null;
  const waitingWorker = currentSnapshot?.availability.subagents && worker
    ? currentSnapshot.subagents.find(entry => entry.id === worker.id && entry.childSessionKey === childKey && entry.status === 'yielded')
    : undefined;
  const waves = currentReceipt?.scheduler?.executionWaves ?? [];
  const batch = workspaceSnapshot?.completionBatches.filter((entry) => entry.requesterSessionKey === sessionKey
    && ((!worker && !childSessionKey) || Boolean(childKey && entry.members.some((member) => member.childSessionKey === childKey))))
    .toSorted((left, right) => right.acceptedAt - left.acceptedAt)[0];
  const matchingBatch = batch && batch.requesterSessionGeneration === generation && batch.generationState === 'matching' ? batch : null;
  const currentChild = currentReceipt?.children.find(child => child.childSessionKey === childKey);
  const currentTask = task && (childView || !currentReceipt || currentReceipt.taskRef === task.contract.taskNodeId) ? task : null;
  const criteria = currentTask?.contract.acceptance ?? [];
  const eligibleReceipts = (verificationReceipts ?? []).filter(entry => currentTask
    && entry.taskNodeId === currentTask.contract.taskNodeId && entry.revision === currentTask.contract.revision
    && criteria.some(criterion => criterion.id === entry.criterionId));
  const latestReceipt = eligibleReceipts.reduce<TaskEvidence | null>((latest, entry) => !latest || entry.createdAt >= latest.createdAt ? entry : latest, null);
  const recordedCriteria = new Set(eligibleReceipts.filter(entry => entry.epoch === latestReceipt?.epoch
    && entry.candidate === latestReceipt?.candidate).map(entry => entry.criterionId));
  const stages = {
    admission: (childView ? currentChild?.admissionStatus : currentReceipt?.status) ?? 'unavailable',
    execution: worker?.status ?? 'unavailable',
    report: matchingBatch?.delivery.state ?? (batch ? 'fenced' : 'unavailable'),
    verification: !currentTask || !verificationReceipts ? 'unavailable' : latestReceipt ? 'recorded' : 'pending',
    acceptance: currentTask?.contract.state === 'done' ? 'accepted' : currentTask?.contract.state === 'cancelled' ? 'cancelled' : currentTask ? 'pending' : 'unavailable',
    continuation: matchingBatch?.delivery.waitingForRequesterTurn ? 'waiting' : batch?.generationState === 'mismatch' ? 'fenced' : 'unavailable',
  };
  if (!receipt && !worker && !batch && !currentTask && !childSessionKey && currentQueue === null) return null;
  return <div data-testid="session-delegation-stages" className="space-y-2 rounded bg-surface-input p-2 text-xs">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
    {Object.entries(stages).map(([stage, status]) => <div key={stage} className="contents">
      <dt className="text-muted-foreground">{t(`delegationStages.label.${stage}`)}</dt>
      <dd data-stage={stage} data-status={status} data-recorded-criteria={stage === 'verification' ? recordedCriteria.size : undefined}
        data-candidate={stage === 'verification' ? latestReceipt?.candidate : undefined} className="min-w-0 break-words">{t(`delegationStages.${stage === 'verification' ? 'verification' : stage === 'acceptance' && currentTask ? 'taskAcceptance' : 'status'}.${status}`,
        { count: recordedCriteria.size, total: criteria.length })}</dd>
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
