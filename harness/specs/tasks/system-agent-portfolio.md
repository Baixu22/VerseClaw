---
id: system-agent-portfolio
title: TF-0683 System portfolio reads project owners independently
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: a8f207f207d75c44c6cb6cbebcb8c312b1595394
intent: Expose a read-only system view of registered projects, their coordinator, task plan, evidence references and observed resource state.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - renderer-main-boundary
  - contract-first-boundary
  - api-client-transport-policy
  - disk-temp-policy
  - comms-regression
  - docs-sync
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
  - e2e
touchedAreas:
  - harness/specs/tasks/system-agent-portfolio.md
  - harness/specs/scenarios/autonomous-project-system.md
  - shared/types/system-portfolio.ts
  - shared/host-api/contract.ts
  - electron/services/workspaces-api.ts
  - electron/services/system-portfolio.ts
  - src/lib/host-api.ts
  - src/stores/system-portfolio.ts
  - src/components/agents/SystemPortfolioPanel.tsx
  - src/components/agents/RolesOrchestrationPanel.tsx
  - src/components/layout/Sidebar.tsx
  - src/App.tsx
  - shared/i18n/locales/*/agents.json
  - tests/unit/system-portfolio.test.ts
  - tests/unit/system-portfolio-store.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/roles-orchestration-panel.test.tsx
  - tests/e2e/system-agent-portfolio.spec.ts
  - harness/specs/fixtures/autonomous-project-system/s1/**
  - scripts/repository-artifacts.json
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - System scope shows all registered projects without activating them or dispatching work.
  - Each project shows its own loading, unavailable or observed state; refresh failures preserve the last observation as stale.
  - Project links enter the persisted project coordinator. Browser back retains the portfolio filter and observations.
  - Resource and cost values without attributable owner observations are shown as unknown.
acceptance:
  - Two project plans and their task, session and evidence references are read from the existing owners, with no cross-project leakage.
  - An unavailable project does not erase other projects; a late response cannot replace a newer project identity or refresh.
  - Four languages, light and dark themes, narrow window and keyboard navigation pass Electron checks.
  - Read-only refresh performs no task dispatch, configuration mutation or workspace activation. Ambiguous and stale coordinator bindings are unavailable.
  - Agent-driven evidence records the fixed source candidate, owner readbacks, commands, failures and artifact hashes.
requiredTests:
  - pnpm exec vitest run tests/unit/system-portfolio.test.ts tests/unit/system-portfolio-store.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/system-agent-portfolio.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/system-agent-portfolio.md
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

The portfolio is a projection of Workspace, TaskSystemStore and resource owners.
It retains references and observation timestamps, never a second task database or
transcript copy. Project identity comes from the requested persisted workspace,
independently of the active workspace. The system read surface grants no execution
authority; later scheduling remains a separate task contract.
