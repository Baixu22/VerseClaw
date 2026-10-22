export const VG_CANDIDATE_SCHEMA = "clawx.versegit.candidate/v1";
export const VG_CANDIDATE_NEGATIVE_SCHEMA = "clawx.versegit.candidate-negative/v1";

export type VerseGitCandidateSnapshot = {
  taskNodeId: string;
  parentOrder: number;
  worktreeRole: string;
  headOid: string;
  baseOid: string;
  statusDigest: string;
  changedFiles: string[];
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
