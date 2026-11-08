/**
 * Subagent registry record types.
 *
 * Defines execution, completion, delivery, pending-delivery, and attachment state stored for child runs.
 */
import type { DeliveryContext } from "../utils/delivery-context.types.js";
import type { SubagentRunOutcome } from "./subagent-announce-output.js";
import type { SubagentLifecycleEndedReason } from "./subagent-lifecycle-events.js";
import type { SpawnSubagentMode } from "./subagent-spawn.types.js";
import type { WorktreeBackend } from "../context-engine/coding-runtime-flags.js";
import type { WorkerOutputHandoffArtifact } from './handoff-artifacts.js';
import type {
  CodingIsolationMode,
  OrchestrationQualityPolicy,
  OrchestrationRepairPolicy,
  OrchestrationExecutionWave,
  OrchestrationTaskGraph,
  OrchestrationTaskLedgerEntry,
  RouteDiagnostics,
  WorkerCommunicationPolicy,
} from "./orchestration-protocol.js";

export type TeamOrchestrationPhase = "worker" | "verifier";

export type TeamPatchFlowStatus =
  | "applied"
  | "partial"
  | "failed"
  | "no-proposals"
  | "verification-failed"
  | "blocked"
  | "unknown";

export type TeamPatchFlowResultSummary = {
  workerId: string;
  ok: boolean;
  error?: string;
  summary?: { added: string[]; modified: string[]; deleted: string[] };
  destructive?: { reason?: string; requiresApproval?: boolean };
  journal?: {
    batchId: string;
    batchState: string;
    undoable: boolean;
    snapshotIds: string[];
  };
  recoveryRef?: string;
};

export type TeamOrchestrationMetadata = {
  verifierNoSelfRepair?: boolean;
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
  verifierSkippedReason?:
    | "all-workers-failed"
    | "no-verifier-role"
    | "spawn-failed"
    | "candidate-apply-host-missing"
    | "candidate-apply-not-complete"
    | "retired-patch-flow";
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
  isolation?: CodingIsolationMode;
  worktreeId?: string;
  worktreeGeneration?: string;
  worktreeBackend?: WorktreeBackend;
  worktreeWriteSet?: string[];
  worktreeMergeStatus?: "merged" | "conflict" | "rework" | "missing" | "error";
  worktreeWriteSetMismatch?: string[];
  worktreeMergeReason?: string;
  worktreeMergeProcessedAt?: number;
  worktreeMergeJournalRef?: string;
  worktreeMergeHashes?: Record<string, string | null>;
  worktreeMergeRecoveryRequired?: boolean;
  routeDiagnostics?: RouteDiagnostics;
  qualityPolicy?: OrchestrationQualityPolicy;
  repairPolicy?: OrchestrationRepairPolicy;
  workerCommunication?: WorkerCommunicationPolicy;
  handoffArtifactsMode?: "off" | "on";
  handoffArtifacts?: WorkerOutputHandoffArtifact[];
  allowFollowupPlanning?: boolean;
  /** Historical execution marker; retirement prevents it from starting new effects. */
  patchFlowExecution?: true;
  /** Worker write-set provenance carried with an extracted patch proposal. */
  patchFlowWriteSet?: string[];
  /** Final best-effort result after all expected workers complete. */
  patchFlowStatus?: TeamPatchFlowStatus;
  patchFlowResults?: TeamPatchFlowResultSummary[];
  patchFlowAppliedAt?: number;
  patchFlowError?: string;
  patchFlowCandidateId?: string;
  patchFlowCandidateTreeOid?: string;
  patchFlowCandidateInputDigest?: string;
  patchFlowTraceDigest?: string;
  patchFlowJournalRefs?: string[];
  completionFactId?: string;
  completionFactStatus?: "recorded" | "duplicate" | "rejected" | "unavailable" | "not_configured";
  completionHostOutcome?: "applied" | "not_applied" | "unknown";
  completionProviderProjection?: "active" | "abandoned" | "host-completed";
  completionActiveSessionRisk?: boolean;
  verseGitCleanup?: {
    bindingId: string;
    requestId: string;
    repoId: string;
    worktreeId: string;
    worktreePath: string;
    ownerId: string;
    epoch: number;
    authorizationId: string;
    baseOid: string;
    refsDigest: string;
  };
};

/** Optional tag that makes a child completion a ContextFoldResult delivery. */
export type ContextFoldRunMetadata = {
  foldId: string;
  deliveryId: string;
  maxResultChars: number;
  childHandles: Array<{
    handleId: string;
    resourceId: string;
    selector: string;
    checksum: string;
    kind: "excerpt" | "search" | "aggregate" | "file" | "test" | "run" | "tool";
    label?: string;
  }>;
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
  contextFold?: ContextFoldRunMetadata;
};

export type SubagentExecutionState = {
  status: "queued" | "pending" | "running" | "interrupted" | "terminal";
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
  /** Prepared agent RPC owned by this registry; retained until dispatch is acknowledged. */
  queuedDispatch?: {
    params: Record<string, unknown>;
    timeoutMs: number;
    controllerSessionId: string;
    maxChildren: number;
    persistentTask?:import('../../../shared/task-system/types.js').TaskDelegationIntent;
  };
  /** Persisted pre-dispatch reservation. Unknown dispatch never releases it by age. */
  dispatchPending?: true;
  childSessionKey: string;
  controllerSessionKey?: string;
  requesterSessionKey: string;
  /**
   * TF-0082 generation pin: the requester session's sessionId snapshotted at
   * spawn. A completion delivery arriving after the requester session was
   * reset/forked to a new generation must never steer the new generation.
   */
  requesterSessionId?: string;
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
  contextFold?: ContextFoldRunMetadata;
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
