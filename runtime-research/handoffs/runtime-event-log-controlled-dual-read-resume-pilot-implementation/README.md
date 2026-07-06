# Runtime Event Log Controlled Dual-Read Resume Pilot Implementation

Status: closed_phase5_ready_for_phase6_entry
Date: 2026-07-01

This handoff records Runtime Event Log phase 5. The work implements a pure, explicit-call, default-closed, diagnostic-only controlled dual-read comparison helper. It does not make event-log data authoritative and does not change TaskLoop, Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, schema, persistence defaults, prompts, model messages, retry, approval, tool policy, or side-effect replay behavior.

## Source Context

Read these files before continuing:

1. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-proposal/README.md`
2. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`
3. `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/README.md`
4. `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/phase4-entry.md`
5. `harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md`
6. `runtime-research/handoffs/runtime-event-log-readonly-operator-inspection-surface/README.md`
7. `runtime-research/handoffs/runtime-event-log-robustness-retention-evidence-mvp/README.md`
8. `harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md`
9. `runtime-research/agent-runtime-index.md` Workflow Checkpoint Engine section
10. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/phase6-entry.md`

## Implementation Summary

Files changed for this slice:

- `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md`
- `openclaw_runtime/src/runtime-core/event-log-controlled-dual-read-resume-pilot.ts`
- `openclaw_runtime/src/runtime-core/index.ts`
- `tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts`
- `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/README.md`
- `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/phase6-entry.md`
- `runtime-research/agent-runtime-index.md`

Behavior implemented:

- Added `buildRuntimeEventLogControlledDualReadResumePilotReport`, a pure runtime-core helper that consumes only caller-provided sanitized summaries.
- The helper defaults to `blocked_before_pilot` unless both `explicitInvocation` and `explicitPilotEnabled` are true.
- The helper compares legacy checkpoint summaries and persisted RuntimeTaskEvent replay summaries in memory only.
- The helper outputs only `blocked_before_pilot`, `needs_more_live_evidence`, or `ready_for_controlled_dual_read_pilot`.
- The helper always returns `legacyAuthoritative: true` and `eventLogAuthoritative: false`.
- Controlled corpus coverage is required for clean, partial, unreadable, corrupt-row, missing-table, missing-checkpoint, retention-pruned, mismatch, and unsafe side-effect ambiguity cases before readiness can be reported.
- Live evidence is accepted only as explicit, bounded, sanitized, caller-provided diagnostic summary input with raw details excluded.
- Output is bounded and sanitized. Sensitive-looking case ids, checkpoint tokens, resume status tokens, mismatch fields, and diagnostic codes are redacted.
- The helper does not open SQLite, read files, write files, create schema, create sidecars, call Gateway/Main/renderer/provider transport, execute tools, apply patches, send messages, or replay side effects.

## Authority Boundary

- `long_task_checkpoints` remains authoritative for checkpoint and resume state.
- Persisted RuntimeTaskEvent event-log replay may only be a diagnostic comparison source.
- The helper does not output `cutover_enabled`, `event_log_authoritative`, `default_on`, `default-on`, `prefer_event_log`, or `runtime.resume.preferEventLog`.
- Event-log diagnostics, replay comparison, retention summaries, verifier sampling, readiness output, and pilot decision output are not task completion proof.
- Any future event-log authority cutover still requires a later fresh spec with rollout and rollback evidence.

## Gap Closure

This gap-closure pass completed the remaining Phase 5 alignment work:

- Added top-level helper authority fields so the report preserves the predecessor contract: `legacyAuthoritative: true` and `eventLogAuthoritative: false`.
- Updated the Phase 5 task spec with the same authority-output requirement.
- Updated the Workflow Checkpoint Engine index entries that still described only the proposal/readiness state.
- Added a Phase 6 entry contract that prepares the next fresh-spec stage without approving event-log authority cutover.

## Decision Matrix

| Evidence condition | Required helper behavior |
|---|---|
| Helper not explicitly invoked or caller enablement omitted | Return `blocked_before_pilot`; preserve legacy checkpoint behavior |
| Required controlled corpus scenario missing | Return `needs_more_live_evidence`; do not report pilot readiness |
| Live evidence present without explicit bounded sanitized caller-provided contract | Return `blocked_before_pilot` |
| Mismatch, partial/unreadable data, missing table, missing checkpoint, corrupt row, retention gap, or unsafe side-effect ambiguity not marked as blocking | Return `blocked_before_pilot` |
| Boundary scan missing or rollback proof incomplete | Return `needs_more_live_evidence` |
| Boundary evidence reports a forbidden surface | Return `blocked_before_pilot` |
| Controlled corpus complete, live evidence valid if used, vetoes block, boundaries clear, rollback ready | Return `ready_for_controlled_dual_read_pilot` |

## Rollback Drill

The implemented rollback remains disable-only:

1. Run the helper only with explicit caller-provided summaries.
2. Confirm runtime behavior still follows `long_task_checkpoints`.
3. Stop calling the helper, or pass `explicitPilotEnabled: false`.
4. Confirm the system returns to legacy-only checkpoint behavior.
5. Confirm no schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, or TaskLoop behavior rollback is required.

## Validation Results

Commands were run directly because `rtk` exists in policy docs but `Get-Command rtk` returned no command in this checkout.

Passed:

- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md --no-diff`
- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md --no-diff`
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts`
  - Result: 1 file passed, 6 tests passed.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-resume-shadow.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-event-log-operator-inspection.test.ts tests/unit/runtime-event-log-resume-cutover-readiness.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts`
  - Result: 7 files passed, 113 tests passed.
- `pnpm --dir openclaw_runtime db:kysely:check`
- `rg -n "[ \t]+$" harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md openclaw_runtime/src/runtime-core/event-log-controlled-dual-read-resume-pilot.ts tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/README.md runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/phase6-entry.md`
  - Result: no trailing whitespace matches.

Expected or unrelated failures in the current dirty worktree:

- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md` failed on diff coverage because the worktree contains a very large set of unrelated modified/untracked files outside this task's touched areas. The same spec passes with `--no-diff`.
- `pnpm run typecheck` failed in unrelated files:
  - `openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts`: unused `FAILURE_SUGGESTED_ACTIONS` and `RuntimeFailureReplayEvidenceDecision`.
- `pnpm --dir openclaw_runtime lint:kysely` failed on pre-existing raw SQLite guardrail violations in memory files:
  - `src/memory/memory-store.ts`: 233, 234, 235, 414, 488, 647, 659, 707, 2095.
  - `src/runtime-core/memory-persistence.ts`: 736, 768, 774, 781, 1043, 1051, 1098, 1117, 1130, 1162, 1185, 1199.
  - `src/runtime-core/memory-read-hydration-shadow.ts`: 392.

Comms replay/compare were not run because this implementation did not touch Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.

## Boundary Scan Classification

Required scans were run with in-memory count/classification wrappers over the requested `rg -n` patterns.

- `rg -n "runtime\.resume\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log|eventLogAuthoritative:\s*true|legacyAuthoritative:\s*false" openclaw_runtime/src tests/unit harness/specs runtime-research`
  - broad count: 83.
  - Phase 5 package count: 20.
  - Phase hits are predecessor proposal docs, implementation spec/handoff hard-boundary text, required scan commands, and unit-test assertions that forbidden output strings are absent. The new helper does not output these strings.
- `rg -n "resume authority|event-log-first|default_on|default-on|defaultOn|event_log_authoritative" openclaw_runtime/src tests/unit harness/specs runtime-research`
  - broad count: 1189.
  - Phase 5 package count: 91.
  - Phase hits are hard-boundary docs/spec text, the runtime index note that default-on behavior remains blocked, and unit-test assertions that forbidden strings are absent. No Phase 5 implementation path grants event-log authority.
- `rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components electron shared openclaw_runtime/src/gateway`
  - broad count: 27.
  - Phase 5 package count: 0.
  - No Phase 5 Gateway, Electron, renderer, host-api, api-client, shared contract, or provider transport surface was added.
- `rg -n "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\(|appendMany\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md`
  - broad count: 274 in the requested paths.
  - Phase 5 package count: 4 in the requested paths.
  - Expanded handoff-aware classification including `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation` reported broad count 280 and Phase 5 package count 10.
  - Phase hits are only implementation-spec/handoff forbidden-boundary text, required scan commands, and acceptance text. The new helper/test do not create schema, migrate, or write persistence.
- `rg -n "createServer|listen\(|WebSocketServer|http\.createServer|net\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs runtime-research`
  - broad count: 1996.
  - Phase 5 package count: 83.
  - Phase hits are docs/spec forbidden-boundary text, rollback language, required scan commands, and the helper's bounded `sidecar` boundary/rollback fields. No server/listener/daemon/sidecar/exporter/collector/JSONL implementation was added.

## Docs Sync

README translation updates are not required for this phase because it adds no user-visible behavior, public API, runtime behavior, or architecture change beyond harness/runtime-research planning documents and a pure runtime-core diagnostic helper.

## Remaining Boundaries

- No event-log resume authority.
- No `runtime.resume.preferEventLog`.
- No `cutover_enabled` output.
- No `event_log_authoritative` output.
- No `default_on` or `default-on` output.
- No schema/table/index/migration.
- No DB/table/file creation, SQLite writes, or JSON/JSONL/TXT sidecar.
- No Gateway route, Electron IPC, renderer UI, host-api, api-client, shared contract, provider transport, TaskLoop status/decision, prompt/model-message, retry/approval/tool policy, service/listener/daemon/server.
- No tool execution, patch apply, workspace writes, message sends, or transport calls as replay behavior.
- No treating event-log diagnostics, replay comparison, retention summaries, verifier sampling, readiness output, or pilot decisions as completion proof.

## Phase 6 Entry

The next recommended fresh-spec entry is:

- `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md`

Phase 6 should evaluate controlled dual-read helper reports and optional live diagnostic summaries as bounded evidence. It must not approve event-log resume authority, default-on behavior, schema/table/index/migration changes, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport surfaces, TaskLoop decision changes, prompt/model-message changes, policy changes, side-effect replay, or completion proof from diagnostics.
