# Phase 8 AST EditPlan Evidence Verifier Readiness Bridge

Status: accepted_phase_8_ast_editplan_evidence_verifier_readiness_bridge

## Scope

This phase implements the corrected AST route's third slice:

```text
EditPlan candidate plan
  -> Evidence Verifier readiness diagnostics / bounded verifier input bridge
  -> non-authoritative report
```

AST remains a structured code-edit planning layer. Evidence Verifier remains non-gating in this phase.

## Implemented

- Runtime-core helper for converting an existing `EditPlan` IR into readiness diagnostics and optional bounded `EvidenceVerifierInput`.
- Explicit mapping for `source_hashes_present`, `match_ranges_present`, `ordered_operations_present`, `no_conflict_diagnostics`, `preview_diff_available`, and `evidence_verifier_review`.
- Fail-closed readiness for invalid input, missing source hashes, conflict diagnostics, and fingerprint/source/preview drift.
- Pending/review-required readiness for missing preview diff or pending Evidence Verifier review.
- Deterministic ordering, bounded diagnostics/evidence refs/operations, and explicit non-completion-evidence markers.

## Boundary

The bridge is pure, in-memory, deterministic, bounded, and explicit-call only. It does not execute lint, typecheck, tests, shell commands, diagnostics, workspace scans, or verifier runtime behavior.

It does not apply patches, write files, edit workspaces, mutate symbols, invoke TaskLoop, integrate Gateway/Main/renderer/host-api/api-client, change provider transport or ordering, insert prompt/model messages, start services/listeners/daemons, add persistence/cache/database behavior, or enable default-on AST behavior.

`eligible_after_verification` remains descriptive. It does not mean patches may apply, and it does not mean the task is complete. Readonly candidate text, preview diff metadata, match counts, ast-grep results, EditPlan output, verifier-readiness input, and readiness reports are planning diagnostics only and are not task-completion evidence.

## Validation

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-evidence-verifier-readiness.md`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-evidence-verifier-readiness.test.ts tests/unit/runtime-ast-edit-plan-foundation.test.ts tests/unit/runtime-ast-grep-edit-plan-adapter.test.ts tests/unit/runtime-evidence-verifier-contracts.test.ts tests/unit/runtime-evidence-verifier-collectors.test.ts`

## Next Phase

Future work remains:

```text
Evidence Verifier -> explicit apply gate
```

Any patch apply, workspace edit, symbol mutation, TaskLoop/Gateway/Main/renderer/host-api/api-client integration, provider transport change, prompt/model-message insertion, persistence/cache/database behavior, service/listener/daemon behavior, active completion gate, or default-on behavior requires a fresh accepted task spec.
