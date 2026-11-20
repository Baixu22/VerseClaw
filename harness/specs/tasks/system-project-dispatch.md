---
id: system-project-dispatch
title: TF-0684 Scoped project dispatch and global pause
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: e0175b238
intent: Reuse project coordinator dispatch, resource admission and Workspace ownership for bounded cross-project execution.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - autonomy-resource-owner-admission
  - renderer-main-boundary
  - contract-first-boundary
  - comms-regression
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
  - e2e
touchedAreas:
  - shared/types/system-portfolio.ts
  - shared/types/system-control.ts
  - shared/system-execution-control.ts
  - shared/workspace-runtime-permissions.ts
  - electron/utils/workspace-runtime-permissions.ts
  - shared/host-api/contract.ts
  - shared/host-api/host-action-timeouts.ts
  - shared/task-system/project-coordinator.ts
  - electron/services/project-execution-scope.ts
  - electron/services/system-project-dispatch.ts
  - electron/services/workspaces-api.ts
  - electron/services/sessions-api.ts
  - electron/services/gateway-api.ts
  - electron/services/resource-fabric.ts
  - electron/main/ipc-handlers.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - openclaw_runtime/src/agents/execution-checkout-tools.ts
  - openclaw_runtime/src/agents/project-runtime-policy.ts
  - openclaw_runtime/src/gateway/server-methods/agent.ts
  - openclaw_runtime/src/agents/openclaw-tools.ts
  - openclaw_runtime/src/agents/tools/transcripts-tool.ts
  - tests/unit/system-transcript-control.test.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/subagent-spawn.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/mission-control/controller.ts
  - tests/unit/project-runtime-policy.test.ts
  - src/lib/host-api.ts
  - src/components/agents/SystemPortfolioPanel.tsx
  - shared/i18n/locales/*/agents.json
  - tests/unit/system-project-dispatch.test.ts
  - tests/unit/project-execution-scope.test.ts
  - tests/unit/workspaces-api.test.ts
  - tests/unit/durable-task-project-planning.test.ts
  - tests/unit/session-task-scope-completion.test.ts
  - tests/unit/gateway-permissions-api.test.ts
  - tests/unit/long-session-delegation-admission.test.ts
  - tests/unit/resource-fabric*.test.ts
  - tests/e2e/system-agent-portfolio.spec.ts
  - harness/specs/tasks/system-project-dispatch.md
  - harness/specs/scenarios/autonomous-project-system.md
  - harness/specs/rules/autonomy-resource-owner-admission.md
  - harness/specs/fixtures/autonomous-project-system/s2/**
  - scripts/repository-artifacts.json
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
expectedUserBehavior:
  - The system submits a versioned project intent without switching the active UI workspace.
  - Each coordinator retains its task plan, permissions, budget and acceptance authority.
  - Global pause prevents new dispatch and new managed effects; already admitted effects may settle.
  - Three contending projects receive bounded, attributable admission through the existing fair resource queue.
acceptance:
  - Two project tasks execute through actual Gateway workers with independent effects and failure outcomes.
  - Explicit scope, plan revision, generation and permission are rechecked before dispatch; foreign scopes and stale requests are rejected.
  - Global pause uses the Workspace mutation barrier and a durable revision. Project resume cannot override it.
  - Fair queuing, request replay, unavailable budget, lost admission and pause races have deterministic owner evidence without duplicate reservations or retry storms.
  - User-visible dispatch, pause and errors have four locales and Electron coverage. Routine failures remain attributable project results.
requiredTests:
  - pnpm exec vitest run tests/unit/system-project-dispatch.test.ts tests/unit/project-execution-scope.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/project-runtime-policy.test.ts tests/unit/session-task-scope-completion.test.ts tests/unit/gateway-permissions-api.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:runtime
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/system-agent-portfolio.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/system-project-dispatch.md
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

Main establishes a scoped execution context only for a persisted coordinator and
matching generation. It is never a renderer-supplied authorization token. The
existing gateway permission path consumes that project's policy and the Task
owner decides completion. Workspace owns the versioned global pause, and Runtime
reads the persisted owner before new managed side effects. Read, reconciliation,
stop and cancellation remain available while paused. No new task, billing or
notification database is introduced.
