---
lifecycleStatus: completed
id: context-orchestrator-authority-closure
title: Close the context orchestrator, VToken and C6 authority boundary
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Close TF-0493 by proving one context assembly authority, one budget ledger per turn and one final receipt per model call, while internalizing VToken and C6 rather than exposing parallel product controls.
dependsOnTasks:
  - TF-0492
diffBase: cae93eaf3
ownedPaths:
  - harness/specs/tasks/context-orchestrator-authority-closure.md
  - docs/clawx-product-semantics.md
  - docs/dev/context-orchestrator.md
  - docs/dev/component-disposition-matrix-20261021.md
  - docs/dev/default-config-matrix.md
  - harness/specs/rules/vtoken-foundation-boundary.md
  - shared/component-authority-manifest.ts
  - shared/dcs/component-disposition-catalog.ts
  - shared/dcs/prod-flags-catalog.ts
  - docs/generated/catalogs/prod-flags.md
  - src/pages/Settings/index.tsx
  - src/components/settings/ContextLayersExplainer.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/unit/context-authority-closeout.test.ts
  - tests/unit/context-orchestrator-entry-scan.test.ts
  - tests/unit/component-disposition-catalog.test.ts
  - tests/unit/component-authority-manifest.test.ts
  - tests/unit/default-config-matrix.test.ts
  - tests/unit/first-product-claims.test.ts
  - harness/specs/fixtures/context-orchestrator-authority/**
touchedAreas:
  - harness/specs/tasks/context-orchestrator-authority-closure.md
  - docs/dev/context-orchestrator.md
  - docs/dev/component-disposition-matrix-20261021.md
  - docs/dev/default-config-matrix.md
  - harness/specs/rules/vtoken-foundation-boundary.md
  - shared/component-authority-manifest.ts
  - shared/dcs/component-disposition-catalog.ts
  - shared/dcs/prod-flags-catalog.ts
  - docs/generated/catalogs/prod-flags.md
  - src/pages/Settings/index.tsx
  - src/components/settings/ContextLayersExplainer.tsx
  - src/components/settings/VtokenBridgePanel.tsx
  - shared/i18n/locales/**
  - tests/unit/context-authority-closeout.test.ts
  - tests/unit/context-orchestrator-entry-scan.test.ts
  - tests/unit/component-disposition-catalog.test.ts
  - tests/unit/component-authority-manifest.test.ts
  - tests/unit/default-config-matrix.test.ts
  - tests/unit/first-product-claims.test.ts
  - tests/unit/vtoken-bridge-panel.test.tsx
  - tests/e2e/vtoken-bridge-settings.spec.ts
  - harness/specs/fixtures/context-orchestrator-authority/**
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - vtoken-foundation-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - One Context Orchestrator remains the final candidate selector, budget consumer, projector and lineage recorder.
  - VToken remains an internal working-context packing strategy without a renderer bridge switch or independent product panel.
  - C6 is an explicit internal API or retired path, never a permanent user-level opt-in.
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.unit-src.config.ts src/context-engine/context-orchestrator.test.ts src/context-engine/context-orchestrator.compass.test.ts src/context-engine/context-candidate.test.ts src/context-engine/turn-injection-budget.test.ts src/context-engine/chat-turn-vtoken-injection.test.ts src/context-engine/rc03-seal.test.ts src/context-engine/rc03-seal-wiring.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/rc03-entry-transitions.acceptance.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/context-authority-closeout.test.ts tests/unit/context-orchestrator-entry-scan.test.ts tests/unit/component-disposition-catalog.test.ts tests/unit/component-authority-manifest.test.ts tests/unit/default-config-matrix.test.ts tests/unit/first-product-claims.test.ts --maxWorkers=1
  - pnpm vtoken:test
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/developer-mode.spec.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm catalogs:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/context-orchestrator-authority-closure.md
  - git diff --check
plannedTests:
  - tests/unit/context-authority-closeout.test.ts
acceptance:
  - Every turn has one shared budget ledger and every actual model call has one immutable final request/receipt snapshot.
  - Tool loop, retry, provider fallback, compact, fork and handoff remain inside that lineage without false duplicate-assembly reports.
  - C6 has an explicit internal API disposition or retirement; no permanent user-level opt-in remains.
  - VToken has no renderer bridge switch or independent product panel and production packing is stateless.
  - Off/on prompt parity, candidate lineage and rollback remain fail-closed under the enhancement kill switch.
  - The final provider request is checked against the sealed context bundle and its correlated wire receipt by the existing owner.
docs:
  required: true
  files:
    - docs/dev/context-orchestrator.md
    - docs/dev/default-config-matrix.md
    - docs/dev/component-disposition-matrix-20261021.md
---

# Close the context orchestrator, VToken and C6 authority boundary

TF-0493 closes the remaining component-graduation boundary around the existing Context Orchestrator. It does not add a context manager, memory database, provider transport or product default. The source stores keep their domain ownership; the orchestrator remains the only final selector, deduplicator, budget consumer, projector and lineage recorder.

VToken remains an internal pack strategy with its existing stateless production request and host bridge diagnostics. The renderer must not expose a separate bridge toggle or product panel. C6 remains an internal assembler request API rather than a permanent product opt-in.

Per-model-call sealing, receipt correlation and the tool-loop/retry/fallback/compact/fork/handoff matrix are owned by the existing RC-03 seal and production-entry tests. This task reads those results alongside the context authority scans and component catalogs.
