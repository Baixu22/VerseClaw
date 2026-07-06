# Phase 00: Specification and Harness Entry Point

## Goal

Freeze the Context Runtime Kit protocol and harness entry point before any runtime implementation.

## Required Reading

- `docs/context-runtime-kit/goal-mode-development-protocol.md`
- `docs/context-runtime-kit/acceptance-and-test-matrix.md`
- `docs/superpowers/plans/2026-07-06-context-runtime-kit.md`
- `harness/specs/tasks/context-runtime-kit.md`
- `harness/specs/rules/context-runtime-kit-boundary.md`
- `harness/specs/scenarios/context-runtime-kit.md`

## Allowed Changes

- `harness/specs/tasks/context-runtime-kit.md`
- `harness/specs/rules/context-runtime-kit-boundary.md`
- `harness/specs/scenarios/context-runtime-kit.md`
- `docs/context-runtime-kit/**`
- `docs/superpowers/plans/2026-07-06-context-runtime-kit.md` only for clarification, not scope expansion

## Forbidden Changes

- runtime prompt assembly,
- tool-call behavior,
- context-engine implementation,
- CVK compiler, resolver, router, verifier, or artifact store,
- `CompressionArtifact` runtime types,
- host-api contracts,
- renderer or UI files,
- database or generated schema files,
- package or lockfile changes.

## Tests and Validation

Run:

```powershell
corepack pnpm harness context --spec harness/specs/tasks/context-runtime-kit.md
corepack pnpm harness validate --spec harness/specs/tasks/context-runtime-kit.md
corepack pnpm run typecheck
git diff --check -- harness/specs/tasks/context-runtime-kit.md harness/specs/rules/context-runtime-kit-boundary.md harness/specs/scenarios/context-runtime-kit.md docs/context-runtime-kit
```

## Acceptance

- Harness context returns the task, scenario, boundary rule, and relevant docs.
- Harness validate passes or failures are explained without touching runtime code.
- Specs clearly state Phase 0 changes no runtime behavior.
- Specs forbid parallel durable truth sources.
- Specs identify Phase 1 as type-only contract work.
- No runtime files are modified.

## Stop Conditions

Stop if harness cannot read the task spec, if a required rule id is missing, or if validation requires runtime implementation.
