---
lifecycleStatus: archived
id: phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof
title: Phase 22 runtime memory readonly read hydration shadow build proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove the Runtime Memory readonly read-hydration shadow helper can be explicitly built as a developer/research-only runtime-core output while staying default-off, readonly, diagnostics-only, rollbackable, and outside package/dev/build/release default execution, SQLite selection, Gateway, Electron IPC, renderer, provider, TaskLoop, prompt assembly, and runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof.md
  - runtime-research/handoffs/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof/**
  - runtime-research/agent-runtime-index.md
  - scripts/build-openclaw-runtime.mjs
  - tests/unit/runtime-memory-read-hydration-shadow-build.test.ts
touchedAreas:
  - harness/specs/tasks/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof.md
  - runtime-research/handoffs/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof/**
  - runtime-research/agent-runtime-index.md
  - scripts/build-openclaw-runtime.mjs
  - tests/unit/runtime-memory-read-hydration-shadow-build.test.ts
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-operator-inspection.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - tests/unit/runtime-memory-read-hydration-shadow.test.ts
  - tests/unit/runtime-memory-operator-inspection.test.ts
expectedUserBehavior:
  - Default runtime behavior is unchanged; Phase 22 adds no product/UI/Gateway/provider/TaskLoop read path.
  - The new build proof is available only through direct developer invocation of `scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only`.
  - The build flag emits only `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js`.
  - The build flag builds source output only; it does not execute `hydrateRuntimeMemoryShadowContext`, does not call `readRuntimeMemoryHydrationShadow`, and does not open, create, read, write, migrate, or select SQLite.
  - `predev`, `dev`, `build`, `package`, and `release` do not invoke the hydration helper or the build-only flag.
  - Package/build scripts do not pass `--database`, do not pass `--read-shadow`, and do not implicitly enable `runtime.memory.persist` or helper-level `readShadow`.
  - Phase 21 helper behavior remains default-off, explicit opt-in, readonly, sanitized, bounded, diagnostics-only, and non-authoritative.
  - Output/source must not expose raw rows, `record_json`, raw task text, self-check, subagent/template/tool/env/secret/trace markers, facts/candidates raw records, provider context, or runtime authority.
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
  - treating Phase 21 accepted synthesis as permission for product/runtime read hydration cutover
  - package, build, dev, release, or predev scripts invoking the hydration helper or `--memory-read-hydration-shadow-only`
  - package or build scripts implicitly adding `--database`, `--read-shadow`, `--persist`, selecting a database path, or enabling database hydration during build/release
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - provider registry/provider ordering cutover, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/context/model-message injection, or automatic fact extraction/promotion
  - helper-level read shadow opt-in implying or enabling `runtime.memory.provider`, `runtime.memory.shadow`, `runtime.memory.proposeFacts`, provider output, TaskLoop output, or runtime authority
  - build proof calling migrate, ensure schema, write transaction, appendEpisode, appendFact, invalidateFact, trimRows, insert/update/delete, TaskLoop, provider hydration, database creation, table creation, or runtime authority logic
  - returning or emitting raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, `record_json`, raw rows, facts/candidates raw records, provider context, or runtime authority markers
  - service, exporter, database-service, listener, daemon, HTTP server, WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, or second runtime
featureFlags:
  - `runtime.memory.persist` remains default false and must be explicit before the helper may open an explicit existing database.
  - Helper-level `readShadow` remains default false and must be explicit before the helper may open an explicit existing database.
  - `runtime.memory.shadow`, `runtime.memory.provider`, and `runtime.memory.proposeFacts` remain unrelated and default false.
rollback:
  - Remove the `--memory-read-hydration-shadow-only` selection branch and the `runtime-core/memory-read-hydration-shadow` build entrypoint from `scripts/build-openclaw-runtime.mjs`.
  - Remove `tests/unit/runtime-memory-read-hydration-shadow-build.test.ts`.
  - Keep Phase 21 helper/source tests unchanged if the diagnostics helper remains useful.
  - Omit `runtime.memory.persist` or helper-level `readShadow` for no-open/no-read/no-write behavior.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 22 validate with `--no-diff` and record the blocker.
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-20-runtime-memory-readonly-operator-utility-packaging-proof.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-19-runtime-memory-readonly-operator-utility-command-proof.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-18-runtime-memory-readonly-operator-utility-build-proof.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-17-runtime-memory-readonly-operator-inspection-surface.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-16-runtime-memory-readonly-episode-inspection.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-15-runtime-memory-sanitized-episode-inspection.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-14-runtime-memory-taskloop-shadow-replay-proof.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-operator-inspection.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow-build.test.ts
  - node scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only
  - node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only
  - node scripts/build-openclaw-runtime.mjs
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'hydrateRuntimeMemoryShadowContext|readRuntimeMemoryHydrationShadow|memory-read-hydration-shadow|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts' openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts
  - node scripts/scan-pattern.mjs --pattern 'appendFact|invalidateFact|loadStore|queryFacts|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts|hydrateRuntimeMemoryShadowContext|readRuntimeMemoryHydrationShadow' openclaw_runtime/src/agents/task-loop-controller.ts
  - node scripts/scan-pattern.mjs --pattern 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|record_json|raw DB|raw row|self-check|subagent|template|facts/candidates raw|provider context|runtime authority' tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-read-hydration-shadow-build.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof.md openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service|daemon' openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-read-hydration-shadow-build.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof.md package.json scripts/build-openclaw-runtime.mjs
  - node scripts/scan-pattern.mjs --pattern 'migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows|insertInto|updateTable|deleteFrom' openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts scripts/build-openclaw-runtime.mjs
  - node scripts/scan-pattern.mjs --pattern '"(predev|dev|build|package|release)"\s*:\s*"[^"]*(hydrateRuntimeMemoryShadowContext|readRuntimeMemoryHydrationShadow|memory-read-hydration-shadow|--memory-read-hydration-shadow-only|--read-shadow|--database|--persist|gateway|server|listener|daemon|createServer|listen\()' package.json
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs only if Main/Gateway/host-api/api-client/provider transport paths are modified by Phase 22 or dirty communication-adjacent files block comms judgment.
acceptance:
  - Phase 22 starts only after Phase 21 synthesis exists, has exactly one `Status:` marker, and ends with exactly `Status: accepted`.
  - Phase 22 creates a fresh task spec and handoff and does not extend Phase 21 into product runtime cutover.
  - Focused tests prove the build flag exists, emits only the hydration helper output, does not execute the helper, does not invoke SQLite or database flags, and remains absent from package lifecycle scripts.
  - Boundary scans prove no Gateway/UI/provider/TaskLoop/runtime authority cutover and no package/build lifecycle implicit hydration behavior.
  - README sync review is recorded; README changes are required only if Phase 22 changes product behavior, UI, public runtime behavior, or user workflows.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 22 Runtime Memory Readonly Read Hydration Shadow Build Proof

Phase 22 adds only an explicit build proof for the Phase 21 readonly read-hydration shadow helper. It may build `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js` through `--memory-read-hydration-shadow-only`, but it does not execute the helper, select a database, enable persistence/readShadow, or add any product/runtime cutover.
