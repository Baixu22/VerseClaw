---
id: phase-19-runtime-memory-readonly-operator-utility-command-proof
title: Phase 19 runtime memory readonly operator utility command proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove the Runtime Memory readonly operator/developer inspection utility is discoverable through an explicit local package command while remaining default-off, readonly, no-open/no-create/no-write for disabled or incomplete inputs, sanitized-only for explicit existing databases, and outside Gateway, Electron, renderer, provider, TaskLoop, prompt assembly, services, and runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-19-runtime-memory-readonly-operator-utility-command-proof.md
  - runtime-research/handoffs/phase-19-runtime-memory-readonly-operator-utility-command-proof/**
  - runtime-research/agent-runtime-index.md
  - package.json
  - openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - tests/unit/runtime-memory-operator-inspection.test.ts
touchedAreas:
  - harness/specs/tasks/phase-19-runtime-memory-readonly-operator-utility-command-proof.md
  - runtime-research/handoffs/phase-19-runtime-memory-readonly-operator-utility-command-proof/**
  - runtime-research/agent-runtime-index.md
  - package.json
  - openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - tests/unit/runtime-memory-operator-inspection.test.ts
  - scripts/build-openclaw-runtime.mjs
  - openclaw_runtime/src/runtime-core/memory-operator-inspection.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/api-client.ts
expectedUserBehavior:
  - Operator/developer inspection is discoverable through the explicit local package script `runtime:memory:inspect`.
  - The package script is only `node openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`; it does not pass `--persist`, does not pass `--database`, and does not start Electron, Gateway, a server, listener, daemon, provider, TaskLoop, prompt assembly, or runtime authority path.
  - The local utility still loads the built Runtime Memory operator inspection module from `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js` only after explicit command invocation.
  - `--help` states readonly, default-off, explicit `--persist`, explicit `--database <path>`, existing built runtime output, no runtime behavior effect, and no durable fact/runtime authority.
  - Without `--persist`, the direct script and package script return skipped diagnostics and do not open, create, migrate, or write SQLite state.
  - With `--persist` but no `--database`, the direct script and package script return bounded diagnostics and do not open SQLite.
  - With an explicit missing database path, the direct script does not create the database file.
  - With an explicit existing database missing `runtime_memory_episodes`, inspection returns `table_missing` diagnostics and does not create Runtime Memory tables or meta rows.
  - With explicit persist true and an explicit existing Runtime Memory database/table, command output contains only sanitized episode summaries/statistics in JSON or text.
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
  - treating Phase 18 accepted synthesis as permission for product/runtime cutover
  - package script implicitly adding `--persist`, implicitly selecting a database path, or becoming an install/start/build lifecycle hook
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
  - Remove the `runtime:memory:inspect` package script.
  - Continue invoking `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs` directly only when local operator/developer inspection is needed.
  - Keep Phase 18 built utility proof, Phase 17 `inspectRuntimeMemoryForOperator(options)`, and Phase 16 `inspectRuntimeMemorySanitizedEpisodes(options)` as explicit readonly helper surfaces.
  - Disable or omit `runtime.memory.persist` for no-open/no-read/no-write behavior.
requiredTests:
  - rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-19-runtime-memory-readonly-operator-utility-command-proof.md
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-19-runtime-memory-readonly-operator-utility-command-proof.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 19 validate with `--no-diff` and record the blocker.
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-18-runtime-memory-readonly-operator-utility-build-proof.md --no-diff
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-17-runtime-memory-readonly-operator-inspection-surface.md --no-diff
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-16-runtime-memory-readonly-episode-inspection.md --no-diff
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-15-runtime-memory-sanitized-episode-inspection.md --no-diff
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-14-runtime-memory-taskloop-shadow-replay-proof.md --no-diff
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md --no-diff
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md --no-diff
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md --no-diff
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md --no-diff
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md --no-diff
  - rtk.exe node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only
  - rtk.exe node scripts/build-openclaw-runtime.mjs
  - rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-operator-inspection.test.ts
  - rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rtk.exe rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - rtk.exe rg -n 'inspectRuntimeMemoryForOperator|inspectRuntimeMemorySanitizedEpisodes|createRuntimeMemoryPersistenceStore|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts' openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts
  - rtk.exe rg -n 'appendFact|invalidateFact|loadStore|queryFacts|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts|inspectRuntimeMemorySanitizedEpisodes|inspectRuntimeMemoryForOperator' openclaw_runtime/src/agents/task-loop-controller.ts
  - rtk.exe rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|record_json|raw DB|raw row' tests/unit/runtime-memory-operator-inspection.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-19-runtime-memory-readonly-operator-utility-command-proof.md openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - rtk.exe rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service|daemon' openclaw_runtime/src/runtime-core/memory-operator-inspection.ts openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs tests/unit/runtime-memory-operator-inspection.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-19-runtime-memory-readonly-operator-utility-command-proof.md package.json
  - rtk.exe rg -n 'migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows|insertInto|updateTable|deleteFrom' openclaw_runtime/src/runtime-core/memory-operator-inspection.ts openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - rtk.exe rg -n '"runtime:memory:inspect"\s*:\s*"[^"]*(--persist|--database|electron|gateway|server|listener|daemon|createServer|listen\()' package.json
  - rtk.exe node scripts/comms/replay.mjs and rtk.exe node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths are modified by Phase 19 or dirty communication-adjacent files block comms judgment.
acceptance:
  - Phase 19 starts only after Phase 18 synthesis exists, has exactly one `Status:` marker, and ends with exactly `Status: accepted`.
  - Phase 19 creates a fresh task spec and handoff and does not extend Phase 18 into product runtime cutover.
  - `package.json` exposes `runtime:memory:inspect` only as a direct pass-through to `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`.
  - Focused tests prove package script `--help`, disabled/missing-input no-open/no-create diagnostics, explicit existing database sanitized JSON/text output, no-mutation table counts, and package script boundary content.
  - Boundary scans prove no Gateway/UI/provider/TaskLoop/runtime authority cutover and no package-script implicit persist/database behavior.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 19 Runtime Memory Readonly Operator Utility Command Proof

Phase 19 proves the Phase 18 explicit local utility is discoverable as an explicit developer package command. It hardens only command discoverability, help text, package-script no-implicit-flag behavior, sanitized command output, and rollback documentation. It rejects Gateway, Electron, renderer, host-api/api-client/shared, provider, TaskLoop, prompt, fact, service/exporter/listener, and runtime-authority cutover.
