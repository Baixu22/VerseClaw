import type { DelegationAdmissionReceipt } from '@shared/types/delegation-admission';
import type {
  SessionActivitySnapshot,
  SessionActivitySubagent,
  SessionActivityTask,
  SessionCompletionBatch,
} from '@shared/types/session-activity';
import type { TaskLedgerNode } from '@shared/types/task-ledger';
import type { WorkspaceCoordinatorBinding } from '@shared/types/workspace';

export type CoordinationWorkState =
  | 'draft'
  | 'accepted'
  | 'running'
  | 'waiting'
  | 'failed'
  | 'cancelled'
  | 'reported'
  | 'accepted-by-task'
  | 'unknown';

export type CoordinationWorkView = {
  receiptId: string;
  idempotencyKey: string;
  roleName: string;
  task: string;
  state: CoordinationWorkState;
  taskNodeId: string | null;
  childSessionKey: string | null;
  childRunId: string | null;
  orchestrationRunId: string | null;
  backend: string;
  isolation: string;
  updatedAt: string;
};

export type CoordinationTaskRefView = {
  nodeId: string;
  title: string;
  status: string | null;
  available: boolean;
};

export type CoordinationBatchView = {
  id: string;
  idempotencyKey: string;
  state: CoordinationWorkState;
  status: SessionCompletionBatch['status'];
  deliveryState: SessionCompletionBatch['delivery']['state'];
  terminal: boolean;
  bounded: boolean;
  expectedWorkerCount: number;
  completedWorkerCount: number;
  failedWorkerCount: number;
  cancelledWorkerCount: number;
  pendingWorkerCount: number;
  openWorkerSessionKey: string | null;
  updatedAt: number;
};

export type CoordinationSurfaceView = {
  bindingState: 'active' | 'invalidated';
  invalidationReason: WorkspaceCoordinatorBinding['invalidationReason'];
  revision: number;
  sessionKey: string;
  agentId: string;
  works: CoordinationWorkView[];
  taskRefs: CoordinationTaskRefView[];
  batches: CoordinationBatchView[];
};

function subagentForReceipt(
  receipt: DelegationAdmissionReceipt,
  subagents: readonly SessionActivitySubagent[],
): SessionActivitySubagent | undefined {
  if (!receipt.childSessionKey) return undefined;
  return subagents.find((subagent) => subagent.childSessionKey === receipt.childSessionKey);
}

function batchForReceipt(
  receipt: DelegationAdmissionReceipt,
  batches: readonly SessionCompletionBatch[],
): SessionCompletionBatch | undefined {
  if (!receipt.orchestrationRunId) return undefined;
  return batches.find((batch) => batch.orchestrationRunId === receipt.orchestrationRunId);
}

function taskStatusForNode(params: {
  nodeId: string | null | undefined;
  tasks: readonly SessionActivityTask[];
  taskNodes: readonly TaskLedgerNode[];
}): string | null {
  if (!params.nodeId) return null;
  const ledgerNode = params.taskNodes.find((node) => node.id === params.nodeId);
  if (ledgerNode) return ledgerNode.status;
  return params.tasks.find((task) => task.id === params.nodeId)?.status ?? null;
}

function isTaskAccepted(status: string | null): boolean {
  return status === 'done' || status === 'completed' || status === 'complete';
}

function isTaskFailed(status: string | null): boolean {
  return status === 'failed' || status === 'error';
}

function isTaskCancelled(status: string | null): boolean {
  return status === 'dropped' || status === 'aborted' || status === 'cancelled';
}

export function deriveCoordinationWorkState(params: {
  receipt: DelegationAdmissionReceipt;
  subagent: SessionActivitySubagent | undefined;
  batch: SessionCompletionBatch | undefined;
  taskStatus: string | null;
}): CoordinationWorkState {
  const { receipt, subagent, batch, taskStatus } = params;
  /* Task Ledger acceptance is the strongest fact: it outranks delivery text
   * and even an earlier worker error. This projection never writes that state. */
  if (isTaskAccepted(taskStatus)) return 'accepted-by-task';
  if (isTaskFailed(taskStatus)) return 'failed';
  if (isTaskCancelled(taskStatus)) return 'cancelled';
  if (receipt.state === 'rejected') return 'failed';
  if (receipt.state === 'submitting') return 'draft';
  if (subagent?.status === 'error') return 'failed';
  if (subagent?.status === 'aborted' || subagent?.status === 'yielded') return 'cancelled';
  if (subagent?.status === 'started') return 'running';
  if (batch) {
    if (batch.failedWorkerCount > 0) return 'failed';
    if (batch.cancelledWorkerCount === batch.expectedWorkerCount && batch.expectedWorkerCount > 0) return 'cancelled';
    if (batch.status === 'delivered' || batch.delivery.state === 'delivered') return 'reported';
    if (batch.delivery.state === 'failed' || batch.delivery.state === 'discarded' || batch.status === 'partial') {
      return 'failed';
    }
    if (batch.delivery.state === 'in_progress' || batch.delivery.state === 'suspended') return 'waiting';
    if (batch.terminal) return 'waiting';
    if (batch.pendingWorkerCount > 0) return 'running';
  }
  if (receipt.state === 'unknown') return 'unknown';
  return 'accepted';
}

function batchState(batch: SessionCompletionBatch): CoordinationWorkState {
  if (batch.failedWorkerCount > 0) return 'failed';
  if (batch.cancelledWorkerCount === batch.expectedWorkerCount && batch.expectedWorkerCount > 0) return 'cancelled';
  if (batch.status === 'delivered' || batch.delivery.state === 'delivered') return 'reported';
  if (batch.delivery.state === 'failed' || batch.delivery.state === 'discarded' || batch.status === 'partial') {
    return 'failed';
  }
  if (batch.delivery.state === 'in_progress' || batch.delivery.state === 'suspended' || batch.terminal) {
    return 'waiting';
  }
  return 'running';
}

export function deriveCoordinationSurface(params: {
  binding: WorkspaceCoordinatorBinding | null | undefined;
  receipts: readonly DelegationAdmissionReceipt[];
  snapshot: SessionActivitySnapshot;
  taskNodes?: readonly TaskLedgerNode[];
}): CoordinationSurfaceView | null {
  const { binding } = params;
  if (!binding) return null;
  const taskNodes = params.taskNodes ?? [];
  const scopedReceipts = params.receipts
    .filter((receipt) => (
      receipt.coordinator.sessionKey === binding.sessionKey
      && receipt.coordinator.workspaceId === binding.workspaceId
    ))
    .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 6);
  const scopedBatches = params.snapshot.completionBatches
    .filter((batch) => batch.requesterSessionKey === binding.sessionKey)
    .toSorted((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 4);
  const works = scopedReceipts.map((receipt) => {
    const subagent = subagentForReceipt(receipt, params.snapshot.subagents);
    const batch = batchForReceipt(receipt, scopedBatches);
    const taskStatus = taskStatusForNode({
      nodeId: receipt.taskRef.nodeId,
      tasks: params.snapshot.tasks,
      taskNodes,
    });
    return {
      receiptId: receipt.receiptId,
      idempotencyKey: receipt.idempotencyKey,
      roleName: receipt.roleName,
      task: receipt.task,
      state: deriveCoordinationWorkState({ receipt, subagent, batch, taskStatus }),
      taskNodeId: receipt.taskRef.nodeId,
      childSessionKey: receipt.childSessionKey,
      childRunId: receipt.childRunId,
      orchestrationRunId: receipt.orchestrationRunId,
      backend: receipt.backend.kind,
      isolation: receipt.isolation.mode,
      updatedAt: receipt.updatedAt,
    };
  });
  const taskRefIds = new Set<string>(binding.taskRefs.map((ref) => ref.nodeId));
  for (const receipt of scopedReceipts) taskRefIds.add(receipt.taskRef.nodeId);
  const taskRefs = [...taskRefIds].slice(0, 6).map((nodeId) => {
    const ledgerNode = taskNodes.find((node) => node.id === nodeId);
    const activityTask = params.snapshot.tasks.find((task) => task.id === nodeId);
    return {
      nodeId,
      title: ledgerNode?.title ?? activityTask?.title ?? nodeId,
      status: ledgerNode?.status ?? activityTask?.status ?? null,
      available: Boolean(ledgerNode ?? activityTask),
    };
  });
  const batches = scopedBatches.map((batch) => ({
    id: batch.id,
    idempotencyKey: batch.idempotencyKey,
    state: batchState(batch),
    status: batch.status,
    deliveryState: batch.delivery.state,
    terminal: batch.terminal,
    bounded: batch.bounded,
    expectedWorkerCount: batch.expectedWorkerCount,
    completedWorkerCount: batch.completedWorkerCount,
    failedWorkerCount: batch.failedWorkerCount,
    cancelledWorkerCount: batch.cancelledWorkerCount,
    pendingWorkerCount: batch.pendingWorkerCount,
    openWorkerSessionKey: batch.workerRuns.find((worker) => worker.childSessionKey)?.childSessionKey ?? null,
    updatedAt: batch.updatedAt,
  }));
  return {
    bindingState: binding.state,
    invalidationReason: binding.invalidationReason,
    revision: binding.revision,
    sessionKey: binding.sessionKey,
    agentId: binding.agentId,
    works,
    taskRefs,
    batches,
  };
}
