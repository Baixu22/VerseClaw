import { createHash } from 'node:crypto';
import type {
  GatewayRpcPayload,
  WorkspaceCoordinatorBindingResult,
} from '@shared/host-api/contract';
import type { WorkspaceCoordinatorBinding } from '@shared/types/workspace';
import { resolveSessionTaskScope, type SessionTaskScopeInput } from '../../shared/session-task-scope';
import {
  SESSION_DELEGATION_RECEIPT_SCHEMA,
  type SessionDelegationBudget,
  type SessionDelegationPayload,
  type SessionDelegationReceipt,
  type SessionDelegationResult,
  type SessionDelegationStatus,
} from '@shared/types/session-delegation';

const STORE_SCHEMA = 'clawx.session-delegation-store/v1' as const;
const MAX_REPLAY_ERROR = 400;

export type StoredSessionDelegationAdmission = {
  schemaVersion: typeof STORE_SCHEMA;
  idempotencyKey: string;
  requestHash: string;
  phase: 'in-flight' | 'approval-pending' | 'terminal';
  receipt: SessionDelegationReceipt;
  createdAt: string;
  updatedAt: string;
};

export type DelegationClaimResult =
  | { kind: 'claimed' }
  | { kind: 'existing'; record: StoredSessionDelegationAdmission }
  | { kind: 'conflict'; existingRequestHash: string };

export type SessionDelegationDependencies = {
  readAdmission: (idempotencyKey: string) => Promise<StoredSessionDelegationAdmission | null>;
  claimAdmission: (record: StoredSessionDelegationAdmission) => Promise<DelegationClaimResult>;
  commitAdmission: (record: StoredSessionDelegationAdmission) => Promise<void>;
  resolveCoordinator: (payload: {
    workspaceId: string;
    agentId: string;
    sessionKey: string;
  }) => WorkspaceCoordinatorBindingResult | Promise<WorkspaceCoordinatorBindingResult>;
  getActiveWorkspaceId: () => Promise<string | null>;
  gatewayRpc: (payload: GatewayRpcPayload) => unknown | Promise<unknown>;
  describeSessionGeneration: (sessionKey: string) => Promise<string | null>;
  assertTaskAdmission?: (input: { workspaceRoot: string; taskRef: string; sessionKey: string; generation: string; requestId: string }) => Promise<void>;
  resolveTaskScope: (input: {
    workspaceId: string;
    sessionKey: string;
    taskRef: string;
    bindingRevision: number;
    bindingState: WorkspaceCoordinatorBinding['state'];
    sessionGeneration: string;
  }) => SessionTaskScopeInput | Promise<SessionTaskScopeInput>;
  stopEpoch: (sessionKey: string) => number;
  now?: () => Date;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export function hashDelegationRequest(payload: SessionDelegationPayload): string {
  return createHash('sha256').update(stableJson({
    sessionKey: payload.sessionKey,
    workspaceId: payload.workspaceId,
    agentId: payload.agentId,
    taskRef: payload.taskRef,
    task: payload.task,
    expectedBindingRevision: payload.expectedBindingRevision,
    expectedSessionGeneration: payload.expectedSessionGeneration,
    idempotencyKey: payload.idempotencyKey,
    backend: payload.backend,
    worker: payload.worker,
    includeVerifier: payload.includeVerifier ?? false,
  })).digest('hex');
}

export function validateSessionDelegationPayload(value: unknown): { ok: true; payload: SessionDelegationPayload } | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: 'Delegation payload must be an object' };
  const workerRecord = isRecord(value.worker) ? value.worker : null;
  const sessionKey = readString(value.sessionKey);
  const workspaceId = readString(value.workspaceId);
  const agentId = readString(value.agentId);
  const taskRef = readString(value.taskRef);
  const task = readString(value.task);
  const idempotencyKey = readString(value.idempotencyKey);
  const expectedSessionGeneration = readString(value.expectedSessionGeneration);
  const expectedBindingRevision = readPositiveInteger(value.expectedBindingRevision);
  const roleName = readString(workerRecord?.roleName);
  const workerTask = readString(workerRecord?.task);
  const backend = value.backend;
  if (!sessionKey || !workspaceId || !agentId || !taskRef || !task || !idempotencyKey) {
    return { ok: false, error: 'sessionKey, workspaceId, agentId, taskRef, task, and idempotencyKey are required' };
  }
  if (!expectedSessionGeneration || expectedBindingRevision === null) {
    return { ok: false, error: 'expectedBindingRevision and expectedSessionGeneration are required' };
  }
  if (backend !== 'subagent') {
    return { ok: false, error: `Unsupported delegation backend: ${String(backend)}` };
  }
  if (!workerRecord || !roleName || !workerTask) {
    return { ok: false, error: 'worker.roleName and worker.task are required' };
  }
  const isolation = workerRecord.isolation;
  if (isolation !== undefined && isolation !== 'shared' && isolation !== 'worktree') {
    return { ok: false, error: 'worker.isolation must be shared or worktree' };
  }
  const rawWriteSet = workerRecord.writeSet;
  if (
    rawWriteSet !== undefined &&
    (!Array.isArray(rawWriteSet) || rawWriteSet.some((entry) => typeof entry !== 'string' || !entry.trim()))
  ) {
    return { ok: false, error: 'worker.writeSet must contain non-empty paths' };
  }
  return {
    ok: true,
    payload: {
      sessionKey,
      workspaceId,
      agentId,
      taskRef,
      task,
      expectedBindingRevision,
      expectedSessionGeneration,
      idempotencyKey,
      backend,
      worker: {
        roleName,
        task: workerTask,
        ...(readString(workerRecord.label) ? { label: readString(workerRecord.label) } : {}),
        ...(readString(workerRecord.modelRef) ? { modelRef: readString(workerRecord.modelRef) } : {}),
        ...(isolation ? { isolation } : {}),
        ...(Array.isArray(rawWriteSet) ? { writeSet: rawWriteSet.map((entry) => entry.trim()) } : {}),
        ...(readString(workerRecord.worktreeId) ? { worktreeId: readString(workerRecord.worktreeId) } : {}),
      },
      ...(value.includeVerifier === true ? { includeVerifier: true } : {}),
      ...(readString(value.approvalId) ? { approvalId: readString(value.approvalId) } : {}),
    },
  };
}

function unverifiedBudget(maxWorkers: number, reason: string): SessionDelegationBudget {
  return {
    status: 'unverified',
    reason,
    maxWorkers,
    process: {
      maxChildrenPerAgent: null,
      maxSpawnDepth: null,
      source: 'agents.defaults.subagents',
    },
    backgroundTerminal: {
      lane: 'subagent',
      maxConcurrent: null,
      activeCount: null,
      queuedCount: null,
      source: 'process.command-queue.subagent',
    },
  };
}

function buildPendingReceipt(params: {
  payload: SessionDelegationPayload;
  binding: WorkspaceCoordinatorBinding;
  status: 'in-flight' | 'approval-pending' | 'outcome-unknown';
  error?: string;
  admissionId?: string;
}): SessionDelegationReceipt {
  return {
    schemaVersion: SESSION_DELEGATION_RECEIPT_SCHEMA,
    admissionId: params.admissionId ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${params.payload.idempotencyKey}`,
    idempotencyKey: params.payload.idempotencyKey,
    status: params.status,
    orchestrationRunId: null,
    acceptedAt: null,
    coordinator: {
      workspaceId: params.payload.workspaceId,
      agentId: params.payload.agentId,
      sessionKey: params.payload.sessionKey,
      bindingRevision: params.binding.bindingRevision,
      sessionGeneration: params.binding.sessionGeneration!,
    },
    taskRef: params.payload.taskRef,
    parentEnvironment: { ...params.binding.environment },
    parentEnvironmentRevision: params.binding.bindingRevision,
    authorization: {
      approvalId: params.payload.approvalId ?? null,
      grantState: params.status === 'approval-pending' ? 'pending-approval' : 'not-observed',
      owner: 'gateway-permission',
    },
    budget: unverifiedBudget(1, params.status === 'in-flight' ? 'admission has not reached a Gateway receipt yet' : params.error ?? 'admission outcome is unknown'),
    scheduler: null,
    children: [],
    errors: params.error ? [params.error.slice(0, MAX_REPLAY_ERROR)] : [],
    completionObserved: false,
    recoveryRequired: params.status === 'outcome-unknown',
  };
}

function recordFromReceipt(
  requestHash: string,
  phase: StoredSessionDelegationAdmission['phase'],
  receipt: SessionDelegationReceipt,
  now: string,
  createdAt = now,
): StoredSessionDelegationAdmission {
  return {
    schemaVersion: STORE_SCHEMA,
    idempotencyKey: receipt.idempotencyKey,
    requestHash,
    phase,
    receipt,
    createdAt,
    updatedAt: now,
  };
}

function replayResult(record: StoredSessionDelegationAdmission, error?: string): SessionDelegationResult {
  const receipt = {
    ...record.receipt,
    replayed: true,
    ...(error ? { errors: [...record.receipt.errors, error].slice(0, 16) } : {}),
  };
  return {
    success: receipt.status === 'accepted' || receipt.status === 'partial',
    status: receipt.status,
    receipt,
    error: error ?? (receipt.errors[0] ?? undefined),
    replayed: true,
  };
}

function resultForReceipt(receipt: SessionDelegationReceipt): SessionDelegationResult {
  const success = receipt.status === 'accepted' || receipt.status === 'partial';
  return {
    success,
    status: receipt.status,
    receipt,
    error: success ? undefined : receipt.errors[0] ?? 'Delegation admission was rejected',
  };
}

function readDelegationReceipt(value: unknown): SessionDelegationReceipt | null {
  if (!isRecord(value) || value.schemaVersion !== SESSION_DELEGATION_RECEIPT_SCHEMA) return null;
  if (!Array.isArray(value.children) || !Array.isArray(value.errors)) return null;
  if (typeof value.admissionId !== 'string' || typeof value.idempotencyKey !== 'string') return null;
  return value as unknown as SessionDelegationReceipt;
}

async function resolveReadyBinding(
  payload: SessionDelegationPayload,
  deps: SessionDelegationDependencies,
): Promise<{ ok: true; binding: WorkspaceCoordinatorBinding } | { ok: false; error: string }> {
  const activeWorkspaceId = await deps.getActiveWorkspaceId();
  if (activeWorkspaceId !== payload.workspaceId) {
    return { ok: false, error: `Workspace ${payload.workspaceId} is not the active Main workspace` };
  }
  const resolved = await deps.resolveCoordinator({
    workspaceId: payload.workspaceId,
    agentId: payload.agentId,
    sessionKey: payload.sessionKey,
  });
  const binding = resolved.binding;
  if (!resolved.success || !binding || resolved.recovery.state !== 'ready') {
    return { ok: false, error: `Coordinator binding is ${resolved.recovery.state}: ${resolved.recovery.reason ?? 'not ready'}` };
  }
  if (binding.state !== 'active') {
    return { ok: false, error: `Coordinator binding is ${binding.state}` };
  }
  if (binding.bindingRevision !== payload.expectedBindingRevision) {
    return { ok: false, error: `Coordinator binding revision changed (${binding.bindingRevision} != ${payload.expectedBindingRevision})` };
  }
  if (!binding.sessionGeneration || binding.sessionGeneration !== payload.expectedSessionGeneration) {
    return { ok: false, error: 'Coordinator session generation changed' };
  }
  if (!binding.taskLedgerReferences.some((reference) => reference.taskLedgerNodeId === payload.taskRef)) {
    return { ok: false, error: `Task reference ${payload.taskRef} is not bound to this coordinator` };
  }
  return { ok: true, binding };
}

export async function executeSessionDelegation(
  rawPayload: unknown,
  deps: SessionDelegationDependencies,
): Promise<SessionDelegationResult> {
  const validated = validateSessionDelegationPayload(rawPayload);
  if (!validated.ok) return { success: false, status: 'rejected', error: validated.error };
  const payload = validated.payload;
  const requestHash = hashDelegationRequest(payload);
  const now = () => (deps.now?.() ?? new Date()).toISOString();

  const existing = await deps.readAdmission(payload.idempotencyKey);
  const pendingAdmissionId = existing?.phase === 'approval-pending'
    ? existing.receipt.admissionId
    : undefined;
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return {
        success: false,
        status: 'rejected',
        error: 'Idempotency key was already used with a different delegation request',
        replayed: false,
      };
    }
    if (existing.phase === 'terminal') return replayResult(existing);
    if (existing.phase === 'in-flight') {
      const receipt = {
        ...existing.receipt,
        status: 'outcome-unknown' as const,
        errors: [...existing.receipt.errors, 'Previous owner stopped before a terminal admission receipt was committed'],
        recoveryRequired: true,
        replayed: undefined,
      };
      const terminal = recordFromReceipt(requestHash, 'terminal', receipt, now(), existing.createdAt);
      await deps.commitAdmission(terminal);
      return replayResult(terminal, 'Previous delegation outcome is unknown; no second spawn was issued');
    }
  }

  const bindingResult = await resolveReadyBinding(payload, deps);
  if (!bindingResult.ok) return { success: false, status: 'rejected', error: bindingResult.error };
  const binding = bindingResult.binding;
  const generationBefore = await deps.describeSessionGeneration(payload.sessionKey);
  if (generationBefore !== payload.expectedSessionGeneration) {
    return { success: false, status: 'rejected', error: 'Parent session generation changed before admission' };
  }
  const scope = resolveSessionTaskScope(await deps.resolveTaskScope({
    workspaceId: payload.workspaceId,
    sessionKey: payload.sessionKey,
    taskRef: payload.taskRef,
    bindingRevision: binding.bindingRevision,
    bindingState: binding.state,
    sessionGeneration: payload.expectedSessionGeneration,
  }));
  if (scope.status !== 'ready') {
    return {
      success: false,
      status: 'rejected',
      error: `Task scope admission is ${scope.status}: ${'reason' in scope ? scope.reason : 'unknown'}`,
    };
  }
  try {
    await deps.assertTaskAdmission?.({workspaceRoot:binding.environment.canonicalRoot,taskRef:payload.taskRef,sessionKey:payload.sessionKey,generation:generationBefore,requestId:payload.idempotencyKey});
  } catch(error) {
    return {success:false,status:'rejected',error:error instanceof Error?error.message:String(error)};
  }
  const stopEpochBefore = deps.stopEpoch(payload.sessionKey);
  const inFlight = buildPendingReceipt({
    payload,
    binding,
    status: 'in-flight',
    ...(pendingAdmissionId ? { admissionId: pendingAdmissionId } : {}),
  });
  const inFlightRecord = recordFromReceipt(requestHash, 'in-flight', inFlight, now());
  const claim = await deps.claimAdmission(inFlightRecord);
  if (claim.kind === 'conflict') {
    return { success: false, status: 'rejected', error: 'Idempotency key was already used with a different delegation request' };
  }
  if (claim.kind === 'existing') {
    if (claim.record.phase === 'terminal') return replayResult(claim.record);
    if (claim.record.phase === 'in-flight') {
      const receipt = {
        ...claim.record.receipt,
        status: 'outcome-unknown' as const,
        errors: [...claim.record.receipt.errors, 'Concurrent owner retry found an unresolved in-flight admission'],
        recoveryRequired: true,
      };
      const terminal = recordFromReceipt(requestHash, 'terminal', receipt, now(), claim.record.createdAt);
      await deps.commitAdmission(terminal);
      return replayResult(terminal, 'Delegation outcome is unknown; no second spawn was issued');
    }
  }

  let gatewayResult: unknown;
  try {
    gatewayResult = await deps.gatewayRpc({
      method: 'orchestrator.run',
      params: {
        task: payload.task,
        sessionKey: payload.sessionKey,
        agentId: payload.agentId,
        workspaceDir: binding.environment.canonicalRoot,
        backend: payload.backend,
        workers: [{
          roleName: payload.worker.roleName,
          task: payload.worker.task,
          ...(payload.worker.label ? { label: payload.worker.label } : {}),
          ...(payload.worker.modelRef ? { modelRef: payload.worker.modelRef } : {}),
          ...(payload.worker.isolation ? { isolation: payload.worker.isolation } : {}),
          ...(payload.worker.writeSet ? { writeSet: payload.worker.writeSet } : {}),
          ...(payload.worker.worktreeId ? { worktreeId: payload.worker.worktreeId } : {}),
        }],
        includeVerifier: payload.includeVerifier ?? false,
        delegationAdmission: {
          schemaVersion: 'clawx.session-delegation-admission/v1',
          admissionId: inFlight.admissionId,
          idempotencyKey: payload.idempotencyKey,
          coordinator: inFlight.coordinator,
          taskRef: payload.taskRef,
          parentEnvironment: inFlight.parentEnvironment,
        },
      },
      timeoutMs: 180_000,
      ...(payload.approvalId ? { approvalId: payload.approvalId } : {}),
    });
  } catch (error) {
    const receipt = {
      ...inFlight,
      status: 'outcome-unknown' as const,
      errors: [`Gateway admission result was lost: ${error instanceof Error ? error.message : String(error)}`.slice(0, MAX_REPLAY_ERROR)],
      recoveryRequired: true,
    };
    const terminal = recordFromReceipt(requestHash, 'terminal', receipt, now(), inFlightRecord.createdAt);
    await deps.commitAdmission(terminal);
    return resultForReceipt(receipt);
  }

  if (isRecord(gatewayResult) && gatewayResult.approvalRequired === true) {
    const receipt = {
      ...inFlight,
      status: 'approval-pending' as const,
      authorization: { ...inFlight.authorization, grantState: 'pending-approval' as const },
      errors: [],
    };
    await deps.commitAdmission(recordFromReceipt(requestHash, 'approval-pending', receipt, now(), inFlightRecord.createdAt));
    return {
      success: false,
      status: 'approval-pending',
      receipt,
      approval: gatewayResult.approval,
      error: typeof gatewayResult.error === 'string' ? gatewayResult.error : 'Delegation requires Gateway approval',
    };
  }

  const runtimeReceipt = isRecord(gatewayResult)
    ? readDelegationReceipt(gatewayResult.delegationReceipt)
    : null;
  if (!runtimeReceipt) {
    const receipt = {
      ...inFlight,
      status: 'outcome-unknown' as const,
      errors: ['Gateway completed without a long-session delegation receipt'],
      recoveryRequired: true,
    };
    const terminal = recordFromReceipt(requestHash, 'terminal', receipt, now(), inFlightRecord.createdAt);
    await deps.commitAdmission(terminal);
    return resultForReceipt(receipt);
  }
  if (
    runtimeReceipt.admissionId !== inFlight.admissionId ||
    runtimeReceipt.idempotencyKey !== payload.idempotencyKey ||
    runtimeReceipt.coordinator.sessionKey !== payload.sessionKey ||
    runtimeReceipt.taskRef !== payload.taskRef
  ) {
    const receipt = {
      ...inFlight,
      status: 'rejected' as const,
      errors: ['Gateway delegation receipt failed scope or idempotency validation'],
    };
    const terminal = recordFromReceipt(requestHash, 'terminal', receipt, now(), inFlightRecord.createdAt);
    await deps.commitAdmission(terminal);
    return resultForReceipt(receipt);
  }

  const generationAfter = await deps.describeSessionGeneration(payload.sessionKey);
  const stopChanged = deps.stopEpoch(payload.sessionKey) !== stopEpochBefore;
  const generationChanged = generationAfter !== payload.expectedSessionGeneration;
  let status: SessionDelegationStatus = runtimeReceipt.status;
  const errors = [...runtimeReceipt.errors];
  if (generationChanged) errors.push('Parent session generation changed during admission');
  if (stopChanged) errors.push('Parent session stop raced with admission');
  if ((generationChanged || stopChanged) && runtimeReceipt.children.some((child) => child.admissionStatus === 'accepted')) {
    status = 'outcome-unknown';
  } else if (generationChanged || stopChanged) {
    status = 'rejected';
  }
  const receipt: SessionDelegationReceipt = {
    ...runtimeReceipt,
    status,
    parentEnvironment: { ...binding.environment },
    parentEnvironmentRevision: binding.bindingRevision,
    authorization: {
      approvalId: payload.approvalId ?? null,
      grantState: status === 'rejected' ? 'rejected' : 'authorized',
      owner: 'gateway-permission',
    },
    errors: [...new Set(errors)].slice(0, 16),
    completionObserved: false,
    recoveryRequired: status === 'outcome-unknown',
  };
  const terminal = recordFromReceipt(requestHash, 'terminal', receipt, now(), inFlightRecord.createdAt);
  await deps.commitAdmission(terminal);
  return resultForReceipt(receipt);
}
