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
    | 'end_rejected';
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
