# Phase 25 Runtime Memory Readonly Read Hydration Shadow Packaged Artifact Boundary Proof

## Scope

Phase 25 proves the Phase 24 `runtime:memory:hydrate-shadow` command remains an explicit local developer/research diagnostic even when the helper source or built helper file is present near packaged, bundled, or release-adjacent artifacts:

- package command stays direct pass-through;
- packaged app startup, electron-builder, afterPack, run-electron-builder, bundle, package, build, dev, and release paths do not invoke the command, helper, helper exports, or hydration-only build flag;
- no implicit `--persist`, `--read-shadow`, `--database`, `--db`, or default database path;
- command/helper remain readonly, diagnostics-only, bounded, sanitized, and no-write;
- no Gateway, Electron, renderer, shared contract, host-api/api-client, provider, TaskLoop, prompt, model-message, service, listener, daemon, durable fact authority, or runtime authority cutover.

## Required Precondition

Before accepting Phase 25, verify Phase 24 synthesis exists, has exactly one `Status:` marker, and ends with exactly `Status: accepted`.

## Expected Artifacts

- `harness/specs/tasks/phase-25-runtime-memory-readonly-read-hydration-shadow-packaged-artifact-boundary-proof.md`
- `tests/unit/runtime-memory-read-hydration-shadow-packaged-artifact-boundary.test.ts`
- this handoff package and final `synthesis.md`
- `runtime-research/agent-runtime-index.md` update only if the synthesis is accepted

## Acceptance Boundary

Accepted scope is proof only. Rejected scope includes product runtime behavior, default TaskLoop memory reads, prompt/model/provider/Gateway transport use, automatic fact extraction or promotion, durable fact authority, runtime authority, raw retention, new servers/listeners/services/exporters, and any implicit persistence/readShadow/database selection.
