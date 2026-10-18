---
lifecycleStatus: active
id: execution-environment-settings
title: Execution Environment Settings and Scenario Verification (TF-0382)
type: task
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - shared/types/sandbox.ts
  - electron/services/sandbox-api.ts
  - src/pages/Settings/index.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/e2e/settings-sandbox-environment.spec.ts
  - harness/specs/tasks/execution-environment-settings.md
  - harness/specs/fixtures/tf0382-execution-environment-settings/**
---

# TF-0382 Execution Environment Settings and Scenario Verification

## Objective

Expose the resolved execution environment in Settings so a user can see the
actual backend, guarantee, network and approval posture, including degradation
reason, without reading a document or opening a new permission surface.

## Scope

- Sandbox status carries the resolved `executionEnvironment`.
- Settings shows backend, guarantee, network and approval fields.
- A degraded strong request keeps the effective `policy` guarantee visible and
  shows the owner-supplied reason instead of hiding the fallback.
- All new copy is translated in en/zh/ja/ru.
- No new permission entry, provider, management console or default change is
  introduced.

## Acceptance

- `pnpm typecheck` passes.
- `pnpm run i18n:lint` passes.
- `pnpm run test:e2e:run tests/e2e/settings-sandbox-environment.spec.ts` passes
  on Windows under Node 24.16.0.
- The E2E covers ordinary policy-light and unavailable strong isolation.
- `pnpm harness validate --spec harness/specs/tasks/execution-environment-settings.md` passes.
- `git diff --check` passes.

## Notes

The UI consumes existing status data. Receipts are agent-driven; no real-human
evidence is claimed.
