# Lane B: Built Runtime Explicit Call Proof

## Evidence

- `scripts/build-openclaw-runtime.mjs` emits `runtime-core/memory-operator-inspection` as an explicit app runtime build entry.
- `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs` imports only `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js` after explicit CLI invocation.
- `tests/unit/runtime-memory-operator-inspection.test.ts` runs `node scripts/build-openclaw-runtime.mjs` in `beforeAll` and invokes the utility as a subprocess.

## Accepted Scope

Accepted the local post-build utility proof for explicit operator/developer inspection.

## Rejected Scope

Rejected packaging this as a Gateway, Electron, renderer, provider, TaskLoop, prompt, service, or runtime-authority path.

## Validation

Pending final validation synthesis.

## Status

Status: accepted
