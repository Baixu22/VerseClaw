export const DELEGATION_ADMISSION_RECEIPT_SCHEMA = 'DelegationAdmissionReceipt/v1' as const;

export type DelegationAdmissionState = 'submitting' | 'accepted' | 'rejected' | 'unknown';

export type DelegationCoordinatorScope = {
  workspaceId: string;
  agentId: string;
  sessionKey: string;
  sessionId: string;
  bindingRevision: number;
};

export type DelegationTaskRef = {
  kind: 'task-ledger';
  nodeId: string;
};

export type DelegationBackend = {
  kind: 'openclaw-embedded' | 'acp' | 'unknown';
  provider: string | null;
  model: string | null;
  evidence: string;
};

export type DelegationToolAuthorization = {
  allowlist: string[];
  denylist: string[];
  permissionDecisionCount: number;
  source: 'role-clamped-inherited' | 'unresolved';
};

export type DelegationIsolation = {
  mode: 'worktree' | 'inprocess-shared' | 'unknown';
  backend: 'git' | 'inprocess' | 'unknown';
  worktreeId: string | null;
  writeSet: string[];
  parallelWritesAllowed: boolean;
  writeSetBasis:
    | 'git-checkout'
    | 'explicit-disjoint-writeset'
    | 'serialized'
    | 'writer-without-proof'
    | 'read-only'
    | 'unresolved';
};

/**
 * Durable admission fact. `accepted` means the already-existing runtime owner
 * admitted a child; it is not a running or completion receipt.
 */
export type DelegationAdmissionReceipt = {
  schemaVersion: typeof DELEGATION_ADMISSION_RECEIPT_SCHEMA;
  receiptId: string;
  idempotencyKey: string;
  requestDigest: string;
  coordinator: DelegationCoordinatorScope;
  taskRef: DelegationTaskRef;
  roleName: string;
  task: string;
  state: DelegationAdmissionState;
  /** Explicit guard against projecting admission as task/run completion. */
  acceptedIsNotCompletion: true;
  orchestrationRunId: string | null;
  taskNodeId: string | null;
  taskId: string | null;
  roleInstanceId: string | null;
  childSessionKey: string | null;
  childRunId: string | null;
  backend: DelegationBackend;
  toolAuthorization: DelegationToolAuthorization;
  isolation: DelegationIsolation;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  rejectedAt: string | null;
};
