# Runtime Event Log Readonly Operator Inspection Surface Handoff

Status: implemented_readonly_local_helper_and_utility
Date: 2026-07-01

This handoff records the implemented fresh-spec entry after the Runtime Event Log robustness and retention evidence MVP. The surface is explicit local readonly inspection only and does not change resume authority, TaskLoop decisions, Gateway/provider transport, UI, host-api, renderer IPC, schema, flags, prompts, tool policy, or persistence defaults.

## Source Context

Read these files before implementation:

1. `harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md`
2. `harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md`
3. `harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md`
4. `runtime-research/handoffs/runtime-event-log-robustness-retention-evidence-mvp/README.md`
5. `runtime-research/agent-runtime-index.md` Workflow Checkpoint Engine section

## Selected Next Work

Priority 1 from the persisted roadmap is selected:

- Operator-facing read-only inspection surface: implemented through `inspectRuntimeEventLogForOperator` and the local `inspect-runtime-event-log.mjs` utility.

The other allowed future directions remain fresh-spec-only:

- Resume cutover readiness research.
- Verifier completion gate research.
- Tool mutability registry formalization.
- Retention policy tuning beyond the current hybrid defaults.
- Schema/index additions or migration work.

## Priority Work Arrangement

P0 spec validation and boundary confirmation:

- Run harness context/validate for the new task spec.
- Validate the predecessor robustness/retention and persisted-resume specs with `--no-diff`.
- Confirm worktree state and avoid reverting unrelated parallel-development changes.
- Confirm whether `rtk` exists; if not, run commands directly and record that fact.

P1 readonly helper contract:

- Add a runtime-core helper, tentatively `openclaw_runtime/src/runtime-core/event-log-operator-inspection.ts`.
- Require explicit config and explicit existing database path before reading.
- Treat persist false/omitted, missing path, missing file, and missing table as bounded no-open/no-create/no-write diagnostics.
- Return sanitized bounded summaries only.

P2 explicit local utility:

- Add a local script, tentatively `openclaw_runtime/scripts/inspect-runtime-event-log.mjs`, only after the helper contract is green.
- Keep it local and explicit; do not add Gateway, Electron, renderer, host-api, api-client, provider, or TaskLoop surfaces.
- Emit bounded JSON diagnostics/summaries only.

P3 validation:

- Add focused unit coverage in `tests/unit/runtime-event-log-operator-inspection.test.ts`.
- Prove no DB creation, no table creation, no writes, no raw payload output, and no boundary drift.
- Run the event-log focused suite, Kysely check, typecheck, harness validate, and boundary scans.
- Classify unrelated failures without editing unrelated modules.

P4 handoff:

- Update this README with implementation status, files changed, validation results, unrelated failures, and remaining fresh-spec-only directions.
- Update `runtime-research/agent-runtime-index.md` only after implementation evidence exists.

## Implementation Summary

Files changed for this slice:

- `openclaw_runtime/src/runtime-core/event-log-operator-inspection.ts`
- `openclaw_runtime/src/runtime-core/index.ts`
- `openclaw_runtime/scripts/inspect-runtime-event-log.mjs`
- `scripts/build-openclaw-runtime.mjs`
- `package.json`
- `tests/unit/runtime-event-log-operator-inspection.test.ts`
- `runtime-research/agent-runtime-index.md`
- `runtime-research/handoffs/runtime-event-log-readonly-operator-inspection-surface/README.md`

Behavior implemented:

- Disabled or omitted `runtime.eventLog.persist` returns bounded diagnostics without opening SQLite.
- Missing database path and missing database file return bounded diagnostics without opening or creating SQLite.
- Existing database with no event-log table opens read-only, returns `table_missing`, and does not create tables or metadata.
- Loaded inspection requires explicit persist true plus an explicit existing database path.
- Loaded output is bounded to event ids, task ids, kinds, timestamps, session/run/trace ids, latest checkpoint event id, retention evidence, read status, corrupt row count, side-effect proof, diagnostics, and a non-authoritative resume comparison marker.
- The resume comparison summary stays `legacyAuthoritative: true`, `eventLogAuthoritative: false`, and `comparisonStatus: "not_run"`.
- The helper and utility do not call TaskLoop, Gateway, Electron, renderer, provider, host-api, api-client, tool execution, patch apply, message send, or runtime transport paths.

## Validation Results

Commands run directly because `rtk` was not available in this checkout:

- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md` - passed.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-operator-inspection.test.ts` - passed, 6 tests.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-event-log-operator-inspection.test.ts tests/unit/runtime-resume-shadow.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts` - passed, 118 tests.
- `pnpm --dir openclaw_runtime db:kysely:check` - passed.
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md --no-diff` - passed.
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md --no-diff` - passed.
- Added-file boundary scans for service/listener/storage cutover, schema/write cutover, and sensitive output terms passed with no matches after implementation cleanup.

Known unrelated failures in the current dirty worktree:

- `pnpm run typecheck` fails in `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts` because `Classification` is declared but unused.
- `pnpm --dir openclaw_runtime lint:kysely` still fails on pre-existing raw SQLite guardrail violations in `src/memory/memory-store.ts`, `src/runtime-core/memory-persistence.ts`, and `src/runtime-core/memory-read-hydration-shadow.ts`; the new event-log inspection helper no longer appears in that violation list.
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md` fails because the worktree contains many unrelated changed and untracked files outside this task's touched areas.
- Broad renderer/Gateway boundary scans still report existing Electron/preload/gateway/project-rule references; no new event-log inspection paths appear there.

Comms replay/compare were not run because this implementation did not touch Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, or provider transport paths.

## Remaining Fresh-Spec-Only Directions

- Resume cutover authority remains blocked.
- Default-on event-log persistence or replay remains blocked.
- Gateway/UI/host-api/api-client/shared contract exposure remains blocked.
- Schema/table/index/migration work remains blocked.
- Completion proof from diagnostics, replay comparison, or retention evidence remains blocked.

## Hard Boundaries

- No event-log resume authority.
- No default-on behavior.
- No new config flag, especially no `runtime.resume.preferEventLog`.
- No schema/table/index/migration.
- No DB/table/file creation during inspection.
- No JSON/JSONL/TXT sidecar.
- No Gateway route, Electron IPC, renderer UI, host-api/api-client/shared contract, provider transport, TaskLoop status/decision, prompt/model-message, retry/approval/tool policy, service/listener/daemon/server.
- No tool execution, patch apply, workspace writes, message sends, or Gateway/Main/renderer transport calls during inspection.
- No treating event-log diagnostics as completion proof.

## Development Acceptance Prompt

```text
Continue in C:\Users\27933\Desktop\clawx\ClawX from local persisted docs only.

Read first:
1. harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
2. runtime-research/handoffs/runtime-event-log-readonly-operator-inspection-surface/README.md
3. harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md
4. harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md
5. runtime-research/agent-runtime-index.md Workflow Checkpoint Engine section

Goal:
Implement the explicit readonly operator/developer inspection surface for persisted RuntimeTaskEvent logs.

Priority:
P1 helper contract first, P2 optional explicit local utility second, P3 tests and scans third, P4 handoff update last.

Acceptance:
- Persist false/omitted, missing database path, missing database file, and missing table return bounded diagnostics and do not open/create/write/migrate SQLite.
- Enabled inspection requires explicit persist true plus explicit existing database path.
- Output includes only bounded sanitized summaries: event counts, task ids, event ids, kinds, timestamps, session/run/trace ids, latest checkpoint id, retention evidence, read status, corrupt row count, diagnostics.
- Output excludes raw record_json, raw rows, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, auth material, runtime authority, and completion-proof markers.
- Persisted resume comparison remains legacyAuthoritative true and never becomes resume authority.
- Boundary scans prove no Gateway/UI/host-api/api-client/renderer/provider/TaskLoop/default-on/schema/service/listener/sidecar cutover.

Required verification:
- pnpm harness context --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
- pnpm harness validate --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
- pnpm harness validate --spec harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md --no-diff
- pnpm harness validate --spec harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md --no-diff
- node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-event-log-operator-inspection.test.ts tests/unit/runtime-resume-shadow.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts
- pnpm run typecheck
- pnpm --dir openclaw_runtime db:kysely:check
- pnpm --dir openclaw_runtime lint:kysely
- Run all boundary scans listed in the task spec.

If rtk is unavailable, run commands directly and record it.
If unrelated failures appear, classify them and do not modify unrelated modules.
```
