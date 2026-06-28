# Phase 10 Lane B: Persistence Read/Write Integration Boundary

## Scope Confirmation

- Lane: `lane-b-persistence-read-write-integration-boundary`
- Output file: `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/submissions/lane-b-persistence-read-write-integration-boundary.md`
- Files reviewed: `AGENTS.md`; `C:\Users\27933\.codex\RTK.md`; `openclaw_runtime/AGENTS.md`; Phase 10 spec, README, parallel lanes, and submission template; Phase 9 spec and accepted synthesis; Lane A accepted submission; `runtime-research/agent-runtime-index.md`; harness context scenario/rules/layers; `memory-persistence.ts`; `memory-store.ts`; `memory-context.ts`; focused runtime memory tests.
- Files changed: this submission only.
- Runtime behavior changed: no
- TaskLoop/Gateway/provider ordering changed: no
- Main/Gateway/host-api/api-client paths changed: no

## Executive Summary

Lane B is accepted as a read/write boundary definition and evidence pass. No production runtime wiring was added. Future runtime writes may call only the Phase 9 persistence owner methods after a later synthesis accepts a default-off runtime integration adapter that has already built sanitized `RuntimeMemoryEpisodeRecord`, `RuntimeMemoryTemporalFact`, `RuntimeMemoryTemporalFactCandidate`, or `RuntimeMemoryInvalidationProposal` values. Future runtime reads may hydrate a fresh `RuntimeMemoryStore` only through `RuntimeMemoryPersistenceStore.loadStore()`, which replays persisted episode, fact, and invalidation records through the same in-memory store append APIs.

The boundary remains default-off. `runtime.memory.persist=false` returns skipped results before SQLite open/migrate/read/write. The current owner rejects raw chat, transcript, trace, prompt, payload, checkpoint-like payloads, tool IO, env, secrets, and raw trace context values through the Runtime Memory sanitizers and the persistence-level deep raw-output rejection. Candidates and LLM-like proposals remain candidate records unless they carry the durable `RuntimeMemoryTemporalFact` shape with accepted verifier, human, or deterministic-rule promotion evidence.

## Phase 9 Entry Confirmation

| Required Entry Fact | Evidence | Result |
|---|---|---|
| Phase 9 synthesis accepted | `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md` ends with `Status: accepted`. | pass |
| Phase 9 accepted only default-off local sanitized persistence foundation | Phase 9 synthesis accepts only standalone local SQLite sanitized episode/fact/invalidation persistence and rejects runtime cutover. | pass |
| Runtime cutover/default-on/provider ordering/raw retention/runtime authority remained rejected | Phase 9 synthesis explicitly rejects runtime cutover, default-on behavior, provider ordering cutover, raw retention, unverified durable facts, services/exporters/listeners, and runtime authority. | pass |
| Lane A accepted before Lane B | `submissions/lane-a-flag-off-runtime-wiring-parity.md` ends with `Status: accepted`. | pass |

## Read/Write Boundary Definition

| Boundary | Accepted Future Shape | Rejected Shape |
|---|---|---|
| Write call site | A later default-off runtime-memory integration adapter may call `createRuntimeMemoryPersistenceStore(...).appendEpisode`, `appendFact`, or `invalidateFact` only after the legacy runtime result remains authoritative and an explicit sanitized memory record has already been constructed. | No TaskLoop/Gateway cutover in Phase 10; no renderer/Main direct write; no raw transcript import; no automatic extraction/promotion from candidates or LLM proposals. |
| Write input contract | Only `RuntimeMemoryEpisodeRecord`, `RuntimeMemoryTemporalFact`, `RuntimeMemoryTemporalFactCandidate`, and `RuntimeMemoryInvalidationProposal` are accepted by the owner. | No raw chat, transcript, trace dump, prompt dump, full payload, checkpoint dump, tool args/output, env, secret, raw trace baggage/tracestate, or broad arbitrary JSON payload. |
| Read call site | A later default-off runtime-memory integration adapter may call `loadStore()` during explicit memory hydration, then pass only the returned `RuntimeMemoryStore` into future readonly provider/context hydration after separate synthesis acceptance. | No default runtime path hydration in Phase 10; no provider ordering change; no memory-derived runtime authority. |
| Read output contract | `loadStore()` creates a fresh `RuntimeMemoryStore` and replays persisted episodes, facts, and invalidations through `store.appendEpisode`, `store.appendFact`, and `store.invalidateFact`. | No raw row exposure to provider/context code; no raw record JSON as prompt/context; no bypass around store sanitization, query filters, retention, or invalidation handling. |

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Persistence owner and schema remain named and local | file | `openclaw_runtime/src/runtime-core/memory-persistence.ts` | `RUNTIME_MEMORY_PERSISTENCE_OWNER` at 42; schema version at 44; tables at 209, 217, 234, 247, 283 | Owner is the Phase 9 local SQLite proof, not a service. |
| Disabled persistence has no SQLite open/read/write | file/test | `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | flag checks at 342-445; no-open test at 31-64 | All public persistence methods skip before `withWriteTransaction()`. |
| Future write boundary only reaches sanitized records | file | `memory-persistence.ts`; `memory-context.ts` | append methods at 358-407; sanitizers at 813-859; record guards at `memory-context.ts` 493-607 | Invalid shape returns rejected before DB write. |
| Future read boundary hydrates through `RuntimeMemoryStore` | file/test | `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | `loadStore()` at 409-438; read helpers at 691-733; hydration assertions at 185-207 | Rows are parsed as memory record shapes and replayed through store methods. |
| Candidates do not become durable facts automatically | file/test | `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts`; `tests/unit/runtime-memory-store.test.ts` | `factToRow()` at 758-783; persistence test at 136-155 and 220-246; store test at 349-440 | Candidate rows keep `record_kind="candidate"`, `promotion_json=null`, and no `acceptedAt`. |
| Current-valid query excludes invalidated/expired/rejected/candidate/unpromoted by default | file/test | `memory-context.ts`; `memory-store.ts`; focused tests | validity at 900-926; verification filter at 1176-1196; store invalidations at 306-324; tests at `runtime-memory-store.test.ts` 294-440 | Explicit include/status options are required to see excluded records. |
| Migration, idempotency, retention, redaction, invalidation, rollback remain covered | file/test | `memory-persistence.ts`; `memory-store.ts`; focused tests | migration upsert at 456-477; episode dedupe at 480-500 and 672-688; trim at 500, 529, 558-563; raw rejection at 859-889; tests at 67-311 | Same Phase 9 owner and focused tests passed. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | `tests/unit/runtime-memory-persistence.test.ts` 31-64; Lane A submission accepted flag-off TaskLoop/provider parity. | pass | Lane B changed no production runtime code. |
| No SQLite open/read/write when disabled | `memory-persistence.ts` 342-445; focused persistence test 31-64. | pass | `loadStore()` creates only an empty in-memory store before returning skipped. |
| Persistence read boundary | `loadStore()` at `memory-persistence.ts` 409-438; read helpers 691-733. | pass | Not connected to default runtime path. |
| Persistence write boundary | `appendEpisode`, `appendFact`, `invalidateFact` at `memory-persistence.ts` 358-407. | pass | Not connected to TaskLoop/Gateway in this lane. |
| Store owner and schema preserved | `RUNTIME_MEMORY_PERSISTENCE_OWNER`; schema DDL in `memory-persistence.ts` 209-305. | pass | none |
| Migration and idempotency preserved | `ensureRuntimeMemoryPersistenceSchema()` 456-477; idempotency/dedupe 480-500 and 672-688; tests 67-107 and 211-214. | pass | none |
| Retention and redaction preserved | Store defaults in `memory-store.ts` 26-28; persistence trims at 500, 529, 558-563; tests 227-245 and 252-311. | pass | none |
| Raw chat/raw trace rejection | Raw rejection reasons and patterns in `memory-context.ts` 97-109 and 336-391; tests 239-307. | pass | Production `memory-persistence.ts` raw scan had no matches. |
| No raw retention | Persistence-level deep raw rejection in `memory-persistence.ts` 859-889; persistence test asserts raw strings absent at 227-245. | pass | Focused raw scan matches are denylist rules or negative fixtures. |
| No service/exporter/database-service/listener | Service/exporter scan over focused memory source/tests. | pass | `NO_MATCHES`; exit 1 from `rg` means no matches. |
| Provider ordering unchanged | Lane B changed no provider registry or provider code; Lane A accepted explicit provider ordering parity. | pass | Not a Lane B implementation surface. |
| Source episode/evidence refs | Record types require non-empty refs at `memory-context.ts` 157-220 and guards at 493-607; tests 154-237. | pass | none |
| Durable promotion gate | Durable fact guard requires accepted status, `acceptedAt`, and promotion evidence at `memory-context.ts` 570-584. | pass | Candidate persistence is allowed only as non-durable proposal. |
| Current-valid query exclusion | `memory-context.ts` 900-926 and 1176-1196; store tests 294-440. | pass | none |
| Rollback proof | Disable `runtime.memory.persist`; `persistEnabled()` at 441-442 returns strict flag resolution and all methods skip before DB open. | pass | Existing rows are preserved because rollback does not delete data. |
| Comms replay/compare if required | `rtk.exe node scripts/comms/replay.mjs`; `rtk.exe node scripts/comms/compare.mjs`. | pass | Not required by this lane's changed files, but run conservatively because the worktree has unrelated dirty communication paths. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` keeps `persist`, `provider`, `shadow`, and `proposeFacts` false at `memory-context.ts` 129-134. |
| No TaskLoop/Gateway/provider cutover | pass | This lane changed only this submission; owner import scan over TaskLoop/Gateway/Electron/renderer/shared/context registry returned `NO_MATCHES`. |
| No raw chat-log/raw trace memory | pass | Production `memory-persistence.ts` raw-retention scan returned `NO_MATCHES`; raw terms in `memory-context.ts` are rejection rules. |
| No unverified durable facts | pass | Candidate and fact shapes remain separate; `factToRow()` stores candidates without promotion at 758-783. |
| No provider-ordering cutover | pass | No provider code changed. |
| No runtime authority | pass | Persistence owner is not imported by runtime authority paths and can only return skipped/rejected/persisted/load results. |
| No service/exporter/database-service/listener | pass | Focused service/exporter scan returned `NO_MATCHES`. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `rtk node ...` from non-login PowerShell | fail | Bare RTK path check | `rtk` was not on PATH; used `C:\Users\27933\.cherrystudio\bin\rtk.exe` for all validation. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 read order | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 spec validity | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 prerequisite validity | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/context-provider-registry.test.ts` | pass, 6 files / 37 tests | Focused runtime memory contracts, store, proposal shadow, provider, persistence, and registry | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node typecheck | none |
| Renderer boundary scan over `src/pages src/components` | pass | No direct renderer IPC/Gateway HTTP/WebSocket bypass | `NO_MATCHES`; `rg` exit 1. |
| Service/exporter/database-service/listener scan over focused memory source/tests | pass | No service, exporter, database-service, listener, HTTP, WebSocket, OTLP, Temporal, or Express surface | `NO_MATCHES`; `rg` exit 1. |
| Raw-retention scan over `openclaw_runtime/src/runtime-core/memory-persistence.ts` | pass | Production persistence owner has no raw-retention marker literals | `NO_MATCHES`; `rg` exit 1. |
| Raw-retention scan over focused memory source/tests | pass/reviewed | Raw terms are rejection classifiers, redaction rules, or negative fixtures/assertions | No unreviewed retention path. |
| Runtime authority persistence import scan | pass | No Phase 9 persistence owner import/use in TaskLoop/Gateway/Electron/renderer/shared/context registry | `NO_MATCHES`; `rg` exit 1. |
| Persistence surface scan over `memory-persistence.ts` and focused persistence test | pass/reviewed | Intended owner, tables, methods, and tests only | No default runtime path found. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/replay.mjs` | pass | Conservative comms replay | Not required by Lane B changed files. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/compare.mjs` | pass | Conservative comms compare | Not required by Lane B changed files. |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| Phase 10 asks for future read/write integration boundaries but rejects runtime cutover. | Phase 10 spec forbids TaskLoop/Gateway/provider/default-on cutover in this phase. | Keep this lane as boundary evidence only. A later synthesis must accept any runtime adapter before calling `append*()` or `loadStore()` from runtime paths. |
| `rtk` is not on PATH in the current non-login shell. | Initial bare `rtk` command failed; direct `C:\Users\27933\.cherrystudio\bin\rtk.exe` worked. | Continue using the direct RTK binary in this workspace unless PATH is repaired. |
| Current worktree has unrelated dirty Main/Gateway/host-api/provider files. | `git status -sb` shows many modified/untracked files outside Lane B. | Lane B changed only this submission. Comms replay/compare were run conservatively. |
| Raw-retention scans necessarily match rejection rules and negative tests. | Focused raw scan shows matches in `memory-context.ts` denylist/redaction code and tests that assert rejection/redaction. | Treat production `memory-persistence.ts` no-match plus focused test assertions as the retention proof. |
| Docs sync rule asks for README updates after functional or architecture changes. | This lane is a planning/evidence submission only and changes no runtime/UI behavior. | No README translation updates are required for Lane B. |

## Status

```text
Status: accepted
```
