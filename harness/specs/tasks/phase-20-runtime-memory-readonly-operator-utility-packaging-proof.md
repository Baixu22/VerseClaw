---
lifecycleStatus: archived
id: phase-20-runtime-memory-readonly-operator-utility-packaging-proof
title: Phase 20 runtime memory readonly operator utility packaging proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove the Runtime Memory readonly operator/developer inspection utility remains discoverable and verifiable through explicit local package/build surfaces while staying default-off, readonly, sanitized-only, rollbackable, and outside Gateway, Electron IPC, renderer, provider, TaskLoop, prompt assembly, services, packaging lifecycle startup, and runtime authority.
ownedPaths:
  - harness/specs/tasks/phase-20-runtime-memory-readonly-operator-utility-packaging-proof.md
  - runtime-research/handoffs/phase-20-runtime-memory-readonly-operator-utility-packaging-proof/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-memory-operator-inspection.test.ts
touchedAreas:
  - harness/specs/tasks/phase-20-runtime-memory-readonly-operator-utility-packaging-proof.md
  - runtime-research/handoffs/phase-20-runtime-memory-readonly-operator-utility-packaging-proof/**
  - runtime-research/agent-runtime-index.md
  - package.json
  - openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - scripts/build-openclaw-runtime.mjs
  - tests/unit/runtime-memory-operator-inspection.test.ts
  - openclaw_runtime/src/runtime-core/memory-operator-inspection.ts
  - openclaw_runtime/src/runtime-core/memory-persistence.ts
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/host-api-client.ts
expectedUserBehavior:
  - Operator/developer inspection remains discoverable only through explicit local developer invocation of `runtime:memory:inspect` or the direct utility script.
  - `runtime:memory:inspect` remains exactly `node openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`.
  - `runtime:memory:inspect` does not pass `--persist`, does not pass `--database`, does not select a database path, and does not start Electron, Gateway, a server, listener, daemon, provider, TaskLoop, prompt assembly, or runtime authority path.
  - `predev`, `dev`, `build`, `package`, and `release` do not invoke `runtime:memory:inspect` or `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`.
  - Build/package scripts may build `openclaw_runtime/dist/runtime-core/memory-operator-inspection.js`, but they do not execute the inspector utility and do not open SQLite or output Runtime Memory data.
  - Utility `--help` still states readonly, default-off, explicit `--persist`, explicit `--database <path>`, built-runtime requirement, no runtime behavior effect, and no durable fact/runtime authority.
  - Without explicit `--persist` and an explicit existing database path, direct and package command paths remain no-open/no-create/no-write diagnostics.
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
  - treating Phase 19 accepted synthesis as permission for product/runtime cutover
  - package, build, dev, or release scripts implicitly invoking the inspector utility
  - package or build scripts implicitly adding `--persist`, implicitly selecting a database path, or enabling database inspection during build/release
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
  - Remove the `runtime:memory:inspect` package script if package-command discoverability must be rolled back.
  - Keep Phase 18 direct utility and Phase 17/16 helper surfaces as explicit readonly local inspection paths if still needed.
  - Remove the focused `memory-operator-inspection` runtime build entrypoint if built-output inspection proof is no longer needed.
  - Disable or omit `runtime.memory.persist` for no-open/no-read/no-write behavior.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-20-runtime-memory-readonly-operator-utility-packaging-proof.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-20-runtime-memory-readonly-operator-utility-packaging-proof.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 20 validate with `--no-diff` and record the blocker.
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
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-operator-inspection.test.ts
  - node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only
  - node scripts/build-openclaw-runtime.mjs
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'inspectRuntimeMemoryForOperator|inspectRuntimeMemorySanitizedEpisodes|createRuntimeMemoryPersistenceStore|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts' openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/agents/task-loop-controller.ts
  - node scripts/scan-pattern.mjs --pattern 'appendFact|invalidateFact|loadStore|queryFacts|RuntimeMemoryProvider|createRuntimeMemoryContextProvider|runtime\.memory\.provider|proposeFacts|inspectRuntimeMemorySanitizedEpisodes|inspectRuntimeMemoryForOperator' openclaw_runtime/src/agents/task-loop-controller.ts
  - node scripts/scan-pattern.mjs --pattern 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|record_json|raw DB|raw row|self-check|subagent|template|facts|candidates|provider|runtime authority' tests/unit/runtime-memory-operator-inspection.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-20-runtime-memory-readonly-operator-utility-packaging-proof.md openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|database-service|listener|exporter|service|daemon' openclaw_runtime/src/runtime-core/memory-operator-inspection.ts openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs tests/unit/runtime-memory-operator-inspection.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/phase-20-runtime-memory-readonly-operator-utility-packaging-proof.md package.json scripts/build-openclaw-runtime.mjs
  - node scripts/scan-pattern.mjs --pattern 'migrate|appendEpisode|appendFact|invalidateFact|ensureRuntimeMemoryPersistenceSchema|withWriteTransaction|trimRows|insertInto|updateTable|deleteFrom' openclaw_runtime/src/runtime-core/memory-operator-inspection.ts openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs
  - node scripts/scan-pattern.mjs --pattern '"(predev|dev|build|package|release)"\s*:\s*"[^"]*(runtime:memory:inspect|inspect-runtime-memory-episodes\.mjs|--persist|--database|gateway|server|listener|daemon|createServer|listen\()' package.json
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs if Main/Gateway/host-api/api-client/provider transport paths are modified by Phase 20 or dirty communication-adjacent files block comms judgment.
acceptance:
  - Phase 20 starts only after Phase 19 synthesis exists, has exactly one `Status:` marker, and ends with exactly `Status: accepted`.
  - Phase 20 creates a fresh task spec and handoff and does not extend Phase 19 into product runtime cutover.
  - Focused tests prove package script `--help`, package script pass-through, no implicit persist/database flags, lifecycle scripts do not invoke the inspector, build/package chains do not execute inspector or start database/server/listener surfaces, disabled/missing-input no-open/no-create diagnostics, explicit existing database sanitized JSON/text output, and no-mutation table counts.
  - Boundary scans prove no Gateway/UI/provider/TaskLoop/runtime authority cutover and no package/build lifecycle implicit persist/database behavior.
  - README sync review is recorded; README changes are required only if Phase 20 changes product behavior, UI, public runtime behavior, or user workflows.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 20 Runtime Memory Readonly Operator Utility Packaging Proof

Phase 20 proves the Phase 19 package command remains a local explicit readonly developer utility through packaging/build proof. It hardens only package/build lifecycle scans, no implicit invocation, no implicit persistence/database flags, sanitized output, rollback, and docs-validation evidence. It rejects Gateway, Electron IPC, renderer, host-api/api-client/shared, provider, TaskLoop, prompt, fact, service/exporter/listener, packaged runtime startup, and runtime-authority cutover.
