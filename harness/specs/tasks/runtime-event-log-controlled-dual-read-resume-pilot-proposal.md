---
lifecycleStatus: archived
id: runtime-event-log-controlled-dual-read-resume-pilot-proposal
title: Runtime event-log controlled dual-read resume pilot proposal
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Convert the phase 3 Runtime Event Log resume cutover readiness proof plan into a fresh proposal for a future limited controlled dual-read resume pilot while keeping long_task_checkpoints authoritative and event-log replay diagnostic-only.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md
  - runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-proposal/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md
  - runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-proposal/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No resume behavior changes.
  - No TaskLoop, Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, schema, persistence default, prompt, model-message, retry, approval, or tool policy changes.
  - The proposal may define only a future controlled dual-read pilot implementation spec entrance.
  - long_task_checkpoints remains authoritative for checkpoint and resume decisions.
  - Persisted RuntimeTaskEvent event-log replay may be used only as sanitized comparison diagnostics in the proposed future pilot.
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
  - runtime.resume.preferEventLog, preferEventLog, event-log-first resume ordering, replacing long_task_checkpoints as authoritative, default-on behavior, cutover_enabled output, event_log_authoritative output, default_on output, or prefer_event_log output
  - new schema table/index/migration, database creation, table creation, SQLite writes, JSON/JSONL/TXT sidecars, non-SQLite OpenClaw-owned runtime state, new service, listener, daemon, local HTTP server, WebSocket server, second Gateway, exporter, collector, or database service
  - Gateway route, Electron IPC route, renderer UI/page/component, host-api/api-client/shared contract change, direct renderer Gateway HTTP/WebSocket, provider transport change, or public API surface
  - changing TaskLoop final status, TaskLoop decision behavior, lifecycle payloads, persisted checkpoint payloads, reviewer prompts, model messages, provider ordering, retry policy, approval policy, verifier authority, or tool permission authority
  - executing tools, applying patches, sending messages, writing workspace files, invoking Gateway/Main/renderer transport, or replaying side effects as part of event-log comparison
  - treating event-log diagnostics, replay comparison, retention summaries, verifier sampling, or readiness output as task completion proof
featureFlags:
  - No new feature flag is added by this proposal.
  - Existing runtime.eventLog.persist remains default false.
  - Existing runtime.eventLog.shadow remains default false.
  - Existing runtime.resume.replayShadow remains default false.
  - runtime.resume.preferEventLog must remain absent/rejected.
rollback:
  - Stop using this proposal package or reject the future pilot implementation spec entrance.
  - Keep long_task_checkpoints authoritative for all current checkpoint/resume behavior.
  - A future controlled dual-read pilot must include a disable-only rollback drill that returns to long_task_checkpoints authoritative behavior without schema rollback, sidecar cleanup, Gateway/UI/API rollback, provider transport rollback, or TaskLoop behavior rollback.
  - Event-log rows created by earlier explicitly enabled diagnostics remain diagnostic data only and must not be required for rollback.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md --no-diff
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-resume-shadow.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-event-log-operator-inspection.test.ts tests/unit/runtime-event-log-resume-cutover-readiness.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "legacyAuthoritative:\\s*false|eventLogAuthoritative:\\s*true|resume authority|event-log-first|default_on" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components electron shared openclaw_runtime/src/gateway
  - node scripts/scan-pattern.mjs --pattern "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md
  - node scripts/scan-pattern.mjs --pattern "createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs docs/dev/runtime-research-boundaries.md
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.
acceptance:
  - This spec explicitly scopes phase 4 to a proposal-only package for a future limited controlled dual-read pilot.
  - The proposal defines a live evidence source or controlled corpus source before any future pilot implementation spec may begin.
  - The proposal defines dual-read comparison between legacy long_task_checkpoints and persisted RuntimeTaskEvent event-log replay without changing authority.
  - The proposal may recommend only blocked_before_pilot, needs_more_live_evidence, or ready_for_controlled_dual_read_pilot_implementation_spec.
  - The proposal must not recommend cutover_enabled, event_log_authoritative, default_on, or prefer_event_log.
  - Any mismatch, corruption, missing checkpoint, unreadable event-log state, missing table, retention-pruned checkpoint gap, or unsafe side-effect ambiguity vetoes pilot implementation.
  - Future pilot rollout is limited, explicit, diagnostic-only, and reversible to long_task_checkpoints authoritative behavior.
  - Boundary scans prove this phase does not add Gateway/UI/host-api/api-client/renderer/provider/TaskLoop/default-on/schema/service/listener/sidecar behavior.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Event Log Controlled Dual-Read Resume Pilot Proposal

This task is the phase 4 fresh-spec entry after resume cutover readiness research. It creates a proposal package only. It does not implement a pilot, does not approve event-log resume authority, and does not change runtime behavior.

## Priority Work Arrangement

P1 fresh task spec:
- Create this spec as the phase 4 entry point.
- Preserve the phase 3 authority boundary: long_task_checkpoints authoritative, event-log replay diagnostic-only.
- Validate the predecessor readiness spec with `--no-diff`.

P2 live evidence or controlled corpus proposal:
- Define the minimum acceptable source for future pilot evidence.
- Prefer controlled corpus cases built from sanitized, caller-owned summaries unless live evidence is explicitly bounded, consented, and sanitized.
- Require clean, partial, unreadable, corrupt-row, missing-table, missing-checkpoint, retention-pruned, mismatch, and unsafe side-effect ambiguity cases before any pilot implementation spec can start.

P3 veto gates, rollout, rollback, and boundary scans:
- Define the dual-read comparison contract between legacy checkpoint state and persisted RuntimeTaskEvent replay.
- Veto pilot implementation on mismatch, corruption, missing checkpoint, unreadable state, retention-pruned checkpoint gaps, or unsafe side-effect ambiguity.
- Require rollback drills that return to long_task_checkpoints authoritative behavior by disabling the future pilot only.
- Run the boundary scans listed in this spec and classify hits without modifying unrelated modules.

P4 handoff and index:
- Add a proposal handoff README with the matrix, decision states, future implementation spec entrance, validation results, and unrelated failure classification.
- Update the Workflow Checkpoint Engine index only with proposal-only status and links.

## Proposal Decision States

The proposal may recommend only:

- `blocked_before_pilot`
- `needs_more_live_evidence`
- `ready_for_controlled_dual_read_pilot_implementation_spec`

Any future implementation spec remains a separate approval step. None of these states grants resume authority to persisted RuntimeTaskEvent replay.

## Dual-Read Comparison Shape

A future controlled dual-read pilot proposal must compare:

- legacy source: latest authoritative `long_task_checkpoints` resume/checkpoint state;
- diagnostic source: persisted RuntimeTaskEvent replay summary;
- comparison output: bounded case id, sanitized checkpoint ids or hashes, replay read status, mismatch codes, side-effect ambiguity codes, retention evidence, and final proposal decision.

The comparison must not read raw transcripts into output, expose checkpoint payload bodies, execute tools, apply patches, write workspace files, send messages, invoke transport, or prove task completion.

## Future Implementation Spec Entrance

The only allowed next entrance is a fresh task spec for a limited controlled dual-read pilot implementation. That future spec must keep legacy checkpoint authority, define explicit opt-in scope, prove disable-only rollback, and rerun the boundary scans before any runtime behavior change is reviewed.
