---
lifecycleStatus: archived
id: runtime-event-log-limited-authority-cutover-evidence-review
title: Runtime event-log limited authority cutover evidence review
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Review bounded limited-authority cutover helper reports and decide whether a later explicit internal wiring spec may be written, while keeping long_task_checkpoints authoritative by default.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-limited-authority-cutover-evidence-review.md
  - runtime-research/handoffs/runtime-event-log-limited-authority-cutover-evidence-review/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/runtime-event-log-limited-authority-cutover-evidence-review.md
  - runtime-research/handoffs/runtime-event-log-limited-authority-cutover-evidence-review/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No resume behavior changes.
  - long_task_checkpoints remains the default authoritative checkpoint/resume source.
  - Evidence review consumes only bounded reports from buildRuntimeEventLogLimitedAuthorityCutoverPilotReport and predecessor controlled dual-read report evidence.
  - Evidence review output may recommend only blocked_before_limited_authority_evidence_review, needs_more_limited_authority_evidence, or ready_for_explicit_internal_wiring_spec.
  - ready_for_explicit_internal_wiring_spec permits only a later fresh spec for explicit internal invocation wiring; it does not approve default runtime authority, broad cutover, TaskLoop default ordering, schema/API/UI/provider/transport changes, or side effects.
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
  - default-on event-log authority, event-log-first resume ordering by default, replacing long_task_checkpoints for all sessions, cutover_enabled output, event_log_authoritative output, default_on output, default-on output, defaultOn output, prefer_event_log output, or runtime.resume.preferEventLog
  - new schema table/index/migration, database creation, table creation, SQLite writes, JSON/JSONL/TXT sidecars, non-SQLite OpenClaw-owned runtime state, new service, listener, daemon, local HTTP server, WebSocket server, second Gateway, exporter, collector, or database service
  - Gateway route, Electron IPC route, renderer UI/page/component, host-api/api-client/shared contract change, direct renderer Gateway HTTP/WebSocket, provider transport change, public API surface, or TaskLoop default decision/status path
  - changing lifecycle payloads, persisted checkpoint payloads, reviewer prompts, model messages, provider ordering, retry policy, approval policy, verifier authority, or tool permission authority
  - executing tools, applying patches, sending messages, writing workspace files, invoking Gateway/Main/renderer/provider transport, calling provider transport, or replaying side effects as part of evidence review
  - treating event-log diagnostics, replay comparison, retention summaries, helper reports, evidence-review output, or next-spec recommendation as task completion proof
featureFlags:
  - No runtime config flag is added by this task.
  - Existing runtime.eventLog.persist remains default false.
  - Existing runtime.eventLog.shadow remains default false.
  - Existing runtime.resume.replayShadow remains default false.
  - Any future explicit internal wiring flag must be default false, operator-gated, kill-switchable, and covered by a later fresh spec before use.
rollback:
  - Reject this evidence-review package or decline later explicit internal wiring work.
  - Keep long_task_checkpoints authoritative for all current checkpoint/resume behavior.
  - Stop consuming limited-authority helper reports for review.
  - No schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, policy rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-evidence-review.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-evidence-review.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-evidence-review.md --no-diff
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "resume authority|event-log-first|default_on|default-on|defaultOn|event_log_authoritative" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components electron shared openclaw_runtime/src/gateway
  - node scripts/scan-pattern.mjs --pattern "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-limited-authority-cutover-evidence-review.md
  - node scripts/scan-pattern.mjs --pattern "createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|default_on|default-on|defaultOn|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(|createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" harness/specs/tasks/runtime-event-log-limited-authority-cutover-evidence-review.md docs/dev/runtime-research-boundaries.md
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.
acceptance:
  - This task creates only a fresh evidence-review spec, handoff package, and runtime index pointer update.
  - Review inputs are limited to bounded helper reports with default authority unchanged, long_task_checkpoints fallback, no runtime behavior change, no TaskLoop decision change, no replay side effects, no schema change, no API/UI/provider/transport change, and no completion-proof authority.
  - The review must reject raw helper input cases, raw SQLite rows, raw record_json, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, auth material, DB handles, files, sidecars, Gateway/Main/renderer/provider transport, or replay side effects.
  - The minimum evidence package includes default-closed omitted invocation, disabled pilot, operator gate closed, kill switch active, missing dual-read report, invalid/non-ready dual-read report, unblocked veto cases, incomplete boundary/rollback proof, and clean fully gated report.
  - Any report that grants default event-log authority, changes runtime behavior, changes TaskLoop decisions, replays side effects, writes persistence, changes schema, calls transport, adds API/UI/provider surface, leaks raw details, or treats diagnostics as completion proof blocks review.
  - Output may contain only blocked_before_limited_authority_evidence_review, needs_more_limited_authority_evidence, or ready_for_explicit_internal_wiring_spec.
  - ready_for_explicit_internal_wiring_spec allows only a later fresh explicit internal wiring spec; it does not approve event-log default authority, broad runtime cutover, default-on behavior, schema/table/index/migration, API/UI/provider/transport work, TaskLoop default decision changes, side effects, or completion proof.
  - Boundary scans classify both broad hits and touched-path hits without modifying unrelated modules.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Event Log Limited Authority Cutover Evidence Review

This task is the fresh evidence-review package after `ready_for_limited_authority_cutover_pr_review`.
It evaluates only bounded limited-authority helper reports and decides whether a later explicit internal wiring spec may be written.

It does not enable event-log resume authority, does not wire TaskLoop, and does not change runtime behavior.

## Priority Work Arrangement

P1 fresh evidence-review package:
- Create this spec as the only next-stage entry after limited authority helper PR review readiness.
- Preserve current behavior: `long_task_checkpoints` remains authoritative by default.
- Validate the implementation spec with `--no-diff`.

P2 helper-report evidence contract:
- Review only bounded reports emitted by `buildRuntimeEventLogLimitedAuthorityCutoverPilotReport`.
- Require report-level proof that default runtime behavior did not change and that the helper falls back to `long_task_checkpoints`.
- Require evidence for disabled/default, operator gate, kill switch, missing evidence, invalid/non-ready dual-read report, unblocked veto, incomplete boundary/rollback, and clean fully gated paths.

P3 decision gate:
- Block on any default authority drift, default-on language, raw detail leakage, unblocked veto, invalid rollback, boundary drift, schema/API/UI/provider/transport surface, TaskLoop default decision change, replay side effect, or completion-proof misuse.
- Use `needs_more_limited_authority_evidence` only when evidence is incomplete but no forbidden authority or boundary drift is found.
- Use `ready_for_explicit_internal_wiring_spec` only when all evidence classes and boundary scans are complete and clean.

P4 handoff and index:
- Add a handoff README with source context, evidence contract, decision matrix, validation results, boundary scan classifications, unrelated failure classifications, docs-sync decision, and remaining boundaries.
- Update the Workflow Checkpoint Engine index only after validation/scans are recorded.

## Evidence Review Decision States

The evidence review may recommend only:

- `blocked_before_limited_authority_evidence_review`
- `needs_more_limited_authority_evidence`
- `ready_for_explicit_internal_wiring_spec`

The last state means only that a later fresh explicit internal wiring spec may be written. It does not approve event-log authority, runtime cutover, default-on behavior, TaskLoop/Gateway/provider/UI/API changes, schema changes, side-effect replay, or completion proof.

## Explicit Non-Goals

This task does not add a runtime config flag, database object, sidecar file, collector, exporter, Gateway route, Electron IPC channel, renderer UI, host-api method, api-client method, shared contract, provider transport, TaskLoop decision/status path, prompt/model-message path, retry/approval/tool policy path, or replay side-effect path.

This task does not treat diagnostics, helper reports, replay comparison, retention summaries, evidence-review output, or the next-spec recommendation as completion proof.
