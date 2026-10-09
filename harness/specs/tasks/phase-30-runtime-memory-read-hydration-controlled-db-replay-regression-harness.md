---
id: phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness
title: Phase 30 runtime memory read hydration controlled DB replay regression harness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Promote the Phase 29 controlled temporary Runtime Memory SQLite DB proof into a focused replay regression harness with multiple controlled DB scenarios, fixed thresholds, and baseline / naive / guarded metrics, without default runtime cutover, TaskLoop integration, prompt/context/model-message injection, durable fact authority, or runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness.md
  - runtime-research/handoffs/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness/**
  - tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts
touchedAreas:
  - harness/specs/tasks/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness.md
  - runtime-research/handoffs/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness/**
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts
  - tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts
expectedUserBehavior:
  - Default runtime behavior is unchanged; Phase 30 adds no product/UI/Gateway/provider/TaskLoop read path and no runtime cutover.
  - The replay harness creates only test-owned temporary Runtime Memory SQLite DBs and does not read or write user data sources.
  - Runtime Memory DB access happens only in test setup through existing persistence helpers and in the existing explicit read-hydration shadow helper.
  - The Phase 28 guarded consumer remains a pure function over sanitized hydration fact projections plus explicit queries.
  - The replay harness compares baseline no memory, naive hydration, and guarded opt-in consumer on multiple sanitized DB projections.
  - Metrics include recall@k, precision, stale/invalid suppression, candidate/rejected suppression, conflict suppression, raw leak rate, prompt injection return rate, latency overhead, token overhead, failure/no-op rate, scenario pass/fail count, aggregate pass/fail count, and threshold violations.
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
  - treating Phase 29 controlled DB success as permission for default runtime read hydration cutover
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - provider registry/provider ordering cutover, RuntimeMemoryProvider default registration, TaskLoop default memory reads, TaskLoop integration, or automatic fact extraction/promotion
  - hydration facts entering default prompt assembly, context provider output, model messages, Gateway/provider transport payloads, runtime decisions, checkpoints, or transcript material
  - consumer opening, reading, creating, migrating, or writing SQLite databases, calling persistence helpers, calling TaskLoop, provider, Gateway, IPC, host-api, api-client, or any service/listener/daemon/server
  - new production helper, route, IPC channel, shared contract, renderer UI, host-api/api-client method, TaskLoop default invocation, prompt/context/model-message injection, or runtime feature default
  - reading or writing user Runtime Memory databases; only temporary test databases created by the focused unit test are allowed
  - creating or implying durable fact authority, runtime authority, prompt authority, provider ordering authority, fact acceptance, fact promotion, episode write authority, invalidation acceptance, or memory store mutation authority
  - accepting facts when `recordKind !== "fact"`, `verificationStatus !== "verified"`, `valid_at > referenceTime`, `invalid_at <= referenceTime`, `expired_at <= referenceTime`, subject/predicate/taskId mismatches, prompt-injection sentinel text, raw leak sentinel text, conflict suppression, token budget exhaustion, or result limit exhaustion apply
  - returning or emitting raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, `record_json`, raw rows, facts/candidates raw records, provider context, durable fact authority, or runtime authority markers
featureFlags:
  - No new runtime feature flag is added by Phase 30.
  - Existing Runtime Memory defaults remain false by omission.
  - Phase 30 replay regression is explicit test/research code only and does not enable `runtime.memory.persist`, `runtime.memory.shadow`, `runtime.memory.provider`, or `runtime.memory.proposeFacts` by default.
rollback:
  - Remove `tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts`.
  - Remove this Phase 30 spec and handoff package.
  - Keep Phase 21-29 helper, consumer, command, proof, mock evaluation, and controlled DB evaluation behavior unchanged.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 30 validate with `--no-diff` and record the blocker.
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'Gateway route|Electron IPC|renderer UI|host-api|api-client|shared contract|TaskLoop default|prompt injection|model-message|context injection|runtime authority|durable fact authority|DB write authority|mutation authority' openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts harness/specs/tasks/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern 'migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows|insertInto|updateTable|deleteFrom|DatabaseSync|node:sqlite|readRuntimeMemoryHydrationShadow|hydrateRuntimeMemoryShadowContext' openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
acceptance:
  - Phase 30 starts only after AGENTS, scoped runtime AGENTS, Phase 28 task/deep-validation, Phase 29 task/deep-validation, existing hydration shadow helper, Phase 28 consumer, persistence, and related tests are read.
  - Phase 30 creates a fresh task spec and handoff and does not extend Phase 29 into product runtime cutover.
  - The focused unit test creates multiple temporary SQLite Runtime Memory DB replay scenarios through existing persistence fixtures/helpers, writes sanitized episodes/facts/candidates/invalidations, and reads sanitized projections through explicit `readRuntimeMemoryHydrationShadow`.
  - The replay corpus covers Phase 29 parity, taskId isolation, subject/predicate mismatch, multilingual preference changes, expired facts, invalidated facts plus persisted invalidation rows, future-valid facts, candidate facts, rejected facts, human_approved/deterministic_rule verification mismatch, conflict facts, prompt-injection sentinel, raw-leak sentinel without raw row mutation, zero token budget, zero result limit, empty no-op, projection limit/truncation behavior, and large source/evidence refs.
  - The replay harness proves baseline remains negative, naive remains a negative control with lower precision and nonzero hazardous returns, and guarded stays above all fixed thresholds.
  - The consumer remains pure with no database, TaskLoop, provider, Gateway, IPC, UI, host-api/api-client, shared contract, prompt/context/model-message, runtime authority, or durable fact authority side effects.
  - README sync review is recorded; README changes are required only if Phase 30 changes product behavior, UI, public runtime behavior, release-facing docs, or user workflows.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 30 Runtime Memory Read Hydration Controlled DB Replay Regression Harness

Phase 30 is an explicit replay regression harness only. It may add deterministic test-owned temporary SQLite DB replay scenarios and a deep-validation handoff. It is not a cutover, default-on behavior, runtime authority, durable fact authority, TaskLoop integration, Gateway route, Electron IPC route, renderer UI, host-api/api-client/shared contract, or prompt/context/model-message path.

Guarded threshold failures must fail the focused unit test directly. Baseline and naive remain negative controls; baseline must preserve no-memory recall/no-op behavior, and naive must preserve lower precision plus hazardous returns on the hazard replay corpus.
