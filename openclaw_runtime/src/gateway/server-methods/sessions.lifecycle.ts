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
import {
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
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
  resolveSessionStoreAgentId,
  resolveSessionStoreKey,
} from "../session-store-key.js";
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
        errorShape(ErrorCodes.INVALID_REQUEST, "cannot fork while the source session has an active run"),
      );
      return;
    }
    const forkDecision = await resolveParentForkDecision({
      parentEntry: source.entry,
      storePath: source.storePath,
    });
    if (forkDecision.status === "skip") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, forkDecision.message));
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
      emitGatewaySessionEndPluginHook,
      emitSessionUnboundLifecycleEvent,
    } = await loadSessionsRuntimeModule();

    const { entry, legacyKey, canonicalKey } = loadSessionEntry(key, {
      agentId: requestedAgentId,
    });
    if (rejectPluginRuntimeDeleteMismatch({ client, key: canonicalKey ?? key, entry, respond })) {
      return;
    }
    const mutationCleanupError = await cleanupSessionBeforeMutation({
      cfg,
      key,
      target,
      entry,
      legacyKey,
      canonicalKey,
      reason: "session-delete",
    });
    if (mutationCleanupError) {
      respond(false, undefined, mutationCleanupError);
      return;
    }
    const sessionId = entry?.sessionId;
    const deleted = await updateSessionStore(storePath, (store) => {
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
    });

    const archivedTranscripts =
      deleted && deleteTranscript
        ? archiveSessionTranscriptsForSessionDetailed({
            sessionId,
            storePath,
            sessionFile: entry?.sessionFile,
            agentId: target.agentId,
            reason: "deleted",
          })
        : [];
    const archived = archivedTranscripts.map((entryLocal) => entryLocal.archivedPath);
    if (deleted) {
      emitGatewaySessionEndPluginHook({
        cfg,
        sessionKey: target.canonicalKey ?? key,
        sessionId,
        storePath,
        sessionFile: entry?.sessionFile,
        agentId: target.agentId,
        reason: "deleted",
        archivedTranscripts,
      });
      const emitLifecycleHooks = p.emitLifecycleHooks !== false;
      await emitSessionUnboundLifecycleEvent({
        targetSessionKey: target.canonicalKey ?? key,
        reason: "session-delete",
        emitHooks: emitLifecycleHooks,
      });
    }

    respond(true, { ok: true, key: target.canonicalKey, deleted, archived }, undefined);
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
