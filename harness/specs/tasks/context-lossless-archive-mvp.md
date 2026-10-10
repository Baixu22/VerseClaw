---
lifecycleStatus: archived
id: context-lossless-archive-mvp
title: Context lossless archive MVP
scenario: context-family
taskType: runtime-bridge
intent: Create checksum-backed archive handles for original payloads or message ranges before irreversible truncation or compaction.
touchedAreas:
  - openclaw_runtime/src/agents/embedded-agent-runner/**
  - openclaw_runtime/src/gateway/session-compaction-checkpoints.ts
  - openclaw_runtime/src/context-engine/registry/**
  - openclaw_runtime/src/config/sessions/**
  - tests/unit/**
  - docs/context-family/**
expectedUserBehavior:
  - Future masking and recall can rely on durable handles instead of lost text.
  - Existing prompts and UI remain unchanged in this MVP.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - backend-communication-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-lossless-archive-mvp.md
  - pnpm harness validate --spec harness/specs/tasks/context-lossless-archive-mvp.md
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/context-item-registry.test.ts --reporter=verbose
  - pnpm test
  - git diff --check -- openclaw_runtime/src/agents/embedded-agent-runner openclaw_runtime/src/gateway/session-compaction-checkpoints.ts openclaw_runtime/src/context-engine/registry openclaw_runtime/src/config/sessions tests/unit docs/context-family
acceptance:
  - Original tool-result payloads can be archived before truncation and addressed by `ArchiveHandle`.
  - Compaction input ranges can be archived before summary replacement and addressed by `ArchiveHandle`.
  - Archive handles include checksum, source session identity, and storage pointer or source range pointer.
  - Checksum verification fails closed.
  - Session hard delete removes related archive artifacts.
  - No observation masking, recall UI, prompt behavior promotion, or large registry payload storage is added.
docs:
  required: true
  files:
    - docs/context-family/goal-progress.md
---

This task supplies the lossless substrate. Masking is not allowed before this substrate exists.
