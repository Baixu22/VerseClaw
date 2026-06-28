# Phase 8 Lane B: Persistence Retention Rollback

## Scope Confirmation

- Lane: lane-b-persistence-retention-rollback
- Output file: runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-b-persistence-retention-rollback.md
- Files reviewed: runtime-research/handoffs/phase-7-runtime-memory-provider/synthesis.md; runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/README.md; runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/parallel-lanes.md; harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md; openclaw_runtime/src/runtime-core/memory-context.ts; openclaw_runtime/src/runtime-core/memory-store.ts; openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts; openclaw_runtime/src/context-engine/memory-context-provider.ts; tests/unit/runtime-memory-context-contracts.test.ts; tests/unit/runtime-memory-store.test.ts; tests/unit/runtime-memory-proposal-shadow.test.ts
- Files changed: runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/submissions/lane-b-persistence-retention-rollback.md
- Runtime behavior changed: no
- Main/Gateway/host-api/api-client paths changed: no

## Executive Summary

Lane B accepts a design-only persistence readiness boundary. It does not accept persistence cutover or add a persistent store. A future implementation must keep runtime.memory.persist default false, store only sanitized episode/fact records, use an existing runtime-owned local SQLite/state owner rather than a service, and prove rollback by disabling writes/reads without changing legacy runtime behavior.

## Persistence Readiness Design

| Area | Required Future Shape | Evidence / Constraint |
|---|---|---|
| Store owner | Runtime-core memory owner around RuntimeMemoryStore; persistent adapter must be a local implementation detail, not a service/exporter/listener. | RuntimeMemoryStore is explicit/local at openclaw_runtime/src/runtime-core/memory-store.ts:92; Phase 8 forbids service/database-service additions at README lines 33 and 42. |
| Feature gate | runtime.memory.persist remains false by default; future persistence may run only when explicitly enabled. | DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS.persist is false at memory-context.ts:129-133. |
| Schema shape | Episode table/record: schemaVersion, episodeId, taskId, kind, reference_time, idempotencyKey, boundedSummary, sourceRefs, evidenceRefs, redactionStatus, sanitized metadata. Fact table/record: factId, taskId, subject, predicate, objectSummary, confidence, source, verificationStatus, valid_at, invalid_at, expired_at, reference_time, sourceEpisodeRefs, evidenceRefs, acceptedAt, promotion. Invalidation table/record: invalidationId, factId, reason, invalid_at, reference_time, proposedBy, verificationStatus, sourceEpisodeRefs, evidenceRefs, replacementFactId. | Contract fields at memory-context.ts:157-207 and invalidation fields at memory-context.ts:210-226. |
| Retained fields | Bounded summaries, ids, source/evidence refs, verification state, temporal timestamps, redaction status, and sanitized metadata. | Sanitization paths at memory-context.ts:742-861; summary output preserves refs at memory-context.ts:1238-1241. |
| Redacted or rejected fields | Raw chat logs, transcripts/jsonl, raw traces, prompts, full payload/checkpoint/tool args/tool output/stdout/stderr, env, secrets, raw traceparent/tracestate/baggage. | Rejection tests at runtime-memory-context-contracts.test.ts:239-256 and redaction tests at lines 275-304. |
| Migration | No raw transcript/chat/trace import. First future migration should create empty persistent storage and optionally copy already-sanitized in-memory records through existing sanitizers. Any shipped user-state migration belongs to doctor/migration ownership before runtime steady state. | Phase 8 spec lines 48-54; root storage policy rejects JSON sidecars and runtime fallback readers. |
| Rollback | Disable runtime.memory.persist. Runtime continues with the existing in-memory RuntimeMemoryStore and ignores persisted rows; data remains local for future migration/doctor decisions but no reads/writes happen while the flag is false. | Phase 8 rollback lines 57-62; no runtime path changed in Lane B. |
| Idempotency | Duplicate episode writes must use idempotencyKey and merge source/evidence refs rather than duplicating records. | RuntimeMemoryStore.appendEpisode at memory-store.ts:116; tests at runtime-memory-store.test.ts:14-83. |
| Invalidation | Invalidation remains additive/query-time, not destructive overwriting. | RuntimeMemoryStore query/invalidation tests at runtime-memory-store.test.ts:126-235. |

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Current memory store is in-memory/local, not persistent | file | openclaw_runtime/src/runtime-core/memory-store.ts | class RuntimeMemoryStore at line 92 | No singleton or service boundary. |
| Persistence flag exists but is off | file/scan | openclaw_runtime/src/runtime-core/memory-context.ts | lines 118, 129-133, 699 | Persistence scan matched only the flag mapping/default/parser. |
| No persistence IO/database implementation exists in memory production files | scan | rtk rg persistence scan over memory-context.ts, memory-store.ts, memory-proposal-shadow.ts, memory-context-provider.ts | only persist flag matches | No writeFile/readFile/fs/sqlite/kysely/database/storage APIs in memory files. |
| No service/exporter/listener/database additions exist in memory production files | scan | focused service/exporter scan over Phase 7 memory production files | no matches | Clean scan for createServer/listen/WebSocketServer/OTLP/Collector/temporalio/sqlite/kysely/database/storage. |
| Raw retention is rejected/redacted before any future persistence | file/test | openclaw_runtime/src/runtime-core/memory-context.ts; tests/unit/runtime-memory-context-contracts.test.ts | memory-context.ts:710-742; test lines 239-304 | Raw shapes are rejected; sensitive metadata is redacted. |
| Store append rejects raw chat/tool-output records | test | tests/unit/runtime-memory-store.test.ts | lines 97-115 | Store-level guard blocks raw retention on append. |
| Current-valid queries exclude invalidated/expired/rejected/candidate/unpromoted by default | test | tests/unit/runtime-memory-store.test.ts | lines 239-329 | Persistence must preserve this default query behavior. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Flag-off parity | runtime.memory.persist false at memory-context.ts:129-133 | pass | Lane B is docs-only; no runtime reads/writes changed. |
| Raw chat/raw trace rejection | runtime-memory-context-contracts.test.ts:239-256 | pass | Future persistence must reuse these sanitizers. |
| No raw retention | raw-retention scan over Phase 7 memory code/tests | pass | Production matches are sanitizer denylist/rejection classifier; test matches are negative fixtures. |
| No service/exporter/database/listener | focused service/exporter scan over memory production files | pass | No matches. |
| Source episode/evidence refs | memory-context.ts:157-207; runtime-memory-context-contracts.test.ts:154-228 | pass | Required retained fields. |
| Durable promotion gate | memory-context.ts:570-583; runtime-memory-context-contracts.test.ts:229-236 | pass | Persistence must not weaken durable fact guard. |
| Current-valid query exclusion | memory-store.ts:487; runtime-memory-store.test.ts:239-329 | pass | Default query filters candidate/rejected/expired/unpromoted. |
| Rollback proof | Phase 8 spec rollback lines 57-62; Lane B design table | pass | Disable persist flag; no Lane B code to roll back. |
| Comms replay/compare if required | changed files list | not applicable | No Main/Gateway/host-api/api-client/provider transport files changed. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | persist remains false at memory-context.ts:133. |
| No raw chat-log/raw trace memory | pass | Rejection tests at runtime-memory-context-contracts.test.ts:239-256. |
| No unverified durable facts | pass | Durable guard requires accepted status and promotion evidence at memory-context.ts:570-583. |
| No persistence without rollback proof | pass | This lane provides design proof only and adds no persistence implementation. |
| No provider-ordering cutover without parity proof | not applicable | Lane B does not touch provider registration/order. |
| No runtime authority | pass | Lane B changes only this submission; no runtime authority path touched. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md | pass | Phase 8 read order | none |
| rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md | pass | Phase 8 spec | none |
| rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md | pass | Phase 7 prerequisite | none |
| rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/context-provider-registry.test.ts | pass, 5 files / 31 tests | Memory contracts/store/proposal/provider/registry | none |
| rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false | pass | Node/runtime types | none |
| rtk rg persistence scan over Phase 7 memory production files | pass/reviewed | No persistence APIs; only persist flag matches | none |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| Persistence is tempting but not accepted | Phase 7 synthesis blocks persistence without retention/redaction/migration/rollback proof | Keep runtime.memory.persist false; accept only this design boundary. |
| Root storage policy prefers SQLite for runtime state, but Phase 8 forbids a database service | AGENTS storage policy; Phase 8 README rejected boundary | Future persistence may use an existing local SQLite/state owner, not a new graph database service, daemon, listener, or exporter. |

## Status

```text
Status: accepted
```
