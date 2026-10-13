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

/**
 * CSP sent as a response header for `clawx-preview:` documents. Identical to
 * `HTML_PREVIEW_CSP` minus `frame-ancestors`: that directive is ignored inside
 * a `<meta>` element but enforced when delivered as a header, and the preview is
 * intentionally embedded in the app shell.
 */
export const HTML_PREVIEW_DOCUMENT_CSP = `${HTML_PREVIEW_CSP
  .split(';')
  .map((directive) => directive.trim())
  .filter((directive) => directive.length > 0 && !directive.startsWith('frame-ancestors'))
  .join('; ')};`;

/** Sandbox flags for HTML Preview iframes — no popup escape / downloads / same-origin. */
export const HTML_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-presentation';

/**
 * Dedicated scheme used to serve untrusted HTML Preview documents.
 *
 * `srcdoc`, `data:` and `blob:` frames are local-scheme documents, so Chromium
 * makes them inherit the embedder's CSP and intersects that inherited policy
 * with the document's own. Under `RENDERER_CSP` (`script-src 'self'`) the
 * intersection silently makes the preview policy's `script-src 'unsafe-inline'`
 * unreachable, so sandboxed preview demos lost their scripts even though
 * `HTML_PREVIEW_CSP` and `HTML_PREVIEW_SANDBOX` both allow them. Serving the
 * preview from a non-local scheme keeps `RENDERER_CSP` authoritative for the
 * renderer and `HTML_PREVIEW_CSP` authoritative for the preview frame (#132).
 */
export const HTML_PREVIEW_SCHEME = 'clawx-preview';

/** Origin used for HTML Preview documents; a `standard` scheme requires a host. */
export const HTML_PREVIEW_ORIGIN = `${HTML_PREVIEW_SCHEME}://document`;

/** Maximum preview document size accepted by the preview document registry. */
export const HTML_PREVIEW_MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

/** Build the URL the sandboxed preview frame loads for a registered document. */
export function buildHtmlPreviewUrl(token: string): string {
  return `${HTML_PREVIEW_ORIGIN}/${encodeURIComponent(token)}`;
}

/** Extract the document token from a `clawx-preview:` request URL, if any. */
export function htmlPreviewTokenFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${HTML_PREVIEW_SCHEME}:`) return null;
    const token = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Production renderer CSP. External HTTP(S) data loading remains limited to
 * media and frame content; images are restricted to `'self'`/`data:`/`blob:`
 * so untrusted renderer content cannot trigger zero-click network image loads
 * (issue #127). Renderer code must use Main-owned host-api/proxy channels for
 * outbound connections.
 */
export const RENDERER_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'self' clawx-preview: http://127.0.0.1:* http://localhost:* https: blob: data:; img-src 'self' data: blob:; media-src 'self' data: blob: https: http:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' data: blob: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* wss://127.0.0.1:* wss://localhost:*; worker-src 'self' blob:; form-action 'self';";

/**
 * Development-only renderer CSP. Vite/React refresh injects a small inline
 * module preamble in the dev server; production must use RENDERER_CSP. The only
 * intended dev/prod delta is that inline script preamble — image loading is
 * restricted identically so dev cannot normalise behaviour prod forbids (#127).
 */
export const RENDERER_DEV_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'self' clawx-preview: http://127.0.0.1:* http://localhost:* https: blob: data:; img-src 'self' data: blob:; media-src 'self' data: blob: https: http:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' data: blob: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* wss://127.0.0.1:* wss://localhost:*; worker-src 'self' blob:; form-action 'self';";