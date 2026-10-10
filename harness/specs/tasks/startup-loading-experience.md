---
lifecycleStatus: archived
id: startup-loading-experience
title: Branded startup and route loading experience
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace blank/full-screen spinner startup states with a stable branded shell, make Settings navigation immediately responsive, expose chat startup hydration explicitly, and keep heavy editor/document/math chunks out of the renderer startup path without changing Gateway transport or fallback semantics.
touchedAreas:
  - harness/specs/tasks/startup-loading-experience.md
  - index.html
  - vite.config.ts
  - electron/main/index.ts
  - src/main.tsx
  - src/App.tsx
  - src/components/layout/MainLayout.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/loading/**
  - src/pages/Settings/**
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/stores/chat/types.ts
  - shared/i18n/locales/*/chat.json
  - shared/i18n/locales/*/settings.json
  - scripts/check-renderer-startup-chunks.mjs
  - tests/e2e/startup-loading-experience.spec.ts
  - tests/unit/startup-loading-experience.test.tsx
expectedUserBehavior:
  - The first visible desktop frame is a theme-matched Verse shell rather than a blank page or isolated full-screen spinner.
  - Main layout chrome remains mounted while lazy routes load; only the route content area shows a structure-matched fallback.
  - Opening Settings immediately shows its header and overview shell, while heavy sections load locally inside the Settings content area.
  - Chat shows a conversation-shaped skeleton while Gateway, sessions, or initial history are unresolved and shows the welcome screen only after an empty history result is confirmed.
  - Cached conversations remain visible during quiet refreshes and uncached session switches replace only the message area with a skeleton.
  - Reduced-motion users receive static loading surfaces.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - i18n-locale-coverage
  - renderer-loading-experience
  - gateway-readiness-policy
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
requiredTests:
  - pnpm run typecheck
  - pnpm run build:vite
  - tests/e2e/startup-loading-experience.spec.ts
  - tests/unit/startup-loading-experience.test.tsx
acceptance:
  - No root-level generic loading spinner replaces the whole application window during ordinary startup or route loading.
  - MainLayout remains mounted while Chat or another main route chunk is pending.
  - Settings overview and page header are synchronously available; section-level lazy loading preserves the header, back navigation, and scroll container.
  - Chat startup state distinguishes waiting-for-gateway, loading-sessions, loading-history, ready, and error without changing transport selection, retry budgets, transcript fallback, or session selection.
  - WelcomeScreen is rendered only when startup hydration is ready and the resolved message list is empty.
  - Warm refreshes do not use the previous full-page blur/spinner overlay.
  - All new user-facing status text has aligned en, zh, ja, and ru keys.
  - Renderer continues to use existing stores and host-api/api-client boundaries; no direct IPC, Gateway HTTP, or renderer-owned protocol switching is introduced.
  - dist/index.html does not preload editor, document-viewers, math-rendering, or ArtifactPanel chunks; initial preloaded JavaScript remains within the checked startup budget.
  - Existing dynamic-import recovery behavior remains intact.
docs:
  required: false
---

## Implementation notes

The static boot shell is non-interactive and contains no user-facing text. It is themed from the persisted window theme and hands off to the first mounted MainLayout or Setup shell. Renderer loading surfaces reuse existing design tokens, DotMatrix, and ShimmerBlock primitives with reduced-motion fallbacks.

Chat startup hydration remains an observation/orchestration layer over the existing loadSessions and loadHistory behavior. It must not change Main-owned Gateway transport or existing startup retry and transcript fallback semantics.
