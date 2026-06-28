# Phase 8 AST Patch Planner Readonly Scan Synthesis

Status: accepted

## Decision

Accepted for the Phase 8 readonly scan MVP. Lanes A-E provide implementation, tests, validation, and boundary evidence for an explicit runtime-core AST Patch Planner surface that validates TypeScript/TSX pattern/fix rules, scans explicit in-memory target files, returns ordered match evidence, emits bounded diagnostics, produces preview diff text/hash only when explicitly enabled, and records checkpoint/drift metadata.

## Current Boundary

The AST Patch Planner is accepted only as a readonly planning slice: contracts, rule validation, explicit target scanning, preview diffs, and drift/conflict diagnostics.

No patch apply, workspace edit, symbol mutation, TaskLoop invocation, Gateway/Main/renderer route, provider transport, model-message insertion, default-on behavior, or verifier completion authority is accepted by this package.

## Validation Results

Accepted lane submissions:

- `submissions/lane-a-contracts-and-flags.md`: accepted. Default-off `readonlyScan` and `previewDiff` flag resolution plus explicit runtime-core contracts and authority metadata.
- `submissions/lane-b-rule-validation.md`: accepted. Rule validation covers shape, TypeScript/TSX language, metavariable binding, constraints, unsupported transforms/rewriters, overbroad patterns, and bounded diagnostics.
- `submissions/lane-c-readonly-scan-preview-diff.md`: accepted. Readonly scan covers explicit target files, ordered match evidence, unfixable match-only rules, multi-file preview diff ordering, TSX snippets, and invalid target inputs.
- `submissions/lane-d-resume-drift-and-conflict-diagnostics.md`: accepted. Checkpoint and resume diagnostics cover rule hash, target/source hash, match count/range, preview diff hash drift, and overlapping ranges.
- `submissions/lane-e-validation-boundary-synthesis.md`: accepted. Focused tests pass (4 files, 16 tests), typecheck passes, structural harness validation passes, comms replay/compare pass with dependency verification disabled, safety scans return `NO_MATCHES`, and a disposable Phase 8-only validation clone passes the exact diff-aware harness validate command.

Validation caveat: the shared worktree contains unrelated changed files outside Phase 8 owned paths, so in-place full diff-aware harness validation remains noisy. Acceptance relies on the isolated Phase 8-only validation clone documented in Lane E, which avoids reverting or staging unrelated user work.

## Accepted Code And Tests

- `openclaw_runtime/src/runtime-core/ast-patch-planner.ts`
- `openclaw_runtime/src/runtime-core/index.ts`
- `tests/unit/runtime-ast-patch-planner-contracts.test.ts`
- `tests/unit/runtime-ast-patch-planner-rule-validation.test.ts`
- `tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts`
- `tests/unit/runtime-ast-patch-planner-resume-drift.test.ts`
- `tests/fixtures/ast-patch-planner/**`

## Rejected Authority

This synthesis rejects patch apply, file writes, workspace edits, symbol rename/body mutation, insert/delete operations, TaskLoop/Gateway/Main/renderer/host-api/api-client integration, provider transport or ordering changes, prompt/model-message insertion, services/listeners/daemons, persistence, default-on behavior, and treating preview diffs as task-completion evidence.
