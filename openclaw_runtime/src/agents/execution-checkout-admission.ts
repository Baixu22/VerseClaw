import { createHash } from 'node:crypto';
import type { SessionTaskEffectAdmission, SessionTaskWriterClaim } from '../../../shared/session-task-scope.js';
import type { CheckoutWriterIdentity } from '../../../shared/checkout-ownership.js';
import type { TaskCredential, TaskView } from '../../../shared/task-system/types.js';
import { createExecutionTaskAccess, type ExecutionTaskAuthorityBasis } from './execution-task-authority.js';
import { TaskSystemStore } from '../../../shared/task-system/store.js';
import { resolveExecutionCheckout } from './worktree-service.js';

export type CheckoutRunObservation = {
  active: boolean; quiescent: boolean; inFlightEffects: number; inFlightProcesses: number;
  inFlightOperationIds?: string[];
};
type RunOwner = Extract<CheckoutWriterIdentity, { kind: 'run' }>;
const sameCredential = (left: TaskCredential, right: TaskCredential) => left.taskNodeId === right.taskNodeId
  && left.sessionKey === right.sessionKey && left.generation === right.generation && left.epoch === right.epoch;

/** A resource transfer consumes canonical task proof; it does not create a task claim. */
export async function admitExecutionCheckout(input: {
  workspaceRoot: string; authority: ExecutionTaskAuthorityBasis; task: TaskView;
  claim: SessionTaskWriterClaim; agentId: string; operationId: string;
  observeRun(owner: RunOwner): Promise<CheckoutRunObservation>;
}): Promise<{ checkout: NonNullable<SessionTaskEffectAdmission['checkout']>; unused: boolean }> {
  const access = createExecutionTaskAccess(input.workspaceRoot, input.authority);
  if (!input.claim.credential || !input.claim.executionRevision || !input.claim.run.scope.sessionKey) throw new Error('TASK_CHECKOUT_EXECUTION_IDENTITY_REQUIRED');
  const target = resolveExecutionCheckout(input.workspaceRoot);
  const owner: RunOwner = { kind: 'run', run: input.claim.run, agentId: input.agentId,
    sessionGeneration: input.claim.sessionGeneration, bindingRevision: input.claim.executionRevision,
    task: { authorityId: access.domain.id, taskNodeId: input.claim.taskNodeId,
      epoch: input.claim.credential.epoch, contractRevision: input.task.contract.revision } };
  const requestId = 'execution:' + createHash('sha256').update(JSON.stringify([owner, target.basis])).digest('hex');
  const previous = target.service.writer(target.worktreeId);
  const assertTask = () => {
    const store = new TaskSystemStore(access.domain, undefined, access);
    try {
      const current = store.assertOwner(input.claim.credential!);
      if (current.contract.revision !== input.task.contract.revision || current.contract.digest !== input.task.contract.digest)
        throw new Error('TASK_CONTRACT_STALE');
    } finally { store.close(); }
  };
  assertTask();
  let credential;
  let unused = !previous || previous.state === 'released';
  if (previous && previous.state !== 'released') {
    if (previous.owner.kind !== 'run') throw new Error('checkout_writer_busy');
    const former = previous.owner;
    const formerSessionKey = former.run.scope.sessionKey;
    if (!formerSessionKey) throw new Error('TASK_CHECKOUT_EXECUTION_IDENTITY_REQUIRED');
    const sameExecution = JSON.stringify(former) === JSON.stringify(owner);
    if (sameExecution && previous.state === 'active') {
      if (previous.generation !== target.basis.generation || previous.incarnation !== target.basis.incarnation)
        throw new Error('worktree_stale_generation');
      const { root, incarnation, generation, epoch, token, owner: capturedOwner } = previous;
      credential = { root, incarnation, generation, epoch, token, owner: capturedOwner };
    } else {
      const observed = await input.observeRun(former);
      if (observed.inFlightProcesses !== 0) throw new Error('TASK_CHECKOUT_PROCESSES_PENDING');
      assertTask();
      let canonicalTransfer = false;
      let retainedForDelegation: boolean;
      const store = new TaskSystemStore(access.domain, undefined, access);
      try {
        const old = former.task;
        const sourceDelegation = store.delegationForChild(formerSessionKey);
        const sourceTask = sourceDelegation ? store.get(sourceDelegation.taskNodeId) : null;
        retainedForDelegation = sourceDelegation?.mode === 'writer'
          && sourceTask?.claim?.state !== 'released' && !['done','cancelled'].includes(sourceTask!.contract.state);
        if (old?.authorityId === access.domain.id && old.taskNodeId === input.claim.taskNodeId) {
          const oldCredential: TaskCredential = { taskNodeId: input.claim.taskNodeId,
            sessionKey: formerSessionKey, generation: former.sessionGeneration, epoch: old.epoch };
          const outgoing = store.delegationForChild(input.claim.run.scope.sessionKey!);
          const returning = store.delegationForChild(formerSessionKey);
          if (outgoing?.mode === 'writer' && ['prepared','dispatched','unknown'].includes(outgoing.phase)
            && sameCredential(outgoing.parent, oldCredential) && sameCredential(outgoing.child, input.claim.credential!)
            && outgoing.childRunId === input.claim.run.runId) {
            canonicalTransfer = observed.inFlightEffects === 0
              || (observed.inFlightOperationIds?.length === observed.inFlightEffects
                && observed.inFlightOperationIds.every(id => outgoing.dispatchOperationIds.includes(id)));
          } else if (returning?.mode === 'writer' && returning.phase === 'returned'
            && sameCredential(returning.child, oldCredential)
            && returning.parent.sessionKey === input.claim.run.scope.sessionKey
            && returning.parent.generation === input.claim.sessionGeneration
            && input.claim.credential!.epoch === returning.child.epoch + 1) {
            canonicalTransfer = observed.quiescent && observed.inFlightEffects === 0;
          }
        }
      } finally { store.close(); }
      // Main retains the same run grant when an idle task lease advances once.
      // Every other owner field and the single in-flight operation must match.
      const continuedTask = former.task && owner.task && owner.task.epoch === former.task.epoch + 1
        && JSON.stringify({ ...former, task: { ...former.task, epoch: owner.task.epoch } }) === JSON.stringify(owner);
      const continuation = (sameExecution || continuedTask) && !previous.terminalReceipt && observed.inFlightEffects === 1
        && observed.inFlightOperationIds?.length === 1 && observed.inFlightOperationIds[0] === input.operationId;
      const terminal = Boolean(!retainedForDelegation && previous.terminalReceipt && observed.quiescent && observed.inFlightEffects === 0);
      if (!canonicalTransfer && !continuation && !terminal) throw new Error('checkout_writer_busy');
      target.service.drainWriter(previous);
      if (canonicalTransfer || continuation || former.task?.taskNodeId === owner.task?.taskNodeId) {
        credential = target.service.transferWriter(previous, owner,
          `${requestId}:transfer:${previous.epoch}:${continuation ? input.operationId : 'owner'}`);
      } else {
        target.service.releaseWriter(previous);
        credential = target.service.claimWriter(target.worktreeId, target.basis.generation, owner, requestId);
        unused = true;
      }
    }
  } else {
    credential = target.service.claimWriter(target.worktreeId, target.basis.generation, owner, requestId);
  }
  assertTask();
  return { checkout: { baseRoot: target.baseRoot,
    worktreeId: target.worktreeId, credential }, unused };
}
