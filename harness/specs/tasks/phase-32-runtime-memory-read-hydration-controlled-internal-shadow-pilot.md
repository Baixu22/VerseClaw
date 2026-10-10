---
lifecycleStatus: archived
id: phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot
title: Phase 32 runtime memory read hydration controlled internal shadow pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Extend the Phase 31 TaskLoop explicit shadow-only seam for a controlled internal shadow pilot corpus with auditable sanitized provenance, while preserving default-off TaskLoop behavior, readonly diagnostics, non-authority boundaries, no prompt/context/model-message injection, no checkpoint/transcript material, no durable memory writes from read diagnostics, no Gateway/IPC/renderer/host-api/api-client/shared contract changes, and no user Runtime Memory DB reads.
ownedPaths:
  - harness/specs/tasks/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot.md
  - runtime-research/handoffs/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot/**
  - openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts
  - tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts
touchedAreas:
  - harness/specs/tasks/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot.md
  - runtime-research/handoffs/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot/**
  - openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts
  - tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts
  - tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts
  - tests/unit/task-loop-controller.test.ts
expectedUserBehavior:
  - Default TaskLoop behavior remains unchanged; Phase 32 adds no product UI, no runtime cutover, no Gateway route, no IPC route, no host-api/api-client/shared contract, no provider/tool ordering change, and no default read hydration.
  - Controlled internal shadow pilot execution is possible only through the existing explicit TaskLoop shadow-only test/research dependency with `explicitOptIn: true` and `testResearchOnly: true`.
  - The pilot corpus must declare accepted provenance, sanitized status, no-user-real-data status, reproducibility, and audit refs before any pilot DB read occurs.
  - Invalid pilot corpus metadata skips before opening SQLite.
  - Valid pilot reads only controlled temporary fixture or sanitized internal sample DBs through `readRuntimeMemoryHydrationShadow`, then runs the pure guarded consumer over sanitized projections.
  - The resulting diagnostics remain readonly and non-authoritative; they do not enter reviewer prompts, context packs, model messages, checkpoints, transcripts, lifecycle events, runtime decisions, next actions, provider/tool inputs, durable memory writes, fact promotion, or fact acceptance.
  - Metrics include guarded recall@k, guarded precision, stale/invalid suppression, candidate/rejected suppression, conflict suppression, raw leak rate, prompt injection return rate, token overhead, latency overhead, default-path no-op rate, TaskLoop decision delta count, tool/provider ordering delta count, prompt/context/model-message injection count, checkpoint/transcript injection count, durable memory write count from read diagnostics, and threshold violations.
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
  - default runtime switch, default TaskLoop read hydration, default shadow helper call, automatic memory/provider registration, implicit fact promotion, runtime authority, or durable fact authority
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - hydration facts entering prompt assembly, context provider output, model messages, Gateway/provider transport payloads, runtime decisions, next actions, checkpoints, transcripts, durable memory writes, provider ordering, or tool selection
  - consumer opening, reading, creating, migrating, or writing SQLite databases, calling persistence helpers, calling TaskLoop, provider, Gateway, IPC, host-api, api-client, or any service/listener/daemon/server
  - reading or writing user Runtime Memory databases; only controlled sanitized pilot corpus / temporary DB sources are allowed
  - pilot DB reads when corpus provenance, sanitization, no-user-real-data, reproducibility, or audit refs are missing or rejected
  - bypassing sanitizer boundaries, returning raw SQLite rows, `record_json`, raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, or authority markers
  - accepting facts when `recordKind !== "fact"`, `verificationStatus !== "verified"`, `valid_at > referenceTime`, `invalid_at <= referenceTime`, `expired_at <= referenceTime`, subject/predicate/taskId mismatches, prompt-injection sentinel text, raw leak sentinel text, conflict suppression, token budget exhaustion, or result limit exhaustion apply
featureFlags:
  - No new runtime feature flag is added by Phase 32.
  - Existing Runtime Memory defaults remain false by omission.
  - Phase 32 controlled internal shadow pilot is an explicit TaskLoop dependency/test-research seam only and does not enable `runtime.memory.persist`, `runtime.memory.shadow`, `runtime.memory.provider`, `runtime.memory.proposeFacts`, or read hydration by default.
rollback:
  - Remove the Phase 32 controlled corpus metadata gate from `openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts`.
  - Remove `tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts`.
  - Remove this Phase 32 spec and handoff package.
  - Keep Phase 28-31 helper, consumer, controlled DB evaluation, replay harness, and TaskLoop explicit opt-in behavior unchanged.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 32 validate with `--no-diff` and record the blocker.
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/task-loop-controller.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'Gateway route|Electron IPC|renderer UI|host-api|api-client|shared contract|TaskLoop default|prompt injection|model-message|context injection|runtime authority|durable fact authority|DB write authority|mutation authority' openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts harness/specs/tasks/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot.md docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components src/lib shared electron
  - node scripts/scan-pattern.mjs --pattern 'readRuntimeMemoryHydrationShadow|hydrateRuntimeMemoryShadowContext|DatabaseSync|node:sqlite|appendEpisode|appendFact|invalidateFact|withWriteTransaction|insertInto|updateTable|deleteFrom' openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts
acceptance:
  - Phase 32 starts only after AGENTS, scoped runtime AGENTS, Phase 30 and Phase 31 task specs and deep validations, Phase 30 replay harness test, Phase 31 TaskLoop explicit opt-in test, existing hydration shadow helper, Phase 28 consumer, TaskLoop controller, and TaskLoop controller tests are read.
  - Phase 32 creates a fresh task spec, focused unit/pilot test, minimal explicit seam extension or fixture support, and deep-validation handoff without extending Phase 31 into product runtime cutover.
  - Default TaskLoop execution with omitted explicit pilot returns no read-hydration diagnostics, opens no read-hydration DB, does not run the guarded consumer, and preserves decisions, next actions, tool calls, provider ordering, prompts, context, model messages, checkpoints, transcripts, lifecycle events, traces, and memory writes.
  - Invalid pilot corpus metadata returns skipped diagnostics before DB access and exposes boundary violations only as readonly diagnostics.
  - Explicit controlled internal shadow pilot requires `explicitOptIn: true`, `testResearchOnly: true`, and accepted corpus metadata before reading sanitized projections from a controlled temporary DB through `readRuntimeMemoryHydrationShadow`, then running `consumeRuntimeMemoryHydrationFacts`.
  - The focused unit test covers stale/invalid, candidate/rejected, conflict, raw-leak sentinel, prompt-injection sentinel, zero token budget, zero result limit, empty no-op, default closed state, invalid corpus skip-before-open, no prompt/context/model-message/checkpoint/transcript/lifecycle/trace injection, TaskLoop decision delta count `0`, and provider/tool ordering delta count `0`.
  - Phase 30 replay threshold logic is reused or extended on the TaskLoop explicit pilot path and fails directly on guarded recall/precision/suppression/raw/prompt/decision/provider/tool/prompt-injection threshold violations.
  - Corpus provenance, sanitization, reproducibility, and no-user-real-data boundary are asserted in test and documented in the handoff.
  - README sync review is recorded; README changes are required only if Phase 32 changes product behavior, UI, public runtime behavior, release-facing docs, or user workflows.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 32 Runtime Memory Read Hydration Controlled Internal Shadow Pilot

Phase 32 extends only the explicit TaskLoop test/research shadow diagnostic seam. It may run a controlled internal shadow pilot over audited sanitized fixture or internal sample corpus metadata and controlled temporary SQLite DBs. It is not default TaskLoop read hydration, not a runtime cutover, not prompt/context/model-message injection, not provider/tool authority, not runtime authority, not durable fact authority, and not a product route.
