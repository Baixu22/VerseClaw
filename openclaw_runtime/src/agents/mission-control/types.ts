import type { AgentModelConfig } from "../../config/types.agents-shared.js";
import type {
  LongConversationAcceptanceStatus,
  LongConversationControlSignal,
  LongConversationQualityAssessment,
  LongConversationValidationState,
} from "../long-conversation-control-signals.js";
import type { TaskLoopRunResult } from "../task-loop-controller.js";
import type { AnomalyPattern } from "../anomaly-classifier.js";
import type { MissionContextPack } from "./context.js";

export type MissionStatus =
  | "idle"
  | "running"
  | "sleeping"
  | "paused"
  | "ask_user"
  | "complete"
  | "blocked"
  | "cancelled"
  | "error";

export type MissionPhase =
  | "intake"
  | "context_pack"
  | "preflight"
  | "execute"
  | "collect_evidence"
  | "reflect"
  | "memory_propose"
  | "checkpoint"
  | "schedule"
  | "complete"
  | "blocked"
  | "ask_user";

export type MissionDecision = "continue" | "repair" | "sleep" | "ask_user" | "complete" | "blocked";

export type MissionConfig = {
  enabled?: boolean;
  maxTicks?: number;
  maxRepairTicks?: number;
  innerLoop?: {
    maxIterations?: number;
    maxRepairIterations?: number;
  };
  tickPolicy?: {
    mode?: "manual" | "scheduled" | "event";
    minIntervalMs?: number;
    quietHours?: string[];
  };
  completion?: {
    minConfidence?: number;
    requireEvidence?: boolean;
    requireLedgerClear?: boolean;
  };
  memory?: {
    proposeAfterTick?: boolean;
    autoApplyLowRisk?: boolean;
  };
  reviewer?: {
    model?: AgentModelConfig;
    timeoutMs?: number;
  };
};

export type MissionEvidenceRef = {
  type: "session" | "trace" | "file" | "memory" | "tool" | "task_loop" | "clawgraph" | "task_ledger" | "manual" | "other";
  ref: string;
  label?: string;
  summary?: string;
};

export type MissionMemoryCandidate = {
  kind: "role_memory" | "knowledge_draft";
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
  noProgressHash?: string;
  /** Mission fencing revision (Phase 0). Populated by the store read model. */
  revision?: number;
  activeTickId?: string | null;
  lastWakeId?: string | null;
  /** Guardian circuit breaker (P2-7) 触发标记：checkpoint trigger 用 audit_fail。 */
  guardianTripped?: boolean;
  metadata?: Record<string, unknown>;
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

export type MissionRunRequest = {
  missionId?: string;
  objective: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string | null;
  acceptance?: string[];
  fileHints?: string[];
  important?: boolean;
  templateId?: string;
  teamTemplateId?: string;
  leadRole?: string;
  preferredLeadRole?: string;
  maxWorkers?: number;
  includeVerifier?: boolean;
  taskLedgerSummary?: string;
  memorySummary?: string;
  openBlockers?: string[];
  reviewItems?: string[];
  repairBrief?: string;
  enableSchedule?: boolean;
  maxTicks?: number;
  maxRepairTicks?: number;
};

export type MissionTickInput = {
  missionId: string;
  reason?: "manual" | "scheduled" | "event" | "approval" | "heartbeat" | "repair";
  taskLedgerSummary?: string;
  memorySummary?: string;
  openBlockers?: string[];
  reviewItems?: string[];
  repairBrief?: string;
  /**
   * Phase 3 goal-wake continuation. `preClaimed` is produced by the SQL
   * mission fencing claim immediately before this tick so the dispatcher and
   * the tick body never race for the same wake effect.
   */
  wake?: {
    wakeId: string;
    preClaimed?: {
      revision: number;
      activeTickId: string;
      tick: number;
    };
  };
  /** Sanitized process completion payload injected into the tick context. */
  wakePayload?: Record<string, unknown>;
};

export type MissionReviewerInput = {
  contextPack: MissionContextPack;
  taskLoopResult?: TaskLoopRunResult;
  failures?: string[];
  tick: number;
  repairTicksUsed: number;
  maxRepairTicks: number;
  maxTicks: number;
  reviewer?: MissionConfig["reviewer"];
  cfg?: unknown;
  agentId?: string;
  /**
   * A3 Round 2: classified anomaly pattern, injected by `classifyAnomalyPattern`
   * (pure function). OPTIONAL and advisory — the reviewer MAY ignore it
   * (observe-only honesty, area-3-runtime-resilience.md §9.1).
   *
   * Flag-off parity: when the A3 flag is off, this field is `undefined` and
   * the reviewer behaves exactly as before. When non-null, the reviewer SHOULD
   * consider the pattern in its reasoning but is NOT required to act on it.
   */
  anomalyPattern?: AnomalyPattern;
};

export type MissionReviewerDeps = {
  complete?: (prompt: string, input: MissionReviewerInput) => Promise<string>;
};
