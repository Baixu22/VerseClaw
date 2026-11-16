import { createHash } from 'node:crypto';
import type { SessionTaskEffectAdmission } from '../../../shared/session-task-scope.js';
import type { CheckoutWriterCredential } from '../../../shared/checkout-ownership.js';
import { TASK_DELEGATION_DISPATCH_TOOLS } from '../../../shared/task-system/types.js';
import { TaskSystemStore } from '../../../shared/task-system/store.js';
import { executeTaskGuarded } from '../../../shared/task-system/runtime.js';
import { openExecutionTaskStore } from './execution-task-authority.js';
import type { createExecutionTaskGuard } from './execution-task-guard.js';
import { createWorktreeService, resolveExecutionCheckout, reconcileTaskCheckoutWrites } from './worktree-service.js';
import { managedProcessReservations } from './verseshell/managed-process-reservation.js';
import { getSession, listRunningSessions } from './bash-process-registry.js';
import { getProcessSupervisor } from '../process/supervisor/index.js';
import { withSessionTaskScope } from './session-task-scope.js';
import { checkoutWritersForRun } from './worktree-writer.js';
import { returnPersistentTaskWriter } from './persistent-task-delegation.js';
import { getSessionEntry } from '../config/sessions/store.js';

type Guard = ReturnType<typeof createExecutionTaskGuard>;
type Checkout = NonNullable<SessionTaskEffectAdmission['checkout']>;
const runCheckouts = new Map<string, Checkout>();
const coordinationTools = new Set([...TASK_DELEGATION_DISPATCH_TOOLS,
  'sessions_send','sessions_steer','sessions_yield','subagents','create_goal','update_goal']);

function processesPending(credential: CheckoutWriterCredential): boolean {
  const owner = credential.owner;
  if (owner.kind !== 'run') return true;
  const sessionKey = owner.run.scope.sessionKey;
  if (!sessionKey) return true;
  const durable = managedProcessReservations().some(record => !record.sessionKey || !record.sessionGeneration || !record.runId
    || (record.sessionKey === sessionKey && record.sessionGeneration === owner.sessionGeneration));
  return durable || listRunningSessions().some(process =>
    (process.lifecycleCanonicalSessionKey ?? process.sessionKey) === sessionKey
    && (!process.lifecycleExpectedSessionId || process.lifecycleExpectedSessionId === owner.sessionGeneration))
    || getProcessSupervisor().snapshotRunsForSession(sessionKey).some(run => run.state !== 'exited'
      && (!run.lifecycleExpectedSessionId || run.lifecycleExpectedSessionId === owner.sessionGeneration));
}

/** Consume TaskSystemStore's exact operation state after its process/effect owner has reconciled it. */
export function reconcileExecutionCheckout(checkout: Checkout): void {
  const service = createWorktreeService(checkout.baseRoot);
  const state = service.writer(checkout.worktreeId);
  if (!state || state.epoch !== checkout.credential.epoch || state.token !== checkout.credential.token || state.owner.kind !== 'run') return;
  if (!state.owner.task) return;
  const sessionKey = state.owner.run.scope.sessionKey;
  if (!sessionKey) throw new Error('TASK_CHECKOUT_EXECUTION_IDENTITY_REQUIRED');
  reconcileTaskCheckoutWrites(checkout);
  const current = service.writer(checkout.worktreeId);
  if (current?.terminalReceipt && current.operations.every(operation => operation.state === 'settled') && !processesPending(current)) {
    const ledger = openExecutionTaskStore(current.root);
    let delegation;
    let terminalTask = false;
    try {
      delegation = ledger.delegationForChild(sessionKey);
      const task = ledger.get(state.owner.task.taskNodeId);
      terminalTask = ['done','cancelled'].includes(task.contract.state) || task.claim?.state === 'released';
    } finally { ledger.close(); }
    if (delegation?.mode === 'writer' && !terminalTask) {
      if (delegation.phase === 'recovery_required' && delegation.terminalReceipt) {
        const parent = getSessionEntry({ sessionKey: delegation.parent.sessionKey });
        returnPersistentTaskWriter({ workspace: current.root, childSessionKey: sessionKey,
          ...delegation.terminalReceipt, parentGeneration: parent?.sessionId });
      }
      // The returning task retains checkout exclusion until the parent's next
      // admitted run atomically rotates it; never expose a release/claim gap.
      return;
    }
    service.releaseWriter(checkout.credential);
    runCheckouts.delete(current.owner.kind === 'run' ? current.owner.run.runId : '');
  }
}

/** Called only from the run owner's terminal cleanup, never from its context TTL sweeper. */
export function finishExecutionCheckoutRun(runId: string, identity?: { sessionKey: string; sessionGeneration: string }): void {
  const checkout = runCheckouts.get(runId);
  if (!checkout && identity) {
    for (const row of checkoutWritersForRun(runId, identity.sessionKey, identity.sessionGeneration)) {
      const target = resolveExecutionCheckout(row.root);
      runCheckouts.set(runId, { baseRoot: target.baseRoot, worktreeId: target.worktreeId, credential: row });
      finishExecutionCheckoutRun(runId);
    }
    return;
  }
  if (!checkout) return;
  const service = createWorktreeService(checkout.baseRoot);
  const state = service.writer(checkout.worktreeId);
  if (!state || state.token !== checkout.credential.token || state.epoch !== checkout.credential.epoch) {
    runCheckouts.delete(runId); return;
  }
  if (!state.terminalReceipt && state.owner.kind === 'run') service.endWriter(checkout.credential, {
    runId, sessionGeneration: state.owner.sessionGeneration, endedAt: Date.now(), ownerReceipt: `runtime-run-terminal:${runId}`,
  });
  try { reconcileExecutionCheckout(checkout); }
  finally { runCheckouts.delete(runId); }
}

function reconcileAfterProcessRead(guard: Guard) {
  if (!guard) return;
  const target = resolveExecutionCheckout(guard.domain.worktree);
  const state = target.service.writer(target.worktreeId);
  if (!state || state.owner.kind !== 'run' || state.owner.run.scope.sessionKey !== guard.sessionKey
    || state.owner.sessionGeneration !== guard.generation) return;
  reconcileExecutionCheckout({ baseRoot: target.baseRoot, worktreeId: target.worktreeId, credential: state });
}

/** Both raw and hook-wrapped tools execute through this single composition. */
export async function executeManagedTaskTool<T>(
  context: Parameters<typeof withSessionTaskScope>[0], guard: Guard, toolCallId: string,
  toolName: string, args: unknown, signal: AbortSignal | undefined, execute: () => Promise<T>,
): Promise<T> {
  const operationId = `${context?.runId ?? 'run'}:${toolCallId}`;
  const action = String((args as { action?: unknown } | null)?.action ?? '');
  const processControl = toolName === 'process' && ['poll','log','list','kill'].includes(action);
  const executeTask = (effect: () => Promise<T>) => executeTaskGuarded(guard, operationId, toolName, effect, args);
  if (toolName === 'task_control') {
    const result = await executeTask(execute);
    if (guard) {
      const target = resolveExecutionCheckout(guard.domain.worktree);
      const row = target.service.writer(target.worktreeId);
      if (row?.terminalReceipt) reconcileExecutionCheckout({ baseRoot: target.baseRoot, worktreeId: target.worktreeId, credential: row });
    }
    return result;
  }
  if (processControl) {
    if (action === 'kill') {
      const handle = getSession(String((args as { sessionId?: unknown } | null)?.sessionId ?? ''));
      if (!guard?.credential || !handle || handle.lifecycleCanonicalSessionKey !== guard.sessionKey
        || handle.lifecycleExpectedSessionId !== guard.generation) throw new Error('TASK_CHECKOUT_PROCESS_OWNER_MISMATCH');
    }
    const result = await executeTask(execute);
    reconcileAfterProcessRead(guard);
    return result;
  }
  const checkoutAccess = coordinationTools.has(toolName) ? 'control' : 'write';
  return withSessionTaskScope(context, toolName, args, signal, async admission => {
    if (!admission || checkoutAccess === 'control') return executeTask(execute);
    const checkout = admission.checkout;
    if (!checkout || !guard || !admission.claim.credential || !admission.claim.executionRevision)
      throw new Error('TASK_CHECKOUT_ADMISSION_REQUIRED');
    const owner = checkout.credential.owner;
    if (owner.kind !== 'run' || owner.run.runId !== context?.runId || owner.run.scope.sessionKey !== guard.sessionKey
      || owner.sessionGeneration !== guard.generation || owner.bindingRevision !== admission.claim.executionRevision
      || owner.task?.authorityId !== guard.domain.id || owner.task.taskNodeId !== admission.claim.taskNodeId
      || owner.task.epoch !== admission.claim.credential.epoch) throw new Error('TASK_CHECKOUT_ADMISSION_MISMATCH');
    signal?.throwIfAborted();
    const service = createWorktreeService(checkout.baseRoot);
    const digest = createHash('sha256').update(JSON.stringify({ operationId, toolName, args })).digest('hex');
    runCheckouts.set(owner.run.runId, checkout);
    const permit = service.beginWrite(checkout.credential, operationId, digest);
    if (permit.state === 'replayed') throw new Error(`TASK_CHECKOUT_EFFECT_ALREADY_RECORDED:${permit.receipt.ownerReceipt}`);
    let dispatched = false;
    try {
      const result = await executeTask(async () => {
        signal?.throwIfAborted(); dispatched = true; return execute();
      });
      const details = (result as { details?: { status?: string } } | null)?.details;
      if (details?.status === 'running' || details?.status === 'background') service.settleWrite(checkout.credential, operationId, null);
      else service.settleWrite(checkout.credential, operationId, { outcome: 'completed', ownerReceipt: `runtime-tool:${operationId}` });
      return result;
    } catch (error) {
      if (dispatched) service.settleWrite(checkout.credential, operationId, null);
      else {
        if (guard.credential) {
          const store = new TaskSystemStore(guard.domain, undefined, guard.access);
          try {
            const operation = store.operation(guard.credential, operationId);
            if (['started','unknown'].includes(operation.state)) store.reconcileOperation(guard.credential, operationId,
              { id: `preflight:${operationId}`, outcome: 'not_applied', owner: 'runtime-tool-boundary' });
          } catch { /* No Task operation was admitted, or its owner changed; retain that owner's state. */ }
          finally { store.close(); }
        }
        service.settleWrite(checkout.credential, operationId, { outcome: 'not-applied', ownerReceipt: `preflight:${operationId}` });
      }
      throw error;
    }
  }, { operationId, checkoutAccess });
}
