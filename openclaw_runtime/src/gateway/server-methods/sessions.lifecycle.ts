// Sessions gateway lifecycle mutation methods (create/fork/patch/reset/delete).
import type { GatewayRequestHandlers } from "./types.js";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "@openclaw/normalization-core/string-coerce";
import {
  ErrorCodes,
  errorShape,
  validateSessionsCreateParams,
  validateSessionsDeleteParams,
  validateSessionsForkParams,
  validateSessionsPatchParams,
  validateSessionsPluginPatchParams,
  validateSessionsResetParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { readAcpSessionMeta } from "../../runtime/session-meta.ts";
import { resolveModelAgentRuntimeMetadata } from "../../agents/agent-runtime-metadata.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import {
  forkSessionFromParent,
  resolveParentForkDecision,
} from "../../auto-reply/reply/session-fork.js";
import {
  resolveMainSessionKey,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { resolveAgentMainSessionKey } from "../../config/sessions/main-session.js";
import {
  createInternalHookEvent,
  hasInternalHookListeners,
  triggerInternalHook,
} from "../../hooks/internal-hooks.js";
import { patchPluginSessionExtension } from "../../plugins/host-hook-state.js";
import { isPluginJsonValue } from "../../plugins/host-hooks.js";
import {
  normalizeAgentId,
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
  toAgentStoreSessionKey,
} from "../../routing/session-key.js";
import { ADMIN_SCOPE } from "../operator-scopes.js";
import { triggerSessionPatchHook } from "../session-patch-hooks.js";
import {
  buildSessionDeleteOperationJournalRow,
  buildSessionDeleteOperationManifest,
  finalizeSessionDeleteOperationJournal,
  markSessionDeleteOperationPartialCommitted,
  parseSessionDeletePartialReceipt,
  readSessionDeleteOperationJournal,
  writeSessionDeleteOperationIntent,
  type SessionDeleteOperationManifest,
  type SessionDeletePartialReceipt,
} from "../session-delete-operation-journal.js";
import { resolveSessionStoreAgentId, resolveSessionStoreKey } from "../session-store-key.js";
import {
  loadSessionEntry,
  migrateAndPruneGatewaySessionStoreKey,
  readSessionMessageCountAsync,
  resolveGatewaySessionStoreTarget,
  resolveSessionDisplayModelIdentityRef,
  resolveSessionModelRef,
  type SessionsPatchResult,
} from "../session-utils.js";
import { applySessionsPatchToStore } from "../sessions-patch.js";
import { chatHandlers } from "./chat.js";
import { emitSessionsChanged } from "./session-change-event.js";
import { assertValidParams } from "./validation.js";
import {
  inheritSessionRuntimeSelection,
  loadSessionsRuntimeModule,
  requireSessionKey,
  rejectPluginRuntimeDeleteMismatch,
  resolveGatewaySessionTargetFromKey,
  resolveOptionalInitialSessionMessage,
  shouldAttachPendingMessageSeq,
  rejectWebchatSessionMutation,
  buildDashboardSessionKey,
  ensureSessionTranscriptFile,
  resolveRequestedGlobalAgentId,
  isSessionBusyForManualCompaction,
} from "./sessions.shared.js";

export const sessionsLifecycleHandlers: GatewayRequestHandlers = {
  "sessions.create": async ({ req, params, respond, context, client, isWebchatConnect }) => {
    if (!assertValidParams(params, validateSessionsCreateParams, "sessions.create", respond)) {
      return;
    }
    const p = params;
    const cfg = context.getRuntimeConfig();
    const requestedKey = normalizeOptionalString(p.key);
    const agentId = normalizeAgentId(
      normalizeOptionalString(p.agentId) ?? resolveDefaultAgentId(cfg),
    );
    if (requestedKey) {
      const requestedAgentId = parseAgentSessionKey(requestedKey)?.agentId;
      if (requestedAgentId && requestedAgentId !== agentId && normalizeOptionalString(p.agentId)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `sessions.create key agent (${requestedAgentId}) does not match agentId (${agentId})`,
          ),
        );
        return;
      }
    }
    const parentSessionKey = normalizeOptionalString(p.parentSessionKey);
    let canonicalParentSessionKey: string | undefined;
    let parentSessionEntry: SessionEntry | undefined;
    let parentSelectedAgentId: string | undefined;
    if (parentSessionKey) {
      const parentCanonicalKey = resolveSessionStoreKey({ cfg, sessionKey: parentSessionKey });
      if (parentCanonicalKey === "global") {
        const parentRequestedAgent = resolveRequestedGlobalAgentId(
          cfg,
          parentSessionKey,
          p.agentId,
        );
        if (!parentRequestedAgent.ok) {
          respond(false, undefined, parentRequestedAgent.error);
          return;
        }
        parentSelectedAgentId = parentRequestedAgent.agentId;
      }
      const parent = loadSessionEntry(
        parentSessionKey,
        parentSelectedAgentId ? { agentId: parentSelectedAgentId } : undefined,
      );
      if (!parent.entry?.sessionId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown parent session: ${parentSessionKey}`),
        );
        return;
      }
      canonicalParentSessionKey = parent.canonicalKey;
      parentSessionEntry = parent.entry;
    }
    if (
      canonicalParentSessionKey &&
      p.emitCommandHooks === true &&
      !requestedKey &&
      !resolveOptionalInitialSessionMessage(p) &&
      cfg.session?.dmScope === "main"
    ) {
      const parentAgentId = normalizeAgentId(
        parentSelectedAgentId ??
          resolveAgentIdFromSessionKey(canonicalParentSessionKey) ??
          resolveDefaultAgentId(cfg),
      );
      const parentMainKey = resolveAgentMainSessionKey({ cfg, agentId: parentAgentId });
      if (canonicalParentSessionKey === parentMainKey) {
        const { performGatewaySessionReset } = await loadSessionsRuntimeModule();
        const resetResult = await performGatewaySessionReset({
          key: canonicalParentSessionKey,
          ...(canonicalParentSessionKey === "global" && parentSelectedAgentId
            ? { agentId: parentSelectedAgentId }
            : {}),
          reason: "new",
          commandSource: "webchat",
        });
        if (!resetResult.ok) {
          respond(false, undefined, resetResult.error);
          return;
        }
        respond(
          true,
          {
            ok: true,
            key: resetResult.key,
            sessionId: resetResult.entry.sessionId,
            entry: resetResult.entry,
            runStarted: false,
          },
          undefined,
        );
        emitSessionsChanged(context, {
          sessionKey: resetResult.key,
          ...(resetResult.key === "global" ? { agentId: resetResult.agentId } : {}),
          reason: "new",
        });
        return;
      }
    }
    if (canonicalParentSessionKey && p.emitCommandHooks === true) {
      const { entry: parentEntry } = loadSessionEntry(
        canonicalParentSessionKey,
        parentSelectedAgentId ? { agentId: parentSelectedAgentId } : undefined,
      );
      const parentAgentId = normalizeAgentId(
        parentSelectedAgentId ??
          resolveAgentIdFromSessionKey(canonicalParentSessionKey) ??
          resolveDefaultAgentId(cfg),
      );
      const workspaceDir = resolveAgentWorkspaceDir(cfg, parentAgentId);
      if (hasInternalHookListeners("command", "new")) {
        const hookEvent = createInternalHookEvent("command", "new", canonicalParentSessionKey, {
          sessionEntry: parentEntry,
          previousSessionEntry: parentEntry,
          commandSource: "webchat",
          cfg,
          workspaceDir,
        });
        await triggerInternalHook(hookEvent);
      }
      const parentTarget = resolveGatewaySessionStoreTarget({
        cfg,
        key: canonicalParentSessionKey,
        ...(canonicalParentSessionKey === "global" && parentSelectedAgentId
          ? { agentId: parentSelectedAgentId }
          : {}),
      });
      const { emitGatewayBeforeResetPluginHook } = await loadSessionsRuntimeModule();
      await emitGatewayBeforeResetPluginHook({
        cfg,
        key: canonicalParentSessionKey,
        target: parentTarget,
        storePath: parentTarget.storePath,
        entry: parentEntry,
        reason: "new",
      });
    }
    const loweredRequestedKey = normalizeOptionalLowercaseString(requestedKey);
    const key = requestedKey
      ? loweredRequestedKey === "global" || loweredRequestedKey === "unknown"
        ? loweredRequestedKey
        : toAgentStoreSessionKey({
            agentId,
            requestKey: requestedKey,
            mainKey: cfg.session?.mainKey,
          })
      : buildDashboardSessionKey(agentId);
    const target = resolveGatewaySessionStoreTarget({ cfg, key, agentId });
    const targetAgentId = target.agentId;
    const created = await updateSessionStore(target.storePath, async (store) => {
      const patched = await applySessionsPatchToStore({
        cfg,
        store,
        storeKey: target.canonicalKey,
        agentId: targetAgentId,
        patch: {
          key: target.canonicalKey,
          label: normalizeOptionalString(p.label),
          model: normalizeOptionalString(p.model),
        },
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
      });
      if (!patched.ok || !canonicalParentSessionKey) {
        return patched;
      }
      const inheritedSelection = normalizeOptionalString(p.model)
        ? {}
        : inheritSessionRuntimeSelection(parentSessionEntry);
      const nextEntry: SessionEntry = {
        ...patched.entry,
        ...inheritedSelection,
        parentSessionKey: canonicalParentSessionKey,
      };
      store[target.canonicalKey] = nextEntry;
      return {
        ...patched,
        entry: nextEntry,
      };
    });
    if (!created.ok) {
      respond(false, undefined, created.error);
      return;
    }
    const ensured = await ensureSessionTranscriptFile({
      sessionId: created.entry.sessionId,
      storePath: target.storePath,
      sessionFile: created.entry.sessionFile,
      agentId: targetAgentId,
    });
    if (!ensured.ok) {
      await updateSessionStore(target.storePath, (store) => {
        delete store[target.canonicalKey];
      });
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to create session transcript: ${ensured.error}`),
      );
      return;
    }

    const createdEntry =
      created.entry.sessionFile === ensured.transcriptPath
        ? created.entry
        : {
            ...created.entry,
            sessionFile: ensured.transcriptPath,
          };
    if (createdEntry !== created.entry) {
      await updateSessionStore(target.storePath, (store) => {
        const existing = store[target.canonicalKey];
        if (existing) {
          store[target.canonicalKey] = {
            ...existing,
            sessionFile: ensured.transcriptPath,
          };
        }
      });
    }

    const initialMessage = resolveOptionalInitialSessionMessage(p);
    let runPayload: Record<string, unknown> | undefined;
    let runError: unknown;
    let runMeta: Record<string, unknown> | undefined;
    const messageSeq = initialMessage
      ? (await readSessionMessageCountAsync(
          createdEntry.sessionId,
          target.storePath,
          createdEntry.sessionFile,
        )) + 1
      : undefined;

    if (initialMessage) {
      await chatHandlers["chat.send"]({
        req,
        params: {
          sessionKey: target.canonicalKey,
          ...(target.canonicalKey === "global" ? { agentId: target.agentId } : {}),
          message: initialMessage,
          idempotencyKey: randomUUID(),
        },
        respond: (ok, payload, error, meta) => {
          if (ok && payload && typeof payload === "object") {
            runPayload = payload as Record<string, unknown>;
          } else {
            runError = error;
          }
          runMeta = meta;
        },
        context,
        client,
        isWebchatConnect,
      });
    }

    const runStarted =
      runPayload !== undefined &&
      shouldAttachPendingMessageSeq({
        payload: runPayload,
        cached: runMeta?.cached === true,
      });

    respond(
      true,
      {
        ok: true,
        key: target.canonicalKey,
        sessionId: createdEntry.sessionId,
        entry: createdEntry,
        runStarted,
        ...(runPayload ? runPayload : {}),
        ...(runStarted && typeof messageSeq === "number" ? { messageSeq } : {}),
        ...(runError ? { runError } : {}),
      },
      undefined,
    );
    emitSessionsChanged(context, {
      sessionKey: target.canonicalKey,
      ...(target.canonicalKey === "global" ? { agentId: target.agentId } : {}),
      reason: "create",
    });
    if (runStarted) {
      emitSessionsChanged(context, {
        sessionKey: target.canonicalKey,
        ...(target.canonicalKey === "global" ? { agentId: target.agentId } : {}),
        reason: "send",
      });
    }
    if (canonicalParentSessionKey && p.emitCommandHooks === true) {
      const { entry: parentEntry } = loadSessionEntry(
        canonicalParentSessionKey,
        parentSelectedAgentId ? { agentId: parentSelectedAgentId } : undefined,
      );
      const parentTarget = resolveGatewaySessionStoreTarget({
        cfg,
        key: canonicalParentSessionKey,
        ...(canonicalParentSessionKey === "global" && parentSelectedAgentId
          ? { agentId: parentSelectedAgentId }
          : {}),
      });
      const { emitGatewaySessionEndPluginHook, emitGatewaySessionStartPluginHook } =
        await loadSessionsRuntimeModule();
      emitGatewaySessionEndPluginHook({
        cfg,
        sessionKey: canonicalParentSessionKey,
        sessionId: parentEntry?.sessionId,
        storePath: parentTarget.storePath,
        sessionFile: parentEntry?.sessionFile,
        agentId: parentTarget.agentId,
        reason: "new",
        nextSessionId: createdEntry.sessionId,
        nextSessionKey: target.canonicalKey,
      });
      emitGatewaySessionStartPluginHook({
        cfg,
        sessionKey: target.canonicalKey,
        sessionId: createdEntry.sessionId,
        resumedFrom: parentEntry?.sessionId,
        storePath: target.storePath,
        sessionFile: createdEntry.sessionFile,
        agentId: target.agentId,
      });
    }
  },
  "sessions.fork": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateSessionsForkParams, "sessions.fork", respond)) {
      return;
    }
    const p = params;
    const sourceKey = requireSessionKey(p.key, respond);
    if (!sourceKey) {
      return;
    }
    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(cfg, sourceKey, p.agentId);
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const source = loadSessionEntry(
      sourceKey,
      requestedAgent.agentId ? { agentId: requestedAgent.agentId } : undefined,
    );
    if (!source.entry?.sessionId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown source session: ${sourceKey}`),
      );
      return;
    }
    const sourceAgentId = normalizeAgentId(
      requestedAgent.agentId ??
        resolveAgentIdFromSessionKey(source.canonicalKey) ??
        resolveSessionStoreAgentId(cfg, source.canonicalKey) ??
        resolveDefaultAgentId(cfg),
    );
    if (
      isSessionBusyForManualCompaction({
        context,
        cfg,
        requestedKey: sourceKey,
        canonicalKey: source.canonicalKey,
        agentId: sourceAgentId,
        sessionId: source.entry.sessionId,
      })
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "cannot fork while the source session has an active run",
        ),
      );
      return;
    }
    const forkDecision = await resolveParentForkDecision({
      parentEntry: source.entry,
      storePath: source.storePath,
    });
    if (forkDecision.status === "skip") {
      // Fail-closed rejection: no child session is created on this path, so
      // the error must not imply an isolated-context fallback (issue #27). The
      // structured details let agents detect the condition without parsing
      // the message text.
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `${forkDecision.message} No fork was created; compact the source session first or fork a smaller session.`,
          {
            details: {
              reason: forkDecision.reason,
              parentTokens: forkDecision.parentTokens,
              maxTokens: forkDecision.maxTokens,
            },
          },
        ),
      );
      return;
    }
    const forked = await forkSessionFromParent({
      parentEntry: source.entry,
      agentId: sourceAgentId,
      sessionsDir: path.dirname(source.storePath),
    });
    if (!forked) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "failed to fork source transcript"),
      );
      return;
    }

    const childKey = buildDashboardSessionKey(sourceAgentId);
    const target = resolveGatewaySessionStoreTarget({ cfg, key: childKey, agentId: sourceAgentId });
    const created = await updateSessionStore(target.storePath, async (store) => {
      const patched = await applySessionsPatchToStore({
        cfg,
        store,
        storeKey: target.canonicalKey,
        agentId: target.agentId,
        patch: {
          key: target.canonicalKey,
          label: normalizeOptionalString(p.label),
        },
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
      });
      if (!patched.ok) {
        return patched;
      }
      const nextEntry: SessionEntry = {
        ...patched.entry,
        ...inheritSessionRuntimeSelection(source.entry),
        sessionId: forked.sessionId,
        sessionFile: forked.sessionFile,
        parentSessionKey: source.canonicalKey,
        forkedFromParent: true,
        updatedAt: Date.now(),
        systemSent: false,
        abortedLastRun: false,
        startedAt: undefined,
        endedAt: undefined,
        runtimeMs: undefined,
        status: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
        estimatedCostUsd: undefined,
      };
      store[target.canonicalKey] = nextEntry;
      return {
        ...patched,
        entry: nextEntry,
      };
    });
    if (!created.ok) {
      respond(false, undefined, created.error);
      return;
    }
    respond(
      true,
      {
        ok: true,
        key: target.canonicalKey,
        sourceKey: source.canonicalKey,
        sessionId: created.entry.sessionId,
        entry: created.entry,
        forkedFromParent: true,
        runStarted: false,
      },
      undefined,
    );
    emitSessionsChanged(context, {
      sessionKey: target.canonicalKey,
      ...(target.canonicalKey === "global" ? { agentId: target.agentId } : {}),
      reason: "fork",
    });
  },
  "sessions.patch": async ({ params, respond, context, client, isWebchatConnect }) => {
    if (!assertValidParams(params, validateSessionsPatchParams, "sessions.patch", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    if (rejectWebchatSessionMutation({ action: "patch", client, isWebchatConnect, respond })) {
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
    const applied = await updateSessionStore(storePath, async (store) => {
      const { primaryKey } = migrateAndPruneGatewaySessionStoreKey({
        cfg,
        key,
        store,
        agentId: requestedAgentId,
      });
      return await applySessionsPatchToStore({
        cfg,
        store,
        storeKey: primaryKey,
        agentId: requestedAgentId,
        patch: p,
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
      });
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }

    triggerSessionPatchHook({
      cfg,
      sessionEntry: applied.entry,
      sessionKey: target.canonicalKey ?? key,
      patch: p,
    });

    const parsed = parseAgentSessionKey(target.canonicalKey ?? key);
    const agentId = normalizeAgentId(
      target.canonicalKey === "global"
        ? target.agentId
        : (parsed?.agentId ?? resolveDefaultAgentId(cfg)),
    );
    const resolved = resolveSessionModelRef(cfg, applied.entry, agentId);
    const resolvedDisplayModel = resolveSessionDisplayModelIdentityRef({
      cfg,
      agentId,
      provider: resolved.provider,
      model: resolved.model,
    });
    const acpMeta = readAcpSessionMeta({ sessionKey: target.canonicalKey ?? key });
    const agentRuntime = resolveModelAgentRuntimeMetadata({
      cfg,
      agentId,
      provider: resolvedDisplayModel.provider,
      model: resolvedDisplayModel.model,
      sessionKey: target.canonicalKey ?? key,
      acpRuntime: acpMeta != null,
      acpBackend: acpMeta?.backend,
    });
    const result: SessionsPatchResult = {
      ok: true,
      path: storePath,
      key: target.canonicalKey,
      entry: applied.entry,
      resolved: {
        modelProvider: resolvedDisplayModel.provider,
        model: resolvedDisplayModel.model,
        agentRuntime,
      },
    };
    respond(true, result, undefined);
    emitSessionsChanged(context, {
      sessionKey: target.canonicalKey,
      ...(target.canonicalKey === "global" && requestedAgentId
        ? { agentId: requestedAgentId }
        : {}),
      reason: "patch",
    });
  },
  "sessions.pluginPatch": async ({ params, respond, context, client, isWebchatConnect }) => {
    if (
      !assertValidParams(params, validateSessionsPluginPatchParams, "sessions.pluginPatch", respond)
    ) {
      return;
    }
    const key = requireSessionKey(params.key, respond);
    if (!key) {
      return;
    }
    if (rejectWebchatSessionMutation({ action: "patch", client, isWebchatConnect, respond })) {
      return;
    }
    const scopes = Array.isArray(client?.connect.scopes) ? client.connect.scopes : [];
    if (!scopes.includes(ADMIN_SCOPE)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `sessions.pluginPatch requires gateway scope: ${ADMIN_SCOPE}`,
        ),
      );
      return;
    }
    const pluginId = normalizeOptionalString(params.pluginId);
    const namespace = normalizeOptionalString(params.namespace);
    if (!pluginId || !namespace) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pluginId and namespace are required"),
      );
      return;
    }
    if (params.unset === true && params.value !== undefined) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "sessions.pluginPatch cannot specify both unset and value",
        ),
      );
      return;
    }
    if (params.value !== undefined && !isPluginJsonValue(params.value)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "sessions.pluginPatch value must be JSON-compatible",
        ),
      );
      return;
    }
    const patched = await patchPluginSessionExtension({
      cfg: context.getRuntimeConfig(),
      sessionKey: key,
      pluginId,
      namespace,
      value: params.value,
      unset: params.unset === true,
    });
    if (!patched.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, patched.error));
      return;
    }
    respond(true, { ok: true, key: patched.key, value: patched.value }, undefined);
    emitSessionsChanged(context, {
      sessionKey: patched.key,
      reason: "plugin-patch",
    });
  },
  "sessions.reset": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateSessionsResetParams, "sessions.reset", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }

    const reason = p.reason === "new" ? "new" : "reset";
    const { performGatewaySessionReset } = await loadSessionsRuntimeModule();
    const result = await performGatewaySessionReset({
      key,
      ...(p.agentId ? { agentId: p.agentId } : {}),
      reason,
      commandSource: "gateway:sessions.reset",
    });
    if (!result.ok) {
      respond(false, undefined, result.error);
      return;
    }
    respond(true, { ok: true, key: result.key, entry: result.entry }, undefined);
    emitSessionsChanged(context, {
      sessionKey: result.key,
      ...(result.key === "global" ? { agentId: result.agentId } : {}),
      reason,
    });
  },
  "sessions.delete": async ({ params, respond, client, isWebchatConnect, context }) => {
    if (!assertValidParams(params, validateSessionsDeleteParams, "sessions.delete", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    if (rejectWebchatSessionMutation({ action: "delete", client, isWebchatConnect, respond })) {
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
    const mainKey = resolveMainSessionKey(cfg);
    const isSelectedNonDefaultGlobal =
      target.canonicalKey === "global" &&
      requestedAgentId !== undefined &&
      requestedAgentId !== resolveDefaultAgentId(cfg);
    if (target.canonicalKey === mainKey && !isSelectedNonDefaultGlobal) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Cannot delete the main session (${mainKey}).`),
      );
      return;
    }

    const deleteTranscript = typeof p.deleteTranscript === "boolean" ? p.deleteTranscript : true;
    const {
      archiveSessionTranscriptsForSessionDetailed,
      cleanupSessionBeforeMutation,
      emitGatewaySessionEndPluginHookAndWait,
      emitSessionUnboundLifecycleEvent,
      resolveSessionTranscriptCandidates,
    } = await loadSessionsRuntimeModule();

    const { entry, legacyKey, canonicalKey } = loadSessionEntry(key, {
      agentId: requestedAgentId,
    });
    if (rejectPluginRuntimeDeleteMismatch({ client, key: canonicalKey ?? key, entry, respond })) {
      return;
    }

    const operationId =
      normalizeOptionalString((p as { operationId?: unknown }).operationId) ?? undefined;
    if (!operationId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "operationId required"));
      return;
    }
    const emitLifecycleHooks = p.emitLifecycleHooks !== false;

    // The caller-generated operationId is the production idempotency boundary.
    let manifest: SessionDeleteOperationManifest | undefined;
    let skipStoreMutation = false;
    let partialReceipt: SessionDeletePartialReceipt | undefined;
    {
      const existingJournal = readSessionDeleteOperationJournal(storePath, operationId);
      if (existingJournal) {
        const requestedCanonicalKey = canonicalKey ?? target.canonicalKey ?? key;
        const requestedAgentIdentity = target.agentId ?? requestedAgentId;
        if (
          existingJournal.manifest.canonicalKey !== requestedCanonicalKey ||
          existingJournal.manifest.agentId !== requestedAgentIdentity ||
          existingJournal.manifest.deleteTranscript !== deleteTranscript ||
          existingJournal.manifest.emitLifecycleHooks !== emitLifecycleHooks
        ) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `Delete operation ${operationId} was already used with a different manifest digest.`,
            ),
          );
          return;
        }
        if (entry && existingJournal.manifest.expectedSessionId !== entry.sessionId) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `Delete operation ${operationId} belongs to a different session generation.`,
            ),
          );
          return;
        }
        if (
          entry &&
          existingJournal.manifest.sessionFile &&
          existingJournal.manifest.sessionFile !== entry.sessionFile
        ) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              `Delete operation ${operationId} was already used with a different manifest digest.`,
            ),
          );
          return;
        }
        if (existingJournal.event.state === "runtime_committed") {
          const savedReceipt = existingJournal.event.receiptJson
            ? (JSON.parse(existingJournal.event.receiptJson) as unknown)
            : undefined;
          respond(
            true,
            savedReceipt ?? {
              ok: true,
              key: target.canonicalKey,
              deleted: true,
              archived: [],
              operationId,
              journalState: "runtime_committed",
            },
            undefined,
          );
          return;
        }
        if (!entry && existingJournal.event.state === "intent") {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              `Delete operation ${operationId} has no current session generation to finalize.`,
            ),
          );
          return;
        }
        manifest = existingJournal.manifest;
        if (existingJournal.event.state === "partial_committed") {
          partialReceipt = parseSessionDeletePartialReceipt(existingJournal.event.receiptJson);
          if (!partialReceipt || partialReceipt.operationId !== operationId) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.UNAVAILABLE,
                `Delete operation ${operationId} has invalid partial progress.`,
              ),
            );
            return;
          }
        }
        if (
          existingJournal.event.state === "store_committed" ||
          existingJournal.event.state === "partial_committed"
        ) {
          skipStoreMutation = true;
        }
      } else if (entry && canonicalKey) {
        manifest = buildSessionDeleteOperationManifest({
          operationId,
          agentId: target.agentId ?? requestedAgentId,
          canonicalKey,
          expectedSessionId: entry.sessionId,
          deleteTranscript,
          emitLifecycleHooks,
          sessionFile: entry.sessionFile,
          archiveEntries: deleteTranscript
            ? resolveSessionTranscriptCandidates(
                entry.sessionId,
                storePath,
                entry.sessionFile,
                target.agentId ?? requestedAgentId,
              )
            : [],
        });
        writeSessionDeleteOperationIntent(storePath, { operationId, manifest });
      } else {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `Delete operation ${operationId} requires an existing session generation.`,
          ),
        );
        return;
      }
    }

    let deleted: boolean;
    let deleteMutationSucceeded = false;
    let sessionId = entry?.sessionId;
    let sessionFile = entry?.sessionFile;
    let archiveAgentId = target.agentId;
    let archiveDeleteTranscript = deleteTranscript;

    if (skipStoreMutation) {
      // Committed-but-incomplete from a previous attempt: never delete the row
      // again and never re-run cleanup; finalize only.
      const existingJournal = readSessionDeleteOperationJournal(storePath, operationId!);
      deleted = true;
      sessionId = existingJournal?.manifest.expectedSessionId ?? entry?.sessionId;
      sessionFile = existingJournal?.manifest.sessionFile ?? entry?.sessionFile;
      archiveAgentId = existingJournal?.manifest.agentId ?? target.agentId;
      archiveDeleteTranscript = existingJournal?.manifest.deleteTranscript ?? deleteTranscript;
    } else {
      const mutationCleanup = await cleanupSessionBeforeMutation({
        cfg,
        key,
        target,
        entry,
        legacyKey,
        canonicalKey,
        reason: "session-delete",
      });
      if (mutationCleanup.error) {
        mutationCleanup.settle(false);
        respond(false, undefined, mutationCleanup.error);
        return;
      }

      const journalRow =
        manifest !== undefined && operationId
          ? buildSessionDeleteOperationJournalRow({
              operationId,
              manifest,
              state: "store_committed",
            })
          : undefined;
      try {
        deleted = await updateSessionStore(
          storePath,
          (store) => {
            const { primaryKey } = migrateAndPruneGatewaySessionStoreKey({
              cfg,
              key,
              store,
              agentId: requestedAgentId,
            });
            const hadEntry = Boolean(store[primaryKey]);
            if (hadEntry) {
              delete store[primaryKey];
            }
            return hadEntry;
          },
          journalRow
            ? {
                sqliteJournalRows: [journalRow],
                skipSaveWhenResult: (result) => result === false,
              }
            : undefined,
        );
        deleteMutationSucceeded = deleted;
      } finally {
        mutationCleanup.settle(deleteMutationSucceeded);
      }
    }

    if (manifest && !deleted) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `Delete operation ${operationId} did not commit a session row mutation.`,
        ),
      );
      return;
    }

    if (!manifest) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "delete manifest missing"));
      return;
    }
    let archivedTranscripts = partialReceipt?.archivedTranscripts ?? [];
    let archiveComplete =
      partialReceipt?.finalization.archiveComplete === true || !archiveDeleteTranscript;
    let sessionEndHookEmitted = partialReceipt?.finalization.sessionEndHookEmitted === true;
    let sessionUnbound = partialReceipt?.finalization.sessionUnbound === true;
    let inFlightFinalizationEffect: "session-end" | "session-unbound" | undefined;
    const buildPartialReceipt = (): SessionDeletePartialReceipt => ({
      ok: true,
      key: target.canonicalKey,
      deleted: true,
      archived: archivedTranscripts.map((entryLocal) => entryLocal.archivedPath),
      archivedTranscripts,
      ...(sessionId ? { sessionId } : {}),
      operationId,
      journalState: "partial_committed",
      finalization: { archiveComplete, sessionEndHookEmitted, sessionUnbound },
    });
    const persistProgress = (): void => {
      markSessionDeleteOperationPartialCommitted(storePath, operationId, buildPartialReceipt());
    };

    try {
      if (deleted && !archiveComplete) {
        const archiveErrors: Array<{ error: unknown; sourcePath: string }> = [];
        const recovered = archiveSessionTranscriptsForSessionDetailed({
          sessionId,
          storePath,
          sessionFile,
          agentId: archiveAgentId,
          reason: "deleted",
          archiveTimestamp: manifest.archivePlan.archiveTimestamp,
          candidatePaths: manifest.archivePlan.entries,
          onArchiveError: (error, sourcePath) => archiveErrors.push({ error, sourcePath }),
        });
        archivedTranscripts = [
          ...new Map(
            [...archivedTranscripts, ...recovered].map((entryLocal) => [
              entryLocal.archivedPath,
              entryLocal,
            ]),
          ).values(),
        ];
        if (archiveErrors.length > 0) {
          throw new Error(
            archiveErrors
              .map(({ error, sourcePath }) => `${sourcePath}: ${String(error)}`)
              .join("; "),
          );
        }
        archiveComplete = true;
        persistProgress();
      }
      if (deleted && !sessionEndHookEmitted) {
        // Plugins receive at-least-once delivery: checkpoint only after all
        // current handlers settle, so a crash cannot silently skip the hook.
        inFlightFinalizationEffect = "session-end";
        await emitGatewaySessionEndPluginHookAndWait({
          cfg,
          sessionKey: target.canonicalKey ?? key,
          sessionId,
          operationId,
          storePath,
          sessionFile,
          agentId: archiveAgentId,
          reason: "deleted",
          archivedTranscripts,
        });
        inFlightFinalizationEffect = undefined;
        sessionEndHookEmitted = true;
        persistProgress();
      }
      if (deleted && !sessionUnbound) {
        inFlightFinalizationEffect = "session-unbound";
        await emitSessionUnboundLifecycleEvent({
          targetSessionKey: target.canonicalKey ?? key,
          reason: "session-delete",
          emitHooks: emitLifecycleHooks,
          operationId,
        });
        inFlightFinalizationEffect = undefined;
        sessionUnbound = true;
        persistProgress();
      }
      const receipt = {
        ok: true,
        key: target.canonicalKey,
        deleted,
        archived: archivedTranscripts.map((entryLocal) => entryLocal.archivedPath),
        ...(sessionId ? { sessionId } : {}),
        operationId,
        journalState: "runtime_committed" as const,
      };
      finalizeSessionDeleteOperationJournal(storePath, operationId, receipt);
      respond(true, receipt, undefined);
    } catch (error) {
      if (inFlightFinalizationEffect === undefined) {
        try {
          persistProgress();
        } catch {
          // The deterministic archive plan lets the next retry recover any
          // rename even when this checkpoint write also failed.
        }
      }
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          `Delete committed but session finalization failed: ${String(error)}`,
        ),
      );
      return;
    }
    if (deleted) {
      emitSessionsChanged(context, {
        sessionKey: target.canonicalKey,
        ...(target.canonicalKey === "global" && requestedAgentId
          ? { agentId: requestedAgentId }
          : {}),
        reason: "delete",
      });
    }
  },
};
