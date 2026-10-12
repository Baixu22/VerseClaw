/**
 * OpenAI-family outbound prompt-cache payload fields.
 *
 * The runtime derives a per-session prompt-cache routing key and a cache-retention
 * preference and threads both through `StreamOptions`, but no write point forwarded
 * them to an OpenAI-family endpoint:
 *
 *   - `gateway/server-methods/chat.ts` / `cron/isolated-agent/run-executor.ts`
 *     derive `promptCacheKey`;
 *   - `embedded-agent-runner/extra-params.ts` resolves `cacheRetention`;
 *   - `openai-responses-payload-policy.ts` only ever *deleted* `prompt_cache_key`.
 *
 * This module is the single write point, consumed by every OpenAI-family payload
 * builder through `finalizeOpenAIProviderParams`. It decides from the shared
 * endpoint capability resolution rather than re-deriving endpoint classes, and it
 * fails closed: a field is emitted only when the route is known to accept it.
 *
 * Deliberately not implemented: the GPT-5.6-and-later `prompt_cache_options` shape
 * (which carries a `ttl` instead of `prompt_cache_retention`). Emitting it requires a
 * model-generation signal this runtime does not yet have, and a wrong lifetime field
 * is a provider 400 while a missing one is only a lost optimization.
 */
import type { Model, SimpleStreamOptions } from "../llm/types.js";
import { resolveProviderRequestCapabilities } from "./provider-attribution.js";

/** Lifetime value accepted by the `prompt_cache_retention` field. */
const OPENAI_LONG_RETENTION = "24h";

/** Outbound payload fields this module owns. */
export type OpenAIPromptCachePayloadFields = {
  prompt_cache_key?: string;
  prompt_cache_retention?: typeof OPENAI_LONG_RETENTION;
};

function readModelCompat(model: Model): unknown {
  return (model as { compat?: unknown }).compat;
}

/** Resolves the prompt-cache fields allowed for this model route and options. */
export function resolveOpenAIPromptCachePayloadFields(params: {
  model: Model;
  options?: SimpleStreamOptions;
}): OpenAIPromptCachePayloadFields {
  const compat = readModelCompat(params.model);
  const capabilities = resolveProviderRequestCapabilities({
    provider: params.model.provider,
    api: params.model.api,
    baseUrl: params.model.baseUrl,
    capability: "llm",
    transport: "stream",
    compat,
  });

  const fields: OpenAIPromptCachePayloadFields = {};

  // One decision for the whole route. The capabilities record already carries the cache
  // allowances resolved by the same descriptor, which is what keeps this write point and
  // the Responses strip policy from disagreeing (see #48155 and the
  // upstream-protocol-capabilities header).
  //
  // `usesKnownNativeOpenAIEndpoint` (not the broader `isKnownNativeEndpoint`) is the trust
  // signal: the wider set includes third-party routes such as OpenRouter, and the compat
  // contract is "default false for third-party completions providers".
  const cacheFields = capabilities.promptCacheFields;

  const promptCacheKey = params.options?.promptCacheKey?.trim();
  if (promptCacheKey && cacheFields.allowsRoutingKey) {
    fields.prompt_cache_key = promptCacheKey;
  }

  // `cacheRetention: "short"` is the provider default and must not be spelled out;
  // `"long"` emits the 24h lifetime field (the OpenAI counterpart of the
  // Anthropic-side `cache_control.ttl: "1h"` mapping), and only where the descriptor
  // allows the retention field.
  //
  // `prompt_cache_options` (the GPT-5.6+ explicit-mode shape) stays unemitted:
  // `allowsExplicitModeOptions` is hard-false because there is no model-generation signal
  // at this seam, and a wrong lifetime field is a provider 400 while a missing one is only
  // a lost optimization. Tracked as a follow-up once a generation signal exists.
  if (params.options?.cacheRetention === "long" && cacheFields.allowsRetention) {
    fields.prompt_cache_retention = OPENAI_LONG_RETENTION;
  }

  return fields;
}

/** Copies resolved fields onto an outgoing payload without overriding explicit values. */
export function applyOpenAIPromptCachePayloadFields(
  payloadObj: Record<string, unknown>,
  fields: OpenAIPromptCachePayloadFields,
): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && payloadObj[key] === undefined) {
      payloadObj[key] = value;
    }
  }
}
