---
id: line-c-grounding-shadow-consumers-readiness
title: Line C grounding shadow consumers readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add explicit readonly/default-off shadow consumer summary helpers for existing GroundingRef and GroundingQuery producer output so Runtime Memory, AgentMap, Symbol, and Trace Context consumers can inspect bounded diagnostic summaries before any runtime cutover.
ownedPaths:
  - harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md
  - runtime-research/handoffs/line-c-grounding-shadow-consumers-readiness/**
  - openclaw_runtime/src/runtime-core/grounding-shadow-consumers.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-grounding-shadow-consumers.test.ts
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-c-grounding-shadow-consumers-readiness/**
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/**
  - tests/unit/**
expectedUserBehavior:
  - Existing TaskLoop execution, Gateway behavior, provider ordering, default context provider registration, renderer/Main transport, runtime completion/blocking/retry/approval/security decisions, and memory promotion remain unchanged.
  - Shadow consumer helpers are callable only through explicit helper functions and remain default-off unless the caller opts into the diagnostic summary.
  - Shadow consumer output is readonly, local, bounded, summary-only, and non-authoritative. Every returned grounding marker keeps authority: "none" and rawRetained: false.
  - Runtime Memory, AgentMap, Symbol, and Trace Context consumers can receive diagnostic grounding summaries derived from already sanitized GroundingRef/GroundingQuery or already sanitized producer refs/summaries.
  - Untrusted grounding refs are excluded by default. Any future include-untrusted path must be explicit, diagnostic-only, and must not change runtime authority.
  - Source and symbol refs remain anchors and relevance links only; they do not replace verifier evidence, human approval, or deterministic promotion rules.
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
  - TaskLoop, Gateway, provider-ordering, default provider registration, prompt assembly, model-message, or runtime execution cutover
  - completion, blocking, failure, retry, approval, security, provider selection, runtime state, verifier enforcement, or memory promotion decisions from grounding output
  - persistence, database, SQLite schema, JSONL sidecar, cache, store, exporter, listener, service, daemon, HTTP server, WebSocket server, telemetry upload, or external service
  - raw retention of prompts, chat logs, trace dumps, full traces, payloads, checkpoints, tool args, tool output, stdout, stderr, env, secrets, credentials, API keys, auth headers, traceparent, tracestate, baggage, or unbounded command output
  - renderer direct window.electron.ipcRenderer.invoke calls, direct Gateway HTTP calls, direct Gateway WebSocket calls, or renderer-owned transport switching
  - AST patch apply, workspace edit, rename, symbol edit apply, safe delete, or mutating patch-planner behavior
featureFlags:
  - No config/schema flag is required for this readiness slice.
  - Helper output must be default-off through explicit helper options and must remain shadowOnly/diagnosticOnly when enabled.
  - No flag may enable runtime authority, persistence, raw retention, default provider registration, provider ordering changes, renderer transport changes, memory fact promotion, or patch application.
rollback:
  - Stop importing the explicit shadow consumer helper functions.
  - Remove the runtime-core shadow consumer helper file and focused tests.
  - No data migration or cleanup is required because this task must not add persistence, stores, sidecars, exporters, listeners, services, or raw retained artifacts.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-shadow-consumers-readiness.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts tests/unit/context-provider-registry.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/runtime-trace-context-provider.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components electron shared --glob '!**/*.md'
  - rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components --glob '!**/*.md'
  - rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|daemon|listener|service|database|sqlite|postgres|mysql|redis|sidecar' <line-c-shadow-consumer-touched-files>
  - rg -n 'raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|rawChat|raw chat|transcript import|jsonl import|full tool args|full tool output|toolArgs|toolOutput|stdout|stderr|process\.env|complete env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|includeRaw|rawRetained' <line-c-shadow-consumer-touched-files>
  - rg -n 'writeFile|appendFile|createWriteStream|mkdir|\.jsonl|\.sqlite|sqlite|kysely|better-sqlite3|database|persist|cache|store|sidecar' <line-c-shadow-consumer-touched-files>
  - rg -n 'applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply' <line-c-shadow-consumer-touched-files>
  - rg -n 'authority' <line-c-shadow-consumer-touched-files>
  - rg -n 'GroundingRef|GroundingQuery|grounding' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src --glob '!**/*.md'
acceptance:
  - Fresh task spec validates before implementation proceeds.
  - Implementation adds only explicit shadow consumer readiness helpers/adapters, tests, and handoff docs.
  - Helpers are readonly, local, bounded by limit/tokenBudget, default-off, summary-only, non-authoritative, and expose no raw data.
  - All helper outputs carry authority: "none", rawRetained: false, shadowOnly: true, diagnosticOnly: true, summaryOnly: true, and noRuntimeAuthority: true.
  - Runtime Memory, AgentMap, Symbol, and Trace Context have explicit callable grounding shadow summary adapters.
  - Untrusted refs are excluded by default; raw metadata/sentinel values do not survive output.
  - Source and symbol refs remain anchors only and cannot replace verifier evidence.
  - Memory facts cannot be promoted from grounding shadow output.
  - No TaskLoop/Gateway/provider-ordering/default registration/runtime cutover, persistence/service/raw retention/renderer transport, or patch-apply boundary is touched.
  - Required validation commands and boundary scans pass or have documented benign policy/test-string-only matches.
docs:
  required: true
  files:
    - runtime-research/handoffs/line-c-grounding-shadow-consumers-readiness/implementation-synthesis.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - README files are review-required after functional or architecture changes; update them only if user-visible behavior, flows, interfaces, or public docs changed.
    - This task is expected to be runtime-internal and not user-visible.
nextPhaseEntry:
  Allowed next phase:
    - a fresh accepted task spec may plan explicit runtime wiring only after this readiness layer is accepted
    - next work must still prove readonly, local, bounded, default-off, summary-only, non-authoritative behavior before runtime use
  Still forbidden:
    - TaskLoop, Gateway, provider-ordering, default provider registration, prompt assembly, model-message, runtime execution, persistence, exporter/listener/service, raw retention, memory promotion, renderer transport, or patch-apply cutover
---

# Line C Grounding Shadow Consumers Readiness

This task adds the readiness layer after the accepted Line C Grounding Spine. It allows explicit shadow consumers to summarize existing `GroundingRef` and `GroundingQuery` data, but it does not wire the output into TaskLoop, Gateway, provider ordering, runtime execution, memory promotion, renderer transport, or patch application.

The accepted implementation surface is intentionally small: a default-off helper layer, focused tests, and an implementation synthesis.
