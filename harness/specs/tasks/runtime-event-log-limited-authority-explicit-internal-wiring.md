---
lifecycleStatus: archived
id: runtime-event-log-limited-authority-explicit-internal-wiring
title: Runtime event-log limited authority explicit internal wiring
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Create a fresh explicit internal wiring spec and a runtime-core pure readiness component for Workflow Checkpoint Engine review/spec progression, without wiring runtime behavior or expanding event-log authority.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md
  - openclaw_runtime/src/runtime-core/event-log-limited-authority-explicit-internal-wiring.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - runtime-research/handoffs/runtime-event-log-limited-authority-explicit-internal-wiring/**
  - tests/unit/runtime-event-log-limited-authority-explicit-internal-wiring.test.ts
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md
  - openclaw_runtime/src/runtime-core/event-log-limited-authority-explicit-internal-wiring.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - runtime-research/handoffs/runtime-event-log-limited-authority-explicit-internal-wiring/**
  - tests/unit/runtime-event-log-limited-authority-explicit-internal-wiring.test.ts
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No resume behavior changes.
  - No default event-log authority.
  - No TaskLoop default wiring.
  - long_task_checkpoints remains the default authoritative checkpoint/resume source.
  - The runtime-core readiness component may recommend only blocked_before_explicit_internal_wiring, needs_more_internal_wiring_evidence, or ready_for_explicit_internal_wiring_review.
  - The ready decision permits only Workflow Checkpoint Engine review/spec progression; it does not approve runtime wiring, cutover, default-on behavior, schema/API/UI/provider/transport changes, TaskLoop default decisions, replay side effects, or completion proof.
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
  - default-on event-log authority, event-log-first resume ordering by default, replacing long_task_checkpoints for all sessions, active authority from helper output, runtime.resume.preferEventLog, cutover_enabled output, event_log_authoritative output, prefer_event_log output, default_on output, default-on output, defaultOn output, eventLogAuthoritative true, legacyAuthoritative false, or any default-on/prefer-event-log output
  - TaskLoop default wiring, TaskLoop final status changes, TaskLoop decision behavior changes, lifecycle payload changes, persisted checkpoint payload changes, reviewer prompt changes, model message changes, provider ordering changes, retry policy changes, approval policy changes, verifier authority changes, or tool permission authority changes
  - new schema table/index/migration, database creation, table creation, SQLite writes, JSON/JSONL/TXT sidecars, non-SQLite OpenClaw-owned runtime state, service, listener, daemon, local HTTP server, WebSocket server, second Gateway, exporter, collector, or database service
  - Gateway route, Electron IPC route, renderer UI/page/component, host-api/api-client/shared contract change, direct renderer Gateway HTTP/WebSocket, provider transport change, public API surface, or product settings
  - calling Gateway/Main/renderer/provider transport, replaying side effects, executing tools from replay, applying patches from replay, sending messages, writing workspace files from replay, or invoking provider transport
  - raw SQLite rows, raw record_json, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, auth material, raw event payloads, raw checkpoint payloads, or unbounded diagnostics in readiness output
  - treating helper reports, diagnostics, scorecards, replay comparison, retention summaries, evidence review output, deep evaluation output, internal optimization output, explicit internal wiring readiness output, or boundary output as task completion proof
featureFlags:
  - No runtime config flag is added by this task.
  - Existing runtime.eventLog.persist remains default false.
  - Existing runtime.eventLog.shadow remains default false.
  - Existing runtime.resume.replayShadow remains default false.
  - Any future runtime behavior wiring flag must be covered by a later fresh spec.
rollback:
  - Remove this task spec.
  - Remove the explicit internal wiring handoff.
  - Remove the runtime-core explicit internal wiring readiness component and its runtime-core index export.
  - Remove the focused readiness component test.
  - Revert only the runtime index pointer update for this wiring line.
  - No schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, policy rollback, TaskLoop behavior rollback, or resume authority rollback is required.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-limited-authority-explicit-internal-wiring.test.ts tests/unit/runtime-event-log-limited-authority-explicit-internal-use-boundary.test.ts tests/unit/runtime-event-log-limited-authority-deep-evaluation.test.ts tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - git diff --check -- harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md openclaw_runtime/src/runtime-core/event-log-limited-authority-explicit-internal-wiring.ts openclaw_runtime/src/runtime-core/index.ts docs/dev/runtime-research-boundaries.md tests/unit/runtime-event-log-limited-authority-explicit-internal-wiring.test.ts
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|default_on|default-on|defaultOn" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components electron shared openclaw_runtime/src/gateway
  - node scripts/scan-pattern.mjs --pattern "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md
  - node scripts/scan-pattern.mjs --pattern "createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "raw SQLite|record_json|checkpoint payload|tool args|tool output|transcript|prompt|process\\.env|secret|apiKey|api[-_]?key|authorization|auth material|raw event|raw checkpoint|unbounded" harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md openclaw_runtime/src/runtime-core/event-log-limited-authority-explicit-internal-wiring.ts docs/dev/runtime-research-boundaries.md tests/unit/runtime-event-log-limited-authority-explicit-internal-wiring.test.ts
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|default_on|default-on|defaultOn|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(|createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl|raw SQLite|record_json|checkpoint payload|tool args|tool output|transcript|prompt|process\\.env|secret|apiKey|api[-_]?key|authorization|auth material|raw event|raw checkpoint|unbounded" harness/specs/tasks/runtime-event-log-limited-authority-explicit-internal-wiring.md openclaw_runtime/src/runtime-core/event-log-limited-authority-explicit-internal-wiring.ts openclaw_runtime/src/runtime-core/index.ts docs/dev/runtime-research-boundaries.md tests/unit/runtime-event-log-limited-authority-explicit-internal-wiring.test.ts
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.
acceptance:
  - Phase 1 concludes that the prior explicit internal use boundary permits only Workflow Checkpoint Engine review/spec progression, not runtime behavior wiring.
  - The integration point is Workflow Checkpoint Engine explicit internal wiring readiness in runtime-core, not a TaskLoop/Gateway/UI/API runtime behavior subsystem.
  - The runtime-core readiness component requires explicitInvocation true and callerProvidedInputs true before it can return ready.
  - The runtime-core readiness component consumes only caller-provided controlled dual-read report, limited-authority cutover report, internal optimization scorecard, thresholds, and diagnostic grouping summary.
  - The runtime-core readiness component outputs only review/spec progression decision, bounded diagnostics, hard veto summary, and coupling/authority boundary summary.
  - The runtime-core readiness component is exported for explicit runtime-core use only; it is not wired into TaskLoop defaults, resume ordering, Gateway, UI, API, schema, provider transport, persistence, services, prompts, model messages, retry, approval, tool policy, or completion proof.
  - The ready decision is ready_for_explicit_internal_wiring_review and does not approve production use, runtime behavior wiring, default-on event-log authority, broad runtime cutover, TaskLoop default wiring, schema/API/UI/provider/transport change, replay side effect, sidecar, service, DB/table/file creation, or prompt/model-message/policy change.
  - Tests cover explicit entry tightening, runtime-core component positioning, ready input, missing/non-ready controlled dual-read input, non-ready limited-authority report, scorecard hard veto, score below threshold, bounded diagnostics and diagnostic groups, forbidden-string leakage, completion-proof false, long_task_checkpoints default authority, and unchanged runtime/TaskLoop/Gateway/UI/API/schema/provider/transport flags.
  - couplingStatus is healthy or acceptable_with_constraints for non-veto evidence gaps, hard veto count is 0 for ready input, authorityRisk is low for ready input, and long_task_checkpoints remains default authoritative.
  - The final conclusion is one of blocked_before_explicit_internal_wiring, needs_more_internal_wiring_evidence, or ready_for_explicit_internal_wiring_review.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Event Log Limited Authority Explicit Internal Wiring

This task creates the next fresh spec after the explicit internal use boundary.
It establishes only a runtime-core pure readiness component for Workflow Checkpoint Engine review/spec progression.

The component entry is tightened by requiring explicit invocation and caller-provided inputs.
The component is allowed to consume only caller-provided inputs:

- controlled dual-read report;
- limited-authority cutover report;
- internal optimization scorecard;
- internal optimization thresholds;
- diagnostic grouping summary.

The component may output only:

- review/spec progression decision;
- bounded diagnostics;
- hard veto summary;
- coupling and authority boundary summary.

It may not change runtime behavior, resume authority, TaskLoop decisions, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport, schemas, persistence, side effects, prompts, model messages, retry, approval, tool policy, or completion proof semantics.
