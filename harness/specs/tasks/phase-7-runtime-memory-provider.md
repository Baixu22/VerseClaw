---
id: phase-7-runtime-memory-provider
title: Phase 7 runtime memory provider contracts and evidence-backed temporal facts
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prepare and implement a Runtime Memory Provider only through evidence-backed episodic records and temporal facts, without raw chat-log memory, raw trace-dump memory, unverified fact promotion, or default provider-ordering cutover.
ownedPaths:
  - harness/specs/tasks/phase-7-runtime-memory-provider.md
  - runtime-research/handoffs/phase-7-runtime-memory-provider/**
  - openclaw_runtime/src/runtime-core/memory-context.ts
  - openclaw_runtime/src/runtime-core/memory-store.ts
  - openclaw_runtime/src/context-engine/memory-context-provider.ts
  - tests/unit/runtime-memory-context-contracts.test.ts
  - tests/unit/runtime-memory-store.test.ts
  - tests/unit/runtime-memory-context-provider.test.ts
touchedAreas:
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/context-engine/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/gateway/**
  - electron/**
  - shared/**
  - src/lib/host-api.ts
  - src/lib/api-client.ts
  - tests/unit/**
expectedUserBehavior:
  - With Phase-7 memory flags disabled, existing TaskLoop execution, tools.invoke behavior, approval waiting, retries, error mapping, return payloads, event-log/checkpoint/resume behavior, Evidence Verifier behavior, Trace Context Provider behavior, and provider ordering remain unchanged.
  - Runtime memory starts from evidence-backed episodes and temporal fact candidates, not raw chat logs, raw trace dumps, full prompts, full tool payloads, or unverified model summaries.
  - Accepted memory context output is readonly, source-linked, and token-budgeted; it must not become a completion gate, verifier authority, security policy, retry policy, tool policy, or runtime authority in Phase 7.
  - Automatic extraction can propose candidate facts only. Durable fact promotion requires verifier-backed evidence, human approval, or an explicitly accepted deterministic source rule.
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
  - raw chat-log memory or raw transcript import as durable memory
  - raw trace-dump memory or treating trace summaries as durable facts without verification
  - persistence of raw prompts, full event payloads, full checkpoints, full tool args, full tool output, complete env, secrets, unbounded command output, traceparent/tracestate/baggage values, or unbounded chat text
  - default-on memory recording, memory provider injection, provider ordering cutover, fact extraction, fact promotion, or prompt memory dump
  - LLM-extracted facts becoming durable memory without verifier or human approval
  - memory provider acting as completion gate, verifier authority, security policy, retry policy, runtime execution policy, or tool permission authority
  - observability platform, OpenTelemetry collector, OTLP exporter, external telemetry upload, graph database service, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway instance, or second runtime service
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - UI-visible memory behavior changes without targeted Electron E2E coverage and full i18n coverage
featureFlags:
  - runtime.memory.shadow defaults off and only authorizes local sanitized episode/fact diagnostics.
  - runtime.memory.provider defaults off and only authorizes readonly, budgeted memory context items.
  - runtime.memory.proposeFacts defaults off and only authorizes candidate fact proposals, not durable fact promotion.
  - runtime.memory.persist defaults off and must not be enabled until a lane proves retention, redaction, idempotency, invalidation, rollback, and migration behavior.
  - No Phase 7 flag may enable raw chat-log memory, raw trace-dump memory, unverified durable facts, external export, or prompt full-memory dumps.
rollback:
  - Disable Phase-7 memory flags.
  - Keep existing TaskLoop, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, Trace Context Provider, and provider ordering authoritative.
  - Remove memory adapter/provider wiring without deleting accepted Phase-4 event-log/checkpoint, Phase-5 verifier, or Phase-6 trace contracts.
requiredTests:
  - rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-7-runtime-memory-provider.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-7-runtime-memory-provider.md
  - rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-context-contracts.test.ts
  - rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src electron shared tests/unit
  - rtk rg -n 'rawChat|raw chat|transcript|jsonl|rawTrace|trace dump|prompt dump|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|baggage|tracestate' <phase-7-touched-files>
  - rtk node scripts/comms/replay.mjs and rtk node scripts/comms/compare.mjs if Main/Gateway communication paths changed
acceptance:
  - Contract exposes sanitized episodic records with episode id, task id, event/test/tool/verifier/trace source refs, evidence refs, reference time, bounded summary, and idempotency key.
  - Contract exposes temporal fact candidates/facts with fact id, subject, predicate, object summary, valid_at, invalid_at, expired_at, reference_time, confidence/source, source episode refs, evidence refs, and verification status.
  - Current-valid queries exclude invalidated, expired, rejected, or unverified facts unless the caller explicitly asks for candidate/provenance views.
  - Historical queries can return facts valid at a requested time without rewriting current truth.
  - Duplicate episode writes are idempotent and preserve source/evidence refs.
  - Conflicting facts produce invalidation/proposal records instead of silently overwriting current truth.
  - Memory summaries are token-budgeted context items, not raw memory dumps.
  - Feature flags are default-off shadow/readonly/proposal-only and do not introduce active runtime authority.
  - No raw prompt, raw chat log, raw trace dump, full payload, full checkpoint, full tool args/output, env, secret, telemetry export, graph service, or full memory dump is retained or exposed by default.
  - Source episode/evidence refs remain links to verifier evidence; memory facts do not replace verifier decisions.
  - Phase 7 synthesis proves all accepted facts are evidence-backed and that unverified extraction remains proposal-only before any future provider-ordering or persistence cutover.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 7 Runtime Memory Provider

This task starts Phase 7 with contracts and harness work first. Runtime behavior remains unchanged unless a future lane explicitly wires default-off, local-only, sanitized episode/fact diagnostics or readonly memory context summaries and proves flag-off parity.

