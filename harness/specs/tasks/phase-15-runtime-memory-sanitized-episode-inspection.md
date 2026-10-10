---
lifecycleStatus: archived
id: phase-15-runtime-memory-sanitized-episode-inspection
title: Phase 15 runtime memory sanitized episode inspection
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove a narrow default-off operator/developer inspection slice for persisted sanitized Runtime Memory episodes: existing RuntimeMemoryPersistenceStore.loadStore().listEpisodes() can enumerate bounded sanitized episode summaries and safe statistics for proof/reporting without adding TaskLoop memory reads, prompt injection, provider ordering changes, Gateway/UI cutover, raw retention, durable fact authority, services, or runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-15-runtime-memory-sanitized-episode-inspection.md
  - runtime-research/handoffs/phase-15-runtime-memory-sanitized-episode-inspection/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-memory-runtime-integration.test.ts
  - tests/unit/task-loop-controller.test.ts
  - openclaw_runtime/src/runtime-core/memory-runtime-integration.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/runtime-core/memory-store.ts
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/context-engine/memory-context-provider.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
touchedAreas:
  - tests/unit/runtime-memory-runtime-integration.test.ts
  - tests/unit/task-loop-controller.test.ts
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/api-client.ts
expectedUserBehavior:
  - With runtime.memory.persist disabled or omitted, inspection is a no-open/no-read/no-write skipped result with an empty RuntimeMemoryStore snapshot.
  - With runtime.memory.persist explicitly true and an explicit database path/test option, existing loadStore().listEpisodes() may be used by tests/operator proof to enumerate persisted sanitized episode summaries.
  - Inspection output may include only episode id, task id, kind, reference_time, boundedSummary, source refs, evidence refs, redaction status, safe metadata, and bounded episode-only statistics.
  - Inspection output must not include raw DB rows, prompts, transcripts, task text, self-check text, subagent ids, templates, tool args/output, env, secrets, raw trace context, raw jsonl, checkpoint payloads, or provider context.
  - Inspection must not call TaskLoop, write or promote facts, invalidate facts, hydrate providers, change provider ordering, change Gateway/Electron/renderer/shared contracts, alter TaskLoop results/checkpoints/evidence verifier/security/retry/tool behavior, or become runtime authority.
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
  - treating Phase 14 accepted synthesis as broad cutover permission
  - default-on Runtime Memory persistence, provider output, provider injection, provider ordering, fact extraction, fact promotion, or prompt memory dump
  - TaskLoop memory reads, persisted-memory prompt injection, provider hydration from TaskLoop, Gateway/Electron/renderer/shared host contract memory routes, direct renderer IPC/Gateway calls, or provider registry default registration
  - runtime.memory.persist alone enabling TaskLoop writes, provider output, inspection side effects, or runtime authority
  - returning raw DB rows, record_json, chat logs, transcripts, jsonl, raw trace, prompt, payload, checkpoint, tool args, tool output, stdout, stderr, env, secret, traceparent, tracestate, baggage, or provider context in inspection output
  - candidate facts, LLM-generated facts, rejected facts, invalidated facts, expired facts, unpromoted facts, or inspection summaries becoming durable runtime facts
  - service, exporter, database-service, listener, daemon, HTTP server, WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, second runtime, or external telemetry upload
  - memory-derived completion gate, verifier authority, security policy, retry policy, tool permission authority, runtime execution authority, provider ordering authority, or runtime authority
featureFlags:
  - runtime.memory.persist remains default false and is required before persisted episode inspection may open/read the local store.
  - runtime.memory.shadow remains default false and is only relevant to TaskLoop episode writes, not inspection.
  - runtime.memory.provider remains default false and must not be enabled or implied by inspection.
  - runtime.memory.proposeFacts remains default false and must not promote durable facts.
rollback:
  - Disable runtime.memory.persist for inspection no-open/no-read/no-write behavior.
  - Disable runtime.memory.shadow to stop the TaskLoop shadow episode writer.
  - Omit any test/operator inspection helper code; preserve existing Phase 9 persisted rows unless a later explicit migration or doctor policy accepts deletion.
  - Keep TaskLoop, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider readonly behavior, provider ordering, and Gateway/renderer contracts authoritative and unchanged.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-15-runtime-memory-sanitized-episode-inspection.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-15-runtime-memory-sanitized-episode-inspection.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-14-runtime-memory-taskloop-shadow-replay-proof.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md
  - node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER' openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-runtime-integration.test.ts
  - node scripts/scan-pattern.mjs --pattern 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER|RuntimeMemoryProvider|createRuntimeMemoryContextProvider' openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/runtime-core/index.ts
  - node scripts/scan-pattern.mjs --pattern 'appendFact|invalidateFact|loadStore|queryFacts|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts' openclaw_runtime/src/agents/task-loop-controller.ts
  - node scripts/scan-pattern.mjs --pattern 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|record_json|raw DB|raw row' tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/task-loop-controller.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-15-runtime-memory-sanitized-episode-inspection.md
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service|daemon' tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/task-loop-controller.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-15-runtime-memory-sanitized-episode-inspection.md
  - node scripts/scan-pattern.mjs --pattern 'runtime\.memory\.persist|runtime\.memory\.shadow|createRuntimeMemoryPersistenceStore|RuntimeMemoryPersistence|runtime_memory_|openOpenClawStateDatabase|DatabaseSync|sqlite|jsonl|transcript' openclaw_runtime/src/runtime-core openclaw_runtime/src/context-engine openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/gateway electron shared src/lib tests/unit
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths are dirty or modified
acceptance:
  - Phase 15 starts only after Phase 14 synthesis exists, has exactly one Status marker, and ends with exactly Status: accepted.
  - Phase 15 creates a fresh task spec and handoff before implementation and does not extend Phase 14 into broad runtime cutover.
  - Focused tests prove persisted sanitized episode inspection can enumerate episode id, task id, kind, reference_time, boundedSummary, source/evidence refs, redaction status, safe metadata, and bounded episode-only statistics through loadStore().listEpisodes().
  - Disabled/omitted persist flag parity proves inspection does not open, read, or write SQLite.
  - Focused tests and scans prove inspection output excludes raw task text, self-check text, subagent ids, templates, tool/env/secret/trace markers, raw rows, record_json, provider context, and durable fact authority.
  - Boundary scans prove no Gateway/Electron/renderer/shared route was added, no provider default registration/order cutover was added, no TaskLoop memory read/fact/provider path was added, and no service/exporter/listener work was added.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 15 Runtime Memory Sanitized Episode Inspection

This task is a narrow proof follow-up to Phase 14. It accepts only default-off, operator/developer inspection of persisted sanitized episode summaries through the existing Runtime Memory store snapshot. It does not accept TaskLoop memory reads, provider/Gateway/default-on cutover, automatic fact promotion, raw retention, services/listeners/exporters, or memory-derived runtime authority.
