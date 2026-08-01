import type { OpenClawConfig } from "../../config/types.openclaw.js";
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
  type LongConversationControlSignal,
} from "../long-conversation-control-signals.js";
import { formatMissionContextPackForReviewer } from "./context.js";
import type {
  MissionDecision,
  MissionMemoryCandidate,
  MissionReviewerDeps,
  MissionReviewerInput,
  MissionReviewerResult,
} from "./types.js";

const DEFAULT_REVIEWER_TIMEOUT_MS = 20_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 1_000)] : []).slice(0, max);
}

function normalizeDecision(value: unknown): MissionDecision | undefined {
  return value === "continue"
    || value === "repair"
    || value === "sleep"
    || value === "ask_user"
    || value === "complete"
    || value === "blocked"
    ? value
    : undefined;
}

function normalizeMemoryCandidates(value: unknown): MissionMemoryCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const kind = record.kind === "knowledge_draft" ? "knowledge_draft" : record.kind === "role_memory" ? "role_memory" : undefined;
    const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, 1_000) : "";
    if (!kind || !summary) return [];
    const candidate: MissionMemoryCandidate = {
      kind,
      summary,
      evidenceRefs: stringArray(record.evidenceRefs, 20),
    };
    return [candidate];
  }).slice(0, 20);
}

export function parseMissionReviewerResponse(text: string): MissionReviewerResult | null {
  const raw = text.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const record = asRecord(JSON.parse(match[0]));
    if (!record) return null;
    const decision = normalizeDecision(record.decision);
    if (!decision) return null;
    const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? Math.max(0, Math.min(1, record.confidence))
      : 0;
    const nextTick = asRecord(record.nextTick);
    const missingEvidence = stringArray(record.missingEvidence);
    const verificationGaps = stringArray(record.verificationGaps);
    const risks = stringArray(record.risks);
    const controlSignals = [
      ...normalizeControlSignals(record.controlSignals),
      ...signalsFromGaps({
        missingEvidence,
        verificationGaps,
        risks,
        source: "mission.reviewer",
        repairable: decision !== "blocked",
      }),
    ];
    const validationState = normalizeValidationState(record.validationState);
    return {
      decision,
      confidence,
      reason: typeof record.reason === "string" ? record.reason.trim().slice(0, 1_000) : "",
      missingEvidence,
      verificationGaps,
      repairBrief: typeof record.repairBrief === "string" && record.repairBrief.trim()
        ? record.repairBrief.trim().slice(0, 4_000)
        : undefined,
      nextTick: nextTick
        ? {
            ...(typeof nextTick.afterMs === "number" && Number.isFinite(nextTick.afterMs)
              ? { afterMs: Math.max(0, Math.floor(nextTick.afterMs)) }
              : {}),
            ...(typeof nextTick.reason === "string" && nextTick.reason.trim()
              ? { reason: nextTick.reason.trim().slice(0, 500) }
              : {}),
        }
        : undefined,
      risks,
      controlSignals,
      validationState,
      acceptanceStatus: normalizeAcceptanceStatus(record.acceptanceStatus),
      quality: normalizeQualityAssessments(record.quality),
      memoryCandidates: normalizeMemoryCandidates(record.memoryCandidates),
      checkpointSummary: typeof record.checkpointSummary === "string"
        ? record.checkpointSummary.trim().slice(0, 4_000)
        : "",
    };
  } catch {
    return null;
  }
}

function heuristicReviewer(input: MissionReviewerInput, reason: string): MissionReviewerResult {
  const taskLoop = input.taskLoopResult;
  const canRepair = input.repairTicksUsed < input.maxRepairTicks && input.tick < input.maxTicks;
  const evidenceAvailable = !input.contextPack.evidenceText.includes("No evidence has been collected yet.");
  const acceptanceGaps = input.contextPack.acceptance.length ? [] : ["Mission acceptance criteria were not provided."];
  if (taskLoop?.status === "complete") {
    const missingEvidence = evidenceAvailable ? [] : ["No mission evidence was collected."];
    const verificationGaps = [
      ...acceptanceGaps,
      ...(taskLoop.remaining ?? []),
    ].filter(Boolean);
    if (missingEvidence.length === 0 && verificationGaps.length === 0 && !reason) {
      const validationState = deriveValidationState({
        status: "passed",
        checks: ["inner task_loop completed", "Mission reviewer fallback saw no remaining gaps"],
      });
      const controlSignals: LongConversationControlSignal[] = [];
      return {
        decision: "complete",
        confidence: 0.82,
        reason: "Inner task loop completed and Mission evidence satisfied the available acceptance criteria.",
        missingEvidence: [],
        verificationGaps: [],
        risks: taskLoop.risks ?? [],
        controlSignals,
        validationState,
        acceptanceStatus: deriveAcceptanceStatus({
          acceptance: input.contextPack.acceptance,
          satisfied: true,
          summary: "Acceptance criteria were satisfied by collected evidence.",
        }),
        quality: defaultQualityAssessments({ signals: controlSignals, validationState }),
        memoryCandidates: [],
        checkpointSummary: taskLoop.finalSummary || `Mission tick ${input.tick} completed through task_loop.`,
      };
    }
    const controlSignals = signalsFromGaps({
      missingEvidence,
      verificationGaps,
      risks: [...(taskLoop.risks ?? []), ...(reason ? [reason] : [])],
      source: "mission.reviewer",
      repairable: canRepair,
    });
    const validationState = deriveValidationState({
      status: "missing",
      gaps: verificationGaps,
      summary: reason || "Mission completion lacks acceptance or validation evidence.",
    });
    return {
      decision: canRepair ? "repair" : "blocked",
      confidence: canRepair ? 0.55 : 0.4,
      reason: reason || (canRepair
        ? "Mission needs scoped repair before it can be treated as complete."
        : "Mission cannot prove completion within the remaining budget."),
      missingEvidence,
      verificationGaps,
      repairBrief: canRepair
        ? `Repair Mission tick ${input.tick}: ${[...missingEvidence, ...verificationGaps].join("; ") || "collect missing acceptance and validation evidence."}`
        : undefined,
      risks: taskLoop.risks ?? [],
      controlSignals,
      validationState,
      acceptanceStatus: deriveAcceptanceStatus({
        acceptance: input.contextPack.acceptance,
        gaps: verificationGaps,
      }),
      quality: defaultQualityAssessments({ signals: controlSignals, validationState }),
      memoryCandidates: [],
      checkpointSummary: `Mission tick ${input.tick} did not prove final completion.${[...missingEvidence, ...verificationGaps].length ? ` Gaps: ${[...missingEvidence, ...verificationGaps].join("; ")}` : ""}`,
    };
  }

  const failures = [
    ...(input.failures ?? []),
    ...(taskLoop?.remaining ?? []),
    taskLoop?.error ?? "",
  ].filter(Boolean);
  const verificationGaps = taskLoop?.remaining ?? [];
  const controlSignals = signalsFromGaps({
    missingEvidence: failures.length ? failures : ["No complete evidence was produced."],
    verificationGaps,
    risks: taskLoop?.risks ?? [],
    source: "mission.reviewer",
    repairable: canRepair,
  });
  const validationState = deriveValidationState({
    status: "missing",
    gaps: verificationGaps.length ? verificationGaps : failures,
    summary: reason,
  });
  return {
    decision: canRepair ? "repair" : "blocked",
    confidence: canRepair ? 0.55 : 0.4,
    reason: reason || (canRepair ? "Mission needs scoped repair." : "Mission cannot progress within repair budget."),
    missingEvidence: failures.length ? failures : ["No complete evidence was produced."],
    verificationGaps,
    repairBrief: canRepair
      ? `Repair Mission tick ${input.tick}: ${failures.join("; ") || "collect missing evidence and retry."}`
      : undefined,
    risks: taskLoop?.risks ?? [],
    controlSignals,
    validationState,
    acceptanceStatus: deriveAcceptanceStatus({
      acceptance: input.contextPack.acceptance,
      gaps: failures,
    }),
    quality: defaultQualityAssessments({ signals: controlSignals, validationState }),
    memoryCandidates: [],
    checkpointSummary: `Mission tick ${input.tick} did not prove completion.${failures.length ? ` Gaps: ${failures.join("; ")}` : ""}`,
  };
}

function requiresUserConfirmation(signals: readonly LongConversationControlSignal[] | undefined): boolean {
  return (signals ?? []).some((signal) =>
    signal.suggestedAction === "ask_user"
      || signal.suggestedAction === "replan"
      || signal.kind === "scope_drift"
      || signal.kind === "replan_required"
      || signal.kind === "permission_wait",
  );
}

function enforceMissionDecision(
  result: MissionReviewerResult,
  input: MissionReviewerInput,
): MissionReviewerResult {
  const explicitGaps = result.missingEvidence.length > 0
    || result.verificationGaps.length > 0
    || hasBlockingControlSignal(result.controlSignals)
    || result.validationState?.status === "failed"
    || result.validationState?.status === "missing"
    || result.acceptanceStatus?.status === "missing"
    || result.acceptanceStatus?.status === "changed";
  const signals = result.controlSignals ?? signalsFromGaps({
    missingEvidence: result.missingEvidence,
    verificationGaps: result.verificationGaps,
    risks: result.risks,
    source: "mission.reviewer",
    repairable: result.decision !== "blocked",
  });
  if (result.decision !== "complete" || !explicitGaps) {
    return {
      ...result,
      controlSignals: signals,
      quality: result.quality?.length ? result.quality : defaultQualityAssessments({
        signals,
        validationState: result.validationState,
      }),
    };
  }
  const canRepair = input.repairTicksUsed < input.maxRepairTicks && input.tick < input.maxTicks;
  const missingEvidence = result.missingEvidence.length ? result.missingEvidence : ["Mission completion had unresolved control signals."];
  const verificationGaps = result.verificationGaps.length ? result.verificationGaps : ["Mission validation or acceptance evidence is missing."];
  const controlSignals = normalizeControlSignals([
    ...signals,
    ...signalsFromGaps({
      missingEvidence,
      verificationGaps,
      risks: result.risks,
      source: "mission.reviewer",
      repairable: canRepair,
    }),
  ]);
  const validationState = result.validationState ?? deriveValidationState({
    status: "missing",
    gaps: verificationGaps,
  });
  const nextDecision: MissionDecision = requiresUserConfirmation(controlSignals)
    ? "ask_user"
    : canRepair
      ? "repair"
      : "blocked";
  return {
    ...result,
    decision: nextDecision,
    confidence: Math.min(result.confidence, nextDecision === "repair" ? 0.55 : 0.4),
    reason: result.reason || "Mission completion was downgraded because required evidence, validation, or acceptance signals were unresolved.",
    missingEvidence,
    verificationGaps,
    repairBrief: nextDecision === "repair"
      ? result.repairBrief ?? `Resolve Mission completion gaps: ${[...missingEvidence, ...verificationGaps].join("; ")}`
      : result.repairBrief,
    controlSignals,
    validationState,
    quality: defaultQualityAssessments({ signals: controlSignals, validationState }),
    checkpointSummary: result.checkpointSummary || "Mission completion was downgraded because control signals remained open.",
  };
}

function buildReviewerPrompt(input: MissionReviewerInput): string {
  return [
    "You are the OpenClaw Mission Loop reviewer.",
    "Return only JSON with this exact shape:",
    '{"decision":"continue|repair|sleep|ask_user|complete|blocked","confidence":0.0,"reason":"","missingEvidence":[],"verificationGaps":[],"repairBrief":"optional","nextTick":{"afterMs":0,"reason":"optional"},"risks":[],"controlSignals":[{"kind":"evidence_gap|validation_missing|scope_drift|unverified_claim|replan_required|permission_wait|blocked_dependency|risk|recovery_gap","severity":"info|warning|blocking","message":"","suggestedAction":"continue|repair|replan|ask_user|block|sleep|verify","source":"mission.reviewer"}],"validationState":{"status":"unknown|not_run|passed|failed|partial|missing","checks":[],"evidenceRefs":[],"summary":""},"acceptanceStatus":{"status":"unknown|satisfied|partial|missing|changed","criteria":[],"gaps":[],"summary":""},"quality":[{"dimension":"scope|evidence|validation|risk|recovery|security","status":"pass|gap|fail|unknown","summary":"","signalKinds":[]}],"memoryCandidates":[{"kind":"role_memory|knowledge_draft","summary":"","evidenceRefs":[]}],"checkpointSummary":"short state summary"}',
    "memoryCandidates: produce 0-3 items. Use kind=knowledge_draft when the tick produced a reusable, self-contained conclusion (a decision, procedure, architecture note, or troubleshooting insight) worth persisting beyond this mission; use kind=role_memory only for durable user preferences or behavior guidance. Each summary must be a complete statement (subject + conclusion + rationale), at most 200 characters. evidenceRefs must reference evidence already present in the mission context; leave empty when no direct evidence exists. Omit memoryCandidates entirely when nothing is worth persisting.",
    "Choose complete only when acceptance appears satisfied by evidence.",
    "Do not choose complete if acceptance is missing, validation is missing, evidence is unverified, a blocking review item remains, or scope has drifted.",
    "Choose repair only when a scoped follow-up can address the gaps within budget.",
    "Choose sleep when scheduled/event evidence is needed later and no immediate work is useful.",
    "Choose ask_user when user input or approval is required.",
    "Choose blocked when evidence is insufficient, repeated, unsafe, or beyond budget.",
    "",
    `repairTicksUsed: ${input.repairTicksUsed}`,
    `maxRepairTicks: ${input.maxRepairTicks}`,
    `maxTicks: ${input.maxTicks}`,
    input.taskLoopResult
      ? `innerTaskLoop: status=${input.taskLoopResult.status}; phase=${input.taskLoopResult.phase}; summary=${input.taskLoopResult.finalSummary ?? ""}`
      : "innerTaskLoop: not run",
    "",
    formatMissionContextPackForReviewer(input.contextPack),
  ].join("\n");
}

function reviewerModelRef(config?: MissionReviewerInput["reviewer"]): string | undefined {
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

async function modelComplete(prompt: string, input: MissionReviewerInput): Promise<string> {
  const cfg = input.cfg as OpenClawConfig | undefined;
  if (!cfg) throw new Error("mission reviewer requires runtime config");
  const {
    completeWithPreparedSimpleCompletionModel,
    prepareSimpleCompletionModelForAgent,
  } = await import("../simple-completion-runtime.js");
  const prepared = await prepareSimpleCompletionModelForAgent({
    cfg,
    agentId: input.agentId ?? "main",
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
      options: { maxTokens: 900, temperature: 0, signal: controller.signal },
    });
    return extractAssistantText(result);
  } finally {
    clearTimeout(timer);
  }
}

export async function runMissionReviewer(
  input: MissionReviewerInput,
  deps: MissionReviewerDeps = {},
): Promise<MissionReviewerResult> {
  const prompt = buildReviewerPrompt(input);
  try {
    const text = await (deps.complete ?? modelComplete)(prompt, input);
    const parsed = parseMissionReviewerResponse(text);
    if (parsed) return enforceMissionDecision(parsed, input);
    return heuristicReviewer(input, "mission reviewer returned no parseable JSON");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return heuristicReviewer(input, `mission reviewer unavailable: ${message}`);
  }
}
