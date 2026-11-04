/**
 * TF-0734: shared provider network policy for validation and inference.
 *
 * The runtime's guarded model transport and the Electron Main provider
 * validation probe must answer the same question for the same target:
 * "may this request leave the process?" Keeping the policy construction and the
 * allow/deny decision here — instead of in each caller — is what makes the
 * `policyFingerprint` meaningful.
 *
 * SCOPE: policy inputs (SSRF, private-network, exact-origin trust, proxy/TLS
 * class) and the pre-flight decision. Socket-level pinning stays with the
 * runtime's `fetchWithSsrFGuard`; validation performs the same resolve-time
 * checks and then uses the Electron-owned transport (net.fetch / NetworkPool).
 */
import { createHash } from "node:crypto";
import {
  isCloudMetadataIpAddress,
  isLinkLocalIpAddress,
} from "@openclaw/net-policy/ip";
import {
  assertHostnameAllowedWithPolicy,
  isBlockedHostname,
  mergeSsrFPolicies,
  resolveSsrFPolicyForUrl,
  ssrfPolicyFromHttpBaseUrlAllowedOrigin,
  ssrfPolicyFromHttpBaseUrlFakeIpHostnameAllowlist,
  SsrFBlockedError,
  type SsrFPolicy,
} from "../infra/net/ssrf.js";

const BLOCKED_EXACT_ORIGIN_TRUST_HOSTNAME_LABELS = new Set(["instance-data"]);
/** Well-known instance metadata endpoints that are also link-local addresses. */
const CLOUD_METADATA_HOSTS = new Set(["169.254.169.254"]);

export type ProviderNetworkBlockedReason =
  | "invalid-url"
  | "unsupported-protocol"
  | "blocked-hostname"
  | "metadata-address"
  | "link-local-address"
  | "private-network"
  | "hostname-not-allowlisted";

export type ProviderNetworkPolicy = {
  policy?: SsrFPolicy;
  fingerprint: string;
  allowPrivateNetwork: boolean;
  trustConfiguredBaseUrlOrigin: boolean;
};

function resolveHttpOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    parsed.hostname = parsed.hostname.replace(/\.+$/, "");
    return parsed.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function normalizeProviderOriginHostname(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    const normalized = parsed.hostname.trim().toLowerCase().replace(/\.+$/, "");
    return normalized || undefined;
  } catch {
    return undefined;
  }
}

export function canImplicitlyTrustConfiguredBaseUrlOrigin(value: unknown): value is string {
  const hostname = normalizeProviderOriginHostname(value);
  if (!hostname) return false;
  const labels = hostname.split(".").filter(Boolean);
  return (
    !labels.some(
      (label) => label.includes("metadata") || BLOCKED_EXACT_ORIGIN_TRUST_HOSTNAME_LABELS.has(label),
    ) &&
    !isLinkLocalIpAddress(hostname) &&
    !isCloudMetadataIpAddress(hostname)
  );
}

export function canApplyFakeIpHostnamePolicy(value: unknown): value is string {
  const hostname = normalizeProviderOriginHostname(value);
  if (!hostname) return false;
  const labels = hostname.split(".").filter(Boolean);
  return (
    !labels.some(
      (label) => label.includes("metadata") || BLOCKED_EXACT_ORIGIN_TRUST_HOSTNAME_LABELS.has(label),
    ) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) && !hostname.includes(":")
  );
}

/**
 * Build the provider network policy for one request target.
 *
 * `trustConfiguredBaseUrlOrigin` is the caller's decision (custom/local
 * endpoints only). The helper still refuses to implicitly trust metadata,
 * link-local, or instance-data hosts — matching the runtime transport.
 */
export function resolveProviderNetworkPolicy(input: {
  baseUrl?: unknown;
  requestUrl: string;
  allowPrivateNetwork?: boolean;
  trustConfiguredBaseUrlOrigin?: boolean;
}): ProviderNetworkPolicy {
  const baseUrl = input.baseUrl;
  const baseOrigin = resolveHttpOrigin(baseUrl);
  const requestOrigin = resolveHttpOrigin(input.requestUrl);
  const requestMatchesBaseOrigin =
    typeof baseUrl === "string" && Boolean(baseOrigin) && requestOrigin === baseOrigin;
  const baseUrlOriginPolicy =
    requestMatchesBaseOrigin &&
    input.trustConfiguredBaseUrlOrigin === true &&
    canImplicitlyTrustConfiguredBaseUrlOrigin(baseUrl)
      ? ssrfPolicyFromHttpBaseUrlAllowedOrigin(baseUrl as string)
      : undefined;
  const fakeIpPolicy =
    requestMatchesBaseOrigin && canApplyFakeIpHostnamePolicy(baseUrl)
      ? ssrfPolicyFromHttpBaseUrlFakeIpHostnameAllowlist(baseUrl as string)
      : undefined;
  const policy = mergeSsrFPolicies(
    baseUrlOriginPolicy,
    fakeIpPolicy,
    input.allowPrivateNetwork ? { allowPrivateNetwork: true } : undefined,
  );
  return {
    ...(policy ? { policy } : {}),
    fingerprint: providerNetworkPolicyFingerprint(policy),
    allowPrivateNetwork: input.allowPrivateNetwork === true,
    trustConfiguredBaseUrlOrigin: input.trustConfiguredBaseUrlOrigin === true,
  };
}

/** Stable SHA-256 over the normalized policy. Same inputs → same fingerprint. */
export function providerNetworkPolicyFingerprint(policy?: SsrFPolicy): string {
  const canonical = JSON.stringify({
    version: 1,
    allowPrivateNetwork: policy?.allowPrivateNetwork === true,
    dangerouslyAllowPrivateNetwork: policy?.dangerouslyAllowPrivateNetwork === true,
    allowRfc2544BenchmarkRange: policy?.allowRfc2544BenchmarkRange === true,
    allowIpv6UniqueLocalRange: policy?.allowIpv6UniqueLocalRange === true,
    allowedHostnames: [...(policy?.allowedHostnames ?? [])].map((v) => v.toLowerCase()).sort(),
    allowedOrigins: [...(policy?.allowedOrigins ?? [])].map((v) => v.toLowerCase()).sort(),
    hostnameAllowlist: [...(policy?.hostnameAllowlist ?? [])].map((v) => v.toLowerCase()).sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Pre-flight allow/deny for one URL under a resolved policy. */
export function evaluateProviderNetworkTarget(
  url: string,
  policy?: SsrFPolicy,
): { allowed: true } | { allowed: false; blockedReason: ProviderNetworkBlockedReason } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, blockedReason: "invalid-url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { allowed: false, blockedReason: "unsupported-protocol" };
  }
  const policyForUrl = resolveSsrFPolicyForUrl(parsed, policy);
  const hostname = parsed.hostname;
  if (isBlockedHostname(hostname)) {
    return { allowed: false, blockedReason: "blocked-hostname" };
  }
  if (isCloudMetadataIpAddress(hostname) || CLOUD_METADATA_HOSTS.has(hostname)) {
    return { allowed: false, blockedReason: "metadata-address" };
  }
  if (isLinkLocalIpAddress(hostname)) {
    return { allowed: false, blockedReason: "link-local-address" };
  }
  try {
    assertHostnameAllowedWithPolicy(hostname, policyForUrl);
    return { allowed: true };
  } catch (error) {
    if (error instanceof SsrFBlockedError) {
      return {
        allowed: false,
        blockedReason: /allowlist/i.test(error.message)
          ? "hostname-not-allowlisted"
          : "private-network",
      };
    }
    throw error;
  }
}
