# Phase 27 Runtime Memory Readonly Read Hydration Shadow Packaged Output Inspection Proof Synthesis

## Decision

Accepted scope is narrow: Phase 27 adds packaged-output-tree inspection proof for the already explicit Phase 26 Runtime Memory readonly read-hydration shadow command/helper. The accepted artifact is proof only: a new Phase 27 task spec, handoff package, focused static test, and agent runtime index addendum.

A packaged output tree may contain the helper source, command source, or built helper artifact as inert developer/research diagnostic resources. Packaged output entrypoints, packaged app startup, Electron main/preload/renderer, OpenClaw runtime entrypoints, Gateway, TaskLoop, provider registry, host-api/api-client, release hooks, afterPack hooks, bundle scripts, and package/build/dev/release scripts do not invoke the command/helper/build flag.

SQLite can still open only when all three inputs are explicit: `--persist`, `--read-shadow`, and `--database <path>`. Existing Phase 21/22/23/24/25/26 helper, build, command, packaging, packaged-artifact, and release-manifest tests remain the behavioral proof for no-open/no-create/no-table-creation and sanitized bounded output.

## Rechecked Lanes

- Lane A accepted: the Phase 27 test constructs a temporary packaged-output tree containing helper source, command source, and built helper artifact; hydration markers appear only in those resource files.
- Lane B accepted: simulated packaged output entrypoints plus package `main`, Electron main/preload, renderer app, and OpenClaw runtime entry sources do not import or invoke read hydration.
- Lane C accepted: package/build/dev/release scripts do not pass implicit SQLite flags; command/helper remain readonly, no-default-db, no-write, and sanitized-only.
- Lane D accepted: Gateway, Electron, shared, host-api/api-client, provider registry, and TaskLoop boundaries contain no hydration import or cutover.
- Lane E accepted: rollback and docs sync review are recorded; README sync is not needed.

## Validation

- Phase 26 prerequisite: synthesis exists, has exactly one `Status:` marker, and its last non-empty line is `Status: accepted`.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-27-runtime-memory-readonly-read-hydration-shadow-packaged-output-inspection-proof.md`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-27-runtime-memory-readonly-read-hydration-shadow-packaged-output-inspection-proof.md`: blocked by broad unrelated dirty/untracked files outside Phase 27 touched areas.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-27-runtime-memory-readonly-read-hydration-shadow-packaged-output-inspection-proof.md --no-diff`: passed, including a rerun after the index update.
- Phase 26/25/24/23/22/21/20/19/18/17/16/15/14/13/12/11/10/9 structural validates with `--no-diff`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow-packaged-output-inspection.test.ts`: passed, 6 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow-packaged-output-inspection.test.ts tests/unit/runtime-memory-read-hydration-shadow-release-artifact-manifest-boundary.test.ts tests/unit/runtime-memory-read-hydration-shadow-packaged-artifact-boundary.test.ts tests/unit/runtime-memory-read-hydration-shadow-command-packaging.test.ts tests/unit/runtime-memory-read-hydration-shadow-command.test.ts tests/unit/runtime-memory-read-hydration-shadow-build.test.ts tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-operator-inspection.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts`: passed, 10 files / 67 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only`: passed; emitted `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js`.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs`: initially blocked by `openclaw_runtime/src/auto-reply/reply/get-reply.ts` EOF syntax damage and then by malformed `resolvedFastMode` syntax in `openclaw_runtime/src/auto-reply/reply/get-reply-directives.ts`; after syntax-only repairs, passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: passed.
- Packaged output tree hydration scan: covered by `tests/unit/runtime-memory-read-hydration-shadow-packaged-output-inspection.test.ts`; only helper source, command source, and built helper artifact matched.
- Release artifact manifest / extraResources / asar / afterPack hydration scan: no matches.
- Packaged entrypoint hydration scan: no matches.
- Package/build/release script scan: only the explicit `runtime:memory:hydrate-shadow` developer command matched; lifecycle scripts did not pass implicit hydration flags.
- Renderer direct IPC/Gateway scan: a broad scan found only an existing comment mentioning `127.0.0.1:18789`; a stricter call-shape scan for `ipcRenderer.invoke`, `fetch(...18789)`, and `new WebSocket(...18789)` found no matches.
- Gateway/Electron/shared/host-api/api-client hydration import scan: no matches.
- TaskLoop memory read/fact/provider hydration scan: no matches.
- Provider registry/default registration scan: no matches.
- Raw-retention scan in helper/command source: no matches.
- Service/exporter/listener scan found only command help text saying the utility is not a service, listener, or daemon integration; no startup code.
- Helper/command mutation scan: no mutation call matches.
- Command script no-write/no-default-db scan: no matches.
- Comms replay/compare were not run because Phase 27 changed no Main/Gateway/host-api/api-client/provider transport, channel delivery, runtime send/receive, or fallback behavior.
- Post-hoc deep validation: `runtime-research/handoffs/phase-27-runtime-memory-readonly-read-hydration-shadow-packaged-output-inspection-proof/deep-validation.md` records quantitative packaged-output, entrypoint, product-boundary, lifecycle flag, mutation, leak-sentinel, build, focused-test, typecheck, real-impact, negative-gain, and next opt-in evaluation design evidence.
- Opt-in mock memory evaluation: `tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts` proves baseline no-hydration has no memory effect, naive hydration consumption is negative/risky, and guarded explicit opt-in hydration is positive on a fixed mock corpus without raw leaks or prompt-injection returns.

## Docs And Rollback

README sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README change is needed because Phase 27 does not change product behavior, UI, Gateway behavior, public runtime behavior, release-facing docs, or user workflow.

Rollback is to remove `tests/unit/runtime-memory-read-hydration-shadow-packaged-output-inspection.test.ts`, remove this Phase 27 spec/handoff/index addendum, and keep Phase 21/22/23/24/25/26 helper/build/command/package/packaged-artifact/release-manifest behavior unchanged.

## Rejected Scope

Still rejected: Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contract changes, provider ordering or default provider registration, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/context/model-message injection, automatic fact extraction/promotion, raw retention, services/exporters/listeners/daemons/servers, database-service work, packaged output entrypoint hydration invocation, package/build/dev/release hydration invocation, packaged app startup or afterPack hydration invocation, implicit persist/database/read-shadow enablement, default database selection, durable fact authority, and runtime authority.

## Index

`runtime-research/agent-runtime-index.md` was updated with a Phase 27 addendum.

Status: accepted
