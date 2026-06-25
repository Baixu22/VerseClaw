# lane-a-runtime-core-contracts: Runtime Core Contracts

## Scope Confirmation

- Lane: `lane-a-runtime-core-contracts`
- Output file: `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/lane-a-runtime-core-contracts.md`
- Lane-owned file only: yes
- Files/directories searched: `openclaw_runtime/src/runtime-core`, `tests/unit/runtime-core-contracts.test.ts`, `vitest.config.ts`, required runtime-research docs
- Commands run:
  - `rtk rg -n "RuntimeTaskEvent|ContextItem|ToolCallRequest|ToolCallResult|EvidenceRef|Checkpoint" openclaw_runtime/src/runtime-core tests/unit/runtime-core-contracts.test.ts`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts`
- Prior handoffs reviewed: `phase-1-runtime-surface-inventory/synthesis.md`, Phase-2 README/template, Phase-2 synthesis

## Executive Summary

- Canonical runtime-core contracts are implemented under `openclaw_runtime/src/runtime-core/**`.
- The lane adds contract definitions and validators only; it does not start a new runtime service.
- The surface includes `RuntimeTaskEvent`, `ContextItem`, `ToolCallRequest`, `ToolCallResult`, `EvidenceRef`, and `Checkpoint`.
- Runtime task status names align with `agent-runtime-core-spec.md` and keep an explicit legacy status map.
- Tool result statuses are canonical: `success | error | denied | cancelled`.
- Contract tests live under root `tests/unit`, so they are collected by the root Vitest include.
- This lane does not endorse MCP catalog, TaskLoop behavior, UI behavior, or durable event-log cutover.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Runtime-core exports are inside `openclaw_runtime`. | file | `openclaw_runtime/src/runtime-core/index.ts` | lines 1-3 | Exports `types`, `evidence`, and `events`. |
| Runtime task statuses are canonical and include state-machine statuses plus terminal statuses. | file | `openclaw_runtime/src/runtime-core/types.ts` | `RUNTIME_TASK_STATUSES`, lines 10-26 | Includes `created`, `planning`, `assembling_context`, `running`, waiting states, `completed`, `failed`, `blocked`, `cancelled`. |
| Legacy status mapping is explicit instead of redefining canonical status names. | file | `openclaw_runtime/src/runtime-core/types.ts` | `LEGACY_RUNTIME_TASK_STATUS_MAP`, lines 28-43 | Maps `complete/succeeded/error/timed_out` to canonical names. |
| `ContextItem` is importable from runtime-core. | file | `openclaw_runtime/src/runtime-core/types.ts` | `ContextItem`, lines 86-95 | Carries source/evidence refs and metadata. |
| `ToolCallRequest` and `ToolCallResult` are importable from runtime-core. | file | `openclaw_runtime/src/runtime-core/types.ts` | `ToolCallRequest`, lines 103-112; `ToolCallResult`, lines 137-146 | Matches Phase-2 contract needs. |
| Tool result status vocabulary is canonical. | file | `openclaw_runtime/src/runtime-core/types.ts` | `TOOL_CALL_RESULT_STATUSES`, line 114 | `success`, `error`, `denied`, `cancelled`. |
| `EvidenceRef` and `Checkpoint` are importable from runtime-core. | file | `openclaw_runtime/src/runtime-core/evidence.ts` | `EvidenceRef`, lines 33-39; `Checkpoint`, lines 41-50 | Checkpoint references canonical task state and tool results. |
| `RuntimeTaskEvent` is importable and payload-typed by kind. | file | `openclaw_runtime/src/runtime-core/events.ts` | `RuntimeTaskEvent`, lines 76-89 | Uses `RuntimeTaskEventPayloadByKind`. |
| Contract validators and JSON parse/serialize guards exist. | file | `openclaw_runtime/src/runtime-core/events.ts` | `isRuntimeTaskEvent`, `serializeRuntimeTaskEvent`, `parseRuntimeTaskEvent`, lines 195-213 | Rejects malformed event contracts. |
| Runtime-core contract tests cover vocabularies, shapes, serialization, and malformed values. | test | `tests/unit/runtime-core-contracts.test.ts` | lines 24-68, 70-104, 148-174 | Unit-level contract coverage. |
| Root Vitest collects runtime-core contract test file. | config | `vitest.config.ts` | line 109 | Includes `tests/unit/**/*.{test,spec}.{ts,tsx}`. |
| Focused contract/context/taskloop test run passed. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts` | result: pass, 3 files / 52 tests | Run during synthesis audit. |

## Current State

Current code:

- `openclaw_runtime/src/runtime-core/types.ts` defines JSON-safe runtime types, task status vocabulary, context items, tool calls, runtime errors, and validators.
- `openclaw_runtime/src/runtime-core/evidence.ts` defines evidence refs and checkpoints.
- `openclaw_runtime/src/runtime-core/events.ts` defines typed event payloads, validators, fixtures, and serialization helpers.
- `openclaw_runtime/src/runtime-core/index.ts` is the single runtime-core export surface.

Current tests:

- `tests/unit/runtime-core-contracts.test.ts` validates vocabularies, shapes, serialization, and malformed input rejection.

Current harness specs:

- `harness/specs/tasks/runtime-contract-layer-spike.md` exists and validates structurally with `--no-diff`.

Existing handoff notes:

- Phase 1 said these contracts were absent and should be the first Stage-1 slice.
- Phase 2 synthesis found the code now exists but lanes were missing; this file supersedes that missing-lane gap for lane A.

## Shadow Contract Or Adapter Shape

| Surface | Contract / Adapter | Shadow Or Warning Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Runtime task status | `RuntimeTaskStatus` plus `mapLegacyRuntimeTaskStatus` | contract-only | none | `types.ts:10`-`:43` |
| Runtime context | `ContextItem` | contract-only | none | `types.ts:86`-`:95` |
| Tool invocation | `ToolCallRequest` / `ToolCallResult` | contract-only | none | `types.ts:103`-`:146` |
| Evidence/checkpoint | `EvidenceRef` / `Checkpoint` | contract-only | none | `evidence.ts:33`-`:50` |
| Event stream | `RuntimeTaskEvent` | contract-only | none | `events.ts:76`-`:89` |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop status names | Existing TaskLoop may still use `complete/error` internally. | Runtime-core provides mapping only; no TaskLoop import is required by this lane. | Lane B must prove emitted shadows do not alter TaskLoop decisions. |
| Existing MCP result shapes | Existing MCP call results are not changed by contract definitions alone. | `openclaw_runtime/src/runtime-core/**` does not export host APIs or renderer APIs. | Lane C must prove adapter parity. |
| Context prompt assembly | Contracts do not add prompt text. | `ContextItem` is a type/validator only. | Lane D must prove shadow fields are side-channel only. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Runtime-core unit tests | `tests/unit/runtime-core-contracts.test.ts` | pass in focused run | Contract vocabulary, validators, fixtures, serialization. | Does not prove adapter behavior. |
| Focused runtime foundation run | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts` | pass | Contract plus adjacent context/taskloop shadows. | MCP not included in passing focused run. |
| Harness structure | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/runtime-contract-layer-spike.md --no-diff` | pass | Spec schema/structure. | `--no-diff` does not prove worktree scope. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Runtime-core contract location vs future shared consumption | Contracts are under `openclaw_runtime/src/runtime-core`. | Renderer must not bypass Main, but Main adapters need importable types. | Keep runtime-core contracts in `openclaw_runtime` for Phase 2; only expose via explicit adapters, not renderer direct calls. |
| Legacy status names still exist | `TaskLoopStatus` uses `complete/error` in `task-loop-controller.ts`. | Canonical RuntimeTaskEvent uses `completed/failed`. | Lane B must keep mapping explicit and tested. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Runtime-core contract consumption hardening
New code path: no new path; keep openclaw_runtime/src/runtime-core as canonical
Legacy path wrapped: none in this lane
Shadow / warning boundary: contract-only
Feature flag: none
Tests: tests/unit/runtime-core-contracts.test.ts
Harness: runtime-contract-layer-spike structural validation
Rollback: remove adapter imports while keeping contracts if consumers regress
Done when: all Phase-2 adapters import these contracts and no duplicate same-name contract is introduced elsewhere
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should a generated or shared package re-export runtime-core contracts for Main-only adapters? | Avoid fragile relative imports from `electron/services`. | maintainer | no |
| Should `RuntimeTaskStatus` include setup states? | Core spec separates setup state from task execution state. | maintainer | no |

## Handoff Notes

- This lane accepts only contract definitions and tests.
- It does not accept any active behavior changes, MCP catalog changes, or UI changes.
- Other lanes should import these contracts instead of defining local `ToolCallResult`, `ContextItem`, or `RuntimeTaskEvent` lookalikes.
