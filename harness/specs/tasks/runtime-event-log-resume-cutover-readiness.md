---
id: runtime-event-log-resume-cutover-readiness
title: Runtime event-log resume cutover readiness research
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a fresh-spec-only readiness research and proof-plan layer for deciding whether persisted RuntimeTaskEvent logs could later enter a limited resume-source pilot, while keeping long_task_checkpoints authoritative today.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md
  - runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/event-log-resume-cutover-readiness.ts
  - tests/unit/runtime-event-log-resume-cutover-readiness.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md
  - runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - Runtime Event Log readiness output is diagnostic-only, bounded, sanitized, and explicit-call only.
  - long_task_checkpoints remains the authoritative checkpoint/resume store.
  - A readiness report may recommend only blocked_for_cutover, needs_more_evidence, or ready_for_limited_future_pilot_proposal.
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
  - runtime.resume.preferEventLog, cutover_enabled, event-log-first ordering, replacing long_task_checkpoints as authoritative, default-on persistence, or default-on replay
  - new schema table/index/migration, database creation, table creation, SQLite writes, JSON/JSONL/TXT sidecars, or non-SQLite OpenClaw-owned runtime state
  - Gateway route, Electron IPC route, renderer UI/page/component, host-api/api-client/shared contract change, direct renderer Gateway HTTP/WebSocket, provider transport change, or public API surface
  - changing TaskLoop final status, lifecycle payloads, persisted checkpoint payloads, reviewer prompts, model messages, provider ordering, retry policy, approval policy, verifier authority, or tool permission authority
  - executing tools, applying patches, sending messages, writing workspace files, invoking Gateway/Main/renderer transport, or replaying side effects as part of comparison
  - treating event-log diagnostics, replay comparison, retention summaries, verifier sampling, or readiness output as task completion proof
  - service, listener, daemon, local HTTP server, WebSocket server, Temporal service, second Gateway, second runtime, exporter, collector, or database service
featureFlags:
  - No new feature flag is added by this task.
  - Existing runtime.eventLog.persist remains default false.
  - Existing runtime.eventLog.shadow remains default false.
  - Existing runtime.resume.replayShadow remains default false.
  - runtime.resume.preferEventLog must remain absent/rejected.
rollback:
  - Stop invoking or remove the diagnostic readiness helper/spec package.
  - Keep long_task_checkpoints authoritative.
  - Keep event-log persistence and replay defaults disabled unless explicitly enabled for diagnostics by earlier specs.
  - No schema, sidecar, Gateway, Electron, renderer, host-api, api-client, provider, TaskLoop, prompt, policy, or transport rollback is required because this task must not touch those surfaces.
requiredTests:
  - rtk pnpm harness context --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
  - rtk pnpm harness validate --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md --no-diff
  - rtk pnpm harness validate --spec harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md --no-diff
  - rtk pnpm harness validate --spec harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md --no-diff
  - rtk pnpm harness context --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md
  - rtk pnpm harness validate --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md
  - rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-resume-shadow.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-event-log-operator-inspection.test.ts tests/unit/runtime-event-log-resume-cutover-readiness.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts
  - rtk pnpm run typecheck
  - rtk pnpm --dir openclaw_runtime db:kysely:check
  - rtk pnpm --dir openclaw_runtime lint:kysely
  - rtk rg -n "runtime\.resume\.preferEventLog|preferEventLog" openclaw_runtime/src tests/unit harness/specs runtime-research
  - rtk rg -n "legacyAuthoritative:\s*false|eventLogAuthoritative:\s*true|cutover_enabled|resume authority|event-log-first" openclaw_runtime/src tests/unit harness/specs runtime-research
  - rtk rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components electron shared openclaw_runtime/src/gateway
  - rtk rg -n "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\(|appendMany\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md
  - rtk rg -n "createServer|listen\(|WebSocketServer|http\.createServer|net\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs runtime-research
acceptance:
  - This spec explicitly scopes phase 3 to readiness research and proof planning only.
  - Readiness output is bounded and sanitized; it excludes raw record_json, raw rows, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, and auth material.
  - Readiness output can only recommend blocked_for_cutover, needs_more_evidence, or ready_for_limited_future_pilot_proposal.
  - legacyAuthoritative remains true and eventLogAuthoritative remains false in all readiness output.
  - The controlled matrix covers clean, partial, unreadable, corrupt-row, missing-table, missing-checkpoint, retention-pruned, mismatch, and unsafe side-effect ambiguity cases.
  - Veto gates block any future cutover proposal when mismatch, corruption, missing checkpoint evidence, unreadable event-log state, missing table, or unsafe side-effect ambiguity is present.
  - Rollback requirements require returning to long_task_checkpoints authoritative behavior before any later pilot proposal can proceed.
  - Boundary scans prove this phase does not add Gateway/UI/host-api/api-client/renderer/provider/TaskLoop/default-on/schema/service/listener/sidecar cutover surfaces.
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/README.md
---

# Runtime Event Log Resume Cutover Readiness Research

This task establishes the readiness proof plan for a possible future limited pilot. It is not a resume cutover implementation and does not make persisted RuntimeTaskEvent logs authoritative.

## Priority Work Arrangement

P1 fresh task spec:
- Create this task spec as the phase 3 entry point.
- Keep predecessor specs validated or classified without changing their behavior.

P2 readiness proof plan:
- Add a pure diagnostic helper that consumes caller-provided sanitized comparison summaries, controlled-corpus status, boundary-scan status, and rollback evidence.
- Output only bounded sanitized summaries and diagnostic recommendations.
- Keep the output non-authoritative: legacyAuthoritative true, eventLogAuthoritative false.

P3 tests and boundary scans:
- Add focused unit tests for pure-function behavior, bounded output, diagnostic-only recommendations, veto handling, rollback requirements, and authority constants.
- Run or record the required boundary scans.

P4 handoff/index:
- Record validation results, unrelated failures, boundary-scan classifications, and the next fresh-spec-only direction.
- Update the Workflow Checkpoint Engine index only with readiness/spec-only status.

## Hard Boundaries

- No current event-log authority for resume.
- No default-on behavior.
- No new config flag.
- No schema, table, index, migration, database write, sidecar, service, listener, Gateway route, Electron IPC, renderer UI, host-api, api-client, shared contract, provider transport, TaskLoop status/decision, prompt/model-message, retry policy, approval policy, or tool policy change.
- No side-effect replay.
- No completion proof from event-log diagnostics, replay comparison, retention evidence, verifier output, or readiness output.
