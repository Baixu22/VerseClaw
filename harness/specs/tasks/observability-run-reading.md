---
id: observability-run-reading
title: Read run steps in the Observability workbench
scenario: windows-ui-v2
intent: Make model calls, tool use and failures readable in the existing Observability route using recorded graph and diagnostic data.
touchedAreas:
  - src/pages/Observability/**
  - src/components/ui/apple-drawer.tsx
  - src/stores/observability.ts
  - shared/i18n/locales/*/observability.json
  - tests/e2e/observability-*.spec.ts
  - tests/e2e/secondary-surfaces-convergence.spec.ts
  - tests/unit/observability-store-lifecycle.test.ts
  - docs/modules/resources-and-observability.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/rules/ui-motion-material-system.md
  - harness/specs/tasks/observability-run-reading.md
requiredRules:
  - renderer-main-boundary
  - ui-motion-material-system
  - i18n-locale-coverage
  - docs-sync
requiredProfiles:
  - fast
  - e2e
requiredTests:
  - pnpm run typecheck:web
  - pnpm run i18n:lint
  - pnpm exec vitest run tests/unit/observability-store-lifecycle.test.ts tests/unit/observability-store-error-sanitize.test.ts tests/unit/observability-graph.test.ts
  - pnpm run test:e2e:run tests/e2e/observability-trace-graph.spec.ts tests/e2e/observability-trace-graph-drawer.spec.ts tests/e2e/observability-quick-locate.spec.ts
acceptance:
  - The existing sidebar entry opens a chronological step list. Model identity, tool names, recorded summaries and failures are legible without opening a drawer.
  - Explicit node links and step clicks open the matching diagnostics. Changing selection cannot attach a previous node's response.
  - Routine events and secondary metrics can be expanded, and graph, tree and swimlane views remain accessible.
  - Chinese desktop and narrow Electron journeys verify run selection, empty steps and return from node detail.
  - View tabs support arrow keys, Home and End. A single-row detail bar keeps summary, issues and events available and recalls the last secondary tab picked from the full list.
---
