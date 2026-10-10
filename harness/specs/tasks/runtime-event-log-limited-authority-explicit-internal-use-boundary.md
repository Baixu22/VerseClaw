---
lifecycleStatus: archived
id: runtime-event-log-limited-authority-explicit-internal-use-boundary
title: Runtime event-log limited authority explicit internal use boundary
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Audit and pin the limited-authority internal use boundary as a Workflow Checkpoint Engine review/spec progression boundary that consumes only caller-provided helper reports, without wiring runtime behavior or expanding authority.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-use-boundary.md
  - runtime-research/handoffs/runtime-event-log-limited-authority-explicit-internal-use-boundary/**
  - tests/unit/runtime-event-log-limited-authority-explicit-internal-use-boundary.test.ts
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-use-boundary.md
  - runtime-research/handoffs/runtime-event-log-limited-authority-explicit-internal-use-boundary/**
  - tests/unit/runtime-event-log-limited-authority-explicit-internal-use-boundary.test.ts
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No resume behavior changes.
  - No default event-log authority.
  - No TaskLoop default wiring.
  - long_task_checkpoints remains the default authoritative checkpoint/resume source.
  - The boundary may recommend only blocked_before_internal_use_boundary, needs_more_coupling_evidence, or ready_for_explicit_internal_wiring_spec_or_next_boundary_hardening.
  - The ready decision permits only a later fresh explicit internal wiring spec or continued boundary hardening; it does not approve direct wiring, cutover, default-on behavior, schema/API/UI/provider/transport changes, TaskLoop default decisions, replay side effects, or completion proof.
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
  - default-on event-log authority, event-log-first resume ordering by default, replacing long_task_checkpoints for all sessions, active authority from helper output, runtime.resume.preferEventLog, or any default-on/prefer-event-log output
  - TaskLoop default wiring, TaskLoop final status changes, TaskLoop decision behavior changes, lifecycle payload changes, persisted checkpoint payload changes, reviewer prompt changes, model message changes, provider ordering changes, retry policy changes, approval policy changes, verifier authority changes, or tool permission authority changes
  - new schema table/index/migration, database creation, table creation, SQLite writes, JSON/JSONL/TXT sidecars, non-SQLite OpenClaw-owned runtime state, service, listener, daemon, local HTTP server, WebSocket server, second Gateway, exporter, collector, or database service
  - Gateway route, Electron IPC route, renderer UI/page/component, host-api/api-client/shared contract change, direct renderer Gateway HTTP/WebSocket, provider transport change, public API surface, or product settings
  - calling Gateway/Main/renderer/provider transport, replaying side effects, executing tools from replay, applying patches from replay, sending messages, writing workspace files from replay, or invoking provider transport
  - raw SQLite rows, raw record_json, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, auth material, raw event payloads, raw checkpoint payloads, or unbounded diagnostics in boundary output
  - treating helper reports, diagnostics, scorecards, replay comparison, retention summaries, evidence review output, deep evaluation output, internal optimization output, or boundary output as task completion proof
featureFlags:
  - No runtime config flag is added by this task.
  - Existing runtime.eventLog.persist remains default false.
  - Existing runtime.eventLog.shadow remains default false.
  - Existing runtime.resume.replayShadow remains default false.
  - Any future explicit internal wiring flag must be covered by a later fresh spec.
rollback:
  - Remove this task spec.
  - Remove the explicit internal use boundary handoff.
  - Remove the focused test-only boundary audit.
  - Revert only the runtime index pointer update for this boundary line.
  - No schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, policy rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-use-boundary.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-use-boundary.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-use-boundary.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-limited-authority-explicit-internal-use-boundary.test.ts tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - git diff --check -- harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-use-boundary.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-event-log-limited-authority-explicit-internal-use-boundary.test.ts
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|default_on|default-on|defaultOn" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components electron shared openclaw_runtime/src/gateway
  - node scripts/scan-pattern.mjs --pattern "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-use-boundary.md
  - node scripts/scan-pattern.mjs --pattern "createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "raw SQLite|record_json|checkpoint payload|tool args|tool output|transcript|prompt|process\\.env|secret|apiKey|api[-_]?key|authorization|auth material|raw event|raw checkpoint|unbounded" harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-use-boundary.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-event-log-limited-authority-explicit-internal-use-boundary.test.ts
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|default_on|default-on|defaultOn|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(|createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl|raw SQLite|record_json|checkpoint payload|tool args|tool output|transcript|prompt|process\\.env|secret|apiKey|api[-_]?key|authorization|auth material|raw event|raw checkpoint|unbounded" harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-use-boundary.md docs/dev/runtime-research-boundaries.md tests/unit/runtime-event-log-limited-authority-explicit-internal-use-boundary.test.ts
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.
acceptance:
  - Phase 1 concludes that existing helper reports already produce facts and internal optimization only interprets/deduplicates those facts at the test/report layer.
  - The integration point is Workflow Checkpoint Engine explicit internal readiness boundary, not a new runtime subsystem.
  - The boundary consumes only controlled dual-read report, limited-authority cutover report, internal optimization scorecard, thresholds, and diagnostic grouping.
  - The boundary outputs only review/spec progression decision, bounded diagnostics, coupling assessment, and hard veto summary.
  - No runtime-core helper is added unless a later spec proves it reduces duplication without changing runtime behavior or public authority surface.
  - No default-on event-log authority, broad runtime cutover, TaskLoop default wiring, schema/API/UI/provider/transport change, replay side effect, sidecar, service, DB/table/file creation, or prompt/model-message/policy change is introduced.
  - couplingStatus is healthy or acceptable_with_constraints, hard veto count is 0, authorityRisk is low, and long_task_checkpoints remains default authoritative.
  - The final conclusion is one of blocked_before_internal_use_boundary, needs_more_coupling_evidence, or ready_for_explicit_internal_wiring_spec_or_next_boundary_hardening.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Event Log Limited Authority Explicit Internal Use Boundary

This task audits the limited-authority internal use boundary for Runtime Event Log work.
It keeps the package at the Workflow Checkpoint Engine review/spec progression layer and avoids runtime wiring.

The boundary is allowed to consume only existing caller-provided reports and test-only scorecard outputs:

- controlled dual-read report;
- limited-authority cutover report;
- internal optimization scorecard;
- internal optimization thresholds;
- diagnostic grouping summary.

The boundary may output only a bounded coupling assessment, hard veto summary, and review/spec progression decision.
It may not change runtime behavior, resume authority, TaskLoop decisions, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport, schemas, persistence, side effects, prompts, model messages, retry, approval, tool policy, or completion proof semantics.
