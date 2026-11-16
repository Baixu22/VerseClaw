---
lifecycleStatus: active
id: memory-read-consistency
title: Memory read revisions and cache freshness
scenario: gateway-backend-communication
task_forest:
  - TF-0743
taskType: runtime-bridge
diffBase: c6414f689878ece855b5a31ef03736611edcbc1a
intent: Keep the two retired memory tool readers consistent after committed writes and expose the limits of snapshot freshness.
touchedAreas:
  - openclaw_runtime/src/infra/sqlite-transaction.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/runtime-core/memory-runtime-integration.ts
  - openclaw_runtime/src/runtime-core/memory-pre-reply-injection.ts
  - openclaw_runtime/src/runtime-core/memory-query-tool.ts
  - openclaw_runtime/src/runtime-core/memory-self-edit-adapter.ts
  - tests/unit/memory-read-consistency.test.ts
  - docs/dev/memory-control-plane.md
  - harness/specs/tasks/memory-read-consistency.md
  - docs/dev/evidence/semantic-convergence-20261104/tf-0743/**
  - scripts/repository-artifacts.json
  - .gitignore
requiredProfiles:
  - fast
  - comms
requiredRules:
  - memory-self-edit-provenance-boundary
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - A successful memory write is visible to the next query and recall without waiting for the facts cache TTL.
  - Tool responses identify their read snapshot and mark it stale if the owner observes a later revision during the call.
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/memory-read-consistency.test.ts --maxWorkers=1
  - node node_modules/vitest/vitest.mjs run tests/unit/memory-atomic-update.test.ts tests/unit/memory-query-tool.test.ts tests/unit/memory-self-edit-adapter.test.ts tests/unit/memory-tf0500-persistence-retirement.test.ts --maxWorkers=1
acceptance:
  - Both readers see committed updates and deletions immediately within one process, including inside the existing 30-second cache lifetime.
  - Revisions distinguish same-connection writes and commits made by another SQLite connection; a change during retrieval is explicitly stale.
  - Cache entries identify the SQLite source and connection scope, and both tools return loadedAt, sourceRevision and stale metadata.
  - The existing persistence owner publishes committed-change invalidation without a second store or a new daemon.
  - Production persist remains false; automated evidence enables only a test-process mocked flag resolver and is labelled agent-driven.
humanEvidence: not-required
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/dev/memory-control-plane.md
---

The original plan names the three reader modules. The existing persistence and
integration owners also require a small read-revision/notification seam so direct
writes, curation and tool edits share invalidation. This is a bounded owner-level
implementation detail, not restoration of persistence or a second cache owner.
The existing transaction helper exposes its active-depth observation so Node 22
does not depend on the DatabaseSync.isTransaction property introduced in Node 24.

Keep the current TTL as a reuse bound. Revisions are opaque, connection-scoped
tokens; never compare SQLite data-version counters from different connections as
global versions. Snapshot freshness describes the observed read boundary, not an
unlimited guarantee that another process cannot commit afterwards.

README translations were reviewed: there is no new application UI, setup flow or
enabled memory capability. The internal recovery contract is documented in the
Memory control-plane guide.
