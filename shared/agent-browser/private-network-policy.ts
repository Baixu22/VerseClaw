/**
 * TF-0503: supervised Browser private-network policy.
 *
 * Every Browser navigation target is classified before it is allowed. Loopback,
 * RFC1918, link-local (including the 169.254.169.254 metadata endpoint),
 * IPv6 unique-local/link-local and "localhost" names are private by default and
 * denied. Private access requires an explicit, non-expired per-origin approval
 * bound to one supervised session; there is no global switch and no implicit
 * bypass.
 */
import { evaluateExternalNavigationUrl } from '../security/url-policy';

export type BrowserPrivateNetworkClass =
  | 'public'
  | 'loopback'
  | 'rfc1918'
  | 'link-local'
  | 'ipv6-local'
  | 'local-name';

export type BrowserPrivateNetworkDecision =
  | {
      allowed: true;
      addressClass: BrowserPrivateNetworkClass;
      reason: 'public' | 'approved-private' | 'first-party-preview';
    }
  | { allowed: false; addressClass: BrowserPrivateNetworkClass; reason: 'private-network-default-deny' | 'approval-expired' | 'approval-origin-mismatch' | 'approval-session-mismatch' | 'invalid-url' };

export type BrowserPrivateNetworkApproval = {
  sessionId: string;
  origin: string;
  grantedAt: number;
  expiresAt: number;
  /** Recorded so evidence can prove the approval came from a supervised step. */
  grantedBy: 'agent' | 'human';
};

const PRIVATE_APPROVAL_TTL_MS = 10 * 60 * 1000;

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/u.test(part) ? Number(part) : -1));
  if (octets.some((value) => value < 0 || value > 255)) return null;
  return octets;
}

function classifyHost(hostnameRaw: string): BrowserPrivateNetworkClass {
  const hostname = hostnameRaw.trim().toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.$/u, '');
  if (/(?:^|\.)(?:localhost|local|internal|home\.arpa)$/u.test(hostname)) return 'local-name';
  const mapped = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return classifyHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  if (hostname.startsWith('::ffff:')) return classifyHost(hostname.slice(7));
  const v4 = parseIpv4(hostname);
  if (v4) {
    const [a, b] = v4;
    if (a === 127) return 'loopback';
    if (a === 10) return 'rfc1918';
    if (a === 172 && b >= 16 && b <= 31) return 'rfc1918';
    if (a === 192 && b === 168) return 'rfc1918';
    if (a === 169 && b === 254) return 'link-local';
    if ((a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0)) return 'rfc1918';
    if (a === 0) return 'loopback';
    return 'public';
  }
  if (hostname === '::' || hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return 'loopback';
  if (hostname.includes(':') && /^(?:fc|fd|fe[89ab])/u.test(hostname)) return 'ipv6-local';
  return 'public';
}

export function classifyBrowserAddress(input: unknown): BrowserPrivateNetworkClass | null {
  const evaluated = evaluateExternalNavigationUrl(input);
  if (!evaluated.ok) return null;
  return classifyHost(new URL(evaluated.href).hostname);
}

export function isPrivateNetworkClass(addressClass: BrowserPrivateNetworkClass): boolean {
  return addressClass !== 'public';
}

/**
 * Default-deny decision for one navigation. Public URLs pass; private URLs need
 * a live approval bound to the same session AND origin.
 */
/**
 * Origin of a URL, or undefined when it cannot be parsed. Used to compare a
 * navigation target against host-owned state (never against payload claims).
 */
export function browserOriginOf(url: unknown): string | undefined {
  const evaluated = evaluateExternalNavigationUrl(url);
  if (!evaluated.ok) return undefined;
  try {
    return new URL(evaluated.href).origin;
  } catch {
    return undefined;
  }
}

export function decideBrowserNavigation(input: {
  url: unknown;
  sessionId: string;
  approvals?: readonly BrowserPrivateNetworkApproval[];
  /**
   * Origins the host itself owns for this session (for example the workspace
   * preview the user already started). Read from Main-side persisted state, never
   * from the caller payload. Localhost only; metadata and RFC1918 stay denied.
   */
  firstPartyOrigins?: readonly string[];
  /** Addresses resolved by the network owner for this request, never caller input. */
  resolvedAddresses?: readonly string[];
  now?: number;
}): BrowserPrivateNetworkDecision {
  const evaluated = evaluateExternalNavigationUrl(input.url);
  if (!evaluated.ok) {
    return { allowed: false, addressClass: 'public', reason: 'invalid-url' };
  }
  const origin = new URL(evaluated.href).origin;
  const targetClass = classifyHost(new URL(evaluated.href).hostname);
  const resolvedPrivate = input.resolvedAddresses?.map(classifyHost).filter(isPrivateNetworkClass) ?? [];
  // A local-looking hostname or first loopback answer cannot hide an additional
  // private destination from the preview exemption.
  const nonLoopbackPrivate = resolvedPrivate.find(addressClass => addressClass !== 'loopback');
  const addressClass = nonLoopbackPrivate ?? (isPrivateNetworkClass(targetClass) ? targetClass : resolvedPrivate[0] ?? targetClass);
  if (!isPrivateNetworkClass(addressClass)) {
    return { allowed: true, addressClass, reason: 'public' };
  }
  const now = input.now ?? Date.now();
  // First-party exemption is deliberately limited to loopback/local-name. A
  // metadata or RFC1918 target can never ride the workspace-preview exception,
  // so private ranges stay default-deny even when a preview is running.
  const firstPartyEligible = addressClass === 'loopback' || addressClass === 'local-name';
  if (firstPartyEligible && (input.firstPartyOrigins ?? []).includes(origin)) {
    return { allowed: true, addressClass, reason: 'first-party-preview' };
  }
  const approval = (input.approvals ?? []).find(
    (candidate) => candidate.sessionId === input.sessionId && candidate.origin === origin,
  );
  if (!approval) {
    return { allowed: false, addressClass, reason: 'private-network-default-deny' };
  }
  if (approval.sessionId !== input.sessionId) {
    return { allowed: false, addressClass, reason: 'approval-session-mismatch' };
  }
  if (approval.origin !== origin) {
    return { allowed: false, addressClass, reason: 'approval-origin-mismatch' };
  }
  if (approval.expiresAt <= now) {
    return { allowed: false, addressClass, reason: 'approval-expired' };
  }
  return { allowed: true, addressClass, reason: 'approved-private' };
}

/** Create a bounded per-origin approval for one supervised session. */
export function createBrowserPrivateNetworkApproval(input: {
  sessionId: string;
  origin: string;
  now?: number;
  ttlMs?: number;
  grantedBy: 'agent' | 'human';
}): BrowserPrivateNetworkApproval {
  const now = input.now ?? Date.now();
  return {
    sessionId: input.sessionId,
    origin: input.origin,
    grantedAt: now,
    expiresAt: now + (input.ttlMs ?? PRIVATE_APPROVAL_TTL_MS),
    grantedBy: input.grantedBy,
  };
}

export { PRIVATE_APPROVAL_TTL_MS };
