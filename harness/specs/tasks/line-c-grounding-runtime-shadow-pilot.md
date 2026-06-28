---
id: line-c-grounding-runtime-shadow-pilot
title: Line C grounding runtime shadow pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a minimal explicit runtime shadow diagnostic pilot that lets the Context Provider Registry pilot call the accepted grounding shadow summary helper and emit bounded diagnostics/metadata-only output, without any authoritative runtime cutover.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md
  - runtime-research/handoffs/line-c-grounding-runtime-shadow-pilot/**
  - openclaw_runtime/src/context-engine/provider-registry.ts
  - tests/unit/context-provider-registry.test.ts
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-c-grounding-runtime-shadow-pilot/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - With no explicit grounding shadow pilot options, Context Provider Registry pilot output remains byte-shape compatible with the accepted readiness behavior: no new diagnostics, context items, provider results, provider ordering, or registry entries.
  - With explicit grounding shadow pilot options enabled, runtime may call the accepted grounding shadow summary helper and append diagnostics/metadata-only output for inspection.
  - Grounding shadow output must never affect completion, blocked, failed, retry, approval, security, provider selection, provider ordering, prompt assembly, memory promotion, TaskLoop state, Gateway behavior, renderer transport, tool policy, or runtime execution result.
  - Every emitted grounding item remains authority: "none", rawRetained: false, readonly, local, bounded, summary-only, shadow-only, diagnostic-only, and non-authoritative.
  - Untrusted refs are excluded by default; source and symbol refs remain anchors only; memory facts cannot be promoted from grounding output.
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
  - TaskLoop, Gateway, provider-ordering, default provider registration, prompt assembly, model-message, tool policy, or runtime execution cutover
  - completion, blocking, failure, retry, approval, security, provider selection, runtime state, verifier enforcement, or memory promotion decisions from grounding output
  - persistence, database, SQLite schema, JSONL sidecar, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, or external service
  - raw retention of prompts, chat logs, trace dumps, full traces, payloads, checkpoints, tool args, tool output, stdout, stderr, env, secrets, credentials, API keys, auth headers, traceparent, tracestate, baggage, or unbounded command output
  - renderer direct window.electron.ipcRenderer.invoke calls, direct Gateway HTTP calls, direct Gateway WebSocket calls, or renderer-owned transport switching
  - AST patch apply, workspace edit, rename, symbol edit apply, safe delete, or mutating patch-planner behavior
featureFlags:
  - No config/schema feature flag is required for this pilot.
  - The runtime call path must be default-off through an explicit optional pilot parameter.
  - The pilot may emit a skipped/no-output result only when explicitly asked; absent options must leave existing Context Provider Registry pilot behavior unchanged.
  - No flag or option may enable runtime authority, persistence, raw retention, default provider registration, provider ordering changes, renderer transport changes, memory fact promotion, or patch application.
rollback:
  - Stop passing the explicit grounding shadow pilot option to the Context Provider Registry pilot.
  - Remove the optional pilot parameter, diagnostic mapping, focused tests, and handoff docs.
  - No data migration or cleanup is required because this task must not add persistence, stores, sidecars, exporters, listeners, services, or raw retained artifacts.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
  - node node_modules/vitest/vitest.mjs run tests/unit/context-provider-registry.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-trace-context-provider.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components electron shared --glob '!**/*.md'
  - rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components --glob '!**/*.md'
  - rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|daemon|listener|service|database|sqlite|postgres|mysql|redis|sidecar' <line-c-runtime-shadow-pilot-touched-files>
  - rg -n 'raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|rawChat|raw chat|transcript import|jsonl import|full tool args|full tool output|toolArgs|toolOutput|stdout|stderr|process\.env|complete env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|includeRaw|rawRetained' <line-c-runtime-shadow-pilot-touched-files>
  - rg -n 'writeFile|appendFile|createWriteStream|mkdir|\.jsonl|\.sqlite|sqlite|kysely|better-sqlite3|database|persist|cache|store|sidecar' <line-c-runtime-shadow-pilot-touched-files>
  - rg -n 'applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply' <line-c-runtime-shadow-pilot-touched-files>
  - rg -n 'authority' <line-c-runtime-shadow-pilot-touched-files>
  - rg -n 'GroundingRef|GroundingQuery|grounding' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src --glob '!**/*.md'
  - rg -n 'createContextProviderRegistryPilot|runContextProviderRegistryPilot|LEGACY_CONTEXT_ENGINE_PROVIDER_ID|LOOP_CONTEXT_PACK_PROVIDER_ID' openclaw_runtime/src/context-engine/provider-registry.ts tests/unit/context-provider-registry.test.ts
acceptance:
  - Fresh task spec validates before implementation proceeds.
  - Design research is accepted before implementation proceeds.
  - Implementation adds only an explicit Context Provider Registry pilot diagnostic/metadata path that calls the accepted grounding shadow summary helper.
  - The optional pilot path is absent/default-off unless the caller passes explicit enabled options.
  - Explicit enabled output is diagnostics/metadata-only and never adds ContextItems, provider results used for prompt assembly, provider ordering, registry entries, runtime state changes, or execution decisions.
  - Grounding authority remains authority: "none" and rawRetained: false for all emitted summary items.
  - Helper output remains bounded by limit/tokenBudget, excludes untrusted refs by default, and does not leak raw metadata/sentinels.
  - Memory facts cannot be promoted from grounding shadow output.
  - Provider registry/default ordering remains unchanged.
  - No TaskLoop/Gateway/provider-ordering/default registration/runtime cutover, persistence/service/raw retention/renderer transport, or patch-apply boundary is touched.
  - Required validation commands and boundary scans pass or have documented benign policy/test-string-only matches.
docs:
  required: true
  files:
    - runtime-research/handoffs/line-c-grounding-runtime-shadow-pilot/design-research.md
    - runtime-research/handoffs/line-c-grounding-runtime-shadow-pilot/implementation-synthesis.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - README files are review-required after functional or architecture changes; update them only if user-visible behavior, flows, interfaces, or public docs changed.
    - This task is expected to be runtime-internal and not user-visible.
nextPhaseEntry:
  Allowed next phase:
    - a fresh accepted task spec may plan broader explicit runtime diagnostics only after this pilot is accepted
    - next work must still prove readonly, local, bounded, default-off, summary-only, non-authoritative behavior before runtime use
  Still forbidden:
    - TaskLoop, Gateway, provider-ordering, default provider registration, prompt assembly, model-message, runtime execution, persistence, exporter/listener/service, raw retention, memory promotion, renderer transport, or patch-apply cutover
---

# Line C Grounding Runtime Shadow Pilot

This task adds the first explicit runtime call path for accepted `GroundingRef` / `GroundingQuery` shadow summaries. The pilot is intentionally limited to Context Provider Registry diagnostics/metadata output and does not make grounding authoritative for runtime execution.

The accepted implementation surface is small: one optional default-off pilot parameter, one diagnostic/metadata mapper, focused tests, design research, and an implementation synthesis.
