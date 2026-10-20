---
lifecycleStatus: archived
id: startup-loading-experience
title: Branded startup and route loading experience
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace blank/full-screen spinner startup states with a stable branded shell, make Settings navigation immediately responsive, expose chat startup hydration explicitly, and keep heavy editor/document/math chunks out of the renderer startup path without changing Gateway transport or fallback semantics.
touchedAreas:
  - harness/specs/tasks/startup-loading-experience.md
  - harness/specs/rules/renderer-loading-experience.md
  - index.html
  - vite.config.ts
  - electron/main/index.ts
  - src/main.tsx
  - src/App.tsx
  - src/components/layout/MainLayout.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/loading/**
  - src/pages/Settings/**
  - src/pages/Agents/**
  - src/styles/structural-loading.css
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/stores/chat/types.ts
  - shared/i18n/locales/*/chat.json
  - shared/i18n/locales/*/settings.json
  - scripts/check-renderer-startup-chunks.mjs
  - tests/e2e/startup-loading-experience.spec.ts
  - tests/e2e/structural-loading-pilot.spec.ts
  - tests/unit/startup-loading-experience.test.tsx
  - tests/unit/agents-structural-loading.test.tsx
expectedUserBehavior:
  - The first visible desktop frame is a theme-matched Verse shell rather than a blank page or isolated full-screen spinner.
  - Main layout chrome remains mounted while lazy routes load; only the route content area shows a quiet destination-shaped fallback.
  - Slow initial Agents data loading constructs actual card geometry and hands it to three groups of real rows without moving navigation, header or actions.
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
  - tests/e2e/structural-loading-pilot.spec.ts
  - tests/unit/startup-loading-experience.test.tsx
  - tests/unit/agents-structural-loading.test.tsx
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
  - The Agents ghost and complete rows share layout geometry; measurements come from actual DOM bounds and dots stay clipped to individual cards.
  - Actual resolved rows and unfinished wireframes coexist during the three-group handoff, with region-specific fading and no construction artifacts at completion.
  - The waiting geometry is drawn, not surfaced: a wavefront starts at the top-left corner, every boundary, guide, measurement and part outline travels from zero length by its diagonal distance, and rows cascade before any content is revealed.
  - One drawing language covers every waiting surface: the first-paint boot shell, Chat's startup skeleton, route and Settings fallbacks and list skeletons draw outlines instead of sweeping a shimmer, and no loading placeholder keeps a gradient sweep.
  - Agent-driven evidence contains non-empty fixture data and structure, partial and complete screenshots for light and dark, plus a deterministic stroke-timeline capture and fast-load, refresh, reduced-motion and narrow-window checks.
docs:
  required: false
---

## Implementation notes

The static boot shell is non-interactive and contains no user-facing text. It is themed from the persisted window theme and hands off to the first mounted MainLayout or Setup shell. Route and Settings section fallbacks are quiet and delayed. Structural data surfaces are selected by `loading-policy.ts`; the reference-quality redesign is currently scoped to Agents. `AgentCardFrame` supplies both placeholder and real geometry, and `AgentsLoadingSurface` measures semantic parts and stages actual rows in three groups within 660ms. Every revealed group's field and individual parts fade locally. Reduced motion removes staging; fast responses skip construction. Other allowlisted surfaces retain their previous implementation and are not covered by Agents visual evidence.

Construction strokes use `pathLength="1"` with a normalized dash offset, so each line is drawn from zero length rather than appearing at its final form. The trace easing is near-linear (`cubic-bezier(0.25, 0.1, 0.55, 0.95)`); the shared expo-out `--ease-ui-out` finishes most of a path in the first frames and must not be used for drawing. Rows cascade by 80ms, and a card builds boundary → guides → icon → title → detail → channels → actions, with nodes and measurement labels arriving after their own stroke. Page-level structural overlays stagger region outlines by reading order and reveal each region's fill only after its boundary has travelled; regions the canvas draws suppress their own ghost border while constructing. The stroke timeline is asserted by freezing the CSS animations in Electron and sampling normalized offsets, so it does not depend on machine speed.

Every other waiting placeholder shares that stroke language through `SketchBlock` (`src/components/loading/StructuralSketch.tsx`): it measures its slot, draws the slot's real radius from zero length, and derives a reading-order delay from neighbouring sketches. Chat's startup skeleton, the route and Settings loading shells and the shared list/card skeletons use it instead of a shimmer. The first-paint `#boot-shell` in `index.html` carries the same motion as inline critical CSS (`@keyframes boot-draw`, 380ms, near-linear, staggered by `--boot-delay`), because it renders before the bundle loads; its line placeholders use percentage geometry so a pill keeps semicircular ends at any width. `ShimmerBlock` stays reserved for streaming content.

Chat startup hydration remains an observation/orchestration layer over the existing loadSessions and loadHistory behavior. It must not change Main-owned Gateway transport or existing startup retry and transcript fallback semantics.
