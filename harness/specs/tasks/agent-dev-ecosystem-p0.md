---
lifecycleStatus: archived
id: agent-dev-ecosystem-p0
title: Agent Dev ecosystem P0 regularization guardrails
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Consolidate Agent Dev scenarios, add contract and i18n validation gates, and expose a single local validation entry point without bypassing renderer/Main boundaries.
touchedAreas:
  - shared/agent-dev/scenarios.ts
  - shared/agent-dev/scenario-composer.ts
  - shared/host-api/contract.ts
  - shared/host-api/agent-dev-schemas.ts
  - electron/services/agent-dev-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/lib/agent-dev.ts
  - scripts/agent-dev-workbench.mjs
  - scripts/contract-check.mjs
  - scripts/i18n-lint.mjs
  - tests/unit/agent-dev-scenario-composer.test.ts
  - tests/unit/contract-check.test.ts
  - tests/unit/i18n-lint.test.ts
  - tests/e2e/agent-dev-quality.spec.ts
  - docs/agent-dev-ecosystem-regularization-plan.md
  - docs/agent-dev-control-plane.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - package.json
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - docs-sync
  - workspace-harness-single-source
expectedUserBehavior:
  - Existing single Agent Dev scenarios remain available through `?devScenario=<id>` and E2E helpers.
  - Composed scenarios such as `?devScenario=chat-streaming+models-heavy-usage` seed deterministic combined state without crashing on unknown ids.
  - Agent Dev scripts and host-api services read scenario ids from one shared registry.
  - Local validation can run contract, i18n, harness, and Agent Dev E2E gates from `pnpm agent-dev:validate`.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/agent-dev-scenario-composer.test.ts
  - tests/unit/contract-check.test.ts
  - tests/unit/i18n-lint.test.ts
  - tests/unit/agent-dev-api.test.ts
  - tests/unit/agent-dev-schemas.test.ts
  - tests/unit/host-api-facade.test.ts
acceptance:
  - Agent Dev scenario definitions live in a shared registry and are consumed by renderer, Main, and workbench code.
  - Scenario composition supports `+` separated ids, later scenarios overriding the same seed slices, and query override metadata.
  - Runtime validation still rejects invalid mutating Agent Dev payloads.
  - `pnpm contract:check` reports host-api contract/facade/service and Agent Dev registry drift with readable locations.
  - `pnpm i18n:lint` reports locale namespace/key drift and unknown `useTranslation()` namespaces.
  - `pnpm agent-dev:validate` executes the P0 gates in contract, i18n, harness, then Agent Dev E2E order.
  - Documentation records the P0 landing shape, and README locale files are reviewed for sync needs.
docs:
  required: true
---

Use this spec for the P0 Agent Dev regularization work only. Do not include P1/P2/P3 scaffold expansion, scenario recording, workbench productization, trace timeline, cost simulator, or skill sandbox work.
