# AST Pilot Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md --no-diff
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-runtime-use-readiness.md --no-diff
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-patch-planner-readonly-scan.md --no-diff
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-controlled-runtime-use-pilot-readiness.test.ts tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-patch-planner-contracts.test.ts tests/unit/runtime-ast-patch-planner-rule-validation.test.ts tests/unit/runtime-ast-patch-planner-readonly-scan.test.ts tests/unit/runtime-ast-patch-planner-resume-drift.test.ts
pnpm --config.verify-deps-before-run=false run typecheck
pnpm --config.verify-deps-before-run=false run comms:replay
pnpm --config.verify-deps-before-run=false run comms:compare
```

## Boundary Scans

```text
rg -n "writeFile|appendFile|mkdir|rm\\(|unlink|createWriteStream|workspaceEdit|applyPatch|ast-grep.*apply|rename|replaceBody|insertBefore|insertAfter|safeDelete" openclaw_runtime/src/runtime-core/ast-patch-planner.ts tests/unit/runtime-ast-patch-planner*.test.ts tests/unit/runtime-controlled-runtime-use-*.test.ts harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md runtime-research/handoffs/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot runtime-research/handoffs/controlled-runtime-use-pilot-readiness
rg -n "TaskLoop|task-loop|Gateway|host-api|api-client|ipcRenderer|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" openclaw_runtime/src/runtime-core/ast-patch-planner.ts tests/unit/runtime-ast-patch-planner*.test.ts tests/unit/runtime-controlled-runtime-use-*.test.ts harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md runtime-research/handoffs/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot runtime-research/handoffs/controlled-runtime-use-pilot-readiness
rg -n "window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|new WebSocket\\(" src/pages src/components
```

## Pass Criteria

- Every forbidden implementation match is zero.
- Guardrail text in docs/specs is classified as documentation only.
- The fail-closed target is 100 percent across AST matrix cases.
- If validation is blocked by unrelated dirty worktree state, the blocked reason must be recorded and structural `--no-diff` validation must still pass.
