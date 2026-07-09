// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

export const LIFECYCLE_PHASES = [
  'created',
  'planned',
  'pre_gate',
  'gated_approved',
  'gated_blocked',
  'running',
  'evidence_collected',
  'verification_pending',
  'verified_pass',
  'verified_fail',
  'review_required',
  'completed',
  'failed',
  'aborted',
  'rolled_back',
] as const;

export type LifecyclePhase = typeof LIFECYCLE_PHASES[number];

export const LIFECYCLE_ENTITY_TYPES = [
  'clawgraph_run',
  'clawgraph_node',
  'ast_edit_plan',
  'tool_invocation',
  'checkpoint_restore',
  'verification_task',
] as const;

export type LifecycleEntityType = typeof LIFECYCLE_ENTITY_TYPES[number];

export type RuntimeSpineMetadata = Record<string, unknown>;

export type LifecycleTransition = {
  transitionId: string;
  entityId: string;
  from: LifecyclePhase;
  to: LifecyclePhase;
  at: number;
  actor?: string;
  reason?: string;
  metadata?: RuntimeSpineMetadata;
};

export type LifecycleEntity = {
  entityId: string;
  entityType: LifecycleEntityType;
  phase: LifecyclePhase;
  createdAt: number;
  updatedAt: number;
  metadata?: RuntimeSpineMetadata;
  transitions: LifecycleTransition[];
};

export type LifecycleTransitionOptions = {
  actor?: string;
  reason?: string;
  metadata?: RuntimeSpineMetadata;
};

export type RuntimeSpineResult<T> =
  | { success: true; value: T }
  | { success: false; error: string };

export const RUNTIME_EVENT_KINDS = [
  'lifecycle_transition',
  'gate_decision',
  'evidence_collected',
  'evidence_verified',
  'evidence_rejected',
  'failure_classified',
  'failure_routed',
  'diagnostic_record',
] as const;

export type RuntimeEventKind = typeof RUNTIME_EVENT_KINDS[number] | (string & {});

export type EventSource = {
  sourceId: string;
  sourceType:
    | 'runtime_spine'
    | 'clawgraph'
    | 'ast'
    | 'tool'
    | 'checkpoint'
    | 'verification'
    | 'failure'
    | 'diagnostic';
  stage?: string;
};

export type RuntimeEvent = {
  eventId: string;
  kind: RuntimeEventKind;
  entityId: string;
  entityType: LifecycleEntityType;
  source: EventSource;
  payload?: unknown;
  refs?: RuntimeSpineRef[];
  timestamp: number;
};

export type RuntimeSpineRef = EvidenceRef | FailureRef | GateDecisionRef | LifecycleEntityRef;

export type LifecycleEntityRef = {
  refType: 'lifecycle_entity';
  entityId: string;
  entityType: LifecycleEntityType;
  phase: LifecyclePhase;
};

export const EVIDENCE_KINDS = [
  'mutation_evidence',
  'completion_evidence',
  'verification_output',
  'diagnostic_snapshot',
  'gate_decision',
  'failure_analysis',
] as const;

export type EvidenceKind = typeof EVIDENCE_KINDS[number];

export type EvidenceItem = {
  itemId: string;
  label: string;
  value: unknown;
  capturedAt: number;
  metadata?: RuntimeSpineMetadata;
};

export type EvidenceStatus = 'pending' | 'verified' | 'rejected';

export type EvidenceRef = {
  refType: 'evidence';
  envelopeId: string;
  entityId: string;
  kind: EvidenceKind;
  status: EvidenceStatus;
};

type BaseEvidenceEnvelope<K extends EvidenceKind> = {
  envelopeId: string;
  entityId: string;
  kind: K;
  collector: string;
  items: EvidenceItem[];
  status: EvidenceStatus;
  collectedAt: number;
  verifiedAt?: number;
  verifiedBy?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  metadata?: RuntimeSpineMetadata;
};

export type MutationEvidence = BaseEvidenceEnvelope<'mutation_evidence'> & {
  mutationEvidence: true;
  completionEvidence?: never;
};

export type CompletionEvidence = BaseEvidenceEnvelope<'completion_evidence'> & {
  completionEvidence: true;
  mutationEvidence?: never;
};

export type DiagnosticEvidence = BaseEvidenceEnvelope<
  Exclude<EvidenceKind, 'mutation_evidence' | 'completion_evidence'>
> & {
  mutationEvidence?: never;
  completionEvidence?: never;
};

export type EvidenceEnvelope = MutationEvidence | CompletionEvidence | DiagnosticEvidence;

export const FAILURE_KINDS = [
  'timeout',
  'permission_denied',
  'drift_detected',
  'gate_blocked',
  'ast_apply_error',
  'verification_failed',
  'unknown',
] as const;

export type FailureKind = typeof FAILURE_KINDS[number];
export type FailureSeverity = 'info' | 'warning' | 'error' | 'critical';
export type FailureAction =
  | 'auto_retry'
  | 'requires_review'
  | 'rollback_planned'
  | 'block'
  | 'record_only';
export type FailureRouteAction = 'retry' | 'escalate_review' | 'rollback_planned' | 'block';

export type FailureEnvelope = {
  failureId: string;
  entityId: string;
  kind: FailureKind;
  stage: string;
  severity: FailureSeverity;
  action: FailureAction;
  message: string;
  evidenceRef?: EvidenceRef;
  context?: RuntimeSpineMetadata;
  retryCount: number;
  maxRetries: number;
  escalated: boolean;
  createdAt: number;
};

export type FailureRef = {
  refType: 'failure';
  failureId: string;
  entityId: string;
  kind: FailureKind;
  severity: FailureSeverity;
};

export type FailureRoutingRule = {
  ruleId: string;
  when: (envelope: FailureEnvelope) => boolean;
  action: FailureRouteAction;
  reason: string;
};

export type FailureRoute = {
  action: FailureRouteAction;
  reason: string;
  ruleId: string;
};

export type GateType =
  | 'destructive_op'
  | 'pre_mutation'
  | 'pre_execution'
  | 'verification'
  | 'checkpoint_restore'
  | 'custom';

export type GateAuthority = 'diagnostic_only' | 'advisory' | 'blocking';
export type GateDecisionStatus = 'approved' | 'blocked' | 'deferred' | 'failed';

export type GateCheckRequest = {
  gateId?: string;
  gateType: GateType;
  entityId: string;
  entityType: LifecycleEntityType;
  source: EventSource;
  payload?: unknown;
  evidenceRefs?: EvidenceRef[];
  metadata?: RuntimeSpineMetadata;
};

export type GateCheckerResult = {
  checkerId: string;
  passed: boolean;
  message?: string;
  evidenceRefs?: EvidenceRef[];
  metadata?: RuntimeSpineMetadata;
};

export type GateChecker = {
  checkerId: string;
  gateTypes?: readonly GateType[];
  check: (request: GateCheckRequest) => GateCheckerResult | Promise<GateCheckerResult>;
};

export type GateDecisionRef = {
  refType: 'gate_decision';
  gateId: string;
  gateType: GateType;
  status: GateDecisionStatus;
  authority: GateAuthority;
};

export type GateDecision = {
  gateId: string;
  gateType: GateType;
  entityId: string;
  entityType: LifecycleEntityType;
  authority: GateAuthority;
  status: GateDecisionStatus;
  sampled: boolean;
  mandatory: boolean;
  checkerResults: GateCheckerResult[];
  errors: string[];
  createdAt: number;
  metadata?: RuntimeSpineMetadata;
};
