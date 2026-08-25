# TF-0071 Task Loop Phase Side-Effect Durability Evidence

Date: 2026-08-20
Status: implementation complete; engineering evidence only

## Scope

TF-0070 isolated `TaskStateHandlerConfig` by `runId + sessionId`, but the
TaskLoop producer still scheduled phase side effects without a completion
boundary. A loop could resolve before the task-state write or terminal
trajectory capture finished, and a rejected write had no structured result for
the caller to observe.

## Changes

- `runAgentHarnessTaskPhaseChangeHook` now returns structured
  `accepted | rejected | failed | skipped` task-state evidence and separate
  trajectory evidence.
- `handleTaskPhaseChange` forwards the sink rejection reason.
- Each TaskLoop run serializes its phase hooks on a per-run promise queue.
  Normal and error returns drain the queue before `runTaskLoop` resolves.
- Terminal trajectory capture is therefore observable before loop completion.
- Sink/capture failures are logged with structured run/session/task/phase
  fields and remain side-effect degradation; they do not change the loop
  control result or create an unhandled rejection.
- Cancellation checks after awaited orchestration prevent late work from
  reviving a cancelled run. Existing default-off, live-readiness, product
  approval, and SEKB writeback boundaries are unchanged.

## RED to GREEN Evidence

- The producer durability test first failed because the returned producer
  promise settled before the delayed hook. After the per-run queue was added,
  it remained pending until the hook gate released.
- The runtime handler test first exposed that a rejected sink reason was not
  returned. The final result preserves `reason: "store unavailable"`.
- The end-to-end TaskLoop test verifies a delayed DCS sink keeps the loop
  promise pending and records an accepted terminal side-effect entry before
  return.

## Verification

| Command | Result |
| --- | --- |
| `pnpm run test:dcs` | PASS: unit 251, runtime-config 10, agents 88 |
| focused root TaskLoop tests | PASS: 67/67 |
| focused runtime agent tests | PASS: 2 files, 15 tests |
| focused runtime unit tests | PASS: 2 files, 34 tests |
| direct `tsc --noEmit -p tsconfig.node.json --composite false` | PASS |
| `pnpm --dir openclaw_runtime db:kysely:check` | PASS |
| `pnpm --dir openclaw_runtime build` | FAIL at existing `goal_wait` tool-display metadata check after tsdown/runtime postbuild; exit 1 |
| `pnpm run lint:dcs` | PASS |
| changed-file ESLint | PASS |
| `pnpm run comms:replay` | PASS |
| `pnpm run comms:compare` | PASS: zero loss/duplicate/reorder and zero metric deltas |
| `pnpm harness validate --no-diff --spec harness/specs/tasks/dcs-stage2-task-state-handoff.md` | PASS: spec valid |
| `git diff --check` | PASS; no whitespace errors |

## Residuals and Boundary

`pnpm harness run --spec harness/specs/tasks/dcs-stage2-task-state-handoff.md --dry-run`
remains blocked by the shared dirty worktree containing unrelated changed
paths outside this task's touched areas and by missing `harness/node_modules`.
This is recorded as a Harness environment/worktree residual, not promoted to
a full-repository pass.

No renderer/Main/Gateway transport, host API, schema, prompt, transcript, or
default-on behavior changed. No automatic SEKB writeback was introduced.
