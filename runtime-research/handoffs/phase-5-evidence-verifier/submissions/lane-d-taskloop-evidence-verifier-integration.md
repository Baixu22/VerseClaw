# lane-d-taskloop-evidence-verifier-integration: TaskLoop Evidence Verifier Shadow Integration

## Scope Confirmation

- Lane: `taskloop-evidence-verifier-integration`
- Output file: `runtime-research/handoffs/phase-5-evidence-verifier/submissions/lane-d-taskloop-evidence-verifier-integration.md`
- Implementation paths touched:
  - `openclaw_runtime/src/agents/task-loop-controller.ts`
- Test paths touched:
  - `tests/unit/task-loop-controller.test.ts`
- Config schema touched: no. The integration reuses existing default-off `runtime.evidenceVerifier.shadow`.
- Required command routing: used `C:\Users\27933\.cherrystudio\bin\rtk.exe` because plain `rtk` is not available on PATH.

## Summary

TaskLoop now embeds the standalone runtime-core Evidence Verifier report inside the existing warning-only TaskLoop evidence verifier shadow report when `runtime.evidenceVerifier.shadow` is enabled.

Legacy TaskLoop decisions remain authoritative:

- Flag off: no `evidenceVerifierReport` is attached to result, lifecycle, or checkpoint metadata.
- Flag on: the report is warning-only and carries `legacyDecisionUnaffected: true`.
- Complete, blocked, repair, and error statuses are not changed by the standalone verifier decision.
- No new default-on verifier gate, renderer IPC/Gateway bypass, second service, external command execution, or LLM judge was added.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Existing TaskLoop shadow report now carries the standalone verifier report. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `TaskLoopEvidenceVerifierShadowReport` lines 189-203 | Adds nested `verifierReport: EvidenceVerifierReport`; top-level report remains `mode: "warning"`. |
| TaskLoop subagent outcomes are projected as sanitized tool-style verifier results. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `verifierToolResultForSubagent` lines 1242-1284 | Successful subagents become `success`; permission becomes `denied`; failure/timeout/unverifiable become `error`. |
| Standalone verifier input is built from TaskLoop evidence gate and self-check data. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `standaloneVerifierReportForTaskLoop` lines 1286-1337 | Uses files touched, tests run, evidence refs, subagent tool results, self-check missing evidence/gaps, and a TaskLoop state summary. |
| Existing shadow report builder embeds the standalone report without enforcing it. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `buildTaskLoopEvidenceVerifierShadowReport` lines 1339-1432 | Top-level status is warning if legacy reasons or standalone findings exist; legacy status/reasons remain recorded. |
| Shadow report is attached only behind the existing flag. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | assignments lines 2070-2072 and 2140-2142 | Reuses `evidenceVerifierShadowEnabled(record)` from existing `runtime.evidenceVerifier.shadow` wiring. |
| Iteration snapshots clone the nested standalone report. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | snapshot clone lines 1802-1808 | Prevents live mutation of findings/evidence refs in iteration history. |
| Flag-off parity is covered. | test | `tests/unit/task-loop-controller.test.ts` | test line 588 | Asserts no result/lifecycle/checkpoint verifier report with shadow off. |
| Complete flow emits warning-only verifier report without changing status. | test | `tests/unit/task-loop-controller.test.ts` | test line 655 | Result remains `complete`; nested standalone decision reports missing test evidence as `insufficient_evidence`. |
| Missing file evidence produces standalone insufficient evidence warning. | test | `tests/unit/task-loop-controller.test.ts` | test line 728 | Result remains `complete`; nested findings contain `missing_file_evidence`. |
| Full file/test/subagent evidence can complete in the standalone verifier. | test | `tests/unit/task-loop-controller.test.ts` | test line 765 | Nested `verifierReport.decision` is `completed` while legacy status remains complete. |
| Tool/subagent failures map to standalone failed taxonomy while legacy remains blocked. | test | `tests/unit/task-loop-controller.test.ts` | matrix line 1469 | Permission maps to `tool_result_denied`; worker failure/timeout/unverifiable map to `tool_result_error`; `result.status` remains `blocked`. |
| Repair legacy status is unchanged with shadow enabled. | test | `tests/unit/task-loop-controller.test.ts` | test line 1525 | Legacy evidence gate remains `repair`; final status remains `blocked`; nested verifier reports `failed`. |
| Error legacy status is unchanged when failure happens before evidence collection. | test | `tests/unit/task-loop-controller.test.ts` | test line 1567 | Result remains `error`; no invented verifier report is attached before evidence exists. |
| Mission completion behavior did not change. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mission-control-loop.test.ts tests/unit/mission-reviewer.test.ts` | pass: 2 files / 10 tests | Mission controller/reviewer completion semantics remained green. |

## Validation

| Check | Command | Result |
|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-5-evidence-verifier.md` | pass |
| TaskLoop focused tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts` | pass: 1 file / 47 tests |
| Runtime evidence verifier contract/collector tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts` | pass: 2 files / 16 tests |
| Mission no-change tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/mission-control-loop.test.ts tests/unit/mission-reviewer.test.ts` | pass: 2 files / 10 tests |
| Node typecheck | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| Full security shadow verifier script | `rtk node scripts/verify-security-shadow-mvp.mjs` | pass: harness context/validate for three shadow specs, focused security shadow tests, Gateway tools.invoke regression, node/web typecheck, comms replay/compare |
| Renderer IPC/Gateway bypass scan | `rtk rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components` | pass: no matches |
| Second runtime service scan | `rtk rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|GatewayManager|Temporal|@temporalio|express\\(" openclaw_runtime/src/agents/task-loop-controller.ts openclaw_runtime/src/runtime-core/evidence-verifier.ts openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts tests/unit/task-loop-controller.test.ts` | pass: no matches |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on verifier gate | pass | Existing `runtime.evidenceVerifier.shadow` is required before assigning `record.evidenceVerifierReport`; no enforcement flag was added. |
| Warning-only TaskLoop integration | pass | `TaskLoopEvidenceVerifierShadowReport.mode` remains `"warning"` and carries `legacyDecisionUnaffected: true`. |
| Flag-off legacy behavior preserved | pass | Flag-off test asserts no report on result/lifecycle/checkpoint metadata. |
| Existing TaskLoop statuses unchanged | pass | Tests cover complete, blocked, repair-to-blocked, and pre-evidence error flows. |
| `blocked` taxonomy remains external-only in standalone verifier | pass | TaskLoop subagent/tool failures are projected as `tool_result_error` / `tool_result_denied`, so standalone decision is `failed`, not `blocked`. |
| No external validation execution inside runtime behavior | pass | Integration only calls deterministic collector/evaluator helpers over supplied TaskLoop summaries. |
| No raw prompt/full payload persistence | pass | Adapter passes file/test refs, subagent status summaries, evidence refs, and self-check gap strings only. |
| No mission completion behavior change | pass | Mission controller/reviewer tests passed; no mission code was touched. |

## Status

```text
Status: accepted
```

## Handoff Notes

- This lane accepts the TaskLoop integration only as warning-only shadow evidence.
- The nested standalone report is available at `evidenceVerifierReport.verifierReport` in result, lifecycle, snapshot, and checkpoint metadata when the flag is enabled.
- Future enforcement still requires a separate default-off pilot flag/spec and must prove legacy flag-off behavior unchanged.
