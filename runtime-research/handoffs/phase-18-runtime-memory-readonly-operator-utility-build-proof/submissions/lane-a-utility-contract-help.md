# Lane A: Utility Contract Help

## Evidence

- `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs` help text now states readonly default-off behavior, explicit `--persist`, explicit `--database <path>`, no open/create/migrate/write for disabled or missing inputs, built OpenClaw runtime output, no runtime behavior effect, and no durable fact/runtime authority.
- `tests/unit/runtime-memory-operator-inspection.test.ts` invokes `--help` as a real Node process and checks the operator/developer boundary wording.

## Accepted Scope

Accepted only the local utility help and argument contract for explicit readonly inspection.

## Rejected Scope

Rejected Gateway, Electron, renderer, host-api/api-client/shared, provider, TaskLoop, prompt, service/listener/daemon, fact authority, and runtime authority expansion.

## Validation

Pending final validation synthesis.

## Status

Status: accepted
