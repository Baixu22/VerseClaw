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
