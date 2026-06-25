# lane-e-evidence-verifier-shadow: Warning-Only Evidence Verifier Shadow

## Scope Confirmation

- Lane: `lane-e-evidence-verifier-shadow`
- Output file: `runtime-research/handoffs/phase-2-openclaw-runtime-core-foundation/submissions/lane-e-evidence-verifier-shadow.md`
- Lane-owned file only: yes
- Files/directories searched: `openclaw_runtime/src/agents/task-loop-controller.ts`, `tests/unit/task-loop-controller.test.ts`, Phase-1 evidence verifier notes
- Commands run:
  - `rtk rg -n "evidenceVerifierShadow|evidenceVerifierReport|legacyDecisionUnaffected|buildTaskLoopEvidenceVerifierShadowReport|applyEvidenceGateToSelfCheck" openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts`
- Prior handoffs reviewed: Phase-1 synthesis, Phase-2 synthesis, Phase-2 README/template

## Executive Summary

- TaskLoop now has a warning-only evidence verifier shadow report behind `runtime.evidenceVerifier.shadow`.
- The report is explicitly typed as `mode: "warning"` and `legacyDecisionUnaffected: true`.
- The report records legacy gate status/reasons, files touched, tests run, worker count, evidence refs, and warning reasons.
- Flag-off behavior omits `evidenceVerifierReport`.
- Unit tests cover warning-only reports without changing complete or blocked legacy statuses.
- Existing active evidence gate behavior (`applyEvidenceGateToSelfCheck`) is not accepted as this lane's new behavior; it is treated as a legacy/adjacent gate.
- This lane does not implement a blocking standalone verifier or completion gate.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Evidence verifier shadow report type is warning-only. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `TaskLoopEvidenceVerifierShadowReport`, lines 172-180 | Includes `mode: "warning"` and `legacyDecisionUnaffected: true`. |
| Shadow report builder records legacy gate data and reasons. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `buildTaskLoopEvidenceVerifierShadowReport`, lines 1084-1171 | Builds warning/pass report from current evidence gate. |
| Evidence verifier shadow flag is checked per record. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `evidenceVerifierShadowEnabled`, lines 1174-1176 | Reads shadow flag from per-run flag map. |
| Evidence verifier shadow flag is captured from deps/config. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | lines 1652-1656 | `deps.evidenceVerifierShadow ?? cfg?.runtime?.evidenceVerifier?.shadow`. |
| Report is built only when shadow flag is enabled. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | lines 1745-1747 | Otherwise `undefined`. |
| Active evidence gate still influences self-check as legacy/adjacent behavior. | file | `openclaw_runtime/src/agents/task-loop-controller.ts` | `applyEvidenceGateToSelfCheck`, lines 912-934; call lines 1805-1808 | Not claimed as warning-only Phase-2 shadow. |
| Flag-off parity test omits evidence verifier report. | test | `tests/unit/task-loop-controller.test.ts` | lines 548-605 | Asserts result/lifecycle/checkpoint have no report when disabled. |
| Complete status remains complete with warning-only shadow report. | test | `tests/unit/task-loop-controller.test.ts` | lines 608-666 | Asserts `status: complete`, report warning, `legacyDecisionUnaffected: true`. |
| Blocked status remains blocked with warning-only shadow report. | test | `tests/unit/task-loop-controller.test.ts` | lines 1213-1256 | Asserts legacy blocked status remains blocked. |
| Focused runtime foundation run passed. | command | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts` | result: pass, 3 files / 52 tests | Includes evidence verifier shadow tests. |

## Current State

Current code:

- TaskLoop computes an evidence gate from worker evidence.
- A warning-only shadow report may be generated from that gate when `runtime.evidenceVerifier.shadow` is true.
- The report can be included in lifecycle/checkpoint/result metadata, but it is labeled as warning-only.

Current tests:

- `tests/unit/task-loop-controller.test.ts` covers flag-off omission, complete-with-warning, and blocked-with-warning cases.

Current harness specs:

- Dedicated `runtime-evidence-verifier-shadow` spec is still recommended before a standalone verifier/gate rollout.

Existing handoff notes:

- Phase 1 warned current TaskLoop/mission gates must not be treated as the target standalone Evidence Verifier.

## Shadow Contract Or Adapter Shape

| Surface | Contract / Adapter | Shadow Or Warning Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| TaskLoop evidence gate projection | Legacy gate -> warning-only `TaskLoopEvidenceVerifierShadowReport` | warning-only | `runtime.evidenceVerifier.shadow` or deps `evidenceVerifierShadow` | `task-loop-controller.ts:1084`-`:1176`, `:1745`-`:1747` |
| Lifecycle/checkpoint metadata | Optional report field | warning-only metadata | same | `task-loop-controller.ts:1439`, `:1355` |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop final complete status | Remains `complete` when legacy path completes. | `tests/unit/task-loop-controller.test.ts:636`-`:642`. | Active evidence gate still exists; must not be confused with this lane. |
| TaskLoop final blocked status | Remains `blocked` when legacy gate blocks. | `tests/unit/task-loop-controller.test.ts:1244`-`:1253`. | Future standalone verifier must define failed vs blocked taxonomy. |
| Flag-off report fields | No report added to result/lifecycle/checkpoint. | `tests/unit/task-loop-controller.test.ts:548`-`:605`. | Optional metadata must stay absent when flag false. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Evidence shadow tests | `tests/unit/task-loop-controller.test.ts` | pass in focused run | Flag-off, complete warning, blocked warning. | Not a standalone verifier. |
| Focused runtime foundation run | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/context-shadow-adapter.test.ts tests/unit/task-loop-controller.test.ts` | pass | Evidence shadow plus adjacent contracts/taskloop. | Does not prove code-edit completion gate semantics. |
| Dedicated verifier harness | future `runtime-evidence-verifier-shadow` | not-run | Would cover file/test/tool/trace verifier taxonomy. | Required before blocking verifier rollout. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Active evidence gate already affects TaskLoop self-check. | `applyEvidenceGateToSelfCheck` at `task-loop-controller.ts:912`-`:934`, call at `:1805`-`:1808`. | Phase 2 verifier lane must be warning-only. | Treat active gate as existing legacy/adjacent behavior; do not claim it as Phase-2 verifier cutover. |
| Blocked vs failed taxonomy remains legacy. | TaskLoop uses `blocked` for repeated repair/missing validation cases in tests. | Core spec says `blocked` should mean external dependency. | Shadow report should record target warnings only; taxonomy cutover needs separate spec. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Standalone evidence verifier shadow fixture
New code path: future openclaw_runtime/src/runtime-core verifier module or TaskLoop adapter module
Legacy path wrapped: TaskLoop evidence gate only as input
Shadow / warning boundary: warning-only report
Feature flag: runtime.evidenceVerifier.shadow
Tests: file/test/tool evidence refs and failed-vs-blocked taxonomy fixtures
Harness: add runtime-evidence-verifier-shadow task spec
Rollback: disable runtime.evidenceVerifier.shadow
Done when: verifier report is standalone, warning-only, and traceable to evidence refs without changing final status
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should TaskLoop active evidence gate be renamed as legacy gate? | Reduces confusion with target Evidence Verifier. | maintainer | no |
| When should missing tests block completion? | Phase 6 behavior change, not Phase 2. | maintainer | yes before verifier cutover |

## Handoff Notes

- This lane accepts only the warning-only evidence verifier report.
- It does not accept a blocking verifier, final completion gate, or failed/blocked taxonomy cutover.
- Any future verifier must consume normalized file/test/tool/trace evidence refs from runtime-core contracts.
