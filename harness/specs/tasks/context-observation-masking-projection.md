---
id: context-observation-masking-projection
title: Context observation masking projection
scenario: context-family
taskType: runtime-bridge
intent: Add projection-only observation masking as a preemptive route option that requires archive handles and preserves transcript truth.
touchedAreas:
  - openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.types.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/**
  - openclaw_runtime/src/context-engine/registry/**
  - tests/unit/**
  - docs/context-family/**
expectedUserBehavior:
  - Old large tool observations can be replaced in prompt snapshots by recallable placeholders.
  - Transcript history remains unchanged in the first masking version.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-observation-masking-projection.md
  - pnpm harness validate --spec harness/specs/tasks/context-observation-masking-projection.md
  - pnpm run typecheck
  - pnpm test
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check -- openclaw_runtime/src/agents/embedded-agent-runner openclaw_runtime/src/context-engine/registry tests/unit docs/context-family
acceptance:
  - Preemptive routing supports an `observation_masking` decision under a flag.
  - Masking targets only `observation` items with verified archive handles.
  - Prompt snapshot placeholders include item id or archive handle and preserve tool-call structure.
  - Transcript rewrite masking is not implemented in this task.
  - Instruction and user intent items are not automatically masked.
  - Flag off preserves legacy route behavior.
docs:
  required: true
  files:
    - docs/context-family/goal-progress.md
---

Masking is a projection strategy. It is not deletion and not compaction.
