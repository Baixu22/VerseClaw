---
lifecycleStatus: active
id: session-family-read-model
title: Preserve session lineage and scoped task facts in the list read model
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 95b876f27
intent: Connect runtime session-list facts to one bounded family projection and a workspace/session/generation-scoped task container.
ownedPaths:
  - shared/chat/types.ts
  - shared/types/session-derivation.ts
  - shared/types/session-stage.ts
  - shared/session-task-scope.ts
  - src/stores/chat.ts
  - src/components/layout/session-buckets.ts
  - src/lib/session-read-model.ts
  - tests/unit/session-family-read-model.test.ts
  - tests/unit/session-derivation-lineage.test.ts
  - tests/unit/session-stage.test.ts
  - tests/unit/session-workstreams.test.ts
  - harness/specs/tasks/session-family-read-model.md
  - harness/specs/fixtures/session-derivation-ui/**
  - docs/modules/multi-agent-and-tasks.md
touchedAreas:
  - shared/**
  - src/stores/chat.ts
  - src/components/layout/session-buckets.ts
  - src/lib/session-read-model.ts
  - tests/unit/**
  - harness/specs/tasks/session-family-read-model.md
  - harness/specs/fixtures/session-derivation-ui/**
  - docs/modules/multi-agent-and-tasks.md
requiredRules:
  - identity-scope-boundary
  - backend-communication-boundary
  - session-derivation-ui-contract
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
expectedUserBehavior:
  - Session lists retain physical generation, spawnedBy and fork facts.
  - Spawn takes precedence over a generic parent field, while conflicting sources remain diagnostic.
  - Family grouping stays within the existing project/workstream and keeps every row.
  - Unloaded, missing, cyclic and bounded sources differ; task reads distinguish empty, unavailable and stale.
acceptance:
  - Exercise 2, 20 and 100 descendants, deep chains, missing/unloaded parents, cycles and scoped grouping.
  - Stage and lineage classifiers share precedence and preserve contradiction evidence.
  - Task links never define the lineage tree and no per-row activity polling is introduced.
  - The next UI phase consumes the family rows and scoped task projection directly.
requiredTests:
  - pnpm exec vitest run tests/unit/session-family-read-model.test.ts tests/unit/session-workstreams.test.ts tests/unit/session-derivation-lineage.test.ts tests/unit/session-stage.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/session-family-read-model.md
  - pnpm harness run --spec harness/specs/tasks/session-family-read-model.md --dry-run
docs:
  required: true
  files:
    - docs/modules/multi-agent-and-tasks.md
---

U1 provides read-only data for U2 family navigation and the persistent task list.
Session facts and Task Ledger facts retain their separate existing owners.
