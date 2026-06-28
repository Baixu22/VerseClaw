# Controlled Runtime-Use Pilot Readiness

Status: accepted_controlled_pilot_ready

## Recommended Route

The next usable direction is a controlled two-line pilot package:

1. Registry first as a controlled diagnostic consumer base.
2. AST as explicit readonly candidate generation.
3. Both lines may proceed in parallel, but neither depends on, authorizes, gates, or default-enables the other.
4. Provider ordering cutover, AST apply, workspace edit, TaskLoop authority, Gateway/provider transport changes, and default-on/default cutover remain forbidden.

## Phase 0 Evidence Table

| Evidence | Current state | Source |
|---|---|---|
| Prerequisite status | `accepted_runtime_use_prerequisites_complete` | `runtime-research/handoffs/runtime-use-prerequisites.md` |
| Controlled runtime-use readiness | `accepted_controlled_runtime_use_readiness` | `runtime-research/handoffs/runtime-use-prerequisites.md` |
| AST synthesis | `Status: accepted` | `runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/synthesis.md` |
| Registry synthesis | `Status: accepted` | `runtime-research/handoffs/phase-3-provider-tool-registry-diagnostic-collector/synthesis.md` |
| Runtime index AST authority | readonly scan MVP only; next behavior requires fresh accepted spec | `runtime-research/agent-runtime-index.md` |
| Runtime index registry authority | diagnostics-only collector; no default registry cutover | `runtime-research/agent-runtime-index.md` |
| Boundary sentinel | controlled readiness boundary tests assert no AST mutation/apply/write export, no registry cutover helper, and no renderer bypass | `tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts` |

## Deliverables

- Independent AST pilot spec: `harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md`
- Independent Registry pilot spec: `harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md`
- Sample matrix: `sample-matrix.md`
- Quantitative scorecard: `scorecard.md`
- Hard veto gates: `veto-gates.md`
- Validation mechanism: `validation-plan.md`
- Boundary scan summary: `boundary-scan-summary.md`
- Final synthesis: `synthesis.md`

## README Sync

This package is internal docs/spec/test readiness work. It does not change user-visible behavior, UI, public settings, provider behavior, runtime transport, or default runtime flows. The multilingual README review must still be recorded in the final synthesis.
