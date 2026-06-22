import type {
  LongConversationAcceptanceStatus,
  LongConversationControlSignal,
  LongConversationQualityAssessment,
  LongConversationValidationState,
} from './long-task-control';

export type MissionStatus =
  | 'idle'
  | 'running'
  | 'sleeping'
  | 'paused'
  | 'ask_user'
  | 'complete'
  | 'blocked'
  | 'cancelled'
  | 'error';

export type MissionPhase =
  | 'intake'
  | 'context_pack'
  | 'preflight'
  | 'execute'
  | 'collect_evidence'
  | 'reflect'
  | 'memory_propose'
  | 'checkpoint'
  | 'schedule'
  | 'complete'
  | 'blocked'
  | 'ask_user';

export type MissionDecision = 'continue' | 'repair' | 'sleep' | 'ask_user' | 'complete' | 'blocked';

export type MissionEvidenceRef = {
  type: 'session' | 'trace' | 'file' | 'memory' | 'tool' | 'task_loop' | 'clawgraph' | 'task_ledger' | 'manual' | 'other';
  ref: string;
  label?: string;
  summary?: string;
};

export type MissionMemoryCandidate = {
  kind: 'role_memory' | 'knowledge_draft';
  summary: string;
  evidenceRefs: string[];
};

export type MissionReviewerResult = {
  decision: MissionDecision;
  confidence: number;
  reason: string;
  missingEvidence: string[];
  verificationGaps: string[];
  repairBrief?: string;
  nextTick?: { afterMs?: number; reason?: string };
  risks: string[];
  controlSignals?: LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
  acceptanceStatus?: LongConversationAcceptanceStatus;
  quality?: LongConversationQualityAssessment[];
  memoryCandidates: MissionMemoryCandidate[];
  checkpointSummary: string;
};

export type MissionContextPack = {
  missionId: string;
  objective: string;
  acceptance: string[];
  tick: number;
  taskLedgerSummary: string;
  checkpointSummary: string;
  previousReviewerSummary: string;
  memorySummary: string;
  evidenceText: string;
  openBlockers: string[];
  reviewItems: string[];
  repairBrief: string;
  controlSignals?: LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
  acceptanceStatus?: LongConversationAcceptanceStatus;
  scopeSummary?: string;
  hash: string;
};

export type MissionTickRecord = {
  tick: number;
  phase: MissionPhase;
  status: MissionStatus;
  decision?: MissionDecision;
  taskLoopRunId?: string;
  traceId?: string;
  evidenceRefs: MissionEvidenceRef[];
  reviewer?: MissionReviewerResult;
  controlSignals?: LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
  createdAt: number;
  updatedAt: number;
};

export type MissionRunRecord = {
  missionId: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string | null;
  objective: string;
  acceptance: string[];
  status: MissionStatus;
  phase: MissionPhase;
  tick: number;
  repairTicks: number;
  maxTicks: number;
  maxRepairTicks: number;
  progress: number;
  lastDecision?: MissionDecision;
  lastReason?: string;
  lastReviewerSummary?: string;
  nextWakeAt?: number;
  blockedReason?: string;
  traceId?: string;
  taskLoopRunId?: string;
  evidenceRefs: MissionEvidenceRef[];
  risks: string[];
  remaining: string[];
  controlSignals?: LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
  acceptanceStatus?: LongConversationAcceptanceStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  ticks: MissionTickRecord[];
};

export type MissionLifecycleEvent = {
  missionId: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string | null;
  phase: MissionPhase;
  status: MissionStatus;
  tick: number;
  progress: number;
  reviewerDecision?: MissionDecision;
  nextWakeAt?: number;
  blockedReason?: string;
  taskLoopRunId?: string;
  traceId?: string;
  controlSignals?: LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
  error?: string;
  ts: number;
};
