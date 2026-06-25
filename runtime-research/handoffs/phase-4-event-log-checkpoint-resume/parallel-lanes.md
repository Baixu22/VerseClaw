# Phase 4 Parallel Implementation Lanes

All lanes may run in separate windows. Each lane must preserve legacy behavior by default and must write its own submission under `submissions/`.

## Lane A: Event Log Contracts And Store

LANE_ID: `lane-a-event-log-contracts-and-store`

LANE_TITLE: RuntimeTaskEvent append-only log contracts, flags, store/query primitives

LANE_SCOPE:

- Define event-log envelope/metadata around canonical `RuntimeTaskEvent`; do not duplicate the event contract.
- Add default-off feature flags such as `runtime.eventLog.shadow`, `runtime.eventLog.persist`, and event-log schema markers.
- Add append-only writer/reader/query primitives with idempotency key support.
- Add search/filter/export primitives by task id, kind, timestamp range, sort order, pagination, and batch get.
- Store errors must be isolated as diagnostics in shadow mode; legacy runtime must remain authoritative.
- Do not start any service or introduce Temporal/OpenHands runtime dependencies.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/**`
- `openclaw_runtime/src/agents/long-task-control/**`
- `tests/unit/runtime-event-log*.test.ts`
- `harness/specs/tasks/phase-4-event-log-checkpoint-resume.md`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-a-event-log-contracts-and-store.md
```

## Lane B: TaskLoop Event Log Dual-Write

LANE_ID: `lane-b-taskloop-event-log-dual-write`

LANE_TITLE: TaskLoop emits append-only RuntimeTaskEvent log shadows

LANE_SCOPE:

- Wire TaskLoop lifecycle/checkpoint RuntimeTaskEvent shadows into the Lane A event-log writer only behind Phase-4 flags.
- Keep `runtimeTaskEventLogShadow`, `runtimeCoreShadow`, and new event-log flags independent and reversible.
- Writer failures are non-fatal and must not change TaskLoop final status, lifecycle payloads, self-check decisions, or persisted checkpoint authority.
- Do not feed event-log output back into prompt context or verifier decisions.
- Maintain Phase-3 registry diagnostics as shadow metadata/evidence only.

SUGGESTED_PATHS:

- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `openclaw_runtime/src/agents/long-task-control/**`
- `tests/unit/task-loop-controller.test.ts`
- new `tests/unit/task-loop-event-log-shadow.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-b-taskloop-event-log-dual-write.md
```

## Lane C: State Reducer And Checkpoint Serializer

LANE_ID: `lane-c-state-reducer-checkpoint-serializer`

LANE_TITLE: Replay reducer and checkpoint serializer for RuntimeTaskEvent history

LANE_SCOPE:

- Build a pure reducer that reconstructs task state from `RuntimeTaskEvent[]`.
- Cover created/planning/running/waiting/verifying/completed/failed/blocked/cancelled/checkpoint states.
- Build checkpoint serializer/deserializer fixtures that preserve open obligations, context summary, tool result refs, file hashes, evidence refs, schema version, and compaction markers.
- Add continue-as-new / compaction shadow shape, but do not use it to replace legacy resume.
- Detect schema/version marker mismatches as structured replay diagnostics, not task crashes.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/**`
- `openclaw_runtime/src/agents/long-task-control/**`
- `tests/unit/runtime-state-reducer*.test.ts`
- `tests/unit/runtime-checkpoint-serializer*.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-c-state-reducer-checkpoint-serializer.md
```

## Lane D: Resume Shadow And Idempotency

LANE_ID: `lane-d-resume-shadow-idempotency`

LANE_TITLE: Resume shadow comparison and side-effect idempotency guard

LANE_SCOPE:

- Add resume shadow helper that reads event log/checkpoints and compares replayed state to legacy latest checkpoint/session state.
- Prove resume shadow does not execute tools, apply patches, send messages, call Gateway, or mutate files.
- Reuse completed tool results by `idempotencyKey` and record missing/ambiguous tool results as waiting/verifying diagnostics.
- Ensure side-effect tool calls are not repeated after resume.
- Keep `runtime.resume.replayShadow` default-off; do not implement `runtime.resume.preferEventLog` cutover in this phase.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/**`
- `openclaw_runtime/src/agents/long-task-control/**`
- `openclaw_runtime/src/agents/tools/task-loop-tool.ts`
- `tests/unit/runtime-resume-shadow*.test.ts`
- `tests/unit/task-loop-controller.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-d-resume-shadow-idempotency.md
```

## Lane E: Harness, Tests, Boundary, Docs

LANE_ID: `lane-e-harness-tests-boundary-docs`

LANE_TITLE: Phase 4 validation, boundary scan, docs/index updates, synthesis readiness

LANE_SCOPE:

- Validate `phase-4-event-log-checkpoint-resume` harness spec.
- Run focused lane tests and a combined Phase-4 unit slice.
- Run boundary scans for renderer direct IPC/Gateway bypass and second-runtime service false positives.
- Run comms replay/compare if Main/Gateway communication paths changed.
- Run targeted E2E if any user-visible UI changes landed.
- Update `runtime-research/agent-runtime-index.md` only after synthesis accepts lanes.

SUGGESTED_PATHS:

- `harness/specs/tasks/phase-4-event-log-checkpoint-resume.md`
- `runtime-research/agent-runtime-index.md`
- `runtime-research/handoffs/phase-4-event-log-checkpoint-resume/**`
- relevant tests

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-e-harness-tests-boundary-docs.md
```

