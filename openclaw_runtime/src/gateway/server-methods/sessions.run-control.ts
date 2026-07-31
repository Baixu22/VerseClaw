// Sessions gateway run-control methods (send/steer/abort/queue drain/long-task status).
import { randomUUID } from "node:crypto";
import {
  normalizeOptionalString,
  readStringValue,
} from "@openclaw/normalization-core/string-coerce";
import {
  ErrorCodes,
  errorShape,
  validateSessionsAbortParams,
  validateSessionsRecoveryContextParams,
  validateSessionsLongTaskControlHistoryParams,
  validateSessionsLongTaskControlStatusParams,
  validateSessionsQueueDrainParams,
  validateSessionsResumeCheckpointsParams,
  validateSessionsRestoreCheckpointParams,
  validateSessionsSendParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { renderRecoveryContextProjection } from "../../../packages/agent-core/src/harness/compaction/compression-artifact.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { createCheckpointRollbackDeps } from "../../agents/checkpoint-rollback-executor.js";
import {
  executeReplayRollback,
} from "../../agents/replay-rollback-authority.js";
import { getLongTaskCheckpointById } from "../../agents/long-task-control/store.js";
import { checkpointContentDiff } from "../../agents/checkpoint-diff.js";
import { type SessionEntry } from "../../config/sessions.js";
import {
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import { resolveSessionKeyForRun } from "../server-session-key.js";
import { listSessionCompactionCheckpoints } from "../session-compaction-checkpoints.js";
import { reactivateCompletedSubagentSession } from "../session-subagent-reactivation.js";
import {
  loadSessionEntry,
  readSessionMessageCountAsync,
  resolveDeletedAgentIdFromSessionKey,
} from "../session-utils.js";
import { setGatewayDedupeEntry } from "./agent-wait-dedupe.js";
import {
  drainQueuedUserMessagesForSession,
  installQueueDrainCallback,
  chatHandlers,
} from "./chat.js";
import { hasTrackedActiveSessionRun } from "./session-active-runs.js";
import { emitSessionsChanged } from "./session-change-event.js";
import {
  countLongTaskQueuedMessages,
  getLatestLongTaskCheckpoint,
  getLatestLongTaskIntervention,
  listLongTaskCheckpoints,
  listLongTaskInterventions,
} from "../../agents/long-task-control/store.js";
import type {
  GatewayClient,
  GatewayRequestContext,
  GatewayRequestHandlerOptions,
  GatewayRequestHandlers,
  RespondFn,
} from "./types.js";
import { assertValidParams } from "./validation.js";
import {
  requireSessionKey,
  shouldAttachPendingMessageSeq,
  isAgentMainSessionKey,
  resolveAbortSessionKey,
  resolveSessionKeyAgentId,
  sessionKeyBelongsToAgent,
  resolveScopedAbortKey,
  resolveRequestedGlobalAgentId,
  interruptSessionRunIfActive,
  compressionArtifactFromCheckpoint,
  estimateProjectionTokens,
} from "./sessions.shared.js";
import { sessionsLifecycleHandlers } from "./sessions.lifecycle.js";

async function createAgentMainSessionForSend(params: {
  req: GatewayRequestHandlerOptions["req"];
  canonicalKey: string;
  context: GatewayRequestContext;
  client: GatewayClient | null;
  isWebchatConnect: GatewayRequestHandlerOptions["isWebchatConnect"];
}): Promise<
  | {
      ok: true;
      entry: SessionEntry;
      canonicalKey: string;
      storePath: string;
    }
  | { ok: false; error: ReturnType<typeof errorShape> }
> {
  const agentId = parseAgentSessionKey(params.canonicalKey)?.agentId;
  if (!agentId) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, `session not found: ${params.canonicalKey}`),
    };
  }

  let createResult:
    | { ok: boolean; payload?: { key?: string }; error?: ReturnType<typeof errorShape> }
    | undefined;
  await sessionsLifecycleHandlers["sessions.create"]({
    req: params.req,
    params: {
      key: params.canonicalKey,
      agentId,
    },
    respond: (ok, payload, error) => {
      createResult = {
        ok,
        payload: payload && typeof payload === "object" ? (payload as { key?: string }) : undefined,
        error,
      };
    },
    context: params.context,
    client: params.client,
    isWebchatConnect: params.isWebchatConnect,
  });

  if (!createResult) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.UNAVAILABLE, "sessions.create did not respond"),
    };
  }
  if (!createResult.ok) {
    return {
      ok: false,
      error: createResult.error ?? errorShape(ErrorCodes.UNAVAILABLE, "failed to create session"),
    };
  }

  const createdKey = normalizeOptionalString(createResult.payload?.key) ?? params.canonicalKey;
  const loaded = loadSessionEntry(createdKey);
  if (!loaded.entry?.sessionId) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.UNAVAILABLE, `session not created: ${createdKey}`),
    };
  }
  return {
    ok: true,
    entry: loaded.entry,
    canonicalKey: loaded.canonicalKey,
    storePath: loaded.storePath,
  };
}

async function handleSessionSend(params: {
  method: "sessions.send" | "sessions.steer";
  req: GatewayRequestHandlerOptions["req"];
  params: Record<string, unknown>;
  respond: RespondFn;
  context: GatewayRequestContext;
  client: GatewayClient | null;
  isWebchatConnect: GatewayRequestHandlerOptions["isWebchatConnect"];
  interruptIfActive: boolean;
}) {
  if (
    !assertValidParams(params.params, validateSessionsSendParams, params.method, params.respond)
  ) {
    return;
  }
  const p = params.params;
  const key = requireSessionKey((p as { key?: unknown }).key, params.respond);
  if (!key) {
    return;
  }
  const cfg = params.context.getRuntimeConfig();
  const requestedAgent = resolveRequestedGlobalAgentId(
    cfg,
    key,
    (p as { agentId?: string }).agentId,
  );
  if (!requestedAgent.ok) {
    params.respond(false, undefined, requestedAgent.error);
    return;
  }
  const requestedAgentId = requestedAgent.agentId;
  const loaded = loadSessionEntry(key, { agentId: requestedAgentId });
  let { entry, canonicalKey, storePath } = loaded;
  // Reject sends/steers targeting sessions whose owning agent was deleted (#65524).
  const deletedAgentId = resolveDeletedAgentIdFromSessionKey(cfg, canonicalKey);
  if (deletedAgentId !== null) {
    params.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `Agent "${deletedAgentId}" no longer exists in configuration`,
      ),
    );
    return;
  }
  if (!entry?.sessionId && !params.interruptIfActive && isAgentMainSessionKey(cfg, canonicalKey)) {
    // Sending to an empty agent main session should create it; steering still requires an active row.
    const created = await createAgentMainSessionForSend({
      req: params.req,
      canonicalKey,
      context: params.context,
      client: params.client,
      isWebchatConnect: params.isWebchatConnect,
    });
    if (!created.ok) {
      params.respond(false, undefined, created.error);
      return;
    }
    entry = created.entry;
    canonicalKey = created.canonicalKey;
    storePath = created.storePath;
  }
  if (!entry?.sessionId) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `session not found: ${key}`),
    );
    return;
  }

  let interruptedActiveRun = false;
  if (params.interruptIfActive) {
    const interruptResult = await interruptSessionRunIfActive({
      req: params.req,
      context: params.context,
      client: params.client,
      isWebchatConnect: params.isWebchatConnect,
      requestedKey: key,
      canonicalKey,
      agentId: requestedAgentId,
      sessionId: entry.sessionId,
    });
    if (interruptResult.error) {
      params.respond(false, undefined, interruptResult.error);
      return;
    }
    interruptedActiveRun = interruptResult.interrupted;
  }

  const messageSeq =
    (await readSessionMessageCountAsync(entry.sessionId, storePath, entry.sessionFile)) + 1;
  let sendAcked = false;
  let sendPayload: unknown;
  let sendCached = false;
  let startedRunId: string | undefined;
  const rawIdempotencyKey = (p as { idempotencyKey?: string }).idempotencyKey;
  const idempotencyKey =
    typeof rawIdempotencyKey === "string" && rawIdempotencyKey.trim()
      ? rawIdempotencyKey.trim()
      : randomUUID();
  await chatHandlers["chat.send"]({
    req: params.req,
    params: {
      sessionKey: canonicalKey,
      ...(canonicalKey === "global" && requestedAgentId ? { agentId: requestedAgentId } : {}),
      message: (p as { message: string }).message,
      thinking: (p as { thinking?: string }).thinking,
      attachments: (p as { attachments?: unknown[] }).attachments,
      timeoutMs: (p as { timeoutMs?: number }).timeoutMs,
      idempotencyKey,
    },
    respond: (ok, payload, error, meta) => {
      sendAcked = ok;
      sendPayload = payload;
      sendCached = meta?.cached === true;
      startedRunId =
        payload &&
        typeof payload === "object" &&
        typeof (payload as { runId?: unknown }).runId === "string"
          ? (payload as { runId: string }).runId
          : undefined;
      if (ok && shouldAttachPendingMessageSeq({ payload, cached: meta?.cached === true })) {
        params.respond(
          true,
          {
            ...(payload && typeof payload === "object" ? payload : {}),
            messageSeq,
            ...(interruptedActiveRun ? { interruptedActiveRun: true } : {}),
          },
          undefined,
          meta,
        );
        return;
      }
      params.respond(
        ok,
        ok && payload && typeof payload === "object"
          ? {
              ...payload,
              ...(interruptedActiveRun ? { interruptedActiveRun: true } : {}),
            }
          : payload,
        error,
        meta,
      );
    },
    context: params.context,
    client: params.client,
    isWebchatConnect: params.isWebchatConnect,
  });
  if (sendAcked) {
    if (shouldAttachPendingMessageSeq({ payload: sendPayload, cached: sendCached })) {
      await reactivateCompletedSubagentSession({
        sessionKey: canonicalKey,
        runId: startedRunId,
      });
    }
    emitSessionsChanged(params.context, {
      sessionKey: canonicalKey,
      ...(canonicalKey === "global" && requestedAgentId ? { agentId: requestedAgentId } : {}),
      reason: interruptedActiveRun ? "steer" : "send",
    });
  }
}

export const sessionsRunControlHandlers: GatewayRequestHandlers = {
  "sessions.recoveryContext": ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsRecoveryContextParams,
        "sessions.recoveryContext",
        respond,
      )
    ) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const { entry, canonicalKey } = loadSessionEntry(key, {
      agentId: requestedAgent.agentId,
    });
    const checkpoints = listSessionCompactionCheckpoints(entry);
    const checkpoint = p.checkpointId
      ? checkpoints.find((item) => item.checkpointId === p.checkpointId)
      : checkpoints[0];
    const warnings: string[] = [];
    if (!checkpoint) {
      warnings.push("recovery_context_unavailable");
      respond(
        true,
        {
          ok: true,
          key: canonicalKey,
          context: "",
          projectionTokens: 0,
          warnings,
        },
        undefined,
      );
      return;
    }
    const artifact = compressionArtifactFromCheckpoint(checkpoint);
    const budgetTokens =
      typeof p.budgetTokens === "number" && Number.isFinite(p.budgetTokens)
        ? Math.max(1, Math.floor(p.budgetTokens))
        : 1400;
    const projection = artifact
      ? renderRecoveryContextProjection(artifact, budgetTokens)
      : checkpoint.summary ?? "";
    if (!artifact) {
      warnings.push("legacy_summary_fallback");
    }
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        checkpointId: checkpoint.checkpointId,
        context: projection,
        projectionTokens: estimateProjectionTokens(projection),
        ...(artifact ? { artifact, quality: artifact.quality } : {}),
        warnings: [...warnings, ...(artifact?.quality.warnings ?? [])],
      },
      undefined,
    );
  },
  "sessions.longTaskControlStatus": ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsLongTaskControlStatusParams,
        "sessions.longTaskControlStatus",
        respond,
      )
    ) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const { canonicalKey } = loadSessionEntry(key, {
      agentId: requestedAgent.agentId,
    });
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        available: true,
        queueCount: countLongTaskQueuedMessages(canonicalKey),
        ...(getLatestLongTaskCheckpoint(canonicalKey)
          ? { latestCheckpoint: getLatestLongTaskCheckpoint(canonicalKey) }
          : {}),
        ...(getLatestLongTaskIntervention(canonicalKey)
          ? { latestIntervention: getLatestLongTaskIntervention(canonicalKey) }
          : {}),
        warnings: [],
      },
      undefined,
    );
  },
  "sessions.longTaskControlHistory": ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsLongTaskControlHistoryParams,
        "sessions.longTaskControlHistory",
        respond,
      )
    ) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const { canonicalKey } = loadSessionEntry(key, {
      agentId: requestedAgent.agentId,
    });
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        events: listLongTaskInterventions(canonicalKey, p.limit),
      },
      undefined,
    );
  },
  "sessions.resumeCheckpoints": ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsResumeCheckpointsParams,
        "sessions.resumeCheckpoints",
        respond,
      )
    ) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const { canonicalKey } = loadSessionEntry(key, {
      agentId: requestedAgent.agentId,
    });
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        checkpoints: listLongTaskCheckpoints(canonicalKey, p.limit),
      },
      undefined,
    );
  },
  "sessions.restoreCheckpoint": async ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsRestoreCheckpointParams,
        "sessions.restoreCheckpoint",
        respond,
      )
    ) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const { canonicalKey } = loadSessionEntry(key, {
      agentId: requestedAgent.agentId,
    });
    // Restore requires the checkpoint to exist; replay-rollback authority is
    // invoked with the legacy checkpoint target (event-log replay is not
    // implemented). The journal root is the agent workspace.
    const checkpoint = getLongTaskCheckpointById(p.checkpointId);
    if (!checkpoint || checkpoint.sessionKey !== canonicalKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.NOT_FOUND, `checkpoint "${p.checkpointId}" not found for session ${canonicalKey}`),
      );
      return;
    }
    const workspaceRoot = resolveAgentWorkspaceDir(cfg, requestedAgent.agentId);
    const rollbackDeps = createCheckpointRollbackDeps({
      workspaceRoot,
      sessionId: checkpoint.sessionKey,
    });
    const result = await executeReplayRollback(
      {
        decision: "repair",
        repairStrategy: "replay_rollback",
        reason: `manual restore of checkpoint ${p.checkpointId}`,
        requestedAtTick: 0,
      },
      { enabled: false, reason: "event-log replay not implemented; legacy checkpoint fallback" },
      { kind: "checkpoint", checkpointId: p.checkpointId },
      rollbackDeps,
    );
    if (!result.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `checkpoint restore failed: ${result.reason} (${result.detail})`),
      );
      return;
    }
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        checkpointId: p.checkpointId,
        rolledBackTo: result.rolledBackTo,
        mode: result.mode,
        evidenceSummary: result.evidenceSummary,
      },
      undefined,
    );
  },

  "sessions.checkpointDiff": async ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsRestoreCheckpointParams,
        "sessions.checkpointDiff",
        respond,
      )
    ) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const { canonicalKey } = loadSessionEntry(key, {
      agentId: requestedAgent.agentId,
    });
    const checkpoint = getLongTaskCheckpointById(p.checkpointId);
    if (!checkpoint || checkpoint.sessionKey !== canonicalKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.NOT_FOUND, `checkpoint "${p.checkpointId}" not found for session ${canonicalKey}`),
      );
      return;
    }
    const workspaceRoot = resolveAgentWorkspaceDir(cfg, requestedAgent.agentId);
    const diff = checkpointContentDiff({
      workspaceRoot,
      checkpoint,
      sessionId: checkpoint.sessionKey,
    });
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        checkpointId: p.checkpointId,
        files: diff.files,
        errors: diff.errors,
      },
      undefined,
    );
  },

  "sessions.queueDrain": async ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsQueueDrainParams,
        "sessions.queueDrain",
        respond,
      )
    ) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const { canonicalKey } = loadSessionEntry(key, {
      agentId: requestedAgent.agentId,
    });
    const defaultAgentId = resolveDefaultAgentId(cfg);
    if (
      hasTrackedActiveSessionRun({
        context,
        requestedKey: key,
        canonicalKey,
        ...(requestedAgent.agentId ? { agentId: requestedAgent.agentId } : {}),
        defaultAgentId,
      })
    ) {
      respond(
        true,
        {
          ok: true,
          key: canonicalKey,
          drained: false,
          queueCount: countLongTaskQueuedMessages(canonicalKey),
          reason: "active_run",
        },
        undefined,
      );
      return;
    }
    installQueueDrainCallback(context);
    const result = await drainQueuedUserMessagesForSession(context, canonicalKey);
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        drained: result.drained,
        queueCount: result.queueCount,
        messageCount: result.messageCount,
        ...(result.reason ? { reason: result.reason } : {}),
      },
      undefined,
    );
  },
  "sessions.send": async ({ req, params, respond, context, client, isWebchatConnect }) => {
    await handleSessionSend({
      method: "sessions.send",
      req,
      params,
      respond,
      context,
      client,
      isWebchatConnect,
      interruptIfActive: false,
    });
  },
  "sessions.steer": async ({ req, params, respond, context, client, isWebchatConnect }) => {
    await handleSessionSend({
      method: "sessions.steer",
      req,
      params,
      respond,
      context,
      client,
      isWebchatConnect,
      interruptIfActive: true,
    });
  },
  "sessions.abort": async ({ req, params, respond, context, client, isWebchatConnect }) => {
    if (!assertValidParams(params, validateSessionsAbortParams, "sessions.abort", respond)) {
      return;
    }
    const p = params;
    const cfg = context.getRuntimeConfig();
    const requestedRunId = readStringValue(p.runId);
    const requestedKey = normalizeOptionalString(p.key);
    const requestedParamAgentId = normalizeOptionalString(p.agentId);
    const scopedRequestedKey = resolveScopedAbortKey({
      cfg,
      key: requestedKey,
      agentId: requestedParamAgentId,
    });
    if (requestedKey && requestedParamAgentId && !scopedRequestedKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "session key agent does not match agentId"),
      );
      return;
    }
    const requestedKeyAgentId = scopedRequestedKey
      ? resolveSessionKeyAgentId(scopedRequestedKey, cfg)
      : undefined;
    const activeRun = requestedRunId ? context.chatAbortControllers.get(requestedRunId) : undefined;
    const activeRunSessionKey = activeRun?.sessionKey;
    const activeRunAgentId = normalizeOptionalString(activeRun?.agentId);
    const inferredRunAgentId =
      requestedParamAgentId ??
      (requestedRunId && scopedRequestedKey?.toLowerCase() === "global"
        ? activeRunAgentId
        : undefined) ??
      requestedKeyAgentId ??
      (requestedRunId && !activeRunSessionKey ? resolveDefaultAgentId(cfg) : undefined);
    const requestedRunAgentId = requestedRunId
      ? inferredRunAgentId
        ? normalizeAgentId(inferredRunAgentId)
        : undefined
      : undefined;
    const scopedActiveRunSessionKey = activeRunSessionKey
      ? requestedRunAgentId
        ? sessionKeyBelongsToAgent(activeRunSessionKey, requestedRunAgentId, cfg)
          ? activeRunSessionKey
          : undefined
        : activeRunSessionKey
      : undefined;
    const keyCandidate =
      scopedRequestedKey ??
      scopedActiveRunSessionKey ??
      (requestedRunId
        ? resolveSessionKeyForRun(requestedRunId, {
            agentId: requestedRunAgentId ?? resolveDefaultAgentId(cfg),
          })
        : undefined);
    if (!keyCandidate && requestedRunId) {
      respond(true, { ok: true, abortedRunId: null, status: "no-active-run" });
      return;
    }
    const key = requireSessionKey(keyCandidate, respond);
    if (!key) {
      return;
    }
    const requestedGlobalAgent = resolveRequestedGlobalAgentId(
      cfg,
      key,
      requestedParamAgentId ?? requestedRunAgentId,
    );
    if (!requestedGlobalAgent.ok) {
      respond(false, undefined, requestedGlobalAgent.error);
      return;
    }
    const requestedGlobalAgentId = requestedGlobalAgent.agentId;
    const { canonicalKey } = loadSessionEntry(key, { agentId: requestedGlobalAgentId });
    const requestedKeyAliases =
      requestedKey &&
      requestedKey !== key &&
      (!requestedParamAgentId || sessionKeyBelongsToAgent(requestedKey, requestedParamAgentId, cfg))
        ? [requestedKey]
        : undefined;
    const resolvedAbortSessionKey = resolveAbortSessionKey({
      context,
      requestedKey: key,
      canonicalKey,
      activeRunSessionKey: scopedActiveRunSessionKey,
      aliasKeys: requestedKeyAliases,
    });
    const abortSessionKey =
      canonicalKey === "global" && requestedGlobalAgentId ? "global" : resolvedAbortSessionKey;
    const abortAgentId =
      abortSessionKey === "global" ? (requestedGlobalAgentId ?? activeRunAgentId) : undefined;
    // Capture run kinds before the abort because abortChatRunById deletes entries
    // from chatAbortControllers synchronously. We use this snapshot to choose the
    // correct dedupe namespace: agent-kind runs use "agent:" (their runId equals
    // their idempotency key), while chat-send runs use "chat:" so the abort
    // snapshot does not collide with the agent RPC dedupe cache.
    const preAbortRunKinds = new Map<string, "chat-send" | "agent" | undefined>();
    if (requestedRunId) {
      preAbortRunKinds.set(requestedRunId, context.chatAbortControllers.get(requestedRunId)?.kind);
    } else {
      for (const [rid, entry] of context.chatAbortControllers) {
        preAbortRunKinds.set(rid, entry.kind);
      }
    }
    let abortedRunId: string | null = null;
    await chatHandlers["chat.abort"]({
      req,
      params: {
        sessionKey: abortSessionKey,
        runId: requestedRunId,
        ...(abortAgentId ? { agentId: abortAgentId } : {}),
      },
      respond: (ok, payload, error, meta) => {
        if (!ok) {
          respond(ok, payload, error, meta);
          return;
        }
        const runIds =
          payload &&
          typeof payload === "object" &&
          Array.isArray((payload as { runIds?: unknown[] }).runIds)
            ? (payload as { runIds: unknown[] }).runIds.filter((value): value is string =>
                Boolean(normalizeOptionalString(value)),
              )
            : [];
        const firstAbortedRunId = runIds[0] ?? null;
        abortedRunId = firstAbortedRunId;
        if (firstAbortedRunId) {
          const endedAt = Date.now();
          const runKind = preAbortRunKinds.get(firstAbortedRunId);
          const dedupePrefix = runKind === "agent" ? "agent" : "chat";
          setGatewayDedupeEntry({
            dedupe: context.dedupe,
            key: `${dedupePrefix}:${firstAbortedRunId}`,
            entry: {
              ts: endedAt,
              ok: true,
              payload: {
                status: "timeout",
                runId: firstAbortedRunId,
                ...(abortAgentId ? { agentId: abortAgentId } : {}),
                stopReason: "rpc",
                endedAt,
              },
            },
          });
        }
        respond(
          true,
          {
            ok: true,
            abortedRunId,
            status: abortedRunId ? "aborted" : "no-active-run",
          },
          undefined,
          meta,
        );
      },
      context,
      client,
      isWebchatConnect,
    });
    if (abortedRunId) {
      emitSessionsChanged(context, {
        sessionKey: canonicalKey,
        ...(canonicalKey === "global" && abortAgentId ? { agentId: abortAgentId } : {}),
        reason: "abort",
      });
    }
  },
};
