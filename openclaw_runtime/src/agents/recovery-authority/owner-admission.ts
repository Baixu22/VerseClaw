/** Owners commit this decision and attempt together before dispatch. */
import { createHash, randomUUID } from "node:crypto";
import type {
  RecoveryAuthorityRequest,
  RecoveryDecision,
  RecoveryEntryPoint,
  RecoveryOwnerAdmission,
  RecoveryAdmissionIdentity,
} from "../../../../shared/recovery-authority/contract.js";
import { recoveryAuthorityV1 } from "./authority.js";

export const RECOVERY_AUTHORITY_MODE_FLAG = "OPENCLAW_RECOVERY_AUTHORITY_MODE";
const OWNER_EPOCH = randomUUID();

export function getRecoveryAdmissionIdentity(
  record: RecoveryOwnerAdmission,
): RecoveryAdmissionIdentity {
  const { idempotencyKey, ownerId, attempts, ownerEpoch } = record;
  return { idempotencyKey, ownerId, attempts, ownerEpoch };
}

export function matchesRecoveryAdmission(
  current: RecoveryOwnerAdmission | undefined,
  expected: RecoveryAdmissionIdentity,
): boolean {
  return Boolean(
    current &&
    current.idempotencyKey === expected.idempotencyKey &&
    current.ownerId === expected.ownerId &&
    current.attempts === expected.attempts &&
    current.ownerEpoch === expected.ownerEpoch &&
    current.decision.kind === "resume" &&
    ["pending", "accepted", "reconcile"].includes(current.state),
  );
}

export function isCurrentRecoverySession(params: {
  sessionId?: string;
  lifecycleRunId?: string;
  requestedSessionId?: string;
  runId: string;
  admission?: RecoveryOwnerAdmission;
  expected: RecoveryAdmissionIdentity;
}): boolean {
  return Boolean(
    params.sessionId &&
    params.sessionId === params.requestedSessionId &&
    params.runId === params.expected.idempotencyKey &&
    matchesRecoveryAdmission(params.admission, params.expected) &&
    (!params.lifecycleRunId ||
      params.lifecycleRunId === params.expected.ownerId ||
      params.lifecycleRunId === params.runId),
  );
}

function previousOwnerExited(previous: RecoveryOwnerAdmission): boolean {
  if (
    previous.processId === process.pid ||
    !Number.isSafeInteger(previous.processId) ||
    previous.processId <= 0 ||
    !previous.ownerEpoch ||
    previous.ownerEpoch === OWNER_EPOCH
  )
    return false;
  try {
    process.kill(previous.processId, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

export function isRecoveryAuthorityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RECOVERY_AUTHORITY_MODE_FLAG]?.trim().toLowerCase() === "authority";
}

export function buildRecoveryAdmissionKey(
  entry: RecoveryEntryPoint,
  ownerId: string,
  generation: string,
  boundary: string,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([entry, ownerId, generation, boundary]))
    .digest("hex");
  return `recovery-${digest}`;
}

type AdmissionResult =
  | { admitted: true; decision: RecoveryDecision; record: RecoveryOwnerAdmission }
  | { admitted: false; decision: RecoveryDecision; record?: RecoveryOwnerAdmission };

/** Call inside the owner's transaction, using its current generation and saved record. */
export function prepareOwnerRecoveryAdmission(
  request: RecoveryAuthorityRequest,
  previous?: RecoveryOwnerAdmission,
): AdmissionResult {
  const saved =
    previous?.idempotencyKey === request.idempotencyKey &&
    previous.ownerId === request.owner.ownerId &&
    previous.decision.entry === request.entry
      ? previous
      : undefined;
  const attempts = saved?.attempts ?? request.budget.attempts.current;
  const budget = {
    ...request.budget,
    attempts: { ...request.budget.attempts, current: attempts },
    wedge: {
      ...request.budget.wedge,
      wedged: request.budget.wedge.wedged || saved?.state === "wedged",
    },
  };
  if (saved?.state === "settled") {
    return { admitted: false, decision: saved.decision, record: saved };
  }
  const settledEffect = request.effect === "applied" || request.effect === "reconciled";
  const stoppedUnstartedOwner =
    saved && request.effect === "not_applied" && previousOwnerExited(saved);
  if (
    saved &&
    ["pending", "accepted", "reconcile"].includes(saved.state) &&
    !settledEffect &&
    !stoppedUnstartedOwner
  ) {
    // An RPC error or process restart does not prove the admitted work never ran.
    // Controller death releases a claim only with owner-proven not_applied;
    // it never supplies effect truth for an uncertain external operation.
    return { admitted: false, decision: saved.decision, record: saved };
  }
  const decision = recoveryAuthorityV1.decide({ ...request, budget });
  if (decision.kind === "reject") return { admitted: false, decision };
  const admitted = ["resume", "replay", "deliver"].includes(decision.kind);
  const state: RecoveryOwnerAdmission["state"] = admitted
    ? "pending"
    : decision.kind === "settle"
      ? "settled"
      : decision.kind === "wedge" && decision.effect !== "unknown"
        ? "wedged"
        : "reconcile";
  const record: RecoveryOwnerAdmission = {
    idempotencyKey: request.idempotencyKey,
    ownerId: request.owner.ownerId,
    attempts: attempts + (admitted ? 1 : 0),
    state,
    decision,
    updatedAt: request.requestedAt,
    processId: process.pid,
    ownerEpoch: OWNER_EPOCH,
  };
  return admitted ? { admitted: true, decision, record } : { admitted: false, decision, record };
}

/** The owner also checks its generation; this protects the exact pending attempt. */
export function finishOwnerRecoveryAdmission(
  current: RecoveryOwnerAdmission | undefined,
  expected: RecoveryOwnerAdmission,
  state: "accepted" | "failed" | "reconcile",
  now = Date.now(),
): RecoveryOwnerAdmission | undefined {
  if (
    !current ||
    (current.state !== "pending" && current.state !== "reconcile") ||
    current.idempotencyKey !== expected.idempotencyKey ||
    current.ownerId !== expected.ownerId ||
    current.attempts !== expected.attempts ||
    current.ownerEpoch !== expected.ownerEpoch ||
    current.decision.entry !== expected.decision.entry
  ) {
    return undefined;
  }
  return { ...current, state, updatedAt: now };
}
