/**
 * S06: correlate runtime memory self-edit writes with the RC-04 EffectReceipt
 * model, so a memory mutation is traceable (effectId/requestId/actor) and can be
 * reconciled when its outcome is unknown.
 *
 * This is not a second effect store. RC-04 (`agents/effect-receipt.ts`) already
 * owns the durable, append-only, idempotent half; this module builds the
 * domain-journal view for a memory write and hands it to an injected sink. The
 * import of the store stays behind a structural type so runtime-core never
 * imports agents/ at runtime (the same arrangement apply-patch-effect-receipt.ts
 * uses).
 *
 * Privacy: the proposal carries identifiers only (action + fact ids + domain) —
 * never memory content — because the receipt store stores the proposal.
 */
import { createHash } from "node:crypto";

/** RC-04 outcome vocabulary, restated so this module does not import the store for a type. */
export type MemoryEffectOutcome = "applied" | "not_applied" | "unknown";

export type MemoryEffectActor = {
  sessionKey: string;
  runId: string;
  attemptIndex: number;
  modelCallIndex: number;
  actorKind: "principal" | "delegate";
};

export type MemoryEffectStage1Context = {
  actor?: MemoryEffectActor;
  effect?: {
    toolCallId: string;
    toolName: string;
    resource: string;
    action: string;
  };
};

/** Structural subset of RC-04's `EffectReceiptInput`. */
export type MemoryEffectReceiptView = {
  idempotencyKey: string;
  proposal: Record<string, unknown>;
  domainExecutor: string;
  outcome: MemoryEffectOutcome;
  recoverability: string;
  stage1Context?: MemoryEffectStage1Context;
};

/** The only thing this module needs from the RC-04 store. */
export type MemoryEffectReceiptSink = {
  record(input: MemoryEffectReceiptView): unknown;
};

export const MEMORY_EFFECT_DOMAIN_EXECUTOR = "clawx-runtime-memory" as const;

export type MemoryEffectReceiptInput = {
  action: "memory_update" | "memory_forget" | "memory_strengthen";
  factId: string;
  outcome: MemoryEffectOutcome;
  /** Correlates a retried intent with the first attempt: same intent -> same key. */
  identity: {
    sessionKey?: string;
    runId?: string;
    toolCallId?: string;
    attemptIndex?: number;
    modelCallIndex?: number;
  };
  newFactId?: string;
  actorKind?: "principal" | "delegate";
  recoverability?: string;
};

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Deterministic per-intent idempotency key. It deliberately excludes the
 * outcome: replaying the same intent must hit the same key (identical content ->
 * duplicate, different content -> conflict), so duplicate effects stay at 0.
 */
export function memoryEffectIdempotencyKey(input: MemoryEffectReceiptInput): string {
  const identity = input.identity;
  return `memory-effect:v1:${sha256Text(
    [
      input.action,
      input.factId,
      identity.sessionKey ?? "",
      identity.runId ?? "",
      identity.toolCallId ?? "",
    ].join("\u0000"),
  )}`;
}

export function buildMemoryEffectReceipt(input: MemoryEffectReceiptInput): MemoryEffectReceiptView {
  const identity = input.identity;
  const stage1Context: MemoryEffectStage1Context = {};
  if (identity.sessionKey && identity.runId) {
    stage1Context.actor = {
      sessionKey: identity.sessionKey,
      runId: identity.runId,
      attemptIndex: identity.attemptIndex ?? 0,
      modelCallIndex: identity.modelCallIndex ?? 0,
      actorKind: input.actorKind ?? "principal",
    };
  }
  if (identity.toolCallId) {
    stage1Context.effect = {
      toolCallId: identity.toolCallId,
      toolName: input.action,
      resource: input.factId,
      action: input.action,
    };
  }
  return {
    idempotencyKey: memoryEffectIdempotencyKey(input),
    // Digest-only: identifiers, never memory content.
    proposal: {
      domain: "runtime-memory",
      action: input.action,
      factId: input.factId,
      ...(input.newFactId ? { newFactId: input.newFactId } : {}),
    },
    domainExecutor: MEMORY_EFFECT_DOMAIN_EXECUTOR,
    outcome: input.outcome,
    recoverability: input.recoverability ?? "reconcile-from-memory-store",
    ...(stage1Context.actor || stage1Context.effect ? { stage1Context } : {}),
  };
}

/**
 * Fail-open recorder: a correlation record is strictly weaker than the memory
 * write itself, so a receipt failure must never block or fail the write (mirrors
 * apply-patch-effect-receipt.ts). Returns whether the record was attempted.
 */
export function recordMemoryEffect(
  context: { effectReceiptStore?: MemoryEffectReceiptSink },
  input: MemoryEffectReceiptInput,
): boolean {
  const sink = context.effectReceiptStore;
  if (!sink) return false;
  try {
    sink.record(buildMemoryEffectReceipt(input));
  } catch {
    // swallow: never block the write path on a correlation record
  }
  return true;
}