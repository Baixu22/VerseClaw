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

1. Windows, macOS and Linux use UI v2; the temporary visual rollback is retired after TF-0027. Old query values resolve to the current shell.
2. The application shell remains mounted while pages and settings sections load.
3. Navigating to `/settings/*` uses the shared full-page Settings chrome and remembers the application return route.
4. Returning from Settings restores the remembered application route and focus.
5. Existing page functionality remains unchanged while shared page shells, compact controls, grayscale materials, migrated SVGs, and restrained motion provide the new visual language.
6. Knowledge has Library and Review Queue as its two primary views. Inbox, Draft and Proposal records remain projections of the existing knowledge service. More > Maintenance and Source tools preserve advanced operations. Documents open in Preview; editing is explicit, and a 960px window shows only one editor pane. The Chat knowledge mode preserves local conversation checkpoints and returns to Library or governed review with its source context.

## Validation

- `pnpm harness validate --spec harness/specs/tasks/windows-ui-v2-apple-motion.md`
- `pnpm run typecheck`
- `pnpm run build:vite`
- `pnpm run test:e2e:run tests/e2e/windows-ui-v2.spec.ts tests/e2e/settings-drawer.spec.ts`
