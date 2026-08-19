/**
 * P0: Unified File Transaction & Audit Kernel (UFTK) contract types.
 *
 * These types are the single cross-boundary contract for coding mutation,
 * exec, and rollback audit records. They intentionally describe normalized
 * *internal* operations, not model-facing tool schemas: existing `write` /
 * `edit` / `apply_patch` tool arguments remain unchanged (dev spec rule 7).
 *
 * The file system + existing write-journal remain the file-state source of
 * truth. These records are the append-only coding audit event stream only.
 */

export const CODING_RUNTIME_SCHEMA_VERSION = 1 as const;

export const CODING_RUNTIME_EVENT_TYPES = {
  MUTATION: 'coding.mutation.v1',
  EXEC: 'coding.exec.v1',
  ROLLBACK: 'coding.rollback.v1',
} as const;

export type CodingRuntimeEventType =
  (typeof CODING_RUNTIME_EVENT_TYPES)[keyof typeof CODING_RUNTIME_EVENT_TYPES];

export type CodingMutationKind = 'write' | 'edit' | 'apply_patch' | 'delete' | 'move';

/**
 * Optimistic-concurrency file version. `path` is a workspace-relative path
 * using forward slashes so events stay portable across operating systems.
 * `contentHash` is a hex digest of the file bytes (default sha256).
 */
export type FileVersion = {
  path: string;
  contentHash: string;
  mtimeMs: number;
  size: number;
};

export type CodingTextEdit = {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
  fuzzy?: boolean;
};

export type CodingWriteMutation = {
  kind: 'write';
  path: string;
  content: string;
  baseVersion?: FileVersion;
};

export type CodingEditMutation = {
  kind: 'edit';
  path: string;
  edits: CodingTextEdit[];
  baseVersion?: FileVersion;
};

export type CodingApplyPatchMutation = {
  kind: 'apply_patch';
  input: string;
  /** One entry per affected file when the caller already knows target versions. */
  baseVersions?: FileVersion[];
};

export type CodingDeleteMutation = {
  kind: 'delete';
  path: string;
  baseVersion?: FileVersion;
};

export type CodingMoveMutation = {
  kind: 'move';
  from: string;
  to: string;
  overwrite?: boolean;
  baseVersion?: FileVersion;
};

export type CodingMutation =
  | CodingWriteMutation
  | CodingEditMutation
  | CodingApplyPatchMutation
  | CodingDeleteMutation
  | CodingMoveMutation;

export type CodingEventFlags = Record<string, boolean | string>;

/**
 * Common fields for every UFTK event. `path` is the primary filterable path:
 * the affected file for mutation events, `cwd` for exec events, and the batch
 * scope (`.` when a batch spans the whole workspace) for rollback events.
 * `beforeHash` / `afterHash` are file hashes for mutation events and workspace
 * fingerprint hashes for exec / rollback events; `null` means "no content".
 */
export type CodingEventBase = {
  schemaVersion: typeof CODING_RUNTIME_SCHEMA_VERSION;
  eventId: string;
  eventType: CodingRuntimeEventType;
  sessionId: string;
  requestId: string;
  toolName: string;
  timestamp: number;
  path: string;
  beforeHash: string | null;
  afterHash: string | null;
  workspaceRoot: string;
  flags?: CodingEventFlags;
};

export type CodingMutationEventPhase = 'committed' | 'rolled_back' | 'recovery_required';

export type CodingMutationEvent = CodingEventBase & {
  eventType: typeof CODING_RUNTIME_EVENT_TYPES.MUTATION;
  phase: CodingMutationEventPhase;
  mutationId: string;
  batchId?: string;
  kind: CodingMutationKind;
  mutation: CodingMutation;
  /** Move destination; mirrors `path`'s pre-image for rollback targeting. */
  targetPath?: string;
  hadPrior: boolean;
  bytesBefore: number;
  bytesAfter: number;
  beforeVersion: FileVersion | null;
  afterVersion: FileVersion | null;
  error?: string;
};

export type CodingExecEventStatus = 'succeeded' | 'failed' | 'timeout' | 'cancelled' | 'denied' | 'running';

export type CodingApprovalDecision = 'allow' | 'prompt' | 'forbidden';

export type CodingExecApproval = {
  decision: CodingApprovalDecision;
  policyId?: string;
  matchedPrefix?: string;
  reason?: string;
};

export type CodingFileSideEffect = {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  beforeHash: string | null;
  afterHash: string | null;
  beforeVersion: FileVersion | null;
  afterVersion: FileVersion | null;
  bytesBefore: number;
  bytesAfter: number;
};

/**
 * Exec audit event. Raw command text is intentionally NOT part of the event;
 * `commandRedacted` + `commandHash` are the persisted contract (dev spec
 * Phase 4 sensitive-command requirement).
 */
export type CodingExecEvent = CodingEventBase & {
  eventType: typeof CODING_RUNTIME_EVENT_TYPES.EXEC;
  commandId: string;
  commandHash: string;
  commandRedacted: string;
  cwd: string;
  shell?: string;
  status: CodingExecEventStatus;
  approval?: CodingExecApproval;
  exitCode: number | null;
  durationMs: number;
  timeoutMs?: number;
  outputTruncated: boolean;
  sideEffects: CodingFileSideEffect[];
  error?: string;
};

export type CodingRollbackStatus = 'rolled_back' | 'recovery_required';

export type CodingRollbackFileOutcome = {
  path: string;
  status: 'restored' | 'removed' | 'restore_failed';
  beforeHash: string | null;
  afterHash: string | null;
  beforeVersion?: FileVersion;
  afterVersion?: FileVersion;
  error?: string;
};

export type CodingRollbackEvent = CodingEventBase & {
  eventType: typeof CODING_RUNTIME_EVENT_TYPES.ROLLBACK;
  batchId: string;
  rollbackId: string;
  status: CodingRollbackStatus;
  preview: boolean;
  diff: string;
  files: CodingRollbackFileOutcome[];
  error?: string;
};

export type CodingAuditEvent = CodingMutationEvent | CodingExecEvent | CodingRollbackEvent;

export type CodingBatchState = 'prepared' | 'committed' | 'rolled_back' | 'recovery_required';

export type MutationPrepareOptions = {
  sessionId: string;
  requestId: string;
  workspaceRoot: string;
  /** Actual calling tool name when it differs from `mutation.kind` (e.g. undo). */
  toolName?: string;
  batchId?: string;
  baseVersion?: FileVersion;
  flags?: CodingEventFlags;
};

export type PreparedMutation = {
  mutationId: string;
  batchId: string;
  sessionId: string;
  requestId: string;
  workspaceRoot: string;
  preparedAt: number;
  mutation: CodingMutation;
  baseVersions: FileVersion[];
  status: Extract<CodingBatchState, 'prepared'>;
};

export type CodingFileCommitOutcome = {
  path: string;
  targetPath?: string;
  status: Extract<CodingBatchState, 'committed' | 'rolled_back' | 'recovery_required'>;
  beforeVersion: FileVersion | null;
  afterVersion: FileVersion | null;
  error?: string;
};

export type CommitResult = {
  mutationId: string;
  batchId: string;
  status: Extract<CodingBatchState, 'committed' | 'recovery_required'>;
  files: CodingFileCommitOutcome[];
  events: CodingMutationEvent[];
  error?: string;
  /** P1 additive: retained write-journal location when rollback was incomplete. */
  recoveryRef?: string;
};

export type RollbackOptions = {
  preview?: boolean;
};

export type RollbackResult = {
  batchId: string;
  status: CodingRollbackStatus;
  preview: boolean;
  diff: string;
  files: CodingRollbackFileOutcome[];
  events: CodingRollbackEvent[];
  error?: string;
  /** P1 additive: retained write-journal location when restore was incomplete. */
  recoveryRef?: string;
};

export type AuditQuery = {
  fromMs?: number;
  toMs?: number;
  toolName?: string;
  path?: string;
  /** Redacted command substring; never accepts raw command text from callers. */
  command?: string;
  limit?: number;
  cursor?: string;
};

export type AuditPage<T> = {
  items: T[];
  nextCursor?: string;
};

export type CodingRuntimeErrorCode =
  | 'E_INVALID_MUTATION'
  | 'E_WORKSPACE_BOUNDARY'
  | 'E_CONFLICT'
  | 'E_BATCH_STATE'
  | 'E_NOT_PREPARED'
  | 'E_LOCK_TIMEOUT'
  | 'E_AUDIT_WRITE_FAILED'
  | 'E_ROLLBACK_FAILED'
  | 'E_COMMAND_FORBIDDEN'
  | 'E_GIT_CHECKPOINT_DISABLED'
  | 'E_GIT_CHECKPOINT_UNSUPPORTED'
  | 'E_GIT_CHECKPOINT_NOT_FOUND'
  | 'E_GIT_CHECKPOINT_CONFLICT'
  | 'E_GIT_CHECKPOINT_TIMEOUT'
  | 'E_GIT_CHECKPOINT_FAILED'
  | 'E_GIT_CHECKPOINT_RECOVERY_REQUIRED';

export type CodingRuntimeError = {
  code: CodingRuntimeErrorCode;
  message: string;
  path?: string;
  batchId?: string;
  baseVersion?: FileVersion;
  currentVersion?: FileVersion;
  diff?: string;
};

/**
 * Phase 1+ unified transaction service. P0 defines the contract only; no
 * implementation may be exposed through the production tool path until its
 * Phase gate is accepted and the UFTK flag is explicitly enabled.
 */
export interface FileTransactionService {
  prepare(mutation: CodingMutation, options: MutationPrepareOptions): Promise<PreparedMutation>;
  commit(prepared: PreparedMutation): Promise<CommitResult>;
  rollback(batchId: string, options?: RollbackOptions): Promise<RollbackResult>;
  listAudit(sessionId: string, query: AuditQuery): Promise<AuditPage<CodingAuditEvent>>;
}

export const CODING_RUNTIME_FLAG_KEYS = {
  uftkEnabled: 'runtime.coding.uftk.enabled',
  auditLogEnabled: 'runtime.coding.uftk.auditLog.enabled',
  execSideEffectsEnabled: 'runtime.coding.uftk.execSideEffects.enabled',
  commandApprovalEnabled: 'runtime.coding.uftk.commandApproval.enabled',
  baseVersionGuardEnabled: 'runtime.coding.uftk.baseVersionGuard.enabled',
  gitCheckpointEnabled: 'runtime.coding.uftk.gitCheckpoint.enabled',
  concurrencyV2Enabled: 'runtime.coding.uftk.concurrencyV2.enabled',
  gitCheckpointPathScopedEnabled: 'runtime.coding.uftk.gitCheckpoint.pathScoped.enabled',
  gitCheckpointSafetySnapshotEnabled: 'runtime.coding.uftk.gitCheckpoint.safetySnapshot.enabled',
  gitCheckpointLifecycleEnabled: 'runtime.coding.uftk.gitCheckpoint.lifecycle.enabled',
  execUndoEnabled: 'runtime.coding.uftk.execUndo.enabled',
  autoCheckpointEnabled: 'runtime.coding.uftk.autoCheckpoint.enabled',
} as const;

export type CodingRuntimeFlagKey =
  (typeof CODING_RUNTIME_FLAG_KEYS)[keyof typeof CODING_RUNTIME_FLAG_KEYS];

/**
 * Every UFTK capability is default-off until its Phase acceptance is complete.
 * P0 ships only this contract and no production path flips these values.
 */
export const DEFAULT_CODING_RUNTIME_FLAGS: Readonly<Record<CodingRuntimeFlagKey, false>> = {
  [CODING_RUNTIME_FLAG_KEYS.uftkEnabled]: false,
  [CODING_RUNTIME_FLAG_KEYS.auditLogEnabled]: false,
  [CODING_RUNTIME_FLAG_KEYS.execSideEffectsEnabled]: false,
  [CODING_RUNTIME_FLAG_KEYS.commandApprovalEnabled]: false,
  [CODING_RUNTIME_FLAG_KEYS.baseVersionGuardEnabled]: false,
  [CODING_RUNTIME_FLAG_KEYS.gitCheckpointEnabled]: false,
  [CODING_RUNTIME_FLAG_KEYS.concurrencyV2Enabled]: false,
  [CODING_RUNTIME_FLAG_KEYS.gitCheckpointPathScopedEnabled]: false,
  [CODING_RUNTIME_FLAG_KEYS.gitCheckpointSafetySnapshotEnabled]: false,
  [CODING_RUNTIME_FLAG_KEYS.gitCheckpointLifecycleEnabled]: false,
  [CODING_RUNTIME_FLAG_KEYS.execUndoEnabled]: false,
  [CODING_RUNTIME_FLAG_KEYS.autoCheckpointEnabled]: false,
};
