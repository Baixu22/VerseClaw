# Runtime Event Log Resume Cutover Readiness Handoff

Status: closed_phase3_ready_for_phase4_entry
Date: 2026-07-01

This handoff records Runtime Event Log phase 3. The work is fresh-spec-only readiness research and proof planning. It does not implement resume cutover, does not make event-log data authoritative, and does not change TaskLoop, Gateway, provider, renderer, host-api, api-client, schema, persistence defaults, prompts, retry/approval/tool policy, or side-effect replay behavior.

## Source Context

Read these files before continuing:

1. `harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md`
2. `runtime-research/handoffs/runtime-event-log-readonly-operator-inspection-surface/README.md`
3. `harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md`
4. `runtime-research/handoffs/runtime-event-log-robustness-retention-evidence-mvp/README.md`
5. `harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md`
6. `harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md`
7. `runtime-research/agent-runtime-index.md` Workflow Checkpoint Engine section

## Implementation Summary

Files changed for this slice:

- `harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md`
- `openclaw_runtime/src/runtime-core/event-log-resume-cutover-readiness.ts`
- `openclaw_runtime/src/runtime-core/index.ts`
- `tests/unit/runtime-event-log-resume-cutover-readiness.test.ts`
- `runtime-research/agent-runtime-index.md`
- `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/README.md`
- `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/phase4-entry.md`

Behavior implemented:

- Added `buildRuntimeEventLogResumeCutoverReadinessReport`, a pure runtime-core helper that consumes caller-provided sanitized readiness evidence only.
- The helper does not open SQLite, read files, write files, create schema, create sidecars, call Gateway/Main/renderer/provider transport, execute tools, apply patches, send messages, or replay side effects.
- The output is bounded and sanitized. Case ids, mismatch fields, and diagnostic codes are tokenized and sensitive-looking tokens are redacted.
- The report can recommend only `blocked_for_cutover`, `needs_more_evidence`, or `ready_for_limited_future_pilot_proposal`.
- The report always returns `legacyAuthoritative: true` and `eventLogAuthoritative: false`.
- The controlled matrix requires clean, partial, unreadable, corrupt-row, missing-table, missing-checkpoint, retention-pruned, mismatch, and unsafe side-effect ambiguity scenarios.
- Veto gates require future gates to block mismatch, corruption, unreadable/missing-table evidence, missing checkpoint evidence, unsafe side-effect ambiguity, and retention-pruned checkpoint gaps.
- Rollback evidence requires long_task_checkpoints authoritative behavior, disable-only future pilot rollback, return to legacy checkpoints, no schema rollback, and no sidecar cleanup.
- Boundary evidence covers TaskLoop, Gateway, provider transport, renderer, Electron IPC, host-api, api-client, shared contract, schema, default-on, service/listener, sidecar, and completion gate surfaces.

## Validation Results

Commands run directly because `rtk` was not available in this checkout:

- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md` - passed.
- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md` - passed.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-resume-cutover-readiness.test.ts` - passed, 5 tests.
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md --no-diff` - passed.
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md --no-diff` - passed.
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md --no-diff` - passed.
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md --no-diff` - passed.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-resume-shadow.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-event-log-operator-inspection.test.ts tests/unit/runtime-event-log-resume-cutover-readiness.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts` - passed, 6 files / 107 tests.
- `pnpm --dir openclaw_runtime db:kysely:check` - passed.
- After adding the phase 4 entry contract:
  - `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md --no-diff` - passed.
  - `node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-resume-cutover-readiness.test.ts` - passed, 1 file / 5 tests.
  - `rg -n "phase4-entry|runtime_event_log_phase4_entry_ready|controlled-dual-read|Controlled Dual-Read" runtime-research/handoffs/runtime-event-log-resume-cutover-readiness runtime-research/agent-runtime-index.md` - passed; phase 4 entry is referenced from the handoff package and runtime index.

Expected or unrelated validation failures in the current dirty worktree:

- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md` failed on the harness diff-coverage rule because the worktree contains many unrelated changed/untracked files outside this task's touched areas. The same spec passes with `--no-diff`.
- `pnpm run typecheck` failed in unrelated `openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts` changes: missing `semanticRiskCodes` fields and missing helper names such as `evidenceCaptureIssueForBlock`, `evidenceCaptureDiagnostic`, `semanticRisksForCompletedReport`, and related count helpers.
- `pnpm --dir openclaw_runtime lint:kysely` failed on pre-existing raw SQLite guardrail violations in memory files:
  - `src/memory/memory-store.ts`
  - `src/runtime-core/memory-persistence.ts`
  - `src/runtime-core/memory-read-hydration-shadow.ts`

Boundary scans run:

- `rg -n "runtime\.resume\.preferEventLog|preferEventLog" openclaw_runtime/src tests/unit harness/specs runtime-research`
  - broad count: 43.
  - phase count: 3, all in this task spec as forbidden text / required scan command.
- `rg -n "legacyAuthoritative:\s*false|eventLogAuthoritative:\s*true|cutover_enabled|resume authority|event-log-first" openclaw_runtime/src tests/unit harness/specs runtime-research`
  - broad count: 30.
  - phase count: 4, all task-spec forbidden text / scan command / tests asserting the forbidden recommendation string is absent.
- `rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components electron shared openclaw_runtime/src/gateway`
  - broad count: 27.
  - phase count: 1, only the required scan command in the task spec.
- `rg -n "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\(|appendMany\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md`
  - broad count: 258.
  - phase count: 4, only spec/handoff forbidden boundary language and the required scan command.
- `rg -n "createServer|listen\(|WebSocketServer|http\.createServer|net\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs runtime-research`
  - broad count: 1913.
  - phase count: 14. Phase hits are spec/handoff forbidden boundary language plus the helper's bounded boundary surface names `service_listener` and `sidecar`; no server/listener process, sidecar file, exporter, collector, or JSONL implementation was added.

Comms replay/compare were not run because this implementation did not touch Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.

## Phase 3 Closure Decision

Phase 3 is closed as a readiness/proof-plan phase. The accepted output is the task spec, pure diagnostic helper, focused tests, boundary-scan record, runtime index update, and this handoff package.

This closure does not approve event-log resume authority. It only establishes the evidence framework for deciding whether a later controlled dual-read pilot proposal can be written.

## Known Boundaries

- No current event-log authority for resume.
- No default-on behavior.
- No new config flag.
- No schema/table/index/migration.
- No DB/table/file creation by the readiness helper.
- No JSON/JSONL/TXT sidecar.
- No Gateway route, Electron IPC, renderer UI, host-api, api-client, shared contract, provider transport, TaskLoop status/decision, prompt/model-message, retry/approval/tool policy, service/listener/daemon/server.
- No tool execution, patch apply, workspace writes, message sends, or transport calls during readiness reporting.
- No treating diagnostics, replay comparison, retention summaries, verifier sampling, or readiness output as completion proof.

## Remaining Fresh-Spec-Only Directions

- A future limited pilot proposal must start from the phase 4 entry contract in `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/phase4-entry.md`.
- Recommended fresh phase 4 task spec path: `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`.
- The phase 4 proposal must define a live evidence source or controlled corpus source, rollout criteria, rollback drill, and explicit acceptance.
- Current readiness output is only a proof-plan diagnostic; it must not be used by TaskLoop, Gateway, renderer, provider transport, or resume logic.
- Any future pilot must keep rollback to long_task_checkpoints authoritative behavior as a hard gate.
