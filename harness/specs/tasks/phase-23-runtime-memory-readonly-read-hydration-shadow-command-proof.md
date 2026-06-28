---
id: phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof
title: Phase 23 runtime memory readonly read hydration shadow command proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove the Runtime Memory readonly read-hydration shadow helper can be explicitly invoked through a local developer/research-only command while staying default-off, readonly, diagnostics-only, rollbackable, and outside package/dev/build/release default execution, SQLite default selection, Gateway, Electron IPC, renderer, provider, TaskLoop, prompt assembly, and runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof.md
  - runtime-research/handoffs/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof/**
  - runtime-research/agent-runtime-index.md
  - package.json
  - openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs
  - tests/unit/runtime-memory-read-hydration-shadow-command.test.ts
touchedAreas:
  - harness/specs/tasks/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof.md
  - runtime-research/handoffs/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof/**
  - runtime-research/agent-runtime-index.md
  - package.json
  - openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - openclaw_runtime/src/runtime-core/memory-operator-inspection.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - tests/unit/runtime-memory-read-hydration-shadow-command.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow-build.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow.test.ts
  - tests/unit/runtime-memory-operator-inspection.test.ts
expectedUserBehavior:
  - Default runtime behavior is unchanged; Phase 23 adds no product/UI/Gateway/provider/TaskLoop read path.
  - The command is available only through direct developer invocation of `openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs` or the explicit package script `runtime:memory:hydrate-shadow`.
  - The package script is a direct pass-through and does not pass `--persist`, `--read-shadow`, `--database`, or any database path.
  - The command requires all three explicit inputs, `--persist`, `--read-shadow`, and `--database <path>`, before SQLite can be opened.
  - Omitting any required input returns skipped diagnostics and does not open, create, migrate, write, or select SQLite.
  - Missing database paths are not created, and unrelated existing databases do not receive Runtime Memory tables.
  - Explicit existing Runtime Memory databases return only sanitized bounded episode summaries, sanitized fact projections, stats, diagnostics, and authority boundary markers.
  - `predev`, `dev`, `build`, `package`, and `release` do not invoke the hydration command, the hydration helper, or the build-only flag.
  - Phase 21/22 helper behavior remains default-off, explicit opt-in, readonly, sanitized, bounded, diagnostics-only, and non-authoritative.
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
  - treating Phase 22 accepted synthesis as permission for product/runtime read hydration cutover
  - package, build, dev, release, or predev scripts invoking the hydration command/helper or `--memory-read-hydration-shadow-only`
  - package or build scripts implicitly adding `--database`, `--read-shadow`, `--persist`, selecting a database path, or enabling database hydration during build/release
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - provider registry/provider ordering cutover, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/context/model-message injection, or automatic fact extraction/promotion
  - helper-level read shadow opt-in implying or enabling `runtime.memory.provider`, `runtime.memory.shadow`, `runtime.memory.proposeFacts`, provider output, TaskLoop output, or runtime authority
  - command or helper calling migrate, ensure schema, write transaction, appendEpisode, appendFact, invalidateFact, trimRows, insert/update/delete, TaskLoop, provider hydration, database creation, table creation, or runtime authority logic
  - returning or emitting raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, `record_json`, raw rows, facts/candidates raw records, provider context, or runtime authority markers
  - service, exporter, database-service, listener, daemon, HTTP server, WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, or second runtime
featureFlags:
  - `runtime.memory.persist` remains default false and must be explicit before the command may open an explicit existing database.
  - Helper-level `readShadow` remains default false and must be explicit before the command may open an explicit existing database.
  - The command must also require explicit `--database <path>` and must never select a default database path.
  - `runtime.memory.shadow`, `runtime.memory.provider`, and `runtime.memory.proposeFacts` remain unrelated and default false.
rollback:
  - Remove the `runtime:memory:hydrate-shadow` package script.
  - Remove `openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs`.
  - Remove `tests/unit/runtime-memory-read-hydration-shadow-command.test.ts`.
  - Keep Phase 21 helper and Phase 22 build proof unchanged if the diagnostics helper remains useful.
  - Omit `runtime.memory.persist`, helper-level `readShadow`, or `--database <path>` for no-open/no-read/no-write behavior.
requiredTests:
  - rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof.md
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 23 validate with `--no-diff` and record the blocker.
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof.md --no-diff
  - rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-21-runtime-memory-readonly-read-hydration-shadow-pilot.md --no-diff
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
  - rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow-command.test.ts
  - rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-read-hydration-shadow-build.test.ts tests/unit/runtime-memory-operator-inspection.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts
  - rtk.exe node scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only
  - rtk.exe node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only
  - rtk.exe node scripts/build-openclaw-runtime.mjs
  - rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rtk.exe rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - rtk.exe rg -n 'hydrateRuntimeMemoryShadowContext|readRuntimeMemoryHydrationShadow|memory-read-hydration-shadow|inspect-runtime-memory-hydration-shadow|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts' openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts
  - rtk.exe rg -n 'appendFact|invalidateFact|loadStore|queryFacts|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts|hydrateRuntimeMemoryShadowContext|readRuntimeMemoryHydrationShadow' openclaw_runtime/src/agents/task-loop-controller.ts
  - rtk.exe rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|record_json|raw DB|raw row|self-check|subagent|template|facts/candidates raw|provider context|runtime authority' tests/unit/runtime-memory-read-hydration-shadow-command.test.ts tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-read-hydration-shadow-build.test.ts runtime-research/handoffs/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof harness/specs/tasks/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof.md openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs
  - rtk.exe rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service|daemon' openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs tests/unit/runtime-memory-read-hydration-shadow-command.test.ts runtime-research/handoffs/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof harness/specs/tasks/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof.md package.json scripts/build-openclaw-runtime.mjs
  - rtk.exe rg -n 'migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows|insertInto|updateTable|deleteFrom' openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs
  - rtk.exe rg -n '"(predev|dev|build|package|release)"\s*:\s*"[^"]*(hydrateRuntimeMemoryShadowContext|readRuntimeMemoryHydrationShadow|memory-read-hydration-shadow|inspect-runtime-memory-hydration-shadow|--memory-read-hydration-shadow-only|--read-shadow|--database|--persist|gateway|server|listener|daemon|createServer|listen\()' package.json
  - rtk.exe node scripts/comms/replay.mjs and rtk.exe node scripts/comms/compare.mjs only if Main/Gateway/host-api/api-client/provider transport paths are modified by Phase 23 or dirty communication-adjacent files block comms judgment.
acceptance:
  - Phase 23 starts only after Phase 22 synthesis exists, has exactly one `Status:` marker, and ends with exactly `Status: accepted`.
  - Phase 23 creates a fresh task spec and handoff and does not extend Phase 22 into product runtime cutover.
  - Focused tests prove the command/help exists, requires explicit `--persist`, `--read-shadow`, and `--database <path>`, does not create/open without all required inputs, does not create missing databases or tables, and returns sanitized bounded diagnostics-only output for explicit existing Runtime Memory databases.
  - Package script proof shows `runtime:memory:hydrate-shadow` is direct pass-through and package lifecycle scripts do not call the command/helper or pass implicit persistence/read-shadow/database flags.
  - Boundary scans prove no Gateway/UI/provider/TaskLoop/runtime authority cutover and no package/build lifecycle implicit hydration behavior.
  - README sync review is recorded; README changes are required only if Phase 23 changes product behavior, UI, public runtime behavior, or user workflows.
docs:
  required: true
  files:
    - runtime-research/handoffs/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof/README.md
    - runtime-research/handoffs/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof/parallel-lanes.md
    - runtime-research/handoffs/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof/window-prompts.md
    - runtime-research/handoffs/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof/submission-template.md
---

# Phase 23 Runtime Memory Readonly Read Hydration Shadow Command Proof

Phase 23 adds only an explicit command proof for the Phase 21 readonly read-hydration shadow helper and Phase 22 built output. It may invoke `openclaw_runtime/dist/runtime-core/memory-read-hydration-shadow.js` through a local developer/research command, but it does not select a default database, enable persistence/readShadow implicitly, or add any product/runtime cutover.
