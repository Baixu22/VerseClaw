/**
 * Anthropic stream wrappers. They add beta headers, service tier/fast-mode
 * payload fields, server-side compaction, and thinking-prefill cleanup around
 * provider stream functions.
 */
import type { StreamFn } from "openclaw/plugin-sdk/agent-core";
import { streamSimple } from "openclaw/plugin-sdk/llm";
import type { ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";
import {
  applyAnthropicPayloadPolicyToParams,
  composeProviderStreamWrappers,
  createAnthropicThinkingPrefillPayloadWrapper,
  resolveAnthropicPayloadPolicy,
  stripTrailingAnthropicAssistantPrefillWhenThinking,
  streamWithPayloadPatch,
} from "openclaw/plugin-sdk/provider-stream-shared";
import { createSubsystemLogger } from "openclaw/plugin-sdk/runtime-env";
import {
  normalizeFastMode,
  normalizeLowercaseStringOrEmpty,
  readStringValue,
} from "openclaw/plugin-sdk/string-coerce-runtime";

const log = createSubsystemLogger("anthropic-stream");

const ANTHROPIC_CONTEXT_1M_BETA_LEGACY = "context-1m-2025-08-07";
const ANTHROPIC_GA_1M_MODEL_PREFIXES = [
  "claude-opus-4-8",
  "claude-opus-4.8",
  "claude-opus-4-6",
  "claude-opus-4.6",
  "claude-opus-4-7",
  "claude-opus-4.7",
  "claude-sonnet-4-6",
  "claude-sonnet-4.6",
  "claude-sonnet-5",
  "claude-fable-5",
] as const;
const OPENCLAW_DEFAULT_ANTHROPIC_BETAS = [
  "fine-grained-tool-streaming-2025-05-14",
  "interleaved-thinking-2025-05-14",
] as const;
const OPENCLAW_OAUTH_ANTHROPIC_BETAS = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  ...OPENCLAW_DEFAULT_ANTHROPIC_BETAS,
] as const;

/** Beta header enabling server-side compaction on the Anthropic Messages API. */
const ANTHROPIC_SERVER_COMPACTION_BETA = "compact-2026-01-12";
const DEFAULT_ANTHROPIC_SERVER_COMPACT_THRESHOLD = 200_000;

function resolvePositiveIntegerParam(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

/** Resolve whether server-side compaction applies for this Anthropic request.
 *  Default-on for the official Anthropic provider; other Anthropic-family
 *  backends opt in explicitly via extraParams.anthropicServerCompaction. */
export function resolveAnthropicServerCompaction(
  provider: string | undefined,
  extraParams: Record<string, unknown> | undefined,
): boolean {
  const configured = extraParams?.anthropicServerCompaction;
  if (configured === true) {
    return true;
  }
  if (configured === false) {
    return false;
  }
  return normalizeLowercaseStringOrEmpty(provider) === "anthropic";
}

/** Resolve the server compaction threshold (tokens) for this Anthropic request. */
export function resolveAnthropicServerCompactionThreshold(
  extraParams: Record<string, unknown> | undefined,
): number {
  return (
    resolvePositiveIntegerParam(extraParams?.anthropicCompactThreshold) ??
    DEFAULT_ANTHROPIC_SERVER_COMPACT_THRESHOLD
  );
}

/** Wrap a stream function with server-side compaction: context_management
 *  payload plus the compact-2026-01-12 beta header. */
export function createAnthropicServerCompactionWrapper(
  baseStreamFn: StreamFn | undefined,
  threshold: number,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    return streamWithPayloadPatch(
      underlying,
      model,
      context,
      {
        ...options,
        headers: mergeAnthropicBetaHeader(options?.headers, [ANTHROPIC_SERVER_COMPACTION_BETA]),
      },
      (payloadObj) => {
        if (payloadObj.context_management === undefined) {
          payloadObj.context_management = [
            { type: "compaction", compact_threshold: threshold },
          ];
        }
      },
    );
  };
}

type AnthropicServiceTier = "auto" | "standard_only";

function isAnthropic1MModel(modelId: string): boolean {
  const normalized = normalizeLowercaseStringOrEmpty(modelId);
  return ANTHROPIC_GA_1M_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function parseHeaderList(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeAnthropicBetaHeader(
  headers: Record<string, string> | undefined,
  betas: string[],
): Record<string, string> {
  const merged = { ...headers };
  const existingKey = Object.keys(merged).find(
    (key) => normalizeLowercaseStringOrEmpty(key) === "anthropic-beta",
  );
  const existing = existingKey ? parseHeaderList(merged[existingKey]) : [];
  const values = Array.from(new Set([...existing, ...betas]));
  const key = existingKey ?? "anthropic-beta";
  merged[key] = values.join(",");
  return merged;
}

function isAnthropicOAuthApiKey(apiKey: unknown): boolean {
  return typeof apiKey === "string" && apiKey.includes("sk-ant-oat");
}

function resolveAnthropicFastServiceTier(enabled: boolean): AnthropicServiceTier {
  return enabled ? "auto" : "standard_only";
}

function normalizeAnthropicServiceTier(value: unknown): AnthropicServiceTier | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = normalizeLowercaseStringOrEmpty(value);
  if (normalized === "auto" || normalized === "standard_only") {
    return normalized;
  }
  return undefined;
}

function hasConfiguredAnthropicBeta(extraParams: Record<string, unknown> | undefined): boolean {
  const configured = extraParams?.anthropicBeta;
  if (typeof configured === "string") {
    return configured.trim().length > 0;
  }
  if (!Array.isArray(configured)) {
    return false;
  }
  return configured.some((beta) => typeof beta === "string" && beta.trim().length > 0);
}

/** Resolve configured Anthropic beta headers from extra model params. */
export function resolveAnthropicBetas(
  extraParams: Record<string, unknown> | undefined,
  _modelId: string,
): string[] | undefined {
  const betas = new Set<string>();
  const configured = extraParams?.anthropicBeta;
  if (typeof configured === "string" && configured.trim()) {
    for (const beta of parseHeaderList(configured)) {
      betas.add(beta);
    }
  } else if (Array.isArray(configured)) {
    for (const beta of configured) {
      if (typeof beta === "string" && beta.trim()) {
        for (const betaValue of parseHeaderList(beta)) {
          betas.add(betaValue);
        }
      }
    }
  }

  // Newer Claude 4.x 1M context is GA. Keep context1m as a context-sizing
  // opt-in, but do not send the retired beta even if it remains in older config.
  betas.delete(ANTHROPIC_CONTEXT_1M_BETA_LEGACY);

  return betas.size > 0 ? [...betas] : undefined;
}

/** Wrap a stream function to merge OpenClaw and configured Anthropic beta headers. */
export function createAnthropicBetaHeadersWrapper(
  baseStreamFn: StreamFn | undefined,
  betas: string[],
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    const isOauth = isAnthropicOAuthApiKey(options?.apiKey);
    const effectiveBetas = betas.filter((beta) => beta !== ANTHROPIC_CONTEXT_1M_BETA_LEGACY);

    const openClawBetas = isOauth
      ? (OPENCLAW_OAUTH_ANTHROPIC_BETAS as readonly string[])
      : (OPENCLAW_DEFAULT_ANTHROPIC_BETAS as readonly string[]);
    const allBetas = [...new Set([...openClawBetas, ...effectiveBetas])];
    return underlying(model, context, {
      ...options,
      headers: mergeAnthropicBetaHeader(options?.headers, allBetas),
    });
  };
}

/** Wrap a stream function with the Anthropic fast-mode service tier. */
export function createAnthropicFastModeWrapper(
  baseStreamFn: StreamFn | undefined,
  enabled: boolean,
): StreamFn {
  return createAnthropicServiceTierWrapper(baseStreamFn, resolveAnthropicFastServiceTier(enabled));
}

/** Wrap a stream function with an explicit Anthropic service tier when allowed. */
export function createAnthropicServiceTierWrapper(
  baseStreamFn: StreamFn | undefined,
  serviceTier: AnthropicServiceTier,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    if (isAnthropicOAuthApiKey(options?.apiKey)) {
      return underlying(model, context, options);
    }

    const payloadPolicy = resolveAnthropicPayloadPolicy({
      provider: readStringValue(model.provider),
      api: readStringValue(model.api),
      baseUrl: readStringValue(model.baseUrl),
      serviceTier,
    });
    if (!payloadPolicy.allowsServiceTier) {
      return underlying(model, context, options);
    }

    return streamWithPayloadPatch(underlying, model, context, options, (payloadObj) =>
      applyAnthropicPayloadPolicyToParams(payloadObj, payloadPolicy),
    );
  };
}

/** Wrap a stream function to strip trailing assistant prefill before thinking requests. */
export function createAnthropicThinkingPrefillWrapper(
  baseStreamFn: StreamFn | undefined,
): StreamFn {
  return createAnthropicThinkingPrefillPayloadWrapper(baseStreamFn, (stripped) => {
    log.warn(
      `removed ${stripped} trailing assistant prefill message${stripped === 1 ? "" : "s"} because Anthropic extended thinking requires conversations to end with a user turn`,
    );
  });
}

/** Resolve Anthropic fast-mode setting from model extra params. */
export function resolveAnthropicFastMode(
  extraParams: Record<string, unknown> | undefined,
): boolean | undefined {
  return normalizeFastMode(
    (extraParams?.fastMode ?? extraParams?.fast_mode) as string | boolean | null | undefined,
  );
}

/** Resolve Anthropic service tier from model extra params. */
export function resolveAnthropicServiceTier(
  extraParams: Record<string, unknown> | undefined,
): AnthropicServiceTier | undefined {
  const raw = extraParams?.serviceTier ?? extraParams?.service_tier;
  const normalized = normalizeAnthropicServiceTier(raw);
  if (raw !== undefined && normalized === undefined) {
    const rawSummary = typeof raw === "string" ? raw : typeof raw;
    log.warn(`ignoring invalid Anthropic service tier param: ${rawSummary}`);
  }
  return normalized;
}

/** Compose all Anthropic stream wrappers for one provider/model context. */
export function wrapAnthropicProviderStream(
  ctx: ProviderWrapStreamFnContext,
): StreamFn | undefined {
  const anthropicBetas = resolveAnthropicBetas(ctx.extraParams, ctx.modelId);
  const needsAnthropicBetaWrapper =
    anthropicBetas !== undefined ||
    hasConfiguredAnthropicBeta(ctx.extraParams) ||
    (ctx.extraParams?.context1m === true && isAnthropic1MModel(ctx.modelId));
  const serviceTier = resolveAnthropicServiceTier(ctx.extraParams);
  const fastMode = resolveAnthropicFastMode(ctx.extraParams);
  const serverCompaction = resolveAnthropicServerCompaction(ctx.provider, ctx.extraParams);
  const serverCompactionThreshold = resolveAnthropicServerCompactionThreshold(ctx.extraParams);
  return composeProviderStreamWrappers(
    ctx.streamFn,
    needsAnthropicBetaWrapper
      ? (streamFn) => createAnthropicBetaHeadersWrapper(streamFn, anthropicBetas ?? [])
      : undefined,
    serverCompaction
      ? (streamFn) => createAnthropicServerCompactionWrapper(streamFn, serverCompactionThreshold)
      : undefined,
    serviceTier
      ? (streamFn) => createAnthropicServiceTierWrapper(streamFn, serviceTier)
      : undefined,
    fastMode !== undefined
      ? (streamFn) => createAnthropicFastModeWrapper(streamFn, fastMode)
      : undefined,
    (streamFn) => createAnthropicThinkingPrefillWrapper(streamFn),
  );
}

/** Test-only hooks for Anthropic stream wrapper behavior. */
export const testing = {
  log,
  stripTrailingAssistantPrefillWhenThinking: stripTrailingAnthropicAssistantPrefillWhenThinking,
};
export { testing as __testing };
