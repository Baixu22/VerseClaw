# lane-b-taskloop-event-shadow

Status: `blocked_on_lane_a_contracts`

## Scope

- Lane id: `lane-b-taskloop-event-shadow`
- Goal: wrap existing TaskLoop lifecycle/checkpoint paths with RuntimeTaskEvent shadow recording while preserving legacy TaskLoop behavior.
- Legacy paths:
  - `openclaw_runtime/src/agents/task-loop-controller.ts`
  - `openclaw_runtime/src/agents/long-task-control/store.ts`
- Required upstream source of truth: `lane-a-runtime-core-contracts`

## Blocker

This checkout does not contain the Lane A runtime-core contract exports required by the lane:

- `RuntimeTaskEvent`
- `ContextItem`
- `ToolCallRequest`
- `ToolCallResult`
- `EvidenceRef`
- `Checkpoint`

Searches for `RuntimeTaskEvent`, `runtimeTaskEvent`, and `lane-a-runtime-core-contracts` found no implementation contract in `shared/`, `openclaw_runtime/src/`, `src/`, or `tests/`. Per lane constraints, this file does not define substitute types, does not add a parallel contract file, and does not modify legacy runtime behavior.

## Adapter Seam Draft

Once Lane A lands, the adapter should import the contract types from that single source and remain one-way/shadow-only:

```ts
import type {
  RuntimeTaskEvent,
  EvidenceRef,
  Checkpoint,
} from "<lane-a-runtime-core-contracts>";
```

The adapter should be called from existing TaskLoop emission/checkpoint boundaries without changing their payloads or return values:

- lifecycle source: `TaskLoopLifecycleEvent` emitted by `emit(...)` in `task-loop-controller.ts`
- checkpoint source: `TaskLoopCheckpointRecordInput` passed through `recordTaskLoopCheckpoint(...)`
- storage/observer sink: provided by dependency injection or Lane A event-log API
- flags: `runtimeTaskEventLogShadow` and/or `runtimeCoreShadow`

Flag off must perform no additional calls and produce byte-for-byte equivalent legacy lifecycle payloads in existing tests.

## Compatibility Mapping Draft

This mapping is intentionally descriptive until Lane A defines exact enum names.

| TaskLoop source | RuntimeTaskEvent intent |
|---|---|
| `phase: intake`, `status: running` | task accepted / created-intake event |
| `phase: plan`, `status: running` | planning event |
| `phase: execute`, `status: running` | running execution event |
| `phase: collect_evidence`, `status: running` | evidence collection event |
| `phase: self_check`, `status: running` | verification/self-check event |
| `phase: repair`, `status: running` | repair/retry event |
| `phase: complete`, `status: complete` | terminal completed event |
| `phase: blocked`, `status: blocked` | terminal blocked event |
| `phase: error`, `status: error` | terminal failed/error event |

Checkpoint linkage should attach the checkpoint id/ref to either `RuntimeTaskEvent.evidenceRefs` or the Lane A-defined checkpoint field. If both exist, prefer the canonical Lane A checkpoint reference field and include the checkpoint as evidence only when the contract says checkpoints are evidence.

## Non-Behavior-Change Requirements

- Do not change `TaskLoopRunRecord.status` or final phase/status assignment.
- Do not change existing `TaskLoopLifecycleEvent` payload fields.
- Do not add optional lifecycle fields unless tests prove legacy consumers remain stable.
- Do not write JSON/JSONL sidecars for OpenClaw-owned runtime state.
- Do not call the shadow adapter unless the feature flag is enabled.
- Shadow adapter failures must not flip TaskLoop status, checkpoint status, or lifecycle delivery.

## Test Draft

Enable these tests only after Lane A contracts land:

- `TaskLoop complete fixture`: run a one-iteration complete loop, enable `runtimeTaskEventLogShadow`, assert emitted RuntimeTaskEvent sequence maps `intake -> plan -> execute -> collect_evidence -> self_check -> complete`, and assert `TaskLoopRunRecord.status === "complete"`.
- `TaskLoop blocked fixture`: force missing evidence or exhausted repair, assert terminal RuntimeTaskEvent maps to blocked and `TaskLoopRunRecord.status === "blocked"`.
- `TaskLoop error fixture`: make `runObserved` throw, assert terminal RuntimeTaskEvent maps to failed/error and `TaskLoopRunRecord.status === "error"`.
- `Checkpoint ref linkage`: capture `recordCheckpoint` input and shadow events, assert checkpoint id/ref is attached through Lane A `evidenceRefs` or checkpoint payload semantics.
- `Flag off parity`: run the existing complete fixture with the flag omitted/false, assert no shadow sink calls and existing lifecycle event payloads equal the current expected payload shape.
- Existing test continuity: keep `tests/unit/task-loop-controller.test.ts` passing unchanged except for additive shadow tests.

## Handoff

Implementing code is intentionally deferred until `lane-a-runtime-core-contracts` is available. The next lane owner should first add imports from the Lane A contract module, then implement a TaskLoop shadow adapter behind `runtimeTaskEventLogShadow` / `runtimeCoreShadow`, with dependency-injected capture for unit tests before any durable event-log storage is introduced.
