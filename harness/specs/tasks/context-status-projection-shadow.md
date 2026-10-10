---
lifecycleStatus: archived
id: context-status-projection-shadow
title: Context Status projection shadow
scenario: context-family
taskType: runtime-shadow
intent: Generate a bounded `[Context Status]` projection from runtime status and Registry metadata under an explicit flag.
touchedAreas:
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/embedded-agent-runner/**
  - tests/unit/**
  - docs/context-family/**
expectedUserBehavior:
  - When enabled for development, agents can see bounded context state without seeing large hidden payloads.
  - When disabled, prompt output remains exactly unchanged.
requiredProfiles:
  - fast
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-status-projection-shadow.md
  - pnpm harness validate --spec harness/specs/tasks/context-status-projection-shadow.md
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/context-runtime-kit-active-engine.test.ts --reporter=verbose
  - git diff --check -- openclaw_runtime/src/context-engine openclaw_runtime/src/agents/embedded-agent-runner tests/unit docs/context-family
acceptance:
  - Flag off preserves exact prompt parity.
  - Flag on injects a bounded `[Context Status]` with pressure, counts by lifecycle state, archive/recovery availability, and warnings.
  - Projection contains no large payloads and no UI-only truth.
  - Status does not replace Task Ledger, ClawGraph, Observability, Memory, Knowledge, CompressionArtifact, or Context Pack authority.
docs:
  required: true
  files:
    - docs/context-family/goal-progress.md
---

Context Status is proprioception, not task truth.
