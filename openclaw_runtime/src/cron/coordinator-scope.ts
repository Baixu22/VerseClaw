/**
 * E1 — long-session follow-up scope fence.
 *
 * A scheduled follow-up may be bound to one explicit long-session coordinator
 * (Workspace + SessionKey + physical generation). This module owns only the
 * decision of whether such a bound job may still run; it never schedules,
 * delivers, stores or cancels anything by itself. Unbound jobs are unaffected.
 */
export const CRON_COORDINATOR_SCOPE_SCHEMA = "CronCoordinatorScope/v1";

export type CronCoordinatorScope = {
  schemaVersion: typeof CRON_COORDINATOR_SCOPE_SCHEMA;
  /** Workspace that owns the coordinator binding. */
  workspaceId: string;
  /** Logical long-session conversation the follow-up belongs to. */
  coordinatorSessionKey: string;
  /** Physical session generation recorded when the follow-up was authorized. */
  expectedSessionId: string;
  taskRef?: { kind: "task-ledger"; nodeId: string } | null;
  intent: "follow-up" | "check-in" | "status";
  /** Optional hard deadline; after this the follow-up must not run. */
  expiresAtMs?: number | null;
  notificationPolicy: "silent-unless-result" | "errors-and-decisions";
};

export type CronCoordinatorGateState =
  | "allowed"
  | "unbound"
  | "malformed"
  | "expired"
  | "session-missing"
  | "generation-mismatch"
  | "unverifiable";

export type CronCoordinatorGateVerdict = {
  allowed: boolean;
  state: CronCoordinatorGateState;
  reason: string;
  expectedSessionId?: string;
  observedSessionId?: string | null;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Validate an untrusted scope value (config, RPC patch, persisted store).
 * Returns undefined when the value is absent, null when it is present but
 * malformed (the fence must fail closed on null).
 */
export function normalizeCronCoordinatorScope(value: unknown): CronCoordinatorScope | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const workspaceId = nonEmptyString(raw.workspaceId);
  const coordinatorSessionKey = nonEmptyString(raw.coordinatorSessionKey);
  const expectedSessionId = nonEmptyString(raw.expectedSessionId);
  const intent = raw.intent;
  const notificationPolicy = raw.notificationPolicy;
  if (
    !workspaceId
    || !coordinatorSessionKey
    || !expectedSessionId
    || (intent !== "follow-up" && intent !== "check-in" && intent !== "status")
    || (notificationPolicy !== "silent-unless-result" && notificationPolicy !== "errors-and-decisions")
  ) {
    return null;
  }
  const taskRefRaw = raw.taskRef;
  let taskRef: CronCoordinatorScope["taskRef"];
  if (taskRefRaw && typeof taskRefRaw === "object" && !Array.isArray(taskRefRaw)) {
    const nodeId = nonEmptyString((taskRefRaw as Record<string, unknown>).nodeId);
    if ((taskRefRaw as Record<string, unknown>).kind === "task-ledger" && nodeId) {
      taskRef = { kind: "task-ledger", nodeId };
    }
  } else if (taskRefRaw === null) {
    taskRef = null;
  }
  const expiresAtMs = typeof raw.expiresAtMs === "number" && Number.isFinite(raw.expiresAtMs) ? raw.expiresAtMs : null;
  return {
    schemaVersion: CRON_COORDINATOR_SCOPE_SCHEMA,
    workspaceId,
    coordinatorSessionKey,
    expectedSessionId,
    taskRef: taskRef ?? null,
    intent,
    expiresAtMs,
    notificationPolicy,
  };
}

/**
 * The delivery-time fence. `liveSessionId` must come from the session store at
 * run time: undefined means the lookup itself was impossible (fail closed),
 * null means the coordinator session no longer exists.
 */
export function evaluateCronCoordinatorScope(params: {
  /** Raw scope as persisted on the job; undefined/null means an unbound job. */
  scope?: unknown;
  nowMs: number;
  liveSessionId?: string | null;
  /** Optional binding state when the caller can read the workspace binding. */
  bindingState?: "active" | "invalidated" | null;
}): CronCoordinatorGateVerdict {
  const normalized = normalizeCronCoordinatorScope(params.scope);
  if (normalized === undefined) {
    return { allowed: true, state: "unbound", reason: "job is not bound to a long-session coordinator" };
  }
  if (normalized === null) {
    return { allowed: false, state: "malformed", reason: "coordinator scope is present but malformed" };
  }
  if (params.bindingState === "invalidated") {
    return {
      allowed: false,
      state: "unverifiable",
      reason: "coordinator binding is invalidated",
      expectedSessionId: normalized.expectedSessionId,
      observedSessionId: params.liveSessionId ?? null,
    };
  }
  if (typeof normalized.expiresAtMs === "number" && params.nowMs >= normalized.expiresAtMs) {
    return {
      allowed: false,
      state: "expired",
      reason: "follow-up deadline passed",
      expectedSessionId: normalized.expectedSessionId,
      observedSessionId: params.liveSessionId ?? null,
    };
  }
  if (params.liveSessionId === undefined) {
    return {
      allowed: false,
      state: "unverifiable",
      reason: "live session generation could not be resolved",
      expectedSessionId: normalized.expectedSessionId,
      observedSessionId: null,
    };
  }
  if (params.liveSessionId === null) {
    return {
      allowed: false,
      state: "session-missing",
      reason: "coordinator session is archived, deleted or otherwise absent",
      expectedSessionId: normalized.expectedSessionId,
      observedSessionId: null,
    };
  }
  if (params.liveSessionId !== normalized.expectedSessionId) {
    return {
      allowed: false,
      state: "generation-mismatch",
      reason: "coordinator session generation rotated after the follow-up was authorized",
      expectedSessionId: normalized.expectedSessionId,
      observedSessionId: params.liveSessionId,
    };
  }
  return {
    allowed: true,
    state: "allowed",
    reason: "coordinator scope is current, unexpired and generation-matched",
    expectedSessionId: normalized.expectedSessionId,
    observedSessionId: params.liveSessionId,
  };
}