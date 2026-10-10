---
id: p2-issue-fixes-batch10-20261010
title: P2 issue batch 10 - renderer CSP least privilege
lifecycleStatus: active
taskType: security-hardening
intent: Tighten the Electron renderer shell CSP by externalizing the boot theme script, removing unsafe-inline from production script-src, and removing arbitrary HTTP(S) from connect-src while keeping Vite dev, loopback services, Gateway frames, and local previews working.
touchedAreas:
  - index.html
  - public/**
  - shared/security/**
  - vite.config.ts
  - tests/unit/**
  - harness/specs/**
  - docs/**
  - docs/README.md
expectedUserBehavior:
  - The production renderer shell loads the boot theme script as a same-origin external file and permits no inline script execution except a development-only Vite preamble.
  - Renderer outbound fetch/WebSocket connections are limited to same-origin, local loopback services, and local data/blob URLs; arbitrary HTTP(S) must go through Main-owned host-api/proxy channels.
  - Gateway iframe embedding, Office/PDF/HTML previews, remote image/media display and workspace web previews continue to work under their distinct CSP/sandbox policies.
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
humanEvidence: not-required
forbiddenPatterns:
  - deleting the boot theme initialization or making the initial theme flash worse
  - removing local loopback, websocket, data/blob, frame or preview allowances without a replacement
  - adding a duplicate renderer protocol switcher or direct renderer Gateway HTTP client
  - claiming an XSS exploit or real malicious-site reproduction from this hardening change
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/renderer-csp.test.ts tests/unit/url-policy.test.ts tests/unit/startup-loading-experience.test.tsx
  - pnpm run build:vite
  - pnpm harness validate --spec harness/specs/tasks/p2-issue-fixes-batch10-20261010.md
acceptance:
  - Issue #132 - RENDERER_CSP has script-src 'self' and no unsafe-inline; the static index.html matches that production policy and references public/boot-theme.js externally.
  - Issue #132 - production connect-src has no bare https: or http: wildcard, while same-origin, loopback, websocket, data: and blob: local uses remain available.
  - Issue #132 - Vite dev receives RENDERER_DEV_CSP with the React refresh inline exception; production build resolution uses RENDERER_CSP.
  - Remaining frame-src/img-src/media-src external allowances and HTML preview CSP are documented as intentionally separate content-preview policies.
docs:
  required: true
  files:
    - docs/dev/p2-issue-fixes-batch10-20261010.md
---

# P2 issue batch 10

This batch addresses the renderer CSP hardening risk in issue #132. It does
not claim an exploited XSS or replace the existing Main-owned host-api/proxy
boundary; it makes that boundary enforceable from the renderer shell as an
additional least-privilege constraint.