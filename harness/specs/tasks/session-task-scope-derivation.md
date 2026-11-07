---
id: session-task-scope-derivation
title: Preserve explicit task links when deriving a session
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: dab184890
intent: Keep fork and handoff task references in the Main-owned Task Ledger path so derived sessions can resolve their existing tasks.
ownedPaths:
  - electron/services/sessions-api.ts
  - src/lib/workspace-session.ts
  - tests/unit/host-services.test.ts
  - tests/unit/workspace-session.test.ts
  - tests/e2e/session-task-scope-derivation.spec.ts
  - harness/specs/tasks/session-task-scope-derivation.md
  - harness/specs/scenarios/autonomy-session-task-scope.md
  - harness/specs/fixtures/session-task-scope-derivation/**
  - docs/modules/multi-agent-and-tasks.md
touchedAreas:
  - electron/services/sessions-api.ts
  - src/lib/workspace-session.ts
  - tests/unit/host-services.test.ts
  - tests/unit/workspace-session.test.ts
  - tests/e2e/session-task-scope-derivation.spec.ts
  - harness/specs/tasks/session-task-scope-derivation.md
  - harness/specs/scenarios/autonomy-session-task-scope.md
  - harness/specs/fixtures/session-task-scope-derivation/**
  - docs/modules/multi-agent-and-tasks.md
requiredRules:
  - identity-scope-boundary
  - renderer-main-boundary
  - backend-communication-boundary
  - autonomy-session-task-scope-boundary
  - comms-regression
  - docs-sync
  - task-forest-autoclose-and-roles
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - Fork and handoff retain the source session's explicit business-task references in the same workspace.
  - Missing tasks, another session's links, turn checks and stale-generation links are not inherited.
  - A fork records its own runtime generation; a pending handoff uses no parent generation.
  - Derived references are read-only, and existing task completion state is preserved.
acceptance:
  - Main persists lineage and deduplicated task links through the existing Task Ledger service.
  - Renderer does not maintain a second fork-lineage writer.
  - Actual Main service and Electron host-path tests read back task links, unchanged task states and unavailable coordinator authority in a fork.
  - Scoped unit, type, lint, contract, build, Electron, comms and diff-aware Harness evidence names its candidate and agent actor.
requiredTests:
  - pnpm exec vitest run tests/unit/host-services.test.ts tests/unit/workspace-session.test.ts tests/unit/session-task-scope.test.ts tests/unit/long-session-delegation-admission.test.ts tests/unit/long-session-coordinator-binding.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run typecheck:test
  - pnpm run contract:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/session-task-scope-derivation.spec.ts --workers=1
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-task-scope-derivation.md
  - pnpm harness run --spec harness/specs/tasks/session-task-scope-derivation.md --dry-run
docs:
  required: true
  files:
    - docs/modules/multi-agent-and-tasks.md
  note: README translations describe the existing fork and handoff entry points; the task-reference persistence contract is documented in the module guide.
---

This slice completes task-reference preservation for the A4 session-derivation path.
Execution admission remains owned by the current coordinator and Gateway permission
services. The A4 parent retains automatic business-task creation and writer-claim
journeys as separate acceptance items.
