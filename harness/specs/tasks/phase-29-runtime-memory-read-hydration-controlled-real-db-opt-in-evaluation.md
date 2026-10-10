---
lifecycleStatus: archived
id: phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation
title: Phase 29 runtime memory read hydration controlled real DB opt-in evaluation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Evaluate Runtime Memory read hydration against a controlled temporary SQLite DB by explicitly reading sanitized projections through the existing shadow helper and reusing the Phase 28 pure guarded consumer, without default runtime cutover, TaskLoop integration, prompt/context/model-message injection, durable fact authority, or runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation.md
  - runtime-research/handoffs/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation/**
  - tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts
touchedAreas:
  - harness/specs/tasks/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation.md
  - runtime-research/handoffs/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation/**
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts
  - tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts
expectedUserBehavior:
  - Default runtime behavior is unchanged; Phase 29 adds no product/UI/Gateway/provider/TaskLoop read path and no runtime cutover.
  - The real DB evaluation creates only a test-owned temporary Runtime Memory SQLite DB and does not read or write user data sources.
  - Runtime Memory DB access happens only in test setup through existing persistence helpers and in the existing explicit read-hydration shadow helper.
  - The Phase 28 guarded consumer remains a pure function over sanitized hydration fact projections plus an explicit query.
  - Evaluation compares baseline no memory, naive hydration, and guarded opt-in consumer on sanitized projections read from the controlled DB.
  - Metrics include recall@k, precision, stale/invalid suppression, candidate/rejected suppression, conflict suppression, raw leak rate, prompt injection return rate, latency overhead, token overhead, and failure/no-op rate.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - treating Phase 28 guarded consumer success as permission for default runtime read hydration cutover
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - provider registry/provider ordering cutover, RuntimeMemoryProvider default registration, TaskLoop default memory reads, TaskLoop integration, or automatic fact extraction/promotion
  - hydration facts entering default prompt assembly, context provider output, model messages, Gateway/provider transport payloads, runtime decisions, checkpoints, or transcript material
  - consumer opening, reading, creating, migrating, or writing SQLite databases, calling persistence helpers, calling TaskLoop, provider, Gateway, IPC, host-api, api-client, or any service/listener/daemon/server
  - new production helper, route, IPC channel, shared contract, renderer UI, host-api/api-client method, TaskLoop default invocation, prompt/context/model-message injection, or runtime feature default
  - reading or writing user Runtime Memory databases; only a temporary test database created by the focused unit test is allowed
  - creating or implying durable fact authority, runtime authority, prompt authority, provider ordering authority, fact acceptance, fact promotion, episode write authority, invalidation acceptance, or memory store mutation authority
  - accepting facts when `recordKind !== "fact"`, `verificationStatus !== "verified"`, `valid_at > referenceTime`, `invalid_at <= referenceTime`, `expired_at <= referenceTime`, subject/predicate/taskId mismatches, prompt-injection sentinel text, raw leak sentinel text, conflict suppression, token budget exhaustion, or result limit exhaustion apply
  - returning or emitting raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, `record_json`, raw rows, facts/candidates raw records, provider context, durable fact authority, or runtime authority markers
featureFlags:
  - No new runtime feature flag is added by Phase 29.
  - Existing Runtime Memory defaults remain false by omission.
  - Phase 29 evaluation is explicit test/research code only and does not enable `runtime.memory.persist`, `runtime.memory.shadow`, `runtime.memory.provider`, or `runtime.memory.proposeFacts` by default.
rollback:
  - Remove `tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts`.
  - Remove this Phase 29 spec and handoff package.
  - Keep Phase 21-28 helper, consumer, command, proof, and mock evaluation behavior unchanged.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 29 validate with `--no-diff` and record the blocker.
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'Gateway route|Electron IPC|renderer UI|host-api|api-client|shared contract|TaskLoop default|prompt injection|model-message|context injection|runtime authority|durable fact authority|DB write authority|mutation authority' openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts harness/specs/tasks/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service|daemon' openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts harness/specs/tasks/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern 'migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows|insertInto|updateTable|deleteFrom|DatabaseSync|node:sqlite|readRuntimeMemoryHydrationShadow|hydrateRuntimeMemoryShadowContext' openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
acceptance:
  - Phase 29 starts only after AGENTS, scoped runtime AGENTS, Phase 28 task/deep-validation, Phase 27 synthesis, existing hydration shadow helper, Phase 28 consumer, persistence, and related tests are read.
  - Phase 29 creates a fresh task spec and handoff and does not extend Phase 28 into product runtime cutover.
  - The focused unit test creates a temporary SQLite Runtime Memory DB through existing persistence fixtures/helpers, writes sanitized episodes/facts/candidates/invalidations, and reads sanitized projections through explicit `readRuntimeMemoryHydrationShadow`.
  - The evaluation reuses the Phase 28 guarded consumer for the guarded arm and keeps the consumer pure with no database, TaskLoop, provider, Gateway, IPC, UI, or runtime side effects.
  - The corpus covers useful verified facts, expired, invalidated, future-valid, candidate, rejected, conflict, task/subject/predicate mismatch, prompt-injection sentinel, raw-leak sentinel, zero token budget, zero limit, and empty no-op.
  - Metrics prove whether guarded opt-in consumption is positive relative to baseline no memory and naive hydration on the controlled DB corpus, while preserving default-off/no-runtime-authority boundaries.
  - README sync review is recorded; README changes are required only if Phase 29 changes product behavior, UI, public runtime behavior, release-facing docs, or user workflows.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 29 Runtime Memory Read Hydration Controlled Real DB Opt-in Evaluation

Phase 29 is an explicit controlled real DB opt-in evaluation only. It may add a deterministic test-owned SQLite DB corpus and a deep-validation handoff. It is not a cutover, default-on behavior, runtime authority, durable fact authority, TaskLoop integration, Gateway route, Electron IPC route, renderer UI, host-api/api-client/shared contract, or prompt/context/model-message path.
