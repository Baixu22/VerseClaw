# Phase 22 Runtime Memory Readonly Read Hydration Shadow Build Proof Synthesis

## Decision

Accepted scope is narrow: Phase 22 adds an explicit developer/research-only build proof for the Phase 21 Runtime Memory readonly read-hydration shadow helper. The new direct build flag is `--memory-read-hydration-shadow-only`, and it emits only `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js`.

The proof remains build-only. It does not execute `hydrateRuntimeMemoryShadowContext`, does not call `readRuntimeMemoryHydrationShadow`, does not open or create SQLite, does not select a database, does not pass `--database`, does not pass `--read-shadow`, and does not implicitly enable `runtime.memory.persist` or helper-level `readShadow`.

## Rechecked Lanes

- Lane A accepted: the explicit build flag emits only the hydration shadow helper output.
- Lane B accepted: the build script adds only an esbuild entrypoint selection and does not execute the helper or SQLite/database logic.
- Lane C accepted: `predev`, `dev`, `build`, `package`, and `release` do not invoke the hydration helper, the new build-only flag, or implicit persistence/database/read-shadow flags.
- Lane D accepted: no Gateway, Electron, renderer, shared, host-api/api-client, provider registry, TaskLoop, prompt, model, provider ordering, or runtime authority cutover is added.
- Lane E accepted: rollback/docs validation is defined; README sync review concludes no README edit is needed.

## Validation

- Phase 21 prerequisite: synthesis exists, has exactly one accepted final marker on the last non-empty line.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof.md`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof.md`: blocked by broad unrelated dirty/untracked files outside Phase 22 touched areas.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof.md --no-diff`: passed.
- Phase 21/20/19/18/17/16/15/14/13/12/11/10/9 structural validates with `--no-diff`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow-build.test.ts`: passed, 3 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-operator-inspection.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts`: passed, 35 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only`: passed; emitted `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js`.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs`: blocked by unrelated existing `openclaw_runtime/src/auto-reply/reply/get-reply.ts:1030` unexpected end-of-file parse error.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: passed.
- Renderer direct IPC/Gateway scan: no matches.
- Gateway/Electron/shared/host-api/api-client/provider/TaskLoop hydration cutover scans: no product-path matches.
- TaskLoop memory read/fact/provider scan: no matches.
- Package lifecycle scan via parsed `package.json`: no lifecycle hydration helper/build flag/database/startup hits.
- Package/build script scan: `memory-read-hydration-shadow` and `--memory-read-hydration-shadow-only` appear only in `scripts/build-openclaw-runtime.mjs`; no package script invokes them.
- Helper mutation scan for migrate/write/append/insert/update/delete/trim calls in the helper and build script: no matches.
- Raw-retention and service/exporter/listener scans found policy/test/handoff negative text only, not helper runtime output or startup code.
- README docs sync scan across `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`: no Runtime Memory/read hydration public docs surface requiring update.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/replay.mjs`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/compare.mjs`: passed.

## Docs And Rollback

README sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README change is needed because Phase 22 does not change product behavior, UI, Gateway behavior, public runtime behavior, public package commands, or user workflow.

Rollback is to remove the `--memory-read-hydration-shadow-only` branch and hydration helper entry path from `scripts/build-openclaw-runtime.mjs`, remove `tests/unit/runtime-memory-read-hydration-shadow-build.test.ts`, and keep Phase 21 helper behavior gated by omitted `runtime.memory.persist` or helper-level `readShadow` for no-open/no-read/no-write behavior.

## Rejected Scope

Still rejected: Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contract changes, provider ordering or default provider registration, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/context/model-message injection, automatic fact extraction/promotion, raw retention, services/exporters/listeners/daemons/servers, database-service work, package/build/dev/release hydration invocation, implicit persist/database/read-shadow enablement, helper execution during build, and any memory-derived runtime authority.

## Index

`runtime-research/agent-runtime-index.md` was updated with a Phase 22 addendum.

Status: accepted
