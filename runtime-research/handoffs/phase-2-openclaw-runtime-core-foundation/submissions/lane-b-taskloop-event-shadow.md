# lane-b-taskloop-event-shadow: TaskLoop RuntimeTaskEvent Shadow

## Scope Confirmation

- Lane: `lane-b-taskloop-event-shadow`
- Output file: `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/lane-b-taskloop-event-shadow.md`
- Lane-owned file only: yes
- Files/directories searched: `openclaw_runtime/src/agents/task-loop-controller.ts`, `openclaw_runtime/src/agents/long-task-control/store.ts`, `tests/unit/task-loop-controller.test.ts`, runtime-core contracts
- Commands run:
  - `rtk rg -n "runtimeTaskEventLogShadow|runtimeCoreShadow|RuntimeTaskEvent|emitRuntimeTaskEventShadow|emitTaskLoopLifecycleShadow|emitTaskLoopCheckpointShadow" openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts`
- Prior handoffs reviewed: misplaced `runtime-research/handoffs/lane-b-taskloop-event-shadow.md`, Phase-1 synthesis, Phase-2 synthesis

## Executive Summary

- This file supersedes the old misplaced blocked handoff at `runtime-research/handoffs/lane-b-taskloop-event-shadow.md`.
- Lane A contracts now exist, so lane B is no longer blocked on missing `RuntimeTaskEvent`.
- TaskLoop can emit canonical `RuntimeTaskEvent` lifecycle/checkpoint shadows through a dependency-injected sink.
- Shadow emission is gated by `runtimeTaskEventLogShadow` or `runtimeCoreShadow`.
- Shadow sink failures are caught and must not perturb TaskLoop behavior.
- Legacy TaskLoop statuses remain `running | complete | blocked | error`; canonical names are only used in shadow events.
- This lane does not accept Task Ledger as a canonical event log or any default-on checkpoint/resume cutover.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| TaskLoop config defines shadow flags. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `TaskLoopConfig`, lines 73-82 | `runtimeTaskEventLogShadow` and `runtimeCoreShadow`. |
| TaskLoop deps define a shadow event sink. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `TaskLoopRuntimeEventShadowSink`, line 84; deps lines 260-317 | Sink is dependency-injected. |
| Legacy TaskLoop statuses remain unchanged. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `TaskLoopStatus`, line 71 | `running`, `complete`, `blocked`, `error`. |
| Runtime shadow maps legacy phase/status to canonical runtime statuses. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `runtimeTaskStatusForTaskLoop`, lines 1178-1201 | Maps `complete` to `completed`, `error` to `failed`. |
| Shadow emission is flag-gated. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `runtimeEventShadowEnabled`, lines 1210-1213 | Requires either flag true. |
| Shadow sink failures are non-fatal. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `emitRuntimeTaskEventShadow`, lines 1215-1225 | Catches errors and comments observational boundary. |
| Lifecycle shadows are emitted from existing lifecycle events. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `emitTaskLoopLifecycleShadow`, lines 1241-1265 | Uses existing `TaskLoopLifecycleEvent`. |
| Checkpoint shadows are emitted after legacy checkpoint construction/write path. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `recordTaskLoopCheckpoint`, lines 1320-1385 | Calls `emitTaskLoopCheckpointShadow` after writer call. |
| Shadow flags are captured per run from deps/config. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | lines 1652-1656 | Supports deps override and config defaults. |
| Complete TaskLoop shadow test exists. | test | `tests/unit/task-loop-controller.test.ts` | lines 703-772 | Asserts lifecycle/checkpoint `RuntimeTaskEvent` shadows for complete loop. |
| Blocked TaskLoop shadow test exists. | test | `tests/unit/task-loop-controller.test.ts` | lines 772-807 | Asserts blocked shadow without changing blocked decision. |
| Shadow-off parity test exists. | test | `tests/unit/task-loop-controller.test.ts` | lines 548-605 | Asserts no evidence verifier report and stable legacy output with shadow flags false. |
| Focused runtime foundation run passed. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts` | result: pass, 3 files / 52 tests | Includes TaskLoop shadow tests. |
| Prior misplaced handoff is superseded. | handoff | `runtime-research/handoffs/lane-b-taskloop-event-shadow.md` | status `blocked_on_lane_a_contracts` | No longer canonical after this submission. |

## Current State

Current code:

- `runTaskLoop()` stores shadow flags per run in a `WeakMap`.
- Lifecycle and checkpoint events are transformed into `RuntimeTaskEvent` shadows only when enabled.
- Shadow emission is observational and delivered to an optional sink.

Current tests:

- `tests/unit/task-loop-controller.test.ts` covers complete and blocked shadow mappings, plus flag-off parity for shadow/evidence report fields.

Current harness specs:

- `harness/specs/tasks/runtime-contract-layer-spike.md` exists for the foundation layer.

Existing handoff notes:

- The older lane-b handoff was blocked before Lane A contracts existed. It should be treated as superseded, not as the canonical Phase-2 submission.

## Shadow Contract Or Adapter Shape

| Surface | Contract / Adapter | Shadow Or Warning Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| TaskLoop lifecycle | Existing `TaskLoopLifecycleEvent` -> `RuntimeTaskEvent` status event | shadow-only | `runtimeTaskEventLogShadow` / `runtimeCoreShadow` | `task-loop-controller.ts:1241`-`:1265` |
| TaskLoop checkpoint | Existing checkpoint -> `RuntimeTaskEvent` checkpoint event | shadow-only | `runtimeTaskEventLogShadow` / `runtimeCoreShadow` | `task-loop-controller.ts:1320`-`:1385` |
| Shadow delivery | Optional sink callback | shadow-only; failures swallowed | same flags | `task-loop-controller.ts:1215`-`:1225` |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| `TaskLoopRunRecord.status` | Remains legacy `running/complete/blocked/error`. | `TaskLoopStatus` at `task-loop-controller.ts:71`; tests assert result status `complete` / `blocked`. | Canonical names must not leak into legacy lifecycle consumers. |
| Lifecycle event delivery | Existing `deps.lifecycle` still receives legacy payload. | `emit()` calls `deps.lifecycle?.(event)` before shadow emission at `task-loop-controller.ts:1447`-`:1448`. | Optional new fields in lifecycle payload need stable-consumer tests. |
| Shadow sink failure | Must not change loop state. | `emitRuntimeTaskEventShadow` catches all errors at `task-loop-controller.ts:1221`-`:1225`. | Durable event log must not be introduced in this lane. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| TaskLoop shadow unit tests | `tests/unit/task-loop-controller.test.ts` | pass in focused run | Complete and blocked RuntimeTaskEvent shadows. | Not a durable event-log replay test. |
| Flag-off parity | `tests/unit/task-loop-controller.test.ts:548`-`:605` | pass in focused run | Shadow/evidence report disabled behavior. | Does not prove every historical TaskLoop fixture byte-for-byte. |
| Focused runtime foundation run | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts` | pass | Contracts and TaskLoop shadow. | Does not include full MCP tests. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| TaskLoop status names differ from runtime-core names. | Legacy `TaskLoopStatus` at line 71; canonical mapping at lines 1178-1201. | RuntimeTaskEvent should use canonical status names. | Keep explicit mapping and tests; do not rename legacy status in Phase 2. |
| Task Ledger is present but not canonical event log. | Checkpoint path writes through long-task store before shadow event. | Future Workflow Checkpoint Engine should use append-only runtime event log. | Treat Task Ledger as compatibility projection until Stage 5. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: TaskLoop shadow event parity expansion
New code path: none; extend tests around existing shadow sink
Legacy path wrapped: openclaw_runtime/src/agents/task-loop-controller.ts lifecycle/checkpoint paths
Shadow / warning boundary: shadow-only RuntimeTaskEvent sink
Feature flag: runtimeTaskEventLogShadow or runtimeCoreShadow
Tests: add error-path shadow test and sink-throws parity test
Harness: runtime-contract-layer-spike or future runtime-event-log-checkpoint-shadow
Rollback: disable flags or omit shadow sink
Done when: complete/blocked/error lifecycle shadows and checkpoint shadows are covered with flag-off parity
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should `runtimeTaskEventLogShadow` and `runtimeCoreShadow` both remain? | Two flags may confuse later migrations. | maintainer | no |
| When does Task Ledger become a projection of canonical event log? | Avoid treating current checkpoint projection as execution truth. | maintainer | yes for Stage 5, no for Phase 2 |

## Handoff Notes

- This lane accepts only RuntimeTaskEvent shadow emission behind flags.
- It does not accept default-on event log, resume behavior changes, or Task Ledger as the canonical event log.
- The old root-level lane-b file is superseded and should not be used as the canonical lane submission.
