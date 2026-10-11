---
id: renderer
title: Renderer Layer
type: layer-spec
pathPatterns:
  - src/pages/**
  - src/components/**
  - src/stores/**
  - src/lib/**
  - shared/i18n/**
---

Renderer code owns UI state, presentation, and user interaction. Backend calls must go through `src/lib/host-api.ts` or `src/lib/host-api-client.ts`.

User-facing text belongs in `react-i18next` locale files with full locale coverage. Styling should use the design tokens and component conventions documented in `src/styles/globals.css`.

Any user-visible UI change should add or update Electron E2E coverage.
