/** Subagent owner adapter: observed facts and the existing Session SQLite commit. */
import type {
  RecoveryAuthorityRequest,
  RecoveryOwnerAdmission,
} from "../../../../shared/recovery-authority/contract.js";
import { updateSessionStoreAtomic, type SessionEntry } from "../../config/sessions.js";
import { resolveMainSessionResumeBlockReason } from "../main-session-restart-recovery-boundary.js";
import {
  authorizePendingToolRecovery,
  resolveExecutionPhaseRecovery,
} from "../execution-phase/recovery.js";
import { isExecutionPhaseWriterEnabled } from "../execution-phase/tool-boundary.js";
import {
  SUBAGENT_RECOVERY_MAX_AUTOMATIC_ATTEMPTS,
  evaluateSubagentRecoveryGate,
  markSubagentRecoveryAttempt,
  markSubagentRecoveryWedged,
  matchesSubagentRecoveryGeneration,
} from "../subagent-recovery-state.js";
import { replaceSubagentRunAfterSteer } from "../subagent-registry-steer-runtime.js";
import type { SubagentRunRecord } from "../subagent-registry.types.js";
import {
  buildRecoveryAdmissionKey,
  finishOwnerRecoveryAdmission,
  getRecoveryAdmissionIdentity,
  matchesRecoveryAdmission,
  prepareOwnerRecoveryAdmission,
} from "./owner-admission.js";

export type SubagentRecoveryAdmission =
  | { kind: "admitted"; record: RecoveryOwnerAdmission }
  | { kind: "failed"; reason: string; attempts: number }
  | { kind: "blocked"; reason: string }
  | { kind: "stale" | "busy" };

export async function admitSubagentRecovery(params: {
  storePath: string;
  sessionKey: string;
  sessionId: string;
  lifecycleRunId?: string;
  originalRunId: string;
  messages: unknown[];
  now: number;
  getCurrentRun: () => SubagentRunRecord | undefined;
}): Promise<SubagentRecoveryAdmission> {
  const phase = isExecutionPhaseWriterEnabled()
    ? resolveExecutionPhaseRecovery(
        params.sessionKey,
        process.env,
        {},
        { sessionId: params.sessionId, messages: params.messages },
      )
    : { action: "reconcile" as const, phases: [], reason: "durable tool writer disabled" };
  const boundaryBlock = resolveMainSessionResumeBlockReason(params.messages);
  const result = await updateSessionStoreAtomic(
    params.storePath,
    (store): SubagentRecoveryAdmission => {
      const current = store[params.sessionKey];
      const activeRun = params.getCurrentRun();
      if (
        !current ||
        current.sessionId !== params.sessionId ||
        current.lifecycleRunId !== params.lifecycleRunId ||
        current.abortedLastRun !== true ||
        !activeRun ||
        activeRun.childSessionKey !== params.sessionKey ||
        activeRun.endedAt
      )
        return { kind: "stale" };
      const idempotencyKey = buildRecoveryAdmissionKey(
        "subagent-orphan",
        params.originalRunId,
        params.sessionId,
        params.originalRunId,
      );
      const gate = evaluateSubagentRecoveryGate(current, params.now);
      const attempts = gate.allowed
        ? gate.nextAttempt - 1
        : Math.max(
            current.subagentRecovery?.automaticAttempts ?? 0,
            SUBAGENT_RECOVERY_MAX_AUTOMATIC_ATTEMPTS,
          );
      const request: RecoveryAuthorityRequest = {
        requestId: idempotencyKey,
        entry: "subagent-orphan",
        owner: {
          kind: "subagent-run",
          ownerId: params.originalRunId,
          sessionKey: params.sessionKey,
          runId: params.originalRunId,
        },
        admission: {
          trigger: "gateway-restart",
          requiredPreState: "active-subagent-run",
          admitted: !boundaryBlock,
          visibleOutputObserved: false,
          reason: boundaryBlock ?? phase.reason,
        },
        budget: {
          attempts: { current: attempts, max: SUBAGENT_RECOVERY_MAX_AUTOMATIC_ATTEMPTS },
          backoff: { initialMs: 5000, multiplier: 2 },
          wedge: { afterAttempts: SUBAGENT_RECOVERY_MAX_AUTOMATIC_ATTEMPTS, wedged: !gate.allowed },
        },
        replayClass: "reconcile",
        effect: phase.action === "reconcile" ? "unknown" : "not_applied",
        requestedAction: "resume",
        idempotencyKey,
        evidence: [{ kind: "transcript", ref: "session:" + params.sessionId, role: "evidence" }],
        requestedAt: params.now,
      };
      const prepared = prepareOwnerRecoveryAdmission(request, current.subagentRecovery?.authority);
      if (prepared.record)
        current.subagentRecovery = { ...current.subagentRecovery, authority: prepared.record };
      if (prepared.record?.state === "wedged")
        markSubagentRecoveryWedged({
          entry: current,
          now: params.now,
          runId: params.originalRunId,
          reason: prepared.decision.reason,
        });
      if (prepared.admitted) {
        markSubagentRecoveryAttempt({
          entry: current,
          now: params.now,
          runId: params.originalRunId,
          attempt: prepared.record.attempts,
        });
        return { kind: "admitted", record: prepared.record };
      }
      if (prepared.record?.state === "wedged")
        return {
          kind: "failed",
          reason: prepared.decision.reason,
          attempts: prepared.record.attempts,
        };
      if (prepared.record?.state === "reconcile")
        return {
          kind: "blocked",
          reason: "recovery outcome requires owner reconciliation; no automatic replay",
        };
      if (prepared.decision.kind === "reject")
        return { kind: "blocked", reason: prepared.decision.reason };
      return { kind: "busy" };
    },
  );
  if (result.kind === "admitted" && phase.action === "resume")
    authorizePendingToolRecovery({
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      messages: params.messages,
    });
  return result;
}

/** A durable lifecycle stamp can recover an accepted RPC whose response was lost. */
export async function reconcileAcceptedOrphanRun(params: {
  entry: SessionEntry;
  storePath: string;
  sessionKey: string;
  originalRunId: string;
  originalRun: SubagentRunRecord;
}): Promise<boolean> {
  const admission = params.entry.subagentRecovery?.authority;
  if (
    !admission ||
    admission.ownerId !== params.originalRunId ||
    !matchesSubagentRecoveryGeneration(params.entry, admission) ||
    params.entry.lifecycleRunId !== admission.idempotencyKey
  )
    return false;
  return commitAcceptedSubagentRecovery({
    ...params,
    admission,
    runId: admission.idempotencyKey,
  });
}

/** The durable lifecycle start precedes registry adoption, including an early ACK. */
export async function commitAcceptedSubagentRecovery(params: {
  entry: SessionEntry;
  storePath: string;
  sessionKey: string;
  originalRunId: string;
  originalRun: SubagentRunRecord;
  admission: RecoveryOwnerAdmission;
  runId: string;
}): Promise<boolean> {
  return await updateSessionStoreAtomic(params.storePath, (store) => {
    const current = store[params.sessionKey];
    const saved = current?.subagentRecovery?.authority;
    const key = params.admission.idempotencyKey;
    if (
      !current ||
      !saved ||
      params.runId !== key ||
      params.admission.ownerId !== params.originalRunId ||
      !matchesRecoveryAdmission(saved, getRecoveryAdmissionIdentity(params.admission)) ||
      !matchesSubagentRecoveryGeneration(current, saved) ||
      (current.sessionId !== params.entry.sessionId &&
        !current.usageFamilySessionIds?.includes(params.entry.sessionId)) ||
      current.lifecycleRunId !== key
    )
      return false;
    const remapped = replaceSubagentRunAfterSteer({
      previousRunId: params.originalRunId,
      nextRunId: key,
      fallback: params.originalRun,
      startedAt: current.startedAt,
    });
    if (!remapped) {
      const uncertain = finishOwnerRecoveryAdmission(saved, params.admission, "reconcile");
      if (uncertain)
        current.subagentRecovery = { ...current.subagentRecovery, authority: uncertain };
      return false;
    }
    const finished = finishOwnerRecoveryAdmission(saved, params.admission, "accepted");
    if (finished) {
      current.subagentRecovery = { ...current.subagentRecovery, authority: finished };
      current.updatedAt = finished.updatedAt;
    }
    // The new run may itself have been interrupted. Its abort marker belongs
    // to that run and must remain available to the next owner scan.
    return true;
  });
}
