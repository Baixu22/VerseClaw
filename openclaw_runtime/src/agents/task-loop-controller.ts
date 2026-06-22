import crypto from "node:crypto";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { AgentConfig } from "../config/types.agents.js";
import { DEFAULT_SUBAGENT_MAX_CHILDREN_PER_AGENT } from "../config/agent-limits.js";
import { storeRuntimeTrace } from "../observability/trace-buffer.js";
import { createRoleFirstTrace, completeObservedRun } from "../observability/role-first-observer.js";
import type { ObservabilityTraceRecorder } from "../observability/trace-recorder.js";
import type {
  ObservedOrchestrationRunRequest,
  OrchestrationLifecycleEvent,
  OrchestrationRunResult,
} from "./orchestrator-run-observed.js";
import { listRoleContracts } from "./role-registry.js";
import type { RoleSpawnContext, SpawnFn } from "./role-spawn.js";
import { buildTaskLoopContextPack, type TaskLoopEvidenceRef } from "./task-loop-context.js";
import {
  defaultQualityAssessments,
  deriveValidationState,
  hasBlockingControlSignal,
  normalizeControlSignals,
  signalsFromGaps,
} from "./long-conversation-control-signals.js";
import {
  hashTaskLoopRepairInput,
  runTaskLoopSelfCheck,
  type TaskLoopReviewerConfig,
  type TaskLoopSelfCheckDeps,
  type TaskLoopSelfCheckResult,
} from "./task-loop-self-check.js";

export type TaskLoopPhase =
  | "intake"
  | "plan"
  | "execute"
  | "collect_evidence"
  | "self_check"
  | "repair"
  | "verify"
  | "blocked"
  | "complete"
  | "error";

export type TaskLoopStatus = "running" | "complete" | "blocked" | "error";

export type TaskLoopConfig = {
  enabled?: boolean;
  maxIterations?: number;
  maxRepairIterations?: number;
  defaultTemplateId?: string;
  includeVerifier?: boolean;
  reviewer?: TaskLoopReviewerConfig;
};

export type TaskLoopRunRequest = {
  task: string;
  sessionKey: string;
  agentId?: string;
  fileHints?: string[];
  important?: boolean;
  templateId?: string;
  teamTemplateId?: string;
  leadRole?: string;
  preferredLeadRole?: string;
  maxWorkers?: number;
  includeVerifier?: boolean;
  acceptance?: string[];
};

export type TaskLoopLifecycleEvent = {
  loopRunId: string;
  sessionKey: string;
  phase: TaskLoopPhase;
  status: TaskLoopStatus;
  iteration: number;
  progress: number;
  orchestrationRunId?: string;
  activeRoles?: string[];
  selfCheckDecision?: TaskLoopSelfCheckResult["decision"];
  controlSignals?: TaskLoopSelfCheckResult["controlSignals"];
  validationState?: TaskLoopSelfCheckResult["validationState"];
  error?: string;
  ts: number;
};

export type TaskLoopIterationSnapshot = {
  iteration: number;
  phase: TaskLoopPhase;
  status: TaskLoopStatus;
  orchestrationRunId?: string;
  evidenceRefs: TaskLoopEvidenceRef[];
  risks: string[];
  remaining: string[];
  nextActions: string[];
  controlSignals?: TaskLoopSelfCheckResult["controlSignals"];
  validationState?: TaskLoopSelfCheckResult["validationState"];
  selfCheck?: TaskLoopSelfCheckResult;
};

export type TaskLoopRunRecord = {
  loopRunId: string;
  sessionKey: string;
  task: string;
  status: TaskLoopStatus;
  phase: TaskLoopPhase;
  iteration: number;
  maxIterations: number;
  maxRepairIterations: number;
  orchestrationRunIds: string[];
  evidenceRefs: TaskLoopEvidenceRef[];
  risks: string[];
  remaining: string[];
  nextActions: string[];
  controlSignals?: TaskLoopSelfCheckResult["controlSignals"];
  validationState?: TaskLoopSelfCheckResult["validationState"];
  finalSummary?: string;
  traceId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  iterations: TaskLoopIterationSnapshot[];
};

export type TaskLoopRunResult = TaskLoopRunRecord;

export type TaskLoopControllerDeps = {
  idFactory?: (prefix: string) => string;
  now?: () => number;
  spawn?: SpawnFn;
  runObserved?: RunObservedFn;
  selfCheck?: typeof runTaskLoopSelfCheck;
  selfCheckDeps?: TaskLoopSelfCheckDeps;
  lifecycle?: (event: TaskLoopLifecycleEvent) => void;
  orchestrationLifecycle?: (event: OrchestrationLifecycleEvent, loop: TaskLoopRunRecord) => void;
  storeTrace?: typeof storeRuntimeTrace;
};

export type RunObservedFn = (
  request: ObservedOrchestrationRunRequest,
  ctx: RoleSpawnContext,
  deps: { spawn: SpawnFn },
  traceAttrs?: { runId?: string; sessionKey?: string },
  lifecycle?: (event: OrchestrationLifecycleEvent) => void,
) => Promise<OrchestrationRunResult>;

const taskLoopRuns = new Map<string, TaskLoopRunRecord>();

function defaultId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function positiveInt(value: unknown, fallback: number, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function resolveAgentTaskLoopConfig(cfg: OpenClawConfig | undefined, agentId?: string): TaskLoopConfig {
  const defaults = cfg?.agents?.defaults?.taskLoop ?? {};
  const agent = cfg?.agents?.list?.find((entry: AgentConfig) => entry.id === agentId);
  return { ...defaults, ...(agent?.taskLoop ?? {}) };
}

function rolesConfig(cfg: OpenClawConfig): { agents?: { roles?: unknown; teams?: unknown } } {
  return cfg as unknown as { agents?: { roles?: unknown; teams?: unknown } };
}

function inferTemplateId(request: TaskLoopRunRequest, config: TaskLoopConfig): string {
  const explicit = request.templateId?.trim() || request.teamTemplateId?.trim();
  if (explicit) return explicit;
  const task = request.task.toLowerCase();
  if (/\b(security|permission|auth|secret|token|network|sandbox|policy|credential)\b/u.test(task)) {
    return "security-audit";
  }
  return config.defaultTemplateId?.trim() || "quick-development";
}

function resolveMaxWorkers(request: TaskLoopRunRequest, cfg: OpenClawConfig | undefined): number {
  const configured = cfg?.agents?.defaults?.subagents?.maxChildrenPerAgent ?? DEFAULT_SUBAGENT_MAX_CHILDREN_PER_AGENT;
  const requested = positiveInt(request.maxWorkers, 4, 1, 20);
  return Math.max(1, Math.min(configured, requested));
}

function summarizePlan(result: OrchestrationRunResult): string {
  return [
    `mode=${result.plan.mode}`,
    `lead=${result.plan.leadRole}`,
    `template=${result.plan.templateId ?? "auto"}`,
    `workers=${result.plan.workers.map((worker) => worker.roleName).join(", ") || "none"}`,
    `verifier=${result.plan.verifierRole ?? "none"}`,
  ].join("; ");
}

function evidenceFromResult(result: OrchestrationRunResult, orchestrationRunId: string): TaskLoopEvidenceRef[] {
  const refs: TaskLoopEvidenceRef[] = [
    {
      type: "trace",
      ref: orchestrationRunId,
      label: "orchestration run",
      summary: summarizePlan(result),
    },
  ];
  for (const outcome of result.outcomes) {
    refs.push({
      type: "subagent",
      ref: outcome.spawn.result?.runId ?? `${orchestrationRunId}:${outcome.roleName}`,
      label: outcome.roleName,
      summary: [
        `role=${outcome.roleName}`,
        `phase=${outcome.isVerifier ? "verifier" : "worker"}`,
        `status=${outcome.spawn.status}`,
        outcome.spawn.result?.childSessionKey ? `childSessionKey=${outcome.spawn.result.childSessionKey}` : "",
        outcome.spawn.error ?? outcome.spawn.result?.error ?? "",
      ].filter(Boolean).join("; "),
    });
  }
  return refs;
}

function failuresFromResult(result: OrchestrationRunResult): string[] {
  return result.failures.map((failure) =>
    `${failure.roleName}: ${failure.status}${failure.error ? ` - ${failure.error}` : ""}`,
  );
}

function progressForPhase(phase: TaskLoopPhase, iteration: number, maxIterations: number): number {
  const phaseWeight: Record<TaskLoopPhase, number> = {
    intake: 5,
    plan: 12,
    execute: 35,
    collect_evidence: 55,
    self_check: 72,
    repair: 82,
    verify: 90,
    blocked: 100,
    complete: 100,
    error: 100,
  };
  const iterationOffset = ((iteration - 1) / Math.max(1, maxIterations)) * 20;
  return Math.min(100, Math.round(phaseWeight[phase] + iterationOffset));
}

function emit(
  record: TaskLoopRunRecord,
  deps: TaskLoopControllerDeps,
  patch: Partial<TaskLoopLifecycleEvent>,
): void {
  record.updatedAt = deps.now?.() ?? Date.now();
  deps.lifecycle?.({
    loopRunId: record.loopRunId,
    sessionKey: record.sessionKey,
    phase: record.phase,
    status: record.status,
    iteration: record.iteration,
    progress: progressForPhase(record.phase, Math.max(1, record.iteration), record.maxIterations),
    controlSignals: record.controlSignals,
    validationState: record.validationState,
    ts: record.updatedAt,
    ...patch,
  });
}

function snapshot(record: TaskLoopRunRecord, selfCheck?: TaskLoopSelfCheckResult): void {
  record.iterations.push({
    iteration: record.iteration,
    phase: record.phase,
    status: record.status,
    orchestrationRunId: record.orchestrationRunIds.at(-1),
    evidenceRefs: [...record.evidenceRefs],
    risks: [...record.risks],
    remaining: [...record.remaining],
    nextActions: [...record.nextActions],
    ...(record.controlSignals ? { controlSignals: [...record.controlSignals] } : {}),
    ...(record.validationState ? { validationState: record.validationState } : {}),
    ...(selfCheck ? { selfCheck } : {}),
  });
}

function buildRepairTask(originalTask: string, selfCheck: TaskLoopSelfCheckResult): string {
  return [
    "Repair the previous task-loop iteration.",
    `Original task: ${originalTask}`,
    selfCheck.repairBrief ? `Repair brief: ${selfCheck.repairBrief}` : "",
    selfCheck.missingEvidence.length ? `Missing evidence: ${selfCheck.missingEvidence.join("; ")}` : "",
    selfCheck.verificationGaps.length ? `Verification gaps: ${selfCheck.verificationGaps.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

function selfCheckHasOpenControlSignals(selfCheck: TaskLoopSelfCheckResult): boolean {
  return selfCheck.missingEvidence.length > 0
    || selfCheck.verificationGaps.length > 0
    || hasBlockingControlSignal(selfCheck.controlSignals)
    || selfCheck.validationState?.status === "failed"
    || selfCheck.validationState?.status === "missing"
    || selfCheck.validationState?.status === "partial"
    || selfCheck.validationState?.status === "not_run"
    || selfCheck.acceptanceStatus?.status === "missing"
    || selfCheck.acceptanceStatus?.status === "partial"
    || selfCheck.acceptanceStatus?.status === "changed";
}

function gateTaskLoopSelfCheckCompletion(
  selfCheck: TaskLoopSelfCheckResult,
  repairIterations: number,
  maxRepairIterations: number,
): TaskLoopSelfCheckResult {
  if (selfCheck.decision !== "complete" || !selfCheckHasOpenControlSignals(selfCheck)) {
    return selfCheck;
  }
  const canRepair = repairIterations < maxRepairIterations;
  const missingEvidence = selfCheck.missingEvidence.length
    ? selfCheck.missingEvidence
    : ["Task-loop completion had unresolved control signals."];
  const verificationGaps = selfCheck.verificationGaps.length
    ? selfCheck.verificationGaps
    : ["Task-loop validation or acceptance evidence is missing."];
  const controlSignals = normalizeControlSignals([
    ...(selfCheck.controlSignals ?? []),
    ...signalsFromGaps({
      missingEvidence,
      verificationGaps,
      risks: selfCheck.risks,
      source: "task_loop.controller",
      repairable: canRepair,
    }),
  ]);
  const validationState = selfCheck.validationState ?? deriveValidationState({
    status: "missing",
    gaps: verificationGaps,
  });
  return {
    ...selfCheck,
    decision: canRepair ? "repair" : "blocked",
    confidence: Math.min(selfCheck.confidence, canRepair ? 0.55 : 0.4),
    missingEvidence,
    verificationGaps,
    repairBrief: canRepair
      ? selfCheck.repairBrief ?? `Resolve task-loop completion gaps: ${[...missingEvidence, ...verificationGaps].join("; ")}`
      : undefined,
    controlSignals,
    validationState,
    quality: defaultQualityAssessments({ signals: controlSignals, validationState }),
    contextSummary: selfCheck.contextSummary || "Task-loop completion was downgraded because control signals remained open.",
  };
}

export function getTaskLoopRun(loopRunId: string): TaskLoopRunRecord | null {
  return taskLoopRuns.get(loopRunId) ?? null;
}

export function clearTaskLoopRunsForTests(): void {
  taskLoopRuns.clear();
}

export async function runTaskLoop(
  request: TaskLoopRunRequest,
  cfg: OpenClawConfig | undefined,
  deps: TaskLoopControllerDeps = {},
): Promise<TaskLoopRunResult> {
  const now = deps.now ?? Date.now;
  const idFactory = deps.idFactory ?? defaultId;
  const config = resolveAgentTaskLoopConfig(cfg, request.agentId);
  if (config.enabled === false) {
    throw new Error("task loop is disabled by configuration");
  }
  const maxIterations = positiveInt(config.maxIterations, 3, 1, 10);
  const maxRepairIterations = positiveInt(config.maxRepairIterations, 2, 0, maxIterations);
  const loopRunId = idFactory("loop");
  const record: TaskLoopRunRecord = {
    loopRunId,
    sessionKey: request.sessionKey,
    task: request.task,
    status: "running",
    phase: "intake",
    iteration: 0,
    maxIterations,
    maxRepairIterations,
    orchestrationRunIds: [],
    evidenceRefs: [],
    risks: [],
    remaining: [],
    nextActions: [],
    createdAt: now(),
    updatedAt: now(),
    iterations: [],
  };
  taskLoopRuns.set(loopRunId, record);

  const recorder = createRoleFirstTrace(request.task, {
    runId: loopRunId,
    sessionKey: request.sessionKey,
    mode: "task-loop",
  });
  recorder.recordEvent("task_loop.phase", "intake", { attributes: { loopRunId } });
  emit(record, deps, {});

  let repairBrief = "";
  let previousContextSummary = "";
  let repairIterations = 0;
  let previousRepairHash = "";

  try {
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      record.iteration = iteration;
      record.phase = "plan";
      emit(record, deps, {});

      const orchestrationRunId = idFactory("orch");
      const loopTask = repairBrief || request.task;
      const templateId = repairBrief ? request.templateId?.trim() || "quick-development" : inferTemplateId(request, config);
      const span = recorder.startSpan({
        name: `task-loop:${iteration}`,
        kind: "orchestrator",
        input: loopTask,
        attributes: { loopRunId, iteration, templateId },
      });

      record.phase = "execute";
      record.orchestrationRunIds.push(orchestrationRunId);
      emit(record, deps, { orchestrationRunId });
      const runRequest: ObservedOrchestrationRunRequest = {
        task: loopTask,
        fileHints: request.fileHints,
        important: request.important ?? false,
        includeVerifier: request.includeVerifier ?? config.includeVerifier ?? true,
        templateId,
        maxWorkers: resolveMaxWorkers(request, cfg),
        cfg: cfg ? rolesConfig(cfg) : undefined,
        roles: cfg ? listRoleContracts(rolesConfig(cfg)) : undefined,
        preferredLeadRole: request.leadRole ?? request.preferredLeadRole,
        agentId: request.agentId,
        orchestrationRunId,
        patchRegistryMetadata: true,
      };
      const ctx: RoleSpawnContext = {
        agentSessionKey: request.sessionKey,
        ...(request.agentId ? { requesterAgentIdOverride: request.agentId } : {}),
      };
      const runObserved = deps.runObserved
        ?? (await import("./orchestrator-run-observed.js")).runOrchestrationObserved;
      const spawn = deps.spawn
        ?? (deps.runObserved
          ? (async () => {
              throw new Error("task-loop injected runObserved attempted to call missing spawn dependency");
            }) as SpawnFn
          : (await import("./subagent-spawn.js")).spawnSubagentDirect);
      const result = await runObserved(
        runRequest,
        ctx,
        { spawn },
        { sessionKey: request.sessionKey, runId: orchestrationRunId },
        (event) => {
          deps.orchestrationLifecycle?.(event, record);
          emit(record, deps, {
            orchestrationRunId,
            activeRoles: [event.roleName],
          });
        },
      );
      recorder.endSpan(span.id, {
        status: result.failures.length > 0 ? "error" : "completed",
        output: summarizePlan(result),
        metrics: {
          workers: result.plan.workers.length,
          failures: result.failures.length,
        },
        attributes: { orchestrationRunId, plan: result.plan },
        error: result.failures.length ? failuresFromResult(result).join("; ") : undefined,
      });

      record.phase = "collect_evidence";
      record.evidenceRefs = evidenceFromResult(result, orchestrationRunId);
      const failures = failuresFromResult(result);
      emit(record, deps, { orchestrationRunId, activeRoles: result.plan.workers.map((worker) => worker.roleName) });

      record.phase = "self_check";
      emit(record, deps, { orchestrationRunId });
      const contextPack = buildTaskLoopContextPack({
        objective: request.task,
        iteration,
        planSummary: summarizePlan(result),
        previousContextSummary,
        repairBrief,
        acceptance: request.acceptance,
        evidenceRefs: record.evidenceRefs,
        failures,
        controlSignals: record.controlSignals,
        validationState: record.validationState,
      });
      const rawSelfCheck = await (deps.selfCheck ?? runTaskLoopSelfCheck)({
        cfg,
        agentId: request.agentId,
        reviewer: config.reviewer,
        contextPack,
        failures,
        repairIterationsUsed: repairIterations,
        maxRepairIterations,
      }, deps.selfCheckDeps);
      const selfCheck = gateTaskLoopSelfCheckCompletion(rawSelfCheck, repairIterations, maxRepairIterations);
      previousContextSummary = selfCheck.contextSummary;
      record.risks = selfCheck.risks;
      record.remaining = [...selfCheck.missingEvidence, ...selfCheck.verificationGaps];
      record.controlSignals = selfCheck.controlSignals;
      record.validationState = selfCheck.validationState;
      record.nextActions = [];
      emit(record, deps, {
        orchestrationRunId,
        selfCheckDecision: selfCheck.decision,
        controlSignals: selfCheck.controlSignals,
        validationState: selfCheck.validationState,
      });
      recorder.recordEvent("task_loop.self_check", selfCheck.decision, {
        attributes: { loopRunId, iteration, confidence: selfCheck.confidence, risks: selfCheck.risks },
      });

      if (selfCheck.decision === "complete") {
        record.phase = "complete";
        record.status = "complete";
        record.finalSummary = selfCheck.contextSummary || "Task loop completed.";
        record.nextActions = ["synthesize_final_response"];
        snapshot(record, selfCheck);
        emit(record, deps, { orchestrationRunId, selfCheckDecision: "complete" });
        break;
      }

      const canRepair = selfCheck.decision === "repair"
        && repairIterations < maxRepairIterations
        && iteration < maxIterations;
      if (canRepair) {
        const nextRepairBrief = buildRepairTask(request.task, selfCheck);
        const repairHash = hashTaskLoopRepairInput(`${nextRepairBrief}\n${contextPack.evidenceText}`);
        if (repairHash === previousRepairHash) {
          record.phase = "blocked";
          record.status = "blocked";
          record.finalSummary = "Task loop blocked because repair evidence repeated without progress.";
          record.nextActions = ["ask_user_or_manual_review"];
          snapshot(record, selfCheck);
          emit(record, deps, { orchestrationRunId, selfCheckDecision: "blocked" });
          break;
        }
        previousRepairHash = repairHash;
        repairBrief = nextRepairBrief;
        repairIterations += 1;
        record.phase = "repair";
        record.nextActions = ["run_scoped_repair_iteration"];
        snapshot(record, selfCheck);
        emit(record, deps, { orchestrationRunId, selfCheckDecision: "repair" });
        continue;
      }

      record.phase = "blocked";
      record.status = "blocked";
      record.finalSummary = selfCheck.contextSummary || "Task loop blocked before completion.";
      record.nextActions = ["ask_user_or_manual_review"];
      snapshot(record, selfCheck);
      emit(record, deps, { orchestrationRunId, selfCheckDecision: "blocked" });
      break;
    }

    if (record.status === "running") {
      record.phase = "blocked";
      record.status = "blocked";
      record.finalSummary = "Task loop reached the maximum iteration limit.";
      record.nextActions = ["ask_user_or_manual_review"];
      snapshot(record);
      emit(record, deps, { selfCheckDecision: "blocked" });
    }
    const { trace, scorecard } = completeObservedRun(
      recorder as ObservabilityTraceRecorder,
      record.status === "error" ? "error" : record.status === "blocked" ? "aborted" : "completed",
      record.error,
    );
    record.traceId = trace.id;
    (deps.storeTrace ?? storeRuntimeTrace)(trace, scorecard);
    return { ...record, iterations: [...record.iterations], evidenceRefs: [...record.evidenceRefs] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record.phase = "error";
    record.status = "error";
    record.error = message;
    record.finalSummary = `Task loop failed: ${message}`;
    snapshot(record);
    emit(record, deps, { error: message });
    const { trace, scorecard } = completeObservedRun(recorder, "error", message);
    record.traceId = trace.id;
    (deps.storeTrace ?? storeRuntimeTrace)(trace, scorecard);
    return { ...record, iterations: [...record.iterations], evidenceRefs: [...record.evidenceRefs] };
  }
}
