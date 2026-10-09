---
id: phase-10-runtime-memory-persistence-integration
title: Phase 10 runtime memory persistence integration planning
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prepare the next default-off Runtime Memory persistence integration phase without implementing TaskLoop, Gateway, provider ordering, or default-on cutover behavior.
ownedPaths:
  - harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md
  - runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/runtime-core/memory-store.ts
  - openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/context-engine/memory-context-provider.ts
  - tests/unit/runtime-memory-context-contracts.test.ts
  - tests/unit/runtime-memory-store.test.ts
  - tests/unit/runtime-memory-proposal-shadow.test.ts
  - tests/unit/runtime-memory-context-provider.test.ts
  - tests/unit/runtime-memory-persistence.test.ts
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
  - Phase 10 may plan default-off integration boundaries for reading and writing sanitized Runtime Memory persistence, but must not implement TaskLoop, Gateway, provider cutover, or default-on runtime behavior in this entry scaffold.
  - Runtime Memory persistence remains off by default; any future integration must prove disabled parity before it can read from or write to the Phase 9 local store.
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
  - TaskLoop cutover, Gateway cutover, provider ordering cutover, default provider registration, or runtime execution cutover in the Phase 10 entry scaffold
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
  - runtime.memory.persist remains default false and may authorize only local sanitized persistence accepted by Phase 9; Phase 10 entry prep must not make it default-on or runtime-authoritative.
rollback:
  - Disable runtime.memory.persist and any related experimental memory flags.
  - Omit optional RuntimeMemoryProvider registration from registry calls.
  - Stop new persistence integration reads and writes when flags are false, while preserving any existing Phase 9 persisted rows.
  - Keep TaskLoop, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider readonly behavior, and provider ordering authoritative.
  - Do not delete persisted memory data unless a later explicit migration or doctor policy accepts deletion.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/context-provider-registry.test.ts
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' <phase-10-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' <phase-10-touched-files>
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths changed
acceptance:
  - Phase 10 starts only from accepted Phase 9 synthesis and does not treat Phase 9 as permission for runtime cutover, default-on behavior, provider ordering changes, or runtime authority.
  - The entry scaffold defines lane work for flag-off runtime wiring parity, persistence read/write integration boundaries, provider/context hydration boundaries, and rollback/docs/validation synthesis readiness.
  - Any future runtime integration plan keeps runtime.memory.persist default false and proves no SQLite open/read/write when disabled.
  - Any future read/write integration plan retains only sanitized bounded episode/fact/invalidation records and rejects raw chat logs, transcripts, traces, prompts, payloads, checkpoints, tool args/output, env, secrets, and raw trace context.
  - Any future provider/context hydration plan preserves default provider ordering and readonly/no-authority context behavior unless a later synthesis explicitly accepts a separate cutover.
  - Boundary scans prove no services, exporters, database services, listeners, renderer bypasses, raw retention, unverified durable facts, or memory-derived runtime authority were added.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 10 Runtime Memory Persistence Integration Planning

This task prepares the next entry phase after Phase 9 accepted only a default-off local sanitized Runtime Memory persistence foundation. Phase 10 entry prep creates the planning and handoff scaffold for future default-off runtime integration evidence; it must not implement TaskLoop, Gateway, provider cutover, default-on persistence, provider ordering changes, or runtime authority.
