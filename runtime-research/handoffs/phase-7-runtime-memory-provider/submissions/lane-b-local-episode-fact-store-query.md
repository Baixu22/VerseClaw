# lane-b-local-episode-fact-store-query: Local episode/fact store query

## Scope Confirmation

- Lane: `lane-b-local-episode-fact-store-query`
- Output file: `runtime-research/handoffs/phase-7-runtime-memory-provider/submissions/lane-b-local-episode-fact-store-query.md`
- Lane-owned file only: yes, within Lane B suggested scope; no TaskLoop, Gateway, provider registry, renderer, persistence, or export wiring was touched.
- Implementation paths touched: `openclaw_runtime/src/runtime-core/memory-store.ts`
- Test paths touched: `tests/unit/runtime-memory-store.test.ts`
- Commands run: harness context/validate, Lane A + Lane B focused tests, required node typecheck, targeted TypeScript probe, raw-retention scan, touched-file service/exporter scan, renderer bypass scan.
- Required reading completed: `C:\Users\27933\.codex\RTK.md`; root `AGENTS.md`; `openclaw_runtime/AGENTS.md`; Phase 7 task spec, README, parallel lanes, and submission template; Lane A accepted handoff; `memory-context.ts`, `evidence.ts`, `types.ts`; selected Phase 6 / Graphiti / roadmap / index references from the Phase 7 required read list.

## Executive Summary

- Added `RuntimeMemoryStore`, an explicit-construction-only local in-memory store over Lane A episode/fact/invalidation contracts.
- Store append paths sanitize Lane A records before retention and reject raw chat/tool-output style inputs instead of storing them.
- Episode append is idempotent by idempotency key and additively preserves unique source/evidence refs without creating duplicate episodes.
- Fact append does not overwrite an existing fact id; replacement truth requires a separate fact plus an invalidation record.
- Current-valid and historical queries support task, file, symbol, subject, evidence, status, source episode, fact id, and time filters.
- Default current-valid queries exclude candidates, rejected facts, expired facts, invalidated facts, and unpromoted verified-looking candidates.
- Invalidation is additive and query-time: accepted invalidation records can close a fact's valid window without mutating the stored fact.
- Returned episodes, facts, invalidations, and summaries are cloned and deep-frozen readonly values.
- Summaries are token-budgeted via Lane A `summarizeRuntimeMemoryFacts`.
- No persistence, database, service, listener, exporter, UI, provider, TaskLoop, or Gateway wiring was added.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Local explicit store exists with no singleton or wiring | file | `openclaw_runtime/src/runtime-core/memory-store.ts` | `RuntimeMemoryStore` line 92 | Exported class only; no index/barrel/provider registration. |
| Episode append sanitizes and is idempotent | file | `openclaw_runtime/src/runtime-core/memory-store.ts` | `appendEpisode` line 116 | Duplicate idempotency key merges unique source/evidence refs and returns `duplicate: true`. |
| Fact append does not silently overwrite truth | file | `openclaw_runtime/src/runtime-core/memory-store.ts` | `appendFact` line 164 | Duplicate `factId` returns existing stored fact clone instead of replacing object summary/evidence. |
| Fact invalidation is additive and query-time | file | `openclaw_runtime/src/runtime-core/memory-store.ts` | `invalidateFact` line 194; `factsWithInvalidations` line 300 | Accepted invalidation proposals set effective `invalid_at` for query results without mutating stored facts. |
| Store queries support Lane B filters | file | `openclaw_runtime/src/runtime-core/memory-store.ts` | `queryFacts` line 260; `matchesStoreQuery` line 324 | Adds file/symbol/task/evidence/status/time filters over Lane A query helpers. |
| Default query excludes unverified/provenance-only shapes | file | `openclaw_runtime/src/runtime-core/memory-store.ts` | `queryAllowsFactShape` line 487 | Candidates require explicit candidate/status/provenance query. |
| Returned data is clone/readonly | file | `openclaw_runtime/src/runtime-core/memory-store.ts` | `readonlyCloneArray` line 581; `readonlyClone` line 587; `deepFreeze` line 595 | All public read/query/summary methods return cloned deep-frozen values. |
| Token-budget summaries exist | file | `openclaw_runtime/src/runtime-core/memory-store.ts` | `summarizeFacts` line 266 | Uses Lane A summary helper over store-filtered facts. |
| Focused Lane B behavior is covered | test | `tests/unit/runtime-memory-store.test.ts` | tests line 14, 97, 126, 239, 332 | Covers bounds/idempotency/readonly, raw rejection, temporal query/invalidation, default exclusions, summaries. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Path/function evidence for changed surfaces | `memory-store.ts`; `runtime-memory-store.test.ts` | pass | See evidence table. |
| Flag-off legacy parity | no legacy paths touched; no feature flag or runtime wiring added | pass | Explicit construction only; existing Phase 7 flags remain Lane A defaults. |
| Sanitization/redaction coverage | `appendEpisode`, `appendFact`, `invalidateFact`; tests line 97 and 332 | pass | Store uses Lane A sanitizers on append and summaries show redacted metadata. |
| Raw chat-log rejection | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-store.test.ts` | pass | Test line 97 rejects raw chat-shaped episode summary. |
| Raw trace-dump rejection | Lane A contract test retained; Lane B raw-retention scan reviewed | pass | Lane B does not add trace ingestion; append uses Lane A sanitizer path. |
| Raw-retention scan | `rtk rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' openclaw_runtime/src/runtime-core/memory-store.ts tests/unit/runtime-memory-store.test.ts` | pass/reviewed | Matches are only deliberate test rejection/redaction fixtures at test lines 97, 112, 356, and 372. |
| Source episode/evidence refs present | store append/query plus tests line 14 and 126 | pass | Duplicate episode handling preserves refs; file/symbol/evidence queries traverse source episodes and fact evidence refs. |
| Durable fact promotion requires verifier/human/deterministic-rule evidence | `appendFact`; tests line 239 | pass | Accepted facts must satisfy Lane A `RuntimeMemoryTemporalFact`; unpromoted verified-looking candidates are excluded by default. |
| valid_at / invalid_at / expired_at / reference_time behavior | tests line 126 and 239 | pass | Historical query returns old fact before invalidation; current query excludes invalidated/expired facts. |
| Idempotent duplicate episode handling | tests line 14 | pass | Duplicate idempotency key returns duplicate result and preserves merged source/evidence refs. |
| Current-valid query excludes invalid/rejected/unverified facts | tests line 126 and 239 | pass | Default query excludes invalidated old fact, candidate, rejected, expired, and unpromoted verified candidate. |
| Token-budget summary behavior | tests line 332 | pass | Summary estimated tokens stay within budget and returned summary is readonly. |
| Touched-file service/exporter scan | `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/runtime-core/memory-store.ts tests/unit/runtime-memory-store.test.ts` | pass | No matches. |
| Renderer IPC/Gateway bypass scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components` | pass | No matches. |
| Comms replay/compare if Main/Gateway paths changed | not run | not-applicable | No Main, Gateway, renderer, host-api, api-client, or runtime communication path changed. |

## Implementation Summary

Current code:
- `memory-store.ts` adds a bounded in-memory `RuntimeMemoryStore` with configurable `maxEpisodes`, `maxFacts`, and `maxInvalidations`.
- Public write methods are `appendEpisode`, `appendFact`, and `invalidateFact`; public read methods are `getEpisodeById`, `getFactById`, `listEpisodes`, `listInvalidations`, `queryFacts`, `summarizeFacts`, and `stats`.
- The store holds only sanitized Lane A records: ids, bounded summaries, refs, statuses, timestamps, and verification metadata.
- Invalidation proposals remain separate records. Query results can show effective `invalid_at`; the stored original fact remains unchanged.

Tests:
- `runtime-memory-store.test.ts` covers bounded retention, duplicate episode idempotency, clone/readonly isolation, raw rejection, temporal current/historical queries, file/symbol/evidence/status filters, invalidation without overwrite, default provenance exclusion, and token-budget summaries.

Feature flags:
- No new flags were added.
- `runtime.memory.shadow`, `runtime.memory.provider`, `runtime.memory.proposeFacts`, and `runtime.memory.persist` remain Lane A default-off contracts.

Docs/index:
- No README update required because this lane adds internal runtime-core store behavior only and no user-visible feature, RPC, UI, transport behavior, persistence, or provider ordering change.
- `runtime-research/agent-runtime-index.md` remains synthesis/Lane E-owned.

## Memory Contract Surface

| Surface | Contract / Adapter | Shadow / Readonly / Proposal Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Local episode store | `RuntimeMemoryStore.appendEpisode`; `listEpisodes` | local sanitized store only | `runtime.memory.shadow` remains default false | `memory-store.ts` line 116; tests line 14 |
| Local fact/candidate store | `RuntimeMemoryStore.appendFact`; `queryFacts` | local readonly query only | `runtime.memory.proposeFacts` remains default false | `memory-store.ts` line 164 and 260; tests line 126 and 239 |
| Invalidation records | `RuntimeMemoryStore.invalidateFact` | additive proposal/accepted invalidation records | `runtime.memory.proposeFacts` remains default false | `memory-store.ts` line 194 and 300; tests line 126 |
| Summaries | `RuntimeMemoryStore.summarizeFacts` | readonly token-budgeted summary | `runtime.memory.provider` remains default false | `memory-store.ts` line 266; tests line 332 |
| Persistence | none | blocked | `runtime.memory.persist` remains default false | No filesystem, DB, service, exporter, or index wiring added. |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion | Unchanged | No TaskLoop files touched | Low |
| tools.invoke | Unchanged | No Gateway/tool files touched | Low |
| approval waiting/retry/error mapping | Unchanged | No runtime execution files touched | Low |
| event-log/checkpoint/resume | Unchanged | No event-log/checkpoint/resume files touched | Low |
| Evidence Verifier | Unchanged | Store references evidence refs only; verifier files untouched | Low |
| Trace Context Provider | Unchanged | No trace provider files touched; trace facts are not promoted | Low |
| Provider ordering | Unchanged | No context provider registry/barrel/provider wiring touched | Low |

## Safety / Retention Audit

| Focus | Result | Evidence | Gap |
|---|---|---|---|
| No raw chat-log/transcript memory | pass | Append rejection test line 97; raw-retention scan reviewed | None |
| No raw trace-dump memory | pass | Lane A sanitizer path used on append; no trace ingestion added | None |
| No raw prompts/full payload persistence | pass | No persistence; metadata sanitizer redaction covered by summary test line 332 | None |
| No full memory dump exposed by default | pass | `summarizeFacts` is token-budgeted and readonly | None |
| Automatic/LLM extraction remains proposal-only | not-applicable | No extraction flow added | None |
| Durable facts require verifier/human/deterministic evidence | pass | Accepted facts rely on Lane A `RuntimeMemoryTemporalFact`; unpromoted candidates excluded by default | None |
| Token-budgeted summaries | pass | Test line 332 | None |
| Source refs do not replace verifier evidence | pass | Store keeps `sourceEpisodeRefs` and `evidenceRefs` separate; tests query both | None |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Phase 7 routing/read list | None |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Task spec validity | None |
| Lane B focused test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-store.test.ts` | pass, 1 file / 5 tests | Local store behavior | None |
| Lane A + Lane B tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts` | pass, 2 files / 13 tests | Lane A contracts plus Lane B store | None |
| Required node typecheck | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Required Phase 7 node typecheck | None |
| Targeted TypeScript probe | `rtk node node_modules/typescript/bin/tsc --noEmit --strict --module ESNext --moduleResolution bundler --target ES2022 --skipLibCheck --types vitest,node tests/unit/runtime-memory-store.test.ts` | pass | New store/test TS surface not covered by narrow node config | None |
| Raw-retention scan | `rtk rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' openclaw_runtime/src/runtime-core/memory-store.ts tests/unit/runtime-memory-store.test.ts` | pass/reviewed | No raw retention in store; deliberate rejection fixtures only | None |
| Touched-file service/exporter scan | `rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/runtime-core/memory-store.ts tests/unit/runtime-memory-store.test.ts` | pass/no matches | No service/exporter/listener additions | None |
| Renderer bypass scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components` | pass/no matches | No renderer IPC/Gateway bypass | None |
| Comms replay/compare | not run | not-applicable | Main/Gateway communication paths unchanged | None |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory recording/provider/persistence/extraction/promotion | pass | No wiring or flags added; store is explicit construction only. |
| No raw chat-log/raw trace memory | pass | Append sanitizer and raw-retention scan. |
| No observability platform/collector/exporter/database service | pass | Touched-file service/exporter scan no matches. |
| No second runtime service/listener/Gateway/Temporal | pass | No service files touched; touched-file scan no matches. |
| No renderer direct IPC | pass | Renderer bypass scan no matches. |
| No renderer direct Gateway HTTP/WS | pass | Renderer bypass scan no matches. |
| No runtime authority/completion gate/security/retry/tool policy from memory provider | pass | Store has no TaskLoop/tool/security/retry/provider integration. |
| Comms replay/compare when Main/Gateway paths changed | not-applicable | Main/Gateway paths unchanged. |
| UI changes have E2E and i18n | not-applicable | No UI or user-facing text changed. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Lane B needs query by file/symbol but Lane A `RuntimeMemoryFactQuery` has no file/symbol fields | Lane A query fields stop at task/source episode/evidence/status/time | Keep Lane A contracts stable and scoped | Add store-specific `RuntimeMemoryStoreFactQuery` fields and resolve them through source episodes/evidence refs locally. |
| Invalidating current truth could be implemented by mutating stored facts | Phase 7 requires historical facts without rewriting truth | Preserve temporal history and provenance | Store invalidation proposals separately and apply effective `invalid_at` only to query result clones. |
| Accepted-looking candidates can carry `verificationStatus: "verified"` without promotion evidence | Lane A candidate type is broad for proposal/provenance views | Default current-valid must exclude unverified facts | Store default query requires accepted `RuntimeMemoryTemporalFact`; candidate shapes require explicit status/provenance query. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: lane-c-fact-proposal-invalidation-shadow
New code path: default-off proposal/invalidation shadow over verified local sources
Legacy path wrapped: none by default
Shadow / readonly / proposal boundary: proposal-only fact extraction/invalidation, no durable promotion without verifier/human/deterministic evidence
Feature flag: runtime.memory.proposeFacts remains default false
Tests: proposal-vs-accepted separation, invalidation proposal behavior, no raw payload retention, no verifier/security/retry/runtime authority
Harness: reuse phase-7-runtime-memory-provider spec
Rollback: omit proposal wiring; local store remains explicit construction only
Done when: proposals can be produced behind flags without provider ordering, persistence, runtime authority, or raw retention
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should future Lane C expose rejected/invalidation proposal listing APIs separately from fact query APIs? | Keeps provenance views explicit before provider summaries exist. | maintainer / synthesis owner | no |

## Handoff Notes

- Lane B intentionally did not export the store from `runtime-core/index.ts`; future lanes can choose the narrowest integration point if provider wiring becomes necessary.
- Persistence remains blocked. The store is process-local only and has no filesystem/database path.
- Candidate facts are retained only as explicit local query/provenance data; default current-valid queries require accepted fact shape and promotion evidence.
