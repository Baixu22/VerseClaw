---
id: phase-26-runtime-memory-readonly-read-hydration-shadow-release-artifact-manifest-boundary-proof
title: Phase 26 runtime memory readonly read hydration shadow release artifact manifest boundary proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prove the Runtime Memory readonly read-hydration shadow command, helper source, and built helper may be listed or copied by release artifact manifests, packaged resources, extraResources, asar, or asarUnpack-adjacent boundaries only as inert explicit developer diagnostics, with no packaged app startup, release hook, bundle hook, Gateway, Electron, renderer, host-api/api-client, provider registry, TaskLoop, prompt/model context, SQLite, durable fact authority, or runtime authority invocation.
ownedPaths:
  - harness/specs/tasks/phase-26-runtime-memory-readonly-read-hydration-shadow-release-artifact-manifest-boundary-proof.md
  - runtime-research/handoffs/phase-26-runtime-memory-readonly-read-hydration-shadow-release-artifact-manifest-boundary-proof/**
  - runtime-research/agent-runtime-index.md
  - tests/unit/runtime-memory-read-hydration-shadow-release-artifact-manifest-boundary.test.ts
touchedAreas:
  - harness/specs/tasks/phase-26-runtime-memory-readonly-read-hydration-shadow-release-artifact-manifest-boundary-proof.md
  - runtime-research/handoffs/phase-26-runtime-memory-readonly-read-hydration-shadow-release-artifact-manifest-boundary-proof/**
  - runtime-research/agent-runtime-index.md
  - package.json
  - electron-builder.yml
  - scripts/build-openclaw-runtime.mjs
  - scripts/bundle-openclaw-runtime.mjs
  - scripts/after-pack.cjs
  - scripts/run-electron-builder.mjs
  - openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs
  - openclaw_runtime/src/runtime-core/memory-read-hydration-shadow.ts
  - electron/main/index.ts
  - electron/preload/index.ts
  - src/App.tsx
  - openclaw_runtime/src/entry.ts
  - tests/unit/runtime-memory-read-hydration-shadow-release-artifact-manifest-boundary.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow-packaged-artifact-boundary.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow-command-packaging.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow-command.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow-build.test.ts
  - tests/unit/runtime-memory-read-hydration-shadow.test.ts
expectedUserBehavior:
  - Default runtime behavior is unchanged; Phase 26 adds no product/UI/Gateway/provider/TaskLoop read path.
  - Release artifact manifests and packaged resource declarations may include `build/openclaw-runtime/` or copied runtime source artifacts, but they do not invoke `runtime:memory:hydrate-shadow`, the command script, helper exports, or the helper-only build flag.
  - `asar`, `asarUnpack`, `extraResources`, `afterPack`, `run-electron-builder`, bundle, package, build, dev, and release paths do not pass `--persist`, `--read-shadow`, `--database`, or `--db`.
  - Packaged app entrypoints remain `dist-electron/main/index.js`, preload, renderer, and runtime entry startup paths, none of which import or invoke read hydration.
  - The command still requires explicit `--persist`, `--read-shadow`, and `--database <path>` before SQLite can open; missing inputs and missing database paths remain no-open/no-create/no-write.
  - Explicit existing Runtime Memory databases return only sanitized bounded diagnostics JSON/text, with no prompt/model/provider/runtime authority.
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
  - treating Phase 25 accepted synthesis as permission for product/runtime read hydration cutover
  - release artifact manifest, packaged resource, extraResources, asar, asarUnpack, afterPack, run-electron-builder, bundle, package, build, dev, release, or packaged app startup invoking hydration
  - package or build scripts implicitly adding `--database`, `--db`, `--read-shadow`, `--persist`, selecting a database path, or enabling database hydration during build/release
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - provider registry/provider ordering cutover, RuntimeMemoryProvider default registration, TaskLoop memory reads, prompt/context/model-message injection, or automatic fact extraction/promotion
  - command or helper calling migrate, ensure schema, write transaction, appendEpisode, appendFact, invalidateFact, trimRows, insert/update/delete, TaskLoop, provider hydration, database creation, table creation, or runtime authority logic
  - returning or emitting raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, `record_json`, raw rows, facts/candidates raw records, provider context, durable fact authority, or runtime authority markers
  - service, exporter, database-service, listener, daemon, HTTP server, WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, or second runtime
featureFlags:
  - `runtime.memory.persist` remains default false and must be explicit before the command may open an explicit existing database.
  - Helper-level `readShadow` remains default false and must be explicit before the command may open an explicit existing database.
  - The command must also require explicit `--database <path>` and must never select a default database path.
  - `runtime.memory.shadow`, `runtime.memory.provider`, and `runtime.memory.proposeFacts` remain unrelated and default false.
rollback:
  - Remove `tests/unit/runtime-memory-read-hydration-shadow-release-artifact-manifest-boundary.test.ts`.
  - Remove this Phase 26 spec and handoff package.
  - Revert the Phase 26 addendum in `runtime-research/agent-runtime-index.md`.
  - Keep Phase 21/22/23/24/25 helper, build, command, package, and packaged-artifact behavior unchanged if the diagnostics command remains useful.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/phase-26-runtime-memory-readonly-read-hydration-shadow-release-artifact-manifest-boundary-proof.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-26-runtime-memory-readonly-read-hydration-shadow-release-artifact-manifest-boundary-proof.md
  - If full diff-aware validate is blocked by unrelated dirty files, run Phase 26 validate with `--no-diff` and record the blocker.
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-25-runtime-memory-readonly-read-hydration-shadow-packaged-artifact-boundary-proof.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-24-runtime-memory-readonly-read-hydration-shadow-command-packaging-proof.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-23-runtime-memory-readonly-read-hydration-shadow-command-proof.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-22-runtime-memory-readonly-read-hydration-shadow-build-proof.md --no-diff
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
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-shadow-release-artifact-manifest-boundary.test.ts tests/unit/runtime-memory-read-hydration-shadow-packaged-artifact-boundary.test.ts tests/unit/runtime-memory-read-hydration-shadow-command-packaging.test.ts tests/unit/runtime-memory-read-hydration-shadow-command.test.ts tests/unit/runtime-memory-read-hydration-shadow-build.test.ts tests/unit/runtime-memory-read-hydration-shadow.test.ts tests/unit/runtime-memory-operator-inspection.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts
  - node scripts/build-openclaw-runtime.mjs --memory-read-hydration-shadow-only
  - node scripts/build-openclaw-runtime.mjs --memory-operator-inspection-only
  - node scripts/build-openclaw-runtime.mjs
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'runtime:memory:hydrate-shadow|inspect-runtime-memory-hydration-shadow|memory-read-hydration-shadow|hydrateRuntimeMemoryShadowContext|readRuntimeMemoryHydrationShadow|--memory-read-hydration-shadow-only|--read-shadow|--database|--db|--persist' electron-builder.yml scripts/bundle-openclaw-runtime.mjs scripts/after-pack.cjs scripts/run-electron-builder.mjs electron/main/index.ts electron/preload/index.ts src/App.tsx openclaw_runtime/src/entry.ts
  - node scripts/scan-pattern.mjs --pattern '"(predev|dev|build|build:runtime|package|package:mac|package:mac:local|package:win|package:linux|release)"\s*:\s*"[^"]*(runtime:memory:hydrate-shadow|hydrateRuntimeMemoryShadowContext|readRuntimeMemoryHydrationShadow|memory-read-hydration-shadow|inspect-runtime-memory-hydration-shadow|--memory-read-hydration-shadow-only|--read-shadow|--database|--db|--persist|gateway|server|listener|daemon|createServer|listen\()' package.json
acceptance:
  - Phase 26 starts only after Phase 25 synthesis exists, has exactly one terminal `Status:` marker, and ends with accepted.
  - Phase 26 creates a fresh task spec and handoff and does not extend Phase 25 into product runtime cutover.
  - Focused tests prove release artifact manifests, packaged resources, extraResources, asar, asarUnpack, and packaged entrypoints remain proof-only/no-invocation surfaces.
  - Existing Phase 21/22/23/24/25 tests continue proving explicit opt-in, no default DB, no missing DB creation, no unrelated DB table creation, readonly behavior, and sanitized bounded diagnostics-only output.
  - Boundary scans prove no Gateway/UI/provider/TaskLoop/runtime authority cutover and no package/build/release lifecycle implicit hydration behavior.
  - README sync review is recorded; README changes are required only if Phase 26 changes product behavior, UI, public runtime behavior, release-facing docs, or user workflows.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 26 Runtime Memory Readonly Read Hydration Shadow Release Artifact Manifest Boundary Proof

Phase 26 adds only release artifact manifest, packaged resource, extraResources, asar/asarUnpack, and packaged entrypoint no-invocation proof for the Phase 25 explicit local diagnostic command. It may add focused static tests and research artifacts. It does not add any new product/runtime read-hydration path.
