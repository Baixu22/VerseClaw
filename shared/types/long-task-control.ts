export type LongTaskInputMode = 'interrupt' | 'guide' | 'queue';

export type ResumeCheckpointTrigger =
  | 'compaction'
  | 'interrupt'
  | 'run_abort'
  | 'clawgraph_node_handoff'
  | 'audit_fail'
  | 'manual_review'
  | 'session_rotation'
  | 'queue_drain'
  | 'guide';

export type LongTaskEvidenceRef = {
  type: 'session' | 'trace' | 'file' | 'memory' | 'tool' | 'clawgraph' | 'task_ledger' | 'manual' | 'other';
  ref: string;
  label?: string;
};

export type LongConversationControlSignalKind =
  | 'evidence_gap'
  | 'validation_missing'
  | 'scope_drift'
  | 'unverified_claim'
  | 'replan_required'
  | 'permission_wait'
  | 'blocked_dependency'
  | 'risk'
  | 'recovery_gap';

export type LongConversationControlSignalSeverity = 'info' | 'warning' | 'blocking';

export type LongConversationSuggestedAction =
  | 'continue'
  | 'repair'
  | 'replan'
  | 'ask_user'
  | 'block'
  | 'sleep'
  | 'verify';

export type LongConversationQualityDimension =
  | 'scope'
  | 'evidence'
  | 'validation'
  | 'risk'
  | 'recovery'
  | 'security';

export type LongConversationQualityStatus = 'pass' | 'gap' | 'fail' | 'unknown';

export type LongConversationControlSignal = {
  kind: LongConversationControlSignalKind;
  severity: LongConversationControlSignalSeverity;
  message: string;
  suggestedAction?: LongConversationSuggestedAction;
  source?: string;
  refs?: string[];
  evidenceRefs?: LongTaskEvidenceRef[];
  details?: Record<string, unknown>;
};

export type LongConversationValidationState = {
  status: 'unknown' | 'not_run' | 'passed' | 'failed' | 'partial' | 'missing';
  checks: string[];
  evidenceRefs: LongTaskEvidenceRef[];
  summary?: string;
};

export type LongConversationAcceptanceStatus = {
  status: 'unknown' | 'satisfied' | 'partial' | 'missing' | 'changed';
  criteria: string[];
  gaps: string[];
  summary?: string;
};

export type LongConversationQualityAssessment = {
  dimension: LongConversationQualityDimension;
  status: LongConversationQualityStatus;
  summary?: string;
  signalKinds?: LongConversationControlSignalKind[];
};

export type ResumeCheckpoint = {
  schemaVersion: 1;
  id?: string;
  workspaceId?: string | null;
  sessionKey?: string | null;
  agentId?: string | null;
  trigger: ResumeCheckpointTrigger;
  objective?: string;
  activeNodeId?: string | null;
  activeTask?: string;
  lastConfirmedHandoff?: string;
  openBlockers: string[];
  decisions: string[];
  deviations: string[];
  filesTouched: string[];
  testsRun: string[];
  nextAction?: string;
  reviewNeededItems: string[];
  evidenceRefs: LongTaskEvidenceRef[];
  controlSignals?: LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
  acceptanceStatus?: LongConversationAcceptanceStatus;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type LongTaskCheckpointRecord = {
  id: string;
  idempotencyKey?: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  runId?: string;
  traceId?: string;
  clawGraphRunId?: string;
  trigger: ResumeCheckpointTrigger;
  status: string;
  checkpoint: ResumeCheckpoint;
  createdAt: number;
  updatedAt: number;
};

export type LongTaskControlEvent = {
  id: string;
  idempotencyKey?: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  runId?: string;
  traceId?: string;
  clawGraphRunId?: string;
  checkpointId?: string;
  mode?: LongTaskInputMode;
  trigger: ResumeCheckpointTrigger;
  status: string;
  payload: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type LongTaskQueueItem = {
  id: string;
  idempotencyKey?: string;
  text: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  status: 'pending' | 'draining' | 'drained' | 'failed';
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
  drainedAt?: number;
  enqueuedAt: number;
  updatedAt: number;
  source: string;
  payload: Record<string, unknown>;
};

export type LongTaskControlStatus = {
  available: boolean;
  key?: string;
  queueCount: number;
  latestCheckpoint?: LongTaskCheckpointRecord;
  latestIntervention?: LongTaskControlEvent;
  warnings: string[];
};

export type ResumeCheckpointInput = Partial<Omit<ResumeCheckpoint, 'schemaVersion' | 'createdAt'>> & {
  trigger: ResumeCheckpointTrigger;
  createdAt?: string | number | Date;
};

export type LongTaskInterventionPolicy = {
  mode: LongTaskInputMode;
  delivery: 'restart_now' | 'steer_active_run' | 'follow_up_after_run';
  mutatesCompletionState: boolean;
  shouldAbortActiveRun: boolean;
  checkpointRequired: boolean;
  recordsSteeringEvidence: boolean;
  recordsDeviation: boolean;
  reviewRequired: boolean;
  confirmationRequired: boolean;
  resumeTrigger?: ResumeCheckpointTrigger;
  taskLedgerEffect: 'none' | 'evidence' | 'deviation' | 'followup';
  description: string;
};

export type LongTaskInterventionOptions = {
  highRisk?: boolean;
  clawGraphNodeActive?: boolean;
};

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeEvidenceRefs(value: unknown): LongTaskEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Partial<LongTaskEvidenceRef>;
    if (typeof record.ref !== 'string' || !record.ref.trim()) return [];
    return [{
      type: record.type ?? 'other',
      ref: record.ref.trim(),
      ...(record.label ? { label: record.label } : {}),
    }];
  });
}

const CONTROL_SIGNAL_KINDS = new Set<LongConversationControlSignalKind>([
  'evidence_gap',
  'validation_missing',
  'scope_drift',
  'unverified_claim',
  'replan_required',
  'permission_wait',
  'blocked_dependency',
  'risk',
  'recovery_gap',
]);

const CONTROL_SIGNAL_SEVERITIES = new Set<LongConversationControlSignalSeverity>([
  'info',
  'warning',
  'blocking',
]);

const CONTROL_SIGNAL_ACTIONS = new Set<LongConversationSuggestedAction>([
  'continue',
  'repair',
  'replan',
  'ask_user',
  'block',
  'sleep',
  'verify',
]);

const VALIDATION_STATUSES = new Set<LongConversationValidationState['status']>([
  'unknown',
  'not_run',
  'passed',
  'failed',
  'partial',
  'missing',
]);

const ACCEPTANCE_STATUSES = new Set<LongConversationAcceptanceStatus['status']>([
  'unknown',
  'satisfied',
  'partial',
  'missing',
  'changed',
]);

function normalizeOptionalString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function normalizeJsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function normalizeLongConversationControlSignals(
  value: unknown,
): LongConversationControlSignal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = normalizeJsonRecord(item);
    if (!record) return [];
    const kind = CONTROL_SIGNAL_KINDS.has(record.kind as LongConversationControlSignalKind)
      ? record.kind as LongConversationControlSignalKind
      : undefined;
    const message = normalizeOptionalString(record.message, 1_000);
    if (!kind || !message) return [];
    const severity = CONTROL_SIGNAL_SEVERITIES.has(record.severity as LongConversationControlSignalSeverity)
      ? record.severity as LongConversationControlSignalSeverity
      : 'warning';
    const suggestedAction = CONTROL_SIGNAL_ACTIONS.has(record.suggestedAction as LongConversationSuggestedAction)
      ? record.suggestedAction as LongConversationSuggestedAction
      : undefined;
    const refs = normalizeStringList(record.refs).slice(0, 20);
    const source = normalizeOptionalString(record.source, 120);
    const evidenceRefs = normalizeEvidenceRefs(record.evidenceRefs).slice(0, 20);
    const details = normalizeJsonRecord(record.details);
    return [{
      kind,
      severity,
      message,
      ...(suggestedAction ? { suggestedAction } : {}),
      ...(source ? { source } : {}),
      ...(refs.length ? { refs } : {}),
      ...(evidenceRefs.length ? { evidenceRefs } : {}),
      ...(details ? { details } : {}),
    }];
  }).slice(0, 50);
}

export function normalizeLongConversationValidationState(
  value: unknown,
): LongConversationValidationState | undefined {
  const record = normalizeJsonRecord(value);
  if (!record) return undefined;
  const status = VALIDATION_STATUSES.has(record.status as LongConversationValidationState['status'])
    ? record.status as LongConversationValidationState['status']
    : 'unknown';
  const summary = normalizeOptionalString(record.summary, 1_000);
  return {
    status,
    checks: normalizeStringList(record.checks).slice(0, 50),
    evidenceRefs: normalizeEvidenceRefs(record.evidenceRefs).slice(0, 50),
    ...(summary ? { summary } : {}),
  };
}

export function normalizeLongConversationAcceptanceStatus(
  value: unknown,
): LongConversationAcceptanceStatus | undefined {
  const record = normalizeJsonRecord(value);
  if (!record) return undefined;
  const status = ACCEPTANCE_STATUSES.has(record.status as LongConversationAcceptanceStatus['status'])
    ? record.status as LongConversationAcceptanceStatus['status']
    : 'unknown';
  const summary = normalizeOptionalString(record.summary, 1_000);
  return {
    status,
    criteria: normalizeStringList(record.criteria).slice(0, 50),
    gaps: normalizeStringList(record.gaps).slice(0, 50),
    ...(summary ? { summary } : {}),
  };
}

function normalizeDate(value: ResumeCheckpointInput['createdAt']): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

export function buildResumeCheckpoint(input: ResumeCheckpointInput): ResumeCheckpoint {
  return {
    schemaVersion: 1,
    ...(input.id ? { id: input.id } : {}),
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    ...(input.sessionKey !== undefined ? { sessionKey: input.sessionKey } : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    trigger: input.trigger,
    ...(input.objective ? { objective: input.objective } : {}),
    ...(input.activeNodeId !== undefined ? { activeNodeId: input.activeNodeId } : {}),
    ...(input.activeTask ? { activeTask: input.activeTask } : {}),
    ...(input.lastConfirmedHandoff ? { lastConfirmedHandoff: input.lastConfirmedHandoff } : {}),
    openBlockers: normalizeStringList(input.openBlockers),
    decisions: normalizeStringList(input.decisions),
    deviations: normalizeStringList(input.deviations),
    filesTouched: normalizeStringList(input.filesTouched),
    testsRun: normalizeStringList(input.testsRun),
    ...(input.nextAction ? { nextAction: input.nextAction } : {}),
    reviewNeededItems: normalizeStringList(input.reviewNeededItems),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
    ...(normalizeLongConversationControlSignals(input.controlSignals).length
      ? { controlSignals: normalizeLongConversationControlSignals(input.controlSignals) }
      : {}),
    ...(normalizeLongConversationValidationState(input.validationState)
      ? { validationState: normalizeLongConversationValidationState(input.validationState) }
      : {}),
    ...(normalizeLongConversationAcceptanceStatus(input.acceptanceStatus)
      ? { acceptanceStatus: normalizeLongConversationAcceptanceStatus(input.acceptanceStatus) }
      : {}),
    createdAt: normalizeDate(input.createdAt),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function interventionPolicyForInputMode(
  mode: LongTaskInputMode,
  options: LongTaskInterventionOptions = {},
): LongTaskInterventionPolicy {
  if (mode === 'interrupt') {
    return {
      mode,
      delivery: 'restart_now',
      mutatesCompletionState: false,
      shouldAbortActiveRun: true,
      checkpointRequired: true,
      recordsSteeringEvidence: false,
      recordsDeviation: true,
      reviewRequired: Boolean(options.highRisk),
      confirmationRequired: Boolean(options.clawGraphNodeActive),
      resumeTrigger: 'interrupt',
      taskLedgerEffect: 'deviation',
      description: 'Abort the active run, retain partial evidence, and restart from a resume checkpoint.',
    };
  }

  if (mode === 'queue') {
    return {
      mode,
      delivery: 'follow_up_after_run',
      mutatesCompletionState: false,
      shouldAbortActiveRun: false,
      checkpointRequired: true,
      recordsSteeringEvidence: false,
      recordsDeviation: false,
      reviewRequired: false,
      confirmationRequired: false,
      resumeTrigger: 'queue_drain',
      taskLedgerEffect: 'followup',
      description: 'Keep the active run intact and deliver the user message as an associated follow-up turn.',
    };
  }

  return {
    mode,
    delivery: 'steer_active_run',
    mutatesCompletionState: false,
    shouldAbortActiveRun: false,
    checkpointRequired: true,
    recordsSteeringEvidence: true,
    recordsDeviation: false,
    reviewRequired: Boolean(options.highRisk),
    confirmationRequired: false,
    resumeTrigger: 'guide',
    taskLedgerEffect: 'evidence',
    description: 'Inject non-disruptive guidance into the active run and record it as steering evidence.',
  };
}

export function renderResumeCheckpointSummary(checkpoint: ResumeCheckpoint): string {
  const lines = [
    checkpoint.objective ? `Objective: ${checkpoint.objective}` : '',
    checkpoint.activeTask ? `Active task: ${checkpoint.activeTask}` : '',
    checkpoint.lastConfirmedHandoff ? `Last confirmed handoff: ${checkpoint.lastConfirmedHandoff}` : '',
    checkpoint.decisions.length ? `Decisions: ${checkpoint.decisions.join('; ')}` : '',
    checkpoint.deviations.length ? `Deviations: ${checkpoint.deviations.join('; ')}` : '',
    checkpoint.openBlockers.length ? `Open blockers: ${checkpoint.openBlockers.join('; ')}` : '',
    checkpoint.filesTouched.length ? `Files touched: ${checkpoint.filesTouched.join('; ')}` : '',
    checkpoint.testsRun.length ? `Tests run: ${checkpoint.testsRun.join('; ')}` : '',
    checkpoint.acceptanceStatus
      ? `Acceptance: ${checkpoint.acceptanceStatus.status}${checkpoint.acceptanceStatus.gaps.length ? ` (${checkpoint.acceptanceStatus.gaps.join('; ')})` : ''}`
      : '',
    checkpoint.validationState
      ? `Validation: ${checkpoint.validationState.status}${checkpoint.validationState.checks.length ? ` (${checkpoint.validationState.checks.join('; ')})` : ''}`
      : '',
    checkpoint.controlSignals?.length
      ? `Control signals: ${checkpoint.controlSignals.map((signal) => `${signal.severity}:${signal.kind}:${signal.message}`).join('; ')}`
      : '',
    checkpoint.reviewNeededItems.length ? `Review needed: ${checkpoint.reviewNeededItems.join('; ')}` : '',
    checkpoint.nextAction ? `Next action: ${checkpoint.nextAction}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}
