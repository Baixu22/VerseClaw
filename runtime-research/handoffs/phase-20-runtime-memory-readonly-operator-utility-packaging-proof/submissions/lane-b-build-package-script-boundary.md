# Lane B: Build Package Script Boundary

## Evidence

- `runtime:memory:inspect` is exactly `node openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`.
- Focused tests assert `predev`, `dev`, `build`, `package`, and `release` do not invoke `runtime:memory:inspect` or `inspect-runtime-memory-episodes.mjs`.
- Focused tests assert package/build script chains do not pass `--persist`, `--database`, Gateway/server/listener/daemon startup terms, or database inspection flags.
- `scripts/build-openclaw-runtime.mjs` contains the `memory-operator-inspection` build entrypoint and the `--memory-operator-inspection-only` selector, but does not execute the inspector utility.

## Accepted Scope

Accepted only build/package discoverability proof: the inspector module can be built, while the inspector utility is not executed by lifecycle/package/release scripts.

## Rejected Scope

Rejected package lifecycle hook cutover, implicit persist/database flags, database open during build/package/release, and server/listener/Gateway startup.

## Validation

Synthesis owner must rerun focused tests and package/build scans before accepting this lane.

## Status

Status: accepted
