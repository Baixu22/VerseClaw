/**
 * E1 — Main-side view of the long-session follow-up scope.
 *
 * The runtime owns the delivery-time fence (openclaw_runtime/src/cron/
 * coordinator-scope.ts); this module gives Electron the same decision so the
 * UI and the maintenance pass can explain and suppress a stale schedule before
 * it fires. Both imps must agree — tests/unit/long-session-followup-scheduling
 * asserts verdict parity over a shared matrix.
 */

export const CRON_COORDINATOR_SCOPE_SCHEMA = 'CronCoordinatorScope/v1' as const;

export type CronCoordinatorIntent = 'follow-up' | 'check-in' | 'status';

export type CronCoordinatorScope = {
  schemaVersion: typeof CRON_COORDINATOR_SCOPE_SCHEMA;
  workspaceId: string;
  coordinatorSessionKey: string;
  expectedSessionId: string;
  taskRef?: { kind: 'task-ledger'; nodeId: string } | null;
  intent: CronCoordinatorIntent;
  expiresAtMs?: number | null;
  notificationPolicy: 'silent-unless-result' | 'errors-and-decisions';
};

export type CronCoordinatorGateState =
  | 'allowed'
  | 'unbound'
  | 'malformed'
  | 'expired'
  | 'session-missing'
  | 'generation-mismatch'
  | 'unverifiable';

export type CronCoordinatorGateVerdict = {
  allowed: boolean;
  state: CronCoordinatorGateState;
  reason: string;
  expectedSessionId?: string;
  observedSessionId?: string | null;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeCronCoordinatorScope(value: unknown): CronCoordinatorScope | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
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
    || (intent !== 'follow-up' && intent !== 'check-in' && intent !== 'status')
    || (notificationPolicy !== 'silent-unless-result' && notificationPolicy !== 'errors-and-decisions')
  ) {
    return null;
  }
  const taskRefRaw = raw.taskRef;
  let taskRef: CronCoordinatorScope['taskRef'];
  if (taskRefRaw && typeof taskRefRaw === 'object' && !Array.isArray(taskRefRaw)) {
    const nodeId = nonEmptyString((taskRefRaw as Record<string, unknown>).nodeId);
    if ((taskRefRaw as Record<string, unknown>).kind === 'task-ledger' && nodeId) {
      taskRef = { kind: 'task-ledger', nodeId };
    }
  } else if (taskRefRaw === null) {
    taskRef = null;
  }
  const expiresAtMs =
    typeof raw.expiresAtMs === 'number' && Number.isFinite(raw.expiresAtMs) ? raw.expiresAtMs : null;
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
 * `liveSessionId === undefined` means "could not check" (fail closed);
 * `null` means "the coordinator session no longer exists".
 */
export function evaluateCronCoordinatorScope(params: {
  scope?: unknown;
  nowMs: number;
  liveSessionId?: string | null;
  bindingState?: 'active' | 'invalidated' | null;
}): CronCoordinatorGateVerdict {
  const normalized = normalizeCronCoordinatorScope(params.scope);
  if (normalized === undefined) {
    return { allowed: true, state: 'unbound', reason: 'job is not bound to a long-session coordinator' };
  }
  if (normalized === null) {
    return { allowed: false, state: 'malformed', reason: 'coordinator scope is present but malformed' };
  }
  if (params.bindingState === 'invalidated') {
    return {
      allowed: false,
      state: 'unverifiable',
      reason: 'coordinator binding is invalidated',
      expectedSessionId: normalized.expectedSessionId,
      observedSessionId: params.liveSessionId ?? null,
    };
  }
  if (typeof normalized.expiresAtMs === 'number' && params.nowMs >= normalized.expiresAtMs) {
    return {
      allowed: false,
      state: 'expired',
      reason: 'follow-up deadline passed',
      expectedSessionId: normalized.expectedSessionId,
      observedSessionId: params.liveSessionId ?? null,
    };
  }
  if (params.liveSessionId === undefined) {
    return {
      allowed: false,
      state: 'unverifiable',
      reason: 'live session generation could not be resolved',
      expectedSessionId: normalized.expectedSessionId,
      observedSessionId: null,
    };
  }
  if (params.liveSessionId === null) {
    return {
      allowed: false,
      state: 'session-missing',
      reason: 'coordinator session is archived, deleted or otherwise absent',
      expectedSessionId: normalized.expectedSessionId,
      observedSessionId: null,
    };
  }
  if (params.liveSessionId !== normalized.expectedSessionId) {
    return {
      allowed: false,
      state: 'generation-mismatch',
      reason: 'coordinator session generation rotated after the follow-up was authorized',
      expectedSessionId: normalized.expectedSessionId,
      observedSessionId: params.liveSessionId,
    };
  }
  return {
    allowed: true,
    state: 'allowed',
    reason: 'coordinator scope is current, unexpired and generation-matched',
    expectedSessionId: normalized.expectedSessionId,
    observedSessionId: params.liveSessionId,
  };
}