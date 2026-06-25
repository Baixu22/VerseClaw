# lane-c-state-reducer-checkpoint-serializer: Replay reducer and checkpoint serializer for RuntimeTaskEvent history

## Scope Confirmation

- Lane: `lane-c-state-reducer-checkpoint-serializer`
- Output file: `runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-c-state-reducer-checkpoint-serializer.md`
- Lane-owned file only: yes
- Implementation paths touched:
  - `openclaw_runtime/src/runtime-core/state-reducer.ts`
  - `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts`
  - `openclaw_runtime/src/runtime-core/index.ts`
- Test paths touched:
  - `tests/unit/runtime-state-reducer.test.ts`
  - `tests/unit/runtime-checkpoint-serializer.test.ts`
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/runtime-state-reducer*.test.ts tests/unit/runtime-checkpoint-serializer*.test.ts`
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff`
  - `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control tests/unit/runtime-state-reducer*.test.ts tests/unit/runtime-checkpoint-serializer*.test.ts`
  - `rtk rg -n 'node:fs|from "fs|child_process|fetch\(|writeFile|exec\(|spawn\(|createServer|listen\(' openclaw_runtime/src/runtime-core/state-reducer.ts openclaw_runtime/src/runtime-core/checkpoint-serializer.ts tests/unit/runtime-state-reducer.test.ts tests/unit/runtime-checkpoint-serializer.test.ts`
- Required reading completed: yes

## Executive Summary

- Added a pure `RuntimeTaskEvent` replay reducer that accepts raw canonical events or Lane A event-log records/envelopes.
- Replayed state covers canonical statuses plus the `checkpoint` event phase while keeping canonical `status` separate from replay `state`.
- Reducer preserves open obligations, context summary, context items, tool requests/results, tool result refs, pending tool call ids, file hashes, evidence refs, latest checkpoint, errors, and optional compaction metadata.
- Added structured replay diagnostics for invalid event order, duplicate event id, missing checkpoint payload, schema/version marker mismatch, and terminal event followed by non-compaction continuation.
- Added a checkpoint serializer/deserializer envelope over canonical `Checkpoint` that preserves schema markers, metadata/version markers, tool result refs, evidence refs, file hashes, and continue-as-new/compaction shadow data.
- Added fixture-driven tests proving deterministic replay/serialization and no side-effect execution from replayed tool requests.
- Kept this lane library-only: no live writes, no TaskLoop call-site changes, no legacy checkpoint store changes, no resume shadow comparison, and no UI.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Pure reducer accepts raw events and Lane A event-log records | file | `openclaw_runtime/src/runtime-core/state-reducer.ts` | `replayRuntimeTaskEvents` lines 181-263; `replayRuntimeTaskEventLogRecords` lines 265-270 | No executor, storage, Gateway, or file APIs are injected or called. |
| Required replay diagnostics are structured | file | `openclaw_runtime/src/runtime-core/state-reducer.ts` | `RUNTIME_TASK_REPLAY_DIAGNOSTIC_CODES` lines 39-46; diagnostic emission lines 237, 358, 393, 411, 572 | Covers invalid order, duplicate id, missing checkpoint payload, schema marker mismatch, terminal continuation. |
| Reducer preserves checkpoint obligations/evidence/tool/file state | test | `tests/unit/runtime-state-reducer.test.ts` | lines 147-173 | Asserts checkpoint phase, open obligations, context summary, tool refs, sorted file hashes, and evidence refs. |
| Reducer replay is deterministic across raw events and event-log records | test | `tests/unit/runtime-state-reducer.test.ts` | lines 175-188 | Compares raw event replay to Lane A store record replay and repeated JSON output. |
| Reducer does not execute side-effect tool requests | test | `tests/unit/runtime-state-reducer.test.ts` | lines 190-221 | Replays a mutating-looking tool request and only records waiting state/pending call id. |
| Invalid/nondeterministic histories are diagnosed | test | `tests/unit/runtime-state-reducer.test.ts` | lines 235-270 | Duplicate id, invalid order, missing checkpoint payload, schema mismatch, and terminal continuation are asserted. |
| Checkpoint serializer preserves canonical checkpoint payload plus refs/metadata/version markers | file | `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts` | `RuntimeCheckpointSnapshot` lines 67-75; `serializeRuntimeCheckpoint` lines 150-185; `deserializeRuntimeCheckpoint` lines 188-232 | Envelope wraps canonical `Checkpoint`; no legacy store behavior changed. |
| Continue-as-new / compaction shadow shape is available but not wired into resume | file | `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts` | `RuntimeTaskContinueAsNewShadow` lines 43-52; `createRuntimeTaskContinueAsNewShadow` lines 96-110 | Library shape only. |
| Checkpoint round-trip and schema handling are fixture-tested | test | `tests/unit/runtime-checkpoint-serializer.test.ts` | lines 14-78, 80-106, 109-155, 158-178 | Preserves checkpoint fields, compaction, schema diagnostics, deterministic serialization, invalid input isolation. |
| New surfaces are exported through runtime-core | file | `openclaw_runtime/src/runtime-core/index.ts` | lines 5-6 | No extra runtime service or adapter path. |
| Focused required unit slice passed | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/runtime-state-reducer*.test.ts tests/unit/runtime-checkpoint-serializer*.test.ts` | 4 files / 26 tests passed | Covers Lane A contracts/store plus Lane C reducer/serializer. |
| TypeScript validation passed | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | exit 0 | Required typecheck. |
| Harness validation passed | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff` | pass | Spec structural validation. |
| No second runtime service or Gateway endpoint introduced | missing-after-search | required `rtk rg` service/listener scan | no matches; `rg` exit 1 | Scanned runtime-core, long-task-control, and lane tests. |
| Reducer/serializer files contain no obvious side-effect imports/calls | missing-after-search | side-effect `rtk rg` scan for fs/process/network/server patterns | no matches; `rg` exit 1 | Supports no side-effect replay claim. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/runtime-core/state-reducer.ts`
  - Defines `RuntimeTaskReplayState`, `RuntimeTaskReplayResult`, `RuntimeTaskReplayDiagnostic`, and replay schema markers.
  - Exposes `replayRuntimeTaskEvents()` and `replayRuntimeTaskEventLogRecords()`.
  - Rebuilds state from event order only; it does not call tools, commands, storage, Gateway, network, or file APIs.
  - Handles checkpoint events by retaining `state: "checkpoint"` and canonical `status: checkpoint.state`.
  - Tracks pending tool calls without executing them.
- `openclaw_runtime/src/runtime-core/checkpoint-serializer.ts`
  - Defines serializer schema markers and `RuntimeCheckpointSnapshot`.
  - Exposes `serializeRuntimeCheckpoint()` and `deserializeRuntimeCheckpoint()`.
  - Defines `RuntimeTaskContinueAsNewShadow` and helper/guard for compaction shadow data.
- `openclaw_runtime/src/runtime-core/index.ts`
  - Exports the reducer and serializer surfaces.

Tests:

- `tests/unit/runtime-state-reducer.test.ts`
  - Canonical lifecycle replay, checkpoint state, raw events vs event-log records, deterministic repeated replay, side-effect-looking tool request replay, terminal statuses, invalid/nondeterministic diagnostics, and compaction continuation marker.
- `tests/unit/runtime-checkpoint-serializer.test.ts`
  - Checkpoint round-trip, metadata/version markers, tool result refs, file hash/evidence preservation, compaction shadow preservation, schema mismatch/missing payload diagnostics, deterministic serialization, invalid checkpoint isolation.

Feature flags:

- No new feature flags were added in this lane.
- Lane A's default-off `runtime.checkpointSerializer.shadow` / `runtime.resume.replayShadow` remain the intended future wiring gates.

Harness/spec changes:

- None.

## Event Log / Checkpoint / Resume Surface

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Replay reducer | `replayRuntimeTaskEvents()` over `RuntimeTaskEvent[]` | library-only; no live runtime authority | future `runtime.resume.replayShadow` | `state-reducer.ts` lines 181-263 |
| Event-log record replay | `replayRuntimeTaskEventLogRecords()` over Lane A records/envelopes | library-only; uses append-order input, no store writes | future `runtime.eventLog.shadow` / `runtime.resume.replayShadow` | `state-reducer.ts` lines 265-270; test lines 175-188 |
| Replay diagnostics | `RuntimeTaskReplayDiagnostic` | structured diagnostics, no crashes | none | `state-reducer.ts` lines 39-62 |
| Checkpoint serializer | `RuntimeCheckpointSnapshot` + `serializeRuntimeCheckpoint()` / `deserializeRuntimeCheckpoint()` | shadow serializer only; legacy checkpoint store unchanged | future `runtime.checkpointSerializer.shadow` | `checkpoint-serializer.ts` lines 67-75, 150-232 |
| Continue-as-new shadow | `RuntimeTaskContinueAsNewShadow` | shape only; not wired to live resume | future compaction/resume flags | `checkpoint-serializer.ts` lines 43-52, 96-110 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop execution/call sites | Unchanged; no TaskLoop files touched in this lane. | Touched implementation paths are runtime-core exports only. | Future Lane D/B follow-ups must keep wiring flag-gated. |
| `long_task_checkpoints` / long-task store | Unchanged; serializer does not read/write legacy store. | Required service scan included `openclaw_runtime/src/agents/long-task-control`; no changes needed. | Future serializer parity wiring must remain shadow-only. |
| Resume behavior | Unchanged; no resume shadow or `preferEventLog` cutover implemented. | No call sites added; reducer/serializer are pure helpers. | Lane D owns resume comparison/idempotency. |
| Renderer/Main transport/UI | Unchanged; no renderer/Main/UI files touched. | Boundary/service scans found no Gateway/server patterns in lane paths. | Any future UI-visible resume change needs E2E. |

## Replay / Idempotency Audit

| Replay Focus | Result | Evidence | Gap |
|---|---|---|---|
| No side-effect tool re-execution | pass | `tests/unit/runtime-state-reducer.test.ts` lines 190-221; side-effect pattern `rg` scan no matches | This is replay reducer proof only; live resume suppression remains Lane D. |
| Completed tool results reused by idempotency key | not-run | Reducer preserves tool results/tool refs (`state-reducer.ts` `addToolResult`) but does not implement resume reuse. | Lane D owns idempotency reuse during resume. |
| Missing tool result returns waiting/verifying diagnostic | not-run | Reducer exposes `pendingToolCallIds` and preserves `waiting_tool` state in test lines 190-221. | Lane D owns resume diagnostics for missing tool result reuse. |
| Schema/version marker handled | pass | Reducer schema mismatch test lines 235-270; serializer schema mismatch test lines 109-155 | None for Lane C. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md` | pass | Required pre-implementation context/read order. | Initial `cmd` shell did not have `rtk`; reran successfully through Git Bash. |
| Focused unit tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/runtime-state-reducer*.test.ts tests/unit/runtime-checkpoint-serializer*.test.ts` | pass, 4 files / 26 tests | Runtime contracts, Lane A event log, Lane C reducer/serializer. | None. |
| TypeScript | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node/runtime surfaces touched by Lane C. | None. |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff` | pass | Phase-4 task spec validation. | `--no-diff` per required validation. |
| Service boundary scan | required `rtk rg` service/listener/Gateway endpoint command | pass/no matches (`rg` exit 1) | No second runtime service or Gateway endpoint patterns in lane paths. | None. |
| Side-effect pattern scan | `rtk rg -n 'node:fs|from "fs|child_process|fetch\(|writeFile|exec\(|spawn\(|createServer|listen\(' ...` | pass/no matches (`rg` exit 1) | Reducer/serializer have no obvious side-effect imports/calls. | Static scan only; unit tests also prove replay does not execute tool request payloads. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No second runtime service | pass | Required service/listener scan returned no matches. |
| No renderer direct IPC | pass | No renderer files touched. |
| No renderer direct Gateway HTTP/WS | pass | No renderer files touched; required scan found no Gateway endpoint strings in lane paths. |
| Feature flags default safe | pass | No new flags added; library-only helpers require future explicit wiring under Lane A flags. |
| Flag-off parity covered | pass | No live wiring, TaskLoop path, or legacy store path changed. |
| Resume does not execute side effects | pass | Reducer has no executor dependency/imports and side-effect-looking tool request replay test only records pending state. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Replay `state: "checkpoint"` vs canonical `RuntimeTaskStatus` | Reducer keeps `state: "checkpoint"` for checkpoint event phase and `status: checkpoint.state` for canonical status. | Preserve canonical `Checkpoint.state` while allowing fixtures to assert checkpoint event replay. | Keep both fields; future resume code should use canonical `status` for task decisions. |
| Missing tool result diagnostics are not implemented in Lane C | Reducer tracks `pendingToolCallIds` but does not emit resume diagnostics. | Resume shadow should decide whether missing results return waiting/verifying diagnostics. | Lane D should consume `pendingToolCallIds` and add resume-specific diagnostics. |
| No persisted checkpoint serializer store | Serializer emits deterministic JSON/string + envelope only. | Runtime AGENTS storage policy discourages new sidecar state. | Keep serializer library-only; any persisted shadow store must choose an approved SQLite/state owner in a future lane. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: lane-d-resume-shadow-idempotency
New code path: runtime-core resume shadow helper consuming event-log replay state
Legacy path wrapped: legacy latest checkpoint/session state comparison only
Shadow / pilot boundary: resume comparison only; no event-log authority and no tool/file/model execution
Feature flag: runtime.resume.replayShadow
Tests: reuse completed tool results by idempotency key; missing result returns waiting/verifying diagnostic; side-effect tools are not re-executed
Harness: phase-4-event-log-checkpoint-resume validate plus service/side-effect boundary scans
Rollback: disable runtime.resume.replayShadow; legacy resume remains authoritative
Done when: shadow resume can compare replay state against legacy state without mutating files, invoking tools, sending Gateway messages, or changing legacy decisions
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should future resume use replay `status` or checkpoint-phase `state` for comparisons? | Lane C exposes both to preserve checkpoint event visibility without corrupting canonical statuses. | maintainer/agent | no |
| Should missing tool results become reducer diagnostics or resume-only diagnostics? | Reducer can identify pending call ids, but only resume knows whether that is actionable. | maintainer/agent | no |

## Handoff Notes

- This lane intentionally does not wire TaskLoop, legacy checkpoint store, resume shadow, idempotency reuse, UI, or renderer/Main APIs.
- Reducer and serializer are deterministic, fixture-driven, and library-only.
- Use `RuntimeTaskReplayState.status` for canonical task state decisions; `state: "checkpoint"` exists to make checkpoint event replay explicit in fixtures and handoff evidence.
- Lane D should consume `pendingToolCallIds`, `toolResultRefs`, `latestCheckpoint`, and `compaction` rather than re-parsing raw events.
