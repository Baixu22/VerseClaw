---
lifecycleStatus: archived
id: phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in
title: Phase 31 runtime memory read hydration TaskLoop shadow-only explicit opt-in
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add the smallest explicit TaskLoop test/research seam that can read sanitized Runtime Memory hydration projections from a controlled temporary SQLite DB and run the Phase 28 guarded consumer as readonly shadow diagnostics, without default TaskLoop read hydration, prompt/context/model-message injection, runtime authority, durable fact authority, provider ordering changes, Gateway routes, IPC routes, renderer UI, host-api/api-client/shared contract changes, or user data reads.
ownedPaths:
  - harness/specs/tasks/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.md
  - runtime-research/handoffs/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in/**
  - openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts
  - tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts
touchedAreas:
  - harness/specs/tasks/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.md
  - runtime-research/handoffs/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts
  - tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts
  - tests/unit/task-loop-controller.test.ts
expectedUserBehavior:
  - Default TaskLoop behavior is unchanged; Phase 31 adds no default memory read path, no product UI, no Gateway route, no provider/tool ordering change, and no runtime cutover.
  - Runtime Memory read hydration can run only through an explicit TaskLoop test/research shadow-only opt-in.
  - The explicit opt-in reads only controlled temporary test DBs through `readRuntimeMemoryHydrationShadow`, then runs the Phase 28 pure guarded consumer over sanitized projections.
  - The resulting diagnostics are readonly and non-authoritative; they do not enter reviewer prompts, context packs, model messages, checkpoints, transcripts, runtime decisions, tool calls, provider selection, durable memory writes, fact promotion, or fact acceptance.
  - Default TaskLoop execution with omitted or disabled opt-in performs no read hydration, opens no read-hydration DB, and has no shadow consumer effect.
  - Metrics include guarded recall@k, precision, stale/invalid suppression, candidate/rejected suppression, conflict suppression, raw leak rate, prompt injection return rate, token overhead, latency overhead, default-path no-op rate, TaskLoop decision delta count, prompt/context/model-message injection count, and threshold violations.
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
  - default runtime switch, default TaskLoop read hydration, default shadow helper call, automatic memory/provider registration, or implicit fact promotion
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - hydration facts entering prompt assembly, context provider output, model messages, Gateway/provider transport payloads, runtime decisions, checkpoints, transcripts, durable memory writes, provider ordering, or tool selection
  - consumer opening, reading, creating, migrating, or writing SQLite databases, calling persistence helpers, calling TaskLoop, provider, Gateway, IPC, host-api, api-client, or any service/listener/daemon/server
  - reading or writing user Runtime Memory databases; only test-owned temporary SQLite DBs are allowed
  - bypassing sanitizer boundaries, returning raw SQLite rows, `record_json`, raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, or authority markers
  - creating or implying durable fact authority, runtime authority, prompt authority, provider ordering authority, tool authority, fact acceptance, fact promotion, episode write authority, invalidation acceptance, checkpoint authority, transcript authority, or memory store mutation authority
  - accepting facts when `recordKind !== "fact"`, `verificationStatus !== "verified"`, `valid_at > referenceTime`, `invalid_at <= referenceTime`, `expired_at <= referenceTime`, subject/predicate/taskId mismatches, prompt-injection sentinel text, raw leak sentinel text, conflict suppression, token budget exhaustion, or result limit exhaustion apply
featureFlags:
  - No new runtime feature flag is added by Phase 31.
  - Existing Runtime Memory defaults remain false by omission.
  - Phase 31 explicit opt-in is a TaskLoop dependency/test-research seam only and does not enable `runtime.memory.persist`, `runtime.memory.shadow`, `runtime.memory.provider`, `runtime.memory.proposeFacts`, or read hydration by default.
rollback:
  - Remove `openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts`.
  - Remove the Phase 31 optional TaskLoop dependency/report field from `openclaw_runtime/src/agents/task-loop-controller.ts`.
  - Remove `tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts`.
  - Remove this Phase 31 spec and handoff package.
  - Keep Phase 28-30 helper, consumer, controlled DB evaluation, and replay harness behavior unchanged.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 31 validate with `--no-diff` and record the blocker.
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/task-loop-controller.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'Gateway route|Electron IPC|renderer UI|host-api|api-client|shared contract|TaskLoop default|prompt injection|model-message|context injection|runtime authority|durable fact authority|DB write authority|mutation authority' openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts harness/specs/tasks/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components src/lib shared electron
  - node scripts/scan-pattern.mjs --pattern 'readRuntimeMemoryHydrationShadow|hydrateRuntimeMemoryShadowContext|DatabaseSync|node:sqlite|appendEpisode|appendFact|invalidateFact|withWriteTransaction|insertInto|updateTable|deleteFrom' openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts
acceptance:
  - Phase 31 starts only after AGENTS, scoped runtime AGENTS, Phase 28-30 task specs and deep validations, Phase 30 replay harness test, existing hydration shadow helper, Phase 28 consumer, persistence code, TaskLoop controller/context, and TaskLoop controller tests are read.
  - Phase 31 creates a fresh task spec, focused unit test, implementation, and deep-validation handoff without extending Phase 30 into a product runtime cutover.
  - Default TaskLoop execution with omitted explicit opt-in returns no read-hydration diagnostics, opens no read-hydration DB, does not run the guarded consumer, and preserves decisions, next actions, tool calls, provider ordering, prompts, context, model messages, checkpoints, transcripts, and memory writes.
  - Explicit TaskLoop shadow-only opt-in requires a test/research-only gate and reads sanitized projections from a temporary DB through `readRuntimeMemoryHydrationShadow`, then runs `consumeRuntimeMemoryHydrationFacts`.
  - The explicit diagnostics expose readonly sanitized consumer results and metrics only; they are never passed into `buildTaskLoopContextPack`, `formatTaskLoopContextPackForReviewer`, self-check model messages, checkpoint metadata, transcript material, provider/tool inputs, or durable memory writes.
  - The focused unit test covers stale/invalid, candidate/rejected, conflict, raw-leak sentinel, prompt-injection sentinel, zero token budget, zero result limit, empty no-op, default closed state, no prompt/context/model-message injection, and TaskLoop decision delta count `0`.
  - Phase 30 replay threshold logic is sampled on the TaskLoop explicit path and fails directly on guarded recall/precision/suppression/raw/prompt/decision/prompt-injection threshold violations.
  - README sync review is recorded; README changes are required only if Phase 31 changes product behavior, UI, public runtime behavior, release-facing docs, or user workflows.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 31 Runtime Memory Read Hydration TaskLoop Shadow-only Explicit Opt-in

Phase 31 adds only an explicit TaskLoop test/research shadow diagnostic seam. It may read sanitized Runtime Memory projections from controlled temporary SQLite DBs through the existing read-hydration shadow helper and pass them to the Phase 28 guarded consumer. It is not default TaskLoop read hydration, not prompt/context/model-message injection, not provider/tool authority, not runtime authority, not durable fact authority, and not a product runtime cutover.
