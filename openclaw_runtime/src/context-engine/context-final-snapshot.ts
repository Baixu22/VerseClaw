import { createHash } from "node:crypto";

import type { AgentMessage } from "../agents/runtime/index.js";
import type { ContextCandidateLineage, ContextCandidateProjection } from "./context-candidate.js";
import type { TurnInjectionAccounting } from "./turn-injection-budget.js";

export const CONTEXT_FINAL_SNAPSHOT_SCHEMA = "ContextFinalSnapshot/v1" as const;

export type ContextFinalSnapshotInput = {
  turnId: string;
  sessionKey?: string;
  runId?: string;
  providerId?: string;
  attemptIndex?: number;
  modelCallIndex?: number;
  systemPrompt?: string;
  messages: readonly AgentMessage[];
  projection: ContextCandidateProjection;
  budget: TurnInjectionAccounting;
  rc03PlanId?: string;
  bundleDigest?: string;
  createdAt?: number;
};

export type ContextFinalSnapshot = {
  schema: typeof CONTEXT_FINAL_SNAPSHOT_SCHEMA;
  snapshotId: string;
  turnId: string;
  sessionKey?: string;
  runId: string;
  providerId?: string;
  attemptIndex: number;
  modelCallIndex: number;
  sealed: true;
  systemPromptDigest: string;
  messagesDigest: string;
  contextCompositionDigest: string;
  providerRequestDigest: string;
  budgetDigest: string;
  budget: TurnInjectionAccounting;
  lineage: readonly ContextCandidateLineage[];
  rc03PlanId?: string;
  bundleDigest?: string;
  createdAt: number;
};

const snapshotsByRun = new Map<string, Map<string, ContextFinalSnapshot>>();

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

function normalizedIndex(value: number | undefined): number {
  return Number.isSafeInteger(value) && (value ?? 0) >= 0 ? value! : 0;
}

function resolvedRunId(input: ContextFinalSnapshotInput): string {
  return input.runId?.trim() || input.turnId;
}

function snapshotKey(attemptIndex: number, modelCallIndex: number): string {
  return `${attemptIndex}:${modelCallIndex}`;
}

function createSnapshot(input: ContextFinalSnapshotInput): ContextFinalSnapshot {
  const attemptIndex = normalizedIndex(input.attemptIndex);
  const modelCallIndex = normalizedIndex(input.modelCallIndex);
  const runId = resolvedRunId(input);
  const systemPrompt = input.systemPrompt ?? input.projection.systemPromptAddition;
  const systemPromptDigest = digest(systemPrompt ?? "");
  const messagesDigest = digest(input.messages);
  const contextCompositionDigest = digest({
    systemPromptAddition: input.projection.systemPromptAddition,
    systemPromptContributions: input.projection.systemPromptContributions ?? [],
    messageReplacement: input.projection.messageReplacement,
    lineage: input.projection.lineage,
  });
  const budgetDigest = digest(input.budget);
  const providerRequestDigest = digest({ systemPrompt: systemPrompt ?? null, messages: input.messages });
  return {
    schema: CONTEXT_FINAL_SNAPSHOT_SCHEMA,
    snapshotId: `ctx-final-${createHash("sha256")
      .update(`${runId}:${attemptIndex}:${modelCallIndex}`)
      .digest("hex")
      .slice(0, 20)}`,
    turnId: input.turnId,
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    runId,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    attemptIndex,
    modelCallIndex,
    sealed: true,
    systemPromptDigest,
    messagesDigest,
    contextCompositionDigest,
    providerRequestDigest,
    budgetDigest,
    budget: input.budget,
    lineage: input.projection.lineage,
    ...(input.rc03PlanId ? { rc03PlanId: input.rc03PlanId } : {}),
    ...(input.bundleDigest ? { bundleDigest: input.bundleDigest } : {}),
    createdAt: input.createdAt ?? Date.now(),
  };
}

/**
 * Record exactly one immutable final snapshot for one actual model call.
 * Identical retries are idempotent; a different final state for the same
 * run/attempt/model-call identity is a hard contract violation.
 */
export function recordContextFinalSnapshot(input: ContextFinalSnapshotInput): ContextFinalSnapshot {
  const snapshot = createSnapshot(input);
  const key = snapshotKey(snapshot.attemptIndex, snapshot.modelCallIndex);
  let byCall = snapshotsByRun.get(snapshot.runId);
  if (!byCall) {
    byCall = new Map();
    snapshotsByRun.set(snapshot.runId, byCall);
  }
  const existing = byCall.get(key);
  if (existing) {
    if (
      existing.providerRequestDigest !== snapshot.providerRequestDigest ||
      existing.contextCompositionDigest !== snapshot.contextCompositionDigest ||
      existing.budgetDigest !== snapshot.budgetDigest
    ) {
      throw new Error(
        `context final snapshot conflict for ${snapshot.runId} attempt=${snapshot.attemptIndex} modelCall=${snapshot.modelCallIndex}`,
      );
    }
    return structuredClone(existing);
  }
  byCall.set(key, snapshot);
  return structuredClone(snapshot);
}

export function getContextFinalSnapshot(
  runId: string | undefined,
  attemptIndex: number,
  modelCallIndex: number,
): ContextFinalSnapshot | undefined {
  if (!runId) return undefined;
  const snapshot = snapshotsByRun.get(runId)?.get(snapshotKey(attemptIndex, modelCallIndex));
  return snapshot ? structuredClone(snapshot) : undefined;
}

export function listContextFinalSnapshots(runId: string | undefined): ContextFinalSnapshot[] {
  if (!runId) return [];
  return [...(snapshotsByRun.get(runId)?.values() ?? [])]
    .map((snapshot) => structuredClone(snapshot))
    .sort(
      (left, right) =>
        left.attemptIndex - right.attemptIndex || left.modelCallIndex - right.modelCallIndex,
    );
}

export function resetContextFinalSnapshotsForTests(): void {
  snapshotsByRun.clear();
}