/**
 * Electron Main side of the sandboxed HTML Preview document protocol.
 *
 * Untrusted agent-authored HTML must render under its own document policy
 * (`HTML_PREVIEW_CSP`) inside a sandboxed frame. `srcdoc` cannot do that: the
 * frame is a local-scheme document, so Chromium intersects the inherited
 * renderer CSP (`script-src 'self'`) with the preview policy and blocks every
 * inline preview script. Serving the prepared document from the dedicated
 * `clawx-preview:` scheme gives the frame its own origin, so only the preview
 * policy applies while `RENDERER_CSP` keeps protecting the renderer.
 */
import { protocol, type Protocol } from 'electron';
import {
  HTML_PREVIEW_DOCUMENT_CSP,
  HTML_PREVIEW_MAX_DOCUMENT_BYTES,
  HTML_PREVIEW_SCHEME,
  buildHtmlPreviewUrl,
  htmlPreviewTokenFromUrl,
} from '@shared/security/url-policy';

const MAX_RETAINED_DOCUMENTS = 64;

const documents = new Map<string, string>();
let sequence = 0;

/**
 * Register the preview scheme as privileged. Must run before `app.whenReady()`.
 */
export function registerHtmlPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: HTML_PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        corsEnabled: false,
        supportFetchAPI: false,
        allowServiceWorkers: false,
        stream: false,
      },
    },
  ]);
}

/**
 * Retain a prepared preview document and return the URL the frame should load.
 * Older documents are evicted so a long session cannot grow without bound.
 */
export function registerHtmlPreviewDocument(html: string): string {
  sequence += 1;
  const token = `${Date.now().toString(36)}${sequence.toString(36)}`;
  documents.set(token, html);
  while (documents.size > MAX_RETAINED_DOCUMENTS) {
    const oldest = documents.keys().next();
    if (oldest.done) break;
    documents.delete(oldest.value);
  }
  return buildHtmlPreviewUrl(token);
}

export function isValidHtmlPreviewDocument(html: unknown): html is string {
  return (
    typeof html === 'string' &&
    html.length > 0 &&
    Buffer.byteLength(html, 'utf8') <= HTML_PREVIEW_MAX_DOCUMENT_BYTES
  );
}

/** Install the request handler. Must run after `app.whenReady()`. */
export function installHtmlPreviewProtocol(target: Protocol = protocol): void {
  target.handle(HTML_PREVIEW_SCHEME, (request) => {
    const token = htmlPreviewTokenFromUrl(request.url);
    const html = token === null ? undefined : documents.get(token);
    if (html === undefined) {
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': HTML_PREVIEW_DOCUMENT_CSP,
      },
    });
  });
}

/** Test seam: drop every retained preview document. */
export function resetHtmlPreviewDocuments(): void {
  documents.clear();
  sequence = 0;
}
