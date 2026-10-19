---
lifecycleStatus: active
id: context-lifecycle-exploration
title: Context lifecycle exploration for TF-0424
scenario: context-family
taskType: runtime-shadow
intent: Explore async soft-threshold compaction, value-based pruning and progressive summary trees as bounded shadow/bypass capabilities, with measurable evidence and explicit go/no-go decisions while preserving every existing context authority and default.
requiredProfiles:
  - fast
requiredRules:
  - context-family-boundary
  - context-runtime-kit-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - Existing prompt text, prompt order, compaction timing, storage writes and product defaults remain unchanged unless a later promotion spec explicitly authorizes adoption.
  - Exploration artifacts expose would-defer, would-drop and summary-tier metrics as diagnostics only.
  - Any insufficient live-quality or cost evidence is recorded as NO-GO rather than silently promoted.
touchedAreas:
  - openclaw_runtime/src/context-engine/exploration/**
  - tests/unit/context-lifecycle-*.test.ts
  - tests/unit/default-config-matrix.test.ts
  - harness/specs/tasks/context-lifecycle-exploration.md
  - harness/specs/fixtures/tf0424-context-lifecycle/**
requiredTests:
  - tests/unit/context-lifecycle-boundary.test.ts
  - tests/unit/context-lifecycle-soft-threshold.test.ts
  - tests/unit/context-lifecycle-value-pruning.test.ts
  - tests/unit/context-lifecycle-segment-ledger.test.ts
  - tests/unit/default-config-matrix.test.ts
acceptance:
  - A written boundary decision names the existing context authorities, allowed shadow surfaces, forbidden default/authority changes and evidence watermarks.
  - The soft-threshold shadow decision covers deferred, head/digest mismatch, background-failure fallback and manual/overflow sync scenarios without changing runtime behavior.
  - Deterministic value-pruning candidates report would-drop item/character counts, secret-scan zero hits and a provider seam while leaving the default path unchanged.
  - A segment-summary ledger produces incremental tiered summaries with digest reuse, archive handles and budget-based assembly without becoming a durable source of truth.
  - Shadow evidence records quality/cost limitations and yields explicit go/no-go decisions for each track.
  - Default/config guards remain green and no product lock or default value changes.
docs:
  required: false
---

# TF-0424 Context Lifecycle Exploration

## Boundary

This track is shadow-first. It may add pure planners, read-only diagnostics and
bounded in-memory prototypes. It must not change prompts, compaction timing,
session storage, provider calls, product defaults or the authority of
`CompressionArtifact v1`, Task Ledger, ClawGraph, Observability, Memory,
Knowledge, ContextRuntimeKit, DCS/FactStore or the session transcript.

Three candidate paths are evaluated independently:

1. async soft-threshold compaction;
2. deterministic value-based pruning with an optional provider seam;
3. incremental segment summary trees.

Any future default-on adoption requires a separate promotion spec with live
quality, cost and rollback evidence.