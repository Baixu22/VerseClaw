---
id: phase-12-runtime-memory-cutover-readiness
title: Phase 12 runtime memory cutover readiness spec
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Plan the evidence required before any Runtime Memory TaskLoop, Gateway, provider-ordering, or runtime call-site import can be accepted, without implementing runtime cutover.
ownedPaths:
  - harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md
  - runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/runtime-core/memory-store.ts
  - openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/runtime-core/memory-runtime-integration.ts
  - openclaw_runtime/src/context-engine/memory-context-provider.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
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
  - tests/unit/task-loop-controller.test.ts
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
  - Phase 12 is planning/spec/evidence only unless a later explicit change is isolated, default-off, and separately justified. It does not implement TaskLoop, Gateway, provider-ordering, runtime call-site, or default provider registration cutover.
  - With runtime.memory flags disabled, existing TaskLoop, tools.invoke, approvals, retries, error mapping, return payloads, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider, and provider ordering remain unchanged.
  - Phase 11 remains accepted only as isolated default-off adapter wiring; the adapter must not be treated as accepted runtime authority or as permission to import it into runtime call sites.
  - Runtime Memory persistence remains off by default; runtime.memory.persist alone must not enable provider output, provider ordering changes, fact extraction, fact promotion, completion gates, tool policy, retry policy, security policy, or runtime authority.
  - Durable facts remain verifier-, human-, or deterministic-rule-promoted only; LLM proposals and candidates do not become durable facts automatically.
  - Current-valid queries continue to exclude invalidated, expired, rejected, candidate, and unpromoted facts by default.
  - No renderer direct IPC, direct Gateway HTTP/WebSocket, raw retention, new service, exporter, database service, listener, default-on persistence, provider ordering cutover, unverified durable fact, or memory-derived runtime authority is introduced.
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
  - TaskLoop cutover, Gateway cutover, provider ordering cutover, default provider registration, runtime call-site import, or runtime execution cutover in Phase 12
  - accepting a future TaskLoop/Gateway/provider-ordering/runtime import without a risk map, disabled parity proof, rollback proof, no-authority proof, scan proof, and synthesis acceptance
  - importing or invoking the Phase 11 integration adapter from TaskLoop, Gateway, Electron Main, renderer, shared host contracts, provider registry defaults, security policy, retry policy, tool permission policy, or verifier authority paths in Phase 12
  - raw chat-log memory, raw transcript import, raw trace-dump memory, prompt dumps, full payload retention, full checkpoint retention, full tool args/output retention, env or secret retention, raw traceparent/tracestate/baggage retention
  - LLM-extracted facts becoming durable memory without verifier-backed evidence, human approval, or accepted deterministic-rule evidence
  - runtime reads or writes against persisted memory without flag-off parity tests, rollback proof, redaction proof, and explicit later synthesis acceptance
  - provider ordering changes without flag-off parity tests, rollback plan, and explicit later synthesis acceptance
  - memory provider or persisted memory acting as completion gate, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority
  - observability platform, OpenTelemetry collector, OTLP exporter, external telemetry upload, graph database service, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway instance, second runtime service, service, exporter, database-service, or listener work
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
featureFlags:
  - runtime.memory.shadow remains default false and may authorize only local sanitized diagnostics.
  - runtime.memory.provider remains default false and may authorize only readonly budgeted context items.
  - runtime.memory.proposeFacts remains default false and may authorize only candidate proposals, not durable promotion.
  - runtime.memory.persist remains default false and may authorize only local sanitized persistence accepted by Phase 9 and isolated adapter use accepted by Phase 11. Phase 12 must not make it default-on or runtime-authoritative.
rollback:
  - Disable runtime.memory.persist and any related experimental memory flags.
  - Omit the Phase 11 integration adapter from all runtime call sites.
  - Omit optional RuntimeMemoryProvider registration from registry calls.
  - Stop adapter reads and writes when flags are false, while preserving any existing Phase 9 persisted rows.
  - Keep TaskLoop, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider readonly behavior, and provider ordering authoritative.
  - Do not delete persisted memory data unless a later explicit migration or doctor policy accepts deletion.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/task-loop-controller.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/runtime-core/index.ts
  - node scripts/scan-pattern.mjs --pattern 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' openclaw_runtime/src/runtime-core/memory-context.ts openclaw_runtime/src/runtime-core/memory-store.ts openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts openclaw_runtime/src/runtime-core/memory-persistence.ts openclaw_runtime/src/runtime-core/memory-runtime-integration.ts openclaw_runtime/src/context-engine/memory-context-provider.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service' openclaw_runtime/src/runtime-core/memory-context.ts openclaw_runtime/src/runtime-core/memory-store.ts openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts openclaw_runtime/src/runtime-core/memory-persistence.ts openclaw_runtime/src/runtime-core/memory-runtime-integration.ts openclaw_runtime/src/context-engine/memory-context-provider.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts
  - node scripts/scan-pattern.mjs --pattern 'runtime\.memory\.persist|createRuntimeMemoryPersistenceStore|RuntimeMemoryPersistence|runtime_memory_|openOpenClawStateDatabase|DatabaseSync|sqlite|jsonl|transcript' openclaw_runtime/src/runtime-core openclaw_runtime/src/context-engine openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src/lib tests/unit
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths changed
acceptance:
  - Phase 12 starts only after Phase 11 synthesis exists and ends with exactly Status: accepted.
  - Phase 12 documents that Phase 11 accepted only isolated default-off adapter wiring and rejects treating Phase 11 as runtime cutover permission.
  - The handoff defines parallel lanes for TaskLoop import/call-site cutover risk, provider registration/order cutover risk, durable fact promotion authority gates, rollback/operator/docs/config proof, and validation/scans/comms proof.
  - The TaskLoop lane is a risk map only and does not import, invoke, instantiate, or configure Runtime Memory runtime integration from TaskLoop, Gateway, Electron, renderer, shared host contracts, default provider registry, verifier, security, retry, or tool policy paths.
  - The provider lane is a risk map only and does not register memory by default or change default provider ordering.
  - The durable fact lane requires source episode refs, evidence refs, accepted verification status, finite acceptedAt, and verifier/human/deterministic-rule promotion evidence before any durable fact can influence runtime context.
  - The rollback/operator/docs/config lane keeps runtime.memory flags default false, names rollback by disabling flags/omitting imports/omitting provider registration, and does not accept default-on persistence or operator-facing persistence flow.
  - Boundary scans prove no services, exporters, database services, listeners, renderer bypasses, raw retention, unverified durable facts, provider-ordering cutover, runtime call-site import, or memory-derived runtime authority were added.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 12 Runtime Memory Cutover Readiness Spec

This task plans the next Runtime Memory phase after Phase 11. It defines the evidence required before any TaskLoop, Gateway, provider-ordering, or runtime call-site import can be accepted. It does not implement runtime cutover.
