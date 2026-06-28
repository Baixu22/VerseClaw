# Phase 11 Synthesis: Runtime Memory Default-Off Wiring MVP

## Decision

Phase 11 is accepted only as an isolated default-off Runtime Memory wiring MVP.

The accepted scope is the `memory-runtime-integration` adapter, its focused tests, explicit sanitized read/write proof through existing Runtime Memory record shapes and `RuntimeMemoryStore`, explicit extra-provider hydration proof, and config help/type wording cleanup for the Phase 9 standalone persistence foundation.

This synthesis does not accept TaskLoop cutover, Gateway cutover, runtime execution cutover, provider ordering cutover, default provider registration, default-on persistence, provider output from `runtime.memory.persist`, automatic fact extraction or promotion, raw retention, service/exporter/database-service/listener work, or memory-derived runtime authority.

## Inputs Rechecked

| Input | Result | Notes |
|---|---|---|
| `AGENTS.md` | reviewed | Harness routing, renderer/Main boundary, docs sync, and comms checklist reviewed. |
| `C:\Users\27933\.codex\RTK.md` | reviewed | Direct `C:\Users\27933\.cherrystudio\bin\rtk.exe` was used because bare RTK was not on PATH. |
| `openclaw_runtime/AGENTS.md` | reviewed | Runtime subtree rules, SQLite state policy, and no service/listener/exporter constraints reviewed. |
| Phase 11 task spec, README, parallel lanes | reviewed/validated | Phase 11 permits only isolated default-off adapter wiring/readiness and forbids runtime cutover. |
| Phase 11 Lane A-E submissions | reviewed/rechecked | All five submissions exist and each has exactly one valid status line. |
| Phase 10 synthesis | reviewed/validated | Accepted only default-off integration boundary/readiness, not runtime wiring or cutover. |
| Phase 9 synthesis | reviewed/validated | Accepted only default-off local sanitized SQLite persistence foundation. |
| `runtime-research/agent-runtime-index.md` | reviewed | Updated after this accepted synthesis. |
| Focused Runtime Memory source/tests | reviewed/rechecked | Adapter, persistence owner, memory contracts/store/proposal/provider, config schema/help, provider registry, and focused tests were rechecked. |

## Submission Audit

| Lane | Submission | Status-line count | Reclassification |
|---|---|---:|---|
| Lane A | `lane-a-adapter-contract-flag-off-parity.md` | 1 | accepted |
| Lane B | `lane-b-sanitized-write-boundary.md` | 1 | accepted |
| Lane C | `lane-c-read-hydration-provider-boundary.md` | 1 | accepted |
| Lane D | `lane-d-config-docs-rollback-boundary.md` | 1 | accepted |
| Lane E | `lane-e-validation-synthesis-readiness.md` | 1 | accepted |

Recheck command:

```text
C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n "^Status:" runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions
```

Result: exactly one accepted status line in each Lane A-E submission.

## Lane Classification

| Lane | Classification | Rechecked reason |
|---|---|---|
| `lane-a-adapter-contract-flag-off-parity` | accepted | `memory-runtime-integration.ts` checks `runtime.memory.persist` before every public method delegates; the disabled test injects a throwing opener and proves zero SQLite opens. Import scans found the adapter imported only by tests. |
| `lane-b-sanitized-write-boundary` | accepted | Adapter write APIs accept only Runtime Memory episode/fact/candidate/invalidation shapes. Enabled writes delegate to the Phase 9 persistence owner, which re-runs Runtime Memory sanitizers and recursive raw-input rejection before write transactions. |
| `lane-c-read-hydration-provider-boundary` | accepted | Adapter reads return a `RuntimeMemoryStore` snapshot only. Provider hydration is explicit extra-provider injection, default provider ordering remains legacy provider then loop provider then extras, and `runtime.memory.persist` does not enable provider output. |
| `lane-d-config-docs-rollback-boundary` | accepted | Config help/types now acknowledge the Phase 9 standalone local sanitized persistence foundation while preserving default-off/no-cutover/no-provider-output/no-runtime-authority boundaries. Schema shape remains optional/default-off. |
| `lane-e-validation-synthesis-readiness` | accepted | Fresh Phase 11/10/9 harness validates, focused tests, node typecheck, renderer/import/raw/service/persistence scans, docs sync scan, and comms replay/compare all passed or were reviewed as expected negative-fixture matches. |

## Boundary Evidence

| Surface | Evidence | Result |
|---|---|---|
| Phase 10 prerequisite | Phase 10 synthesis accepts only default-off boundary/readiness and rejects TaskLoop/Gateway/provider-ordering/default-on/runtime-authority cutover. | pass |
| Phase 9 prerequisite | Phase 9 synthesis accepts only standalone default-off local sanitized persistence foundation. | pass |
| Runtime memory flags default false | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` keeps `shadow`, `provider`, `proposeFacts`, and `persist` false in `memory-context.ts:129`. | pass |
| Adapter disabled no-open/no-read/no-write | `memory-runtime-integration.ts` returns skipped results before delegation; `runtime-memory-runtime-integration.test.ts:38` injects a throwing opener and asserts zero opens after migrate/write/load calls. | pass |
| Persistence owner remains flag-gated | `memory-persistence.ts:342`, `:358`, `:375`, `:392`, and `:409` check `persist` before DB transaction/open paths; focused persistence tests passed. | pass |
| Sanitized write boundary | `memory-persistence.ts:813` through `:889` revalidates episode/fact/invalidation shapes and recursively rejects raw memory markers before persistence. | pass |
| Read hydration boundary | `memory-runtime-integration.ts:89` returns an empty `RuntimeMemoryStore` when disabled or delegates to persistence `loadStore`; persistence replays parsed rows into a fresh store and does not expose raw rows to provider code. | pass |
| Durable fact gate | `isRuntimeMemoryTemporalFact()` requires accepted verification status, finite `acceptedAt`, and promotion evidence; adapter/persistence tests prove verified-looking candidates persist as candidates with null promotion fields. | pass |
| Current-valid query behavior | `isRuntimeMemoryFactValidAt()` and store query filters exclude invalidated, expired, rejected, candidate, and unpromoted facts by default; focused store/context tests passed. | pass |
| Provider ordering | `createContextProviderRegistryPilot()` still constructs legacy provider, loop provider, then explicit extras only; memory is absent from the default registry. | pass |
| Provider authority | `memory-context-provider.ts` keeps `enabledByDefault:false`, `shadowOnly:true`, readonly/budgeted summaries, and no completion/verifier/security/retry/tool/runtime authority metadata. | pass |
| Config/docs wording | `runtime.memory.persist` help says default false and does not enable TaskLoop/Gateway cutover, provider output, default-on memory, extraction/promotion, user-facing persistence, or runtime authority. | pass |

## Validation

| Command / Scan | Result |
|---|---|
| `rtk.exe node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md` | pass |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md` | pass |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass |
| `rtk.exe node.exe node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts` | pass, 8 files / 47 tests |
| `rtk.exe node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| Renderer boundary scan over `src/pages src/components` | pass/no matches |
| Runtime authority import scan over TaskLoop/Gateway/Electron/shared/renderer API/default registry paths | pass/no matches |
| Adapter import scan | pass/reviewed; only runtime integration test import and test evidence refs matched |
| Production raw-retention scan over adapter/persistence/provider source | pass/no matches |
| Focused test raw-retention scan | pass/reviewed; matches are negative fixtures, rejection assertions, or leak-absence assertions |
| Service/exporter/database-service/listener scan over Phase 11 memory source/tests | pass/no matches |
| Broader config service/exporter scan | pass/reviewed; matches are pre-existing unrelated gateway/OTLP/mcporter help text, not Phase 11 memory additions |
| Persistence scan | pass/reviewed; matches are intended Phase 9 SQLite owner, Phase 11 adapter, and tests inspecting rows for non-promotion/non-leak proof |
| README docs sync scan for Runtime Memory text | pass/no matches |
| `rtk.exe node.exe scripts/comms/replay.mjs` | pass |
| `rtk.exe node.exe scripts/comms/compare.mjs` | pass |

Comms replay/compare were run because the current worktree has unrelated dirty Main/Gateway/host-api/shared/provider-adjacent paths, even though the accepted Phase 11 memory slice does not itself cut over those paths.

## Rejected Claims

| Claim | Decision |
|---|---|
| Default-on persistence or default-on memory behavior | rejected |
| TaskLoop, Gateway, provider, or runtime execution cutover | rejected |
| Provider ordering cutover or default memory provider registration | rejected |
| `runtime.memory.persist` enabling provider output | rejected |
| Raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool/env/secret retention | rejected |
| LLM/candidate facts becoming durable without verifier, human, or deterministic-rule promotion evidence | rejected |
| Service, exporter, database-service, listener, daemon, second Gateway, or second runtime work | rejected |
| Memory-derived completion, verifier, security, retry, tool, or runtime authority | rejected |
| Treating Phase 9 or Phase 10 as permission for runtime cutover | rejected |

## Rollback

Rollback remains disabling `runtime.memory.persist` and related experimental memory flags, omitting the isolated adapter from runtime call sites, and omitting optional memory provider extra-provider injection. Existing Phase 9 persisted rows are preserved unless a later explicit migration or doctor policy accepts deletion.

## Next Decision

Any TaskLoop/Gateway/runtime call-site import of the adapter, provider-ordering change, default provider registration, operator-facing persistence flow, default-on behavior, automatic extraction/promotion, raw retention, or memory-derived authority requires a fresh cutover spec and synthesis acceptance.

Status: accepted
