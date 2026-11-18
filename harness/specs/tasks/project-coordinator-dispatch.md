---
id: project-coordinator-dispatch
title: TF-0676 Single-project coordinator delegation
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: a1cf565ab
intent: Dispatch a ready project plan task through the existing coordinator, admission and worker owners.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - comms-regression
  - disk-temp-policy
  - docs-sync
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - harness/specs/tasks/project-coordinator-dispatch.md
  - harness/specs/scenarios/autonomy-session-task-scope.md
  - harness/specs/rules/durable-task-system-boundary.md
  - shared/task-system/**
  - shared/types/session-delegation.ts
  - electron/services/session-delegation-admission.ts
  - electron/services/sessions-api.ts
  - electron/services/task-system-service.ts
  - openclaw_runtime/src/agents/**
  - tests/unit/**
  - tests/e2e/project-agent-loop.spec.ts
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
expectedUserBehavior:
  - A coordinator selects a dependency-ready task from the current plan; only one writer may start.
  - A replay returns the original task and admission. A lost receipt requires reconciliation before another spawn.
  - Admission, worker execution and verified task completion remain distinct.
requiredTests:
  - pnpm exec vitest run --config vitest.task-system.config.ts
  - pnpm exec vitest run tests/unit/long-session-delegation-admission.test.ts tests/unit/orchestration-resource-scheduler.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run test:e2e tests/e2e/project-agent-loop.spec.ts
acceptance:
  - Reject foreign scopes, stale generations, unknown budgets and concurrent reservations beyond the cap before spawning.
  - Use the effective role and allowed models; prompts do not expand grants. Fallback stays within the allowed set and budget.
  - An agent-driven Electron run reads actual worker effects, session identity, effective model and usage; missing cost remains unknown.
  - Read back dispatch, model route and reservation evidence on one frozen candidate before closing TF-0676.
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

The first canary is serial. The Task Ledger owns the current plan, dependencies and writer claim; session delegation owns the admission intent and replay; the Runtime owns effective grants, budgets and worker execution.
