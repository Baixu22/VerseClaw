# Phase 03: Selector Resolver and Checksum Verifier

## Goal

Resolve `resource_id + selector` to chunks and fail closed on missing, stale, ambiguous, or checksum-mismatched evidence.

## Allowed Changes

- Resolver module inside the scoped CRK/CVK implementation area.
- Resolver diagnostics and result types.
- Unit tests and fixtures for selector resolution.

## Forbidden Changes

- Active prompt retrieval.
- Active tool-call blocking.
- Runtime storage migration.
- CompressionArtifact integration.
- UI exposure.

## Required Behaviors

- Resolve one selector.
- Resolve a batch while preserving input order.
- Validate checksums.
- Report per-item errors.
- Distinguish missing, stale, ambiguous, wrong-resource, and checksum mismatch failures.
- Fail closed for hard claims.

## Required Tests

Use TDD. Add failing tests for:

- valid selector resolution,
- missing selector,
- stale selector,
- ambiguous selector,
- wrong resource id,
- checksum mismatch,
- batch resolution order and per-item diagnostics.

Run:

```powershell
corepack pnpm exec vitest run tests/unit/<selector-resolver-tests> --reporter=verbose
corepack pnpm run typecheck
```

## Acceptance

- RRR = 100% for valid fixture refs.
- Invalid refs fail closed with deterministic diagnostics.
- No live prompt or tool behavior changes unless a later phase explicitly consumes report-only resolver output.

## Stop Conditions

Stop if the resolver needs to choose which context to inject. That is Context Router work.
