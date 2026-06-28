# Phase 21 Runtime Memory Readonly Read Hydration Shadow Pilot Synthesis

## Decision

Accepted scope is narrow: Phase 21 adds a default-off, explicit readonly Runtime Memory read-hydration shadow diagnostics helper. The helper may read sanitized bounded episode summaries and sanitized fact projections only when `runtime.memory.persist` is explicitly true, helper-level `readShadow` is explicitly true, and an explicit existing database path is provided.

The helper is diagnostics-only. It returns a skipped/loaded/error result state, diagnostics, stats, bounded projections, and authority boundary markers. Those markers state readonly, diagnostics-only, no prompt injection, no provider ordering, no runtime authority, and no durable fact authority.

## Rechecked Lanes

- Lane A accepted: result contract, explicit opt-in, bounded projections, diagnostics, stats, and authority markers are present.
- Lane B accepted: disabled, missing opt-in, missing path, missing database, and unrelated database states stay no-open/no-create/no-write/no-migrate.
- Lane C accepted: output is sanitized and does not return `record_json`, raw rows, raw task text, prompt/template/tool/env/secret/trace markers, or raw fact/candidate records.
- Lane D accepted: no Gateway, Electron, renderer, shared, host-api/api-client, provider registry, TaskLoop, prompt, model, provider ordering, or runtime authority cutover is added.
- Lane E accepted pending final validation update: rollback/docs validation is defined; README sync review concludes no README edit is needed for an internal diagnostics-only helper.

## Validation

- Phase 20 prerequisite: synthesis exists, has exactly one accepted final marker.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot.md`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot.md`: blocked by broad unrelated dirty/untracked files outside Phase 21 touched areas.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot.md --no-diff`: passed.
- Phase 20/19/18/17/16/15/14/13/12/11/10/9 structural validates with `--no-diff`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-operator-inspection.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts`: passed, 35 tests.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs`: blocked by unrelated existing `openclaw_runtime/src/auto-reply/reply/get-reply.ts:1030` unexpected end-of-file parse error.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: passed.
- Renderer direct IPC/Gateway scan: no matches.
- Gateway/Electron/shared/host-api/api-client/provider/TaskLoop hydration cutover scans: no product-path matches; helper appears only in `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts`.
- TaskLoop memory read/fact/provider scan: no matches.
- Package/build/dev/release hydration invocation scan: no matches.
- Utility/helper mutation scan for migrate/write/append/insert/update/delete/trim calls in the helper: no matches.
- Raw-retention and service/exporter/listener scans found policy/test/handoff negative text only, not helper runtime output or startup code.
- README docs sync review: no README updates required.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/replay.mjs`: passed.
- `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/compare.mjs`: passed.

## Docs And Rollback

README sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README change is needed because Phase 21 does not change product behavior, UI, Gateway behavior, public runtime behavior, public package commands, or user workflow.

Rollback is to remove `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts`, remove its runtime-core barrel export, and remove `tests/unit/runtime-memory-read-hydration-shadow.test.ts`. Omitting `runtime.memory.persist` or helper-level `readShadow` gives no-open/no-read/no-write behavior.

## Rejected Scope

Still rejected: Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contract changes, provider ordering or default provider registration, TaskLoop memory reads, prompt/context/model-message injection, automatic fact extraction/promotion, raw retention, services/exporters/listeners/daemons/servers, database-service work, package/build/dev/release hydration invocation, implicit persist/database/read-shadow enablement, and any memory-derived runtime authority.

## Index

`runtime-research/agent-runtime-index.md` was updated with a Phase 21 addendum.

Status: accepted
