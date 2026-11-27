// Shared helpers for the sessions.* gateway method modules, split from sessions.ts.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { GATEWAY_CLIENT_IDS } from "../../../packages/gateway-protocol/src/client-info.js";
import {
  ErrorCodes,
  errorShape,
  type SessionOperationEvent,
} from "../../../packages/gateway-protocol/src/index.js";
import {
  buildDeterministicCompressionArtifact,
  normalizeCompressionArtifact,
  type CompressionArtifact,
} from "../../../packages/agent-core/src/harness/compaction/compression-artifact.js";
import {
  listAgentIds,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import {
  abortEmbeddedAgentRun,
  isEmbeddedAgentRunActive,
  waitForEmbeddedAgentRunEnd,
} from "../../agents/embedded-agent-runner/runs.js";
import { clearSessionQueues } from "../../auto-reply/reply/queue/cleanup.js";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  listConfiguredSessionStoreAgentIds,
  type SessionEntry,
} from "../../config/sessions.js";
import { resolveAgentMainSessionKey } from "../../config/sessions/main-session.js";
import { CURRENT_SESSION_VERSION } from "../../config/sessions/version.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { formatErrorMessage } from "../../infra/errors.js";
import {
  normalizeAgentId,
  parseAgentSessionKey,
} from "../../routing/session-key.js";
import {
  getSessionCompactionCheckpoint,
  listSessionCompactionCheckpoints,
} from "../session-compaction-checkpoints.js";
import {
  resolveSessionStoreAgentId,
  resolveSessionStoreKey,
  resolveStoredSessionKeyForAgentStore,
  resolveStoredSessionOwnerAgentId,
} from "../session-store-key.js";
import { resolveGatewaySessionStoreTarget } from "../session-utils.js";
import { chatHandlers } from "./chat.js";
import { hasTrackedActiveSessionRun } from "./session-active-runs.js";
import type {
  GatewayClient,
  GatewayRequestContext,
  GatewayRequestHandlerOptions,
  RespondFn,
} from "./types.js";

export function filterSessionStoreToConfiguredAgents(
  cfg: OpenClawConfig,
  store: Record<string, SessionEntry>,
): Record<string, SessionEntry> {
  const configuredAgentIds = new Set(listConfiguredSessionStoreAgentIds(cfg));
  const isConfiguredSessionKey = (key: string | undefined) => {
    const normalizedKey = normalizeOptionalString(key);
    if (!normalizedKey) {
      return false;
    }
    const canonicalKey = resolveSessionStoreKey({ cfg, sessionKey: normalizedKey });
    const agentId = resolveSessionStoreAgentId(cfg, canonicalKey);
    return configuredAgentIds.has(normalizeAgentId(agentId));
  };
  return Object.fromEntries(
    Object.entries(store).filter(([key, entry]) => {
      if (key === "global" || key === "unknown") {
        return true;
      }
      if (isConfiguredSessionKey(key)) {
        return true;
      }
      // Keep spawned child sessions visible when their parent belongs to a configured agent.
      return (
        isConfiguredSessionKey(entry?.spawnedBy) || isConfiguredSessionKey(entry?.parentSessionKey)
      );
    }),
  );
}

export function inheritSessionRuntimeSelection(
  parentEntry: SessionEntry | undefined,
): Partial<SessionEntry> {
  if (!parentEntry) {
    return {};
  }
  return {
    ...(parentEntry.providerOverride ? { providerOverride: parentEntry.providerOverride } : {}),
    ...(parentEntry.modelOverride ? { modelOverride: parentEntry.modelOverride } : {}),
    ...(parentEntry.modelOverrideSource
      ? { modelOverrideSource: parentEntry.modelOverrideSource }
      : {}),
    ...(parentEntry.agentRuntimeOverride
      ? { agentRuntimeOverride: parentEntry.agentRuntimeOverride }
      : {}),
    ...(parentEntry.modelProvider ? { modelProvider: parentEntry.modelProvider } : {}),
    ...(parentEntry.model ? { model: parentEntry.model } : {}),
    ...(typeof parentEntry.contextTokens === "number"
      ? { contextTokens: parentEntry.contextTokens }
      : {}),
    ...(parentEntry.thinkingLevel ? { thinkingLevel: parentEntry.thinkingLevel } : {}),
    ...(typeof parentEntry.fastMode === "boolean" ? { fastMode: parentEntry.fastMode } : {}),
    ...(parentEntry.verboseLevel ? { verboseLevel: parentEntry.verboseLevel } : {}),
    ...(parentEntry.traceLevel ? { traceLevel: parentEntry.traceLevel } : {}),
    ...(parentEntry.reasoningLevel ? { reasoningLevel: parentEntry.reasoningLevel } : {}),
    ...(parentEntry.elevatedLevel ? { elevatedLevel: parentEntry.elevatedLevel } : {}),
    ...(parentEntry.authProfileOverride
      ? { authProfileOverride: parentEntry.authProfileOverride }
      : {}),
    ...(parentEntry.authProfileOverrideSource
      ? { authProfileOverrideSource: parentEntry.authProfileOverrideSource }
      : {}),
  };
}

export type SessionsRuntimeModule = typeof import("./sessions.runtime.js");

let sessionsRuntimeModulePromise: Promise<SessionsRuntimeModule> | undefined;

export function loadSessionsRuntimeModule(): Promise<SessionsRuntimeModule> {
  sessionsRuntimeModulePromise ??= import("./sessions.runtime.js");
  return sessionsRuntimeModulePromise;
}

export function requireSessionKey(key: unknown, respond: RespondFn): string | null {
  const raw =
    typeof key === "string"
      ? key
      : typeof key === "number"
        ? String(key)
        : typeof key === "bigint"
          ? String(key)
          : "";
  const normalized = normalizeOptionalString(raw) ?? "";
  if (!normalized) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
    return null;
  }
  return normalized;
}

export function rejectPluginRuntimeDeleteMismatch(params: {
  client: GatewayClient | null;
  key: string;
  entry: SessionEntry | undefined;
  respond: RespondFn;
}): boolean {
  const pluginOwnerId = normalizeOptionalString(params.client?.internal?.pluginRuntimeOwnerId);
  if (!pluginOwnerId || !params.entry) {
    return false;
  }
  if (normalizeOptionalString(params.entry.pluginOwnerId) === pluginOwnerId) {
    return false;
  }
  params.respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `Plugin "${pluginOwnerId}" cannot delete session "${params.key}" because it did not create it.`,
    ),
  );
  return true;
}

export function resolveGatewaySessionTargetFromKey(
  key: string,
  cfg: OpenClawConfig,
  opts?: { agentId?: string },
) {
  const target = resolveGatewaySessionStoreTarget({
    cfg,
    key,
    ...(opts?.agentId ? { agentId: opts.agentId } : {}),
  });
  return { cfg, target, storePath: target.storePath };
}

export function resolveOptionalInitialSessionMessage(params: {
  task?: unknown;
  message?: unknown;
}): string | undefined {
  if (typeof params.task === "string" && params.task.trim()) {
    return params.task;
  }
  if (typeof params.message === "string" && params.message.trim()) {
    return params.message;
  }
  return undefined;
}

export function shouldAttachPendingMessageSeq(params: { payload: unknown; cached?: boolean }): boolean {
  if (params.cached) {
    return false;
  }
  const status =
    params.payload && typeof params.payload === "object"
      ? (params.payload as { status?: unknown }).status
      : undefined;
  return status === "started";
}

export function emitSessionOperation(
  context: Pick<GatewayRequestContext, "broadcastToConnIds" | "getSessionEventSubscriberConnIds">,
  payload: Omit<SessionOperationEvent, "ts">,
) {
  const connIds = context.getSessionEventSubscriberConnIds();
  if (connIds.size === 0) {
    return;
  }
  context.broadcastToConnIds(
    "session.operation",
    {
      ...payload,
      ts: Date.now(),
    } satisfies SessionOperationEvent,
    connIds,
    { dropIfSlow: true },
  );
}

export function rejectWebchatSessionMutation(params: {
  action: "patch" | "delete" | "compact" | "restore";
  client: GatewayClient | null;
  isWebchatConnect: (params: GatewayClient["connect"] | null | undefined) => boolean;
  respond: RespondFn;
}): boolean {
  if (!params.client?.connect || !params.isWebchatConnect(params.client.connect)) {
    return false;
  }
  if (params.client.connect.client.id === GATEWAY_CLIENT_IDS.CONTROL_UI) {
    return false;
  }
  params.respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `webchat clients cannot ${params.action} sessions; use chat.send for session-scoped updates`,
    ),
  );
  return true;
}

export function buildDashboardSessionKey(agentId: string): string {
  return `agent:${agentId}:dashboard:${randomUUID()}`;
}

export function cloneCheckpointSessionEntry(params: {
  currentEntry: SessionEntry;
  nextSessionId: string;
  nextSessionFile: string;
  label?: string;
  parentSessionKey?: string;
  totalTokens?: number;
  preserveCompactionCheckpoints?: boolean;
}): SessionEntry {
  return {
    ...params.currentEntry,
    sessionId: params.nextSessionId,
    sessionFile: params.nextSessionFile,
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
    totalTokens:
      typeof params.totalTokens === "number" && Number.isFinite(params.totalTokens)
        ? params.totalTokens
        : undefined,
    totalTokensFresh:
      typeof params.totalTokens === "number" && Number.isFinite(params.totalTokens)
        ? true
        : undefined,
    label: params.label ?? params.currentEntry.label,
    parentSessionKey: params.parentSessionKey ?? params.currentEntry.parentSessionKey,
    compactionCheckpoints: params.preserveCompactionCheckpoints
      ? params.currentEntry.compactionCheckpoints
      : undefined,
  };
}

export function resolveCheckpointForkSource(
  checkpoint: NonNullable<ReturnType<typeof getSessionCompactionCheckpoint>>,
): { sourceFile: string; sourceLeafId?: string; totalTokens?: number } | null {
  const preCompactionFile = checkpoint.preCompaction.sessionFile?.trim();
  if (preCompactionFile) {
    return {
      sourceFile: preCompactionFile,
      sourceLeafId: checkpoint.preCompaction.leafId,
      totalTokens: checkpoint.tokensBefore,
    };
  }
  const postCompactionFile = checkpoint.postCompaction.sessionFile?.trim();
  if (!postCompactionFile) {
    return null;
  }
  const postCompactionLeafId =
    checkpoint.postCompaction.leafId ?? checkpoint.postCompaction.entryId;
  if (!postCompactionLeafId) {
    return null;
  }
  return {
    sourceFile: postCompactionFile,
    sourceLeafId: postCompactionLeafId,
    totalTokens: checkpoint.tokensAfter,
  };
}

export function isAgentMainSessionKey(cfg: OpenClawConfig, sessionKey: string): boolean {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) {
    return false;
  }
  return sessionKey === resolveAgentMainSessionKey({ cfg, agentId: parsed.agentId });
}

export async function ensureSessionTranscriptFile(params: {
  sessionId: string;
  storePath: string;
  sessionFile?: string;
  agentId: string;
}): Promise<{ ok: true; transcriptPath: string } | { ok: false; error: string }> {
  try {
    const transcriptPath = resolveSessionFilePath(
      params.sessionId,
      params.sessionFile ? { sessionFile: params.sessionFile } : undefined,
      resolveSessionFilePathOptions({
        storePath: params.storePath,
        agentId: params.agentId,
      }),
    );
    await fs.promises.mkdir(path.dirname(transcriptPath), { recursive: true });
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: params.sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    try {
      // "wx" keeps the create-if-missing check and the write atomic; a
      // concurrent creator winning the race (EEXIST) is equivalent to the
      // file having existed all along, which is the no-op path here.
      await fs.promises.writeFile(transcriptPath, `${JSON.stringify(header)}\n`, {
        encoding: "utf-8",
        mode: 0o600,
        flag: "wx",
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") {
        throw err;
      }
    }
    return { ok: true, transcriptPath };
  } catch (err) {
    return {
      ok: false,
      error: formatErrorMessage(err),
    };
  }
}

export function resolveAbortSessionKey(params: {
  context: Pick<GatewayRequestContext, "chatAbortControllers">;
  requestedKey: string;
  canonicalKey: string;
  activeRunSessionKey?: string;
  aliasKeys?: string[];
}): string {
  if (params.activeRunSessionKey) {
    return params.activeRunSessionKey;
  }
  const candidates = [params.canonicalKey, params.requestedKey, ...(params.aliasKeys ?? [])];
  for (const active of params.context.chatAbortControllers.values()) {
    if (active.controlUiVisible === false) {
      continue;
    }
    for (const candidate of candidates) {
      if (active.sessionKey === candidate) {
        return candidate;
      }
    }
  }
  return params.requestedKey;
}

export function resolveSessionKeyAgentId(
  sessionKey: string | undefined,
  cfg: OpenClawConfig,
): string | undefined {
  const key = normalizeOptionalString(sessionKey);
  if (!key) {
    return undefined;
  }
  if (!parseAgentSessionKey(key) && key.toLowerCase().startsWith("agent:")) {
    return undefined;
  }
  const canonicalKey = resolveSessionStoreKey({ cfg, sessionKey: key });
  return resolveSessionStoreAgentId(cfg, canonicalKey);
}

export function sessionKeyBelongsToAgent(
  sessionKey: string | undefined,
  agentId: string,
  cfg: OpenClawConfig,
): boolean {
  const key = normalizeOptionalString(sessionKey);
  if (cfg.session?.scope === "global" && key?.toLowerCase() === "global") {
    return true;
  }
  const sessionAgentId = resolveSessionKeyAgentId(sessionKey, cfg);
  return Boolean(sessionAgentId && sessionAgentId === normalizeAgentId(agentId));
}

export function resolveScopedAbortKey(params: {
  cfg: OpenClawConfig;
  key: string | undefined;
  agentId: string | undefined;
}): string | undefined {
  const key = normalizeOptionalString(params.key);
  if (!key) {
    return undefined;
  }
  const requestedAgentId = normalizeOptionalString(params.agentId);
  if (!requestedAgentId) {
    return key;
  }
  const scopedAgentId = normalizeAgentId(requestedAgentId);
  const ownerAgentId = resolveStoredSessionOwnerAgentId({
    cfg: params.cfg,
    agentId: scopedAgentId,
    sessionKey: key,
  });
  if (ownerAgentId && ownerAgentId !== scopedAgentId) {
    return undefined;
  }
  return resolveStoredSessionKeyForAgentStore({
    cfg: params.cfg,
    agentId: scopedAgentId,
    sessionKey: key,
  });
}

export function resolveSessionMessageSubscriptionKey(params: {
  canonicalKey: string;
  agentId?: string;
  defaultAgentId?: string;
}): string {
  const agentId = params.agentId
    ? normalizeAgentId(params.agentId)
    : params.canonicalKey === "global" && params.defaultAgentId
      ? normalizeAgentId(params.defaultAgentId)
      : undefined;
  // Global session message subscriptions need per-agent channels to avoid cross-agent fanout.
  return params.canonicalKey === "global" && agentId
    ? `agent:${agentId}:global`
    : params.canonicalKey;
}

export type RequestedGlobalAgentIdResolution =
  | { ok: true; agentId?: string }
  | { ok: false; error: ReturnType<typeof errorShape> };

export function resolveRequestedGlobalAgentId(
  cfg: OpenClawConfig,
  key: string,
  explicitAgentId?: string,
): RequestedGlobalAgentIdResolution {
  const canonicalKey = resolveSessionStoreKey({ cfg, sessionKey: key });
  const parsed = parseAgentSessionKey(key);
  const requestedAgentId = normalizeOptionalString(explicitAgentId);
  if (requestedAgentId) {
    const agentId = normalizeAgentId(requestedAgentId);
    if (!listAgentIds(cfg).includes(agentId)) {
      return {
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, `Unknown agent id "${explicitAgentId}"`),
      };
    }
    if (parsed?.agentId && normalizeAgentId(parsed.agentId) !== agentId) {
      return {
        ok: false,
        error: errorShape(ErrorCodes.INVALID_REQUEST, "session key agent does not match agentId"),
      };
    }
    if (canonicalKey !== "global") {
      const keyAgentId = parsed?.agentId
        ? normalizeAgentId(parsed.agentId)
        : normalizeAgentId(resolveSessionStoreAgentId(cfg, canonicalKey));
      if (keyAgentId !== agentId) {
        return {
          ok: false,
          error: errorShape(ErrorCodes.INVALID_REQUEST, "session key agent does not match agentId"),
        };
      }
    }
    return { ok: true, agentId };
  }
  if (!parsed?.agentId) {
    return { ok: true };
  }
  const inferredAgentId = normalizeAgentId(parsed.agentId);
  if (canonicalKey === "global" && !listAgentIds(cfg).includes(inferredAgentId)) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, `Unknown agent id "${parsed.agentId}"`),
    };
  }
  return {
    ok: true,
    agentId: canonicalKey === "global" ? inferredAgentId : undefined,
  };
}

export async function interruptSessionRunIfActive(params: {
  req: GatewayRequestHandlerOptions["req"];
  context: GatewayRequestContext;
  client: GatewayClient | null;
  isWebchatConnect: GatewayRequestHandlerOptions["isWebchatConnect"];
  requestedKey: string;
  canonicalKey: string;
  agentId?: string;
  sessionId?: string;
  expectedRunId?: string;
}): Promise<{ interrupted: boolean; error?: ReturnType<typeof errorShape> }> {
  if (params.expectedRunId) {
    const run = params.context.chatAbortControllers.get(params.expectedRunId);
    const changed = { interrupted: false, error: errorShape(ErrorCodes.INVALID_REQUEST, "SESSION_STEER_RUN_CHANGED") };
    if (!run || run.controller.signal.aborted || run.sessionId !== params.sessionId ||
        (run.sessionKey !== params.canonicalKey && run.sessionKey !== params.requestedKey)) return changed;
    let interrupted = false;
    let abortError: ReturnType<typeof errorShape> | undefined;
    await chatHandlers["chat.abort"]({
      req: params.req,
      params: { sessionKey: run.sessionKey, runId: params.expectedRunId, ...(params.agentId ? { agentId: params.agentId } : {}) },
      respond: (ok, payload, error) => {
        interrupted = ok && (payload as { aborted?: boolean } | undefined)?.aborted === true;
        abortError = error;
        if (interrupted) clearSessionQueues([params.requestedKey, params.canonicalKey, params.sessionId]);
      },
      context: params.context,
      client: params.client,
      isWebchatConnect: params.isWebchatConnect,
    });
    if (!interrupted) return abortError ? { interrupted: false, error: abortError } : changed;
    if (params.sessionId && !await waitForEmbeddedAgentRunEnd(params.sessionId, 15_000)) {
      return { interrupted: true, error: errorShape(ErrorCodes.UNAVAILABLE, "The original run is still ending") };
    }
    return { interrupted: true };
  }
  const cfg = params.context.getRuntimeConfig();
  const hasTrackedRun = hasTrackedActiveSessionRun({
    context: params.context,
    requestedKey: params.requestedKey,
    canonicalKey: params.canonicalKey,
    agentId: params.agentId,
    defaultAgentId: resolveDefaultAgentId(cfg),
  });
  const hasEmbeddedRun =
    typeof params.sessionId === "string" && params.sessionId
      ? isEmbeddedAgentRunActive(params.sessionId)
      : false;

  if (!hasTrackedRun && !hasEmbeddedRun) {
    return { interrupted: false };
  }

  if (hasTrackedRun) {
    let abortOk = true;
    let abortError: ReturnType<typeof errorShape> | undefined;
    const abortSessionKey = resolveAbortSessionKey({
      context: params.context,
      requestedKey: params.requestedKey,
      canonicalKey: params.canonicalKey,
    });

    await chatHandlers["chat.abort"]({
      req: params.req,
      params: {
        sessionKey: abortSessionKey,
        ...(params.canonicalKey === "global" && params.agentId ? { agentId: params.agentId } : {}),
      },
      respond: (ok, _payload, error) => {
        abortOk = ok;
        abortError = error;
      },
      context: params.context,
      client: params.client,
      isWebchatConnect: params.isWebchatConnect,
    });

    if (!abortOk) {
      return {
        interrupted: true,
        error:
          abortError ?? errorShape(ErrorCodes.UNAVAILABLE, "failed to interrupt active session"),
      };
    }
  }

  if (hasEmbeddedRun && params.sessionId) {
    abortEmbeddedAgentRun(params.sessionId);
  }

  // Clear queued follow-up work for both requested aliases and the canonical session id.
  clearSessionQueues([params.requestedKey, params.canonicalKey, params.sessionId]);

  if (hasEmbeddedRun && params.sessionId) {
    const ended = await waitForEmbeddedAgentRunEnd(params.sessionId, 15_000);
    if (!ended) {
      return {
        interrupted: true,
        error: errorShape(
          ErrorCodes.UNAVAILABLE,
          `Session ${params.requestedKey} is still active; try again in a moment.`,
        ),
      };
    }
  }

  return { interrupted: true };
}

export function compressionDetailsFromCheckpoint(
  checkpoint: ReturnType<typeof listSessionCompactionCheckpoints>[number],
): Record<string, unknown> | undefined {
  const details = (checkpoint as { details?: unknown }).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  return details as Record<string, unknown>;
}

export function telemetryFromCheckpoint(
  checkpoint: ReturnType<typeof listSessionCompactionCheckpoints>[number],
): Record<string, unknown> | undefined {
  const compression = compressionDetailsFromCheckpoint(checkpoint)?.compression;
  if (!compression || typeof compression !== "object" || Array.isArray(compression)) return undefined;
  return compression as Record<string, unknown>;
}

function isCompressionTier(
  value: unknown,
): value is "tier0" | "tier1" | "tier2" | "tier3" | "tier4" {
  return (
    value === "tier0" ||
    value === "tier1" ||
    value === "tier2" ||
    value === "tier3" ||
    value === "tier4"
  );
}

function isCompressionStrategy(
  value: unknown,
): value is
  | "hot-context"
  | "micro-compact"
  | "token-pruning"
  | "semantic-handoff"
  | "emergency-collapse" {
  return (
    value === "hot-context" ||
    value === "micro-compact" ||
    value === "token-pruning" ||
    value === "semantic-handoff" ||
    value === "emergency-collapse"
  );
}

export function compressionArtifactFromCheckpoint(
  checkpoint: ReturnType<typeof listSessionCompactionCheckpoints>[number],
): CompressionArtifact | undefined {
  const details = compressionDetailsFromCheckpoint(checkpoint);
  const storedArtifact = normalizeCompressionArtifact(details?.artifact);
  const telemetry = telemetryFromCheckpoint(checkpoint);
  const readFiles = Array.isArray(details?.readFiles)
    ? details.readFiles.filter((item): item is string => typeof item === "string")
    : [];
  const modifiedFiles = Array.isArray(details?.modifiedFiles)
    ? details.modifiedFiles.filter((item): item is string => typeof item === "string")
    : [];
  const artifact = storedArtifact ?? buildDeterministicCompressionArtifact({
    messages: [],
    summary: checkpoint.summary,
    readFiles,
    modifiedFiles,
    telemetry: {
      ...(isCompressionTier(telemetry?.tier) ? { tier: telemetry.tier } : {}),
      ...(isCompressionStrategy(telemetry?.strategy) ? { strategy: telemetry.strategy } : {}),
      ...(typeof telemetry?.compressionRatio === "number" ? { compressionRatio: telemetry.compressionRatio } : {}),
      ...(typeof checkpoint.tokensBefore === "number" ? { tokensBefore: checkpoint.tokensBefore } : {}),
      ...(typeof checkpoint.tokensAfter === "number" ? { tokensAfter: checkpoint.tokensAfter } : {}),
      ...(Array.isArray(telemetry?.rehydratedFiles)
        ? { rehydratedFiles: telemetry.rehydratedFiles.filter((item): item is string => typeof item === "string") }
        : {}),
      ...(typeof telemetry?.staleExcludedCount === "number"
        ? { staleExcludedCount: telemetry.staleExcludedCount }
        : {}),
      ...(typeof telemetry?.causalAnchorCount === "number"
        ? { causalAnchorCount: telemetry.causalAnchorCount }
        : {}),
      ...(Array.isArray(telemetry?.warnings)
        ? { warnings: telemetry.warnings.filter((item): item is string => typeof item === "string") }
        : {}),
    },
  });
  return normalizeCompressionArtifact({
    ...artifact,
    ...(typeof telemetry?.tier === "string" ? { tier: telemetry.tier } : {}),
    ...(typeof telemetry?.strategy === "string" ? { strategy: telemetry.strategy } : {}),
    ...(typeof telemetry?.compressionRatio === "number" ? { compressionRatio: telemetry.compressionRatio } : {}),
    ...(typeof checkpoint.tokensBefore === "number" ? { tokensBefore: checkpoint.tokensBefore } : {}),
    ...(typeof checkpoint.tokensAfter === "number" ? { tokensAfter: checkpoint.tokensAfter } : {}),
    ...(Array.isArray(telemetry?.rehydratedFiles)
      ? { rehydratedFiles: telemetry.rehydratedFiles.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(typeof telemetry?.staleExcludedCount === "number"
      ? { staleExcludedCount: telemetry.staleExcludedCount }
      : {}),
    ...(typeof telemetry?.causalAnchorCount === "number"
      ? { causalAnchorCount: telemetry.causalAnchorCount }
      : {}),
    ...(Array.isArray(telemetry?.warnings)
      ? { warnings: telemetry.warnings.filter((item): item is string => typeof item === "string") }
      : {}),
  });
}

export function estimateProjectionTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

export function compactionHistoryEntryFromCheckpoint(checkpoint: ReturnType<typeof listSessionCompactionCheckpoints>[number]) {
  const artifact = compressionArtifactFromCheckpoint(checkpoint);
  return {
    id: checkpoint.checkpointId,
    timestamp: checkpoint.createdAt,
    ...(checkpoint.summary ? { summary: checkpoint.summary } : {}),
    ...(typeof checkpoint.tokensBefore === "number" ? { tokensBefore: checkpoint.tokensBefore } : {}),
    ...(typeof checkpoint.tokensAfter === "number" ? { tokensAfter: checkpoint.tokensAfter } : {}),
    ...(checkpoint.firstKeptEntryId ? { firstKeptEntryId: checkpoint.firstKeptEntryId } : {}),
    trigger: checkpoint.reason,
    ...(artifact?.quality ? { quality: artifact.quality } : {}),
    ...(artifact?.quality ? { artifactTokens: artifact.quality.artifactTokens } : {}),
    ...(artifact?.quality ? { projectionTokens: artifact.quality.projectionTokens } : {}),
    ...(artifact?.quality ? { evidenceCoverage: artifact.quality.evidenceCoverage } : {}),
    ...(artifact ? { unverifiedCount: artifact.unverifiedClaims.length } : {}),
    ...(artifact?.quality.warnings.length ? { warnings: artifact.quality.warnings } : {}),
  };
}

export function listCompactionHistoryEntries(entry: SessionEntry | undefined, limit?: number) {
  const entries = listSessionCompactionCheckpoints(entry)
    .map(compactionHistoryEntryFromCheckpoint)
    .sort((a, b) => b.timestamp - a.timestamp);
  return typeof limit === "number" && Number.isFinite(limit)
    ? entries.slice(0, Math.max(1, Math.floor(limit)))
    : entries;
}

export function resolveCompactionPressure(params: {
  usedTokens?: number;
  maxTokens?: number;
  shouldCompact?: boolean;
  route?: string;
  overflowTokens?: number;
}): "unknown" | "low" | "medium" | "high" {
  if (
    params.shouldCompact ||
    (typeof params.overflowTokens === "number" && params.overflowTokens > 0) ||
    (params.route && params.route !== "fits")
  ) {
    return "high";
  }
  if (
    typeof params.usedTokens !== "number" ||
    typeof params.maxTokens !== "number" ||
    params.maxTokens <= 0
  ) {
    return "unknown";
  }
  const ratio = params.usedTokens / params.maxTokens;
  if (ratio >= 0.8) return "high";
  if (ratio >= 0.6) return "medium";
  return "low";
}
