---
id: windows-ui-v2
title: Cross-platform FakeCoding UI v2
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

# Cross-platform FakeCoding UI v2

## Purpose

Give the Electron application a coherent FakeCoding-aligned grayscale shell, compact control system, and route-driven settings surface while preserving all existing product workflows.

## Flow

1. Windows, macOS, and Linux resolve UI v2 by default; `?uiVersion=legacy` keeps a development rollback path during migration.
2. The application shell remains mounted while pages and settings sections load.
3. Navigating to `/settings/*` preserves route and focus behavior while using the platform-appropriate settings surface without invalidating the background render tree.
4. Closing settings completes its exit animation before returning to the background route and restoring focus.
5. Existing page functionality remains unchanged while shared page shells, compact controls, grayscale materials, migrated SVGs, and restrained motion provide the new visual language.

## Validation

- `pnpm harness validate --spec harness/specs/tasks/windows-ui-v2-apple-motion.md`
- `pnpm run typecheck`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/windows-ui-v2.spec.ts tests/e2e/settings-drawer.spec.ts`
