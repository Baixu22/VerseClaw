/**
 * Memory/COMPASS dual write/use gates + poison revoke (P3-003 / F-DATA-003, F-DATA-004).
 *
 * Write and use gates are independent: enabling one never implies the other.
 * Defaults are closed (off), matching COMPASS advanced flags and the Role Memory
 * "disabled until enabled" UI copy.
 *
 * Production wiring (TF-0110 / T-P0-1, P0 governance fix):
 * - Use gate: role-memory-context-provider.ts and role-spawn.ts call
 *   applyMemoryUseGateOverlay on the real injection paths. Gate enabled ->
 *   strict filter (secret / secret_adjacent / poison / tombstone cards are
 *   removed before any ContextPack bucket); gate disabled (the default) ->
 *   the legacy card set passes through unchanged, so default-off behavior is
 *   identical to pre-wiring by construction (P3-003 staged rollout).
 * - Write gate: memory-store.ts proposeMemoryCard consults
 *   evaluateMemoryWriteGate when the gate is explicitly configured (caller
 *   override or OPENCLAW_MEMORY_WRITE_GATE); unconfigured callers keep the
 *   legacy proposal flow (default behavior unchanged).
 * Sensitivity alignment (req-4, option b): secret_adjacent is banned by the
 * gate AND by the real paths whenever the use gate is consulted, so both
 * sides agree; with the gate disabled the legacy paths stay unchanged (AC-1).
 * simulateMemoryInjection models the gate-enabled contract directly.
 */
import {
  reviewMemoryProposal,
  type MemoryGatekeeperOptions,
} from "./gatekeeper.js";
import type {
  MemoryCard,
  MemoryGatekeeperDecision,
  MemoryProposal,
} from "./types.js";
import {
  DEFAULT_MEMORY_RUNTIME_CONFIG,
  type MemoryFeatureFlags,
  type MemoryRuntimeConfig,
} from "../runtime-core/memory-runtime-config.js";

export type MemoryDualGateConfig = {
  /**
   * Write gate. When consulted (explicit config or OPENCLAW_MEMORY_WRITE_GATE):
   * false rejects memory writes/proposes with an explicit reason; the
   * gatekeeper still runs when open. Default false. Unconfigured
   * proposeMemoryCard callers keep the legacy flow (TF-0110 wiring; P3-003
   * staged rollout), so the default behavior is unchanged.
   */
  writeEnabled: boolean;
  /**
   * Use gate. When enabled, applyMemoryUseGateOverlay removes secret /
   * secret_adjacent / poison / tombstone cards on the production injection
   * paths before any ContextPack bucket; when disabled (the default) the
   * legacy injection set passes through unchanged. simulateMemoryInjection
   * models the enabled contract (off there = nothing injectable). Default
   * false.
   */
  useEnabled: boolean;
};

export type MemoryDualGateKind = "write" | "use";

export type MemoryCutoverEvidence = {
  sampleSize: number;
  successRate: number;
  baselineP95LatencyMs: number;
  candidateP95LatencyMs: number;
  tokenOverheadRatio: number;
  safetyRegressions: number;
  evidenceRefs: string[];
  drivenBy: "agent";
};

export type MemoryCutoverThresholds = {
  minSampleSize: number;
  minSuccessRate: number;
  maxP95LatencyRatio: number;
  maxTokenOverheadRatio: number;
  maxSafetyRegressions: number;
};

export type MemoryCutoverDecision = {
  eligible: boolean;
  stage: "shadow" | "guarded-opt-in" | "product-cutover";
  reasons: string[];
  metrics: {
    sampleSize: number;
    successRate: number;
    p95LatencyRatio: number;
    tokenOverheadRatio: number;
    safetyRegressions: number;
  };
  /** The gate evaluator never mutates frozen product defaults. */
  defaultGateUnchanged: true;
};

export const DEFAULT_MEMORY_CUTOVER_THRESHOLDS: MemoryCutoverThresholds = {
  minSampleSize: 50,
  minSuccessRate: 0.9,
  maxP95LatencyRatio: 1.5,
  maxTokenOverheadRatio: 0.2,
  maxSafetyRegressions: 0,
};

export type MemoryDualGateDecision = {
  allowed: boolean;
  gate: MemoryDualGateKind;
  reason: string;
  reasonCode:
    | "write_enabled"
    | "write_disabled"
    | "use_enabled"
    | "use_disabled"
    | "poison_revoked"
    | "tombstone"
    | "secret_blocked"
    | "gatekeeper_reject"
    | "gatekeeper_accept"
    | "gatekeeper_review";
  /** Explicit marker that the other gate was not consulted. */
  independentOfOtherGate: true;
  otherGateEnabled?: boolean;
  gatekeeper?: MemoryGatekeeperDecision;
};

export const DEFAULT_MEMORY_DUAL_GATE_CONFIG: MemoryDualGateConfig = {
  writeEnabled: false,
  useEnabled: false,
};

/** UI claim keys that must remain consistent with default-off dual gates. */
export const MEMORY_DEFAULT_OFF_UI_CLAIMS = [
  "memoryDisabledTitle",
  "memoryDisabledDescription",
  "memoryDisabledBadge",
] as const;

export function resolveMemoryDualGateConfig(
  overrides: Partial<MemoryDualGateConfig> = {},
  runtime: MemoryRuntimeConfig = DEFAULT_MEMORY_RUNTIME_CONFIG,
): MemoryDualGateConfig {
  // COMPASS advanced retrieval/use remains default-off via feature flags.
  const compassUse =
    runtime.featureFlags.enablePreReplyRetrieval === true ||
    runtime.featureFlags.enableSessionStatePage === true;

  const envWrite = readEnvBool("OPENCLAW_MEMORY_WRITE_GATE");
  const envUse = readEnvBool("OPENCLAW_MEMORY_USE_GATE");
  const roleMemoryMasterOff = process.env.OPENCLAW_ROLE_MEMORY_ENABLED === "0";

  if (roleMemoryMasterOff) {
    // TF-0110 (T-P0-1, req-3): overrides must NOT be able to re-open either
    // gate while the role-memory master switch is off. Spread overrides first,
    // then pin both gates closed — the previous order let ...overrides win
    // over the pin (OPENCLAW_ROLE_MEMORY_ENABLED=0 + { useEnabled: true }
    // flipped the use gate open).
    return {
      ...overrides,
      writeEnabled: false,
      useEnabled: false,
    };
  }

  return {
    writeEnabled: envWrite ?? overrides.writeEnabled ?? DEFAULT_MEMORY_DUAL_GATE_CONFIG.writeEnabled,
    useEnabled:
      envUse ??
      overrides.useEnabled ??
      (compassUse ? true : DEFAULT_MEMORY_DUAL_GATE_CONFIG.useEnabled),
    ...overrides,
  };
}

function readEnvBool(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  return undefined;
}

/**
 * Write gate: closed unless writeEnabled. Gatekeeper still runs when open.
 * useEnabled is recorded only to prove independence — it never grants writes.
 */
export function evaluateMemoryWriteGate(input: {
  config: MemoryDualGateConfig;
  proposal: MemoryProposal;
  existing?: readonly MemoryCard[];
  options?: MemoryGatekeeperOptions;
}): MemoryDualGateDecision {
  if (!input.config.writeEnabled) {
    return {
      allowed: false,
      gate: "write",
      reason: "Memory write gate is closed (default off / P3-003).",
      reasonCode: "write_disabled",
      independentOfOtherGate: true,
      otherGateEnabled: input.config.useEnabled,
    };
  }

  const gatekeeper = reviewMemoryProposal(
    input.proposal,
    input.existing ?? [],
    input.options,
  );

  if (!gatekeeper.accepted) {
    return {
      allowed: false,
      gate: "write",
      reason: gatekeeper.reason ?? "Memory write rejected by gatekeeper.",
      reasonCode:
        /secret/i.test(gatekeeper.reason ?? "")
          ? "secret_blocked"
          : gatekeeper.action === "needs_review"
            ? "gatekeeper_review"
            : "gatekeeper_reject",
      independentOfOtherGate: true,
      otherGateEnabled: input.config.useEnabled,
      gatekeeper,
    };
  }

  return {
    allowed: true,
    gate: "write",
    reason: gatekeeper.reason ?? "Memory write gate open and gatekeeper accepted.",
    reasonCode: "gatekeeper_accept",
    independentOfOtherGate: true,
    otherGateEnabled: input.config.useEnabled,
    gatekeeper,
  };
}

/**
 * Use gate: closed unless useEnabled. Write gate state never opens use.
 * Poison-revoked / tombstone cards are never injectable.
 */
export function evaluateMemoryUseGate(input: {
  config: MemoryDualGateConfig;
  card: MemoryCard;
}): MemoryDualGateDecision {
  if (isPoisonRevokedCard(input.card) || input.card.status === "tombstone") {
    return {
      allowed: false,
      gate: "use",
      reason: "Poisoned or tombstoned memory cannot be injected into model context.",
      reasonCode: input.card.status === "tombstone" ? "tombstone" : "poison_revoked",
      independentOfOtherGate: true,
      otherGateEnabled: input.config.writeEnabled,
    };
  }

  if (!input.config.useEnabled) {
    return {
      allowed: false,
      gate: "use",
      reason: "Memory use gate is closed (default off / P3-003).",
      reasonCode: "use_disabled",
      independentOfOtherGate: true,
      otherGateEnabled: input.config.writeEnabled,
    };
  }

  if (input.card.sensitivity === "secret" || input.card.sensitivity === "secret_adjacent") {
    return {
      allowed: false,
      gate: "use",
      reason: "Secret-adjacent memory is blocked from model injection.",
      reasonCode: "secret_blocked",
      independentOfOtherGate: true,
      otherGateEnabled: input.config.writeEnabled,
    };
  }

  return {
    allowed: true,
    gate: "use",
    reason: "Memory use gate open for injectable card.",
    reasonCode: "use_enabled",
    independentOfOtherGate: true,
    otherGateEnabled: input.config.writeEnabled,
  };
}

export function filterCardsForModelInjection(
  cards: readonly MemoryCard[],
  config: MemoryDualGateConfig,
): MemoryCard[] {
  return cards.filter((card) => evaluateMemoryUseGate({ config, card }).allowed);
}

/**
 * TF-0110 (T-P0-1): use-gate overlay for the production injection paths
 * (role-memory-context-provider.ts, role-spawn.ts). Gate enabled -> strict
 * filter via evaluateMemoryUseGate; gate disabled (the default) -> the input
 * set is returned unchanged, so default-off behavior stays identical to the
 * pre-wiring legacy path (AC-1 / req-5).
 */
export function applyMemoryUseGateOverlay(
  cards: readonly MemoryCard[],
  config: MemoryDualGateConfig = resolveMemoryDualGateConfig(),
): MemoryCard[] {
  if (!config.useEnabled) return [...cards];
  return filterCardsForModelInjection(cards, config);
}

export function isPoisonRevokedCard(card: MemoryCard): boolean {
  const labels = card.retentionLabels ?? [];
  return labels.includes("poison_revoked") || labels.includes("p3_003_poison_revoked");
}

/**
 * Revoke poisoned memory: tombstone + poison labels so use gate always denies.
 */
export function revokePoisonedMemory(
  card: MemoryCard,
  options: { reason?: string; now?: Date } = {},
): MemoryCard {
  const now = (options.now ?? new Date()).toISOString();
  const labels = new Set([...(card.retentionLabels ?? []), "poison_revoked", "p3_003_poison_revoked"]);
  return {
    ...card,
    status: "tombstone",
    retentionLabels: [...labels],
    updatedAt: now,
    // Keep content for audit but mark supersession lineage for delete cascade later.
    supersedes: card.supersedes ?? null,
    supersededBy: card.supersededBy ?? null,
  };
}

function boundedRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return numerator / denominator;
}

/**
 * Issue #143: turn the shadow -> product cutover decision into an automated
 * evidence gate. The evaluator only reports eligibility and stage; it never
 * edits frozen defaults. Callers may not promote solely on model judgment:
 * every promotion input is a bounded metric or explicit evidence ref.
 */
export function evaluateMemoryCutoverGate(
  evidence: MemoryCutoverEvidence,
  thresholds: MemoryCutoverThresholds = DEFAULT_MEMORY_CUTOVER_THRESHOLDS,
): MemoryCutoverDecision {
  const reasons: string[] = [];
  const sampleSize = Number.isFinite(evidence.sampleSize) ? Math.max(0, Math.floor(evidence.sampleSize)) : 0;
  const successRate = Number.isFinite(evidence.successRate) ? evidence.successRate : 0;
  const p95LatencyRatio = boundedRatio(evidence.candidateP95LatencyMs, evidence.baselineP95LatencyMs);
  const tokenOverheadRatio = Number.isFinite(evidence.tokenOverheadRatio) ? evidence.tokenOverheadRatio : Number.POSITIVE_INFINITY;
  const safetyRegressions = Number.isFinite(evidence.safetyRegressions)
    ? Math.max(0, Math.floor(evidence.safetyRegressions))
    : Number.POSITIVE_INFINITY;
  const evidenceRefs = evidence.evidenceRefs.filter((ref) => typeof ref === "string" && ref.trim().length > 0);

  if (evidence.drivenBy !== "agent") reasons.push("evidence_must_be_agent_driven");
  if (sampleSize < thresholds.minSampleSize) reasons.push("sample_size_below_minimum");
  if (successRate < thresholds.minSuccessRate) reasons.push("success_rate_below_minimum");
  if (p95LatencyRatio > thresholds.maxP95LatencyRatio) reasons.push("p95_latency_ratio_above_maximum");
  if (tokenOverheadRatio > thresholds.maxTokenOverheadRatio) reasons.push("token_overhead_ratio_above_maximum");
  if (safetyRegressions > thresholds.maxSafetyRegressions) reasons.push("safety_regressions_present");
  if (evidenceRefs.length === 0) reasons.push("evidence_refs_required");

  const metrics = {
    sampleSize,
    successRate,
    p95LatencyRatio,
    tokenOverheadRatio,
    safetyRegressions,
  };
  const stage: MemoryCutoverDecision["stage"] =
    reasons.length === 0
      ? "product-cutover"
      : sampleSize >= thresholds.minSampleSize && safetyRegressions <= thresholds.maxSafetyRegressions
        ? "guarded-opt-in"
        : "shadow";
  return {
    eligible: stage === "product-cutover",
    stage,
    reasons,
    metrics,
    defaultGateUnchanged: true,
  };
}

/**
 * A3: default dual-gate off aligns with COMPASS flags default-off and UI disabled copy.
 */
export function assertMemoryDefaultOffConsistent(input: {
  dualGate?: MemoryDualGateConfig;
  featureFlags?: MemoryFeatureFlags;
  uiClaims?: Partial<Record<(typeof MEMORY_DEFAULT_OFF_UI_CLAIMS)[number], string>>;
}): { ok: true } | { ok: false; reasons: string[] } {
  const dual = input.dualGate ?? DEFAULT_MEMORY_DUAL_GATE_CONFIG;
  const flags = input.featureFlags ?? DEFAULT_MEMORY_RUNTIME_CONFIG.featureFlags;
  const reasons: string[] = [];

  if (dual.writeEnabled) reasons.push("dual_gate_write_default_must_be_off");
  if (dual.useEnabled) reasons.push("dual_gate_use_default_must_be_off");
  if (flags.enablePreReplyRetrieval) reasons.push("compass_pre_reply_default_must_be_off");
  if (flags.enableSessionStatePage) reasons.push("compass_ssp_default_must_be_off");

  const ui = input.uiClaims ?? {};
  for (const key of MEMORY_DEFAULT_OFF_UI_CLAIMS) {
    const value = ui[key];
    if (value != null && value.trim()) {
      const lower = value.toLowerCase();
      if (!/(off|disabled|not injected|blocked until)/i.test(lower)) {
        reasons.push(`ui_claim_${key}_must_describe_disabled_default`);
      }
    }
  }

  return reasons.length ? { ok: false, reasons } : { ok: true };
}
