import {
  extractEmbeddedIpv4FromIpv6,
  isCloudMetadataIpAddress,
  isIpv4Address,
  isIpv6Address,
  parseCanonicalIpAddress,
} from './net-policy/ip.ts';

/**
 * Unified external navigation URL policy (P1-004 / F-SEC-003 / F-SEC-007 / F-SEC-010).
 * Single allowlist for openExternal, window.open, Agent Browser navigate/newPage.
 */

export type UrlPolicyErrorCode =
  | 'invalidUrl'
  | 'disallowedScheme'
  | 'emptyUrl';

export type UrlPolicyResult =
  | { ok: true; href: string; protocol: 'http:' | 'https:' }
  | { ok: false; code: UrlPolicyErrorCode; reason: string };

/** Explicit external navigation allowlist. */
export const EXTERNAL_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:'] as const);

const DANGEROUS_SCHEME_RE = /^(javascript|data|vbscript|file|blob|about|chrome|chrome-extension|edge|app|clawx|ms-msdt|ms-windows-store|shell|vscode|view-source):/i;

export function normalizeUrlInput(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim();
}

/**
 * Allow only absolute http/https URLs for external navigation and browser control.
 * Rejects javascript/data/file/custom schemes and relative/malformed inputs.
 */
export function evaluateExternalNavigationUrl(input: unknown): UrlPolicyResult {
  const raw = normalizeUrlInput(input);
  if (!raw) {
    return { ok: false, code: 'emptyUrl', reason: 'URL is required' };
  }

  // Fast-path reject for known dangerous schemes before URL parse edge cases.
  if (DANGEROUS_SCHEME_RE.test(raw)) {
    return { ok: false, code: 'disallowedScheme', reason: 'URL scheme is not allowed' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, code: 'invalidUrl', reason: 'Malformed URL' };
  }

  const protocol = parsed.protocol.toLowerCase() as 'http:' | 'https:';
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { ok: false, code: 'disallowedScheme', reason: `Protocol ${parsed.protocol} is not allowed` };
  }

  // Disallow credentials in open targets (credential phishing / odd OS handlers).
  if (parsed.username || parsed.password) {
    return { ok: false, code: 'invalidUrl', reason: 'URLs with embedded credentials are not allowed' };
  }

  return { ok: true, href: parsed.toString(), protocol };
}

export function isAllowedExternalNavigationUrl(input: unknown): boolean {
  return evaluateExternalNavigationUrl(input).ok;
}

export function assertAllowedExternalNavigationUrl(input: unknown): string {
  const result = evaluateExternalNavigationUrl(input);
  if (!result.ok) {
    const error = new Error(result.reason) as Error & { code: UrlPolicyErrorCode };
    error.code = result.code;
    error.name = 'UrlPolicyError';
    throw error;
  }
  return result.href;
}

/**
 * Navigate/open guard for the default browser drivers.
 * - Blocks dangerous schemes (javascript/data/file/…) for http(s) navigation targets.
 * - Allows `file:` / `data:` local documents (fixtures, offline demos) unless strict.
 * - For literal IP hosts, blocks the cloud-metadata endpoints via net-policy's parser (dotted
 *   quad, IPv4-mapped IPv6, rfc6052, rfc6145). Private/loopback literals stay allowed so local
 *   fixtures remain navigable.
 */
export function assertAgentBrowserNavigateUrl(
  input: unknown,
  options: { allowLocalDocuments?: boolean } = {},
): string {
  const raw = normalizeUrlInput(input);
  const allowLocal = options.allowLocalDocuments !== false;
  if (allowLocal && /^(file|data):/i.test(raw)) {
    return raw;
  }
  const href = assertAllowedExternalNavigationUrl(raw);
  // Literal-IP SSRF guard (DNS rebinding is out of scope here). This hostname check is the only
  // cloud-metadata protection the default drivers have, so it shares the net-policy parser:
  // string equality on the three well-known addresses missed the IPv4-mapped IPv6 form
  // (`http://[::ffff:169.254.169.254]/`), which reaches the same endpoint.
  try {
    const host = new URL(href).hostname.replace(/^\[|\]$/g, '');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
      return assertSafeIpHostnameNavigate(href, host);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'UrlPolicyError') throw error;
  }
  return href;
}

/**
 * The AWS/GCP/Azure metadata endpoint sits inside the link-local range, which net-policy reports as
 * a range name rather than a metadata literal, so compare its canonical dotted quad after decoding
 * any IPv4-mapped / rfc6052 / rfc6145 embedding. `isCloudMetadataIpAddress` covers the endpoints
 * that are not link-local (100.100.100.200, fd00:ec2::254) in every shape it understands.
 */
function isCloudMetadataNavigateHost(host: string): boolean {
  if (isCloudMetadataIpAddress(host)) return true;
  const parsed = parseCanonicalIpAddress(host);
  if (!parsed) return false;
  const target = isIpv6Address(parsed) ? extractEmbeddedIpv4FromIpv6(parsed) ?? parsed : parsed;
  return isIpv4Address(target) && target.toString() === '169.254.169.254';
}

function assertSafeIpHostnameNavigate(href: string, host: string): string {
  // Blocks the cloud-metadata endpoints (169.254.169.254, 100.100.100.200, fd00:ec2::254) in every
  // literal shape the net-policy parser understands: dotted quad, IPv4-mapped IPv6, rfc6052, rfc6145.
  if (isCloudMetadataNavigateHost(host)) {
    const error = new Error('Cloud metadata address is not allowed') as Error & {
      code: UrlPolicyErrorCode;
    };
    error.code = 'disallowedScheme';
    error.name = 'UrlPolicyError';
    throw error;
  }
  return href;
}

/** CSP applied to untrusted HTML Preview documents (srcdoc). */
export const HTML_PREVIEW_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; img-src data: blob: https: http:; media-src data: blob: https: http:; font-src data: https: http:; style-src 'unsafe-inline' data:; script-src 'unsafe-inline'; connect-src https: http:; object-src 'none';";

/** Sandbox flags for HTML Preview iframes — no popup escape / downloads / same-origin. */
export const HTML_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-presentation';

/** Baseline CSP for the Verse Claw renderer shell (Electron + Vite). */
export const RENDERER_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'self' http://127.0.0.1:* http://localhost:* https: blob: data:; img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* wss://127.0.0.1:* wss://localhost:* https: http:; worker-src 'self' blob:; form-action 'self';";