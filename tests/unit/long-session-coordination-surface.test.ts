import { describe, expect, it } from 'vitest';
import { deriveCoordinationSurface, deriveCoordinationWorkState } from '@/pages/Chat/long-session-coordination';
import type { DelegationAdmissionReceipt } from '@shared/types/delegation-admission';
import { createEmptySessionActivitySnapshot, type SessionCompletionBatch } from '@shared/types/session-activity';
import type { WorkspaceCoordinatorBinding } from '@shared/types/workspace';

const SESSION_KEY = 'agent:main:long';
const WORKSPACE_ID = 'workspace-a';

function binding(overrides: Partial<WorkspaceCoordinatorBinding> = {}): WorkspaceCoordinatorBinding {
  return {
    schemaVersion: 'WorkspaceCoordinatorBinding/v1',
    workspaceId: WORKSPACE_ID,
    agentId: 'main',
    sessionKey: SESSION_KEY,
    sessionId: 'session-generation-1',
    taskRefs: [{ kind: 'task-ledger', nodeId: 'task-1' }],
    state: 'active',
    revision: 3,
    createdAt: '2026-10-23T00:00:00.000Z',
    updatedAt: '2026-10-23T00:00:00.000Z',
    invalidatedAt: null,
    invalidationReason: null,
    ...overrides,
  };
}

function receipt(index: number, overrides: Partial<DelegationAdmissionReceipt> = {}): DelegationAdmissionReceipt {
  const id = 'receipt-' + index;
  return {
    schemaVersion: 'DelegationAdmissionReceipt/v1',
    receiptId: id,
    idempotencyKey: 'delegation-' + index,
    requestDigest: 'digest-' + index,
    coordinator: {
      workspaceId: WORKSPACE_ID,
      agentId: 'main',
      sessionKey: SESSION_KEY,
      sessionId: 'session-generation-1',
      bindingRevision: 3,
    },
    taskRef: { kind: 'task-ledger', nodeId: 'task-1' },
    roleName: 'role-' + index,
    task: 'Task ' + index,
    state: 'accepted',
    acceptedIsNotCompletion: true,
    orchestrationRunId: 'orch-' + index,
    taskNodeId: 'task-node-' + index,
    taskId: 'task-id-' + index,
    roleInstanceId: 'role-instance-' + index,
    childSessionKey: 'agent:main:subagent:' + index,
    childRunId: 'run-' + index,
    backend: {
      kind: 'openclaw-embedded',
      provider: 'test',
      model: 'test',
      evidence: 'role-spawn:spawnSubagentDirect',
    },
    toolAuthorization: {
      allowlist: [],
      denylist: [],
      permissionDecisionCount: 0,
      source: 'role-clamped-inherited',
    },
    isolation: {
      mode: 'inprocess-shared',
      backend: 'inprocess',
      worktreeId: null,
      writeSet: ['src/task-' + index + '.ts'],
      parallelWritesAllowed: false,
      writeSetBasis: 'serialized',
    },
    reason: null,
    createdAt: '2026-10-23T00:00:0' + index + '.000Z',
    updatedAt: '2026-10-23T00:00:0' + index + '.000Z',
    acceptedAt: '2026-10-23T00:00:0' + index + '.000Z',
    rejectedAt: null,
    ...overrides,
  };
}

function batch(index: number, overrides: Partial<SessionCompletionBatch> = {}): SessionCompletionBatch {
  const runId = 'run-' + index;
  return {
    id: 'completion-batch:orch-' + index + ':' + SESSION_KEY,
    idempotencyKey: 'completion-batch:orch-' + index + ':' + SESSION_KEY,
    orchestrationRunId: 'orch-' + index,
    requesterSessionKey: SESSION_KEY,
    requesterSessionId: 'session-generation-1',
    generationState: 'consistent',
    status: 'delivery-pending',
    terminal: true,
    expectedWorkerCount: 1,
    completedWorkerCount: 1,
    failedWorkerCount: 0,
    cancelledWorkerCount: 0,
    pendingWorkerCount: 0,
    workerRuns: [{
      runId,
      roleName: 'role-' + index,
      taskNodeId: 'task-node-' + index,
      childSessionKey: 'agent:main:subagent:' + index,
      status: 'completed',
    }],
    verifier: null,
    delivery: {
      state: 'pending',
      pendingCount: 1,
      inProgressCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      suspendedCount: 0,
      discardedCount: 0,
    },
    bounded: true,
    completionAuthority: 'none',
    updatedAt: 1_000 + index,
    ...overrides,
  };
}

describe('long-session coordination projection', () => {
  it('maps durable receipts and live owner records without inventing task acceptance', () => {
    const snapshot = createEmptySessionActivitySnapshot(SESSION_KEY);
    snapshot.tasks = [{
      id: 'task-1',
      kind: 'taskLedger',
      title: 'Ship coordinated slice',
      status: 'running',
      updatedAt: 1_000,
      source: 'task-ledger',
    }];
    snapshot.subagents = [
      { id: 'subagent-1', role: 'implementer', status: 'started', childSessionKey: 'agent:main:subagent:1', updatedAt: 1_001, source: 'snapshot' },
      { id: 'subagent-2', role: 'tester', status: 'yielded', childSessionKey: 'agent:main:subagent:2', updatedAt: 1_002, source: 'snapshot' },
      { id: 'subagent-3', role: 'reviewer', status: 'completed', childSessionKey: 'agent:main:subagent:3', updatedAt: 1_003, source: 'snapshot' },
    ];
    snapshot.completionBatches = [
      batch(3, { status: 'delivered', delivery: { state: 'delivered', pendingCount: 0, inProgressCount: 0, deliveredCount: 1, failedCount: 0, suspendedCount: 0, discardedCount: 0 } }),
    ];
    const surface = deriveCoordinationSurface({
      binding: binding(),
      receipts: [
        receipt(1),
        receipt(2),
        receipt(3),
        receipt(4, { state: 'submitting', orchestrationRunId: null, childSessionKey: null, childRunId: null }),
        receipt(5, { state: 'rejected', rejectedAt: '2026-10-23T00:00:05.000Z' }),
      ],
      snapshot,
    })!;
    expect(surface.bindingState).toBe('active');
    expect(surface.revision).toBe(3);
    expect(surface.taskRefs).toEqual([{
      nodeId: 'task-1',
      title: 'Ship coordinated slice',
      status: 'running',
      available: true,
    }]);
    expect(surface.works.map((work) => [work.roleName, work.state])).toEqual([
      ['role-5', 'failed'],
      ['role-4', 'draft'],
      ['role-3', 'reported'],
      ['role-2', 'cancelled'],
      ['role-1', 'running'],
    ]);
    expect(surface.batches[0]).toMatchObject({
      state: 'reported',
      deliveryState: 'delivered',
      openWorkerSessionKey: 'agent:main:subagent:3',
    });
  });

  it('lets Task Ledger acceptance outrank worker delivery, while invalidated bindings keep their actual reason', () => {
    const snapshot = createEmptySessionActivitySnapshot(SESSION_KEY);
    snapshot.tasks = [{
      id: 'task-1',
      kind: 'taskLedger',
      title: 'Accepted task',
      status: 'completed',
      updatedAt: 2_000,
      source: 'task-ledger',
    }];
    snapshot.completionBatches = [batch(1)];
    const surface = deriveCoordinationSurface({
      binding: binding({
        state: 'invalidated',
        invalidationReason: 'archived',
        invalidatedAt: '2026-10-23T00:10:00.000Z',
      }),
      receipts: [receipt(1)],
      snapshot,
    })!;
    expect(surface.works[0].state).toBe('accepted-by-task');
    expect(surface.batches[0].state).toBe('waiting');
    expect(surface.bindingState).toBe('invalidated');
    expect(surface.invalidationReason).toBe('archived');
  });

  it('keeps accepted and unknown receipt facts distinct when no worker result exists', () => {
    expect(deriveCoordinationWorkState({
      receipt: receipt(1),
      subagent: undefined,
      batch: undefined,
      taskStatus: null,
    })).toBe('accepted');
    expect(deriveCoordinationWorkState({
      receipt: receipt(2, { state: 'unknown', childSessionKey: null, childRunId: null, orchestrationRunId: null }),
      subagent: undefined,
      batch: undefined,
      taskStatus: null,
    })).toBe('unknown');
  });

  it('bounds recent work and batch references without creating a second task authority', () => {
    const snapshot = createEmptySessionActivitySnapshot(SESSION_KEY);
    snapshot.completionBatches = Array.from({ length: 8 }, (_, index) => batch(index + 1));
    const surface = deriveCoordinationSurface({
      binding: binding(),
      receipts: Array.from({ length: 9 }, (_, index) => receipt(index + 1)),
      snapshot,
    })!;
    expect(surface.works).toHaveLength(6);
    expect(surface.batches).toHaveLength(4);
    expect(surface.taskRefs).toHaveLength(1);
  });
});
