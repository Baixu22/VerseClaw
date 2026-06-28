# Phase 23 Runtime Memory Readonly Read Hydration Shadow Command Proof

## Scope

Phase 23 proves a new explicit local developer/research command can invoke the built Runtime Memory readonly read-hydration shadow helper while preserving the Phase 21/22 boundaries:

- default-off by omission;
- explicit `--persist`, `--read-shadow`, and `--database <path>` required before SQLite opens;
- readonly, diagnostics-only, bounded sanitized output;
- no Gateway, Electron, renderer, shared contract, host-api/api-client, provider, TaskLoop, prompt, model-message, service, listener, daemon, or runtime authority cutover.

## Required Precondition

Before accepting Phase 23, verify Phase 22 synthesis exists, has exactly one `Status:` marker, and ends with exactly `Status: accepted`.

## Expected Artifacts

- `harness/specs/tasks/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof.md`
- `openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs`
- `package.json` script `runtime:memory:hydrate-shadow`
- `tests/unit/runtime-memory-read-hydration-shadow-command.test.ts`
- this handoff package and final `synthesis.md`

## Acceptance Boundary

Accepted scope is the command proof only. Rejected scope includes product runtime behavior, default TaskLoop memory reads, prompt/model/provider/Gateway transport use, automatic fact extraction or promotion, durable fact authority, runtime authority, raw retention, new servers/listeners/services/exporters, and any implicit persistence/readShadow/database selection.
