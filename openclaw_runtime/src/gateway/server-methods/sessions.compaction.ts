// Sessions gateway compaction methods (status/history/artifacts/branch/restore/compact).
import type { GatewayRequestHandlers } from "./types.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  ErrorCodes,
  errorShape,
  validateSessionsCompactParams,
  validateSessionsCompactRangeParams,
  validateSessionsCompactionHistoryParams,
  validateSessionsCompressionArtifactParams,
  validateSessionsCompactionBranchParams,
  validateSessionsCompactionGetParams,
  validateSessionsCompactionListParams,
  validateSessionsCompactionRestoreParams,
  validateSessionsCompactionStatusParams,
  validateSessionsExpandSelectorParams,
  validateSessionsRecallOriginalParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { compactEmbeddedAgentSession } from "../../agents/embedded-agent.js";
import { readTranscriptFileState } from "../../agents/embedded-agent-runner/transcript-file-state.js";
import {
  normalizeReasoningLevel,
  normalizeThinkLevel,
} from "../../auto-reply/thinking.js";
import { updateSessionStore } from "../../config/sessions.js";
import { sessionAdmissionRegistry } from "../../sessions/session-admission-registry.js";
import { verifyContextArchiveHandle } from "../../context-engine/registry/context-item-registry.js";
import { normalizeArchiveHandle } from "../../../../shared/types/context-family.js";
import { formatErrorMessage } from "../../infra/errors.js";
import {
  forkCompactionCheckpointTranscriptAsync,
  getSessionCompactionCheckpoint,
  listSessionCompactionCheckpoints,
} from "../session-compaction-checkpoints.js";
import {
  archiveFileOnDisk,
  loadSessionEntry,
  migrateAndPruneGatewaySessionStoreKey,
  readRecentSessionTranscriptLines,
  resolveGatewaySessionStoreTarget,
  resolveFreshestSessionEntryFromStoreKeys,
  resolveSessionModelRef,
  resolveSessionTranscriptCandidates,
} from "../session-utils.js";
import { emitSessionsChanged } from "./session-change-event.js";
import {
  getLatestLongTaskLedgerRootId,
  recordLongTaskCheckpoint,
  recordLongTaskInterventionEvent,
} from "../../agents/long-task-control/store.js";
import { assertValidParams } from "./validation.js";
import { resolveRangeCompactionKeepEntry } from "./sessions.compaction-range.js";
import { isSessionBusyForManualCompaction } from "./session-active-runs.js";
import {
  requireSessionKey,
  resolveGatewaySessionTargetFromKey,
  emitSessionOperation,
  rejectWebchatSessionMutation,
  buildDashboardSessionKey,
  cloneCheckpointSessionEntry,
  resolveCheckpointForkSource,
  resolveRequestedGlobalAgentId,
  interruptSessionRunIfActive,
  compressionArtifactFromCheckpoint,
  listCompactionHistoryEntries,
  resolveCompactionPressure,
} from "./sessions.shared.js";

export const sessionsCompactionHandlers: GatewayRequestHandlers = {
  "sessions.compactionStatus": ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsCompactionStatusParams,
        "sessions.compactionStatus",
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
    const { entry, canonicalKey, storePath } = loadSessionEntry(key, {
      agentId: requestedAgent.agentId,
    });
    const sessionId = entry?.sessionId;
    const warnings: string[] = [];
    const checkpoints = listCompactionHistoryEntries(entry, 1);
    const budget = entry?.contextBudgetStatus;
    const usedTokens =
      typeof budget?.estimatedPromptTokens === "number" && Number.isFinite(budget.estimatedPromptTokens)
        ? Math.max(0, Math.floor(budget.estimatedPromptTokens))
        : typeof entry?.totalTokens === "number" && Number.isFinite(entry.totalTokens)
          ? Math.max(0, Math.floor(entry.totalTokens))
          : undefined;
    const maxTokens =
      typeof budget?.contextTokenBudget === "number" && Number.isFinite(budget.contextTokenBudget)
        ? Math.max(1, Math.floor(budget.contextTokenBudget))
        : typeof entry?.contextTokens === "number" && Number.isFinite(entry.contextTokens)
          ? Math.max(1, Math.floor(entry.contextTokens))
          : undefined;
    const remainingTokens =
      typeof budget?.remainingPromptBudgetTokens === "number" &&
      Number.isFinite(budget.remainingPromptBudgetTokens)
        ? Math.max(0, Math.floor(budget.remainingPromptBudgetTokens))
        : usedTokens !== undefined && maxTokens !== undefined
          ? Math.max(0, maxTokens - usedTokens)
          : undefined;
    if (!budget) {
      warnings.push("context_budget_unknown");
    }
    if (entry?.totalTokensFresh === false) {
      warnings.push("token_estimate_stale");
    }
    const truncatedMessageCount =
      budget && budget.unwindowedMessageCount > budget.messageCount
        ? Math.max(0, budget.unwindowedMessageCount - budget.messageCount)
        : 0;
    const hasTranscript =
      typeof sessionId === "string" && sessionId
        ? resolveSessionTranscriptCandidates(
            sessionId,
            storePath,
            entry?.sessionFile,
            requestedAgent.agentId,
          ).some((candidate) => fs.existsSync(candidate))
        : false;
    const inProgress =
      typeof sessionId === "string" && sessionId
        ? isSessionBusyForManualCompaction({
            context,
            cfg,
            requestedKey: key,
            canonicalKey,
            agentId: requestedAgent.agentId,
            sessionId,
          })
        : false;
    const reason = !sessionId
      ? "no_session"
      : !hasTranscript
        ? "no_transcript"
        : inProgress
          ? "active_run"
          : undefined;
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        available: true,
        canCompact: !reason,
        inProgress,
        ...(reason ? { reason } : {}),
        ...(usedTokens !== undefined ? { usedTokens } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(remainingTokens !== undefined ? { remainingTokens } : {}),
        pressure: resolveCompactionPressure({
          usedTokens,
          maxTokens,
          shouldCompact: budget?.shouldCompact,
          route: budget?.route,
          overflowTokens: budget?.overflowTokens,
        }),
        ...(checkpoints[0] ? { lastCompaction: checkpoints[0] } : {}),
        truncatedMessageCount,
        warnings,
      },
      undefined,
    );
  },
  "sessions.compactionHistory": ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsCompactionHistoryParams,
        "sessions.compactionHistory",
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
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        entries: listCompactionHistoryEntries(entry, p.limit),
      },
      undefined,
    );
  },
  "sessions.recallOriginal": async ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsRecallOriginalParams,
        "sessions.recallOriginal",
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
    let archiveHandle: ReturnType<typeof normalizeArchiveHandle>;
    try {
      archiveHandle = normalizeArchiveHandle(p.archiveHandle);
    } catch (error) {
      respond(
        true,
        {
          ok: false,
          archiveHandle: p.archiveHandle,
          diagnostics: [
            {
              code: "invalid_handle",
              message: formatErrorMessage(error),
              ref: typeof p.archiveHandle?.uri === "string" ? p.archiveHandle.uri : undefined,
            },
          ],
        },
        undefined,
      );
      return;
    }
    const verified = await verifyContextArchiveHandle(archiveHandle);
    if (!verified.ok) {
      const code =
        verified.reason === "missing"
          ? "missing_archive"
          : verified.reason === "checksum_mismatch"
            ? "checksum_mismatch"
            : verified.reason === "invalid_uri"
              ? "invalid_handle"
              : "read_error";
      respond(
        true,
        {
          ok: false,
          archiveHandle,
          diagnostics: [
            {
              code,
              message: `Archive recall failed: ${verified.reason}`,
              ref: archiveHandle.uri,
            },
          ],
        },
        undefined,
      );
      return;
    }
    respond(
      true,
      {
        ok: true,
        payload: verified.payload,
        archiveHandle,
        diagnostics: [],
      },
      undefined,
    );
  },
  "sessions.compressionArtifact": ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsCompressionArtifactParams,
        "sessions.compressionArtifact",
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
      warnings.push("compression_artifact_unavailable");
      respond(true, { ok: true, key: canonicalKey, warnings }, undefined);
      return;
    }
    const artifact = compressionArtifactFromCheckpoint(checkpoint);
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        checkpointId: checkpoint.checkpointId,
        ...(artifact ? { artifact, quality: artifact.quality } : {}),
        warnings: [...warnings, ...(artifact?.quality.warnings ?? [])],
      },
      undefined,
    );
  },
  "sessions.expandSelector": ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsExpandSelectorParams,
        "sessions.expandSelector",
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
    const ambiguous = /[*{},]|\.\.$/u.test(p.selector);
    const diagnostic = ambiguous
      ? {
          code: "ambiguous_selector",
          message: "Selector matched an ambiguous range and was not expanded.",
          ref: `${p.resourceId}#${p.selector}`,
        }
      : p.checksum
        ? {
            code: "stale_selector",
            message: "Selector content could not be resolved for the supplied checksum.",
            ref: `${p.resourceId}#${p.selector}`,
          }
        : {
            code: "missing_selector",
            message: "No selector-backed content resolver is available for this resource.",
            ref: `${p.resourceId}#${p.selector}`,
          };
    respond(
      true,
      {
        ok: false,
        resourceId: p.resourceId,
        selector: p.selector,
        ...(p.checksum ? { checksum: p.checksum } : {}),
        diagnostics: [diagnostic],
      },
      undefined,
    );
  },
  "sessions.compaction.list": ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsCompactionListParams,
        "sessions.compaction.list",
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
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        checkpoints: listSessionCompactionCheckpoints(entry),
      },
      undefined,
    );
  },
  "sessions.compaction.get": ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsCompactionGetParams,
        "sessions.compaction.get",
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
    const checkpointId = normalizeOptionalString(p.checkpointId) ?? "";
    if (!checkpointId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "checkpointId required"));
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
    const checkpoint = getSessionCompactionCheckpoint({ entry, checkpointId });
    if (!checkpoint) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `checkpoint not found: ${checkpointId}`),
      );
      return;
    }
    respond(
      true,
      {
        ok: true,
        key: canonicalKey,
        checkpoint,
      },
      undefined,
    );
  },
  "sessions.compaction.branch": async ({ params, respond, context }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsCompactionBranchParams,
        "sessions.compaction.branch",
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
    const checkpointId =
      typeof p.checkpointId === "string" && p.checkpointId.trim() ? p.checkpointId.trim() : "";
    if (!checkpointId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "checkpointId required"));
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const loaded = loadSessionEntry(key, { agentId: requestedAgent.agentId });
    const { cfg: loadedCfg, entry, canonicalKey } = loaded;
    const target = resolveGatewaySessionStoreTarget({
      cfg: loadedCfg,
      key: canonicalKey,
      agentId: requestedAgent.agentId,
    });
    if (!entry?.sessionId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `session not found: ${key}`),
      );
      return;
    }
    const checkpoint = getSessionCompactionCheckpoint({ entry, checkpointId });
    const forkSource = checkpoint ? resolveCheckpointForkSource(checkpoint) : null;
    if (!checkpoint || !forkSource) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `checkpoint not found: ${checkpointId}`),
      );
      return;
    }
    const branchedSession = await forkCompactionCheckpointTranscriptAsync({
      sourceFile: forkSource.sourceFile,
      sourceLeafId: forkSource.sourceLeafId,
      sessionDir: path.dirname(forkSource.sourceFile),
    });
    if (!branchedSession?.sessionFile) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "failed to create checkpoint branch transcript"),
      );
      return;
    }
    const nextKey = buildDashboardSessionKey(target.agentId);
    const label = entry.label?.trim() ? `${entry.label.trim()} (checkpoint)` : "Checkpoint branch";
    const nextEntry = cloneCheckpointSessionEntry({
      currentEntry: entry,
      nextSessionId: branchedSession.sessionId,
      nextSessionFile: branchedSession.sessionFile,
      label,
      parentSessionKey: canonicalKey,
      totalTokens: forkSource.totalTokens,
    });

    await updateSessionStore(target.storePath, (store) => {
      store[nextKey] = nextEntry;
    });

    respond(
      true,
      {
        ok: true,
        sourceKey: canonicalKey,
        key: nextKey,
        sessionId: nextEntry.sessionId,
        checkpoint,
        entry: nextEntry,
      },
      undefined,
    );
    emitSessionsChanged(context, {
      sessionKey: canonicalKey,
      ...(canonicalKey === "global" && requestedAgent.agentId
        ? { agentId: requestedAgent.agentId }
        : {}),
      reason: "checkpoint-branch",
    });
    emitSessionsChanged(context, {
      sessionKey: nextKey,
      reason: "checkpoint-branch",
    });
  },
  "sessions.compaction.restore": async ({
    req,
    params,
    respond,
    context,
    client,
    isWebchatConnect,
  }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsCompactionRestoreParams,
        "sessions.compaction.restore",
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
    if (rejectWebchatSessionMutation({ action: "restore", client, isWebchatConnect, respond })) {
      return;
    }
    const checkpointId =
      typeof p.checkpointId === "string" && p.checkpointId.trim() ? p.checkpointId.trim() : "";
    if (!checkpointId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "checkpointId required"));
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const loaded = loadSessionEntry(key, { agentId: requestedAgent.agentId });
    const { entry, canonicalKey, storePath } = loaded;
    if (!entry?.sessionId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `session not found: ${key}`),
      );
      return;
    }
    const sessionId = entry.sessionId;
    const generationError = errorShape(ErrorCodes.INVALID_REQUEST, "Session generation changed before checkpoint transcript restore.", {
      details: { reason: "generation-mismatch" },
    });
    if (p.expectedSessionId !== undefined && p.expectedSessionId !== sessionId) {
      respond(false, undefined, generationError);
      return;
    }
    const checkpoint = getSessionCompactionCheckpoint({ entry, checkpointId });
    const forkSource = checkpoint ? resolveCheckpointForkSource(checkpoint) : null;
    if (!checkpoint || !forkSource) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `checkpoint not found: ${checkpointId}`),
      );
      return;
    }
    const target = resolveGatewaySessionStoreTarget({ cfg, key, agentId: requestedAgent.agentId });
    const identity = { agentId: target.agentId, canonicalSessionKey: canonicalKey, expectedSessionId: sessionId };
    if (sessionAdmissionRegistry.isFenced(identity)) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Session is fenced by another lifecycle operation."));
      return;
    }
    // Preserve the legacy interrupt entry; pinned callers reject an active run.
    if (p.expectedSessionId === undefined) {
      const interruptResult = await interruptSessionRunIfActive({
        req, context, client, isWebchatConnect,
        requestedKey: key, canonicalKey, agentId: requestedAgent.agentId, sessionId,
      });
      if (interruptResult.error) {
        respond(false, undefined, interruptResult.error);
        return;
      }
    }
    if (isSessionBusyForManualCompaction({
      context, cfg, requestedKey: key, canonicalKey, agentId: requestedAgent.agentId, sessionId,
    })) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Session is active or fenced; restore after the current operation finishes."));
      return;
    }
    const fence = await sessionAdmissionRegistry.fence(identity, { operation: "session-compaction-restore" });
    try {
      // The fork does not write the store; keep the original writer queue until publication.
      const restored = await updateSessionStore(storePath, async (store) => {
        const currentTarget = resolveGatewaySessionStoreTarget({ cfg, key, agentId: requestedAgent.agentId, store });
        const current = resolveFreshestSessionEntryFromStoreKeys(store, currentTarget.storeKeys);
        if (current?.sessionId !== sessionId) return { error: generationError };
        const currentCheckpoint = getSessionCompactionCheckpoint({ entry: current, checkpointId });
        const currentSource = currentCheckpoint ? resolveCheckpointForkSource(currentCheckpoint) : null;
        if (!currentCheckpoint || !currentSource) {
          return { error: errorShape(ErrorCodes.INVALID_REQUEST, "Checkpoint is no longer available for this session.") };
        }
        const restoredSession = await forkCompactionCheckpointTranscriptAsync({
          sourceFile: currentSource.sourceFile,
          sourceLeafId: currentSource.sourceLeafId,
          sessionDir: path.dirname(currentSource.sourceFile),
        });
        if (!restoredSession?.sessionFile) {
          return { error: errorShape(ErrorCodes.UNAVAILABLE, "failed to restore checkpoint transcript") };
        }
        const nextEntry = cloneCheckpointSessionEntry({
          currentEntry: current,
          nextSessionId: restoredSession.sessionId,
          nextSessionFile: restoredSession.sessionFile,
          totalTokens: currentSource.totalTokens,
          preserveCompactionCheckpoints: true,
        });
        migrateAndPruneGatewaySessionStoreKey({ cfg, key, agentId: requestedAgent.agentId, store });
        store[canonicalKey] = nextEntry;
        return { entry: nextEntry, checkpoint: currentCheckpoint };
      }, { skipSaveWhenResult: (result) => "error" in result });
      if ("error" in restored) {
        respond(false, undefined, restored.error);
        return;
      }
      respond(
        true,
        {
          ok: true,
          key: canonicalKey,
          sessionId: restored.entry.sessionId,
          checkpoint: restored.checkpoint,
          entry: restored.entry,
        },
        undefined,
      );
      emitSessionsChanged(context, {
        sessionKey: canonicalKey,
        ...(canonicalKey === "global" && requestedAgent.agentId
          ? { agentId: requestedAgent.agentId }
          : {}),
        reason: "checkpoint-restore",
      });
    } finally {
      fence.release();
    }
  },
  /**
   * #178: summarize a located stretch of the transcript and keep the untouched
   * side verbatim. Exactly one boundary is supplied:
   *   - `fromLeafId` keeps that entry (and everything after it) verbatim and
   *     summarizes the older entries;
   *   - `toLeafId` folds the head (through that entry) into the summary and
   *     keeps the newer entries verbatim.
   * The id must be on the active branch; an absent/off-branch id - or a
   * `toLeafId` that is the transcript tail - fails closed. The actual work is
   * delegated to the single `sessions.compact` path so the validated pipeline,
   * the pre-operation checkpoint, and the admission rules are shared.
   */
  "sessions.compactRange": async (args) => {
    const { params, respond, context } = args;
    if (
      !assertValidParams(params, validateSessionsCompactRangeParams, "sessions.compactRange", respond)
    ) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const fromLeafId = normalizeOptionalString(p.fromLeafId);
    const toLeafId = normalizeOptionalString(p.toLeafId);
    if ((fromLeafId && toLeafId) || (!fromLeafId && !toLeafId)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "sessions.compactRange requires exactly one of fromLeafId or toLeafId.",
        ),
      );
      return;
    }

    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const requestedAgentId = requestedAgent.agentId;
    const { target, storePath } = resolveGatewaySessionTargetFromKey(key, cfg, {
      agentId: requestedAgentId,
    });
    const compactTarget = loadSessionEntry(key, { agentId: requestedAgentId });
    const generationError = errorShape(ErrorCodes.INVALID_REQUEST, "Session generation changed before compaction.", {
      details: { reason: "generation-mismatch" },
    });
    if (p.expectedSessionId !== undefined && compactTarget.entry?.sessionId !== p.expectedSessionId) {
      respond(false, undefined, generationError);
      return;
    }
    const sessionId = compactTarget.entry?.sessionId;
    if (!sessionId) {
      respond(
        true,
        { ok: true, key: target.canonicalKey, compacted: false, reason: "no sessionId" },
        undefined,
      );
      return;
    }
    const filePath = resolveSessionTranscriptCandidates(
      sessionId,
      storePath,
      compactTarget.entry?.sessionFile,
      target.agentId,
    ).find((candidate) => fs.existsSync(candidate));
    if (!filePath) {
      respond(
        true,
        { ok: true, key: target.canonicalKey, compacted: false, reason: "no transcript" },
        undefined,
      );
      return;
    }

    let keepFromEntryId: string;
    try {
      const state = await readTranscriptFileState(filePath);
      const branchIds = state.getBranch().map((entry) => entry.id);
      const resolution = resolveRangeCompactionKeepEntry({ branchIds, fromLeafId, toLeafId });
      if (!resolution.ok) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            resolution.reason === 'boundary-is-tail'
              ? `toLeafId "${resolution.boundaryId}" is the transcript tail; use sessions.compact to summarize the whole transcript.`
              : `${resolution.boundaryParam} "${resolution.boundaryId}" is not on the active transcript branch; no compaction was performed.`,
            { details: { reason: resolution.reason, [resolution.boundaryParam]: resolution.boundaryId } },
          ),
        );
        return;
      }
      keepFromEntryId = resolution.keepFromEntryId;
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `failed to read the session transcript for ranged compaction: ${formatErrorMessage(error)}`,
        ),
      );
      return;
    }
    await sessionsCompactionHandlers["sessions.compact"]!({
      ...args,
      params: {
        key,
        ...(requestedAgentId ? { agentId: requestedAgentId } : {}),
        ...(normalizeOptionalString(p.customInstructions)
          ? { customInstructions: normalizeOptionalString(p.customInstructions) }
          : {}),
        keepFromEntryId,
        expectedSessionId: sessionId,
      } as never,
    });
  },
  "sessions.compact": async ({ req, params, respond, context, client, isWebchatConnect }) => {
    if (!assertValidParams(params, validateSessionsCompactParams, "sessions.compact", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    if (rejectWebchatSessionMutation({ action: "compact", client, isWebchatConnect, respond })) {
      return;
    }

    const maxLines =
      typeof p.maxLines === "number" && Number.isFinite(p.maxLines)
        ? Math.max(1, Math.floor(p.maxLines))
        : undefined;

    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, key, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const requestedAgentId = requestedAgent.agentId;
    const { target, storePath } = resolveGatewaySessionTargetFromKey(key, cfg, {
      agentId: requestedAgentId,
    });
    // Read without alias migration so a stale request has no store effects.
    const compactTarget = loadSessionEntry(key, { agentId: requestedAgentId });
    const generationError = errorShape(ErrorCodes.INVALID_REQUEST, "Session generation changed before compaction.", {
      details: { reason: "generation-mismatch" },
    });
    if (p.expectedSessionId !== undefined && compactTarget.entry?.sessionId !== p.expectedSessionId) {
      respond(false, undefined, generationError);
      return;
    }
    const entry = compactTarget.entry;
    const sessionId = entry?.sessionId;
    if (!sessionId) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no sessionId",
        },
        undefined,
      );
      return;
    }

    const filePath = resolveSessionTranscriptCandidates(
      sessionId,
      storePath,
      entry?.sessionFile,
      target.agentId,
    ).find((candidate) => fs.existsSync(candidate));
    if (!filePath) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no transcript",
        },
        undefined,
      );
      return;
    }

    // Legacy unpinned callers retain interrupt semantics; pinned UI requests reject busy.
    if (maxLines === undefined && !p.force && p.expectedSessionId === undefined) {
      const interruptResult = await interruptSessionRunIfActive({
        req, context, client, isWebchatConnect,
        requestedKey: key, canonicalKey: target.canonicalKey,
        agentId: requestedAgentId, sessionId,
      });
      if (interruptResult.error) {
        respond(false, undefined, interruptResult.error);
        return;
      }
    }
    const identity = { agentId: target.agentId, canonicalSessionKey: target.canonicalKey, expectedSessionId: sessionId };
    if (isSessionBusyForManualCompaction({
      context, cfg, requestedKey: key, canonicalKey: target.canonicalKey,
      agentId: requestedAgentId, sessionId,
    })) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Session is active or fenced; compact after the current operation finishes."));
      return;
    }
    // Busy check and fence have no intervening await: refuse busy instead of draining a writer.
    const fence = await sessionAdmissionRegistry.fence(identity, { operation: "session-compact" });
    try {
      const currentGeneration = await updateSessionStore(storePath, (store) => {
        const currentTarget = resolveGatewaySessionStoreTarget({ cfg, key, store, agentId: requestedAgentId });
        return resolveFreshestSessionEntryFromStoreKeys(store, currentTarget.storeKeys)?.sessionId;
      }, { skipSaveWhenResult: () => true });
      if (currentGeneration !== sessionId) {
        respond(false, undefined, generationError);
        return;
      }
      if (maxLines === undefined) {
        const resolvedModel = resolveSessionModelRef(cfg, entry, target.agentId);
        const workspaceDir =
          normalizeOptionalString(entry?.spawnedWorkspaceDir) ||
          resolveAgentWorkspaceDir(cfg, target.agentId);
        const cwd = normalizeOptionalString(entry?.spawnedCwd);
        const operationId = randomUUID();
        emitSessionOperation(context, {
          operationId,
          operation: "compact",
          phase: "start",
          sessionKey: target.canonicalKey,
          ...(target.canonicalKey === "global" && target.agentId ? { agentId: target.agentId } : {}),
        });
        let result: Awaited<ReturnType<typeof compactEmbeddedAgentSession>>;
        try {
          result = await compactEmbeddedAgentSession({
            sessionId,
            sessionKey: target.canonicalKey,
            agentId: target.agentId,
            allowGatewaySubagentBinding: true,
            sessionFile: filePath,
            workspaceDir,
            cwd,
            config: cfg,
            provider: resolvedModel.provider,
            model: resolvedModel.model,
            authProfileId: entry?.authProfileOverride,
            agentHarnessId: entry?.sessionId === sessionId ? entry.agentHarnessId : undefined,
            thinkLevel: normalizeThinkLevel(entry?.thinkingLevel),
            reasoningLevel: normalizeReasoningLevel(entry?.reasoningLevel),
            bashElevated: {
              enabled: false,
              allowed: false,
              defaultLevel: "off",
            },
            customInstructions: normalizeOptionalString(p.customInstructions),
            force: p.force === true,
            trigger: "manual",
            // #178: located compaction pins the retained tail (see sessions.compactRange).
            ...(normalizeOptionalString(p.keepFromEntryId)
              ? { keepFromEntryId: normalizeOptionalString(p.keepFromEntryId) }
              : {}),
          });
        } catch (err) {
          emitSessionOperation(context, {
            operationId,
            operation: "compact",
            phase: "end",
            sessionKey: target.canonicalKey,
            ...(target.canonicalKey === "global" && target.agentId
              ? { agentId: target.agentId }
              : {}),
            completed: false,
            reason: formatErrorMessage(err),
          });
          throw err;
        }

        if (result.ok && result.compacted) {
          const committed = await updateSessionStore(storePath, (store) => {
            const currentTarget = resolveGatewaySessionStoreTarget({ cfg, key, store, agentId: requestedAgentId });
            const current = resolveFreshestSessionEntryFromStoreKeys(store, currentTarget.storeKeys);
            if (current?.sessionId !== sessionId) return false;
            const { entry: entryToUpdate } = migrateAndPruneGatewaySessionStoreKey({ cfg, key, store, agentId: requestedAgentId });
            if (!entryToUpdate) return false;
            entryToUpdate.updatedAt = Date.now();
            entryToUpdate.compactionCount = Math.max(0, entryToUpdate.compactionCount ?? 0) + 1;
            if (result.result?.sessionId && result.result.sessionId !== entryToUpdate.sessionId) {
              entryToUpdate.sessionId = result.result.sessionId;
            }
            if (result.result?.sessionFile) {
              entryToUpdate.sessionFile = result.result.sessionFile;
            }
            delete entryToUpdate.inputTokens;
            delete entryToUpdate.outputTokens;
            delete entryToUpdate.contextBudgetStatus;
            if (
              typeof result.result?.tokensAfter === "number" &&
              Number.isFinite(result.result.tokensAfter)
            ) {
              entryToUpdate.totalTokens = result.result.tokensAfter;
              entryToUpdate.totalTokensFresh = true;
            } else {
              delete entryToUpdate.totalTokens;
              delete entryToUpdate.totalTokensFresh;
            }
            return true;
          }, { skipSaveWhenResult: (committed) => !committed });
          if (!committed) {
            emitSessionOperation(context, {
              operationId, operation: "compact", phase: "end", sessionKey: target.canonicalKey,
              ...(target.canonicalKey === "global" && target.agentId ? { agentId: target.agentId } : {}),
              completed: false, reason: "generation-mismatch",
            });
            respond(false, undefined, generationError);
            return;
          }
          const taskLedgerRootId = getLatestLongTaskLedgerRootId(target.canonicalKey);
          if (taskLedgerRootId) {
            const checkpoint = recordLongTaskCheckpoint({
              idempotencyKey: `sessions:${target.canonicalKey}:compact:${operationId}:checkpoint`,
              sessionKey: target.canonicalKey,
              agentId: target.agentId,
              taskLedgerRootId,
              trigger: "compaction",
              status: "compacted",
              activeTask: "Current /loop session was manually compacted.",
              nextAction: "Continue from the compaction checkpoint and preserved long-task state.",
              evidenceRefs: [{ type: "session", ref: target.canonicalKey }],
              metadata: {
                summary: result.result?.summary,
                tokensBefore: result.result?.tokensBefore,
                tokensAfter: result.result?.tokensAfter,
                firstKeptEntryId: result.result?.firstKeptEntryId,
                sessionId: result.result?.sessionId,
              },
            });
            recordLongTaskInterventionEvent({
              idempotencyKey: `sessions:${target.canonicalKey}:compact:${operationId}:event`,
              sessionKey: target.canonicalKey,
              agentId: target.agentId,
              taskLedgerRootId,
              checkpointId: checkpoint.id,
              trigger: "compaction",
              status: "checkpointed",
              payload: {
                tokensBefore: result.result?.tokensBefore,
                tokensAfter: result.result?.tokensAfter,
                firstKeptEntryId: result.result?.firstKeptEntryId,
              },
            });
          }
        }

        emitSessionOperation(context, {
          operationId,
          operation: "compact",
          phase: "end",
          sessionKey: target.canonicalKey,
          ...(target.canonicalKey === "global" && target.agentId ? { agentId: target.agentId } : {}),
          completed: result.ok && result.compacted,
          reason: result.reason,
        });
        respond(
          true,
          {
            ok: result.ok,
            key: target.canonicalKey,
            compacted: result.compacted,
            reason: result.reason,
            result: result.result,
          },
          undefined,
        );
        if (result.ok) {
          emitSessionsChanged(context, {
            sessionKey: target.canonicalKey,
            ...(target.canonicalKey === "global" && target.agentId
              ? { agentId: target.agentId }
              : {}),
            reason: "compact",
            compacted: result.compacted,
          });
        }
        return;
      }

      const tail = readRecentSessionTranscriptLines({
        sessionId,
        storePath,
        sessionFile: entry?.sessionFile,
        agentId: target.agentId,
        maxLines,
      });
      const lines = tail?.lines ?? [];
      const totalLines = tail?.totalLines ?? 0;
      if (totalLines <= maxLines) {
        respond(
          true,
          {
            ok: true,
            key: target.canonicalKey,
            compacted: false,
            kept: totalLines,
          },
          undefined,
        );
        return;
      }

      const committed = await updateSessionStore(storePath, async (store) => {
        const currentTarget = resolveGatewaySessionStoreTarget({ cfg, key, store, agentId: requestedAgentId });
        const current = resolveFreshestSessionEntryFromStoreKeys(store, currentTarget.storeKeys);
        if (current?.sessionId !== sessionId) return undefined;
        const { entry: entryToUpdate } = migrateAndPruneGatewaySessionStoreKey({ cfg, key, store, agentId: requestedAgentId });
        if (!entryToUpdate) return undefined;
        const archived = archiveFileOnDisk(filePath, "bak");
        await fs.promises.writeFile(filePath, `${lines.join("\n")}\n`, "utf-8");
        delete entryToUpdate.inputTokens;
        delete entryToUpdate.outputTokens;
        delete entryToUpdate.totalTokens;
        delete entryToUpdate.totalTokensFresh;
        delete entryToUpdate.contextBudgetStatus;
        entryToUpdate.updatedAt = Date.now();
        return { archived };
      }, { skipSaveWhenResult: (committed) => !committed });
      if (!committed) {
        respond(false, undefined, generationError);
        return;
      }

      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: true,
          archived: committed.archived,
          kept: lines.length,
        },
        undefined,
      );
      emitSessionsChanged(context, {
        sessionKey: target.canonicalKey,
        ...(target.canonicalKey === "global" && target.agentId ? { agentId: target.agentId } : {}),
        reason: "compact",
        compacted: true,
      });
    } finally {
      fence.release();
    }
  },
};
