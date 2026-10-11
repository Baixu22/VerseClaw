---
lifecycleStatus: archived
id: line-c-evidence-trace-grounding-spine
title: Line C evidence trace grounding spine derived refs and bounded queries
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a readonly/shadow Grounding Spine contract that derives sanitized GroundingRef records and bounded GroundingQuery results from existing evidence, trace, event-log, checkpoint, memory, AgentMap, and Symbol surfaces without changing runtime authority, provider ordering, TaskLoop/Gateway behavior, persistence, or raw retention.
ownedPaths:
  - harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
  - runtime-research/handoffs/line-c-evidence-trace-grounding-planning/**
  - openclaw_runtime/src/runtime-core/grounding.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-grounding-contracts.test.ts
  - tests/unit/runtime-grounding-ref-projections.test.ts
  - tests/unit/runtime-grounding-query.test.ts
  - tests/unit/runtime-grounding-retention-boundary.test.ts
touchedAreas:
  - harness/specs/**
  - runtime-research/handoffs/line-c-evidence-trace-grounding-planning/**
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/host-api-client.ts
  - tests/unit/**
  - tests/fixtures/**
expectedUserBehavior:
  - With grounding flags disabled, existing TaskLoop execution, tools.invoke behavior, approval waiting, retries, error mapping, return payloads, event-log/checkpoint/resume behavior, Evidence Verifier behavior, Trace Context Provider behavior, Runtime Memory behavior, AgentMap/Symbol behavior, renderer/Main transport, and provider ordering remain unchanged.
  - GroundingRef and GroundingQuery are derived-only views over already produced sanitized refs, summaries, ids, diagnostics, and source anchors. They must not mutate EvidenceRef, TaskLoopEvidenceRef, RuntimeTraceSpan, RuntimeTaskEvent, checkpoint, memory, AgentMap, or Symbol producer contracts in the first implementation slice.
  - Every grounding record has authority: "none". Trust, projection, sanitization, and ranking metadata are explanatory only and cannot decide completion, blocked/failed status, retry, security, tool permission, provider ordering, memory fact promotion, or runtime state.
  - Grounding output is readonly, local, bounded, token-budgeted, and summary-only. It never exposes raw prompts, raw trace dumps, full payloads, full checkpoints, full tool args, full tool output, complete env, secrets, or unbounded command output.
  - Source refs, symbol refs, event refs, checkpoint refs, and memory refs can explain why context was selected, but they do not replace verifier-backed evidence or human-approved evidence.
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
  - completion gate, verifier enforcement gate, or grounding-based completion/blocking decision
  - TaskLoop cutover, Gateway cutover, runtime execution cutover, model-message cutover, provider transport cutover, or default provider-ordering cutover
  - provider-ordering ranking changes, prompt assembly default changes, context provider default registration changes, or runtime authority changes
  - persistence, database, SQLite schema, sidecar file, exporter, collector, telemetry upload, listener, daemon, HTTP server, WebSocket server, Temporal service, second Gateway instance, second runtime service, or external service
  - raw retention of raw prompts, raw chat logs, raw trace dumps, full traces, full event payloads, full checkpoints, full tool args, full tool output, complete env, secrets, credentials, traceparent/tracestate/baggage values, or unbounded command output
  - mutating EvidenceRef, TaskLoopEvidenceRef, RuntimeTraceSpan, RuntimeTaskEvent, checkpoint, memory, AgentMap, or Symbol producer contracts as part of the initial grounding spine
  - treating renderer evidence, external trace context, subagent text, model summaries, memory facts, source refs, symbol refs, or patch refs as authoritative runtime truth
  - AST patch apply, workspace edit, rename, symbol edit apply, safe delete, or any mutating patch-planner behavior
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
featureFlags:
  - runtime.groundingSpine.shadow defaults false/off and only authorizes local derived GroundingRef normalization diagnostics.
  - runtime.groundingSpine.query defaults false/off and only authorizes readonly, bounded, sanitized GroundingQuery helpers.
  - runtime.groundingSpine.consumerProjection defaults false/off and only authorizes explicit test/shadow projection adapters for Runtime Memory, AgentMap, and Symbol consumers.
  - If implementation proves no runtime wiring is required, no config schema or feature flag edit is required; any added flag must default false/off, remain readonly/shadow-only, and must not enable authority, persistence, raw retention, provider-ordering changes, or runtime cutover.
rollback:
  - Disable or omit all runtime.groundingSpine.* flags.
  - Stop importing the grounding helpers and remove any explicit test/shadow provider injection.
  - Keep existing TaskLoop, Gateway, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, Runtime Memory Provider, AgentMap/Symbol, renderer/Main transport, and provider ordering authoritative.
  - No data migration or cleanup is required because the Grounding Spine must not add persistence, databases, sidecars, exporters, listeners, or raw retained artifacts.
requiredTests:
  - node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-line-b-agentmap-symbol-readonly.md
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-ref-projections.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-grounding-retention-boundary.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-checkpoint-serializer.test.ts tests/unit/runtime-verification-auto-sampling.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/runtime-symbol-tool-contracts.test.ts tests/unit/runtime-symbol-tool-readonly.test.ts tests/unit/runtime-symbol-context-provider.test.ts tests/unit/context-provider-registry.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components electron shared --glob '!**/*.md'
  - node scripts/scan-pattern.mjs --pattern 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(|daemon|listener|service|database|sqlite|postgres|mysql|redis|sidecar' <line-c-grounding-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|rawChat|raw chat|transcript import|jsonl import|full tool args|full tool output|toolArgs|toolOutput|stdout|stderr|process\.env|complete env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|includeRaw|rawRetained' <line-c-grounding-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'writeFile|appendFile|createWriteStream|mkdir|\.jsonl|\.sqlite|sqlite|kysely|better-sqlite3|database|persist|cache|store|sidecar' <line-c-grounding-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply' <line-c-grounding-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'authority' <line-c-grounding-touched-files>
  - node scripts/scan-pattern.mjs --pattern 'GroundingRef|GroundingQuery|grounding' openclaw_runtime/src/agents openclaw_runtime/src/gateway electron shared src --glob '!**/*.md'
  - node scripts/comms/replay.mjs and node scripts/comms/compare.mjs only if a later accepted implementation touches Main/Gateway/host-api/api-client/provider transport paths
acceptance:
  - The task spec and implementation scope are accepted before runtime code begins.
  - GroundingRef, GroundingRefTrust, GroundingQuery, and bounded GroundingResult or summary contracts are exposed as readonly derived helpers, not as executor or policy surfaces.
  - GroundingRef supports evidence, file, test, tool, trace, source, checkpoint, event, event_log, verifier_report, verifier_finding, memory, symbol, and patch planning refs as needed by existing producers and future consumers.
  - Every GroundingRef includes a stable id or canonicalKey, explicit trust classification, projection metadata, sanitization metadata, rawRetained: false, and authority: "none".
  - GroundingRef and GroundingQuery are derived from existing refs and summaries only; the first implementation does not change producer contracts or require TaskLoop/Gateway/provider-ordering wiring.
  - Query helpers are local, readonly, paginated or bounded by limit, bounded by tokenBudget where summaries are rendered, and default to excluding untrusted records unless an explicit readonly diagnostic path asks for them.
  - Renderer evidence, external trace context, subagent text, model summaries, memory facts, and future patch refs are untrusted, projected, rejected, or consumer-only as appropriate and never become runtime authority.
  - Source refs and symbol refs remain evidence links and relevance anchors. They do not replace verifier evidence, human approval, or deterministic promotion rules.
  - Durable memory facts cannot be promoted from grounding records alone; they still require verifier-backed evidence, human approval, or a separately accepted deterministic source rule.
  - Dedupe and canonical-key behavior is deterministic across EvidenceRef, TaskLoopEvidenceRef projections, RuntimeTraceSpan/source refs, RuntimeTaskEvent/event-log records, checkpoint diagnostics, verifier reports/findings, memory refs, AgentMap refs, and Symbol refs.
  - Focused tests prove derivation, dedupe, trust classification, renderer/external untrusted handling, source refs as non-authoritative links, query bounds, token-budget behavior, raw-retention rejection, and fixed authority: "none".
  - Boundary scans prove no completion gate, no TaskLoop/Gateway/runtime cutover, no provider-ordering cutover, no persistence/database/exporter/listener/service, no raw retention, no patch apply behavior, and no renderer/Main transport bypass.
  - Any touched docs or handoff files include path/function/test/command evidence and exactly one final status line using Status: accepted, Status: needs_revision, or Status: blocked.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - README files are review-required by docs-sync after functional or architecture changes; update them only if behavior, flows, interfaces, or user-visible docs change.
    - Product/user-facing text is not expected for the initial readonly helper slice unless a later accepted phase exposes UI or user-visible behavior.
nextPhaseEntry:
  Future implementation lanes:
    - requires this harness task spec and next-spec synthesis to be accepted before runtime code begins
    - may add only derived GroundingRef/GroundingQuery contracts, projection helpers, fixtures, and focused tests in the first slice
    - must not add TaskLoop, Gateway, provider-ordering, model-message, completion-gate, persistence/export, service/listener, raw retention, memory promotion, or renderer transport cutover
  Future AST Patch Planner and grounding consumers:
    - requires a fresh accepted harness task spec before any patch planning or consumer cutover implementation
    - may consume GroundingRef and GroundingQuery only as readonly evidence-plan material
    - must not add patch apply, workspace edit, provider-ordering cutover, TaskLoop/Gateway/runtime cutover, completion gate, persistence/export, service/listener, or raw retention
    - must prove verifier-ready evidence and human/operator confirmation rules before any apply-oriented behavior
---

# Line C Evidence Trace Grounding Spine

This task creates the first implementation boundary for the Line C Grounding Spine. It is a derived-only, readonly/shadow coordination layer over existing evidence, trace, event-log, checkpoint, memory, AgentMap, and Symbol records.

GroundingRef and GroundingQuery are not authority surfaces. Every grounding record must carry `authority: "none"`, must be sanitized and summary-only, and must preserve flag-off/default behavior unchanged.

This spec-integration step is docs/spec-only. It creates the formal harness task spec and next-spec synthesis; it does not authorize runtime code until the harness context and validate commands pass and the synthesis is accepted.
