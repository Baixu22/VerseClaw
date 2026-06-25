import crypto from "node:crypto";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { AgentConfig } from "../config/types.agents.js";
import { DEFAULT_SUBAGENT_MAX_CHILDREN_PER_AGENT } from "../config/agent-limits.js";
import { storeRuntimeTrace } from "../observability/trace-buffer.js";
import { createRoleFirstTrace, completeObservedRun } from "../observability/role-first-observer.js";
import type { ObservabilityTraceRecorder } from "../observability/trace-recorder.js";
import {
  resolveRuntimeEventLogFeatureFlags,
  resolveRuntimeRegistryFeatureFlags,
  type EvidenceRef,
  type RuntimeEventLogFeatureFlags,
  type RuntimeRegistryDiagnostic,
  type RuntimeRegistryFeatureFlags,
  type RuntimeCoreJsonObject,
  type RuntimeCoreJsonValue,
  type RuntimeTaskEventLogAppendOptions,
  type RuntimeTaskEventLogAppendResult,
  type RuntimeTaskEvent,
  type RuntimeTaskStatus,
} from "../runtime-core/index.js";
import type {
  ObservedOrchestrationRunRequest,
  OrchestrationLifecycleEvent,
  OrchestrationWorkerOutcome,
  OrchestrationRunResult,
} from "./orchestrator-run-observed.js";
import { listRoleContracts } from "./role-registry.js";
import type { RoleSpawnContext, SpawnFn } from "./role-spawn.js";
import {
  buildTaskLoopContextPack,
  type TaskLoopEvidenceRef,
  type TaskLoopSubagentEvidenceForContext,
} from "./task-loop-context.js";
import {
  defaultQualityAssessments,
  deriveValidationState,
  type LongConversationControlSignal,
  hasBlockingControlSignal,
  normalizeControlSignals,
  signalsFromGaps,
} from "./long-conversation-control-signals.js";
import {
  extractFollowupCandidates,
  scoreWorkerQuality,
  type WorkerQualityScore,
} from "./orchestration-protocol.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";
import {
  buildRuntimeCoreCheckpointFromResumeCheckpoint,
  runtimeEvidenceRefsFromResumeCheckpoint,
  type RuntimeResumeCheckpoint,
} from "./long-task-control/store.js";
import {
  ensureLongTaskLedgerRoot,
  type LongTaskLedgerRootInput,
} from "./long-task-control/task-ledger.js";
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
  runtimeTaskEventLogShadow?: boolean;
  runtimeCoreShadow?: boolean;
  reviewer?: TaskLoopReviewerConfig;
};

export type TaskLoopRuntimeEventShadowSink = (event: RuntimeTaskEvent) => void;
export type TaskLoopRuntimeTaskEventLogWriter = (
  event: RuntimeTaskEvent,
  options?: RuntimeTaskEventLogAppendOptions,
) => RuntimeTaskEventLogAppendResult | void | Promise<RuntimeTaskEventLogAppendResult | void>;
export type TaskLoopRuntimeRegistryDiagnosticsProvider =
  | readonly RuntimeRegistryDiagnostic[]
  | (() => readonly RuntimeRegistryDiagnostic[]);

export type TaskLoopRunRequest = {
  task: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string | null;
  taskLedgerRootId?: string;
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

export type TaskLoopSubagentEvidence = {
  roleName: string;
  phase: "worker" | "verifier";
  taskNodeId?: string;
  executionWave?: number;
  childRunId?: string;
  childSessionKey?: string;
  spawnStatus: "accepted" | "forbidden" | "error" | "timeout";
  completionStatus:
    | "completed"
    | "partial"
    | "failed"
    | "unverifiable"
    | "permission_blocked"
    | "timeout";
  summary: string;
  filesTouched: string[];
  testsRun: string[];
  evidenceRefs: TaskLoopEvidenceRef[];
  decisions: string[];
  risks: string[];
  followupTasks: string[];
  quality: WorkerQualityScore;
  failureReason?: string;
  capturedAt: number;
};

export type TaskLoopEvidenceGateResult = {
  status: "pass" | "repair" | "blocked";
  reasons: string[];
  blockingEvidence: TaskLoopSubagentEvidence[];
  filesTouched: string[];
  testsRun: string[];
};

export type TaskLoopRoleQualitySummary = {
  good: number;
  needsAttention: number;
  poorAttempt: number;
  roles: Array<{
    roleName: string;
    overall: WorkerQualityScore["overall"];
    score: number;
    reasons: string[];
  }>;
};

export type TaskLoopLifecycleEvidenceGateSummary = {
  status: TaskLoopEvidenceGateResult["status"];
  reasons: string[];
  workerCount: number;
  failedWorkerCount: number;
  unverifiableWorkerCount: number;
};

export type TaskLoopEvidenceVerifierShadowReasonCode =
  | "missing_tests"
  | "worker_failure"
  | "permission"
  | "timeout"
  | "unverifiable";

export type TaskLoopEvidenceVerifierShadowReason = {
  code: TaskLoopEvidenceVerifierShadowReasonCode;
  message: string;
  roleName?: string;
  evidenceRefs: EvidenceRef[];
};

export type TaskLoopEvidenceVerifierShadowReport = {
  schemaVersion: 1;
  source: "task_loop.evidence_gate";
  mode: "warning";
  status: "pass" | "warning";
  generatedAt: number;
  legacyGateStatus: TaskLoopEvidenceGateResult["status"];
  legacyGateReasons: string[];
  legacyDecisionUnaffected: true;
  filesTouched: string[];
  testsRun: string[];
  workerCount: number;
  evidenceRefs: EvidenceRef[];
  reasons: TaskLoopEvidenceVerifierShadowReason[];
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
  evidenceGate?: TaskLoopLifecycleEvidenceGateSummary;
  evidenceVerifierReport?: TaskLoopEvidenceVerifierShadowReport;
  roleQualitySummary?: Pick<TaskLoopRoleQualitySummary, "good" | "needsAttention" | "poorAttempt">;
  filesTouched?: string[];
  testsRun?: string[];
  blockedReason?: string;
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
  subagentEvidence: TaskLoopSubagentEvidence[];
  evidenceGate?: TaskLoopEvidenceGateResult;
  evidenceVerifierReport?: TaskLoopEvidenceVerifierShadowReport;
  roleQualitySummary?: TaskLoopRoleQualitySummary;
  selfCheck?: TaskLoopSelfCheckResult;
};

export type TaskLoopRunRecord = {
  loopRunId: string;
  sessionKey: string;
  workspaceId?: string | null;
  task: string;
  taskLedgerRootId?: string;
  status: TaskLoopStatus;
  phase: TaskLoopPhase;
  iteration: number;
  maxIterations: number;
  maxRepairIterations: number;
  orchestrationRunIds: string[];
  evidenceRefs: TaskLoopEvidenceRef[];
  subagentEvidence: TaskLoopSubagentEvidence[];
  evidenceGate?: TaskLoopEvidenceGateResult;
  evidenceVerifierReport?: TaskLoopEvidenceVerifierShadowReport;
  roleQualitySummary: TaskLoopRoleQualitySummary;
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
  getSubagentRun?: (runId?: string, childSessionKey?: string) => SubagentRunRecord | null;
  ensureTaskLedgerRoot?: (input: LongTaskLedgerRootInput) => string | Promise<string>;
  recordCheckpoint?: (input: TaskLoopCheckpointRecordInput) => unknown | Promise<unknown>;
  lifecycle?: (event: TaskLoopLifecycleEvent) => void;
  orchestrationLifecycle?: (event: OrchestrationLifecycleEvent, loop: TaskLoopRunRecord) => void;
  runtimeTaskEventLogShadow?: boolean;
  runtimeCoreShadow?: boolean;
  evidenceVerifierShadow?: boolean;
  runtimeRegistryDiagnostics?: TaskLoopRuntimeRegistryDiagnosticsProvider;
  runtimeTaskEventShadowSink?: TaskLoopRuntimeEventShadowSink;
  runtimeTaskEventLogWriter?: TaskLoopRuntimeTaskEventLogWriter;
  storeTrace?: typeof storeRuntimeTrace;
};

export type TaskLoopCheckpointRecordInput = {
  id?: string;
  idempotencyKey?: string;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string;
  taskLedgerRootId?: string;
  runId?: string;
  traceId?: string;
  trigger: RuntimeResumeCheckpoint["trigger"];
  status?: string;
  checkpoint?: RuntimeResumeCheckpoint;
  activeTask?: string;
  filesTouched?: string[];
  testsRun?: string[];
  nextAction?: string;
  reviewNeededItems?: string[];
  evidenceRefs?: RuntimeResumeCheckpoint["evidenceRefs"];
  controlSignals?: TaskLoopSelfCheckResult["controlSignals"];
  validationState?: TaskLoopSelfCheckResult["validationState"];
  acceptanceStatus?: TaskLoopSelfCheckResult["acceptanceStatus"];
  metadata?: Record<string, unknown>;
};

export type RunObservedFn = (
  request: ObservedOrchestrationRunRequest,
  ctx: RoleSpawnContext,
  deps: { spawn: SpawnFn },
  traceAttrs?: { runId?: string; sessionKey?: string },
  lifecycle?: (event: OrchestrationLifecycleEvent) => void,
) => Promise<OrchestrationRunResult>;

const taskLoopRuns = new Map<string, TaskLoopRunRecord>();
const runtimeEventShadowFlags = new WeakMap<
  TaskLoopRunRecord,
  {
    runtimeTaskEventLogShadow?: boolean;
    runtimeCoreShadow?: boolean;
    evidenceVerifierShadow?: boolean;
    runtimeEventLogFlags: RuntimeEventLogFeatureFlags;
    runtimeRegistryFlags: RuntimeRegistryFeatureFlags;
    runtimeRegistryDiagnostics?: () => readonly RuntimeRegistryDiagnostic[];
  }
>();
const runtimeEventShadowSequences = new WeakMap<TaskLoopRunRecord, number>();

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

function uniqueStrings(values: readonly (string | undefined)[], limit = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = value?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text.slice(0, 1_000));
    if (out.length >= limit) break;
  }
  return out;
}

function truncateText(value: string | undefined, maxChars: number): string {
  const text = value?.trim() ?? "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 80))}\n[truncated ${text.length - maxChars} chars]`;
}

function nonEmptyText(value: string | undefined | null): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.flatMap((entry) => typeof entry === "string" ? [entry] : []), limit);
}

function normalizeEvidenceRefs(value: unknown, fallback: TaskLoopEvidenceRef[]): TaskLoopEvidenceRef[] {
  if (!Array.isArray(value)) return fallback;
  const refs = value.flatMap((entry) => {
    const record = asRecord(entry);
    const ref = typeof record?.ref === "string" ? record.ref.trim() : "";
    if (!ref) return [];
    const type = typeof record?.type === "string"
      && ["trace", "subagent", "tool", "manual", "other"].includes(record.type)
      ? record.type as TaskLoopEvidenceRef["type"]
      : "other";
    return [{
      type,
      ref,
      ...(typeof record?.label === "string" && record.label.trim() ? { label: record.label.trim() } : {}),
      ...(typeof record?.summary === "string" && record.summary.trim()
        ? { summary: truncateText(record.summary, 2_000) }
        : {}),
    }];
  });
  return refs.length ? refs.slice(0, 20) : fallback;
}

function extractJsonCandidates(text: string): unknown[] {
  const candidates: string[] = [];
  const taskLoopFence = /```(?:task_loop_evidence|clawgraph_handoff|json\s+task_loop_evidence|json\s+clawgraph_handoff)\s*([\s\S]*?)```/giu;
  for (const match of text.matchAll(taskLoopFence)) {
    candidates.push(match[1] ?? "");
  }
  const jsonFence = /```json\s*([\s\S]*?)```/giu;
  for (const match of text.matchAll(jsonFence)) {
    candidates.push(match[1] ?? "");
  }
  const objectMatch = text.match(/\{[\s\S]*"(summary|filesTouched|testsRun|nodeId)"[\s\S]*\}/u);
  if (objectMatch) {
    candidates.push(objectMatch[0]);
  }
  return candidates.flatMap((candidate) => {
    try {
      return [JSON.parse(candidate.trim())];
    } catch {
      return [];
    }
  });
}

function sectionLines(text: string, title: string, limit = 8): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^#{0,4}\\s*${title}\\b`, "iu").test(line.trim()));
  if (start < 0) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,4}\s+\S/u.test(line.trim())) break;
    const trimmed = line.replace(/^[-*]\s*/u, "").trim();
    if (!trimmed || /^(none|n\/a|no\b)/iu.test(trimmed)) continue;
    body.push(trimmed);
    if (body.length >= limit) break;
  }
  return body;
}

function extractPathLikeItems(text: string): string[] {
  const matches = text.match(/(?:[A-Za-z]:\\[^\s,;:]+|(?:[\w.-]+\/)+[\w.-]+|[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|py|rs|go|java|yml|yaml))/giu);
  return uniqueStrings(matches ?? [], 12);
}

function extractTestLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\b(test|spec|vitest|playwright|typecheck|lint|passed|failed|coverage)\b/iu.test(line));
  return uniqueStrings(lines, 8);
}

function readResultText(entry: SubagentRunRecord | null | undefined): string {
  const legacyFrozen = entry as (SubagentRunRecord & {
    frozenResultText?: string | null;
    fallbackFrozenResultText?: string | null;
  }) | null | undefined;
  return (
    entry?.completion?.resultText?.trim()
    || entry?.delivery?.payload?.frozenResultText?.trim()
    || legacyFrozen?.frozenResultText?.trim()
    || entry?.delivery?.payload?.fallbackFrozenResultText?.trim()
    || legacyFrozen?.fallbackFrozenResultText?.trim()
    || entry?.completion?.fallbackResultText?.trim()
    || ""
  );
}

function parseEvidenceText(params: {
  text: string;
  roleName: string;
  childRunId: string;
  fallbackRef: TaskLoopEvidenceRef;
}): Pick<TaskLoopSubagentEvidence, "summary" | "filesTouched" | "testsRun" | "evidenceRefs" | "decisions" | "risks" | "followupTasks"> {
  const text = truncateText(params.text, 6_000);
  let structured: Record<string, unknown> | null = null;
  for (const candidate of extractJsonCandidates(text)) {
    const record = asRecord(candidate);
    if (record?.summary || record?.filesTouched || record?.testsRun || record?.evidenceRefs) {
      structured = record;
      break;
    }
  }
  const summary = typeof structured?.summary === "string" && structured.summary.trim()
    ? structured.summary.trim()
    : sectionLines(text, "Summary", 4).join("; ") || text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4).join("\n");
  const filesTouched = uniqueStrings([
    ...stringList(structured?.filesTouched),
    ...sectionLines(text, "Files Touched"),
    ...sectionLines(text, "Files"),
    ...extractPathLikeItems(text),
  ], 20);
  const testsRun = uniqueStrings([
    ...stringList(structured?.testsRun),
    ...sectionLines(text, "Tests Run"),
    ...sectionLines(text, "Tests"),
    ...extractTestLines(text),
  ], 20);
  const decisions = uniqueStrings([
    ...stringList(structured?.decisions),
    ...sectionLines(text, "Decisions"),
  ], 12);
  const risks = uniqueStrings([
    ...stringList(structured?.risks),
    ...sectionLines(text, "Risks"),
  ], 12);
  const followupTasks = uniqueStrings([
    ...stringList(structured?.followupTasks),
    ...sectionLines(text, "Follow-up Candidates"),
    ...extractFollowupCandidates({
      text,
      roleName: params.roleName,
      childRunId: params.childRunId,
    }).map((candidate) => candidate.task),
  ], 12);
  return {
    summary: truncateText(summary, 2_000),
    filesTouched,
    testsRun,
    evidenceRefs: normalizeEvidenceRefs(structured?.evidenceRefs, [params.fallbackRef]),
    decisions,
    risks,
    followupTasks,
  };
}

function spawnStatusForEvidence(outcome: OrchestrationWorkerOutcome): TaskLoopSubagentEvidence["spawnStatus"] {
  return outcome.spawn.status === "forbidden"
    ? "forbidden"
    : outcome.spawn.status === "accepted"
      ? "accepted"
      : "error";
}

function failureStatusForEvidence(status: string): TaskLoopSubagentEvidence["spawnStatus"] {
  if (status === "forbidden") return "forbidden";
  if (status === "timeout") return "timeout";
  return "error";
}

function completionStatusForFailure(status: TaskLoopSubagentEvidence["spawnStatus"]): TaskLoopSubagentEvidence["completionStatus"] {
  if (status === "forbidden") return "permission_blocked";
  if (status === "timeout") return "timeout";
  return "failed";
}

function taskNodeIdForOutcome(outcome: OrchestrationWorkerOutcome): string | undefined {
  return outcome.ledger?.taskNodeId ?? outcome.ledger?.taskId;
}

async function resolveSubagentRun(
  deps: TaskLoopControllerDeps,
  runId?: string,
  childSessionKey?: string,
): Promise<SubagentRunRecord | null> {
  const injected = deps.getSubagentRun?.(runId, childSessionKey);
  if (injected) return injected;
  try {
    const registry = await import("./subagent-registry-runtime.js");
    if (runId) {
      const byRunId = registry.getSubagentRunByRunId(runId);
      if (byRunId) return byRunId;
    }
    return childSessionKey ? registry.getLatestSubagentRunByChildSessionKey(childSessionKey) : null;
  } catch {
    return null;
  }
}

async function collectSubagentEvidence(
  result: OrchestrationRunResult,
  orchestrationRunId: string,
  deps: TaskLoopControllerDeps,
  now: () => number,
): Promise<TaskLoopSubagentEvidence[]> {
  const evidence: TaskLoopSubagentEvidence[] = [];
  for (const outcome of result.outcomes) {
    const childRunId = outcome.spawn.result?.runId;
    const childSessionKey = outcome.spawn.result?.childSessionKey;
    const phase = outcome.isVerifier ? "verifier" : "worker";
    const baseRef: TaskLoopEvidenceRef = {
      type: "subagent",
      ref: childRunId ?? `${orchestrationRunId}:${outcome.roleName}`,
      label: outcome.roleName,
      summary: `${phase} spawn status: ${outcome.spawn.status}`,
    };
    const spawnStatus = spawnStatusForEvidence(outcome);
    const failureReason = outcome.spawn.error ?? outcome.spawn.result?.error;
    if (spawnStatus !== "accepted") {
      const childId = childRunId ?? `${orchestrationRunId}:${outcome.roleName}`;
      const quality = scoreWorkerQuality({
        roleName: outcome.roleName,
        childRunId: childId,
        childSessionKey,
        outcomeStatus: spawnStatus,
        outcomeError: failureReason,
      });
      evidence.push({
        roleName: outcome.roleName,
        phase,
        ...(taskNodeIdForOutcome(outcome) ? { taskNodeId: taskNodeIdForOutcome(outcome) } : {}),
        ...(typeof outcome.ledger?.executionWave === "number" ? { executionWave: outcome.ledger.executionWave } : {}),
        ...(childRunId ? { childRunId } : {}),
        ...(childSessionKey ? { childSessionKey } : {}),
        spawnStatus,
        completionStatus: completionStatusForFailure(spawnStatus),
        summary: failureReason ?? `${outcome.roleName} did not spawn successfully.`,
        filesTouched: [],
        testsRun: [],
        evidenceRefs: [baseRef],
        decisions: [],
        risks: failureReason ? [failureReason] : [],
        followupTasks: [],
        quality,
        ...(failureReason ? { failureReason } : {}),
        capturedAt: now(),
      });
      continue;
    }
    const registryEntry = await resolveSubagentRun(deps, childRunId, childSessionKey);
    const resultText = readResultText(registryEntry);
    const completionOutcome = registryEntry?.outcome ?? registryEntry?.execution?.outcome;
    const outcomeStatus = completionOutcome?.status === "ok" ? "ok" : completionOutcome?.status;
    const childId = childRunId ?? registryEntry?.runId ?? `${orchestrationRunId}:${outcome.roleName}`;
    const quality = scoreWorkerQuality({
      roleName: outcome.roleName,
      childRunId: childId,
      childSessionKey,
      resultText,
      outcomeStatus: outcomeStatus ?? (resultText ? "ok" : "empty_output"),
      outcomeError: completionOutcome?.error,
    });
    if (!resultText) {
      evidence.push({
        roleName: outcome.roleName,
        phase,
        ...(taskNodeIdForOutcome(outcome) ? { taskNodeId: taskNodeIdForOutcome(outcome) } : {}),
        ...(typeof outcome.ledger?.executionWave === "number" ? { executionWave: outcome.ledger.executionWave } : {}),
        ...(childRunId ? { childRunId } : {}),
        ...(childSessionKey ? { childSessionKey } : {}),
        spawnStatus,
        completionStatus: "unverifiable",
        summary: "Accepted child run has no captured completion result.",
        filesTouched: [],
        testsRun: [],
        evidenceRefs: [baseRef],
        decisions: [],
        risks: ["accepted child run has no captured result"],
        followupTasks: [],
        quality,
        failureReason: "unverifiable_result",
        capturedAt: now(),
      });
      continue;
    }
    const parsed = parseEvidenceText({
      text: resultText,
      roleName: outcome.roleName,
      childRunId: childId,
      fallbackRef: {
        ...baseRef,
        summary: truncateText(resultText, 2_000),
      },
    });
    const failedCompletion = completionOutcome?.status === "error" || completionOutcome?.status === "timeout";
    evidence.push({
      roleName: outcome.roleName,
      phase,
      ...(taskNodeIdForOutcome(outcome) ? { taskNodeId: taskNodeIdForOutcome(outcome) } : {}),
      ...(typeof outcome.ledger?.executionWave === "number" ? { executionWave: outcome.ledger.executionWave } : {}),
      ...(childRunId ? { childRunId } : {}),
      ...(childSessionKey ? { childSessionKey } : {}),
      spawnStatus,
      completionStatus: failedCompletion ? "failed" : "completed",
      ...parsed,
      quality,
      ...(failedCompletion && completionOutcome?.error ? { failureReason: completionOutcome.error } : {}),
      capturedAt: registryEntry?.completion?.capturedAt ?? registryEntry?.endedAt ?? now(),
    });
  }
  for (const failure of result.failures) {
    const spawnStatus = failureStatusForEvidence(failure.status);
    const hasOutcomeEvidence = result.outcomes.some((outcome) => outcome.roleName === failure.roleName);
    const alreadyCaptured = evidence.some((entry) =>
      entry.roleName === failure.roleName
      && entry.spawnStatus === spawnStatus
      && entry.failureReason === failure.error,
    );
    if (alreadyCaptured || (hasOutcomeEvidence && spawnStatus !== "timeout")) {
      continue;
    }
    const ref = `${orchestrationRunId}:${failure.roleName}:${spawnStatus}`;
    const quality = scoreWorkerQuality({
      roleName: failure.roleName,
      childRunId: ref,
      outcomeStatus: spawnStatus,
      outcomeError: failure.error,
    });
    evidence.push({
      roleName: failure.roleName,
      phase: "worker",
      spawnStatus,
      completionStatus: completionStatusForFailure(spawnStatus),
      summary: failure.error ?? `${failure.roleName} reported ${spawnStatus}.`,
      filesTouched: [],
      testsRun: [],
      evidenceRefs: [{
        type: "subagent",
        ref,
        label: failure.roleName,
        summary: `worker failure status: ${failure.status}`,
      }],
      decisions: [],
      risks: failure.error ? [failure.error] : [],
      followupTasks: [],
      quality,
      ...(failure.error ? { failureReason: failure.error } : {}),
      capturedAt: now(),
    });
  }
  return evidence;
}

function evidenceFromResult(
  result: OrchestrationRunResult,
  orchestrationRunId: string,
  subagentEvidence: readonly TaskLoopSubagentEvidence[] = [],
): TaskLoopEvidenceRef[] {
  const refs: TaskLoopEvidenceRef[] = [
    {
      type: "trace",
      ref: orchestrationRunId,
      label: "orchestration run",
      summary: summarizePlan(result),
    },
  ];
  for (const evidence of subagentEvidence) {
    refs.push({
      type: "subagent",
      ref: evidence.childRunId ?? `${orchestrationRunId}:${evidence.roleName}`,
      label: evidence.roleName,
      summary: [
        `role=${evidence.roleName}`,
        `phase=${evidence.phase}`,
        `spawnStatus=${evidence.spawnStatus}`,
        `completionStatus=${evidence.completionStatus}`,
        evidence.childSessionKey ? `childSessionKey=${evidence.childSessionKey}` : "",
        evidence.failureReason ?? "",
        evidence.summary,
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

function summarizeRoleQuality(evidence: readonly TaskLoopSubagentEvidence[]): TaskLoopRoleQualitySummary {
  const roles = evidence.map((entry) => ({
    roleName: entry.roleName,
    overall: entry.quality.overall,
    score: entry.quality.score,
    reasons: [...entry.quality.reasons].slice(0, 5),
  }));
  return {
    good: roles.filter((role) => role.overall === "good").length,
    needsAttention: roles.filter((role) => role.overall === "needs_attention").length,
    poorAttempt: roles.filter((role) => role.overall === "poor_attempt").length,
    roles,
  };
}

function lifecycleGateSummary(
  gate: TaskLoopEvidenceGateResult | undefined,
  evidence: readonly TaskLoopSubagentEvidence[],
): TaskLoopLifecycleEvidenceGateSummary | undefined {
  if (!gate) return undefined;
  return {
    status: gate.status,
    reasons: gate.reasons.slice(0, 8),
    workerCount: evidence.filter((entry) => entry.phase === "worker").length,
    failedWorkerCount: evidence.filter((entry) =>
      entry.completionStatus === "failed"
      || entry.completionStatus === "permission_blocked"
      || entry.completionStatus === "timeout",
    ).length,
    unverifiableWorkerCount: evidence.filter((entry) => entry.completionStatus === "unverifiable").length,
  };
}

function roleQualityLifecycleSummary(summary: TaskLoopRoleQualitySummary): Pick<TaskLoopRoleQualitySummary, "good" | "needsAttention" | "poorAttempt"> {
  return {
    good: summary.good,
    needsAttention: summary.needsAttention,
    poorAttempt: summary.poorAttempt,
  };
}

function filesTouchedFromEvidence(evidence: readonly TaskLoopSubagentEvidence[]): string[] {
  return uniqueStrings(evidence.flatMap((entry) => entry.filesTouched), 40);
}

function testsRunFromEvidence(evidence: readonly TaskLoopSubagentEvidence[]): string[] {
  return uniqueStrings(evidence.flatMap((entry) => entry.testsRun), 40);
}

function gateReasonsFromEvidence(evidence: readonly TaskLoopSubagentEvidence[]): string[] {
  const reasons: string[] = [];
  for (const entry of evidence) {
    if (entry.spawnStatus === "forbidden" || entry.completionStatus === "permission_blocked") {
      reasons.push(`permission_blocked:${entry.roleName}`);
    } else if (entry.spawnStatus === "timeout" || entry.completionStatus === "timeout") {
      reasons.push(`worker_timeout:${entry.roleName}`);
    } else if (entry.completionStatus === "failed") {
      reasons.push(`worker_failed:${entry.roleName}`);
    } else if (entry.completionStatus === "unverifiable") {
      reasons.push(`unverifiable_result:${entry.roleName}`);
    } else if (entry.phase === "worker" && !entry.summary.trim() && entry.evidenceRefs.length === 0) {
      reasons.push(`evidence_gap:${entry.roleName}`);
    }
  }
  if (!evidence.some((entry) => entry.phase === "worker")) {
    reasons.push("evidence_gap:no_worker_evidence");
  }
  return uniqueStrings(reasons, 20);
}

function evaluateEvidenceGate(
  evidence: readonly TaskLoopSubagentEvidence[],
  repairIterations: number,
  maxRepairIterations: number,
): TaskLoopEvidenceGateResult {
  const reasons = gateReasonsFromEvidence(evidence);
  const blockingEvidence = evidence.filter((entry) =>
    entry.completionStatus !== "completed"
    || entry.spawnStatus !== "accepted"
    || (entry.phase === "worker" && !entry.summary.trim() && entry.evidenceRefs.length === 0),
  );
  const status: TaskLoopEvidenceGateResult["status"] = reasons.length === 0
    ? "pass"
    : repairIterations < maxRepairIterations
      ? "repair"
      : "blocked";
  return {
    status,
    reasons,
    blockingEvidence,
    filesTouched: filesTouchedFromEvidence(evidence),
    testsRun: testsRunFromEvidence(evidence),
  };
}

function controlSignalsFromEvidenceGate(
  gate: TaskLoopEvidenceGateResult,
): LongConversationControlSignal[] {
  const repairable = gate.status !== "blocked";
  return gate.reasons.map((reason): LongConversationControlSignal => {
    const [code, roleName] = reason.split(":");
    if (code === "permission_blocked") {
      return {
        kind: "permission_wait",
        severity: repairable ? "warning" : "blocking",
        message: `Task-loop worker ${roleName ?? ""} was blocked by permissions.`.trim(),
        suggestedAction: repairable ? "repair" : "block",
        source: "task_loop.evidence_gate",
      };
    }
    if (code === "worker_timeout" || code === "worker_failed") {
      return {
        kind: "blocked_dependency",
        severity: repairable ? "warning" : "blocking",
        message: `Task-loop worker ${roleName ?? ""} ${code === "worker_timeout" ? "timed out" : "failed"}.`.trim(),
        suggestedAction: repairable ? "repair" : "block",
        source: "task_loop.evidence_gate",
      };
    }
    return {
      kind: "evidence_gap",
      severity: repairable ? "warning" : "blocking",
      message: `Task-loop evidence gate failed: ${reason}`,
      suggestedAction: repairable ? "repair" : "block",
      source: "task_loop.evidence_gate",
    };
  });
}

function applyEvidenceGateToSelfCheck(
  selfCheck: TaskLoopSelfCheckResult,
  gate: TaskLoopEvidenceGateResult,
): TaskLoopSelfCheckResult {
  if (gate.status === "pass") {
    return selfCheck;
  }
  const evidenceSignals = controlSignalsFromEvidenceGate(gate);
  const missingEvidence = uniqueStrings([
    ...selfCheck.missingEvidence,
    ...gate.reasons,
  ], 30);
  const validationState = selfCheck.validationState ?? deriveValidationState({
    status: "missing",
    gaps: ["Task-loop subagent evidence gate did not pass."],
    evidenceRefs: gate.blockingEvidence.flatMap((entry) => entry.evidenceRefs),
  });
  const decision: TaskLoopSelfCheckResult["decision"] =
    selfCheck.decision === "blocked" || gate.status === "blocked" ? "blocked" : "repair";
  return {
    ...selfCheck,
    decision,
    confidence: Math.min(selfCheck.confidence, decision === "blocked" ? 0.4 : 0.55),
    missingEvidence,
    controlSignals: normalizeControlSignals([
      ...(selfCheck.controlSignals ?? []),
      ...evidenceSignals,
    ]),
    validationState,
    quality: defaultQualityAssessments({
      signals: [...(selfCheck.controlSignals ?? []), ...evidenceSignals],
      validationState,
    }),
    repairBrief: decision === "repair"
      ? selfCheck.repairBrief ?? `Resolve task-loop evidence gate gaps: ${gate.reasons.join("; ")}`
      : selfCheck.repairBrief,
    contextSummary: selfCheck.contextSummary
      || `Task-loop evidence gate ${gate.status}: ${gate.reasons.join("; ")}`,
  };
}

function evidenceForContext(evidence: readonly TaskLoopSubagentEvidence[]): TaskLoopSubagentEvidenceForContext[] {
  return evidence.map((entry) => ({
    roleName: entry.roleName,
    phase: entry.phase,
    spawnStatus: entry.spawnStatus,
    completionStatus: entry.completionStatus,
    summary: entry.summary,
    filesTouched: entry.filesTouched,
    testsRun: entry.testsRun,
    decisions: entry.decisions,
    risks: entry.risks,
    followupTasks: entry.followupTasks,
    ...(entry.failureReason ? { failureReason: entry.failureReason } : {}),
    evidenceRefs: entry.evidenceRefs,
  }));
}

function checkpointEvidenceRefs(refs: readonly TaskLoopEvidenceRef[]): RuntimeResumeCheckpoint["evidenceRefs"] {
  return refs.map((ref) => ({
    type: ref.type,
    ref: ref.ref,
    ...(ref.label ? { label: ref.label } : {}),
  }));
}

function checkpointReviewNeededItems(
  record: TaskLoopRunRecord,
  selfCheck?: TaskLoopSelfCheckResult,
): string[] {
  return uniqueStrings([
    ...record.remaining,
    ...(record.evidenceGate?.reasons.map((reason) => `evidence_gate:${reason}`) ?? []),
    ...(selfCheck?.missingEvidence.map((item) => `missing_evidence:${item}`) ?? []),
    ...(selfCheck?.verificationGaps.map((item) => `verification_gap:${item}`) ?? []),
  ], 40);
}

function runtimeCoreJsonValue(value: unknown): RuntimeCoreJsonValue | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((entry) => runtimeCoreJsonValue(entry) ?? null);
  if (value && typeof value === "object") return runtimeCoreJsonObject(value as Record<string, unknown>);
  return undefined;
}

function runtimeCoreJsonObject(value: Record<string, unknown>): RuntimeCoreJsonObject {
  const out: RuntimeCoreJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = runtimeCoreJsonValue(entry);
    if (normalized !== undefined) out[key] = normalized;
  }
  return out;
}

function taskLoopEvidenceRefToRuntime(ref: TaskLoopEvidenceRef): EvidenceRef {
  const type: EvidenceRef["type"] =
    ref.type === "trace" ||
    ref.type === "subagent" ||
    ref.type === "tool" ||
    ref.type === "manual" ||
    ref.type === "other"
      ? ref.type
      : "other";
  return {
    type,
    ref: ref.ref,
    ...(ref.label ? { label: ref.label } : {}),
    ...(ref.summary ? { summary: ref.summary } : {}),
  };
}

function dedupeEvidenceRefs(refs: readonly EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.type}:${ref.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function runtimeRegistryDiagnosticsProvider(
  provider?: TaskLoopRuntimeRegistryDiagnosticsProvider,
): (() => readonly RuntimeRegistryDiagnostic[]) | undefined {
  if (!provider) return undefined;
  if (typeof provider === "function") return provider;
  return () => provider;
}

function runtimeRegistryDiagnosticShadowEnabled(
  flags: RuntimeRegistryFeatureFlags | undefined,
  diagnostic: RuntimeRegistryDiagnostic,
): boolean {
  if (!flags) return false;
  if (diagnostic.surface === "context") {
    return flags.registryPilotEnabled
      && flags.providerRegistryShadow
      && flags.contextProviderRegistryPilot;
  }
  if (diagnostic.surface === "tool") {
    return flags.toolRegistryShadow;
  }
  return false;
}

function runtimeRegistryDiagnosticsForShadow(record: TaskLoopRunRecord): RuntimeRegistryDiagnostic[] {
  const shadow = runtimeEventShadowFlags.get(record);
  const diagnostics = shadow?.runtimeRegistryDiagnostics?.() ?? [];
  return diagnostics.filter((diagnostic) =>
    runtimeRegistryDiagnosticShadowEnabled(shadow?.runtimeRegistryFlags, diagnostic)
  );
}

function registryDiagnosticShadowEvidenceRef(
  diagnostic: RuntimeRegistryDiagnostic,
  index: number,
): EvidenceRef {
  const providerId = diagnostic.providerId?.trim() || "unknown";
  return {
    type: "other",
    ref: `runtime-registry:${diagnostic.surface}:${providerId}:${diagnostic.reason}`,
    label: "Runtime registry diagnostic",
    ...(diagnostic.message ? { summary: diagnostic.message } : {}),
    metadata: runtimeCoreJsonObject({
      source: "task_loop.registry_shadow",
      surface: diagnostic.surface,
      providerId: diagnostic.providerId,
      status: diagnostic.status,
      reason: diagnostic.reason,
      retryable: diagnostic.retryable,
      diagnosticIndex: index,
      shadowOnly: true,
      legacyDecisionUnaffected: true,
      finalTaskStatusUnaffected: true,
    }),
  };
}

function registryDiagnosticEvidenceRefWithMetadata(
  ref: EvidenceRef,
  diagnostic: RuntimeRegistryDiagnostic,
  diagnosticIndex: number,
  evidenceIndex: number,
): EvidenceRef {
  return {
    ...ref,
    metadata: runtimeCoreJsonObject({
      ...(ref.metadata ?? {}),
      source: "task_loop.registry_shadow",
      registrySurface: diagnostic.surface,
      registryProviderId: diagnostic.providerId,
      registryStatus: diagnostic.status,
      registryReason: diagnostic.reason,
      registryDiagnosticIndex: diagnosticIndex,
      registryEvidenceIndex: evidenceIndex,
      shadowOnly: true,
      legacyDecisionUnaffected: true,
      finalTaskStatusUnaffected: true,
    }),
  };
}

function runtimeRegistryEvidenceRefsForShadow(
  diagnostics: readonly RuntimeRegistryDiagnostic[],
): EvidenceRef[] {
  return dedupeEvidenceRefs(diagnostics.flatMap((diagnostic, diagnosticIndex) => [
    ...diagnostic.evidenceRefs.map((ref, evidenceIndex) =>
      registryDiagnosticEvidenceRefWithMetadata(ref, diagnostic, diagnosticIndex, evidenceIndex)
    ),
    registryDiagnosticShadowEvidenceRef(diagnostic, diagnosticIndex),
  ]));
}

function runtimeRegistryShadowMetadata(
  diagnostics: readonly RuntimeRegistryDiagnostic[],
): RuntimeCoreJsonObject | undefined {
  if (diagnostics.length === 0) return undefined;
  return runtimeCoreJsonObject({
    schemaVersion: 1,
    source: "task_loop.registry_shadow",
    mode: "shadow",
    shadowOnly: true,
    legacyDecisionUnaffected: true,
    finalTaskStatusUnaffected: true,
    diagnostics: diagnostics.map((diagnostic, index) => ({
      index,
      surface: diagnostic.surface,
      providerId: diagnostic.providerId,
      status: diagnostic.status,
      reason: diagnostic.reason,
      message: diagnostic.message,
      retryable: diagnostic.retryable,
      evidenceRefs: diagnostic.evidenceRefs,
      metadata: diagnostic.metadata,
    })),
  });
}

function evidenceRefForFile(path: string, index: number): EvidenceRef {
  return {
    type: "file",
    ref: path,
    label: "File touched",
    metadata: runtimeCoreJsonObject({
      source: "task_loop.filesTouched",
      index,
    }),
  };
}

function evidenceRefForTest(command: string, index: number): EvidenceRef {
  return {
    type: "test",
    ref: command,
    label: "Test run",
    metadata: runtimeCoreJsonObject({
      source: "task_loop.testsRun",
      index,
    }),
  };
}

function evidenceRefForSubagent(entry: TaskLoopSubagentEvidence, index: number): EvidenceRef {
  return {
    type: "subagent",
    ref: entry.childRunId ?? entry.childSessionKey ?? `${entry.phase}:${entry.roleName}:${index}`,
    label: entry.roleName,
    summary: entry.failureReason ?? entry.summary,
    metadata: runtimeCoreJsonObject({
      source: "task_loop.subagentEvidence",
      roleName: entry.roleName,
      phase: entry.phase,
      taskNodeId: entry.taskNodeId,
      executionWave: entry.executionWave,
      childSessionKey: entry.childSessionKey,
      spawnStatus: entry.spawnStatus,
      completionStatus: entry.completionStatus,
      filesTouched: entry.filesTouched,
      testsRun: entry.testsRun,
      capturedAt: entry.capturedAt,
    }),
  };
}

function buildTaskLoopEvidenceVerifierShadowReport(params: {
  record: TaskLoopRunRecord;
  generatedAt: number;
}): TaskLoopEvidenceVerifierShadowReport | undefined {
  const gate = params.record.evidenceGate;
  if (!gate) return undefined;

  const fileRefs = gate.filesTouched.map(evidenceRefForFile);
  const testRefs = gate.testsRun.map(evidenceRefForTest);
  const legacyRefs = params.record.evidenceRefs.map(taskLoopEvidenceRefToRuntime);
  const subagentEvidenceRefs = params.record.subagentEvidence.flatMap((entry) =>
    entry.evidenceRefs.map(taskLoopEvidenceRefToRuntime),
  );
  const subagentRefs = params.record.subagentEvidence.map(evidenceRefForSubagent);
  const evidenceRefs = dedupeEvidenceRefs([
    ...fileRefs,
    ...testRefs,
    ...legacyRefs,
    ...subagentEvidenceRefs,
    ...subagentRefs,
  ]);
  const reasons: TaskLoopEvidenceVerifierShadowReason[] = [];

  if (gate.filesTouched.length > 0 && gate.testsRun.length === 0) {
    reasons.push({
      code: "missing_tests",
      message: "Files were touched, but no test evidence was reported.",
      evidenceRefs: fileRefs,
    });
  }

  for (const [index, entry] of params.record.subagentEvidence.entries()) {
    const evidenceRef = evidenceRefForSubagent(entry, index);
    if (entry.spawnStatus === "forbidden" || entry.completionStatus === "permission_blocked") {
      reasons.push({
        code: "permission",
        roleName: entry.roleName,
        message: `Worker ${entry.roleName} was blocked by permissions.`,
        evidenceRefs: [evidenceRef],
      });
      continue;
    }
    if (entry.spawnStatus === "timeout" || entry.completionStatus === "timeout") {
      reasons.push({
        code: "timeout",
        roleName: entry.roleName,
        message: `Worker ${entry.roleName} timed out.`,
        evidenceRefs: [evidenceRef],
      });
      continue;
    }
    if (entry.completionStatus === "failed" || entry.spawnStatus === "error") {
      reasons.push({
        code: "worker_failure",
        roleName: entry.roleName,
        message: `Worker ${entry.roleName} failed.`,
        evidenceRefs: [evidenceRef],
      });
      continue;
    }
    if (
      entry.completionStatus === "unverifiable" ||
      (entry.phase === "worker" && !entry.summary.trim() && entry.evidenceRefs.length === 0)
    ) {
      reasons.push({
        code: "unverifiable",
        roleName: entry.roleName,
        message: `Worker ${entry.roleName} did not provide verifiable evidence.`,
        evidenceRefs: [evidenceRef],
      });
    }
  }

  return {
    schemaVersion: 1,
    source: "task_loop.evidence_gate",
    mode: "warning",
    status: reasons.length ? "warning" : "pass",
    generatedAt: params.generatedAt,
    legacyGateStatus: gate.status,
    legacyGateReasons: [...gate.reasons],
    legacyDecisionUnaffected: true,
    filesTouched: [...gate.filesTouched],
    testsRun: [...gate.testsRun],
    workerCount: params.record.subagentEvidence.filter((entry) => entry.phase === "worker").length,
    evidenceRefs,
    reasons,
  };
}

function evidenceVerifierShadowEnabled(record: TaskLoopRunRecord): boolean {
  return runtimeEventShadowFlags.get(record)?.evidenceVerifierShadow === true;
}

function runtimeTaskStatusForTaskLoop(phase: TaskLoopPhase, status: TaskLoopStatus): RuntimeTaskStatus {
  if (status === "complete") return "completed";
  if (status === "blocked") return "blocked";
  if (status === "error") return "failed";
  switch (phase) {
    case "intake":
      return "created";
    case "plan":
      return "planning";
    case "execute":
      return "running";
    case "collect_evidence":
    case "self_check":
    case "verify":
      return "verifying";
    case "repair":
      return "applying_changes";
    case "blocked":
      return "blocked";
    case "complete":
      return "completed";
    case "error":
      return "failed";
  }
}

function nextRuntimeEventShadowId(record: TaskLoopRunRecord, label: string): string {
  const next = (runtimeEventShadowSequences.get(record) ?? 0) + 1;
  runtimeEventShadowSequences.set(record, next);
  return `task-loop:${record.loopRunId}:shadow:${next}:${label}`;
}

function runtimeEventShadowEnabled(record: TaskLoopRunRecord): boolean {
  const flags = runtimeEventShadowFlags.get(record);
  return flags?.runtimeTaskEventLogShadow === true || flags?.runtimeCoreShadow === true;
}

function runtimeEventLogDualWriteEnabled(record: TaskLoopRunRecord): boolean {
  const flags = runtimeEventShadowFlags.get(record);
  return runtimeEventShadowEnabled(record)
    && (flags?.runtimeEventLogFlags.eventLogShadow === true
      || flags?.runtimeEventLogFlags.eventLogPersist === true);
}

function emitRuntimeTaskEventShadow(
  record: TaskLoopRunRecord,
  deps: TaskLoopControllerDeps,
  build: () => RuntimeTaskEvent,
): void {
  if (!runtimeEventShadowEnabled(record)) return;
  const event = build();
  try {
    deps.runtimeTaskEventShadowSink?.(event);
  } catch {
    // RuntimeTaskEvent shadowing is observational and must not perturb TaskLoop behavior.
  }
  emitRuntimeTaskEventLogShadow(record, deps, event);
}

function emitRuntimeTaskEventLogShadow(
  record: TaskLoopRunRecord,
  deps: TaskLoopControllerDeps,
  event: RuntimeTaskEvent,
): void {
  if (!runtimeEventLogDualWriteEnabled(record) || !deps.runtimeTaskEventLogWriter) return;
  const flags = runtimeEventShadowFlags.get(record);
  try {
    const result = deps.runtimeTaskEventLogWriter(cloneRuntimeTaskEvent(event), {
      shadow: flags?.runtimeEventLogFlags.eventLogShadow === true
        ? { enabled: true, runId: record.loopRunId, source: "verification.run", trigger: "event-log-append" }
        : false,
    });
    if (result && typeof (result as Promise<unknown>).then === "function") {
      void (result as Promise<unknown>).catch(() => {
        // Event-log dual-write is shadow-only; writer failures must stay diagnostic-only.
      });
    }
  } catch {
    // Event-log dual-write is shadow-only; writer failures must stay diagnostic-only.
  }
}

function cloneRuntimeTaskEvent(event: RuntimeTaskEvent): RuntimeTaskEvent {
  return JSON.parse(JSON.stringify(event)) as RuntimeTaskEvent;
}

function taskLoopTraceContext(record: TaskLoopRunRecord, extra?: RuntimeCoreJsonObject): RuntimeTaskEvent["traceContext"] {
  return {
    ...(record.traceId ? { traceId: record.traceId } : {}),
    attributes: {
      source: "task_loop",
      loopRunId: record.loopRunId,
      sessionKey: record.sessionKey,
      ...(record.taskLedgerRootId ? { taskLedgerRootId: record.taskLedgerRootId } : {}),
      ...(extra ?? {}),
    },
  };
}

function emitTaskLoopLifecycleShadow(
  record: TaskLoopRunRecord,
  deps: TaskLoopControllerDeps,
  lifecycleEvent: TaskLoopLifecycleEvent,
): void {
  emitRuntimeTaskEventShadow(record, deps, () => {
    const status = runtimeTaskStatusForTaskLoop(lifecycleEvent.phase, lifecycleEvent.status);
    const registryDiagnostics = runtimeRegistryDiagnosticsForShadow(record);
    const registryShadow = runtimeRegistryShadowMetadata(registryDiagnostics);
    const registryEvidenceRefs = runtimeRegistryEvidenceRefsForShadow(registryDiagnostics);
    return {
      schemaVersion: 1,
      eventId: nextRuntimeEventShadowId(record, status),
      taskId: record.loopRunId,
      kind: status,
      timestamp: lifecycleEvent.ts,
      payload: {
        status,
        message: `TaskLoop ${lifecycleEvent.phase}`,
        ...(record.finalSummary ? { summary: record.finalSummary } : {}),
        metadata: runtimeCoreJsonObject({
          legacyPhase: lifecycleEvent.phase,
          legacyStatus: lifecycleEvent.status,
          iteration: lifecycleEvent.iteration,
          progress: lifecycleEvent.progress,
          orchestrationRunId: lifecycleEvent.orchestrationRunId,
          activeRoles: lifecycleEvent.activeRoles,
          selfCheckDecision: lifecycleEvent.selfCheckDecision,
          evidenceGate: lifecycleEvent.evidenceGate,
          evidenceVerifierReport: lifecycleEvent.evidenceVerifierReport,
          roleQualitySummary: lifecycleEvent.roleQualitySummary,
          filesTouched: lifecycleEvent.filesTouched,
          testsRun: lifecycleEvent.testsRun,
          blockedReason: lifecycleEvent.blockedReason,
          error: lifecycleEvent.error,
          registryDiagnostics: registryShadow,
        }),
      },
      traceContext: taskLoopTraceContext(record, {
        legacyPhase: lifecycleEvent.phase,
        legacyStatus: lifecycleEvent.status,
      }),
      evidenceRefs: dedupeEvidenceRefs([
        ...record.evidenceRefs.map(taskLoopEvidenceRefToRuntime),
        ...registryEvidenceRefs,
      ]),
    } as RuntimeTaskEvent;
  });
}

function emitTaskLoopCheckpointShadow(
  record: TaskLoopRunRecord,
  deps: TaskLoopControllerDeps,
  checkpoint: RuntimeResumeCheckpoint,
  reviewNeededItems: string[],
): void {
  emitRuntimeTaskEventShadow(record, deps, () => {
    const checkpointId = checkpoint.id ?? `task-loop:${record.loopRunId}:iteration:${record.iteration}:${record.phase}`;
    const state = runtimeTaskStatusForTaskLoop(record.phase, record.status);
    const registryDiagnostics = runtimeRegistryDiagnosticsForShadow(record);
    const registryShadow = runtimeRegistryShadowMetadata(registryDiagnostics);
    const registryEvidenceRefs = runtimeRegistryEvidenceRefsForShadow(registryDiagnostics);
    const runtimeCheckpoint = buildRuntimeCoreCheckpointFromResumeCheckpoint({
      checkpointId,
      taskId: record.loopRunId,
      state,
      checkpoint,
      openObligations: reviewNeededItems,
      contextSummary: record.finalSummary ?? checkpoint.nextAction ?? checkpoint.activeTask,
    });
    return {
      schemaVersion: 1,
      eventId: nextRuntimeEventShadowId(record, "checkpoint"),
      taskId: record.loopRunId,
      kind: "checkpoint",
      timestamp: record.updatedAt,
      payload: { checkpoint: runtimeCheckpoint },
      traceContext: taskLoopTraceContext(record, {
        legacyPhase: record.phase,
        legacyStatus: record.status,
        checkpointId,
        ...(registryShadow ? { registryDiagnostics: registryShadow } : {}),
      }),
      evidenceRefs: dedupeEvidenceRefs([
        ...runtimeEvidenceRefsFromResumeCheckpoint(checkpoint, checkpointId),
        ...registryEvidenceRefs,
      ]),
    };
  });
}

async function recordTaskLoopCheckpoint(
  record: TaskLoopRunRecord,
  deps: TaskLoopControllerDeps,
  selfCheck?: TaskLoopSelfCheckResult,
): Promise<void> {
  if (!record.taskLedgerRootId) {
    throw new Error(`task loop checkpoint requires Task Ledger root for loop ${record.loopRunId}`);
  }
  try {
    const reviewNeededItems = checkpointReviewNeededItems(record, selfCheck);
    const checkpoint: RuntimeResumeCheckpoint = {
      schemaVersion: 1,
      id: `task-loop:${record.loopRunId}:iteration:${record.iteration}:${record.phase}`,
      sessionKey: record.sessionKey,
      ...(record.workspaceId !== undefined ? { workspaceId: record.workspaceId } : {}),
      ...(record.taskLedgerRootId ? { taskLedgerRootId: record.taskLedgerRootId } : {}),
      trigger: record.status === "blocked" || record.status === "error" ? "manual_review" : "guide",
      activeTask: record.task,
      openBlockers: [],
      decisions: [],
      deviations: [],
      filesTouched: record.evidenceGate?.filesTouched ?? [],
      testsRun: record.evidenceGate?.testsRun ?? [],
      nextAction: record.nextActions[0],
      reviewNeededItems,
      evidenceRefs: checkpointEvidenceRefs(record.evidenceRefs),
      ...(record.controlSignals?.length ? { controlSignals: record.controlSignals } : {}),
      ...(record.validationState ? { validationState: record.validationState } : {}),
      ...(selfCheck?.acceptanceStatus ? { acceptanceStatus: selfCheck.acceptanceStatus } : {}),
      createdAt: new Date(record.updatedAt).toISOString(),
      metadata: {
        loopRunId: record.loopRunId,
        taskLedgerRootId: record.taskLedgerRootId,
        iteration: record.iteration,
        phase: record.phase,
        status: record.status,
        evidenceGate: record.evidenceGate,
        ...(record.evidenceVerifierReport ? { evidenceVerifierReport: record.evidenceVerifierReport } : {}),
        roleQualitySummary: record.roleQualitySummary,
        selfCheckDecision: selfCheck?.decision,
      },
    };
    const writer = deps.recordCheckpoint
      ?? (await import("./long-task-control/store.js")).recordLongTaskCheckpoint;
    await writer({
      id: checkpoint.id,
      idempotencyKey: `task-loop:${record.loopRunId}:iteration:${record.iteration}:${record.phase}`,
      sessionKey: record.sessionKey,
      workspaceId: record.workspaceId ?? undefined,
      taskLedgerRootId: record.taskLedgerRootId,
      runId: record.loopRunId,
      traceId: record.traceId,
      trigger: checkpoint.trigger,
      status: record.status,
      checkpoint,
      activeTask: record.task,
      filesTouched: record.evidenceGate?.filesTouched,
      testsRun: record.evidenceGate?.testsRun,
      nextAction: record.nextActions[0],
      reviewNeededItems,
      evidenceRefs: checkpointEvidenceRefs(record.evidenceRefs),
      controlSignals: record.controlSignals,
      validationState: record.validationState,
      acceptanceStatus: selfCheck?.acceptanceStatus,
      metadata: checkpoint.metadata,
    });
    emitTaskLoopCheckpointShadow(record, deps, checkpoint, reviewNeededItems);
  } catch {
    // Checkpoints improve resume quality but must not flip loop execution state.
  }
}

function recordCheckpointTraceEvent(
  recorder: ObservabilityTraceRecorder,
  record: TaskLoopRunRecord,
): void {
  recorder.recordEvent("task_loop.checkpoint_recorded", record.phase, {
    attributes: {
      loopRunId: record.loopRunId,
      iteration: record.iteration,
      status: record.status,
      evidenceGate: record.evidenceGate?.status,
    },
  });
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
  const evidenceGate = patch.evidenceGate ?? lifecycleGateSummary(record.evidenceGate, record.subagentEvidence);
  const roleQualitySummary = patch.roleQualitySummary ?? roleQualityLifecycleSummary(record.roleQualitySummary);
  const event: TaskLoopLifecycleEvent = {
    loopRunId: record.loopRunId,
    sessionKey: record.sessionKey,
    phase: record.phase,
    status: record.status,
    iteration: record.iteration,
    progress: progressForPhase(record.phase, Math.max(1, record.iteration), record.maxIterations),
    controlSignals: record.controlSignals,
    validationState: record.validationState,
    ...(evidenceGate ? { evidenceGate } : {}),
    ...(record.evidenceVerifierReport ? { evidenceVerifierReport: record.evidenceVerifierReport } : {}),
    roleQualitySummary,
    filesTouched: record.evidenceGate?.filesTouched ?? [],
    testsRun: record.evidenceGate?.testsRun ?? [],
    blockedReason: record.status === "blocked" ? record.finalSummary ?? record.remaining[0] : undefined,
    ts: record.updatedAt,
    ...patch,
  };
  deps.lifecycle?.(event);
  emitTaskLoopLifecycleShadow(record, deps, event);
}

function snapshot(record: TaskLoopRunRecord, selfCheck?: TaskLoopSelfCheckResult): void {
  record.iterations.push({
    iteration: record.iteration,
    phase: record.phase,
    status: record.status,
    orchestrationRunId: record.orchestrationRunIds.at(-1),
    evidenceRefs: [...record.evidenceRefs],
    subagentEvidence: record.subagentEvidence.map((entry) => ({
      ...entry,
      filesTouched: [...entry.filesTouched],
      testsRun: [...entry.testsRun],
      evidenceRefs: [...entry.evidenceRefs],
      decisions: [...entry.decisions],
      risks: [...entry.risks],
      followupTasks: [...entry.followupTasks],
      quality: { ...entry.quality, reasons: [...entry.quality.reasons] },
    })),
    ...(record.evidenceGate
      ? {
          evidenceGate: {
            ...record.evidenceGate,
            reasons: [...record.evidenceGate.reasons],
            blockingEvidence: [...record.evidenceGate.blockingEvidence],
            filesTouched: [...record.evidenceGate.filesTouched],
            testsRun: [...record.evidenceGate.testsRun],
          },
        }
      : {}),
    ...(record.evidenceVerifierReport
      ? {
          evidenceVerifierReport: {
            ...record.evidenceVerifierReport,
            legacyGateReasons: [...record.evidenceVerifierReport.legacyGateReasons],
            filesTouched: [...record.evidenceVerifierReport.filesTouched],
            testsRun: [...record.evidenceVerifierReport.testsRun],
            evidenceRefs: [...record.evidenceVerifierReport.evidenceRefs],
            reasons: record.evidenceVerifierReport.reasons.map((reason) => ({
              ...reason,
              evidenceRefs: [...reason.evidenceRefs],
            })),
          },
        }
      : {}),
    roleQualitySummary: {
      ...record.roleQualitySummary,
      roles: record.roleQualitySummary.roles.map((role) => ({ ...role, reasons: [...role.reasons] })),
    },
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
  let taskLedgerRootId = nonEmptyText(request.taskLedgerRootId);
  try {
    taskLedgerRootId = nonEmptyText(await (deps.ensureTaskLedgerRoot ?? ensureLongTaskLedgerRoot)({
      workspaceId: request.workspaceId,
      ...(taskLedgerRootId ? { taskLedgerRootId } : {}),
      sessionKey: request.sessionKey,
      ...(request.agentId ? { agentId: request.agentId } : {}),
      runId: loopRunId,
      title: request.task,
      source: "task_loop",
      metadata: {
        templateId: request.templateId ?? request.teamTemplateId,
        acceptance: request.acceptance ?? [],
      },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot start /loop without a Task Ledger root (loopRunId=${loopRunId}, sessionKey=${request.sessionKey}, workspaceId=${request.workspaceId ?? "default"}): ${message}`,
      { cause: error },
    );
  }
  if (!taskLedgerRootId) {
    throw new Error(
      `Cannot start /loop without a Task Ledger root (loopRunId=${loopRunId}, sessionKey=${request.sessionKey}, workspaceId=${request.workspaceId ?? "default"}): root creator returned an empty id`,
    );
  }
  const record: TaskLoopRunRecord = {
    loopRunId,
    sessionKey: request.sessionKey,
    ...(request.workspaceId !== undefined ? { workspaceId: request.workspaceId } : {}),
    task: request.task,
    ...(taskLedgerRootId ? { taskLedgerRootId } : {}),
    status: "running",
    phase: "intake",
    iteration: 0,
    maxIterations,
    maxRepairIterations,
    orchestrationRunIds: [],
    evidenceRefs: [],
    subagentEvidence: [],
    roleQualitySummary: {
      good: 0,
      needsAttention: 0,
      poorAttempt: 0,
      roles: [],
    },
    risks: [],
    remaining: [],
    nextActions: [],
    createdAt: now(),
    updatedAt: now(),
    iterations: [],
  };
  taskLoopRuns.set(loopRunId, record);
  const runtimeRegistryFlags = resolveRuntimeRegistryFeatureFlags(cfg);
  const runtimeEventLogFlags = resolveRuntimeEventLogFeatureFlags(cfg);
  runtimeEventShadowFlags.set(record, {
    runtimeTaskEventLogShadow: deps.runtimeTaskEventLogShadow ?? config.runtimeTaskEventLogShadow,
    runtimeCoreShadow: deps.runtimeCoreShadow ?? config.runtimeCoreShadow,
    evidenceVerifierShadow: deps.evidenceVerifierShadow ?? cfg?.runtime?.evidenceVerifier?.shadow,
    runtimeEventLogFlags,
    runtimeRegistryFlags,
    runtimeRegistryDiagnostics: runtimeRegistryDiagnosticsProvider(deps.runtimeRegistryDiagnostics),
  });

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
      record.subagentEvidence = await collectSubagentEvidence(result, orchestrationRunId, deps, now);
      record.roleQualitySummary = summarizeRoleQuality(record.subagentEvidence);
      record.evidenceGate = evaluateEvidenceGate(record.subagentEvidence, repairIterations, maxRepairIterations);
      record.evidenceRefs = evidenceFromResult(result, orchestrationRunId, record.subagentEvidence);
      record.evidenceVerifierReport = evidenceVerifierShadowEnabled(record)
        ? buildTaskLoopEvidenceVerifierShadowReport({ record, generatedAt: now() })
        : undefined;
      const failures = failuresFromResult(result);
      recorder.recordEvent("task_loop.evidence_collected", record.evidenceGate.status, {
        attributes: {
          loopRunId,
          iteration,
          orchestrationRunId,
          evidenceCount: record.subagentEvidence.length,
          filesTouched: record.evidenceGate.filesTouched.length,
          testsRun: record.evidenceGate.testsRun.length,
        },
      });
      recorder.recordEvent("task_loop.evidence_gate", record.evidenceGate.status, {
        attributes: {
          loopRunId,
          iteration,
          reasons: record.evidenceGate.reasons,
          blockingEvidenceCount: record.evidenceGate.blockingEvidence.length,
        },
      });
      for (const entry of record.subagentEvidence) {
        if (entry.completionStatus === "permission_blocked") {
          recorder.recordEvent("task_loop.worker_permission_blocked", entry.roleName, {
            attributes: { loopRunId, iteration, childRunId: entry.childRunId, reason: entry.failureReason },
          });
        }
        if (entry.completionStatus === "timeout") {
          recorder.recordEvent("task_loop.worker_timeout", entry.roleName, {
            attributes: { loopRunId, iteration, childRunId: entry.childRunId, reason: entry.failureReason },
          });
        }
      }
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
        subagentEvidence: evidenceForContext(record.subagentEvidence),
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
      const selfCheck = applyEvidenceGateToSelfCheck(
        gateTaskLoopSelfCheckCompletion(rawSelfCheck, repairIterations, maxRepairIterations),
        record.evidenceGate,
      );
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
        attributes: {
          loopRunId,
          iteration,
          confidence: selfCheck.confidence,
          risks: selfCheck.risks,
          evidenceGate: record.evidenceGate.status,
          evidenceGateReasons: record.evidenceGate.reasons,
        },
      });

      if (selfCheck.decision === "complete") {
        record.phase = "complete";
        record.status = "complete";
        record.finalSummary = selfCheck.contextSummary || "Task loop completed.";
        record.nextActions = ["synthesize_final_response"];
        snapshot(record, selfCheck);
        await recordTaskLoopCheckpoint(record, deps, selfCheck);
        recordCheckpointTraceEvent(recorder, record);
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
          await recordTaskLoopCheckpoint(record, deps, selfCheck);
          recordCheckpointTraceEvent(recorder, record);
          emit(record, deps, { orchestrationRunId, selfCheckDecision: "blocked" });
          break;
        }
        previousRepairHash = repairHash;
        repairBrief = nextRepairBrief;
        repairIterations += 1;
        record.phase = "repair";
        record.nextActions = ["run_scoped_repair_iteration"];
        snapshot(record, selfCheck);
        await recordTaskLoopCheckpoint(record, deps, selfCheck);
        recordCheckpointTraceEvent(recorder, record);
        emit(record, deps, { orchestrationRunId, selfCheckDecision: "repair" });
        continue;
      }

      record.phase = "blocked";
      record.status = "blocked";
      record.finalSummary = selfCheck.contextSummary || "Task loop blocked before completion.";
      record.nextActions = ["ask_user_or_manual_review"];
      snapshot(record, selfCheck);
      await recordTaskLoopCheckpoint(record, deps, selfCheck);
      recordCheckpointTraceEvent(recorder, record);
      emit(record, deps, { orchestrationRunId, selfCheckDecision: "blocked" });
      break;
    }

    if (record.status === "running") {
      record.phase = "blocked";
      record.status = "blocked";
      record.finalSummary = "Task loop reached the maximum iteration limit.";
      record.nextActions = ["ask_user_or_manual_review"];
      snapshot(record);
      await recordTaskLoopCheckpoint(record, deps);
      recordCheckpointTraceEvent(recorder, record);
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
    await recordTaskLoopCheckpoint(record, deps);
    recordCheckpointTraceEvent(recorder, record);
    emit(record, deps, { error: message });
    const { trace, scorecard } = completeObservedRun(recorder, "error", message);
    record.traceId = trace.id;
    (deps.storeTrace ?? storeRuntimeTrace)(trace, scorecard);
    return { ...record, iterations: [...record.iterations], evidenceRefs: [...record.evidenceRefs] };
  }
}
