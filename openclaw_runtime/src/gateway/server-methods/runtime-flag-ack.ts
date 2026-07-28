// FP-P0-04: gateway method that lets the Electron control plane read the
// acknowledgement from the *child* runtime, so "applied" can only be reached
// after a real gateway child reported its own effective flags.
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { buildRuntimeFlagAck } from "../../context-engine/runtime-flag-ack.js";
import type { GatewayRequestHandlers } from "./types.js";

function normalizeRequestedFlags(params: unknown): Record<string, boolean> | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const raw = (params as { requestedFlags?: unknown }).requestedFlags;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Gateway handler returning this child's runtime flag acknowledgement. */
export const runtimeFlagAckHandlers: GatewayRequestHandlers = {
  "runtime.flags.ack": async ({ params, respond, context }) => {
    try {
      const requestedFlags = normalizeRequestedFlags(params);
      const ack = buildRuntimeFlagAck({
        cfg: context.getRuntimeConfig(),
        ...(requestedFlags ? { requestedFlags } : {}),
      });
      respond(true, ack, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          err instanceof Error ? err.message : "runtime.flags.ack failed",
        ),
      );
    }
  },
};
