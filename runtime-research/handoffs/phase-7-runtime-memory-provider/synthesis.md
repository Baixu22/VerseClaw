# Phase 7 Synthesis: Runtime Memory Provider

## Decision

Phase 7 is accepted as a default-off, local-only Runtime Memory Provider foundation.

Accepted scope is limited to sanitized episode/fact contracts, an explicit in-memory store, proposal-only fact/invalidation helpers, and a readonly budgeted provider factory. Phase 7 is not accepted for persistence, default-on memory recording, default provider injection, provider-ordering cutover, durable LLM fact promotion, service/exporter/database work, or runtime authority.

## Inputs Reviewed

| Input | Status | Notes |
|---|---|---|
| `runtime-research/handoffs/phase-7-runtime-memory-provider/README.md` | reviewed | Defines accepted/rejected Phase 7 boundary. |
| `runtime-research/handoffs/phase-7-runtime-memory-provider/parallel-lanes.md` | reviewed | Defines A-E evidence requirements and future cutover block. |
| `harness/specs/tasks/phase-7-runtime-memory-provider.md` | reviewed/validated | Harness task spec validates. |
| `runtime-research/agent-runtime-index.md` | reviewed/updated | Updated only after this synthesis accepted Phase 7. |
| `runtime-research/implementation-roadmap.md`, Phase 7 | reviewed | Confirms memory follows evidence/verifier/trace foundations. |
| `runtime-research/migration-execution-plan.md`, Stage 8 | reviewed | Confirms Runtime Memory should replace raw chat-log style memory. |
| `runtime-research/agent-runtime-core-spec.md` | reviewed | Confirms RuntimeMemoryProvider follows Graphiti-style episode/fact lookup. |
| `runtime-research/handoffs/phase-6-trace-context-provider/synthesis.md` | reviewed | Phase 6 requires fresh Phase 7 spec and forbids raw trace facts as durable memory. |
| `runtime-research/graphiti/*.md` | reviewed | Temporal fact, episode, valid_at/invalid_at, evidence-ref model reviewed. |
| A-E submissions | reviewed | All five lanes have exactly one valid `Status: accepted`; claims were rechecked against code/tests/scans. |

## Lane Classification

| Lane | Status | Reason |
|---|---|---|
| lane-a-contracts-and-harness | accepted | Adds default-off flags, bounded sanitized contracts, raw input rejection/redaction, source/evidence refs, temporal query/summary helpers, and focused tests. No runtime wiring. |
| lane-b-local-episode-fact-store-query | accepted | Adds explicit in-memory store with sanitized append, duplicate episode idempotency, clone/read isolation, invalidation-aware current/historical queries, and budgeted summaries. No persistence/service/provider wiring. |
| lane-c-fact-proposal-invalidation-shadow | accepted | Adds default-off proposal-only helper gated by `runtime.memory.shadow` and `runtime.memory.proposeFacts`; emits candidates/invalidation proposals only and `acceptedFacts: []`. |
| lane-d-memory-context-provider-summary | accepted | Adds readonly provider factory gated by `runtime.memory.provider`; output is source/evidence-linked budgeted context. Default registry ordering is unchanged. |
| lane-e-validation-docs-synthesis-readiness | accepted | Validated submissions, harness, tests, typecheck, scans, docs decision, and comms replay/compare. Lane E's Lane D status fix was doc-only and revalidated. |

## Memory Surface Accepted

| Surface | Evidence | Accepted Boundary |
|---|---|---|
| Feature flags | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` has `shadow`, `provider`, `proposeFacts`, and `persist` all false in `openclaw_runtime/src/runtime-core/memory-context.ts:129`. | Default-off only. |
| Sanitized episode contract | `RuntimeMemoryEpisodeRecord` requires bounded summary, source refs, evidence refs, idempotency key, reference time, and `redactionStatus: "sanitized"` at `memory-context.ts:157`. | Contract and sanitized local records only. |
| Temporal fact contracts | Candidate/fact types carry `valid_at`, `invalid_at`, `expired_at`, `reference_time`, `sourceEpisodeRefs`, `evidenceRefs`, verification status, and promotion evidence at `memory-context.ts:171`, `memory-context.ts:185`, and `memory-context.ts:201`. | Durable facts must be promoted by verifier, human, or deterministic rule. |
| Local store | `RuntimeMemoryStore` is an explicit class at `memory-store.ts:92`; append/query methods are local in-memory APIs. | No singleton, no persistence, no service. |
| Proposal shadow | `buildRuntimeMemoryFactProposalShadow` returns empty disabled output unless both flags are true at `memory-proposal-shadow.ts:102`; result has `acceptedFacts: []` at `memory-proposal-shadow.ts:123`. | Candidate/proposal-only. |
| RuntimeMemoryProvider factory | `createRuntimeMemoryContextProvider` manifest is `enabledByDefault: false` and `shadowOnly: true` at `memory-context-provider.ts:48` and `memory-context-provider.ts:65`. | Readonly budgeted context only, optional registration. |

## Accepted Boundary Audit

| Boundary | Evidence | Status |
|---|---|---|
| Episode contract is bounded and sanitized | `sanitizeRuntimeMemoryEpisodeRecord` uses bounded text sanitizer and writes `redactionStatus: "sanitized"` at `memory-context.ts:742`; tests cover sanitized records at `runtime-memory-context-contracts.test.ts:154`. | pass |
| Temporal fact contract carries valid_at / invalid_at / source evidence | Temporal fields and source/evidence refs are required in type guards at `memory-context.ts:514`, `memory-context.ts:544`, and `memory-context.ts:570`. | pass |
| Local store/query is bounded, local-only, and idempotent | Store bounds are constructor-only at `memory-store.ts:107`; duplicate episode idempotency is in `appendEpisode` at `memory-store.ts:116`; tests cover duplicate source/evidence merge at `runtime-memory-store.test.ts:14`. | pass |
| Fact proposal/promotion remains default-off and proposal-only unless verified | Proposal helper is disabled unless both flags are true at `memory-proposal-shadow.ts:102`; accepted facts require promotion evidence at `memory-context.ts:528` and `memory-context.ts:570`; proposal result emits no accepted facts at `memory-proposal-shadow.ts:129`. | pass |
| RuntimeMemoryProvider is readonly and budgeted | Provider flag fallback is at `memory-context-provider.ts:94`; provider result is readonly at `memory-context-provider.ts:180`; tests prove token budgets and no source-body leak at `runtime-memory-context-provider.test.ts:253`. | pass |
| Validation/docs/synthesis evidence is complete | Fresh harness context/validate, focused tests, typecheck, scans, and comms replay/compare all passed in synthesis validation. | pass |

## Rejected Boundary Audit

| Rejected Surface | Evidence | Result |
|---|---|---|
| Raw chat-log/transcript memory | `rejectRawRuntimeMemoryInput` and `sanitizeRuntimeMemoryText` reject raw shapes at `memory-context.ts:710`; tests reject chat/transcript fixtures at `runtime-memory-context-contracts.test.ts:239` and store append rejects raw chat at `runtime-memory-store.test.ts:97`. Raw-retention scan matches only sanitizer denylist/test fixtures. | pass |
| Raw trace-dump memory or trace facts promoted without verification | Raw trace fixtures are rejected at `runtime-memory-context-contracts.test.ts:239` and `runtime-memory-proposal-shadow.test.ts:105`; accepted facts require promotion evidence and proposal emits candidates only. | pass |
| Unverified durable facts | `isRuntimeMemoryTemporalFact` requires accepted verification status plus non-empty promotion evidence at `memory-context.ts:570`; store default query rejects candidate/provenance shapes via `queryAllowsFactShape` at `memory-store.ts:487`; proposal emits `acceptedFacts: []`. | pass |
| Default-on memory recording/provider/persistence/extraction/promotion/provider-ordering cutover | Flags default false; provider disabled fallback at `memory-context-provider.ts:94`; default registry contains only legacy and loop providers unless extras are supplied at `provider-registry.ts:252`; registry test covers default exclusion at `runtime-memory-context-provider.test.ts:32`. | pass |
| Full memory dump to prompt/UI | Provider converts summary items to context items at `memory-context-provider.ts:333`; metadata marks `noMemoryDump` at `memory-context-provider.ts:156`; tests ensure source bodies do not leak at `runtime-memory-context-provider.test.ts:100` and `runtime-memory-context-provider.test.ts:253`. | pass |
| Raw prompt/full payload/full checkpoint/full tool args/output/env/secrets/unbounded output retention | Raw-retention scan over Phase 7 code/tests matched only denylist/classifier code and negative fixtures. Store/proposal/provider production files had no raw-retention matches. | pass |
| External telemetry, OTLP, collector, observability platform, graph database service, listener, or second Gateway/runtime | Touched-file service/exporter scan over Phase 7 code/tests had no matches. Broad matches are existing OAuth/Gateway/test/plugin infrastructure, not Phase 7 memory additions. | pass |
| Persistence/database service | Persistence scan for fs/sqlite/kysely/storage APIs over Phase 7 production files had no matches. `RuntimeMemoryStore` is in-memory only and not exported from `runtime-core/index.ts`. | pass |
| Memory-derived completion, verifier, security, retry, tool permission, or runtime authority | Provider permission reason says no completion/verifier/tool/retry/security/runtime authority at `memory-context-provider.ts:60`; metadata repeats no-authority flags at `memory-context-provider.ts:156`. Authority scan only found those declarations. | pass |

## Temporal Memory Evidence

| Requirement | Evidence | Status |
|---|---|---|
| Duplicate episode writes are idempotent | `appendEpisode` merges duplicate idempotency-key refs at `memory-store.ts:116`; contract and store tests cover duplicate behavior at `runtime-memory-context-contracts.test.ts:309` and `runtime-memory-store.test.ts:14`. | pass |
| Current-valid query excludes invalidated/expired/rejected/unverified facts | `isRuntimeMemoryFactValidAt` excludes invalidated and expired facts unless explicitly included at `memory-context.ts:900`; `matchesVerification` excludes candidates/rejected/invalidated unless explicitly requested at `memory-context.ts:1176`; store query shape filtering excludes unpromoted candidates by default at `memory-store.ts:487`; tests prove default output only returns `fact_current` at `runtime-memory-store.test.ts:239`. | pass |
| Historical query returns facts valid at requested time | Store tests query old/new facts at historical times without mutating truth at `runtime-memory-store.test.ts:126`; provider labels historical context with `time_scope=historical` at `runtime-memory-context-provider.test.ts:170`. | pass |
| Conflicting facts create invalidation/proposal records | Store applies invalidations as additive query-time views at `memory-store.ts:300`; proposal shadow creates candidate invalidation proposals without mutating accepted facts at `memory-proposal-shadow.ts:186`; tests cover both at `runtime-memory-store.test.ts:126` and `runtime-memory-proposal-shadow.test.ts:144`. | pass |
| Durable facts cite source episode/evidence refs | Type guards require non-empty `sourceEpisodeRefs` and `evidenceRefs` at `memory-context.ts:544`; accepted fact guard also requires non-empty promotion evidence at `memory-context.ts:528`; tests assert episode/evidence linkage at `runtime-memory-context-contracts.test.ts:154`. | pass |
| Source refs do not replace verifier evidence | Source episode refs and evidence refs are distinct fields in contracts at `memory-context.ts:149` and `memory-context.ts:178`; summary output carries both at `memory-context.ts:1222`; tests assert both source episode ids and evidence refs in summaries at `runtime-memory-context-contracts.test.ts:475`. | pass |
| Summary respects token budget | `summarizeRuntimeMemoryFacts` enforces `tokenBudget` at `memory-context.ts:964`; store/provider tests verify estimated tokens stay within budget at `runtime-memory-store.test.ts:332` and `runtime-memory-context-provider.test.ts:253`. | pass |

## Legacy Paths Wrapped

| Legacy Path | Memory Adapter | Feature Flag | Parity Evidence |
|---|---|---|---|
| TaskLoop completion | none | n/a | No Phase 7 TaskLoop changes; focused scans found no TaskLoop/runtime authority hooks in memory files. |
| `tools.invoke` / Gateway communication | none | n/a | No Gateway/Main/renderer communication files touched by Phase 7 memory surfaces; comms replay/compare passed due dirty shared worktree. |
| Evidence Verifier | evidence refs only | n/a | Facts cite verifier/human/deterministic promotion evidence but do not call or replace verifier decisions. |
| Trace Context Provider | source refs only | n/a | Trace summaries can be source refs/candidates; raw trace dumps are rejected and not durable by default. |
| Context provider registry | optional extra provider only | `runtime.memory.provider` | Default registry creates legacy + loop providers only at `provider-registry.ts:252`; memory appears only when explicitly passed in tests. |

## Feature Flags

| Flag | Default | Evidence | Rollback |
|---|---|---|---|
| `runtime.memory.shadow` | false | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` at `memory-context.ts:129`. | Leave false; no legacy path depends on it. |
| `runtime.memory.provider` | false | Flag parser default plus provider fallback at `memory-context-provider.ts:94`. | Leave false or omit provider factory registration. |
| `runtime.memory.proposeFacts` | false | Proposal helper disabled unless `shadow && proposeFacts` at `memory-proposal-shadow.ts:102`. | Leave false; no candidates/invalidation proposals are emitted. |
| `runtime.memory.persist` | false | Default flag only; no persistence implementation. | Leave false; persistence remains blocked pending fresh cutover spec. |

## Validation Evidence

| Command / Test | Result | Covers | Gaps |
|---|---|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Harness context and read order. | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md` | pass | Phase 7 task spec. | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/scenarios/gateway-backend-communication.md` | pass | Referenced scenario. | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/context-provider-registry.test.ts` | pass, 5 files / 31 tests | Contracts, store, proposal, provider, registry ordering. | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node/runtime TypeScript. | none |
| Renderer IPC/Gateway bypass scan over `src/pages src/components` | pass/no matches | No direct renderer IPC/Gateway/WebSocket bypass. | none |
| Touched-file service/exporter scan over Phase 7 code/tests | pass/no matches | No service/listener/exporter/collector additions in memory files. | none |
| Persistence scan over Phase 7 production files | pass/no matches | No fs/sqlite/kysely/storage persistence in Phase 7 memory files. | none |
| Raw-retention scan over Phase 7 code/tests | reviewed/pass | Matches are sanitizer denylist/classifier and negative tests only. | none |
| Broad service/exporter scan over `openclaw_runtime/src electron shared tests/unit` | reviewed | Matches are existing non-Phase-7 infrastructure. | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/replay.mjs` | pass | Communication replay, run due dirty shared Main/Gateway paths. | none |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/comms/compare.mjs` | pass | Communication baseline compare, run due dirty shared Main/Gateway paths. | none |

## Behavior Change Audit

| Focus | Result |
|---|---|
| No default-on memory recording/provider/persistence/extraction/promotion | pass |
| Runtime memory code inside allowed paths | pass |
| Legacy behavior unchanged with flags off | pass |
| No raw chat-log/raw trace memory | pass |
| No observability platform/collector/exporter/database service | pass |
| No raw prompt/full payload/full memory dump retention | pass |
| Automatic extraction remains proposal-only | pass |
| Memory provider remains readonly/non-gating | pass |
| Renderer direct IPC / Gateway HTTP bypass | pass |
| UI changes have E2E/i18n | not applicable; no UI behavior added |

## Contract / Naming Conflicts

| Conflict | Evidence | Required Resolution |
|---|---|---|
| Lane D initially lacked a valid `Status:` line | Lane E recorded a doc-only status fix and reran validation. Current status scan shows exactly one accepted status for A-E. | Resolved by Lane E; no runtime change. |
| Broad scans include existing service/exporter/raw-memory terms | Broad service/raw scans hit existing OAuth, Gateway, plugin collector, transcript, stdout/stderr, and test infrastructure. | Classified as non-Phase-7 unless in Phase 7 touched files. |
| Future persistence/provider-ordering cutover remains tempting | Phase 7 evidence proves foundation only; no rollback/migration/default-ordering cutover spec exists. | Keep blocked until a fresh cutover spec and rollback/retention/migration evidence exist. |

## Ready For Next Phase?

Yes, for the next planning phase that consumes this default-off foundation.

No, for provider-ordering cutover, persistence cutover, default-on memory recording, default-on provider injection, raw transcript import, raw trace memory, or durable LLM fact promotion. Those remain blocked until a fresh cutover spec proves retention, redaction, migration, rollback, default-off parity, and owner boundaries.

## Future Cutover Criteria

| Criterion | Evidence | Status |
|---|---|---|
| Memory facts are evidence-backed and not raw chat/trace text | Contracts/tests/scans prove this for the Phase 7 foundation. | pass |
| Unverified extraction remains proposal-only | Proposal helper returns candidates and `acceptedFacts: []`; durable fact guard requires promotion evidence. | pass |
| Local store is bounded, redacted, idempotent, and rollback-ready | In-memory store tests cover bounds, redaction, idempotency, invalidation, and clone isolation. | pass for in-memory foundation |
| Persistence has retention/redaction/migration/rollback proof | No persistence added. | blocked |
| Current-valid and historical queries handle invalidation correctly | Store/provider tests cover current/historical invalidation behavior. | pass |
| Memory provider output is budgeted context, not raw dumps | Provider tests cover budget and source-body non-leakage. | pass |
| Fresh cutover spec exists before default-on behavior | No cutover spec exists in Phase 7. | blocked |

## Required Fixes Before Next Phase

None for accepting Phase 7's default-off foundation.

Required before any cutover:

1. Add a fresh cutover task spec for persistence, provider-ordering, or default-on behavior.
2. Prove retention/redaction/migration/rollback before persistence.
3. Prove default registry ordering changes and rollback before provider injection.
4. Keep LLM extraction proposal-only unless promotion has verifier, human, or deterministic-rule evidence.

## agent-runtime-index.md Updates Applied

```text
Runtime Memory Provider:
  code: openclaw_runtime/src/runtime-core/memory-context.ts; openclaw_runtime/src/runtime-core/memory-store.ts; openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts; openclaw_runtime/src/context-engine/memory-context-provider.ts; openclaw_runtime/src/runtime-core/index.ts
  tests: tests/unit/runtime-memory-context-contracts.test.ts; tests/unit/runtime-memory-store.test.ts; tests/unit/runtime-memory-proposal-shadow.test.ts; tests/unit/runtime-memory-context-provider.test.ts; tests/unit/context-provider-registry.test.ts
  status: accepted_phase_7_runtime_memory_provider_shadow_readonly_proposal_only; no persistence/default-on/provider-ordering cutover
```
