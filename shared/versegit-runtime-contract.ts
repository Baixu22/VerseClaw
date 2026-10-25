export const VG_RUNTIME_BINDING_SCHEMA = 'clawx.versegit.runtime-binding/v1';
export const VG_RUNTIME_BRIDGE_EVENT_SCHEMA = 'clawx.versegit.bridge-event/v1';

export type VerseGitRuntimeMode = 'M1' | 'M2';
export type VerseGitBindingEndReason =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retry'
  | 'orchestration_completed'
  | 'orchestration_error'
  | 'timeout';

export type VerseGitBindingRequest = {
  schema: typeof VG_RUNTIME_BINDING_SCHEMA;
  requestId: string;
  runId: string;
  traceId: string;
  worktreePath: string;
  agentSessionId: string;
  ownerId: string;
  epoch: number;
  mode: VerseGitRuntimeMode;
  taskNodeId?: string;
};

export type VerseGitBindingRecord = {
  schema: typeof VG_RUNTIME_BINDING_SCHEMA;
  bindingId: string;
  authorizationId: string;
  baseOid: string;
  refsDigest: string;
  requestId: string;
  runId: string;
  traceId: string;
  repoId: string;
  worktreeId: string;
  worktreePath: string;
  agentSessionId: string;
  vgSessionId: string;
  ownerId: string;
  epoch: number;
  mode: VerseGitRuntimeMode;
  phase: 'bound' | 'attached' | 'ended';
  createdAt: string;
  taskNodeId?: string;
  childSessionKey?: string;
  childRunId?: string;
  endedAt?: string;
  endReason?: VerseGitBindingEndReason;
};

export type VerseGitBindingAttachRequest = {
  schema: typeof VG_RUNTIME_BINDING_SCHEMA;
  bindingId: string;
  childSessionKey: string;
  childRunId: string;
  ownerId: string;
  epoch: number;
};

export type VerseGitBindingEndRequest = {
  schema: typeof VG_RUNTIME_BINDING_SCHEMA;
  bindingId: string;
  reason: VerseGitBindingEndReason;
  ownerId: string;
  epoch: number;
};

export type VerseGitBridgeEvent = {
  schema: typeof VG_RUNTIME_BRIDGE_EVENT_SCHEMA;
  eventId: string;
  at: string;
  driven_by: 'agent';
  actor: string;
  kind:
    | 'bind_requested'
    | 'bound'
    | 'bind_rejected'
    | 'attach_requested'
    | 'attached'
    | 'attach_rejected'
    | 'end_requested'
    | 'ended'
    | 'end_rejected'
    | 'observation_bound'
    | 'observation_bind_rejected'
    | 'observed'
    | 'observation_rejected'
    | 'observation_sealed'
    | 'feedback_produced'
    | 'feedback_delivered'
    | 'feedback_confirmed'
    | 'feedback_rejected';
  requestId?: string;
  bindingId?: string;
  runId?: string;
  traceId?: string;
  repoId?: string;
  worktreeId?: string;
  agentSessionId?: string;
  childSessionKey?: string;
  childRunId?: string;
  vgSessionId?: string;
  ownerId?: string;
  epoch?: number;
  reason?: string;
  error?: string;
  evidenceId?: string;
  toolCallId?: string;
  level?: string;
};

export type VerseGitBindingResponse =
  | { ok: true; data: VerseGitBindingRecord }
  | { ok: false; error: { code: string; message: string } };

export type VerseGitBindingAttachResponse =
  | { ok: true; data: VerseGitBindingRecord }
  | { ok: false; error: { code: string; message: string } };

export type VerseGitBindingEndResponse =
  | { ok: true; data: { bindingId: string; endedAt: string; reason: string } }
  | { ok: false; error: { code: string; message: string } };

export type VerseGitRuntimeBindingPort = {
  bind: (request: Omit<VerseGitBindingRequest, 'schema' | 'ownerId' | 'epoch'> & Partial<Pick<VerseGitBindingRequest, 'ownerId' | 'epoch'>>) => Promise<VerseGitBindingRecord>;
  attach: (request: Pick<VerseGitBindingAttachRequest, 'bindingId' | 'childSessionKey' | 'childRunId'>) => Promise<VerseGitBindingRecord>;
  end: (request: Pick<VerseGitBindingEndRequest, 'bindingId' | 'reason'>) => Promise<{ bindingId: string; endedAt: string; reason: string }>;
};

export const VG_TOOL_BASIS_SCHEMA = 'clawx.versegit.tool-basis/v1';
export const VG_TOOL_OBSERVATION_SCHEMA = 'clawx.versegit.tool-observation-request/v1';
export const VG_TOOL_OBSERVATION_RESULT_SCHEMA = 'clawx.versegit.tool-observation-result/v1';
export const VG_FEEDBACK_SCHEMA = 'clawx.versegit.feedback/v1';
export const VG_FEEDBACK_DELIVERY_SCHEMA = 'clawx.versegit.feedback-delivery/v1';

export type VerseGitToolBasis = {
  schema: typeof VG_TOOL_BASIS_SCHEMA;
  kind: 'read' | 'write' | 'edit';
  path: string;
  lineStart: number;
  lineEnd: number;
  fileSha256?: string | null;
  rangeSha256?: string | null;
  beforeSha256?: string | null;
  afterSha256?: string | null;
  truncated?: boolean;
};

export type VerseGitToolObservationStatus = 'succeeded' | 'failed' | 'cancelled' | 'timed-out' | 'unknown';

export type VerseGitToolObservationRequest = {
  schema: typeof VG_TOOL_OBSERVATION_SCHEMA;
  bindingId: string;
  childRunId: string;
  toolCallId: string;
  toolName: string;
  status: VerseGitToolObservationStatus;
  args: Record<string, unknown>;
  cwd: string;
  inputDigest: string;
  outputDigest: string;
  basis?: VerseGitToolBasis;
  observedAt: string;
  ownerId: string;
  epoch: number;
};

export type VerseGitFeedbackDelivery = {
  schema: typeof VG_FEEDBACK_SCHEMA;
  evidenceId: string;
  message: string;
  coverage: string;
  basisDigest: string;
  candidateId: null;
  path: string;
  lineStart: number;
  lineEnd: number;
};

export type VerseGitFeedbackDeliveryLevel = 'produced' | 'host-delivered' | 'transcript-confirmed';

export type VerseGitFeedbackDeliveryRequest = {
  schema: typeof VG_FEEDBACK_DELIVERY_SCHEMA;
  bindingId: string;
  childRunId: string;
  toolCallId: string;
  evidenceId: string;
  level: VerseGitFeedbackDeliveryLevel;
  observedAt: string;
  ownerId: string;
  epoch: number;
};

export type VerseGitFeedbackDeliveryResponse = {
  schema: 'clawx.versegit.feedback-delivery-result/v1';
  evidenceId: string;
  level: VerseGitFeedbackDeliveryLevel;
  accepted: boolean;
  reason: string | null;
  host_verdict: 'unchanged';
};

export type VerseGitToolObservationRecord = {
  schema: typeof VG_TOOL_OBSERVATION_RESULT_SCHEMA;
  status: 'observed' | 'partial' | 'duplicate' | 'stale' | 'rejected_by_policy';
  why: string;
  issues: string[];
  binding: {
    runId: string;
    repoId: string;
    worktreeId: string;
    agentSessionId: string;
    epoch: number;
  } | null;
  event: {
    eventId: string;
    runId: string;
    traceId: string;
    agentSessionId: string;
    vgSessionId: string;
    repoId: string;
    worktreeId: string;
    ownerId: string;
    epoch: number;
    surface: string;
    operation: string;
    effect: string;
    status: string;
    coverage: string;
    path: string | null;
    lineStart: number | null;
    lineEnd: number | null;
    basisDigest: string | null;
    inputDigest: string;
    outputDigest: string;
    observedAt: string;
  } | null;
  feedback?: VerseGitFeedbackDelivery;
  host_verdict: 'unchanged';
};

export type VerseGitRuntimeObservationPort = {
  observe: (request: Omit<VerseGitToolObservationRequest, 'schema' | 'ownerId' | 'epoch'>) => Promise<VerseGitToolObservationRecord>;
  reportDelivery: (request: Omit<VerseGitFeedbackDeliveryRequest, 'schema' | 'ownerId' | 'epoch'>) => Promise<VerseGitFeedbackDeliveryResponse>;
};
