/** Session pending replies reference the existing outbound intent; queue effect truth owns settlement. */
import type { SessionEntry } from "../../config/sessions/types.js";
import type { OutboundDeliveryIntent } from "../../infra/outbound/deliver.js";

export type PendingFinalDeliveryIdentity = Pick<
  SessionEntry,
  | "sessionId"
  | "pendingFinalDelivery"
  | "pendingFinalDeliveryRunId"
  | "pendingFinalDeliveryRecoveryRunId"
  | "pendingFinalDeliveryText"
  | "pendingFinalDeliveryCreatedAt"
  | "pendingFinalDeliveryIntentId"
  | "pendingFinalDeliveryContext"
>;

/** The queue retains only the reply identity needed to settle its Session reference. */
export type PendingFinalDeliveryBinding = {
  storePath: string;
  sessionKey: string;
  expected: PendingFinalDeliveryIdentity;
};

export function pendingFinalDeliveryIdentity(entry: SessionEntry): PendingFinalDeliveryIdentity {
  const {
    sessionId,
    pendingFinalDelivery,
    pendingFinalDeliveryRunId,
    pendingFinalDeliveryRecoveryRunId,
    pendingFinalDeliveryText,
    pendingFinalDeliveryCreatedAt,
    pendingFinalDeliveryIntentId,
    pendingFinalDeliveryContext,
  } = entry;
  return {
    sessionId,
    pendingFinalDelivery,
    pendingFinalDeliveryRunId,
    pendingFinalDeliveryRecoveryRunId,
    pendingFinalDeliveryText,
    pendingFinalDeliveryCreatedAt,
    pendingFinalDeliveryIntentId,
    pendingFinalDeliveryContext,
  };
}

export function hasSamePendingFinalDelivery(
  current: SessionEntry,
  expected: PendingFinalDeliveryIdentity,
): boolean {
  return (
    current.sessionId === expected.sessionId &&
    current.pendingFinalDelivery === expected.pendingFinalDelivery &&
    current.pendingFinalDeliveryRunId === expected.pendingFinalDeliveryRunId &&
    current.pendingFinalDeliveryRecoveryRunId === expected.pendingFinalDeliveryRecoveryRunId &&
    current.pendingFinalDeliveryText === expected.pendingFinalDeliveryText &&
    current.pendingFinalDeliveryCreatedAt === expected.pendingFinalDeliveryCreatedAt &&
    current.pendingFinalDeliveryIntentId === expected.pendingFinalDeliveryIntentId &&
    current.pendingFinalDeliveryContext?.channel ===
      expected.pendingFinalDeliveryContext?.channel &&
    current.pendingFinalDeliveryContext?.to === expected.pendingFinalDeliveryContext?.to &&
    current.pendingFinalDeliveryContext?.accountId ===
      expected.pendingFinalDeliveryContext?.accountId &&
    current.pendingFinalDeliveryContext?.threadId === expected.pendingFinalDeliveryContext?.threadId
  );
}

export function clearedPendingFinalDelivery(): Partial<SessionEntry> {
  return {
    pendingFinalDelivery: undefined,
    pendingFinalDeliveryText: undefined,
    pendingFinalDeliveryRunId: undefined,
    pendingFinalDeliveryRecoveryRunId: undefined,
    pendingFinalDeliveryCreatedAt: undefined,
    pendingFinalDeliveryLastAttemptAt: undefined,
    pendingFinalDeliveryAttemptCount: undefined,
    pendingFinalDeliveryLastError: undefined,
    pendingFinalDeliveryContext: undefined,
    pendingFinalDeliveryIntentId: undefined,
  };
}

export async function bindPendingFinalDeliveryIntent(params: {
  storePath: string;
  sessionKey: string;
  expected: PendingFinalDeliveryIdentity;
  intent: OutboundDeliveryIntent;
}): Promise<boolean> {
  if (
    params.expected.pendingFinalDeliveryIntentId &&
    params.expected.pendingFinalDeliveryIntentId !== params.intent.id
  )
    return false;
  const { updateSessionStoreAtomic } = await import("../../config/sessions/store.js");
  return await updateSessionStoreAtomic(params.storePath, (store) => {
    const current = store[params.sessionKey];
    if (
      !current ||
      !(
        hasSamePendingFinalDelivery(current, {
          ...params.expected,
          pendingFinalDeliveryIntentId: undefined,
        }) ||
        hasSamePendingFinalDelivery(current, {
          ...params.expected,
          pendingFinalDeliveryIntentId: params.intent.id,
        })
      )
    )
      return false;
    current.pendingFinalDeliveryIntentId = params.intent.id;
    current.updatedAt = Date.now();
    return true;
  });
}

export async function settlePendingFinalDeliveryIntent(params: {
  storePath: string;
  sessionKey: string;
  expected: PendingFinalDeliveryIdentity;
}): Promise<boolean> {
  const { updateSessionStoreAtomic } = await import("../../config/sessions/store.js");
  return await updateSessionStoreAtomic(params.storePath, (store) => {
    const current = store[params.sessionKey];
    if (!current || !hasSamePendingFinalDelivery(current, params.expected)) {
      // Replacement retires the old reference. An altered reply that still
      // points to this intent needs its applied queue truth until it is rebound.
      return Boolean(
        params.expected.pendingFinalDeliveryIntentId &&
        current?.pendingFinalDeliveryIntentId !== params.expected.pendingFinalDeliveryIntentId,
      );
    }
    Object.assign(current, clearedPendingFinalDelivery(), { updatedAt: Date.now() });
    return true;
  });
}
