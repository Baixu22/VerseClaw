// Agent Browser bridge methods relay runtime tool calls to the Electron Main
// process, which owns browser lifecycle, profiles, and permissions.
//
// P4-001 / F-REL-003: never broadcast first-response to all clients. Target only
// trusted backend bridge connections and bind results to requestId + allowed
// responder connIds so multi-window/late/wrong-source replies cannot win the race.
import { randomUUID } from "node:crypto";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
} from "../../../packages/gateway-protocol/src/client-info.js";
import type {
  GatewayClient,
  GatewayRequestHandlerOptions,
  GatewayRequestHandlers,
} from "./types.js";

type PendingAgentBrowserInvoke = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Connections allowed to answer this request (Electron/backend bridges). */
  allowedConnIds: ReadonlySet<string>;
  /** Session key/id from payload when present (extra binding surface). */
  sessionKey?: string;
  /** Originating gateway connection that requested the invoke. */
  originConnId?: string;
  /** First accepted responder connId; further replies are rejected. */
  acceptedResponderConnId?: string;
  createdAtMs: number;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const pendingInvokes = new Map<string, PendingAgentBrowserInvoke>();

function normalizeTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Math.trunc(value)));
}

function readAction(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readErrorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "agent browser invoke failed";
}

function readSessionKey(payload: Record<string, unknown>): string | undefined {
  for (const key of ["sessionKey", "sessionId"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  const session = payload.session;
  if (session && typeof session === "object" && !Array.isArray(session)) {
    const id = (session as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

/** True when a client is a trusted Electron/backend Agent Browser bridge. */
export function isAgentBrowserBridgeClient(client: GatewayClient | null | undefined): boolean {
  if (!client?.connect?.client) return false;
  const info = client.connect.client;
  const mode = typeof info.mode === "string" ? info.mode.trim().toLowerCase() : "";
  const id = typeof info.id === "string" ? info.id.trim().toLowerCase() : "";
  if (mode === GATEWAY_CLIENT_MODES.BACKEND) return true;
  if (id === GATEWAY_CLIENT_IDS.GATEWAY_CLIENT) return true;
  if (
    id === GATEWAY_CLIENT_IDS.MACOS_APP ||
    id === GATEWAY_CLIENT_IDS.IOS_APP ||
    id === GATEWAY_CLIENT_IDS.ANDROID_APP
  ) {
    return true;
  }
  return false;
}

/** Resolve bridge connection ids from an approval-client enumerator (or empty). */
export function resolveAgentBrowserBridgeConnIds(
  getApprovalClientConnIds: GatewayRequestHandlerOptions["context"]["getApprovalClientConnIds"],
  excludeConnId?: string,
): Set<string> {
  if (!getApprovalClientConnIds) {
    return new Set();
  }
  return new Set(
    getApprovalClientConnIds({
      excludeConnId,
      filter: (client) => isAgentBrowserBridgeClient(client),
    }),
  );
}

export type AgentBrowserResultClaim =
  | { ok: true; pending: PendingAgentBrowserInvoke }
  | { ok: false; reason: "unknown_request" | "wrong_source" | "duplicate" | "session_mismatch" };

/**
 * Claim a pending invoke for a responder. First valid responder wins; wrong-source,
 * session mismatch, and late/duplicate replies are rejected.
 */
export function claimAgentBrowserResult(params: {
  requestId: string;
  responderConnId?: string;
  sessionKey?: string;
}): AgentBrowserResultClaim {
  const pending = pendingInvokes.get(params.requestId);
  if (!pending) {
    return { ok: false, reason: "unknown_request" };
  }

  const responder = (params.responderConnId ?? "").trim();
  if (!responder || !pending.allowedConnIds.has(responder)) {
    return { ok: false, reason: "wrong_source" };
  }

  if (pending.sessionKey && params.sessionKey && pending.sessionKey !== params.sessionKey) {
    return { ok: false, reason: "session_mismatch" };
  }

  if (pending.acceptedResponderConnId) {
    return { ok: false, reason: "duplicate" };
  }

  pending.acceptedResponderConnId = responder;
  return { ok: true, pending };
}

function resolvePendingResult(params: {
  requestId: string;
  ok: boolean;
  payload?: unknown;
  error?: unknown;
  responderConnId?: string;
  sessionKey?: string;
}): { resolved: boolean; reason?: "unknown_request" | "wrong_source" | "duplicate" | "session_mismatch" } {
  const claim = claimAgentBrowserResult({
    requestId: params.requestId,
    responderConnId: params.responderConnId,
    sessionKey: params.sessionKey,
  });
  if (!claim.ok) {
    return { resolved: false, reason: claim.reason };
  }

  const pending = claim.pending;
  clearTimeout(pending.timer);
  pendingInvokes.delete(params.requestId);
  if (params.ok) {
    pending.resolve(params.payload);
  } else {
    pending.reject(new Error(readErrorMessage(params.error)));
  }
  return { resolved: true };
}

export const agentBrowserHandlers: GatewayRequestHandlers = {
  "agentBrowser.invoke": async ({ params, respond, context, client }) => {
    const action = readAction(params.action);
    if (!action) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "action required"));
      return;
    }
    const payload = readPayload(params.payload);
    const timeoutMs = normalizeTimeoutMs(params.timeoutMs ?? payload.timeoutMs);
    const requestId = randomUUID();
    const sessionKey = readSessionKey(payload);
    const originConnId = client?.connId;

    const allowedConnIds = resolveAgentBrowserBridgeConnIds(
      context.getApprovalClientConnIds,
      originConnId,
    );

    if (allowedConnIds.size === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "no agent browser bridge connected", {
          details: { requestId, action },
        }),
      );
      return;
    }

    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingInvokes.delete(requestId);
        reject(new Error("agent browser bridge timed out"));
      }, timeoutMs);
      pendingInvokes.set(requestId, {
        resolve,
        reject,
        timer,
        allowedConnIds,
        sessionKey,
        originConnId,
        createdAtMs: Date.now(),
      });
    });

    const eventPayload = {
      requestId,
      action,
      payload,
      timeoutMs,
      originConnId,
      sessionKey,
      allowedConnIds: [...allowedConnIds],
    };

    context.broadcastToConnIds(
      "agentBrowser.invoke.request",
      eventPayload,
      allowedConnIds,
      { dropIfSlow: false },
    );

    try {
      respond(true, await result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          error instanceof Error ? error.message : String(error),
          { details: { requestId, action } },
        ),
      );
    }
  },

  "agentBrowser.invoke.result": ({ params, respond, client }) => {
    const requestId = typeof params.requestId === "string" ? params.requestId.trim() : "";
    if (!requestId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "requestId required"));
      return;
    }

    const ok = params.ok === true;
    const sessionKey =
      typeof params.sessionKey === "string" && params.sessionKey.trim()
        ? params.sessionKey.trim()
        : readSessionKey(readPayload(params.payload));

    const { resolved, reason } = resolvePendingResult({
      requestId,
      ok,
      payload: params.payload,
      error: params.error,
      responderConnId: client?.connId,
      sessionKey,
    });

    if (!resolved) {
      respond(
        true,
        {
          ok: false,
          ignored: true,
          reason: reason ?? "unknown_request",
        },
        undefined,
      );
      return;
    }

    respond(true, { ok: true, ignored: false }, undefined);
  },
};

export const __testing = {
  pendingInvokes,
  resolvePendingResult,
  claimAgentBrowserResult,
  isAgentBrowserBridgeClient,
  resolveAgentBrowserBridgeConnIds,
  clearPendingInvokes: () => {
    for (const pending of pendingInvokes.values()) {
      clearTimeout(pending.timer);
    }
    pendingInvokes.clear();
  },
};