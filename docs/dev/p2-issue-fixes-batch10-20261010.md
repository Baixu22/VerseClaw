# P2 issue fix: renderer CSP least privilege

Scope: issue #132. This record is agent-authored and makes no XSS exploitation
claim.

## Change

- The inline boot-theme script moved to `public/boot-theme.js`; `index.html`
  now references it as a same-origin external script.
- Production `RENDERER_CSP` uses `script-src 'self'` and no longer permits
  inline script execution.
- Production `connect-src` no longer permits arbitrary `https:` or `http:`
  origins. It retains same-origin, loopback HTTP/WebSocket, `data:`, and `blob:`
  so the existing image-copy and local service paths continue to work.
- `RENDERER_DEV_CSP` keeps `'unsafe-inline'` only for the Vite/React refresh
  preamble during `vite serve`; `vite.config.ts` selects production versus dev
  policy at index transform time.
- Remote image/media and workspace/HTML preview frame allowances remain
  intentional content-display policies, separate from renderer outbound
  connections. `HTML_PREVIEW_CSP` remains the stricter untrusted-preview policy.

## Verification

```text
node node_modules/vitest/vitest.mjs run tests/unit/renderer-csp.test.ts tests/unit/url-policy.test.ts tests/unit/startup-loading-experience.test.tsx
pnpm run build:vite
```

The local build reaches client bundle generation and the production CSP
transform; a host-specific Windows esbuild temp-file `Access is denied` failure
is reported if it prevents final bundling.

## Follow-up (2026-10-14): preview document scheme

Keeping the renderer CSP at `script-src 'self'` silently disabled scripts in the
sandboxed HTML preview. The preview frame rendered through `srcdoc`, which is a
local-scheme document, so Chromium made it inherit `RENDERER_CSP` and
intersected that policy with `HTML_PREVIEW_CSP`. The intersection blocked
`'unsafe-inline'`, so only the renderer's policy was ever reachable.

`HTML_PREVIEW_CSP` is now served as the *document* policy of a dedicated
`clawx-preview:` scheme instead:

- The renderer prepares the guarded document and registers it through
  `hostApi.files.registerHtmlPreview`; Main keeps it in a bounded registry and
  serves it with a `Content-Security-Policy` header.
- The header policy drops `frame-ancestors` (`HTML_PREVIEW_DOCUMENT_CSP`) because
  the directive is ignored inside `<meta>` but enforced from a header, and the
  preview is intentionally framed by the app shell.
- `RENDERER_CSP` / `RENDERER_DEV_CSP` add `clawx-preview:` to `frame-src` only;
  the renderer keeps `script-src 'self'`.
- `srcdoc` remains the sandboxed fallback when the document cannot be
  registered; scripts stay blocked in that degraded path.
