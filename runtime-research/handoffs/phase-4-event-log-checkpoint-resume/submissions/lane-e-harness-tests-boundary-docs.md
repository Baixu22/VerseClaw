# lane-e-harness-tests-boundary-docs: Phase 4 validation, boundary scan, docs readiness

## Scope Confirmation

- Lane: `lane-e-harness-tests-boundary-docs`
- Output file: `runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions/lane-e-harness-tests-boundary-docs.md`
- Lane-owned file only: yes
- Implementation paths touched: none
- Test paths touched: none
- Commands run:
  - `rtk --version` - fail, plain `rtk` is not available on PATH in this shell.
  - `C:\Users\27933\.cherrystudio\bin\rtk.exe --version` - pass, `rtk 0.30.1`; final closure reruns used this absolute path.
  - `node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md` - pass.
  - `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff` - pass.
  - `node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/runtime-state-reducer*.test.ts tests/unit/runtime-checkpoint-serializer*.test.ts tests/unit/runtime-resume-shadow*.test.ts tests/unit/task-loop-controller.test.ts` - pass, but PowerShell wildcard forwarding only exercised 2 files / 51 tests.
  - `node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-state-reducer.test.ts tests/unit/runtime-checkpoint-serializer.test.ts tests/unit/runtime-resume-shadow.test.ts tests/unit/task-loop-controller.test.ts tests/unit/task-loop-event-log-shadow.test.ts` - pass, 7 files / 84 tests.
  - `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` - pass.
  - `rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` - reviewed/pass; matches are existing rule/i18n/preload/Main/test/url-helper cases, not Phase 4 renderer bypasses.
  - `rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789' src/pages src/components --glob '!**/*.md'` - pass by no matches (`rg` exit 1).
  - `rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/tools/task-loop-tool.ts tests/unit` - reviewed/pass; matches are existing unrelated unit-test servers, MCP config test names, URL-helper tests, and project-rule fixtures.
  - `rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/tools/task-loop-tool.ts tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-state-reducer.test.ts tests/unit/runtime-checkpoint-serializer.test.ts tests/unit/runtime-resume-shadow.test.ts tests/unit/task-loop-controller.test.ts tests/unit/task-loop-event-log-shadow.test.ts` - pass by no matches (`rg` exit 1).
  - `rg -n 'runtime\.resume\.preferEventLog|preferEventLog|runtime\.resume\.replayShadow|runtime\.eventLog\.(shadow|persist)|runtime\.checkpointSerializer\.shadow' openclaw_runtime/src tests/unit runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions --glob '!**/*.md'` - reviewed/pass; `preferEventLog` appears only in the strict rejection test.
  - `rg -n 'verseshell-runtime|verseshell' openclaw_runtime/src tests/unit runtime-research/handoffs/phase-4-event-log-checkpoint-resume/submissions --glob '!**/*.md'` - reviewed/pass; matches remain existing exec-host/stdio terminal tool code and tests, not Phase 4 authority.
  - `rg -n 'writeFile|appendFile|unlink|rm\(|rename\(|mkdir|fetch\(|WebSocket|hostapi:fetch|gateway:httpProxy|ipcRenderer|window\.electron|sendMessage|applyPatch|execute|executor|callTool|child_process|spawn\(|exec\(' openclaw_runtime/src/runtime-core/resume-shadow.ts openclaw_runtime/src/runtime-core/state-reducer.ts openclaw_runtime/src/runtime-core/checkpoint-serializer.ts tests/unit/runtime-resume-shadow.test.ts tests/unit/runtime-state-reducer.test.ts tests/unit/runtime-checkpoint-serializer.test.ts` - reviewed/pass; matches are side-effect spy assertions and a fixture command string, not runtime side effects.
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-verification-auto-sampling.test.ts` - pass, 1 file / 4 tests; adjacent verification sampling remains observe-only, sanitized, and non-gating.
  - Submission structure/status audit via Node script over lane A-D files - pass; all required headings present and each file has exactly one `Status: accepted`.
  - `node scripts/comms/replay.mjs` - not-run; A-D did not touch Main/Gateway communication, runtime send/receive, delivery, or fallback paths.
  - `node scripts/comms/compare.mjs` - not-run; same reason.
  - Targeted Electron E2E - not-run; A-D did not touch renderer UI or user-visible resume/checkpoint behavior.
- Required reading completed: yes

## Executive Summary

- A-D submissions exist, follow the submission template headings, and each declares exactly one valid status: `accepted`.
- Independent validation supports synthesis readiness: harness context/validate passed, TypeScript passed, and the expanded Phase 4 unit slice passed with 7 files / 84 tests.
- The required Vitest wildcard command passed but only exercised 2 files in this PowerShell shell; I treated that as under-covered evidence and reran with explicit Phase 4 test paths, including Lane B's event-log dual-write tests.
- Boundary scans did not find new renderer direct IPC, renderer direct Gateway HTTP/WS, second runtime service, Temporal service, daemon, listener, HTTP server, WS server, or Gateway instance.
- `runtime.resume.preferEventLog` is not implemented or enabled; it appears only in a strict schema rejection test.
- Phase 4 flags remain default-off / shadow-only: `runtime.eventLog.shadow`, `runtime.eventLog.persist`, `runtime.checkpointSerializer.shadow`, and `runtime.resume.replayShadow`.
- Resume shadow evidence shows no tool callback/executor execution, no Gateway/Main transport calls, no file writes, no message sends, and no patch application.
- `verification-shadow-sampling.ts` was reviewed as an adjacent observe-only helper: it is default-off unless sampling options are passed, catches sink failures, and must not be treated as a Phase 5 completion gate.
- Comms replay/compare and Electron E2E were not applicable because A-D did not change Main/Gateway communication or user-visible UI behavior.
- README translation updates were reviewed as not required for this lane because Lane E is validation-only and A-D are internal default-off runtime-core/task-loop shadows.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Harness context and validation pass | command | `node harness/src/cli.mjs context --spec ...`; `node harness/src/cli.mjs validate --spec ... --no-diff` | exit 0 | Initial run used direct Node because plain `rtk` is unavailable on PATH; closure rerun used absolute `rtk.exe`. |
| Combined Phase 4 units pass with real A-D coverage | command | explicit 7-file Vitest command | 7 files / 84 tests passed | Covers runtime contracts, event log, reducer, serializer, resume shadow, TaskLoop, and dual-write tests. |
| Required wildcard unit command is insufficient in this shell | command | wildcard Vitest command | 2 files / 51 tests passed | Not accepted as full coverage; explicit rerun supplies the required evidence. |
| TypeScript validation passes | command | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | exit 0 | Required node typecheck. |
| A-D submission structure/status audit passes | command | Node script over `submissions/lane-[abcd]-*.md` | all required headings; statuses `["accepted"]` each | Confirms presence and exactly one valid status per lane. |
| Lane A event log is append-only, queryable, idempotent, and default-off | test | `tests/unit/runtime-event-log-store.test.ts` | tests lines 51-280 | Covers append order, idempotency key dedupe, search filters, pagination-after-filtering, export order, diagnostics, and strict `preferEventLog` rejection. |
| Lane B TaskLoop dual-write is gated and non-fatal | test | `tests/unit/task-loop-event-log-shadow.test.ts` | tests lines 100-296 | Covers both-gate requirement, writer failure swallowing, clean lifecycle objects, and clean checkpoint inputs. |
| Lane C reducer/serializer are deterministic and schema-aware | test | `tests/unit/runtime-state-reducer.test.ts`; `tests/unit/runtime-checkpoint-serializer.test.ts` | reducer tests lines 147-303; serializer tests lines 14-172 | Covers replay states, pending tool calls, diagnostics, checkpoint round-trip, version markers, and continue-as-new shape. |
| Lane D resume shadow does not execute side effects | test | `tests/unit/runtime-resume-shadow.test.ts` | tests lines 153-335 | Covers flag-off no-op, idempotency reuse, missing/ambiguous mutating result diagnostics, terminal comparisons, and legacy authority. |
| Renderer direct IPC and Gateway bypass absent in pages/components | missing-after-search | focused `rg` scan over `src/pages src/components` | no matches; `rg` exit 1 | This is the direct renderer boundary gate. |
| No second runtime service in Phase 4 paths | missing-after-search | narrow service/listener `rg` scan over Phase 4 runtime/test paths | no matches; `rg` exit 1 | Broad required scan had existing unrelated test false positives; narrow Phase 4 scan had none. |
| `verseshell-runtime` remains only the stdio terminal tool exception | command | `rg -n 'verseshell-runtime|verseshell' ...` | existing exec-host matches only | No Phase 4 event-log/checkpoint/resume authority points to verseshell. |
| Verification sampling is observe-only and non-gating | test | `tests/unit/runtime-verification-auto-sampling.test.ts`; `openclaw_runtime/src/runtime-core/verification-shadow-sampling.ts` | 1 file / 4 tests passed; implementation comments lines 109 and 134 | Adjacent helper remains default-off unless sampling options are passed, sanitized, sink-failure tolerant, and not a completion gate. |
| Comms replay/compare not required | handoff | A-D touched runtime-core/config/TaskLoop/tests/submissions only | not-run | No Main/Gateway communication path changed. |
| Electron E2E not required | handoff | A-D touched no renderer UI/user-visible flow | not-run | No UI-visible resume/checkpoint behavior changed. |

Allowed `Evidence Type` values used: `file`, `test`, `command`, `config`, `missing-after-search`, `handoff`.

## Implementation Summary

Current code:

- No runtime code was added or changed by Lane E.
- No tests were added or changed by Lane E.
- No README or `agent-runtime-index.md` updates were made by Lane E.

Validation/docs output:

- Added this validation-only submission file.
- Confirmed A-D are ready for synthesis review based on independent command, scan, and code/test evidence.

## Event Log / Checkpoint / Resume Surface

| Surface | Contract / Adapter | Shadow / Pilot Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Event-log contracts/store/query | `RuntimeTaskEventLogEnvelope`, `RuntimeTaskEventLogStore`, search/export/batch APIs | library/shadow only; no service | `runtime.eventLog.shadow`, `runtime.eventLog.persist` default off | `event-log.ts`; `runtime-event-log-store.test.ts` |
| TaskLoop event-log dual-write | Optional `runtimeTaskEventLogWriter` dependency receives cloned `RuntimeTaskEvent` shadows | requires existing TaskLoop shadow flag plus Phase 4 event-log flag; writer failures non-fatal | existing `runtimeTaskEventLogShadow` / `runtimeCoreShadow` plus `runtime.eventLog.shadow` or `runtime.eventLog.persist` | `task-loop-controller.ts`; `task-loop-event-log-shadow.test.ts` |
| State reducer | `replayRuntimeTaskEvents()` / `replayRuntimeTaskEventLogRecords()` | pure replay; no executor dependency | no live flag; library-only for Phase 4 | `state-reducer.ts`; `runtime-state-reducer.test.ts` |
| Checkpoint serializer | `serializeRuntimeCheckpoint()` / `deserializeRuntimeCheckpoint()` and continue-as-new marker shape | deterministic serializer; no legacy checkpoint authority change | `runtime.checkpointSerializer.shadow` default off for future wiring | `checkpoint-serializer.ts`; `runtime-checkpoint-serializer.test.ts` |
| Resume shadow | `runRuntimeResumeShadow()` diagnostics-only comparison and idempotency audit | legacy checkpoint/session remains authoritative; no side effects | `runtime.resume.replayShadow` default off | `resume-shadow.ts`; `runtime-resume-shadow.test.ts` |
| Verification shadow sampling | `verification-shadow-sampling.ts` observe-only sampling helper | non-gating diagnostics only; must not perturb runtime behavior | explicit sampling options only; default-off by tests | `runtime-verification-auto-sampling.test.ts`; `runtime-event-log-verification-shadow.md` |
| Event-log resume cutover | Not implemented | no default-on cutover | `runtime.resume.preferEventLog` rejected/not implemented | `runtime-event-log-store.test.ts` strict schema rejection |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop execution/status/checkpoints | Legacy outcomes and checkpoint payloads remain authoritative; event-log writer is injected, cloned, gated, and non-fatal. | 7-file unit pass; `task-loop-event-log-shadow.test.ts`; `task-loop-controller.test.ts`. | Future real store wiring must keep the same gates. |
| Long-task checkpoint store/task ledger | No Phase 4 lane made it event-log authoritative or rewrote history. | Narrow service scan; serializer/resume tests are library/helper-only. | Future persistence owner must satisfy runtime storage policy. |
| Renderer/Main transport | Renderer pages/components have no direct IPC or direct Gateway endpoint matches. | Focused boundary scan over `src/pages src/components` returned no matches. | None from A-D. |
| Resume behavior | Existing legacy checkpoint/session state remains authoritative; resume shadow is diagnostics-only. | `runtime-resume-shadow.test.ts` lines 314-348; no TaskLoop resume hook added by Lane D. | Future integration hook must stay flag-gated and side-effect-free. |
| Runtime history | Append-only behavior is tested; compaction/continue-as-new is represented as explicit marker shape, not history rewrite. | `runtime-event-log-store.test.ts`; `runtime-state-reducer.test.ts`; `runtime-checkpoint-serializer.test.ts`. | Future persisted store must preserve append-only semantics. |

## Replay / Idempotency Audit

| Replay Focus | Result | Evidence | Gap |
|---|---|---|---|
| No side-effect tool re-execution | pass | `tests/unit/runtime-resume-shadow.test.ts` asserts no tool, Gateway/Main, write, send, or patch spy calls. | None for Phase 4 shadow helper. |
| Completed tool results reused by idempotency key | pass | `resume-shadow.ts` idempotency audit; `runtime-resume-shadow.test.ts` lines 176-208. | Future live resume hook must consume this without adding executors. |
| Missing tool result returns waiting/verifying diagnostic | pass | `runtime-resume-shadow.test.ts` lines 210-245; status `waiting_verification`, diagnostic `missing_mutating_tool_result`. | None. |
| Ambiguous mutating tool result returns diagnostic | pass | `runtime-resume-shadow.test.ts` lines 247-285; diagnostic `ambiguous_mutating_tool_result`. | None. |
| Schema/version marker handled | pass | Event-log schema marker test, checkpoint serializer mismatch tests, reducer diagnostics tests. | Resume shadow has its own marker but no persisted resume artifact in Phase 4. |
| Continue-as-new / compaction does not rewrite history | pass | Reducer and serializer tests preserve explicit continue-as-new/compaction marker shape. | Future persisted compaction must emit markers, not mutate prior history. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| RTK availability | `rtk --version`; `C:\Users\27933\.cherrystudio\bin\rtk.exe --version` | plain PATH lookup failed; absolute rtk passed | Environment/tooling precheck. | Direct Node/rg equivalents were used initially; closure reruns used absolute `rtk.exe`. |
| Harness context | `node harness/src/cli.mjs context --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md` | pass | Required context/read order. | Initial run used direct Node; closure rerun used absolute `rtk.exe`. |
| Harness validate | `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff` | pass | Phase 4 task spec structural validation. | None. |
| Required wildcard unit command | `node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log*.test.ts tests/unit/runtime-state-reducer*.test.ts tests/unit/runtime-checkpoint-serializer*.test.ts tests/unit/runtime-resume-shadow*.test.ts tests/unit/task-loop-controller.test.ts` | pass but insufficient | Only 2 files / 51 tests ran in this shell. | Explicit rerun below covers omitted files. |
| Expanded combined unit slice | `node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-state-reducer.test.ts tests/unit/runtime-checkpoint-serializer.test.ts tests/unit/runtime-resume-shadow.test.ts tests/unit/task-loop-controller.test.ts tests/unit/task-loop-event-log-shadow.test.ts` | pass, 7 files / 84 tests | A-D runtime contracts, event log, dual-write, reducer, serializer, resume shadow, and legacy TaskLoop behavior. | None. |
| TypeScript | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Runtime/node typecheck. | None. |
| Broad renderer/Main boundary scan | `rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'` | reviewed/pass | Broad IPC/Gateway endpoint audit. | Existing matches are expected rule text, i18n, preload/Main bridge, E2E helpers, comments, and URL-helper tests. |
| Focused renderer page/component scan | `rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789' src/pages src/components --glob '!**/*.md'` | pass/no matches | Direct renderer bypass ban. | `rg` exit 1 is expected for no matches. |
| Required broad service scan | `rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|127\.0\.0\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/agents/tools/task-loop-tool.ts tests/unit` | reviewed/pass | Second runtime service scan. | Existing unrelated unit tests contain local test servers, MCP config method names, project-rule fixtures, and URL-helper strings. |
| Narrow Phase 4 service scan | same pattern over Phase 4 runtime paths plus 7 relevant test files | pass/no matches | Confirms A-D did not add service/listener/Gateway endpoint patterns. | `rg` exit 1 is expected for no matches. |
| Feature flag / cutover scan | `rg -n 'runtime\.resume\.preferEventLog|preferEventLog|runtime\.resume\.replayShadow|runtime\.eventLog\.(shadow|persist)|runtime\.checkpointSerializer\.shadow' ...` | reviewed/pass | Confirms `preferEventLog` is only a rejection test and Phase 4 flags are explicit/default-off. | None. |
| `verseshell-runtime` authority scan | `rg -n 'verseshell-runtime|verseshell' openclaw_runtime/src tests/unit ...` | reviewed/pass | Confirms verseshell remains existing exec-host/stdio terminal tool exception. | Existing matches are outside Phase 4 event-log/checkpoint/resume authority. |
| Resume/reducer side-effect scan | `rg -n 'writeFile|appendFile|...|exec\(' openclaw_runtime/src/runtime-core/resume-shadow.ts ...` | reviewed/pass | Static check for side-effect-looking APIs in replay/resume/serializer files. | Matches are side-effect spies and a fixture command string, not runtime calls. |
| Verification sampling check | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-verification-auto-sampling.test.ts` | pass, 1 file / 4 tests | Adjacent verification sampling default-off, sanitized, and sink-failure tolerant. | Not a Phase 5 completion-gate acceptance. |
| Submission structure/status audit | Node script over `submissions/lane-a-*.md` through `lane-d-*.md` | pass | Required headings and exactly one valid status per A-D submission. | None. |
| Comms replay | `node scripts/comms/replay.mjs` | not-run | Main/Gateway communication regression. | Not applicable: A-D did not touch Main/Gateway communication, delivery, or fallback paths. |
| Comms compare | `node scripts/comms/compare.mjs` | not-run | Main/Gateway communication baseline compare. | Not applicable for the same reason. |
| Targeted Electron E2E | `pnpm run test:e2e ...` | not-run | UI/user-visible resume/checkpoint behavior. | Not applicable: A-D did not touch renderer UI or user-visible behavior. |
| README docs sync review | `rg` over `README.md`, `README.zh-CN.md`, `README.ja-JP.md`, runtime research docs | reviewed/no update | Docs sync applicability. | No user-visible behavior/interface change from Lane E; A-D are internal default-off shadows. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No second runtime service | pass | Required broad service scan reviewed existing unrelated test false positives; narrow Phase 4 scan returned no matches. |
| No renderer direct IPC | pass | Focused page/component scan returned no matches; broad scan matches are existing preload/Main/test/rule-text paths. |
| No renderer direct Gateway HTTP/WS | pass | Focused page/component scan returned no matches; broad scan matches are existing URL helper tests, comments, Main allowlist, and rule text. |
| Feature flags default safe | pass | Event-log flag tests assert default false; resume shadow flag-off test does not read event-log or legacy state; `preferEventLog` is rejected. |
| Flag-off parity covered | pass | Combined unit slice includes event-log default-off, TaskLoop dual-write no-op, resume no-op, and existing TaskLoop tests. |
| Resume does not execute side effects | pass | Resume shadow tests assert no tool callback/executor, Gateway/Main transport, file write, message send, or patch spy is called. |
| Runtime event-log/checkpoint/reducer/resume code in allowed paths | pass | A-D implementation paths are `openclaw_runtime/**` plus existing config/runtime exports; no renderer ownership. |
| `verseshell-runtime` remains terminal exception | pass | Matches are existing exec-host code/tests only; no event-log/checkpoint/resume authority uses it. |
| No default-on event-log/resume cutover | pass | `runtime.resume.preferEventLog` is not implemented; `runtime.resume.replayShadow` is default-off diagnostics only. |
| Verification sampling non-gating | pass | `verification-shadow-sampling.ts` comments and `runtime-verification-auto-sampling.test.ts` prove observe-only/default-off sampling; this is not accepted as a Phase 5 completion gate. |
| UI changes without E2E | pass/not applicable | No A-D UI changes found or claimed; E2E not required. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| `rtk` unavailable in this validation shell | `rtk --version` fails; PATH contains Node and `rg`, not `rtk`. | Required commands prefer `rtk`. | Do not fail Phase 4 for a local shell proxy issue; record it and rely on direct Node/rg equivalents. |
| PowerShell wildcard forwarding under-covered the required Vitest command | Required wildcard unit command passed but ran only 2 files / 51 tests. | Combined validation must cover all A-D test files. | Use explicit file paths; 7 files / 84 tests passed. |
| Required broad service scan includes unrelated unit-test false positives | Broad scan matched existing local test servers, MCP config test names, project-rule fixtures, and Gateway URL helper tests. | Detect Phase 4 second-runtime violations. | Treat broad matches as reviewed false positives and use the narrow Phase 4 scan as the decisive lane evidence. |
| Future persistence owner remains undecided | Lane A adds in-memory/library event-log store and default-off persist flag; runtime AGENTS discourages JSON/sidecar state. | Future persisted event log should use an approved SQLite/state owner and keep append-only semantics. | Synthesis or a later lane should design the storage owner before enabling persistence. |
| Mutating tool classification is local to resume shadow | Lane D uses conservative metadata/tool-name classification. | Future registry manifests should own mutation policy. | Accept for shadow diagnostics; replace/extend when registry policy is available. |
| Verification shadow sampling is adjacent to Phase 4 but not a cutover gate | `verification-shadow-sampling.ts` is imported by event log and checkpoint serializer; its tests prove observe-only/default-off behavior. | Phase 5 must not treat sampling as completion-gate acceptance. | Document as non-gating evidence only; require a separate Phase 5 spec before any verifier gate behavior. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Phase 4 synthesis
New code path: none from lane E
Legacy path wrapped: none from lane E
Shadow / pilot boundary: synthesis should preserve A-D as default-off/shadow-only and legacy-authoritative
Feature flag: runtime.eventLog.shadow; runtime.eventLog.persist; runtime.checkpointSerializer.shadow; runtime.resume.replayShadow; keep runtime.resume.preferEventLog unavailable
Tests: reuse this lane's harness validate, expanded 7-file unit run, typecheck, boundary scans, and submission audit
Harness: no task-spec change required unless synthesis adds a new reusable rule
Rollback: disable Phase 4 flags; legacy TaskLoop/checkpoint/resume paths remain authoritative
Done when: synthesis owner independently classifies A-E and updates runtime-research/agent-runtime-index.md only if Phase 4 is accepted
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should future persisted event logs use the shared state DB, per-agent DB, or a dedicated SQLite schema? | Runtime storage policy rejects new sidecar state for runtime-owned persistence. | maintainer/synthesis owner | no |
| Should tool registry manifests become the authoritative source for mutating/read-only classification? | Resume idempotency would be stronger with owner-declared tool effects. | maintainer/synthesis owner | no |
| Should the harness add a Windows-safe explicit-file validation command for Phase 4 tests? | The wildcard command can under-cover tests in PowerShell. | maintainer/agent | no |

## Handoff Notes

- Lane E is validation evidence only; it does not declare final Phase 4 acceptance.
- The synthesis owner should make the final A-E decision and update `agent-runtime-index.md` only after accepting Phase 4.
- No runtime behavior, tests, README translations, or docs index files were changed by this lane.
- Comms replay/compare and Electron E2E are recorded as not-run because A-D did not change Main/Gateway communication or UI/user-visible resume/checkpoint behavior.
- Existing broad-scan false positives should remain documented so future reviewers do not mistake them for Phase 4 service or renderer-boundary violations.
