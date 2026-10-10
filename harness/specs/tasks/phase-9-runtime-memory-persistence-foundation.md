---
lifecycleStatus: archived
id: phase-9-runtime-memory-persistence-foundation
title: Phase 9 runtime memory persistence foundation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prepare or implement only a default-off local persistence foundation for sanitized Runtime Memory records, with retention, redaction, migration, rollback, flag-off parity, and no runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
  - runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/runtime-core/memory-store.ts
  - openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts
  - openclaw_runtime/src/context-engine/memory-context-provider.ts
  - tests/unit/runtime-memory-context-contracts.test.ts
  - tests/unit/runtime-memory-store.test.ts
  - tests/unit/runtime-memory-proposal-shadow.test.ts
  - tests/unit/runtime-memory-context-provider.test.ts
  - tests/unit/context-provider-registry.test.ts
touchedAreas:
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/config/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/api-client.ts
  - tests/unit/**
expectedUserBehavior:
  - With runtime.memory.persist false, existing TaskLoop, tools.invoke, approvals, retries, error mapping, return payloads, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider, and provider ordering remain unchanged.
  - Runtime Memory persistence is off by default; any implementation writes only sanitized episode/fact records after retention/redaction checks and proves disabled parity.
  - Durable facts remain verifier-, human-, or deterministic-rule-promoted only; LLM proposals and candidates do not become durable facts automatically.
  - Current-valid queries continue to exclude invalidated, expired, rejected, candidate, and unpromoted facts by default.
  - No renderer direct IPC, direct Gateway HTTP/WebSocket, new service, exporter, database service, listener, external telemetry, or memory-derived runtime authority is introduced.
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
  - default-on runtime memory recording, persistence, provider injection, provider ordering cutover, fact extraction, fact promotion, or prompt memory dump
  - raw chat-log memory, raw transcript import, raw trace-dump memory, prompt dumps, full payload retention, full checkpoint retention, full tool args/output retention, env or secret retention, raw traceparent/tracestate/baggage retention
  - LLM-extracted facts becoming durable memory without verifier-backed evidence, human approval, or accepted deterministic-rule evidence
  - persistence without a named local store owner, schema shape, retained fields, redacted fields, retention limits, invalidation behavior, migration path, idempotency proof, rollback path, and flag-off parity tests
  - provider ordering changes without flag-off parity tests, rollback plan, and explicit synthesis acceptance
  - memory provider or persisted memory acting as completion gate, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority
  - observability platform, OpenTelemetry collector, OTLP exporter, external telemetry upload, graph database service, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway instance, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
featureFlags:
  - runtime.memory.shadow remains default false and may authorize only local sanitized diagnostics.
  - runtime.memory.provider remains default false and may authorize only readonly budgeted context items.
  - runtime.memory.proposeFacts remains default false and may authorize only candidate proposals, not durable promotion.
  - runtime.memory.persist remains default false and may authorize only local sanitized persistence after Phase 9 implementation evidence is accepted.
rollback:
  - Disable runtime.memory.persist and any related experimental memory flags.
  - Omit optional RuntimeMemoryProvider registration from registry calls.
  - Stop new persistence writes when the flag is false and prove runtime reads the existing default-off behavior.
  - Preserve user data during rollback; do not delete persisted memory data unless a later explicit migration/doctor policy accepts deletion.
  - Keep TaskLoop, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider readonly behavior, and provider ordering authoritative.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/context-provider-registry.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' <phase-9-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' <phase-9-touched-files>
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths changed
acceptance:
  - Phase 9 starts from accepted Phase 8 synthesis and does not accept persistence claims from unverified lane text alone.
  - Any implementation names the local store owner and schema, proves migration and rollback, and remains disabled when runtime.memory.persist is false.
  - Persistence writes retain only sanitized bounded episode/fact records; raw chat logs, transcripts, trace dumps, prompts, full payloads, full checkpoints, full tool args/output, env, secrets, and raw trace context are not persisted.
  - Current-valid and historical query behavior remains covered for invalidated, expired, rejected, candidate, unpromoted, and verified facts.
  - Provider ordering, provider registration defaults, TaskLoop completion, tool permission, retry, security, and verifier authority remain unchanged unless a later synthesis explicitly accepts a separate cutover.
  - Boundary scans prove no services/exporters/databases, renderer bypasses, raw retention, or memory-derived runtime authority were added.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 9 Runtime Memory Persistence Foundation

This task prepares the implementation phase after Phase 8 accepted only cutover-readiness evidence. Phase 9 may implement a local, sanitized, default-off persistence foundation, but it must not turn memory on by default, change provider ordering, promote unverified facts, or create runtime authority.
