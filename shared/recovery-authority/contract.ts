/**
 * Frozen RecoveryAuthority contract v1 (TF-0713).
 *
 * This module is intentionally dependency-free: it has no imports, no I/O, no
 * process access, no timers, and no runtime wiring. It freezes the vocabulary
 * and fail-closed decision rules for the five existing recovery entries.
 *
 * Contract boundary:
 * - Existing runtime owners remain the only truth for session, run, task, and
 *   delivery state. This contract adds no store, daemon, database, or service.
 * - Effect receipts and event-log records are evidence only. They can explain or
 *   correlate an outcome, but they can never authorize replay.
 * - A receipt, event-log entry, or transcript never substitutes for domain
 *   journal effect truth.
 */

export const RECOVERY_AUTHORITY_CONTRACT_VERSION = 1 as const;
export type RecoveryAuthorityContractVersion = typeof RECOVERY_AUTHORITY_CONTRACT_VERSION;
export const RECOVERY_AUTHORITY_ID = "recovery-authority/v1" as const;
export type RecoveryAuthorityId = typeof RECOVERY_AUTHORITY_ID;

/** The five existing recovery entry points covered by the frozen contract. */
export type RecoveryEntryPoint =
  | "main-session-restart"
  | "subagent-orphan"
  | "goal-wake-durable"
  | "final-delivery"
  | "acp-runtime-resume";

/**
 * Stable owner of the state being recovered. The owner identity must already
 * exist in the owning subsystem; the RecoveryAuthority never invents an owner.
 */
export type RecoveryOwner =
  | {
      readonly kind: "main-session";
      readonly ownerId: string;
      readonly sessionKey: string;
      readonly runId?: string;
    }
  | {
      readonly kind: "subagent-run";
      readonly ownerId: string;
      readonly sessionKey: string;
      readonly runId: string;
    }
  | {
      readonly kind: "goal-wake";
      readonly ownerId: string;
      readonly missionId: string;
      readonly taskId: string;
      readonly runId?: string;
    }
  | {
      readonly kind: "final-delivery";
      readonly ownerId: string;
      readonly sessionKey: string;
      readonly deliveryId: string;
    }
  | {
      readonly kind: "acp-session";
      readonly ownerId: string;
      readonly sessionKey: string;
      readonly backend: string;
    };

/** Why an entry point is being asked to recover. */
export type RecoveryTrigger =
  | "gateway-restart"
  | "startup-stale-lock"
  | "scheduled-retry"
  | "runtime-error-before-output"
  | "pending-final-delivery"
  | "durable-helper-sweep"
  | "operator-request";

/** The authoritative pre-state that must be observed before admission. */
export type RecoveryRequiredPreState =
  | "aborted-last-run"
  | "active-subagent-run"
  | "queued-or-running-task"
  | "pending-final-delivery"
  | "missing-persistent-session"
  | "repeated-repair";

/**
 * Admission is a gate, not a hint. A recovery may proceed only when the
 * boundary says it is admitted and the owner pre-state is present.
 */
export type AdmissionBoundary = {
  readonly trigger: RecoveryTrigger;
  readonly requiredPreState: RecoveryRequiredPreState;
  readonly admitted: boolean;
  /**
   * Once any user-visible output has been observed, a new turn or replay is
   * forbidden. The request must reconcile or settle instead.
   */
  readonly visibleOutputObserved: boolean;
  readonly reason?: string;
};

/**
 * safe: replay is idempotent/read-only and may be retried.
 * unsafe: replay may repeat a side effect and must not run blindly.
 * reconcile: the effect is not decidable from the request; inspect the domain
 * journal/receipt correlation before any further action.
 */
export type ReplayClass = "safe" | "unsafe" | "reconcile";

/**
 * applied: the domain journal says the effect happened.
 * not_applied: the domain journal says it did not happen.
 * unknown: no durable effect truth is available.
 * reconciled: a prior reconciliation settled the effect state.
 */
export type EffectCertainty = "applied" | "not_applied" | "unknown" | "reconciled";

/** The action the caller wants the authority to authorize. */
export type RecoveryAction = "resume" | "replay" | "reconcile" | "deliver";

/** Evidence role is deliberately narrower than "authority". */
export type RecoveryEvidenceRole = "evidence" | "effect-truth";

/**
 * Evidence references are correlation inputs only unless explicitly marked as
 * domain-journal effect truth. The role matrix is validated at runtime by
 * `validateRecoveryAuthorityRequest`; effect receipts and event-log records
 * cannot be promoted to effect truth.
 */
export type RecoveryEvidenceRef =
  | {
      readonly kind: "event-log";
      readonly ref: string;
      readonly role: "evidence";
    }
  | {
      readonly kind: "effect-receipt";
      readonly ref: string;
      readonly role: "evidence";
    }
  | {
      readonly kind: "domain-journal";
      readonly ref: string;
      readonly role: "effect-truth";
    }
  | {
      readonly kind: "transcript";
      readonly ref: string;
      readonly role: "evidence";
    };

/**
 * Every recovery has a finite attempt budget. `wedge` is durable tombstone
 * state: once true, automatic recovery must not run again until an explicit
 * owner/maintenance transition clears it.
 */
export type RecoveryBudget = {
  readonly attempts: {
    /** Number of attempts already consumed, including failed attempts. */
    readonly current: number;
    /** Hard ceiling. Infinity/absent/zero is invalid. */
    readonly max: number;
  };
  readonly backoff: {
    readonly initialMs: number;
    readonly multiplier: number;
    readonly maxMs?: number;
  };
  readonly wedge: {
    readonly afterAttempts: number;
    readonly wedged: boolean;
    readonly reason?: string;
  };
};

/** A request is the complete, auditable input to one decision. */
export type RecoveryAuthorityRequest = {
  readonly requestId: string;
  readonly entry: RecoveryEntryPoint;
  readonly owner: RecoveryOwner;
  readonly admission: AdmissionBoundary;
  readonly budget: RecoveryBudget;
  readonly replayClass: ReplayClass;
  readonly effect: EffectCertainty;
  readonly requestedAction: RecoveryAction;
  /** Stable across retries of the same recovery. Required for dedupe. */
  readonly idempotencyKey: string;
  readonly evidence: readonly RecoveryEvidenceRef[];
  readonly requestedAt: number;
};

export type RecoveryDecisionKind =
  | "resume"
  | "replay"
  | "reconcile"
  | "deliver"
  | "settle"
  | "wedge"
  | "reject";

export type RecoveryDecisionBasis =
  | "owner-state"
  | "admission-boundary"
  | "effect-certainty"
  | "budget"
  | "replay-policy"
  | "invalid-request";

/**
 * Exactly one decision is returned for one request. `owner` is null only for a
 * fail-closed invalid-request rejection; every admitted decision names its owner.
 */
export type RecoveryDecision = {
  readonly contractVersion: RecoveryAuthorityContractVersion;
  readonly authorityId: RecoveryAuthorityId;
  readonly decisionId: string;
  readonly requestId: string;
  readonly entry: RecoveryEntryPoint;
  readonly owner: RecoveryOwner | null;
  readonly kind: RecoveryDecisionKind;
  readonly basis: RecoveryDecisionBasis;
  readonly replayClass: ReplayClass;
  readonly effect: EffectCertainty;
  readonly attempt: {
    readonly current: number;
    readonly max: number;
  };
  readonly reason: string;
  /** The decision may cite evidence, but evidence never becomes authority. */
  readonly evidenceOnly: true;
  readonly decidedAt: number;
};

/** A bounded admission record stored by the existing recovery owner. */
export type RecoveryOwnerAdmission = {
  readonly idempotencyKey: string;
  readonly ownerId: string;
  readonly attempts: number;
  readonly state: "pending" | "accepted" | "failed" | "reconcile" | "wedged" | "settled";
  readonly decision: RecoveryDecision;
  readonly updatedAt: number;
  readonly processId: number;
  readonly ownerEpoch: string;
};

/** Identifies the exact persisted admission carried across the existing RPC. */
export type RecoveryAdmissionIdentity = Pick<
  RecoveryOwnerAdmission,
  "idempotencyKey" | "ownerId" | "attempts" | "ownerEpoch"
>;

/**
 * The single decision surface. Implementations MUST NOT fan one request out to
 * multiple independent recovery decisions; entry adapters supply facts, and the
 * authority returns one decision.
 */
export interface RecoveryAuthority {
  readonly contractVersion: RecoveryAuthorityContractVersion;
  readonly id: RecoveryAuthorityId;
  decide(request: RecoveryAuthorityRequest): RecoveryDecision;
}

export type RecoveryRequestValidation =
  | { readonly ok: true; readonly request: RecoveryAuthorityRequest }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecoveryEntryPoint(value: unknown): value is RecoveryEntryPoint {
  return (
    value === "main-session-restart" ||
    value === "subagent-orphan" ||
    value === "goal-wake-durable" ||
    value === "final-delivery" ||
    value === "acp-runtime-resume"
  );
}

function isRecoveryOwner(value: unknown): value is RecoveryOwner {
  if (!isRecord(value) || !isNonEmptyString(value.ownerId) || !isNonEmptyString(value.kind)) {
    return false;
  }
  switch (value.kind) {
    case "main-session":
      return isNonEmptyString(value.sessionKey) && (value.runId === undefined || isNonEmptyString(value.runId));
    case "subagent-run":
      return isNonEmptyString(value.sessionKey) && isNonEmptyString(value.runId);
    case "goal-wake":
      return (
        isNonEmptyString(value.missionId) &&
        isNonEmptyString(value.taskId) &&
        (value.runId === undefined || isNonEmptyString(value.runId))
      );
    case "final-delivery":
      return isNonEmptyString(value.sessionKey) && isNonEmptyString(value.deliveryId);
    case "acp-session":
      return isNonEmptyString(value.sessionKey) && isNonEmptyString(value.backend);
    default:
      return false;
  }
}

function isAdmissionBoundary(value: unknown): value is AdmissionBoundary {
  if (!isRecord(value)) return false;
  const trigger = value.trigger;
  const preState = value.requiredPreState;
  return (
    (trigger === "gateway-restart" ||
      trigger === "startup-stale-lock" ||
      trigger === "scheduled-retry" ||
      trigger === "runtime-error-before-output" ||
      trigger === "pending-final-delivery" ||
      trigger === "durable-helper-sweep" ||
      trigger === "operator-request") &&
    (preState === "aborted-last-run" ||
      preState === "active-subagent-run" ||
      preState === "queued-or-running-task" ||
      preState === "pending-final-delivery" ||
      preState === "missing-persistent-session" ||
      preState === "repeated-repair") &&
    typeof value.admitted === "boolean" &&
    typeof value.visibleOutputObserved === "boolean" &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

function isRecoveryBudget(value: unknown): value is RecoveryBudget {
  if (
    !isRecord(value) ||
    !isRecord(value.attempts) ||
    !isRecord(value.backoff) ||
    !isRecord(value.wedge)
  ) {
    return false;
  }
  const attempts = value.attempts;
  const backoff = value.backoff;
  const wedge = value.wedge;
  if (
    !isFiniteInteger(attempts.current) ||
    !isFiniteInteger(attempts.max) ||
    attempts.current < 0 ||
    attempts.max < 1 ||
    attempts.current > attempts.max
  ) {
    return false;
  }
  if (
    !isNonNegativeFiniteNumber(backoff.initialMs) ||
    !isNonNegativeFiniteNumber(backoff.multiplier) ||
    backoff.multiplier < 1 ||
    (backoff.maxMs !== undefined &&
      (!isNonNegativeFiniteNumber(backoff.maxMs) || backoff.maxMs < backoff.initialMs))
  ) {
    return false;
  }
  return (
    isFiniteInteger(wedge.afterAttempts) &&
    wedge.afterAttempts >= 1 &&
    wedge.afterAttempts <= attempts.max &&
    typeof wedge.wedged === "boolean" &&
    (wedge.reason === undefined || typeof wedge.reason === "string")
  );
}

function isEvidenceRef(value: unknown): value is RecoveryEvidenceRef {
  if (!isRecord(value) || !isNonEmptyString(value.ref)) return false;
  switch (value.kind) {
    case "event-log":
    case "effect-receipt":
    case "transcript":
      return value.role === "evidence";
    case "domain-journal":
      return value.role === "effect-truth";
    default:
      return false;
  }
}

function isReplayClass(value: unknown): value is ReplayClass {
  return value === "safe" || value === "unsafe" || value === "reconcile";
}

function isEffectCertainty(value: unknown): value is EffectCertainty {
  return (
    value === "applied" || value === "not_applied" || value === "unknown" || value === "reconciled"
  );
}

function isRecoveryAction(value: unknown): value is RecoveryAction {
  return value === "resume" || value === "replay" || value === "reconcile" || value === "deliver";
}

/** Validates an unknown request and fails closed on any missing/wrong field. */
export function validateRecoveryAuthorityRequest(value: unknown): RecoveryRequestValidation {
  if (!isRecord(value)) {
    return { ok: false, reason: "request must be an object" };
  }
  if (!isNonEmptyString(value.requestId)) {
    return { ok: false, reason: "requestId must be a non-empty string" };
  }
  if (!isRecoveryEntryPoint(value.entry)) {
    return { ok: false, reason: "entry is not a known recovery entry point" };
  }
  if (!isRecoveryOwner(value.owner)) {
    return { ok: false, reason: "owner is missing or malformed" };
  }
  if (!isAdmissionBoundary(value.admission)) {
    return { ok: false, reason: "admission boundary is missing or malformed" };
  }
  if (!isRecoveryBudget(value.budget)) {
    return {
      ok: false,
      reason: "budget is missing or malformed; maxAttempts must be finite and non-zero",
    };
  }
  if (!isReplayClass(value.replayClass)) {
    return { ok: false, reason: "replayClass must be safe, unsafe, or reconcile" };
  }
  if (!isEffectCertainty(value.effect)) {
    return { ok: false, reason: "effect must be applied, not_applied, unknown, or reconciled" };
  }
  if (!isRecoveryAction(value.requestedAction)) {
    return { ok: false, reason: "requestedAction is not a known recovery action" };
  }
  if (!isNonEmptyString(value.idempotencyKey)) {
    return { ok: false, reason: "idempotencyKey must be a non-empty string" };
  }
  if (!Array.isArray(value.evidence) || !value.evidence.every(isEvidenceRef)) {
    return {
      ok: false,
      reason:
        "evidence must contain only event-log/effect-receipt/transcript evidence or domain-journal effect truth",
    };
  }
  if (!isNonNegativeFiniteNumber(value.requestedAt)) {
    return { ok: false, reason: "requestedAt must be a finite non-negative number" };
  }
  return { ok: true, request: value as RecoveryAuthorityRequest };
}

function hasDomainJournalTruth(evidence: readonly RecoveryEvidenceRef[]): boolean {
  return evidence.some((item) => item.kind === "domain-journal" && item.role === "effect-truth");
}

function makeDecision(params: {
  request: RecoveryAuthorityRequest;
  kind: RecoveryDecisionKind;
  basis: RecoveryDecisionBasis;
  reason: string;
}): RecoveryDecision {
  return {
    contractVersion: RECOVERY_AUTHORITY_CONTRACT_VERSION,
    authorityId: RECOVERY_AUTHORITY_ID,
    decisionId: `${params.request.requestId}:v${RECOVERY_AUTHORITY_CONTRACT_VERSION}`,
    requestId: params.request.requestId,
    entry: params.request.entry,
    owner: params.request.owner,
    kind: params.kind,
    basis: params.basis,
    replayClass: params.request.replayClass,
    effect: params.request.effect,
    attempt: {
      current: params.request.budget.attempts.current,
      max: params.request.budget.attempts.max,
    },
    reason: params.reason,
    evidenceOnly: true,
    decidedAt: params.request.requestedAt,
  };
}

function rejectInvalidRequest(input: unknown, reason: string): RecoveryDecision {
  const requestId =
    isRecord(input) && isNonEmptyString(input.requestId) ? input.requestId : "invalid-request";
  const entry =
    isRecord(input) && isRecoveryEntryPoint(input.entry) ? input.entry : "main-session-restart";
  return {
    contractVersion: RECOVERY_AUTHORITY_CONTRACT_VERSION,
    authorityId: RECOVERY_AUTHORITY_ID,
    decisionId: `${requestId}:invalid`,
    requestId,
    entry,
    owner: null,
    kind: "reject",
    basis: "invalid-request",
    replayClass: "reconcile",
    effect: "unknown",
    attempt: { current: 0, max: 0 },
    reason,
    evidenceOnly: true,
    decidedAt: 0,
  };
}

/**
 * Pure decision function shared by owner admission and shadow evaluation.
 * Known outcomes settle before budgeting another attempt; admission and effect
 * certainty govern whether the existing owner may continue.
 */
export function evaluateRecoveryRequest(input: unknown): RecoveryDecision {
  const validation = validateRecoveryAuthorityRequest(input);
  if (!validation.ok) {
    return rejectInvalidRequest(input, validation.reason);
  }
  const request = validation.request;
  const { current, max } = request.budget.attempts;

  // A known outcome needs no new attempt. Exhaustion must not hide an effect
  // already settled by its owner or turn a delivered result into a failure.
  if (
    request.admission.admitted &&
    (request.effect === "applied" || request.effect === "reconciled")
  ) {
    return makeDecision({
      request,
      kind: "settle",
      basis: "effect-certainty",
      reason: "effect is already settled; replay is forbidden",
    });
  }

  if (request.budget.wedge.wedged || current >= max) {
    return makeDecision({
      request,
      kind: "wedge",
      basis: "budget",
      reason: request.budget.wedge.reason ?? "recovery attempt budget is exhausted or wedged",
    });
  }

  if (!request.admission.admitted) {
    return makeDecision({
      request,
      kind: "reject",
      basis: "admission-boundary",
      reason: request.admission.reason ?? "admission boundary rejected the recovery request",
    });
  }

  if (request.admission.visibleOutputObserved && request.requestedAction !== "deliver") {
    return makeDecision({
      request,
      kind: "reconcile",
      basis: "admission-boundary",
      reason: "visible output was already observed; resume/replay is forbidden, reconcile instead",
    });
  }

  if (request.effect === "unknown") {
    return makeDecision({
      request,
      kind: "reconcile",
      basis: "effect-certainty",
      reason: "effect certainty is unknown; reconcile against the domain journal before replay",
    });
  }

  if (request.requestedAction === "deliver") {
    return makeDecision({
      request,
      kind: "deliver",
      basis: "owner-state",
      reason: "final delivery is owned by the existing delivery path",
    });
  }

  if (request.requestedAction === "replay") {
    if (request.replayClass !== "safe") {
      return makeDecision({
        request,
        kind: "reject",
        basis: "replay-policy",
        reason: "replay requires replayClass=safe",
      });
    }
    if (!hasDomainJournalTruth(request.evidence)) {
      return makeDecision({
        request,
        kind: "reject",
        basis: "replay-policy",
        reason:
          "effect receipt, event-log, and transcript are evidence only; replay requires domain-journal effect truth",
      });
    }
    return makeDecision({
      request,
      kind: "replay",
      basis: "owner-state",
      reason: "safe replay is authorized by the owner state and domain journal",
    });
  }

  if (request.requestedAction === "reconcile") {
    return makeDecision({
      request,
      kind: "reconcile",
      basis: "effect-certainty",
      reason: "caller requested reconciliation",
    });
  }

  return makeDecision({
    request,
    kind: "resume",
    basis: "owner-state",
    reason: "owner state and admission boundary permit a resumed turn",
  });
}
