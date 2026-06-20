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
    checkpoint.reviewNeededItems.length ? `Review needed: ${checkpoint.reviewNeededItems.join('; ')}` : '',
    checkpoint.nextAction ? `Next action: ${checkpoint.nextAction}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}
