---
id: context-family-shadow-ingestion
title: Context Family shadow ingestion
scenario: context-family
taskType: runtime-shadow
intent: Register existing runtime inputs as ContextItems in shadow mode while preserving current behavior.
touchedAreas:
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/context-engine/**
  - tests/unit/**
  - docs/context-family/**
expectedUserBehavior:
  - Tool results, bootstrap instructions, user messages, assistant messages, compaction summaries, and available ledger artifacts can be observed as ContextItems.
  - Agent behavior and prompt content remain unchanged with shadow ingestion enabled or disabled.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - backend-communication-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-family-shadow-ingestion.md
  - pnpm harness validate --spec harness/specs/tasks/context-family-shadow-ingestion.md
  - pnpm exec vitest run tests/unit/context-item-registry.test.ts --reporter=verbose
  - pnpm run typecheck
  - git diff --check -- openclaw_runtime/src/agents openclaw_runtime/src/context-engine tests/unit docs/context-family
acceptance:
  - Tool results register as `observation` items with tool-call source refs when available.
  - Bootstrap/system prompt files register as `instruction` items with file source refs.
  - User messages register as `user_intent`; assistant messages register as `reasoning`.
  - Compaction summaries register as `derived` and CompressionArtifact records register as `ledger` only when available.
  - Registration failures are non-fatal and do not change prompts, transcripts, compaction outputs, or tool behavior.
docs:
  required: true
  files:
    - docs/context-family/goal-progress.md
---

This task gives existing components Context Family identity cards. It does not make Registry authoritative.
