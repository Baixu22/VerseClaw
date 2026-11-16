---
lifecycleStatus: active
id: memory-atomic-update
title: Atomic memory updates and truthful DELETE outcomes
scenario: gateway-backend-communication
task_forest:
  - TF-0742
taskType: runtime-bridge
intent: Make self-edit and curation mutations atomic at the existing store owner, preserve retirement, and report applied deletion truthfully.
touchedAreas:
  - openclaw_runtime/src/runtime-core/memory-store.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/runtime-core/memory-runtime-integration.ts
  - openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts
  - openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts
  - tests/unit/memory-atomic-update.test.ts
  - vitest.config.ts
  - tests/unit/memory-self-edit-provenance.test.ts
  - tests/unit/runtime-memory-self-edit-persistence.test.ts
  - docs/dev/memory-control-plane.md
  - harness/specs/tasks/memory-atomic-update.md
  - harness/specs/tasks/semantic-convergence-remediation.md
  - docs/dev/evidence/semantic-convergence-20261104/tf-0742/**
  - scripts/repository-artifacts.json
  - .gitignore
requiredProfiles:
  - fast
  - comms
requiredRules:
  - memory-self-edit-provenance-boundary
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - A failed replacement does not expose a new fact with the old one still active or an invalidated old fact without its replacement.
  - DELETE reports applied or already_applied after its effect, while disabled persistence remains skipped.
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/memory-atomic-update.test.ts --maxWorkers=1
  - node node_modules/vitest/vitest.mjs run tests/unit/memory-self-edit-provenance.test.ts tests/unit/runtime-memory-self-edit-persistence.test.ts tests/unit/memory-tf0500-persistence-retirement.test.ts --maxWorkers=1
acceptance:
  - Append, invalidation and relation failures roll back on both self-edit and curation paths.
  - Rejected or skipped writes abort the enclosing mutation; a port without atomic support fails before effects.
  - Successful DELETE reports applied and a repeated DELETE reports already_applied, both with persisted=true.
  - Production persist remains false; SQLite tests enable only a mocked flag resolver inside the test process and label all observations agent-driven.
humanEvidence: not-required
docs:
  required: true
  files:
    - docs/dev/memory-control-plane.md
---

Use the existing SQLite transaction/savepoint helper and in-memory store owner.
No second store, daemon, public configuration switch, or persistence restoration.
The mutation is synchronous; async transaction callbacks are rejected. Failure
injection and a separate SQLite reader verify rollback and committed visibility.
