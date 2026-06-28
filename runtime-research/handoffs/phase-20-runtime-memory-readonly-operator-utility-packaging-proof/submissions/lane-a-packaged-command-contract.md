# Lane A: Packaged Command Contract

## Evidence

- `package.json` exposes `runtime:memory:inspect`.
- `tests/unit/runtime-memory-operator-inspection.test.ts` checks utility help through the package script.
- `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs` help states readonly/default-off inspection, explicit `--persist`, explicit `--database <path>`, built-runtime requirement, no runtime behavior effect, and no durable fact/runtime authority.

## Accepted Scope

Accepted only explicit local developer command discoverability for readonly sanitized Runtime Memory episode inspection.

## Rejected Scope

Rejected implicit persistence/database selection, product runtime entrypoints, Gateway/UI/provider/TaskLoop/prompt/service startup, durable facts, and runtime authority.

## Validation

Synthesis owner must rerun focused tests and package help proof before accepting this lane.

## Status

Status: accepted
