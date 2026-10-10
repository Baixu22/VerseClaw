---
lifecycleStatus: archived
id: phase-14-runtime-memory-taskloop-shadow-replay-proof
title: Phase 14 runtime memory TaskLoop shadow replay proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove a narrow follow-up to the Phase 13 TaskLoop shadow persistence pilot: when runtime.memory.shadow and runtime.memory.persist are both explicitly true, the real TaskLoop-to-Runtime-Memory adapter path persists exactly one sanitized terminal episode that can be replayed through the existing store, while all flags remain default false and no TaskLoop memory reads, provider cutover, Gateway route, raw retention, durable fact promotion, service, or runtime authority is introduced.
ownedPaths:
  - harness/specs/tasks/phase-14-runtime-memory-taskloop-shadow-replay-proof.md
  - runtime-research/handoffs/phase-14-runtime-memory-taskloop-shadow-replay-proof/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/task-loop-controller.test.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/runtime-core/memory-runtime-integration.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/runtime-core/memory-store.ts
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
touchedAreas:
  - tests/unit/task-loop-controller.test.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/config/**
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/api-client.ts
expectedUserBehavior:
  - With runtime.memory.shadow or runtime.memory.persist disabled or omitted, existing TaskLoop behavior remains unchanged and Runtime Memory persistence is not opened, read, or written.
  - With both runtime.memory.shadow and runtime.memory.persist explicitly true, Phase 14 may only prove the already accepted Phase 13 terminal TaskLoop episode shadow write through the real adapter/persistence path.
  - Replayed persisted content may be inspected only through the existing RuntimeMemoryStore test harness and must not participate in TaskLoop decisions, prompts, provider ordering, Gateway routes, renderer flows, completion gates, retries, tool permissions, verifier/security policy, or runtime authority.
  - The replayed terminal episode must remain bounded and sanitized. It must not retain raw task text, self-check text, transcript/jsonl content, trace dumps, prompts, full payloads, checkpoints, tool args/output, env, secrets, traceparent/tracestate/baggage, or provider context.
  - Phase 14 must not add or enable fact extraction, candidate promotion, durable LLM facts, default RuntimeMemoryProvider registration, provider output from runtime.memory.persist, service/exporter/database-service/listener/daemon work, HTTP/WebSocket routes, OTLP/Temporal integration, second Gateway, or second runtime.
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
  - treating Phase 13 accepted synthesis as broad cutover permission
  - default-on Runtime Memory recording, persistence, provider output, provider injection, provider ordering cutover, fact extraction, fact promotion, or prompt memory dump
  - TaskLoop memory reads, persisted-memory prompt injection, provider hydration from TaskLoop, Gateway/Electron/renderer/shared host contract memory routes, direct renderer IPC/Gateway calls, or provider registry default registration
  - runtime.memory.persist alone enabling TaskLoop writes or provider output
  - raw chat, transcript, jsonl, raw trace, prompt, payload, checkpoint, tool args, tool output, stdout, stderr, env, secret, traceparent, tracestate, or baggage retention
  - candidate facts, LLM-generated facts, rejected facts, invalidated facts, expired facts, or unpromoted facts becoming durable facts
  - service, exporter, database-service, listener, daemon, HTTP server, WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, second runtime, or external telemetry upload
  - memory-derived completion gate, verifier authority, security policy, retry policy, tool permission authority, runtime execution authority, provider ordering authority, or runtime authority
featureFlags:
  - runtime.memory.shadow remains default false and is required before the TaskLoop shadow episode write can run.
  - runtime.memory.persist remains default false and is required before the TaskLoop shadow episode write can run.
  - runtime.memory.provider remains default false and must not be enabled or implied by replay proof.
  - runtime.memory.proposeFacts remains default false and must not promote durable facts.
rollback:
  - Disable runtime.memory.shadow or runtime.memory.persist.
  - Omit the Phase 13 TaskLoop shadow episode writer call site if a later rollback removes the pilot.
  - Preserve existing Phase 9 persisted rows unless a later explicit migration or doctor policy accepts deletion.
  - Keep TaskLoop, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider readonly behavior, provider ordering, and Gateway/renderer contracts authoritative and unchanged.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-14-runtime-memory-taskloop-shadow-replay-proof.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-14-runtime-memory-taskloop-shadow-replay-proof.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
  - node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER' openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts
  - node scripts/scan-pattern.mjs --pattern 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER' openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/runtime-core/index.ts
  - node scripts/scan-pattern.mjs --pattern 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' <phase-14-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service' <phase-14-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'runtime\.memory\.persist|runtime\.memory\.shadow|createRuntimeMemoryPersistenceStore|RuntimeMemoryPersistence|runtime_memory_|openOpenClawStateDatabase|DatabaseSync|sqlite|jsonl|transcript' openclaw_runtime/src/runtime-core openclaw_runtime/src/context-engine openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/gateway electron shared src/lib tests/unit
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths are dirty or modified
acceptance:
  - Phase 14 starts only after Phase 13 synthesis exists, has exactly one Status marker, and ends with exactly Status: accepted.
  - Phase 14 creates a fresh task spec and handoff before implementation and does not extend Phase 13 into any broader cutover.
  - A focused TaskLoop test proves the real adapter/persistence path stores one sanitized terminal episode and replays it through RuntimeMemoryStore without TaskLoop memory reads, facts, provider hydration, raw retention, or changed TaskLoop results.
  - Disabled/omitted flag parity remains covered and proves no Runtime Memory open/read/write when either required flag is not explicitly true.
  - Boundary scans prove only the intended TaskLoop test/runtime-memory import surface exists, no Gateway/Electron/renderer/shared contract route was added, no provider default registration was added, no forbidden authority path was added, and no service/exporter/listener work was added.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 14 Runtime Memory TaskLoop Shadow Replay Proof

This task is a narrow hardening/proof follow-up to Phase 13. It accepts only replay evidence for the default-off dual-flag TaskLoop sanitized episode shadow persistence pilot. It does not accept TaskLoop memory reads, provider/Gateway/default-on cutover, automatic fact promotion, raw retention, service/listener/exporter work, or memory-derived runtime authority.
