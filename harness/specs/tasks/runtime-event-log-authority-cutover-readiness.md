---
id: runtime-event-log-authority-cutover-readiness
title: Runtime event-log authority cutover readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Create a docs/spec-only readiness gate for deciding whether the project has enough bounded evidence to write a later limited authority cutover implementation spec, while keeping long_task_checkpoints authoritative today.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md
  - runtime-research/handoffs/runtime-event-log-authority-cutover-readiness/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md
  - runtime-research/handoffs/runtime-event-log-authority-cutover-readiness/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No resume behavior changes.
  - long_task_checkpoints remains authoritative for checkpoint and resume decisions.
  - RuntimeTaskEvent event-log replay remains diagnostic-only comparison evidence.
  - This package may decide only whether a later fresh limited authority cutover implementation spec may be written.
  - The readiness decision may be only blocked_before_cutover_readiness, needs_more_authority_cutover_evidence, or ready_for_limited_authority_cutover_implementation_spec.
  - The ready decision permits only a later fresh implementation spec; it does not approve event-log authority, runtime cutover, default-on behavior, schema, API, UI, TaskLoop, provider, transport, or policy changes.
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
  - runtime.resume.preferEventLog, preferEventLog, event-log-first resume ordering, replacing long_task_checkpoints as authoritative, current event-log resume authority, cutover_enabled output, event_log_authoritative output, default_on output, default-on output, defaultOn output, or prefer_event_log output
  - new schema table/index/migration, database creation, table creation, SQLite writes, JSON/JSONL/TXT sidecars, non-SQLite OpenClaw-owned runtime state, new service, listener, daemon, local HTTP server, WebSocket server, second Gateway, exporter, collector, or database service
  - Gateway route, Electron IPC route, renderer UI/page/component, host-api/api-client/shared contract change, direct renderer Gateway HTTP/WebSocket, provider transport change, or public API surface
  - changing TaskLoop final status, TaskLoop decision behavior, lifecycle payloads, persisted checkpoint payloads, reviewer prompts, model messages, provider ordering, retry policy, approval policy, verifier authority, or tool permission authority
  - executing tools, applying patches, sending messages, writing workspace files, invoking Gateway/Main/renderer/provider transport, calling provider transport, or replaying side effects as part of readiness review
  - treating event-log diagnostics, replay comparison, retention summaries, evidence-review output, readiness output, or any helper decision as task completion proof
featureFlags:
  - No runtime config flag is added by this task.
  - Existing runtime.eventLog.persist remains default false.
  - Existing runtime.eventLog.shadow remains default false.
  - Existing runtime.resume.replayShadow remains default false.
  - runtime.resume.preferEventLog must remain absent/rejected.
rollback:
  - Reject this readiness package or decline the later implementation-spec entrance.
  - Keep long_task_checkpoints authoritative for all current checkpoint/resume behavior.
  - Stop using Phase 5 helper reports and Phase 6 evidence-review output as cutover-readiness input.
  - No schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, policy rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "resume authority|event-log-first|default_on|default-on|defaultOn|event_log_authoritative" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components electron shared openclaw_runtime/src/gateway
  - node scripts/scan-pattern.mjs --pattern "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md
  - node scripts/scan-pattern.mjs --pattern "createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|default_on|default-on|defaultOn|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(|createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md docs/dev/runtime-research-boundaries.md
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.
acceptance:
  - This task creates only a fresh authority cutover readiness task spec, handoff package, and runtime index pointer update.
  - The readiness review evaluates whether bounded evidence is enough to write a later limited authority cutover implementation spec; it does not evaluate or approve switching authority now.
  - Accepted inputs are only prior docs/spec/handoff decisions, validation records, boundary scan classifications, and bounded sanitized Phase 5 helper-report evidence reviewed by Phase 6.
  - Readiness must reject raw Phase 5 input cases, raw SQLite rows, raw record_json, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, auth material, DB handles, files, sidecars, Gateway/Main/renderer/provider transport, or replay side effects.
  - Phase 6 bounded sanitized helper-report corpus coverage is required: default-closed omitted invocation, complete controlled corpus, incomplete controlled corpus, unblocked veto case, invalid live evidence contract, and sanitization/redaction case.
  - Controlled scenario coverage remains required for clean, partial, unreadable, corrupt-row, missing-table, missing-checkpoint, retention-pruned, mismatch, and unsafe side-effect ambiguity cases.
  - Veto gates must block mismatch, unreadable or corrupt data, missing table, missing checkpoint, retention-pruned checkpoint gaps, unsafe side-effect ambiguity, invalid live evidence, raw-detail leak, forbidden authority drift, schema drift, transport drift, service/sidecar drift, default-on drift, and rollback drift.
  - Operator gate definition must require an explicit future implementation spec, explicit operator enablement, kill-switch or disable-only rollback, validation of boundary scans, and confirmation that long_task_checkpoints remains authoritative until the future spec changes that under review.
  - Output may contain only blocked_before_cutover_readiness, needs_more_authority_cutover_evidence, or ready_for_limited_authority_cutover_implementation_spec as the readiness decision.
  - ready_for_limited_authority_cutover_implementation_spec permits only a later fresh implementation spec; it does not approve event-log authority, runtime cutover, default-on behavior, TaskLoop/Gateway/provider/UI/API changes, schema/table/index/migration, side effects, or completion proof.
  - Boundary scans classify both broad hits and touched-path hits without modifying unrelated modules.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Event Log Authority Cutover Readiness

This task is the fresh readiness gate after the controlled dual-read resume pilot evidence review. It is docs/spec-only. It decides only whether the project has enough bounded evidence to write a later limited authority cutover implementation spec.

It does not enable event-log resume authority, does not switch runtime authority, and does not change runtime behavior.

## Priority Work Arrangement

P1 fresh authority-cutover readiness spec:
- Create this spec as the next fresh entry after `ready_for_authority_cutover_readiness_spec`.
- Preserve the Phase 6 authority boundary: `long_task_checkpoints` authoritative, event-log replay diagnostic-only.
- Validate the previous evidence-review spec with `--no-diff`.

P2 readiness matrix:
- Review only prior docs/spec/handoff records, validation records, boundary scan classifications, and bounded sanitized Phase 5 helper reports as accepted by Phase 6.
- Decide whether evidence is blocked, incomplete, or sufficient to write a later limited authority cutover implementation spec.
- Do not use diagnostics, replay comparison, retention summaries, evidence-review output, or helper decisions as completion proof.

P3 Phase 6 helper-report corpus contract:
- Require Phase 6 coverage for default-closed behavior, complete controlled corpus, incomplete corpus, unblocked veto blocking, invalid live evidence contract blocking, and sanitization/redaction blocking.
- Require controlled scenarios for clean, partial, unreadable, corrupt-row, missing-table, missing-checkpoint, retention-pruned, mismatch, and unsafe side-effect ambiguity.
- Admit optional live summaries only through the Phase 5 helper report contract, with explicit, bounded, sanitized, caller-provided, raw-details-excluded evidence.

P4 veto, rollback, operator gates, and boundary scans:
- Treat any forbidden authority, transport, schema-write, service, sidecar, raw-detail, side-effect, completion-proof, default-on, or rollback drift as blocking.
- Define operator gates for a future implementation spec: explicit fresh spec, explicit operator enablement, disable-only rollback, kill switch or equivalent stop path, boundary scans, and validation records.
- Run the required broad scans and touched-path classification scan.

P5 handoff and index:
- Add a readiness handoff README with source context, decision matrix, validation results, boundary scan classifications, unrelated failure classifications, docs-sync decision, and remaining boundaries.
- Update the Workflow Checkpoint Engine index only after the readiness package exists and validation/scans are recorded.

## Readiness Decision States

The readiness review may recommend only:

- `blocked_before_cutover_readiness`
- `needs_more_authority_cutover_evidence`
- `ready_for_limited_authority_cutover_implementation_spec`

The last state means only that a later fresh limited authority cutover implementation spec may be written. It does not approve event-log authority, runtime cutover, default-on behavior, TaskLoop, Gateway, provider, UI, API, schema, policy, or side-effect changes.

## Readiness Matrix

| Evidence condition | Readiness decision |
|---|---|
| Missing required Phase 0 context, contradictory prior authority boundary, or unavailable predecessor handoff/spec/index | `blocked_before_cutover_readiness` |
| Any evidence grants current event-log authority, replaces `long_task_checkpoints`, changes runtime behavior, changes TaskLoop decisions, replays side effects, writes persistence, changes schema, calls transport, or adds API/UI/provider surfaces | `blocked_before_cutover_readiness` |
| Any required Phase 6 corpus class, controlled scenario, veto proof, rollback item, operator gate, boundary surface, or validation record is missing | `needs_more_authority_cutover_evidence` |
| Optional live summaries are present but not explicit, bounded, sanitized, caller-provided, and raw-details-excluded | `blocked_before_cutover_readiness` |
| Boundary scans show forbidden touched-path implementation changes | `blocked_before_cutover_readiness` |
| Prior Phase 6 evidence is complete, vetoes block correctly, rollback is disable-only, operator gates are defined, scans are classified, and no forbidden implementation surface was added | `ready_for_limited_authority_cutover_implementation_spec` |

## Future Implementation Spec Gate

A future limited authority cutover implementation spec may be written only if this readiness package records `ready_for_limited_authority_cutover_implementation_spec`.

That future spec must still define and validate:

- explicit operator opt-in and rollback;
- exact cutover authority scope;
- kill switch or equivalent disable path;
- no default-on behavior without separate explicit approval;
- no schema/API/UI/TaskLoop/provider/transport changes unless the future spec explicitly owns and validates them;
- legacy `long_task_checkpoints` authority until the future implementation spec proves and approves a bounded replacement.

This readiness package itself approves none of those changes.

## Explicit Non-Goals

This task does not add a runtime config flag, database object, sidecar file, collector, exporter, Gateway route, Electron IPC channel, renderer UI, host-api method, api-client method, shared contract, provider transport, TaskLoop decision/status path, prompt/model-message path, retry/approval/tool policy path, or replay side-effect path.

This task does not treat diagnostics, helper reports, replay comparison, retention summaries, evidence-review output, or the next-spec recommendation as completion proof.
