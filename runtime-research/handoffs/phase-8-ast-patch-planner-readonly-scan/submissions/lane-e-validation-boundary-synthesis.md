# lane-e-validation-boundary-synthesis: Harness, tests, boundary scans, docs, and synthesis readiness

## Scope Confirmation

- Lane: lane-e-validation-boundary-synthesis
- Output file: runtime-research/handoffs/phase-8-ast-patch-planner-readonly-scan/submissions/lane-e-validation-boundary-synthesis.md
- Lane-owned file only: yes
- Implementation paths touched: openclaw_runtime/src/runtime-core/ast-patch-planner.ts; openclaw_runtime/src/runtime-core/index.ts
- Test paths touched: tests/unit/runtime-ast-patch-planner-*.test.ts; tests/fixtures/ast-patch-planner/**
- Commands run: harness context; harness validate --no-diff; full harness validate; focused Vitest; typecheck; comms replay/compare; safety scans; README search
- Required reading completed: yes

## Executive Summary

- Focused AST planner tests pass: 4 files, 16 tests.
- Typecheck passes for node and web configs.
- Structural task-spec validation passes.
- Safety scans over planner implementation/tests/fixtures return `NO_MATCHES` for mutation/process/backend forbidden patterns.
- Renderer backend boundary scan over `src/pages` and `src/components` returns `NO_MATCHES`.
- Comms replay and compare pass with dependency verification disabled.
- Full diff-aware harness validation passes in an isolated Phase 8-only validation clone using the exact `node harness/src/cli.mjs validate --spec ...` command after resetting that clone's `origin/main` ref to its clean HEAD so the default diff gate sees only the Phase 8 working-tree slice.
- The shared worktree still contains many unrelated changed files outside Phase 8 owned paths, so the same full diff-aware command remains noisy in-place; the isolated clone provides the acceptance evidence for this slice without reverting or staging unrelated work.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Focused tests pass | command | `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-contracts.test.ts tests/unit/runtime-ast-patch-planner-rule-validation.test.ts tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts tests/unit/runtime-ast-patch-planner-resume-drift.test.ts` | 4 passed, 16 passed | Windows glob did not expand, so explicit files were used. |
| Typecheck passes | command | `pnpm --config.verify-deps-before-run=false run typecheck` | node and web configs | Pass. |
| Structural harness validation passes | command | `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md --no-diff` | spec valid | Pass. |
| Full diff-aware harness validation passes for Phase 8 slice | command | `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md` in `C:\Users\27933\AppData\Local\Temp\clawx-phase8-validate-20260628021027` after `git update-ref refs/remotes/origin/main HEAD` | `Spec is valid` | Disposable clean clone populated only with Phase 8 files; avoids unrelated shared-worktree changes. |
| In-place full diff-aware harness validation remains noisy | command | `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md` | changed files outside owned paths | Expected because current shared worktree has unrelated edits. |
| Safety scans pass | command | `rg ... <planner implementation/tests/fixtures>` | `NO_MATCHES` | Covers mutation/process/backend forbidden strings. |
| Comms checks pass | command | `pnpm --config.verify-deps-before-run=false run comms:replay`; `pnpm --config.verify-deps-before-run=false run comms:compare` | exit 0 | Initial plain `pnpm run comms:replay` hit dependency verification before script execution. |
| README docs do not need AST planner update | command | `rg -n 'AST Patch Planner|astPatchPlanner|runtime-core' README*.md` | `NO_MATCHES` | No user-facing/default behavior change. |

## Planner Surface

| Surface | Contract / Helper | Readonly Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Planner contracts | `AstPatchPlanner*` exported types | Runtime-core only | none | Lane A |
| Rule validation | `validateAstPatchPlannerRule` | Diagnostics only | none | Lane B |
| Readonly scan | `scanAstPatchPlannerReadonly` | Explicit in-memory target files only | `readonlyScan` | Lane C |
| Preview diff | `AstPatchPlannerPreviewDiff` | Diagnostic text/hash only | `previewDiff` | Lane C |
| Resume drift | `checkAstPatchPlannerResumeDrift` | Rerun readonly scan; diagnostics only | scan flags | Lane D |

## Safety Audit

| Boundary | Result | Evidence |
|---|---|---|
| No patch execution or file write | pass | Safety scan returned `NO_MATCHES`. |
| No symbol mutation or project mutation | pass | Tests and authority boundary. |
| No TaskLoop/Gateway/Main/renderer integration | pass | Renderer scan returned `NO_MATCHES`; touched implementation is runtime-core only. |
| No service/background process | pass | Safety scan returned `NO_MATCHES`. |
| Invalid/overbroad/overlap/drift fails closed | pass | Focused tests pass. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Pre-implementation context | `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md` | pass | Reading list | None |
| Pre-implementation structural validate | `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md --no-diff` | pass | Spec structure | None |
| Post-implementation structural validate | same command | pass | Spec structure | None |
| Full diff-aware validate, Phase 8-only clone | `node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md` | pass | Owned path diff gate | Clone origin/main ref reset to clean HEAD so only Phase 8 copied files are in diff. |
| Full diff-aware validate, shared worktree | `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md` | fail | Shared dirty worktree audit | Fails on unrelated files outside Phase 8. |
| Focused tests | explicit AST planner Vitest files | pass | Contracts, validation, scan, drift | None |
| Typecheck | `pnpm --config.verify-deps-before-run=false run typecheck` | pass | Node/web TS | None |
| Comms replay | `pnpm --config.verify-deps-before-run=false run comms:replay` | pass | Regression replay script | No comms code changed. |
| Comms compare | `pnpm --config.verify-deps-before-run=false run comms:compare` | pass | Regression compare script | No comms code changed. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Full diff-aware harness validation cannot isolate this MVP in the current worktree | Shared-worktree command fails on many unrelated changed files outside Phase 8 owned paths | Accepted synthesis should have clean harness evidence | Completed via disposable Phase 8-only validation clone; do not use the shared dirty worktree result as acceptance evidence. |

## Status

Status: accepted

## Recommended Next Slice

```text
Slice: Phase 8 accepted handoff to future apply-readiness planning
New code path: none in this slice
Readonly boundary: unchanged; no apply behavior
Feature flag: keep readonlyScan and previewDiff default-off
Tests: preserve focused AST planner tests
Harness: future apply work requires a fresh task spec
Rollback: remove explicit helper export and do not call planner helpers
Done when: later spec defines apply authority, verifier evidence, and operator confirmation
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should future work add patch apply authority? | This phase explicitly forbids apply behavior. | maintainer | no |

## Handoff Notes

A-E are accepted for the readonly scan MVP. The shared worktree still has unrelated dirty files; use the isolated validation-clone evidence for this slice and keep future mutation/apply behavior behind a new task spec.
