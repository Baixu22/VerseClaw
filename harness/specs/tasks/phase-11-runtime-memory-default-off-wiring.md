---
lifecycleStatus: archived
id: phase-11-runtime-memory-default-off-wiring
title: Phase 11 runtime memory default-off wiring MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement or prepare only an isolated default-off Runtime Memory persistence wiring adapter that proves no SQLite open/read/write when disabled and does not cut over TaskLoop, Gateway, provider ordering, or runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
  - runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/runtime-core/memory-store.ts
  - openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/runtime-core/memory-runtime-integration.ts
  - openclaw_runtime/src/context-engine/memory-context-provider.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/schema.labels.ts
  - openclaw_runtime/src/config/zod-schema.ts
  - tests/unit/runtime-memory-context-contracts.test.ts
  - tests/unit/runtime-memory-store.test.ts
  - tests/unit/runtime-memory-proposal-shadow.test.ts
  - tests/unit/runtime-memory-context-provider.test.ts
  - tests/unit/runtime-memory-persistence.test.ts
  - tests/unit/runtime-memory-runtime-integration.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
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
  - Phase 11 may add an isolated runtime memory integration adapter only if disabled parity proves no SQLite open/read/write and no default runtime path imports it.
  - Phase 11 may add explicit read/write adapter tests for sanitized records, but must not implement TaskLoop, Gateway, provider ordering, provider registration, default-on persistence, or runtime execution cutover.
  - Runtime Memory persistence remains off by default; runtime.memory.persist alone must not enable provider output, provider ordering changes, fact extraction, fact promotion, completion gates, tool policy, retry policy, security policy, or runtime authority.
  - Durable facts remain verifier-, human-, or deterministic-rule-promoted only; LLM proposals and candidates do not become durable facts automatically.
  - Current-valid queries continue to exclude invalidated, expired, rejected, candidate, and unpromoted facts by default.
  - No renderer direct IPC, direct Gateway HTTP/WebSocket, raw retention, new service, exporter, database service, listener, or memory-derived runtime authority is introduced.
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
  - TaskLoop cutover, Gateway cutover, provider ordering cutover, default provider registration, or runtime execution cutover in Phase 11
  - importing or invoking the Phase 11 integration adapter from TaskLoop, Gateway, Electron Main, renderer, shared host contracts, provider registry defaults, security policy, retry policy, tool permission policy, or verifier authority paths without a later cutover synthesis
  - raw chat-log memory, raw transcript import, raw trace-dump memory, prompt dumps, full payload retention, full checkpoint retention, full tool args/output retention, env or secret retention, raw traceparent/tracestate/baggage retention
  - LLM-extracted facts becoming durable memory without verifier-backed evidence, human approval, or accepted deterministic-rule evidence
  - runtime reads or writes against persisted memory without flag-off parity tests, rollback proof, redaction proof, and explicit synthesis acceptance
  - provider ordering changes without flag-off parity tests, rollback plan, and explicit synthesis acceptance
  - memory provider or persisted memory acting as completion gate, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority
  - observability platform, OpenTelemetry collector, OTLP exporter, external telemetry upload, graph database service, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway instance, second runtime service, service, exporter, database-service, or listener work
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
featureFlags:
  - runtime.memory.shadow remains default false and may authorize only local sanitized diagnostics.
  - runtime.memory.provider remains default false and may authorize only readonly budgeted context items.
  - runtime.memory.proposeFacts remains default false and may authorize only candidate proposals, not durable promotion.
  - runtime.memory.persist remains default false and may authorize only local sanitized persistence accepted by Phase 9. Phase 11 adapter work must prove the disabled path opens, reads, and writes nothing.
rollback:
  - Disable runtime.memory.persist and any related experimental memory flags.
  - Omit the Phase 11 integration adapter from all runtime call sites.
  - Omit optional RuntimeMemoryProvider registration from registry calls.
  - Stop adapter reads and writes when flags are false, while preserving any existing Phase 9 persisted rows.
  - Keep TaskLoop, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider readonly behavior, and provider ordering authoritative.
  - Do not delete persisted memory data unless a later explicit migration or doctor policy accepts deletion.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' <phase-11-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' <phase-11-touched-files>
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths changed
acceptance:
  - Phase 11 starts only from accepted Phase 10 synthesis and does not treat Phase 10 as permission for runtime cutover, default-on behavior, provider ordering changes, or runtime authority.
  - If an integration adapter is implemented, it is isolated, explicitly imported only by tests or later accepted adapter call sites, and proves no SQLite open/read/write when runtime.memory.persist is false.
  - Adapter write APIs accept only already-sanitized Runtime Memory episode/fact/invalidation record shapes or explicit builder results that pass Runtime Memory sanitizers.
  - Adapter read APIs hydrate only a RuntimeMemoryStore snapshot and never expose raw SQLite rows, raw JSON blobs, raw transcript text, or prompt dumps to provider/context code.
  - runtime.memory.persist remains default false and does not enable runtime provider output; runtime.memory.provider remains a separate explicit flag.
  - Provider/context hydration, if implemented, uses explicit extra-provider injection only and preserves default provider ordering.
  - Config help/docs no longer falsely claim Phase 9 persistence is unimplemented, while still warning that runtime wiring/default-on/user-facing persistence remain off unless separately accepted.
  - Boundary scans prove no TaskLoop/Gateway/Electron/renderer/shared/default-registry runtime authority wiring, services, exporters, database services, listeners, renderer bypasses, raw retention, unverified durable facts, or memory-derived runtime authority were added.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 11 Runtime Memory Default-Off Wiring MVP

This task follows the accepted Phase 10 boundary/readiness synthesis. Phase 11 may add an isolated default-off Runtime Memory persistence wiring adapter and tests, plus stale config help/docs updates. It must not cut over TaskLoop, Gateway, provider ordering, default provider registration, default-on persistence, provider output, or runtime authority.
