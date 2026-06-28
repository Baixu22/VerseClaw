---
id: line-c-grounding-runtime-memory-diagnostics-consumer
title: Line C grounding Runtime Memory diagnostics consumer expansion
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a minimal explicit Runtime Memory Context Provider diagnostics-only grounding expansion that calls the accepted grounding shadow summary helper and emits bounded metadata-only output, proving GroundingRef/GroundingQuery can enter Runtime Memory provider diagnostics metadata without any authoritative runtime cutover, durable fact promotion, or persistence behavior change.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-runtime-memory-diagnostics-consumer.md
  - runtime-research/handoffs/line-c-grounding-runtime-memory-diagnostics-consumer/**
  - openclaw_runtime/src/context-engine/memory-context-provider.ts
  - tests/unit/runtime-memory-context-provider.test.ts
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-c-grounding-runtime-memory-diagnostics-consumer/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - With no explicit grounding diagnostics options, Runtime Memory Context Provider output remains unchanged: no new diagnostics, metadata, context items, evidence refs, provider ordering, registry entries, prompt content, TaskLoop state, Gateway behavior, renderer transport, memory fact promotion, memory persistence, or runtime execution result.
  - With explicit grounding diagnostics options enabled, Runtime Memory Context Provider may call the accepted grounding shadow summary helper and append diagnostics/metadata-only output for inspection.
  - Grounding diagnostics output must never affect completion, blocked, failed, retry, approval, security, provider selection, provider ordering, prompt assembly, memory fact promotion, fact acceptance, episode writes, memory store writes, invalidation proposal acceptance, TaskLoop state, Gateway behavior, renderer transport, tool policy, symbol mutation, patch apply, or runtime execution result.
  - Every emitted grounding item remains authority: "none", rawRetained: false, readonly, local, bounded, summary-only, shadow-only, diagnostic-only, and non-authoritative.
  - Untrusted refs are excluded by default. Runtime Memory source refs, evidence refs, file refs, symbol refs, trace refs, checkpoint refs, event refs, test refs, and tool refs are anchors/evidence links only; they cannot become durable fact authority, promotion authority, prompt authority, or provider ordering authority.
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
  - completion, blocking, failure, retry, approval, security, provider selection, runtime state, verifier enforcement, provider ordering, prompt authority, memory promotion, fact acceptance, episode write, memory store write, invalidation proposal acceptance, or durable fact authority decisions from grounding output
  - persistence, database, SQLite schema, JSONL sidecar, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, external service, or memory persistence API mutation
  - raw retention of prompts, chat logs, trace dumps, full traces, payloads, checkpoints, tool args, tool output, stdout, stderr, env, secrets, credentials, API keys, auth headers, traceparent, tracestate, baggage, raw memory facts, raw episodes, transcripts, JSONL imports, or unbounded command output
  - renderer direct window.electron.ipcRenderer.invoke calls, direct Gateway HTTP calls, direct Gateway WebSocket calls, or renderer-owned transport switching
  - AST patch apply, workspace edit, rename, symbol edit apply, safe delete, or mutating patch-planner behavior
featureFlags:
  - No config/schema feature flag is required for this diagnostics expansion.
  - The provider call path must be default-off through an explicit optional provider parameter.
  - The explicit provider parameter may emit a skipped/no-output diagnostic only when explicitly enabled and no refs survive sanitization; absent or disabled options must leave existing Runtime Memory Context Provider behavior unchanged.
  - No flag or option may enable runtime authority, persistence, raw retention, default provider registration, provider ordering changes, renderer transport changes, memory fact promotion, fact acceptance, episode writes, memory store writes, invalidation proposal acceptance, prompt assembly, symbol mutation, patch application, or Runtime Memory cutover.
rollback:
  - Stop passing the explicit grounding diagnostics option to Runtime Memory Context Provider construction.
  - Remove the optional provider parameter, diagnostic metadata mapping, focused tests, and handoff docs.
  - No data migration or cleanup is required because this task must not add persistence, stores, sidecars, exporters, listeners, services, raw retained artifacts, memory fact writes, episode writes, or provider-registration changes.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-runtime-memory-diagnostics-consumer.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-memory-diagnostics-consumer.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-agentmap-diagnostics-consumer.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-specific-diagnostics-consumers.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-trace-diagnostics-expansion.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-runtime-shadow-pilot.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md --no-diff
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-provider.test.ts
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components electron shared --glob '!**/*.md'
  - rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components --glob '!**/*.md'
  - rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|daemon|listener|service|database|sqlite|postgres|mysql|redis|sidecar' <line-c-runtime-memory-diagnostics-consumer-touched-files>
  - rg -n 'raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|rawChat|raw chat|transcript import|jsonl import|full tool args|full tool output|toolArgs|toolOutput|stdout|stderr|process\.env|complete env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|includeRaw|rawRetained|raw memory|raw episode|raw fact' <line-c-runtime-memory-diagnostics-consumer-touched-files>
  - rg -n 'writeFile|appendFile|createWriteStream|mkdir|\.jsonl|\.sqlite|sqlite|kysely|better-sqlite3|database|persist|cache|store|sidecar' <line-c-runtime-memory-diagnostics-consumer-touched-files>
  - rg -n 'promote|promotion|acceptFact|fact acceptance|episode write|writeEpisode|insertEpisode|memory store write|invalidation proposal acceptance|acceptInvalidation|persist|saveFact|upsertFact' <line-c-runtime-memory-diagnostics-consumer-touched-files>
  - rg -n 'applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply' <line-c-runtime-memory-diagnostics-consumer-touched-files>
  - rg -n 'authority' <line-c-runtime-memory-diagnostics-consumer-touched-files>
  - rg -n 'GroundingRef|GroundingQuery|grounding' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src --glob '!**/*.md'
  - rg -n 'createContextProviderRegistryPilot|runContextProviderRegistryPilot|LEGACY_CONTEXT_ENGINE_PROVIDER_ID|LOOP_CONTEXT_PACK_PROVIDER_ID|RUNTIME_MEMORY_CONTEXT_PROVIDER_ID|groundingDiagnostics' openclaw_runtime/src/context-engine/memory-context-provider.ts openclaw_runtime/src/context-engine/provider-registry.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/context-provider-registry.test.ts
acceptance:
  - Fresh task spec validates before implementation proceeds.
  - Design research is accepted before implementation proceeds.
  - Implementation adds only an explicit Runtime Memory Context Provider diagnostic/metadata path that calls the accepted grounding shadow summary helper.
  - The optional path is absent/default-off unless the caller passes explicit enabled options.
  - Explicit enabled output is diagnostics/metadata-only and never adds or changes ContextItems, evidenceRefs, provider results used for prompt assembly, provider ordering, registry entries, runtime state changes, memory facts, fact candidates, fact acceptance, episode writes, memory store writes, invalidation proposal acceptance, symbol mutations, patch application, or execution decisions.
  - Grounding authority remains authority: "none" and rawRetained: false for all emitted summary items.
  - Helper output remains bounded by limit/tokenBudget, excludes untrusted refs by default, and does not leak raw metadata/sentinels.
  - Runtime Memory source/evidence refs remain anchors/evidence links only and do not become durable fact authority, promotion authority, prompt authority, or provider ordering authority.
  - Memory facts cannot be promoted from grounding diagnostics output.
  - No fact acceptance, episode write, memory persistence mutation, invalidation proposal acceptance, or side-effecting memory store call is added.
  - Provider registry/default ordering remains unchanged.
  - No TaskLoop/Gateway/provider-ordering/default registration/runtime cutover, persistence/service/raw retention/renderer transport, symbol mutation, or patch-apply boundary is touched.
  - Required validation commands and boundary scans pass or have documented benign policy/test-string-only matches.
docs:
  required: true
  files:
    - runtime-research/handoffs/line-c-grounding-runtime-memory-diagnostics-consumer/design-research.md
    - runtime-research/handoffs/line-c-grounding-runtime-memory-diagnostics-consumer/implementation-synthesis.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - README files are review-required after functional or architecture changes; update them only if user-visible behavior, flows, interfaces, or public docs changed.
    - This task is expected to be runtime-internal, explicit, default-off, diagnostics-only, and not user-visible.
nextPhaseEntry:
  Allowed next phase:
    - a fresh accepted task spec may plan another specific diagnostics consumer or broader diagnostics-only comparison after this Runtime Memory provider metadata path is accepted
    - next work must still prove readonly, local, bounded, default-off, summary-only, diagnostics/metadata-only, non-authoritative behavior before runtime use
  Still forbidden:
    - TaskLoop, Gateway, provider-ordering, default provider registration, prompt assembly, model-message, runtime execution, persistence, exporter/listener/service, raw retention, memory promotion, fact acceptance, episode writes, memory store writes, invalidation proposal acceptance, renderer transport, symbol mutation, or patch-apply cutover
---

# Line C Grounding Runtime Memory Diagnostics Consumer Expansion

This task expands the accepted Line C runtime shadow, Trace diagnostics, Symbol diagnostics, and AgentMap diagnostics work into the Runtime Memory Context Provider's diagnostics metadata path. The output remains explicit, default-off, diagnostics/metadata-only, bounded, sanitized, and non-authoritative.

The accepted implementation surface is intentionally small: one optional Runtime Memory Context Provider diagnostics parameter, one metadata mapper, focused tests, design research, and an implementation synthesis. It does not authorize any durable memory fact promotion, fact acceptance, episode write, memory persistence, provider ordering, prompt assembly, TaskLoop, Gateway, renderer transport, or patch-apply behavior.
