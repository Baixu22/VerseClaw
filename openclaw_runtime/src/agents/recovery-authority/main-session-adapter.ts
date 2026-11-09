/**
 * TF-0714: main-session entry adapter.
 *
 * Reads the same facts the legacy path already reads and expresses them as a
 * `RecoveryAuthorityRequest`. It is intentionally pure: callers pass the
 * already-resolved values, so this module cannot become a second state owner or
 * a second recovery decider.
 *
 * Replay class for an "interrupted assistant turn" resume:
 *   - resumable assistant tail (aborted | toolUse) and no visible output yet
 *     -> an effect may or may not have happened -> `reconcile`;
 *   - non-resumable or stale approval-pending tail -> a blind re-execution
 *     would duplicate work, not recover it -> `unsafe`.
 */
import type {
  RecoveryAuthorityRequest,
  ReplayClass,
  EffectCertainty,
} from "../../../../shared/recovery-authority/contract.js";

export type MainSessionRecoveryFacts = {
  sessionKey: string;
  sessionId: string;
  runId?: string;
  /** Attempts already consumed, including failed ones. */
  attemptsConsumed: number;
  maxAttempts: number;
  /** Result of the existing transcript-tail boundary check. */
  resumable: boolean;
  /** The tail is a stale approval-pending tool result. */
  approvalPending: boolean;
  /** Any user-visible assistant output was already emitted for this turn. */
  visibleOutputObserved: boolean;
  /** A durable final-delivery intent is still pending for this session. */
  pendingFinalDelivery: boolean;
  /** Current effect classification read from the existing owner. */
  effect?: EffectCertainty;
  now?: number;
};

export function classifyMainSessionReplayClass(facts: MainSessionRecoveryFacts): ReplayClass {
  if (!facts.resumable || facts.approvalPending) return "unsafe";
  return "reconcile";
}

export function buildMainSessionRecoveryRequest(
  facts: MainSessionRecoveryFacts,
): RecoveryAuthorityRequest {
  const replayClass = classifyMainSessionReplayClass(facts);
  const now = facts.now ?? Date.now();
  return {
    requestId: `main-session:${facts.sessionId}`,
    entry: "main-session-restart",
    owner: {
      kind: "main-session",
      ownerId: facts.sessionId,
      sessionKey: facts.sessionKey,
      ...(facts.runId ? { runId: facts.runId } : {}),
    },
    admission: {
      trigger: "gateway-restart",
      requiredPreState: "aborted-last-run",
      admitted: facts.resumable && !facts.approvalPending,
      visibleOutputObserved: facts.visibleOutputObserved,
      reason: facts.approvalPending
        ? "stale approval-pending tool result"
        : facts.resumable
          ? "resumable assistant tail"
          : "non-resumable transcript tail",
    },
    budget: {
      attempts: { current: facts.attemptsConsumed, max: facts.maxAttempts },
      backoff: { initialMs: 5_000, multiplier: 2, maxMs: 40_000 },
      wedge: {
        afterAttempts: facts.maxAttempts,
        wedged: facts.attemptsConsumed >= facts.maxAttempts,
        reason: "automatic recovery budget exhausted",
      },
    },
    replayClass,
    // Pending text does not establish effect truth; the existing owner supplies it.
    effect: facts.effect ?? (replayClass === "unsafe" ? "not_applied" : "unknown"),
    requestedAction: facts.pendingFinalDelivery ? "deliver" : "resume",
    idempotencyKey: `main-session-restart-recovery:${facts.sessionId}`,
    evidence: [
      {
        kind: "transcript",
        ref: `session:${facts.sessionId}`,
        role: "evidence",
      },
    ],
    requestedAt: now,
  };
}
