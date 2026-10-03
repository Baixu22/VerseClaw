---
id: phase-6-trace-context-provider
title: Phase 6 trace context provider contracts and shadow pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a local Trace Context Provider contract, query model, and default-off shadow pilot so runtime/tool/test behavior can become readonly context without changing TaskLoop, tools.invoke, approval, retry, error, return-payload, event-log/checkpoint, or Evidence Verifier behavior.
ownedPaths:
  - harness/specs/tasks/phase-6-trace-context-provider.md
  - runtime-research/handoffs/phase-6-trace-context-provider/**
  - openclaw_runtime/src/runtime-core/trace-context.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-trace-context-contracts.test.ts
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
  - With Phase-6 trace flags disabled, existing TaskLoop execution, tools.invoke behavior, approval waiting, retries, error mapping, return payloads, event-log/checkpoint/resume behavior, and Evidence Verifier behavior remain unchanged.
  - Lane A adds contract validation and handoff scaffolding only; it does not record live spans, inject trace context, change provider ordering, or expose trace summaries to prompts/UI.
  - Accepted trace context output is readonly and budgeted; it must not become a verifier/completion gate, security policy, retry policy, or runtime authority in Phase 6.
  - Phase 7 Runtime Memory Provider work must not start from raw chat logs, raw trace dumps, or unverified trace facts; it requires a fresh spec with evidence-backed temporal facts.
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
  - default-on trace recording, trace provider injection, trace export, or prompt trace dump
  - observability platform, OpenTelemetry collector, OTLP exporter, external telemetry upload, database, daemon, listener, HTTP server, WebSocket server, Temporal service, second Gateway instance, or second runtime service
  - trusting external traceparent/tracestate/baggage as local runtime authority without sanitizing, re-rooting, or marking untrusted
  - persistence of raw prompts, full event payloads, full checkpoints, full tool args, full tool output, complete env, secrets, or unbounded command output in spans, attributes, events, links, summaries, or source refs
  - trace provider acting as completion gate, verifier authority, security policy, retry policy, or runtime execution policy
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - UI-visible trace behavior changes without targeted Electron E2E coverage
featureFlags:
  - runtime.traceContext.shadow defaults off and only authorizes local sanitized span diagnostics.
  - runtime.traceContext.provider defaults off and only authorizes readonly, budgeted context items.
  - runtime.traceContext.propagation defaults off and must sanitize or re-root external trace context before local use.
  - No Phase 6 flag may enable external trace export or prompt full-trace dumps.
rollback:
  - Disable Phase-6 trace flags.
  - Keep existing TaskLoop, tools.invoke, event-log/checkpoint/resume, Evidence Verifier, and provider ordering authoritative.
  - Remove trace adapter/provider wiring without deleting accepted Phase-4 event-log/checkpoint or Phase-5 evidence verifier contracts.
requiredTests:
  - rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md
  - rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md
  - rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-contracts.test.ts
  - rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - rtk rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src electron shared tests/unit
  - rtk node scripts/comms/replay.mjs and rtk node scripts/comms/compare.mjs if Main/Gateway communication paths changed
acceptance:
  - Contract exposes span-like task/tool/test/verifier records with trace id, span id, parent span id, links, timestamps, status, bounded attributes, source refs, and evidence refs.
  - Parent/child spans are queryable by trace id, span id, parent id, task/tool/file/symbol/status, and time range.
  - Linked resume/evidence spans are queryable without treating links as causal parentage.
  - Error/test/verifier/evidence-linked spans rank ahead of unrelated sibling spans in budgeted summaries.
  - External traceparent is sanitized, re-rooted, rejected, or marked untrusted before local runtime use.
  - Source refs connect trace spans to file/symbol/evidence refs but do not replace verifier evidence.
  - Feature flags are default-off shadow/readonly only and do not introduce active runtime authority.
  - No raw prompt, full payload, full checkpoint, full tool args/output, env, secret, telemetry export, or full trace dump is retained or exposed by default.
  - Every accepted lane submission includes path/function/test/command evidence, flag-off parity evidence, sanitization/redaction evidence, external trace context handling evidence, token-budget evidence, boundary scans, and comms replay/compare when Main/Gateway paths changed.
  - Phase 6 synthesis proves trace spans are local, sanitized, bounded, queryable, source/evidence linked, and non-authoritative before Phase 7 can begin.
nextPhaseEntry:
  Runtime Memory Provider:
    - requires a fresh harness task spec before implementation
    - forbids raw chat-log memory and raw trace-dump memory
    - requires evidence-backed temporal facts with valid_at / invalid_at semantics
    - must not treat unverified trace facts as durable memory facts
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Phase 6 Trace Context Provider

This task starts Phase 6 with contract and harness work first. Runtime behavior remains unchanged unless a future lane explicitly wires default-off, local-only, sanitized trace recording or readonly context summaries and proves flag-off parity.
