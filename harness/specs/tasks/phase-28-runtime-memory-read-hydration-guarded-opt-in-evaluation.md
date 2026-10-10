---
lifecycleStatus: archived
id: phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation
title: Phase 28 runtime memory read hydration guarded opt-in evaluation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add an explicit opt-in consumer evaluation for Runtime Memory read-hydration shadow output by introducing a pure guarded consumer over sanitized fact projections plus a fixed mock corpus comparison, without default runtime cutover, TaskLoop integration, prompt/context/model-message injection, durable fact authority, or runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation.md
  - runtime-research/handoffs/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation/**
  - openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
  - tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts
touchedAreas:
  - harness/specs/tasks/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation.md
  - runtime-research/handoffs/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation/**
  - openclaw_runtime/src/runtime-core/index.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/runtime-core/memory-store.ts
  - tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts
expectedUserBehavior:
  - Default runtime behavior is unchanged; Phase 28 adds no product/UI/Gateway/provider/TaskLoop read path and no runtime cutover.
  - The guarded consumer is a pure function over `RuntimeMemoryHydrationShadowFactProjection[]` plus an explicit query. It does not open, read, create, or write any database.
  - The guarded consumer returns accepted facts, rejected facts, and metrics only. It does not create runtime authority, durable fact authority, provider ordering input, TaskLoop decisions, prompt text, context items, or model messages.
  - Evaluation compares baseline no memory, naive hydration, and guarded opt-in consumer on a fixed mock corpus containing useful preferences and hazardous facts.
  - Metrics include recall@k, precision, stale/invalid suppression rate, raw leak rate, prompt injection return rate, latency overhead, token overhead, and failure/no-op rate.
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
  - treating Phase 27 accepted synthesis as permission for default runtime read hydration cutover
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - provider registry/provider ordering cutover, RuntimeMemoryProvider default registration, TaskLoop default memory reads, TaskLoop integration, or automatic fact extraction/promotion
  - hydration facts entering default prompt assembly, context provider output, model messages, Gateway/provider transport payloads, runtime decisions, checkpoints, or transcript material
  - consumer opening, reading, creating, migrating, or writing SQLite databases, calling persistence helpers, calling TaskLoop, provider, Gateway, IPC, host-api, api-client, or any service/listener/daemon/server
  - consumer creating or implying durable fact authority, runtime authority, prompt authority, provider ordering authority, fact acceptance, fact promotion, episode writes, invalidation acceptance, or memory store mutation
  - accepting facts when `recordKind !== "fact"`, `verificationStatus !== "verified"`, `valid_at > referenceTime`, `invalid_at <= referenceTime`, `expired_at <= referenceTime`, subject/predicate/taskId mismatches, prompt-injection sentinel text, raw leak sentinel text, or token budget exhaustion apply
  - returning or emitting raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, `record_json`, raw rows, facts/candidates raw records, provider context, durable fact authority, or runtime authority markers
featureFlags:
  - No new runtime feature flag is added by Phase 28.
  - Existing Runtime Memory defaults remain false by omission.
  - Phase 28 evaluation is explicit test/research code only and does not enable `runtime.memory.persist`, `runtime.memory.shadow`, `runtime.memory.provider`, or `runtime.memory.proposeFacts` by default.
rollback:
  - Remove `openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts` and its barrel export.
  - Remove `tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts`.
  - Remove this Phase 28 spec and handoff package.
  - Keep Phase 21-27 read-hydration helper/command/proof behavior unchanged.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 28 validate with `--no-diff` and record the blocker.
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service|daemon' openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts harness/specs/tasks/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation.md
  - node scripts/scan-pattern.mjs --pattern 'migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows|insertInto|updateTable|deleteFrom|DatabaseSync|node:sqlite|readRuntimeMemoryHydrationShadow|hydrateRuntimeMemoryShadowContext' openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
acceptance:
  - Phase 28 starts only after Phase 27 synthesis and deep validation are read and Phase 27 remains accepted as proof-only/no-invocation.
  - Phase 28 creates a fresh task spec and handoff and does not extend Phase 27 into product runtime cutover.
  - The consumer is a pure exported runtime-core helper that accepts only hydration fact projections and an explicit query, returns accepted/rejected facts plus metrics, and has no database, TaskLoop, provider, Gateway, IPC, UI, or runtime side effects.
  - Consumer guards reject non-facts, non-verified projections, future-valid facts, invalidated facts, expired facts, subject/predicate/taskId mismatches, prompt-injection sentinel text, raw leak sentinel text, and facts that would exceed the explicit token budget.
  - Fixed mock corpus evaluation proves whether guarded opt-in consumption is positive relative to baseline no memory and naive hydration, while preserving default-off/no-runtime-authority boundaries.
  - README sync review is recorded; README changes are required only if Phase 28 changes product behavior, UI, public runtime behavior, release-facing docs, or user workflows.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 28 Runtime Memory Read Hydration Guarded Opt-in Evaluation

Phase 28 is an explicit opt-in consumer evaluation only. It may add a pure guarded consumer and a deterministic mock-corpus evaluation. It is not a default runtime switch, does not connect TaskLoop, does not add Gateway/Electron/renderer/host-api/api-client/shared contract surfaces, and does not place hydration output into default prompts, context, or model messages.
