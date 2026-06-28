# Lane B: Sanitized Write Boundary

## Scope Confirmation

- Lane: `lane-b-sanitized-write-boundary`
- Output file: `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/submissions/lane-b-sanitized-write-boundary.md`
- Files reviewed: `AGENTS.md`; `C:\Users\27933\.codex\RTK.md`; `openclaw_runtime/AGENTS.md`; Phase 11 spec/README/parallel-lanes/submission-template; Phase 11 Lane A submission; Phase 10 spec and synthesis; Phase 9 spec and synthesis; `runtime-research/agent-runtime-index.md`; harness context scenario/rules/layer files; `openclaw_runtime/src/runtime-core/memory-context.ts`; `openclaw_runtime/src/runtime-core/memory-store.ts`; `openclaw_runtime/src/runtime-core/memory-persistence.ts`; `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`; `openclaw_runtime/src/context-engine/memory-context-provider.ts`; focused Runtime Memory tests.
- Files changed: `tests/unit/runtime-memory-runtime-integration.test.ts`; this submission.
- Runtime behavior changed: no
- TaskLoop/Gateway/provider ordering changed: no
- Main/Gateway/host-api/api-client paths changed: no

## Executive Summary

Lane B is accepted. No production runtime authority, extraction path, promotion path, TaskLoop/Gateway cutover, or provider ordering change was added. The Phase 11 adapter write methods remain typed to Runtime Memory episode/fact/candidate/invalidation record shapes, stay flag-gated, and delegate enabled writes to the Phase 9 persistence owner, which re-runs existing Runtime Memory sanitizers and recursive raw-retention rejection before opening a write transaction.

This lane adds adapter-level tests proving raw transcript/tool-args/prompt/trace-baggage markers are rejected and not persisted, while verified-looking candidates remain persisted as candidates with null `promotion_json`, null `accepted_at`, no `acceptedAt`, and no `promotion`.

## Phase 10 Entry Confirmation

| Required Entry Fact | Evidence | Result |
|---|---|---|
| Phase 10 synthesis accepted | `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md` decision accepts boundary/readiness only and ends accepted. | pass |
| Phase 10 accepted only default-off boundary/readiness | Phase 10 synthesis says accepted scope is flag-off no-open/no-read/no-write evidence, sanitized read/write handoff plans, optional provider hydration boundaries, rollback/docs/scans, and synthesis readiness. | pass |
| Runtime cutover/default-on/provider ordering/raw retention/runtime authority remained rejected | Phase 10 synthesis rejected TaskLoop/Gateway cutover, provider ordering cutover, default-on persistence, default provider registration, raw retention, unverified durable facts, services/exporters/listeners, and memory-derived runtime authority. | pass |
| Phase 9 accepted only default-off local sanitized persistence foundation | `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md` accepts only standalone default-off local sanitized SQLite persistence foundation. | pass |

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Adapter write surface accepts only Runtime Memory record shapes | file | `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts` | `RuntimeMemoryRuntimeIntegrationPort` lines 18-29; `appendEpisode`/`appendFact`/`invalidateFact` lines 62-87 | No raw transcript/chat/prompt/tool/checkpoint payload API was added. |
| Flag-off no-write parity remains true | file/test | `memory-runtime-integration.ts`; `tests/unit/runtime-memory-runtime-integration.test.ts` | flag checks lines 55-97 and disabled write result lines 150-156; test lines 38-72 | Disabled adapter returns skipped writes/empty store and injected SQLite opener is not called. |
| Enabled writes are re-sanitized before persistence | file | `openclaw_runtime/src/runtime-core/memory-persistence.ts` | write methods lines 358-407; sanitizers lines 813-861 | Existing Runtime Memory sanitizers and raw rejection run before write transaction. |
| Raw adapter writes are rejected and not persisted | test | `tests/unit/runtime-memory-runtime-integration.test.ts` | lines 126-195 | Transcript, full tool args, prompt, and trace baggage markers return rejected write results; loaded store remains empty. |
| Candidates remain candidates and do not become durable facts | file/test | `memory-persistence.ts`; `runtime-memory-runtime-integration.test.ts` | `factToRow` lines 758-784; test lines 197-255 | Candidate row has `record_kind = candidate`, null `accepted_at`, null `promotion_json`, no `acceptedAt`, and no `promotion`. |
| Durable fact gate requires accepted status, acceptedAt, source episode refs, evidence refs, and promotion evidence | file | `openclaw_runtime/src/runtime-core/memory-context.ts` | fact type lines 201-208; promotion evidence lines 178-183; guards lines 544-584 | Durable facts require accepted verification status and promotion evidence from verifier/human/deterministic-rule. |
| Current-valid query behavior remains unchanged | file/test | `memory-context.ts`; `memory-store.ts`; focused tests | `isRuntimeMemoryFactValidAt` lines 900-926; verification matching lines 1176-1195; store invalidations lines 306-327 | Focused tests passed; default queries still exclude invalidated, expired, rejected, candidate, and unpromoted candidate facts. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | `tests/unit/runtime-memory-runtime-integration.test.ts` lines 38-72; focused tests | pass | none |
| No SQLite open/read/write when disabled | Adapter test injects throwing opener and asserts `openCalls` is `0`; persistence no-open test remains covered by focused suite. | pass | none |
| Adapter isolation from TaskLoop/Gateway/Electron/renderer/shared/default registry | Runtime authority import scan over `openclaw_runtime/src/agents`, `openclaw_runtime/src/gateway`, `electron`, `shared`, `src/lib`, and provider registry. | pass | `NO_MATCHES` |
| Persistence read boundary | `memory-runtime-integration.ts` lines 89-97 delegates only to persistence `loadStore`; disabled path returns empty `RuntimeMemoryStore`. | pass | Lane B did not change read hydration. |
| Persistence write boundary | `memory-runtime-integration.ts` lines 62-87; `memory-persistence.ts` lines 358-407 and 813-861. | pass | none |
| Store owner and schema preserved | No production code changed; focused persistence tests passed. | pass | none |
| Migration and idempotency preserved | No production code changed; focused persistence tests passed. | pass | none |
| Retention and redaction preserved | Existing persistence test and store/context tests passed; production raw scan had no matches. | pass | none |
| Raw chat/raw trace rejection | Adapter raw write test lines 126-195; existing context raw rejection tests passed. | pass | Test fixtures intentionally contain raw markers. |
| No raw retention | Production scan over `memory-runtime-integration.ts` and `memory-persistence.ts` returned no matches; adapter test raw matches are negative fixtures only. | pass | none |
| No service/exporter/database-service/listener | Service/exporter/listener scan over production adapter/persistence and touched adapter test returned no matches. | pass | none |
| Provider ordering unchanged | No provider registry production change; focused `context-provider-registry` tests passed. | pass | none |
| Source episode/evidence refs | `isRuntimeMemoryTemporalFactCandidate` requires non-empty `sourceEpisodeRefs` and `evidenceRefs`; focused tests passed. | pass | none |
| Durable promotion gate | `isRuntimeMemoryTemporalFact` requires accepted status, `acceptedAt`, and promotion evidence; adapter candidate test proves candidates do not gain promotion fields. | pass | none |
| Current-valid query exclusion | Focused context/store/integration tests passed. | pass | none |
| Rollback proof | Disable `runtime.memory.persist` or omit the isolated adapter; no runtime call site imports the adapter. | pass | none |
| Config help/docs sync | Not applicable. | not-applicable | Lane B has no operator-visible config/help/UI behavior change. |
| Comms replay/compare if required | Not applicable. | not-applicable | Lane B changed no Main/Gateway/host-api/api-client/provider transport path. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | Defaults remain false in `memory-context.ts` lines 129-134; focused tests passed. |
| No TaskLoop/Gateway/provider cutover | pass | Runtime authority import scan returned no matches; no production call site changed. |
| No raw chat-log/raw trace memory | pass | Production raw-retention scan returned no matches; adapter negative fixtures are rejected and not persisted. |
| No unverified durable facts | pass | Candidate test proves verified-looking candidates stay non-durable; durable guard remains accepted-status plus promotion evidence only. |
| No provider-ordering cutover | pass | Provider registry production code was not touched; focused registry/provider tests passed. |
| No runtime authority | pass | Adapter is isolated and imported by tests only; provider metadata remains no-authority. |
| No service/exporter/database-service/listener | pass | Service/exporter/listener scan returned no matches. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md` | pass | Phase 11 reading list | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md` | pass | Phase 11 spec validity | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 prerequisite | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 prerequisite | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-runtime-integration.test.ts` | pass, 1 file / 6 tests | Adapter boundary | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts` | pass, 4 files / 24 tests | Lane B focused context/store/persistence/integration proof | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts` | pass, 8 files / 47 tests | Required focused runtime-memory suite | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node typecheck | none |
| Production raw-retention scan over `memory-runtime-integration.ts` and `memory-persistence.ts` | pass | No production raw marker literals in adapter/persistence | `NO_MATCHES` |
| Touched adapter test raw-retention scan | pass/reviewed | Negative raw fixtures only | Matches are expected assertions at lines 136, 154, 166, 169, and 184. |
| Service/exporter/listener scan over production adapter/persistence and touched test | pass | No service/exporter/listener additions | `NO_MATCHES` |
| Runtime authority import scan | pass | No adapter/persistence import in TaskLoop/Gateway/Electron/shared/renderer/default registry paths | `NO_MATCHES` |
| Renderer bypass scan over `src/pages src/components` | pass | No direct IPC/Gateway HTTP/WebSocket bypass introduced | `NO_MATCHES` |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| `rtk` was not on PATH in this shell. | Bare `rtk` failed; Phase 9/10/11 docs use `C:\Users\27933\.cherrystudio\bin\rtk.exe`, which worked. | Continue using the direct `rtk.exe` path in this workspace. |
| Worktree has many unrelated dirty and untracked files. | `git status -sb` shows broad pre-existing changes across Main/Gateway/UI/config/runtime research. | This lane changed only the adapter test file and this submission; unrelated changes were not reverted. |
| Raw-retention scan over the touched adapter test file finds raw strings. | Matches are negative fixtures/asserted rejection reasons in `tests/unit/runtime-memory-runtime-integration.test.ts` lines 136, 154, 166, 169, and 184. | Keep as tests; production adapter/persistence raw scan returned no matches. |

Status: accepted
