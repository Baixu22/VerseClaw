---
lifecycleStatus: completed
id: session-task-scope-admission
title: Repair the session delegation task-scope contract and Main admission path
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 9627d3c093739adf53a6fda710efe63785581189
intent: Finish the A4 delegation admission slice by reusing its dependency contract and resolving the explicitly requested task among all same-session links.
ownedPaths:
  - electron/services/sessions-api.ts
  - electron/services/session-delegation-admission.ts
  - shared/session-task-scope.ts
  - tests/unit/session-task-scope.test.ts
  - tests/unit/long-session-delegation-admission.test.ts
  - harness/specs/tasks/session-task-scope-admission.md
  - harness/specs/fixtures/session-task-scope-admission/**
  - docs/modules/multi-agent-and-tasks.md
touchedAreas:
  - electron/services/sessions-api.ts
  - electron/services/session-delegation-admission.ts
  - shared/session-task-scope.ts
  - tests/unit/session-task-scope.test.ts
  - tests/unit/long-session-delegation-admission.test.ts
  - harness/specs/tasks/session-task-scope-admission.md
  - harness/specs/fixtures/session-task-scope-admission/**
  - docs/modules/multi-agent-and-tasks.md
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - autonomy-session-task-scope-boundary
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - Delegation resolves its explicit task from the current session's Task Ledger links before calling Gateway.
  - An unrelated link does not hide the requested valid link.
  - Missing tasks and missing, foreign-session or stale-generation links reject before Gateway admission.
acceptance:
  - Main and injected resolvers share SessionDelegationDependencies.resolveTaskScope without casts or a second request shape.
  - Regression tests exercise createSessionsApi's default Task Ledger resolver, including accepted, missing-task, missing-link, foreign-session, stale-generation and multiple-link cases.
  - Focused unit, node/test type, lint, contract, comms and diff-aware Harness results are retained with source hashes and agent attribution.
requiredTests:
  - pnpm exec vitest run tests/unit/session-task-scope.test.ts tests/unit/long-session-delegation-admission.test.ts tests/unit/long-session-coordinator-binding.test.ts --maxWorkers=1
  - pnpm run typecheck:node
  - pnpm run typecheck:test
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-task-scope-admission.md
  - pnpm harness run --spec harness/specs/tasks/session-task-scope-admission.md --dry-run
docs:
  required: true
  files:
    - docs/modules/multi-agent-and-tasks.md
---

This repair contributes to `autonomy-session-task-scope`. Its admission proof uses the
existing Main service and Task Ledger snapshot owner. The wider A4 discussion-to-execution
and fork/handoff journeys remain in that task's acceptance contract.
