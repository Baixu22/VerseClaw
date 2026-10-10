---
lifecycleStatus: archived
id: context-lifecycle-event-audit
title: Context lifecycle event audit
scenario: context-family
taskType: runtime-shadow
intent: Record lifecycle events for truncation, routing, compaction, and checkpoint creation without changing their decisions or behavior.
touchedAreas:
  - openclaw_runtime/src/agents/embedded-agent-runner/**
  - openclaw_runtime/src/gateway/session-compaction-checkpoints.ts
  - openclaw_runtime/src/context-engine/registry/**
  - tests/unit/**
  - docs/context-family/**
expectedUserBehavior:
  - Context transformations become explainable through lifecycle events.
  - Existing truncation and compaction behavior remains unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-lifecycle-event-audit.md
  - pnpm harness validate --spec harness/specs/tasks/context-lifecycle-event-audit.md
  - pnpm run typecheck
  - pnpm test
  - git diff --check -- openclaw_runtime/src/agents/embedded-agent-runner openclaw_runtime/src/gateway/session-compaction-checkpoints.ts openclaw_runtime/src/context-engine/registry tests/unit docs/context-family
acceptance:
  - Tool-result truncation records lifecycle events with old/new size metadata.
  - Preemptive route decisions record bounded decision metadata.
  - Compaction records derived item provenance and source item transitions.
  - Compaction checkpoints may reference item ids but are still documented and tested as recovery indexes, not lossless archives.
  - No route, truncation, compaction, prompt, tool, Host API, Gateway, renderer, or storage-authority behavior changes are made.
docs:
  required: true
  files:
    - docs/context-family/goal-progress.md
---

Lifecycle events are audit evidence. They must not secretly become policy.
