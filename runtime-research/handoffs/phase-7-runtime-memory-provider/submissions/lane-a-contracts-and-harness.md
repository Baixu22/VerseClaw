# lane-a-contracts-and-harness: Runtime memory episode/fact contracts and harness

## Scope Confirmation

- Lane: `lane-a-contracts-and-harness`
- Output file: `runtime-research/handoffs/phase-7-runtime-memory-provider/submissions/lane-a-contracts-and-harness.md`
- Lane-owned file only: yes, within Lane A suggested scope; `runtime-core/index.ts` touched only to export the new contract module.
- Implementation paths touched: `openclaw_runtime/src/runtime-core/memory-context.ts`; `openclaw_runtime/src/runtime-core/index.ts`
- Test paths touched: `tests/unit/runtime-memory-context-contracts.test.ts`
- Commands run: harness context/validate, focused contract test, node typecheck, renderer bypass scan, touched-file service/exporter scan, raw-retention scan, README docs-sync search.
- Required reading completed: `C:\Users\27933\.codex\RTK.md`; `AGENTS.md`; `openclaw_runtime/AGENTS.md`; `runtime-research/agent-runtime-index.md`; Phase 6 synthesis; Phase 7 README/lanes/template; Graphiti temporal/mapping/useful-tests/extraction docs; Phase 7 task spec; selected harness scenario/rules/layers from `harness context`.

## Executive Summary

- Added canonical Runtime Memory Provider contracts in `memory-context.ts`.
- Defined sanitized episode records, source refs, source episode refs, temporal fact candidates, accepted facts, invalidation proposals, query contracts, summaries, and readonly provider result contracts.
- Added `valid_at`, `invalid_at`, `expired_at`, `reference_time`, source episode refs, evidence refs, verification status, promotion evidence, and idempotency key fields.
- Added default-off flags for `runtime.memory.shadow`, `runtime.memory.provider`, `runtime.memory.proposeFacts`, and `runtime.memory.persist`.
- Added raw-memory rejection helpers and metadata redaction helpers for raw chat logs, raw transcripts, raw trace dumps, prompts, payloads, tool args/output, env, secrets, baggage, and tracestate.
- Added pure deterministic helpers for duplicate episode idempotency, current-valid/historical fact filtering, fact ranking, and token-budgeted summaries.
- Added fixture builders and focused contract tests covering flags, validation, rejection/redaction, idempotency, temporal queries, invalidation, promotion evidence, and summary contracts.
- No TaskLoop, Gateway, renderer, provider registry, persistence, extraction, UI, transport, durable promotion, or default-on runtime behavior was wired.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Memory flags are default-off | file | `openclaw_runtime/src/runtime-core/memory-context.ts` | `RUNTIME_MEMORY_CONTEXT_FLAG_PATHS` line 114; `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` line 129 | Strict flag parser enables only literal `true`. |
| Episode contract includes task/source/evidence/idempotency fields | file | `openclaw_runtime/src/runtime-core/memory-context.ts` | `RuntimeMemoryEpisodeRecord` line 157 | `redactionStatus: "sanitized"` and non-empty source/evidence refs required. |
| Temporal fact contracts include required time/provenance fields | file | `openclaw_runtime/src/runtime-core/memory-context.ts` | `RuntimeMemoryTemporalFactCandidate` line 185; `RuntimeMemoryTemporalFact` line 201 | Accepted facts require accepted verification status plus promotion evidence. |
| Invalidation/query/summary contracts exist | file | `openclaw_runtime/src/runtime-core/memory-context.ts` | `RuntimeMemoryInvalidationProposal` line 210; `RuntimeMemoryFactQuery` line 225; `RuntimeMemorySummary` line 253 | Contract-only; no store or provider registration. |
| Raw-memory rejection and redaction helpers exist | file | `openclaw_runtime/src/runtime-core/memory-context.ts` | `rejectRawRuntimeMemoryInput` line 710; `sanitizeRuntimeMemoryMetadata` line 733 | Rejects raw inputs; metadata redacts sensitive keys/values. |
| Idempotency/query/summary pure helpers exist | file | `openclaw_runtime/src/runtime-core/memory-context.ts` | `dedupeRuntimeMemoryEpisodes` line 877; `findRuntimeMemoryFacts` line 928; `summarizeRuntimeMemoryFacts` line 964 | Pure helpers only, no persistence. |
| Fixture builders exist | file | `openclaw_runtime/src/runtime-core/memory-context.ts` | `buildRuntimeMemoryEpisodeFixture` line 1008 | Includes episode, candidate, fact, and invalidation fixtures. |
| Runtime-core export added | file | `openclaw_runtime/src/runtime-core/index.ts` | line 14 | Barrel export only. |
| Focused contract tests pass | test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts` | 1 file / 8 tests | Exact required focused test passed. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Path/function evidence for changed surfaces | `memory-context.ts`; `index.ts`; test file | pass | See evidence table. |
| Flag-off legacy parity | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS`; `resolveRuntimeMemoryFeatureFlags({})`; tests line 36 | pass | No legacy path touched; flags default false. |
| Sanitization/redaction coverage | `sanitizeRuntimeMemoryText`; `sanitizeRuntimeMemoryMetadata`; tests line 239 and 275 | pass | Raw inputs rejected, metadata redacted. |
| Raw chat-log rejection | Focused test line 239 | pass | `user:` / role JSON fixtures rejected. |
| Raw trace-dump rejection | Focused test line 239 | pass | Raw trace dump / traceparent fixture rejected. |
| Raw-retention scan | `rtk rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' ...` | pass/reviewed | Matches are sanitizer denylist code, rejection/redaction fixtures, and audit text only. |
| Source episode/evidence refs present | `RuntimeMemoryTemporalFactCandidate`; tests line 154 | pass | Type guards require non-empty source episode refs and evidence refs. |
| Durable fact promotion requires verifier/human/deterministic-rule evidence | `RuntimeMemoryTemporalFact`; `RuntimeMemoryFactPromotionEvidence`; tests line 154 | pass | Accepted fact guard rejects candidates and empty promotion evidence. |
| valid_at / invalid_at / expired_at / reference_time behavior | `isRuntimeMemoryFactValidAt`; tests line 340 | pass | Current-valid and historical query behavior covered. |
| Idempotent duplicate episode handling | `dedupeRuntimeMemoryEpisodes`; tests line 309 | pass | Duplicate idempotency key keeps first sanitized episode refs. |
| Current-valid query excludes invalid/rejected/unverified facts | `findRuntimeMemoryFacts`; tests line 340 | pass | Candidates/rejected/invalidated/expired excluded unless explicitly requested. |
| Token-budget summary behavior | `summarizeRuntimeMemoryFacts`; tests line 475 | pass | Summary remains readonly and within token budget. |
| Touched-file service/exporter scan | `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' ...` | pass | No matches in touched code/test files. |
| Renderer IPC/Gateway bypass scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components` | pass | No matches; `rg` exit 1 means no output. |
| Comms replay/compare if Main/Gateway paths changed | not run | not-applicable | No Main/Gateway/runtime communication path changed. |

## Implementation Summary

Current code:
- `memory-context.ts` adds contracts, type guards, strict default-off flag resolution, sanitizers/redactors, fixture builders, and pure helper functions.
- `index.ts` exports `./memory-context.js`.

Tests:
- `runtime-memory-context-contracts.test.ts` covers taxonomies/flags, shape validation, raw rejection, redaction, idempotency, temporal filtering, ranking, and readonly summaries.

Feature flags:
- `runtime.memory.shadow`: default false, local diagnostics only in future lanes.
- `runtime.memory.provider`: default false, readonly context only in future lanes.
- `runtime.memory.proposeFacts`: default false, candidate facts only in future lanes.
- `runtime.memory.persist`: default false, blocked until retention/redaction/idempotency/invalidation/rollback evidence exists.

Docs/index:
- README docs search found no user-facing runtime-memory surface. No README update required because this lane adds internal contracts only and no user-visible behavior, RPC, UI, or transport behavior.
- `runtime-research/agent-runtime-index.md` not updated; Lane E/synthesis owns accepted Phase 7 index updates.

## Memory Contract Surface

| Surface | Contract / Adapter | Shadow / Readonly / Proposal Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Sanitized episode | `RuntimeMemoryEpisodeRecord` | contract-only | `runtime.memory.shadow` default false | `memory-context.ts` line 157; tests line 154 |
| Temporal fact candidate | `RuntimeMemoryTemporalFactCandidate` | proposal-only | `runtime.memory.proposeFacts` default false | `memory-context.ts` line 185; tests line 154 |
| Accepted temporal fact | `RuntimeMemoryTemporalFact` | contract-only durable shape; no store | none enabled | `memory-context.ts` line 201; tests line 154 |
| Invalidation | `RuntimeMemoryInvalidationProposal` | proposal-only | `runtime.memory.proposeFacts` default false | `memory-context.ts` line 210; tests line 154 |
| Query/summary | `RuntimeMemoryFactQuery`; `RuntimeMemorySummary` | readonly pure helpers | `runtime.memory.provider` default false | `memory-context.ts` lines 225 and 253; tests line 475 |
| Provider result shape | `RuntimeMemoryContextProviderResult` | readonly contract only | `runtime.memory.provider` default false | tests line 475 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion | Unchanged | No TaskLoop files touched | Low |
| tools.invoke | Unchanged | No Gateway/tool files touched | Low |
| approval waiting/retry/error mapping | Unchanged | No runtime execution files touched | Low |
| event-log/checkpoint/resume | Unchanged | No event-log/checkpoint/resume files touched | Low |
| Evidence Verifier | Unchanged | Memory contracts only reference evidence refs | Low |
| Trace Context Provider | Unchanged | Trace code not touched | Low |
| Provider ordering | Unchanged | No provider registry touched | Low |

## Safety / Retention Audit

| Focus | Result | Evidence | Gap |
|---|---|---|---|
| No raw chat-log/transcript memory | pass | Rejection helpers and tests line 239 | None |
| No raw trace-dump memory | pass | Rejection helpers and tests line 239 | None |
| No raw prompts/full payload persistence | pass | Contract-only; no persistence; sanitizer tests | None |
| No full memory dump exposed by default | pass | Summaries are token-budgeted and readonly | None |
| Automatic/LLM extraction remains proposal-only | pass | Candidate contract only; no extraction wiring | None |
| Durable facts require verifier/human/deterministic evidence | pass | `RuntimeMemoryFactPromotionEvidence`; tests line 154 | None |
| Token-budgeted summaries | pass | `summarizeRuntimeMemoryFacts`; tests line 475 | None |
| Source refs do not replace verifier evidence | pass | Source episode refs and evidence refs remain separate fields | None |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Phase 7 routing/read list | None |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Task spec validity | None |
| Focused contract test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts` | pass, 1 file / 8 tests | Contracts, flags, sanitizers, queries, summaries | None |
| Node typecheck | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Runtime-core TypeScript surface selected by node config | None |
| Renderer bypass scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components` | pass/no matches | No renderer IPC/Gateway bypass | None |
| Touched-file service/exporter scan | `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/runtime-core/memory-context.ts openclaw_runtime/src/runtime-core/index.ts tests/unit/runtime-memory-context-contracts.test.ts` | pass/no matches | No service/exporter/listener/collector additions | None |
| Raw-retention scan | `rtk rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' openclaw_runtime/src/runtime-core/memory-context.ts openclaw_runtime/src/runtime-core/index.ts tests/unit/runtime-memory-context-contracts.test.ts` | pass/reviewed | No retained raw memory; sanitizer/test fixtures only | None |
| Docs-sync search | `rtk rg -n "Runtime Memory|runtime memory|memory provider|trace context|Evidence Verifier|runtime-core" README.md README.zh-CN.md README.ja-JP.md README.ru-RU.md` | pass/no matches | README update not required | None |

Dependency note:
- The first required Vitest command initially failed because local `node_modules/vitest` was absent.
- `pnpm install --frozen-lockfile` was blocked by an existing package/lock override mismatch.
- `pnpm install --no-frozen-lockfile` was blocked by pnpm's exotic subdependency guard for `@whiskeysockets/baileys`.
- After the partial dependency install made local Vitest/TypeScript available, the exact required focused test and node typecheck passed. `package.json` and `pnpm-lock.yaml` were already dirty before Lane A work and were not intentionally changed by this lane.

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory recording/provider/persistence/extraction/promotion | pass | Flags default false; no wiring. |
| No raw chat-log/raw trace memory | pass | Rejection helpers plus focused tests. |
| No observability platform/collector/exporter/database service | pass | Touched-file service/exporter scan no matches. |
| No second runtime service/listener/Gateway/Temporal | pass | No service files touched; scan no matches. |
| No renderer direct IPC | pass | Renderer bypass scan no matches. |
| No renderer direct Gateway HTTP/WS | pass | Renderer bypass scan no matches. |
| No runtime authority/completion gate/security/retry/tool policy from memory provider | pass | Contracts only; no runtime execution path touched. |
| Comms replay/compare when Main/Gateway paths changed | not-applicable | Main/Gateway paths unchanged. |
| UI changes have E2E and i18n | not-applicable | No UI/user-visible text changed. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| README/docs-sync vs internal-only contract | README search has no runtime-memory surface | Avoid user-facing docs churn for non-user-visible contract work | No README update in Lane A. |
| Local dependency install blocked by repo supply-chain guard | `pnpm install --no-frozen-lockfile` fails on exotic subdependency guard | Validate focused lane without relaxing security settings | Use exact required commands once local partial install made tools available; do not change pnpm policy. |
| Accepted fact contract without store | Lane A scope forbids persistence/durable promotion behavior | Define durable shape but no runtime behavior | Lane B/C must add store/proposal behavior behind explicit default-off flags. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: lane-b-local-episode-fact-store-query
New code path: openclaw_runtime/src/runtime-core/memory-store.ts
Legacy path wrapped: none by default
Shadow / readonly / proposal boundary: local sanitized store/query only; no provider ordering
Feature flag: runtime.memory.shadow and runtime.memory.persist remain default false
Tests: runtime-memory-store tests for idempotency, clone isolation, temporal filtering, invalidation, and raw-retention rejection
Harness: reuse phase-7-runtime-memory-provider spec and Lane A contracts
Rollback: omit/disable memory flags; no legacy runtime behavior changes
Done when: bounded local store/query proves sanitized append, duplicate idempotency, current-valid filtering, historical queries, and no raw retention or service/exporter additions
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should Lane B define only in-memory store behavior, or also a disabled persistence interface? | Persistence is the highest retention/rollback risk. | maintainer / synthesis owner | no |
| Should accepted deterministic sources initially exclude trace-derived facts unless verifier-backed? | Further reduces accidental trace-summary promotion. | maintainer / agent | no |

## Handoff Notes

- Lane A intentionally does not update `runtime-research/agent-runtime-index.md`; synthesis/Lane E should update accepted Phase 7 pointers.
- Future lanes must keep candidates separate from accepted facts and must not treat trace summaries or model summaries as durable truth.
- Future persistence/provider work requires fresh evidence for retention, redaction, invalidation, rollback, and flag-off parity.
