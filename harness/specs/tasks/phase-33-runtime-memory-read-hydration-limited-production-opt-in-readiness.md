---
id: phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness
title: Phase 33 runtime memory read hydration limited production opt-in readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define and validate the limited-production opt-in readiness gates for Runtime Memory read hydration while preserving default-off TaskLoop behavior, controlled-corpus-only evidence, readonly diagnostics, non-authority boundaries, no prompt/context/model-message injection, no durable memory writes, no user Runtime Memory DB reads, and no product runtime cutover.
ownedPaths:
  - harness/specs/tasks/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness.md
  - runtime-research/handoffs/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness/**
  - tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts
touchedAreas:
  - harness/specs/tasks/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness.md
  - runtime-research/handoffs/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness/**
  - openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts
  - tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts
  - tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts
  - tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts
  - tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts
  - tests/unit/task-loop-controller.test.ts
expectedUserBehavior:
  - Default TaskLoop behavior remains unchanged; Phase 33 adds no default read hydration, no product UI, no Gateway route, no IPC route, no host-api/api-client/shared contract, no provider/tool ordering change, and no runtime cutover.
  - Phase 33 is readiness evidence only. It defines the hard gates that Phase 34 must satisfy before any limited production opt-in implementation can be proposed.
  - Readiness gate failures fail closed before DB access and before consumer execution.
  - The only executable positive path remains the Phase 32 explicit controlled internal shadow pilot over controlled sanitized temporary corpus data.
  - No user Runtime Memory DB or real user data source may be read in Phase 33.
  - Diagnostics remain readonly and non-authoritative; they do not enter TaskLoop decisions, next actions, tool calls, provider ordering, prompt assembly, context packs, model messages, checkpoints, transcripts, lifecycle events, traces, durable memory writes, fact promotion, or fact acceptance.
  - Metrics must continue to prove guarded recall@k, guarded precision, stale/invalid suppression, candidate/rejected suppression, conflict suppression, raw leak rate, prompt injection return rate, token overhead, latency overhead, default fail-closed rate, TaskLoop decision delta count, tool/provider ordering delta count, prompt/context/model-message injection count, checkpoint/transcript/lifecycle/trace injection count, durable memory write count from read diagnostics, and threshold violations.
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
  - reading or writing user Runtime Memory databases; Phase 33 may use only controlled sanitized temporary fixture DBs through the already explicit Phase 32 path
  - pilot or readiness DB reads when operator opt-in, corpus provenance, sanitization, no-user-real-data, reproducibility, audit refs, privacy/retention, rollback, or metrics gates are missing or rejected
  - bypassing sanitizer boundaries, returning raw SQLite rows, `record_json`, raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, or authority markers
  - accepting facts when `recordKind !== "fact"`, `verificationStatus !== "verified"`, `valid_at > referenceTime`, `invalid_at <= referenceTime`, `expired_at <= referenceTime`, subject/predicate/taskId mismatches, prompt-injection sentinel text, raw-leak sentinel text, conflict suppression, token budget exhaustion, or result limit exhaustion apply
featureFlags:
  - No new runtime feature flag is added by Phase 33.
  - Existing Runtime Memory defaults remain false by omission.
  - Phase 33 readiness does not enable `runtime.memory.persist`, `runtime.memory.shadow`, `runtime.memory.provider`, `runtime.memory.proposeFacts`, read hydration, or limited production opt-in by default.
operatorGate:
  requiredBeforePhase34:
    - named operator owner and approval ref
    - explicit per-run opt-in request
    - bounded participant/corpus scope
    - diagnostics-only/shadow-only scope
    - expiry or renewal window
    - default-off and no product cutover attestation
corpusGate:
  requiredBeforePhase34:
    - approved provenance
    - sanitized corpus status
    - no-user-real-data status for readiness corpora
    - reproducible corpus version
    - audit refs tied to specs/tests/handoffs
    - sanitizer boundary preserved before consumer use
privacyRetentionGate:
  requiredBeforePhase34:
    - no raw transcript/chat/jsonl/trace/prompt/tool/env/secret material
    - bounded retention period
    - deletion owner and evidence
    - aggregate metrics only outside diagnostics
    - no user Runtime Memory DB read until a fresh implementation spec accepts that scope
rollbackGate:
  requiredBeforePhase34:
    - single operator kill switch
    - rollback owner and escalation path
    - no migrations or durable writes required to disable
    - no persisted authority state to unwind
    - exact rollback validation commands
metricsGate:
  requiredBeforePhase34:
    - guarded recall@k 1
    - guarded precision 1
    - stale/invalid suppression 1
    - candidate/rejected suppression 1
    - conflict suppression 1
    - raw leak rate 0
    - prompt injection return rate 0
    - TaskLoop decision delta count 0
    - tool/provider ordering delta count 0
    - prompt/context/model-message/checkpoint/transcript/lifecycle/trace injection count 0
    - durable memory write count from read diagnostics 0
    - threshold violations 0
rollback:
  - Remove `tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts`.
  - Remove this Phase 33 spec and handoff package.
  - Keep Phase 28-32 helper, consumer, controlled DB replay, TaskLoop explicit opt-in, and controlled internal shadow pilot behavior unchanged.
requiredTests:
  - C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness.md
  - C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 33 validate with `--no-diff` and record the blocker.
  - C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/task-loop-controller.test.ts
  - C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n 'Gateway route|Electron IPC|renderer UI|host-api|api-client|shared contract|TaskLoop default|prompt injection|model-message|context injection|runtime authority|durable fact authority|DB write authority|mutation authority' tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts harness/specs/tasks/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness.md docs/dev/runtime-research-boundaries.md
  - C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components src/lib shared electron
  - C:\Users\27933\.cherrystudio\bin\rtk.exe rg -n 'readRuntimeMemoryHydrationShadow|hydrateRuntimeMemoryShadowContext|DatabaseSync|node:sqlite|appendEpisode|appendFact|invalidateFact|withWriteTransaction|insertInto|updateTable|deleteFrom' openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts
acceptance:
  - Phase 33 starts only after AGENTS, scoped runtime AGENTS, Phase 30-32 task specs and deep validations, Phase 30-32 focused tests, existing hydration shadow helper, Phase 28 consumer, TaskLoop controller, and TaskLoop controller tests are read.
  - Phase 33 creates a fresh task spec, focused readiness unit test, and deep-validation handoff without extending Phase 32 into product runtime cutover.
  - Default TaskLoop execution with omitted read hydration returns no read-hydration diagnostics, opens no read-hydration DB, does not run the guarded consumer, and preserves decisions, next actions, tool calls, provider ordering, prompts, context, model messages, checkpoints, transcripts, lifecycle events, traces, and memory writes.
  - Readiness gate failures return fail-closed evidence before DB access and before consumer execution.
  - Operator opt-in, corpus provenance, sanitization, no-user-real-data, reproducibility, audit refs, privacy/retention, rollback, and metrics gates are explicitly asserted.
  - Phase 32 controlled corpus path still passes guarded metrics and all zero-delta / zero-injection checks.
  - Stale/invalid, candidate/rejected, conflict, raw-leak sentinel, prompt-injection sentinel, zero token budget, zero result limit, and empty no-op boundaries remain suppressed.
  - Phase 34 entry is limited to a fresh implementation spec; Phase 33 does not approve default-on behavior, real user DB reads, prompt/context/model-message insertion, durable fact authority, runtime authority, or production cutover.
  - README sync review is recorded; README changes are required only if Phase 33 changes product behavior, UI, public runtime behavior, release-facing docs, or user workflows.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 33 Runtime Memory Read Hydration Limited Production Opt-in Readiness

Phase 33 is readiness evidence only. It defines the operator, corpus, privacy/retention, rollback, and metrics gates that must exist before a future Phase 34 limited production opt-in implementation can be considered. It does not enable read hydration by default, does not read user Runtime Memory DBs, and does not move diagnostics into prompts, context, model messages, TaskLoop decisions, provider/tool ordering, checkpoints, transcripts, traces, durable memory, or runtime authority.
