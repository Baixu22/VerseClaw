// Sessions gateway read/subscription methods (list/preview/describe/get/subscribe).
import type { GatewayRequestHandlers } from "./types.js";
import path from "node:path";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import {
  ErrorCodes,
  errorShape,
  validateSessionsCleanupParams,
  validateSessionsDescribeParams,
  validateSessionsEffectivePolicyParams,
  validateSessionsListParams,
  validateSessionsMessagesSubscribeParams,
  validateSessionsMessagesUnsubscribeParams,
  validateSessionsPreviewParams,
  validateSessionsResolveParams,
} from "../../../packages/gateway-protocol/src/index.js";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import {
  loadSessionStore,
  resolveSessionFilePath,
  runSessionsCleanup,
  serializeSessionCleanupResult,
  type SessionEntry,
} from "../../config/sessions.js";
import {
  measureDiagnosticsTimelineSpan,
  measureDiagnosticsTimelineSpanSync,
} from "../../infra/diagnostics-timeline.js";
import { formatErrorMessage } from "../../infra/errors.js";
import {
  buildGatewaySessionRow,
  listSessionsFromStoreAsync,
  loadCombinedSessionStoreForGateway,
  loadSessionEntry,
  readRecentSessionMessagesWithStatsAsync,
  readSessionPreviewItemsFromTranscript,
  resolveFreshestSessionEntryFromStoreKeys,
  resolveGatewaySessionStoreTarget,
  resolveGatewaySessionStoreTargetWithStore,
  type SessionsPreviewEntry,
  type SessionsPreviewResult,
} from "../session-utils.js";
import { resolveSessionKeyFromResolveParams } from "../sessions-resolve.js";
import { loadOptionalServerMethodModelCatalog } from "./optional-model-catalog.js";
import { hasTrackedActiveSessionRun } from "./session-active-runs.js";
import { emitSessionsChanged } from "./session-change-event.js";
import { filterArchivedSessionStore } from "../session-archive-service.js";
import { assertValidParams } from "./validation.js";
import { buildSessionEffectivePolicy } from "../../agents/session-effective-policy.js";
import {
  filterSessionStoreToConfiguredAgents,
  requireSessionKey,
  resolveGatewaySessionTargetFromKey,
  resolveSessionMessageSubscriptionKey,
  resolveRequestedGlobalAgentId,
} from "./sessions.shared.js";

export const sessionsReadHandlers: GatewayRequestHandlers = {
  "sessions.list": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateSessionsListParams, "sessions.list", respond)) {
      return;
    }
    const p = params;
    const cfg = context.getRuntimeConfig();
    const configuredAgentsOnly = p.configuredAgentsOnly === true;
    const payload = await measureDiagnosticsTimelineSpan(
      "gateway.sessions.list",
      async () => {
        const { storePath, store } = measureDiagnosticsTimelineSpanSync(
          "gateway.sessions.list.store_load",
          () =>
            loadCombinedSessionStoreForGateway(cfg, {
              agentId: p.agentId,
            }),
          {
            config: cfg,
            phase: "sessions.list",
            attributes: {
              agentId: p.agentId ?? null,
              configuredAgentsOnly,
            },
          },
        );
        const visibleStore = configuredAgentsOnly
          ? filterSessionStoreToConfiguredAgents(cfg, store)
          : store;
        // Archive intent is visible before the store row disappears; filtering
        // here keeps a partially recovered archive from reappearing as a live chat.
        const listStore = await filterArchivedSessionStore(cfg, visibleStore);
        const modelCatalog = await measureDiagnosticsTimelineSpan(
          "gateway.sessions.list.model_catalog",
          () => loadOptionalServerMethodModelCatalog(context, "sessions.list"),
          {
            config: cfg,
            phase: "sessions.list",
          },
        );
        const result = await measureDiagnosticsTimelineSpan(
          "gateway.sessions.list.rows",
          () =>
            listSessionsFromStoreAsync({
              cfg,
              storePath,
              store: listStore,
              modelCatalog,
              opts: p,
            }),
          {
            config: cfg,
            phase: "sessions.list",
            attributes: {
              storeEntries: Object.keys(listStore).length,
            },
          },
        );
        const sessions = measureDiagnosticsTimelineSpanSync(
          "gateway.sessions.list.active_run_flags",
          () => {
            return result.sessions.map((session) =>
              Object.assign({}, session, {
                hasActiveRun: hasTrackedActiveSessionRun({
                  context,
                  requestedKey: session.key,
                  canonicalKey: session.key,
                  ...(session.key === "global" && p.agentId ? { agentId: p.agentId } : {}),
                  defaultAgentId: resolveDefaultAgentId(cfg),
                }),
              }),
            );
          },
          {
            config: cfg,
            phase: "sessions.list",
            attributes: {
              sessions: result.sessions.length,
            },
          },
        );
        return {
          ...result,
          sessions,
        };
      },
      {
        config: cfg,
        phase: "sessions.list",
        attributes: {
          agentId: p.agentId ?? null,
          configuredAgentsOnly,
        },
      },
    );
    respond(true, payload, undefined);
  },

  "sessions.effectivePolicy": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateSessionsEffectivePolicyParams, "sessions.effectivePolicy", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) return;
    const cfg = context.getRuntimeConfig();
    const loaded = loadSessionEntry(key);
    if (!loaded.entry) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown session: ${key}`));
      return;
    }
    const target = resolveGatewaySessionStoreTarget({ cfg, key: loaded.canonicalKey });
    const sessionFile = (() => {
      try {
        return resolveSessionFilePath(loaded.entry.sessionId, loaded.entry, {
          agentId: target.agentId,
          sessionsDir: path.dirname(loaded.storePath),
        });
      } catch {
        return undefined;
      }
    })();
    const policy = await buildSessionEffectivePolicy({
      cfg,
      entry: loaded.entry,
      workspaceId: p.workspaceId,
      sessionKey: loaded.canonicalKey,
      permissionMode: p.permissionMode,
      sessionFile,
      expectedRuntimeGeneration: process.env.VERSE_CLAW_GATEWAY_GENERATION,
    });
    respond(true, { ok: true, policy }, undefined);
  },
  "sessions.cleanup": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateSessionsCleanupParams, "sessions.cleanup", respond)) {
      return;
    }
    const p = params;
    try {
      const { mode, appliedSummaries } = await runSessionsCleanup({
        cfg: context.getRuntimeConfig(),
        opts: {
          agent: p.agent,
          allAgents: p.allAgents,
          enforce: p.enforce,
          activeKey: p.activeKey,
          fixMissing: p.fixMissing,
          fixDmScope: p.fixDmScope,
        },
      });
      const result = serializeSessionCleanupResult({
        mode,
        dryRun: false,
        summaries: appliedSummaries,
      });
      respond(true, result, undefined);
      for (const summary of appliedSummaries) {
        emitSessionsChanged(context, {
          reason: "cleanup",
          sessionKey: undefined,
        });
        if (summary.wouldMutate) {
          context.logGateway.debug(
            `sessions.cleanup applied ${summary.storePath}: ${summary.beforeCount} -> ${summary.afterCount}`,
          );
        }
      }
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, formatErrorMessage(error)));
    }
  },
  "sessions.subscribe": ({ client, context, respond }) => {
    const connId = client?.connId?.trim();
    if (connId) {
      context.subscribeSessionEvents(connId);
    }
    respond(true, { subscribed: Boolean(connId) }, undefined);
  },
  "sessions.unsubscribe": ({ client, context, respond }) => {
    const connId = client?.connId?.trim();
    if (connId) {
      context.unsubscribeSessionEvents(connId);
    }
    respond(true, { subscribed: false }, undefined);
  },
  "sessions.messages.subscribe": ({ params, client, context, respond }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsMessagesSubscribeParams,
        "sessions.messages.subscribe",
        respond,
      )
    ) {
      return;
    }
    const connId = client?.connId?.trim();
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
    const requestedAgentId = requestedAgent.agentId;
    const { canonicalKey } = loadSessionEntry(key, { agentId: requestedAgentId });
    const subscriptionKey = resolveSessionMessageSubscriptionKey({
      canonicalKey,
      agentId: requestedAgentId,
      defaultAgentId: resolveDefaultAgentId(cfg),
    });
    if (connId) {
      context.subscribeSessionMessageEvents(connId, subscriptionKey);
      respond(true, { subscribed: true, key: canonicalKey }, undefined);
      return;
    }
    respond(true, { subscribed: false, key: canonicalKey }, undefined);
  },
  "sessions.messages.unsubscribe": ({ params, client, context, respond }) => {
    if (
      !assertValidParams(
        params,
        validateSessionsMessagesUnsubscribeParams,
        "sessions.messages.unsubscribe",
        respond,
      )
    ) {
      return;
    }
    const connId = client?.connId?.trim();
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
    const requestedAgentId = requestedAgent.agentId;
    const { canonicalKey } = loadSessionEntry(key, { agentId: requestedAgentId });
    const subscriptionKey = resolveSessionMessageSubscriptionKey({
      canonicalKey,
      agentId: requestedAgentId,
      defaultAgentId: resolveDefaultAgentId(cfg),
    });
    if (connId) {
      context.unsubscribeSessionMessageEvents(connId, subscriptionKey);
    }
    respond(true, { subscribed: false, key: canonicalKey }, undefined);
  },
  "sessions.preview": ({ params, respond, context }) => {
    if (!assertValidParams(params, validateSessionsPreviewParams, "sessions.preview", respond)) {
      return;
    }
    const p = params;
    const keysRaw = Array.isArray(p.keys) ? p.keys : [];
    const keys = keysRaw
      .map((key) => normalizeOptionalString(key ?? ""))
      .filter((key): key is string => Boolean(key))
      .slice(0, 64);
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit) ? Math.max(1, p.limit) : 12;
    const maxChars =
      typeof p.maxChars === "number" && Number.isFinite(p.maxChars)
        ? Math.max(20, p.maxChars)
        : 240;

    if (keys.length === 0) {
      respond(true, { ts: Date.now(), previews: [] } satisfies SessionsPreviewResult, undefined);
      return;
    }

    const cfg = context.getRuntimeConfig();
    const storeCache = new Map<string, Record<string, SessionEntry>>();
    const previews: SessionsPreviewEntry[] = [];

    for (const key of keys) {
      try {
        const cachedStoreTarget = resolveGatewaySessionStoreTargetWithStore({
          cfg,
          key,
          scanLegacyKeys: false,
        });
        const store = storeCache.get(cachedStoreTarget.storePath) ?? cachedStoreTarget.store;
        storeCache.set(cachedStoreTarget.storePath, store);
        const target = resolveGatewaySessionStoreTarget({
          cfg,
          key,
          store,
        });
        const entry = resolveFreshestSessionEntryFromStoreKeys(store, target.storeKeys);
        if (!entry?.sessionId) {
          previews.push({ key, status: "missing", items: [] });
          continue;
        }
        const items = readSessionPreviewItemsFromTranscript(
          entry.sessionId,
          target.storePath,
          entry.sessionFile,
          target.agentId,
          limit,
          maxChars,
        );
        previews.push({
          key,
          status: items.length > 0 ? "ok" : "empty",
          items,
        });
      } catch {
        previews.push({ key, status: "error", items: [] });
      }
    }

    respond(true, { ts: Date.now(), previews } satisfies SessionsPreviewResult, undefined);
  },
  "sessions.describe": ({ params, respond, context }) => {
    if (!assertValidParams(params, validateSessionsDescribeParams, "sessions.describe", respond)) {
      return;
    }
    const p = params;
    const key = requireSessionKey(p.key, respond);
    if (!key) {
      return;
    }
    const cfg = context.getRuntimeConfig();
    const { target, storePath } = resolveGatewaySessionTargetFromKey(key, cfg);
    const store = loadSessionStore(storePath);
    const entry = resolveFreshestSessionEntryFromStoreKeys(store, target.storeKeys);
    if (!entry) {
      respond(true, { session: null }, undefined);
      return;
    }
    const row = buildGatewaySessionRow({
      cfg,
      storePath,
      store,
      key: target.canonicalKey,
      entry,
      includeDerivedTitles: p.includeDerivedTitles,
      includeLastMessage: p.includeLastMessage,
      transcriptUsageMaxBytes: 64 * 1024,
    });
    respond(true, { session: row }, undefined);
  },
  "sessions.resolve": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateSessionsResolveParams, "sessions.resolve", respond)) {
      return;
    }
    const p = params;
    const cfg = context.getRuntimeConfig();

    const resolved = await resolveSessionKeyFromResolveParams({ cfg, p });
    if (!resolved.ok) {
      respond(false, undefined, resolved.error);
      return;
    }
    respond(true, { ok: true, key: resolved.key }, undefined);
  },
  "sessions.get": async ({ params, respond, context }) => {
    const p = params as {
      key?: unknown;
      sessionKey?: unknown;
      limit?: unknown;
      agentId?: unknown;
    };
    const key = requireSessionKey(p.key ?? p.sessionKey, respond);
    if (!key) {
      return;
    }
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit)
        ? Math.max(1, Math.floor(p.limit))
        : 200;

    const cfg = context.getRuntimeConfig();
    const requestedAgent = resolveRequestedGlobalAgentId(
      cfg,
      key,
      normalizeOptionalString(p.agentId),
    );
    if (!requestedAgent.ok) {
      respond(false, undefined, requestedAgent.error);
      return;
    }
    const { target, storePath } = resolveGatewaySessionTargetFromKey(key, cfg, {
      agentId: requestedAgent.agentId,
    });
    const store = loadSessionStore(storePath);
    const entry = resolveFreshestSessionEntryFromStoreKeys(store, target.storeKeys);
    if (!entry?.sessionId) {
      respond(true, { messages: [] }, undefined);
      return;
    }
    const { messages } = await readRecentSessionMessagesWithStatsAsync(
      entry.sessionId,
      storePath,
      entry.sessionFile,
      {
        maxMessages: limit,
        maxLines: limit * 20 + 20,
      },
    );
    respond(true, { messages }, undefined);
  },
};
