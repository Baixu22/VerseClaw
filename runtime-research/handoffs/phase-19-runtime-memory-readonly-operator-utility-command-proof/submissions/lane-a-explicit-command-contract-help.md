# Lane A: Explicit Command Contract Help

## Evidence

- `package.json` adds `runtime:memory:inspect` as a local developer command.
- `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs --help` states readonly/default-off inspection, explicit `--persist`, explicit `--database <path>`, no open/create/migrate/write for missing inputs, built-runtime requirement, no runtime behavior effect, and no durable fact/runtime authority.
- `tests/unit/runtime-memory-operator-inspection.test.ts` checks direct utility help and package command help.

## Accepted Scope

Accepted only command discoverability and help text for the existing readonly utility.

## Rejected Scope

Rejected product UI, Gateway, Electron IPC, provider, TaskLoop, prompt, fact, raw-retention, service, listener, and runtime-authority expansion.

## Validation

Synthesis owner rechecked direct utility help, package command help with `pnpm_config_verify_deps_before_run=false`, and focused command tests.

## Status

Status: accepted
