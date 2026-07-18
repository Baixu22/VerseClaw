/**
 * Subagent registry record types.
 *
 * Defines execution, completion, delivery, pending-delivery, and attachment state stored for child runs.
 */
import type { DeliveryContext } from "../utils/delivery-context.types.js";
import type { SubagentRunOutcome } from "./subagent-announce-output.js";
import type { SubagentLifecycleEndedReason } from "./subagent-lifecycle-events.js";
import type { SpawnSubagentMode } from "./subagent-spawn.types.js";
import type {
  OrchestrationQualityPolicy,
  OrchestrationRepairPolicy,
  OrchestrationExecutionWave,
  OrchestrationTaskGraph,
  OrchestrationTaskLedgerEntry,
  RouteDiagnostics,
  WorkerCommunicationPolicy,
} from "./orchestration-protocol.js";

export type TeamOrchestrationPhase = "worker" | "verifier";

export type TeamOrchestrationMetadata = {
  orchestrationRunId: string;
  templateId?: string;
  roleName: string;
  isVerifier: boolean;
  phase: TeamOrchestrationPhase;
  expectedWorkerRunIds?: string[];
  leadRole: string;
  originalTask: string;
  verifierRole?: string;
  verifierModelRef?: string | null;
  verifierStartedRunId?: string;
  verifierSkippedReason?: "all-workers-failed" | "no-verifier-role" | "spawn-failed";
  verifierStartedAt?: number;
  verifierSkippedAt?: number;
  /** Explicit structured verifier decision; free text alone cannot authorize pass (F-AUTH-005). */
  verificationVerdict?: "pass" | "fail" | "repair_required";
  taskId?: string;
  taskNodeId?: string;
  graphRunId?: string;
  roleInstanceId?: string;
  attempt?: number;
  scope?: string;
  requiredCapabilities?: string[];
  dependsOn?: string[];
  repairOf?: string;
  followupOf?: string;
  executionWave?: number;
  ledger?: OrchestrationTaskLedgerEntry;
  taskGraph?: OrchestrationTaskGraph;
  executionWaves?: OrchestrationExecutionWave[];
  routeDiagnostics?: RouteDiagnostics;
  qualityPolicy?: OrchestrationQualityPolicy;
  repairPolicy?: OrchestrationRepairPolicy;
  workerCommunication?: WorkerCommunicationPolicy;
  handoffArtifactsMode?: "off" | "on";
  allowFollowupPlanning?: boolean;
};

export type PendingFinalDeliveryPayload = {
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  childSessionKey: string;
  childRunId: string;
  task: string;
  label?: string;
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  expectsCompletionMessage?: boolean;
  spawnMode?: SpawnSubagentMode;
  frozenResultText?: string | null;
  fallbackFrozenResultText?: string | null;
  wakeOnDescendantSettle?: boolean;
  orchestration?: TeamOrchestrationMetadata;
};

export type SubagentExecutionState = {
  status: "running" | "interrupted" | "terminal";
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  interruptedAt?: number;
  interruptionReason?: "gateway-restart" | "lost-execution-context";
  transcriptFile?: string;
};

export type SubagentCompletionState = {
  required: boolean;
  resultText?: string | null;
  capturedAt?: number;
  fallbackResultText?: string | null;
  fallbackCapturedAt?: number;
};

export type SubagentCompletionDeliveryState = {
  status:
    | "not_required"
    | "pending"
    | "in_progress"
    | "delivered"
    | "failed"
    | "suspended"
    | "discarded";
  payload?: PendingFinalDeliveryPayload;
  createdAt?: number;
  enqueuedAt?: number;
  deliveredAt?: number;
  announcedAt?: number;
  lastAttemptAt?: number;
  attemptCount?: number;
  lastError?: string | null;
  steeringLeaseId?: string;
  steeringLeasedAt?: number;
  steeringInjectedAt?: number;
  suspendedAt?: number;
  suspendedReason?: "retry-limit" | "expiry";
  discardedAt?: number;
  discardReason?: "expired" | "pressure-pruned";
  discardedPayloadSummary?: {
    requesterSessionKey?: string;
    childSessionKey?: string;
    childRunId?: string;
    endedAt?: number;
    status?: string;
    lastError?: string | null;
  };
  lastDropReason?:
    | "queue_cap"
    | "parent_run_ended"
    | "sink_unavailable"
    | "dedupe"
    | "waiting_for_requester_turn";
};

export type SubagentRunRecord = {
  runId: string;
  childSessionKey: string;
  controllerSessionKey?: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  taskName?: string;
  cleanup: "delete" | "keep";
  label?: string;
  model?: string;
  agentDir?: string;
  workspaceDir?: string;
  runTimeoutSeconds?: number;
  spawnMode?: SpawnSubagentMode;
  createdAt: number;
  startedAt?: number;
  sessionStartedAt?: number;
  accumulatedRuntimeMs?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  archiveAtMs?: number;
  cleanupCompletedAt?: number;
  cleanupHandled?: boolean;
  suppressAnnounceReason?: "steer-restart" | "killed";
  expectsCompletionMessage?: boolean;
  endedReason?: SubagentLifecycleEndedReason;
  pauseReason?: "sessions_yield";
  wakeOnDescendantSettle?: boolean;
  orchestration?: TeamOrchestrationMetadata;
  execution?: SubagentExecutionState;
  completion?: SubagentCompletionState;
  /** Set after the subagent_ended hook has been emitted successfully once. */
  endedHookEmittedAt?: number;
  /** Set after cleanupBrowserSessionsForLifecycleEnd has been dispatched once. */
  browserCleanupDispatchedAt?: number;
  /** Durable outbox marker for parent/external completion delivery. */
  delivery?: SubagentCompletionDeliveryState;
  attachmentsDir?: string;
  attachmentsRootDir?: string;
  retainAttachmentsOnKeep?: boolean;
};
