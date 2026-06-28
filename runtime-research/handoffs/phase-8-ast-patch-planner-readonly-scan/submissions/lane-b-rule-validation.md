# lane-b-rule-validation: Pattern/fix rule validation and fail-closed diagnostics

## Scope Confirmation

- Lane: lane-b-rule-validation
- Output file: runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-b-rule-validation.md
- Lane-owned file only: yes
- Implementation paths touched: openclaw_runtime/src/runtime-core/ast-patch-planner.ts
- Test paths touched: tests/unit/runtime-ast-patch-planner-rule-validation.test.ts
- Commands run: focused Vitest; typecheck
- Required reading completed: yes

## Executive Summary

- Added `validateAstPatchPlannerRule` for MVP rule shape, language, fix, metavariable, constraint, transform, and overbroad-pattern checks.
- Accepted languages are exactly `typescript` and `tsx`.
- Fix metavariables must be bound by the pattern.
- Constraints may reference only pattern-bound metavariables and must provide valid regex strings.
- Transform/rewriter utility surfaces are rejected with structured diagnostics.
- Overbroad single-metavariable patterns fail closed before scan.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Validation rejects unsupported languages | file | openclaw_runtime/src/runtime-core/ast-patch-planner.ts | validateAstPatchPlannerRule:267 | Emits `invalid_language`. |
| Validation rejects unbound fix metavariables | file | openclaw_runtime/src/runtime-core/ast-patch-planner.ts | validateAstPatchPlannerRule:267 | Emits `unbound_metavariable`. |
| Validation rejects transforms/rewriter utilities | file | openclaw_runtime/src/runtime-core/ast-patch-planner.ts | validateAstPatchPlannerRule:267 | Emits `unsupported_transform`. |
| Validation behavior is covered | test | tests/unit/runtime-ast-patch-planner-rule-validation.test.ts | describe:4 | Covers accepted MVP, invalid language, invalid shapes, unbound variables, transforms, overbroad patterns, and constraints. |

## Planner Surface

| Surface | Contract / Helper | Readonly Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Rule validation | `validateAstPatchPlannerRule` | Diagnostics only; no scan needed | none | tests/unit/runtime-ast-patch-planner-rule-validation.test.ts |
| Constraint validation | `constraints` regex strings | Only filters in-memory captures | none | openclaw_runtime/src/runtime-core/ast-patch-planner.ts |

## Safety Audit

| Boundary | Result | Evidence |
|---|---|---|
| No patch execution or file write | pass | Safety scan returned `NO_MATCHES`. |
| No symbol mutation or project mutation | pass | Validation returns diagnostics only. |
| No TaskLoop/Gateway/Main/renderer integration | pass | No such paths touched. |
| No service/background process | pass | Safety scan returned `NO_MATCHES`. |
| Invalid/overbroad/overlap/drift fails closed | pass | Invalid/overbroad validation tests pass. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Rule validation tests | `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-*.test.ts` | pass | 16 tests across all AST planner specs | None in lane scope |
| Typecheck | `pnpm --config.verify-deps-before-run=false run typecheck` | pass | Contract typing | None |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Full ast-grep rule language is larger than MVP | Research docs require narrow Phase 8 surface | Pattern/fix only | Keep transforms and rewrite utilities rejected until a later accepted spec. |

## Status

Status: accepted

## Recommended Next Slice

```text
Slice: Rule templates after readonly MVP
New code path: optional curated rule builder
Readonly boundary: validation and scan only
Feature flag: default-off
Tests: invalid template and overbroad template fixtures
Harness: fresh task spec
Rollback: remove template helper
Done when: template output still enters validateAstPatchPlannerRule first
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should constraints grow beyond regex filters? | More expressiveness increases safety burden. | maintainer | no |

## Handoff Notes

Validation remains independent from scan flags so callers can preflight rules without reading target files.
