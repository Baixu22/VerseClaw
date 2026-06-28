# Phase 10 Lane C: Provider and Context Hydration Boundary

## Scope Confirmation

- Lane: `lane-c-provider-context-hydration-boundary`
- Output file: `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/submissions/lane-c-provider-context-hydration-boundary.md`
- Files reviewed: `AGENTS.md`; `C:\Users\27933\.codex\RTK.md`; `openclaw_runtime/AGENTS.md`; `harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md`; `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md`; Phase 10 README, parallel lanes, submission template, and Lane A submission; Phase 9 synthesis; `runtime-research/agent-runtime-index.md`; harness context scenario/rules/layers; `openclaw_runtime/src/context-engine/memory-context-provider.ts`; `openclaw_runtime/src/context-engine/provider-registry.ts`; `openclaw_runtime/src/runtime-core/memory-store.ts`; `openclaw_runtime/src/runtime-core/memory-context.ts`; `openclaw_runtime/src/runtime-core/memory-persistence.ts`; focused memory provider/store/persistence/registry tests.
- Files changed: this submission only.
- Runtime behavior changed: no.
- TaskLoop/Gateway/provider ordering changed: no.
- Main/Gateway/host-api/api-client paths changed: no.

## Executive Summary

Lane C is accepted as a provider/context hydration boundary proof. Future context hydration may consume a loaded `RuntimeMemoryStore` only by passing a readonly query adapter, such as `queryFacts: (query) => loaded.store.queryFacts(query)`, into `createRuntimeMemoryContextProvider(...)` and registering that provider explicitly as an extra provider. This lane does not implement default provider registration, TaskLoop/Gateway cutover, provider ordering cutover, prompt memory dumps, default-on flags, or runtime authority.

The default registry remains `legacy-context-engine -> loop-context-pack`; `runtime-memory` is absent unless explicitly supplied through `extraProviders`. The memory provider remains optional, readonly, token-budgeted, shadow-only/no-authority, and disabled unless `runtime.memory.provider` is explicitly true. Current-valid queries still exclude invalidated, expired, rejected, candidate, and unpromoted facts by default. Durable facts still require verifier, human, or deterministic-rule promotion evidence plus source episode refs and evidence refs.

## Future Hydration Boundary

Future integration may use this shape only after a later synthesis accepts the read boundary:

1. If `runtime.memory.persist` is false, do not open/read/write SQLite; `loadStore()` currently returns an empty store with `status: "skipped"` before DB open.
2. If `runtime.memory.persist` is true and later accepted, call the Phase 9 persistence owner `createRuntimeMemoryPersistenceStore(...).loadStore()` to produce a sanitized `RuntimeMemoryStore` snapshot.
3. Pass the loaded store into the provider by callback, not by global/default registration: `createRuntimeMemoryContextProvider({ config, queryFacts: (query) => loaded.store.queryFacts(query) })`.
4. Register the memory provider only as an explicit extra provider: `createContextProviderRegistryPilot([memoryProvider])`.
5. Keep `runtime.memory.provider` as a separate explicit flag; `runtime.memory.persist` alone must not enable provider output.
6. Provider output stays readonly context items with source/evidence refs and token budgets. It cannot grant completion, verifier, security, retry, tool, or runtime authority.

## Phase 9 Entry Confirmation

| Required Entry Fact | Evidence | Result |
|---|---|---|
| Phase 9 synthesis accepted | `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md` decision and final accepted line. | pass |
| Phase 9 accepted only default-off local sanitized persistence foundation | Phase 9 synthesis accepts standalone local SQLite sanitized episode/fact/invalidation persistence and rejects runtime cutover/default-on/provider ordering/raw retention/runtime authority. | pass |
| Runtime cutover/default-on/provider ordering/raw retention/runtime authority remained rejected | Phase 9 synthesis rejected those surfaces; Phase 10 task repeats the rejection boundary. | pass |

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Future hydration can consume a loaded store without default registration | file | `openclaw_runtime/src/runtime-core/memory-persistence.ts`; `openclaw_runtime/src/context-engine/memory-context-provider.ts`; `openclaw_runtime/src/runtime-core/memory-store.ts` | `loadStore()` lines 409-438; `readFacts()` lines 267-274; `queryFacts()` lines 266-303 | The accepted shape is explicit callback injection from a loaded store, not default registry wiring. |
| Disabled persistence opens/reads/writes nothing | file/test | `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | `persistEnabled()` lines 441-443; disabled `loadStore()` lines 409-417; no-open test starts line 31 | `persist:false` returns skipped and empty store before DB open. |
| Memory provider remains optional/default-off/shadow-only | file/test | `memory-context-provider.ts`; `runtime-memory-context-provider.test.ts` | manifest lines 51-85; disabled branch lines 90-117; test starts line 32 | `enabledByDefault:false`, `shadowOnly:true`, and flag-disabled fallback are covered. |
| Memory provider remains readonly and budgeted | file/test | `memory-context-provider.ts`; `runtime-memory-context-provider.test.ts` | result lines 180-197; budget summary lines 280-307; test starts line 253 | Summaries are readonly and constrained by token budget. |
| Memory provider has no runtime authority | file/test | `memory-context-provider.ts`; `runtime-memory-context-provider.test.ts` | manifest metadata lines 76-85; result metadata lines 139-173; context item metadata lines 341-362; tests start lines 32 and 285 | Metadata explicitly marks no completion/verifier/security/retry/tool/runtime authority. |
| Default provider ordering unchanged | file/test/scan | `provider-registry.ts`; `context-provider-registry.test.ts`; provider ordering scan | registry lines 252-259; tests start lines 31 and 157 | Registry constructs legacy, loop pack, then explicit extras. |
| Memory provider can only be explicit extra provider | file/test/scan | `provider-registry.ts`; `runtime-memory-context-provider.test.ts`; no-default-registration scan | no `runtime-memory` match in `provider-registry.ts`; explicit extra test lines 34-45 | Default registry excludes memory; test proves explicit extra appends after loop pack. |
| Current-valid defaults exclude invalidated/expired facts | file/test | `memory-context.ts`; `memory-store.ts`; `runtime-memory-store.test.ts` | valid-at lines 900-925; store invalidation overlay lines 306-327; test starts line 294 | Accepted invalidations affect current view; invalidated/expired require explicit include flags. |
| Current-valid defaults exclude candidate/rejected/unpromoted facts | file/test | `memory-context.ts`; `memory-store.ts`; `runtime-memory-store.test.ts`; `runtime-memory-context-provider.test.ts` | verification lines 1176-1195; shape gate lines 497-510; store test starts line 349; provider test starts line 212 | Candidates/rejected require explicit include flags; verified-looking candidates without promotion need explicit status query. |
| Durable facts require promotion evidence plus source/evidence refs | file/test | `memory-context.ts`; `runtime-memory-store.test.ts`; `runtime-memory-persistence.test.ts` | accepted statuses lines 76-80; promotion type lines 178-208; guards lines 530-584; persistence candidate assertions lines 207-237 | Durable `RuntimeMemoryTemporalFact` requires accepted status, `acceptedAt`, promotion evidence, source episode refs, and evidence refs. |
| Raw retention is rejected or redacted | file/test/scan | raw-retention scans; `memory-context.ts`; persistence/store tests | rejection reasons lines 97-109; denylist lines 346-391; tests line 97 and line 67 | Production provider/store/persistence/registry scan had no matches; broader memory-context/test matches are sanitizer denylist and negative fixtures. |
| No service/exporter/database-service/listener added | scan | service/exporter/database-service/listener scans | no matches | No service, exporter, database-service, listener, HTTP/WebSocket, OTLP, Temporal, or Express surface was added. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | `memory-persistence.ts` disabled branches; `runtime-memory-persistence.test.ts` no-open test; `context-provider-registry.test.ts` provider-ordering test. | pass | No runtime code changed. |
| No SQLite open/read/write when disabled | `tests/unit/runtime-memory-persistence.test.ts` line 31; `memory-persistence.ts` lines 342-417 and 441-443. | pass | none |
| Persistence read boundary | `memory-persistence.ts` `loadStore()` lines 409-438. | pass | Future runtime read wiring not implemented. |
| Persistence write boundary | `memory-persistence.ts` append/invalidate methods lines 358-407. | pass | Future runtime write wiring not implemented. |
| Store owner and schema preserved | `memory-persistence.ts` owner/schema lines 42-44. | pass | none |
| Migration and idempotency preserved | Focused persistence tests passed; `memory-persistence.ts` migrate lines 342-355. | pass | none |
| Retention and redaction preserved | Focused store/persistence tests passed; raw production scan over provider/store/persistence/registry had no matches. | pass | none |
| Raw chat/raw trace rejection | `memory-context.ts` rejection reasons/denylist lines 97-109 and 346-391; negative tests reviewed. | pass | none |
| No raw retention | Production scan over `memory-context-provider.ts`, `provider-registry.ts`, `memory-store.ts`, `memory-persistence.ts` returned no matches. | pass | Broader scan matches are sanitizer denylist and negative tests only. |
| No service/exporter/database-service/listener | Service/exporter/database-service/listener scans returned no matches. | pass | none |
| Provider ordering unchanged | `provider-registry.ts` lines 252-259; provider ordering scan; focused registry tests. | pass | none |
| Source episode/evidence refs | `memory-context.ts` lines 185-208, 563-584; store/persistence tests with source/evidence refs. | pass | none |
| Durable promotion gate | `memory-context.ts` lines 178-208 and 530-584; persistence candidate assertions lines 207-237. | pass | none |
| Current-valid query exclusion | `memory-context.ts` lines 900-925 and 1176-1195; `memory-store.ts` lines 293-303 and 497-510; store/provider tests. | pass | none |
| Rollback proof | Disable `runtime.memory.persist` and omit explicit memory extra provider; default registry and provider flags stay off. | pass | Existing persisted rows are preserved by omission/disable. |
| Comms replay/compare if required | `rtk.exe node scripts/comms/replay.mjs`; `rtk.exe node scripts/comms/compare.mjs`. | pass | Run conservatively because the pre-existing dirty worktree includes transport-adjacent paths; Lane C did not change them. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` keeps all memory flags false at `memory-context.ts` lines 129-134. |
| No TaskLoop/Gateway/provider cutover | pass | No production code changed; scans found no memory provider/persistence owner wiring into TaskLoop/Gateway/Electron/renderer/shared/default registry. |
| No raw chat-log/raw trace memory | pass | Raw production scan over provider/store/persistence/registry returned no matches; sanitizer/test matches reviewed. |
| No unverified durable facts | pass | Durable fact guard requires accepted status, `acceptedAt`, and promotion evidence; candidates stay candidates unless explicitly queried. |
| No provider-ordering cutover | pass | Default registry remains legacy then loop pack; memory only through explicit extra provider. |
| No runtime authority | pass | Provider manifest/result/context item metadata all mark no completion/verifier/security/retry/tool/runtime authority. |
| No service/exporter/database-service/listener | pass | Service/exporter/database-service/listener scans returned no matches. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 read order | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 spec validity | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 prerequisite validity | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/context-provider-registry.test.ts` | pass, 6 files / 37 tests | Focused memory contracts, store, proposal shadow, provider, persistence, registry | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node typecheck | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components` | pass/no matches | Renderer boundary | `rg` exit 1 means no matches. |
| Raw-retention scan over focused provider/store/persistence/registry production files | pass/no matches | No raw retention in Lane C production boundary | `rg` exit 1 means no matches. |
| Raw-retention scan over focused memory source/tests | pass/reviewed | Sanitizer denylist and negative fixtures | Matches are raw rejection classifiers or tests asserting rejection/redaction. |
| Service/exporter/database-service/listener scans over focused memory files/tests | pass/no matches | No service/exporter/listener additions | `rg` exit 1 means no matches. |
| Provider ordering scan over registry/provider tests | pass | Default order and explicit extra-provider proof | none |
| No-default-registration scan for `runtime-memory`/memory provider/persistence imports in TaskLoop/Gateway/Electron/renderer/shared/default registry | pass/no matches | No cutover or runtime authority wiring | `rg` exit 1 means no matches. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/replay.mjs` | pass | Conservative comms replay | Lane C did not change comm paths. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/compare.mjs` | pass | Conservative comms compare | Lane C did not change comm paths. |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| Future hydration could be mistaken for provider cutover. | `provider-registry.ts` only appends `extraProviders` after legacy and loop providers; Phase 10 forbids default registration. | Treat loaded-store hydration as an explicit extra-provider adapter only, gated by later synthesis. |
| `runtime.memory.persist` could be mistaken as enabling provider output. | `memory-persistence.ts` gates SQLite load/write; `memory-context-provider.ts` separately requires `runtime.memory.provider`. | Keep flags independent: persist may load a store only after later acceptance; provider output still requires explicit provider flag and explicit registration. |
| Unpromoted verified-looking candidates can appear if callers explicitly ask by status. | `runtime-memory-store.test.ts` proves default exclusion and explicit status inclusion. | Keep default current-valid queries strict; explicit historical/audit queries may request candidates/statuses without making them durable. |
| Current worktree has unrelated dirty Main/Gateway/host-api/provider-adjacent files. | `git status -sb` showed pre-existing dirty files outside Lane C. | Lane C changed only this submission; comms replay/compare were run conservatively. |

## Status

```text
Status: accepted
```
