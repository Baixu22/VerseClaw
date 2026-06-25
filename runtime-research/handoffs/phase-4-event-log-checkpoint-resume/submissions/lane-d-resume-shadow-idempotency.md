# lane-d-resume-shadow-idempotency: Resume shadow comparison and side-effect idempotency guard

## Scope Confirmation

- Lane: `lane-d-resume-shadow-idempotency`
- Output file: `runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-d-resume-shadow-idempotency.md`
- Lane-owned file only: yes
- Implementation paths touched:
  - `openclaw_runtime/src/runtime-core/resume-shadow.ts`
  - `openclaw_runtime/src/runtime-core/index.ts`
- Test paths touched:
  - `tests/unit/runtime-resume-shadow.test.ts`
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-resume-shadow.test.ts`
  - Git Bash expansion: `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/runtime-state-reducer*.test.ts tests/unit/runtime-checkpoint-serializer*.test.ts tests/unit/runtime-resume-shadow*.test.ts`
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff`
  - `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'`
  - Git Bash expansion: `rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/tools/task-loop-tool.ts tests/unit/runtime-resume-shadow*.test.ts`
- Required reading completed: yes

## Executive Summary

- Added a default-off `runRuntimeResumeShadow()` helper that only runs when `runtime.resume.replayShadow === true`.
- The helper consumes Lane A event-log records or injected event-log reader output, rebuilds state with Lane C replay reducer, and compares against injected legacy checkpoint/session state.
- Legacy checkpoint/session state stays explicitly authoritative in the result (`legacyAuthoritative: true`); replay comparison emits diagnostics only.
- Added side-effect idempotency audit that indexes mutating tool history by `idempotencyKey`, reuses completed result metadata/evidence, and never invokes executors.
- Missing mutating tool results return `waiting_verification` with `missing_mutating_tool_result` diagnostics instead of marking replay as completed.
- Ambiguous mutating tool histories or missing idempotency keys return `ambiguous_mutating_tool_result` diagnostics instead of selecting a side effect.
- Added tests with spies proving resume shadow does not execute tools, call Gateway/Main transport, write files, send messages, or apply patches.
- Did not implement or enable `runtime.resume.preferEventLog`; no TaskLoop hook, UI, renderer IPC/Gateway call, service, listener, or runtime behavior cutover was added.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Resume shadow helper is default-off and gated by `runtime.resume.replayShadow` | file | `openclaw_runtime/src/runtime-core/resume-shadow.ts` | `runRuntimeResumeShadow` lines 106-147 | Returns disabled result before reading event-log/legacy state when flag is off. |
| Event-log records replay through Lane C reducer | file | `openclaw_runtime/src/runtime-core/resume-shadow.ts` | lines 116-124 | Calls `replayRuntimeTaskEventLogRecords()` over Lane A records/reader output. |
| Legacy state remains authoritative | file | `openclaw_runtime/src/runtime-core/resume-shadow.ts` | result type lines 79-90; returns lines 137-147 | Result always includes `legacyAuthoritative: true`; comparison is diagnostic-only. |
| Completed mutating tool result metadata/evidence is reused by idempotency key | file | `openclaw_runtime/src/runtime-core/resume-shadow.ts` | `auditIdempotentToolResults` lines 226-335 | Reuse entries contain completed `ToolCallResult` clone and evidence refs; no executor dependency exists. |
| Missing/ambiguous mutating tool result diagnostics are modeled | file | `openclaw_runtime/src/runtime-core/resume-shadow.ts` | lines 235-287, 300-315 | Missing result returns waiting verification; ambiguous history/missing key returns ambiguous diagnostics. |
| Mutating tool classifier is pure and local | file | `openclaw_runtime/src/runtime-core/resume-shadow.ts` | `isMutatingToolRequest` lines 354-371 | Uses request metadata/tool name only; no tool callbacks or transport calls. |
| Replay-vs-legacy comparison covers completed/blocked/failed states and checkpoint fields | file | `openclaw_runtime/src/runtime-core/resume-shadow.ts` | `compareReplayWithLegacyState` lines 373-428 | Compares task id, status, obligations, tool refs, and file hashes. |
| Runtime-core exports the helper | file | `openclaw_runtime/src/runtime-core/index.ts` | line 7 | Adds `export * from "./resume-shadow.js"`. |
| Flag-off no-op covered | test | `tests/unit/runtime-resume-shadow.test.ts` | lines 153-174 | Reader spies are not called. |
| Completed side-effect tool not repeated | test | `tests/unit/runtime-resume-shadow.test.ts` | lines 176-208 | Tool, Gateway/Main, write, send, and patch spies are not called. |
| Missing mutating result returns waiting/verifying diagnostic | test | `tests/unit/runtime-resume-shadow.test.ts` | lines 210-245 | Result status is `waiting_verification`, not completed. |
| Ambiguous mutating result is diagnosed | test | `tests/unit/runtime-resume-shadow.test.ts` | lines 247-285 | Duplicate idempotency key history returns ambiguous diagnostic. |
| Completed/blocked/failed comparison covered | test | `tests/unit/runtime-resume-shadow.test.ts` | lines 287-312 | Table-driven terminal state parity. |
| Legacy checkpoint remains authoritative on mismatch | test | `tests/unit/runtime-resume-shadow.test.ts` | lines 314-348 | Replay completed vs legacy failed produces mismatch while keeping `legacyAuthoritative: true`. |
| Focused required unit slice passed | command | Git Bash expanded required Vitest command | 5 files / 34 tests passed | Runtime contracts, Lane A, Lane C, and Lane D tests. |
| TypeScript validation passed | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | exit 0 | Required node typecheck. |
| Harness validation passed | command | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff` | pass | Spec structural validation. |
| No second runtime service introduced | missing-after-search | required service/listener `rtk rg` scan | no matches; `rg` exit 1 | Scanned runtime-core, long-task-control, TaskLoop, task-loop tool, and resume-shadow tests. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/runtime-core/resume-shadow.ts`
  - Defines schema markers and structured diagnostic codes for resume shadow.
  - Exposes `runRuntimeResumeShadow()` as the single entry point.
  - Accepts fixture inputs (`eventLogRecords`, `legacyState`) or injected reader functions (`eventLogReader`, `legacyStateReader`).
  - Resolves Lane A's `runtime.resume.replayShadow` flag and returns a no-op disabled result when the flag is absent or not exactly `true`.
  - Replays Lane A records using Lane C's `replayRuntimeTaskEventLogRecords()`.
  - Compares replay state with legacy checkpoint/session status, obligations, tool result refs, and file hashes.
  - Audits mutating tool requests by `idempotencyKey`, reusing completed result metadata/evidence without any executor hook.
- `openclaw_runtime/src/runtime-core/index.ts`
  - Exports the resume shadow surface.

Tests:

- `tests/unit/runtime-resume-shadow.test.ts`
  - Covers flag-off no-op, completed side-effect tool reuse without side-effect spies being called, missing result waiting verification, ambiguous idempotency history, completed/blocked/failed comparison, and legacy checkpoint authority on mismatch.

Feature flags:

- Uses Lane A's default-off `runtime.resume.replayShadow` resolver.
- Does not add or accept `runtime.resume.preferEventLog`.

Harness/spec changes:

- None.

## Event Log / Checkpoint / Resume Surface

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Resume shadow helper | `runRuntimeResumeShadow()` over Lane A records/readers and legacy state/readers | diagnostics-only; no resume authority | `runtime.resume.replayShadow` | `resume-shadow.ts` lines 106-147 |
| Replay source | `replayRuntimeTaskEventLogRecords()` | pure replay only, no tool/file/Gateway execution | `runtime.resume.replayShadow` | `resume-shadow.ts` lines 116-124 |
| Legacy comparison | `RuntimeResumeShadowLegacyState` | legacy checkpoint/session remains authoritative | `runtime.resume.replayShadow` | `resume-shadow.ts` lines 79-90, 373-428 |
| Idempotency guard | `RuntimeResumeShadowToolReuse` by `idempotencyKey` | metadata/evidence reuse only; no executor seam | `runtime.resume.replayShadow` | `resume-shadow.ts` lines 226-335 |
| Missing/ambiguous mutating tool state | structured diagnostics | waiting/verifying diagnostic, not completion | `runtime.resume.replayShadow` | `resume-shadow.ts` lines 235-315 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| Legacy resume/checkpoint authority | Existing latest checkpoint/session state remains authoritative; replay comparison is diagnostic-only. | `legacyAuthoritative: true` in `RuntimeResumeShadowResult`; legacy mismatch test lines 314-348. | Low; no live resume hook added. |
| TaskLoop execution | Unchanged; no TaskLoop code touched in this lane. | Implementation paths are runtime-core only; service scan includes TaskLoop and passes/no matches. | Future hook must remain flag-gated if added. |
| Long-task checkpoint store | Unchanged; helper accepts fixture/injected legacy state and does not read/write SQLite. | No edits under `openclaw_runtime/src/agents/long-task-control/**`; no fs/db imports in helper. | Future store wiring must stay read-only and shadow-only. |
| Tool execution / patch / messaging | Unchanged; helper has no executor, transport, patch, send, or file-write dependency. | Spy test lines 176-208; side-effect/service scans. | Low; do not add executor hooks in future replay. |
| Renderer/Main transport/UI | Unchanged; no renderer/Main/UI paths touched. | Broad boundary scan reviewed existing unrelated matches only. | Any future UI-visible resume change needs E2E. |

## Replay / Idempotency Audit

| Replay Focus | Result | Evidence | Gap |
|---|---|---|---|
| No side-effect tool re-execution | pass | `tests/unit/runtime-resume-shadow.test.ts` lines 176-208; helper has no executor dependency. | None for shadow helper. |
| Completed tool results reused by idempotency key | pass | `resume-shadow.ts` lines 258-335; test lines 176-208. | Future real resume hook must consume this result without executing tools. |
| Missing tool result returns waiting/verifying diagnostic | pass | `resume-shadow.ts` lines 300-315; test lines 210-245. | None. |
| Ambiguous mutating tool result returns diagnostic | pass | `resume-shadow.ts` lines 235-287; test lines 247-285. | None. |
| Schema/version marker handled | pass-by-dependency | Required Lane A/Lane C tests passed in combined unit slice. | Resume shadow adds schema marker but no serialized persistence. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md` | pass | Required pre-implementation context/read order. | None. |
| Focused Lane D tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-resume-shadow.test.ts` | pass, 1 file / 8 tests | Resume shadow/idempotency behavior. | None. |
| Required unit slice | Git Bash expanded required Vitest command | pass, 5 files / 34 tests | Runtime contracts, Lane A event log, Lane C reducer/serializer, Lane D resume shadow. | None. |
| TypeScript | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node/runtime typecheck. | None. |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff` | pass | Phase-4 task spec validation. | `--no-diff` per required validation. |
| Renderer/Main boundary scan | `rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | reviewed/pass | No new renderer direct IPC/Gateway bypass from this lane. | Existing unrelated matches are tests, preload/Main, i18n/rule text/comment/url-helper cases. |
| Service boundary scan | Git Bash expanded required service/listener/Gateway scan | pass/no matches (`rg` exit 1) | No second runtime service/listener/Gateway endpoint in lane paths. | None. |
| Comms replay | `pnpm run comms:replay` / `scripts/comms/replay.mjs` | not-run | Main/Gateway communication regression. | Not applicable: lane touched only runtime-core/test paths, no Main/Gateway communication path. |
| Comms compare | `pnpm run comms:compare` / `scripts/comms/compare.mjs` | not-run | Main/Gateway communication regression. | Not applicable: lane touched only runtime-core/test paths, no Main/Gateway communication path. |
| README docs sync | Manual scope review | not-run | User-visible docs. | Not required: default-off internal runtime-core helper only; no user-visible flow/interface changed. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No second runtime service | pass | Required service/listener scan returned no matches (`rg` exit 1). |
| No renderer direct IPC | pass | No renderer/Main files touched; broad scan matches are existing unrelated test/preload/rule text paths. |
| No renderer direct Gateway HTTP/WS | pass | No renderer/Main files touched; broad scan matches are existing unrelated tests/comments/Main URL helpers. |
| Feature flags default safe | pass | `runRuntimeResumeShadow()` returns disabled no-op unless `runtime.resume.replayShadow === true`. |
| Flag-off parity covered | pass | Flag-off no-op test verifies event-log and legacy readers are not called. |
| Resume does not execute side effects | pass | Spy test proves no tool/Gateway/Main/write/send/patch function calls; helper has no side-effect imports. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Mutating tool classification is conservative | Helper treats explicit non-read `permissionContext.mode/effect` and known mutating tool names as mutating. | Future registry policy should provide a first-class side-effect classification. | Keep current classifier local to shadow diagnostics; replace/extend it when registry manifests expose mutation policy. |
| Resume shadow has injected readers, not live store wiring | Lane D can read fixture inputs or injected readers but does not call long-task SQLite/store APIs directly. | Real resume comparison should eventually read the accepted event-log/checkpoint stores. | Add a future optional TaskLoop/long-task-control hook only after synthesis accepts the read-only owner boundary. |
| Completed result reuse indexes by request idempotency key and result call id | `ToolCallResult` currently lacks its own `idempotencyKey`, so helper joins result by `callId` from the matching request. | Future canonical tool result may carry idempotency key directly. | Keep request/result join for Phase 4; consider adding result-side idempotency in a later contract revision. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: phase-4 synthesis / optional read-only integration hook
New code path: optional TaskLoop or long-task-control resume-shadow diagnostic hook consuming accepted event-log and checkpoint stores
Legacy path wrapped: legacy latest checkpoint/session state comparison only
Shadow / pilot boundary: diagnostics-only; no resume cutover and no tool/file/model execution
Feature flag: runtime.resume.replayShadow
Tests: hook flag-off no-op; reader failure non-fatal; legacy checkpoint remains authoritative; no side-effect spies called
Harness: phase-4 validate plus required boundary scans
Rollback: disable runtime.resume.replayShadow or remove the injected hook; legacy resume remains authoritative
Done when: real TaskLoop-written event logs can be compared against legacy checkpoints without mutating state or changing runtime behavior
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should mutating/read-only policy come from tool registry manifests? | Current classifier is intentionally conservative and local; registry policy would be more authoritative. | maintainer/synthesis owner | no |
| Should `ToolCallResult` grow an optional `idempotencyKey`? | It would remove the need to join completed results through matching requests during resume replay. | maintainer/synthesis owner | no |
| Which owner should wire real event-log/checkpoint readers into resume shadow? | Runtime storage policy requires a clear SQLite/store owner and no sidecar fallback. | maintainer/synthesis owner | no |

## Handoff Notes

- This lane intentionally stops at a pure runtime-core helper plus tests.
- No TaskLoop hook, long-task checkpoint store read/write, renderer/Main route, UI, service, listener, Gateway call, tool executor, message send, file write, or patch application was added.
- `runtime.resume.preferEventLog` remains unimplemented; legacy checkpoint/session state is still authoritative.
- The workspace already had extensive unrelated uncommitted/untracked changes before this lane; this submission only claims `resume-shadow.ts`, the runtime-core export, the new resume-shadow unit test, and this lane submission file.
