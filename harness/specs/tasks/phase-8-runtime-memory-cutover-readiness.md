---
lifecycleStatus: archived
id: phase-8-runtime-memory-cutover-readiness
title: Phase 8 runtime memory cutover readiness and rollback proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prepare a cutover-readiness plan for Runtime Memory Provider persistence, provider registration, fact promotion, and rollback without enabling default-on memory behavior or accepting unverified durable facts.
ownedPaths:
  - harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md
  - runtime-research/handoffs/phase-8-runtime-memory-cutover-readiness/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/runtime-core/memory-store.ts
  - openclaw_runtime/src/runtime-core/memory-proposal-shadow.ts
  - openclaw_runtime/src/context-engine/memory-context-provider.ts
  - tests/unit/runtime-memory-context-contracts.test.ts
  - tests/unit/runtime-memory-store.test.ts
  - tests/unit/runtime-memory-proposal-shadow.test.ts
  - tests/unit/runtime-memory-context-provider.test.ts
touchedAreas:
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/config/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/host-api-client.ts
  - tests/unit/**
expectedUserBehavior:
  - With all runtime.memory flags disabled, existing TaskLoop, tools.invoke, approval waiting, retries, error mapping, return payloads, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, and provider ordering remain unchanged.
  - Runtime memory persistence, provider registration, provider ordering, fact extraction, and fact promotion remain off unless a lane explicitly proves rollback, retention, redaction, migration, and flag-off parity.
  - Durable memory facts must cite source episode refs and evidence refs and must be promoted only by verifier-backed evidence, human approval, or an accepted deterministic rule.
  - Current-valid queries continue to exclude invalidated, expired, rejected, candidate, and unpromoted facts by default.
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
  - persistence without retention, redaction, invalidation, migration, and rollback proof
  - provider ordering changes without flag-off parity tests, rollback plan, and explicit synthesis acceptance
  - memory provider acting as completion gate, verifier authority, security policy, retry policy, tool permission authority, runtime execution policy, or runtime authority
  - observability platform, OpenTelemetry collector, OTLP exporter, external telemetry upload, graph database service, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway instance, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
featureFlags:
  - runtime.memory.shadow remains default false and may authorize only local sanitized diagnostics.
  - runtime.memory.provider remains default false and may authorize only readonly budgeted context items.
  - runtime.memory.proposeFacts remains default false and may authorize only candidate proposals, not durable promotion.
  - runtime.memory.persist remains default false until retention, redaction, invalidation, migration, rollback, and store-owner evidence is accepted.
rollback:
  - Disable all runtime.memory flags.
  - Remove or omit optional RuntimeMemoryProvider registration from any experimental registry call.
  - Keep existing TaskLoop, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, and provider ordering authoritative.
  - If persistence is introduced in a future lane, rollback must preserve user data, stop new writes, and prove runtime reads the old default behavior when flags are false.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-8-runtime-memory-cutover-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/context-provider-registry.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' <phase-8-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' <phase-8-touched-files>
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths changed
acceptance:
  - Phase 8 starts from accepted Phase 7 synthesis evidence and does not accept memory claims from unverified lane text alone.
  - Any persistence proposal identifies a store owner, schema shape, retained fields, redacted fields, migration path, rollback path, and no-raw-retention proof.
  - Any provider registration or ordering proposal proves disabled flag parity, default ordering behavior, rollback, and no runtime authority.
  - Any durable promotion proposal proves candidates cannot become durable facts without verifier, human, or deterministic-rule evidence and source episode/evidence refs.
  - Current-valid and historical query behavior remains covered for invalidated, expired, rejected, candidate, unpromoted, and verified facts.
  - Boundary scans prove no raw chat logs, raw trace dumps, services/exporters/databases, renderer bypasses, or memory-derived runtime authority were added.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 8 Runtime Memory Cutover Readiness

This task prepares the next evidence-gathering phase after Phase 7 accepted the Runtime Memory Provider foundation. Phase 8 must prove cutover readiness before any persistence, default-on provider behavior, default ordering change, or durable promotion path can be accepted.
