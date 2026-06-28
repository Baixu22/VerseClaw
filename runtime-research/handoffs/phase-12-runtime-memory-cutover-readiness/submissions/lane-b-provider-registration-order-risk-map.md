# Phase 12 Lane B Submission: Provider Registration And Provider Ordering Cutover Risk Map

## Scope Confirmation

- Lane: `lane-b-provider-registration-order-risk-map`
- Output file: `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/submissions/lane-b-provider-registration-order-risk-map.md`
- Files reviewed: `openclaw_runtime/src/context-engine/provider-registry.ts`; `openclaw_runtime/src/context-engine/memory-context-provider.ts`; `tests/unit/context-provider-registry.test.ts`; `tests/unit/runtime-memory-context-provider.test.ts`; `tests/unit/runtime-memory-runtime-integration.test.ts`; Phase 12 task spec and handoff lane instructions.
- Files changed: `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/submissions/lane-b-provider-registration-order-risk-map.md`
- Runtime behavior changed: no
- TaskLoop/Gateway/runtime call-site import changed: no
- Provider registration/order changed: no
- Main/Gateway/host-api/api-client paths changed: no

## Executive Summary

Lane B is accepted as a provider registration and provider ordering risk map only. Current provider registration remains legacy provider, loop provider, then explicit extras. Runtime Memory is not registered by default, `runtime.memory.persist` does not enable provider output, and `runtime.memory.provider` remains the separate explicit flag required for memory provider output.

This lane does not accept default Runtime Memory provider registration, provider ordering cutover, prompt-order changes, prompt-cache churn, provider-derived runtime authority, or `persist`-driven provider output. Any future default registration/order change needs a fresh cutover spec and proof plan covering prompt order impact, flag-off parity, rollback, provider output parity, no-authority metadata, comms regression, and prompt-cache byte/order risk.

## Phase Entry Confirmation

| Required Entry Fact | Evidence | Result |
|---|---|---|
| Phase 11 synthesis exists and ends accepted | `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md`; prior Lane A exact-ending check returned `ENDS_EXACT_STATUS_ACCEPTED` | pass |
| Phase 11 accepted only isolated default-off adapter wiring | Phase 11 synthesis decision rejects provider ordering/default registration/default-on/runtime authority cutover | pass |
| Phase 10 accepted only default-off integration boundary/readiness | `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md` decision | pass |
| Phase 9 accepted only default-off local sanitized persistence foundation | `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md` decision | pass |

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Default provider ordering remains legacy, loop, then explicit extras | file | `openclaw_runtime/src/context-engine/provider-registry.ts` | `createContextProviderRegistryPilot` lines 375-381 | Registry constructs `createLegacyContextEngineProvider()`, `createLoopContextPackProvider()`, then `...extraProviders`. |
| Legacy provider is shadow compatibility only | file | `openclaw_runtime/src/context-engine/provider-registry.ts` | lines 236-295 | Manifest is `enabledByDefault:false`, `shadowOnly:true`; diagnostics preserve message order. |
| Loop provider is shadow compatibility only | file | `openclaw_runtime/src/context-engine/provider-registry.ts` | lines 306-364 | Manifest is `enabledByDefault:false`, `shadowOnly:true`; diagnostics preserve prompt text and pack hash. |
| Memory provider is optional/default-off/shadow-only | file/test | `openclaw_runtime/src/context-engine/memory-context-provider.ts`; `tests/unit/runtime-memory-context-provider.test.ts` | source lines 48-84; test lines 32-63 | Manifest has `enabledByDefault:false`, `shadowOnly:true`, readonly/no-authority metadata. |
| Runtime Memory is absent from default registry | test | `tests/unit/runtime-memory-context-provider.test.ts` | lines 32-44 | Default registry lists legacy and loop only; memory appears only when passed as explicit extra. |
| Runtime Memory remains absent when persistence is disabled | test | `tests/unit/context-provider-registry.test.ts` | lines 215-235 | With `memory: { persist:false, provider:false }`, registry resolves no memory provider and provider results are legacy then loop. |
| `runtime.memory.provider` is the provider output gate | file/test | `openclaw_runtime/src/context-engine/memory-context-provider.ts`; `tests/unit/runtime-memory-context-provider.test.ts` | source lines 91-117 and 200-214; test lines 66-93 | Provider returns `flag_disabled` with required flag `runtime.memory.provider` when provider flag is false. |
| `runtime.memory.persist` does not enable provider output | test | `tests/unit/runtime-memory-runtime-integration.test.ts` | lines 339-373 | Provider configured with `{ persist:true, provider:false }` returns skipped/flag-disabled provider output and does not query facts. |
| Explicit memory provider injection appends after defaults | test | `tests/unit/runtime-memory-runtime-integration.test.ts` | lines 257-300 | Explicit `createContextProviderRegistryPilot([memoryProvider])` lists legacy, loop, memory in that order. |
| Provider output remains readonly/no-authority | file/test | `memory-context-provider.ts`; focused tests | source lines 145-167 and 342-361; tests lines 100-162 and 286-304 | Metadata repeats `readonlyMemoryContext`, `noCompletionAuthority`, `noVerifierAuthority`, `noSecurityAuthority`, `noRetryAuthority`, `noToolAuthority`, and `noRuntimeAuthority`. |
| Phase 12 does not add default provider registration/order behavior | scan | `rg -n "createRuntimeMemoryContextProvider\(|RUNTIME_MEMORY_CONTEXT_PROVIDER_ID|runtime-memory" openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/runtime-core/index.ts` | no matches | Memory provider is not imported or registered by default in provider registry, TaskLoop, Gateway, Electron, shared, renderer API, or runtime-core barrel. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Planning/spec only | This submission file only | pass | No runtime source edited by this lane. |
| No TaskLoop/Gateway/runtime call-site import | Lane B provider registration scan plus Lane A authority scan | pass | No memory provider default import or adapter call-site import found. |
| No provider registration/order cutover | `provider-registry.ts` lines 375-381; focused tests | pass | Default registry remains legacy, loop, explicit extras. |
| Flag-off parity plan | Future acceptance requirements below | pass | Future registration must prove disabled path has no memory provider output and preserves legacy prompt/message bytes. |
| No SQLite open/read/write when disabled plan | Phase 11 adapter/persistence tests remain prerequisite | pass | Lane B does not wire persistence; future provider hydration must prove provider disabled path does not trigger persistence reads. |
| Adapter isolation from TaskLoop/Gateway/Electron/renderer/shared/default registry | Provider registration scan | pass | No production default registration/import matches. |
| Persistence read boundary | `runtime-memory-runtime-integration.test.ts` explicit hydration test lines 257-336 | pass | Hydration only through explicit extra provider; future default registration needs read/no-read proof. |
| Persistence write boundary | not changed | not-applicable | Lane B does not add write paths. |
| Store owner and schema preserved | not changed | not-applicable | Lane B does not touch persistence schema. |
| Migration and idempotency preserved | not changed | not-applicable | Lane B does not touch persistence migration. |
| Retention and redaction preserved | provider output tests | pass | Provider output excludes raw rows/source bodies; future cutover must rerun raw-retention scans. |
| Raw chat/raw trace rejection | Phase 12 required scans from Lane A | pass | Lane B adds no raw-retention path. |
| No raw retention | `runtime-memory-context-provider.test.ts` source-body non-leak checks; adapter provider hydration test | pass | Provider emits bounded summaries, not raw store rows. |
| No service/exporter/database-service/listener | not changed; Lane A focused scan | pass | Lane B adds no service/exporter/listener work. |
| Provider ordering unchanged | `provider-registry.ts` and tests | pass | Required Lane B evidence. |
| Source episode/evidence refs | `memory-context-provider.ts` summary/context item construction | pass | Provider output includes evidence refs as links only; it is not runtime authority. |
| Durable promotion gate | Runtime Memory source/tests from prior phases | pass | Lane B does not alter durable-fact rules. |
| Current-valid query exclusion | `findRuntimeMemoryFacts` via memory provider tests | pass | Candidates are included only when explicitly requested. |
| Rollback proof plan | Future rollback below | pass | Disable memory flags, omit default registration, omit explicit memory extra provider, preserve rows. |
| Config help/docs sync plan | Phase 12 docs-sync rule | pass | No user-visible behavior changed; future provider default change needs README locale review. |
| Comms replay/compare requirement | Future provider/order change requirements below | pass | Lane B made no transport changes; future Main/Gateway/host-api/api-client/provider transport impact must run comms replay/compare. |

## Provider Registration And Order Risk Map

| Future Change Surface | Risk | Required Proof Before Acceptance |
|---|---|---|
| Add Runtime Memory to `createContextProviderRegistryPilot()` defaults | Prompt/context order could change from legacy/loop to legacy/loop/memory or memory-before-loop, affecting prompt bytes and cache keys. | Prompt byte/order snapshot before and after; provider result order test; prompt-cache deterministic ordering proof; rollback test omitting memory registration. |
| Enable memory provider from `runtime.memory.persist` | Persistence flag could unexpectedly become provider output flag. | Explicit test that `persist:true, provider:false` still returns `flag_disabled`; separate test that only `provider:true` enables output; docs/config wording proof. |
| Move memory before legacy or loop provider | Runtime memory could affect prompt construction before legacy authoritative context. | Provider result order proof; legacy message identity proof; loop prompt text/hash proof; prompt-cache regression proof. |
| Hydrate provider from persisted store automatically | Provider execution could open/read SQLite or expose raw rows when disabled. | No-open/no-read proof when provider or persist flag is false; raw-row non-exposure proof; bounded summary proof; rollback by disabling provider and omitting registration. |
| Use memory context for verifier, security, retry, tool, or completion decisions | Readonly context could become runtime authority. | No-authority metadata assertions; negative tests for completion/verifier/security/retry/tool/runtime authority; durable fact gate proof with source episode refs, evidence refs, accepted status, finite `acceptedAt`, and promotion evidence. |
| Expose provider default through Main/Gateway/host-api/api-client | Transport/user-visible behavior could change and require comms/E2E/docs. | Renderer/Main boundary scan; comms replay/compare; host-api/api-client tests; Electron E2E if user-visible; README translation review. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | Memory provider manifest `enabledByDefault:false`; default registry omits memory provider. |
| No TaskLoop/Gateway/runtime cutover | pass | Production provider registration scan returned no matches outside memory provider source itself. |
| No raw chat-log/raw trace memory | pass | Lane B adds no retention path; provider tests assert source bodies/raw rows do not leak. |
| No unverified durable facts | pass | Provider uses `findRuntimeMemoryFacts`; candidate output requires explicit request. |
| No provider-ordering cutover | pass | Current default order remains legacy, loop, explicit extras. |
| No runtime authority | pass | Provider metadata and context items carry no-authority fields. |
| No service/exporter/database-service/listener | pass | No service/listener/exporter work in this lane. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `Get-Content -Raw openclaw_runtime/src/context-engine/provider-registry.ts` | pass | Provider registry source read | none |
| `Get-Content -Raw openclaw_runtime/src/context-engine/memory-context-provider.ts` | pass | Memory provider source read | none |
| `Get-Content -Raw tests/unit/context-provider-registry.test.ts` | pass | Registry ordering/prompt parity tests read | none |
| `Get-Content -Raw tests/unit/runtime-memory-context-provider.test.ts` | pass | Memory provider default-off/no-authority tests read | none |
| `Get-Content -Raw tests/unit/runtime-memory-runtime-integration.test.ts` and focused `rg` | pass | `persist` does not enable provider output; explicit provider hydration | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-runtime-integration.test.ts` | pass, 3 files / 21 tests | Provider order, memory provider flagging, explicit hydration, persist/provider separation | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md` | pass | Phase 12 spec validity | none |
| Provider/default registration scan over provider registry, TaskLoop, Gateway, Electron, shared, renderer API, runtime-core barrel | pass/no matches | No default memory provider registration or production import | none |
| Provider flag scan over source/tests | pass/reviewed | `runtime.memory.provider` remains explicit and separate from `persist` | Matches are expected source gates/tests. |
| `C:\Program Files\Git\bin\git.exe status -sb -- <provider/memory files and submissions>` | reviewed | Worktree condition | Provider source/tests are pre-existing dirty/untracked files in this workspace; this lane changes only the new submission file. |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| Memory provider has a manifest, but default registry must not include it. | `runtime-memory-context-provider.test.ts` proves default registry omits memory and explicit registry appends it after legacy/loop. | Keep memory provider explicit-only until a later cutover spec accepts default registration. |
| `runtime.memory.persist` can load persisted rows, but provider output must stay behind `runtime.memory.provider`. | Adapter/provider test with `{ persist:true, provider:false }` returns provider `flag_disabled`. | Preserve separate flags; future docs/config must continue warning that persist does not enable provider output. |
| Future provider-order change can perturb prompt cache and prompt bytes even if behavior is shadow-only. | Registry diagnostics currently assert `messageOrderPreserved`, `promptTextUnchanged`, and `packHashUnchanged`. | Future cutover must add prompt byte/order snapshots and prompt-cache deterministic-order proof. |
| Workspace is not clean. | Path-specific git status shows existing modified/untracked provider and memory files from earlier phases. | Do not claim a clean baseline; classify this lane by current source evidence and this lane's single added submission file. |

## Status

```text
Status: accepted
```
