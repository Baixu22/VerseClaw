# lane-d-resume-drift-and-conflict-diagnostics: Match checkpoint, overlap conflict, and resume range drift diagnostics

## Scope Confirmation

- Lane: lane-d-resume-drift-and-conflict-diagnostics
- Output file: runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-d-resume-drift-and-conflict-diagnostics.md
- Lane-owned file only: yes
- Implementation paths touched: openclaw_runtime/src/runtime-core/ast-patch-planner.ts
- Test paths touched: tests/unit/runtime-ast-patch-planner-resume-drift.test.ts; tests/fixtures/ast-patch-planner/nested-overlap.ts
- Commands run: focused Vitest; typecheck; boundary scans
- Required reading completed: yes

## Executive Summary

- Added checkpoint metadata for rule hash, target files, source hashes, match count/ranges, replacement hashes, and preview diff hash.
- Added `checkAstPatchPlannerResumeDrift` to rerun the readonly scan and compare checkpoint evidence.
- Rule hash drift, target file drift, source hash drift, match count drift, range drift, and preview diff hash drift return review-required diagnostics.
- Nested overlapping match ranges return review-required diagnostics and no preview diff.
- Identical duplicate AST ranges are deduplicated before overlap checks; true nested overlaps still fail closed.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Checkpoint stores resume evidence | file | openclaw_runtime/src/runtime-core/ast-patch-planner.ts | scanAstPatchPlannerReadonly:382 | Checkpoint is emitted for scan results with match evidence. |
| Resume drift check compares checkpoint metadata | file | openclaw_runtime/src/runtime-core/ast-patch-planner.ts | checkAstPatchPlannerResumeDrift:553 | Returns stable/review_required/invalid. |
| Overlap conflicts fail closed | test | tests/unit/runtime-ast-patch-planner-resume-drift.test.ts | describe:25 | Nested fixture returns review-required and no preview diff. |
| Drift diagnostics are covered | test | tests/unit/runtime-ast-patch-planner-resume-drift.test.ts | describe:25 | Covers stable, rule hash, target file, source hash, match count/range, preview diff hash drift, and overlap conflict. |

## Planner Surface

| Surface | Contract / Helper | Readonly Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Checkpoint | `AstPatchPlannerCheckpoint` | Hash/range metadata only | produced by scan | openclaw_runtime/src/runtime-core/ast-patch-planner.ts |
| Resume drift | `checkAstPatchPlannerResumeDrift` | Reruns readonly scan; diagnostics only | scan flags still apply | tests/unit/runtime-ast-patch-planner-resume-drift.test.ts |
| Overlap conflict | `overlapping_ranges` diagnostic | Stops before preview diff | none | nested-overlap fixture |

## Safety Audit

| Boundary | Result | Evidence |
|---|---|---|
| No patch execution or file write | pass | Safety scan returned `NO_MATCHES`. |
| No symbol mutation or project mutation | pass | Drift checker returns diagnostics only. |
| No TaskLoop/Gateway/Main/renderer integration | pass | No such paths touched. |
| No service/background process | pass | Safety scan returned `NO_MATCHES`. |
| Invalid/overbroad/overlap/drift fails closed | pass | Resume/overlap tests pass. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Resume drift tests | `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-*.test.ts` | pass | Stable resume, rule hash, target file, source hash, match count/range, preview diff hash drift, overlap conflict | None in lane scope |
| Typecheck | `pnpm --config.verify-deps-before-run=false run typecheck` | pass | Checkpoint/drift types | None |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Review-required drift has no UI owner in this phase | Task boundary forbids UI/backend integration | Diagnostics only | Keep drift result local until a later accepted integration spec. |

## Status

Status: accepted

## Recommended Next Slice

```text
Slice: Operator review contract
New code path: diagnostics consumer only
Readonly boundary: no project mutation
Feature flag: default-off
Tests: checkpoint drift presentation and rejected continuation cases
Harness: fresh task spec
Rollback: keep current helper local
Done when: review-required diagnostics remain non-authoritative
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should checkpoint evidence include AST kind histograms? | It may make drift explanations clearer. | maintainer | no |

## Handoff Notes

Range drift is intentionally conservative. Any mismatch returns review-required diagnostics instead of continuing from stale data.
