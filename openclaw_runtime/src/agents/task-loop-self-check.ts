import { createHash } from "node:crypto";
import type { AgentModelConfig } from "../config/types.agents-shared.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
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
  return {
    decision,
    confidence: clampConfidence(record.confidence),
    missingEvidence: stringArray(record.missingEvidence),
    repairBrief: typeof record.repairBrief === "string" && record.repairBrief.trim()
      ? record.repairBrief.trim().slice(0, 4_000)
      : undefined,
    verificationGaps: stringArray(record.verificationGaps),
    risks: stringArray(record.risks),
    contextSummary,
  };
}

function heuristicSelfCheck(input: TaskLoopSelfCheckInput, reason?: string): TaskLoopSelfCheckResult {
  const failures = input.failures ?? [];
  const repairIterationsUsed = input.repairIterationsUsed ?? 0;
  const maxRepairIterations = input.maxRepairIterations ?? 2;
  if (failures.length > 0) {
    const canRepair = repairIterationsUsed < maxRepairIterations;
    return {
      decision: canRepair ? "repair" : "blocked",
      confidence: 0.55,
      missingEvidence: failures,
      repairBrief: canRepair
        ? `Repair the task-loop failures and verification gaps: ${failures.join("; ")}`
        : undefined,
      verificationGaps: failures,
      risks: reason ? [reason] : ["worker failure evidence requires follow-up"],
      contextSummary: `Task loop iteration ${input.contextPack.iteration} saw failures: ${failures.join("; ")}`,
    };
  }
  return {
    decision: "complete",
    confidence: reason ? 0.6 : 0.75,
    missingEvidence: [],
    verificationGaps: [],
    risks: reason ? [reason] : [],
    contextSummary: `Task loop iteration ${input.contextPack.iteration} completed without recorded spawn failures.`,
  };
}

function buildReviewerPrompt(pack: TaskLoopContextPack): string {
  return [
    "You are the OpenClaw task-loop self-check reviewer.",
    "Return only JSON with this exact shape:",
    '{"decision":"complete|repair|blocked","confidence":0.0,"missingEvidence":[],"repairBrief":"optional","verificationGaps":[],"risks":[],"contextSummary":"short state summary"}',
    "Choose complete only when the objective appears satisfied by evidence.",
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
      context: [{ role: "user", content: prompt }],
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
    if (parsed) return parsed;
    return heuristicSelfCheck(input, "task-loop reviewer returned no parseable JSON");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return heuristicSelfCheck(input, `task-loop reviewer unavailable: ${message}`);
  }
}

export function hashTaskLoopRepairInput(value: string): string {
  return createHash("sha256").update(value.trim()).digest("hex");
}
