---
id: project-coordinator-planning
title: TF-0675 Project coordinator plans and revisions
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 2a62eb731
intent: Persist project goals, verifiable task criteria and explicit plan revisions in the existing Task Ledger owner.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - comms-regression
  - disk-temp-policy
  - docs-sync
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - harness/specs/tasks/project-coordinator-planning.md
  - harness/specs/rules/durable-task-system-boundary.md
  - harness/specs/scenarios/autonomy-session-task-scope.md
  - harness/specs/fixtures/autonomous-project-system/p1/**
  - shared/task-system/**
  - electron/gateway/process-launcher.ts
  - electron/services/task-system-service.ts
  - electron/services/workspaces-api.ts
  - openclaw_runtime/src/agents/tools/persistent-task-tool.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/SessionTaskDock.tsx
  - shared/i18n/locales/*/taskLedger.json
  - tests/unit/durable-task-project-planning.test.ts
  - tests/unit/durable-task-session-scope.test.ts
  - tests/unit/durable-task-start.test.ts
  - tests/e2e/project-agent-loop.spec.ts
  - docs/modules/multi-agent-and-tasks.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
expectedUserBehavior:
  - A coordinator saves a plan with task dependencies, acceptance criteria and a next action after an explicit planning request.
  - A retried request reuses its result; a new goal has independent identity. Revisions preserve old tasks and evidence.
  - The project reads the same Ledger plan and revision history; ordinary discussion creates no plan.
requiredTests:
  - pnpm exec vitest run --config vitest.task-system.config.ts
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e tests/e2e/project-agent-loop.spec.ts
acceptance:
  - An agent-driven user goal goes through the actual Gateway tool and results in durable tasks, dependencies and acceptance with a project readback.
  - Assumptions remain provisional and scope decisions stay pending. Reject foreign projects, stale generations, conflicting requests, cycles and replacement of unsettled work.
  - Revision history identifies affected tasks and retains old evidence without reusing it for the new plan. Disk evidence identifies actor, inputs, candidate, command exit and artifact digests.
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

Planning uses the existing coordinator session and grants no task execution claim. Revision requires an explicit reason and the expected contract version.
