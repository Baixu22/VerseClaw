/** Main-session decisions and output observations commit in the existing Session owner. */
import type {
  RecoveryAdmissionIdentity,
  RecoveryOwnerAdmission,
} from "../../../../shared/recovery-authority/contract.js";
import {
  updateSessionStoreAtomic,
  loadSessionStore,
  mergeSessionEntryWithPolicy,
  type SessionEntry,
} from "../../config/sessions.js";
import type { ExecutionPhaseRecovery } from "../execution-phase/recovery.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { derivePersistedSessionLifecyclePatch } from "../../gateway/session-lifecycle-state.js";
import { isCliProvider } from "../model-selection-cli.js";
import {
  isAcpSessionKey,
  isCronSessionKey,
  isSubagentSessionKey,
} from "../../routing/session-key.js";
import { buildMainSessionRecoveryRequest } from "./main-session-adapter.js";
import {
  buildRecoveryAdmissionKey,
  finishOwnerRecoveryAdmission,
  getRecoveryAdmissionIdentity,
  isRecoveryAuthorityEnabled,
  isCurrentRecoverySession,
  matchesRecoveryAdmission,
  prepareOwnerRecoveryAdmission,
} from "./owner-admission.js";

export type MainRecoveryAdmission =
  | { kind: "admitted"; record: RecoveryOwnerAdmission }
  | { kind: "reconcile" | "wedged" | "stale" | "rejected"; reason: string };

class MainSessionOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MainSessionOwnershipError";
  }
}

/** Saved uncertainty remains reserved when the authority-mode gate is rolled back. */
export function hasRetainedMainSessionRecovery(entry: SessionEntry): boolean {
  const recovery = entry.restartRecovery;
  const saved = recovery?.authority;
  const owner = saved?.decision.owner;
  const ownerRunId = owner && "runId" in owner ? owner.runId : undefined;
  const sameGeneration =
    recovery &&
    (recovery.sessionId === entry.sessionId ||
      (entry.lifecycleRunId === recovery.runId &&
        entry.usageFamilySessionIds?.includes(recovery.sessionId)));
  const reserved = Boolean(
    saved &&
    sameGeneration &&
    saved.idempotencyKey === recovery?.runId &&
    saved.ownerId === recovery?.sessionId &&
    saved.decision.entry === "main-session-restart" &&
    (saved.decision.kind === "resume" || saved.decision.effect === "unknown") &&
    ["pending", "accepted", "reconcile"].includes(saved.state) &&
    (!entry.lifecycleRunId ||
      entry.lifecycleRunId === ownerRunId ||
      entry.lifecycleRunId === recovery?.runId),
  );
  const output = entry.recoveryOutput;
  const uncertainOutput = Boolean(
    output &&
    output.effect === "unknown" &&
    output.runId === entry.lifecycleRunId &&
    (output.sessionId === entry.sessionId ||
      entry.usageFamilySessionIds?.includes(output.sessionId)),
  );
  return reserved || uncertainOutput;
}

/** Native and CLI attempts initialize the same Session lifecycle owner before execution. */
export async function beginMainSessionRun(params: {
  storePath: string;
  sessionKey: string;
  sessionId: string;
  runId: string;
  expectedRunId?: string;
  startedAt: number;
  outputBoundaryGuarded?: boolean;
  recoveryAdmission?: RecoveryAdmissionIdentity;
}): Promise<void> {
  await updateSessionStoreAtomic(params.storePath, (store) => {
    const current = store[params.sessionKey];
    const saved = current?.restartRecovery?.authority;
    const recoveryRun =
      params.recoveryAdmission || current?.restartRecovery?.runId === params.runId;
    const expectedAdmission =
      params.recoveryAdmission ?? (saved ? getRecoveryAdmissionIdentity(saved) : undefined);
    const recoveryOwner = saved?.decision.owner;
    const recoveryMatches =
      !recoveryRun ||
      Boolean(
        expectedAdmission &&
        saved?.decision.entry === "main-session-restart" &&
        recoveryOwner?.kind === "main-session" &&
        recoveryOwner.sessionKey === params.sessionKey &&
        isCurrentRecoverySession({
          sessionId: current?.sessionId,
          requestedSessionId: params.sessionId,
          lifecycleRunId: current?.lifecycleRunId,
          status: current?.status,
          abortedLastRun: current?.abortedLastRun,
          runId: params.runId,
          admission: saved,
          expected: expectedAdmission,
        }),
      );
    if (
      !current ||
      !recoveryMatches ||
      current.sessionId !== params.sessionId ||
      (current.status === "running" &&
        current.abortedLastRun !== true &&
        current.lifecycleRunId !== params.runId) ||
      (current.lifecycleRunId !== params.runId &&
        current.lifecycleRunId !== params.expectedRunId) ||
      (current.lifecycleRunId !== params.runId &&
        typeof current.startedAt === "number" &&
        current.startedAt > params.startedAt)
    ) {
      throw new MainSessionOwnershipError("main run no longer owns the session start");
    }
    const output =
      current.recoveryOutput?.runId === params.runId ? current.recoveryOutput : undefined;
    if (
      params.outputBoundaryGuarded !== false &&
      current.status === "running" &&
      current.lifecycleRunId === params.runId &&
      output
    )
      return;
    Object.assign(
      current,
      derivePersistedSessionLifecyclePatch({
        entry: current,
        event: {
          runId: params.runId,
          sessionId: params.sessionId,
          ts: params.startedAt,
          data: { phase: "start", startedAt: params.startedAt },
        },
      }),
    );
    current.recoveryOutput =
      params.outputBoundaryGuarded !== false && output
        ? output
        : {
            sessionId: params.sessionId,
            runId: params.runId,
            effect: params.outputBoundaryGuarded === false ? "unknown" : "not_applied",
            visibleOutputObserved: output?.visibleOutputObserved === true,
          };
  });
}

/** Explicit visible Session bindings cross this boundary before unguarded runtimes execute. */
export async function beginUnguardedMainSessionRun(params: {
  sessionStorePath?: string;
  sessionKey?: string;
  sessionId?: string;
  runId: string;
  recoveryAdmission?: RecoveryAdmissionIdentity;
}): Promise<void> {
  if (
    !isRecoveryAuthorityEnabled() ||
    !params.sessionStorePath ||
    !params.sessionKey ||
    !params.sessionId ||
    isSubagentSessionKey(params.sessionKey) ||
    isAcpSessionKey(params.sessionKey) ||
    isCronSessionKey(params.sessionKey)
  )
    return;
  const current = loadSessionStore(params.sessionStorePath, { skipCache: true })[params.sessionKey];
  await beginMainSessionRun({
    storePath: params.sessionStorePath,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    runId: params.runId,
    expectedRunId: current?.lifecycleRunId,
    startedAt: Date.now(),
    outputBoundaryGuarded: false,
    recoveryAdmission: params.recoveryAdmission,
  });
}

export async function admitMainSessionRecovery(params: {
  entry: SessionEntry;
  storePath: string;
  sessionKey: string;
  boundary: string;
  phase: ExecutionPhaseRecovery;
  resumeBlockReason: string | null;
  maxAttempts: number;
  cfg?: OpenClawConfig;
}): Promise<MainRecoveryAdmission> {
  return await updateSessionStoreAtomic(params.storePath, (store): MainRecoveryAdmission => {
    const current = store[params.sessionKey];
    if (
      !current ||
      current.sessionId !== params.entry.sessionId ||
      current.lifecycleRunId !== params.entry.lifecycleRunId ||
      current.abortedLastRun !== true
    )
      return { kind: "stale", reason: "main recovery owner changed" };
    const savedRecovery = current.restartRecovery;
    const transferred =
      savedRecovery &&
      current.lifecycleRunId === savedRecovery.runId &&
      (current.sessionId === savedRecovery.sessionId ||
        current.usageFamilySessionIds?.includes(savedRecovery.sessionId));
    const prior =
      savedRecovery &&
      (transferred ||
        (savedRecovery.sessionId === current.sessionId &&
          savedRecovery.boundary === params.boundary))
        ? savedRecovery
        : undefined;
    const output = current.recoveryOutput;
    const observed = Boolean(
      output &&
      current.lifecycleRunId &&
      output.runId === current.lifecycleRunId &&
      (output.sessionId === current.sessionId ||
        current.usageFamilySessionIds?.includes(output.sessionId)),
    );
    const pendingOwned = Boolean(
      current.lifecycleRunId &&
      (current.pendingFinalDeliveryRunId === current.lifecycleRunId ||
        current.pendingFinalDeliveryRecoveryRunId === current.lifecycleRunId),
    );
    const pendingFinal =
      pendingOwned && Boolean(current.pendingFinalDelivery || current.pendingFinalDeliveryText);
    const unsupportedRuntime =
      current.acp ||
      (current.agentRuntimeOverride && current.agentRuntimeOverride !== "openclaw") ||
      (current.agentHarnessId && current.agentHarnessId !== "openclaw") ||
      (current.modelProvider && isCliProvider(current.modelProvider, params.cfg));
    const effect =
      unsupportedRuntime ||
      params.phase.action === "reconcile" ||
      pendingFinal ||
      !observed ||
      output?.effect !== "not_applied"
        ? "unknown"
        : "not_applied";
    const originalSessionId = prior?.sessionId ?? current.sessionId;
    const key =
      prior?.runId ??
      buildRecoveryAdmissionKey(
        "main-session-restart",
        current.sessionId,
        current.sessionId,
        params.boundary,
      );
    const request = buildMainSessionRecoveryRequest({
      sessionKey: params.sessionKey,
      sessionId: originalSessionId,
      runId:
        prior?.authority?.decision.owner && "runId" in prior.authority.decision.owner
          ? prior.authority.decision.owner.runId
          : current.lifecycleRunId,
      attemptsConsumed: prior?.attempts ?? 0,
      maxAttempts: params.maxAttempts,
      resumable: !params.resumeBlockReason,
      approvalPending: Boolean(params.resumeBlockReason?.includes("approval-pending")),
      visibleOutputObserved: observed && output?.visibleOutputObserved === true,
      pendingFinalDelivery: pendingFinal,
      effect,
    });
    const prepared = prepareOwnerRecoveryAdmission(
      { ...request, requestId: key, idempotencyKey: key },
      prior?.authority,
    );
    if (prepared.record) {
      current.restartRecovery = {
        sessionId: originalSessionId,
        boundary: prior?.boundary ?? params.boundary,
        runId: key,
        attempts: prepared.record.attempts,
        state: prepared.admitted
          ? "admitted"
          : prepared.record.state === "wedged"
            ? "wedged"
            : "reconcile",
        authority: prepared.record,
      };
      current.updatedAt = prepared.record.updatedAt;
      if (prepared.record.state === "wedged") {
        current.status = "failed";
        current.endedAt = prepared.record.updatedAt;
      }
    }
    if (prepared.admitted) return { kind: "admitted", record: prepared.record };
    if (prepared.decision.kind === "reject")
      return { kind: "rejected", reason: prepared.decision.reason };
    return {
      kind: prepared.record?.state === "wedged" ? "wedged" : "reconcile",
      reason: prepared.decision.reason,
    };
  });
}

export async function finishMainSessionRecovery(params: {
  entry: SessionEntry;
  storePath: string;
  sessionKey: string;
  record: RecoveryOwnerAdmission;
  state: "accepted" | "reconcile";
}): Promise<boolean> {
  return await updateSessionStoreAtomic(params.storePath, (store) => {
    const current = store[params.sessionKey];
    const saved = current?.restartRecovery?.authority;
    if (
      !current ||
      !saved ||
      (current.sessionId !== params.entry.sessionId &&
        !(
          current.lifecycleRunId === params.record.idempotencyKey &&
          current.usageFamilySessionIds?.includes(params.entry.sessionId)
        )) ||
      !matchesRecoveryAdmission(saved, getRecoveryAdmissionIdentity(params.record)) ||
      (current.lifecycleRunId !== params.entry.lifecycleRunId &&
        current.lifecycleRunId !== params.record.idempotencyKey)
    )
      return false;
    const finished = finishOwnerRecoveryAdmission(saved, params.record, params.state);
    if (!finished || !current.restartRecovery) return false;
    current.restartRecovery = {
      ...current.restartRecovery,
      state: params.state,
      authority: finished,
    };
    current.updatedAt = finished.updatedAt;
    // Lifecycle start/terminal writers own the abort marker; an ACK cannot clear a later interruption.
    return true;
  });
}

export async function recordMainSessionOutputBoundary(params: {
  storePath: string;
  sessionKey: string;
  sessionId: string;
  runId: string;
  observed?: boolean;
}): Promise<void> {
  await updateSessionStoreAtomic(params.storePath, (store) => {
    const current = store[params.sessionKey];
    const sameGeneration =
      current?.sessionId === params.sessionId ||
      (current?.recoveryOutput?.runId === params.runId &&
        current.usageFamilySessionIds?.includes(params.sessionId));
    if (!current || !sameGeneration || current.lifecycleRunId !== params.runId) {
      throw new MainSessionOwnershipError("visible output no longer owns the session");
    }
    current.recoveryOutput = {
      sessionId: current.sessionId,
      runId: params.runId,
      effect: "unknown",
      visibleOutputObserved:
        params.observed === true || current.recoveryOutput?.visibleOutputObserved === true,
    };
  });
}

/** Called before the runner adopts the successor transcript and schedules another attempt. */
export async function transferMainSessionCompaction(params: {
  storePath: string;
  sessionKey: string;
  previousSessionId: string;
  sessionId: string;
  sessionFile?: string;
  runId: string;
}): Promise<SessionEntry> {
  return await updateSessionStoreAtomic(params.storePath, (store) => {
    const current = store[params.sessionKey];
    if (
      !current ||
      current.lifecycleRunId !== params.runId ||
      (current.sessionId !== params.previousSessionId && current.sessionId !== params.sessionId)
    ) {
      throw new MainSessionOwnershipError("compaction no longer owns the main session");
    }
    if (current.sessionId === params.sessionId) return current;
    store[params.sessionKey] = mergeSessionEntryWithPolicy(
      current,
      {
        sessionId: params.sessionId,
        ...(params.sessionFile ? { sessionFile: params.sessionFile } : {}),
        usageFamilyKey: current.usageFamilyKey ?? params.sessionKey,
        usageFamilySessionIds: [
          ...new Set([
            ...(current.usageFamilySessionIds ?? []),
            params.previousSessionId,
            params.sessionId,
          ]),
        ],
      },
      { identityTransition: "compaction" },
    );
    return store[params.sessionKey];
  });
}
