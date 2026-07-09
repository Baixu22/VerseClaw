---
id: context-item-registry-shadow
title: ContextItemRegistry shadow
scenario: context-family
taskType: runtime-shadow
intent: Implement a metadata-only ContextItemRegistry in shadow mode without changing prompt, tool, compaction, or UI behavior.
touchedAreas:
  - openclaw_runtime/src/context-engine/registry/**
  - tests/unit/context-item-registry.test.ts
  - docs/context-family/**
expectedUserBehavior:
  - Runtime behavior remains unchanged while ContextItem metadata can be recorded and queried for diagnostics.
  - Registry failures do not break active agent runs.
requiredProfiles:
  - fast
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-item-registry-shadow.md
  - pnpm harness validate --spec harness/specs/tasks/context-item-registry-shadow.md
  - pnpm exec vitest run tests/unit/context-item-registry.test.ts --reporter=verbose
  - pnpm run typecheck
  - git diff --check -- openclaw_runtime/src/context-engine/registry tests/unit/context-item-registry.test.ts docs/context-family
acceptance:
  - Registry can register metadata-only items, append lifecycle events, query by session/kind/state, and return status snapshots.
  - Registry records do not store large raw payloads.
  - Shadow mode failures are bounded diagnostics, not run failures.
  - No prompt text, prompt order, tool invocation, approval, Gateway RPC, Host API, renderer UI, or storage authority changes are made.
docs:
  required: true
  files:
    - docs/context-family/goal-progress.md
---

This task creates the semantic index layer. It must not become a second source of truth.
