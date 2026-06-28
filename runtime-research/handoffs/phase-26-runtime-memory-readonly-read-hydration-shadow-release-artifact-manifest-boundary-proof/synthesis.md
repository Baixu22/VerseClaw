# Phase 26 Runtime Memory Readonly Read Hydration Shadow Release Artifact Manifest Boundary Proof Synthesis

## Decision

Accepted scope is narrow: Phase 26 adds release artifact manifest, packaged resource, extraResources, asar/asarUnpack, and packaged entrypoint no-invocation proof for the already explicit Phase 25 Runtime Memory readonly read-hydration shadow command. The accepted artifact is proof only: a new Phase 26 task spec, handoff package, focused static test, and agent runtime index addendum.

Release manifests and resource declarations may include `build/openclaw-runtime/` or copied runtime resources, and build-only paths may explicitly emit `memory-read-hydration-shadow.js`, but packaged app startup, Electron main/preload/renderer, OpenClaw runtime entry startup, electron-builder, afterPack, run-electron-builder, bundle, package, build, dev, and release paths do not execute the helper or command.

SQLite can still open only when all three inputs are explicit: `--persist`, `--read-shadow`, and `--database <path>`. Existing Phase 21/22/23/24/25 helper, build, command, packaging, and packaged-artifact tests remain the behavioral proof for no-open/no-create/no-table-creation and sanitized bounded output.

## Rechecked Lanes

- Lane A accepted: release artifact manifests and package entrypoints can include runtime resources only as inert packaged resources; no hydration invocation or implicit SQLite flags are present.
- Lane B accepted: `extraResources`, `asar`, `asarUnpack`, `scripts/after-pack.cjs`, `scripts/run-electron-builder.mjs`, and `scripts/bundle-openclaw-runtime.mjs` do not invoke hydration, helper exports, the helper-only build flag, or implicit persistence/read-shadow/database flags.
- Lane C accepted: package `main`, Electron main/preload, renderer app, and OpenClaw runtime entry sources do not import or invoke read hydration.
- Lane D accepted: no Gateway, Electron IPC, renderer, shared contract, host-api/api-client, provider registry, TaskLoop, prompt/model-message, provider ordering, durable fact authority, or runtime authority cutover is added.
- Lane E accepted: rollback and docs sync review are recorded; README sync is not needed.

## Validation

- Phase 25 prerequisite: synthesis exists, now has exactly one terminal status marker after marker hygiene cleanup, and its last non-empty line is the accepted terminal marker.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-26-runtime-memory-readonly-read-hydration-shadow-release-artifact-manifest-boundary-proof.md`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-26-runtime-memory-readonly-read-hydration-shadow-release-artifact-manifest-boundary-proof.md`: blocked by broad unrelated dirty/untracked files outside Phase 26 touched areas.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-26-runtime-memory-readonly-read-hydration-shadow-release-artifact-manifest-boundary-proof.md --no-diff`: passed.
- Phase 25/24/23/22/21/20/19/18/17/16/15/14/13/12/11/10/9 structural validates with `--no-diff`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow-release-artifact-manifest-boundary.test.ts`: passed, 5 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow-release-artifact-manifest-boundary.test.ts tests/unit/runtime-memory-read-hydration-shadow-packaged-artifact-boundary.test.ts tests/unit/runtime-memory-read-hydration-shadow-command-packaging.test.ts tests/unit/runtime-memory-read-hydration-shadow-command.test.ts tests/unit/runtime-memory-read-hydration-shadow-build.test.ts tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-operator-inspection.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts`: passed, 9 files / 61 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only`: passed; emitted `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js`.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs`: blocked by unrelated existing `openclaw_runtime/src/auto-reply/reply/get-reply.ts:1030` unexpected end-of-file parse error.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: passed.
- Release artifact manifest / extraResources / asar / afterPack hydration scan: no matches.
- Package/build/release script scan: only the explicit `runtime:memory:hydrate-shadow` developer command matched; release lifecycle scripts did not match.
- Packaged resource entrypoint scan: no matches.
- Renderer direct IPC/Gateway scan: no matches.
- Gateway/Electron/shared/host-api/api-client/provider registry/TaskLoop hydration import scan: no matches.
- TaskLoop memory read/fact/provider scan: no matches.
- Provider registry/default registration scan: no matches.
- Raw-retention scan found only test fixtures, negative assertions, spec/handoff prohibitions, and command help text; no runtime output leak or packaged invocation path.
- Service/exporter/listener scan found only negative assertions, spec/handoff prohibitions, and command help text; no service/listener/daemon startup code.
- Helper/command mutation scan found only command help text saying the command does not open/create/migrate/write; no mutation call.
- Command script no-write/no-default-db scan found only explicit `databasePath` argument plumbing and no default database name.
- Comms replay/compare were not run because Phase 26 changed no Main/Gateway/host-api/api-client/provider transport, channel delivery, runtime send/receive, or fallback behavior.

## Docs And Rollback

README sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README change is needed because Phase 26 does not change product behavior, UI, Gateway behavior, public runtime behavior, release-facing docs, or user workflow.

Rollback is to remove `tests/unit/runtime-memory-read-hydration-shadow-release-artifact-manifest-boundary.test.ts`, remove this Phase 26 spec/handoff/index addendum, and keep Phase 21/22/23/24/25 helper/build/command/package/packaged-artifact behavior unchanged.

## Rejected Scope

Still rejected: Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contract changes, provider ordering or default provider registration, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/context/model-message injection, automatic fact extraction/promotion, raw retention, services/exporters/listeners/daemons/servers, database-service work, package/build/dev/release hydration invocation, packaged app startup or afterPack hydration invocation, release artifact manifest or extraResources hydration invocation, implicit persist/database/read-shadow enablement, default database selection, durable fact authority, and runtime authority.

## Index

`runtime-research/agent-runtime-index.md` was updated with a Phase 26 addendum.

Status: accepted
