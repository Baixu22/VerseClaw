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
  - vite.config.ts
requiredTests:
  - tests/e2e/startup-loading-experience.spec.ts
---

# Renderer Loading Experience

User-visible loading must preserve spatial context instead of replacing the entire desktop window with an isolated generic spinner.

Requirements:

- The first visible application frame uses a theme-matched branded shell.
- Main application chrome remains mounted while route chunks load.
- Route and section fallbacks resemble the destination layout and respect reduced-motion preferences.
- Chat must not render its empty-session welcome state until initial session/history hydration has resolved.
- Cached content stays visible during background refreshes.
- Heavy editor, document viewer, and math rendering chunks are excluded from the renderer startup preload path.

Validation:

- `pnpm run build:vite`
- `pnpm exec vitest run tests/unit/startup-loading-experience.test.tsx`
- `pnpm run test:e2e:run tests/e2e/startup-loading-experience.spec.ts`
