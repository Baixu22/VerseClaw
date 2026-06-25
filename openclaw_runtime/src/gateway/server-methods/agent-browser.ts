// Agent Browser bridge methods relay runtime tool calls to the Electron Main
// process, which owns browser lifecycle, profiles, and permissions.
import { randomUUID } from "node:crypto";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import type { GatewayRequestHandlers } from "./types.js";

type PendingAgentBrowserInvoke = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
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

function resolvePendingResult(params: {
  requestId: string;
  ok: boolean;
  payload?: unknown;
  error?: unknown;
}): boolean {
  const pending = pendingInvokes.get(params.requestId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingInvokes.delete(params.requestId);
  if (params.ok) {
    pending.resolve(params.payload);
    return true;
  }
  pending.reject(new Error(readErrorMessage(params.error)));
  return true;
}

export const agentBrowserHandlers: GatewayRequestHandlers = {
  "agentBrowser.invoke": async ({ params, respond, context }) => {
    const action = readAction(params.action);
    if (!action) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "action required"));
      return;
    }
    const payload = readPayload(params.payload);
    const timeoutMs = normalizeTimeoutMs(params.timeoutMs ?? payload.timeoutMs);
    const requestId = randomUUID();

    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingInvokes.delete(requestId);
        reject(new Error("agent browser bridge timed out"));
      }, timeoutMs);
      pendingInvokes.set(requestId, { resolve, reject, timer });
    });

    context.broadcast(
      "agentBrowser.invoke.request",
      {
        requestId,
        action,
        payload,
        timeoutMs,
      },
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

  "agentBrowser.invoke.result": ({ params, respond }) => {
    const requestId = typeof params.requestId === "string" ? params.requestId.trim() : "";
    if (!requestId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "requestId required"));
      return;
    }
    const ok = params.ok === true;
    const resolved = resolvePendingResult({
      requestId,
      ok,
      payload: params.payload,
      error: params.error,
    });
    respond(true, { ok: true, ignored: !resolved }, undefined);
  },
};

export const __testing = {
  pendingInvokes,
  resolvePendingResult,
};
