# Phase 23 Runtime Memory Readonly Read Hydration Shadow Command Proof Synthesis

## Decision

Accepted scope is narrow: Phase 23 adds an explicit local developer/research-only command proof for the Phase 21 Runtime Memory readonly read-hydration shadow helper and Phase 22 built output. The command is `openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs`, with package script `runtime:memory:hydrate-shadow` as a direct pass-through.

The proof remains explicit-command-only. SQLite can open only when all three inputs are explicit: `--persist`, `--read-shadow`, and `--database <path>`. The command does not choose a default database path, does not create missing database files, does not create Runtime Memory tables in unrelated existing databases, and does not migrate or write SQLite.

## Rechecked Lanes

- Lane A accepted: command/help documents readonly/default-off, explicit flags, diagnostics-only output, and no runtime/durable fact authority.
- Lane B accepted: missing `--persist`, missing `--read-shadow`, missing `--database`, missing DB files, unrelated DBs, and invalid args remain no-open/no-create/no-write boundaries.
- Lane C accepted: the command imports the built helper and explicit existing Runtime Memory DB output is bounded, sanitized, diagnostics-only, readonly, and non-authoritative.
- Lane D accepted: no package lifecycle, Gateway, Electron, renderer, shared, host-api/api-client, provider registry, TaskLoop, prompt, model, provider ordering, or runtime authority cutover is added.
- Lane E accepted: rollback/docs validation is defined; README sync review concludes no README edit is needed.

## Validation

- Phase 22 prerequisite: synthesis exists, has exactly one final status marker, and ends with the accepted final line.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof.md`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof.md`: blocked by broad unrelated dirty/untracked files outside Phase 23 touched areas.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof.md --no-diff`: passed.
- Phase 22/21/20/19/18/17/16/15/14/13/12/11/10/9 structural validates with `--no-diff`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow-command.test.ts`: passed, 8 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-read-hydration-shadow-build.test.ts tests/unit/runtime-memory-operator-inspection.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts`: passed, 38 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only`: passed; emitted `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js`.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs`: blocked by unrelated existing `openclaw_runtime/src/auto-reply/reply/get-reply.ts:1030` unexpected end-of-file parse error.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: passed.
- Renderer direct IPC/Gateway scan: no matches.
- Gateway/Electron/shared/host-api/api-client/provider/TaskLoop hydration cutover scans: no product-path matches.
- TaskLoop memory read/fact/provider scan: no matches.
- Helper/command mutation scan: no runtime write/migrate/append/insert/update/delete/trim calls; one match was command help text saying it does not open/create/migrate/write.
- Raw-retention scan found only test fixtures and spec/handoff negative assertions, not helper or command runtime output leaks.
- Service/exporter/listener scan found only command/spec/handoff negative text, not runtime startup code.
- Parsed `package.json` script scan: `runtime:memory:hydrate-shadow` is exactly `node openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs`; it passes no `--persist`, `--read-shadow`, or `--database`; `predev`, `dev`, `build`, `package`, and `release` do not invoke the command/helper/build flag or implicit flags.
- Command script no-write/no-default-db scan: no direct `DatabaseSync`, default DB, persistence store, append, insert, update, delete, trim, migrate, or schema calls; persist/readShadow/database are populated only from explicit CLI flags.
- README docs sync scan across `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`: no Runtime Memory/read hydration public docs surface requiring update.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/replay.mjs`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/compare.mjs`: passed.

## Docs And Rollback

README sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README change is needed because Phase 23 does not change product behavior, UI, Gateway behavior, public runtime behavior, release-facing docs, or user workflow.

Rollback is to remove `runtime:memory:hydrate-shadow` from `package.json`, remove `openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs`, remove `tests/unit/runtime-memory-read-hydration-shadow-command.test.ts`, remove this Phase 23 spec/handoff/index addendum, and keep Phase 21/22 helper/build behavior gated by omitted `runtime.memory.persist`, helper-level `readShadow`, or explicit database path.

## Rejected Scope

Still rejected: Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contract changes, provider ordering or default provider registration, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/context/model-message injection, automatic fact extraction/promotion, raw retention, services/exporters/listeners/daemons/servers, database-service work, package/build/dev/release hydration invocation, implicit persist/database/read-shadow enablement, default database selection, and any memory-derived runtime authority.

## Index

`runtime-research/agent-runtime-index.md` was updated with a Phase 23 addendum.

Status: accepted
