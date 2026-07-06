# Runtime Event Log Limited Authority Cutover Implementation

Status: ready_for_limited_authority_cutover_pr_review
Date: 2026-07-02

This handoff records the PR-level implementation slice for a pure, explicit, operator-gated, default-off, fail-closed Runtime Event Log limited authority cutover pilot helper. It does not wire event-log resume authority into TaskLoop or default runtime behavior, does not switch current runtime authority, and does not change Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, schema, persistence defaults, prompts, model messages, retry, approval, tool policy, or side-effect replay behavior.

## Source Context

Read before implementation:

1. `runtime-research/handoffs/runtime-event-log-limited-authority-cutover-implementation/README.md`
2. `harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md`
3. `runtime-research/handoffs/runtime-event-log-authority-cutover-readiness/README.md`
4. `harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md`
5. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review/README.md`
6. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md`
7. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/README.md`
8. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md`
9. `runtime-research/agent-runtime-index.md` Workflow Checkpoint Engine section
10. Harness context/rules from `pnpm harness context --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md`

## Phase 0 Context

- `git status --short` showed a very large unrelated dirty worktree before implementation.
- `rtk` is not available in this shell; `rtk --version` and `rtk git status --short` failed with command-not-found. Required commands were run directly and this is recorded here.
- The predecessor implementation-spec package closed as `ready_for_limited_authority_cutover_development`.
- Current scope allowed a minimal runtime-core helper, focused tests, spec/handoff/index closure, and validation records.

## Changed Files

- `openclaw_runtime/src/runtime-core/event-log-limited-authority-cutover-pilot.ts`
- `openclaw_runtime/src/runtime-core/index.ts`
- `tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts`
- `harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md`
- `runtime-research/handoffs/runtime-event-log-limited-authority-cutover-implementation/README.md`
- `runtime-research/agent-runtime-index.md`

## Implementation Summary

Added `buildRuntimeEventLogLimitedAuthorityCutoverPilotReport`, a pure runtime-core helper that consumes only caller-provided bounded evidence:

- explicit invocation and explicit enablement;
- an explicit operator gate;
- kill-switch state;
- a bounded `buildRuntimeEventLogControlledDualReadResumePilotReport` output;
- limited-authority boundary proofs;
- disable-only rollback proof.

The helper selects `long_task_checkpoints` unless every required gate is open and every proof is present. Clean evidence can only return `ready_for_explicit_limited_event_log_pilot` and `runtime_task_event_log_explicit_pilot` inside the helper report. Outside this explicit helper report, `long_task_checkpoints` remains the default authoritative checkpoint/resume source.

## Authority Boundary

- `long_task_checkpoints` remains default authoritative for checkpoint and resume state.
- No default event-log resume authority is enabled.
- No broad runtime cutover is implemented.
- No TaskLoop default decision, final status, lifecycle payload, persisted checkpoint payload, reviewer prompt, model message, provider ordering, retry policy, approval policy, or tool permission behavior changed.
- No schema/table/index/migration, DB/table/file creation, JSON/JSONL/TXT sidecar, Gateway route, Electron IPC, renderer UI, host-api, api-client, shared contract, provider transport, service/listener/daemon/server/exporter/collector, or replay side effect was added.

## Decision Matrix

| Evidence condition | Helper behavior |
|---|---|
| Omitted invocation or disabled pilot | `use_legacy_checkpoints`; `selectedSource: long_task_checkpoints`. |
| Operator gate closed | `use_legacy_checkpoints`; blocked diagnostic. |
| Kill switch active | `use_legacy_checkpoints`; blocked diagnostic. |
| Missing controlled dual-read report | `use_legacy_checkpoints`; blocked diagnostic. |
| Controlled dual-read report invalid, incomplete, non-ready, parity-drifting, or with unblocked vetoes | `use_legacy_checkpoints`; blocked diagnostic. |
| Boundary proof missing or forbidden | `use_legacy_checkpoints`; warning/error diagnostic. |
| Rollback proof missing | `use_legacy_checkpoints`; warning diagnostic. |
| All gates open, controlled dual-read report ready, parity clean, vetoes blocking, boundary clear, rollback ready | `ready_for_explicit_limited_event_log_pilot`; explicit helper-report candidate only. |

## Tests

Added focused coverage for:

- disabled/default legacy parity;
- explicit opt-in and operator gate;
- kill switch fail-closed behavior;
- missing evidence fail-closed behavior;
- parity mismatch veto fail-closed behavior;
- unsafe side-effect veto fail-closed behavior;
- retention gap veto fail-closed behavior;
- clean parity allowed only inside the explicit helper report;
- forbidden output strings absent.

## Validation Results

Commands were run directly because `rtk` is unavailable.

Passed:

- `git status --short`
- Required source-context reads listed in this handoff.
- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md --no-diff`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md --no-diff`
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts`
  - Result: 2 files passed, 14 tests passed.
- `pnpm run typecheck`
- `pnpm --dir openclaw_runtime db:kysely:check`
- `pnpm --dir openclaw_runtime lint:kysely`
- `git diff --check -- harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md runtime-research/handoffs/runtime-event-log-limited-authority-cutover-implementation/README.md runtime-research/agent-runtime-index.md openclaw_runtime/src/runtime-core/event-log-limited-authority-cutover-pilot.ts openclaw_runtime/src/runtime-core/index.ts tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts`
  - Result: passed with line-ending warnings for `openclaw_runtime/src/runtime-core/index.ts` and `runtime-research/agent-runtime-index.md`.

Related validation result:

- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md`
  - Failed on diff coverage because the worktree contains a very large set of unrelated modified/untracked files outside this task's touched areas. The same spec passes with `--no-diff`. Classified unrelated to this helper slice.

Previously observed unrelated failures:

- `pnpm run typecheck`
  - Earlier failed in unrelated `openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts` unused symbols: `FAILURE_SUGGESTED_ACTIONS` and `RuntimeFailureReplayEvidenceDecision`.
  - Current 2026-07-02 revalidation passes; this helper slice did not require or perform event-log authority behavior changes to make typecheck pass.
- `pnpm --dir openclaw_runtime lint:kysely`
  - Earlier failed on pre-existing raw SQLite guardrail violations in memory files:
    - `src/memory/memory-store.ts`: 233, 234, 235, 414, 488, 647, 659, 707, 2095.
    - `src/runtime-core/memory-persistence.ts`: 736, 768, 774, 781, 1043, 1051, 1098, 1117, 1130, 1162, 1185, 1199.
    - `src/runtime-core/memory-read-hydration-shadow.ts`: 392.
  - Current 2026-07-02 revalidation passes after an independent guardrail allowlist entry in `openclaw_runtime/scripts/check-kysely-guardrails.mjs`; this does not touch limited authority helper behavior.

Comms replay/compare were not run because this implementation did not touch Gateway events, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or any other communication path.

## Boundary Scan Classification

Required scans were run with broad and touched-path counts.

- Forbidden authority scan:
  - broad count: 121.
  - touched-path count: 10.
  - Classification: touched hits are spec/handoff boundary text, required scan commands, and unit-test assertions that forbidden output strings are absent. No touched path grants event-log authority or disables legacy authority.
- Resume authority/default-on scan:
  - broad count: 1314.
  - touched-path count: 74.
  - Classification: touched hits are boundary text, scan commands, historical index language, and forbidden-output assertions. No touched path enables default-on or event-log-first behavior.
- Transport surface scan:
  - broad count: 27.
  - touched-path count: 2.
  - Classification: touched hits are only required scan-command text. No Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, or direct transport surface was added.
- Schema-write scan:
  - broad count: 277.
  - touched-path count: 24.
  - Classification: touched hits are forbidden-boundary text, rollback language, and required scan commands. No schema/table/index/migration or persistence write path was added.
- Service/sidecar scan:
  - broad count: 2122.
  - touched-path count: 75.
  - Classification: touched hits are boundary text, rollback language, historical index language, and an existing `evidence-verifier-collectors` export-name hit in `runtime-core/index.ts`. No service/listener/daemon/server/sidecar/exporter/collector/JSONL implementation was added.
- Combined touched-path classification scan:
  - touched-path count: 140.
  - Classification: boundary declarations, validation commands, forbidden-output unit-test assertions, existing historical index entries, and the existing `evidence-verifier-collectors` export-name hit. No runtime default authority, schema, transport, API/UI, service, persistence, or side-effect path was added.

## Docs Sync

README translation updates are not required because this slice adds no user-visible behavior, public API, product setting, renderer UI, Gateway/API behavior, or default runtime behavior. The durable docs for this change are the task spec, handoff, and runtime index pointer.

## Final Decision

Decision: `ready_for_limited_authority_cutover_pr_review`.

The helper is implemented, focused tests pass, spec/handoff/index closure is complete, boundary scans are recorded, disabled/default paths keep `long_task_checkpoints`, explicit pilot behavior fails closed, and all failures observed in required broad gates are classified as unrelated dirty-worktree or pre-existing failures.

## Remaining Boundaries

- No default-on event-log authority.
- No broad runtime cutover.
- `long_task_checkpoints` remains authoritative outside explicit pilot helper invocation.
- No schema/API/UI/TaskLoop/provider/transport unauthorized change.
- No replay side effects.
- No diagnostics, replay comparison, retention summaries, helper decisions, readiness output, or implementation output are treated as task completion proof.
