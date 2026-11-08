/**
 * TF-0718 / TF-0719: execution-phase recovery decision.
 *
 * The committed execution phase is the only judge of "what already happened";
 * the domain journal is the only effect truth. This module is pure: it maps
 * (committed phase, resolved effect certainty) to one recovery action, and it
 * refuses to re-run an effect that may already be present.
 *
 * It never authorizes a replay from an effect receipt: receipts explain and
 * correlate, the journal decides.
 */
import {
  classifyReplay,
  type ExecutionPhase,
  type ReplayDisposition,
} from "../../../../shared/recovery-contract/execution-phase.js";

/** Effect truth, resolved by the caller from the domain journal/receipts. */
export type ResolvedEffectCertainty = "applied" | "not_applied" | "unknown" | "reconciled";

export type ExecutionRecoveryAction =
  | "resume-dispatch"
  | "reconcile"
  | "advance-commit"
  | "continue-verify"
  | "settle"
  | "quarantine"
  | "refuse";

export type ExecutionRecoveryDecision = {
  readonly phase: ExecutionPhase;
  readonly disposition: ReplayDisposition;
  readonly effect: ResolvedEffectCertainty;
  readonly action: ExecutionRecoveryAction;
  readonly replayAllowed: boolean;
  readonly reason: string;
  readonly evidenceRequired: readonly string[];
};

export type EffectFacts = {
  /** At least one durable intent record exists for this tool call. */
  readonly intentRecorded: boolean;
  /** Domain journal rows observed for the idempotency key. */
  readonly journalMatches: number;
  /** Effect receipt outcomes observed for the idempotency key (evidence only). */
  readonly receiptOutcomes: readonly ("applied" | "not_applied" | "unknown" | "reconciled")[];
};

/**
 * Resolve effect certainty. Journal presence wins; receipts corroborate but can
 * never promote an unknown effect to `applied` on their own.
 */
export function deriveEffectCertainty(facts: EffectFacts): ResolvedEffectCertainty {
  if (facts.journalMatches > 0) return "applied";
  // Receipts correlate evidence; they cannot prove either applied or not_applied.
  if (facts.receiptOutcomes.length > 0) return "unknown";
  if (facts.intentRecorded) return "unknown";
  return "not_applied";
}

export function decideExecutionRecovery(
  phase: ExecutionPhase,
  effect: ResolvedEffectCertainty,
): ExecutionRecoveryDecision {
  const disposition = classifyReplay(phase);
  const base = { phase, disposition, effect } as const;

  if (effect === "applied" || effect === "reconciled") {
    return {
      ...base,
      action: "advance-commit",
      replayAllowed: false,
      reason:
        "the effect is already present in the domain journal; advance the committed phase, never re-run",
      evidenceRequired: ["domain-journal"],
    };
  }

  if (effect === "unknown") {
    return {
      ...base,
      action: "quarantine",
      replayAllowed: false,
      reason: "effect certainty is unknown; keep the phase quarantined until the journal is read",
      evidenceRequired: ["domain-journal", "effect-receipt"],
    };
  }

  switch (disposition) {
    case "safe":
      return {
        ...base,
        action: phase === "admitted" ? "resume-dispatch" : "settle",
        replayAllowed: phase === "admitted",
        reason: "phase is replay-safe and the effect is not applied",
        evidenceRequired: [],
      };
    case "unsafe":
      return {
        ...base,
        action: "continue-verify",
        replayAllowed: false,
        reason: "the effect may already be present; continue verification, never re-run",
        evidenceRequired: ["domain-journal"],
      };
    case "reconcile":
    default:
      return {
        ...base,
        action: "reconcile",
        replayAllowed: false,
        reason: "phase is ambiguous; reconcile before any further action",
        evidenceRequired: ["domain-journal", "effect-receipt"],
      };
  }
}

/** The intent record that must be durable before a tool effect is executed. */
export type ToolIntentRecord = {
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly toolName: string;
  readonly phase: "dispatched";
  readonly recordedAt: number;
};

export function buildToolIntentRecord(input: {
  idempotencyKey: string;
  toolName: string;
  now: number;
}): ToolIntentRecord {
  return {
    intentId: `intent:${input.idempotencyKey}`,
    idempotencyKey: input.idempotencyKey,
    toolName: input.toolName,
    phase: "dispatched",
    recordedAt: input.now,
  };
}

/** An intent record is only useful if it is durable before the effect starts. */
export function isIntentBeforeEffect(
  intent: ToolIntentRecord | undefined,
  effectStartedAt: number | undefined,
): boolean {
  if (!intent) return false;
  if (effectStartedAt === undefined) return true;
  return intent.recordedAt <= effectStartedAt;
}
