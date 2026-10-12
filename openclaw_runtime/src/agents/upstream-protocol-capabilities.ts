/**
 * Upstream protocol capability descriptor.
 *
 * One module decides which wire protocol an api id denotes and what that protocol's
 * prompt-cache fields can carry. Before this file the same knowledge existed as
 * independent enumerations:
 *
 *   - `provider-attribution.ts` owned one `OPENAI_RESPONSES_APIS` set;
 *   - `openai-responses-payload-policy.ts` owned a second, different one;
 *   - `embedded-agent-runner/prompt-cache-retention.ts` owned a third
 *     (`OPENAI_FAMILY_CACHE_APIS`).
 *
 * The spellings differ for the same session because `provider-transport-stream.ts`
 * rewrites a public api id to the in-tree transport id (`openai-responses` ->
 * `openclaw-openai-responses-transport`) before the runtime transport runs, while the
 * provider wrapper still sees the public id. A descriptor therefore classifies both
 * spellings, and the cache-field decision is computed once from the descriptor so the
 * emit point (`openai-prompt-cache-payload.ts`) and the strip point
 * (`openai-responses-payload-policy.ts`) cannot disagree about the same route.
 *
 * See harness/specs/rules/outbound-protocol-payload-consistency.md.
 */
import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";

/** Wire protocol an api id builds its payload with. */
export type UpstreamProtocolKind =
  | "openai-responses"
  | "openai-completions"
  | "anthropic-messages"
  | "google-generative-ai"
  | "unknown";

/**
 * Api ids that build an OpenAI Responses payload.
 *
 * Both spellings of each route are listed: the public id a configured model carries and
 * the in-tree transport id `provider-transport-stream.ts` aliases it to. A route that
 * appears in only one spelling is the defect this module exists to prevent.
 */
export const OPENAI_RESPONSES_API_IDS: ReadonlySet<string> = new Set([
  "openai-responses",
  "azure-openai-responses",
  "openai-chatgpt-responses",
  "openclaw-openai-responses-transport",
  "openclaw-azure-openai-responses-transport",
]);

/** Api ids that build an OpenAI Chat Completions payload. */
export const OPENAI_COMPLETIONS_API_IDS: ReadonlySet<string> = new Set([
  "openai-completions",
  "openclaw-openai-completions-transport",
]);

/** Providers whose Responses routes accept the OpenAI Responses payload fields. */
export const OPENAI_RESPONSES_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "openai",
  "azure-openai",
  "azure-openai-responses",
]);

/** Normalizes an api id for set membership (case-insensitive, trimmed). */
export function normalizeUpstreamApiId(api: unknown): string | undefined {
  return normalizeOptionalLowercaseString(typeof api === "string" ? api : undefined);
}

/** Resolves the wire protocol an api id builds. */
export function resolveUpstreamProtocolKind(api: unknown): UpstreamProtocolKind {
  const normalized = normalizeUpstreamApiId(api);
  if (normalized === undefined) {
    return "unknown";
  }
  if (OPENAI_RESPONSES_API_IDS.has(normalized)) {
    return "openai-responses";
  }
  if (OPENAI_COMPLETIONS_API_IDS.has(normalized)) {
    return "openai-completions";
  }
  if (normalized === "anthropic-messages" || normalized === "openclaw-anthropic-messages-transport") {
    return "anthropic-messages";
  }
  if (
    normalized === "google-generative-ai" ||
    normalized === "openclaw-google-generative-ai-transport"
  ) {
    return "google-generative-ai";
  }
  return "unknown";
}

/** Whether the api id builds an OpenAI Responses payload (either spelling). */
export function isOpenAIResponsesApi(api: unknown): boolean {
  const normalized = normalizeUpstreamApiId(api);
  return normalized !== undefined && OPENAI_RESPONSES_API_IDS.has(normalized);
}

/** Whether the api id belongs to the OpenAI family the transports own. */
export function isOpenAIFamilyApi(api: unknown): boolean {
  const kind = resolveUpstreamProtocolKind(api);
  return kind === "openai-responses" || kind === "openai-completions";
}

/** Prompt-cache fields one resolved route may carry. */
export type UpstreamPromptCacheFields = {
  /** May the outbound payload carry the routing key field (`prompt_cache_key`). */
  allowsRoutingKey: boolean;
  /** May the outbound payload carry the retention field (`prompt_cache_retention`). */
  allowsRetention: boolean;
  /**
   * May the payload carry the model-generation-gated explicit-mode shape
   * (`prompt_cache_options`). Always false today: no generation signal exists, and the
   * rule is to fail closed rather than guess a field shape.
   */
  allowsExplicitModeOptions: boolean;
  /** Must the Responses cache fields be deleted from a payload that already carries them. */
  stripResponsesCacheFields: boolean;
};

/**
 * Compat-driven capability facts shared by every cache decision point.
 *
 * `compat.supportsPromptCacheKey` is the operator's explicit statement about the route:
 * `true` means "forward the fields even on a route we do not recognize", `false` means
 * "this route rejects them". Absent means the endpoint trust signals decide.
 */
type PromptCacheCompatFacts = {
  supportsPromptCacheKey?: boolean;
  supportsLongCacheRetention?: boolean;
};

function readCompatFlag(compat: unknown, key: keyof PromptCacheCompatFacts): boolean | undefined {
  if (!compat || typeof compat !== "object") {
    return undefined;
  }
  const value = (compat as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Resolves a route's prompt-cache field allowances.
 *
 * The single precedence rule, in order:
 *
 *   1. an explicit `supportsPromptCacheKey` decides for both fields — this is the
 *      operator's override, and #48155 (Volcano Engine DeepSeek) depends on `false`
 *      forcing the strip. `prompt_cache_retention` is one of the fields the strip policy
 *      deletes, so an explicit `false` refuses it even when `supportsLongCacheRetention`
 *      is set: shipping a field to a route that declared it rejects cache fields is a
 *      provider 400, while omitting it is only a lost optimization;
 *   2. otherwise the Responses strip policy is authoritative, and a strip target never
 *      receives the fields;
 *   3. otherwise `supportsLongCacheRetention` decides retention on its own, because it is
 *      documented as defaulting to true and an explicit `true` also covers forwarding
 *      proxies that accept the longer lifetime while still refusing the routing key.
 *
 * Nuance kept from the original write point: on a strip route (unknown proxy-like
 * endpoint) an explicit `supportsLongCacheRetention: true` still wins for the retention
 * field, because it is the operator stating that this exact route accepts a cache field,
 * while the strip exists as a default for routes nobody described. The routing key keeps
 * its own gate, so such a route still gets no key.
 *
 * `stripResponsesCacheFields` is reported for every Responses route so a payload built
 * before this resolution can be cleaned up rather than shipped.
 */
export function resolveUpstreamPromptCacheFields(input: {
  api: unknown;
  compat?: unknown;
  /** Endpoint trust facts from the endpoint resolver, not re-derived here. */
  usesKnownNativeOpenAIEndpoint: boolean;
  usesExplicitProxyLikeEndpoint: boolean;
}): UpstreamPromptCacheFields {
  const flags: PromptCacheCompatFacts = {
    supportsPromptCacheKey: readCompatFlag(input.compat, "supportsPromptCacheKey"),
    supportsLongCacheRetention: readCompatFlag(input.compat, "supportsLongCacheRetention"),
  };
  const responsesProtocol = isOpenAIResponsesApi(input.api);

  // Step 1+2: the Responses strip decision, computed once.
  const stripResponsesCacheFields =
    flags.supportsPromptCacheKey === true
      ? false
      : flags.supportsPromptCacheKey === false
        ? responsesProtocol
        : responsesProtocol && input.usesExplicitProxyLikeEndpoint;

  const routingKeyAllowedByRoute =
    flags.supportsPromptCacheKey === true ||
    (flags.supportsPromptCacheKey !== false &&
      input.usesKnownNativeOpenAIEndpoint &&
      !stripResponsesCacheFields);

  const retentionAllowedByRoute =
    flags.supportsPromptCacheKey === true
      ? true
      : flags.supportsPromptCacheKey === false
        ? false
        : flags.supportsLongCacheRetention === true
          ? true
          : flags.supportsLongCacheRetention === false
            ? false
            : input.usesKnownNativeOpenAIEndpoint && !stripResponsesCacheFields;

  return {
    allowsRoutingKey: routingKeyAllowedByRoute,
    allowsRetention: retentionAllowedByRoute,
    allowsExplicitModeOptions: false,
    stripResponsesCacheFields,
  };
}
