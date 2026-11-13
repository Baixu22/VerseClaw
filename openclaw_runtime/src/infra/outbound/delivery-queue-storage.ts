// Delivery queue storage persists replayable outbound send intents and tracks
// platform-send recovery state in the shared SQLite queue.
import type {
  EffectCertainty,
  RecoveryAdmissionIdentity,
  RecoveryAuthorityRequest,
  RecoveryOwnerAdmission,
} from "../../../../shared/recovery-authority/contract.js";
import {
  buildRecoveryAdmissionKey,
  finishOwnerRecoveryAdmission,
  isRecoveryAuthorityEnabled,
  prepareOwnerRecoveryAdmission,
} from "../../agents/recovery-authority/owner-admission.js";
import { isPidDefinitelyDead } from "../../shared/pid-alive.js";
import type { PendingFinalDeliveryBinding } from "../../agents/recovery-authority/final-delivery-session.js";
import type { ReplyDispatchKind } from "../../auto-reply/reply/reply-dispatcher.types.js";
import type { ReplyPayload } from "../../auto-reply/types.js";
import type { RenderedMessageBatchPlanItem } from "../../channels/message/types.js";
import type { ReplyToMode } from "../../config/types.js";
import type { PluginHookReplyPayloadSendingContext } from "../../plugins/hook-types.js";
import {
  deleteDeliveryQueueEntry,
  loadDeliveryQueueEntries,
  loadDeliveryQueueEntry,
  moveDeliveryQueueEntryToFailed,
  updateDeliveryQueueEntry,
  upsertDeliveryQueueEntry,
  type DeliveryQueueRowMetadata,
} from "../delivery-queue-sqlite.js";
import { generateSecureUuid } from "../secure-random.js";
import type { OutboundDeliveryFormattingOptions } from "./formatting.js";
import type { OutboundIdentity } from "./identity.js";
import type { OutboundMirror } from "./mirror.js";
import type { OutboundSessionContext } from "./session-context.js";
import type { OutboundChannel } from "./targets.js";

const QUEUE_NAME = "outbound";
export const MAX_DELIVERY_RECOVERY_ATTEMPTS = 5;
export const DELIVERY_RECOVERY_BACKOFF_MS: readonly number[] = [5_000, 25_000, 120_000, 600_000];

export type QueuedRenderedMessageBatchPlan = {
  payloadCount: number;
  textCount: number;
  mediaCount: number;
  voiceCount: number;
  presentationCount: number;
  interactiveCount: number;
  channelDataCount: number;
  items: readonly RenderedMessageBatchPlanItem[];
};

export type QueuedReplyPayloadSendingHook = {
  kind: ReplyDispatchKind;
  channel?: string;
  sessionKey?: string;
  runId?: string;
  context: PluginHookReplyPayloadSendingContext;
};

export type QueuedDeliveryPayload = {
  channel: Exclude<OutboundChannel, "none">;
  to: string;
  accountId?: string;
  /**
   * Original payloads before plugin hooks. On recovery, hooks re-run on these
   * payloads — this is intentional since hooks are stateless transforms and
   * should produce the same result on replay.
   */
  payloads: ReplyPayload[];
  /** Replayable projection summary captured when the durable send intent is created. */
  renderedBatchPlan?: QueuedRenderedMessageBatchPlan;
  threadId?: string | number | null;
  replyToId?: string | null;
  replyToMode?: ReplyToMode;
  formatting?: OutboundDeliveryFormattingOptions;
  identity?: OutboundIdentity;
  bestEffort?: boolean;
  gifPlayback?: boolean;
  forceDocument?: boolean;
  /** Replayable reply payload hook context for recovery and live delivery. */
  replyPayloadSendingHook?: QueuedReplyPayloadSendingHook;
  silent?: boolean;
  mirror?: OutboundMirror;
  /** Session context needed to preserve outbound media policy on recovery. */
  session?: OutboundSessionContext;
  /** Gateway caller scopes at enqueue time, preserved for recovery replay. */
  gatewayClientScopes?: readonly string[];
  /** Exact Session reply referenced by this durable intent. */
  pendingFinalDelivery?: PendingFinalDeliveryBinding;
};

export interface QueuedDelivery extends QueuedDeliveryPayload {
  id: string;
  enqueuedAt: number;
  retryCount: number;
  lastAttemptAt?: number;
  lastError?: string;
  platformSendStartedAt?: number;
  recoveryState?: "send_attempt_started" | "unknown_after_send";
  recoveryEffect?: EffectCertainty;
  recoveryAdmission?: RecoveryOwnerAdmission;
  /** Dispatch and reconciliation retain their queue owner until completion or process exit. */
  activeSendProcessId?: number;
}

function queuedDeliveryMetadata(entry: QueuedDelivery): DeliveryQueueRowMetadata {
  return {
    entryKind: "outbound",
    sessionKey: entry.session?.key,
    channel: entry.channel,
    target: entry.to,
    accountId: entry.accountId,
  };
}

/** Persist a delivery entry before attempting send. Returns the entry ID. */
export async function enqueueDelivery(
  params: QueuedDeliveryPayload,
  stateDir?: string,
  options?: { activeSend?: boolean },
): Promise<string> {
  const id = generateSecureUuid();
  const entry: QueuedDelivery = {
    id,
    enqueuedAt: Date.now(),
    channel: params.channel,
    to: params.to,
    accountId: params.accountId,
    payloads: params.payloads,
    renderedBatchPlan: params.renderedBatchPlan,
    threadId: params.threadId,
    replyToId: params.replyToId,
    replyToMode: params.replyToMode,
    formatting: params.formatting,
    identity: params.identity,
    bestEffort: params.bestEffort,
    gifPlayback: params.gifPlayback,
    forceDocument: params.forceDocument,
    replyPayloadSendingHook: params.replyPayloadSendingHook,
    silent: params.silent,
    mirror: params.mirror,
    session: params.session,
    gatewayClientScopes: params.gatewayClientScopes,
    ...(params.pendingFinalDelivery
      ? {
          pendingFinalDelivery: {
            ...params.pendingFinalDelivery,
            expected: { ...params.pendingFinalDelivery.expected, pendingFinalDeliveryIntentId: id },
          },
        }
      : {}),
    retryCount: 0,
    ...(isRecoveryAuthorityEnabled() && options?.activeSend
      ? { activeSendProcessId: process.pid, recoveryEffect: "not_applied" as const }
      : {}),
  };
  upsertDeliveryQueueEntry({
    queueName: QUEUE_NAME,
    entry,
    metadata: queuedDeliveryMetadata(entry),
    stateDir,
  });
  return id;
}

/** Remove a successfully delivered entry from the queue. */
export async function ackDelivery(
  id: string,
  stateDir?: string,
  expected?: QueuedDelivery,
): Promise<boolean> {
  const entry = await loadPendingDelivery(id, stateDir);
  if (!entry || (expected && !hasSameQueuedDelivery(entry, expected))) return false;
  if (entry.pendingFinalDelivery) {
    // Clear the exact Session reference before deleting effect truth. A crash
    // between these commits leaves the applied intent available for settlement.
    const { settlePendingFinalDeliveryIntent } =
      await import("../../agents/recovery-authority/final-delivery-session.js");
    if (!(await settlePendingFinalDeliveryIntent(entry.pendingFinalDelivery))) return false;
  }
  return deleteDeliveryQueueEntry(QUEUE_NAME, id, stateDir, (current) =>
    hasSameQueuedDelivery(current as QueuedDelivery, entry),
  );
}

/** Update a queue entry after a failed delivery attempt. */
export async function failDelivery(id: string, error: string, stateDir?: string): Promise<void> {
  updateQueuedDelivery(id, stateDir, (entry) => ({
    ...entry,
    retryCount: entry.retryCount + 1,
    lastAttemptAt: Date.now(),
    lastError: error,
    activeSendProcessId: undefined,
  }));
}

function updateQueuedDelivery(
  id: string,
  stateDir: string | undefined,
  update: (entry: QueuedDelivery) => QueuedDelivery | null,
): boolean {
  return updateDeliveryQueueEntry(QUEUE_NAME, id, stateDir, (entry) =>
    update(entry as QueuedDelivery),
  );
}

/** A concurrent settlement removes the intent; recovery must continue with the next row. */
function updateQueuedRecovery(
  id: string,
  stateDir: string | undefined,
  update: (entry: QueuedDelivery) => QueuedDelivery | null,
): boolean {
  try {
    return updateQueuedDelivery(id, stateDir, update);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** Immutable intent fields distinguish a replacement from retries of the same payload. */
function queuedDeliveryKey(entry: QueuedDelivery): string {
  return buildRecoveryAdmissionKey(
    "final-delivery",
    entry.id,
    String(entry.enqueuedAt),
    JSON.stringify([
      entry.channel,
      entry.to,
      entry.accountId,
      entry.payloads,
      entry.renderedBatchPlan,
      entry.threadId,
      entry.replyToId,
      entry.replyToMode,
      entry.formatting,
      entry.identity,
      entry.bestEffort,
      entry.gifPlayback,
      entry.forceDocument,
      entry.replyPayloadSendingHook,
      entry.silent,
      entry.mirror,
      entry.session,
      entry.gatewayClientScopes,
      entry.pendingFinalDelivery,
    ]),
  );
}

export function hasSameQueuedDelivery(current: QueuedDelivery, expected: QueuedDelivery): boolean {
  return (
    queuedDeliveryKey(current) === queuedDeliveryKey(expected) &&
    (!expected.recoveryAdmission ||
      (current.recoveryAdmission?.idempotencyKey === expected.recoveryAdmission.idempotencyKey &&
        current.recoveryAdmission.attempts === expected.recoveryAdmission.attempts &&
        current.recoveryAdmission.ownerEpoch === expected.recoveryAdmission.ownerEpoch &&
        current.recoveryAdmission.ownerId === expected.recoveryAdmission.ownerId &&
        current.recoveryAdmission.processId === expected.recoveryAdmission.processId))
  );
}

export function queuedDeliveryEffect(entry: QueuedDelivery): EffectCertainty {
  return entry.recoveryEffect ?? (entry.recoveryState ? "unknown" : "not_applied");
}

/** Persisted authority intents retain their uncertainty after the mode is rolled back. */
export function usesQueuedDeliveryAuthority(entry: QueuedDelivery): boolean {
  return (
    isRecoveryAuthorityEnabled() ||
    Boolean(entry.recoveryAdmission) ||
    entry.recoveryEffect !== undefined
  );
}

/** Runs in the queue transaction; the original row owns its decision and finite budget. */
export function admitQueuedDeliveryRecovery(expected: QueuedDelivery, stateDir?: string) {
  let admission: ReturnType<typeof prepareOwnerRecoveryAdmission> | undefined;
  let entry: QueuedDelivery | undefined;
  updateQueuedRecovery(expected.id, stateDir, (current) => {
    if (!hasSameQueuedDelivery(current, expected)) return null;
    if (current.activeSendProcessId && !isPidDefinitelyDead(current.activeSendProcessId))
      return null;
    const reserved = current.recoveryAdmission;
    if (
      reserved?.state === "pending" &&
      ["resume", "replay", "deliver"].includes(reserved.decision.kind) &&
      !isPidDefinitelyDead(reserved.processId)
    )
      return null;
    const key = queuedDeliveryKey(current);
    const effect = queuedDeliveryEffect(current);
    const request: RecoveryAuthorityRequest = {
      requestId: key,
      entry: "final-delivery",
      owner: {
        kind: "final-delivery",
        ownerId: current.id,
        deliveryId: current.id,
        sessionKey:
          current.session?.key ?? current.replyPayloadSendingHook?.sessionKey ?? current.id,
      },
      admission: {
        trigger: "pending-final-delivery",
        requiredPreState: "pending-final-delivery",
        admitted: true,
        visibleOutputObserved: effect === "applied" || effect === "reconciled",
      },
      budget: {
        attempts: { current: current.retryCount, max: MAX_DELIVERY_RECOVERY_ATTEMPTS },
        backoff: {
          initialMs: DELIVERY_RECOVERY_BACKOFF_MS[0]!,
          multiplier: 5,
          maxMs: DELIVERY_RECOVERY_BACKOFF_MS.at(-1)!,
        },
        wedge: {
          afterAttempts: MAX_DELIVERY_RECOVERY_ATTEMPTS,
          wedged: current.retryCount >= MAX_DELIVERY_RECOVERY_ATTEMPTS,
        },
      },
      replayClass: "reconcile",
      effect,
      requestedAction: "deliver",
      idempotencyKey: key,
      evidence: [
        {
          kind: "domain-journal",
          ref: `delivery_queue_entries:outbound:${current.id}`,
          role: "effect-truth",
        },
      ],
      requestedAt: Date.now(),
    };
    // An uncertain dispatch hands off to observation after its live claim exits.
    // Reconciliation binds this process while retaining the consumed send budget.
    const previous =
      reserved &&
      effect === "unknown" &&
      ["pending", "accepted", "reconcile"].includes(reserved.state)
        ? { ...reserved, state: "failed" as const }
        : reserved;
    admission = prepareOwnerRecoveryAdmission(request, previous);
    entry = {
      ...current,
      recoveryEffect: effect,
      recoveryAdmission: admission.record ?? current.recoveryAdmission,
      retryCount: admission.record?.attempts ?? current.retryCount,
      activeSendProcessId: admission.admitted || effect === "unknown" ? process.pid : undefined,
      ...(admission.admitted ? { lastAttemptAt: request.requestedAt } : {}),
    };
    return entry;
  });
  return admission && entry ? { ...admission, entry } : null;
}

export function recordQueuedDeliveryEffect(
  expected: QueuedDelivery,
  effect: EffectCertainty,
  stateDir?: string,
): QueuedDelivery | null {
  let saved: QueuedDelivery | null = null;
  updateQueuedRecovery(expected.id, stateDir, (current) => {
    if (!hasSameQueuedDelivery(current, expected)) return null;
    saved = { ...current, recoveryEffect: effect };
    return saved;
  });
  return saved;
}

export function finishQueuedDeliveryRecovery(
  expected: QueuedDelivery,
  error: string,
  stateDir?: string,
): void {
  updateQueuedRecovery(expected.id, stateDir, (current) => {
    if (!expected.recoveryAdmission || !hasSameQueuedDelivery(current, expected)) return null;
    const recoveryAdmission = finishOwnerRecoveryAdmission(
      current.recoveryAdmission,
      expected.recoveryAdmission,
      "failed",
    );
    return recoveryAdmission
      ? { ...current, recoveryAdmission, activeSendProcessId: undefined, lastError: error }
      : null;
  });
}

function matchesQueuedAdmission(
  entry: QueuedDelivery,
  expected?: RecoveryAdmissionIdentity,
): boolean {
  return (
    !expected ||
    (entry.recoveryAdmission?.idempotencyKey === expected.idempotencyKey &&
      entry.recoveryAdmission.attempts === expected.attempts &&
      entry.recoveryAdmission.ownerEpoch === expected.ownerEpoch &&
      entry.recoveryAdmission.ownerId === expected.ownerId &&
      entry.recoveryAdmission.processId === process.pid &&
      entry.recoveryAdmission.state === "pending" &&
      entry.recoveryAdmission.decision.kind === "deliver" &&
      queuedDeliveryKey(entry) === expected.idempotencyKey)
  );
}

export async function markDeliveryPlatformSendAttemptStarted(
  id: string,
  stateDir?: string,
  expected?: RecoveryAdmissionIdentity,
): Promise<void> {
  const updated = updateQueuedDelivery(id, stateDir, (entry) =>
    matchesQueuedAdmission(entry, expected)
      ? {
          ...entry,
          platformSendStartedAt: entry.platformSendStartedAt ?? Date.now(),
          recoveryState: "send_attempt_started",
          ...(usesQueuedDeliveryAuthority(entry) ? { recoveryEffect: "unknown" as const } : {}),
        }
      : null,
  );
  if (!updated) throw new Error("delivery admission no longer owns its intent");
}

export async function markDeliveryPlatformOutcomeUnknown(
  id: string,
  stateDir?: string,
  expected?: RecoveryAdmissionIdentity,
): Promise<void> {
  const updated = updateQueuedDelivery(id, stateDir, (entry) =>
    matchesQueuedAdmission(entry, expected)
      ? {
          ...entry,
          platformSendStartedAt: entry.platformSendStartedAt ?? Date.now(),
          recoveryState: "unknown_after_send",
          ...(usesQueuedDeliveryAuthority(entry) ? { recoveryEffect: "unknown" as const } : {}),
        }
      : null,
  );
  if (!updated) throw new Error("delivery outcome no longer owns its intent");
}

export async function markDeliveryPlatformOutcomeApplied(
  id: string,
  stateDir?: string,
  expected?: RecoveryAdmissionIdentity,
): Promise<void> {
  const updated = updateQueuedDelivery(id, stateDir, (entry) =>
    matchesQueuedAdmission(entry, expected)
      ? {
          ...entry,
          ...(usesQueuedDeliveryAuthority(entry) ? { recoveryEffect: "applied" as const } : {}),
          activeSendProcessId: undefined,
        }
      : null,
  );
  if (!updated) throw new Error("delivery outcome no longer owns its intent");
}

/** Load a single pending delivery entry by ID from the queue directory. */
export async function loadPendingDelivery(
  id: string,
  stateDir?: string,
): Promise<QueuedDelivery | null> {
  return loadDeliveryQueueEntry(QUEUE_NAME, id, stateDir) as QueuedDelivery | null;
}

/** Load all pending delivery entries from the queue. */
export async function loadPendingDeliveries(stateDir?: string): Promise<QueuedDelivery[]> {
  return loadDeliveryQueueEntries(QUEUE_NAME, stateDir) as QueuedDelivery[];
}

/** Move a queue entry out of the pending retry set. */
export async function moveToFailed(
  id: string,
  stateDir?: string,
  expected?: QueuedDelivery,
): Promise<boolean> {
  return moveDeliveryQueueEntryToFailed(
    QUEUE_NAME,
    id,
    stateDir,
    expected ? (current) => hasSameQueuedDelivery(current as QueuedDelivery, expected) : undefined,
  );
}
