/**
 * Shared token-usage math and source-classification helpers.
 *
 * Single source of truth used by BOTH the Main-process transcript scanner
 * (`electron/utils/token-usage-core.ts`) and the renderer Billing page, so
 * the client-side fallback totals and the backend aggregates always agree.
 */

/**
 * Usage sources excluded from billing aggregates. These markers describe
 * gateway bookkeeping rows (injected mirrors, delivery echoes) that would
 * otherwise double-count real model usage.
 */
export const HIDDEN_USAGE_MARKERS = ['gateway-injected', 'delivery-mirror'];

export type UsageTokenParts = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Disjoint token buckets captured by a native model call. */
export type ObservedModelTokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

export function readObservedModelTokens(value: unknown): ObservedModelTokens | null {
  if (!value || typeof value !== 'object') return null;
  const { input, output, cacheRead, cacheWrite, total } = value as ObservedModelTokens;
  if (![input, output, cacheRead, cacheWrite, total].every(count => Number.isSafeInteger(count) && count >= 0) ||
      total < input + output + cacheRead + cacheWrite) return null;
  return { input, output, cacheRead, cacheWrite, total };
}

/**
 * Prompt tokens sent to the model. OpenAI-style usage reports prompt totals
 * that already include cached tokens, so the parser stores the cache *miss*
 * in `inputTokens` and cache hits separately; the prompt total is their sum.
 */
export function promptTokensForUsage(entry: UsageTokenParts): number {
  return entry.inputTokens + entry.cacheReadTokens + entry.cacheWriteTokens;
}

/**
 * Cache hit rate for one usage record: cache-read tokens over prompt tokens.
 * Returns `null` when there is no prompt denominator to compute against.
 */
export function computeCacheHitRate(entry: UsageTokenParts): number | null {
  const promptTokens = promptTokensForUsage(entry);
  return promptTokens > 0 ? entry.cacheReadTokens / promptTokens : null;
}

/** True when the provider or model name carries a hidden-source marker. */
export function isHiddenUsageSource(source?: string): boolean {
  if (!source) return false;
  const normalizedSource = source.trim().toLowerCase();
  return HIDDEN_USAGE_MARKERS.some((marker) => normalizedSource.includes(marker));
}
