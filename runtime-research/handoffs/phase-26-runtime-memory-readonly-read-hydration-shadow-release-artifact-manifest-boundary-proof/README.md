# Phase 26 Runtime Memory Readonly Read Hydration Shadow Release Artifact Manifest Boundary Proof

## Scope

Phase 26 proves the Phase 25 `runtime:memory:hydrate-shadow` command remains an explicit local developer/research diagnostic even when release artifact manifests, packaged resources, `extraResources`, `asar`, `asarUnpack`, or copied runtime resources can include the helper source or built helper artifact:

- release manifests may declare `build/openclaw-runtime/` resources, but do not invoke hydration;
- packaged app startup, Electron main/preload/renderer, OpenClaw runtime entry, electron-builder, afterPack, run-electron-builder, bundle, package, build, dev, and release paths do not invoke the command, helper, helper exports, or hydration-only build flag;
- no implicit `--persist`, `--read-shadow`, `--database`, `--db`, or default database path;
- command/helper remain readonly, diagnostics-only, bounded, sanitized, and no-write;
- no Gateway, Electron IPC, renderer UI, shared contract, host-api/api-client, provider, TaskLoop, prompt, model-message, service, listener, daemon, durable fact authority, or runtime authority cutover.

## Required Precondition

Before accepting Phase 26, verify Phase 25 synthesis exists, has exactly one terminal `Status:` marker, and ends with accepted.

## Expected Artifacts

- `harness/specs/tasks/phase-26-runtime-memory-readonly-read-hydration-shadow-release-artifact-manifest-boundary-proof.md`
- `tests/unit/runtime-memory-read-hydration-shadow-release-artifact-manifest-boundary.test.ts`
- this handoff package and final `synthesis.md`
- `runtime-research/agent-runtime-index.md` update only if the synthesis is accepted

## Acceptance Boundary

Accepted scope is proof only. Rejected scope includes product runtime behavior, default TaskLoop memory reads, prompt/model/provider/Gateway transport use, automatic fact extraction or promotion, durable fact authority, runtime authority, raw retention, new servers/listeners/services/exporters, and any implicit persistence/readShadow/database selection.
