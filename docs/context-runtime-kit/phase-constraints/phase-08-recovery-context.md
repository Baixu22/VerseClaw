# Phase 08: Recovery Context Integration

## Goal

Recover long-running work from compact state plus CVK selectors, with visible stale or missing reference handling.

## Allowed Changes

- Recovery projection builder.
- Recovery verifier.
- Recovery tests and benchmark fixtures.
- Report-only recovery diagnostics before active recovery behavior.

## Forbidden Changes

- Trusting stale refs silently.
- Replacing transcript replay globally without a pilot flag.
- Hiding missing required selectors.
- Mutating durable task truth from compact summaries.

## Required Projection Content

Recovery projection must include:

- resource map,
- required selectors,
- unresolved or unverified claims,
- blockers,
- failed attempts,
- next action,
- stale or missing reference diagnostics.

## Required Tests

Use TDD. Add failing tests for:

- recovery succeeds from compact projection plus selectors,
- recovery fails visibly when required selectors are missing,
- stale code/doc refs are marked,
- failed attempts are not repeated,
- uncertainty survives recovery.

Run:

```powershell
corepack pnpm exec vitest run tests/unit/context-compression-eval.test.ts --reporter=verbose
corepack pnpm exec vitest run tests/unit/<recovery-context-tests> --reporter=verbose
corepack pnpm run typecheck
```

## Acceptance

- Compact recovery benchmark reaches Level 1 thresholds before active pilot.
- Missing or stale refs fail visibly.
- Existing recovery behavior remains available via rollback.

## Stop Conditions

Stop if recovery requires replacing existing compaction or transcript behavior without a flag.
