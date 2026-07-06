# Runtime Event Log Controlled Dual-Read Resume Pilot Evidence Review

Status: ready_for_authority_cutover_readiness_spec
Date: 2026-07-01

This handoff records Runtime Event Log Phase 6. The package is docs/spec-only evidence review for bounded sanitized reports produced by the Phase 5 controlled dual-read helper. It does not implement event-log resume authority, does not add runtime behavior, and does not change TaskLoop, Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, schema, persistence defaults, prompts, model messages, retry, approval, tool policy, or side-effect replay behavior.

## Source Context

Read these files before continuing:

1. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/README.md`
2. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/phase6-entry.md`
3. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md`
4. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-proposal/README.md`
5. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`
6. `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/README.md`
7. `runtime-research/agent-runtime-index.md` Workflow Checkpoint Engine section

## Phase 6 Output

Files owned by this evidence-review package:

- `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md`
- `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review/README.md`
- `runtime-research/agent-runtime-index.md`

This package defines and records the evidence-review contract for Phase 5 helper reports. No new helper was added because the Phase 6 objective is satisfied by a fresh task spec, handoff, validation record, and runtime index pointer. Any future runtime-core evidence-review helper still requires explicit justification and must remain pure, explicit-call, default-closed, diagnostic-only, and non-authoritative.

`runtime-research/agent-runtime-index.md` was updated with byte-safe ASCII replacements because `apply_patch` could not read the file as valid UTF-8. The replacement touched only Workflow Checkpoint Engine status/link text and preserved all other bytes.

## Authority Boundary

- `long_task_checkpoints` remains authoritative for checkpoint and resume state.
- Persisted RuntimeTaskEvent event-log replay may only be a diagnostic comparison source.
- Phase 6 may recommend only `blocked_before_evidence_review`, `needs_more_dual_read_evidence`, or `ready_for_authority_cutover_readiness_spec`.
- `ready_for_authority_cutover_readiness_spec` allows only a later fresh cutover-readiness spec; it does not approve event-log authority, runtime cutover, default-on behavior, TaskLoop/Gateway/provider/UI/API changes, schema changes, side effects, or completion proof.
- Event-log diagnostics, replay comparison, retention summaries, Phase 5 helper decisions, and Phase 6 evidence-review output are not task completion proof.

## Accepted Evidence Inputs

The review accepts only bounded sanitized reports emitted by `buildRuntimeEventLogControlledDualReadResumePilotReport`:

- `schemaVersion: 1`
- `source: runtime.event_log.controlled_dual_read_resume_pilot`
- `legacyAuthoritative: true`
- `eventLogAuthoritative: false`
- `authority.diagnosticOnly: true`
- `authority.readonly: true`
- `authority.legacyCheckpointStoreAuthoritative: true`
- `authority.eventLogCurrentAuthority: false`
- `authority.runtimeBehaviorChanged: false`
- `authority.taskLoopDecisionChanged: false`
- `authority.replaySideEffects: false`
- `authority.schemaChanged: false`
- `authority.persistenceWritten: false`
- `authority.transportCalled: false`
- all `evidenceUse.*CompletionProof` fields false

The review must not consume raw Phase 5 input cases, raw SQLite rows, raw `record_json`, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, auth material, DB handles, files, sidecars, Gateway/Main/renderer/provider transport, or replayed side effects.

## Controlled Helper-Report Corpus Contract

The minimum Phase 6 corpus is a report set with these classes:

| Report class | Expected Phase 5 helper decision | Required evidence |
|---|---|---|
| Default-closed omitted invocation | `blocked_before_pilot` | `explicitInvocation: false`, `explicitPilotEnabled: false`, legacy authority true, event-log authority false. |
| Complete controlled corpus | `ready_for_controlled_dual_read_pilot` | All required scenarios, all boundary surfaces clear, rollback ready, veto gates represented and blocking where required. |
| Incomplete controlled corpus | `needs_more_live_evidence` | Missing scenario, boundary, or rollback diagnostics with no runtime behavior change. |
| Unblocked veto case | `blocked_before_pilot` | Any mismatch/unreadable/missing/retention/unsafe side-effect gate not marked blocking must block. |
| Invalid live evidence contract | `blocked_before_pilot` | Live summaries without explicit bounded sanitized caller-provided raw-details-excluded contract must block. |
| Sanitization/redaction case | `blocked_before_pilot` | Sensitive-looking raw tokens are redacted and treated as blocking evidence. |

Required controlled scenarios are:

- `clean`
- `partial`
- `unreadable`
- `corrupt_row`
- `missing_table`
- `missing_checkpoint`
- `retention_pruned`
- `mismatch`
- `unsafe_side_effect_ambiguity`

## Optional Live Diagnostic Summary Contract

Live diagnostic summaries are optional. They are admitted only as bounded Phase 5 helper report summaries when:

- `liveEvidence.used` is true;
- `liveEvidence.valid` is true;
- `explicitConsent`, `bounded`, `sanitized`, `callerProvided`, and `rawDetailsExcluded` are all true;
- no raw details are required to explain a decision.

Live diagnostic summaries cannot compensate for missing controlled corpus coverage and cannot approve current event-log authority.

## Evidence Review Decision Matrix

| Evidence condition | Phase 6 decision |
|---|---|
| Invalid Phase 5 report source/schema or malformed authority/evidence-use fields | `blocked_before_evidence_review` |
| Any report grants event-log authority, changes runtime behavior, changes TaskLoop decision, replays side effects, changes schema, writes persistence, or calls transport | `blocked_before_evidence_review` |
| Forbidden output strings appear in non-scan output or raw details leak | `blocked_before_evidence_review` |
| Veto gates are present but not blocking pilot readiness | `blocked_before_evidence_review` |
| Live evidence is present but its bounded sanitized caller-provided contract is invalid | `blocked_before_evidence_review` |
| Boundary evidence reports a forbidden runtime, transport, schema, service, sidecar, or default-on surface | `blocked_before_evidence_review` |
| Required report class, scenario, boundary surface, rollback item, or validation record is missing | `needs_more_dual_read_evidence` |
| Corpus complete, optional live summaries valid if present, vetoes block correctly, rollback is disable-only, scans are classified, and boundaries remain clear | `ready_for_authority_cutover_readiness_spec` |

## Phase 6 Decision

Decision: `ready_for_authority_cutover_readiness_spec`.

This decision allows only a later fresh authority cutover-readiness spec. It does not approve event-log authority, runtime cutover, default-on behavior, schema/table/index/migration work, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport work, TaskLoop decision changes, prompt/model-message changes, policy changes, side-effect replay, or completion proof from diagnostics.

## Rollback Drill

The Phase 6 rollback remains docs/spec-only:

1. Reject this evidence-review package or any later cutover-readiness spec entrance.
2. Stop consuming Phase 5 helper reports for evidence review.
3. Confirm runtime behavior still follows `long_task_checkpoints`.
4. Confirm no schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, or TaskLoop behavior rollback is required.

## Validation Results

Commands were run directly because `Get-Command rtk` returned no command in this checkout.

Passed:

- `git status --short`
- Required first-read files listed in this handoff.
- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md --no-diff`
- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md`
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts`
  - Result: 1 file passed, 6 tests passed.
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md --no-diff`
- `pnpm --dir openclaw_runtime db:kysely:check`
- `git diff --check -- harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review/README.md runtime-research/agent-runtime-index.md`

Expected or unrelated failures in the current dirty worktree:

- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md` failed on diff coverage because the worktree contains a very large set of unrelated modified/untracked files outside this task's touched areas. The same spec passes with `--no-diff`.
- `pnpm run typecheck`
  - Failed in unrelated `openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts` unused symbols: `FAILURE_SUGGESTED_ACTIONS` and `RuntimeFailureReplayEvidenceDecision`.
- `pnpm --dir openclaw_runtime lint:kysely`
  - Failed on pre-existing raw SQLite guardrail violations in memory files:
    - `src/memory/memory-store.ts`: 233, 234, 235, 414, 488, 647, 659, 707, 2095.
    - `src/runtime-core/memory-persistence.ts`: 736, 768, 774, 781, 1043, 1051, 1098, 1117, 1130, 1162, 1185, 1199.
    - `src/runtime-core/memory-read-hydration-shadow.ts`: 392.

Comms replay/compare were not run because this Phase 6 package did not touch Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or other communication paths.

## Boundary Scan Classification

Required scans were run with count/classification wrappers over the Phase 5 patterns plus a Phase 6 touched-path aggregation.

- `rg -n "runtime\.resume\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\s*true|legacyAuthoritative:\s*false" openclaw_runtime/src tests/unit harness/specs runtime-research`
  - broad count: 91.
  - Phase 6 touched-path count: 9.
  - Phase 6 hits are only hard-boundary text, required scan commands, and the existing runtime index note that `runtime.resume.preferEventLog` remains false/not implemented until future cutover.
- `rg -n "resume authority|event-log-first|default_on|default-on|defaultOn|event_log_authoritative" openclaw_runtime/src tests/unit harness/specs runtime-research`
  - broad count: 1209.
  - Phase 6 touched-path count: 83.
  - Phase 6 touched hits are hard-boundary text, required scan commands, and existing runtime index historical/default-on status text. No Phase 6 path grants event-log authority or default-on behavior.
- `rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components electron shared openclaw_runtime/src/gateway`
  - broad count: 27.
  - Phase 6 touched-path count: 0.
  - No Phase 6 Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, or direct transport surface was added.
- `rg -n "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\(|appendMany\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md`
  - broad count: 275.
  - Phase 6 touched-path count: 4.
  - Phase 6 hits are only task-spec forbidden-boundary text and required scan commands. No schema/table/index/migration or persistence write path was added.
- `rg -n "createServer|listen\(|WebSocketServer|http\.createServer|net\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs runtime-research`
  - broad count: 2018.
  - Phase 6 touched-path count: 81.
  - Phase 6 touched hits are hard-boundary docs/spec text, rollback language, required scan commands, and existing runtime index historical references. No service/listener/daemon/server/sidecar/exporter/collector/JSONL implementation was added.
- Phase 6 touched-path combined scan over `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md`, `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review`, and `runtime-research/agent-runtime-index.md`
  - touched-path count: 139.
  - Classification: docs/spec/index-only boundary declarations, validation commands, rollback language, and historical index entries. No runtime source, test helper, Gateway/UI/API/transport/schema/service/persistence path was added by Phase 6.

## Docs Sync

README translation updates are not required for this phase because it adds no user-visible behavior, public API, runtime behavior, or architecture change beyond harness/runtime-research planning documents.

## Remaining Boundaries

- No event-log resume authority.
- No `runtime.resume.preferEventLog`.
- No `cutover_enabled` output.
- No `event_log_authoritative` output.
- No `default_on`, `default-on`, or `defaultOn` output.
- No schema/table/index/migration.
- No DB/table/file creation, SQLite writes, or JSON/JSONL/TXT sidecar.
- No Gateway route, Electron IPC, renderer UI, host-api, api-client, shared contract, provider transport, TaskLoop status/decision, prompt/model-message, retry/approval/tool policy, service/listener/daemon/server.
- No tool execution, patch apply, workspace writes, message sends, or transport calls as replay behavior.
- No treating event-log diagnostics, replay comparison, retention summaries, Phase 5 helper decisions, or Phase 6 evidence-review output as completion proof.

## Next Stage Entrance

If Phase 6 closes as `ready_for_authority_cutover_readiness_spec`, the only allowed next step is a later fresh cutover-readiness spec. That next spec still must not approve event-log authority, runtime cutover, default-on behavior, schema/table/index/migration changes, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport changes, TaskLoop decision changes, prompt/model-message changes, policy changes, side-effect replay, or completion proof from diagnostics.
