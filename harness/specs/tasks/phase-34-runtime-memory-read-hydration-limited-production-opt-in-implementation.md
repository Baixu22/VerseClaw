---
id: phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation
title: Phase 34 runtime memory read hydration limited production opt-in implementation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement the smallest runtime operator/readiness gate for Runtime Memory read hydration limited production opt-in, based on Phase 33 readiness evidence, while preserving default-off TaskLoop behavior, diagnostics-only shadow authority, controlled sanitized corpus reads, no user Runtime Memory DB reads, no prompt/context/model-message injection, no durable memory writes, and no product runtime cutover.
ownedPaths:
  - harness/specs/tasks/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation.md
  - runtime-research/handoffs/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation/**
  - tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts
touchedAreas:
  - harness/specs/tasks/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation.md
  - runtime-research/handoffs/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation/**
  - openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
  - tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts
  - tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts
  - tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts
  - tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts
  - tests/unit/task-loop-controller.test.ts
expectedUserBehavior:
  - Default TaskLoop behavior remains unchanged; Phase 34 adds no default read hydration, no product UI, no Gateway route, no IPC route, no host-api/api-client/shared contract, no provider/tool ordering change, and no runtime cutover.
  - Limited production opt-in is a runtime assertion gate on the existing explicit diagnostics-only shadow path, not a product runtime switch.
  - Operator opt-in, approval, diagnostics-only scope, bounded participant/corpus scope, expiry, corpus, privacy/retention, rollback, and metrics gates all fail closed before DB access and before consumer execution.
  - Accepted gates allow only the explicit diagnostics-only shadow path over controlled sanitized fixture or separately approved sanitized internal sample corpus metadata.
  - Phase 34 does not read user Runtime Memory DBs. The focused test uses a controlled sanitized temporary fixture DB only.
  - Diagnostics remain readonly and non-authoritative; they do not enter TaskLoop decisions, next actions, tool calls, provider ordering, prompt assembly, context packs, model messages, checkpoints, transcripts, lifecycle events, traces, durable memory writes, fact promotion, or fact acceptance.
  - Metrics continue to prove guarded recall@k, guarded precision, stale/invalid suppression, candidate/rejected suppression, conflict suppression, raw leak rate, prompt injection return rate, token overhead, latency overhead, default fail-closed rate, TaskLoop decision delta count, tool/provider ordering delta count, prompt/context/model-message injection count, checkpoint/transcript/lifecycle/trace injection count, durable memory write count from read diagnostics, and threshold violations.
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
  - default runtime switch, default TaskLoop read hydration, default shadow helper call, automatic memory/provider registration, implicit fact promotion, runtime authority, durable fact authority, or production cutover
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - hydration facts entering prompt assembly, context provider output, model messages, Gateway/provider transport payloads, runtime decisions, next actions, checkpoints, transcripts, lifecycle events, traces, durable memory writes, provider ordering, or tool selection
  - consumer opening, reading, creating, migrating, or writing SQLite databases, calling persistence helpers, calling TaskLoop, provider, Gateway, IPC, host-api, api-client, or any service/listener/daemon/server
  - reading or writing user Runtime Memory databases; Phase 34 may use only controlled sanitized temporary fixture DBs through the explicit diagnostics path
  - limited production DB reads when operator opt-in, approval, diagnostics-only scope, bounded scope, expiry, corpus provenance, sanitization, no-user-real-data, reproducibility, audit refs, sanitizer boundary, privacy/retention, rollback, or metrics gates are missing or rejected
  - bypassing sanitizer boundaries, returning raw SQLite rows, `record_json`, raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, or authority markers
  - accepting facts when `recordKind !== "fact"`, `verificationStatus !== "verified"`, `valid_at > referenceTime`, `invalid_at <= referenceTime`, `expired_at <= referenceTime`, subject/predicate/taskId mismatches, prompt-injection sentinel text, raw-leak sentinel text, conflict suppression, token budget exhaustion, or result limit exhaustion apply
featureFlags:
  - No default runtime feature flag is added by Phase 34.
  - Existing Runtime Memory defaults remain false by omission.
  - Phase 34 limited production opt-in is an explicit TaskLoop dependency/test-research diagnostics seam only and does not enable `runtime.memory.persist`, `runtime.memory.shadow`, `runtime.memory.provider`, `runtime.memory.proposeFacts`, read hydration, or limited production opt-in by default.
operatorGate:
  runtimeAssertions:
    - `limitedProductionOptIn.enabled === true` is required to evaluate the Phase 34 gate; omission preserves earlier explicit test/research behavior and default closed TaskLoop behavior.
    - `operator.optInRequested === true`
    - non-empty `operator.operatorId`
    - non-empty `operator.approvalRef`
    - `operator.scope === "diagnostics_shadow_only"`
    - non-empty participant and corpus scope
    - `expiresAt > requestedAt`
    - `defaultEnabled === false`
    - `productCutover === false`
corpusGate:
  runtimeAssertions:
    - provenance is `controlled_fixture` or `sanitized_internal_sample`
    - `sanitized === true`
    - `noUserRealData === true`
    - `reproducible === true`
    - non-empty audit refs
    - `sanitizerBoundaryPreserved === true`
privacyRetentionGate:
  runtimeAssertions:
    - no raw transcript/chat/jsonl/trace/prompt/tool/env/secret material
    - retention window is 1-30 days
    - non-empty deletion owner
    - aggregate metrics only outside diagnostics
    - `noUserRuntimeDbRead === true`
    - `noDurableFactAuthority === true`
rollbackGate:
  runtimeAssertions:
    - single operator kill switch present
    - non-empty rollback owner
    - non-empty disable procedure
    - no migration required
    - no durable writes to undo
    - non-empty rollback validation commands
metricsGate:
  runtimeAssertions:
    - guarded recall@k 1
    - guarded precision 1
    - stale/invalid suppression 1
    - candidate/rejected suppression 1
    - conflict suppression 1
    - raw leak rate 0
    - prompt injection return rate 0
    - TaskLoop decision delta count 0
    - tool call delta count 0
    - provider ordering delta count 0
    - prompt/context/model-message injection count 0
    - checkpoint/transcript/lifecycle/trace injection count 0
    - durable memory write count from read diagnostics 0
    - threshold violations 0
rollback:
  - Remove the Phase 34 `limitedProductionOptIn` option and gate report from `openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts`.
  - Remove `tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts`.
  - Remove this Phase 34 spec and handoff package.
  - Keep Phase 28-33 helper, consumer, controlled DB replay, TaskLoop explicit opt-in, controlled internal shadow pilot, and readiness behavior unchanged.
requiredTests:
  - C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation.md
  - C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 34 validate with `--no-diff` and record the blocker.
  - C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/task-loop-controller.test.ts
  - C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n 'Gateway route|Electron IPC|renderer UI|host-api|api-client|shared contract|TaskLoop default|prompt injection|model-message|context injection|runtime authority|durable fact authority|DB write authority|mutation authority' openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts harness/specs/tasks/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation.md docs/dev/runtime-research-boundaries.md
  - C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components src/lib shared electron
  - C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n 'readRuntimeMemoryHydrationShadow|hydrateRuntimeMemoryShadowContext|DatabaseSync|node:sqlite|appendEpisode|appendFact|invalidateFact|withWriteTransaction|insertInto|updateTable|deleteFrom' openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts
acceptance:
  - Phase 34 starts only after AGENTS, scoped runtime AGENTS, Phase 30-33 task specs and deep validations, Phase 30-33 focused tests, existing hydration shadow helper, Phase 28 consumer, TaskLoop controller, and TaskLoop controller tests are read.
  - Phase 34 creates a fresh task spec, focused implementation unit test, minimal runtime gate, and deep-validation handoff without extending Phase 33 into product runtime cutover.
  - Default TaskLoop execution with omitted read hydration returns no read-hydration diagnostics, opens no read-hydration DB, does not run the guarded consumer, and preserves decisions, next actions, tool calls, provider ordering, prompts, context, model messages, checkpoints, transcripts, lifecycle events, traces, and memory writes.
  - Missing operator opt-in, approval, diagnostics-only scope, expiry, corpus, privacy/retention, rollback, or metrics gate returns skipped diagnostics before DB access and before consumer execution.
  - Accepted limited production opt-in permits only the explicit diagnostics-only shadow path and returns readonly gate evidence in diagnostics.
  - Phase 33 controlled corpus path still passes guarded metrics and all zero-delta / zero-injection checks.
  - Stale/invalid, candidate/rejected, conflict, raw-leak sentinel, prompt-injection sentinel, zero token budget, zero result limit, and empty no-op boundaries remain suppressed.
  - Phase 35 entry requires a fresh spec and cannot default-enable read hydration, read user Runtime Memory DBs, inject prompts/context/model messages, add product routes, or create runtime/durable fact authority.
  - README sync review is recorded; README changes are required only if Phase 34 changes product behavior, UI, public runtime behavior, release-facing docs, or user workflows.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 34 Runtime Memory Read Hydration Limited Production Opt-in Implementation

Phase 34 implements only the minimal runtime gate required by Phase 33 readiness. It adds an explicit `limitedProductionOptIn` diagnostics gate to the existing TaskLoop shadow-only read hydration helper. The gate fails closed before SQLite access unless operator, corpus, privacy/retention, rollback, and metrics evidence is complete.

This phase does not default-enable read hydration, does not connect the default TaskLoop path, does not read user Runtime Memory DBs, does not add Gateway/IPC/renderer/host-api/api-client/shared contract surfaces, and does not let diagnostics become runtime authority or durable fact authority.
