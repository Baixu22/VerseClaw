---
id: phase-13-runtime-memory-taskloop-shadow-persistence-pilot
title: Phase 13 runtime memory TaskLoop shadow persistence pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Orchestrate the first default-off TaskLoop Runtime Memory call-site pilot for sanitized episode persistence, gated by runtime.memory.shadow and runtime.memory.persist, without Gateway cutover, provider-ordering cutover, durable fact promotion, default-on behavior, raw retention, or runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md
  - runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/agents/task-loop-controller.ts
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
  - tests/unit/task-loop-controller.test.ts
  - tests/unit/runtime-memory-context-contracts.test.ts
  - tests/unit/runtime-memory-store.test.ts
  - tests/unit/runtime-memory-proposal-shadow.test.ts
  - tests/unit/runtime-memory-context-provider.test.ts
  - tests/unit/runtime-memory-persistence.test.ts
  - tests/unit/runtime-memory-runtime-integration.test.ts
  - tests/unit/runtime-feature-config-schema.test.ts
  - tests/unit/context-provider-registry.test.ts
touchedAreas:
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/config/**
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/api-client.ts
  - tests/unit/**
expectedUserBehavior:
  - With runtime.memory.shadow or runtime.memory.persist disabled, existing TaskLoop, tools.invoke, approvals, retries, error mapping, return payloads, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider, and provider ordering remain unchanged.
  - Phase 13 may accept only a default-off TaskLoop shadow persistence pilot for sanitized Runtime Memory episode records. The pilot must not extract facts, promote facts, change completion, change retries, change approvals, change tool policy, change verifier/security behavior, or alter runtime authority.
  - runtime.memory.persist alone must not enable TaskLoop memory writes. The TaskLoop pilot requires both runtime.memory.shadow and runtime.memory.persist to be explicitly true.
  - runtime.memory.provider remains separate and default false. Phase 13 must not register RuntimeMemoryProvider by default, change provider ordering, or hydrate provider output from persisted memory by default.
  - Durable facts remain verifier-, human-, or deterministic-rule-promoted only. Phase 13 should not add automatic fact extraction or durable fact writes.
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
  - Gateway cutover, Electron Main cutover, renderer cutover, shared host contract cutover, provider ordering cutover, default provider registration, runtime execution authority cutover, security policy cutover, retry policy cutover, verifier authority cutover, or tool permission policy cutover in Phase 13
  - treating Phase 12 readiness as permission for broad runtime cutover beyond the narrow TaskLoop sanitized episode pilot
  - invoking Runtime Memory adapter writes from TaskLoop unless both runtime.memory.shadow and runtime.memory.persist are explicitly true
  - reading persisted memory from TaskLoop, Gateway, Electron Main, renderer, shared host contracts, provider registry defaults, security policy, retry policy, tool permission policy, or verifier authority paths in Phase 13
  - raw chat-log memory, raw transcript import, raw trace-dump memory, prompt dumps, full payload retention, full checkpoint retention, full tool args/output retention, env or secret retention, raw traceparent/tracestate/baggage retention
  - LLM-extracted facts becoming durable memory without verifier-backed evidence, human approval, or accepted deterministic-rule evidence
  - runtime writes against persisted memory without flag-off parity tests, rollback proof, redaction proof, idempotency proof, error-isolation proof, and explicit Phase 13 synthesis acceptance
  - provider ordering changes without flag-off parity tests, rollback plan, prompt byte/order proof, and explicit later synthesis acceptance
  - memory provider or persisted memory acting as completion gate, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority
  - observability platform, OpenTelemetry collector, OTLP exporter, external telemetry upload, graph database service, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway instance, second runtime service, service, exporter, database-service, or listener work
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
featureFlags:
  - runtime.memory.shadow remains default false and is required for the Phase 13 TaskLoop shadow persistence pilot.
  - runtime.memory.persist remains default false and is required before the Phase 13 TaskLoop pilot may call the Phase 11 adapter.
  - runtime.memory.provider remains default false and must not be enabled or implied by the TaskLoop pilot.
  - runtime.memory.proposeFacts remains default false and must not be used to promote durable facts in Phase 13.
rollback:
  - Disable runtime.memory.shadow or runtime.memory.persist.
  - Omit the TaskLoop adapter import/call site introduced by the Phase 13 pilot.
  - Omit optional RuntimeMemoryProvider registration from registry calls.
  - Stop TaskLoop memory episode writes when either required flag is false, while preserving any existing Phase 9 persisted rows.
  - Keep TaskLoop, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider readonly behavior, and provider ordering authoritative.
  - Do not delete persisted memory data unless a later explicit migration or doctor policy accepts deletion.
requiredTests:
  - rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
  - rtk node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts
  - rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - rtk rg -n 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER' openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts
  - rtk rg -n 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER' openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/runtime-core/index.ts
  - rtk rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' <phase-13-touched-files>
  - rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service' <phase-13-touched-files>
  - rtk rg -n 'runtime\.memory\.persist|runtime\.memory\.shadow|createRuntimeMemoryPersistenceStore|RuntimeMemoryPersistence|runtime_memory_|openOpenClawStateDatabase|DatabaseSync|sqlite|jsonl|transcript' openclaw_runtime/src/runtime-core openclaw_runtime/src/context-engine openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/gateway electron shared src/lib tests/unit
  - rtk node scripts/comms/replay.mjs and rtk node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths changed
acceptance:
  - Phase 13 starts only after Phase 12 synthesis exists and ends with exactly Status: accepted.
  - Phase 13 documents that Phase 12 accepted only planning/spec/evidence readiness and rejects treating Phase 12 as broad runtime cutover permission.
  - The handoff defines parallel lanes for TaskLoop call-site gating and disabled parity, sanitized episode write mapping, persistence idempotency/error isolation, provider/Gateway/no-authority/docs boundary, and validation/scans/comms proof.
  - The TaskLoop pilot requires both runtime.memory.shadow and runtime.memory.persist to be explicitly true before adapter writes can run. Omitted flags, shadow=false, persist=false, and persist=true with shadow=false must preserve legacy TaskLoop behavior and must not open/read/write SQLite.
  - The TaskLoop pilot may persist only bounded sanitized Runtime Memory episode records. It must not persist raw prompts, transcripts, tool args/output, full payloads, full checkpoints, env, secrets, raw trace context, durable facts, candidates, invalidations, or provider context by default.
  - Adapter write errors remain shadow-only diagnostics and must not change TaskLoop terminal status, return payload shape, approval behavior, retry behavior, tool policy, verifier/security behavior, or event-log/checkpoint/resume behavior.
  - Phase 13 does not add Gateway/Electron/renderer/shared host contract memory routes, provider default registration, provider ordering changes, provider output from runtime.memory.persist, default-on behavior, raw retention, unverified durable facts, service/exporter/database-service/listener work, or memory-derived runtime authority.
  - Boundary scans prove only the intended TaskLoop pilot imports/call sites were added, no forbidden authority paths were added, and rollback is disable flags plus omit the pilot import/call site while preserving Phase 9 rows.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/README.md
    - runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/parallel-lanes.md
    - runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/window-prompts.md
    - runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submission-template.md
---

# Phase 13 Runtime Memory TaskLoop Shadow Persistence Pilot

This task orchestrates the first narrow Runtime Memory runtime call-site pilot after Phase 12 readiness was accepted. It may accept only a default-off TaskLoop shadow persistence pilot for sanitized episode records, gated by both `runtime.memory.shadow` and `runtime.memory.persist`. It must not accept Gateway/provider/default-on/raw-retention/fact-promotion/runtime-authority cutover.
