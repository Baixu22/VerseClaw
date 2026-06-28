# Phase 11 Lane C: Read Hydration And Provider Boundary

## Scope Confirmation

- Lane: `lane-c-read-hydration-provider-boundary`
- Output file: `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-c-read-hydration-provider-boundary.md`
- Files reviewed: `AGENTS.md`; `C:\Users\27933\.codex\RTK.md`; `openclaw_runtime/AGENTS.md`; Phase 11 spec/README/parallel-lanes/submission-template; Phase 10 synthesis and Lane A submission; Phase 9 synthesis; `runtime-research/agent-runtime-index.md`; `openclaw_runtime/src/runtime-core/memory-persistence.ts`; `openclaw_runtime/src/runtime-core/memory-store.ts`; `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`; `openclaw_runtime/src/context-engine/memory-context-provider.ts`; `openclaw_runtime/src/context-engine/provider-registry.ts`; focused runtime memory and context-provider tests.
- Files changed: `tests/unit/runtime-memory-runtime-integration.test.ts`; this submission.
- Runtime behavior changed: no. Test-only proof was added.
- TaskLoop/Gateway/provider ordering changed: no.
- Main/Gateway/host-api/api-client paths changed: no.

## Executive Summary

Lane C is accepted. The Phase 11 adapter read path already delegates enabled reads to the Phase 9 persistence owner and returns only a `RuntimeMemoryStore` snapshot. Disabled `runtime.memory.persist` returns a skipped result with a fresh empty store before SQLite is opened.

This lane adds focused tests proving provider hydration is optional and explicit: the memory provider is created with `queryFacts: (query) => loaded.store.queryFacts(query)` and registered only through `createContextProviderRegistryPilot([memoryProvider])`. `runtime.memory.persist` remains independent from `runtime.memory.provider`; persist alone produces fallback output and does not invoke `queryFacts`.

## Phase Entry Confirmation

| Required Entry Fact | Evidence | Result |
|---|---|---|
| Phase 10 synthesis accepted | `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md` decision accepts boundary/readiness only and ends accepted. | pass |
| Phase 10 accepted only default-off boundary/readiness | Phase 10 synthesis rejects TaskLoop cutover, Gateway cutover, provider ordering cutover, default-on persistence, default provider registration, raw retention, service/exporter/database-service/listener work, memory runtime authority, and implemented runtime read/write wiring. | pass |
| Phase 9 accepted only default-off local sanitized persistence foundation | `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md` accepts only standalone local SQLite sanitized episode/fact/invalidation persistence foundation. | pass |
| Phase 11 Lane A adapter boundary is stable | `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-a-adapter-contract-flag-off-parity.md` accepts the isolated adapter and proves disabled no-open parity. | pass |

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Adapter read hydration returns a `RuntimeMemoryStore` snapshot or skipped result only | file/test | `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`; `tests/unit/runtime-memory-runtime-integration.test.ts` | `loadStore()` lines 89-97; read hydration test lines 124-203 | Disabled path creates an empty `RuntimeMemoryStore`; enabled path delegates to the Phase 9 owner and test queries `loaded.store.queryFacts(...)`. |
| Enabled reads call the Phase 9 persistence owner | file | `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts` | `createRuntimeMemoryPersistenceStore` lines 10 and 52; `return this.#persistence.loadStore()` line 97 | The adapter has no raw row reader of its own. |
| Disabled persist does not open/read SQLite | test | `tests/unit/runtime-memory-runtime-integration.test.ts` | disabled no-open test lines 31-64 | Injected opener throws if called; migrate/write/load all skip and `openCalls` remains zero. |
| Provider hydration is explicit extra-provider injection only | test | `tests/unit/runtime-memory-runtime-integration.test.ts` | lines 157-168 | Test uses `createRuntimeMemoryContextProvider({ queryFacts: (query) => loaded.store.queryFacts(query) })` and `createContextProviderRegistryPilot([memoryProvider])`. |
| Default provider ordering remains unchanged | file/test/scan | `openclaw_runtime/src/context-engine/provider-registry.ts`; `tests/unit/context-provider-registry.test.ts`; provider-ordering scan | provider registry lines 252-258; test lines 157-177 | Registry remains legacy context engine, loop context pack, then explicit extras. |
| `runtime.memory.persist` does not enable provider output | test | `tests/unit/runtime-memory-runtime-integration.test.ts` | lines 206-247 | With `persist: true` and `provider: false`, provider returns fallback, no context items, and `queryFacts` is not called. |
| Provider output remains readonly, budgeted, shadow/no-authority | file/test | `openclaw_runtime/src/context-engine/memory-context-provider.ts`; `tests/unit/runtime-memory-context-provider.test.ts`; new integration provider test | provider metadata lines 65-84, 145-167, 353-361; integration test lines 179-201 | Manifest/result metadata preserve readonly, no dump, and no completion/verifier/security/retry/tool/runtime authority. |
| Current-valid queries exclude invalidated, expired, rejected, candidate, and unpromoted facts by default | test/file | `tests/unit/runtime-memory-store.test.ts`; `openclaw_runtime/src/runtime-core/memory-context.ts` | store tests lines 294 and 349; query code lines 900-928 and 1176-1194 | Focused suite passed. |
| No raw row or raw JSON prompt dump exposure | test/scan | `tests/unit/runtime-memory-runtime-integration.test.ts`; raw-row scan | lines 137, 202-203 | Provider result excludes `RAW_ROW_DO_NOT_LEAK` and `record_json`; raw-row scan matches only negative fixtures/assertions. |
| No TaskLoop/Gateway/provider-ordering cutover | scan | runtime authority import scan | no matches | No memory integration/persistence owner imports in TaskLoop, Gateway, Electron, shared, renderer host APIs, or default provider registry. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | `tests/unit/runtime-memory-runtime-integration.test.ts` disabled no-open test | pass | none |
| No SQLite open/read/write when disabled | Injected throwing `openDatabase` in runtime integration test; focused persistence disabled test also passed | pass | none |
| Adapter isolation from TaskLoop/Gateway/Electron/renderer/shared/default registry | `rtk.exe rg -n 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts` | pass | no matches |
| Persistence read boundary | `memory-runtime-integration.ts:89-97`; `memory-persistence.ts:409-435` | pass | returns skipped or `RuntimeMemoryStore`, not raw rows |
| Persistence write boundary | Existing Phase 9/11 focused tests passed | pass | no new write production code |
| Store owner and schema preserved | `memory-persistence.ts` owner/schema unchanged; persistence tests passed | pass | none |
| Migration and idempotency preserved | `tests/unit/runtime-memory-persistence.test.ts` passed | pass | none |
| Retention and redaction preserved | `tests/unit/runtime-memory-store.test.ts` and `tests/unit/runtime-memory-persistence.test.ts` passed | pass | none |
| Raw chat/raw trace rejection | `tests/unit/runtime-memory-context-contracts.test.ts`, store/persistence tests, raw-retention scan | pass | scan matches only negative fixtures/assertions in provider tests |
| No raw retention | Provider result assertions exclude raw marker and `record_json`; touched-file raw scan reviewed | pass | none |
| No service/exporter/database-service/listener | `rtk.exe rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/runtime-core/memory-runtime-integration.ts tests/unit/runtime-memory-runtime-integration.test.ts openclaw_runtime/src/context-engine/memory-context-provider.ts tests/unit/runtime-memory-context-provider.test.ts` | pass | no matches |
| Provider ordering unchanged | Provider-ordering scan; `context-provider-registry.test.ts`; new explicit extra-provider test | pass | none |
| Source episode/evidence refs | Existing store/persistence/provider tests passed | pass | no new durable facts without refs |
| Durable promotion gate | Existing context/store/persistence tests passed | pass | no new promotion code |
| Current-valid query exclusion | `runtime-memory-store.test.ts` current-valid tests passed | pass | none |
| Rollback proof | Disable `runtime.memory.persist` and omit the optional memory extra provider | pass | persisted rows are preserved |
| Config help/docs sync | not applicable | pass | no operator/user-visible config wording changed in Lane C |
| Comms replay/compare if required | not run | not applicable | Lane C changed tests/submission only; no Main/Gateway/host-api/api-client/provider transport path changed |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | Defaults remain covered by focused memory contract/config tests. |
| No TaskLoop/Gateway/provider cutover | pass | Runtime authority import scan returned no matches. |
| No raw chat-log/raw trace memory | pass | Focused tests passed; touched-file raw scan has only explicit negative fixture/assertion matches. |
| No unverified durable facts | pass | Existing durable promotion gate tests passed; Lane C adds no promotion code. |
| No provider-ordering cutover | pass | Registry code remains legacy provider, loop provider, then explicit extras. |
| No runtime authority | pass | Provider metadata and tests assert no completion/verifier/security/retry/tool/runtime authority. |
| No service/exporter/database-service/listener | pass | Service/exporter/listener scan returned no matches. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md` | pass | Phase 11 context/read order | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md` | pass | Phase 11 harness validate | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 prerequisite | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 prerequisite | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-runtime-integration.test.ts` | pass, 1 file / 4 tests | New Lane C tests plus Lane A adapter proof | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts` | pass, 8 files / 45 tests | Requested focused runtime memory/provider/registry suite | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node typecheck | no diagnostics |
| Renderer bypass scan over `src/pages src/components` | pass | No direct IPC/Gateway HTTP/WebSocket bypass | no matches |
| Provider ordering scan over provider registry and focused tests | pass/reviewed | Default registry and explicit extra-provider tests | intended matches only |
| Runtime authority import scan | pass | No TaskLoop/Gateway/Electron/shared/renderer/default-registry persistence wiring | no matches |
| Raw-retention and raw-row scan over touched/provider files | pass/reviewed | No provider dump of raw row/raw JSON; negative markers only in assertions | none |
| Service/exporter/database-service/listener scan over touched/provider files | pass | No service/exporter/listener work | no matches |

## Design Conflicts

| Conflict | Evidence | Resolution |
|---|---|---|
| `rtk` is not on PATH in this PowerShell session. | Bare `rtk` failed; `C:\Users\27933\.cherrystudio\bin\rtk.exe` works and was used for validation. | Use the direct RTK binary path for this workspace. |
| Worktree contains many unrelated dirty and untracked files. | `git status -sb` shows broad pre-existing changes outside Lane C. | Lane C changed only `tests/unit/runtime-memory-runtime-integration.test.ts` and this submission; unrelated changes were not reverted. |
| Provider hydration must not become default registration. | Provider registry code remains explicit extras only; tests use `createContextProviderRegistryPilot([memoryProvider])`. | Keep provider hydration test-only/explicit until a later cutover synthesis accepts runtime wiring. |

Status: accepted
