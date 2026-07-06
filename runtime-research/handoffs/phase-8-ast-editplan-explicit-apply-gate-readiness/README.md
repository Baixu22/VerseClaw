# Phase 8 AST EditPlan Explicit Apply Gate Readiness

Status: accepted_phase_8_ast_editplan_explicit_apply_gate_readiness

## Scope

This phase implements the corrected AST route's fourth slice:

```text
Evidence Verifier readiness / EvidenceVerifierReport
  -> explicit apply gate readiness diagnostics
  -> later separate controlled explicit apply pilot
```

AST remains a structured code-edit planning layer. The new helper is only a readiness gate for a future explicit apply pilot.

## Implemented

- Runtime-core helper for building an `ApplyGateReadinessReport` from an existing `EditPlan` IR, phase 3 readiness report, `EvidenceVerifierReport`, current source/preview/match fingerprints, and explicit operator approval.
- Decision states: `blocked`, `review_required`, and `approved_for_explicit_apply`.
- Fail-closed diagnostics for invalid input, missing approval, failed/missing verifier report, plan/source/preview/range drift, conflict diagnostics, non-ready phase 3 report, authority drift, unsupported or over-budget operations, and missing verifier requirements.
- Deterministic fingerprints for match ranges and ordered operations.
- Bounded diagnostics/evidence refs/operation reporting.
- Focused unit coverage for approved path, missing approval, verifier failure, readiness pending, drift, conflict diagnostics, authority drift, bounded output, and invalid input.

## Boundary

The helper is pure, in-memory, deterministic, bounded, and explicit-call only. It does not execute lint, typecheck, tests, shell commands, diagnostics, workspace scans, verifier runtime behavior, or apply behavior.

It does not apply patches, write files, edit workspaces, mutate symbols, invoke runtime loops, integrate Gateway/Main/renderer/host-api/api-client, change provider transport or ordering, insert prompt/model messages, start services/listeners/daemons, add persistence/cache/database behavior, or enable default-on AST behavior.

`approved_for_explicit_apply` is still only a readiness result. It does not apply patches, does not prove task completion, and does not approve a controlled apply pilot by itself.

Preview diff metadata, match counts, candidate text, ast-grep results, EditPlan output, Evidence Verifier reports, and ApplyGateReadinessReport output remain planning diagnostics only and must not be treated as task-completion evidence.

## Validation

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-explicit-apply-gate-readiness.md`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-apply-gate-readiness.test.ts`

## Next Phase

Future work remains:

```text
explicit apply gate readiness
  -> controlled explicit apply pilot
```

Any patch apply, workspace edit, symbol mutation, TaskLoop/Gateway/Main/renderer/host-api/api-client integration, provider transport change, prompt/model-message insertion, persistence/cache/database behavior, service/listener/daemon behavior, active completion gate, or default-on behavior requires a fresh accepted task spec.
