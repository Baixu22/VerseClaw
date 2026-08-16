// Provider reasoning-effort capability matrix.
//
// Provider APIs do not share one effort vocabulary:
// - OpenAI Responses: none/minimal/low/medium/high/xhigh/max
// - Anthropic Messages: low/medium/high/xhigh/max (no minimal)
// - DeepSeek V4: low/high/max; medium and xhigh are accepted aliases that map to high
//
// This module is intentionally pure data + functions so intensity-policy and
// session reporting can share the same provider truth without importing
// provider plugins.

export type ProviderReasoningEffortId =
  | "off"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ProviderEffortCapability = {
  provider: string;
  /** Values accepted on the wire. Aliases may map to another accepted value. */
  acceptedEfforts: readonly ProviderReasoningEffortId[];
  /** Wire-level effort the provider actually applies for each accepted alias. */
  effectiveByRequested: Partial<Record<ProviderReasoningEffortId, ProviderReasoningEffortId>>;
  /** Default thinking level for the provider family. */
  defaultEffort: ProviderReasoningEffortId;
};

const BASE_OPENAI_EFFORTS: readonly ProviderReasoningEffortId[] = [
  "off",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const OPENAI_CAPABILITY: ProviderEffortCapability = {
  provider: "openai",
  acceptedEfforts: BASE_OPENAI_EFFORTS,
  effectiveByRequested: {
    off: "off",
    none: "none",
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  defaultEffort: "medium",
};

const ANTHROPIC_CAPABILITY: ProviderEffortCapability = {
  provider: "anthropic",
  acceptedEfforts: ["off", "low", "medium", "high", "xhigh", "max"],
  effectiveByRequested: {
    off: "off",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  defaultEffort: "high",
};

const DEEPSEEK_CAPABILITY: ProviderEffortCapability = {
  provider: "deepseek",
  // DeepSeek V4 documents low/high/max as native values. medium/xhigh are
  // accepted aliases for high; minimal is an app-level alias clamped to low
  // by the shared stream wrapper, so it is listed as accepted for UI/reporting.
  acceptedEfforts: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  effectiveByRequested: {
    off: "off",
    minimal: "low",
    low: "low",
    medium: "high",
    high: "high",
    xhigh: "high",
    max: "max",
  },
  defaultEffort: "high",
};

const UNKNOWN_CAPABILITY: ProviderEffortCapability = {
  provider: "unknown",
  acceptedEfforts: BASE_OPENAI_EFFORTS,
  effectiveByRequested: {
    off: "off",
    none: "none",
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  },
  defaultEffort: "medium",
};

function normalizeProvider(provider?: string | null): string {
  return (provider ?? "").trim().toLowerCase();
}

export function resolveProviderEffortCapability(
  provider?: string | null,
): ProviderEffortCapability {
  const normalized = normalizeProvider(provider);
  if (normalized === "openai" || normalized === "openai-compatible") {
    return OPENAI_CAPABILITY;
  }
  if (normalized === "anthropic" || normalized === "claude") {
    return ANTHROPIC_CAPABILITY;
  }
  if (normalized === "deepseek") {
    return DEEPSEEK_CAPABILITY;
  }
  return { ...UNKNOWN_CAPABILITY, provider: normalized || "unknown" };
}

function normalizeEffort(effort?: string | null): ProviderReasoningEffortId | undefined {
  const normalized = (effort ?? "").trim().toLowerCase();
  return BASE_OPENAI_EFFORTS.includes(normalized as ProviderReasoningEffortId)
    ? (normalized as ProviderReasoningEffortId)
    : undefined;
}

export type ResolvedProviderReasoningEffort = {
  requested: ProviderReasoningEffortId;
  effective: ProviderReasoningEffortId;
  accepted: boolean;
  /** True when provider semantics change the user-visible effort on the wire. */
  remapped: boolean;
};

export function resolveProviderReasoningEffort(params: {
  provider?: string | null;
  requested?: string | null;
}): ResolvedProviderReasoningEffort | undefined {
  const requested = normalizeEffort(params.requested);
  if (!requested) {
    return undefined;
  }
  const capability = resolveProviderEffortCapability(params.provider);
  const accepted = capability.acceptedEfforts.includes(requested);
  const effective = accepted
    ? (capability.effectiveByRequested[requested] ?? requested)
    : resolveFallbackEffort(capability, requested);
  return { requested, effective, accepted, remapped: effective !== requested };
}

function resolveFallbackEffort(
  capability: ProviderEffortCapability,
  requested: ProviderReasoningEffortId,
): ProviderReasoningEffortId {
  // Pick the closest accepted non-off effort at or below the requested rank.
  const ranks: Record<ProviderReasoningEffortId, number> = {
    off: 0,
    none: 0,
    minimal: 1,
    low: 2,
    medium: 3,
    high: 4,
    xhigh: 5,
    max: 6,
  };
  const requestedRank = ranks[requested];
  return (
    capability.acceptedEfforts
      .filter((effort) => effort !== "off" && effort !== "none" && ranks[effort] <= requestedRank)
      .toSorted((a, b) => ranks[b] - ranks[a])[0] ??
    capability.acceptedEfforts.find((effort) => effort !== "off" && effort !== "none") ??
    "off"
  );
}
