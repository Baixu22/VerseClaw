---
id: runtime-event-log-limited-authority-deep-evaluation
title: Runtime event-log limited authority deep evaluation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Quantitatively deep-test the Runtime Event Log limited-authority helper with a deterministic scorecard, without wiring TaskLoop, enabling event-log authority, changing runtime behavior, or adding schema/API/UI/provider/transport surfaces.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-limited-authority-deep-evaluation.md
  - runtime-research/handoffs/runtime-event-log-limited-authority-deep-evaluation/**
  - tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/runtime-event-log-limited-authority-deep-evaluation.md
  - runtime-research/handoffs/runtime-event-log-limited-authority-deep-evaluation/**
  - tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No resume behavior changes.
  - No default event-log authority.
  - No TaskLoop default wiring.
  - long_task_checkpoints remains the default authoritative checkpoint/resume source.
  - Deep evaluation output may recommend only blocked_before_internal_optimization, needs_more_limited_authority_deep_evidence, or ready_for_internal_optimization_spec.
  - ready_for_internal_optimization_spec permits only a later fresh internal optimization spec; it does not approve wiring, cutover, default-on behavior, schema/API/UI/provider/transport changes, TaskLoop default decisions, or completion proof.
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
  - default-on event-log authority, event-log-first resume ordering by default, replacing long_task_checkpoints for all sessions, cutover_enabled output, event_log_authoritative output, default_on output, default-on output, defaultOn output, prefer_event_log output, runtime.resume.preferEventLog, or active authority from scorecard output
  - TaskLoop default wiring, TaskLoop final status changes, TaskLoop decision behavior changes, lifecycle payload changes, persisted checkpoint payload changes, reviewer prompt changes, model message changes, provider ordering changes, retry policy changes, approval policy changes, verifier authority changes, or tool permission authority changes
  - new schema table/index/migration, database creation, table creation, SQLite writes, JSON/JSONL/TXT sidecars, non-SQLite OpenClaw-owned runtime state, service, listener, daemon, local HTTP server, WebSocket server, second Gateway, exporter, collector, or database service
  - Gateway route, Electron IPC route, renderer UI/page/component, host-api/api-client/shared contract change, direct renderer Gateway HTTP/WebSocket, provider transport change, public API surface, or product settings
  - calling Gateway/Main/renderer/provider transport, replaying side effects, executing tools from replay, applying patches from replay, sending messages, writing workspace files from replay, or invoking provider transport
  - raw SQLite rows, raw record_json, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, auth material, raw event payloads, raw checkpoint payloads, or unbounded diagnostics in deep-evaluation output
  - treating helper reports, diagnostics, scorecards, replay comparison, retention summaries, evidence review output, deep evaluation output, or next-spec recommendation as task completion proof
featureFlags:
  - No runtime config flag is added by this task.
  - Existing runtime.eventLog.persist remains default false.
  - Existing runtime.eventLog.shadow remains default false.
  - Existing runtime.resume.replayShadow remains default false.
  - Any future explicit internal optimization or wiring flag must be covered by a later fresh spec.
rollback:
  - Remove this task spec.
  - Remove the deep-evaluation handoff.
  - Remove the focused deep-evaluation unit test.
  - Revert only the runtime index pointer update for this evaluation line.
  - No schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, policy rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-limited-authority-deep-evaluation.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-deep-evaluation.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-deep-evaluation.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - git diff --check -- harness/specs/tasks/runtime-event-log-limited-authority-deep-evaluation.md runtime-research/handoffs/runtime-event-log-limited-authority-deep-evaluation/README.md tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts runtime-research/agent-runtime-index.md
  - rg -n "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|default_on|default-on|defaultOn" openclaw_runtime/src tests/unit harness/specs runtime-research
  - rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components electron shared openclaw_runtime/src/gateway
  - rg -n "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-limited-authority-deep-evaluation.md
  - rg -n "createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs runtime-research
  - rg -n "raw SQLite|record_json|checkpoint payload|tool args|tool output|transcript|prompt|process\\.env|secret|apiKey|api[-_]?key|authorization|auth material|raw event|raw checkpoint|unbounded" harness/specs/tasks/runtime-event-log-limited-authority-deep-evaluation.md runtime-research/handoffs/runtime-event-log-limited-authority-deep-evaluation tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts
  - rg -n "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|default_on|default-on|defaultOn|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(|createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl|raw SQLite|record_json|checkpoint payload|tool args|tool output|transcript|prompt|process\\.env|secret|apiKey|api[-_]?key|authorization|auth material|raw event|raw checkpoint|unbounded" harness/specs/tasks/runtime-event-log-limited-authority-deep-evaluation.md runtime-research/handoffs/runtime-event-log-limited-authority-deep-evaluation tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts runtime-research/agent-runtime-index.md
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.
acceptance:
  - The task creates only a fresh deep-evaluation spec, focused quantitative unit test, handoff package, and runtime index pointer update.
  - The focused test uses at least 60 deterministic synthetic cases and only calls existing pure helper functions.
  - Corpus classes cover omitted invocation, disabled pilot, operator gate closed, kill switch active, missing dual-read report, invalid dual-read report, non-ready dual-read report, parity mismatch, retention gap, unsafe side-effect ambiguity, unblocked veto, missing boundary proof, forbidden boundary proof, missing rollback proof, diagnostic overflow/bounding, and clean fully gated ready cases.
  - The scorecard totals 100 points across Safety/fail-closed 35, Evidence coverage 25, Bounded diagnostics/leakage 15, Performance/noise 15, and Optimization readiness 10.
  - Passing metrics are failClosedRate 1, cleanReadyRate 1, vetoBlockRate 1, boundarySensitivityRate 1, rollbackSensitivityRate 1, forbiddenStringLeakCount 0, defaultAuthorityDriftCount 0, taskLoopDecisionDriftCount 0, schemaApiUiProviderTransportDriftCount 0, diagnosticsBoundedRate 1, score >= 95, and hardVetoCount 0.
  - Deep evaluation output may contain only blocked_before_internal_optimization, needs_more_limited_authority_deep_evidence, or ready_for_internal_optimization_spec.
  - ready_for_internal_optimization_spec allows only a later fresh internal optimization spec; it does not approve event-log default authority, broad runtime cutover, default-on behavior, schema/table/index/migration, API/UI/provider/transport work, TaskLoop default decision changes, side effects, or completion proof.
  - Boundary scans classify broad hits and touched-path hits without modifying unrelated modules.
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-event-log-limited-authority-deep-evaluation/README.md
---

# Runtime Event Log Limited Authority Deep Evaluation

This task quantifies the safety and optimization readiness of the Runtime Event Log limited-authority helper.
It is evaluation-only and does not implement internal wiring, runtime cutover, default authority, or product behavior.

## Scorecard

The focused test must produce a deterministic 100-point scorecard:

- Safety / fail-closed: 35.
- Evidence coverage: 25.
- Bounded diagnostics / leakage: 15.
- Performance and noise: 15.
- Optimization readiness: 10.

The only passing forward decision is `ready_for_internal_optimization_spec`.
That decision permits only a later fresh optimization spec and never authorizes wiring or authority changes.

## Internal Optimization Candidates

If this task closes as ready, the later optimization spec may consider:

- deduplicating limited-authority test fixture builders;
- grouping diagnostics by gate family for lower review noise;
- preserving scorecard thresholds before internal wiring;
- improving report readability without expanding runtime authority.

Those optimizations remain non-authoritative and may not change default runtime behavior.
