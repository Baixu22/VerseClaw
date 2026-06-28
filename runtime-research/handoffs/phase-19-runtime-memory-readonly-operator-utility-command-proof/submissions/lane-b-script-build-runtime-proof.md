# Lane B: Script Build Runtime Proof

## Evidence

- `runtime:memory:inspect` is exactly `node openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`.
- The package script does not include `--persist`, `--database`, Electron, Gateway, server, listener, or daemon terms.
- `scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only` remains the focused build proof for `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js`.
- The utility imports the built inspector module only after explicit command invocation.

## Accepted Scope

Accepted only package-script pass-through discoverability plus existing built-runtime utility proof.

## Rejected Scope

Rejected package lifecycle hooks, implicit persistence/database selection, Gateway/UI/provider/TaskLoop/prompt/service startup, and runtime cutover.

## Validation

Synthesis owner rechecked the package script value, the focused runtime build, and the utility built-module import path.

## Status

Status: accepted
