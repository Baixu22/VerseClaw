---
id: line-c-grounding-diagnostics-consumers-cross-audit
title: Line C grounding diagnostics consumers cross-consumer boundary audit
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Audit the accepted Registry, Trace, Symbol, AgentMap, and Runtime Memory grounding diagnostics consumers as a cross-consumer diagnostics-only comparison, proving GroundingRef and GroundingQuery remain metadata/shadow summaries with no authoritative runtime, prompt, provider-ordering, memory-promotion, persistence, or mutation behavior.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md
  - runtime-research/handoffs/line-c-grounding-diagnostics-consumers-cross-audit/**
  - tests/unit/runtime-grounding-shadow-consumers.test.ts
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-c-grounding-diagnostics-consumers-cross-audit/**
  - tests/unit/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/runtime-core/**
expectedUserBehavior:
  - Existing TaskLoop execution, Gateway behavior, Main/renderer/host-api/api-client/provider transport, provider ordering, default provider registration, prompt assembly, model-message assembly, persistence, memory promotion, symbol mutation, patch application, and runtime execution decisions remain unchanged.
  - The audit may compare only Registry `groundingShadow` metadata and Trace, Symbol, AgentMap, and Runtime Memory `groundingDiagnostics` metadata shapes.
  - GroundingRef and GroundingQuery may appear only as readonly, local, bounded, summary-only, diagnostics/metadata-only, non-authoritative anchors/evidence links.
  - Every cross-consumer grounding marker keeps `authority: "none"` and `rawRetained: false`.
  - Refs remain anchors/evidence links only and must not become durable fact authority, prompt authority, provider ordering authority, verifier authority, memory promotion authority, patch mutation authority, or symbol mutation authority.
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
  - TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, WebSocket, HTTP proxy, or IPC behavior changes
  - provider default registration, provider ordering, provider ranking, provider selection, prompt assembly, model-message assembly, tool policy, or runtime execution cutover
  - completion, blocked, failed, retry, approval, security, verifier enforcement, runtime state, memory promotion, fact acceptance, episode write, memory store write, invalidation proposal acceptance, durable fact authority, prompt authority, or provider ordering authority from grounding output
  - persistence, database, SQLite schema, JSONL sidecar, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, or external service
  - raw retention of prompts, chat logs, trace dumps, full traces, payloads, checkpoints, tool args, tool output, stdout, stderr, env, secrets, credentials, API keys, auth headers, traceparent, tracestate, baggage, raw memory facts, raw episodes, transcripts, JSONL imports, or unbounded command output
  - renderer direct window.electron.ipcRenderer.invoke calls, direct Gateway HTTP calls, direct Gateway WebSocket calls, or renderer-owned transport switching
  - AST patch apply, workspace edit, rename, symbol edit apply, safe delete, symbol mutation, or mutating patch-planner behavior
featureFlags:
  - No config/schema feature flag is required or authorized for this audit.
  - Existing diagnostics options must remain explicit/default-off and diagnostics-only.
  - No flag or option may enable runtime authority, persistence, raw retention, default provider registration, provider ordering changes, renderer transport changes, prompt assembly, memory fact promotion, fact acceptance, episode writes, memory store writes, invalidation proposal acceptance, symbol mutation, or patch application.
rollback:
  - Remove the cross-consumer audit spec, handoff docs, and any focused cross-consumer invariant tests.
  - No data migration or cleanup is required because this task must not add persistence, stores, sidecars, exporters, listeners, services, raw retained artifacts, runtime wiring, provider registration, or mutation behavior.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-consumers-cross-audit.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-memory-diagnostics-consumer.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-agentmap-diagnostics-consumer.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-specific-diagnostics-consumers.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-trace-diagnostics-expansion.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components electron shared --glob '!**/*.md'
  - rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components --glob '!**/*.md'
  - rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|daemon|listener|service|database|sqlite|postgres|mysql|redis|sidecar' <line-c-cross-audit-touched-files>
  - rg -n 'raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|rawChat|raw chat|transcript import|jsonl import|full tool args|full tool output|toolArgs|toolOutput|stdout|stderr|process\.env|complete env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|includeRaw|rawRetained|raw memory|raw episode|raw fact' <line-c-cross-audit-touched-files>
  - rg -n 'writeFile|appendFile|createWriteStream|mkdir|\.jsonl|\.sqlite|sqlite|kysely|better-sqlite3|database|persist|cache|store|sidecar' <line-c-cross-audit-touched-files>
  - rg -n 'promote|promotion|acceptFact|fact acceptance|episode write|writeEpisode|insertEpisode|memory store write|invalidation proposal acceptance|acceptInvalidation|persist|saveFact|upsertFact' <line-c-cross-audit-touched-files>
  - rg -n 'applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply' <line-c-cross-audit-touched-files>
  - rg -n 'authority' <line-c-cross-audit-touched-files>
  - rg -n 'GroundingRef|GroundingQuery|grounding' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src --glob '!**/*.md'
  - rg -n 'createContextProviderRegistryPilot|runContextProviderRegistryPilot|LEGACY_CONTEXT_ENGINE_PROVIDER_ID|LOOP_CONTEXT_PACK_PROVIDER_ID|RUNTIME_TRACE_CONTEXT_PROVIDER_ID|SYMBOL_CONTEXT_PROVIDER_ID|AGENT_MAP_CONTEXT_PROVIDER_ID|RUNTIME_MEMORY_CONTEXT_PROVIDER_ID|groundingDiagnostics|groundingShadow' openclaw_runtime/src/context-engine/*.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts
acceptance:
  - Fresh task spec structural validation passes before audit implementation proceeds.
  - Design research is accepted before any focused test or metadata invariant fix proceeds.
  - Implementation is limited to cross-consumer unit tests, metadata marker drift fixes if found, and synthesis docs.
  - Registry `groundingShadow` and Trace, Symbol, AgentMap, and Runtime Memory `groundingDiagnostics` metadata are proven to share required diagnostics-only/no-authority markers.
  - Any drift fix remains metadata-only and does not add runtime call paths beyond existing accepted explicit/default-off diagnostics paths.
  - `authority` remains exactly `"none"` and `rawRetained` remains exactly `false` for all summary metadata and summary items.
  - `contextItems`, `evidenceRefs`, provider ordering, provider registration, prompt/model-message content, and runtime execution results remain unchanged.
  - Memory facts cannot be promoted from grounding diagnostics; no fact acceptance, episode write, memory persistence mutation, invalidation proposal acceptance, or side-effecting memory store call is added.
  - No TaskLoop/Gateway/Main/renderer/host-api/api-client/provider transport changes are made.
  - No persistence/service/cache/exporter/listener/raw retention/patch apply/symbol mutation boundary is touched.
  - Required validation commands and boundary scans pass or have documented benign policy/test-string-only matches.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - README files are review-required after functional or architecture changes; update them only if user-visible behavior, flows, interfaces, or public docs changed.
    - This task is expected to be runtime-internal, explicit, default-off, diagnostics-only, metadata-only, and not user-visible.
nextPhaseEntry:
  Allowed next phase:
    - a fresh accepted task spec may plan the next diagnostics-only Line C comparison or a separately accepted consumer readiness audit
    - next work may use GroundingRef and GroundingQuery only as readonly, local, bounded, default-off, summary-only, diagnostics/metadata-only, non-authoritative material unless a later accepted spec explicitly narrows another diagnostics-only path
  Still forbidden:
    - TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider-ordering, default provider registration, prompt assembly, model-message, runtime execution, persistence, exporter/listener/service/cache, raw retention, memory promotion, fact acceptance, episode writes, memory store writes, invalidation proposal acceptance, renderer transport, symbol mutation, or patch-apply cutover
---

# Line C Grounding Diagnostics Consumers Cross-Consumer Boundary Audit

This task audits the accepted Line C Registry, Trace, Symbol, AgentMap, and Runtime Memory diagnostics consumers as a single cross-consumer boundary proof.

The accepted surface is intentionally narrow: a fresh spec, design research, focused invariant tests or minimal metadata marker drift fixes, required validations/scans, and an implementation synthesis. It does not authorize TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, default registration, prompt assembly, persistence, memory promotion, raw retention, patch apply, symbol mutation, or any authoritative runtime cutover.
