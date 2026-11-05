// Gateway session reset/delete service.
// Rotates transcripts and coordinates lifecycle cleanup across runtimes/hooks.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ErrorCodes, errorShape } from "../../packages/gateway-protocol/src/index.js";
import { getAcpSessionManager } from "../acp/control-plane/manager.js";
import { getAcpRuntimeBackend } from "../runtime/registry.ts";
import {
  readAcpSessionMeta,
  upsertAcpSessionMeta,
  writeAcpSessionMetaForMigration,
} from "../runtime/session-meta.ts";
import { retireSessionMcpRuntime } from "../agents/agent-bundle-mcp-tools.js";
import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import { clearBootstrapSnapshot } from "../agents/bootstrap-cache.js";
import { clearAllCliSessions } from "../agents/cli-session.js";
import {
  abortEmbeddedAgentRun,
  resolveActiveEmbeddedRunSessionId,
  waitForEmbeddedAgentRunEnd,
} from "../agents/embedded-agent-runner/runs.js";
import { listDescendantRunsForRequester } from "../agents/subagent-registry.js";
import { stopSubagentsForRequester } from "../auto-reply/reply/abort.js";
import {
  buildSessionEndHookPayload,
  buildSessionStartHookPayload,
} from "../auto-reply/reply/session-hooks.js";
import { clearSessionResetRuntimeState } from "../auto-reply/reply/session-reset-cleanup.js";
import { cleanupBrowserSessionsForLifecycleEnd } from "../browser-lifecycle-cleanup.js";
import { createWorktreeService } from "../agents/worktree-service.js";
import { getRuntimeConfig } from "../config/io.js";
import {
  snapshotSessionOrigin,
  type SessionEntry,
  updateSessionStore,
} from "../config/sessions.js";
import { resolveSessionFilePath, resolveSessionFilePathOptions } from "../config/sessions/paths.js";
import { resolveResetPreservedSelection } from "../config/sessions/reset-preserved-selection.js";
import {
  canonicalizeAbsoluteSessionFilePath,
  rewriteSessionFileForNewSessionId,
} from "../config/sessions/session-file-rotation.js";
import type { SessionAcpMeta } from "../config/sessions/types.js";
import { CURRENT_SESSION_VERSION } from "../config/sessions/version.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { logVerbose } from "../globals.js";
import { createInternalHookEvent, triggerInternalHook } from "../hooks/internal-hooks.js";
import { getSessionBindingService } from "../infra/outbound/session-binding-service.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { runPluginHostCleanup } from "../plugins/host-hook-cleanup.js";
import { getActivePluginRegistry } from "../plugins/runtime.js";
import {
  isSubagentSessionKey,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import {
  SessionAdmissionFenceWaitError,
  SessionAdmissionFencedError,
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from "../sessions/session-admission-registry.js";
import { drainScope, SESSION_DRAIN_TIMEOUT_MS } from "./session-drain-service.js";
import {
  forgetActiveSessionForShutdown,
  listActiveSessionsForShutdown,
  noteActiveSessionForShutdown,
} from "./active-sessions-shutdown-tracker.js";
import { findDirectChildSessionsForParent } from "./session-child-sessions.js";
import {
  archiveSessionTranscriptsDetailed,
  resolveSessionTranscriptCandidates,
  resolveStableSessionEndTranscript,
  type ArchivedSessionTranscript,
} from "./session-transcript-files.fs.js";
import {
  loadSessionEntry,
  migrateAndPruneGatewaySessionStoreKey,
  readSessionMessagesAsync,
  resolveGatewaySessionStoreTarget,
  resolveSessionStoreKey,
  resolveSessionModelRef,
} from "./session-utils.js";

const ACP_RUNTIME_CLEANUP_TIMEOUT_MS = 15_000;

function resolveResetSessionFile(params: {
  nextSessionId: string;
  currentEntry?: SessionEntry;
  storePath: string;
  agentId: string;
}): string {
  const currentEntry = params.currentEntry;
  // Preserve explicit session-file placement across reset while swapping the
  // embedded session id, so linked runtimes keep writing beside old transcripts.
  const rewrittenSessionFile = currentEntry?.sessionId
    ? rewriteSessionFileForNewSessionId({
        sessionFile: currentEntry.sessionFile,
        previousSessionId: currentEntry.sessionId,
        nextSessionId: params.nextSessionId,
      })
    : undefined;
  const normalizedRewrittenSessionFile =
    rewrittenSessionFile && path.isAbsolute(rewrittenSessionFile)
      ? canonicalizeAbsoluteSessionFilePath(rewrittenSessionFile)
      : rewrittenSessionFile;
  const preservedSessionFile = normalizedRewrittenSessionFile ?? currentEntry?.sessionFile;
  return resolveSessionFilePath(
    params.nextSessionId,
    preservedSessionFile ? { sessionFile: preservedSessionFile } : undefined,
    resolveSessionFilePathOptions({
      storePath: params.storePath,
      agentId: params.agentId,
    }),
  );
}

function stripRuntimeModelState(entry?: SessionEntry): SessionEntry | undefined {
  if (!entry) {
    return entry;
  }
  return {
    ...entry,
    // Reset should keep user selection preferences but drop per-run resolved
    // model state so the next turn rehydrates from current config.
    model: undefined,
    modelProvider: undefined,
    contextTokens: undefined,
    contextBudgetStatus: undefined,
    systemPromptReport: undefined,
  };
}

export function archiveSessionTranscriptsForSessionDetailed(params: {
  sessionId: string | undefined;
  storePath: string;
  sessionFile?: string;
  agentId?: string;
  reason: "reset" | "deleted";
  onArchiveError?: (err: unknown, sourcePath: string) => void;
  archiveTimestamp?: string;
  candidatePaths?: string[];
}): ArchivedSessionTranscript[] {
  if (!params.sessionId) {
    return [];
  }
  return archiveSessionTranscriptsDetailed({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
    agentId: params.agentId,
    reason: params.reason,
    onArchiveError: params.onArchiveError,
    archiveTimestamp: params.archiveTimestamp,
    candidatePaths: params.candidatePaths,
  });
}

export { resolveSessionTranscriptCandidates };

export function emitGatewaySessionEndPluginHook(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  sessionId?: string;
  operationId?: string;
  storePath: string;
  sessionFile?: string;
  agentId?: string;
  reason:
    | "new"
    | "reset"
    | "idle"
    | "daily"
    | "compaction"
    | "deleted"
    | "shutdown"
    | "restart"
    | "unknown";
  archivedTranscripts?: ArchivedSessionTranscript[];
  nextSessionId?: string;
  nextSessionKey?: string;
}): void {
  if (!params.sessionId) {
    return;
  }
  // Drop this session from the shutdown finalizer's tracked set unconditionally
  // -- even when no plugin hooks are registered for `session_end`, the session
  // is being closed here and must not be re-finalized by a later shutdown drain.
  forgetActiveSessionForShutdown(params.sessionId);
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("session_end")) {
    return;
  }
  const transcript = resolveStableSessionEndTranscript({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
    agentId: params.agentId,
    archivedTranscripts: params.archivedTranscripts,
  });
  const payload = buildSessionEndHookPayload({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    ...(params.operationId ? { operationId: params.operationId } : {}),
    cfg: params.cfg,
    reason: params.reason,
    sessionFile: transcript.sessionFile,
    transcriptArchived: transcript.transcriptArchived,
    nextSessionId: params.nextSessionId,
    nextSessionKey: params.nextSessionKey,
  });
  void hookRunner.runSessionEnd(payload.event, payload.context).catch((err: unknown) => {
    logVerbose(`session_end hook failed: ${String(err)}`);
  });
}

/** Awaitable delete finalizer variant; callers can checkpoint only after dispatch settles. */
export async function emitGatewaySessionEndPluginHookAndWait(
  params: Parameters<typeof emitGatewaySessionEndPluginHook>[0],
): Promise<void> {
  if (!params.sessionId) {
    return;
  }
  forgetActiveSessionForShutdown(params.sessionId);
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("session_end")) {
    return;
  }
  const transcript = resolveStableSessionEndTranscript({
    sessionId: params.sessionId,
    storePath: params.storePath,
    sessionFile: params.sessionFile,
    agentId: params.agentId,
    archivedTranscripts: params.archivedTranscripts,
  });
  const payload = buildSessionEndHookPayload({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    ...(params.operationId ? { operationId: params.operationId } : {}),
    cfg: params.cfg,
    reason: params.reason,
    sessionFile: transcript.sessionFile,
    transcriptArchived: transcript.transcriptArchived,
    nextSessionId: params.nextSessionId,
    nextSessionKey: params.nextSessionKey,
  });
  await hookRunner.runSessionEnd(payload.event, payload.context);
}

export function emitGatewaySessionStartPluginHook(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  sessionId?: string;
  resumedFrom?: string;
  storePath?: string;
  sessionFile?: string;
  agentId?: string;
}): void {
  if (!params.sessionId) {
    return;
  }
  // Track the session for the shutdown finalizer even when no plugin hooks are
  // registered locally, so a later restart still emits a typed `session_end`
  // for sessions that opened while a `session_end` plugin was attached. The
  // tracker is keyed by `sessionId`, so a session that is subsequently closed
  // via reset / delete / compaction is forgotten before the shutdown drain
  // ever runs (see #57790).
  if (params.storePath) {
    noteActiveSessionForShutdown({
      cfg: params.cfg,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      storePath: params.storePath,
      sessionFile: params.sessionFile,
      agentId: params.agentId,
    });
  }
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("session_start")) {
    return;
  }
  const payload = buildSessionStartHookPayload({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    cfg: params.cfg,
    resumedFrom: params.resumedFrom,
  });
  void hookRunner.runSessionStart(payload.event, payload.context).catch((err: unknown) => {
    logVerbose(`session_start hook failed: ${String(err)}`);
  });
}

const SHUTDOWN_DRAIN_DEFAULT_TOTAL_TIMEOUT_MS = 2_000;

export type DrainActiveSessionsForShutdownResult = {
  emittedSessionIds: string[];
  timedOut: boolean;
};

/**
 * Emit a typed `session_end` for every session that received `session_start`
 * but did not yet receive a paired `session_end`. The bounded total timeout
 * mirrors the gateway lifecycle hook timeout so a slow plugin cannot block
 * SIGTERM/SIGINT past the runtime's overall shutdown grace window.
 *
 * Sessions that have already been finalized through replace / reset / delete /
 * compaction are forgotten from the tracker by `emitGatewaySessionEndPluginHook`
 * before this drain runs, so they will not be double-fired here.
 */
export async function drainActiveSessionsForShutdown(params: {
  reason: "shutdown" | "restart";
  totalTimeoutMs?: number;
}): Promise<DrainActiveSessionsForShutdownResult> {
  const tracked = listActiveSessionsForShutdown();
  if (tracked.length === 0) {
    return { emittedSessionIds: [], timedOut: false };
  }
  const totalTimeoutMs = Math.max(
    100,
    Math.floor(params.totalTimeoutMs ?? SHUTDOWN_DRAIN_DEFAULT_TOTAL_TIMEOUT_MS),
  );
  const emittedSessionIds: string[] = [];
  const hookRunner = getGlobalHookRunner();
  let settledEmissions = 0;
  // Inline the session_end emission instead of calling
  // `emitGatewaySessionEndPluginHook`, because that helper uses fire-and-forget
  // (`void hookRunner.runSessionEnd(...)`). Start every tracked session's
  // emission before awaiting the bounded aggregate so one slow plugin write
  // cannot prevent later active sessions from receiving `session_end`.
  const drain = Promise.allSettled(
    tracked.map(async (entry) => {
      try {
        forgetActiveSessionForShutdown(entry.sessionId);
        emittedSessionIds.push(entry.sessionId);
        if (!hookRunner?.hasHooks("session_end")) {
          return;
        }
        const transcript = resolveStableSessionEndTranscript({
          sessionId: entry.sessionId,
          storePath: entry.storePath,
          sessionFile: entry.sessionFile,
          agentId: entry.agentId,
        });
        const payload = buildSessionEndHookPayload({
          sessionId: entry.sessionId,
          sessionKey: entry.sessionKey,
          cfg: entry.cfg,
          reason: params.reason,
          sessionFile: transcript.sessionFile,
          transcriptArchived: transcript.transcriptArchived,
        });
        await hookRunner.runSessionEnd(payload.event, payload.context);
      } catch (err) {
        logVerbose(`session_end hook failed during shutdown drain: ${String(err)}`);
      } finally {
        settledEmissions++;
      }
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), totalTimeoutMs);
    timer.unref?.();
  });
  try {
    const result = await Promise.race([drain.then(() => "ok" as const), timeout]);
    if (result === "timeout") {
      logVerbose(
        `shutdown session-end drain timed out after ${totalTimeoutMs}ms with ${tracked.length - settledEmissions} session_end handler(s) still pending`,
      );
      return { emittedSessionIds, timedOut: true };
    }
    return { emittedSessionIds, timedOut: false };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function emitSessionUnboundLifecycleEvent(params: {
  targetSessionKey: string;
  reason: "session-reset" | "session-delete" | "session-archive";
  emitHooks?: boolean;
  operationId?: string;
}) {
  const targetKind = isSubagentSessionKey(params.targetSessionKey) ? "subagent" : "acp";
  await getSessionBindingService().unbind({
    targetSessionKey: params.targetSessionKey,
    reason: params.reason,
  });

  if (params.emitHooks === false) {
    return;
  }

  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("subagent_ended")) {
    return;
  }
  await hookRunner.runSubagentEnded(
    {
      targetSessionKey: params.targetSessionKey,
      targetKind,
      ...(params.operationId ? { operationId: params.operationId } : {}),
      reason: params.reason,
      sendFarewell: true,
      outcome: params.reason === "session-reset" ? "reset" : "deleted",
    },
    {
      childSessionKey: params.targetSessionKey,
    },
  );
}

type SessionCleanupTarget = ReturnType<typeof resolveGatewaySessionStoreTarget>;

type SessionCleanupParams = {
  cfg: OpenClawConfig;
  key: string;
  target: SessionCleanupTarget;
  entry: SessionEntry | undefined;
  legacyKey?: string;
  canonicalKey?: string;
};

export type StopSessionRuntimeResult =
  | { ok: true; key: string; sessionId: string }
  | { ok: false; error: ReturnType<typeof errorShape> };

export type SessionMutationCleanupOutcome = {
  error?: ReturnType<typeof errorShape>;
  /** Archive retries reuse the same exclusive fence; unknown cleanup never reopens admission. */
  retry?: () => Promise<SessionMutationCleanupOutcome>;
  /**
   * Called once the caller knows whether the mutation committed. Archive
   * failure retains the fence for its bound recovery callback. Successful
   * delete keeps the old-generation fence as a tombstone; successful reset
   * releases the old fence because the next generation gets a new identity.
   */
  settle: (mutationSucceeded: boolean, releaseDefinitiveArchiveFailure?: boolean) => void;
};

function resolveSessionLifecycleIdentity(
  params: SessionCleanupParams,
): SessionAdmissionIdentity | undefined {
  const expectedSessionId = params.entry?.sessionId?.trim();
  if (!expectedSessionId) {
    return undefined;
  }
  return {
    agentId: normalizeAgentId(params.target.agentId),
    canonicalSessionKey: params.target.canonicalKey ?? params.key,
    expectedSessionId,
  };
}

function resolveCleanupQueueKeys(params: SessionCleanupParams): string[] {
  const queueKeys = new Set<string>(params.target.storeKeys);
  queueKeys.add(params.target.canonicalKey);
  if (params.entry?.sessionId) {
    queueKeys.add(params.entry.sessionId);
  }
  return [...queueKeys];
}

function resolveChildRunWaitTargets(
  cfg: OpenClawConfig,
  parentKey: string,
): Array<{ childSessionKey: string; sessionId?: string }> {
  void cfg;
  const targets = new Map<string, { childSessionKey: string; sessionId?: string }>();
  for (const run of listDescendantRunsForRequester(parentKey)) {
    if (typeof run.endedAt === "number") {
      continue;
    }
    const childSessionKey = run.childSessionKey.trim();
    if (!childSessionKey || targets.has(childSessionKey)) {
      continue;
    }
    const sessionId =
      resolveActiveEmbeddedRunSessionId(childSessionKey) ??
      loadSessionEntry(childSessionKey)?.entry?.sessionId;
    targets.set(childSessionKey, { childSessionKey, sessionId });
  }
  return [...targets.values()];
}

async function closeTrackedBrowserTabs(
  params: SessionCleanupParams & {
    reason: "session-reset" | "session-delete" | "session-archive";
  },
): Promise<void> {
  const closeKeys = new Set<string>([
    params.key,
    params.target.canonicalKey,
    ...params.target.storeKeys,
    params.entry?.sessionId ?? "",
  ]);
  const strict = params.reason === "session-archive";
  const failures: string[] = [];
  await cleanupBrowserSessionsForLifecycleEnd({
    cfg: params.cfg,
    sessionKeys: [...closeKeys],
    onWarn: (message) => {
      logVerbose(message);
      if (strict) failures.push(message);
    },
    onError: (error) => {
      logVerbose(`sessions.${params.reason}: browser cleanup failed: ${String(error)}`);
      if (strict) failures.push(String(error));
    },
  });
  if (strict && failures.length) {
    throw new Error(`Browser cleanup is incomplete: ${failures.join('; ')}`);
  }
}

function cleanupSessionWorktrees(params: {
  cleanup: SessionCleanupParams;
  identity: SessionAdmissionIdentity;
}): { attempted: number; reclaimed: number; failed: number; kept: number; worktreeIds: string[] } {
  const workspaceDir =
    params.cleanup.entry?.workspaceDir?.trim() ||
    params.cleanup.entry?.spawnedWorkspaceDir?.trim();
  if (!workspaceDir) {
    return { attempted: 0, reclaimed: 0, failed: 0, kept: 0, worktreeIds: [] };
  }
  const result = createWorktreeService(workspaceDir).cleanupOwned({
    agentId: params.identity.agentId,
    sessionKey: params.identity.canonicalSessionKey,
    expectedSessionId: params.identity.expectedSessionId,
  });
  return {
    attempted: result.attempted,
    reclaimed: result.reclaimed,
    failed: result.failed,
    kept: result.kept,
    worktreeIds: result.worktreeIds,
  };
}
async function runSessionStopFront(params: {
  cleanup: SessionCleanupParams;
  identity: SessionAdmissionIdentity;
  reason: "session-stop" | "session-reset" | "session-delete" | "session-archive";
}): Promise<ReturnType<typeof errorShape> | undefined> {
  const { cleanup } = params;
  const sessionId = cleanup.entry?.sessionId?.trim();
  const parentKey = cleanup.target.canonicalKey ?? cleanup.canonicalKey ?? cleanup.key;
  if (!sessionId) {
    return errorShape(ErrorCodes.INVALID_REQUEST, `session not found: ${cleanup.key}`);
  }

  // Fixed finalizer front order: queues/system events -> abort parent ->
  // recursive abort children -> wait for embedded runs -> drainScope.
  clearSessionResetRuntimeState(resolveCleanupQueueKeys(cleanup));
  clearBootstrapSnapshot(cleanup.target.canonicalKey);
  abortEmbeddedAgentRun(sessionId);
  const childTargets = resolveChildRunWaitTargets(cleanup.cfg, parentKey);
  stopSubagentsForRequester({ cfg: cleanup.cfg, requesterSessionKey: parentKey });

  const parentEnded = await waitForEmbeddedAgentRunEnd(sessionId, SESSION_DRAIN_TIMEOUT_MS);
  if (!parentEnded) {
    return errorShape(
      ErrorCodes.UNAVAILABLE,
      `Session ${cleanup.key} is still active; try again in a moment.`,
    );
  }
  for (const child of childTargets) {
    if (!child.sessionId) {
      return errorShape(
        ErrorCodes.UNAVAILABLE,
        `Subagent child ${child.childSessionKey} is still active; unable to resolve its embedded run id.`,
      );
    }
    const childEnded = await waitForEmbeddedAgentRunEnd(child.sessionId, SESSION_DRAIN_TIMEOUT_MS);
    if (!childEnded) {
      return errorShape(
        ErrorCodes.UNAVAILABLE,
        `Subagent child ${child.childSessionKey} is still active; try again in a moment.`,
      );
    }
  }

  const drain = await drainScope(params.identity, SESSION_DRAIN_TIMEOUT_MS);
  if (!drain.ok) {
    return errorShape(
      ErrorCodes.UNAVAILABLE,
      `Session ${cleanup.key} drain failed (${drain.reason}): ${drain.message}`,
    );
  }
  if (params.reason === "session-delete") {
    const worktrees = cleanupSessionWorktrees(params);
    if (worktrees.failed > 0) {
      return errorShape(
        ErrorCodes.UNAVAILABLE,
        `Session ${cleanup.key} retained ${worktrees.failed} managed worktree(s) after cleanup failure: ${worktrees.worktreeIds.join(", ")}`,
      );
    }
  }
  return undefined;
}

async function runCleanupOtherOwners(
  params: SessionCleanupParams & {
    reason: "session-reset" | "session-delete" | "session-archive";
    onAcpResetMeta?: (meta: { sessionKey: string; meta: SessionAcpMeta }) => void;
  },
): Promise<ReturnType<typeof errorShape> | undefined> {
  if (params.entry?.sessionId) {
    const mcpErrors: string[] = [];
    await retireSessionMcpRuntime({
      sessionId: params.entry.sessionId,
      reason: "gateway-session-cleanup",
      onError: (error, sessionId) => {
        mcpErrors.push(String(error));
        logVerbose(
          `sessions cleanup: failed to dispose bundle MCP runtime for ${sessionId}: ${String(error)}`,
        );
      },
    });
    if (params.reason === "session-archive" && mcpErrors.length) {
      return errorShape(ErrorCodes.UNAVAILABLE, `MCP cleanup is incomplete: ${mcpErrors.join('; ')}`);
    }
  }
  await closeTrackedBrowserTabs(params);

  const pluginCleanup = await runPluginHostCleanup({
    cfg: params.cfg,
    registry: getActivePluginRegistry(),
    reason: params.reason === "session-reset" ? "reset" : "delete",
    sessionKey: params.target.canonicalKey ?? params.key,
  });
  for (const failure of pluginCleanup.failures) {
    logVerbose(
      `plugin host cleanup failed for ${failure.pluginId}/${failure.hookId}: ${String(failure.error)}`,
    );
  }
  if (params.reason === "session-archive" && pluginCleanup.failures.length) {
    return errorShape(ErrorCodes.UNAVAILABLE, "Plugin owner cleanup is incomplete.");
  }

  const parentSessionKey = params.target.canonicalKey ?? params.canonicalKey ?? params.key;
  const parentAcpError = await closeAcpRuntimeForSession({
    cfg: params.cfg,
    sessionKey: parentSessionKey,
    fallbackSessionKeys: [params.canonicalKey, params.legacyKey, params.key],
    reason: params.reason,
    onResetMeta: params.onAcpResetMeta,
  });
  const childAcpError = await closeChildAcpRuntimesForParent({
    cfg: params.cfg,
    parentKey: parentSessionKey,
    reason: params.reason,
  });
  return parentAcpError ?? childAcpError;
}

/**
 * Stops runtime activity for one session without any store/transcript
 * mutation. Used by `sessions.stop`; the fence is released on success.
 */
export async function stopSessionRuntime(
  params: SessionCleanupParams & { onFenced?: () => void },
): Promise<StopSessionRuntimeResult> {
  const identity = resolveSessionLifecycleIdentity(params);
  if (!identity) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, `session not found: ${params.key}`),
    };
  }
  let fence: Awaited<ReturnType<typeof sessionAdmissionRegistry.fence>>;
  try {
    fence = await sessionAdmissionRegistry.fence(identity, {
      timeoutMs: SESSION_DRAIN_TIMEOUT_MS,
      operation: "session-stop",
    });
  } catch (error) {
    if (error instanceof SessionAdmissionFencedError) {
      return {
        ok: false,
        error: errorShape(
          ErrorCodes.UNAVAILABLE,
          `Session ${params.key} is fenced by another lifecycle operation.`,
        ),
      };
    }
    if (error instanceof SessionAdmissionFenceWaitError) {
      // Fail closed: the fence stays closed, so nothing was mutated and the old
      // generation cannot re-admit. Recovery uses the existing removeFence path.
      return {
        ok: false,
        error: errorShape(
          ErrorCodes.UNAVAILABLE,
          `Session ${params.key} admission fence did not drain within ${SESSION_DRAIN_TIMEOUT_MS}ms ` +
            `(${error.reason}); ${error.activeAtFailure} permit(s) still in flight. No stop was performed.`,
          { retryable: true },
        ),
      };
    }
    throw error;
  }
  try {
    params.onFenced?.();
    const frontError = await runSessionStopFront({ cleanup: params, identity, reason: "session-stop" });
    if (frontError) {
      fence.release();
      return { ok: false, error: frontError };
    }
    fence.release();
    return { ok: true, key: params.target.canonicalKey ?? params.key, sessionId: identity.expectedSessionId };
  } catch (error) {
    fence.release();
    throw error;
  }
}
async function runAcpCleanupStep(params: {
  op: () => Promise<void>;
}): Promise<{ status: "ok" } | { status: "timeout" } | { status: "error"; error: unknown }> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<{ status: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ status: "timeout" }), ACP_RUNTIME_CLEANUP_TIMEOUT_MS);
  });
  const opPromise = params
    .op()
    .then(() => ({ status: "ok" as const }))
    .catch((error: unknown) => ({ status: "error" as const, error }));
  const outcome = await Promise.race([opPromise, timeoutPromise]);
  if (timer) {
    clearTimeout(timer);
  }
  return outcome;
}

async function closeAcpRuntimeForSession(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  fallbackSessionKeys?: Array<string | undefined>;
  reason: "session-reset" | "session-delete" | "session-archive";
  onResetMeta?: (params: { sessionKey: string; meta: SessionAcpMeta }) => void;
}) {
  const sessionKeys = Array.from(
    new Set(
      [params.sessionKey, ...(params.fallbackSessionKeys ?? [])]
        .map((key) => (typeof key === "string" ? key.trim() : ""))
        .filter(Boolean),
    ),
  );
  let acpMeta: SessionAcpMeta | undefined;
  let acpSessionKey = params.sessionKey;
  for (const sessionKey of sessionKeys) {
    acpMeta = readAcpSessionMeta({ sessionKey });
    if (acpMeta) {
      acpSessionKey = sessionKey;
      break;
    }
  }
  if (!acpMeta) {
    return undefined;
  }
  const acpManager = getAcpSessionManager();
  const cancelOutcome = await runAcpCleanupStep({
    op: async () => {
      await acpManager.cancelSession({
        cfg: params.cfg,
        sessionKey: acpSessionKey,
        reason: params.reason,
      });
    },
  });
  if (cancelOutcome.status === "timeout") {
    return errorShape(
      ErrorCodes.UNAVAILABLE,
      `Session ${params.sessionKey} is still active; try again in a moment.`,
    );
  }
  if (cancelOutcome.status === "error") {
    logVerbose(
      `sessions.${params.reason}: ACP cancel failed for ${params.sessionKey}: ${String(cancelOutcome.error)}`,
    );
  }

  const closeOutcome = await runAcpCleanupStep({
    op: async () => {
      await acpManager.closeSession({
        cfg: params.cfg,
        sessionKey: acpSessionKey,
        reason: params.reason,
        discardPersistentState: true,
        requireAcpSession: false,
        allowBackendUnavailable: true,
      });
    },
  });
  if (closeOutcome.status === "timeout") {
    return errorShape(
      ErrorCodes.UNAVAILABLE,
      `Session ${params.sessionKey} is still active; try again in a moment.`,
    );
  }
  if (closeOutcome.status === "error") {
    logVerbose(
      `sessions.${params.reason}: ACP runtime close failed for ${params.sessionKey}: ${String(closeOutcome.error)}`,
    );
  }
  if (params.reason === "session-delete") {
    await upsertAcpSessionMeta({
      cfg: params.cfg,
      sessionKey: acpSessionKey,
      mutate: () => null,
    });
  } else {
    const resetMeta = await ensureFreshAcpResetState({
      cfg: params.cfg,
      sessionKey: acpSessionKey,
      reason: params.reason,
      acpMeta,
    });
    if (resetMeta) {
      params.onResetMeta?.({ sessionKey: acpSessionKey, meta: resetMeta });
    }
  }
  return undefined;
}

function buildPendingAcpMeta(base: SessionAcpMeta, now: number): SessionAcpMeta {
  const currentIdentity = base.identity;
  const nextIdentity = currentIdentity
    ? {
        state: "pending" as const,
        ...(currentIdentity.acpxRecordId ? { acpxRecordId: currentIdentity.acpxRecordId } : {}),
        source: currentIdentity.source,
        lastUpdatedAt: now,
      }
    : undefined;
  return {
    backend: base.backend,
    agent: base.agent,
    runtimeSessionName: base.runtimeSessionName,
    ...(nextIdentity ? { identity: nextIdentity } : {}),
    mode: base.mode,
    ...(base.runtimeOptions ? { runtimeOptions: base.runtimeOptions } : {}),
    ...(base.cwd ? { cwd: base.cwd } : {}),
    state: "idle",
    lastActivityAt: now,
  };
}

async function ensureFreshAcpResetState(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  reason: "session-reset" | "session-delete" | "session-archive";
  acpMeta: SessionAcpMeta;
}): Promise<SessionAcpMeta | undefined> {
  if (params.reason !== "session-reset") {
    return undefined;
  }
  const latestMeta =
    readAcpSessionMeta({
      sessionKey: params.sessionKey,
    }) ?? params.acpMeta;
  if (
    !latestMeta?.identity ||
    latestMeta.identity.state !== "resolved" ||
    (!latestMeta.identity.acpxSessionId && !latestMeta.identity.agentSessionId)
  ) {
    return undefined;
  }

  const backendId = (latestMeta.backend || params.cfg.acp?.backend || "").trim() || undefined;
  try {
    await getAcpRuntimeBackend(backendId)?.runtime.prepareFreshSession?.({
      sessionKey: params.sessionKey,
    });
  } catch (error) {
    logVerbose(
      `sessions.${params.reason}: ACP prepareFreshSession failed for ${params.sessionKey}: ${String(error)}`,
    );
  }

  const now = Date.now();
  let resetMeta: SessionAcpMeta | undefined;
  await upsertAcpSessionMeta({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    mutate: (current) => {
      resetMeta = buildPendingAcpMeta(current ?? latestMeta, now);
      return resetMeta;
    },
  });
  return resetMeta;
}

async function closeChildAcpRuntimesForParent(params: {
  cfg: OpenClawConfig;
  parentKey: string;
  reason: "session-reset" | "session-delete" | "session-archive";
}): Promise<ReturnType<typeof errorShape> | undefined> {
  let firstError: ReturnType<typeof errorShape> | undefined;
  // Enumerate across every agent session store, not just the parent's: ACP
  // spawns create child keys under the target agent (`agent:<targetAgentId>:acp:…`)
  // whose entries live in that agent's store, which is a different file from the
  // parent's under the default per-agent layout. The combined gateway store
  // aggregates all agent stores under canonical keys (same source the dashboard
  // session list uses).
  let children: Array<{ sessionKey: string }>;
  try {
    children = findDirectChildSessionsForParent({
      cfg: params.cfg,
      parentKey: params.parentKey,
    }).flatMap(({ sessionKey }) => {
      const acpMeta = readAcpSessionMeta({ sessionKey });
      return acpMeta ? [{ sessionKey }] : [];
    });
  } catch (error) {
    logVerbose(
      `sessions.${params.reason}: failed to enumerate sessions for child ACP cleanup: ${String(error)}`,
    );
    if (params.reason === "session-archive") {
      return errorShape(ErrorCodes.UNAVAILABLE, `Child ACP owner inventory is unavailable: ${String(error)}`);
    }
    return undefined;
  }
  // Close only direct ACP-backed children of the session being mutated; the
  // parent itself is closed separately by the caller. Without this, child ACP
  // sessions spawned via sessions_spawn are orphaned on parent reset/delete.
  // Close children concurrently so total latency is bounded by a single ACP
  // cleanup timeout window. Reset/delete retain their historical best-effort
  // behavior; archive treats an unknown child owner result as fail-closed.
  const results = await Promise.allSettled(
    children.map(({ sessionKey }) =>
      closeAcpRuntimeForSession({
        cfg: params.cfg,
        sessionKey,
        reason: params.reason,
      }).then((childError) => {
        if (childError) {
          if (params.reason === "session-archive") firstError ??= childError;
          logVerbose(`sessions.${params.reason}: child ACP cleanup incomplete for ${sessionKey}`);
        }
      }),
    ),
  );
  const rejected = results.find((result) => result.status === "rejected");
  if (params.reason === "session-archive" && rejected?.status === "rejected") {
    firstError ??= errorShape(
      ErrorCodes.UNAVAILABLE,
      `Child ACP cleanup is unknown: ${String(rejected.reason)}`,
    );
  }
  return params.reason === "session-archive" ? firstError : undefined;
}

export async function cleanupSessionBeforeMutation(params: {
  cfg: OpenClawConfig;
  key: string;
  target: ReturnType<typeof resolveGatewaySessionStoreTarget>;
  entry: SessionEntry | undefined;
  legacyKey?: string;
  canonicalKey?: string;
  reason: "session-reset" | "session-delete" | "session-archive";
  onAcpResetMeta?: (params: { sessionKey: string; meta: SessionAcpMeta }) => void;
}): Promise<SessionMutationCleanupOutcome> {
  const identity = resolveSessionLifecycleIdentity(params);
  let fence: Awaited<ReturnType<typeof sessionAdmissionRegistry.fence>> | undefined;
  let settled = false;

  const settle = (
    mutationSucceeded: boolean,
    releaseDefinitiveArchiveFailure = false,
  ): void => {
    if (settled) return;
    settled = true;
    // Delete and archive success keep the old-generation fence as a tombstone.
    // Unknown archive cleanup retains its exclusive owner. A caller that has
    // proven the archive request was refused before mutation can explicitly
    // release that fence so the same generation remains usable.
    if (
      (params.reason === "session-archive" && !releaseDefinitiveArchiveFailure) ||
      (params.reason === "session-delete" && mutationSucceeded)
    ) {
      return;
    }
    fence?.release();
  };

  if (identity) {
    try {
      fence = await sessionAdmissionRegistry.fence(identity, {
        timeoutMs: SESSION_DRAIN_TIMEOUT_MS,
        operation: params.reason,
      });
    } catch (error) {
      if (error instanceof SessionAdmissionFencedError) {
        return {
          error: errorShape(
            ErrorCodes.UNAVAILABLE,
            `Session ${params.key} is fenced by another lifecycle operation.`,
          ),
          settle,
        };
      }
      if (error instanceof SessionAdmissionFenceWaitError) {
        // Fail closed: the fence stays closed as a tombstone for this generation
        // (nothing is mutated, and no release/retry can re-admit it). Recovery
        // uses the existing removeFence path.
        return {
          error: errorShape(
            ErrorCodes.UNAVAILABLE,
            `Session ${params.key} admission fence did not drain within ${SESSION_DRAIN_TIMEOUT_MS}ms ` +
              `(${error.reason}); ${error.activeAtFailure} permit(s) still in flight. No mutation was performed.`,
            { retryable: true },
          ),
          settle,
        };
      }
      throw error;
    }
  }

  const runOwners = async (): Promise<SessionMutationCleanupOutcome> => {
    const retry = params.reason === "session-archive" ? runOwners : undefined;
    if (
      params.reason === "session-archive" &&
      fence &&
      !sessionAdmissionRegistry.ownsFence(fence)
    ) {
      return {
        error: errorShape(
          ErrorCodes.UNAVAILABLE,
          "Archive recovery no longer owns its admission fence.",
        ),
        settle,
      };
    }
    try {
      if (identity) {
        const frontError = await runSessionStopFront({ cleanup: params, identity, reason: params.reason });
        if (frontError) {
          return { error: frontError, settle, retry };
        }
      } else {
        // No stored generation (for example a create/reset on a missing row):
        // there is no lifecycle identity to fence or drain, but queued work and
        // child activity for the key aliases must still be cleared.
        clearSessionResetRuntimeState(resolveCleanupQueueKeys(params));
        clearBootstrapSnapshot(params.target.canonicalKey);
        stopSubagentsForRequester({
          cfg: params.cfg,
          requesterSessionKey: params.target.canonicalKey,
        });
      }

      const otherOwnersError = await runCleanupOtherOwners(params);
      if (otherOwnersError) {
        return { error: otherOwnersError, settle, retry };
      }
      return { settle, retry };
    } catch (error) {
      if (params.reason === "session-archive") {
        return {
          error: errorShape(ErrorCodes.UNAVAILABLE, `Archive cleanup is unknown: ${String(error)}`),
          settle,
          retry,
        };
      }
      fence?.release();
      settled = true;
      throw error;
    }
  };
  return runOwners();
}
export async function emitGatewayBeforeResetPluginHook(params: {
  cfg: OpenClawConfig;
  key: string;
  target: ReturnType<typeof resolveGatewaySessionStoreTarget>;
  storePath: string;
  entry?: SessionEntry;
  reason: "new" | "reset";
}): Promise<void> {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("before_reset")) {
    return;
  }

  const sessionKey = params.target.canonicalKey ?? params.key;
  const sessionId = params.entry?.sessionId;
  const sessionFile = params.entry?.sessionFile;
  const agentId = normalizeAgentId(params.target.agentId ?? resolveDefaultAgentId(params.cfg));
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
  let messages: unknown[] = [];
  try {
    if (typeof sessionId === "string" && sessionId.trim().length > 0) {
      messages = await readSessionMessagesAsync(sessionId, params.storePath, sessionFile, {
        mode: "full",
        reason: "before_reset hook payload",
      });
    }
  } catch (err) {
    logVerbose(
      `before_reset: failed to read session messages for ${sessionId ?? "(none)"}; firing hook with empty messages (${String(err)})`,
    );
  }

  void hookRunner
    .runBeforeReset(
      {
        sessionFile,
        messages,
        reason: params.reason,
      },
      {
        agentId,
        sessionKey,
        sessionId,
        workspaceDir,
      },
    )
    .catch((err: unknown) => {
      logVerbose(`before_reset hook failed: ${String(err)}`);
    });
}

export async function performGatewaySessionReset(params: {
  key: string;
  agentId?: string;
  reason: "new" | "reset";
  commandSource: string;
}): Promise<
  | { ok: true; key: string; entry: SessionEntry; agentId: string }
  | { ok: false; error: ReturnType<typeof errorShape> }
> {
  const resetTarget = (() => {
    const cfg = getRuntimeConfig();
    const explicitAgentId = params.agentId ? normalizeAgentId(params.agentId) : undefined;
    const parsedKey = parseAgentSessionKey(params.key);
    const inferredGlobalAgentId =
      !explicitAgentId &&
      parsedKey &&
      resolveSessionStoreKey({ cfg, sessionKey: params.key }) === "global"
        ? normalizeAgentId(parsedKey.agentId)
        : undefined;
    const requestedAgentId = explicitAgentId ?? inferredGlobalAgentId;
    if (requestedAgentId && !listAgentIds(cfg).includes(requestedAgentId)) {
      return {
        ok: false as const,
        error: errorShape(ErrorCodes.INVALID_REQUEST, `Unknown agent id: ${requestedAgentId}`),
      };
    }
    if (
      explicitAgentId &&
      parsedKey?.agentId &&
      normalizeAgentId(parsedKey.agentId) !== explicitAgentId
    ) {
      return {
        ok: false as const,
        error: errorShape(ErrorCodes.INVALID_REQUEST, "session key agent does not match agentId"),
      };
    }
    const target = resolveGatewaySessionStoreTarget({
      cfg,
      key: params.key,
      ...(requestedAgentId ? { agentId: requestedAgentId } : {}),
    });
    return { ok: true as const, cfg, target, storePath: target.storePath, requestedAgentId };
  })();
  if (!resetTarget.ok) {
    return resetTarget;
  }
  const { cfg, target, storePath, requestedAgentId } = resetTarget;
  const { entry, legacyKey, canonicalKey } = loadSessionEntry(
    params.key,
    requestedAgentId ? { agentId: requestedAgentId } : undefined,
  );
  const hadExistingEntry = Boolean(entry);
  const agentId = normalizeAgentId(target.agentId ?? resolveDefaultAgentId(cfg));
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  let pendingAcpResetMeta: { sessionKey: string; meta: SessionAcpMeta } | undefined;
  const hookEvent = createInternalHookEvent(
    "command",
    params.reason,
    target.canonicalKey ?? params.key,
    {
      sessionEntry: entry,
      previousSessionEntry: entry,
      commandSource: params.commandSource,
      cfg,
      workspaceDir,
    },
  );
  await triggerInternalHook(hookEvent);
  const mutationCleanup = await cleanupSessionBeforeMutation({
    cfg,
    key: params.key,
    target,
    entry,
    legacyKey,
    canonicalKey,
    reason: "session-reset",
    onAcpResetMeta: (meta) => {
      pendingAcpResetMeta = meta;
    },
  });
  if (mutationCleanup.error) {
    mutationCleanup.settle(false);
    return { ok: false, error: mutationCleanup.error };
  }

  let oldSessionId: string | undefined;
  let oldSessionFile: string | undefined;
  let resetSourceEntry: SessionEntry | undefined;
  let resetMutationSucceeded = false;
  let next: SessionEntry;
  try {
    next = await updateSessionStore(storePath, (store) => {
      const { primaryKey } = migrateAndPruneGatewaySessionStoreKey({
        cfg,
        key: params.key,
        store,
        ...(requestedAgentId ? { agentId: requestedAgentId } : {}),
      });
      const currentEntry = store[primaryKey];
      resetSourceEntry = currentEntry ? { ...currentEntry } : undefined;
      const parsed = parseAgentSessionKey(primaryKey);
      const sessionAgentId = normalizeAgentId(
        parsed?.agentId ?? target.agentId ?? requestedAgentId ?? resolveDefaultAgentId(cfg),
      );
      const resetPreservedSelection = resolveResetPreservedSelection({
        entry: currentEntry,
      });
      const resetEntry = {
        ...stripRuntimeModelState(currentEntry),
        providerOverride: undefined,
        modelOverride: undefined,
        modelOverrideSource: undefined,
        authProfileOverride: undefined,
        authProfileOverrideSource: undefined,
        authProfileOverrideCompactionCount: undefined,
        ...resetPreservedSelection,
      };
      const resolvedModel = resolveSessionModelRef(cfg, resetEntry, sessionAgentId);
      oldSessionId = currentEntry?.sessionId;
      oldSessionFile = currentEntry?.sessionFile;
      const now = Date.now();
      const nextSessionId = randomUUID();
      const sessionFile = resolveResetSessionFile({
        nextSessionId,
        currentEntry,
        storePath,
        agentId: sessionAgentId,
      });
      const nextEntry: SessionEntry = {
        sessionId: nextSessionId,
        sessionFile,
        updatedAt: now,
        systemSent: false,
        abortedLastRun: false,
        thinkingLevel: currentEntry?.thinkingLevel,
        fastMode: currentEntry?.fastMode,
        verboseLevel: currentEntry?.verboseLevel,
        traceLevel: currentEntry?.traceLevel,
        reasoningLevel: currentEntry?.reasoningLevel,
        elevatedLevel: currentEntry?.elevatedLevel,
        ttsAuto: currentEntry?.ttsAuto,
        execHost: currentEntry?.execHost,
        execSecurity: currentEntry?.execSecurity,
        execAsk: currentEntry?.execAsk,
        execNode: currentEntry?.execNode,
        responseUsage: currentEntry?.responseUsage,
        // Resets should keep the user's explicit selection, but clear any
        // temporary fallback model that was pinned during the previous run.
        ...resetPreservedSelection,
        groupActivation: currentEntry?.groupActivation,
        groupActivationNeedsSystemIntro: currentEntry?.groupActivationNeedsSystemIntro,
        chatType: currentEntry?.chatType,
        model: resolvedModel.model,
        modelProvider: resolvedModel.provider,
        contextTokens: resetEntry?.contextTokens,
        compactionCount: currentEntry?.compactionCount,
        compactionCheckpoints: currentEntry?.compactionCheckpoints,
        sendPolicy: currentEntry?.sendPolicy,
        queueMode: currentEntry?.queueMode,
        queueDebounceMs: currentEntry?.queueDebounceMs,
        queueCap: currentEntry?.queueCap,
        queueDrop: currentEntry?.queueDrop,
        spawnedBy: currentEntry?.spawnedBy,
        spawnedWorkspaceDir: currentEntry?.spawnedWorkspaceDir,
        spawnedCwd: currentEntry?.spawnedCwd,
        parentSessionKey: currentEntry?.parentSessionKey,
        forkedFromParent: currentEntry?.forkedFromParent,
        spawnDepth: currentEntry?.spawnDepth,
        subagentRole: currentEntry?.subagentRole,
        subagentControlScope: currentEntry?.subagentControlScope,
        label: currentEntry?.label,
        displayName: currentEntry?.displayName,
        channel: currentEntry?.channel,
        groupId: currentEntry?.groupId,
        subject: currentEntry?.subject,
        groupChannel: currentEntry?.groupChannel,
        space: currentEntry?.space,
        origin: snapshotSessionOrigin(currentEntry),
        deliveryContext: currentEntry?.deliveryContext,
        cliSessionBindings: currentEntry?.cliSessionBindings,
        cliSessionIds: currentEntry?.cliSessionIds,
        claudeCliSessionId: currentEntry?.claudeCliSessionId,
        lastChannel: currentEntry?.lastChannel,
        lastTo: currentEntry?.lastTo,
        lastAccountId: currentEntry?.lastAccountId,
        lastThreadId: currentEntry?.lastThreadId,
        // Do not carry the cached skills catalog across /new. Long-lived channel
        // sessions (Signal DMs/groups in particular) otherwise keep advertising a
        // stale <available_skills> block even after reset/restart, because the
        // skills snapshot version is runtime-local and may reset to 0.
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        totalTokensFresh: true,
      };
      // Drop CLI provider bindings so the next turn after reset starts a fresh
      // CLI conversation on the provider side. Preserved only for spawned
      // subagents (canonical `:subagent:` keys), where Tak Hoffman's fa56682b3ced
      // regression fix intentionally protects CLI continuity for
      // orchestration-driven resets. Non-subagent sessions that happen to set
      // `parentSessionKey` (e.g. dashboard children) are not exempt.
      if (!isSubagentSessionKey(primaryKey)) {
        clearAllCliSessions(nextEntry);
      }
      store[primaryKey] = nextEntry;
      return nextEntry;
    });
    resetMutationSucceeded = true;
  } finally {
    mutationCleanup.settle(resetMutationSucceeded);
  }
  if (pendingAcpResetMeta) {
    writeAcpSessionMetaForMigration({
      sessionKey: pendingAcpResetMeta.sessionKey,
      sessionId: next.sessionId,
      meta: pendingAcpResetMeta.meta,
    });
  }
  await emitGatewayBeforeResetPluginHook({
    cfg,
    key: params.key,
    target,
    storePath,
    entry: resetSourceEntry,
    reason: params.reason,
  });

  const archivedTranscripts = archiveSessionTranscriptsForSessionDetailed({
    sessionId: oldSessionId,
    storePath,
    sessionFile: oldSessionFile,
    agentId: target.agentId,
    reason: "reset",
  });
  await fs.promises.mkdir(path.dirname(next.sessionFile as string), { recursive: true });
  const header = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: next.sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  };
  try {
    // "wx" makes the create-if-missing atomic; a concurrent creator winning
    // the race (EEXIST) leaves the existing header in place, same as before.
    await fs.promises.writeFile(next.sessionFile as string, `${JSON.stringify(header)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") {
      throw err;
    }
  }
  emitGatewaySessionEndPluginHook({
    cfg,
    sessionKey: target.canonicalKey ?? params.key,
    sessionId: oldSessionId,
    storePath,
    sessionFile: oldSessionFile,
    agentId: target.agentId,
    reason: params.reason,
    archivedTranscripts,
    nextSessionId: next.sessionId,
  });
  emitGatewaySessionStartPluginHook({
    cfg,
    sessionKey: target.canonicalKey ?? params.key,
    sessionId: next.sessionId,
    resumedFrom: oldSessionId,
    storePath,
    sessionFile: next.sessionFile,
    agentId: target.agentId,
  });
  if (hadExistingEntry) {
    await emitSessionUnboundLifecycleEvent({
      targetSessionKey: target.canonicalKey ?? params.key,
      reason: "session-reset",
    });
  }
  return { ok: true, key: target.canonicalKey, entry: next, agentId: target.agentId };
}
