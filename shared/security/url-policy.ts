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

/** CSP applied to untrusted HTML Preview documents (srcdoc). */
export const HTML_PREVIEW_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; img-src data: blob: https: http:; media-src data: blob: https: http:; font-src data: https: http:; style-src 'unsafe-inline' data:; script-src 'unsafe-inline'; connect-src https: http:; object-src 'none';";

/** Sandbox flags for HTML Preview iframes — no popup escape / downloads / same-origin. */
export const HTML_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-presentation';

/**
 * Production renderer CSP. External HTTP(S) data loading remains limited to
 * image/media/frame content; renderer code must use Main-owned host-api/proxy
 * channels for outbound connections.
 */
export const RENDERER_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'self' http://127.0.0.1:* http://localhost:* https: blob: data:; img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' data: blob: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* wss://127.0.0.1:* wss://localhost:*; worker-src 'self' blob:; form-action 'self';";

/**
 * Development-only renderer CSP. Vite/React refresh injects a small inline
 * module preamble in the dev server; production must use RENDERER_CSP.
 */
export const RENDERER_DEV_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'self' http://127.0.0.1:* http://localhost:* https: blob: data:; img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' data: blob: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* wss://127.0.0.1:* wss://localhost:*; worker-src 'self' blob:; form-action 'self';";