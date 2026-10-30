import type { TurnIdentity } from './context-control-plane/artifacts';
import type { GitPatchArtifactV1 } from './remote-forge';

export const CHANGE_CONTEXT_STATES = [
  'available',
  'partial',
  'truncated',
  'stale',
  'removed',
  'unavailable',
] as const;

export type ChangeContextState = (typeof CHANGE_CONTEXT_STATES)[number];

export const CHANGE_CONTEXT_REVIEW_ANCHOR_STATES = [
  'live',
  'stale',
  'removed',
  'unavailable',
] as const;

export type ChangeContextReviewAnchorState = (typeof CHANGE_CONTEXT_REVIEW_ANCHOR_STATES)[number];

export const CHANGE_CONTEXT_COMPARISON_MODES = [
  'merge-base',
  'last-commit',
  'last-turn',
  'checkpoint',
] as const;

export type ChangeContextComparisonMode = (typeof CHANGE_CONTEXT_COMPARISON_MODES)[number];

export const CHANGE_CONTEXT_REVIEW_VERDICTS = [
  'approve',
  'request_changes',
  'comment_only',
] as const;

export type ChangeContextReviewVerdictDecision = (typeof CHANGE_CONTEXT_REVIEW_VERDICTS)[number];

export type ChangeContextSource =
  | 'session'
  | 'transcript'
  | 'workspace'
  | 'git'
  | 'code-review'
  | 'observability'
  | 'task-ledger'
  | 'versegit'
  | 'checkpoint'
  | 'review-store';

export type ChangeContextActor = {
  id: string;
  kind: 'agent' | 'user' | 'system';
  /** Required when an automated actor is standing in for an interactive action. */
  drivenBy?: 'agent' | 'human';
};

export type ChangeContextGitCommitRevision = {
  kind: 'git-commit';
  commit: string;
  treeDigest: string | null;
};

export type ChangeContextGitWorktreeRevision = {
  kind: 'git-worktree';
  workspaceId: string | null;
  headCommit: string | null;
  worktreeDigest: string | null;
};

export type ChangeContextTranscriptSeqBounds = {
  start: number;
  end: number;
};

export type ChangeContextTurnRevision = {
  kind: 'turn';
  turn: TurnIdentity | null;
  runtimeTurnId: string | null;
  transcriptSeq: ChangeContextTranscriptSeqBounds | null;
  transcriptDigest: string | null;
};

export type ChangeContextCheckpointRevision = {
  kind: 'checkpoint';
  checkpointId: string;
  checkpointDigest: string | null;
};

export type ChangeContextRevisionRef =
  | ChangeContextGitCommitRevision
  | ChangeContextGitWorktreeRevision
  | ChangeContextTurnRevision
  | ChangeContextCheckpointRevision;

export type ChangeContextMergeBaseComparisonRequest = {
  mode: 'merge-base';
  baseRef: string;
};

export type ChangeContextLastCommitComparisonRequest = {
  mode: 'last-commit';
  commit: string;
};

export type ChangeContextLastTurnComparisonRequest = {
  mode: 'last-turn';
};

export type ChangeContextCheckpointComparisonRequest = {
  mode: 'checkpoint';
  checkpointId: string;
};

export type ChangeContextComparisonRequest =
  | ChangeContextMergeBaseComparisonRequest
  | ChangeContextLastCommitComparisonRequest
  | ChangeContextLastTurnComparisonRequest
  | ChangeContextCheckpointComparisonRequest;

export type ChangeContextIssueCode =
  | 'missing_source'
  | 'source_unavailable'
  | 'source_partial'
  | 'source_truncated'
  | 'source_stale'
  | 'source_removed'
  | 'digest_missing'
  | 'not_implemented'
  | 'invalid_payload'
  | 'not_found'
  | 'conflict'
  | 'approval_required'
  | 'capacity_exceeded'
  | 'internal';

export type ChangeContextIssue = {
  code: ChangeContextIssueCode;
  message: string;
  source?: ChangeContextSource;
  revision?: ChangeContextRevisionRef | null;
};

export type ChangeContextComparison = {
  mode: ChangeContextComparisonMode;
  state: ChangeContextState;
  base: ChangeContextRevisionRef | null;
  candidate: ChangeContextRevisionRef | null;
  resolvedAt: string;
  issues: ChangeContextIssue[];
};

export type ChangeContextDiffEntry = {
  path: string;
  previousPath?: string;
  changeKind: 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';
  additions: number | null;
  deletions: number | null;
  patchDigest: string | null;
  contentState: ChangeContextState;
};

export type ChangeContextDiffProjection = {
  state: ChangeContextState;
  files: ChangeContextDiffEntry[];
  patchArtifacts: GitPatchArtifactV1[];
  stats: {
    files: number;
    additions: number;
    deletions: number;
    patchBytes: number;
  } | null;
  truncated: boolean;
  issues: ChangeContextIssue[];
};

export type ChangeContextIdentity = {
  workspaceId: string | null;
  sessionKey: string;
  runId: string | null;
  turn: TurnIdentity | null;
};

export type ChangeContextEvidenceProjection = {
  source: Extract<ChangeContextSource, 'code-review' | 'observability' | 'versegit' | 'checkpoint'>;
  state: ChangeContextState;
  advisory: true;
  hostVerdict: 'unchanged';
  summary: string;
  refs: string[];
};

export type ChangeContextReviewCommentRange = {
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
};

export type ChangeContextReviewCommentAnchor = {
  path: string;
  range: ChangeContextReviewCommentRange;
  fileDigest: string | null;
  rangeDigest: string | null;
  baseRevision: ChangeContextRevisionRef | null;
  candidateRevision: ChangeContextRevisionRef | null;
  originalExcerpt: string;
};

export type ChangeContextReviewAnchorRevision = {
  kind: 'source-snapshot';
  revisionId: string;
  fileDigest: string;
  rangeDigest: string;
};

export type ChangeContextReviewAnchorFacetState = 'match' | 'changed' | 'missing';

export type ChangeContextReviewAnchorFreshness = {
  state: ChangeContextReviewAnchorState;
  fileDigestState: ChangeContextReviewAnchorFacetState;
  rangeDigestState: ChangeContextReviewAnchorFacetState;
  issues: ChangeContextIssue[];
};

export type ChangeContextReviewAnchorResolver = (
  anchor: ChangeContextReviewCommentAnchor,
) => Promise<ChangeContextReviewAnchorRevision | null>;

export type ChangeContextReviewComment = {
  id: string;
  schemaVersion: 1;
  workspaceId: string | null;
  sessionKey: string;
  contextId: string;
  body: string;
  author: ChangeContextActor;
  anchor: ChangeContextReviewCommentAnchor;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  deletedAt: string | null;
  deletionReason: string | null;
  reanchorCount: number;
};

export type ChangeContextReviewCommentProjection = {
  comment: ChangeContextReviewComment;
  anchorState: ChangeContextReviewAnchorState;
  anchorIssues: ChangeContextIssue[];
};

export type ChangeContextReviewCommentStorePolicy = {
  owner: 'main-change-context-review-store';
  schemaVersion: 1;
  storage: 'electron-store';
  storeName: 'change-context-review-comments';
  maxRecords: number;
  maxBodyChars: number;
  deletion: 'explicit-tombstone';
  capacityBehavior: 'reject';
  restoreSemantics: 'review-evidence-only';
  authority: {
    session: false;
    task: false;
    execution: false;
    approval: false;
    gitMutation: false;
  };
};

export const CHANGE_CONTEXT_REVIEW_COMMENT_STORE_POLICY = {
  owner: 'main-change-context-review-store',
  schemaVersion: 1,
  storage: 'electron-store',
  storeName: 'change-context-review-comments',
  maxRecords: 2_000,
  maxBodyChars: 20_000,
  deletion: 'explicit-tombstone',
  capacityBehavior: 'reject',
  restoreSemantics: 'review-evidence-only',
  authority: {
    session: false,
    task: false,
    execution: false,
    approval: false,
    gitMutation: false,
  },
} as const satisfies ChangeContextReviewCommentStorePolicy;

export type ChangeContextProjection = {
  schemaVersion: 1;
  contextId: string;
  identity: ChangeContextIdentity;
  comparison: ChangeContextComparison | null;
  diff: ChangeContextDiffProjection | null;
  comments: ChangeContextReviewCommentProjection[];
  evidence: ChangeContextEvidenceProjection[];
  issues: ChangeContextIssue[];
  generatedAt: string;
  reviewedDigest?: string;
};

export type ChangeContextErrorCode =
  | 'validation'
  | 'unavailable'
  | 'partial'
  | 'truncated'
  | 'stale'
  | 'removed'
  | 'not_found'
  | 'conflict'
  | 'approval_required'
  | 'capacity_exceeded'
  | 'not_implemented'
  | 'internal';

export type ChangeContextErrorEnvelope = {
  schema: 'ChangeContextError/v1';
  code: ChangeContextErrorCode;
  retryable: boolean;
  requestId: string;
  safeMessage: string;
  details?: Record<string, unknown>;
};

export type ChangeContextProjectionPayload = {
  workspaceId?: string | null;
  sessionKey: string;
  comparison: ChangeContextComparisonRequest;
};

export type ChangeContextProjectionResult = {
  success: boolean;
  error?: ChangeContextErrorEnvelope;
  projection?: ChangeContextProjection;
};

export type ChangeContextReviewCommentListPayload = {
  workspaceId?: string | null;
  sessionKey: string;
  contextId?: string;
  includeDeleted?: boolean;
};

export type ChangeContextReviewCommentListResult = {
  success: boolean;
  error?: ChangeContextErrorEnvelope;
  storeState: ChangeContextState;
  comments: ChangeContextReviewCommentProjection[];
};

export type ChangeContextReviewCommentCreatePayload = {
  workspaceId?: string | null;
  sessionKey: string;
  contextId: string;
  body: string;
  author: ChangeContextActor;
  anchor: ChangeContextReviewCommentAnchor;
};

export type ChangeContextReviewCommentResolvePayload = {
  commentId: string;
  resolved: boolean;
  author: ChangeContextActor;
};

export type ChangeContextReviewCommentReanchorPayload = {
  commentId: string;
  expectedUpdatedAt: string;
  author: ChangeContextActor;
  anchor: ChangeContextReviewCommentAnchor;
  reason: string;
};

export type ChangeContextReviewCommentDeletePayload = {
  commentId: string;
  expectedUpdatedAt: string;
  author: ChangeContextActor;
  reason: string;
};

export type ChangeContextReviewCommentMutationResult = {
  success: boolean;
  error?: ChangeContextErrorEnvelope;
  comment?: ChangeContextReviewComment;
};

export type ChangeContextReviewTaskLedgerLink = {
  direction: 'review-to-task-ledger';
  taskLedgerNodeId: string;
  taskLedgerWorkspaceId: string | null;
  linkedAt: string;
  created: boolean;
};

export type ChangeContextReviewVerdictAuthority = {
  completesTaskLedgerNode: false;
  executesCode: false;
  grantsApproval: false;
};

type ChangeContextReviewVerdictBase = {
  id: string;
  schemaVersion: 1;
  contextId: string;
  workspaceId: string | null;
  sessionKey: string;
  reviewedDigest: string;
  commentIds: string[];
  author: ChangeContextActor;
  createdAt: string;
  authority: ChangeContextReviewVerdictAuthority;
};

export type ChangeContextApproveVerdict = ChangeContextReviewVerdictBase & {
  decision: 'approve';
  taskLedgerEffect: 'none';
  taskLedgerLink: null;
};

export type ChangeContextCommentOnlyVerdict = ChangeContextReviewVerdictBase & {
  decision: 'comment_only';
  taskLedgerEffect: 'none';
  taskLedgerLink: null;
};

export type ChangeContextRequestChangesVerdict = ChangeContextReviewVerdictBase & {
  decision: 'request_changes';
  taskLedgerEffect: 'link_only';
  taskLedgerLink: ChangeContextReviewTaskLedgerLink | null;
};

export type ChangeContextReviewVerdict =
  | ChangeContextApproveVerdict
  | ChangeContextCommentOnlyVerdict
  | ChangeContextRequestChangesVerdict;

export type ChangeContextReviewVerdictPayload = {
  workspaceId?: string | null;
  sessionKey: string;
  contextId: string;
  decision: ChangeContextReviewVerdictDecision;
  reviewedDigest: string;
  commentIds?: string[];
  author: ChangeContextActor;
  taskLedgerNodeId?: string | null;
  taskLedgerWorkspaceId?: string | null;
};

export type ChangeContextReviewVerdictResult = {
  success: boolean;
  error?: ChangeContextErrorEnvelope;
  verdict?: ChangeContextReviewVerdict;
};

export type ChangeContextPullChangesReceipt = {
  approvalId: string;
  patchDigest: string;
  destinationHeadBefore: string;
  destinationHeadAfter: string;
  writeJournalId: string;
};

export type ChangeContextPullChangesDeniedState =
  | 'denied'
  | 'stale'
  | 'conflicted'
  | 'unavailable'
  | 'partial'
  | 'truncated';

export type ChangeContextPullChangesPayload = {
  workspaceId?: string | null;
  sessionKey: string;
  contextId: string;
  patchArtifact: GitPatchArtifactV1;
  expectedDestinationHead: string;
  approvalId: string;
};

export type ChangeContextPullChangesResult =
  | {
      success: true;
      state: 'applied';
      destinationMutated: true;
      receipt: ChangeContextPullChangesReceipt;
    }
  | {
      success: false;
      state: ChangeContextPullChangesDeniedState;
      destinationMutated: false;
      error: ChangeContextErrorEnvelope;
    }
  | {
      success: false;
      state: 'recovery_required';
      destinationMutated: 'unknown';
      writeJournalId?: string;
      error: ChangeContextErrorEnvelope;
    };

export type ChangeContextApiContract = {
  getProjection: (payload: ChangeContextProjectionPayload) => ChangeContextProjectionResult;
  listComments: (payload: ChangeContextReviewCommentListPayload) => ChangeContextReviewCommentListResult;
  createComment: (
    payload: ChangeContextReviewCommentCreatePayload,
  ) => ChangeContextReviewCommentMutationResult;
  resolveComment: (
    payload: ChangeContextReviewCommentResolvePayload,
  ) => ChangeContextReviewCommentMutationResult;
  reanchorComment: (
    payload: ChangeContextReviewCommentReanchorPayload,
  ) => ChangeContextReviewCommentMutationResult;
  deleteComment: (
    payload: ChangeContextReviewCommentDeletePayload,
  ) => ChangeContextReviewCommentMutationResult;
  submitVerdict: (payload: ChangeContextReviewVerdictPayload) => ChangeContextReviewVerdictResult;
  pullChanges: (payload: ChangeContextPullChangesPayload) => ChangeContextPullChangesResult;
};
