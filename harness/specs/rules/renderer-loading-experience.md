---
id: renderer-loading-experience
title: Renderer Loading Experience
type: rule
appliesTo:
  - startup-loading-experience
pathPatterns:
  - index.html
  - src/App.tsx
  - src/main.tsx
  - src/components/layout/**
  - src/components/loading/**
  - src/pages/Chat/**
  - src/pages/Settings/**
  - src/pages/Agents/**
  - vite.config.ts
requiredTests:
  - tests/e2e/startup-loading-experience.spec.ts
  - tests/e2e/structural-loading-pilot.spec.ts
---

# Renderer Loading Experience

User-visible loading must preserve spatial context instead of replacing the entire desktop window with an isolated generic spinner.

Requirements:

- The first visible application frame uses a theme-matched branded shell.
- Main application chrome remains mounted while route chunks load.
- Route and section fallbacks resemble the destination layout and respect reduced-motion preferences.
- Ordinary route chunks and Settings sections use a quiet, destination-shaped fallback after 200ms. They do not mount a generic construction matrix.
- Structural data surfaces are explicitly allowlisted by `loading-policy.ts`, with a 200-240ms trigger delay. Fast results skip construction; stable data remains visible during refresh.
- The Agents pilot shares the resolved AgentCard layout with its waiting ghost. Its dot field is clipped to each card, and outlines, measurements and nodes follow actual avatar, identity, model, channel and action bounds.
- Resolved Agents data appears in three bounded groups in reading order. Each group's real regions appear while its corresponding auxiliary regions fade; unrevealed rows retain wireframes. Completion leaves no construction SVG, dots, labels or inert controls.
- Construction is drafted, not revealed. Every boundary, guide, measurement and part outline is stroked from zero length with a near-constant-speed draw, and the wavefront starts at the surface's top-left corner: each element begins by its diagonal distance from that corner, so the right and bottom of a surface draw last and rows cascade. A stroke must never start at its final length, and a strongly decelerating ease that covers most of the path in the first frames is not a draw.
- A measured overlay owns a region's boundary while it is drawing, so a destination ghost must not paint that border first; only regions the canvas actually outlines may hide theirs.
- Every waiting surface uses the same stroke language instead of a sweeping shimmer: the static boot shell, Chat's startup skeleton, route and Settings fallbacks and list skeletons all draw their outlines in reading order. A gradient sweep belongs to streaming content, never to a loading placeholder.
- Reduced motion keeps static waiting geometry and reveals all resolved content immediately. A visual timeline never decides request success, error or cancellation.
- Visual evidence includes non-empty Agents data and structure, partial and complete images in light and dark. Test success alone does not establish fidelity to the design reference. Evidence and visual review are agent-driven and explicitly labelled.
- Chat must not render its empty-session welcome state until initial session/history hydration has resolved.
- Cached content stays visible during background refreshes.
- Heavy editor, document viewer, and math rendering chunks are excluded from the renderer startup preload path.

Validation:

- `pnpm run build:vite`
- `pnpm exec vitest run tests/unit/startup-loading-experience.test.tsx`
- `pnpm run test:e2e:run tests/e2e/startup-loading-experience.spec.ts`
- `pnpm exec playwright test tests/e2e/structural-loading-pilot.spec.ts`
