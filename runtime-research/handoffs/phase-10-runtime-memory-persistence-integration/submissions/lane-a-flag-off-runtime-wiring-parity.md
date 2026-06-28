# Phase 10 Lane A: Flag-Off Runtime Wiring Parity

## Scope Confirmation

- Lane: `lane-a-flag-off-runtime-wiring-parity`
- Output file: `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/submissions/lane-a-flag-off-runtime-wiring-parity.md`
- Files reviewed: `AGENTS.md`; `C:\Users\27933\.codex\RTK.md`; `openclaw_runtime/AGENTS.md`; Phase 10 spec; Phase 9 spec and synthesis; Phase 10 README, parallel lanes, and submission template; `runtime-research/agent-runtime-index.md`; harness context scenario/rules/layers; focused runtime memory persistence/provider/TaskLoop source and tests.
- Files changed: `tests/unit/context-provider-registry.test.ts`; `tests/unit/task-loop-controller.test.ts`; this submission.
- Runtime behavior changed: no
- TaskLoop/Gateway/provider ordering changed: no
- Main/Gateway/host-api/api-client paths changed: no

## Executive Summary

Lane A is accepted as a flag-off integration proof only. No production runtime wiring was added. The existing Phase 9 `memory-persistence.ts` API already skips before SQLite open/migrate/read/write when `runtime.memory.persist` is false, and this lane adds focused tests proving explicit `persist: false` does not register the memory provider, change provider ordering, or alter `task_loop` tool / warning-only verifier behavior.

The current worktree had pre-existing unrelated dirty Main/Gateway/host-api/provider-adjacent files. This lane did not touch those paths, but comms replay/compare were run anyway.

## Phase 9 Entry Confirmation

| Required Entry Fact | Evidence | Result |
|---|---|---|
| Phase 9 synthesis accepted | `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md` ends with `Status: accepted`. | pass |
| Phase 9 accepted only default-off local sanitized persistence foundation | Phase 9 synthesis decision accepts only standalone local SQLite sanitized episode/fact/invalidation persistence. | pass |
| Runtime cutover/default-on/provider ordering/raw retention/runtime authority remained rejected | Phase 9 synthesis rejected runtime cutover, default-on memory, provider ordering cutover, raw retention, unverified durable facts, services/exporters/listeners, and runtime authority. | pass |
| Phase 10 task spec exists and validates | `rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` -> valid. | pass |

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Disabled persistence does not open, migrate, read, or write SQLite | file/test | `openclaw_runtime/src/runtime-core/memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | `migrate`, `appendEpisode`, `appendFact`, `invalidateFact`, and `loadStore` check `persistEnabled()` before `withWriteTransaction`; no-open test at lines 31-64. | Existing API was sufficient; no production seam needed. |
| Provider ordering is unchanged with `runtime.memory.persist=false` | test | `tests/unit/context-provider-registry.test.ts` | New test at lines 157-177. | Registry remains `legacy-context-engine`, `loop-context-pack`; `runtime-memory` is not resolved. |
| TaskLoop tool and warning-only verifier behavior are unchanged with `runtime.memory.persist=false` | test | `tests/unit/task-loop-controller.test.ts` | New test at lines 1941-1999. | `task_loop` still completes, returns normal result policy, and emits the same warning-only verifier report/checkpoint metadata. |
| No runtime authority path imports persistence | scan | `rtk.exe rg -n 'memory-persistence|createRuntimeMemoryPersistenceStore|RUNTIME_MEMORY_PERSISTENCE_OWNER' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron src/lib shared openclaw_runtime/src/context-engine/provider-registry.ts` | `NO_MATCHES` | Confirms TaskLoop/Gateway/Electron/renderer/shared/provider registry were not wired to the persistence owner. |
| Production persistence code has no raw-retention literals | scan | `rtk.exe rg -n <raw-retention-pattern> openclaw_runtime/src/runtime-core/memory-persistence.ts` | `NO_MATCHES` | Raw fixture matches exist only in tests and are reviewed below. |
| No service/exporter/database-service/listener was added | scan | `rtk.exe rg -n <service-exporter-pattern> openclaw_runtime/src/runtime-core/memory-persistence.ts tests/unit/context-provider-registry.test.ts tests/unit/task-loop-controller.test.ts` | `NO_MATCHES` | No HTTP/WebSocket server, OTLP/exporter/collector, Temporal, or Express surface. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | New provider-ordering and task_loop tool/verifier tests; existing persistence no-open test. | pass | none |
| No SQLite open/read/write when disabled | `tests/unit/runtime-memory-persistence.test.ts` lines 31-64; focused runtime memory suite. | pass | none |
| Persistence read boundary | `memory-persistence.ts` `loadStore()` returns skipped before transaction when disabled. | pass | No runtime read wiring added. |
| Persistence write boundary | `appendEpisode`, `appendFact`, `invalidateFact` return skipped before transaction when disabled. | pass | No runtime write wiring added. |
| Store owner and schema preserved | `RUNTIME_MEMORY_PERSISTENCE_OWNER`; persistence scan only found intended owner/schema/test references. | pass | none |
| Migration and idempotency preserved | Existing focused persistence tests passed. | pass | none |
| Retention and redaction preserved | Existing focused persistence tests passed; production raw scan had no matches. | pass | none |
| Raw chat/raw trace rejection | Production persistence raw scan `NO_MATCHES`; test raw matches are negative fixtures/assertions and trace sanitization fixtures. | pass | none |
| No raw retention | Production persistence raw scan `NO_MATCHES`. | pass | none |
| No service/exporter/database-service/listener | Service/exporter scan `NO_MATCHES`. | pass | none |
| Provider ordering unchanged | `tests/unit/context-provider-registry.test.ts` new `persist:false` ordering test. | pass | none |
| Source episode/evidence refs | Existing persistence tests assert persisted sanitized records and source/evidence refs. | pass | No new runtime records created. |
| Durable promotion gate | Existing persistence tests assert verified-looking candidates remain candidates without promotion. | pass | none |
| Current-valid query exclusion | Existing runtime memory store/context tests passed. | pass | none |
| Rollback proof | Disable `runtime.memory.persist`; no runtime path opens/reads/writes persistence. | pass | Existing persisted rows are preserved. |
| Comms replay/compare if required | `rtk.exe node scripts/comms/replay.mjs`; `rtk.exe node scripts/comms/compare.mjs`. | pass | Run conservatively because worktree had unrelated dirty comm paths. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | Defaults remain covered by `runtime-memory-context-contracts.test.ts`; no production default changed. |
| No TaskLoop/Gateway/provider cutover | pass | No production code changed; runtime authority import scan returned `NO_MATCHES`. |
| No raw chat-log/raw trace memory | pass | Production persistence raw scan returned `NO_MATCHES`; touched-test raw matches are negative/sanitization fixtures. |
| No unverified durable facts | pass | Existing persistence and memory context tests passed. |
| No provider-ordering cutover | pass | New `persist:false` provider ordering test passed. |
| No runtime authority | pass | Persistence owner is still standalone and not imported by TaskLoop/Gateway/Electron/renderer/shared/provider registry. |
| No service/exporter/database-service/listener | pass | Service/exporter scan returned `NO_MATCHES`. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 reading list | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 spec validity | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 prerequisite spec validity | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-persistence.test.ts tests/unit/context-provider-registry.test.ts tests/unit/task-loop-controller.test.ts` | pass, 3 files / 57 tests | Newly touched tests plus persistence no-open proof | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/context-provider-registry.test.ts tests/unit/task-loop-controller.test.ts` | pass, 7 files / 86 tests | Focused runtime memory plus TaskLoop proof | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node typecheck | none |
| Renderer bypass scan over `src/pages src/components` | pass | No direct IPC/Gateway HTTP/WebSocket bypass | `NO_MATCHES` |
| Production raw-retention scan over `memory-persistence.ts` | pass | No raw persistence literals in production persistence owner | `NO_MATCHES` |
| Touched-test raw-retention scan | pass/reviewed | Negative persistence fixtures and existing trace sanitization fixtures | Matches are expected test data only. |
| Service/exporter/database-service/listener scan | pass | No new service/exporter/listener | `NO_MATCHES` |
| Runtime authority import scan | pass | No persistence import into TaskLoop/Gateway/Electron/renderer/shared/provider registry | `NO_MATCHES` |
| Persistence surface scan | pass/reviewed | Intended Phase 9 owner/test references only | No runtime authority wiring found. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/replay.mjs` | pass | Conservative comms replay | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/compare.mjs` | pass | Conservative comms compare | none |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| `rtk` was not on PATH. | `rtk --version` failed, but Phase 9 synthesis documented `C:\Users\27933\.cherrystudio\bin\rtk.exe`; that direct binary worked for validation/tests/scans. | Continue using direct `rtk.exe` path in this workspace unless PATH is repaired. |
| Worktree had unrelated dirty communication/runtime files before this lane. | `git status -sb` showed many dirty and untracked files outside Lane A. | This lane changed only focused tests and submission; comms replay/compare were run conservatively. |
| Phase 10 allows planning/wiring proof but rejects runtime cutover. | Phase 10 spec and README reject TaskLoop/Gateway/provider/default-on cutover in entry prep. | No production runtime code was changed; future runtime read/write integration needs later lane evidence and synthesis. |

## Status

```text
Status: accepted
```
