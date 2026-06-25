# lane-a-event-log-contracts-and-store: RuntimeTaskEvent append-only log contracts, flags, store/query primitives

## Scope Confirmation

- Lane: `lane-a-event-log-contracts-and-store`
- Output file: `runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-a-event-log-contracts-and-store.md`
- Lane-owned file only: yes
- Implementation paths touched:
  - `openclaw_runtime/src/runtime-core/event-log.ts`
  - `openclaw_runtime/src/runtime-core/index.ts`
  - `openclaw_runtime/src/config/types.openclaw.ts`
  - `openclaw_runtime/src/config/zod-schema.ts`
  - `openclaw_runtime/src/config/schema.labels.ts`
  - `openclaw_runtime/src/config/schema.help.ts`
- Test paths touched:
  - `tests/unit/runtime-event-log-store.test.ts`
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts` (run through Git Bash for glob expansion)
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff`
  - `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control tests/unit/runtime-event-log*.test.ts`
- Required reading completed: yes

## Executive Summary

- Added a canonical `RuntimeTaskEvent` event-log envelope/record shape that wraps, rather than duplicates, the existing `RuntimeTaskEvent` contract.
- Added an in-process, library-only `RuntimeTaskEventLogStore` with append one/many, get by event id, batch get, filtered search, and stable export iterator primitives.
- Added idempotency-key dedupe and event-id duplicate isolation without rewriting append-only history.
- Added diagnostics for invalid event input, duplicate idempotency key, duplicate event id, store read/write failure, and schema marker mismatch.
- Added default-off helper/schema coverage for `runtime.eventLog.shadow`, `runtime.eventLog.persist`, `runtime.checkpointSerializer.shadow`, and `runtime.resume.replayShadow`.
- Did not implement or expose `runtime.resume.preferEventLog`; schema remains strict and rejects it.
- Did not wire TaskLoop, long-task checkpoints, renderer/Main transport, UI, services, listeners, ports, resume, or live event writes.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Canonical envelope wraps existing `RuntimeTaskEvent` | file | `openclaw_runtime/src/runtime-core/event-log.ts` | `RuntimeTaskEventLogEnvelope` lines 55-60; imports lines 1-12 | Envelope contains `event: RuntimeTaskEvent`; no duplicate event/checkpoint contract. |
| Append-only store/query primitives landed | file | `openclaw_runtime/src/runtime-core/event-log.ts` | `RuntimeTaskEventLogStore` lines 166-386 | Covers append, appendMany, getByEventId, batchGet, search, exportRecords. |
| Idempotency dedupe is isolated | file | `openclaw_runtime/src/runtime-core/event-log.ts` | lines 198-216 | Duplicate idempotency key returns existing record + diagnostic, no append. |
| Diagnostics include required failure classes | file | `openclaw_runtime/src/runtime-core/event-log.ts` | lines 35-40, 207, 254, 355, 645, 658 | Invalid event, duplicate idempotency key, write/read failure, schema marker mismatch. |
| Flags default off and are strict true-only | file | `openclaw_runtime/src/runtime-core/event-log.ts` | `RUNTIME_EVENT_LOG_FLAG_PATHS` lines 17-22; defaults lines 27-32; resolver lines 433-449 | No `runtime.resume.preferEventLog`. |
| Config schema accepts only requested flags | config | `openclaw_runtime/src/config/types.openclaw.ts`; `openclaw_runtime/src/config/zod-schema.ts` | types lines 111-127; schema lines 78-96 | Event log, checkpoint serializer, resume replay flags only. |
| Tests cover required lane behavior | test | `tests/unit/runtime-event-log-store.test.ts` | lines 52-282 | Append-only, idempotency, get/batch, filters, pagination, export, diagnostics, flags. |
| Focused tests passed | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts` | 2 files / 16 tests passed | Run through Git Bash for wildcard expansion. |
| TypeScript validation passed | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | exit 0 | Required typecheck. |
| Harness validation passed | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff` | pass | Spec structural validation. |
| No second runtime service introduced | missing-after-search | required `rtk rg` service/listener scan | no matches; `rg` exit 1 | No listener/server/port patterns in touched runtime/test paths. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/runtime-core/event-log.ts` defines:
  - `RUNTIME_TASK_EVENT_LOG_SCHEMA_MARKER` / version marker.
  - `RuntimeTaskEventLogEnvelope` and `RuntimeTaskEventLogRecord`.
  - `RuntimeTaskEventLogStore` with append-only in-process storage primitives.
  - `InMemoryRuntimeTaskEventLogStorage` for library-only shadow usage.
  - query/export result types and diagnostic types.
- `openclaw_runtime/src/runtime-core/index.ts` exports the event-log surface.

Tests:

- `tests/unit/runtime-event-log-store.test.ts` covers append-only immutability/order, idempotency, get/batch get, filtering, pagination-after-filtering, export order, invalid-event isolation, schema marker mismatch, store read/write failures, and default-off flags.

Feature flags:

- Added config types/schema/help/labels for:
  - `runtime.eventLog.shadow`
  - `runtime.eventLog.persist`
  - `runtime.checkpointSerializer.shadow`
  - `runtime.resume.replayShadow`
- `runtime.resume.preferEventLog` was intentionally not added and is rejected by strict schema.

Harness/spec changes:

- None.

## Event Log / Checkpoint / Resume Surface

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Event-log envelope | `RuntimeTaskEventLogEnvelope` wraps canonical `RuntimeTaskEvent` | pilot/library-only | `runtime.eventLog.shadow` | `event-log.ts` lines 55-60 |
| Event-log store | `RuntimeTaskEventLogStore` + in-memory storage | shadow-only, no live wiring | `runtime.eventLog.persist` only allows explicit store use | `event-log.ts` lines 141-386 |
| Query/export | `search`, `getByEventId`, `batchGet`, `exportRecords` | read-only library primitives | caller-controlled; no listener | `event-log.ts` lines 290-342 |
| Checkpoint serializer flag | config/helper only | no serializer implementation in lane A | `runtime.checkpointSerializer.shadow` | `types.openclaw.ts` lines 118-122; `event-log.ts` lines 440 |
| Resume replay flag | config/helper only | no resume implementation/cutover | `runtime.resume.replayShadow` | `types.openclaw.ts` lines 123-127; `event-log.ts` line 441 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop execution | Unchanged; no TaskLoop call sites touched or wired to event log. | Touched paths exclude `openclaw_runtime/src/agents/task-loop-controller.ts`; required service scan passed. | Future lane B must keep dual-write shadow gated. |
| `long_task_checkpoints` | Unchanged; no long-task checkpoint store behavior changed. | No edits under `openclaw_runtime/src/agents/long-task-control/**`. | Future serializer lane must compare only in shadow. |
| Renderer/Main transport | Unchanged; no renderer/Main routes or UI touched. | Implementation paths are runtime-core/config/tests only. | Future UI/transport work would need boundary/E2E coverage. |
| Resume behavior | Unchanged; no resume path or `preferEventLog` cutover implemented. | Strict schema rejects `runtime.resume.preferEventLog` in `runtime-event-log-store.test.ts`. | Future lane D owns resume shadow/idempotency proof. |

## Replay / Idempotency Audit

| Replay Focus | Result | Evidence | Gap |
|---|---|---|---|
| No side-effect tool re-execution | pass | Lane A adds no executor/resume hooks; store is library-only. | Full resume side-effect proof remains lane D. |
| Completed tool results reused by idempotency key | pass | `tests/unit/runtime-event-log-store.test.ts` duplicate idempotency test lines 79-97. | This lane dedupes event-log writes; resume reuse remains lane D. |
| Missing tool result returns waiting/verifying diagnostic | not-run | Out of lane A reducer/resume scope. | Lane C/D should add reducer/resume diagnostics. |
| Schema/version marker handled | pass | `tests/unit/runtime-event-log-store.test.ts` schema marker test lines 186-204. | Future serializer/reducer schemas need their own marker tests. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md` | pass | Required pre-implementation context/read order. | None. |
| Focused unit tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts` | pass, 2 files / 16 tests | Runtime contracts plus lane A event-log behavior. | None. |
| TypeScript | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Required node typecheck. | None. |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff` | pass | Phase-4 task spec validation. | `--no-diff` per required validation. |
| Service boundary scan | `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control tests/unit/runtime-event-log*.test.ts` | pass/no matches | No second runtime service, listener, or Gateway endpoint. | `rg` returns exit 1 for no matches. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No second runtime service | pass | Required service/listener `rg` scan returned no matches. |
| No renderer direct IPC | pass | No renderer/Main files touched. |
| No renderer direct Gateway HTTP/WS | pass | No renderer/Main files touched; required service scan found no Gateway endpoint strings in touched runtime/test paths. |
| Feature flags default safe | pass | `DEFAULT_RUNTIME_EVENT_LOG_FEATURE_FLAGS` all false; tests assert absent/string values are false. |
| Flag-off parity covered | pass | No live wiring exists; config flags are optional/default-off and tests assert strict true-only behavior. |
| Resume does not execute side effects | pass | No resume implementation added; only `runtime.resume.replayShadow` flag helper/schema exists. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Persist flag vs runtime storage policy | Lane A adds only in-process storage and a default-off `runtime.eventLog.persist` schema/helper. | Future persisted runtime state should choose the correct SQLite/state owner and remain append-only. | Keep this lane library-only; require a future lane/spec to design any persisted SQLite store explicitly. |
| Event-log record idempotency vs future resume reuse | Lane A dedupes writes by `idempotencyKey`; it does not replay or reuse tool results during resume. | Resume should reuse completed side-effect tool results by idempotency key without execution. | Lane D should consume these primitives and add side-effect suppression tests. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: lane-b-taskloop-event-log-dual-write
New code path: TaskLoop optional shadow writer integration to RuntimeTaskEventLogStore
Legacy path wrapped: TaskLoop lifecycle/checkpoint RuntimeTaskEvent shadows
Shadow / pilot boundary: event-log writes only when Phase-4 flags are explicitly true; no prompt/verifier/checkpoint authority changes
Feature flag: runtime.eventLog.shadow plus existing runtimeTaskEventLogShadow/runtimeCoreShadow gates
Tests: task-loop event-log shadow writer failure non-fatal; flag-off parity; no checkpoint authority change
Harness: phase-4-event-log-checkpoint-resume validate plus service boundary scan
Rollback: disable event-log shadow flags; remove writer dependency injection
Done when: TaskLoop can dual-write event-log shadows without changing final status, lifecycle payloads, self-check, or long_task_checkpoints
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Which SQLite owner should future persisted event logs use? | Runtime AGENTS storage policy discourages new JSON/sidecar runtime state. | maintainer | no |
| Should event-id duplicates remain a separate diagnostic from idempotency duplicates? | Current store isolates both, but future reducers may want one canonical duplicate taxonomy. | maintainer/agent | no |

## Handoff Notes

- This lane intentionally stops at append-only contracts/store/query and config flags.
- There is no live TaskLoop write path, reducer, checkpoint serializer, resume shadow, renderer/Main route, UI, service, listener, or port.
- `runtime.resume.preferEventLog` remains unimplemented; strict schema rejection is covered by unit test.
- Future persisted storage should not add JSON/JSONL sidecars; choose an approved SQLite/state owner before enabling real persistence.
