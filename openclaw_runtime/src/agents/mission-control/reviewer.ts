import type { OpenClawConfig } from "../../config/types.openclaw.js";
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
    return [{
      kind,
      summary,
      evidenceRefs: stringArray(record.evidenceRefs, 20),
    }];
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
    return {
      decision,
      confidence,
      reason: typeof record.reason === "string" ? record.reason.trim().slice(0, 1_000) : "",
      missingEvidence: stringArray(record.missingEvidence),
      verificationGaps: stringArray(record.verificationGaps),
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
      risks: stringArray(record.risks),
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
  if (taskLoop?.status === "complete") {
    return {
      decision: "complete",
      confidence: 0.82,
      reason: reason || "Inner task loop completed with evidence.",
      missingEvidence: [],
      verificationGaps: [],
      risks: taskLoop.risks ?? [],
      memoryCandidates: [],
      checkpointSummary: taskLoop.finalSummary || `Mission tick ${input.tick} completed through task_loop.`,
    };
  }

  const failures = [
    ...(input.failures ?? []),
    ...(taskLoop?.remaining ?? []),
    taskLoop?.error ?? "",
  ].filter(Boolean);
  return {
    decision: canRepair ? "repair" : "blocked",
    confidence: canRepair ? 0.55 : 0.4,
    reason: reason || (canRepair ? "Mission needs scoped repair." : "Mission cannot progress within repair budget."),
    missingEvidence: failures.length ? failures : ["No complete evidence was produced."],
    verificationGaps: taskLoop?.remaining ?? [],
    repairBrief: canRepair
      ? `Repair Mission tick ${input.tick}: ${failures.join("; ") || "collect missing evidence and retry."}`
      : undefined,
    risks: taskLoop?.risks ?? [],
    memoryCandidates: [],
    checkpointSummary: `Mission tick ${input.tick} did not prove completion.${failures.length ? ` Gaps: ${failures.join("; ")}` : ""}`,
  };
}

function buildReviewerPrompt(input: MissionReviewerInput): string {
  return [
    "You are the OpenClaw Mission Loop reviewer.",
    "Return only JSON with this exact shape:",
    '{"decision":"continue|repair|sleep|ask_user|complete|blocked","confidence":0.0,"reason":"","missingEvidence":[],"verificationGaps":[],"repairBrief":"optional","nextTick":{"afterMs":0,"reason":"optional"},"risks":[],"memoryCandidates":[{"kind":"role_memory|knowledge_draft","summary":"","evidenceRefs":[]}],"checkpointSummary":"short state summary"}',
    "Choose complete only when acceptance appears satisfied by evidence.",
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
      context: [{ role: "user", content: prompt }],
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
    if (parsed) return parsed;
    return heuristicReviewer(input, "mission reviewer returned no parseable JSON");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return heuristicReviewer(input, `mission reviewer unavailable: ${message}`);
  }
}
