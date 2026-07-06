# Runtime Event Log Limited Authority Cutover Evidence Review

Status: ready_for_explicit_internal_wiring_spec
Date: 2026-07-02

This handoff records the docs/spec-only evidence review package for bounded reports produced by the Runtime Event Log limited authority cutover pilot helper. It does not implement event-log resume authority, does not wire TaskLoop, does not switch runtime authority, and does not change Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, schema, persistence defaults, prompts, model messages, retry, approval, tool policy, or side-effect replay behavior.

## Source Context

Read before this package was created:

1. `runtime-research/handoffs/runtime-event-log-limited-authority-cutover-implementation/README.md`
2. `harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md`
3. `runtime-research/handoffs/runtime-event-log-authority-cutover-readiness/README.md`
4. `harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md`
5. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review/README.md`
6. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-evidence-review.md`
7. `runtime-research/handoffs/runtime-event-log-controlled-dual-read-resume-pilot-implementation/README.md`
8. `harness/specs/tasks/runtime-event-log-controlled-dual-read-resume-pilot-implementation.md`
9. `runtime-research/agent-runtime-index.md` Workflow Checkpoint Engine section

## Phase 0 Context

- `git status --short` showed a very large unrelated dirty worktree.
- `rtk` remains unavailable in this shell; required commands were run directly and recorded that way.
- The predecessor implementation package closed as `ready_for_limited_authority_cutover_pr_review`.
- This package is evidence-review-only and may not implement TaskLoop wiring, default runtime authority, schema/API/UI/provider/transport changes, or replay side effects.

## Phase Output

Files owned by this evidence-review package:

- `harness/specs/tasks/runtime-event-log-limited-authority-cutover-evidence-review.md`
- `runtime-research/handoffs/runtime-event-log-limited-authority-cutover-evidence-review/README.md`
- `runtime-research/agent-runtime-index.md`

This package defines the next review gate for bounded reports emitted by `buildRuntimeEventLogLimitedAuthorityCutoverPilotReport`. It does not add a new helper because the package objective is satisfied by a fresh task spec, handoff, validation record, and runtime index pointer.

## Accepted Evidence Inputs

The review accepts only bounded limited-authority helper reports that prove:

- `long_task_checkpoints` remains the fallback and default authoritative source;
- default runtime behavior did not change;
- TaskLoop decisions did not change;
- replay side effects are false;
- schema changes are false;
- transport/API/UI/provider changes are false;
- completion-proof use is false.

The review must not consume raw helper input cases, raw SQLite rows, raw `record_json`, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, auth material, DB handles, files, sidecars, Gateway/Main/renderer/provider transport, or replayed side effects.

## Minimum Evidence Classes

The minimum evidence package for a later explicit internal wiring spec includes:

- default-closed omitted invocation;
- disabled pilot;
- operator gate closed;
- kill switch active;
- missing controlled dual-read report;
- invalid or non-ready controlled dual-read report;
- parity mismatch, retention gap, and unsafe side-effect vetoes that block;
- incomplete boundary proof;
- incomplete rollback proof;
- clean fully gated report.

## Evidence Review Decision Matrix

| Evidence condition | Review decision |
|---|---|
| Missing predecessor context, contradictory authority boundary, or unavailable implementation handoff/spec/index | `blocked_before_limited_authority_evidence_review` |
| Any report grants default event-log authority, changes runtime behavior, changes TaskLoop decisions, replays side effects, changes schema, writes persistence, calls transport, adds API/UI/provider surface, leaks raw details, or treats diagnostics as completion proof | `blocked_before_limited_authority_evidence_review` |
| Required evidence class, boundary surface, rollback item, helper validation record, or boundary scan classification is missing | `needs_more_limited_authority_evidence` |
| Evidence classes are complete, vetoes block correctly, rollback is disable-only, boundaries are clear, validation is recorded, and no forbidden surface was added | `ready_for_explicit_internal_wiring_spec` |

## Current Review Assessment

Decision: `ready_for_explicit_internal_wiring_spec`.

The limited authority helper evidence from the predecessor package is complete enough to write a later fresh explicit internal wiring spec. This decision does not approve event-log authority, runtime cutover, default-on behavior, schema/table/index/migration work, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport work, TaskLoop default decision changes, prompt/model-message changes, policy changes, side-effect replay, or completion proof from diagnostics.

## Validation Results

Commands were run directly because `rtk` is unavailable.

Passed:

- `pnpm harness context --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-evidence-review.md`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-evidence-review.md --no-diff`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-implementation.md --no-diff`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-authority-cutover-readiness.md --no-diff`
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-limited-authority-cutover-pilot.test.ts tests/unit/runtime-event-log-controlled-dual-read-resume-pilot.test.ts`
  - Result: 2 files passed, 14 tests passed.
- `pnpm run typecheck`
- `pnpm --dir openclaw_runtime db:kysely:check`
- `pnpm --dir openclaw_runtime lint:kysely`
- `git diff --check -- <touched files>`
  - Result: passed with line-ending warnings for `openclaw_runtime/scripts/check-kysely-guardrails.mjs`, `openclaw_runtime/src/runtime-core/index.ts`, and `runtime-research/agent-runtime-index.md`.

Adjacent gate-debt line B:

- `pnpm run typecheck` now passes in the current worktree; the earlier unrelated unused-symbol failure in `openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts` is not present in current validation output.
- `pnpm --dir openclaw_runtime lint:kysely` now passes after an independent allowlist entry in `openclaw_runtime/scripts/check-kysely-guardrails.mjs` for existing runtime memory SQLite boundaries pending Kysely migration.
- This gate-debt closure does not change runtime event-log authority behavior and does not touch the limited authority helper.

Expected or unrelated result:

- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-limited-authority-cutover-evidence-review.md`
  - Failed on diff coverage because the worktree contains a very large set of unrelated modified/untracked files outside this task's touched areas. The same spec passes with `--no-diff`.

Comms replay/compare were not run because this evidence-review package did not touch Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, renderer, provider transport, or other communication paths.

## Boundary Scan Classification

Required scans were run with broad and touched-path counts.

- Forbidden authority scan:
  - broad count: 121.
  - touched-path count: 9.
  - Classification: touched hits are only boundary text, required scan commands, historical index language that keeps `runtime.resume.preferEventLog` false/not implemented, and no touched path grants event-log authority or disables legacy authority.
- Resume authority/default-on scan:
  - broad count: 1314.
  - touched-path count: 72.
  - Classification: touched hits are boundary text, scan commands, historical index language, and forbidden-output language. No touched path enables default-on or event-log-first behavior.
- Transport surface scan:
  - broad count: 27.
  - touched-path count: 2.
  - Classification: touched hits are only required scan-command text. No Gateway, Electron, renderer, host-api, api-client, shared contract, provider transport, or direct transport surface was added.
- Schema-write scan:
  - broad count: 277.
  - touched-path count: 25.
  - Classification: touched hits are forbidden-boundary text, rollback language, required scan commands, and historical index migration planning language. No schema/table/index/migration or persistence write path was added by this package.
- Service/sidecar scan:
  - broad count: 2122.
  - touched-path count: 74.
  - Classification: touched hits are boundary text, rollback language, historical index language, and required scan-command text. No service/listener/daemon/server/sidecar/exporter/collector/JSONL implementation was added.
- Combined touched-path classification scan:
  - touched-path count: 138.
  - Classification: docs/spec/index-only boundary declarations, validation commands, rollback language, and historical index entries only.

## Docs Sync

README translation updates are not required because this phase adds no user-visible behavior, public API, product setting, renderer UI, Gateway/API behavior, or default runtime behavior. The durable docs for this change are the task spec, handoff, and runtime index pointer.

## Remaining Boundaries

- No event-log resume authority.
- No `runtime.resume.preferEventLog`.
- No `cutover_enabled` output.
- No `event_log_authoritative` output.
- No `default_on`, `default-on`, or `defaultOn` output.
- No schema/table/index/migration.
- No DB/table/file creation, SQLite writes, or JSON/JSONL/TXT sidecar.
- No Gateway route, Electron IPC, renderer UI, host-api, api-client, shared contract, provider transport, TaskLoop status/default decision, prompt/model-message, retry/approval/tool policy, service/listener/daemon/server.
- No tool execution, patch apply, workspace writes, message sends, or transport calls as replay behavior.
- No treating event-log diagnostics, replay comparison, retention summaries, helper reports, evidence-review output, or next-spec recommendation as completion proof.

## Next Stage Entrance

If this package closes as `ready_for_explicit_internal_wiring_spec`, the only allowed next step is a later fresh explicit internal wiring spec. That next spec still must not approve default event-log authority, broad runtime cutover, default-on behavior, schema/table/index/migration changes, Gateway/Electron/renderer/host-api/api-client/shared contract/provider transport changes, TaskLoop default decision changes, prompt/model-message changes, policy changes, side-effect replay, or completion proof from diagnostics.
