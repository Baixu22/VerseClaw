/**
 * Vendor prompt-cache retention policy.
 *
 * Mirrors the reference DeepSeek-Reasonix `cache_policy.go`: a host-based table
 * of prefix-cache TTLs used to decide whether a provider's prefix cache is
 * still warm after a session idle period. DeepSeek and unknown vendors keep the
 * long-standing 24h default (DeepSeek Context Caching on Disk retains prefixes
 * for "several hours to days"), while DashScope and Anthropic override with a
 * documented 5m ephemeral cache.
 *
 * Values are deliberately conservative: a TTL that is too small burns a live
 * cache (the user pays full input price for a prefix the server still cached),
 * while one that is too large only forgoes a prune opportunity.
 */

export type CacheVendor = "deepseek" | "anthropic" | "dashscope" | "unknown";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Resolve a base URL hostname, lowercased and without a trailing dot. */
function resolveBaseUrlHostname(baseUrl: string | undefined): string | undefined {
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    return undefined;
  }
  try {
    return new URL(baseUrl).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}

/**
 * Identify the cache-policy vendor from a provider base URL. Host-based
 * exact/suffix matching (not full-URL substring) so unrelated or
 * attacker-controlled URLs cannot be misdetected.
 */
export function detectCacheVendor(baseUrl: string | undefined): CacheVendor {
  const host = resolveBaseUrlHostname(baseUrl);
  if (!host) {
    return "unknown";
  }
  if (
    host === "dashscope.aliyuncs.com" ||
    host.endsWith(".dashscope.aliyuncs.com") ||
    host.endsWith(".maas.aliyuncs.com")
  ) {
    return "dashscope";
  }
  if (host === "api.deepseek.com" || host.endsWith(".deepseek.com")) {
    return "deepseek";
  }
  if (host === "api.anthropic.com" || host.endsWith(".anthropic.com")) {
    return "anthropic";
  }
  return "unknown";
}

/** Known vendor prefix-cache TTLs in milliseconds. */
export function defaultCacheTtlMs(vendor: CacheVendor): number {
  switch (vendor) {
    case "dashscope":
      // DashScope Session cache TTL is 5 minutes (documented).
      return 5 * MINUTE_MS;
    case "anthropic":
      // Anthropic ephemeral cache TTL is 5 minutes.
      return 5 * MINUTE_MS;
    case "deepseek":
    default:
      // DeepSeek and unknown vendors keep the legacy 24h default.
      return 24 * HOUR_MS;
  }
}

/**
 * Resolve the effective provider cache TTL: an explicit `cacheTtlMinutes`
 * override wins; otherwise the vendor default applies.
 */
export function effectiveCacheTtlMs(params: {
  baseUrl?: string;
  cacheTtlMinutes?: number;
}): number {
  if (
    typeof params.cacheTtlMinutes === "number" &&
    Number.isFinite(params.cacheTtlMinutes) &&
    params.cacheTtlMinutes > 0
  ) {
    return params.cacheTtlMinutes * MINUTE_MS;
  }
  return defaultCacheTtlMs(detectCacheVendor(params.baseUrl));
}
