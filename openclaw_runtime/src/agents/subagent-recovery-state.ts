/**
 * Subagent orphan recovery gate.
 *
 * Bounds automatic recovery attempts and tombstones repeatedly wedged session entries.
 */
import type { SessionEntry } from "../config/sessions.js";
import type { RecoveryOwnerAdmission } from "../../../shared/recovery-authority/contract.js";
import { buildRecoveryAdmissionKey } from "./recovery-authority/owner-admission.js";

export const SUBAGENT_RECOVERY_MAX_AUTOMATIC_ATTEMPTS = 2;
const SUBAGENT_RECOVERY_REWEDGE_WINDOW_MS = 2 * 60_000;

/** Compaction retains the admission's predecessor while advancing its transcript. */
export function matchesSubagentRecoveryGeneration(
  entry: SessionEntry | undefined,
  admission: RecoveryOwnerAdmission | undefined,
): boolean {
  if (!entry || !admission || admission.decision.entry !== "subagent-orphan") return false;
  const matches = (sessionId: string) =>
    admission.idempotencyKey ===
    buildRecoveryAdmissionKey("subagent-orphan", admission.ownerId, sessionId, admission.ownerId);
  return (
    matches(entry.sessionId) ||
    (entry.lifecycleRunId === admission.idempotencyKey &&
      (entry.usageFamilySessionIds?.some(matches) ?? false))
  );
}

/** The original registry row remains reserved until its admitted identity is reconciled. */
export function hasReservedSubagentRecovery(
  entry: SessionEntry | undefined,
  originalRunId: string,
): boolean {
  const admission = entry?.subagentRecovery?.authority;
  return Boolean(
    admission &&
    matchesSubagentRecoveryGeneration(entry, admission) &&
    admission.ownerId === originalRunId &&
    (admission.decision.kind === "resume" || admission.decision.effect === "unknown") &&
    ["pending", "accepted", "reconcile"].includes(admission.state) &&
    (!entry?.lifecycleRunId ||
      entry.lifecycleRunId === originalRunId ||
      entry.lifecycleRunId === admission.idempotencyKey),
  );
}

/** Decision returned before attempting automatic subagent orphan recovery. */
type SubagentRecoveryGate =
  | {
      allowed: true;
      nextAttempt: number;
    }
  | {
      allowed: false;
      reason: string;
      shouldMarkWedged: boolean;
    };

// Legacy attempts outside the rewedge window start a new small burst.
// An owned authority admission retains its durable count independently of time.
function isRecentRecoveryAttempt(entry: SessionEntry, now: number): boolean {
  const lastAttemptAt = entry.subagentRecovery?.lastAttemptAt;
  return (
    typeof lastAttemptAt === "number" &&
    Number.isFinite(lastAttemptAt) &&
    now - lastAttemptAt <= SUBAGENT_RECOVERY_REWEDGE_WINDOW_MS
  );
}

/** Returns true when recovery has been tombstoned for a session entry. */
export function isSubagentRecoveryWedgedEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const recovery = (entry as SessionEntry).subagentRecovery;
  return (
    typeof recovery?.wedgedAt === "number" &&
    Number.isFinite(recovery.wedgedAt) &&
    recovery.wedgedAt > 0
  );
}

/** Formats the operator-facing reason for a wedged recovery entry. */
export function formatSubagentRecoveryWedgedReason(entry: SessionEntry): string {
  return (
    entry.subagentRecovery?.wedgedReason?.trim() ||
    "subagent orphan recovery is tombstoned for this session"
  );
}

/** Checks whether automatic orphan recovery may run for this session entry. */
export function evaluateSubagentRecoveryGate(
  entry: SessionEntry,
  now: number,
): SubagentRecoveryGate {
  if (isSubagentRecoveryWedgedEntry(entry)) {
    return {
      allowed: false,
      reason: formatSubagentRecoveryWedgedReason(entry),
      shouldMarkWedged: false,
    };
  }

  const authority = entry.subagentRecovery?.authority;
  // Registry adoption changes the run id, not the interrupted task's budget.
  // Compaction may also advance its transcript while retaining this admission.
  const continuingAdmission =
    authority &&
    matchesSubagentRecoveryGeneration(entry, authority) &&
    (entry.lifecycleRunId === authority.ownerId ||
      entry.lifecycleRunId === authority.idempotencyKey);
  const previousAttempts = Math.max(
    continuingAdmission ? authority.attempts : 0,
    isRecentRecoveryAttempt(entry, now) ? (entry.subagentRecovery?.automaticAttempts ?? 0) : 0,
  );
  if (previousAttempts >= SUBAGENT_RECOVERY_MAX_AUTOMATIC_ATTEMPTS) {
    return {
      allowed: false,
      reason:
        `subagent orphan recovery blocked after ${previousAttempts} automatic resume attempts; ` +
        `run "openclaw tasks maintenance --apply" or "openclaw doctor --fix" to reconcile it`,
      shouldMarkWedged: true,
    };
  }

  return {
    allowed: true,
    nextAttempt: previousAttempts + 1,
  };
}

/** Records one accepted automatic orphan-recovery attempt. */
export function markSubagentRecoveryAttempt(params: {
  entry: SessionEntry;
  now: number;
  runId: string;
  attempt: number;
}): void {
  params.entry.subagentRecovery = {
    ...params.entry.subagentRecovery,
    automaticAttempts: Math.max(1, params.attempt),
    lastAttemptAt: params.now,
    lastRunId: params.runId,
  };
}

/** Tombstones automatic recovery until maintenance or doctor clears the state. */
export function markSubagentRecoveryWedged(params: {
  entry: SessionEntry;
  now: number;
  runId?: string;
  reason: string;
}): void {
  params.entry.abortedLastRun = false;
  params.entry.subagentRecovery = {
    ...params.entry.subagentRecovery,
    automaticAttempts: Math.max(
      params.entry.subagentRecovery?.automaticAttempts ?? 0,
      SUBAGENT_RECOVERY_MAX_AUTOMATIC_ATTEMPTS,
    ),
    lastAttemptAt: params.entry.subagentRecovery?.lastAttemptAt ?? params.now,
    ...(params.runId ? { lastRunId: params.runId } : {}),
    wedgedAt: params.now,
    wedgedReason: params.reason,
  };
  params.entry.updatedAt = params.now;
}

/** Clears stale abort state when a wedged entry should no longer look runnable. */
export function clearWedgedSubagentRecoveryAbort(entry: SessionEntry, now: number): boolean {
  if (!isSubagentRecoveryWedgedEntry(entry) || entry.abortedLastRun !== true) {
    return false;
  }
  entry.abortedLastRun = false;
  entry.updatedAt = now;
  return true;
}
