// Stream payload utilities normalize provider stream payload fields for wrappers.
import { recordProviderPayloadTrace } from "../../../agents/provider-payload-trace.js";
import type { StreamFn } from "../../../agents/runtime/index.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value) && typeof (value as { then?: unknown }).then === "function";
}

function mergePayloadReplacement(payload: unknown, replacement: unknown): unknown {
  if (replacement === undefined) {
    return payload;
  }
  if (isRecord(payload) && isRecord(replacement)) {
    return { ...payload, ...replacement };
  }
  return replacement;
}

function recordPatchedProviderPayload(
  options: Parameters<StreamFn>[2],
  payload: unknown,
  source: string,
): void {
  recordProviderPayloadTrace(options as Record<PropertyKey, unknown> | undefined, payload, source);
}

/** Wraps a stream function and lets callers mutate outgoing provider payload objects. */
export function streamWithPayloadPatch(
  underlying: StreamFn,
  model: Parameters<StreamFn>[0],
  context: Parameters<StreamFn>[1],
  options: Parameters<StreamFn>[2],
  patchPayload: (payload: Record<string, unknown>) => void,
): ReturnType<StreamFn> {
  const originalOnPayload = options?.onPayload;
  return underlying(model, context, {
    ...options,
    onPayload: (payload) => {
      // Payload hooks receive mutable provider request objects before the underlying sender uses them.
      if (payload && typeof payload === "object") {
        patchPayload(payload as Record<string, unknown>);
      }
      const result = originalOnPayload?.(payload, model);
      if (isPromiseLike(result)) {
        return result.then((replacement) => {
          recordPatchedProviderPayload(
            options,
            mergePayloadReplacement(payload, replacement),
            "stream-payload-patch",
          );
          return replacement;
        });
      }
      recordPatchedProviderPayload(
        options,
        mergePayloadReplacement(payload, result),
        "stream-payload-patch",
      );
      return result;
    },
  });
}
