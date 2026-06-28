# Phase 12 Lane C Submission: Durable Fact Promotion Authority Gate Proof Plan

## Scope Confirmation

- Lane: `lane-c-durable-fact-authority-gate-proof-plan`
- Output file: `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/submissions/lane-c-durable-fact-authority-gate-proof-plan.md`
- Files reviewed: `AGENTS.md`; `C:\Users\27933\.codex\RTK.md`; `openclaw_runtime/AGENTS.md`; `harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md`; Phase 12 README/parallel lanes/submission template; Phase 11/10/9 syntheses; `runtime-research/agent-runtime-index.md`; `openclaw_runtime/src/runtime-core/memory-context.ts`; `openclaw_runtime/src/runtime-core/memory-store.ts`; `openclaw_runtime/src/runtime-core/memory-persistence.ts`; `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`; `openclaw_runtime/src/context-engine/memory-context-provider.ts`; focused tests listed below.
- Files changed: `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/submissions/lane-c-durable-fact-authority-gate-proof-plan.md`
- Runtime behavior changed: no
- TaskLoop/Gateway/runtime call-site import changed: no
- Provider registration/order changed: no
- Main/Gateway/host-api/api-client paths changed: no

## Executive Summary

Lane C is accepted as a durable-fact authority gate proof plan only. Current source and tests prove the Runtime Memory model already separates candidates from durable temporal facts, requires source/evidence links and promotion evidence for durable facts, stores verified-looking candidates as non-durable rows, and excludes non-current or non-authoritative facts from default current-valid queries.

This lane does not implement extraction or promotion. It rejects any future claim that memory-derived facts can influence runtime context beyond readonly summaries unless a later cutover spec proves the full durable promotion gate: source episode refs, evidence refs, accepted verification status, finite `acceptedAt`, verifier/human/deterministic-rule promotion evidence, current-valid exclusion behavior, rollback, no raw retention, and no completion/verifier/security/retry/tool/runtime authority.

## Phase Entry Confirmation

| Required Entry Fact | Evidence | Result |
|---|---|---|
| Phase 11 synthesis exists | `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md` | pass |
| Phase 11 synthesis ends exactly accepted | Exact suffix check returned `True`; `rtk rg -n "^Status:"` returned only line 116 for Phase 11 | pass |
| Phase 11 accepted only isolated default-off adapter wiring | Phase 11 synthesis Decision/Rejected Claims; adapter gates in `memory-runtime-integration.ts:55`, `:65`, `:74`, `:83`, `:89` | pass |
| Phase 11 rejected TaskLoop/Gateway/provider-ordering/default-on/raw-retention/runtime-authority cutover | Phase 11 synthesis Decision, Rejected Claims, and Next Decision | pass |
| Phase 10 accepted only default-off integration boundary/readiness | `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md`, line 105 status plus Decision | pass |
| Phase 9 accepted only default-off local sanitized persistence foundation | `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md`, line 139 status plus Decision | pass |

## Durable Fact Gate Definition

A future durable fact may influence runtime context beyond readonly summaries only when all of these are proven together:

| Gate | Required Proof | Current Evidence |
|---|---|---|
| Source episode refs | Non-empty `sourceEpisodeRefs` linking the fact to sanitized memory episodes | `isRuntimeMemoryTemporalFactCandidate()` requires non-empty source episode refs in `memory-context.ts:561`-`:564`; tests construct fact refs from accepted episodes in `runtime-memory-context-contracts.test.ts:185`-`:227` |
| Evidence refs | Non-empty `evidenceRefs` on the fact and on promotion evidence | Candidate shape requires non-empty `evidenceRefs` in `memory-context.ts:563`-`:565`; promotion evidence requires non-empty evidence refs in `memory-context.ts:530`-`:539` |
| Accepted verification status | One of `verified`, `human_approved`, or `deterministic_rule` | `isRuntimeMemoryTemporalFact()` requires `isRuntimeMemoryAcceptedVerificationStatus()` in `memory-context.ts:570`-`:583`; accepted statuses are asserted in `runtime-memory-context-contracts.test.ts:78`-`:82` |
| Finite acceptedAt | Numeric finite acceptance time separate from proposed time | Durable guard requires finite `acceptedAt` in `memory-context.ts:581`-`:583`; fixture/test proof at `runtime-memory-context-contracts.test.ts:196`-`:210` |
| Promotion evidence | `promotion.promotedBy` is `verifier`, `human`, or `deterministic_rule`; promotion has evidence refs and optional approver/rule id | `isRuntimeMemoryFactPromotionEvidence()` at `memory-context.ts:530`-`:539`; rank tests cover verifier/human/deterministic-rule promotion at `runtime-memory-context-contracts.test.ts:439`-`:464` |
| Candidate separation | Candidate shape remains valid but not durable without the durable-only fields | Candidate type excludes `acceptedAt`/`promotion`; persistence stores non-durable candidates with null accepted/promotion fields in `memory-persistence.ts:758`-`:783` |
| Current-valid filtering | Default queries exclude invalidated, expired, rejected, candidate, and unpromoted facts | Query filters in `memory-context.ts:900`-`:919` and `:1176`-`:1195`; store filters in `memory-store.ts:493`-`:512`; tests below |

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Durable facts require sourceEpisodeRefs and evidenceRefs | file/test | `openclaw_runtime/src/runtime-core/memory-context.ts`; `tests/unit/runtime-memory-context-contracts.test.ts` | `memory-context.ts:185`-`:207`, `:553`-`:565`; test `:154`-`:237` | Candidate base shape requires non-empty source/evidence refs; durable facts reuse that base shape. |
| Durable facts require accepted verification status, finite acceptedAt, and promotion evidence | file/test | `memory-context.ts`; `runtime-memory-context-contracts.test.ts` | `memory-context.ts:570`-`:583`; test `:196`-`:237` | Test asserts candidate verification status and empty promotion evidence do not satisfy durable fact guard. |
| Promotion evidence is limited to verifier/human/deterministic-rule | file/test | `memory-context.ts`; `runtime-memory-context-contracts.test.ts` | `memory-context.ts:530`-`:539`; test `:439`-`:464` | Accepted promotion origins are closed, evidence-backed values. |
| Verified-looking candidates remain non-durable in store queries | test | `tests/unit/runtime-memory-store.test.ts` | `:349`-`:440` | Default query returns only `fact_current`; verified-looking candidate appears only when explicitly requesting `status: "verified"`. |
| Verified-looking candidates remain non-durable in persistence | file/test | `memory-persistence.ts`; `tests/unit/runtime-memory-persistence.test.ts` | `memory-persistence.ts:758`-`:783`; test `:136`-`:155`, `:185`-`:245` | Row has `record_kind = "candidate"`, null `promotion_json`, no `promotion`, no `acceptedAt`, and defined `proposedAt`. |
| Verified-looking candidates remain non-durable through Phase 11 adapter | file/test | `memory-runtime-integration.ts`; `tests/unit/runtime-memory-runtime-integration.test.ts` | adapter gate `:71`-`:78`; test `:197`-`:251` | Default query after load returns none; explicit status query can inspect the candidate as diagnostic data only. |
| Current-valid queries exclude invalidated facts by default | file/test | `memory-store.ts`; `tests/unit/runtime-memory-store.test.ts` | invalidation merge `memory-store.ts:306`-`:327`; test `:294`-`:346` | Candidate/rejected invalidations do not apply; accepted invalidation hides fact unless `includeInvalidated` is true. |
| Current-valid queries exclude expired/rejected/candidate facts by default | file/test | `memory-context.ts`; `tests/unit/runtime-memory-context-contracts.test.ts`; `tests/unit/runtime-memory-store.test.ts` | `memory-context.ts:900`-`:919`, `:1176`-`:1195`; tests `runtime-memory-context-contracts.test.ts:340`-`:437`, `runtime-memory-store.test.ts:349`-`:440` | Include flags or explicit status are required to see excluded diagnostic facts. |
| Runtime Memory provider remains readonly/no-authority | file/test | `openclaw_runtime/src/context-engine/memory-context-provider.ts`; `tests/unit/runtime-memory-context-provider.test.ts` | provider metadata `memory-context-provider.ts:353`-`:361`; tests `:47`-`:62`, `:148`-`:167`, `:285`-`:305` | Context items carry no completion/verifier/security/retry/tool/runtime authority metadata. |
| Phase 12 added no runtime call-site import | scan | `rtk rg -n "memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER" openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/runtime-core/index.ts` | no matches | Lane C did not wire durable facts into runtime authority paths. |
| Raw retention remains rejected on focused memory surface | scan/test | Focused raw-retention scan over memory source/tests | production matches are rejection rules in `memory-context.ts:338`-`:391`; tests are negative fixtures/assertions | No raw transcript/chat/trace/tool/env/secret retention accepted. |
| No service/exporter/database-service/listener work | scan | Focused service/exporter/listener scan over memory source/tests | no matches | Lane C added no service/exporter/listener. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Planning/spec only | This submission file only | pass | No runtime code change. |
| No TaskLoop/Gateway/runtime call-site import | Runtime authority import scan listed above | pass | No matches. |
| No provider registration/order cutover | No provider registry edits; Lane C changed only this submission | pass | Provider ordering not part of Lane C implementation. |
| Flag-off parity plan | Future Acceptance Tests section | pass | Later cutover must prove disabled behavior before runtime context influence. |
| No SQLite open/read/write when disabled plan | `memory-runtime-integration.ts:55`-`:97`; future tests below | pass | Current adapter proof exists; future runtime call-site proof remains required. |
| Adapter isolation from TaskLoop/Gateway/Electron/renderer/shared/default registry | Runtime authority import scan | pass | No matches. |
| Persistence read boundary | `memory-persistence.ts:409`-`:427`; adapter `memory-runtime-integration.ts:89`-`:97` | pass | Load hydrates `RuntimeMemoryStore`; no raw row authority. |
| Persistence write boundary | `memory-persistence.ts:375`-`:388`; sanitizers `:826`-`:842` | pass | Facts are sanitized as durable or candidate shapes before write. |
| Store owner and schema preserved | `memory-persistence.ts:42`; fact schema `:247`-`:267` | pass | No schema change in Lane C. |
| Migration and idempotency preserved | Not changed | not-applicable | Lane C only writes research submission. |
| Retention and redaction preserved | Focused raw-retention scan and tests | pass | No retention behavior changed. |
| Raw chat/raw trace rejection | Focused raw-retention scan | pass | Matches are rejection patterns or negative fixtures. |
| No raw retention | `runtime-memory-persistence.test.ts:237`-`:245`; `runtime-memory-runtime-integration.test.ts:126`-`:194` | pass | Tests prove raw markers are rejected/not persisted. |
| No service/exporter/database-service/listener | Focused service scan | pass | No matches. |
| Provider ordering unchanged | No provider registry changes | pass | No default memory registration. |
| Source episode/evidence refs | `memory-context.ts:553`-`:565` | pass | Non-empty source/evidence refs required for fact candidate base shape. |
| Durable promotion gate | `memory-context.ts:530`-`:539`, `:570`-`:583` | pass | Accepted status, finite acceptedAt, promotion evidence required. |
| Current-valid query exclusion | `memory-context.ts:900`-`:919`, `:1176`-`:1195`; `memory-store.ts:493`-`:512` | pass | Tests prove default exclusions. |
| Rollback proof plan | Future Acceptance Tests section | pass | Disable flags, omit adapter/provider imports, preserve rows. |
| Config help/docs sync plan | Phase 12 docs-sync rule; no behavior change | pass | No README update required for research-only submission. |
| Comms replay/compare requirement | Phase 12 task spec and comms rule | not-applicable | Lane C did not touch Main/Gateway/host-api/api-client/provider transport paths. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | Lane C changed no config/runtime defaults; Phase 12/11/10/9 validations passed. |
| No TaskLoop/Gateway/runtime cutover | pass | Runtime authority import scan returned no matches. |
| No raw chat-log/raw trace memory | pass | Focused raw-retention scan shows production rejection patterns and negative tests. |
| No unverified durable facts | pass | Durable guard requires accepted status, finite acceptedAt, and promotion evidence; verified-looking candidates persist as candidates. |
| No provider-ordering cutover | pass | No provider registry edit; memory provider remains explicit/readonly. |
| No runtime authority | pass | Provider metadata/tests assert no completion/verifier/security/retry/tool/runtime authority. |
| No service/exporter/database-service/listener | pass | Focused service scan returned no matches. |

## Future Acceptance Tests For Durable Promotion

Before any memory-derived fact can influence runtime context beyond readonly summaries, a later phase must add and pass tests covering:

| Test | Required Assertion |
|---|---|
| Durable fact guard rejects missing refs | Missing or empty `sourceEpisodeRefs`, `evidenceRefs`, or promotion `evidenceRefs` makes `isRuntimeMemoryTemporalFact()` false and rejects persistence/runtime integration writes. |
| Durable fact guard rejects non-accepted status | `candidate`, `rejected`, and `invalidated` records with `acceptedAt` or promotion-like fields cannot become durable facts. |
| Durable fact guard rejects invalid acceptance time | Missing, non-finite, or non-numeric `acceptedAt` makes a fact non-durable and absent from default current-valid context. |
| Promotion origins are closed | Only `verifier`, `human`, and `deterministic_rule` promotion evidence can pass; LLM/self/prompt-derived promotion labels fail. |
| Verified-looking candidate remains candidate | A candidate with `verificationStatus: "verified"` but without durable fields remains `record_kind: "candidate"` with null accepted/promotion columns and is absent from default current-valid queries. |
| Default current-valid query exclusion | Default store/provider queries exclude invalidated, expired, rejected, candidate, and unpromoted facts; include flags or explicit status are diagnostic-only and must not grant runtime authority. |
| Runtime authority rejection | Memory facts cannot satisfy completion gates, verifier gates, security policy, retry policy, tool permission policy, provider ordering, or runtime execution policy. |
| Rollback and disabled parity | With memory flags disabled, future call sites do not read/write SQLite, do not hydrate provider output, and preserve legacy TaskLoop/Gateway behavior. |
| Raw retention rejection | Durable promotion input rejects raw chat logs, transcripts, trace dumps, prompt dumps, full payloads, checkpoints, tool args/output, env, secrets, and raw trace context. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md` | pass | Phase 12 spec validity | none |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md` | pass | Phase 11 prerequisite | none |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 prerequisite | none |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 prerequisite | none |
| `rtk.exe node.exe node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-memory-context-provider.test.ts` | pass, 5 files / 31 tests | Durable fact gate, current-valid filters, non-durable candidates, adapter/persistence/provider no-authority proof | none |
| `rtk.exe node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node TypeScript | none |
| Runtime authority import scan | pass/no matches | No adapter/persistence owner import into TaskLoop/Gateway/Electron/shared/renderer/default registry/runtime-core barrel | none |
| Focused raw-retention scan | pass/reviewed | Raw markers are rejection patterns or negative fixtures/assertions | none |
| Focused service/exporter/database-service/listener scan | pass/no matches | No service/listener/exporter additions | none |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| `verificationStatus: "verified"` can appear on a candidate shape for diagnostics, but that must not be mistaken for a durable fact. | `runtime-memory-store.test.ts:349`-`:440`; `runtime-memory-persistence.test.ts:221`-`:245`; `runtime-memory-runtime-integration.test.ts:197`-`:251` | Future cutover must require durable shape proof, not status-string proof alone. |
| Provider summaries rank accepted-looking facts, but provider output remains readonly and non-authoritative. | `memory-context-provider.ts:353`-`:361`; provider tests `:47`-`:62`, `:285`-`:305` | Later runtime influence needs a separate authority gate; readonly context ranking is not authority. |
| Diagnostic include flags can expose candidates/rejected/invalidated/expired facts. | Query filters allow explicit include/status requests; tests prove default exclusion. | Future runtime context must use default current-valid behavior unless a later synthesis accepts a narrowly scoped diagnostic-only path. |

## Rejected Claims

- Automatic LLM extraction or promotion to durable memory.
- Candidate, rejected, invalidated, expired, or verified-looking candidate facts acting as durable facts by default.
- Durable facts without source episode refs, evidence refs, finite `acceptedAt`, accepted verification status, and verifier/human/deterministic-rule promotion evidence.
- Memory-derived completion gates, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority.
- Raw chat-log, transcript, trace, prompt, payload, checkpoint, tool args/output, env, secret, traceparent, tracestate, or baggage retention.
- TaskLoop/Gateway/runtime call-site cutover or provider ordering cutover in Phase 12.

Status: accepted
