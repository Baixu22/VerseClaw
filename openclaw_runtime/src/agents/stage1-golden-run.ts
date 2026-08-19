/**
 * Stage 1 golden-path runner. It drives one real DeepSeek provider/model turn
 * through buildGuardedModelFetch, forces the real model to call the owner-
 * selected `write` tool, executes that call through the Stage 1 Tool Guard,
 * and returns queryable RequestEnvelope/WireReceipt/EffectReceipt evidence.
 *
 * This runner is explicit-invoke only and is not wired into the default
 * prompt path. It never logs the API key and never treats fixture/mock
 * execution as real evidence.
 */
import { createHash } from "node:crypto";
import path from "node:path";

import OpenAI from "openai";

import type { Model } from "../llm/types.js";
import type { OpenClawStateDatabaseOptions } from "../state/openclaw-state-db.js";
import { ApprovalLedger } from "./approval-ledger.js";
import { createOpenClawCodingTools } from "./agent-tools.js";
import { EffectReceiptStore } from "./effect-receipt.js";
import { projectStage1EffectReceipt } from "./stage1-effect-projection.js";
import { buildGuardedModelFetch } from "./provider-transport-fetch.js";
import {
  ReceiptStore,
  type RuntimeReceiptRow,
} from "./receipt-store.js";
import {
  getShadowCensusDiagnostics,
  type Stage2PromptPlanCarrier,
  type Stage2SnapshotCarrier,
} from "./shadow-census.js";
import {
  createCompilePlan,
  type CompilePlan,
} from "../context-engine/compile-plan.js";
import { RC03_SEAL_POLICY_DIGEST } from "../context-engine/rc03-seal-hook.js";
import { registerRc03SealProducers } from "../context-engine/rc03-producers.js";
import { getRegisteredSealProducers } from "../context-engine/seal-registry.js";
import { STAGE1_WRITE_TOOL_NAME } from "./stage1-tool-guard.js";

export const STAGE1_GOLDEN_MODEL_ID = "deepseek-v4-flash";
export const STAGE1_GOLDEN_MODEL_REF = "deepseek/deepseek-v4-flash";
export const STAGE1_GOLDEN_BASE_URL = "https://api.deepseek.com/v1";

export type Stage1GoldenRunResult =
  | {
      ok: true;
      model: string;
      toolCallId: string;
      approvalId: string;
      effectReceiptId: string;
      journalRef?: string;
      envelopeDigest?: string;
      envelopeRef?: string;
      wireReceiptId?: string;
      wireDigest?: string;
      census: ReturnType<typeof getShadowCensusDiagnostics>;
      result: unknown;
    }
  | {
      ok: false;
      reason:
        | "api-key-missing"
        | "invalid-workspace-path"
        | "model-tool-call-missing"
        | "tool-not-found"
        | "receipt-query-failed"
        | "error";
      message?: string;
    };

export type Stage1GoldenRunOptions = {
  apiKey?: string;
  database?: OpenClawStateDatabaseOptions;
  baseUrl?: string;
  modelId?: string;
  sessionKey: string;
  runId: string;
  attemptIndex?: number;
  modelCallIndex?: number;
  workspaceRoot: string;
  /** Relative to workspaceRoot. Must stay inside the workspace. */
  sentinelPath: string;
  sentinelContent: string;
  prompt?: string;
  signal?: AbortSignal;
  /** Stage 2 DCS carriers; optional and never change the Stage 1 send path. */
  stage2PromptPlan?: Stage2PromptPlanCarrier;
  stage2Snapshot?: Stage2SnapshotCarrier;
};

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resolveWorkspaceResource(workspaceRoot: string, relativePath: string): string | null {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

function buildModel(baseUrl: string, modelId: string): Model {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "deepseek",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

function buildStage1CompilePlan(options: {
  sessionKey: string;
  runId: string;
  attemptIndex: number;
  modelCallIndex: number;
}): CompilePlan {
  registerRc03SealProducers();
  const registrations = getRegisteredSealProducers();
  return createCompilePlan({
    sessionKey: options.sessionKey,
    runId: options.runId,
    providerId: "deepseek",
    adapterId: "openai-completions",
    policyDigest: RC03_SEAL_POLICY_DIGEST,
    callIndex: {
      attemptIndex: options.attemptIndex,
      planRevision: 0,
      modelCallIndex: options.modelCallIndex,
      wireAttemptIndex: 0,
    },
    preSealProducers: registrations
      .filter((registration) => registration.kind === "semantic")
      .map((registration) => ({
        producerId: registration.id,
        producerVersion: registration.version,
        applied: false,
      })),
    postSealTransformIds: registrations
      .filter((registration) => registration.kind === "non-semantic")
      .map((registration) => registration.id)
      .sort(),
  });
}

function parseToolCallArguments(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function envelopeEvidenceFromWireRow(row: RuntimeReceiptRow | undefined): {
  envelopeRef?: string;
  envelopeDigest?: string;
} {
  if (!row?.selected_json) return {};
  try {
    const selected = JSON.parse(row.selected_json) as unknown;
    if (!Array.isArray(selected)) return {};
    const envelopeRef = selected.find(
      (value): value is string => typeof value === "string" && value.startsWith("ref:request-envelope:"),
    );
    if (!envelopeRef) return {};
    return {
      envelopeRef,
      envelopeDigest: `sha256:${envelopeRef.slice("ref:request-envelope:".length)}`,
    };
  } catch {
    return {};
  }
}

export async function runStage1GoldenCodingTurn(
  options: Stage1GoldenRunOptions,
): Promise<Stage1GoldenRunResult> {
  const apiKey = (options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) {
    return { ok: false, reason: "api-key-missing" };
  }
  const resource = resolveWorkspaceResource(options.workspaceRoot, options.sentinelPath);
  if (!resource) {
    return { ok: false, reason: "invalid-workspace-path" };
  }
  const attemptIndex = options.attemptIndex ?? 0;
  const modelCallIndex = options.modelCallIndex ?? 0;
  const baseUrl = options.baseUrl ?? STAGE1_GOLDEN_BASE_URL;
  const modelId = options.modelId ?? STAGE1_GOLDEN_MODEL_ID;
  const database = options.database ?? {};
  const model = buildModel(baseUrl, modelId);
  const plan = buildStage1CompilePlan({
    sessionKey: options.sessionKey,
    runId: options.runId,
    attemptIndex,
    modelCallIndex,
  });
  const correlationDigest = sha256Text(plan.planDigest);
  const shadow = {
    enabled: true,
    sourceRuntime: true,
    database,
    sessionKey: options.sessionKey,
    runId: options.runId,
    providerId: model.provider,
    adapterId: model.api,
    attemptIndex,
    modelCallIndex,
    rc03Plan: plan,
    correlationDigest,
    ...(options.stage2PromptPlan ? { stage2PromptPlan: options.stage2PromptPlan } : {}),
    ...(options.stage2Snapshot ? { stage2Snapshot: options.stage2Snapshot } : {}),
  };
  const guardedFetch = buildGuardedModelFetch(model, undefined, { sanitizeSse: false }, shadow);
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    fetch: guardedFetch,
  });

  try {
    const sentinelContent = options.sentinelContent;
    const sentinelPath = options.sentinelPath;
    const prompt =
      options.prompt ??
      `Call the write tool exactly once. ` +
        `path must be ${JSON.stringify(sentinelPath)} and content must be ` +
        `${JSON.stringify(sentinelContent)}. Do not call any other tool.`;
    const completion = await client.chat.completions.create(
      {
        model: modelId,
        messages: [{ role: "user", content: prompt }],
        tools: [
          {
            type: "function",
            function: {
              name: STAGE1_WRITE_TOOL_NAME,
              description: "Write a file.",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  content: { type: "string" },
                },
                required: ["path", "content"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: "auto",
        max_tokens: 512,
        stream: false,
      },
      { signal: options.signal },
    );
    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function?.name !== STAGE1_WRITE_TOOL_NAME) {
      return { ok: false, reason: "model-tool-call-missing" };
    }
    const toolCallId =
      typeof toolCall.id === "string" && toolCall.id.trim()
        ? toolCall.id.trim()
        : `tool_${sha256Text(`${options.runId}:${modelCallIndex}`).slice(0, 12)}`;
    let args: Record<string, unknown>;
    try {
      args = parseToolCallArguments(toolCall.function?.arguments ?? "{}");
    } catch {
      return { ok: false, reason: "model-tool-call-missing", message: "invalid tool arguments" };
    }
    const tools = createOpenClawCodingTools({
      agentId: "stage1-golden-runner",
      sessionKey: options.sessionKey,
      runId: options.runId,
      sessionId: `stage1:${options.sessionKey}:${options.runId}`,
      workspaceDir: options.workspaceRoot,
      cwd: options.workspaceRoot,
      toolConstructionPlan: {
        includeBaseCodingTools: true,
        includeShellTools: false,
        includeChannelTools: false,
        includeOpenClawTools: false,
        includePluginTools: false,
      },
      writeJournalEnabled: true,
      stage1ToolGuard: {
        enabled: true,
        database,
        identity: {
          sessionKey: options.sessionKey,
          runId: options.runId,
          attemptIndex,
          modelCallIndex,
        },
        actorKind: "principal",
        workspaceRoot: options.workspaceRoot,
        sessionId: `stage1:${options.sessionKey}:${options.runId}`,
      },
    });
    const writeTool = tools.find((tool) => tool.name === STAGE1_WRITE_TOOL_NAME);
    if (!writeTool) {
      return { ok: false, reason: "tool-not-found" };
    }
    const result = await writeTool.execute(toolCallId, args, options.signal, undefined);

    const ledger = new ApprovalLedger(database);
    const approval = ledger.getByIdempotencyKey(`stage1:${STAGE1_WRITE_TOOL_NAME}:${toolCallId}`);
    const effects = new EffectReceiptStore(database);
    const effectRows = approval ? effects.listByApproval(approval.approval_id) : [];
    const projected = projectStage1EffectReceipt(effectRows[0]);
    if (!approval || !projected) {
      return { ok: false, reason: "receipt-query-failed" };
    }
    const receipts = new ReceiptStore(database);
    const wireRow = receipts
      .list({ kind: "wire", runId: options.runId, correlationDigest })
      .find((row) => row.version === "1");
    const envelopeEvidence = envelopeEvidenceFromWireRow(wireRow);
    const details =
      result && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>).details
        : undefined;
    const writeJournal =
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as Record<string, unknown>).write_journal
        : undefined;
    const snapshots =
      writeJournal && typeof writeJournal === "object" && !Array.isArray(writeJournal)
        ? (writeJournal as Record<string, unknown>).snapshots
        : undefined;
    const journalRef =
      Array.isArray(snapshots) && snapshots.length > 0 && snapshots[0]
        ? (snapshots[0] as Record<string, unknown>).journalEntryId
        : undefined;

    return {
      ok: true,
      model: STAGE1_GOLDEN_MODEL_REF,
      toolCallId,
      approvalId: approval.approval_id,
      effectReceiptId: projected.receiptId,
      ...(typeof journalRef === "string" ? { journalRef } : {}),
      ...envelopeEvidence,
      wireReceiptId: wireRow?.receipt_id,
      wireDigest: wireRow?.wire_digest ?? undefined,
      census: getShadowCensusDiagnostics(),
      result,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
