# lane-d-taskloop-shadow-diagnostics-bridge: Inject collected registry diagnostics into TaskLoop shadow metadata only

## Scope Confirmation

- Lane: lane-d-taskloop-shadow-diagnostics-bridge
- Output file: runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/submissions/lane-d-taskloop-shadow-diagnostics-bridge.md
- Lane-owned file only: yes
- Implementation paths touched: openclaw_runtime/src/agents/task-loop-controller.ts
- Test paths touched: tests/unit/task-loop-controller.test.ts
- Commands run: focused unit slice; typecheck
- Required reading completed: yes

## Executive Summary

- Updated TaskLoop registry diagnostic shadow gating to require `runtime.registryDiagnostics.collector`.
- Kept TaskLoop input as explicit injected `runtimeRegistryDiagnostics`; no discovery or authority path added.
- Preserved final status, self-check input, lifecycle payloads, checkpoint authority, and runtime checkpoint payloads.
- Added a negative test proving old surface flags alone do not attach registry diagnostics when collector flag is omitted.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Collector flag required for TaskLoop shadow attachment | file | openclaw_runtime/src/agents/task-loop-controller.ts | `runtimeRegistryDiagnosticShadowEnabled` | Returns false when collector flag omitted. |
| Legacy status unchanged | test | tests/unit/task-loop-controller.test.ts | registry shadow tests | Result remains complete. |
| Self-check/checkpoint authority unchanged | test | tests/unit/task-loop-controller.test.ts | registry shadow tests | No registry refs in self-check/checkpoint authority. |
| Collector omitted blocks diagnostics | test | tests/unit/task-loop-controller.test.ts | collector omitted test | No registryDiagnostics metadata. |

## Collector Surface

| Surface | Contract / Adapter | Shadow Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| TaskLoop shadow bridge | `TaskLoopControllerDeps.runtimeRegistryDiagnostics` | RuntimeTaskEvent shadow metadata/evidence only | `runtime.registryDiagnostics.collector` plus existing surface flags | task-loop-controller tests |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop final status | Unchanged | registry shadow tests | Low |
| Self-check context | No registry refs | assertions in registry shadow test | Low |
| Checkpoint authority | No registry refs in persisted checkpoint authority | assertions in registry shadow test | Low |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| TaskLoop focused tests | focused unit slice | pass | Shadow bridge and collector gate | None |
| Typecheck | pnpm --config.verify-deps-before-run=false run typecheck | pass | TaskLoop type surface | None |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No provider ordering/default registration cutover | pass | No provider code path added |
| No tool response/approval semantic drift | pass | TaskLoop only consumes injected diagnostics |
| No TaskLoop authority drift | pass | Tests assert final/self-check/checkpoint unchanged |
| No renderer direct IPC/Gateway bypass | pass | No renderer files touched |
| No second runtime service/listener | pass | No service added |
| Comms replay/compare handled if required | not-run | TaskLoop lane alone does not touch Main comms |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| TaskLoop still does not collect real B/C diagnostics itself | Existing seam is explicit injection | TaskLoop must not become registry authority | Keep injection-only bridge |

## Status

Status: accepted

## Recommended Next Slice

```text
Slice: task-run scoped diagnostic sink wiring
New code path: explicit caller-owned collector output
Legacy path wrapped: no live TaskLoop path
Shadow boundary: RuntimeTaskEvent shadow metadata only
Feature flag: runtime.registryDiagnostics.collector
Tests: task-loop-controller
Harness: clean-diff validate
Rollback: omit collector flag or injected diagnostics
Done when: caller can pass collector output without TaskLoop discovery
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should TaskLoop accept collector output directly instead of raw diagnostics? | Could make the bounded contract harder to bypass | maintainer | no |

## Handoff Notes

TaskLoop remains a consumer of explicit diagnostics only. It does not call context/tool registries, collect diagnostics, alter prompts, alter model messages, or change final decision authority.
