/**
 * Post-restart recovery for main sessions interrupted while holding a transcript lock.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { sanitizePendingFinalDeliveryText } from "../auto-reply/reply/pending-final-delivery.js";
import { resolveStateDir } from "../config/paths.js";
import {
  type SessionEntry,
  loadSessionStore,
  resolveAllAgentSessionStoreTargetsSync,
  resolveSessionFilePath,
  resolveSessionTranscriptPathInDir,
  updateSessionStore,
} from "../config/sessions.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { callGateway } from "../gateway/call.js";
import { readSessionMessagesAsync } from "../gateway/session-utils.fs.js";
import { resolveGatewaySessionStoreTarget } from "../gateway/session-utils.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { recordRecoveryEvalDecision } from "../infra/recovery-eval-probe.js";
import { CommandLane } from "../process/lanes.js";
import { isAcpSessionKey, isCronSessionKey, isSubagentSessionKey } from "../routing/session-key.js";
import { resolveSendPolicy } from "../sessions/send-policy.js";
import {
  deliveryContextFromSession,
  normalizeDeliveryContext,
  type DeliveryContext,
} from "../utils/delivery-context.shared.js";
import { isDeliverableMessageChannel } from "../utils/message-channel.js";
import { resolveAgentSessionDirs } from "./session-dirs.js";
import { resolveMainSessionResumeBlockReason } from "./main-session-restart-recovery-boundary.js";
import { recoveryAuthorityV1 } from "./recovery-authority/authority.js";
import { buildMainSessionRecoveryRequest } from "./recovery-authority/main-session-adapter.js";
import {
  admitMainSessionRecovery,
  finishMainSessionRecovery,
  hasRetainedMainSessionRecovery,
} from "./recovery-authority/main-session-admission.js";
import {
  getRecoveryAdmissionIdentity,
  isRecoveryAuthorityEnabled,
} from "./recovery-authority/owner-admission.js";
import type { RecoveryOwnerAdmission } from "../../../shared/recovery-authority/contract.js";
import {
  compareRecoveryShadow,
  isRecoveryAuthorityShadowEnabled,
  recoveryShadowSink,
  type LegacyRecoveryOutcome,
} from "./recovery-authority/shadow.js";
import {
  isExecutionPhaseWriterEnabled,
  settlePersistedToolResult,
} from "./execution-phase/tool-boundary.js";
import {
  authorizePendingToolRecovery,
  resolveExecutionPhaseRecovery,
} from "./execution-phase/recovery.js";
import { settleOrphanedExecutionPhases } from "./execution-phase/store.js";
import type { SessionLockInspection } from "./session-write-lock.js";

const log = createSubsystemLogger("main-session-restart-recovery");

const DEFAULT_RECOVERY_DELAY_MS = 5_000;
const MAX_RECOVERY_RETRIES = 3;
const RETRY_BACKOFF_MULTIPLIER = 2;
const UNRESUMABLE_SESSION_NOTICE =
  "I was interrupted by a gateway restart and couldn't safely resume the previous turn. " +
  "Please send that last request again and I'll pick it up cleanly.";

function shouldSkipMainRecovery(entry: SessionEntry, sessionKey: string): boolean {
  if (typeof entry.spawnDepth === "number" && entry.spawnDepth > 0) {
    return true;
  }
  if (entry.subagentRole != null) {
    return true;
  }
  return (
    isSubagentSessionKey(sessionKey) || isCronSessionKey(sessionKey) || isAcpSessionKey(sessionKey)
  );
}

function normalizeStringSet(values: Iterable<string> | undefined): Set<string> {
  const normalized = new Set<string>();
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (trimmed) {
      normalized.add(trimmed);
    }
  }
  return normalized;
}

function normalizeTranscriptLockPath(lockPath: string): string | undefined {
  const trimmed = lockPath.trim();
  if (!path.basename(trimmed).endsWith(".jsonl.lock")) {
    return undefined;
  }
  const resolved = path.resolve(trimmed);
  try {
    return path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved));
  } catch {
    return resolved;
  }
}

function resolveEntryTranscriptLockPaths(params: {
  entry: SessionEntry;
  sessionsDir: string;
}): string[] {
  const paths = new Set<string>();
  const push = (resolvePath: () => string) => {
    try {
      paths.add(path.resolve(`${resolvePath()}.lock`));
    } catch {
      // Keep restart recovery best-effort when session metadata is stale.
    }
  };
  push(() =>
    resolveSessionFilePath(params.entry.sessionId, params.entry, {
      sessionsDir: params.sessionsDir,
    }),
  );
  push(() => resolveSessionTranscriptPathInDir(params.entry.sessionId, params.sessionsDir));
  return [...paths];
}

export async function markRestartAbortedMainSessions(params: {
  cfg?: OpenClawConfig;
  additionalCfgs?: Iterable<OpenClawConfig | undefined>;
  stateDir?: string;
  sessionKeys?: Iterable<string>;
  sessionIds?: Iterable<string>;
  reason?: string;
}): Promise<{ marked: number; skipped: number }> {
  const sessionKeys = normalizeStringSet(params.sessionKeys);
  const sessionIds = normalizeStringSet(params.sessionIds);
  const preferSessionIdMatch = sessionIds.size > 0;
  const result = { marked: 0, skipped: 0 };
  if (sessionKeys.size === 0 && sessionIds.size === 0) {
    return result;
  }

  const storePaths = new Set<string>();
  const env =
    params.stateDir === undefined
      ? process.env
      : { ...process.env, OPENCLAW_STATE_DIR: params.stateDir };
  const stateDir = resolveStateDir(env);
  const configs = [params.cfg, ...(params.additionalCfgs ?? [])].filter(
    (cfg): cfg is OpenClawConfig => Boolean(cfg),
  );
  for (const cfg of configs) {
    try {
      for (const target of resolveAllAgentSessionStoreTargetsSync(cfg, { env })) {
        storePaths.add(path.resolve(target.storePath));
      }
    } catch (err) {
      log.warn(`failed to resolve configured session stores for restart marker: ${String(err)}`);
    }
    for (const sessionKey of sessionKeys) {
      try {
        const target = resolveGatewaySessionStoreTarget({
          cfg,
          key: sessionKey,
          scanLegacyKeys: true,
        });
        storePaths.add(path.resolve(target.storePath));
        for (const storeKey of target.storeKeys) {
          const trimmed = storeKey.trim();
          if (trimmed) {
            sessionKeys.add(trimmed);
          }
        }
      } catch (err) {
        log.warn(
          `failed to resolve session store for restart marker ${sessionKey}: ${String(err)}`,
        );
      }
    }
  }

  for (const sessionsDir of await resolveAgentSessionDirs(stateDir)) {
    storePaths.add(path.join(sessionsDir, "sessions.json"));
  }

  for (const storePath of storePaths) {
    await updateSessionStore(
      storePath,
      (store) => {
        for (const [sessionKey, entry] of Object.entries(store)) {
          if (!entry || entry.status !== "running") {
            continue;
          }
          const matches =
            typeof entry.sessionId === "string" && sessionIds.has(entry.sessionId)
              ? true
              : !preferSessionIdMatch && sessionKeys.has(sessionKey);
          if (!matches) {
            continue;
          }
          if (shouldSkipMainRecovery(entry, sessionKey)) {
            result.skipped++;
            continue;
          }
          entry.abortedLastRun = true;
          entry.updatedAt = Date.now();
          store[sessionKey] = entry;
          result.marked++;
        }
      },
      { skipMaintenance: true },
    );
  }

  if (result.marked > 0) {
    log.warn(
      `marked ${result.marked} interrupted main session(s) for restart recovery${
        params.reason ? ` (${params.reason})` : ""
      }`,
    );
  }
  return result;
}

function buildResumeMessage(pendingFinalDeliveryText?: string | null): string {
  const base =
    "[System] Your previous turn was interrupted by a gateway restart while " +
    "OpenClaw was waiting on tool/model work. Continue from the existing " +
    "transcript and finish the interrupted response.";
  const sanitizedPendingText =
    typeof pendingFinalDeliveryText === "string"
      ? sanitizePendingFinalDeliveryText(pendingFinalDeliveryText)
      : "";
  if (sanitizedPendingText) {
    return `${base}\n\nNote: The interrupted final reply was captured: "${sanitizedPendingText}"`;
  }
  return base;
}

function hasSamePendingFinalDelivery(current: SessionEntry, expected: SessionEntry): boolean {
  return (
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

async function markSessionFailed(params: {
  entry: SessionEntry;
  storePath: string;
  sessionKey: string;
  reason: string;
}): Promise<void> {
  await updateSessionStore(
    params.storePath,
    (store) => {
      const entry = store[params.sessionKey];
      if (
        !entry ||
        entry.status !== "running" ||
        entry.sessionId !== params.entry.sessionId ||
        entry.lifecycleRunId !== params.entry.lifecycleRunId
      ) {
        return;
      }
      entry.status = "failed";
      entry.abortedLastRun = true;
      entry.endedAt = Date.now();
      entry.updatedAt = entry.endedAt;
      // A previous or concurrently replaced delivery remains owned by its sender.
      if (!isRecoveryAuthorityEnabled() && hasSamePendingFinalDelivery(entry, params.entry)) {
        entry.pendingFinalDelivery = undefined;
        entry.pendingFinalDeliveryText = undefined;
        entry.pendingFinalDeliveryRunId = undefined;
        entry.pendingFinalDeliveryRecoveryRunId = undefined;
        entry.pendingFinalDeliveryCreatedAt = undefined;
        entry.pendingFinalDeliveryLastAttemptAt = undefined;
        entry.pendingFinalDeliveryAttemptCount = undefined;
        entry.pendingFinalDeliveryLastError = undefined;
        entry.pendingFinalDeliveryContext = undefined;
        entry.pendingFinalDeliveryIntentId = undefined;
      }
      entry.restartRecoveryDeliveryContext = undefined;
      entry.restartRecoveryDeliveryRunId = undefined;
      store[params.sessionKey] = entry;
    },
    { skipMaintenance: true },
  );
  log.warn(`marked interrupted main session failed: ${params.sessionKey} (${params.reason})`);
}

async function sendUnresumableSessionNotice(params: {
  cfg?: OpenClawConfig;
  entry: SessionEntry;
  reason: string;
  sessionKey: string;
}): Promise<boolean> {
  const deliveryContext = resolveRestartRecoveryDeliveryContext({
    cfg: params.cfg,
    entry: params.entry,
    includeSessionDeliveryFallback: true,
    sessionKey: params.sessionKey,
  });
  if (!deliveryContext) {
    return false;
  }

  const messageParams: Record<string, unknown> = {
    to: deliveryContext.to,
    message: UNRESUMABLE_SESSION_NOTICE,
    bestEffort: true,
  };
  if (deliveryContext?.threadId != null) {
    messageParams.threadId = deliveryContext.threadId;
  }
  const actionParams: Record<string, unknown> = {
    channel: deliveryContext.channel,
    action: "send",
    sessionKey: params.sessionKey,
    sessionId: params.entry.sessionId,
    idempotencyKey: `main-session-restart-recovery:${params.entry.sessionId}:failed-notice`,
    params: messageParams,
  };
  const accountId = normalizeOptionalString(deliveryContext?.accountId);
  if (accountId) {
    actionParams.accountId = accountId;
  }

  try {
    await callGateway({
      method: "message.action",
      params: actionParams,
      timeoutMs: 10_000,
    });
    log.info(
      `sent interrupted main session recovery notice: ${params.sessionKey} (${params.reason})`,
    );
    return true;
  } catch (err) {
    log.warn(
      `failed to send interrupted main session recovery notice ${params.sessionKey}: ${String(err)}`,
    );
    return false;
  }
}

function resolveRestartRecoveryDeliveryContext(params: {
  cfg?: OpenClawConfig;
  entry: SessionEntry;
  includeSessionDeliveryFallback?: boolean;
  sessionKey: string;
}): DeliveryContext | undefined {
  const deliveryContext =
    normalizeDeliveryContext(params.entry.pendingFinalDeliveryContext) ??
    normalizeDeliveryContext(params.entry.restartRecoveryDeliveryContext) ??
    (params.includeSessionDeliveryFallback ? deliveryContextFromSession(params.entry) : undefined);
  const channel = normalizeOptionalString(deliveryContext?.channel);
  const to = normalizeOptionalString(deliveryContext?.to);
  if (!channel || !to || !isDeliverableMessageChannel(channel)) {
    return undefined;
  }
  if (
    params.cfg &&
    resolveSendPolicy({
      cfg: params.cfg,
      entry: params.entry,
      sessionKey: params.sessionKey,
      channel,
      chatType: params.entry.chatType,
    }) === "deny"
  ) {
    return undefined;
  }
  return {
    ...deliveryContext,
    channel,
    to,
  };
}

async function resumeMainSession(params: {
  cfg?: OpenClawConfig;
  entry: SessionEntry;
  storePath: string;
  sessionKey: string;
  pendingFinalDeliveryText?: string | null;
  recoveryBoundary: string;
  authorityAdmission?: RecoveryOwnerAdmission;
}): Promise<boolean> {
  const sanitizedPendingText =
    typeof params.pendingFinalDeliveryText === "string"
      ? sanitizePendingFinalDeliveryText(params.pendingFinalDeliveryText)
      : "";
  const deliveryContext = resolveRestartRecoveryDeliveryContext({
    cfg: params.cfg,
    entry: params.entry,
    sessionKey: params.sessionKey,
  });
  try {
    const phaseWriter = isExecutionPhaseWriterEnabled();
    const carriesPendingFinal = Boolean(
      params.entry.pendingFinalDelivery || params.entry.pendingFinalDeliveryText,
    );
    // Reuse the admitted continuation while this exact payload remains pending.
    // Replacing it before RPC start can orphan the prior lifecycle on a failed RPC.
    let recoveryRunId =
      params.authorityAdmission?.idempotencyKey ||
      (carriesPendingFinal && params.entry.pendingFinalDeliveryRecoveryRunId) ||
      crypto.randomUUID();
    let pendingSnapshot = params.entry;
    if (!params.authorityAdmission && (phaseWriter || carriesPendingFinal)) {
      let admitted = false;
      await updateSessionStore(
        params.storePath,
        (store) => {
          const current = store[params.sessionKey];
          if (
            !current ||
            current.sessionId !== params.entry.sessionId ||
            current.lifecycleRunId !== params.entry.lifecycleRunId ||
            current.abortedLastRun !== true
          )
            throw new Error("restart recovery session or run identity changed");
          if (carriesPendingFinal && !hasSamePendingFinalDelivery(current, params.entry))
            throw new Error("restart recovery pending delivery changed");
          if (phaseWriter) {
            const previous =
              current.restartRecovery?.sessionId === current.sessionId &&
              current.restartRecovery.boundary === params.recoveryBoundary
                ? current.restartRecovery
                : undefined;
            if (
              previous &&
              (previous.state === "wedged" || previous.attempts >= MAX_RECOVERY_RETRIES)
            ) {
              current.restartRecovery = { ...previous, state: "wedged" };
              current.status = "failed";
              current.endedAt = Date.now();
              return;
            }
            recoveryRunId = previous?.runId ?? recoveryRunId;
            current.restartRecovery = {
              sessionId: current.sessionId,
              boundary: params.recoveryBoundary,
              runId: recoveryRunId,
              attempts: (previous?.attempts ?? 0) + 1,
              state: "admitted",
            };
          }
          if (carriesPendingFinal) {
            // Keep the producer identity and bind its continuation before dispatch.
            // Another crash may refresh startedAt without changing delivery ownership.
            current.pendingFinalDeliveryRecoveryRunId = recoveryRunId;
            pendingSnapshot = { ...params.entry, pendingFinalDeliveryRecoveryRunId: recoveryRunId };
          }
          admitted = true;
        },
        { skipMaintenance: true },
      );
      if (!admitted) return false;
    }
    const agentParams: Record<string, unknown> = {
      message: buildResumeMessage(sanitizedPendingText),
      sessionKey: params.sessionKey,
      sessionId: params.entry.sessionId,
      idempotencyKey: recoveryRunId,
      deliver: Boolean(deliveryContext),
      lane: CommandLane.Main,
    };
    if (params.authorityAdmission) {
      agentParams.recoveryAdmission = getRecoveryAdmissionIdentity(params.authorityAdmission);
      agentParams.suppressPromptPersistence = true;
    }
    if (deliveryContext) {
      agentParams.channel = deliveryContext.channel;
      agentParams.to = deliveryContext.to;
      agentParams.bestEffortDeliver = true;
      if (deliveryContext.accountId) {
        agentParams.accountId = deliveryContext.accountId;
      }
      if (deliveryContext.threadId != null) {
        agentParams.threadId = String(deliveryContext.threadId);
      }
    }
    const acknowledgement = await callGateway<{ runId: string }>({
      method: "agent",
      params: agentParams,
      timeoutMs: 10_000,
    });
    if (params.authorityAdmission) {
      const accepted = acknowledgement.runId === recoveryRunId;
      const committed = await finishMainSessionRecovery({
        entry: params.entry,
        storePath: params.storePath,
        sessionKey: params.sessionKey,
        record: params.authorityAdmission,
        state: accepted ? "accepted" : "reconcile",
      });
      return accepted && committed;
    }
    await updateSessionStore(
      params.storePath,
      (store) => {
        const entry = store[params.sessionKey];
        if (
          !entry ||
          entry.sessionId !== params.entry.sessionId ||
          (entry.lifecycleRunId !== params.entry.lifecycleRunId &&
            entry.lifecycleRunId !== recoveryRunId)
        ) {
          return;
        }
        if (isExecutionPhaseWriterEnabled()) {
          if (entry.restartRecovery?.runId !== recoveryRunId) return;
          entry.restartRecovery.state = "accepted";
        }
        const now = Date.now();
        entry.abortedLastRun = false;
        entry.updatedAt = now;
        // The RPC may finish after a new result has replaced this delivery.
        // Only update the exact pending payload observed before dispatch.
        if (
          (params.entry.pendingFinalDelivery || params.entry.pendingFinalDeliveryText) &&
          hasSamePendingFinalDelivery(entry, pendingSnapshot)
        ) {
          if (sanitizedPendingText) {
            entry.pendingFinalDeliveryLastAttemptAt = now;
            entry.pendingFinalDeliveryAttemptCount =
              (entry.pendingFinalDeliveryAttemptCount ?? 0) + 1;
            entry.pendingFinalDeliveryLastError = null;
            entry.pendingFinalDeliveryText = sanitizedPendingText;
          } else {
            entry.pendingFinalDelivery = undefined;
            entry.pendingFinalDeliveryText = undefined;
            entry.pendingFinalDeliveryRunId = undefined;
            entry.pendingFinalDeliveryRecoveryRunId = undefined;
            entry.pendingFinalDeliveryCreatedAt = undefined;
            entry.pendingFinalDeliveryLastAttemptAt = undefined;
            entry.pendingFinalDeliveryAttemptCount = undefined;
            entry.pendingFinalDeliveryLastError = undefined;
            entry.pendingFinalDeliveryContext = undefined;
          }
        }
        store[params.sessionKey] = entry;
      },
      { skipMaintenance: true },
    );
    log.info(
      `resumed interrupted main session: ${params.sessionKey}${
        sanitizedPendingText ? " (with pending payload)" : ""
      }`,
    );
    return true;
  } catch (err) {
    if (params.authorityAdmission) {
      await finishMainSessionRecovery({
        entry: params.entry,
        storePath: params.storePath,
        sessionKey: params.sessionKey,
        record: params.authorityAdmission,
        state: "reconcile",
      });
    }
    log.warn(`failed to resume interrupted main session ${params.sessionKey}: ${String(err)}`);
    return false;
  }
}

export async function markRestartAbortedMainSessionsFromLocks(params: {
  sessionsDir: string;
  cleanedLocks: SessionLockInspection[];
}): Promise<{ marked: number; skipped: number }> {
  const result = { marked: 0, skipped: 0 };
  const sessionsDir = path.resolve(params.sessionsDir);
  const interruptedLockPaths = new Set(
    params.cleanedLocks
      .map((lock) => normalizeTranscriptLockPath(lock.lockPath))
      .filter((lockPath): lockPath is string => Boolean(lockPath)),
  );
  if (interruptedLockPaths.size === 0) {
    return result;
  }

  const storePath = path.join(sessionsDir, "sessions.json");
  await updateSessionStore(
    storePath,
    (store) => {
      for (const [sessionKey, entry] of Object.entries(store)) {
        if (!entry || entry.status !== "running") {
          continue;
        }
        if (shouldSkipMainRecovery(entry, sessionKey)) {
          result.skipped++;
          continue;
        }
        const entryLockPaths = resolveEntryTranscriptLockPaths({ entry, sessionsDir });
        if (!entryLockPaths.some((lockPath) => interruptedLockPaths.has(lockPath))) {
          continue;
        }
        entry.abortedLastRun = true;
        store[sessionKey] = entry;
        result.marked++;
      }
    },
    { skipMaintenance: true },
  );

  if (result.marked > 0) {
    log.warn(`marked ${result.marked} interrupted main session(s) from stale transcript locks`);
  }
  return result;
}

async function recoverStore(params: {
  cfg?: OpenClawConfig;
  storePath: string;
  resumedSessionKeys: Set<string>;
}): Promise<{ recovered: number; failed: number; skipped: number }> {
  const result = { recovered: 0, failed: 0, skipped: 0 };
  let store: Record<string, SessionEntry>;
  try {
    store = loadSessionStore(params.storePath);
  } catch (err) {
    log.warn(`failed to load session store ${params.storePath}: ${String(err)}`);
    result.failed++;
    return result;
  }

  for (const [sessionKey, entry] of Object.entries(store).toSorted(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!entry || entry.status !== "running" || entry.abortedLastRun !== true) {
      continue;
    }
    if (shouldSkipMainRecovery(entry, sessionKey)) {
      result.skipped++;
      continue;
    }
    if (!isRecoveryAuthorityEnabled() && hasRetainedMainSessionRecovery(entry)) {
      recordRecoveryEvalDecision({
        sessionKey,
        sessionId: entry.sessionId,
        action: "reconcile",
        reason: "saved main recovery uncertainty remains reserved after authority rollback",
      });
      result.skipped++;
      continue;
    }
    if (params.resumedSessionKeys.has(sessionKey)) {
      result.skipped++;
      continue;
    }

    let messages: unknown[];
    try {
      messages = await readSessionMessagesAsync(
        entry.sessionId,
        params.storePath,
        entry.sessionFile,
        {
          mode: "recent",
          maxMessages: 20,
          maxBytes: 256 * 1024,
        },
      );
    } catch (err) {
      log.warn(`failed to read transcript for ${sessionKey}: ${String(err)}`);
      result.failed++;
      continue;
    }

    // Lifecycle timestamps change on every recovery attempt. Only the durable
    // producer or its admitted continuation may carry this pending delivery.
    // Unbound/older payloads remain with their delivery owner, never discarded.
    const pendingBelongsToRun = Boolean(
      entry.lifecycleRunId &&
      (entry.pendingFinalDeliveryRunId === entry.lifecycleRunId ||
        entry.pendingFinalDeliveryRecoveryRunId === entry.lifecycleRunId),
    );
    const recoveryEntry = pendingBelongsToRun
      ? entry
      : {
          ...entry,
          pendingFinalDelivery: undefined,
          pendingFinalDeliveryText: undefined,
          pendingFinalDeliveryContext: undefined,
        };
    const resumeBlockReason = resolveMainSessionResumeBlockReason(messages);

    // Compare with the observed owner outcome, including failed admission/RPC.
    // A predicted "resumed" value would hide a real continuation failure.
    const recordShadow = (outcome: LegacyRecoveryOutcome) => {
      if (!isRecoveryAuthorityShadowEnabled()) return;
      try {
        const request = buildMainSessionRecoveryRequest({
          sessionKey,
          sessionId: entry.sessionId ?? sessionKey,
          attemptsConsumed: entry.restartRecovery?.attempts ?? 0,
          maxAttempts: MAX_RECOVERY_RETRIES,
          resumable: !resumeBlockReason,
          approvalPending: Boolean(resumeBlockReason?.includes("approval-pending")),
          visibleOutputObserved:
            entry.recoveryOutput?.sessionId === entry.sessionId &&
            entry.recoveryOutput.runId === entry.lifecycleRunId &&
            entry.recoveryOutput.visibleOutputObserved === true,
          pendingFinalDelivery: Boolean(recoveryEntry.pendingFinalDeliveryText),
        });
        const decision = recoveryAuthorityV1.decide(request);
        const record = compareRecoveryShadow(request, decision, outcome);
        recoveryShadowSink.record(record);
        recordRecoveryEvalDecision({
          sessionKey,
          sessionId: entry.sessionId,
          action: "shadow",
          ...record,
        });
      } catch (err) {
        log.warn(`recovery authority shadow failed for ${sessionKey}: ${String(err)}`);
      }
    };
    // TF-0719: with the execution-phase writer on, an open effect may already
    // have been applied. Resuming blindly would duplicate it.
    let effectiveResumeBlockReason = resumeBlockReason;
    let phaseRecovery = {
      action: "reconcile" as "none" | "resume" | "reconcile",
      phases: [] as string[],
      reason: "durable tool writer disabled",
    };
    if (isExecutionPhaseWriterEnabled()) {
      for (const message of messages) {
        settlePersistedToolResult(message as import("./runtime/index.js").AgentMessage, {
          sessionKey,
          sessionId: entry.sessionId,
        });
      }
      phaseRecovery = resolveExecutionPhaseRecovery(
        sessionKey,
        process.env,
        {},
        {
          sessionId: entry.sessionId,
          messages,
        },
      );
      if (phaseRecovery.action === "reconcile") {
        effectiveResumeBlockReason =
          "execution phase requires reconciliation: " + phaseRecovery.reason;
      } else if (
        !isRecoveryAuthorityEnabled() &&
        !effectiveResumeBlockReason &&
        phaseRecovery.action === "resume"
      ) {
        try {
          authorizePendingToolRecovery({ sessionKey, sessionId: entry.sessionId, messages });
        } catch (error) {
          effectiveResumeBlockReason = "execution recovery authorization failed: " + String(error);
        }
      }
    }
    const recoveryBoundary = crypto
      .createHash("sha256")
      .update(JSON.stringify(messages.slice(-1)))
      .digest("hex");
    let authorityAdmission: RecoveryOwnerAdmission | undefined;
    if (isRecoveryAuthorityEnabled()) {
      const admitted = await admitMainSessionRecovery({
        entry: recoveryEntry,
        storePath: params.storePath,
        sessionKey,
        boundary: recoveryBoundary,
        phase: phaseRecovery,
        resumeBlockReason,
        maxAttempts: MAX_RECOVERY_RETRIES,
        cfg: params.cfg,
      });
      if (admitted.kind !== "admitted") {
        if (admitted.kind === "rejected") {
          await markSessionFailed({
            entry: recoveryEntry,
            storePath: params.storePath,
            sessionKey,
            reason: admitted.reason,
          });
          await sendUnresumableSessionNotice({
            cfg: params.cfg,
            entry: recoveryEntry,
            sessionKey,
            reason: admitted.reason,
          });
        }
        recordRecoveryEvalDecision({
          sessionKey,
          sessionId: entry.sessionId,
          action: "reconcile",
          reason: admitted.reason,
        });
        result.failed++;
        continue;
      }
      authorityAdmission = admitted.record;
      if (phaseRecovery.action === "resume") {
        try {
          authorizePendingToolRecovery({ sessionKey, sessionId: entry.sessionId, messages });
        } catch (error) {
          await finishMainSessionRecovery({
            entry: recoveryEntry,
            storePath: params.storePath,
            sessionKey,
            record: admitted.record,
            state: "reconcile",
          });
          recordRecoveryEvalDecision({
            sessionKey,
            sessionId: entry.sessionId,
            action: "reconcile",
            reason: String(error),
          });
          result.failed++;
          continue;
        }
      }
    }
    if (effectiveResumeBlockReason) {
      recordShadow("not-resumed");
      recordRecoveryEvalDecision({
        sessionKey,
        sessionId: entry.sessionId,
        action: "reconcile",
        reason: effectiveResumeBlockReason,
      });
      await sendUnresumableSessionNotice({
        cfg: params.cfg,
        entry: recoveryEntry,
        sessionKey,
        reason: effectiveResumeBlockReason,
      });
      await markSessionFailed({
        entry: recoveryEntry,
        storePath: params.storePath,
        sessionKey,
        reason: effectiveResumeBlockReason,
      });
      result.failed++;
      continue;
    }

    recordRecoveryEvalDecision({ sessionKey, sessionId: entry.sessionId, action: "resume" });
    const resumed = await resumeMainSession({
      cfg: params.cfg,
      entry: recoveryEntry,
      storePath: params.storePath,
      sessionKey,
      pendingFinalDeliveryText: recoveryEntry.pendingFinalDeliveryText,
      recoveryBoundary,
      authorityAdmission,
    });
    recordShadow(resumed ? "resumed" : "failed");
    if (resumed) {
      params.resumedSessionKeys.add(sessionKey);
      result.recovered++;
    } else {
      result.failed++;
    }
  }

  return result;
}

async function resolveRestartRecoveryStorePaths(params: {
  cfg?: OpenClawConfig;
  stateDir?: string;
}): Promise<string[]> {
  const storePaths = new Set<string>();
  const stateDir = params.stateDir ?? resolveStateDir(process.env);
  for (const sessionsDir of await resolveAgentSessionDirs(stateDir)) {
    storePaths.add(path.join(sessionsDir, "sessions.json"));
  }
  if (params.cfg) {
    const env = { ...process.env, OPENCLAW_STATE_DIR: stateDir };
    for (const target of resolveAllAgentSessionStoreTargetsSync(params.cfg, { env })) {
      storePaths.add(path.resolve(target.storePath));
    }
  }
  return [...storePaths].toSorted((a, b) => a.localeCompare(b));
}

export async function recoverRestartAbortedMainSessions(
  params: {
    cfg?: OpenClawConfig;
    stateDir?: string;
    resumedSessionKeys?: Set<string>;
  } = {},
): Promise<{ recovered: number; failed: number; skipped: number }> {
  const result = { recovered: 0, failed: 0, skipped: 0 };
  const resumedSessionKeys = params.resumedSessionKeys ?? new Set<string>();
  if (isExecutionPhaseWriterEnabled()) {
    try {
      settleOrphanedExecutionPhases();
    } catch (err) {
      log.warn("execution phase settlement failed: " + String(err));
    }
  }

  for (const storePath of await resolveRestartRecoveryStorePaths(params)) {
    const storeResult = await recoverStore({
      cfg: params.cfg,
      storePath,
      resumedSessionKeys,
    });
    result.recovered += storeResult.recovered;
    result.failed += storeResult.failed;
    result.skipped += storeResult.skipped;
  }

  if (result.recovered > 0 || result.failed > 0) {
    log.info(
      `main-session restart recovery complete: recovered=${result.recovered} failed=${result.failed} skipped=${result.skipped}`,
    );
  }
  return result;
}

export function scheduleRestartAbortedMainSessionRecovery(
  params: {
    cfg?: OpenClawConfig;
    delayMs?: number;
    maxRetries?: number;
    stateDir?: string;
  } = {},
): void {
  const candidateMode = isExecutionPhaseWriterEnabled();
  const initialDelay = params.delayMs ?? (candidateMode ? 1_000 : DEFAULT_RECOVERY_DELAY_MS);
  const nextDelay = (delay: number) =>
    candidateMode
      ? Math.min(delay * RETRY_BACKOFF_MULTIPLIER, 10_000)
      : delay * RETRY_BACKOFF_MULTIPLIER;
  const maxRetries = params.maxRetries ?? MAX_RECOVERY_RETRIES;
  const resumedSessionKeys = new Set<string>();

  const attemptRecovery = (attempt: number, delay: number) => {
    setTimeout(() => {
      void recoverRestartAbortedMainSessions({
        cfg: params.cfg,
        stateDir: params.stateDir,
        resumedSessionKeys,
      })
        .then((result) => {
          if (result.failed > 0 && attempt < maxRetries) {
            attemptRecovery(attempt + 1, nextDelay(delay));
          }
        })
        .catch((err: unknown) => {
          if (attempt < maxRetries) {
            log.warn(`main-session restart recovery failed: ${String(err)}`);
            attemptRecovery(attempt + 1, nextDelay(delay));
          } else {
            log.warn(`main-session restart recovery gave up: ${String(err)}`);
          }
        });
    }, delay).unref?.();
  };

  attemptRecovery(1, initialDelay);
}
