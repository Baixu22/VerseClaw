# Phase 01: Protocol Types and Artifact Shape

## Goal

Define stable, serializable Context Runtime Kit protocol contracts without changing runtime prompt or tool behavior.

## Allowed Changes

- `shared/types/context-runtime-kit.ts` or a similarly scoped shared type file.
- Pure validation helpers colocated with the type module.
- Unit tests under `tests/unit/**`.
- Harness docs that clarify P1 contract semantics.

## Forbidden Changes

- CVK compiler logic.
- Selector resolver with filesystem-backed artifacts.
- Context router or provider registry changes.
- Tool-call gating.
- Prompt assembly.
- `CompressionArtifact` schema changes.
- Host API exposure unless a separate task spec authorizes read-only type exposure.

## Required Types

Define contracts for:

- `ResourceId`
- `Selector`
- `Chunk`
- `CompactView`
- `CvkEvidenceRef`
- `RetrievalTraceEntry`
- `PromptBundle`
- `VerificationResult`

## Required Tests

Use TDD. Add failing tests first for:

- valid JSON serialization and deserialization,
- invalid resource ids,
- invalid selectors,
- invalid checksums,
- invalid chunk ranges,
- evidence refs missing `resource_id`, `selector`, or `checksum` when used for hard claims,
- deterministic sorting or normalization where defined.

Run:

```powershell
corepack pnpm exec vitest run tests/unit/<context-runtime-kit-contract-tests> --reporter=verbose
corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md
corepack pnpm run typecheck
```

## Acceptance

- Types are additive and do not affect runtime behavior.
- Invalid data produces explicit diagnostics.
- Serialization is stable.
- No prompt, tool, host-api, renderer, storage, or compaction behavior changes.

## Stop Conditions

Stop if the implementation needs runtime state, storage migration, or prompt integration. That belongs to later phases.
