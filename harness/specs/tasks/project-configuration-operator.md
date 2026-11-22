---
id: project-configuration-operator
title: TF-0685 Preview apply and verify bounded project configuration
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: d19b3a7cf
intent: Apply typed project-agent configuration through the existing config mutex and require loaded Runtime readback or compensating rollback.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - contract-first-boundary
  - active-config-guards
  - renderer-main-boundary
  - comms-regression
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
  - e2e
touchedAreas:
  - shared/project-configuration.ts
  - shared/host-api/contract.ts
  - shared/host-api/host-action-timeouts.ts
  - electron/services/project-configuration-operator.ts
  - electron/services/workspaces-api.ts
  - openclaw_runtime/src/gateway/server-methods/runtime-flag-ack.ts
  - src/lib/host-api.ts
  - src/components/agents/ProjectConfigurationPanel.tsx
  - src/components/agents/SystemPortfolioPanel.tsx
  - shared/i18n/locales/*/agents.json
  - tests/unit/project-configuration-operator.test.ts
  - tests/unit/workspaces-api.test.ts
  - tests/e2e/project-configuration-operator.spec.ts
  - harness/specs/tasks/project-configuration-operator.md
  - harness/specs/scenarios/autonomous-project-system.md
  - harness/specs/fixtures/autonomous-project-system/s3/**
  - scripts/repository-artifacts.json
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
expectedUserBehavior:
  - A project with an exclusive agent binding previews its model, denied tools and context quota before applying a typed change.
  - Existing configured models require known non-increasing prices; tool restrictions and context quota may only be tightened by the operator.
  - Desired, configured and loaded effective values remain separate. Reload failure compensates only the fields written by this operation.
  - Shared-agent projects explain the scope conflict; raw secrets, approval policy, evaluator and global defaults are rejected.
acceptance:
  - A valid project patch reaches the loaded Runtime configuration and the UI shows the same safe values and runtime generation.
  - Schema errors, stale config or owner revision, conflicting request IDs, shared agent scope, unknown prices and permission expansion are refused before writing.
  - Preview is read-only. A failed reload restores the previous touched fields and verifies the restored Runtime value; a concurrent change is preserved and produces degraded state.
  - Pending operations survive restart and block new writes until reconciled. Credentials never enter previews, receipts or logs.
  - Agent-driven unit and Electron evidence binds the fixed source, command results and artifact hashes, including real reload and injected failure paths.
requiredTests:
  - pnpm exec vitest run tests/unit/project-configuration-operator.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:runtime
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/project-configuration-operator.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/project-configuration-operator.md
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/modules/multi-agent-and-tasks.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

The existing OpenClaw config is the configured-value authority. Workspace retains
only bounded operation receipts and safe backups of the fields being changed.
Reload runs outside the config mutex; rollback compares the exact touched fields
before restoring them. The Runtime acknowledgement is built from its loaded config,
not config.get's on-disk snapshot. Global defaults, credentials and product locks
remain outside this operator's typed patch.
