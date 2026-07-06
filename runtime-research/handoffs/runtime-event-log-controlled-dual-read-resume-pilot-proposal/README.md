# Runtime Event Log Controlled Dual-Read Resume Pilot Proposal

Status: ready_for_controlled_dual_read_pilot_implementation_spec
Date: 2026-07-01

This handoff records Runtime Event Log phase 4. The work is proposal-only. It does not implement a resume pilot, does not approve event-log resume authority, and does not change TaskLoop, Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, schema, persistence defaults, prompts, model messages, retry, approval, tool policy, or side-effect replay behavior.

## Source Context

Read these files before continuing:

1. `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/README.md`
2. `runtime-research/handoffs/runtime-event-log-resume-cutover-readiness/phase4-entry.md`
3. `harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md`
4. `runtime-research/handoffs/runtime-event-log-readonly-operator-inspection-surface/README.md`
5. `runtime-research/handoffs/runtime-event-log-robustness-retention-evidence-mvp/README.md`
6. `harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md`
7. `runtime-research/agent-runtime-index.md` Workflow Checkpoint Engine section

## Phase 4 Output

Files owned by this proposal package:

- `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`
- `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-proposal/README.md`
- `runtime-research/agent-runtime-index.md`

This package converts the phase 3 readiness proof plan into a concrete proposal for a future limited controlled dual-read pilot. It does not implement the pilot.

Implementation notes:

- Added the fresh phase 4 task spec.
- Added this proposal handoff README.
- Updated the Workflow Checkpoint Engine row in `runtime-research/agent-runtime-index.md` to record proposal-only readiness and link the new package.
- No runtime helper, test helper, schema, table, index, migration, sidecar, Gateway route, Electron IPC, renderer UI, host-api, api-client, shared contract, provider transport, or TaskLoop behavior was added.

## Authority Boundary

- `long_task_checkpoints` remains authoritative for checkpoint and resume state.
- Persisted RuntimeTaskEvent event-log replay may only be a diagnostic comparison source.
- Proposal output may recommend only `blocked_before_pilot`, `needs_more_live_evidence`, or `ready_for_controlled_dual_read_pilot_implementation_spec`.
- The proposal must not recommend or output `cutover_enabled`, `event_log_authoritative`, `default_on`, or `prefer_event_log`.
- Event-log diagnostics, replay comparison, retention summaries, verifier sampling, and readiness output are not task completion proof.

## Evidence Source Proposal

The future pilot implementation spec must choose one evidence source before implementation begins:

| Source | Allowed input | Minimum requirements | Decision impact |
|---|---|---|---|
| Controlled corpus | Sanitized caller-owned summaries from known legacy checkpoints and persisted RuntimeTaskEvent replay summaries | Must cover clean, partial, unreadable, corrupt-row, missing-table, missing-checkpoint, retention-pruned, mismatch, and unsafe side-effect ambiguity cases | Preferred first source; can support `ready_for_controlled_dual_read_pilot_implementation_spec` if all veto gates pass |
| Live evidence | Explicitly consented, bounded, sanitized local diagnostic summaries from existing event-log inspection and legacy checkpoint state | Must exclude raw rows, raw `record_json`, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, and auth material; must not write files or open/create/migrate SQLite outside already explicit diagnostic surfaces | Can support `needs_more_live_evidence` or later readiness only after controlled corpus gates pass |

No live evidence source may become an automatic collector, exporter, sidecar, daemon, listener, service, Gateway route, Electron IPC route, renderer UI, host-api method, api-client method, or shared contract.

## Dual-Read Comparison Proposal

A future limited pilot implementation spec must compare the two sources in memory as sanitized summaries only:

| Comparison field | Legacy source | Event-log diagnostic source | Required handling |
|---|---|---|---|
| Latest checkpoint identity | Authoritative `long_task_checkpoints` checkpoint id or bounded hash | Latest replayed checkpoint event id or bounded hash | Mismatch becomes a veto unless explained by a known non-authoritative diagnostic gap |
| Resume status | Legacy checkpoint-derived resume status | Event-log replay-derived status | Event-log status cannot alter TaskLoop status or decision |
| Read status | Legacy checkpoint lookup result | Event-log clean, partial, unreadable, missing-table, or corrupt-row status | Partial or unreadable states require inspection and cannot approve pilot implementation |
| Retention evidence | Existing checkpoint age and availability | Pruned ranges, latest retained checkpoint anchor, retention-pruned gaps | Any gap that can hide required checkpoint state vetoes pilot implementation |
| Side-effect ambiguity | Existing legacy checkpoint evidence | Event-log tool/result/action ambiguity codes | Missing or ambiguous mutating side effects veto pilot implementation |
| Bounded diagnostics | Existing sanitized checkpoint metadata | Sanitized replay comparison metadata | No raw payloads, raw rows, transcripts, prompts, env, secrets, tool args, or tool output |

The comparison must not execute tools, apply patches, send messages, write workspace files, call Gateway/Main/renderer transport, call provider transport, or treat replay as completion proof.

## Veto Gates

Any one of these gates blocks a future pilot implementation spec:

- Legacy checkpoint and event-log replay disagree on latest checkpoint identity, resume status, task terminal state, or required ordering.
- Event-log rows are corrupt beyond a bounded partial-read diagnostic.
- Event-log state is unreadable or the required event-log table is missing for a case that claims replay evidence.
- Required legacy checkpoint evidence is missing.
- Retention pruned rows create a checkpoint gap that could hide required resume state.
- Event-log replay has unsafe side-effect ambiguity for mutating tools, workspace writes, patch application, message sending, transport calls, or approvals.
- Any comparison output needs raw checkpoint payload bodies, raw `record_json`, raw rows, transcripts, prompts, env, secrets, auth material, tool args, or tool output to make its decision.
- Any implementation path requires Gateway, Electron IPC, renderer, host-api, api-client, shared contract, provider transport, TaskLoop decision/status, schema/table/index/migration, default-on behavior, service, listener, daemon, exporter, collector, sidecar, JSONL, or SQLite write changes.

## Rollout Proposal

A future controlled dual-read pilot implementation spec may proceed only if it remains:

- limited to explicit diagnostic invocation;
- default disabled;
- legacy-authoritative for all runtime behavior;
- bounded to sanitized summaries;
- covered by controlled corpus cases before live evidence use;
- reversible by disabling the future pilot without schema rollback, data cleanup, Gateway/UI/API rollback, provider rollback, or TaskLoop behavior rollback.

## Rollback Drill

The future pilot implementation spec must prove this drill:

1. Run dual-read diagnostics with explicit pilot input.
2. Confirm runtime behavior still follows `long_task_checkpoints`.
3. Disable the pilot entry point or omit explicit invocation.
4. Confirm the system returns to legacy-only checkpoint behavior.
5. Confirm no schema rollback, sidecar cleanup, DB cleanup, Gateway route removal, Electron IPC removal, renderer removal, host-api/api-client removal, shared contract rollback, provider rollback, prompt rollback, or TaskLoop behavior rollback is required.

## Future Implementation Spec Entrance

The only allowed next step is a fresh limited pilot implementation spec. Recommended path:

- `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md`

That future spec must restate the hard boundary that event-log replay is diagnostic-only and `long_task_checkpoints` remains authoritative. It must not introduce `runtime.resume.preferEventLog`, event-log resume authority, default-on behavior, schema/table/index/migration, sidecars, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport surfaces, TaskLoop decision changes, prompt/model-message changes, policy changes, or replay side effects.

## Required Validation

Commands should be run directly if `rtk` is unavailable:

- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md --no-diff`
- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-resume-shadow.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-event-log-operator-inspection.test.ts tests/unit/runtime-event-log-resume-cutover-readiness.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts`
- `pnpm run typecheck`
- `pnpm --dir openclaw_runtime db:kysely:check`
- `pnpm --dir openclaw_runtime lint:kysely`

Boundary scans:

- `rg -n "runtime\.resume\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log" openclaw_runtime/src tests/unit harness/specs runtime-research`
- `rg -n "legacyAuthoritative:\s*false|eventLogAuthoritative:\s*true|resume authority|event-log-first|default_on" openclaw_runtime/src tests/unit harness/specs runtime-research`
- `rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components electron shared openclaw_runtime/src/gateway`
- `rg -n "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\(|appendMany\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`
- `rg -n "createServer|listen\(|WebSocketServer|http\.createServer|net\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs runtime-research`

## Validation Results

Commands were run directly because `rtk` exists in policy docs but `where.exe rtk` returned no match in this checkout.

Passed:

- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-resume-cutover-readiness.md --no-diff`
- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md --no-diff`
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-resume-shadow.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-event-log-operator-inspection.test.ts tests/unit/runtime-event-log-resume-cutover-readiness.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts`
  - Result: 6 files passed, 107 tests passed.
- `pnpm --dir openclaw_runtime db:kysely:check`

Expected or unrelated failures in the current dirty worktree:

- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md` failed on diff coverage because the worktree contains a very large set of unrelated modified/untracked files outside this proposal's touched areas. The same spec passes with `--no-diff`.
- `pnpm run typecheck` failed in unrelated runtime memory/failure files:
  - `openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts`: unused `FAILURE_SUGGESTED_ACTIONS` and `RuntimeFailureReplayEvidenceDecision`.
  - `openclaw_runtime/src/runtime-core/memory-persistence.ts`: unused `RuntimeMemoryRelationType` and a `relationId` type mismatch at line 631.
- `pnpm --dir openclaw_runtime lint:kysely` failed on pre-existing raw SQLite guardrail violations in memory files:
  - `src/memory/memory-store.ts`
  - `src/runtime-core/memory-persistence.ts`
  - `src/runtime-core/memory-read-hydration-shadow.ts`

Comms replay/compare were not run because this proposal did not touch Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, or provider transport paths.

## Boundary Scan Classification

Required scans were run exactly as listed above.

- `rg -n "runtime\.resume\.preferEventLog|preferEventLog|cutover_enabled|event_log_authoritative|prefer_event_log" openclaw_runtime/src tests/unit harness/specs runtime-research`
  - broad count: 64.
  - phase proposal docs count: 10.
  - Phase hits are forbidden-boundary text and required scan commands only; no implementation path was added.
- `rg -n "legacyAuthoritative:\s*false|eventLogAuthoritative:\s*true|resume authority|event-log-first|default_on" openclaw_runtime/src tests/unit harness/specs runtime-research`
  - broad count: 97.
  - phase proposal docs count: 11.
  - Phase hits are proposal-only boundary language and required scan commands; broad extra hits are existing AgentMap/default-on/runtime-event-log research and tests.
- `rg -n "window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(" src/pages src/components electron shared openclaw_runtime/src/gateway`
  - broad count: 27.
  - no Phase 4 touched-path implementation hit in the scanned runtime/UI paths.
  - Hits are existing i18n rule text, Electron preload/main/gateway internals, and existing test harness/project-rule references.
- `rg -n "create table|create index|migration|migrate|insertInto|updateTable|deleteFrom|append\(|appendMany\(" openclaw_runtime/src/runtime-core tests/unit harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-proposal.md`
  - broad count: 258.
  - phase proposal hit count in the exact scan path: 2, both in the new task spec forbidden-boundary text and required scan command.
  - Existing hits are runtime event-log storage, memory persistence, trace/event-log tests, and unrelated migration/eval tests.
- `rg -n "createServer|listen\(|WebSocketServer|http\.createServer|net\.createServer|database-service|listener|daemon|sidecar|exporter|collector|jsonl" openclaw_runtime/src/runtime-core harness/specs runtime-research`
  - broad count: 1949.
  - phase proposal docs count: 14.
  - Phase hits are forbidden-boundary text, rollback language, and required scan commands only; no server/listener/daemon/sidecar/exporter/collector/JSONL implementation was added.

## Docs Sync

README translation updates are not required for this phase because this proposal adds no user-visible behavior, public API, runtime behavior, or architecture change beyond harness/runtime-research planning documents.

## Hard Boundaries

- No event-log resume authority.
- No `runtime.resume.preferEventLog`.
- No `cutover_enabled` output.
- No default-on behavior.
- No schema/table/index/migration.
- No DB/table/file creation, SQLite writes, or JSON/JSONL/TXT sidecar.
- No Gateway route, Electron IPC, renderer UI, host-api, api-client, shared contract, provider transport, TaskLoop status/decision, prompt/model-message, retry/approval/tool policy, service/listener/daemon/server.
- No tool execution, patch apply, workspace writes, message sends, or transport calls as replay behavior.
- No treating event-log diagnostics, replay comparison, retention summaries, verifier sampling, or readiness output as completion proof.
