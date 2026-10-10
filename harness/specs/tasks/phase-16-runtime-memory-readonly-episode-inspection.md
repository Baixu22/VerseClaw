---
lifecycleStatus: archived
id: phase-16-runtime-memory-readonly-episode-inspection
title: Phase 16 runtime memory readonly episode inspection
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove a narrow default-off Runtime Memory inspection boundary for persisted sanitized episodes that is operator/developer-verifiable as read-only: disabled inspection opens/reads/writes no SQLite, enabled inspection reads only an explicit existing database/table without migration/schema/meta/idempotency/trim/fact/provider/TaskLoop side effects, and output remains sanitized episode summaries plus bounded episode-only statistics.
ownedPaths:
  - harness/specs/tasks/phase-16-runtime-memory-readonly-episode-inspection.md
  - runtime-research/handoffs/phase-16-runtime-memory-readonly-episode-inspection/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-memory-runtime-integration.test.ts
  - tests/unit/runtime-memory-persistence.test.ts
  - tests/unit/task-loop-controller.test.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/runtime-core/memory-runtime-integration.ts
  - openclaw_runtime/src/runtime-core/memory-store.ts
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/context-engine/memory-context-provider.ts
  - openclaw_runtime/src/context-engine/provider-registry.ts
touchedAreas:
  - harness/specs/tasks/phase-16-runtime-memory-readonly-episode-inspection.md
  - runtime-research/handoffs/phase-16-runtime-memory-readonly-episode-inspection/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-memory-runtime-integration.test.ts
  - tests/unit/runtime-memory-persistence.test.ts
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
  - With runtime.memory.persist disabled or omitted, readonly episode inspection returns a skipped no-open/no-read/no-write result.
  - With runtime.memory.persist explicitly true and an explicit existing database path/test database option, readonly inspection may enumerate persisted sanitized episode summaries without running migration, schema creation, meta writes, idempotency writes, retention trimming, fact writes, invalidations, provider hydration, or TaskLoop.
  - If the database file or runtime_memory_episodes table does not exist, inspection returns bounded diagnostics and creates no file/table.
  - Inspection output may include only episode id, task id, kind, reference_time, boundedSummary, source refs, evidence refs, redaction status, safe metadata, and bounded episode-only count/limit/truncated statistics.
  - Inspection output must not include raw DB rows, record_json, prompts, transcripts, task text, self-check text, subagent ids, templates, tool args/output, env, secrets, raw trace context, raw jsonl, checkpoint payloads, provider context, facts, candidates, invalidations, or durable runtime authority.
  - Inspection must not change TaskLoop results, checkpoints, evidence verifier, security, retry, tool behavior, provider ordering, Gateway/Electron/renderer/shared contracts, or runtime authority.
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
  - treating Phase 15 accepted synthesis as broad runtime cutover permission
  - default-on Runtime Memory persistence, provider output, provider injection, provider ordering, fact extraction, fact promotion, prompt memory dump, or inspection authority
  - using RuntimeMemoryPersistenceStore.loadStore() as proof of strict readonly inspection when it can migrate, ensure schema, write meta, create tables, or use a write transaction
  - readonly inspection calling migrate, ensure schema, write transaction, appendEpisode, appendFact, invalidateFact, trimRows, TaskLoop, provider hydration, Gateway, Electron, renderer, shared host contracts, api-client, or host-api
  - returning raw DB rows, record_json, chat logs, transcripts, jsonl, raw trace, prompt, payload, checkpoint, tool args, tool output, stdout, stderr, env, secret, traceparent, tracestate, baggage, provider context, facts, candidates, invalidations, or durable runtime decisions in inspection output
  - candidate facts, LLM-generated facts, rejected facts, invalidated facts, expired facts, unpromoted facts, or inspection summaries becoming durable runtime facts
  - service, exporter, database-service, listener, daemon, HTTP server, WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, second runtime, or external telemetry upload
  - memory-derived completion gate, verifier authority, security policy, retry policy, tool permission authority, runtime execution authority, provider ordering authority, or runtime authority
featureFlags:
  - runtime.memory.persist remains default false and is required before readonly inspection may open/read an explicit existing database.
  - runtime.memory.shadow remains default false and is only relevant to TaskLoop episode writes, not inspection.
  - runtime.memory.provider remains default false and must not be enabled or implied by inspection.
  - runtime.memory.proposeFacts remains default false and must not promote durable facts.
rollback:
  - Disable runtime.memory.persist for inspection no-open/no-read/no-write behavior.
  - Omit the readonly inspection helper/proof; keep Phase 15 loadStore() inspection only as a non-strict sanitized proof, not as operator read-only proof.
  - Disable runtime.memory.shadow to stop the TaskLoop shadow episode writer.
  - Preserve existing Phase 9 persisted rows unless a later explicit migration or doctor policy accepts deletion.
  - Keep TaskLoop, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, RuntimeMemoryProvider readonly behavior, provider ordering, and Gateway/renderer contracts authoritative and unchanged.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-16-runtime-memory-readonly-episode-inspection.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-16-runtime-memory-readonly-episode-inspection.md
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
  - node scripts/scan-pattern.mjs --pattern 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|memory-persistence|inspectRuntimeMemorySanitizedEpisodes|RUNTIME_MEMORY_PERSISTENCE_OWNER' openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-memory-persistence.test.ts
  - node scripts/scan-pattern.mjs --pattern 'memory-runtime-integration|createRuntimeMemoryRuntimeIntegration|RuntimeMemoryRuntimeIntegration|createRuntimeMemoryPersistenceStore|inspectRuntimeMemorySanitizedEpisodes|memory-persistence|RUNTIME_MEMORY_PERSISTENCE_OWNER|RuntimeMemoryProvider|createRuntimeMemoryContextProvider' openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/runtime-core/index.ts
  - node scripts/scan-pattern.mjs --pattern 'appendFact|invalidateFact|loadStore|queryFacts|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts|inspectRuntimeMemorySanitizedEpisodes' openclaw_runtime/src/agents/task-loop-controller.ts
  - node scripts/scan-pattern.mjs --pattern 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|record_json|raw DB|raw row' tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/task-loop-controller.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-16-runtime-memory-readonly-episode-inspection.md
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service|daemon' tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/task-loop-controller.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-16-runtime-memory-readonly-episode-inspection.md
  - node scripts/scan-pattern.mjs --pattern 'runtime\.memory\.persist|runtime\.memory\.shadow|createRuntimeMemoryPersistenceStore|inspectRuntimeMemorySanitizedEpisodes|RuntimeMemoryPersistence|runtime_memory_|openOpenClawStateDatabase|DatabaseSync|sqlite|jsonl|transcript' openclaw_runtime/src/runtime-core openclaw_runtime/src/context-engine openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/gateway electron shared src/lib tests/unit
  - node scripts/scan-pattern.mjs --pattern 'inspectRuntimeMemorySanitizedEpisodes[\s\S]*(migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows)' openclaw_runtime/src/runtime-core/memory-persistence.ts
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths are dirty or modified
acceptance:
  - Phase 16 starts only after Phase 15 synthesis exists, has exactly one Status marker, and ends with exactly Status: accepted.
  - Phase 16 creates a fresh task spec and handoff before implementation and does not extend Phase 15 into runtime behavior or product cutover.
  - Focused tests prove disabled/omitted persist flag inspection does not open, read, or write SQLite.
  - Focused tests prove enabled readonly inspection uses an explicit existing database path/test database option and lists only sanitized episode summaries/statistics.
  - Focused tests prove readonly inspection does not migrate schema, create a database, create runtime memory tables, update meta, write idempotency rows, trim rows, append episodes/facts/invalidations, hydrate providers, or call TaskLoop.
  - Focused tests and scans prove inspection output excludes raw task text, self-check text, subagent ids, templates, tool/env/secret/trace markers, raw rows, record_json, facts, candidates, provider context, and durable fact authority.
  - Boundary scans prove no Gateway/Electron/renderer/shared route was added, no provider default registration/order cutover was added, no TaskLoop memory read/fact/provider path was added, and no service/exporter/listener work was added.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 16 Runtime Memory Readonly Episode Inspection

This task is a narrow proof follow-up to Phase 15. It accepts only default-off, operator/developer-verifiable readonly inspection of persisted sanitized episode summaries from an explicit existing Runtime Memory SQLite database. It does not accept TaskLoop memory reads, provider/Gateway/default-on cutover, automatic fact promotion, raw retention, services/listeners/exporters, or memory-derived runtime authority.
