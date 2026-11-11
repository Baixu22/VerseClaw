import type { WorkspaceCoordinatorEnvironmentBinding } from './workspace.js';

export const SESSION_DELEGATION_RECEIPT_SCHEMA = 'clawx.session-delegation-receipt/v1' as const;
export const SESSION_DELEGATION_ADMISSION_SCHEMA = 'clawx.session-delegation-admission/v1' as const;

export type SessionDelegationBackend = 'subagent';
export type SessionDelegationIsolationMode = 'shared' | 'worktree';
export type SessionDelegationIsolationBackend =
  | 'shared-inprocess'
  | 'inprocess-worktree'
  | 'git-worktree';

export type SessionDelegationStatus =
  | 'in-flight'
  | 'approval-pending'
  | 'accepted'
  | 'partial'
  | 'rejected'
  | 'outcome-unknown';

export type SessionDelegationCoordinator = {
  workspaceId: string;
  agentId: string;
  sessionKey: string;
  bindingRevision: number;
  sessionGeneration: string;
};

export type SessionDelegationWorkerPlan = {
  roleName: string;
  task: string;
  label?: string;
  modelRef?: string;
  isolation?: SessionDelegationIsolationMode;
  writeSet?: string[];
  worktreeId?: string;
};

export type SessionDelegationToolAuthorization = {
  status: 'effective' | 'runtime-inherited';
  source: 'role-contract+parent-clamp' | 'role-contract+runtime-inheritance';
  roleName: string;
  effectiveRoleName: string;
  parentRoleName: string | null;
  allowlist: string[] | null;
  denylist: string[];
};

export type SessionDelegationIsolation = {
  mode: SessionDelegationIsolationMode;
  backend: SessionDelegationIsolationBackend;
  canonicalRoot: string;
  branch: string | null;
  detachedHead: boolean | null;
  verifiedCheckout: boolean;
  worktreeId?: string;
};

export type SessionDelegationChildReceipt = {
  roleName: string;
  taskNodeId: string;
  roleInstanceId: string;
  admissionStatus: 'accepted' | 'rejected';
  runState: 'accepted-not-completed' | 'not-accepted';
  completionObserved: false;
  backend: SessionDelegationBackend;
  childSessionKey: string | null;
  childRunId: string | null;
  toolAuthorization: SessionDelegationToolAuthorization;
  isolation: SessionDelegationIsolation;
  schedulerWave: number | null;
  error: string | null;
};

export type SessionDelegationSchedulerReceipt = {
  executionWaves: Array<{
    wave: number;
    taskNodeIds: string[];
    roles: string[];
    reason: string;
    deferredReasons?: string[];
  }>;
  metrics: {
    queued: number;
    running: number;
    scheduled: number;
    skipped: number;
    concurrencyCap: number;
    budgetEstimate: number;
  };
};

export type SessionDelegationBudget = {
  status: 'observed' | 'unverified';
  reason: string | null;
  maxWorkers: number;
  process: {
    maxChildrenPerAgent: number | null;
    maxSpawnDepth: number | null;
    source: 'agents.defaults.subagents';
  };
  backgroundTerminal: {
    lane: 'subagent';
    maxConcurrent: number | null;
    activeCount: number | null;
    queuedCount: number | null;
    source: 'process.command-queue.subagent';
  };
};

export type SessionDelegationAdmission = {
  schemaVersion: typeof SESSION_DELEGATION_ADMISSION_SCHEMA;
  admissionId: string;
  idempotencyKey: string;
  coordinator: SessionDelegationCoordinator;
  taskRef: string;
  parentEnvironment: WorkspaceCoordinatorEnvironmentBinding;
};

export type SessionDelegationAuthorization = {
  approvalId: string | null;
  grantState: 'authorized' | 'pending-approval' | 'rejected' | 'not-observed';
  owner: 'gateway-permission';
};

export type SessionDelegationReceipt = {
  schemaVersion: typeof SESSION_DELEGATION_RECEIPT_SCHEMA;
  admissionId: string;
  idempotencyKey: string;
  status: SessionDelegationStatus;
  orchestrationRunId: string | null;
  acceptedAt: string | null;
  coordinator: SessionDelegationCoordinator;
  taskRef: string;
  parentEnvironment: WorkspaceCoordinatorEnvironmentBinding;
  parentEnvironmentRevision: number;
  authorization: SessionDelegationAuthorization;
  budget: SessionDelegationBudget;
  scheduler: SessionDelegationSchedulerReceipt | null;
  children: SessionDelegationChildReceipt[];
  errors: string[];
  completionObserved: false;
  recoveryRequired: boolean;
  replayed?: boolean;
};

export type SessionDelegationPayload = {
  sessionKey: string;
  workspaceId: string;
  agentId: string;
  taskRef: string;
  task: string;
  expectedBindingRevision: number;
  expectedSessionGeneration: string;
  idempotencyKey: string;
  backend: SessionDelegationBackend;
  worker: SessionDelegationWorkerPlan;
  includeVerifier?: boolean;
  approvalId?: string;
};

export type SessionDelegationResult = {
  success: boolean;
  status: SessionDelegationStatus;
  receipt?: SessionDelegationReceipt;
  approval?: unknown;
  error?: string;
  replayed?: boolean;
};