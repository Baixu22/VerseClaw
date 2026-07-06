# Phase 07: CompressionArtifact Integration

## Goal

Add evidence references and retrieval traces to compact recovery state without breaking existing `CompressionArtifact v1` consumers.

## Allowed Changes

- Additive artifact fields.
- Compatibility tests.
- Projection logic for evidence refs, blockers, failed attempts, unverified claims, and required selectors.
- Recovery fixtures.

## Forbidden Changes

- Removing or renaming existing artifact fields.
- Making summary text authoritative.
- Embedding large durable facts when selectors are available.
- Auto-mutating Task Ledger, ClawGraph, Memory, Knowledge, or workflow state.

## Required Additive Fields

Fields may include:

- retrieved context refs,
- required selectors,
- capability activations,
- unverified claims,
- stale references,
- retrieval traces.

Existing consumers must continue working when these fields are absent.

## Required Tests

Use TDD. Add failing tests for:

- old artifact fixtures deserialize,
- new fields are optional,
- evidence refs survive compaction,
- unverified claims remain visibly uncertain,
- failed attempts and blockers survive projection,
- large chunks are not embedded when selector refs are available,
- stale refs are marked.

Run:

```powershell
corepack pnpm exec vitest run tests/unit/context-compression-eval.test.ts --reporter=verbose
corepack pnpm exec vitest run tests/unit/<compression-artifact-crk-tests> --reporter=verbose
corepack pnpm run typecheck
```

## Acceptance

- Existing artifact consumers pass unchanged.
- ERR = 100% in fixture recovery cases.
- No durable workflow owner is mutated by compact output.

## Stop Conditions

Stop if compatibility requires breaking existing artifact readers. Create a migration spec instead.
