# lane-c-readonly-scan-preview-diff: Explicit target scan, match evidence, and preview diff generation

## Scope Confirmation

- Lane: lane-c-readonly-scan-preview-diff
- Output file: runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-c-readonly-scan-preview-diff.md
- Lane-owned file only: yes
- Implementation paths touched: openclaw_runtime/src/runtime-core/ast-patch-planner.ts
- Test paths touched: tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts; tests/fixtures/ast-patch-planner/**
- Commands run: focused Vitest; typecheck; boundary scans
- Required reading completed: yes

## Executive Summary

- Added explicit target-file readonly scan for TypeScript and TSX.
- Matching is constrained to TypeScript AST node text, then bounded into ordered match evidence.
- Fixable rules return in-memory preview diff diagnostics when `previewDiff` is explicitly enabled.
- Unfixable rules return match evidence only.
- Multi-file results are ordered by normalized file path and source range.
- Preview diff text is bounded and hashed; it does not grant completion evidence.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Readonly scan requires explicit target files | file | openclaw_runtime/src/runtime-core/ast-patch-planner.ts | scanAstPatchPlannerReadonly:382 | Target validation rejects globs and unsupported extensions. |
| Match evidence is ordered and bounded | file | openclaw_runtime/src/runtime-core/ast-patch-planner.ts | scanAstPatchPlannerReadonly:382 | Match IDs are normalized after ordering. |
| Preview diffs are in-memory diagnostics | file | openclaw_runtime/src/runtime-core/ast-patch-planner.ts | scanAstPatchPlannerReadonly:382 | No file-system mutation helpers are present. |
| Multi-file and TSX scan are covered | test | tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts | describe:15 | Covers multi-file order, unfixable match-only rules, TSX attribute snippets, and invalid targets. |

## Planner Surface

| Surface | Contract / Helper | Readonly Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Explicit scan | `scanAstPatchPlannerReadonly` | Reads supplied strings only | `readonlyScan` | tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts |
| Preview diff | `AstPatchPlannerPreviewDiff` | In-memory text/hash only | `previewDiff` | tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts |
| Fixtures | tests/fixtures/ast-patch-planner/** | Static test inputs | none | alpha.ts, beta.ts, component.tsx |

## Safety Audit

| Boundary | Result | Evidence |
|---|---|---|
| No patch execution or file write | pass | Safety scan returned `NO_MATCHES`. |
| No symbol mutation or project mutation | pass | Planner receives and returns strings; fixtures are unchanged after scan in tests. |
| No TaskLoop/Gateway/Main/renderer integration | pass | No such paths touched. |
| No service/background process | pass | Safety scan returned `NO_MATCHES`. |
| Invalid/overbroad/overlap/drift fails closed | pass | Lane B/D tests cover fail-closed cases. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Readonly scan tests | `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-*.test.ts` | pass | Fixable, unfixable, multi-file order, TSX, invalid targets | None in lane scope |
| Typecheck | `pnpm --config.verify-deps-before-run=false run typecheck` | pass | Exported scan/result types | None |
| Boundary scans | `rg ... <planner files>` | pass | No forbidden mutation/process/backend strings in implementation/tests/fixtures | Docs handled separately |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| No ast-grep runtime dependency exists in workspace | package search found no ast-grep package | Phase 8 readonly pattern/fix scan | Use TypeScript AST node text for MVP; revisit library integration in a later spec. |

## Status

Status: accepted

## Recommended Next Slice

```text
Slice: Larger pattern grammar evaluation
New code path: optional parser-backed pattern compiler
Readonly boundary: scan and preview only
Feature flag: default-off
Tests: comments/string false positives, JSX edge cases, nested snippets
Harness: fresh task spec
Rollback: keep current TypeScript AST MVP
Done when: new matcher preserves fail-closed diagnostics
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should future scan use ast-grep binary/library directly? | It may improve grammar fidelity but adds dependency and packaging work. | maintainer | no |

## Handoff Notes

The MVP intentionally does not scan globs or discover files. Callers must pass explicit file paths and content.

