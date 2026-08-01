import crypto, { createHash } from "node:crypto";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { AgentConfig } from "../../config/types.agents.js";
import { storeRuntimeTrace } from "../../observability/trace-buffer.js";
import { createRoleFirstTrace, completeObservedRun } from "../../observability/role-first-observer.js";
import type { ObservabilityTraceRecorder } from "../../observability/trace-recorder.js";
import {
  localControlPlaneReportEnabled,
  recordLocalControlPlaneReport,
  type LocalControlPlaneDiagnostic,
} from "../../local-control-plane/index.js";
import {
  buildRuntimeResumeCheckpoint,
  getLatestLongTaskCheckpoint,
  listLongTaskCheckpoints,
  recordLongTaskCheckpoint,
} from "../long-task-control/store.js";
import {
  executeReplayRollback,
  type ReplayRollbackDeps,
} from "../replay-rollback-authority.js";
import { ensureLongTaskLedgerRoot } from "../long-task-control/task-ledger.js";
import {
  defaultQualityAssessments,
  deriveValidationState,
  hasBlockingControlSignal,
  normalizeControlSignals,
  signalsFromGaps,
  type LongConversationControlSignal,
} from "../long-conversation-control-signals.js";
import { getSessionGuardianCircuitBreaker } from "../guardian-circuit-breaker.js";
import {
  runTaskLoop,
  type TaskLoopControllerDeps,
  type TaskLoopRunRequest,
  type TaskLoopRunResult,
} from "../task-loop-controller.js";
import { proposeMemoryCard } from "../../memory/memory-store.js";
import { extractMemoryProposalDrafts } from "../../memory/memory-extractor.js";
import type { MemoryEvidenceRef, MemoryProposal } from "../../memory/types.js";
import { resolveAnomalyPatternForReviewer } from "../anomaly-classifier.js";
import { buildMissionContextPack } from "./context.js";
import { runMissionReviewer } from "./reviewer.js";
import {
  getLatestMissionForSession,
  getMissionRun as getMissionRunFromStore,
  recordMissionEvent,
  saveMissionRun,
} from "./store.js";
import type {
  MissionConfig,
  MissionDecision,
  MissionEvidenceRef,
  MissionLifecycleEvent,
  MissionMemoryCandidate,
  MissionPhase,
  MissionReviewerResult,
  MissionReviewerDeps,
  MissionRunRecord,
  MissionRunRequest,
  MissionStatus,
  MissionTickInput,
} from "./types.js";

export type MissionControllerDeps = {
  idFactory?: (prefix: string) => string;
  now?: () => number;
  runTaskLoop?: typeof runTaskLoop;
  taskLoopDeps?: TaskLoopControllerDeps;
  reviewer?: typeof runMissionReviewer;
  reviewerDeps?: MissionReviewerDeps;
  lifecycle?: (event: MissionLifecycleEvent) => void;
  saveMission?: typeof saveMissionRun;
  getMission?: typeof getMissionRunFromStore;
  getLatestMissionForSession?: typeof getLatestMissionForSession;
  recordEvent?: typeof recordMissionEvent;
  storeTrace?: typeof storeRuntimeTrace;
  proposeMemory?: typeof proposeMemoryCard;
  createKnowledgeInboxItem?: (item: MissionKnowledgeInboxItem) => void;
  /**
   * A3 replay-rollback wiring for repeated-repair recovery. When provided AND
   * `runtime.mission.rollback.enabled` is true, Mission Control invokes
   * `executeReplayRollback` (legacy checkpoint target) instead of blocking
   * immediately when repair evidence repeats without progress. Default
   * undefined: no rollback, legacy blocked behavior preserved.
   */
  rollback?: ReplayRollbackDeps;
  /**
   * Resolve the write-journal seq boundary at the current instant (max entry
   * seq recorded so far for the mission session). When provided, checkpoints
   * are stamped with `metadata.journalSeq` so rollback can filter journal
   * entries by monotonic seq (`entry.seq > boundary`) instead of
   * same-millisecond-ambiguous createdAt. Default undefined: checkpoint
   * falls back to createdAt-based filtering.
   */
  journalSeqBoundary?: () => number | undefined;
};

export type MissionRunResult = MissionRunRecord;

const missionLocalControlPlaneConfigs = new WeakMap<MissionRunRecord, OpenClawConfig | undefined>();

export type MissionKnowledgeInboxSourceRef = {
  id: string;
  label?: string;
  kind?: "chat" | "file" | "wiki" | "task_ledger" | "trace" | "task_loop" | "manual" | "search_result" | "other";
  path?: string;
  url?: string;
};

export type MissionKnowledgeInboxItem = {
  title: string;
  body: string;
  kind: "chat-session" | "task-ledger";
  type: "source-note" | "synthesis" | "decision" | "architecture" | "command" | "troubleshooting" | "glossary" | "procedure";
  status: "pending";
  sourceIds: string[];
  sourceRefs: MissionKnowledgeInboxSourceRef[];
  tags: string[];
  workspaceId?: string | null;
  agentId?: string | null;
  createdBy: "agent";
  warnings?: string[];
  metadata: {
    mvpVersion: "knowledge-interaction-mvp-1";
    recommendation: "save" | "review" | "archive-only";
    score: {
      reusability: number;
      uniqueness: number;
      confidence: number;
      overall: number;
    };
    temporality: "stable" | "versioned" | "ephemeral";
    reason: string;
    missionId: string;
    tick: number;
    outcome: MissionStatus;
    evidenceRefs: string[];
    captureKey: string;
  };
};

function defaultId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function positiveInt(value: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function resolveAgentMissionConfig(cfg: OpenClawConfig | undefined, agentId?: string): MissionConfig {
  const defaults = cfg?.agents?.defaults?.missionLoop ?? {};
  const agent = cfg?.agents?.list?.find((entry: AgentConfig) => entry.id === agentId);
  return { ...defaults, ...(agent?.missionLoop ?? {}) };
}

function terminal(status: MissionStatus): boolean {
  return status === "complete" || status === "blocked" || status === "cancelled" || status === "error";
}

function progressForPhase(phase: MissionPhase, tick: number, maxTicks: number): number {
  const phaseWeight: Record<MissionPhase, number> = {
    intake: 4,
    context_pack: 12,
    preflight: 18,
    execute: 42,
    collect_evidence: 58,
    reflect: 72,
    memory_propose: 80,
    checkpoint: 88,
    schedule: 94,
    ask_user: 100,
    blocked: 100,
    complete: 100,
  };
  const tickOffset = ((Math.max(1, tick) - 1) / Math.max(1, maxTicks)) * 10;
  return Math.min(100, Math.round(phaseWeight[phase] + tickOffset));
}

function clone(record: MissionRunRecord): MissionRunRecord {
  return {
    ...record,
    acceptance: [...record.acceptance],
    evidenceRefs: [...record.evidenceRefs],
    risks: [...record.risks],
    remaining: [...record.remaining],
    controlSignals: record.controlSignals ? [...record.controlSignals] : undefined,
    validationState: record.validationState ? { ...record.validationState } : undefined,
    acceptanceStatus: record.acceptanceStatus ? { ...record.acceptanceStatus } : undefined,
    ticks: record.ticks.map((tick) => ({
      ...tick,
      evidenceRefs: [...tick.evidenceRefs],
      controlSignals: tick.controlSignals ? [...tick.controlSignals] : undefined,
      validationState: tick.validationState ? { ...tick.validationState } : undefined,
      reviewer: tick.reviewer ? {
        ...tick.reviewer,
        controlSignals: tick.reviewer.controlSignals ? [...tick.reviewer.controlSignals] : undefined,
        validationState: tick.reviewer.validationState ? { ...tick.reviewer.validationState } : undefined,
        acceptanceStatus: tick.reviewer.acceptanceStatus ? { ...tick.reviewer.acceptanceStatus } : undefined,
      } : undefined,
    })),
    metadata: { ...(record.metadata ?? {}) },
  };
}

function missionSeverity(status: MissionStatus): LocalControlPlaneDiagnostic["severity"] {
  if (status === "error") return "error";
  if (status === "blocked" || status === "ask_user" || status === "cancelled") return "warning";
  return "info";
}

function missionEvidenceRefsForReport(record: MissionRunRecord) {
  return record.evidenceRefs.map((ref) => ({
    type: ref.type === "task_loop" ? "task_loop" as const : ref.type,
    ref: ref.ref,
    ...(ref.label ? { label: ref.label } : {}),
    ...(ref.summary ? { summary: ref.summary } : {}),
  }));
}

function recordMissionLifecycleReport(
  record: MissionRunRecord,
  event: MissionLifecycleEvent,
): void {
  const cfg = missionLocalControlPlaneConfigs.get(record);
  if (!localControlPlaneReportEnabled(cfg, "mission")) return;
  try {
    const diagnostics: LocalControlPlaneDiagnostic[] = [
      {
        code: `mission.phase.${event.phase}`,
        severity: missionSeverity(event.status),
        message: `Mission phase ${event.phase} status ${event.status}.`,
        metadata: {
          phase: event.phase,
          status: event.status,
          tick: event.tick,
          progress: event.progress,
          reviewerDecision: event.reviewerDecision ?? record.lastDecision ?? null,
        },
      },
      ...(event.blockedReason
        ? [{
            code: "mission.blocked_reason",
            severity: "warning" as const,
            message: event.blockedReason,
          }]
        : []),
      ...(record.remaining.length
        ? [{
            code: "mission.remaining_evidence_or_work",
            severity: "warning" as const,
            message: "Mission has remaining evidence or verification gaps.",
            metadata: { remainingCount: record.remaining.length },
          }]
        : []),
    ];
    recordLocalControlPlaneReport(cfg, {
      kind: "mission",
      sessionKey: record.sessionKey,
      runId: record.missionId,
      taskId: record.taskLoopRunId ?? record.missionId,
      timestamp: event.ts,
      summary: `Mission ${event.phase}/${event.status}`,
      diagnostics,
      evidenceRefs: missionEvidenceRefsForReport(record),
      payload: {
        source: "mission.lifecycle",
        missionId: record.missionId,
        phase: event.phase,
        status: event.status,
        tick: event.tick,
        maxTicks: record.maxTicks,
        repairCount: record.repairTicks,
        maxRepairTicks: record.maxRepairTicks,
        reviewerDecision: event.reviewerDecision ?? record.lastDecision,
        evidenceRefCount: record.evidenceRefs.length,
        taskLoopRunId: record.taskLoopRunId,
        traceId: record.traceId,
        nextWakeAt: record.nextWakeAt,
        nextAction: record.lastDecision ?? record.phase,
        blockedReason: event.blockedReason ?? record.blockedReason,
        legacyDecisionUnaffected: true,
      },
    });
  } catch {
    // Local control-plane reports are observe-only and must not perturb Mission behavior.
  }
}

function emit(record: MissionRunRecord, deps: MissionControllerDeps, patch: Partial<MissionLifecycleEvent> = {}): void {
  const now = deps.now?.() ?? Date.now();
  record.updatedAt = now;
  record.progress = progressForPhase(record.phase, Math.max(1, record.tick), record.maxTicks);
  (deps.saveMission ?? saveMissionRun)(record);
  (deps.recordEvent ?? recordMissionEvent)({
    missionId: record.missionId,
    sessionKey: record.sessionKey,
    type: `mission.${record.phase}`,
    phase: record.phase,
    status: record.status,
    tick: record.tick,
    decision: record.lastDecision,
    payload: {
      progress: record.progress,
      lastReason: record.lastReason,
      blockedReason: record.blockedReason,
      taskLoopRunId: record.taskLoopRunId,
      traceId: record.traceId,
      controlSignals: record.controlSignals,
      validationState: record.validationState,
      ...patch,
    },
    createdAt: now,
  });
  deps.lifecycle?.({
    missionId: record.missionId,
    sessionKey: record.sessionKey,
    agentId: record.agentId,
    workspaceId: record.workspaceId,
    phase: record.phase,
    status: record.status,
    tick: record.tick,
    progress: record.progress,
    reviewerDecision: record.lastDecision,
    nextWakeAt: record.nextWakeAt,
    blockedReason: record.blockedReason,
    taskLoopRunId: record.taskLoopRunId,
    traceId: record.traceId,
    controlSignals: record.controlSignals,
    validationState: record.validationState,
    ts: now,
    ...patch,
  });
  recordMissionLifecycleReport(record, {
    missionId: record.missionId,
    sessionKey: record.sessionKey,
    agentId: record.agentId,
    workspaceId: record.workspaceId,
    phase: record.phase,
    status: record.status,
    tick: record.tick,
    progress: record.progress,
    reviewerDecision: record.lastDecision,
    nextWakeAt: record.nextWakeAt,
    blockedReason: record.blockedReason,
    taskLoopRunId: record.taskLoopRunId,
    traceId: record.traceId,
    controlSignals: record.controlSignals,
    validationState: record.validationState,
    ts: now,
    ...patch,
  });
}

function checkpointSummary(sessionKey: string): string {
  const latest = getLatestLongTaskCheckpoint(sessionKey);
  if (!latest) return "";
  const checkpoint = latest.checkpoint;
  return [
    checkpoint.objective ? `Objective: ${checkpoint.objective}` : "",
    checkpoint.activeTask ? `Active task: ${checkpoint.activeTask}` : "",
    checkpoint.lastConfirmedHandoff ? `Last handoff: ${checkpoint.lastConfirmedHandoff}` : "",
    checkpoint.decisions.length ? `Decisions: ${checkpoint.decisions.join("; ")}` : "",
    checkpoint.deviations.length ? `Deviations: ${checkpoint.deviations.join("; ")}` : "",
    checkpoint.openBlockers.length ? `Open blockers: ${checkpoint.openBlockers.join("; ")}` : "",
    checkpoint.filesTouched.length ? `Files touched: ${checkpoint.filesTouched.join("; ")}` : "",
    checkpoint.testsRun.length ? `Tests run: ${checkpoint.testsRun.join("; ")}` : "",
    checkpoint.reviewNeededItems.length ? `Review needed: ${checkpoint.reviewNeededItems.join("; ")}` : "",
    checkpoint.nextAction ? `Next action: ${checkpoint.nextAction}` : "",
  ].filter(Boolean).join("\n");
}

function evidenceFromTaskLoop(result: TaskLoopRunResult): MissionEvidenceRef[] {
  const refs: MissionEvidenceRef[] = [
    {
      type: "task_loop",
      ref: result.loopRunId,
      label: "Mission inner task loop",
      summary: result.finalSummary || `task_loop status=${result.status} phase=${result.phase}`,
    },
  ];
  if (result.traceId) {
    refs.push({ type: "trace", ref: result.traceId, label: "Mission task-loop trace", summary: result.finalSummary });
  }
  for (const ref of result.evidenceRefs) {
    refs.push({
      type: ref.type === "trace" ? "trace" : ref.type === "tool" ? "tool" : "other",
      ref: ref.ref,
      label: ref.label,
      summary: ref.summary,
    });
  }
  return refs;
}

function buildNoProgressHash(decision: MissionDecision, repairBrief: string | undefined, evidence: readonly MissionEvidenceRef[]): string {
  return createHash("sha256")
    .update(JSON.stringify({
      decision,
      repairBrief: repairBrief ?? "",
      evidence: evidence.map((ref) => [ref.type, ref.ref, ref.summary ?? ""]),
    }))
    .digest("hex");
}

function missionHasOpenControlSignals(reviewer: MissionReviewerResult): boolean {
  return reviewer.missingEvidence.length > 0
    || reviewer.verificationGaps.length > 0
    || hasBlockingControlSignal(reviewer.controlSignals)
    || reviewer.validationState?.status === "failed"
    || reviewer.validationState?.status === "missing"
    || reviewer.validationState?.status === "partial"
    || reviewer.validationState?.status === "not_run"
    || reviewer.acceptanceStatus?.status === "missing"
    || reviewer.acceptanceStatus?.status === "partial"
    || reviewer.acceptanceStatus?.status === "changed";
}

function missionNeedsUserConfirmation(signals: readonly LongConversationControlSignal[] | undefined): boolean {
  return (signals ?? []).some((signal) =>
    signal.suggestedAction === "ask_user"
      || signal.suggestedAction === "replan"
      || signal.kind === "scope_drift"
      || signal.kind === "replan_required"
      || signal.kind === "permission_wait",
  );
}

function gateMissionReviewerCompletion(
  reviewer: MissionReviewerResult,
  record: MissionRunRecord,
): MissionReviewerResult {
  if (reviewer.decision !== "complete" || !missionHasOpenControlSignals(reviewer)) {
    return reviewer;
  }
  const canRepair = record.repairTicks < record.maxRepairTicks && record.tick < record.maxTicks;
  const missingEvidence = reviewer.missingEvidence.length
    ? reviewer.missingEvidence
    : ["Mission completion had unresolved control signals."];
  const verificationGaps = reviewer.verificationGaps.length
    ? reviewer.verificationGaps
    : ["Mission validation or acceptance evidence is missing."];
  const controlSignals = normalizeControlSignals([
    ...(reviewer.controlSignals ?? []),
    ...signalsFromGaps({
      missingEvidence,
      verificationGaps,
      risks: reviewer.risks,
      source: "mission.controller",
      repairable: canRepair,
    }),
  ]);
  const validationState = reviewer.validationState ?? deriveValidationState({
    status: "missing",
    gaps: verificationGaps,
  });
  const decision: MissionDecision = missionNeedsUserConfirmation(controlSignals)
    ? "ask_user"
    : canRepair
      ? "repair"
      : "blocked";
  return {
    ...reviewer,
    decision,
    confidence: Math.min(reviewer.confidence, decision === "repair" ? 0.55 : 0.4),
    reason: reviewer.reason || "Mission completion was downgraded because control signals remained open.",
    missingEvidence,
    verificationGaps,
    repairBrief: decision === "repair"
      ? reviewer.repairBrief ?? `Resolve Mission completion gaps: ${[...missingEvidence, ...verificationGaps].join("; ")}`
      : reviewer.repairBrief,
    controlSignals,
    validationState,
    quality: defaultQualityAssessments({ signals: controlSignals, validationState }),
    checkpointSummary: reviewer.checkpointSummary || "Mission completion was downgraded because control signals remained open.",
  };
}

function withInnerTaskLoopConfig(cfg: OpenClawConfig | undefined, missionConfig: MissionConfig): OpenClawConfig | undefined {
  const inner = missionConfig.innerLoop;
  if (!cfg || !inner || (inner.maxIterations === undefined && inner.maxRepairIterations === undefined)) {
    return cfg;
  }
  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        taskLoop: {
          ...cfg.agents?.defaults?.taskLoop,
          ...(inner.maxIterations !== undefined ? { maxIterations: inner.maxIterations } : {}),
          ...(inner.maxRepairIterations !== undefined ? { maxRepairIterations: inner.maxRepairIterations } : {}),
        },
      },
    },
  };
}

function memoryEvidenceRefs(record: MissionRunRecord): MemoryEvidenceRef[] {
  return record.evidenceRefs.flatMap((ref) => {
    if (ref.type === "trace" || ref.type === "session" || ref.type === "tool" || ref.type === "manual") {
      return [{ type: ref.type, ref: ref.ref, ...(ref.summary ? { excerpt: ref.summary.slice(0, 500) } : {}) }];
    }
    if (ref.type === "task_loop") {
      return [{ type: "tool" as const, ref: ref.ref, ...(ref.summary ? { excerpt: ref.summary.slice(0, 500) } : {}) }];
    }
    return [];
  });
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function titleFromKnowledgeCandidate(candidate: MissionMemoryCandidate): string {
  const firstLine = candidate.summary.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
  if (!firstLine) return "Mission knowledge candidate";
  return firstLine.length <= 88 ? firstLine : `${firstLine.slice(0, 85)}...`;
}

function knowledgeDraftTypeFromCandidate(candidate: MissionMemoryCandidate, failed: boolean): MissionKnowledgeInboxItem["type"] {
  const text = candidate.summary.toLowerCase();
  if (failed || /error|failed|failure|blocked|bug|排障|故障|失败|错误/u.test(text)) return "troubleshooting";
  if (/decision|rationale|chose|chosen|选择|决策|取舍/u.test(text)) return "decision";
  if (/workflow|procedure|steps|流程|步骤/u.test(text)) return "procedure";
  if (/architecture|架构/u.test(text)) return "architecture";
  return "synthesis";
}

function temporalityFromSummary(summary: string): MissionKnowledgeInboxItem["metadata"]["temporality"] {
  if (/temporary|workaround|hack|临时|绕过/u.test(summary)) return "ephemeral";
  if (/v\d+|version|migration|upgrade|Next\.js|React|TypeScript|版本|迁移|升级/u.test(summary)) return "versioned";
  return "stable";
}

function sourceRefFromEvidence(ref: MissionEvidenceRef): MissionKnowledgeInboxSourceRef {
  const label = ref.label ?? `${ref.type}:${ref.ref}`;
  switch (ref.type) {
    case "task_ledger":
      return { id: ref.ref, kind: "task_ledger", label };
    case "trace":
      return { id: `trace:${ref.ref}`, kind: "trace", label };
    case "task_loop":
      return { id: `task_loop:${ref.ref}`, kind: "task_loop", label };
    case "session":
      return { id: ref.ref, kind: "chat", label };
    case "file":
      return { id: ref.ref, kind: "file", path: ref.ref, label };
    case "memory":
      return { id: ref.ref, kind: "wiki", label };
    case "manual":
      return { id: ref.ref, kind: "manual", label };
    default:
      return { id: `${ref.type}:${ref.ref}`, kind: "other", label };
  }
}

function knowledgeCandidateCaptureHash(candidate: MissionMemoryCandidate): string {
  return createHash("sha256")
    .update(JSON.stringify({
      summary: candidate.summary.trim(),
      evidenceRefs: [...candidate.evidenceRefs].map((ref) => ref.trim()).filter(Boolean).sort(),
    }))
    .digest("hex")
    .slice(0, 16);
}

function knowledgeCandidateCaptureKey(record: MissionRunRecord, candidate: MissionMemoryCandidate): string {
  return `mission:${record.missionId}:tick:${record.tick}:knowledge:${knowledgeCandidateCaptureHash(candidate)}`;
}

function outcomeFromReviewer(record: MissionRunRecord, reviewer: MissionReviewerResult, failedOverride = false): MissionStatus {
  if (failedOverride) return "blocked";
  if (reviewer.decision === "complete") return "complete";
  if (reviewer.decision === "blocked") return "blocked";
  if (reviewer.decision === "ask_user") return "ask_user";
  if (reviewer.decision === "repair" || reviewer.decision === "sleep" || reviewer.decision === "continue") {
    return record.tick >= record.maxTicks ? "blocked" : "sleeping";
  }
  return record.status;
}

function buildKnowledgeSourceRefs(
  record: MissionRunRecord,
  candidate: MissionMemoryCandidate,
): MissionKnowledgeInboxSourceRef[] {
  const refs = new Map<string, MissionKnowledgeInboxSourceRef>();
  const allEvidence = [...record.evidenceRefs];
  for (const tick of record.ticks) {
    allEvidence.push(...tick.evidenceRefs);
  }
  const evidenceByRef = new Map(allEvidence.map((ref) => [ref.ref, ref]));

  for (const ref of allEvidence) {
    const source = sourceRefFromEvidence(ref);
    refs.set(source.id, source);
  }

  for (const evidenceRef of candidate.evidenceRefs) {
    const known = evidenceByRef.get(evidenceRef);
    const source = known
      ? sourceRefFromEvidence(known)
      : { id: evidenceRef, kind: "manual" as const, label: evidenceRef };
    refs.set(source.id, source);
  }

  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : {};
  const taskLedgerRootId = typeof metadata.taskLedgerRootId === "string" ? metadata.taskLedgerRootId : undefined;
  if (taskLedgerRootId) {
    refs.set(taskLedgerRootId, {
      id: taskLedgerRootId,
      kind: "task_ledger",
      label: "Mission Task Ledger root",
    });
  }

  return [...refs.values()].slice(0, 12);
}

function scoreKnowledgeCandidate(params: {
  record: MissionRunRecord;
  reviewer: MissionReviewerResult;
  sourceRefs: MissionKnowledgeInboxSourceRef[];
  failed: boolean;
  captureKey: string;
}): MissionKnowledgeInboxItem["metadata"] {
  const { record, reviewer, sourceRefs, failed, captureKey } = params;
  const strongEvidence = sourceRefs.some((ref) => ref.kind === "task_ledger" || ref.kind === "file" || ref.kind === "trace" || ref.kind === "task_loop" || ref.id.startsWith("trace:") || ref.id.startsWith("task_loop:"));
  const validated = reviewer.validationState?.status === "passed" || reviewer.acceptanceStatus?.status === "satisfied";
  const complete = reviewer.decision === "complete" || record.status === "complete";
  const recommendation: MissionKnowledgeInboxItem["metadata"]["recommendation"] = failed
    ? "archive-only"
    : complete && (validated || strongEvidence)
      ? "save"
      : "review";
  const reusability = recommendation === "save" ? 0.82 : recommendation === "review" ? 0.62 : 0.58;
  const uniqueness = 0.5;
  const confidence = recommendation === "save" ? (validated ? 0.86 : 0.76) : recommendation === "review" ? 0.55 : 0.48;
  const overall = clampScore((reusability * 0.4) + (uniqueness * 0.2) + (confidence * 0.4));
  const reason = recommendation === "save"
    ? "Mission completed with reusable evidence-backed knowledge."
    : recommendation === "archive-only"
      ? "Mission did not fully succeed; keep the lesson reviewable without formal wiki writes."
      : "Mission produced a reusable lesson, but evidence or validation needs user review.";

  return {
    mvpVersion: "knowledge-interaction-mvp-1",
    recommendation,
    score: {
      reusability: clampScore(reusability),
      uniqueness: clampScore(uniqueness),
      confidence: clampScore(confidence),
      overall,
    },
    temporality: "stable",
    reason,
    missionId: record.missionId,
    tick: record.tick,
    outcome: outcomeFromReviewer(record, reviewer, failed),
    evidenceRefs: sourceRefs.map((ref) => ref.id),
    captureKey,
  };
}

function buildMissionKnowledgeInboxItem(
  record: MissionRunRecord,
  reviewer: MissionReviewerResult,
  candidate: MissionMemoryCandidate,
  failedOverride = false,
): MissionKnowledgeInboxItem {
  const failed = failedOverride || record.status === "blocked" || record.status === "error" || reviewer.decision === "blocked";
  const sourceRefs = buildKnowledgeSourceRefs(record, candidate);
  const captureKey = knowledgeCandidateCaptureKey(record, candidate);
  const metadata = scoreKnowledgeCandidate({ record, reviewer, sourceRefs, failed, captureKey });
  return {
    title: titleFromKnowledgeCandidate(candidate),
    body: candidate.summary,
    kind: sourceRefs.some((ref) => ref.kind === "task_ledger") ? "task-ledger" : "chat-session",
    type: knowledgeDraftTypeFromCandidate(candidate, failed),
    status: "pending",
    sourceIds: sourceRefs.map((ref) => ref.id),
    sourceRefs,
    tags: ["mission-control", "knowledge-interaction-mvp"],
    workspaceId: record.workspaceId,
    agentId: record.agentId,
    createdBy: "agent",
    warnings: sourceRefs.length === 0 ? ["Mission knowledge candidate has no evidence references."] : [],
    metadata: {
      ...metadata,
      temporality: temporalityFromSummary(candidate.summary),
    },
  };
}

function proposeMemoryCandidates(record: MissionRunRecord, candidates: readonly MissionMemoryCandidate[], deps: MissionControllerDeps): number {
  const propose = deps.proposeMemory ?? proposeMemoryCard;
  let proposed = 0;
  for (const candidate of candidates) {
    if (candidate.kind !== "role_memory") continue;
    const proposal: MemoryProposal = {
      type: "episode",
      scope: "session",
      scopeKey: record.missionId,
      roleTags: ["mission-control"],
      content: candidate.summary,
      evidenceRefs: memoryEvidenceRefs(record),
      evidence: candidate.evidenceRefs,
      confidence: 0.55,
      importance: 0.4,
      source: "trace",
      durability: "session",
      operation: "create",
      reason: `Mission ${record.missionId} memory candidate`,
    };
    try {
      propose(proposal, { actor: { type: "system", id: "mission-control" } });
      proposed += 1;
    } catch {
      // Memory proposals are best-effort; Mission state remains authoritative.
    }
  }
  return proposed;
}

function proposeExtractedMemoryCandidates(record: MissionRunRecord, deps: MissionControllerDeps): number {
  const propose = deps.proposeMemory ?? proposeMemoryCard;
  // Extract explicit "remember" style statements from the tick's reviewable
  // text (latest reason + task-loop final summary + checkpoint summary).
  // Only run on the first tick or a complete decision to avoid cross-tick
  // duplicate proposals; the gatekeeper dedup is a backstop.
  if (record.tick !== 1 && record.status !== "complete" && record.lastDecision !== "complete") {
    return 0;
  }
  const text = record.lastReason ?? "";
  if (!text.trim()) return 0;
  // extractMemoryProposalDrafts emits a draft whenever a source is supplied,
  // so gate on the explicit-remember patterns here: only actual "remember"
  // statements become role-memory candidates. Reviewer summaries are not
  // memory by themselves — this keeps the extraction precise and avoids
  // duplicate proposals alongside reviewer role_memory candidates.
  const REMEMBER_PATTERNS = [
    /\bremember\b/i,
    /\bkeep in mind\b/i,
    /\bnext time\b/i,
    /记住/,
    /以后/,
    /下次/,
    /这个角色应该/,
  ];
  if (!REMEMBER_PATTERNS.some((pattern) => pattern.test(text))) {
    return 0;
  }
  const drafts = extractMemoryProposalDrafts({
    text,
    roleName: "mission-control",
    scopeKey: record.missionId,
    source: "trace_summary",
    evidenceRefs: memoryEvidenceRefs(record),
  });
  let proposed = 0;
  for (const draft of drafts) {
    const proposal: MemoryProposal = {
      type: draft.type,
      scope: draft.scope,
      scopeKey: draft.scopeKey ?? record.missionId,
      roleTags: draft.roleTags,
      content: draft.content,
      evidenceRefs: draft.evidenceRefs,
      evidence: draft.evidenceRefs?.map((ref) => ref.ref),
      confidence: draft.confidence,
      importance: draft.importance,
      source: draft.source,
      durability: "session",
      operation: "create",
      reason: `Mission ${record.missionId} extracted memory candidate (tick ${record.tick})`,
    };
    try {
      propose(proposal, { actor: { type: "system", id: "mission-control" } });
      proposed += 1;
    } catch {
      // Memory proposals are best-effort; Mission state remains authoritative.
    }
  }
  return proposed;
}

function proposeKnowledgeInboxCandidates(record: MissionRunRecord, reviewer: MissionReviewerResult, deps: MissionControllerDeps, failedOverride = false): number {
  if (!deps.createKnowledgeInboxItem) return 0;
  let proposed = 0;
  for (const candidate of reviewer.memoryCandidates) {
    if (candidate.kind !== "knowledge_draft" || !candidate.summary.trim()) continue;
    try {
      deps.createKnowledgeInboxItem(buildMissionKnowledgeInboxItem(record, reviewer, candidate, failedOverride));
      proposed += 1;
    } catch {
      // Knowledge Inbox capture is best-effort; Mission state remains authoritative.
    }
  }
  return proposed;
}

export function createMission(
  request: MissionRunRequest,
  cfg: OpenClawConfig | undefined,
  deps: MissionControllerDeps = {},
): MissionRunRecord {
  const config = resolveAgentMissionConfig(cfg, request.agentId);
  if (config.enabled === false) throw new Error("mission loop is disabled by configuration");
  const now = deps.now?.() ?? Date.now();
  const missionId = request.missionId?.trim() || (deps.idFactory ?? defaultId)("mission");
  let taskLedgerRootId: string | undefined;
  try {
    taskLedgerRootId = ensureLongTaskLedgerRoot({
      workspaceId: request.workspaceId,
      sessionKey: request.sessionKey,
      ...(request.agentId ? { agentId: request.agentId } : {}),
      runId: missionId,
      title: request.objective,
      source: "mission_loop",
      createdAt: now,
      metadata: { missionId, acceptance: request.acceptance ?? [] },
    });
  } catch {
    // Mission state remains authoritative if the ledger file is temporarily unavailable.
  }
  const record: MissionRunRecord = {
    missionId,
    sessionKey: request.sessionKey,
    agentId: request.agentId,
    workspaceId: request.workspaceId,
    objective: request.objective,
    acceptance: request.acceptance ?? [],
    status: "idle",
    phase: "intake",
    tick: 0,
    repairTicks: 0,
    maxTicks: positiveInt(request.maxTicks ?? config.maxTicks, 8, 1, 50),
    maxRepairTicks: positiveInt(request.maxRepairTicks ?? config.maxRepairTicks, 3, 0, 20),
    progress: 0,
    evidenceRefs: [],
    risks: [],
    remaining: [],
    metadata: {
      enableSchedule: request.enableSchedule === true,
      taskLedgerSummary: request.taskLedgerSummary,
      taskLedgerRootId,
      memorySummary: request.memorySummary,
      fileHints: request.fileHints ?? [],
      important: request.important ?? false,
      templateId: request.templateId ?? request.teamTemplateId,
      leadRole: request.leadRole ?? request.preferredLeadRole,
    },
    createdAt: now,
    updatedAt: now,
    ticks: [],
  };
  missionLocalControlPlaneConfigs.set(record, cfg);
  emit(record, deps);
  return clone(record);
}

export function getMissionRun(missionId: string, deps: MissionControllerDeps = {}): MissionRunRecord | null {
  const record = (deps.getMission ?? getMissionRunFromStore)(missionId);
  return record ? clone(record) : null;
}

export function getLatestMission(sessionKey: string, deps: MissionControllerDeps = {}): MissionRunRecord | null {
  const record = (deps.getLatestMissionForSession ?? getLatestMissionForSession)(sessionKey);
  return record ? clone(record) : null;
}

export async function runMission(
  request: MissionRunRequest,
  cfg: OpenClawConfig | undefined,
  deps: MissionControllerDeps = {},
): Promise<MissionRunResult> {
  const existing = request.missionId ? (deps.getMission ?? getMissionRunFromStore)(request.missionId) : undefined;
  const mission = existing ?? createMission(request, cfg, deps);
  return tickMission({ missionId: mission.missionId, reason: "manual" }, cfg, deps);
}

export async function tickMission(
  input: MissionTickInput,
  cfg: OpenClawConfig | undefined,
  deps: MissionControllerDeps = {},
): Promise<MissionRunResult> {
  const getMission = deps.getMission ?? getMissionRunFromStore;
  const saveMission = deps.saveMission ?? saveMissionRun;
  const record = getMission(input.missionId);
  if (!record) throw new Error(`unknown mission "${input.missionId}"`);
  missionLocalControlPlaneConfigs.set(record, cfg);
  const config = resolveAgentMissionConfig(cfg, record.agentId);
  const now = deps.now ?? Date.now;
  if (record.status === "paused" || record.status === "cancelled" || terminal(record.status)) {
    return clone(record);
  }
  if (record.tick >= record.maxTicks) {
    record.status = "blocked";
    record.phase = "blocked";
    record.blockedReason = "Mission reached the maximum tick limit.";
    record.lastDecision = "blocked";
    record.completedAt = now();
    emit(record, deps, { blockedReason: record.blockedReason });
    return clone(record);
  }

  const traceRunId = `mission_tick_${record.missionId}_${record.tick + 1}`;
  const recorder = createRoleFirstTrace(record.objective, {
    runId: traceRunId,
    sessionKey: record.sessionKey,
    mode: "mission-loop",
  });
  recorder.recordEvent("mission.tick", "start", {
    attributes: { missionId: record.missionId, nextTick: record.tick + 1 },
  });

  let taskLoopResult: TaskLoopRunResult | undefined;
  try {
    record.tick += 1;
    record.status = "running";
    record.phase = "context_pack";
    emit(record, deps);

    const contextPack = buildMissionContextPack({
      missionId: record.missionId,
      objective: record.objective,
      acceptance: record.acceptance,
      tick: record.tick,
      taskLedgerSummary: input.taskLedgerSummary ?? String(record.metadata?.taskLedgerSummary ?? ""),
      checkpointSummary: checkpointSummary(record.sessionKey),
      previousReviewerSummary: record.lastReviewerSummary,
      memorySummary: input.memorySummary ?? String(record.metadata?.memorySummary ?? ""),
      evidenceRefs: record.evidenceRefs,
      openBlockers: input.openBlockers,
      reviewItems: input.reviewItems,
      repairBrief: input.repairBrief,
      controlSignals: record.controlSignals,
      validationState: record.validationState,
      acceptanceStatus: record.acceptanceStatus,
      scopeSummary: record.lastReason,
    });
    recorder.recordEvent("mission.context_pack", contextPack.hash, {
      attributes: { missionId: record.missionId, tick: record.tick },
    });

    record.phase = "preflight";
    emit(record, deps);

    record.phase = "execute";
    emit(record, deps);
    const shouldRunRepairTask = Boolean(input.repairBrief) || record.lastDecision === "repair";
    const taskRequest: TaskLoopRunRequest = {
      task: shouldRunRepairTask
        ? input.repairBrief || record.lastReason || record.objective
        : record.objective,
      sessionKey: record.sessionKey,
      agentId: record.agentId,
      workspaceId: record.workspaceId,
      taskLedgerRootId: typeof record.metadata?.taskLedgerRootId === "string"
        ? record.metadata.taskLedgerRootId
        : undefined,
      acceptance: record.acceptance,
      fileHints: Array.isArray(record.metadata?.fileHints) ? record.metadata.fileHints as string[] : [],
      important: record.metadata?.important === true,
      templateId: typeof record.metadata?.templateId === "string" ? record.metadata.templateId : undefined,
      leadRole: typeof record.metadata?.leadRole === "string" ? record.metadata.leadRole : undefined,
    };
    taskLoopResult = await (deps.runTaskLoop ?? runTaskLoop)(
      taskRequest,
      withInnerTaskLoopConfig(cfg, config),
      deps.taskLoopDeps,
    );
    record.taskLoopRunId = taskLoopResult.loopRunId;
    record.traceId = taskLoopResult.traceId;
    record.evidenceRefs = evidenceFromTaskLoop(taskLoopResult);
    record.risks = taskLoopResult.risks;
    record.remaining = taskLoopResult.remaining;

    record.phase = "collect_evidence";
    emit(record, deps, { taskLoopRunId: record.taskLoopRunId, traceId: record.traceId });

    record.phase = "reflect";
    emit(record, deps);

    // A3 Round 2 wiring (Stage 1 Stream 1B acceptance 1.8):
    // Flag-gated seam — when `runtime.resilience.anomalyClassifierPilot !== 'shadow'`,
    // returns `undefined` and `anomalyPattern` stays undefined (flag-off parity).
    // When 'shadow', classifies recent signals into an advisory AnomalyPattern.
    const failures = taskLoopResult.status === "error" ? [taskLoopResult.error ?? "task_loop error"] : [];
    const anomalyPattern = resolveAnomalyPatternForReviewer(cfg?.runtime, {
      tick: record.tick,
      repairTicksUsed: record.repairTicks,
      maxRepairTicks: record.maxRepairTicks,
      maxTicks: record.maxTicks,
      failures,
      // previousNoProgressHash comes from the prior tick's hash on the record.
      previousNoProgressHash: record.noProgressHash,
      // noProgressHash for the current tick is computed AFTER the reviewer runs
      // (line ~930: buildNoProgressHash). At classification time we don't have
      // the current hash yet, so we omit it; classifier relies on the other signals.
    });

    const rawReviewer = await (deps.reviewer ?? runMissionReviewer)({
      cfg,
      agentId: record.agentId,
      reviewer: config.reviewer,
      contextPack: buildMissionContextPack({
        missionId: record.missionId,
        objective: record.objective,
        acceptance: record.acceptance,
        tick: record.tick,
        taskLedgerSummary: input.taskLedgerSummary ?? String(record.metadata?.taskLedgerSummary ?? ""),
        checkpointSummary: checkpointSummary(record.sessionKey),
        previousReviewerSummary: record.lastReviewerSummary,
        memorySummary: input.memorySummary ?? String(record.metadata?.memorySummary ?? ""),
        evidenceRefs: record.evidenceRefs,
        openBlockers: input.openBlockers,
        reviewItems: input.reviewItems,
        repairBrief: input.repairBrief,
        controlSignals: record.controlSignals,
        validationState: record.validationState,
        acceptanceStatus: record.acceptanceStatus,
        scopeSummary: record.lastReason,
      }),
      taskLoopResult,
      failures,
      tick: record.tick,
      repairTicksUsed: record.repairTicks,
      maxRepairTicks: record.maxRepairTicks,
      maxTicks: record.maxTicks,
      ...(anomalyPattern != null ? { anomalyPattern } : {}),
    }, deps.reviewerDeps);
    let reviewer = gateMissionReviewerCompletion(rawReviewer, record);

    const noProgressHash = buildNoProgressHash(reviewer.decision, reviewer.repairBrief, record.evidenceRefs);
    const repeatedRepair = reviewer.decision === "repair" && record.noProgressHash === noProgressHash;
    record.noProgressHash = noProgressHash;
    record.lastDecision = reviewer.decision;
    record.lastReason = reviewer.reason;
    record.lastReviewerSummary = reviewer.checkpointSummary;
    record.risks = reviewer.risks;
    record.remaining = [...reviewer.missingEvidence, ...reviewer.verificationGaps];
    record.controlSignals = reviewer.controlSignals;
    record.validationState = reviewer.validationState;
    record.acceptanceStatus = reviewer.acceptanceStatus;

    // Guardian circuit breaker (P2-7)：连续 blocking ≥3 或 50 次内 ≥10 →
    // 强制 blocked + audit_fail checkpoint，停止 mission tick 循环。
    const guardianOutcome = getSessionGuardianCircuitBreaker(record.sessionKey).record(
      record.controlSignals,
    );
    if (guardianOutcome === "trip") {
      record.guardianTripped = true;
      reviewer = { ...reviewer, decision: "blocked" as const };
      record.lastDecision = "blocked";
      record.lastReason =
        "Mission interrupted by the guardian circuit breaker after repeated blocking control signals.";
    }

    record.phase = "memory_propose";
    emit(record, deps, {
      reviewerDecision: reviewer.decision,
      controlSignals: reviewer.controlSignals,
      validationState: reviewer.validationState,
    });
    const proposedMemory = config.memory?.proposeAfterTick === false
      ? 0
      : proposeMemoryCandidates(record, reviewer.memoryCandidates, deps);
    const proposedExtracted = config.memory?.proposeAfterTick === false
      ? 0
      : proposeExtractedMemoryCandidates(record, deps);
    const proposedKnowledge = proposeKnowledgeInboxCandidates(record, reviewer, deps, repeatedRepair);
    recorder.recordEvent("mission.memory_propose", String(proposedMemory + proposedExtracted), {
      attributes: { missionId: record.missionId, proposedMemory, proposedExtracted, proposedKnowledge },
    });

    record.phase = "checkpoint";
    emit(record, deps, {
      reviewerDecision: reviewer.decision,
      controlSignals: reviewer.controlSignals,
      validationState: reviewer.validationState,
    });
    const journalSeq = deps.journalSeqBoundary?.();
    const checkpoint = buildRuntimeResumeCheckpoint({
      id: `mission:${record.missionId}:tick:${record.tick}`,
      sessionKey: record.sessionKey,
      agentId: record.agentId,
      workspaceId: record.workspaceId ?? undefined,
      taskLedgerRootId: typeof record.metadata?.taskLedgerRootId === "string"
        ? record.metadata.taskLedgerRootId
        : undefined,
      trigger:
        record.guardianTripped === true
          ? "audit_fail"
          : reviewer.decision === "blocked" || reviewer.decision === "ask_user"
            ? "manual_review"
            : "guide",
      activeTask: record.objective,
      nextAction: reviewer.decision,
      reviewNeededItems: reviewer.decision === "ask_user" ? reviewer.missingEvidence : [],
      evidenceRefs: record.evidenceRefs.map((ref) => ({ type: ref.type, ref: ref.ref, label: ref.label })),
      controlSignals: reviewer.controlSignals,
      validationState: reviewer.validationState,
      acceptanceStatus: reviewer.acceptanceStatus,
      metadata: {
        missionId: record.missionId,
        taskLedgerRootId: record.metadata?.taskLedgerRootId,
        tick: record.tick,
        reviewer,
        ...(journalSeq !== undefined ? { journalSeq } : {}),
      },
      createdAt: now(),
    });
    recordLongTaskCheckpoint({
      id: checkpoint.id,
      idempotencyKey: `mission:${record.missionId}:tick:${record.tick}`,
      sessionKey: record.sessionKey,
      agentId: record.agentId,
      workspaceId: record.workspaceId ?? undefined,
      taskLedgerRootId: typeof record.metadata?.taskLedgerRootId === "string"
        ? record.metadata.taskLedgerRootId
        : undefined,
      runId: record.missionId,
      traceId: record.traceId,
      trigger: checkpoint.trigger,
      status: reviewer.decision,
      checkpoint,
      controlSignals: reviewer.controlSignals,
      validationState: reviewer.validationState,
      acceptanceStatus: reviewer.acceptanceStatus,
    });

    if (repeatedRepair) {
      const rollbackEnabled = cfg?.runtime?.mission?.rollback?.enabled === true;
      if (rollbackEnabled && deps.rollback) {
        // A3: repeated repair without progress — attempt checkpoint rollback
        // before blocking. Only the legacy checkpoint target is used (event-log
        // replay is not implemented); the authority enforces decision shape and
        // records the outcome through deps.rollback.recordOutcome.
        // A3: roll back to the PREVIOUS tick's checkpoint. The most recent
        // checkpoint was just written at the end of THIS tick (createdAt≈now),
        // so its journal seq boundary covers nothing — rolling back to it
        // would report success while undoing zero writes. The previous
        // checkpoint's seq boundary is before this tick's writes, which is
        // exactly the state to restore.
        const checkpoints = listLongTaskCheckpoints(record.sessionKey, 2);
        const checkpoint = checkpoints.length >= 2 ? checkpoints[1] : undefined;
        const rollbackDecision = {
          decision: "repair" as const,
          repairStrategy: "replay_rollback" as const,
          reason: record.blockedReason ?? "Mission blocked because repair evidence repeated without progress.",
          requestedAtTick: record.tick,
        };
        const rollbackResult = checkpoint
          ? await executeReplayRollback(
              rollbackDecision,
              { enabled: false, reason: "event-log replay not implemented; legacy checkpoint fallback" },
              { kind: "checkpoint", checkpointId: checkpoint.id },
              deps.rollback,
            )
          : undefined;
        if (rollbackResult?.ok) {
          // Rollback succeeded: record the event, clear the no-progress latch
          // so the next repair tick may make progress, and keep the mission
          // sleeping (not blocked) for another tick.
          recorder.recordEvent("mission.rollback", "ok", {
            attributes: {
              missionId: record.missionId,
              tick: record.tick,
              rolledBackTo: rollbackResult.rolledBackTo,
              mode: rollbackResult.mode,
              evidenceSummary: rollbackResult.evidenceSummary,
            },
          });
          record.noProgressHash = undefined;
          record.lastDecision = "repair";
          record.phase = "schedule";
          record.status = "sleeping";
          record.nextWakeAt = reviewer.nextTick?.afterMs ? now() + reviewer.nextTick.afterMs : now() + 60_000;
        } else {
          // Rollback unavailable/failed: preserve the legacy blocked outcome.
          record.status = "blocked";
          record.phase = "blocked";
          record.blockedReason = `Mission blocked because repair evidence repeated without progress${
            rollbackResult ? `; rollback failed: ${rollbackResult.reason} (${rollbackResult.detail})` : "; no checkpoint available for rollback"
          }.`;
          record.lastDecision = "blocked";
          record.completedAt = now();
          recorder.recordEvent("mission.rollback", "failed", {
            attributes: {
              missionId: record.missionId,
              tick: record.tick,
              reason: rollbackResult?.reason ?? "no_checkpoint",
            },
          });
        }
      } else {
        record.status = "blocked";
        record.phase = "blocked";
        record.blockedReason = "Mission blocked because repair evidence repeated without progress.";
        record.lastDecision = "blocked";
        record.completedAt = now();
      }
    } else if (reviewer.decision === "complete") {
      record.status = "complete";
      record.phase = "complete";
      record.completedAt = now();
    } else if (reviewer.decision === "blocked") {
      record.status = "blocked";
      record.phase = "blocked";
      record.blockedReason = reviewer.reason || "Mission reviewer blocked the run.";
      record.completedAt = now();
    } else if (reviewer.decision === "ask_user") {
      record.status = "ask_user";
      record.phase = "ask_user";
      record.blockedReason = reviewer.reason || "Mission requires user input.";
    } else if (reviewer.decision === "sleep") {
      record.status = "sleeping";
      record.phase = "schedule";
      record.nextWakeAt = reviewer.nextTick?.afterMs ? now() + reviewer.nextTick.afterMs : undefined;
    } else {
      record.repairTicks += reviewer.decision === "repair" ? 1 : 0;
      record.status = record.tick >= record.maxTicks ? "blocked" : "sleeping";
      record.phase = record.status === "blocked" ? "blocked" : "schedule";
      record.blockedReason = record.status === "blocked" ? "Mission reached the maximum tick limit." : undefined;
      record.nextWakeAt = reviewer.nextTick?.afterMs ? now() + reviewer.nextTick.afterMs : undefined;
    }
    if (record.phase === "schedule") {
      recorder.recordEvent("mission.schedule", record.status, {
        attributes: {
          missionId: record.missionId,
          tick: record.tick,
          nextWakeAt: record.nextWakeAt,
          decision: reviewer.decision,
          enableSchedule: record.metadata?.enableSchedule === true,
        },
      });
    }

    record.ticks.push({
      tick: record.tick,
      phase: record.phase,
      status: record.status,
      decision: record.lastDecision,
      taskLoopRunId: record.taskLoopRunId,
      traceId: record.traceId,
      evidenceRefs: [...record.evidenceRefs],
      reviewer,
      controlSignals: reviewer.controlSignals,
      validationState: reviewer.validationState,
      createdAt: now(),
      updatedAt: now(),
    });
    emit(record, deps, {
      reviewerDecision: record.lastDecision,
      controlSignals: record.controlSignals,
      validationState: record.validationState,
    });

    recorder.recordEvent("mission.reflect", reviewer.decision, {
      attributes: { missionId: record.missionId, confidence: reviewer.confidence, risks: reviewer.risks },
    });
    const { trace, scorecard } = completeObservedRun(
      recorder as ObservabilityTraceRecorder,
      record.status === "blocked" ? "aborted" : "completed",
      record.blockedReason,
    );
    record.traceId = trace.id;
    (deps.storeTrace ?? storeRuntimeTrace)(trace, scorecard);
    saveMission(record);
    emit(record, deps, {
      traceId: record.traceId,
      reviewerDecision: record.lastDecision,
      controlSignals: record.controlSignals,
      validationState: record.validationState,
    });
    return clone(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record.status = "error";
    record.phase = "blocked";
    record.blockedReason = message;
    record.completedAt = now();
    emit(record, deps, { error: message });
    const { trace, scorecard } = completeObservedRun(recorder, "error", message);
    record.traceId = trace.id;
    (deps.storeTrace ?? storeRuntimeTrace)(trace, scorecard);
    saveMission(record);
    return clone(record);
  }
}

export function pauseMission(missionId: string, deps: MissionControllerDeps = {}): MissionRunRecord {
  const record = (deps.getMission ?? getMissionRunFromStore)(missionId);
  if (!record) throw new Error(`unknown mission "${missionId}"`);
  if (!terminal(record.status)) {
    record.status = "paused";
    record.phase = "schedule";
    emit(record, deps);
  }
  return clone(record);
}

export function resumeMission(missionId: string, deps: MissionControllerDeps = {}): MissionRunRecord {
  const record = (deps.getMission ?? getMissionRunFromStore)(missionId);
  if (!record) throw new Error(`unknown mission "${missionId}"`);
  if (record.status === "paused") {
    record.status = "sleeping";
    record.phase = "schedule";
    emit(record, deps);
  }
  return clone(record);
}

export function cancelMission(missionId: string, deps: MissionControllerDeps = {}): MissionRunRecord {
  const record = (deps.getMission ?? getMissionRunFromStore)(missionId);
  if (!record) throw new Error(`unknown mission "${missionId}"`);
  if (!terminal(record.status)) {
    record.status = "cancelled";
    record.phase = "blocked";
    record.completedAt = deps.now?.() ?? Date.now();
    emit(record, deps);
  }
  return clone(record);
}
