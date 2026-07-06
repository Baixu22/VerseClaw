---
id: runtime-event-log-controlled-dual-read-resume-pilot-evidence-review
title: Runtime event-log controlled dual-read resume pilot evidence review
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Create a fresh docs/spec-only evidence review package for bounded sanitized Phase 5 controlled dual-read helper reports while keeping long_task_checkpoints authoritative and event-log replay diagnostic-only.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md
  - runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md
  - runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review/**
  - runtime-research/agent-runtime-index.md
expectedUserBehavior:
  - No user-visible runtime behavior changes.
  - No resume behavior changes.
  - long_task_checkpoints remains authoritative for checkpoint and resume decisions.
  - RuntimeTaskEvent event-log replay summaries remain diagnostic-only comparison input.
  - Phase 6 evidence review consumes only bounded sanitized reports emitted by the Phase 5 helper and optional explicit bounded sanitized live diagnostic summaries already contained in those reports.
  - Evidence review output may recommend only blocked_before_evidence_review, needs_more_dual_read_evidence, or ready_for_authority_cutover_readiness_spec.
  - ready_for_authority_cutover_readiness_spec permits only a later fresh cutover-readiness spec; it does not approve event-log authority, runtime cutover, default-on behavior, or any TaskLoop/Gateway/provider/UI/API change.
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
  - executing tools, applying patches, sending messages, writing workspace files, invoking Gateway/Main/renderer/provider transport, calling provider transport, or replaying side effects as part of evidence review
  - treating event-log diagnostics, replay comparison, retention summaries, evidence-review output, or any Phase 5 helper decision as task completion proof
featureFlags:
  - No runtime config flag is added by this task.
  - Existing runtime.eventLog.persist remains default false.
  - Existing runtime.eventLog.shadow remains default false.
  - Existing runtime.resume.replayShadow remains default false.
  - runtime.resume.preferEventLog must remain absent/rejected.
rollback:
  - Reject this evidence-review package or the later cutover-readiness spec entrance.
  - Keep long_task_checkpoints authoritative for all current checkpoint/resume behavior.
  - Stop consuming Phase 5 helper reports for evidence review.
  - No schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, or TaskLoop behavior rollback is required.
requiredTests:
  - rtk pnpm harness context --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md
  - rtk pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md --no-diff
  - rtk pnpm harness context --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md
  - rtk pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md
  - rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts
  - rtk pnpm run typecheck
  - rtk pnpm --dir openclaw_runtime db:kysely:check
  - rtk pnpm --dir openclaw_runtime lint:kysely
  - rtk rg -n "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false" openclaw_runtime/src tests/unit harness/specs runtime-research
  - rtk rg -n "resume authority|event-log-first|default_on|default-on|defaultOn|event_log_authoritative" openclaw_runtime/src tests/unit harness/specs runtime-research
  - rtk rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components electron shared openclaw_runtime/src/gateway
  - rtk rg -n "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md
  - rtk rg -n "createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs runtime-research
  - rtk rg -n "runtime\\.resume\\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|default_on|default-on|defaultOn|eventLogAuthoritative:\\s*true|legacyAuthoritative:\\s*false|window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(|create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\\(|appendMany\\(|createServer|listen\\(|WebSocketServer|http\\.createServer|net\\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review runtime-research/agent-runtime-index.md
  - rtk pnpm run comms:replay and rtk pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.
acceptance:
  - This task creates only a fresh evidence-review spec, handoff package, and runtime index pointer update unless a separate pure helper is explicitly justified.
  - Evidence review consumes only Phase 5 helper report objects with schemaVersion 1, source runtime.event_log.controlled_dual_read_resume_pilot, legacyAuthoritative true, eventLogAuthoritative false, diagnosticOnly true, readonly true, runtimeBehaviorChanged false, taskLoopDecisionChanged false, replaySideEffects false, schemaChanged false, persistenceWritten false, and transportCalled false.
  - Evidence review must not consume Phase 5 raw case input, raw rows, raw record_json, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, auth material, DB handles, files, sidecars, Gateway/Main/renderer/provider transport, or replay side effects.
  - The controlled helper-report corpus contract covers default-closed blocked behavior, complete controlled-corpus readiness, incomplete corpus needs-more behavior, veto-not-blocking blocked behavior, invalid live-evidence contract blocking, and bounded sanitization/redaction blocking.
  - Controlled corpus coverage includes clean, partial, unreadable, corrupt-row, missing-table, missing-checkpoint, retention-pruned, mismatch, and unsafe side-effect ambiguity scenarios before ready_for_authority_cutover_readiness_spec can be reported.
  - Optional live diagnostic summaries are admitted only when the Phase 5 helper report marks liveEvidence.used true and liveEvidence.valid true with explicitConsent, bounded, sanitized, callerProvided, and rawDetailsExcluded all true.
  - Any invalid helper source/schema, authority drift, forbidden output string, raw detail leak, missing corpus class, missing required scenario, unblocked veto gate, boundary drift, incomplete rollback proof, or live evidence contract failure blocks or withholds readiness.
  - Output may contain only blocked_before_evidence_review, needs_more_dual_read_evidence, or ready_for_authority_cutover_readiness_spec as the evidence-review decision.
  - ready_for_authority_cutover_readiness_spec allows only the next fresh cutover-readiness spec; it does not approve event-log authority, runtime cutover, default-on behavior, TaskLoop/Gateway/provider/UI/API changes, schema/table/index/migration, side effects, or completion proof.
  - Boundary scans classify both broad hits and Phase 6 touched-path hits without modifying unrelated modules.
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review/README.md
---

# Runtime Event Log Controlled Dual-Read Resume Pilot Evidence Review

This task is the Phase 6 fresh-spec entry after the controlled dual-read resume pilot helper implementation. It is an evidence review package only. It does not enable event-log resume authority and does not change runtime behavior.

## Priority Work Arrangement

P1 fresh evidence-review task spec:
- Create this spec as the Phase 6 entry point.
- Preserve the Phase 5 authority boundary: long_task_checkpoints authoritative, event-log replay diagnostic-only.
- Validate the Phase 5 implementation spec with `--no-diff`.

P2 controlled Phase 5 helper-report corpus contract:
- Review only bounded sanitized reports emitted by `buildRuntimeEventLogControlledDualReadResumePilotReport`.
- Require report-level authority fields to prove diagnostic-only, readonly, no runtime behavior change, no TaskLoop decision change, no replayed side effects, no schema change, no persistence write, and no transport call.
- Require controlled report coverage for default-closed blocked behavior, complete corpus readiness, incomplete corpus needs-more behavior, unblocked veto blocking, invalid live-evidence blocking, and sanitization/redaction blocking.
- Require scenario coverage for clean, partial, unreadable, corrupt-row, missing-table, missing-checkpoint, retention-pruned, mismatch, and unsafe side-effect ambiguity cases.

P3 optional live diagnostic summary contract:
- Live diagnostic summaries may be reviewed only through the Phase 5 helper report's bounded `liveEvidence` summary.
- Live evidence must be explicit, bounded, sanitized, caller-provided, and raw-details-excluded.
- Live evidence cannot compensate for missing controlled corpus coverage or approve current authority.

P4 veto, rollback, boundary aggregation and scans:
- Aggregate helper decisions, veto gates, rollback proof, evidence-use flags, and boundary surfaces at report level.
- Treat any forbidden authority, transport, schema-write, service, sidecar, raw-detail, side-effect, completion-proof, or rollback drift as blocking.
- Run the Phase 5 forbidden authority / transport / schema-write / service-sidecar scans and add a Phase 6 touched-path classification scan.

P5 handoff and index:
- Add a Phase 6 handoff README with source context, evidence contract, decision matrix, validation results, boundary scan classifications, unrelated failure classifications, docs-sync decision, and remaining boundaries.
- Update the Workflow Checkpoint Engine index only after the evidence review package exists.

## Evidence Review Decision States

The Phase 6 review may recommend only:

- `blocked_before_evidence_review`
- `needs_more_dual_read_evidence`
- `ready_for_authority_cutover_readiness_spec`

The last state means only that a later fresh cutover-readiness spec may be written. It does not approve event-log authority, runtime cutover, default-on behavior, TaskLoop/Gateway/provider/UI/API changes, schema changes, side-effect replay, or completion proof.

## Helper-Report Corpus Contract

The minimum controlled corpus is a set of Phase 5 helper reports, not raw Phase 5 input cases. The review accepts only reports with:

- `schemaVersion: 1`.
- `source: runtime.event_log.controlled_dual_read_resume_pilot`.
- `legacyAuthoritative: true` and `eventLogAuthoritative: false`.
- `authority.diagnosticOnly`, `authority.readonly`, and `authority.legacyCheckpointStoreAuthoritative` all true.
- `authority.eventLogCurrentAuthority`, `authority.runtimeBehaviorChanged`, `authority.taskLoopDecisionChanged`, `authority.replaySideEffects`, `authority.schemaChanged`, `authority.persistenceWritten`, and `authority.transportCalled` all false.
- `evidenceUse.eventLogDiagnosticsAreCompletionProof`, `evidenceUse.replayComparisonIsCompletionProof`, `evidenceUse.retentionSummaryIsCompletionProof`, `evidenceUse.pilotDecisionIsCompletionProof`, and `evidenceUse.pilotDecisionChangesRuntimeBehavior` all false.
- Bounded `matrix`, `vetoSummary`, `boundary`, `rollback`, `liveEvidence`, and `diagnostics` summaries only.

The required report classes are:

| Report class | Expected Phase 5 helper decision | Evidence purpose |
|---|---|---|
| default-closed omitted invocation | `blocked_before_pilot` | Proves explicit-call/default-closed behavior. |
| complete controlled corpus | `ready_for_controlled_dual_read_pilot` | Proves all required scenarios, boundary surfaces, rollback proof, and veto gates can be represented diagnostically. |
| incomplete controlled corpus | `needs_more_live_evidence` | Proves missing matrix, boundary, or rollback evidence withholds readiness. |
| unblocked veto case | `blocked_before_pilot` | Proves mismatch, unreadable, missing, retention, or side-effect vetoes must block. |
| invalid live evidence contract | `blocked_before_pilot` | Proves live summaries must be explicit, bounded, sanitized, caller-provided, and raw-details-excluded. |
| sanitization/redaction case | `blocked_before_pilot` | Proves raw-looking or sensitive-looking tokens are redacted and treated as blocking evidence. |

## Aggregation Rules

- `blocked_before_evidence_review`: use when Phase 5 report source/schema is invalid, authority fields drift, forbidden strings appear in non-scan output, raw details leak, a veto gate is not blocking, live evidence is invalid, rollback proof contradicts legacy authority, boundary evidence reports a forbidden surface, or validation proves the Phase 6 package crossed a hard boundary.
- `needs_more_dual_read_evidence`: use when report classes, required controlled scenarios, boundary surfaces, rollback evidence, or validation records are incomplete but no forbidden runtime authority or boundary drift is detected.
- `ready_for_authority_cutover_readiness_spec`: use only when the controlled helper-report corpus is complete, optional live summaries are valid if present, vetoes block correctly, rollback remains disable-only to long_task_checkpoints, boundary scans are classified, and no forbidden runtime/schema/transport/service/side-effect/default-on surface is added.

## Explicit Non-Goals

Phase 6 does not add a runtime config flag, database object, sidecar file, collector, exporter, Gateway route, Electron IPC channel, renderer UI, host-api method, api-client method, shared contract, provider transport, TaskLoop decision/status path, prompt/model-message path, retry/approval/tool policy path, or replay side-effect path.

Phase 6 does not treat diagnostics, helper reports, replay comparison, retention summaries, evidence-review output, or the next-spec recommendation as completion proof.
