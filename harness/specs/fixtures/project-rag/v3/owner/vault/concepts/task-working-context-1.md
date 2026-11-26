---
title: shared/types/task-ledger.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T04:49:07.401Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: shared/types/task-ledger.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
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
  /** Optional generation fence for links that must not survive a session handoff. */
  sessionGeneration?: string | null;
  summary?: string;
  /** Relay depth of the linked session (1 is the first relay of a root). */
  handoffDepth?: number;
  parentHandoffId?: string;
  rootHandoffId?: string;
  handoffRootSessionKey?: string;
  createdAt: string;
};

export type TaskLedgerCompletionClaim = {
  schema: 'TaskCompletionClaim/v1';
  taskId: string;
  candidateDigest: string;
  generation: string;
  verifierReceiptId: string;
  effectReceiptId: string;
  verifierDigest: string;
  effectDigest: string;
  priorStatus: string;
};

export type TaskLedgerEventPayload = {
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
  completionClaim?: TaskLedgerCompletionClaim;
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
  /** Raw Workspace owner identity alongside the existing normalized storage key. */
  sourceWorkspaceId?: string;
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

~~~
