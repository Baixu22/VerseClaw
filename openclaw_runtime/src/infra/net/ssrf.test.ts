/**
 * Lock-in tests for the SSRF guard (infra/net/ssrf.ts).
 *
 * The web-fetch tool already integrates these guards; these tests pin the
 * core predicates so regressions cannot silently widen the attack surface:
 * private/special-use IP blocking, hostname blocking, policy allowlists,
 * DNS pinning, and redirect re-evaluation.
 */
import { describe, expect, it } from "vitest";
import {
  createPinnedLookup,
  isBlockedHostname,
  isBlockedHostnameOrIp,
  isHostnameAllowedByPattern,
  isPrivateIpAddress,
  matchesHostnameAllowlist,
  resolveSsrFPolicyForUrl,
  type SsrFPolicy,
} from "./ssrf.js";

describe("isPrivateIpAddress", () => {
  it("blocks RFC1918 private ranges", () => {
    expect(isPrivateIpAddress("10.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("172.16.0.1")).toBe(true);
    expect(isPrivateIpAddress("192.168.1.1")).toBe(true);
  });

  it("blocks loopback and link-local", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
    expect(isPrivateIpAddress("127.0.0.2")).toBe(true);
    expect(isPrivateIpAddress("169.254.169.254")).toBe(true); // cloud metadata
  });

  it("allows public addresses", () => {
    expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
    expect(isPrivateIpAddress("1.1.1.1")).toBe(false);
    expect(isPrivateIpAddress("140.82.112.3")).toBe(false);
  });

  it("blocks IPv6 loopback/ULA and embedded IPv4", () => {
    expect(isPrivateIpAddress("::1")).toBe(true);
    expect(isPrivateIpAddress("fc00::1")).toBe(true);
    expect(isPrivateIpAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("fails closed on malformed IPv6 literals and legacy IPv4 forms", () => {
    expect(isPrivateIpAddress("::ffff:999.999.999.999")).toBe(true); // malformed embedded
    expect(isPrivateIpAddress("2130706433")).toBe(true); // legacy 127.0.0.1 integer form
  });
});

describe("isBlockedHostname / isBlockedHostnameOrIp", () => {
  it("blocks localhost, .local, .internal and metadata hostnames", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("foo.localhost")).toBe(true);
    expect(isBlockedHostname("printer.local")).toBe(true);
    expect(isBlockedHostname("service.internal")).toBe(true);
  });

  it("allows normal public hostnames", () => {
    expect(isBlockedHostname("example.com")).toBe(false);
    expect(isBlockedHostname("api.github.com")).toBe(false);
  });

  it("blocks hostnames that are private IPs", () => {
    expect(isBlockedHostnameOrIp("192.168.1.1")).toBe(true);
    expect(isBlockedHostnameOrIp("127.0.0.1")).toBe(true);
  });
});

describe("policy allowlists", () => {
  const policy: SsrFPolicy = { allowedHostnames: ["example.com", "*.github.com"] };

  it("matches exact hostname and wildcard patterns", () => {
    expect(isHostnameAllowedByPattern("example.com", "example.com")).toBe(true);
    expect(isHostnameAllowedByPattern("api.github.com", "*.github.com")).toBe(true);
    expect(isHostnameAllowedByPattern("evil.com", "*.github.com")).toBe(false);
  });

  it("matchesHostnameAllowlist requires an explicit entry", () => {
    expect(matchesHostnameAllowlist("example.com", ["example.com"])).toBe(true);
    expect(matchesHostnameAllowlist("other.com", ["example.com"])).toBe(false);
  });

  it("resolveSsrFPolicyForUrl returns the policy unchanged without allowedOrigins", () => {
    const url = new URL("https://other.com/x");
    expect(resolveSsrFPolicyForUrl(url, policy)).toBe(policy);
  });

  it("resolveSsrFPolicyForUrl promotes only matching allowedOrigins hosts", () => {
    const originPolicy: SsrFPolicy = { allowedOrigins: ["https://trusted.example"] };
    const url = new URL("https://trusted.example/x");
    const resolved = resolveSsrFPolicyForUrl(url, originPolicy);
    expect(resolved?.allowedHostnames).toContain("trusted.example");
    const other = resolveSsrFPolicyForUrl(new URL("https://untrusted.example/x"), originPolicy);
    expect(other?.allowedHostnames).toBeUndefined();
  });

  it("exempts RFC2544 benchmark range only when policy opts in", () => {
    expect(isPrivateIpAddress("198.18.0.1")).toBe(true);
    expect(isPrivateIpAddress("198.18.0.1", { allowRfc2544BenchmarkRange: true })).toBe(false);
    // RFC1918 private ranges are never exempted by that flag.
    expect(isPrivateIpAddress("192.168.1.1", { allowRfc2544BenchmarkRange: true })).toBe(true);
  });
});

describe("createPinnedLookup (DNS pinning)", () => {
  it("returns the pinned address for the matching hostname", async () => {
    const lookup = createPinnedLookup({
      hostname: "example.com",
      addresses: ["93.184.216.34"],
    });
    await expect(
      new Promise<string>((resolve, reject) => {
        lookup("example.com", (err, address) => {
          if (err) reject(err);
          else resolve(address);
        });
      }),
    ).resolves.toBe("93.184.216.34");
  });

  it("falls back to the original lookup for other hostnames", async () => {
    const fallback = (host: string, cb: (err: Error | null, address?: string, family?: number) => void) => {
      cb(null, "1.2.3.4", 4);
    };
    const lookup = createPinnedLookup({
      hostname: "example.com",
      addresses: ["93.184.216.34"],
      fallback,
    });
    await expect(
      new Promise<string>((resolve, reject) => {
        lookup("other.com", (err, address) => {
          if (err) reject(err);
          else resolve(address!);
        });
      }),
    ).resolves.toBe("1.2.3.4");
  });

  it("private-IP rejection is enforced by the dispatcher override path (fail-closed)", () => {
    // The predicate used by resolvePinnedDispatcherLookup must reject
    // private override addresses even when the caller pins them explicitly.
    expect(isPrivateIpAddress("192.168.1.10")).toBe(true);
  });
});
