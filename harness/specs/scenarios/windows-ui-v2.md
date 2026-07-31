---
id: windows-ui-v2
title: Windows UI v2
type: scenario
requiredRules:
  - ui-motion-material-system
  - renderer-loading-experience
  - i18n-locale-coverage
  - docs-sync
pathPatterns:
  - src/App.tsx
  - src/styles/**
  - src/components/layout/**
  - src/components/ui/**
  - src/pages/**
  - shared/i18n/locales/**
---

# Windows UI v2

## Purpose

Give the Windows Electron application a coherent ClawX/Apple split-view shell, fluid material system, and route-driven settings drawer while preserving all existing product workflows.

## Flow

1. Windows resolves UI v2 by default; `?uiVersion=legacy` keeps a development rollback path.
2. The application shell remains mounted while pages and settings sections load.
3. Navigating to `/settings/*` preserves the last non-settings route as a stationary background context and opens a lightweight modal right-side drawer without invalidating the background render tree.
4. Closing settings completes its exit animation before returning to the background route and restoring focus.
5. Existing page functionality remains unchanged while shared page shells, controls, materials, and motion presets provide the new visual language.

## Validation

- `pnpm harness validate --spec harness/specs/tasks/windows-ui-v2-apple-motion.md`
- `pnpm run typecheck`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/windows-ui-v2.spec.ts tests/e2e/settings-drawer.spec.ts`
