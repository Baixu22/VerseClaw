---
id: autonomy-project-continuity
title: TF-0686 Preserve accepted project context across coordinator changes
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 208ad0c36
intent: Keep task constraints, decisions, evidence references and next action attached to their current owners across handoff and compaction.
requiredRules:
  - backend-communication-boundary
  - identity-scope-boundary
  - durable-task-system-boundary
  - context-family-boundary
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - shared/long-session-continuity.ts
  - shared/task-system/store.ts
  - electron/services/chat-api.ts
  - electron/services/task-ledger-working-context.ts
  - tests/unit/task-ledger-working-context-single-source.test.ts
  - tests/unit/autonomy-context-paired.test.ts
  - tests/unit/fixtures/autonomy-context-baseline.json
  - tests/unit/long-session-continuity-context.test.ts
  - tests/unit/durable-task-runtime.test.ts
  - tests/unit/durable-task-context-artifacts.test.ts
  - tests/unit/durable-task-project-planning.test.ts
  - tests/e2e/long-session-continuity-context.spec.ts
  - tests/e2e/project-agent-loop.spec.ts
  - harness/specs/tasks/autonomy-project-continuity.md
  - harness/specs/scenarios/autonomous-project-system.md
  - harness/specs/fixtures/autonomous-project-system/m1/**
  - scripts/repository-artifacts.json
  - .gitignore
  - docs/modules/multi-agent-and-tasks.md
  - README*.md
expectedUserBehavior:
  - A replacement coordinator reads the current task goal, constraints, decisions, next action and artifact references.
  - Accepted working context is restricted to the requested project and relevant task; candidate, expired and invalidated facts remain excluded.
  - Artifact contents stay on disk, with compact references and explicit omission counts in the existing context projection.
acceptance:
  - A coordinator handoff preserves task identity while the new generation and writer epoch consume the current contract and progress.
  - Owner identity changed during asynchronous reads invalidates the continuity response.
  - Same-workspace foreign-task working context and cross-workspace snapshots are rejected before prompt assembly.
  - Critical goal and constraint overflow blocks execution instead of silently truncating the contract.
  - Existing paired-evaluation cases record current projection fidelity, exclusions, size and costs with explicit scripted versus live-provider scope.
requiredTests:
  - pnpm exec vitest run tests/unit/long-session-continuity-context.test.ts tests/unit/task-ledger-working-context-single-source.test.ts tests/unit/autonomy-context-paired.test.ts tests/unit/durable-task-runtime.test.ts tests/unit/durable-task-project-planning.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec playwright test tests/e2e/long-session-continuity-context.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/autonomy-project-continuity.md
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

Continue the existing task-context hydration and accepted Working Context readers.
Frozen memory injection and auto-write defaults remain governed by their owners.
This projection is bounded by character/token budgets; process memory is a separate
resource measurement. No second context store or injection pipeline is introduced.

This task promotes the existing bound-project continuity projection at Main chat
assembly and Runtime persistent-task restoration. An invalidated owner or missing
critical task constraints rejects that bound execution. Unbound discussion keeps
its existing path, and native compaction ownership remains separate. Rollback is
the prior projection implementation with original owner data retained; no memory
write, injection default or Context Family shadow flag is changed.
