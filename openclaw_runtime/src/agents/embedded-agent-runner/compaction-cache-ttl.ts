/**
 * Resolves whether non-urgent embedded compaction should wait for prompt-cache TTL.
 */
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { computeEffectiveSettings } from "../agent-hooks/context-pruning/settings.js";
import { isCacheTtlEligibleProvider, readLastCacheTtlTimestamp } from "./cache-ttl.js";
import { CACHE_TTL_DEFERRED_COMPACTION_REASON } from "./compact-reasons.js";

export type CompactionCacheTtlDeferral = {
  reason: typeof CACHE_TTL_DEFERRED_COMPACTION_REASON;
  ageMs: number;
  ttlMs: number;
};

/**
 * Returns a deferral only for an explicitly enabled, eligible provider whose
 * latest cache touch is still inside the configured context-pruning TTL.
 *
 * `budget` is the non-urgent threshold path. Manual compaction and
 * overflow/timeout recovery must never be delayed by prompt-cache policy.
 */
export function resolveCompactionCacheTtlDeferral(params: {
  config?: OpenClawConfig;
  sessionManager: unknown;
  provider: string;
  modelId: string;
  modelApi?: string;
  trigger?: string;
  now?: number;
}): CompactionCacheTtlDeferral | null {
  const compaction = params.config?.agents?.defaults?.compaction;
  if (compaction?.deferWhileCacheHot !== true || params.trigger !== "budget") {
    return null;
  }

  const settings = computeEffectiveSettings(
    params.config?.agents?.defaults?.contextPruning,
  );
  if (!settings || settings.ttlMs <= 0) {
    return null;
  }
  if (!isCacheTtlEligibleProvider(params.provider, params.modelId, params.modelApi)) {
    return null;
  }

  const lastCacheTouchAt = readLastCacheTtlTimestamp(params.sessionManager, {
    provider: params.provider,
    modelId: params.modelId,
  });
  if (!lastCacheTouchAt) {
    return null;
  }

  const now = params.now ?? Date.now();
  const ageMs = now - lastCacheTouchAt;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= settings.ttlMs) {
    return null;
  }

  return {
    reason: CACHE_TTL_DEFERRED_COMPACTION_REASON,
    ageMs,
    ttlMs: settings.ttlMs,
  };
}
