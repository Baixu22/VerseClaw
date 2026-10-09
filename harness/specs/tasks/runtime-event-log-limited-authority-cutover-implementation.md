---
id: runtime-event-log-limited-authority-cutover-implementation
title: Runtime event-log limited authority cutover implementation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement a pure runtime-core helper for an explicit, operator-gated, default-off, fail-closed limited event-log resume-source pilot while keeping current default runtime behavior on long_task_checkpoints.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md
  - runtime-research/handoffs/runtime-event-log-limited-authority-cutover-implementation/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/event-log-limited-authority-cutover-pilot.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md
  - runtime-research/handoffs/runtime-event-log-limited-authority-cutover-implementation/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - No user-visible runtime behavior changes are made.
  - No default resume behavior changes are made.
  - long_task_checkpoints remains the default authoritative checkpoint/resume source outside explicit helper invocation.
  - The helper is pure runtime-core, explicit-call only, default-off, operator-gated, kill-switchable, and fail-closed.
  - Missing opt-in, closed operator gate, active kill switch, missing dual-read evidence, parity/veto failure, rollback gap, or boundary drift returns long_task_checkpoints.
  - A clean result only marks a bounded explicit pilot candidate; it does not wire default TaskLoop/runtime authority.
  - This package does not approve default-on event-log authority, broad runtime cutover, schema changes, UI/API surfaces, provider transport changes, or TaskLoop decision changes.
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
  - default-on event-log authority, event-log-first resume ordering by default, replacing long_task_checkpoints for all sessions, cutover_enabled output, event_log_authoritative output, default_on output, default-on output, defaultOn output, prefer_event_log output, or runtime.resume.preferEventLog without explicit future implementation ownership and tests
  - new schema table/index/migration, database creation, table creation, SQLite writes beyond pre-existing event-log persistence surfaces, JSON/JSONL/TXT sidecars, non-SQLite OpenClaw-owned runtime state, new service, listener, daemon, local HTTP server, WebSocket server, second Gateway, exporter, collector, or database service
  - Gateway route, Electron IPC route, renderer UI/page/component, host-api/api-client/shared contract change, direct renderer Gateway HTTP/WebSocket, provider transport change, or public API surface unless a later implementation change explicitly owns and validates that surface under this spec
  - changing TaskLoop final status, TaskLoop decision behavior, lifecycle payloads, persisted checkpoint payloads, reviewer prompts, model messages, provider ordering, retry policy, approval policy, verifier authority, or tool permission authority
  - executing tools, applying patches, sending messages, writing workspace files, invoking Gateway/Main/renderer/provider transport, calling provider transport, or replaying side effects as part of resume replay comparison
  - treating event-log diagnostics, replay comparison, retention summaries, readiness output, implementation-spec output, or helper decisions as task completion proof
featureFlags:
  - This implementation adds no runtime config flag.
  - Existing runtime.eventLog.persist remains default false.
  - Existing runtime.eventLog.shadow remains default false.
  - Existing runtime.resume.replayShadow remains default false.
  - Any future product/runtime flag must remain explicit opt-in, default false, operator-gated, and covered by a separate reviewed spec before use.
rollback:
  - Stop calling the helper or pass explicitPilotEnabled false.
  - Keep long_task_checkpoints authoritative for all current checkpoint/resume behavior.
  - Use the helper kill switch or disable-only rollback inputs to force long_task_checkpoints.
  - No schema rollback, sidecar cleanup, Gateway/UI/API rollback, provider rollback, prompt rollback, policy rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md --no-diff
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "resume authority|event-log-first|default_on|default-on|defaultOn|event_log_authoritative" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components electron shared openclaw_runtime/src/gateway
  - node scripts/scan-pattern.mjs --pattern "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md
  - node scripts/scan-pattern.mjs --pattern "createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|default_on|default-on|defaultOn|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(|createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md docs/dev/runtime-research-boundaries.md
  - pnpm run comms:replay and pnpm run comms:compare only if future implementation work touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.
acceptance:
  - This task implements only a pure runtime-core helper, export, focused unit test, handoff, spec update, and runtime index pointer update.
  - The helper consumes only a bounded controlled dual-read report plus explicit gate, boundary, and rollback inputs.
  - The helper does not read DB/files, write DB/files, create schema/table/index/migration, create JSON/JSONL/TXT sidecars, call Gateway/Main/renderer/provider transport, execute tools, apply patches, send messages, or replay side effects.
  - The helper fails closed to long_task_checkpoints when opt-in is absent, operator gate is closed, kill switch is active, evidence is missing, parity fails, veto gates fail, rollback proof is absent, or boundary scans fail.
  - Disabled/default paths preserve legacy behavior by selecting long_task_checkpoints and reporting no default runtime behavior change.
  - Clean parity with all gates open may only return a bounded explicit pilot candidate inside the helper report; it does not wire default TaskLoop/runtime authority.
  - Output is bounded and must not leak raw SQLite rows, raw record_json, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, or auth material.
  - The implementation must not add schema/table/index/migration, DB/table/file creation, JSON/JSONL/TXT sidecars, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport surfaces, TaskLoop status/decision changes, prompt/model-message changes, retry/approval/tool policy changes, or replay side effects.
  - Helper output must not emit cutover_enabled, event_log_authoritative, default_on, default-on, defaultOn, prefer_event_log, or runtime.resume.preferEventLog as public/default behavior.
  - Boundary scans classify both broad hits and touched-path hits without modifying unrelated modules.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Event Log Limited Authority Cutover Implementation Spec

This task is the fresh implementation package after `ready_for_limited_authority_cutover_development`. It implements a pure helper only. It does not wire event-log resume authority into default runtime behavior and does not change current TaskLoop behavior.

## Priority Work Arrangement

P1 fresh implementation package:
- Use this spec as the only next-stage entry after authority cutover readiness and implementation-spec closure.
- Preserve current behavior: `long_task_checkpoints` remains authoritative today.
- Validate the predecessor readiness spec with `--no-diff`.

P2 helper implementation contract:
- Limit the implementation to explicit opt-in and operator-gated resume-source pilot evaluation.
- Require default-off behavior and disabled-path legacy parity.
- Require a kill switch or equivalent disable-only rollback path.
- Require event-log evidence to pass dual-read parity, veto gates, rollback proof, and boundary scans before any pilot authority result can be considered.

P3 veto and fail-closed rules:
- Fail closed to `long_task_checkpoints` when opt-in is absent, operator gate is closed, kill switch is active, evidence is missing, parity fails, live evidence is invalid, side-effect ambiguity exists, retention gaps can hide required checkpoint state, or boundary drift is detected.
- Treat diagnostics, replay comparison, retention summaries, readiness output, and implementation-spec output as non-completion-proof.

P4 hard boundaries:
- No default-on authority.
- No current runtime cutover.
- No schema/table/index/migration.
- No new Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport surface.
- No TaskLoop status/decision, prompt/model-message, retry/approval/tool policy, or provider ordering changes.
- No replayed side effects.

P5 handoff and index:
- Add an implementation handoff README with source context, helper contract, validation results, boundary scan classifications, unrelated failure classifications, docs-sync decision, and remaining boundaries.
- Update the Workflow Checkpoint Engine index only after validation/scans are recorded.

## Implementation Decision States

This implementation package may close only as:

- `blocked_before_limited_authority_cutover_pr_review`
- `needs_more_limited_authority_cutover_evidence`
- `ready_for_limited_authority_cutover_pr_review`

The ready state means this pure helper slice is ready for PR review. It still does not approve default-on authority, broad runtime cutover, schema/API/UI/provider/transport changes, TaskLoop decision changes, or side effects.

## Pilot Helper Contract

The limited authority cutover helper must be:

- explicit opt-in;
- operator-gated;
- default-off;
- kill-switchable or disable-only rollback capable;
- bounded to resume-source authority evaluation only;
- legacy-authoritative when disabled or blocked;
- covered by dual-read parity tests, veto tests, rollback tests, and boundary scans.

The pilot helper must fail closed to `long_task_checkpoints` when any gate is missing or false.

## Future Validation Matrix

| Case | Required future behavior |
|---|---|
| Pilot disabled or omitted | Use `long_task_checkpoints`; preserve legacy output. |
| Operator gate closed | Use `long_task_checkpoints`; report blocked diagnostic only. |
| Kill switch active | Use `long_task_checkpoints`; report rollback diagnostic only. |
| Event-log evidence missing, partial, unreadable, corrupt, or missing table | Use `long_task_checkpoints`; report veto diagnostic only. |
| Legacy checkpoint evidence missing | Use `long_task_checkpoints`; report veto diagnostic only. |
| Retention gap can hide checkpoint state | Use `long_task_checkpoints`; report veto diagnostic only. |
| Unsafe side-effect ambiguity exists | Use `long_task_checkpoints`; report veto diagnostic only. |
| Dual-read parity mismatch | Use `long_task_checkpoints`; report veto diagnostic only. |
| Dual-read parity passes and all gates open | The helper may return a bounded explicit pilot candidate only inside the explicit opt-in path. |

## Explicit Non-Goals

This task does not add a runtime config flag, database object, sidecar file, collector, exporter, Gateway route, Electron IPC channel, renderer UI, host-api method, api-client method, shared contract, provider transport, TaskLoop decision/status path, prompt/model-message path, retry/approval/tool policy path, or replay side-effect path.

This task does not treat diagnostics, helper reports, replay comparison, retention summaries, readiness output, implementation-spec output, or the next development recommendation as completion proof.
