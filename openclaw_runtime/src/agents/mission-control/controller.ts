import crypto, { createHash } from "node:crypto";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { AgentConfig } from "../../config/types.agents.js";
import { storeRuntimeTrace } from "../../observability/trace-buffer.js";
import { createRoleFirstTrace, completeObservedRun } from "../../observability/role-first-observer.js";
import type { ObservabilityTraceRecorder } from "../../observability/trace-recorder.js";
import {
  buildRuntimeResumeCheckpoint,
  getLatestLongTaskCheckpoint,
  recordLongTaskCheckpoint,
} from "../long-task-control/store.js";
import {
  runTaskLoop,
  type TaskLoopControllerDeps,
  type TaskLoopRunRequest,
  type TaskLoopRunResult,
} from "../task-loop-controller.js";
import { proposeMemoryCard } from "../../memory/memory-store.js";
import type { MemoryEvidenceRef, MemoryProposal } from "../../memory/types.js";
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
};

export type MissionRunResult = MissionRunRecord;

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
    ticks: record.ticks.map((tick) => ({
      ...tick,
      evidenceRefs: [...tick.evidenceRefs],
      reviewer: tick.reviewer ? { ...tick.reviewer } : undefined,
    })),
    metadata: { ...(record.metadata ?? {}) },
  };
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
      propose(proposal, { actor: { kind: "system", id: "mission-control" } });
      proposed += 1;
    } catch {
      // Memory proposals are best-effort; Mission state remains authoritative.
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
    const reviewer = await (deps.reviewer ?? runMissionReviewer)({
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
      }),
      taskLoopResult,
      failures: taskLoopResult.status === "error" ? [taskLoopResult.error ?? "task_loop error"] : [],
      tick: record.tick,
      repairTicksUsed: record.repairTicks,
      maxRepairTicks: record.maxRepairTicks,
      maxTicks: record.maxTicks,
    }, deps.reviewerDeps);

    const noProgressHash = buildNoProgressHash(reviewer.decision, reviewer.repairBrief, record.evidenceRefs);
    const repeatedRepair = reviewer.decision === "repair" && record.noProgressHash === noProgressHash;
    record.noProgressHash = noProgressHash;
    record.lastDecision = reviewer.decision;
    record.lastReason = reviewer.reason;
    record.lastReviewerSummary = reviewer.checkpointSummary;
    record.risks = reviewer.risks;
    record.remaining = [...reviewer.missingEvidence, ...reviewer.verificationGaps];

    record.phase = "memory_propose";
    emit(record, deps, { reviewerDecision: reviewer.decision });
    const proposedMemory = config.memory?.proposeAfterTick === false
      ? 0
      : proposeMemoryCandidates(record, reviewer.memoryCandidates, deps);
    recorder.recordEvent("mission.memory_propose", String(proposedMemory), {
      attributes: { missionId: record.missionId, proposedMemory },
    });

    record.phase = "checkpoint";
    emit(record, deps, { reviewerDecision: reviewer.decision });
    const checkpoint = buildRuntimeResumeCheckpoint({
      id: `mission:${record.missionId}:tick:${record.tick}`,
      sessionKey: record.sessionKey,
      agentId: record.agentId,
      workspaceId: record.workspaceId ?? undefined,
      trigger: reviewer.decision === "blocked" || reviewer.decision === "ask_user" ? "manual_review" : "guide",
      activeTask: record.objective,
      nextAction: reviewer.decision,
      reviewNeededItems: reviewer.decision === "ask_user" ? reviewer.missingEvidence : [],
      evidenceRefs: record.evidenceRefs.map((ref) => ({ type: ref.type, ref: ref.ref, label: ref.label })),
      metadata: {
        missionId: record.missionId,
        tick: record.tick,
        reviewer,
      },
      createdAt: now(),
    });
    recordLongTaskCheckpoint({
      id: checkpoint.id,
      idempotencyKey: `mission:${record.missionId}:tick:${record.tick}`,
      sessionKey: record.sessionKey,
      agentId: record.agentId,
      workspaceId: record.workspaceId ?? undefined,
      runId: record.missionId,
      traceId: record.traceId,
      trigger: checkpoint.trigger,
      status: reviewer.decision,
      checkpoint,
    });

    if (repeatedRepair) {
      record.status = "blocked";
      record.phase = "blocked";
      record.blockedReason = "Mission blocked because repair evidence repeated without progress.";
      record.lastDecision = "blocked";
      record.completedAt = now();
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
      createdAt: now(),
      updatedAt: now(),
    });
    emit(record, deps, { reviewerDecision: record.lastDecision });

    recorder.recordEvent("mission.reflect", reviewer.decision, {
      attributes: { missionId: record.missionId, confidence: reviewer.confidence, risks: reviewer.risks },
    });
    const { trace, scorecard } = completeObservedRun(
      recorder as ObservabilityTraceRecorder,
      record.status === "error" ? "error" : record.status === "blocked" || record.status === "cancelled" ? "aborted" : "completed",
      record.blockedReason,
    );
    record.traceId = trace.id;
    (deps.storeTrace ?? storeRuntimeTrace)(trace, scorecard);
    saveMission(record);
    emit(record, deps, { traceId: record.traceId, reviewerDecision: record.lastDecision });
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
