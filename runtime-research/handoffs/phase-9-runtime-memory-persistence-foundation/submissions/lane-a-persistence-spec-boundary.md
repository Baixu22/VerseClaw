# Phase 9 Lane A: Persistence Spec Boundary

## Scope Confirmation

- Lane: `lane-a-persistence-spec-boundary`
- Output file: `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-a-persistence-spec-boundary.md`
- Files reviewed:
  - `AGENTS.md`
  - `C:\Users\27933\.codex\RTK.md`
  - `openclaw_runtime/AGENTS.md`
  - `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md`
  - `runtime-research/agent-runtime-index.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/README.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/parallel-lanes.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/window-prompts.md`
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submission-template.md`
  - `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/synthesis.md`
  - `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-f-config-flag-schema-parity.md`
  - `openclaw_runtime/src/runtime-core/memory-context.ts`
  - `openclaw_runtime/src/runtime-core/memory-store.ts`
  - `openclaw_runtime/src/context-engine/memory-context-provider.ts`
  - `openclaw_runtime/src/config/types.openclaw.ts`
  - `openclaw_runtime/src/config/zod-schema.ts`
  - `harness/specs/scenarios/gateway-backend-communication.md`
  - `harness/specs/rules/backend-communication-boundary.md`
  - `harness/specs/rules/renderer-main-boundary.md`
  - `harness/specs/rules/comms-regression.md`
- Files changed:
  - `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/submissions/lane-a-persistence-spec-boundary.md`
- Runtime behavior changed: no
- Main/Gateway/host-api/api-client paths changed: no

## Executive Summary

Phase 9 may proceed from Lane A into Lane B/C/D, but only as a default-off local sanitized persistence proof. Lane A does not accept runtime cutover, provider-ordering cutover, default-on memory, automatic fact promotion, service/exporter/database-service work, raw retention, or memory-derived runtime authority.

The minimum acceptable Phase 9 foundation is a local OpenClaw runtime-owned durable backing for existing sanitized Runtime Memory contracts. It must preserve the current in-memory `RuntimeMemoryStore` semantics for schema validation, sanitization, idempotency, retention limits, invalidation, and current-valid queries, and it must remain inert when `runtime.memory.persist` is false.

## Phase 9 Minimum Persistence Foundation

| Requirement | Lane A boundary |
|---|---|
| Local store owner | The owner must be `openclaw_runtime` runtime-core memory persistence. It may wrap or hydrate the existing `RuntimeMemoryStore` contract, but it must not be owned by renderer, Gateway transport, provider ordering, a plugin, an exporter, a listener, or a new service. If durable storage is implemented, it must be local OpenClaw-owned state storage, not raw JSONL transcript import or an external database service. |
| Schema shape | Persist only versioned records equivalent to `RuntimeMemoryEpisodeRecord`, `RuntimeMemoryTemporalFact`, `RuntimeMemoryTemporalFactCandidate`, and `RuntimeMemoryInvalidationProposal`. A minimal durable schema has separate logical collections for `episodes`, `facts`, and `invalidations`, each carrying `schemaVersion: 1`, stable ids, source/evidence refs, temporal fields, sanitized metadata, and a write timestamp/sequence for retention. |
| Retained episode fields | `schemaVersion`, `episodeId`, `taskId`, `kind`, `reference_time`, `idempotencyKey`, `boundedSummary`, bounded sanitized `sourceRefs`, bounded sanitized `evidenceRefs`, sanitized `metadata`, and `redactionStatus: "sanitized"`. |
| Retained fact fields | `schemaVersion`, `factId`, optional `taskId`, `subject`, `predicate`, `objectSummary`, `confidence`, `source`, `verificationStatus`, `valid_at`, optional `invalid_at`, optional `expired_at`, `reference_time`, `sourceEpisodeRefs`, `evidenceRefs`, sanitized `metadata`, and either `proposedAt` for candidates or `acceptedAt` plus `promotion` for durable facts. |
| Retained invalidation fields | `schemaVersion`, `invalidationId`, `factId`, `reason`, `invalid_at`, `reference_time`, `proposedBy`, `verificationStatus`, `sourceEpisodeRefs`, `evidenceRefs`, optional `replacementFactId`, and sanitized `metadata`. |
| Redacted fields | Sensitive metadata keys and values matching existing memory sanitizers must be redacted or rejected before storage: raw chat/chatLog, transcript/jsonl, raw trace/traceparent, prompt, payload, tool args, tool output/stdout/stderr, process/env, secrets/tokens/api keys/auth/passwords, baggage, and tracestate. |
| Rejected fields | Raw chat logs, raw transcripts, raw trace dumps, prompts, full payloads, full checkpoints, full tool args, full tool output, env, secrets, raw trace context, unbounded source bodies, provider prompt dumps, raw runtime traces, and raw checkpoint snapshots are not persistence inputs. |
| Retention limits | The default minimum must be no larger than current in-memory defaults: 256 episodes, 512 facts, and 256 invalidations unless a later lane proves stricter local bounds. Retention must trim oldest records deterministically and preserve current-valid query semantics after trim. |
| Invalidation behavior | Invalidation records are append-only proposals until accepted verification status is present. Accepted invalidations set or preserve the earliest `invalid_at` for a fact; default current-valid queries exclude invalidated and expired facts unless the query explicitly includes them. Rollback must not delete user data by default. |
| Idempotency key strategy | Episodes dedupe by `idempotencyKey` first and `episodeId` second, merging source/evidence refs without duplicating them. Facts dedupe by `factId`; invalidations dedupe by `invalidationId`. Persistent writes must be replay-safe across restart and migration. |
| Migration path | Migration must be explicit and versioned. It may create the local memory persistence schema and import only already-sanitized records that pass the current validators/sanitizers. It must reject raw transcripts, raw traces, prompts, payloads, tool args/output, env, secrets, and unverified durable facts. |
| Rollback path | Setting `runtime.memory.persist` false must stop new durable writes and keep existing TaskLoop, tools.invoke, approvals, retries, error mapping, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider readonly behavior, and provider ordering unchanged. Existing persisted memory data must be preserved unless a later explicit doctor/migration policy authorizes deletion. |
| Flag-off parity proof | Lane B/C/D must prove that with `runtime.memory.persist: false`, no persistence reads or writes occur and current default behavior matches Phase 8/Phase 7. Passing config parse is not enough; tests or scans must prove runtime paths remain inert. |
| No runtime authority proof | Persisted memory and memory provider output must remain readonly context/proposal data only. It must not become completion authority, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, provider ordering authority, or any other runtime authority. |

## Explicit Rejections

- Default-on memory recording, persistence, provider injection, provider ordering cutover, fact extraction, fact promotion, or prompt memory dump.
- Raw chat, transcript, trace, prompt, full payload, checkpoint, tool args, tool output, env, secret, raw traceparent, tracestate, or baggage retention.
- LLM-extracted or candidate facts becoming durable facts without verifier-backed evidence, human approval, or accepted deterministic-rule evidence.
- A service, exporter, database service, listener, daemon, HTTP server, WebSocket server, Temporal service, second Gateway, second runtime service, OTLP exporter, collector, external telemetry, or graph database.
- Provider ordering cutover or default RuntimeMemoryProvider registration changes without separate parity evidence and synthesis acceptance.
- Memory-derived completion, verifier, security, retry, tool, runtime, provider ordering, or policy authority.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Phase 9 is allowed to start only as default-off sanitized persistence foundation. | file | `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | task intent / featureFlags / forbiddenPatterns | Spec requires `runtime.memory.persist` default false and rejects raw retention, services/exporters, provider-ordering cutover, and authority. |
| Phase 8 did not accept persistence cutover. | file | `runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/synthesis.md` | Decision, Ready For Cutover | Synthesis says Phase 8 is docs/evidence-only and no runtime cutover is ready. |
| Config surface is a reserved default-off gate only. | file | `openclaw_runtime/src/config/types.openclaw.ts` | runtime memory fields around `memory.persist` | Comment states `persist` is reserved default-off and Phase 9 persistence is not implemented there. |
| Runtime memory flags default false. | file | `openclaw_runtime/src/runtime-core/memory-context.ts` | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` | `shadow`, `provider`, `proposeFacts`, and `persist` are false. |
| Existing sanitized episode/fact/invalidation schema is the only acceptable source contract. | file | `openclaw_runtime/src/runtime-core/memory-context.ts` | `RuntimeMemoryEpisodeRecord`, `RuntimeMemoryTemporalFactCandidate`, `RuntimeMemoryTemporalFact`, `RuntimeMemoryInvalidationProposal` | Lane B/C/D must persist these shapes or a strictly equivalent versioned local durable schema. |
| Existing store owner semantics are local and bounded. | file | `openclaw_runtime/src/runtime-core/memory-store.ts` | `RuntimeMemoryStore`, `DEFAULT_MAX_EPISODES`, `DEFAULT_MAX_FACTS`, `DEFAULT_MAX_INVALIDATIONS` | Current store is in-memory, bounded at 256/512/256, sanitizes inputs, dedupes, and trims. |
| Raw retention is rejected by current memory contracts. | file/scan | `rg -n "rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate" ...` | reviewed matches | Matches in memory code are denylist/rejection logic; config matches are pre-existing unrelated secret/transcript config surfaces. |
| RuntimeMemoryProvider is not default-on or authoritative. | file | `openclaw_runtime/src/context-engine/memory-context-provider.ts` | `enabledByDefault: false`; `noCompletionAuthority`, `noVerifierAuthority`, `noRuntimeAuthority` metadata | Provider is readonly/shadow-only and explicitly non-authoritative. |
| Renderer/Gateway direct bypass is not part of this lane. | scan | `rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components` | no matches / exit 1 | No renderer bypass matches in scanned page/component paths. |
| Service/exporter/listener additions are not present in Lane A docs/code surface. | scan | `rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\\(" ...` | reviewed matches | Only Phase 9 README forbidden-language match; no implementation service/exporter/listener addition. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | `memory-context.ts` default flags; Phase 8 synthesis; `corepack pnpm harness validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass for spec boundary | Lane B/C/D must add implementation-level no-read/no-write proof if code changes. |
| Store owner and schema | This submission; `memory-context.ts`; `memory-store.ts` | pass for boundary | No durable code implemented in Lane A. |
| Migration and idempotency | This submission; `RuntimeMemoryStore.appendEpisode`, `appendFact`, `invalidateFact` semantics | pass for boundary | Lane B must prove durable replay/migration behavior. |
| Retention and redaction | `memory-store.ts` defaults and trimmers; `memory-context.ts` sanitizers | pass for boundary | Lane C must prove persistence respects equal or stricter bounds. |
| Raw chat/raw trace rejection | `memory-context.ts` raw rejection patterns; raw-retention scan | pass | Matches are denylist/rejection or pre-existing unrelated config surfaces. |
| No raw retention | Phase 9 spec forbidden patterns; raw-retention scan | pass for docs boundary | Lane B/C must prove writes cannot store raw fields. |
| No service/exporter/database/listener | service/exporter scan | pass | One README match is a forbidden-boundary statement. |
| Source episode/evidence refs | `RuntimeMemoryEpisodeRecord`, `RuntimeMemoryTemporalFactCandidate`, `RuntimeMemoryTemporalFact`, `RuntimeMemoryInvalidationProposal` | pass for boundary | Lane B/C/D must prove persisted records retain refs. |
| Durable promotion gate | `RuntimeMemoryTemporalFact` requires accepted status plus `promotion`; Phase 8 synthesis | pass for boundary | Lane D must prove candidates/LLM proposals remain unpromoted by persistence. |
| Current-valid query exclusion | `findRuntimeMemoryFacts`, `matchesVerification`, `isRuntimeMemoryFactValidAt`, `RuntimeMemoryStore.factsWithInvalidations` | pass for boundary | Lane D must run focused tests if query behavior changes. |
| Rollback proof | Phase 9 spec rollback section; this submission | pass for boundary | Lane B/C/D must prove stop-new-writes behavior when `persist` is false. |
| Comms replay/compare if required | No Main/Gateway/host-api/api-client files changed | not applicable | Lane A is docs-only; comms replay/compare not required. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` keeps all runtime memory flags false; provider manifest has `enabledByDefault: false`. |
| No raw chat-log/raw trace memory | pass | `memory-context.ts` rejects raw chat/transcript/trace/prompt/payload/tool/env/secret markers; Lane A adds no persistence code. |
| No unverified durable facts | pass | Durable `RuntimeMemoryTemporalFact` requires accepted verification status plus promotion evidence; candidates remain separate. |
| No persistence without owner/schema/migration/rollback proof | pass | This boundary defines the required owner/schema/migration/rollback proof; no implementation is accepted by Lane A. |
| No provider-ordering cutover without parity proof | pass | Lane A changes no provider registration or ordering and rejects provider ordering cutover. |
| No runtime authority | pass | Provider metadata marks no completion/verifier/security/retry/tool/runtime authority; this submission preserves that boundary. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `rtk pnpm harness context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | blocked by environment | Attempted required command through RTK | `rtk` is not on this PowerShell PATH. |
| `pnpm harness context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | failed before harness | Required command attempted exactly | Bare `pnpm` triggered ignored-builds install gate before harness; matches prior Lane F environment note. |
| `pnpm harness validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | failed before harness | Required command attempted exactly | Same ignored-builds install gate. |
| `pnpm harness validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md` | failed before harness | Required command attempted exactly | Same ignored-builds install gate. |
| `corepack pnpm harness context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 context/read list | PowerShell profile emits unrelated `starship` warning. |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 task spec validity | PowerShell profile emits unrelated `starship` warning. |
| `corepack pnpm harness validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md` | pass | Phase 8 prerequisite validity | PowerShell profile emits unrelated `starship` warning. |
| `rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components` | pass/no matches | Renderer boundary | `rg` exit 1 means no matches. |
| `rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\\(" ...` | pass/reviewed | No service/exporter/listener in Lane A surface | One match is README forbidden-boundary language. |
| `rg -n "rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate" ...` | pass/reviewed | Raw retention boundary | Memory matches are rejection/sanitizer logic; config matches are pre-existing unrelated config surfaces. |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| Phase 8 readiness could be misread as persistence cutover permission. | Phase 8 synthesis says no runtime cutover is ready and Phase 9 may start Lane A only. | Lane B/C/D may proceed only after this accepted boundary and only with default-off local sanitized persistence proof. |
| `runtime.memory.persist` exists in config but persistence is not implemented. | Lane F says `persist` is only a default-off formal config gate. | Treat the flag as authorization for future proof only; do not claim persistence exists from schema parity. |
| Durable local storage could drift into raw transcript/chat memory. | Existing raw rejection patterns and Phase 9 forbidden patterns reject raw transcript/jsonl/chat/trace/prompt/payload/tool/env/secret inputs. | Persist only sanitized bounded episode/fact/invalidation records that pass validators and sanitizers. |
| Persistence could become provider/runtime authority. | RuntimeMemoryProvider metadata is readonly/no-authority and Phase 9 spec forbids memory-derived authority. | Persisted memory may feed readonly context only under explicit provider flag and must not affect tools, retries, security, verifier, completion, or runtime policy. |

## Lane A Decision

Status: accepted

Ready for Lane B/C/D: yes

Lane B/C/D may proceed only as default-off local sanitized persistence proof, not default-on cutover. They must independently prove store owner/schema, retained/redacted/rejected fields, retention, invalidation, idempotency, migration, rollback, flag-off parity, no raw retention, no service/exporter/database/listener, no provider ordering cutover, no unverified durable facts, and no runtime authority before Phase 9 synthesis can accept any implementation claim.
