import type { AutonomySessionScope } from './identity-scope.js';
import type { ScopedTaskReference } from './task-ledger-reference.js';

/** Requests reference existing owner records; they never carry their own pass verdict. */
export type TaskLedgerCompletionClaim = {
  operationId: string;
  expectedRevision: number;
  taskRef: ScopedTaskReference & { owner: 'task-ledger' };
  checkpointId: string;
  verificationRunIds: string[];
};

/** Candidate provenance stored inside an existing checkpoint/Ledger event. */
export type TaskLedgerCompletionCandidate = {
  source: string;
  inputSha256: string;
  configSha256: string;
  dirtyDiffSha256: string;
};

/** The existing verifier owner publishes its candidate before review starts. */
export type TaskLedgerCompletionReview =
  | { state: 'requested'; workspaceRoot: string; executionWorkdir?: string }
  | { state: 'pinned'; workspaceRoot: string; executionWorkdir?: string; candidate: TaskLedgerCompletionCandidate; capturedAt: number };

/** Read from the existing TaskLoop checkpoint owner, never a caller-authored claim. */
export type TaskLedgerCompletionCheckpoint = {
  owner: 'task-loop';
  checkpointId: string;
  ownerRevision: string;
  loopRunId: string;
  taskRef: TaskLedgerCompletionClaim['taskRef'];
  status: string;
  evidenceGate: 'pass' | 'repair' | 'blocked' | 'unavailable';
  selfCheckDecision: 'complete' | 'repair' | 'blocked' | 'unavailable';
  candidate: TaskLedgerCompletionCandidate;
  /** Missing on legacy checkpoints: absence is unavailable review provenance. */
  reviewSource?: Extract<TaskLedgerCompletionReview, { state: 'pinned' }>;
  acceptanceSha256: string;
  taskInputSha256: string;
  requiredCheckIds: string[];
  verificationChecks: Array<{ checkId: string; command: string }>;
  /** Effective session cwd pinned at intake; legacy records default to their review workspace. */
  executionWorkdir?: string;
  workerRunIds: string[];
  verifierRunId: string;
  reviewer: { agentId: string; runId: string; sessionKey: string };
  capturedAt: number;
  expiresAt: number;
};

/** Normalized read from the existing verification/effect owner; no write API. */
export type TaskLedgerCompletionCheckReceipt = {
  owner: 'verseshell-host-receipt' | 'task-loop-exec-effect';
  receiptId: string;
  ownerRevision: string;
  verificationRunId: string;
  checkpointId: string;
  checkpointRevision: string;
  taskRef: TaskLedgerCompletionClaim['taskRef'];
  candidate: TaskLedgerCompletionCandidate;
  acceptanceSha256: string;
  checkId: string;
  reviewer: { agentId: string; runId: string; sessionKey: string };
  status: 'verified' | 'failed' | 'unavailable';
  exitCode: number | null;
  artifactRefs: Array<{ owner: 'verseshell-host-receipt' | 'context-archive'; ref: string; sha256: string; verified: boolean; path?: string }>;
  capturedAt: number;
  expiresAt: number;
};

export type TaskLedgerOperationIdentity = {
  actor: 'assistant';
  agentId: string;
  scope: AutonomySessionScope;
  runtimeGeneration: string;
  runtimeOwner: { childPid: number; connectedAt: number };
};

/** Historical acceptance points at existing owners; current readback may invalidate it. */
export type TaskLedgerCompletionDecision = {
  operationId: string;
  accepted: boolean;
  taskRef: TaskLedgerCompletionClaim['taskRef'];
  checkpointId: string;
  checkpointRevision: string | null;
  verificationRunIds: string[];
  verificationRevisions: string[];
  candidate: TaskLedgerCompletionCandidate | null;
  acceptanceSha256: string | null;
  taskInputSha256: string | null;
  gaps: string[];
  capturedAt: number;
  expiresAt: number | null;
  driven_by: 'agent';
};

export type TaskLedgerOperationReceipt = {
  operationId: string;
  requestSha256: string;
  revision: number;
  identity: TaskLedgerOperationIdentity;
  replayed: boolean;
  eventIds: string[];
};

export type TaskLedgerNodeKind =
  | 'goal'
  | 'milestone'
  | 'task'
  | 'check'
  | 'decision'
  | 'risk'
  | 'deviation'
  | 'review';

export type TaskLedgerNodeStatus = 'todo' | 'doing' | 'blocked' | 'review' | 'done' | 'dropped';
export type TaskLedgerActor = 'user' | 'assistant' | 'system';
export type TaskLedgerOwner = 'user' | 'agent' | 'system';
export type TaskLedgerPriority = 'low' | 'normal' | 'high';

export type TaskLedgerEdgeType =
  | 'depends_on'
  | 'blocks'
  | 'relates_to'
  | 'derived_from'
  | 'supersedes'
  | 'needs_review';

export type TaskLedgerEventType =
  | 'node_created'
  | 'node_updated'
  | 'node_deleted'
  | 'status_changed'
  | 'progress_changed'
  | 'edge_added'
  | 'edge_removed'
  | 'dependency_added'
  | 'decision_recorded'
  | 'deviation_logged'
  | 'review_requested'
  | 'review_cleared'
  | 'session_linked'
  | 'completion_decided'
  | 'completion_evidence_changed'
  | 'working_context_proposed'
  | 'working_context_proposal_accepted'
  | 'working_context_proposal_rejected';

export const TASK_LEDGER_WORKING_CONTEXT_FIELDS = [
  'Objective',
  'Constraints',
  'ConfirmedFacts',
  'Decisions',
  'OpenRisks',
  'ActiveFiles',
  'Evidence',
  'NextAction',
] as const;

export type TaskLedgerWorkingContextField = (typeof TASK_LEDGER_WORKING_CONTEXT_FIELDS)[number];
export type TaskLedgerWorkingContextSensitivity = 'public' | 'workspace' | 'secret-adjacent';
export type TaskLedgerWorkingContextTrust = 'confirmed' | 'proposed' | 'uncertain';

/** Bounded Working Context values. Evidence is refs only; raw payload is forbidden. */
export type TaskLedgerWorkingContextFieldValue = string | string[] | TaskLedgerEvidenceRef[];

export type TaskLedgerWorkingContextProposal = {
  proposalId: string;
  field: TaskLedgerWorkingContextField;
  value: TaskLedgerWorkingContextFieldValue;
  version: number;
  evidenceRefs: TaskLedgerEvidenceRef[];
  ttl: { issuedAt: string; expiresAt: string };
  sensitivity: TaskLedgerWorkingContextSensitivity;
  trust: TaskLedgerWorkingContextTrust;
};

export type TaskLedgerWorkingContextDecision = {
  proposalId: string;
  field: TaskLedgerWorkingContextField;
  version: number;
  decision: 'accepted' | 'rejected';
  policyDigest: string;
  rejectionReason?: string;
};

export type TaskLedgerMemPromotionCandidate = {
  schema: 'MemPromotionCandidate/v1';
  proposalId: string;
  field: TaskLedgerWorkingContextField;
  value: TaskLedgerWorkingContextFieldValue;
  version: number;
  actor: TaskLedgerActor;
  evidenceRefs: TaskLedgerEvidenceRef[];
  sensitivity: TaskLedgerWorkingContextSensitivity;
  trust: TaskLedgerWorkingContextTrust;
  acceptedAt: string;
  policyDigest: string;
};

export type TaskLedgerWorkingContextWarningType =
  | 'invalid_event'
  | 'invalid_value'
  | 'invalid_ttl'
  | 'missing_actor'
  | 'missing_task_id'
  | 'missing_policy_digest'
  | 'missing_proposal'
  | 'version_mismatch'
  | 'duplicate_proposal'
  | 'duplicate_accept'
  | 'expired_accept'
  | 'illegal_actor'
  | 'invalid_decision';

export type TaskLedgerWorkingContextWarning = {
  type: TaskLedgerWorkingContextWarningType;
  message: string;
  eventId?: string;
  proposalId?: string;
  field?: TaskLedgerWorkingContextField;
};

export type TaskLedgerWorkingContextProposalRecord = {
  proposalId: string;
  field: TaskLedgerWorkingContextField;
  value: TaskLedgerWorkingContextFieldValue;
  version: number;
  actor: TaskLedgerActor;
  evidenceRefs: TaskLedgerEvidenceRef[];
  ttl: { issuedAt: string; expiresAt: string };
  sensitivity: TaskLedgerWorkingContextSensitivity;
  trust: TaskLedgerWorkingContextTrust;
  eventId: string;
  taskId: string;
  sessionId?: string | null;
  createdAt: string;
};

export type TaskLedgerWorkingContextAcceptedRecord = TaskLedgerWorkingContextProposalRecord & {
  acceptedEventId: string;
  policyDigest: string;
  acceptedAt: string;
};

export type TaskLedgerWorkingContextRejectedRecord = {
  proposalId: string;
  field: TaskLedgerWorkingContextField;
  version: number;
  actor: TaskLedgerActor;
  policyDigest: string;
  rejectionReason: string;
  eventId: string;
  taskId: string;
  createdAt: string;
};

export type TaskLedgerWorkingContextFieldProjection = {
  current?: TaskLedgerWorkingContextAcceptedRecord;
  history: TaskLedgerWorkingContextAcceptedRecord[];
  pending: TaskLedgerWorkingContextProposalRecord[];
  conflicts: TaskLedgerWorkingContextProposalRecord[];
  rejected: TaskLedgerWorkingContextRejectedRecord[];
  expired: TaskLedgerWorkingContextProposalRecord[];
};

export type TaskLedgerWorkingContextSnapshot = {
  schemaVersion: 1;
  fields: Record<TaskLedgerWorkingContextField, TaskLedgerWorkingContextFieldProjection>;
  promotionCandidates: TaskLedgerMemPromotionCandidate[];
  warnings: TaskLedgerWorkingContextWarning[];
};

export type TaskLedgerEvidenceRef = {
  type: 'session' | 'trace' | 'file' | 'memory' | 'manual' | 'tool' | 'other';
  ref: string;
  label?: string;
};

export type TaskLedgerNode = {
  id: string;
  title: string;
  kind: TaskLedgerNodeKind;
  parentId?: string | null;
  status: TaskLedgerNodeStatus;
  progress?: number;
  owner?: TaskLedgerOwner;
  priority?: TaskLedgerPriority;
  tags?: string[];
  description?: string;
  evidenceRefs?: TaskLedgerEvidenceRef[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  completionDecision?: TaskLedgerCompletionDecision;
  completionReadback?: { state: 'accepted' | 'invalidated' | 'unavailable'; gaps: string[] };
};

export type TaskLedgerEdge = {
  id: string;
  from: string;
  to: string;
  type: TaskLedgerEdgeType;
  label?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type TaskLedgerSessionLink = {
  id: string;
  sessionKey: string;
  nodeId?: string | null;
  agentId?: string | null;
  traceId?: string | null;
  relation?: 'related' | 'forked_from' | 'handoff_from';
  sourceSessionKey?: string | null;
  summary?: string;
  /** Relay depth of the linked session (1 is the first relay of a root). */
  handoffDepth?: number;
  parentHandoffId?: string;
  rootHandoffId?: string;
  handoffRootSessionKey?: string;
  createdAt: string;
};

export type TaskLedgerEventPayload = {
  completionDecision?: TaskLedgerCompletionDecision;
  node?: TaskLedgerNode;
  nodeId?: string;
  patch?: Partial<Omit<TaskLedgerNode, 'id' | 'createdAt'>>;
  status?: TaskLedgerNodeStatus;
  progress?: number;
  edge?: TaskLedgerEdge;
  edgeId?: string;
  sessionLink?: TaskLedgerSessionLink;
  reviewReason?: string;
  decision?: string;
  deviation?: string;
  note?: string;
  workingContextProposal?: TaskLedgerWorkingContextProposal;
  workingContextDecision?: TaskLedgerWorkingContextDecision;
};

export type TaskLedgerEvent = {
  id: string;
  workspaceId: string;
  type: TaskLedgerEventType;
  actor: TaskLedgerActor;
  taskId?: string | null;
  sessionId?: string | null;
  idempotencyKey?: string | null;
  payload: TaskLedgerEventPayload;
  createdAt: string;
};

export type TaskLedgerEventInput = Omit<TaskLedgerEvent, 'id' | 'workspaceId' | 'createdAt'> & {
  id?: string;
  workspaceId?: string;
  createdAt?: string;
};

export type TaskLedgerWarning = {
  type: 'invalid_jsonl' | 'invalid_event' | 'projection';
  message: string;
  line?: number;
  eventId?: string;
};

export type TaskLedgerSnapshot = {
  schemaVersion: 1;
  workspaceId: string;
  generatedAt: string;
  nodes: TaskLedgerNode[];
  edges: TaskLedgerEdge[];
  sessionLinks: TaskLedgerSessionLink[];
  rootNodeIds: string[];
  reviewNodeIds: string[];
  activeNodeIds: string[];
  blockedNodeIds: string[];
  currentGoalId?: string | null;
  recentDecisions: TaskLedgerNode[];
  eventsCount: number;
  warnings: TaskLedgerWarning[];
};
