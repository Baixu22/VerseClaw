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