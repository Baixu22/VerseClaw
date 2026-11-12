export const VG_CANDIDATE_SCHEMA = "clawx.versegit.candidate/v1";
export const VG_CANDIDATE_NEGATIVE_SCHEMA = "clawx.versegit.candidate-negative/v1";

export type VerseGitCandidateSnapshot = {
  taskNodeId: string;
  parentOrder: number;
  worktreeRole: string;
  worktreeGeneration?: string;
  headOid: string;
  baseOid: string;
  statusDigest: string;
  changedFiles: string[];
  postimageHashes?: Record<string, string | null>;
  treeOid: string;
  commitOid: string;
};

export type VerseGitCandidateRef = { ref: string; oid: string };

export type VerseGitCandidateManifest = {
  schema: typeof VG_CANDIDATE_SCHEMA;
  candidateId: string;
  baseOid: string;
  baseTreeOid: string;
  workerSnapshots: VerseGitCandidateSnapshot[];
  candidateCommitOid: string;
  candidateTreeOid: string;
  refsBefore: VerseGitCandidateRef[];
  refsAfter: VerseGitCandidateRef[];
  mainStateBeforeDigest: string;
  mainStateAfterDigest: string;
  mainUnchanged: boolean;
  verificationCwdRole: "host-disposable-candidate";
  materializedPathRole: string;
  materializedIdentity?: { rootPath: string; nativeIdentity: string };
  allowedRuntimeIgnorePaths: string[];
  inputDigest: string;
};

export type VerseGitCandidateResult =
  | {
      status: "frozen";
      manifest: VerseGitCandidateManifest;
      materializedPath: string;
      issues: string[];
    }
  | {
      status: "conflict" | "rejected";
      reason: string;
      issues: string[];
      mainBefore: Record<string, unknown>;
      mainAfter: Record<string, unknown>;
      refsBefore: VerseGitCandidateRef[];
      refsAfter: VerseGitCandidateRef[];
    };

export type VerseGitCandidateNegative = {
  schema: typeof VG_CANDIDATE_NEGATIVE_SCHEMA;
  case: "merge_conflict" | "main_dirty" | "untracked" | "worker_refresh" | "base_drift" | "write_set_mismatch";
  rejected: boolean;
  reason: string;
  mainUnchanged: boolean;
  refsUnchanged: boolean;
};


export const VG_COMPLETION_CONTRACT_VERSION = 'clawx.versegit.completion-contract/v1' as const;
export const VG_HOST_COMPLETION_SCHEMA = 'clawx.versegit.host-completion/v1' as const;
export const VG_COMPLETION_STORE_SCHEMA = 'clawx.versegit.completion-store/v1' as const;
export const VG_LEGACY_COMPLETION_SCHEMA = 'clawx.versegit.completion/v0' as const;

export const VG_HOST_COMPLETION_OUTCOMES = ['applied', 'not_applied', 'unknown'] as const;
export type VerseGitHostCompletionOutcome = (typeof VG_HOST_COMPLETION_OUTCOMES)[number];

export const VG_PROVIDER_COMPLETION_PROJECTIONS = ['active', 'abandoned', 'host-completed'] as const;
export type VerseGitProviderCompletionProjection = (typeof VG_PROVIDER_COMPLETION_PROJECTIONS)[number];

export const VG_HOST_COMPLETION_MAPPING = Object.freeze({
  applied: Object.freeze({
    providerProjection: 'host-completed',
    activeSessionRisk: false,
    recoveryRequired: false,
    providerLanded: false,
  }),
  not_applied: Object.freeze({
    providerProjection: 'abandoned',
    activeSessionRisk: false,
    recoveryRequired: false,
    providerLanded: false,
  }),
  unknown: Object.freeze({
    providerProjection: 'abandoned',
    activeSessionRisk: false,
    recoveryRequired: true,
    providerLanded: false,
  }),
} satisfies Record<VerseGitHostCompletionOutcome, {
  providerProjection: VerseGitProviderCompletionProjection;
  activeSessionRisk: boolean;
  recoveryRequired: boolean;
  providerLanded: false;
}>);

export type VerseGitCompletionIdentity = {
  ownerId: string;
  epoch: number;
  authorizationId: string;
  sessionId: string;
  runId: string;
  candidateId: string;
  candidateTreeOid: string;
  candidateInputDigest: string;
  receiptDigest: string;
  effectId: string;
};

export type VerseGitHostCompletionFact = {
  schema: typeof VG_HOST_COMPLETION_SCHEMA;
  contractVersion: typeof VG_COMPLETION_CONTRACT_VERSION;
  factId: string;
  idempotencyKey: string;
  recordedAt: string;
  actor: string;
  drivenBy: 'agent';
  identity: VerseGitCompletionIdentity;
  hostOutcome: VerseGitHostCompletionOutcome;
  providerProjection: VerseGitProviderCompletionProjection;
  providerProjectionSource: 'host-completion-fact';
  providerLanded: false;
  activeSessionRisk: boolean;
  recoveryRequired: boolean;
  reason: string | null;
  legacyUnbound: boolean;
  recoveryOf: string | null;
};

export type VerseGitCompletionStoreRecord = {
  schema: typeof VG_COMPLETION_STORE_SCHEMA;
  sessionId: string;
  revision: number;
  current: VerseGitHostCompletionFact;
  history: VerseGitHostCompletionFact[];
};

export type VerseGitLegacyCompletionRecord = {
  schema: typeof VG_LEGACY_COMPLETION_SCHEMA;
  sessionId: string;
  outcome: 'success' | 'cancelled' | 'failed' | 'unknown';
  recordedAt?: string;
  candidateId?: string;
  receiptDigest?: string;
};

export type VerseGitCompletionSink = {
  record(input: {
    identity: VerseGitCompletionIdentity;
    hostOutcome: VerseGitHostCompletionOutcome;
    idempotencyKey: string;
    actor: string;
    reason?: string | null;
    recoveryOf?: string | null;
    recordedAt?: string;
  }): {
    status: 'recorded' | 'duplicate' | 'rejected';
    reason: string | null;
    fact: VerseGitHostCompletionFact | null;
  };
};

export const VG_CLEANUP_BARRIER_SCHEMA = 'clawx.versegit.cleanup-barrier/v1' as const;
export const VG_CLEANUP_RESOURCE_KINDS = ['process', 'manager', 'worktree', 'temp'] as const;
export type VerseGitCleanupResourceKind = (typeof VG_CLEANUP_RESOURCE_KINDS)[number];
export type VerseGitCleanupStage =
  | 'stop_accepting'
  | 'drain_cancel'
  | 'seal_evidence'
  | 'detach_vg'
  | 'verify_owner_epoch_ref'
  | 'delete_disposable';
export type VerseGitCleanupIdentity = {
  ownerId: string;
  epoch: number;
  authorizationId: string;
  baseOid: string;
  refsDigest: string;
};
export type VerseGitCleanupInventory = {
  observed: boolean;
  processes: number | null;
  managers: number | null;
  worktrees: number | null;
  tempRoots: number | null;
  survivors?: string[];
};
export type VerseGitCleanupResource = {
  kind: VerseGitCleanupResourceKind;
  id: string;
  target?: string;
  owned: boolean;
  preserve: boolean;
};
export type VerseGitCleanupBarrierRecord = {
  schema: typeof VG_CLEANUP_BARRIER_SCHEMA;
  sealId: string;
  runId: string;
  sessionId: string;
  bindingId: string;
  actor: string;
  driven_by: 'agent';
  sealedAt: string;
  deletedAt: string | null;
  status: 'sealed' | 'detached' | 'deleted' | 'recovery_required' | 'rejected';
  stages: Partial<Record<VerseGitCleanupStage, string>>;
  expected: VerseGitCleanupIdentity;
  current: VerseGitCleanupIdentity;
  references: string[];
  evidenceDigests: string[];
  inventoryBefore: VerseGitCleanupInventory;
  inventoryAfter: VerseGitCleanupInventory | null;
  resources: VerseGitCleanupResource[];
  deletedKinds: VerseGitCleanupResourceKind[];
  issues: string[];
  lateEvents: Array<{ event: string; epoch: number; at: string; accepted: false }>;
};
export type VerseGitCleanupSealInput = {
  runId: string;
  sessionId: string;
  bindingId: string;
  actor: string;
  expected: VerseGitCleanupIdentity;
  current: VerseGitCleanupIdentity;
  references: readonly string[];
  evidenceDigests: readonly string[];
  inventoryBefore: VerseGitCleanupInventory;
  resources: readonly VerseGitCleanupResource[];
  deletedKinds: readonly VerseGitCleanupResourceKind[];
  stopAccepting: boolean;
  drain: { ok: boolean; issues: readonly string[] };
};
export type VerseGitCleanupDeletionAuthorization = {
  barrierRoot: string;
  runId: string;
  sealId: string;
  resourceKind: VerseGitCleanupResourceKind;
  resourceId: string;
  expected: VerseGitCleanupIdentity;
};
export type VerseGitCleanupBarrierPort = {
  read(runId: string): VerseGitCleanupBarrierRecord | null;
  seal(input: VerseGitCleanupSealInput): { ok: boolean; sealId: string | null; issues: string[]; record: VerseGitCleanupBarrierRecord | null };
  markDetached(input: { runId: string; sealId: string; current: VerseGitCleanupIdentity; vgDetached: boolean }): { ok: boolean; issues: string[]; record: VerseGitCleanupBarrierRecord | null };
  complete(input: { runId: string; sealId: string; inventoryAfter: VerseGitCleanupInventory }): { ok: boolean; issues: string[]; record: VerseGitCleanupBarrierRecord | null };
  recoveryRequired(input: { runId: string; sealId?: string | null; issues: readonly string[]; inventoryAfter: VerseGitCleanupInventory | null }): { ok: boolean; record: VerseGitCleanupBarrierRecord | null };
  observeLateEvent(input: { runId: string; event: string; epoch: number }): { accepted: boolean; record: VerseGitCleanupBarrierRecord | null };
  authorizeDeletion(input: Omit<VerseGitCleanupDeletionAuthorization, 'barrierRoot'>): { ok: boolean; issues: string[]; record: VerseGitCleanupBarrierRecord | null };
};
