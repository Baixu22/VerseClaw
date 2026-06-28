# Phase 10 Synthesis: Runtime Memory Persistence Integration Boundary

## Decision

Phase 10 is accepted only as default-off runtime memory persistence integration boundary/readiness evidence.

The accepted scope is the Lane A-D planning and validation evidence for future integration boundaries: flag-off no-open/no-read/no-write parity, sanitized read/write handoff to the Phase 9 persistence owner, optional readonly provider hydration without provider-ordering cutover, rollback/docs/scans, and synthesis readiness.

This synthesis does not accept TaskLoop cutover, Gateway cutover, provider ordering cutover, default-on persistence, default provider registration, raw retention, unverified durable facts, service/exporter/database-service/listener work, memory-derived runtime authority, or implemented runtime read/write wiring.

## Inputs Rechecked

| Input | Result | Notes |
|---|---|---|
| `AGENTS.md` | reviewed | Harness routing, renderer/Main boundary, docs sync, comms checklist, and pnpm caveats reviewed. |
| `C:\Users\27933\.codex\RTK.md` | reviewed | Bare `rtk` was not on PATH in this shell; direct `C:\Users\27933\.cherrystudio\bin\rtk.exe` was used for validation. |
| `openclaw_runtime/AGENTS.md` | reviewed | Runtime subtree rules, SQLite state-storage policy, and no service/listener/exporter constraints reviewed. |
| Phase 10 task spec, README, parallel lanes | reviewed/validated | Phase 10 is an entry/readiness scaffold and forbids runtime cutover/default-on/provider-ordering changes. |
| Phase 10 Lane A-D submissions | reviewed/rechecked | All four submissions exist and each has exactly one submission status line. |
| Phase 9 task spec and synthesis | reviewed/validated | Phase 9 accepted only default-off local sanitized SQLite persistence foundation. |
| `runtime-research/agent-runtime-index.md` | reviewed | Index updated after this accepted synthesis. |
| Focused Runtime Memory source/tests | reviewed/rechecked | `memory-context.ts`, `memory-store.ts`, `memory-proposal-shadow.ts`, `memory-persistence.ts`, `memory-context-provider.ts`, provider registry, config help, and focused tests were rechecked. |

## Lane Classification

| Lane | Classification | Rechecked reason |
|---|---|---|
| `lane-a-flag-off-runtime-wiring-parity` | accepted | Evidence proves `runtime.memory.persist=false` opens/reads/writes no SQLite and does not register memory provider or alter TaskLoop parity. No production runtime wiring was added. |
| `lane-b-persistence-read-write-integration-boundary` | accepted | Defines future read/write boundaries through the Phase 9 persistence owner only. Current code accepts sanitized episode/fact/invalidation records and hydrates via `RuntimeMemoryStore`; no runtime call site is wired. |
| `lane-c-provider-context-hydration-boundary` | accepted | Defines explicit extra-provider hydration only. Default registry remains legacy context engine, loop context pack, then explicit extras; memory provider remains default-off, readonly, budgeted, and non-authoritative. |
| `lane-d-rollback-docs-validation-synthesis-readiness` | accepted | Rechecked A-C marker counts, validation commands, scans, stale config-help note, and comms replay/compare. Acceptance remains boundary/readiness only. |

## Submission Status Line Audit

| Submission | Count | Value |
|---|---:|---|
| `lane-a-flag-off-runtime-wiring-parity.md` | 1 | accepted |
| `lane-b-persistence-read-write-integration-boundary.md` | 1 | accepted |
| `lane-c-provider-context-hydration-boundary.md` | 1 | accepted |
| `lane-d-rollback-docs-validation-synthesis-readiness.md` | 1 | accepted |

The audit used `Select-String -Pattern '^Status:'` over the Phase 10 submissions directory and found exactly one matching line in each A-D submission.

## Boundary Evidence

| Surface | Evidence | Result |
|---|---|---|
| Phase 9 prerequisite | Phase 9 synthesis decision accepts only standalone default-off local sanitized SQLite persistence and ends accepted. | pass |
| Default-off flags | `openclaw_runtime/src/runtime-core/memory-context.ts:129` keeps `shadow`, `provider`, `proposeFacts`, and `persist` false. | pass |
| Disabled persistence no-open/no-read/no-write | `openclaw_runtime/src/runtime-core/memory-persistence.ts:342`, `:358`, `:375`, `:392`, and `:409` check the flag before DB transaction/open paths; `tests/unit/runtime-memory-persistence.test.ts:31` injects a throwing opener and proves zero opens. | pass |
| Sanitized write boundary | `appendEpisode`, `appendFact`, and `invalidateFact` sanitize accepted Runtime Memory record shapes before write; persistence-level recursive raw rejection remains in `memory-persistence.ts:860`. | pass as boundary only |
| Sanitized read boundary | `loadStore()` replays parsed rows into a fresh `RuntimeMemoryStore` via `appendEpisode`, `appendFact`, and `invalidateFact`; raw rows are not exposed as provider context. | pass as boundary only |
| Durable fact gate | `isRuntimeMemoryTemporalFact()` requires accepted verification status, finite `acceptedAt`, and promotion evidence at `memory-context.ts:570`; candidates persist as non-durable candidate rows with null promotion. | pass |
| Current-valid exclusions | Memory query logic excludes invalidated, expired, rejected, candidate, and unpromoted facts unless explicit include/status options are used. Focused tests passed. | pass |
| Provider ordering | `openclaw_runtime/src/context-engine/provider-registry.ts:252` still returns legacy provider, loop context pack, then explicit extras. | pass |
| Provider authority | `memory-context-provider.ts` keeps `enabledByDefault:false`, `shadowOnly:true`, readonly summaries, and metadata for no completion/verifier/security/retry/tool/runtime authority. | pass |
| Raw retention | Production `memory-persistence.ts` raw-retention scan returned no matches; broader focused matches were sanitizer denylist/redaction logic or negative test fixtures/assertions. | pass |
| Service/exporter/database-service/listener | Focused source/test scan for server/listener/exporter/OTLP/Temporal/Express patterns returned no matches. | pass |
| Renderer boundary | Scan over `src/pages` and `src/components` found no direct IPC, localhost Gateway HTTP/WebSocket, or `new WebSocket` bypasses. | pass |
| Runtime authority wiring | Import/use scan over TaskLoop/Gateway/Electron/shared/renderer/default registry found no Phase 9 persistence owner wiring. | pass |

## Validation

| Command | Result |
|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/context-provider-registry.test.ts tests/unit/task-loop-controller.test.ts` | pass, 7 files / 86 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| Renderer boundary scan over `src/pages src/components` | pass/no matches |
| Production persistence raw-retention scan | pass/no matches |
| Focused broader raw-retention scan | pass/reviewed sanitizer and negative-test matches only |
| Service/exporter/database-service/listener scan | pass/no matches |
| Persistence surface scan | pass/reviewed intended Phase 9 owner/config/tests only |
| Runtime authority import scan | pass/no matches |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe scripts/comms/replay.mjs` | pass |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe scripts/comms/compare.mjs` | pass |

Comms replay/compare were required because the current dirty worktree includes Main/Gateway/host-api/shared/provider-adjacent paths, even though this synthesis only adds research/index updates.

## Rejected Claims

| Claim | Decision |
|---|---|
| Default-on persistence or memory behavior | rejected |
| TaskLoop/Gateway/runtime cutover | rejected |
| Provider ordering cutover/default memory registration | rejected |
| Raw chat/transcript/trace/prompt/payload/checkpoint/tool/env/secret retention | rejected |
| LLM/candidate facts becoming durable without verifier, human, or deterministic-rule promotion evidence | rejected |
| Service, exporter, database-service, listener, daemon, second Gateway, or second runtime | rejected |
| Memory-derived completion, verifier, security, retry, tool, or runtime authority | rejected |
| Treating Phase 9 foundation as runtime integration permission | rejected |

## Required Follow-Ups

1. Before any operator-facing persistence flow or runtime wiring, update config help/docs. `openclaw_runtime/src/config/types.openclaw.ts` and `openclaw_runtime/src/config/schema.help.ts` still describe `runtime.memory.persist` as reserved/future Phase 9 validation.
2. Any implementation that wires persistence into TaskLoop, Gateway, provider ordering, runtime execution, verifier, tool policy, security, retry, or user-visible behavior needs a fresh cutover spec and synthesis acceptance.
3. Keep `runtime.memory.persist`, `runtime.memory.provider`, `runtime.memory.shadow`, and `runtime.memory.proposeFacts` default false.
4. Continue requiring no-open/no-read/no-write proof when disabled, sanitized-only record proof when enabled, and comms replay/compare for Main/Gateway/host-api/api-client/provider transport changes.

## agent-runtime-index.md Update Applied

The Runtime Memory Provider index now records Phase 10 as accepted boundary/readiness only and keeps runtime cutover/default-on/provider-ordering/raw-retention/service/runtime-authority claims blocked.

Status: accepted
