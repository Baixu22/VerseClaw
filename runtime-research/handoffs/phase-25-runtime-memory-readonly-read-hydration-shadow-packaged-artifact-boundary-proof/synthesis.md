# Phase 25 Runtime Memory Readonly Read Hydration Shadow Packaged Artifact Boundary Proof Synthesis

## Decision

Accepted scope is narrow: Phase 25 adds packaged-artifact and release-boundary proof for the already explicit Phase 24 Runtime Memory readonly read-hydration shadow command. The accepted artifact is proof only: a new Phase 25 task spec, handoff package, and focused packaged-artifact boundary test.

Built or bundled artifacts may contain the helper source or built helper file, but packaged app startup, electron-builder, afterPack, run-electron-builder, bundle, package, build, dev, and release paths do not execute the helper or command. `runtime:memory:hydrate-shadow` remains a direct package-script pass-through to `openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs`.

SQLite can still open only when all three inputs are explicit: `--persist`, `--read-shadow`, and `--database <path>`. Existing Phase 21/22/23/24 helper, build, command, and packaging tests remain the behavioral proof for no-open/no-create/no-table-creation and sanitized bounded output.

## Rechecked Lanes

- Lane A accepted: package command is direct pass-through, and built helper artifact presence remains inert diagnostic material unless manually invoked by a developer.
- Lane B accepted: `electron-builder.yml`, `scripts/after-pack.cjs`, and `scripts/run-electron-builder.mjs` do not invoke hydration, helper exports, the build-only flag, or implicit persistence/read-shadow/database flags.
- Lane C accepted: `scripts/bundle-openclaw-runtime.mjs` copies runtime source/dependencies into `build/openclaw-runtime/` but does not execute hydration, open SQLite, or select a database path.
- Lane D accepted: no Gateway, Electron, renderer, shared contract, host-api/api-client, provider registry, TaskLoop, prompt/model-message, provider ordering, durable fact authority, or runtime authority cutover is added.
- Lane E accepted: rollback and docs sync review are recorded; README sync is not needed.

## Validation

- Phase 24 prerequisite: synthesis exists, has exactly one terminal status marker, and ends with the accepted terminal marker.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-25-runtime-memory-readonly-read-hydration-shadow-packaged-artifact-boundary-proof.md`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-25-runtime-memory-readonly-read-hydration-shadow-packaged-artifact-boundary-proof.md`: blocked by broad unrelated dirty/untracked files outside Phase 25 touched areas.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-25-runtime-memory-readonly-read-hydration-shadow-packaged-artifact-boundary-proof.md --no-diff`: passed.
- Phase 24/23/22/21/20/19/18/17/16/15/14/13/12/11/10/9 structural validates with `--no-diff`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow-packaged-artifact-boundary.test.ts`: passed, 5 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow-packaged-artifact-boundary.test.ts tests/unit/runtime-memory-read-hydration-shadow-command-packaging.test.ts tests/unit/runtime-memory-read-hydration-shadow-command.test.ts tests/unit/runtime-memory-read-hydration-shadow-build.test.ts tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-operator-inspection.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts`: passed, 8 files / 56 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only`: passed; emitted `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js`.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs`: blocked by unrelated existing `openclaw_runtime/src/auto-reply/reply/get-reply.ts:1030` unexpected end-of-file parse error.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: passed.
- Renderer direct IPC/Gateway scan: no matches.
- Hydration product-path scan across Gateway/Electron/shared/host-api/api-client/renderer/provider registry/TaskLoop paths: no matches.
- TaskLoop memory read/fact/provider scan: no matches.
- Provider registry/default registration scan for hydration and RuntimeMemoryProvider terms: no matches.
- Raw-retention scan found only test fixtures, negative assertions, spec/handoff prohibitions, and command help text; no runtime output leak or packaged invocation path.
- Service/exporter/listener scan found only negative assertions, spec/handoff prohibitions, and command help text; no service/listener/daemon startup code.
- Helper/command mutation scan found only command help text saying the command does not open/create/migrate/write; no mutation call.
- Package/build/release script scan: no matches.
- Electron builder / afterPack / run-electron-builder / bundle script hydration scan: no matches.
- Command script no-write/no-default-db scan: no matches.
- Comms replay/compare were not run for Phase 25 because this slice changed no Main/Gateway/host-api/api-client/provider transport paths. Existing unrelated communication-adjacent dirty files remain outside this proof and were already recorded as the diff-aware harness blocker.

## Docs And Rollback

README sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README change is needed because Phase 25 does not change product behavior, UI, Gateway behavior, public runtime behavior, release-facing docs, or user workflow.

Rollback is to remove `tests/unit/runtime-memory-read-hydration-shadow-packaged-artifact-boundary.test.ts`, remove this Phase 25 spec/handoff/index addendum, and keep Phase 21/22/23/24 helper/build/command/package behavior unchanged.

## Rejected Scope

Still rejected: Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contract changes, provider ordering or default provider registration, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/context/model-message injection, automatic fact extraction/promotion, raw retention, services/exporters/listeners/daemons/servers, database-service work, package/build/dev/release hydration invocation, packaged app startup or afterPack hydration invocation, implicit persist/database/read-shadow enablement, default database selection, durable fact authority, and runtime authority.

## Index

`runtime-research/agent-runtime-index.md` was updated with a Phase 25 addendum.

Status: accepted
