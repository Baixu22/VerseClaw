---
id: phase-21-runtime-memory-readonly-read-hydration-shadow-pilot
title: Phase 21 runtime memory readonly read hydration shadow pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a narrow, explicit, readonly Runtime Memory read-hydration shadow diagnostics helper that can read sanitized bounded projections from an existing Runtime Memory SQLite database without changing default runtime behavior, TaskLoop decisions, provider ordering, Gateway/Electron/UI routes, prompt assembly, package scripts, or runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot.md
  - runtime-research/handoffs/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - tests/unit/runtime-memory-read-hydration-shadow.test.ts
touchedAreas:
  - harness/specs/tasks/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot.md
  - runtime-research/handoffs/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/runtime-core/memory-store.ts
  - openclaw_runtime/src/runtime-core/memory-runtime-integration.ts
  - tests/unit/runtime-memory-read-hydration-shadow.test.ts
  - tests/unit/runtime-memory-operator-inspection.test.ts
  - tests/unit/runtime-memory-persistence.test.ts
  - tests/unit/runtime-memory-runtime-integration.test.ts
expectedUserBehavior:
  - Default runtime behavior is unchanged; Phase 21 adds no product/UI/Gateway/provider/TaskLoop read path.
  - The hydration shadow helper is diagnostics-only and callable only by explicit developer/test code.
  - The helper stays no-open/no-read/no-create/no-write unless both `runtime.memory.persist` and the helper-level `readShadow` opt-in are explicitly true and an explicit existing database path is provided.
  - Disabled, missing opt-in, missing database path, missing database file, or missing Runtime Memory tables return skipped diagnostics and do not open or create SQLite files.
  - Explicit existing Runtime Memory databases return bounded sanitized episode summaries and sanitized fact projections only.
  - Output must carry diagnostics-only/no-authority/no-prompt-injection markers and cannot be used as durable fact authority, runtime authority, provider ordering input, TaskLoop decision input, model prompt text, or context injection.
  - Output must not include raw rows, `record_json`, raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret markers, candidates/facts raw records, provider context, or runtime authority markers.
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
  - treating Phase 20 accepted synthesis as permission for product/runtime read hydration cutover
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - provider registry/provider ordering cutover, RuntimeMemoryProvider default registration, default provider hydration, TaskLoop memory reads, prompt/context injection, or automatic fact extraction/promotion
  - helper-level read shadow opt-in implying or enabling `runtime.memory.provider`, `runtime.memory.shadow`, `runtime.memory.proposeFacts`, provider output, TaskLoop output, or runtime authority
  - helper calling migrate, ensure schema, write transaction, appendEpisode, appendFact, invalidateFact, trimRows, insert/update/delete, TaskLoop, provider hydration, database creation, table creation, or runtime authority logic
  - returning raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, `record_json`, raw rows, facts/candidates raw records, provider context, or runtime authority markers
  - service, exporter, database-service, listener, daemon, HTTP server, WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, or second runtime
  - package, build, dev, or release scripts implicitly invoking the hydration shadow helper
featureFlags:
  - `runtime.memory.persist` remains default false and must be explicit before the helper may open an explicit existing database.
  - Helper-level `readShadow` remains default false and must be explicit before the helper may open an explicit existing database.
  - `runtime.memory.shadow`, `runtime.memory.provider`, and `runtime.memory.proposeFacts` remain unrelated and default false.
rollback:
  - Remove `openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts` and its barrel export.
  - Remove `tests/unit/runtime-memory-read-hydration-shadow.test.ts`.
  - Keep Phase 20/19/18/17 operator inspection surfaces unchanged.
  - Omit `runtime.memory.persist` or helper-level `readShadow` for no-open/no-read/no-write behavior.
requiredTests:
  - rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot.md
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 21 validate with `--no-diff` and record the blocker.
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-20-runtime-memory-readonly-operator-utility-packaging-proof.md --no-diff
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-19-runtime-memory-readonly-operator-utility-command-proof.md --no-diff
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
  - rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-operator-inspection.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts
  - rtk.exe node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only
  - rtk.exe node scripts/build-openclaw-runtime.mjs
  - rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rtk.exe rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - rtk.exe rg -n 'hydrateRuntimeMemoryShadowContext|readRuntimeMemoryHydrationShadow|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts' openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts
  - rtk.exe rg -n 'appendFact|invalidateFact|loadStore|queryFacts|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts|hydrateRuntimeMemoryShadowContext|readRuntimeMemoryHydrationShadow' openclaw_runtime/src/agents/task-loop-controller.ts
  - rtk.exe rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|record_json|raw DB|raw row|self-check|subagent|template|facts/candidates raw|provider context|runtime authority' tests/unit/runtime-memory-read-hydration-shadow.test.ts runtime-research/handoffs/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot harness/specs/tasks/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot.md openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - rtk.exe rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service|daemon' openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts tests/unit/runtime-memory-read-hydration-shadow.test.ts runtime-research/handoffs/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot harness/specs/tasks/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot.md package.json scripts/build-openclaw-runtime.mjs
  - rtk.exe rg -n 'migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows|insertInto|updateTable|deleteFrom' openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - rtk.exe rg -n '"(predev|dev|build|package|release)"\s*:\s*"[^"]*(hydrateRuntimeMemoryShadowContext|readRuntimeMemoryHydrationShadow|memory-read-hydration-shadow|--read-shadow|--database|gateway|server|listener|daemon|createServer|listen\()' package.json
  - rtk.exe node scripts/comms/replay.mjs and rtk.exe node scripts/comms/compare.mjs only if Main/Gateway/host-api/api-client/provider transport paths are modified by Phase 21 or dirty communication-adjacent files block comms judgment.
acceptance:
  - Phase 21 starts only after Phase 20 synthesis exists, has exactly one `Status:` marker, and ends with exactly `Status: accepted`.
  - Phase 21 creates a fresh task spec and handoff and does not extend Phase 20 into product runtime cutover.
  - Focused tests prove default-off no-open/no-create/no-read/no-write, missing explicit database path no-open, explicit missing database no-create, unrelated existing database no Runtime Memory table creation, explicit existing database sanitized bounded episode/fact projections, readonly open behavior, no mutation helper calls, and disabled parity.
  - Boundary scans prove no Gateway/UI/provider/TaskLoop/runtime authority cutover and no package/build lifecycle implicit hydration behavior.
  - README sync review is recorded; README changes are required only if Phase 21 changes product behavior, UI, public runtime behavior, or user workflows.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot/README.md
    - runtime-research/handoffs/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot/parallel-lanes.md
    - runtime-research/handoffs/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot/window-prompts.md
    - runtime-research/handoffs/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot/submission-template.md
---

# Phase 21 Runtime Memory Readonly Read Hydration Shadow Pilot

Phase 21 adds only a diagnostics-only read hydration shadow helper for explicit developer/test proof. It may read sanitized bounded projections from an explicit existing Runtime Memory SQLite database only when `runtime.memory.persist` and helper-level `readShadow` are explicitly true. It rejects Gateway, Electron IPC, renderer, host-api/api-client/shared, provider, TaskLoop, prompt, automatic fact promotion, package lifecycle, service/exporter/listener, and runtime-authority cutover.
