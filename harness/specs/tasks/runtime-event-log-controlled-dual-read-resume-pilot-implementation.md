---
id: runtime-event-log-controlled-dual-read-resume-pilot-implementation
title: Runtime event-log controlled dual-read resume pilot implementation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement a limited, explicit, default-closed, diagnostic-only controlled dual-read comparison helper for legacy long_task_checkpoints and persisted RuntimeTaskEvent replay summaries while keeping long_task_checkpoints authoritative.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md
  - runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/event-log-controlled-dual-read-resume-pilot.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md
  - runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No resume behavior changes.
  - long_task_checkpoints remains authoritative for checkpoint and resume decisions.
  - RuntimeTaskEvent event-log replay summaries remain diagnostic-only comparison input.
  - The helper is pure and explicit-call only; omitted invocation or caller enablement returns blocked diagnostics.
  - The helper may output only blocked_before_pilot, needs_more_live_evidence, or ready_for_controlled_dual_read_pilot.
  - The helper always returns legacyAuthoritative true and eventLogAuthoritative false.
  - The helper must not output cutover_enabled, event_log_authoritative, default_on, default-on, prefer_event_log, or runtime.resume.preferEventLog.
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
  - runtime.resume.preferEventLog, preferEventLog, event-log-first resume ordering, replacing long_task_checkpoints as authoritative, default-on behavior, cutover_enabled output, event_log_authoritative output, default_on output, default-on output, or prefer_event_log output
  - new schema table/index/migration, database creation, table creation, SQLite writes, JSON/JSONL/TXT sidecars, non-SQLite OpenClaw-owned runtime state, new service, listener, daemon, local HTTP server, WebSocket server, second Gateway, exporter, collector, or database service
  - Gateway route, Electron IPC route, renderer UI/page/component, host-api/api-client/shared contract change, direct renderer Gateway HTTP/WebSocket, provider transport change, or public API surface
  - changing TaskLoop final status, TaskLoop decision behavior, lifecycle payloads, persisted checkpoint payloads, reviewer prompts, model messages, provider ordering, retry policy, approval policy, verifier authority, or tool permission authority
  - executing tools, applying patches, sending messages, writing workspace files, invoking Gateway/Main/renderer transport, calling provider transport, or replaying side effects as part of event-log comparison
  - treating event-log diagnostics, replay comparison, retention summaries, verifier sampling, readiness output, or pilot decision output as task completion proof
featureFlags:
  - No runtime config flag is added by this task.
  - Existing runtime.eventLog.persist remains default false.
  - Existing runtime.eventLog.shadow remains default false.
  - Existing runtime.resume.replayShadow remains default false.
  - runtime.resume.preferEventLog must remain absent/rejected.
rollback:
  - Stop calling the helper, or pass explicitPilotEnabled false.
  - Keep long_task_checkpoints authoritative for all current checkpoint/resume behavior.
  - No schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, or TaskLoop behavior rollback is required.
  - Event-log rows created by earlier explicitly enabled diagnostics remain diagnostic data only and are not required for rollback.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md --no-diff
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-resume-shadow.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-event-log-operator-inspection.test.ts tests/unit/runtime-event-log-resume-cutover-readiness.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - node scripts/scan-pattern.mjs --pattern "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "resume authority|event-log-first|default_on|default-on|defaultOn|event_log_authoritative" openclaw_runtime/src tests/unit harness/specs docs/dev/runtime-research-boundaries.md
  - node scripts/scan-pattern.mjs --pattern "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components electron shared openclaw_runtime/src/gateway
  - node scripts/scan-pattern.mjs --pattern "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md
  - node scripts/scan-pattern.mjs --pattern "createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs docs/dev/runtime-research-boundaries.md
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.
acceptance:
  - This spec implements only an explicit diagnostic helper and documentation package.
  - The helper consumes only caller-provided sanitized summaries from a controlled corpus first, with optional live evidence only when explicit, bounded, sanitized, and caller-provided.
  - The helper compares legacy long_task_checkpoints summaries with persisted RuntimeTaskEvent replay summaries in memory only.
  - The helper reads no DB or files, writes no DB or files, creates no schema/table/index/migration, creates no JSON/JSONL/TXT sidecar, and calls no Gateway/Main/renderer/provider transport.
  - The helper does not execute tools, apply patches, write workspace files, send messages, replay side effects, or prove task completion.
  - Output is bounded and sanitized; raw rows, raw record_json, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, and auth material are excluded.
  - Any mismatch, corrupt row, partial or unreadable event-log evidence, missing event-log table, missing checkpoint evidence, retention-pruned checkpoint gap, unsafe side-effect ambiguity, unbounded live evidence, boundary drift, or incomplete rollback proof blocks or withholds pilot readiness.
  - Output may contain only blocked_before_pilot, needs_more_live_evidence, or ready_for_controlled_dual_read_pilot as the pilot decision.
  - Output keeps legacyAuthoritative true and eventLogAuthoritative false.
  - Future event-log authority cutover still requires a later fresh spec and is not approved by this task.
  - Boundary scans prove this phase does not add Gateway/UI/host-api/api-client/renderer/provider/TaskLoop/default-on/schema/service/listener/sidecar behavior.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Event Log Controlled Dual-Read Resume Pilot Implementation

This task implements the first limited controlled dual-read comparison helper after the phase 4 proposal. It is not a resume authority cutover and does not change runtime behavior.

## Priority Work Arrangement

P1 fresh implementation task spec:
- Create this spec as the phase 5 implementation entry point.
- Preserve the phase 4 authority boundary: long_task_checkpoints authoritative, event-log replay diagnostic-only.
- Validate the predecessor proposal spec with `--no-diff`.

P2 controlled corpus and bounded input contract:
- Prefer controlled corpus cases over live evidence.
- Require controlled corpus coverage for clean, partial, unreadable, corrupt-row, missing-table, missing-checkpoint, retention-pruned, mismatch, and unsafe side-effect ambiguity scenarios before a ready pilot decision is allowed.
- Allow live diagnostic summaries only when they are explicit, bounded, sanitized, caller-provided, and exclude raw details.

P3 diagnostic-only helper and tests:
- Add a pure runtime-core helper that consumes caller-provided summaries only.
- Require explicit invocation and explicit caller enablement; omitted inputs return blocked diagnostics.
- Output bounded diagnostics and one of the three allowed pilot decisions.
- Add focused tests for default-closed behavior, corpus readiness, veto gates, live evidence bounds, sanitization, and forbidden output strings.

P4 veto gates, rollback drill, and boundary scans:
- Veto readiness when comparison, retention, corrupt/unreadable data, missing checkpoint, unsafe side-effect, live-evidence, boundary, or rollback evidence fails.
- Prove disable-only rollback back to legacy checkpoint behavior.
- Run the boundary scans listed in this spec and classify hits without modifying unrelated modules.

P5 handoff and index:
- Add an implementation handoff README with matrix, helper contract, tests, validation results, unrelated failure classification, and remaining boundaries.
- Update the Workflow Checkpoint Engine index only after implementation evidence exists.

## Pilot Decision States

The helper may output only:

- `blocked_before_pilot`
- `needs_more_live_evidence`
- `ready_for_controlled_dual_read_pilot`

None of these states grants authority to persisted RuntimeTaskEvent replay. Future authority cutover remains a later fresh-spec decision.

## Next Stage Entrance

The next Runtime Event Log stage may only start from a fresh task spec. The recommended entry is a controlled dual-read resume pilot evidence review that evaluates bounded, sanitized helper reports and optional live diagnostic summaries before any authority-cutover readiness work is considered.

That next stage must not enable event-log resume authority, default-on behavior, schema/table/index/migration changes, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport surfaces, TaskLoop decision changes, prompt/model-message changes, policy changes, or replay side effects.
