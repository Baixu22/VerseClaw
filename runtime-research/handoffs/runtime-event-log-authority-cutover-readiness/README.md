# Runtime Event Log Authority Cutover Readiness

Status: ready_for_limited_authority_cutover_implementation_spec
Date: 2026-07-01

This handoff records the docs/spec-only Runtime Event Log authority cutover readiness package. It reviews whether prior bounded evidence is enough to write a later limited authority cutover implementation spec. It does not implement event-log resume authority, does not switch runtime authority, and does not change TaskLoop, Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, schema, persistence defaults, prompts, model messages, retry, approval, tool policy, or side-effect replay behavior.

## Source Context

Read before this package was created:

1. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review/README.md`
2. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md`
3. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/README.md`
4. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/phase6-entry.md`
5. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md`
6. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-proposal/README.md`
7. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`
8. `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/README.md`
9. `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/phase4-entry.md`
10. `harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md`
11. `runtime-research/agent-runtime-index.md` Workflow Checkpoint Engine section

## Phase 0 Context

- `git status --short` showed a very large dirty worktree with many unrelated modified and untracked files.
- `rtk` is not available in this shell; `where.exe rtk` returned no match. Required commands are run directly and recorded that way.
- Current prior Runtime Event Log context is consistent: Phase 6 closed as `ready_for_authority_cutover_readiness_spec`, and the index states event-log current authority remains false.
- Current allowed scope is docs/spec-only readiness gating and later-spec entrance definition.
- Current forbidden scope is runtime implementation, current event-log authority, runtime cutover, default-on behavior, schema/table/index/migration, DB/table/file creation, SQLite writes, JSON/JSONL/TXT sidecars, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport changes, TaskLoop status/decision changes, prompt/model-message changes, retry/approval/tool policy changes, service/listener/daemon/server/exporter/collector work, and replay side effects.

## Phase Output

Files owned by this readiness package:

- `harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md`
- `runtime-research/handoffs/runtime-event-log-authority-cutover-readiness/README.md`
- `runtime-research/agent-runtime-index.md`

This package defines a docs/spec-only readiness matrix for whether a later limited authority cutover implementation spec may be written. It does not approve runtime cutover.

`runtime-research/agent-runtime-index.md` was updated with byte-safe ASCII replacements because `apply_patch` could not read the file as valid UTF-8. The replacement touched only Workflow Checkpoint Engine status/link text and preserved all other bytes.

## Authority Boundary

- `long_task_checkpoints` remains authoritative for checkpoint and resume state.
- Persisted RuntimeTaskEvent event-log replay may only be diagnostic comparison evidence.
- This readiness package may recommend only `blocked_before_cutover_readiness`, `needs_more_authority_cutover_evidence`, or `ready_for_limited_authority_cutover_implementation_spec`.
- `ready_for_limited_authority_cutover_implementation_spec` allows only a later fresh implementation spec. It does not approve event-log authority, runtime cutover, default-on behavior, TaskLoop/Gateway/provider/UI/API changes, schema changes, side effects, or completion proof.
- Event-log diagnostics, replay comparison, retention summaries, Phase 5 helper decisions, Phase 6 evidence-review output, and this readiness output are not task completion proof.

## Accepted Evidence Inputs

The readiness review accepts only:

- prior task specs and handoff decisions from the Runtime Event Log chain;
- validation records and boundary scan classifications from those handoffs;
- bounded sanitized Phase 5 helper reports admitted through Phase 6 evidence review;
- optional live diagnostic summaries only when they are already present in valid Phase 5 helper reports and marked explicit, bounded, sanitized, caller-provided, and raw-details-excluded.

The review must not consume raw Phase 5 input cases, raw SQLite rows, raw `record_json`, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, auth material, DB handles, files, sidecars, Gateway/Main/renderer/provider transport, or replayed side effects.

## Required Corpus And Gates

The Phase 6 helper-report corpus must cover:

- default-closed omitted invocation;
- complete controlled corpus;
- incomplete controlled corpus;
- unblocked veto case;
- invalid live evidence contract;
- sanitization/redaction case.

Controlled scenario coverage remains required for:

- `clean`
- `partial`
- `unreadable`
- `corrupt_row`
- `missing_table`
- `missing_checkpoint`
- `retention_pruned`
- `mismatch`
- `unsafe_side_effect_ambiguity`

Veto gates must block mismatch, unreadable or corrupt data, missing table, missing checkpoint, retention-pruned checkpoint gaps, unsafe side-effect ambiguity, invalid live evidence, raw-detail leak, forbidden authority drift, schema drift, transport drift, service/sidecar drift, default-on drift, and rollback drift.

Operator gates for a future implementation spec must include explicit fresh spec approval, explicit operator enablement, disable-only rollback, kill switch or equivalent stop path, boundary scans, validation records, and confirmation that `long_task_checkpoints` remains authoritative until the future spec explicitly proves and approves otherwise.

## Readiness Decision Matrix

| Evidence condition | Readiness decision |
|---|---|
| Missing required Phase 0 context, contradictory prior authority boundary, or unavailable predecessor handoff/spec/index | `blocked_before_cutover_readiness` |
| Any evidence grants current event-log authority, replaces `long_task_checkpoints`, changes runtime behavior, changes TaskLoop decisions, replays side effects, writes persistence, changes schema, calls transport, or adds API/UI/provider surfaces | `blocked_before_cutover_readiness` |
| Any required Phase 6 corpus class, controlled scenario, veto proof, rollback item, operator gate, boundary surface, or validation record is missing | `needs_more_authority_cutover_evidence` |
| Optional live summaries are present but not explicit, bounded, sanitized, caller-provided, and raw-details-excluded | `blocked_before_cutover_readiness` |
| Boundary scans show forbidden touched-path implementation changes | `blocked_before_cutover_readiness` |
| Prior Phase 6 evidence is complete, vetoes block correctly, rollback is disable-only, operator gates are defined, scans are classified, and no forbidden implementation surface was added | `ready_for_limited_authority_cutover_implementation_spec` |

## Current Readiness Assessment

Decision: `ready_for_limited_authority_cutover_implementation_spec`.

Prior Phase 6 evidence is complete enough to define the fresh authority cutover readiness gate, and this package stayed docs/spec-only. The decision allows only a later fresh limited authority cutover implementation spec. It does not approve event-log authority, runtime cutover, default-on behavior, schema/table/index/migration work, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport work, TaskLoop decision changes, prompt/model-message changes, policy changes, side-effect replay, or completion proof from diagnostics.

## Rollback Drill

The readiness rollback remains docs/spec-only:

1. Reject this readiness package or decline the later implementation-spec entrance.
2. Stop using Phase 5 helper reports and Phase 6 evidence-review output as cutover-readiness input.
3. Confirm runtime behavior still follows `long_task_checkpoints`.
4. Confirm no schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, policy rollback, or TaskLoop behavior rollback is required.

## Validation Results

Commands were run directly because `rtk` exists in policy docs but `where.exe rtk` returned no match in this checkout.

Passed:

- `git status --short`
- Required Phase 0 source-context reads listed in this handoff.
- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md --no-diff`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md --no-diff`
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts`
  - Result: 1 file passed, 6 tests passed.
- `pnpm --dir openclaw_runtime db:kysely:check`
- `git diff --check -- harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md runtime-research/handoffs/runtime-event-log-authority-cutover-readiness/README.md runtime-research/agent-runtime-index.md`
  - Result: passed with an existing line-ending warning for `runtime-research/agent-runtime-index.md`.

Expected or unrelated failures in the current dirty worktree:

- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md`
  - Failed on diff coverage because the worktree contains a very large set of unrelated modified/untracked files outside this task's touched areas. The same spec passes with `--no-diff`.
- `pnpm run typecheck`
  - Failed in unrelated `openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts` unused symbols: `FAILURE_SUGGESTED_ACTIONS` and `RuntimeFailureReplayEvidenceDecision`.
- `pnpm --dir openclaw_runtime lint:kysely`
  - Failed on pre-existing raw SQLite guardrail violations in memory files:
    - `src/memory/memory-store.ts`: 233, 234, 235, 414, 488, 647, 659, 707, 2095.
    - `src/runtime-core/memory-persistence.ts`: 736, 768, 774, 781, 1043, 1051, 1098, 1117, 1130, 1162, 1185, 1199.
    - `src/runtime-core/memory-read-hydration-shadow.ts`: 392.

Comms replay/compare were not run because this readiness package did not touch Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or other communication paths.

## Boundary Scan Classification

Required scans were run with count/classification wrappers over the Phase 6 patterns plus a new touched-path aggregation.

- `rg -n "runtime\.resume\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\s*true|legacyAuthoritative:\s*false" openclaw_runtime/src tests/unit harness/specs runtime-research`
  - broad count: 104.
  - touched-path count: 11.
  - Touched hits are only hard-boundary text and required scan commands. No touched path grants event-log authority or disables legacy authority.
- `rg -n "resume authority|event-log-first|default_on|default-on|defaultOn|event_log_authoritative" openclaw_runtime/src tests/unit harness/specs runtime-research`
  - broad count: 1241.
  - touched-path count: 78.
  - Touched hits are hard-boundary text, required scan commands, and existing historical index language. No touched path grants event-log authority or default-on behavior.
- `rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components electron shared openclaw_runtime/src/gateway`
  - broad count: 27.
  - touched-path count: 3.
  - Touched hits are only the required scan command text. No Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, or direct transport surface was added.
- `rg -n "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\(|appendMany\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md`
  - broad count: 275.
  - touched-path count: 25.
  - Touched hits are docs/spec forbidden-boundary text, rollback language, and required scan commands. No schema/table/index/migration or persistence write path was added.
- `rg -n "createServer|listen\(|WebSocketServer|http\.createServer|net\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs runtime-research`
  - broad count: 2043.
  - touched-path count: 79.
  - Touched hits are hard-boundary docs/spec text, rollback language, and required scan commands. No service/listener/daemon/server/sidecar/exporter/collector/JSONL implementation was added.
- Touched-path combined scan over `harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md`, `runtime-research/handoffs/runtime-event-log-authority-cutover-readiness`, and `runtime-research/agent-runtime-index.md`
  - touched-path count: 146.
  - Classification: docs/spec/index-only boundary declarations, validation commands, rollback language, and historical index entries. No runtime source, test helper, Gateway/UI/API/transport/schema/service/persistence path was added by this package.

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
- No treating event-log diagnostics, replay comparison, retention summaries, Phase 5 helper decisions, Phase 6 evidence-review output, or readiness output as completion proof.

## Next Stage Entrance

If this package closes as `ready_for_limited_authority_cutover_implementation_spec`, the only allowed next step is a later fresh limited authority cutover implementation spec. That future spec still must not treat this readiness package as runtime cutover approval.
