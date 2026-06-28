# Phase 8 Parallel Lanes: AST Patch Planner Readonly Scan

All lanes may run in separate windows. Each lane must preserve default runtime behavior and must not introduce patch apply or workspace mutation.

## Lane A: Contracts And Flags

LANE_ID: `lane-a-contracts-and-flags`

LANE_TITLE: AST patch planner contracts, diagnostics, and default-off flags

LANE_SCOPE:

- Define minimal planner input/output contracts for rules, target files, match evidence, preview diffs, diagnostics, and checkpoint metadata.
- Add default-off flag resolution for readonly scan and preview diff only.
- Keep contracts under runtime-core and exported only for explicit callers.
- Do not add apply flags or live runtime invocation.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/**`
- `tests/unit/runtime-ast-patch-planner-contracts.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-a-contracts-and-flags.md
```

## Lane B: Rule Validation

LANE_ID: `lane-b-rule-validation`

LANE_TITLE: Pattern/fix rule validation and fail-closed diagnostics

LANE_SCOPE:

- Validate TypeScript/TSX rule shape and language selection.
- Reject invalid rules, unbound metavariables in fixes, unsupported transforms, and intentionally overbroad patterns.
- Return diagnostics only; do not scan or apply.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/**`
- `tests/unit/runtime-ast-patch-planner-rule-validation.test.ts`
- `tests/fixtures/ast-patch-planner/**`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-b-rule-validation.md
```

## Lane C: Readonly Scan And Preview Diff

LANE_ID: `lane-c-readonly-scan-preview-diff`

LANE_TITLE: Explicit target scan, match evidence, and preview diff generation

LANE_SCOPE:

- Run readonly scans over explicit TypeScript/TSX target files.
- Return ordered match evidence and bounded preview diffs.
- Cover fixable/unfixable rules and multi-file ordering.
- Do not write files, call formatters, or expose an apply path.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/**`
- `tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts`
- `tests/fixtures/ast-patch-planner/**`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-c-readonly-scan-preview-diff.md
```

## Lane D: Resume Drift And Conflict Diagnostics

LANE_ID: `lane-d-resume-drift-and-conflict-diagnostics`

LANE_TITLE: Match checkpoint, overlap conflict, and resume range drift diagnostics

LANE_SCOPE:

- Store rule hash, target files, match counts/ranges, preview diff hash, and source file hashes in explicit planner checkpoint data.
- Re-scan readonly inputs for resume diagnostics.
- Detect match count changes, range drift, file hash drift, and overlapping ranges.
- Return review-required diagnostics; do not continue to apply.

SUGGESTED_PATHS:

- `openclaw_runtime/src/runtime-core/**`
- `tests/unit/runtime-ast-patch-planner-resume-drift.test.ts`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-d-resume-drift-and-conflict-diagnostics.md
```

## Lane E: Validation Boundary Synthesis

LANE_ID: `lane-e-validation-boundary-synthesis`

LANE_TITLE: Harness, tests, boundary scans, docs, and synthesis readiness

LANE_SCOPE:

- Validate the task spec.
- Run focused AST planner tests and typecheck.
- Run scans proving no apply/write/service/renderer/Gateway path was added.
- Update `agent-runtime-index.md` only after synthesis accepts A-D.

SUGGESTED_PATHS:

- `harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md`
- `runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/**`
- `runtime-research/agent-runtime-index.md`

OUTPUT_FILE:

```text
runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-e-validation-boundary-synthesis.md
```
