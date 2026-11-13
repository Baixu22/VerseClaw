// Delivery queue recovery drains pending outbound sends with backoff, crash
// replay protection, unknown-send reconciliation, and failed-entry pruning.
import {
  resolveDateTimestampMs,
  resolveExpiresAtMsFromDurationMs,
} from "@openclaw/normalization-core/number-coercion";
import type {
  ChannelMessageSendCommitContext,
  ChannelMessageUnknownSendReconciliationResult,
} from "../../channels/message/types.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { RecoveryAdmissionIdentity } from "../../../../shared/recovery-authority/contract.js";
import { getRecoveryAdmissionIdentity } from "../../agents/recovery-authority/owner-admission.js";
import { formatErrorMessage } from "../errors.js";
import { resolveOutboundChannelMessageAdapter } from "./channel-resolution.js";
import type { OutboundDeliveryResult } from "./deliver-types.js";
import {
  isOutboundDeliveryResultArray,
  runOutboundDeliveryCommitHooks,
} from "./delivery-commit-hooks.js";
import {
  ackDelivery,
  failDelivery,
  loadPendingDelivery,
  loadPendingDeliveries,
  moveToFailed,
  admitQueuedDeliveryRecovery,
  finishQueuedDeliveryRecovery,
  recordQueuedDeliveryEffect,
  queuedDeliveryEffect,
  usesQueuedDeliveryAuthority,
  MAX_DELIVERY_RECOVERY_ATTEMPTS,
  DELIVERY_RECOVERY_BACKOFF_MS,
  type QueuedDelivery,
  type QueuedDeliveryPayload,
} from "./delivery-queue-storage.js";

export type RecoverySummary = {
  recovered: number;
  failed: number;
  skippedMaxRetries: number;
  deferredBackoff: number;
};

type DeliveryRecoveryOutcome =
  | "recovered"
  | "failed"
  | "moved-to-failed"
  | "already-gone"
  | "deferred-backoff";

export type DeliverFn = (
  params: {
    cfg: OpenClawConfig;
  } & QueuedDeliveryPayload & {
      deliveryQueueId?: string;
      deliveryQueueStateDir?: string;
      skipQueue?: boolean;
      deferCommitHooks?: boolean;
      recoveryAdmission?: RecoveryAdmissionIdentity;
      onError?: (error: unknown) => void;
    },
) => Promise<unknown>;

export interface RecoveryLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface PendingDeliveryDrainDecision {
  match: boolean;
  bypassBackoff?: boolean;
}

export type ActiveDeliveryClaimResult<T> =
  | { status: "claimed"; value: T }
  | { status: "claimed-by-other-owner" };

const MAX_RETRIES = MAX_DELIVERY_RECOVERY_ATTEMPTS;

/** Backoff delays in milliseconds indexed by retry count (1-based). */
const BACKOFF_MS = DELIVERY_RECOVERY_BACKOFF_MS;

const PERMANENT_ERROR_PATTERNS: readonly RegExp[] = [
  /no conversation reference found/i,
  /chat not found/i,
  /user not found/i,
  /bot.*not.*member/i,
  /bot was blocked by the user/i,
  /forbidden: bot was kicked/i,
  /chat_id is empty/i,
  /recipient is not a valid/i,
  /outbound not configured for channel/i,
  /ambiguous .* recipient/i,
  /User .* not in room/i,
];

const drainInProgress = new Map<string, boolean>();
const entriesInProgress = new Set<string>();

function resolveRecoveryDeadlineMs(maxRecoveryMs: number | undefined): number {
  const durationMs =
    typeof maxRecoveryMs === "number" && Number.isFinite(maxRecoveryMs)
      ? Math.max(0, Math.trunc(maxRecoveryMs))
      : 60_000;
  if (durationMs <= 0) {
    return resolveDateTimestampMs(Date.now());
  }
  return resolveExpiresAtMsFromDurationMs(durationMs) ?? resolveDateTimestampMs(Date.now());
}

function getErrnoCode(err: unknown): string | null {
  return err && typeof err === "object" && "code" in err
    ? String((err as { code?: unknown }).code)
    : null;
}

function createEmptyRecoverySummary(): RecoverySummary {
  return {
    recovered: 0,
    failed: 0,
    skippedMaxRetries: 0,
    deferredBackoff: 0,
  };
}

function claimRecoveryEntry(entryId: string): boolean {
  if (entriesInProgress.has(entryId)) {
    return false;
  }
  entriesInProgress.add(entryId);
  return true;
}

function releaseRecoveryEntry(entryId: string): void {
  entriesInProgress.delete(entryId);
}

export async function withActiveDeliveryClaim<T>(
  entryId: string,
  fn: () => Promise<T>,
): Promise<ActiveDeliveryClaimResult<T>> {
  if (!claimRecoveryEntry(entryId)) {
    return { status: "claimed-by-other-owner" };
  }

  try {
    return { status: "claimed", value: await fn() };
  } finally {
    releaseRecoveryEntry(entryId);
  }
}

function buildRecoveryDeliverParams(entry: QueuedDelivery, cfg: OpenClawConfig, stateDir?: string) {
  return {
    cfg,
    channel: entry.channel,
    to: entry.to,
    accountId: entry.accountId,
    payloads: entry.payloads,
    renderedBatchPlan: entry.renderedBatchPlan,
    threadId: entry.threadId,
    replyToId: entry.replyToId,
    replyToMode: entry.replyToMode,
    formatting: entry.formatting,
    identity: entry.identity,
    bestEffort: entry.bestEffort,
    gifPlayback: entry.gifPlayback,
    forceDocument: entry.forceDocument,
    replyPayloadSendingHook: entry.replyPayloadSendingHook,
    silent: entry.silent,
    mirror: entry.mirror,
    session: entry.session,
    gatewayClientScopes: entry.gatewayClientScopes,
    deliveryQueueId: entry.id,
    deliveryQueueStateDir: stateDir,
    skipQueue: true, // Prevent re-enqueueing during recovery.
    deferCommitHooks: true,
    ...(entry.recoveryAdmission
      ? { recoveryAdmission: getRecoveryAdmissionIdentity(entry.recoveryAdmission) }
      : {}),
  } satisfies Parameters<DeliverFn>[0];
}

async function reconcileUnknownQueuedDelivery(opts: {
  entry: QueuedDelivery;
  cfg: OpenClawConfig;
  log: RecoveryLogger;
}): Promise<ChannelMessageUnknownSendReconciliationResult | null> {
  const adapter = resolveOutboundChannelMessageAdapter({
    channel: opts.entry.channel,
    cfg: opts.cfg,
    allowBootstrap: true,
  });
  if (adapter?.durableFinal?.capabilities?.reconcileUnknownSend !== true) {
    return null;
  }
  const reconcileUnknownSend = adapter?.durableFinal?.reconcileUnknownSend;
  if (!reconcileUnknownSend) {
    return null;
  }
  const { entry } = opts;
  try {
    return await reconcileUnknownSend({
      cfg: opts.cfg,
      queueId: entry.id,
      channel: entry.channel,
      to: entry.to,
      ...(entry.accountId !== undefined ? { accountId: entry.accountId } : {}),
      enqueuedAt: entry.enqueuedAt,
      retryCount: entry.retryCount,
      ...(entry.platformSendStartedAt !== undefined
        ? { platformSendStartedAt: entry.platformSendStartedAt }
        : {}),
      payloads: entry.payloads,
      ...(entry.renderedBatchPlan ? { renderedBatchPlan: entry.renderedBatchPlan } : {}),
      ...(entry.replyToId !== undefined ? { replyToId: entry.replyToId } : {}),
      ...(entry.replyToMode !== undefined ? { replyToMode: entry.replyToMode } : {}),
      ...(entry.threadId !== undefined ? { threadId: entry.threadId } : {}),
      ...(entry.silent !== undefined ? { silent: entry.silent } : {}),
    });
  } catch (err) {
    const error = formatErrorMessage(err);
    opts.log.warn(`Delivery entry ${opts.entry.id} unknown-send reconciliation failed: ${error}`);
    return { status: "unresolved", error, retryable: true };
  }
}

function buildReconciledSentResult(
  entry: QueuedDelivery,
  reconciliation: Extract<ChannelMessageUnknownSendReconciliationResult, { status: "sent" }>,
): OutboundDeliveryResult {
  return {
    channel: entry.channel,
    messageId:
      reconciliation.messageId ??
      reconciliation.receipt.primaryPlatformMessageId ??
      reconciliation.receipt.platformMessageIds[0] ??
      "",
    receipt: reconciliation.receipt,
  };
}

function buildReconciledCommitContext(params: {
  entry: QueuedDelivery;
  cfg: OpenClawConfig;
  result: OutboundDeliveryResult;
}): ChannelMessageSendCommitContext {
  const payload = params.entry.payloads[0] ?? {};
  const result = {
    messageId: params.result.messageId,
    receipt: params.result.receipt ?? {
      platformMessageIds: [params.result.messageId].filter(Boolean),
      parts: [],
      sentAt: Date.now(),
    },
  };
  const base = {
    cfg: params.cfg,
    to: params.entry.to,
    accountId: params.entry.accountId,
    replyToId: params.entry.replyToId,
    replyToMode: params.entry.replyToMode,
    threadId: params.entry.threadId,
    silent: params.entry.silent,
    result,
  };
  if (
    payload.presentation !== undefined ||
    payload.delivery !== undefined ||
    payload.interactive !== undefined ||
    (payload.channelData !== undefined && Object.keys(payload.channelData).length > 0)
  ) {
    return {
      ...base,
      kind: "payload",
      text: payload.text ?? "",
      mediaUrl: payload.mediaUrl,
      payload,
    };
  }
  const mediaUrl = payload.mediaUrl ?? payload.mediaUrls?.find((url) => url);
  if (mediaUrl) {
    return {
      ...base,
      kind: "media",
      text: payload.text ?? "",
      mediaUrl,
      audioAsVoice: payload.audioAsVoice,
      gifPlayback: params.entry.gifPlayback,
      forceDocument: params.entry.forceDocument,
    };
  }
  return {
    ...base,
    kind: "text",
    text: payload.text ?? "",
  };
}

async function runReconciledSentCommitHooks(params: {
  entry: QueuedDelivery;
  cfg: OpenClawConfig;
  reconciliation: Extract<ChannelMessageUnknownSendReconciliationResult, { status: "sent" }>;
  log: RecoveryLogger;
}): Promise<void> {
  const adapter = resolveOutboundChannelMessageAdapter({
    channel: params.entry.channel,
    cfg: params.cfg,
    allowBootstrap: true,
  });
  const afterCommit = adapter?.send?.lifecycle?.afterCommit;
  if (!afterCommit) {
    return;
  }
  const result = buildReconciledSentResult(params.entry, params.reconciliation);
  try {
    await afterCommit(
      buildReconciledCommitContext({
        entry: params.entry,
        cfg: params.cfg,
        result,
      }),
    );
  } catch (err) {
    params.log.warn(
      `Delivery entry ${params.entry.id} reconciled sent afterCommit hook failed: ${formatErrorMessage(err)}`,
    );
  }
}

async function moveEntryToFailedWithLogging(
  entryId: string,
  log: RecoveryLogger,
  stateDir?: string,
): Promise<void> {
  try {
    await moveToFailed(entryId, stateDir);
  } catch (err) {
    log.error(`Failed to move entry ${entryId} to failed/: ${String(err)}`);
  }
}

/** Compute the backoff delay in ms for a given retry count. */
export function computeBackoffMs(retryCount: number): number {
  if (retryCount <= 0) {
    return 0;
  }
  return BACKOFF_MS[Math.min(retryCount - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS.at(-1) ?? 0;
}

export function isEntryEligibleForRecoveryRetry(
  entry: QueuedDelivery,
  now: number,
): { eligible: true } | { eligible: false; remainingBackoffMs: number } {
  const backoff = computeBackoffMs(entry.retryCount + 1);
  if (backoff <= 0) {
    return { eligible: true };
  }
  const firstReplayAfterCrash = entry.retryCount === 0 && entry.lastAttemptAt === undefined;
  if (firstReplayAfterCrash) {
    return { eligible: true };
  }
  const hasAttemptTimestamp =
    typeof entry.lastAttemptAt === "number" &&
    Number.isFinite(entry.lastAttemptAt) &&
    entry.lastAttemptAt > 0;
  const baseAttemptAt = hasAttemptTimestamp
    ? (entry.lastAttemptAt ?? entry.enqueuedAt)
    : entry.enqueuedAt;
  const nextEligibleAt = baseAttemptAt + backoff;
  if (now >= nextEligibleAt) {
    return { eligible: true };
  }
  return { eligible: false, remainingBackoffMs: nextEligibleAt - now };
}

export function isPermanentDeliveryError(error: string): boolean {
  return PERMANENT_ERROR_PATTERNS.some((re) => re.test(error));
}

async function drainQueuedEntry(opts: {
  entry: QueuedDelivery;
  cfg: OpenClawConfig;
  deliver: DeliverFn;
  log: RecoveryLogger;
  stateDir?: string;
  bypassBackoff?: boolean;
  onRecovered?: (entry: QueuedDelivery) => void;
  onFailed?: (entry: QueuedDelivery, errMsg: string) => void;
}): Promise<DeliveryRecoveryOutcome> {
  if (usesQueuedDeliveryAuthority(opts.entry)) {
    return await drainAdmittedQueuedEntry(opts);
  }
  const { entry } = opts;
  if (
    entry.recoveryState === "send_attempt_started" ||
    entry.recoveryState === "unknown_after_send"
  ) {
    // A crash after platform send start cannot be blindly replayed; adapters
    // must reconcile whether the platform already committed the message.
    const reconciliation = await reconcileUnknownQueuedDelivery({
      entry,
      cfg: opts.cfg,
      log: opts.log,
    });
    if (reconciliation?.status === "sent") {
      try {
        await ackDelivery(entry.id, opts.stateDir);
        await runReconciledSentCommitHooks({
          entry,
          cfg: opts.cfg,
          reconciliation,
          log: opts.log,
        });
        opts.onRecovered?.(entry);
        opts.log.info(`Delivery entry ${entry.id} reconciled unknown_after_send as already sent`);
        return "recovered";
      } catch (ackErr) {
        if (getErrnoCode(ackErr) === "ENOENT") {
          return "already-gone";
        }
        const errMsg = `failed to ack reconciled sent delivery: ${formatErrorMessage(ackErr)}`;
        opts.log.warn(`Delivery entry ${entry.id} ${errMsg}`);
        opts.onFailed?.(entry, errMsg);
        try {
          await failDelivery(entry.id, errMsg, opts.stateDir);
          return "failed";
        } catch (failErr) {
          if (getErrnoCode(failErr) === "ENOENT") {
            return "already-gone";
          }
        }
        return "failed";
      }
    }
    if (reconciliation?.status === "not_sent") {
      opts.log.info(
        `Delivery entry ${entry.id} reconciled ${entry.recoveryState} as not sent; replaying`,
      );
    } else {
      const errMsg =
        reconciliation?.status === "unresolved" && reconciliation.error
          ? `delivery state is ${entry.recoveryState} and reconciliation is unresolved: ${reconciliation.error}`
          : `delivery state is ${entry.recoveryState}; refusing blind replay without adapter reconciliation`;
      opts.log.warn(`Delivery entry ${entry.id} ${errMsg}`);
      opts.onFailed?.(entry, errMsg);
      if (reconciliation?.status === "unresolved" && reconciliation.retryable === true) {
        try {
          await failDelivery(entry.id, errMsg, opts.stateDir);
          return "failed";
        } catch (failErr) {
          if (getErrnoCode(failErr) === "ENOENT") {
            return "already-gone";
          }
        }
        return "failed";
      }
      try {
        await moveToFailed(entry.id, opts.stateDir);
        return "moved-to-failed";
      } catch (moveErr) {
        if (getErrnoCode(moveErr) === "ENOENT") {
          return "already-gone";
        }
      }
      return "failed";
    }
  }
  try {
    const result = await opts.deliver(buildRecoveryDeliverParams(entry, opts.cfg, opts.stateDir));
    await ackDelivery(entry.id, opts.stateDir);
    if (isOutboundDeliveryResultArray(result)) {
      await runOutboundDeliveryCommitHooks(result);
    }
    opts.onRecovered?.(entry);
    return "recovered";
  } catch (err) {
    const errMsg = formatErrorMessage(err);
    opts.onFailed?.(entry, errMsg);
    if (isPermanentDeliveryError(errMsg)) {
      try {
        await moveToFailed(entry.id, opts.stateDir);
        return "moved-to-failed";
      } catch (moveErr) {
        if (getErrnoCode(moveErr) === "ENOENT") {
          return "already-gone";
        }
      }
    } else {
      try {
        await failDelivery(entry.id, errMsg, opts.stateDir);
        return "failed";
      } catch (failErr) {
        if (getErrnoCode(failErr) === "ENOENT") {
          return "already-gone";
        }
      }
    }
    return "failed";
  }
}

/** The existing queue supplies effect truth; every continuation uses its committed admission. */
async function drainAdmittedQueuedEntry(
  opts: Parameters<typeof drainQueuedEntry>[0],
): Promise<DeliveryRecoveryOutcome> {
  let prepared: ReturnType<typeof admitQueuedDeliveryRecovery> | undefined;
  let entry = opts.entry;
  let releaseSessionPermit: (() => void) | undefined;
  const acquireReplyPermit = async () => {
    if (entry.pendingFinalDelivery && !releaseSessionPermit) {
      const { acquirePendingFinalDeliveryPermit } =
        await import("../../agents/recovery-authority/final-delivery-session.js");
      releaseSessionPermit = acquirePendingFinalDeliveryPermit(
        entry.pendingFinalDelivery,
        entry.session?.agentId,
      );
    }
  };
  try {
    const effect = queuedDeliveryEffect(entry);
    if (entry.pendingFinalDelivery && effect !== "applied" && effect !== "reconciled") {
      const { hasCurrentPendingFinalDelivery } =
        await import("../../agents/recovery-authority/final-delivery-session.js");
      if (await hasCurrentPendingFinalDelivery(entry.pendingFinalDelivery))
        await acquireReplyPermit();
    }
    prepared = admitQueuedDeliveryRecovery(entry, opts.stateDir);
    if (!prepared) return "already-gone";
    entry = prepared.entry;
    let reconciliation: ChannelMessageUnknownSendReconciliationResult | null = null;
    if (queuedDeliveryEffect(entry) === "unknown") {
      reconciliation = await reconcileUnknownQueuedDelivery({
        entry,
        cfg: opts.cfg,
        log: opts.log,
      });
      const effect =
        reconciliation?.status === "sent"
          ? "applied"
          : reconciliation?.status === "not_sent"
            ? "not_applied"
            : "unknown";
      const current = recordQueuedDeliveryEffect(entry, effect, opts.stateDir);
      if (!current) return "already-gone";
      // A retired Session cannot admit a new lifecycle notification. Its
      // queue owner still reconciles and settles the confirmed platform effect.
      if (
        reconciliation?.status === "sent" &&
        (!entry.pendingFinalDelivery || releaseSessionPermit)
      ) {
        await runReconciledSentCommitHooks({
          entry: current,
          cfg: opts.cfg,
          reconciliation,
          log: opts.log,
        });
      }
      finishQueuedDeliveryRecovery(
        current,
        effect === "unknown"
          ? "effect reconciliation unresolved"
          : "effect reconciliation completed",
        opts.stateDir,
      );
      if (effect === "unknown") {
        opts.log.warn(`Delivery entry ${entry.id} remains pending for effect reconciliation`);
        return "failed";
      }
      if (effect === "not_applied" && current.retryCount < MAX_RETRIES && !opts.bypassBackoff) {
        const eligibility = isEntryEligibleForRecoveryRetry(current, Date.now());
        if (!eligibility.eligible) return "deferred-backoff";
      }
      prepared = admitQueuedDeliveryRecovery(current, opts.stateDir);
      if (!prepared) return "already-gone";
      entry = prepared.entry;
    }
    if (prepared.decision.kind === "settle") {
      // Commit hooks are process-local best-effort notifications. Applied
      // restart recovery settles queue truth without replaying these callbacks
      // or requiring a permit from a fenced generation.
      if (!(await ackDelivery(entry.id, opts.stateDir, entry)))
        return (await loadPendingDelivery(entry.id, opts.stateDir)) ? "failed" : "already-gone";
      opts.onRecovered?.(entry);
      return "recovered";
    }
    if (!prepared.admitted) {
      if (prepared.record?.state === "wedged") {
        await moveToFailed(entry.id, opts.stateDir, entry);
        return "moved-to-failed";
      }
      return "failed";
    }
    let failed = false;
    if (entry.pendingFinalDelivery) {
      const { bindPendingFinalDeliveryIntent } =
        await import("../../agents/recovery-authority/final-delivery-session.js");
      const bound = await bindPendingFinalDeliveryIntent({
        ...entry.pendingFinalDelivery,
        intent: {
          id: entry.id,
          channel: entry.channel,
          to: entry.to,
          accountId: entry.accountId,
          queuePolicy: "required",
        },
      });
      if (!bound) {
        finishQueuedDeliveryRecovery(
          entry,
          "final delivery no longer owns its pending reply",
          opts.stateDir,
        );
        await moveToFailed(entry.id, opts.stateDir, entry);
        return "moved-to-failed";
      }
    }
    await acquireReplyPermit();
    const boundary = recordQueuedDeliveryEffect(entry, "unknown", opts.stateDir);
    if (!boundary) return "already-gone";
    const result = await opts.deliver({
      ...buildRecoveryDeliverParams(entry, opts.cfg, opts.stateDir),
      onError: () => {
        failed = true;
      },
    });
    if (failed || !isOutboundDeliveryResultArray(result)) {
      finishQueuedDeliveryRecovery(
        entry,
        "delivery result requires effect reconciliation",
        opts.stateDir,
      );
      return "failed";
    }
    const applied = recordQueuedDeliveryEffect(entry, "applied", opts.stateDir);
    if (!applied) return "already-gone";
    await runOutboundDeliveryCommitHooks(result);
    if (!(await ackDelivery(entry.id, opts.stateDir, applied))) {
      finishQueuedDeliveryRecovery(
        applied,
        "final delivery awaits Session settlement",
        opts.stateDir,
      );
      return (await loadPendingDelivery(entry.id, opts.stateDir)) ? "failed" : "already-gone";
    }
    opts.onRecovered?.(entry);
    return "recovered";
  } catch (error) {
    if (getErrnoCode(error) === "ENOENT") return "already-gone";
    const message = formatErrorMessage(error);
    if (prepared) finishQueuedDeliveryRecovery(entry, message, opts.stateDir);
    opts.onFailed?.(entry, message);
    return "failed";
  } finally {
    releaseSessionPermit?.();
  }
}

export async function drainPendingDeliveries(opts: {
  drainKey: string;
  logLabel: string;
  cfg: OpenClawConfig;
  log: RecoveryLogger;
  stateDir?: string;
  deliver: DeliverFn;
  selectEntry: (entry: QueuedDelivery, now: number) => PendingDeliveryDrainDecision;
}): Promise<void> {
  if (drainInProgress.get(opts.drainKey)) {
    opts.log.info(`${opts.logLabel}: already in progress for ${opts.drainKey}, skipping`);
    return;
  }

  drainInProgress.set(opts.drainKey, true);
  try {
    const now = Date.now();
    const deliver = opts.deliver;
    const matchingEntries = (await loadPendingDeliveries(opts.stateDir))
      .filter((entry) => opts.selectEntry(entry, now).match)
      .toSorted((a, b) => a.enqueuedAt - b.enqueuedAt);

    if (matchingEntries.length === 0) {
      return;
    }

    opts.log.info(
      `${opts.logLabel}: ${matchingEntries.length} pending message(s) matched ${opts.drainKey}`,
    );

    for (const entry of matchingEntries) {
      if (!claimRecoveryEntry(entry.id)) {
        opts.log.info(`${opts.logLabel}: entry ${entry.id} is already being recovered`);
        continue;
      }

      try {
        // Re-read after claim so the queue file remains the source of truth.
        // This prevents stale startup/reconnect snapshots from re-sending an
        // entry that another recovery path already acked.
        const currentEntry = await loadPendingDelivery(entry.id, opts.stateDir);
        if (!currentEntry) {
          opts.log.info(`${opts.logLabel}: entry ${entry.id} already gone, skipping`);
          continue;
        }

        const currentDecision = opts.selectEntry(currentEntry, Date.now());
        if (!currentDecision.match) {
          opts.log.info(`${opts.logLabel}: entry ${currentEntry.id} no longer matches, skipping`);
          continue;
        }

        const gated = usesQueuedDeliveryAuthority(currentEntry);
        if (!gated && currentEntry.retryCount >= MAX_RETRIES) {
          try {
            await moveToFailed(currentEntry.id, opts.stateDir);
          } catch (err) {
            if (getErrnoCode(err) === "ENOENT") {
              opts.log.info(`${opts.logLabel}: entry ${currentEntry.id} already gone, skipping`);
              continue;
            }
            throw err;
          }
          opts.log.warn(
            `${opts.logLabel}: entry ${currentEntry.id} exceeded max retries and was moved to failed/`,
          );
          continue;
        }

        if (
          !currentDecision.bypassBackoff &&
          (!gated || queuedDeliveryEffect(currentEntry) === "not_applied")
        ) {
          const retryEligibility = isEntryEligibleForRecoveryRetry(currentEntry, Date.now());
          if (!retryEligibility.eligible) {
            opts.log.info(
              `${opts.logLabel}: entry ${currentEntry.id} not ready for retry yet — backoff ${retryEligibility.remainingBackoffMs}ms remaining`,
            );
            continue;
          }
        }

        const result = await drainQueuedEntry({
          entry: currentEntry,
          cfg: opts.cfg,
          deliver,
          log: opts.log,
          stateDir: opts.stateDir,
          bypassBackoff: currentDecision.bypassBackoff,
          onFailed: (failedEntry, errMsg) => {
            if (isPermanentDeliveryError(errMsg)) {
              opts.log.warn(
                `${opts.logLabel}: entry ${failedEntry.id} hit permanent error — moving to failed/: ${errMsg}`,
              );
              return;
            }
            opts.log.warn(`${opts.logLabel}: retry failed for entry ${failedEntry.id}: ${errMsg}`);
          },
        });
        if (result === "recovered") {
          opts.log.info(
            `${opts.logLabel}: drained delivery ${currentEntry.id} on ${currentEntry.channel}`,
          );
        }
      } finally {
        releaseRecoveryEntry(entry.id);
      }
    }
  } finally {
    drainInProgress.delete(opts.drainKey);
  }
}

/**
 * On gateway startup, scan the delivery queue and retry any pending entries.
 * Uses exponential backoff and moves entries that exceed MAX_RETRIES to failed/.
 */
export async function recoverPendingDeliveries(opts: {
  deliver: DeliverFn;
  log: RecoveryLogger;
  cfg: OpenClawConfig;
  stateDir?: string;
  /** Maximum wall-clock time for recovery in ms. Remaining entries are deferred to next startup. Default: 60 000. */
  maxRecoveryMs?: number;
}): Promise<RecoverySummary> {
  const pending = await loadPendingDeliveries(opts.stateDir);
  if (pending.length === 0) {
    return createEmptyRecoverySummary();
  }

  pending.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  opts.log.info(`Found ${pending.length} pending delivery entries — starting recovery`);

  const deadline = resolveRecoveryDeadlineMs(opts.maxRecoveryMs);
  const summary = createEmptyRecoverySummary();

  for (const entry of pending) {
    const now = Date.now();
    if (now >= deadline) {
      opts.log.warn(`Recovery time budget exceeded — remaining entries deferred to next startup`);
      // Budget deferral is not a delivery attempt. Keep entries pending without
      // consuming retry budget; attempted failures still flow through failDelivery.
      break;
    }

    if (!claimRecoveryEntry(entry.id)) {
      opts.log.info(`Recovery skipped for delivery ${entry.id}: already being processed`);
      continue;
    }

    try {
      const currentEntry = await loadPendingDelivery(entry.id, opts.stateDir);
      if (!currentEntry) {
        opts.log.info(`Recovery skipped for delivery ${entry.id}: already gone`);
        continue;
      }

      const gated = usesQueuedDeliveryAuthority(currentEntry);
      if (!gated && currentEntry.retryCount >= MAX_RETRIES) {
        opts.log.warn(
          `Delivery ${currentEntry.id} exceeded max retries (${currentEntry.retryCount}/${MAX_RETRIES}) — moving to failed/`,
        );
        await moveEntryToFailedWithLogging(currentEntry.id, opts.log, opts.stateDir);
        summary.skippedMaxRetries += 1;
        continue;
      }

      const currentRetryEligibility = isEntryEligibleForRecoveryRetry(currentEntry, Date.now());
      if (
        !currentRetryEligibility.eligible &&
        (!gated || queuedDeliveryEffect(currentEntry) === "not_applied")
      ) {
        summary.deferredBackoff += 1;
        opts.log.info(
          `Delivery ${currentEntry.id} not ready for retry yet — backoff ${currentRetryEligibility.remainingBackoffMs}ms remaining`,
        );
        continue;
      }

      const result = await drainQueuedEntry({
        entry: currentEntry,
        cfg: opts.cfg,
        deliver: opts.deliver,
        log: opts.log,
        stateDir: opts.stateDir,
        onRecovered: (recoveredEntry) => {
          summary.recovered += 1;
          opts.log.info(`Recovered delivery ${recoveredEntry.id} on ${recoveredEntry.channel}`);
        },
        onFailed: (failedEntry, errMsg) => {
          summary.failed += 1;
          if (isPermanentDeliveryError(errMsg)) {
            opts.log.warn(
              `Delivery ${failedEntry.id} hit permanent error — moving to failed/: ${errMsg}`,
            );
            return;
          }
          opts.log.warn(`Retry failed for delivery ${failedEntry.id}: ${errMsg}`);
        },
      });
      if (result === "moved-to-failed") {
        continue;
      }
      if (result === "deferred-backoff") summary.deferredBackoff += 1;
    } finally {
      releaseRecoveryEntry(entry.id);
    }
  }

  opts.log.info(
    `Delivery recovery complete: ${summary.recovered} recovered, ${summary.failed} failed, ${summary.skippedMaxRetries} skipped (max retries), ${summary.deferredBackoff} deferred (backoff)`,
  );
  return summary;
}

export { MAX_RETRIES };
