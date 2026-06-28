# lane-a-contracts-and-flags: AST patch planner contracts, diagnostics, and default-off flags

## Scope Confirmation

- Lane: lane-a-contracts-and-flags
- Output file: runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-a-contracts-and-flags.md
- Lane-owned file only: yes
- Implementation paths touched: openclaw_runtime/src/runtime-core/ast-patch-planner.ts; openclaw_runtime/src/runtime-core/index.ts
- Test paths touched: tests/unit/runtime-ast-patch-planner-contracts.test.ts; tests/fixtures/ast-patch-planner/**
- Commands run: focused Vitest; typecheck; harness context; harness validate --no-diff
- Required reading completed: yes

## Executive Summary

- Added explicit runtime-core contracts for rules, target files, diagnostics, match evidence, preview diffs, and checkpoints.
- Added `resolveRuntimeAstPatchPlannerFlags` with `readonlyScan` and `previewDiff` defaulting false by omission.
- Added `scanAstPatchPlannerReadonly` as an explicit helper only; no automatic runtime invocation was added.
- Added authority metadata marking diagnostics-only, readonly, no project mutation, no symbol mutation, no TaskLoop invocation, no Gateway integration, no provider transport change, and preview-diff-only.
- Exported the helper from the runtime-core barrel for explicit callers.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Default-off flags are resolved from unknown config | file | openclaw_runtime/src/runtime-core/ast-patch-planner.ts | resolveRuntimeAstPatchPlannerFlags:258 | Only exact `true` enables each flag. |
| Explicit scan helper returns closed status/diagnostic shapes | file | openclaw_runtime/src/runtime-core/ast-patch-planner.ts | scanAstPatchPlannerReadonly:382 | Helper has no implicit caller. |
| Runtime-core barrel exposes the explicit helper | file | openclaw_runtime/src/runtime-core/index.ts | line 26 | Adds only `./ast-patch-planner.js`. |
| Default-off behavior is tested | test | tests/unit/runtime-ast-patch-planner-contracts.test.ts | describe:26 | Skipped result has no matches, no checkpoint, and no preview diff. |

## Planner Surface

| Surface | Contract / Helper | Readonly Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Flag resolution | `resolveRuntimeAstPatchPlannerFlags` | Reads config object only | `runtime.astPatchPlanner.readonlyScan`; `runtime.astPatchPlanner.previewDiff` | tests/unit/runtime-ast-patch-planner-contracts.test.ts |
| Readonly planning | `scanAstPatchPlannerReadonly` | In-memory scan and diagnostics only | `readonlyScan` required | openclaw_runtime/src/runtime-core/ast-patch-planner.ts |
| Preview diff | `AstPatchPlannerPreviewDiff` | Diagnostic text only | `previewDiff` required | tests/unit/runtime-ast-patch-planner-contracts.test.ts |

## Safety Audit

| Boundary | Result | Evidence |
|---|---|---|
| No patch execution or file write | pass | Safety scan returned `NO_MATCHES` on implementation/tests/fixtures. |
| No symbol mutation or project mutation | pass | Authority boundary and safety scan. |
| No TaskLoop/Gateway/Main/renderer integration | pass | Only runtime-core and tests touched for Lane A. |
| No service/background process | pass | Safety scan returned `NO_MATCHES`. |
| Invalid/overbroad/overlap/drift fails closed | pass | Covered by Lane B-D tests. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Contracts tests | `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-contracts.test.ts ...` | pass | Flags, disabled scan, preview flag split | None in lane scope |
| Typecheck | `pnpm --config.verify-deps-before-run=false run typecheck` | pass | Node/web TS contracts | None |
| Structural spec validate | `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md --no-diff` | pass | Spec structure | Full diff gate handled in Lane E |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Full diff-aware harness validation sees unrelated worktree changes | Lane E command evidence | Validate only phase-owned edits | Rerun in clean/isolated worktree before accepting synthesis. |

## Status

Status: accepted

## Recommended Next Slice

```text
Slice: AST planner accepted synthesis gate
New code path: none
Readonly boundary: unchanged
Feature flag: keep both flags default-off
Tests: rerun focused tests and typecheck
Harness: rerun full validate in a clean/isolated worktree
Rollback: remove explicit barrel export and helper file
Done when: full validation is not polluted by unrelated worktree changes
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should the MVP later split internals after acceptance? | The helper is intentionally single-surface but large. | maintainer | no |

## Handoff Notes

Keep all future callers explicit and local. No flag added in this phase can enable patch execution.

