---
id: phase-18-runtime-memory-readonly-operator-utility-build-proof
title: Phase 18 runtime memory readonly operator utility build proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove the explicit local Runtime Memory readonly operator/developer inspection utility works from built OpenClaw runtime output while remaining default-off, no-open/no-create/no-write for disabled or incomplete inputs, sanitized-only for explicit existing databases, and outside Gateway, Electron, renderer, provider, TaskLoop, prompt assembly, services, and runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-18-runtime-memory-readonly-operator-utility-build-proof.md
  - runtime-research/handoffs/phase-18-runtime-memory-readonly-operator-utility-build-proof/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - tests/unit/runtime-memory-operator-inspection.test.ts
  - scripts/build-openclaw-runtime.mjs
touchedAreas:
  - harness/specs/tasks/phase-18-runtime-memory-readonly-operator-utility-build-proof.md
  - runtime-research/handoffs/phase-18-runtime-memory-readonly-operator-utility-build-proof/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - tests/unit/runtime-memory-operator-inspection.test.ts
  - scripts/build-openclaw-runtime.mjs
  - openclaw_runtime/src/runtime-core/memory-operator-inspection.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/host-api-client.ts
expectedUserBehavior:
  - Operator/developer inspection remains explicit local utility/helper invocation only.
  - The local utility loads the built Runtime Memory operator inspection module from `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js`; Phase 18 does not add a Gateway, Electron, renderer, shared contract, provider, TaskLoop, prompt, service, or runtime-authority entrypoint.
  - `--help` states readonly, default-off, explicit persist, explicit database path, existing built runtime output, no runtime behavior effect, and no durable fact/runtime authority.
  - Without `--persist`, the utility returns skipped diagnostics and does not open, create, migrate, or write SQLite state.
  - With `--persist` but no `--database`, the utility returns bounded diagnostics and does not open SQLite.
  - With an explicit missing database path, the utility returns bounded diagnostics and does not create the database file.
  - With an explicit existing database missing `runtime_memory_episodes`, the utility returns `table_missing` diagnostics and does not create Runtime Memory tables or meta rows.
  - With explicit persist true and an explicit existing Runtime Memory database/table, the utility returns only sanitized episode summaries/statistics in JSON or text.
  - Output must not include raw rows, `record_json`, chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret markers, facts, candidates, provider context, or runtime authority.
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
  - treating Phase 17 accepted synthesis as permission for product/runtime cutover
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - provider registry/provider ordering cutover, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/context injection, or automatic fact extraction/promotion
  - `runtime.memory.persist` implicitly enabling provider/shadow/proposeFacts/default runtime behavior
  - utility or helper calling migrate, ensure schema, write transaction, appendEpisode, appendFact, invalidateFact, trimRows, TaskLoop, provider hydration, database creation, table creation, or runtime authority logic
  - returning raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, `record_json`, raw rows, facts, candidates, invalidations, provider context, or runtime authority markers
  - service, exporter, database-service, listener, daemon, HTTP server, WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, or second runtime
featureFlags:
  - `runtime.memory.persist` remains default false and must be explicit before the utility may open an explicit existing database.
  - `runtime.memory.shadow` remains default false and is unrelated to operator utility inspection.
  - `runtime.memory.provider` remains default false and must not be enabled or implied by operator utility inspection.
  - `runtime.memory.proposeFacts` remains default false and must not be enabled or implied by operator utility inspection.
rollback:
  - Remove or stop invoking `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`.
  - Remove the built utility entrypoint from `scripts/build-openclaw-runtime.mjs` if the local built-runtime utility is no longer needed.
  - Keep Phase 17 `inspectRuntimeMemoryForOperator(options)` and Phase 16 `inspectRuntimeMemorySanitizedEpisodes(options)` as explicit readonly helper surfaces.
  - Disable or omit `runtime.memory.persist` for no-open/no-read/no-write behavior.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-18-runtime-memory-readonly-operator-utility-build-proof.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-18-runtime-memory-readonly-operator-utility-build-proof.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 18 validate with `--no-diff` and record the blocker.
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-17-runtime-memory-readonly-operator-inspection-surface.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-16-runtime-memory-readonly-episode-inspection.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-15-runtime-memory-sanitized-episode-inspection.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-14-runtime-memory-taskloop-shadow-replay-proof.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md --no-diff
  - node scripts/build-openclaw-runtime.mjs
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-operator-inspection.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'inspectRuntimeMemoryForOperator|inspectRuntimeMemorySanitizedEpisodes|createRuntimeMemoryPersistenceStore|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts' openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts
  - node scripts/scan-pattern.mjs --pattern 'appendFact|invalidateFact|loadStore|queryFacts|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts|inspectRuntimeMemorySanitizedEpisodes|inspectRuntimeMemoryForOperator' openclaw_runtime/src/agents/task-loop-controller.ts
  - node scripts/scan-pattern.mjs --pattern 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|record_json|raw DB|raw row' tests/unit/runtime-memory-operator-inspection.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-18-runtime-memory-readonly-operator-utility-build-proof.md openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service|daemon' openclaw_runtime/src/runtime-core/memory-operator-inspection.ts openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs tests/unit/runtime-memory-operator-inspection.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-18-runtime-memory-readonly-operator-utility-build-proof.md
  - node scripts/scan-pattern.mjs --pattern 'migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows|insertInto|updateTable|deleteFrom' openclaw_runtime/src/runtime-core/memory-operator-inspection.ts openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths are modified by Phase 18 or dirty communication-adjacent files block comms judgment.
acceptance:
  - Phase 18 starts only after Phase 17 synthesis exists, has exactly one `Status:` marker, and ends with exactly `Status: accepted`.
  - Phase 18 creates a fresh task spec and handoff and does not extend Phase 17 into product runtime cutover.
  - The app runtime build emits the built inspector module consumed by the explicit utility.
  - Focused tests prove utility `--help`, disabled/missing-input no-open/no-create diagnostics, missing-table no-create behavior, built-runtime JSON/text sanitized output, and no-mutation table counts.
  - Boundary scans prove no Gateway/UI/provider/TaskLoop/runtime authority cutover.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 18 Runtime Memory Readonly Operator Utility Build Proof

Phase 18 proves the Phase 17 operator/developer inspection surface is usable through the explicit local utility after the OpenClaw runtime build. It hardens only the local utility contract and build proof. It rejects Gateway, Electron, renderer, host-api/api-client/shared, provider, TaskLoop, prompt, fact, service/exporter/listener, and runtime-authority cutover.
