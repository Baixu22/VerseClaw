---
id: context-family-protocol-types
title: Context Family protocol types
scenario: context-family
taskType: shared-contract
intent: Add additive shared Context Family types and pure helpers for item identity, lifecycle, projection, provenance, source refs, archive handles, and status snapshots.
touchedAreas:
  - shared/types/context-item.ts
  - shared/types/context-family.ts
  - tests/unit/context-family-contracts.test.ts
  - docs/context-family/**
expectedUserBehavior:
  - Future runtime code can exchange ContextItem metadata by stable shared types.
  - Invalid lifecycle transitions are rejected before integration.
  - CVK selectors and checksums can be referenced without making CVK mandatory for all items.
requiredProfiles:
  - fast
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-family-protocol-types.md
  - pnpm harness validate --spec harness/specs/tasks/context-family-protocol-types.md
  - pnpm exec vitest run tests/unit/context-family-contracts.test.ts --reporter=verbose
  - pnpm run typecheck
  - git diff --check -- shared/types/context-item.ts shared/types/context-family.ts tests/unit/context-family-contracts.test.ts docs/context-family
acceptance:
  - Types are additive and do not modify existing `context-runtime-kit` or `CompressionArtifact` serialization.
  - `ContextItemKind`, `LifecycleState`, `ProjectionSpec`, `SourceRef`, `ArchiveHandle`, and `LifecycleEvent` have stable serialization tests.
  - Pure helpers validate item ids, archive handles, lifecycle transitions, and bounded projection metadata.
  - No runtime registration, storage, Host API, Gateway, renderer, prompt, or compaction behavior changes are made.
docs:
  required: true
  files:
    - docs/context-family/goal-progress.md
---

This task creates the shared language in code, but it does not wire the runtime to speak it yet.
