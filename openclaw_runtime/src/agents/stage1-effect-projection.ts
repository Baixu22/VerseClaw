/**
 * Stage 1 projection from the existing digest-only effect_receipts row to the
 * logical EffectReceipt/v1 contract. The projection reads identifier/digest
 * facts only; it never reconstructs or exposes raw proposal, tool arguments,
 * or tool output.
 */
import type { EffectReceipt } from "../../../shared/types/context-control-plane/artifacts.js";
import {
  EFFECT_RECEIPT_SCHEMA_VERSION,
  parseStage1EffectContext,
  type EffectReceiptRow,
} from "./effect-receipt.js";

export type Stage1ProjectedEffectReceipt = EffectReceipt;

function optionalNonEmpty(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Project a Stage 1 EffectReceipt/v1 from an effect_receipts row. Returns
 * undefined for legacy rows that predate the Stage 1 identifier context or
 * for rows whose digest-only facts cannot satisfy the frozen contract.
 */
export function projectStage1EffectReceipt(
  row: EffectReceiptRow | undefined,
): Stage1ProjectedEffectReceipt | undefined {
  if (!row || row.schema_version !== EFFECT_RECEIPT_SCHEMA_VERSION) return undefined;
  const context = parseStage1EffectContext(row.effect_context_json);
  const actor = context.actor;
  const effect = context.effect;
  const policyDigest =
    typeof context.approvalPolicyDigest === "string" ? context.approvalPolicyDigest : undefined;
  const approvalId = optionalNonEmpty(row.approval_id);
  const approvalDecision = row.approval_decision === "approved" || row.approval_decision === "denied"
    ? row.approval_decision
    : undefined;
  const outcome =
    row.outcome === "applied" ||
    row.outcome === "not_applied" ||
    row.outcome === "unknown" ||
    row.outcome === "reconciled"
      ? row.outcome
      : undefined;
  const recoverability =
    row.recoverability === "none-needed" ||
    row.recoverability === "journal-replay" ||
    row.recoverability === "reconcile-from-journal"
      ? row.recoverability
      : undefined;
  if (
    !actor ||
    !effect ||
    !approvalId ||
    !approvalDecision ||
    !outcome ||
    !recoverability ||
    !policyDigest ||
    !isStage1Actor(actor) ||
    !isStage1Effect(effect)
  ) {
    return undefined;
  }
  return {
    schema: "EffectReceipt/v1",
    receiptId: row.effect_receipt_id,
    idempotencyKey: row.idempotency_key,
    approvalRef: {
      approvalId,
      decision: approvalDecision,
      policyDigest,
    },
    actor: {
      sessionKey: actor.sessionKey,
      runId: actor.runId,
      attemptIndex: actor.attemptIndex,
      modelCallIndex: actor.modelCallIndex,
      actorKind: actor.actorKind,
    },
    effect: {
      toolCallId: effect.toolCallId,
      toolName: effect.toolName,
      resource: effect.resource,
      action: effect.action,
    },
    outcome,
    proposalDigest: `sha256:${row.proposal_digest}`,
    ...(row.journal_ref ? { journalRef: row.journal_ref } : {}),
    ...(row.artifact_ref ? { artifactRef: row.artifact_ref } : {}),
    recoverability,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function isStage1Actor(value: unknown): value is {
  sessionKey: string;
  runId: string;
  attemptIndex: number;
  modelCallIndex: number;
  actorKind: "principal" | "delegate";
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actor = value as Record<string, unknown>;
  return (
    typeof actor.sessionKey === "string" &&
    typeof actor.runId === "string" &&
    typeof actor.attemptIndex === "number" &&
    typeof actor.modelCallIndex === "number" &&
    (actor.actorKind === "principal" || actor.actorKind === "delegate")
  );
}

function isStage1Effect(value: unknown): value is {
  toolCallId: string;
  toolName: string;
  resource: string;
  action: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const effect = value as Record<string, unknown>;
  return (
    typeof effect.toolCallId === "string" &&
    typeof effect.toolName === "string" &&
    typeof effect.resource === "string" &&
    typeof effect.action === "string"
  );
}
