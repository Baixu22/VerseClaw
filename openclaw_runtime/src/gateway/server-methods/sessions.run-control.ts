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
  validateSessionsStopParams,
  validateSessionsLifecycleLedgerParams,
  validateSessionsYieldStateParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { renderRecoveryContextProjection } from "../../../packages/agent-core/src/harness/compaction/compression-artifact.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { createCheckpointRollbackDeps } from "../../agents/checkpoint-rollback-executor.js";
import { executeReplayRollback } from "../../agents/replay-rollback-authority.js";
import { getLongTaskCheckpointById } from "../../agents/long-task-control/store.js";
import { checkpointContentDiff } from "../../agents/checkpoint-diff.js";
import { updateSessionStore, type SessionEntry } from "../../config/sessions.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import { resolveSessionKeyForRun } from "../server-session-key.js";
import { resolveSessionStoreAgentId } from "../session-store-key.js";
import { listSessionCompactionCheckpoints } from "../session-compaction-checkpoints.js";
import { reactivateCompletedSubagentSession } from "../session-subagent-reactivation.js";
import { readArmedGoalWaitForSession } from "../../agents/goal-wake-read.js";
import { collectSessionLifecycleLedger } from "./session-lifecycle-ledger.js";
import {
  getLatestSubagentRunByChildSessionKey,
  listSubagentRunsForRequester,
} from "../../agents/subagent-registry.js";
import {
  loadSessionEntry,
  resolveGatewaySessionStoreTarget,
  resolveFreshestSessionEntryFromStoreKeys,
  readSessionMessageCountAsync,
  resolveDeletedAgentIdFromSessionKey,
} from "../session-utils.js";
import { setGatewayDedupeEntry } from "./agent-wait-dedupe.js";
import { acquireSessionAdmissionPermit, sessionAdmissionRegistry } from "../../sessions/session-admission-registry.js";
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
  resolveGatewaySessionTargetFromKey,
  interruptSessionRunIfActive,
  isSessionBusyForManualCompaction,
  compressionArtifactFromCheckpoint,
  estimateProjectionTokens,
  loadSessionsRuntimeModule,
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
  let collaboration: Awaited<ReturnType<typeof import('./session-collaboration-message.js')['prepareSessionCollaborationMessage']>> | undefined;
  if (p.collaboration !== undefined) {
    try {
      if (params.interruptIfActive) throw new Error('COLLABORATION_MESSAGE_IS_NOT_STEER');
      const { prepareSessionCollaborationMessage } = await import('./session-collaboration-message.js');
      collaboration = await prepareSessionCollaborationMessage(p.collaboration, params.context, params.client);
      if (collaboration.message.target.sessionKey !== canonicalKey || collaboration.message.message !== p.message
        || (p.idempotencyKey !== undefined && p.idempotencyKey !== collaboration.message.id)) throw new Error('COLLABORATION_MESSAGE_SCOPE_MISMATCH');
    } catch (error) {
      params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : 'Invalid collaboration message')); return;
    }
  }
  if (typeof p.expectedSessionId === "string" && entry?.sessionId !== p.expectedSessionId) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "Worker session generation changed"),
    );
    return;
  }
  if (!collaboration && (p.requesterSessionKey || p.expectedRequesterSessionId)) {
    if (
      typeof p.requesterSessionKey !== "string" ||
      typeof p.expectedRequesterSessionId !== "string" ||
      loadSessionEntry(p.requesterSessionKey).entry?.sessionId !== p.expectedRequesterSessionId ||
      (entry?.spawnedBy ?? entry?.parentSessionKey) !== p.requesterSessionKey
    ) {
      params.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Worker requester generation changed"),
      );
      return;
    }
  }
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

  const releaseSessionsSendPermit = acquireSessionAdmissionPermit(
    {
      agentId: requestedAgentId,
      canonicalSessionKey: canonicalKey,
      expectedSessionId: entry.sessionId,
    },
    params.interruptIfActive ? "sessions-steer" : "sessions-send",
  );
  let interruptedActiveRun = false;
  let releaseCollaborationSource: (() => void) | undefined;
  // TF-0082: the permit must fence the whole run-start window (steer interrupt,
  // transcript seq read, chat.send preamble) so a reset/delete racing mid-send
  // cannot seed a run on a stale generation. It is released as soon as the run
  // is armed (first respond callback carries the ack/runId) — after that,
  // reset fences normally and aborts the run through the canonical stop path.
  let sendStartPermitReleased = false;
  const releaseSendStartPermitOnce = () => {
    if (!sendStartPermitReleased) {
      sendStartPermitReleased = true;
      releaseSessionsSendPermit();
      releaseCollaborationSource?.();
    }
  };
  let sendAcked = false;
  let sendPayload: unknown;
  let sendCached = false;
  let startedRunId: string | undefined;
  try {
    if (collaboration) {
      releaseCollaborationSource = acquireSessionAdmissionPermit({ canonicalSessionKey: collaboration.message.source.sessionKey,
        expectedSessionId: collaboration.message.source.sessionGeneration }, 'sessions-send');
      const source = loadSessionEntry(collaboration.message.source.sessionKey, { readOnly: true, skipCache: true });
      if (source.entry?.sessionId !== collaboration.message.source.sessionGeneration || source.entry.workspaceId !== collaboration.message.source.workspaceId) throw new Error('COLLABORATION_SOURCE_GENERATION_CHANGED');
      const current = loadSessionEntry(canonicalKey, { readOnly: true, skipCache: true });
      if (current.entry?.sessionId !== collaboration.message.target.sessionGeneration || current.entry.workspaceId !== collaboration.message.target.workspaceId) throw new Error('COLLABORATION_TARGET_GENERATION_CHANGED');
      const { agentHandlers } = await import('./agent.js');
      const { assertSessionCollaborationSource } = await import('./session-collaboration-message.js');
      assertSessionCollaborationSource(collaboration.message, params.context, params.client);
      await agentHandlers.agent({ req: params.req, client: params.client, context: params.context, isWebchatConnect: params.isWebchatConnect,
        params: { message: collaboration.message.message, sessionKey: canonicalKey, expectedSessionId: collaboration.message.target.sessionGeneration,
          workspaceId: collaboration.message.target.workspaceId, idempotencyKey: collaboration.message.id, deliver: false,
          sourceReplyDeliveryMode: 'message_tool_only', inputProvenance: collaboration.provenance },
        respond: (ok, payload, error, meta) => {
          releaseSendStartPermitOnce();
          const ack = payload as { runId?: string; status?: string } | undefined;
          params.respond(ok, ok ? { receipt: { schemaVersion: 'SessionCollaborationReceipt/v1', message: collaboration!.message,
            phase: ack?.status === 'queued' ? 'queued' : ['accepted', 'ok'].includes(ack?.status ?? '') ? 'accepted' : 'unknown', run: ack?.runId ? { runId: ack.runId, scope: {
              workspaceId: collaboration!.message.target.workspaceId, projectId: collaboration!.message.target.projectId, sessionKey: collaboration!.message.target.sessionKey } } : null,
            replyRef: null, updatedAt: Date.now() } } : payload, error, meta);
        },
      });
      emitSessionsChanged(params.context, { sessionKey: canonicalKey, reason: 'send' });
      return;
    }
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
        ...(typeof p.expectedSessionId === "string"
          ? { expectedSessionGeneration: p.expectedSessionId }
          : {}),
        ...(typeof p.requesterSessionKey === "string"
          ? { requesterSessionKey: p.requesterSessionKey }
          : {}),
        ...(typeof p.expectedRequesterSessionId === "string"
          ? { expectedRequesterSessionId: p.expectedRequesterSessionId }
          : {}),
        ...(typeof p.workspaceId === "string" ? { workspaceId: p.workspaceId } : {}),
        ...(typeof p.workspaceDir === "string" ? { workspaceDir: p.workspaceDir } : {}),
        thinking: (p as { thinking?: string }).thinking,
        attachments: (p as { attachments?: unknown[] }).attachments,
        timeoutMs: (p as { timeoutMs?: number }).timeoutMs,
        idempotencyKey,
      },
      respond: (ok, payload, error, meta) => {
        // The first respond (ack/runId or failure) means the run-start window
        // is over: release the start permit so reset can fence normally.
        releaseSendStartPermitOnce();
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
  } finally {
    releaseSendStartPermitOnce();
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
      : (checkpoint.summary ?? "");
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
    const loaded = loadSessionEntry(key, {
      agentId: requestedAgent.agentId,
    });
    const { canonicalKey } = loaded;
    const sessionId = loaded.entry?.sessionId;
    const agentId = requestedAgent.agentId ?? resolveSessionStoreAgentId(cfg, canonicalKey);
    const generationError = errorShape(ErrorCodes.INVALID_REQUEST, "Session generation changed before checkpoint restore.", {
      details: { reason: "generation-mismatch" },
    });
    if (!sessionId || (p.expectedSessionId !== undefined && sessionId !== p.expectedSessionId)) {
      respond(false, undefined, generationError);
      return;
    }
    const identity = { agentId, canonicalSessionKey: canonicalKey, expectedSessionId: sessionId };
    const admission = sessionAdmissionRegistry.snapshot(identity);
    if (admission?.active || admission?.fenced || isSessionBusyForManualCompaction({
      context, cfg, requestedKey: key, canonicalKey, agentId, sessionId,
    })) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Session is active or fenced; restore after the current operation finishes."));
      return;
    }
    const fence = await sessionAdmissionRegistry.fence(identity, { operation: "session-restore-checkpoint" });
    try {
      // Hold the existing store barrier through the journal's file leases and undo.
      await updateSessionStore(loaded.storePath, async (store) => {
        const target = resolveGatewaySessionStoreTarget({ cfg, key, store, agentId });
        const current = resolveFreshestSessionEntryFromStoreKeys(store, target.storeKeys);
        if (current?.sessionId !== sessionId) {
          respond(false, undefined, generationError);
          return;
        }
        // Restore requires the checkpoint to exist; replay-rollback authority is
        // invoked with the legacy checkpoint target (event-log replay is not
        // implemented). The journal follows this session generation's execution directory.
        const checkpoint = getLongTaskCheckpointById(p.checkpointId);
        if (!checkpoint || checkpoint.sessionKey !== canonicalKey || (checkpoint.agentId && checkpoint.agentId !== agentId)) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.NOT_FOUND,
              `checkpoint "${p.checkpointId}" not found for session ${canonicalKey}`,
            ),
          );
          return;
        }
        const workspaceRoot = current.workspaceDir?.trim() || current.spawnedWorkspaceDir?.trim() || resolveAgentWorkspaceDir(cfg, agentId);
        // Restore must use the journal identity stamped by the checkpoint owner.
        const journalSessionId = resolveCheckpointJournalSessionId(checkpoint, undefined);
        if (!journalSessionId || journalSessionId !== sessionId) {
          const message = journalSessionId
            ? "Checkpoint write-journal belongs to a different session generation."
            : "Checkpoint has no recorded write-journal session UUID; restore cannot verify its source generation.";
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message, {
            details: { reason: journalSessionId ? "checkpoint-generation-mismatch" : "checkpoint-journal-identity-missing" },
          }));
          return;
        }
        const rollbackDeps = createCheckpointRollbackDeps({
          workspaceRoot,
          sessionId: journalSessionId,
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
          { ...rollbackDeps, loadCheckpoint: async () => checkpoint },
        );
        if (!result.ok) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              `checkpoint restore failed: ${result.reason} (${result.detail})`,
            ),
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
      }, { skipSaveWhenResult: () => true });
    } finally {
      fence.release();
    }
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
    const loaded = loadSessionEntry(key, {
      agentId: requestedAgent.agentId,
    });
    const { canonicalKey } = loaded;
    const checkpoint = getLongTaskCheckpointById(p.checkpointId);
    if (!checkpoint || checkpoint.sessionKey !== canonicalKey) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.NOT_FOUND,
          `checkpoint "${p.checkpointId}" not found for session ${canonicalKey}`,
        ),
      );
      return;
    }
    const workspaceRoot = loaded.entry?.workspaceDir?.trim() || loaded.entry?.spawnedWorkspaceDir?.trim() || resolveAgentWorkspaceDir(
      cfg, requestedAgent.agentId ?? resolveSessionStoreAgentId(cfg, canonicalKey),
    );
    const journalSessionId = resolveCheckpointJournalSessionId(checkpoint, loaded.entry?.sessionId);
    if (!journalSessionId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `cannot diff checkpoint "${p.checkpointId}": no session id is recorded for ${canonicalKey}, and the write-journal is keyed by the session UUID.`,
        ),
      );
      return;
    }
    const diff = checkpointContentDiff({
      workspaceRoot,
      checkpoint,
      sessionId: journalSessionId,
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
      !assertValidParams(params, validateSessionsQueueDrainParams, "sessions.queueDrain", respond)
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
    // TF-0082 generation guard: a drain pinned to a previous generation must
    // never seed a post-reset/forked run. Messages stay queued (fail-closed).
    if (p.expectedSessionId && entry && entry.sessionId !== p.expectedSessionId) {
      respond(
        true,
        {
          ok: true,
          key: canonicalKey,
          drained: false,
          queueCount: countLongTaskQueuedMessages(canonicalKey),
          reason: "generation-mismatch",
        },
        undefined,
      );
      return;
    }
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
    const result = await drainQueuedUserMessagesForSession(context, canonicalKey, {
      expectedSessionId: p.expectedSessionId,
    });
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
  /**
   * TF-0082 owner path 6: read-only yield / goal-wait surface.
   *
   * Arming stays tool-only — `sessions_yield` ends the caller's own turn and
   * `goal_wait` binds mission/tick identity from the live run context, so an
   * out-of-turn RPC could only either duplicate `chat.abort` or arm a wait on
   * somebody else's mission. This method reports the resulting state instead,
   * so a caller can tell "parent yielded, waiting for N children" from "mission
   * asleep on a goal wait" without polling a subagent roster.
   */
  "sessions.yieldState": ({ params, respond, context }) => {
    if (
      !assertValidParams(params, validateSessionsYieldStateParams, "sessions.yieldState", respond)
    ) {
      return;
    }
    const p = params as {
      key: string;
      agentId?: string;
      expectedSessionId?: string;
    };
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
    const { entry, canonicalKey } = loadSessionEntry(key, { agentId: requestedAgent.agentId });
    const sessionId = entry?.sessionId?.trim() ? entry.sessionId : null;
    const emptyYield = { paused: false, wakeOnDescendantSettle: false, pendingChildren: 0 };
    // Fail closed the same way queueDrain does: never describe a generation the
    // caller did not ask about.
    if (p.expectedSessionId && entry && entry.sessionId !== p.expectedSessionId) {
      respond(
        true,
        {
          ok: true,
          key: canonicalKey,
          sessionId,
          reason: "generation-mismatch",
          yield: emptyYield,
          goalWait: { armed: false },
        },
        undefined,
      );
      return;
    }

    let parentRun: ReturnType<typeof getLatestSubagentRunByChildSessionKey> | undefined;
    let pendingChildren: number;
    try {
      parentRun = getLatestSubagentRunByChildSessionKey(canonicalKey) ?? undefined;
      // A child run counts as pending while it has not ended, and also while it
      // is parked by its own sessions_yield — a paused child still owes the
      // parent exactly one continuation.
      pendingChildren = listSubagentRunsForRequester(canonicalKey).filter(
        (run) => !run.endedAt || run.pauseReason === "sessions_yield",
      ).length;
    } catch {
      // Fail closed: a partially-read registry must not be reported as state.
      parentRun = undefined;
      pendingChildren = 0;
    }
    const paused = parentRun?.pauseReason === "sessions_yield";

    let armed: ReturnType<typeof readArmedGoalWaitForSession>;
    try {
      armed = readArmedGoalWaitForSession(canonicalKey);
    } catch {
      armed = undefined;
    }

    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        sessionId,
        yield: {
          paused,
          ...(paused && parentRun?.runId ? { runId: parentRun.runId } : {}),
          ...(paused && parentRun?.requesterSessionKey
            ? { parentSessionKey: parentRun.requesterSessionKey }
            : {}),
          ...(paused && parentRun?.requesterSessionId
            ? { parentSessionId: parentRun.requesterSessionId }
            : {}),
          wakeOnDescendantSettle: paused && parentRun?.wakeOnDescendantSettle === true,
          pendingChildren,
          ...(paused && typeof parentRun?.endedAt === "number"
            ? { updatedAt: Math.max(0, Math.trunc(parentRun.endedAt)) }
            : {}),
        },
        goalWait: armed
          ? {
              armed: true,
              flowId: armed.flowId,
              status: armed.status,
              updatedAt: Math.max(0, Math.trunc(armed.updatedAt)),
              ...(armed.taskId ? { taskId: armed.taskId } : {}),
              ...(armed.missionId ? { missionId: armed.missionId } : {}),
              ...(armed.turnBarrier ? { turnBarrier: armed.turnBarrier } : {}),
              ...(armed.runId ? { runId: armed.runId } : {}),
              ...(armed.ownerEpoch ? { ownerEpoch: armed.ownerEpoch } : {}),
              ...(typeof armed.timeoutMs === "number"
                ? { timeoutMs: Math.max(0, Math.trunc(armed.timeoutMs)) }
                : {}),
            }
          : { armed: false },
      },
      undefined,
    );
  },
  /**
   * TF-0084 owner path 1: read-only lifecycle ledger.
   *
   * Reports the transitions the lifecycle owners already record, joined into one
   * ordered list with the owner and the generation each one pinned. It adds no
   * writer and no second identity source; an owner this projection cannot read
   * is declared in `declaredGaps` instead of being dropped, so a caller can tell
   * a covered lifecycle from a coverage gap.
   */
  "sessions.lifecycleLedger": ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsLifecycleLedgerParams,
        "sessions.lifecycleLedger",
        respond,
      )
    ) {
      return;
    }
    const p = params as { key: string; agentId?: string; expectedSessionId?: string };
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
    const { entry, canonicalKey } = loadSessionEntry(key, { agentId: requestedAgent.agentId });
    const ledger = collectSessionLifecycleLedger(canonicalKey, {
      session: {
        sessionId: entry?.sessionId?.trim() ? entry.sessionId : null,
        ...(typeof entry?.sessionStartedAt === "number"
          ? { startedAt: entry.sessionStartedAt }
          : {}),
        ...(typeof entry?.updatedAt === "number" ? { updatedAt: entry.updatedAt } : {}),
      },
      ...(p.expectedSessionId ? { expectedSessionId: p.expectedSessionId } : {}),
    });
    respond(
      true,
      {
        ok: true,
        key: ledger.sessionKey || canonicalKey,
        sessionId: ledger.sessionId,
        ...(ledger.reason ? { reason: ledger.reason } : {}),
        entries: ledger.entries,
        census: ledger.census,
        declaredGaps: ledger.declaredGaps,
        capturedAt: ledger.capturedAt,
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
  "sessions.stop": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateSessionsStopParams, "sessions.stop", respond)) {
      return;
    }
    const key = requireSessionKey(params.key, respond);
    if (!key) {
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, params.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const { target } = resolveGatewaySessionTargetFromKey(key, cfg, {
      agentId: requestedAgent.agentId,
    });
    const { entry, legacyKey, canonicalKey } = loadSessionEntry(key, {
      agentId: requestedAgent.agentId,
    });
    const { stopSessionRuntime } = await loadSessionsRuntimeModule();
    if (
      params.expectedSessionId &&
      loadSessionEntry(key, { agentId: requestedAgent.agentId }).entry?.sessionId !==
        params.expectedSessionId
    ) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Session generation changed before stop"),
      );
      return;
    }
    const result = await stopSessionRuntime({
      cfg,
      key,
      target,
      entry,
      legacyKey,
      canonicalKey,
    });
    if (!result.ok) {
      respond(false, undefined, result.error);
      return;
    }
    respond(true, { ok: true, key: result.key, sessionId: result.sessionId }, undefined);
  },
};

/**
 * #176: resolve which write-journal a checkpoint describes.
 *
 * Order matters:
 *   1. `checkpoint.metadata.journalSessionId` — stamped at creation time, so the
 *      identity travels with the checkpoint and does not depend on the store.
 *   2. the session store's transcript UUID, for checkpoints created before the
 *      stamp existed.
 *
 * The canonical session key is deliberately NOT a candidate: it addresses a
 * different directory, which is how a manual restore could report success while
 * restoring nothing.
 */
export function resolveCheckpointJournalSessionId(
  checkpoint: { checkpoint: { metadata?: unknown } },
  storeSessionId: string | undefined,
): string | undefined {
  const metadata = checkpoint.checkpoint.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const stamped = (metadata as Record<string, unknown>).journalSessionId;
    if (typeof stamped === "string" && stamped.trim()) {
      return stamped.trim();
    }
  }
  return storeSessionId?.trim() || undefined;
}
