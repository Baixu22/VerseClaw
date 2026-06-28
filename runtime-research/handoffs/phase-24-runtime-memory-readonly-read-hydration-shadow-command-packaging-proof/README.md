# Phase 24 Runtime Memory Readonly Read Hydration Shadow Command Packaging Proof

## Scope

Phase 24 proves the Phase 23 `runtime:memory:hydrate-shadow` package command remains an explicit local developer/research diagnostic across package, build, dev, and release boundaries:

- package command stays direct pass-through;
- package/build lifecycle scripts do not invoke the command, helper, command script, or hydration-only build flag;
- no implicit `--persist`, `--read-shadow`, `--database`, or default database path;
- command/helper remain readonly, diagnostics-only, bounded, sanitized, and no-write;
- no Gateway, Electron, renderer, shared contract, host-api/api-client, provider, TaskLoop, prompt, model-message, service, listener, daemon, durable fact authority, or runtime authority cutover.

## Required Precondition

Before accepting Phase 24, verify Phase 23 synthesis exists, has exactly one `Status:` marker, and ends with exactly `Status: accepted`.

## Expected Artifacts

- `harness/specs/tasks/phase-24-runtime-memory-readonly-read-hydration-shadow-command-packaging-proof.md`
- `tests/unit/runtime-memory-read-hydration-shadow-command-packaging.test.ts`
- this handoff package and final `synthesis.md`
- `runtime-research/agent-runtime-index.md` update only if the synthesis is accepted

## Acceptance Boundary

Accepted scope is proof only. Rejected scope includes product runtime behavior, default TaskLoop memory reads, prompt/model/provider/Gateway transport use, automatic fact extraction or promotion, durable fact authority, runtime authority, raw retention, new servers/listeners/services/exporters, and any implicit persistence/readShadow/database selection.
