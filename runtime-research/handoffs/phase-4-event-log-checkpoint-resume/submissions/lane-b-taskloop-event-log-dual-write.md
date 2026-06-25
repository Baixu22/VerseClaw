# lane-b-taskloop-event-log-dual-write: TaskLoop emits append-only RuntimeTaskEvent log shadows

## Scope Confirmation

- Lane: `lane-b-taskloop-event-log-dual-write`
- Output file: `runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-b-taskloop-event-log-dual-write.md`
- Lane-owned file only: yes
- Implementation paths touched:
  - `openclaw_runtime/src/agents/task-loop-controller.ts`
- Test paths touched:
  - `tests/unit/task-loop-event-log-shadow.test.ts`
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/task-loop-event-log-shadow.test.ts`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/task-loop-controller.test.ts tests/unit/task-loop-event-log*.test.ts` (direct argv run did not expand globs; only `runtime-core-contracts` and `task-loop-controller` ran)
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/task-loop-controller.test.ts tests/unit/task-loop-event-log*.test.ts` through Git Bash for glob expansion
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff`
  - `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'`
  - `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/long-task-control tests/unit/task-loop-controller.test.ts tests/unit/task-loop-event-log*.test.ts` through Git Bash for glob expansion
- Required reading completed: yes

## Executive Summary

- Added an optional `runtimeTaskEventLogWriter` TaskLoop dependency typed against Lane A's RuntimeTaskEvent log append options/result API.
- Dual-write is gated by both existing TaskLoop RuntimeTaskEvent shadow enablement (`runtimeTaskEventLogShadow` or `runtimeCoreShadow`) and explicit Phase-4 event-log flags (`runtime.eventLog.shadow` or `runtime.eventLog.persist`).
- Lifecycle/checkpoint RuntimeTaskEvent shadows are built once, still emitted to the existing shadow sink, and then cloned before event-log writer append so writer mutation/failure cannot affect legacy objects.
- Writer failures, including sync throw and async rejection, are swallowed as shadow-only diagnostics and do not alter TaskLoop completion/block/error outcomes.
- Legacy lifecycle callback payloads and persisted checkpoint inputs are not given event-log metadata or event-log-only fields.
- Phase-3 registry diagnostics remain only in RuntimeTaskEvent shadow metadata/evidence; they are not added to legacy lifecycle records, self-check context, or checkpoint authority.
- No reducer, resume, renderer/Main IPC, Gateway calls, UI, service, listener, or event-log authority cutover was added.
- Comms replay/compare was not run because this lane touched only TaskLoop runtime/test paths, not Main/Gateway communication paths.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Optional Lane A append hook added | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `TaskLoopRuntimeTaskEventLogWriter` lines 91-95; dep line 291 | Hook uses `RuntimeTaskEventLogAppendOptions` / `RuntimeTaskEventLogAppendResult`. |
| Dual-write requires both TaskLoop shadow and Phase-4 event-log flags | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `runtimeEventLogDualWriteEnabled` lines 1351-1356; flags loaded lines 1833-1840 | Uses existing shadow flags plus `eventLogShadow || eventLogPersist`. |
| Writer failures are non-fatal | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `emitRuntimeTaskEventLogShadow` lines 1373-1388 | Sync exceptions and async rejections are swallowed. |
| Writer receives a clone, not the lifecycle/checkpoint object | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | lines 1380-1392 | `cloneRuntimeTaskEvent` isolates writer-side mutation from shadow event construction. |
| Flag-off no event-log writes covered | test | `tests/unit/task-loop-event-log-shadow.test.ts` | test lines 100-130 | Covers TaskLoop shadow-on/Phase4-off and Phase4-on/TaskLoop-shadow-off. |
| Flag-on lifecycle/checkpoint writes covered | test | `tests/unit/task-loop-event-log-shadow.test.ts` | test lines 132-172 | Uses `RuntimeTaskEventLogStore` and asserts lifecycle + checkpoint event kinds. |
| Writer failure preserves outcomes | test | `tests/unit/task-loop-event-log-shadow.test.ts` | test lines 174-230 | Covers complete, blocked, and error outcomes with throwing writer. |
| Legacy lifecycle object has no event-log metadata | test | `tests/unit/task-loop-event-log-shadow.test.ts` | test lines 232-259 | Asserts no `runtimeTaskEvent`, `runtimeTaskEventLog`, or `eventLog` text. |
| Persisted checkpoint input has no event-log-only fields | test | `tests/unit/task-loop-event-log-shadow.test.ts` | test lines 261-296 | Asserts checkpoint shape and absence of `eventLog`/`runtimeTaskEvent`. |
| Required unit slice passed | command | Git Bash: `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/task-loop-controller.test.ts tests/unit/task-loop-event-log*.test.ts` | 4 files / 66 tests passed | Includes Lane A store tests and new Lane B tests. |
| TypeScript passed | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | exit 0 | Required node typecheck. |
| Harness validation passed | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff` | pass | Spec structural validation. |
| No second runtime service introduced | missing-after-search | Git Bash service/listener `rtk rg` over lane paths | no matches; `rg` exit 1 | No listener/server/port/Gateway endpoint patterns in touched lane paths. |
| Renderer/Main boundary unchanged | command | broad IPC/Gateway `rtk rg` scan | reviewed/pass | Matches are existing preload/Main/tests/i18n/rule-text/comment cases, not new lane changes. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/agents/task-loop-controller.ts` imports Lane A event-log flag resolution and append API types from `runtime-core`.
- `TaskLoopControllerDeps.runtimeTaskEventLogWriter` is an optional hook accepting a canonical `RuntimeTaskEvent` plus Lane A append options.
- Runtime event-log flags are resolved once per TaskLoop run and stored beside existing RuntimeTaskEvent shadow/registry flags.
- `emitRuntimeTaskEventShadow` still preserves existing shadow sink behavior, then invokes `emitRuntimeTaskEventLogShadow` only when both gate families are on.
- The event-log writer receives a JSON clone of the canonical RuntimeTaskEvent shadow; legacy `TaskLoopLifecycleEvent` and `RuntimeResumeCheckpoint` objects are not decorated with event-log metadata.

Tests:

- `tests/unit/task-loop-event-log-shadow.test.ts` covers flag-off no-op, flag-on append, writer failure non-fatal behavior for complete/blocked/error outcomes, lifecycle object cleanliness, and checkpoint input cleanliness.
- Existing `tests/unit/task-loop-controller.test.ts` remains passing and continues to cover Phase-2/Phase-3 shadow behavior and registry diagnostic boundaries.

Feature flags:

- Existing TaskLoop gates: `agents.defaults.taskLoop.runtimeTaskEventLogShadow` / `agents.defaults.taskLoop.runtimeCoreShadow` and dep overrides.
- Phase-4 gates: `runtime.eventLog.shadow` or `runtime.eventLog.persist` via Lane A's `resolveRuntimeEventLogFeatureFlags`.
- No default writer/store is created; callers must explicitly inject `runtimeTaskEventLogWriter`.

Harness/spec changes:

- None.

## Event Log / Checkpoint / Resume Surface

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| TaskLoop event-log writer hook | `TaskLoopRuntimeTaskEventLogWriter` wrapping Lane A append API types | shadow-only, dependency-injected | existing TaskLoop shadow flag plus `runtime.eventLog.shadow` or `runtime.eventLog.persist` | `task-loop-controller.ts` lines 91-95, 291, 1351-1388 |
| Lifecycle RuntimeTaskEvent dual-write | Existing `emitTaskLoopLifecycleShadow` output forwarded as cloned event | shadow-only; legacy lifecycle callback unchanged | same dual gate | `task-loop-controller.ts` lines 1358-1388; tests lines 132-172, 232-259 |
| Checkpoint RuntimeTaskEvent dual-write | Existing `emitTaskLoopCheckpointShadow` output forwarded as cloned event | shadow-only; persisted checkpoint input unchanged | same dual gate | `task-loop-controller.ts` lines 1373-1392; tests lines 132-172, 261-296 |
| State reducer | Not implemented | out of lane | none | explicit non-goal |
| Resume/prefer event log | Not implemented | no resume behavior or side effects | none | explicit non-goal |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop status/result | Complete, blocked, and error outcomes remain controlled by legacy TaskLoop logic. | `tests/unit/task-loop-event-log-shadow.test.ts` lines 174-230; required unit slice passed. | Low; writer hook is optional and swallowed. |
| Lifecycle callback | Receives legacy `TaskLoopLifecycleEvent` without event-log fields. | `tests/unit/task-loop-event-log-shadow.test.ts` lines 232-259. | Low; writer sees cloned RuntimeTaskEvent after lifecycle event construction. |
| Persisted checkpoint input | Existing `recordCheckpoint` input remains authoritative and does not include event-log-only fields. | `tests/unit/task-loop-event-log-shadow.test.ts` lines 261-296. | Low; checkpoint RuntimeTaskEvent is emitted separately after checkpoint input is built. |
| Self-check decisions | Event-log output is not fed into self-check context or decisions. | Existing `task-loop-controller.test.ts` registry/self-check tests passed in required unit slice. | Low; lane adds no prompt/context/verifier path. |
| Phase-3 registry diagnostics | Remain RuntimeTaskEvent shadow metadata/evidence only. | Existing `task-loop-controller.test.ts` registry diagnostics assertions passed in required unit slice. | Low; lane forwards existing shadows only. |

## Replay / Idempotency Audit

| Replay Focus | Result | Evidence | Gap |
|---|---|---|---|
| No side-effect tool re-execution | pass | Lane B adds no resume/replay executor and no tool invocation path; service scan no matches. | Full resume side-effect proof remains Lane D. |
| Completed tool results reused by idempotency key | not-run | Out of Lane B scope; this lane only forwards TaskLoop RuntimeTaskEvent shadows to writer. | Lane D owns resume idempotency reuse. |
| Missing tool result returns waiting/verifying diagnostic | not-run | Out of Lane B reducer/resume scope. | Lane C/D should add reducer/resume diagnostics. |
| Schema/version marker handled | pass-by-dependency | Lane A `runtime-event-log-store` tests passed in required unit slice. | Lane B adds no schema marker. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md` | pass | Required read-order/context before implementation. | None. |
| Focused Lane B tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/task-loop-event-log-shadow.test.ts` | pass, 1 file / 5 tests | Flag gating, writer append, writer failure, lifecycle/checkpoint cleanliness. | None. |
| Required unit slice | Git Bash: `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/task-loop-controller.test.ts tests/unit/task-loop-event-log*.test.ts` | pass, 4 files / 66 tests | Runtime core, Lane A store, existing TaskLoop shadows, Lane B dual-write. | Direct argv run did not expand globs, so Git Bash rerun is the accepted evidence. |
| TypeScript | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node/runtime typecheck. | None. |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff` | pass | Phase-4 task spec validation. | `--no-diff` per required validation. |
| Renderer/Main boundary scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | reviewed/pass | No new renderer direct IPC/Gateway bypass from this lane. | Existing unrelated matches remain in preload/Main/tests/i18n/rule text/comment paths. |
| Lane service scan | Git Bash: `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/long-task-control tests/unit/task-loop-controller.test.ts tests/unit/task-loop-event-log*.test.ts` | pass/no matches (`rg` exit 1) | No second runtime service/listener/Gateway endpoint in lane paths. | None. |
| Comms replay | `pnpm run comms:replay` / `scripts/comms/replay.mjs` | not-run | Main/Gateway communication regression. | Not applicable: lane touched only TaskLoop runtime/test paths, no Main/Gateway communication paths. |
| Comms compare | `pnpm run comms:compare` / `scripts/comms/compare.mjs` | not-run | Main/Gateway communication regression. | Not applicable: lane touched only TaskLoop runtime/test paths, no Main/Gateway communication paths. |
| README docs sync | Manual review of change scope | not-run | User-visible docs. | Not required: no UI, CLI, user-visible flow, or architecture default changed; shadow-only injected test seam. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No second runtime service | pass | Lane service scan returned no matches (`rg` exit 1). |
| No renderer direct IPC | pass | No renderer/Main files touched; broad scan matches are existing preload/tests/rule text, not lane changes. |
| No renderer direct Gateway HTTP/WS | pass | No renderer/Main files touched; broad scan matches are existing Main/tests/rule text/comment paths. |
| Feature flags default safe | pass | `runtimeEventLogDualWriteEnabled` requires existing TaskLoop shadow plus explicit Phase-4 event-log flags; no default writer. |
| Flag-off parity covered | pass | `tests/unit/task-loop-event-log-shadow.test.ts` lines 100-130. |
| Resume does not execute side effects | pass | No resume/replay implementation or tool execution path added. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| `runtime.eventLog.shadow` vs `runtime.eventLog.persist` as dual-write gate | Lane A exposes both flags; this lane accepts either explicit flag but still requires existing TaskLoop shadow enablement and injected writer. | Shadow-only event-log writes remain reversible and never become authority. | Keep both accepted as explicit Phase-4 event-log opt-in until synthesis decides stricter persist-vs-shadow semantics. |
| Default writer/store ownership | This lane adds only an injected writer and creates no default storage. | Future live persistence must choose the correct runtime state owner and avoid a second service. | Defer any default writer wiring/persistence owner to a future accepted lane/synthesis decision. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: lane-c-state-reducer-checkpoint-serializer or lane-d-resume-shadow-idempotency
New code path: pure reducer/serializer or resume shadow reader over Lane A event-log records
Legacy path wrapped: long-task checkpoints and TaskLoop session state comparison only
Shadow / pilot boundary: no resume cutover; replay must not execute tools or mutate files
Feature flag: runtime.checkpointSerializer.shadow or runtime.resume.replayShadow
Tests: reducer state fixtures; checkpoint parity; side-effect suppression/idempotency fixtures
Harness: phase-4 validate plus service/boundary scans
Rollback: disable Phase-4 flags; legacy checkpoints/session state remain authoritative
Done when: replay/serializer/resume comparisons are deterministic, non-mutating, and parity-tested
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should future TaskLoop production wiring require `runtime.eventLog.persist` specifically, or is `runtime.eventLog.shadow` sufficient for an injected in-memory writer? | Lane B currently treats either as explicit Phase-4 opt-in while keeping TaskLoop shadow flags required. | synthesis owner/maintainer | no |
| Where should a default persisted writer live if Phase 4 later enables persistence? | Runtime AGENTS storage policy requires choosing an approved state owner and avoiding JSON/sidecars. | maintainer | no |

## Handoff Notes

- The workspace had substantial unrelated uncommitted changes before this lane; this submission only claims the lane-b TaskLoop hook and new task-loop event-log test file.
- The event-log writer is dependency-injected only; no global store, service, listener, renderer route, Gateway call, or resume reader was added.
- The dual-write forwards the same canonical RuntimeTaskEvent shadows produced by Phase 2/3 and does not promote registry diagnostics, event-log metadata, or checkpoint shadows into legacy authority.
- Comms replay/compare intentionally remain not-run because no Main/Gateway communication path was touched.
