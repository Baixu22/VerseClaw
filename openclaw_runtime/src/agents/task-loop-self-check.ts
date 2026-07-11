import { createHash } from "node:crypto";
import type { AgentModelConfig } from "../config/types.agents-shared.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  defaultQualityAssessments,
  deriveAcceptanceStatus,
  deriveValidationState,
  hasBlockingControlSignal,
  normalizeAcceptanceStatus,
  normalizeControlSignals,
  normalizeQualityAssessments,
  normalizeValidationState,
  signalsFromGaps,
  type LongConversationAcceptanceStatus,
  type LongConversationControlSignal,
  type LongConversationQualityAssessment,
  type LongConversationValidationState,
} from "./long-conversation-control-signals.js";
import {
  formatTaskLoopContextPackForReviewer,
  type TaskLoopContextPack,
} from "./task-loop-context.js";

export type TaskLoopSelfCheckDecision = "complete" | "repair" | "blocked";

export type TaskLoopSelfCheckResult = {
  decision: TaskLoopSelfCheckDecision;
  confidence: number;
  missingEvidence: string[];
  repairBrief?: string;
  verificationGaps: string[];
  risks: string[];
  controlSignals?: LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
  acceptanceStatus?: LongConversationAcceptanceStatus;
  quality?: LongConversationQualityAssessment[];
  contextSummary: string;
};

export type TaskLoopReviewerConfig = {
  model?: AgentModelConfig;
  timeoutMs?: number;
};

export type TaskLoopSelfCheckInput = {
  cfg?: OpenClawConfig;
  agentId?: string;
  reviewer?: TaskLoopReviewerConfig;
  contextPack: TaskLoopContextPack;
  failures?: string[];
  repairIterationsUsed?: number;
  maxRepairIterations?: number;
};

export type TaskLoopSelfCheckDeps = {
  complete?: (prompt: string, input: TaskLoopSelfCheckInput) => Promise<string>;
};

const DEFAULT_REVIEWER_TIMEOUT_MS = 30_000;

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []));
}

function normalizeDecision(value: unknown): TaskLoopSelfCheckDecision | undefined {
  return value === "complete" || value === "repair" || value === "blocked" ? value : undefined;
}

function extractJsonObject(text: string): string | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  if (stripped.startsWith("{") && stripped.endsWith("}")) return stripped;
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  return start >= 0 && end > start ? stripped.slice(start, end + 1) : null;
}

export function parseTaskLoopSelfCheckResponse(text: string): TaskLoopSelfCheckResult | null {
  const objectText = extractJsonObject(text);
  if (!objectText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(objectText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const decision = normalizeDecision(record.decision);
  if (!decision) return null;
  const contextSummary = typeof record.contextSummary === "string"
    ? record.contextSummary.trim().slice(0, 4_000)
    : "";
  const missingEvidence = stringArray(record.missingEvidence);
  const verificationGaps = stringArray(record.verificationGaps);
  const risks = stringArray(record.risks);
  const controlSignals = [
    ...normalizeControlSignals(record.controlSignals),
    ...signalsFromGaps({
      missingEvidence,
      verificationGaps,
      risks,
      source: "task_loop.self_check",
      repairable: decision !== "blocked",
    }),
  ];
  const validationState = normalizeValidationState(record.validationState);
  return {
    decision,
    confidence: clampConfidence(record.confidence),
    missingEvidence,
    repairBrief: typeof record.repairBrief === "string" && record.repairBrief.trim()
      ? record.repairBrief.trim().slice(0, 4_000)
      : undefined,
    verificationGaps,
    risks,
    controlSignals,
    validationState,
    acceptanceStatus: normalizeAcceptanceStatus(record.acceptanceStatus),
    quality: normalizeQualityAssessments(record.quality),
    contextSummary,
  };
}

function heuristicSelfCheck(input: TaskLoopSelfCheckInput, reason?: string): TaskLoopSelfCheckResult {
  const failures = input.failures ?? [];
  const repairIterationsUsed = input.repairIterationsUsed ?? 0;
  const maxRepairIterations = input.maxRepairIterations ?? 2;
  const canRepair = repairIterationsUsed < maxRepairIterations;
  if (failures.length > 0) {
    const controlSignals = signalsFromGaps({
      missingEvidence: failures,
      verificationGaps: failures,
      risks: reason ? [reason] : ["worker failure evidence requires follow-up"],
      source: "task_loop.self_check",
      repairable: canRepair,
    });
    const validationState = deriveValidationState({
      status: "missing",
      gaps: failures,
      summary: reason,
    });
    return {
      decision: canRepair ? "repair" : "blocked",
      confidence: 0.55,
      missingEvidence: failures,
      repairBrief: canRepair
        ? `Repair the task-loop failures and verification gaps: ${failures.join("; ")}`
        : undefined,
      verificationGaps: failures,
      risks: reason ? [reason] : ["worker failure evidence requires follow-up"],
      controlSignals,
      validationState,
      acceptanceStatus: deriveAcceptanceStatus({
        acceptance: input.contextPack.acceptance,
        gaps: failures,
      }),
      quality: defaultQualityAssessments({ signals: controlSignals, validationState }),
      contextSummary: `Task loop iteration ${input.contextPack.iteration} saw failures: ${failures.join("; ")}`,
    };
  }
  const evidenceAvailable = !input.contextPack.evidenceText.includes("No evidence has been collected yet.");
  if (reason || !evidenceAvailable) {
    const missingEvidence = evidenceAvailable ? [] : ["No task-loop evidence was collected."];
    const validationGaps = reason ? [reason] : ["No validation evidence was available to the fallback reviewer."];
    const controlSignals = signalsFromGaps({
      missingEvidence,
      verificationGaps: validationGaps,
      risks: reason ? [reason] : [],
      source: "task_loop.self_check",
      repairable: canRepair,
    });
    const validationState = deriveValidationState({
      status: "missing",
      gaps: validationGaps,
      summary: reason,
    });
    return {
      decision: canRepair ? "repair" : "blocked",
      confidence: canRepair ? 0.5 : 0.35,
      missingEvidence,
      repairBrief: canRepair ? `Collect missing task-loop evidence and validation: ${[...missingEvidence, ...validationGaps].join("; ")}` : undefined,
      verificationGaps: validationGaps,
      risks: reason ? [reason] : [],
      controlSignals,
      validationState,
      acceptanceStatus: deriveAcceptanceStatus({
        acceptance: input.contextPack.acceptance,
        gaps: missingEvidence,
      }),
      quality: defaultQualityAssessments({ signals: controlSignals, validationState }),
      contextSummary: `Task loop iteration ${input.contextPack.iteration} could not prove completion.${[...missingEvidence, ...validationGaps].length ? ` Gaps: ${[...missingEvidence, ...validationGaps].join("; ")}` : ""}`,
    };
  }
  const validationState = deriveValidationState({
    status: "passed",
    checks: ["fallback reviewer saw collected evidence and no recorded spawn failures"],
  });
  return {
    decision: "complete",
    confidence: reason ? 0.6 : 0.75,
    missingEvidence: [],
    verificationGaps: [],
    risks: reason ? [reason] : [],
    controlSignals: reason
      ? signalsFromGaps({ risks: [reason], source: "task_loop.self_check", repairable: true })
      : [],
    validationState,
    acceptanceStatus: deriveAcceptanceStatus({
      acceptance: input.contextPack.acceptance,
      satisfied: true,
      summary: "No task-loop self-check gaps were recorded.",
    }),
    quality: defaultQualityAssessments({ validationState }),
    contextSummary: `Task loop iteration ${input.contextPack.iteration} completed without recorded spawn failures.`,
  };
}

function enforceSelfCheckDecision(
  result: TaskLoopSelfCheckResult,
  input: TaskLoopSelfCheckInput,
): TaskLoopSelfCheckResult {
  const explicitGaps = result.missingEvidence.length > 0
    || result.verificationGaps.length > 0
    || hasBlockingControlSignal(result.controlSignals)
    || result.validationState?.status === "failed"
    || result.validationState?.status === "missing"
    || result.acceptanceStatus?.status === "missing"
    || result.acceptanceStatus?.status === "changed";
  if (result.decision !== "complete" || !explicitGaps) {
    const signals = result.controlSignals ?? signalsFromGaps({
      missingEvidence: result.missingEvidence,
      verificationGaps: result.verificationGaps,
      risks: result.risks,
      source: "task_loop.self_check",
      repairable: result.decision !== "blocked",
    });
    return {
      ...result,
      controlSignals: signals,
      quality: result.quality?.length ? result.quality : defaultQualityAssessments({
        signals,
        validationState: result.validationState,
      }),
    };
  }
  const canRepair = (input.repairIterationsUsed ?? 0) < (input.maxRepairIterations ?? 2);
  const missingEvidence = result.missingEvidence.length ? result.missingEvidence : ["Task-loop completion had unresolved control signals."];
  const verificationGaps = result.verificationGaps.length ? result.verificationGaps : ["Validation evidence is missing or failed."];
  const controlSignals = normalizeControlSignals([
    ...(result.controlSignals ?? []),
    ...signalsFromGaps({
      missingEvidence,
      verificationGaps,
      risks: result.risks,
      source: "task_loop.self_check",
      repairable: canRepair,
    }),
  ]);
  const validationState = result.validationState ?? deriveValidationState({
    status: "missing",
    gaps: verificationGaps,
  });
  return {
    ...result,
    decision: canRepair ? "repair" : "blocked",
    confidence: Math.min(result.confidence, canRepair ? 0.55 : 0.4),
    missingEvidence,
    verificationGaps,
    repairBrief: canRepair
      ? result.repairBrief ?? `Resolve task-loop completion gaps: ${[...missingEvidence, ...verificationGaps].join("; ")}`
      : undefined,
    controlSignals,
    validationState,
    quality: defaultQualityAssessments({ signals: controlSignals, validationState }),
    contextSummary: result.contextSummary || "Task-loop completion was downgraded because required evidence or validation was missing.",
  };
}

function buildReviewerPrompt(pack: TaskLoopContextPack): string {
  return [
    "You are the OpenClaw task-loop self-check reviewer.",
    "Return only JSON with this exact shape:",
    '{"decision":"complete|repair|blocked","confidence":0.0,"missingEvidence":[],"repairBrief":"optional","verificationGaps":[],"risks":[],"controlSignals":[{"kind":"evidence_gap|validation_missing|scope_drift|unverified_claim|replan_required|permission_wait|blocked_dependency|risk|recovery_gap","severity":"info|warning|blocking","message":"","suggestedAction":"continue|repair|replan|ask_user|block|sleep|verify","source":"task_loop.self_check"}],"validationState":{"status":"unknown|not_run|passed|failed|partial|missing","checks":[],"evidenceRefs":[],"summary":""},"acceptanceStatus":{"status":"unknown|satisfied|partial|missing|changed","criteria":[],"gaps":[],"summary":""},"quality":[{"dimension":"scope|evidence|validation|risk|recovery|security","status":"pass|gap|fail|unknown","summary":"","signalKinds":[]}],"contextSummary":"short state summary"}',
    "Choose complete only when the objective appears satisfied by evidence.",
    "Do not choose complete if any evidence gap, validation gap, blocking control signal, scope drift, or unverified completion claim remains.",
    "Choose repair when a scoped follow-up can address missing evidence or failures.",
    "Choose blocked when evidence is insufficient, repeated, unsafe, or beyond the repair budget.",
    "",
    formatTaskLoopContextPackForReviewer(pack),
  ].join("\n");
}

function reviewerModelRef(config?: TaskLoopReviewerConfig): string | undefined {
  const model = config?.model;
  if (typeof model === "string") return model.trim() || undefined;
  return model?.primary?.trim() || undefined;
}

function extractAssistantText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

async function modelComplete(prompt: string, input: TaskLoopSelfCheckInput): Promise<string> {
  const cfg = input.cfg;
  if (!cfg) throw new Error("task-loop reviewer requires runtime config");
  const {
    completeWithPreparedSimpleCompletionModel,
    prepareSimpleCompletionModelForAgent,
  } = await import("./simple-completion-runtime.js");
  const agentId = input.agentId ?? "main";
  const prepared = await prepareSimpleCompletionModelForAgent({
    cfg,
    agentId,
    modelRef: reviewerModelRef(input.reviewer),
  });
  if ("error" in prepared) throw new Error(prepared.error);
  const controller = new AbortController();
  const timeoutMs = Math.max(1_000, Math.floor(input.reviewer?.timeoutMs ?? DEFAULT_REVIEWER_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await completeWithPreparedSimpleCompletionModel({
      model: prepared.model,
      auth: prepared.auth,
      cfg,
      context: {
        messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      },
      options: { maxTokens: 700, temperature: 0, signal: controller.signal },
    });
    return extractAssistantText(result);
  } finally {
    clearTimeout(timer);
  }
}

export async function runTaskLoopSelfCheck(
  input: TaskLoopSelfCheckInput,
  deps: TaskLoopSelfCheckDeps = {},
): Promise<TaskLoopSelfCheckResult> {
  const prompt = buildReviewerPrompt(input.contextPack);
  try {
    const text = await (deps.complete ?? modelComplete)(prompt, input);
    const parsed = parseTaskLoopSelfCheckResponse(text);
    if (parsed) return enforceSelfCheckDecision(parsed, input);
    return heuristicSelfCheck(input, "task-loop reviewer returned no parseable JSON");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return heuristicSelfCheck(input, `task-loop reviewer unavailable: ${message}`);
  }
}

export function hashTaskLoopRepairInput(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}
