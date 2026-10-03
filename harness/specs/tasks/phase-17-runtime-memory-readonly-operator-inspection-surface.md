---
id: phase-17-runtime-memory-readonly-operator-inspection-surface
title: Phase 17 runtime memory readonly operator inspection surface
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a narrow explicit-call operator/developer inspection surface over Phase 16 Runtime Memory readonly sanitized episode inspection, while proving the surface stays default-off, requires explicit persistence and database path input, creates no SQLite files/tables, mutates no persisted rows, and does not become a Gateway/UI/provider/TaskLoop/runtime-authority cutover.
ownedPaths:
  - harness/specs/tasks/phase-17-runtime-memory-readonly-operator-inspection-surface.md
  - runtime-research/handoffs/phase-17-runtime-memory-readonly-operator-inspection-surface/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/memory-operator-inspection.ts
  - openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - tests/unit/runtime-memory-operator-inspection.test.ts
touchedAreas:
  - harness/specs/tasks/phase-17-runtime-memory-readonly-operator-inspection-surface.md
  - runtime-research/handoffs/phase-17-runtime-memory-readonly-operator-inspection-surface/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/memory-operator-inspection.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - tests/unit/runtime-memory-operator-inspection.test.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/api-client.ts
expectedUserBehavior:
  - Operator/developer inspection is available only by explicit utility/helper invocation, not through Gateway, Electron, renderer UI, providers, TaskLoop decisions, prompt assembly, or runtime authority.
  - With runtime.memory.persist disabled or omitted, the Phase 17 surface returns a skipped diagnostic and does not open, read, write, migrate, or create SQLite state.
  - With runtime.memory.persist explicitly true but no explicit database path, the surface returns a bounded diagnostic and does not open SQLite.
  - With an explicit missing database path, the surface returns a bounded diagnostic and does not create the database file.
  - With an explicit existing database missing runtime_memory_episodes, the surface returns a table_missing diagnostic and does not create tables or meta rows.
  - With explicit persist true and an explicit existing Runtime Memory database/table, the surface calls `inspectRuntimeMemorySanitizedEpisodes(options)` and returns only sanitized episode summaries/statistics.
  - Output may include only episode id, task id, kind, reference_time, boundedSummary, source refs, evidence refs, redaction status, safe metadata, count/limit/truncated/inspectedAt stats, and bounded diagnostics.
  - Output must not include raw rows, `record_json`, chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret markers, facts, candidates, provider context, or durable runtime authority.
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
  - treating Phase 16 accepted synthesis as permission for product/runtime cutover
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - provider registry/provider ordering cutover, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/context injection, or automatic fact extraction/promotion
  - `runtime.memory.persist` implicitly enabling provider/shadow/proposeFacts/default runtime behavior
  - inspection calling migrate, ensure schema, write transaction, appendEpisode, appendFact, invalidateFact, trimRows, TaskLoop, provider hydration, database creation, table creation, or runtime authority logic
  - returning raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, `record_json`, raw rows, facts, candidates, invalidations, provider context, or runtime authority markers
  - service, exporter, database-service, listener, daemon, HTTP server, WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, or second runtime
featureFlags:
  - `runtime.memory.persist` remains default false and must be explicit before the surface may open an explicit existing database.
  - `runtime.memory.shadow` remains default false and is unrelated to operator inspection.
  - `runtime.memory.provider` remains default false and must not be enabled or implied by operator inspection.
  - `runtime.memory.proposeFacts` remains default false and must not be enabled or implied by operator inspection.
rollback:
  - Remove or stop invoking the Phase 17 helper/script surface.
  - Keep Phase 16 `inspectRuntimeMemorySanitizedEpisodes(options)` as the internal readonly helper.
  - Disable or omit `runtime.memory.persist` for no-open/no-read/no-write behavior.
  - TaskLoop, provider ordering, Gateway/Electron/renderer/shared contracts, runtime authority, and existing persisted Runtime Memory rows remain unchanged.
requiredTests:
  - rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-17-runtime-memory-readonly-operator-inspection-surface.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-17-runtime-memory-readonly-operator-inspection-surface.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-16-runtime-memory-readonly-episode-inspection.md --no-diff
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-15-runtime-memory-sanitized-episode-inspection.md --no-diff
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-14-runtime-memory-taskloop-shadow-replay-proof.md --no-diff
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md --no-diff
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md --no-diff
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md --no-diff
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md --no-diff
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md --no-diff
  - rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-operator-inspection.test.ts
  - rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - rtk rg -n 'inspectRuntimeMemorySanitizedEpisodes|createRuntimeMemoryPersistenceStore|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts' openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts
  - rtk rg -n 'appendFact|invalidateFact|loadStore|queryFacts|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts|inspectRuntimeMemorySanitizedEpisodes' openclaw_runtime/src/agents/task-loop-controller.ts
  - rtk rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|record_json|raw DB|raw row' tests/unit/runtime-memory-operator-inspection.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-17-runtime-memory-readonly-operator-inspection-surface.md
  - rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service|daemon' openclaw_runtime/src/runtime-core/memory-operator-inspection.ts openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs tests/unit/runtime-memory-operator-inspection.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-17-runtime-memory-readonly-operator-inspection-surface.md
  - rtk rg -n 'migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows|insertInto|updateTable|deleteFrom' openclaw_runtime/src/runtime-core/memory-operator-inspection.ts openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - rtk node scripts/comms/replay.mjs and rtk node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths are modified by Phase 17 or block validation because of dirty communication-adjacent files.
acceptance:
  - Phase 17 starts only after Phase 16 synthesis exists, has exactly one Status marker, and ends with exactly Status: accepted.
  - Phase 17 creates a fresh task spec and handoff and does not extend Phase 16 into product runtime cutover.
  - The new surface explicitly calls/reuses `inspectRuntimeMemorySanitizedEpisodes(options)`.
  - Focused tests prove persist false/omitted, missing database path, missing database file, and missing episodes table are no-open/no-create/no-write bounded diagnostics.
  - Focused tests prove enabled inspection returns sanitized episode summaries/statistics and leaves meta/episodes/idempotency/facts/invalidations state unchanged.
  - Focused tests and scans prove output excludes raw rows, `record_json`, facts/candidates/provider markers/runtime authority markers, and raw task/tool/env/secret/trace markers.
  - Boundary scans prove no Gateway/UI/provider/TaskLoop/runtime authority cutover.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 17 Runtime Memory Readonly Operator Inspection Surface

Phase 17 promotes the Phase 16 readonly helper into a minimal explicit operator/developer surface. It accepts only readonly sanitized episode inspection through explicit invocation with explicit persistence intent and explicit database path. It rejects Gateway, UI, provider, TaskLoop, prompt, fact, service/exporter/listener, and runtime-authority cutover.
