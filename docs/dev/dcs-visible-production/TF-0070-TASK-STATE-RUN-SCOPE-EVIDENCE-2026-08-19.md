# TF-0070 DCS Task State Run Scope Evidence

Date: 2026-08-19

Status: implementation complete for the run-scope isolation slice. This is
engineering evidence only; it does not change `default-off`, `liveReady`,
`productApproved`, or `defaultOn`.

## Problem

`TaskStateHandlerConfig` was previously held as one process-level value. A
second embedded run could replace the sink, objective, working-memory store,
or SEKB capture used by an in-flight `task_phase_change` event. A later run
with failed DCS initialization could also leave an old registration visible.

## Change

- `lifecycle-hook-helpers.ts` now stores configs by normalized `runId` and
  `sessionId` scope and resolves a phase event using its own event lineage.
- `task-loop-controller.ts` explicitly binds its `loopRunId` to the unique
  session-scoped embedded DCS config before the first lifecycle event. If a
  session has multiple candidate outer runs, the bridge fails closed rather
  than guessing.
- The phase hook captures the resolved config before awaiting the handler, so
  later registrations cannot redirect the current write or trajectory capture.
- `completed`, `failed`, and `cancelled` phases clear only their own scope.
- `agent_end` clears the outer attempt owner and any loop aliases derived from
  it, closing the stale-config window after a TaskLoop returns.
- `buildTaskStateFactory` registers the attempt `runId`/session key and clears
  that scope when sink/store dependencies are unavailable.
- The unscoped setter/getter remains only as a compatibility and diagnostic
  surface. It is used by the hook only when it is the sole legacy registration;
  any scoped registrations disable that fallback.

## Verification

| Check | Result |
|---|---|
| `pnpm run test:dcs` | PASS: 20 unit files / 250 tests; 5 runtime-config files / 10 tests; 10 agent files / 87 tests |
| Focused task-state extension shard | PASS: 9 tests |
| Task-loop + SEKB focused shard | PASS: 33 tests |
| `pnpm run typecheck:node` | PASS |
| Scoped ESLint for changed runtime/test files | PASS |
| Harness context for `dcs-stage2-task-state-handoff` | PASS |

The new regression coverage proves:

1. Interleaved plugin-hook awaits keep two phase events on their own sink and
   objective.
2. Terminal/cancelled cleanup removes only the finished run and leaves a
   concurrent run registered.
3. A no-dependency follow-up initialization invalidates a stale scope without
   affecting another run.
4. The TaskLoop `loopRunId` bridge selects the unique session config and
   rejects ambiguous same-session registrations.
5. Agent-end cleanup removes both the outer attempt registration and its loop
   aliases.

## Boundary

This slice does not change TaskFlow/Mission lifecycle ownership, BlockStore
schema, transport, host API, SEKB auto-writeback, or product rollout flags.
The existing DCS Stage 2 task-state and child-handoff contract remains the
behavioral baseline.
