# Validation Plan

Status: validated_with_no_diff_fallback_for_unrelated_dirty_tree.

## Required Commands

```bash
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts tests/unit/runtime-feature-config-schema.test.ts
pnpm run typecheck
```

If unrelated dirty worktree state blocks full harness validation:

```bash
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md --no-diff
```

## Required Proof

- Component metadata marks the component as runtime-usable, default-off, not production/default-on approved, and preflight-owner-only.
- Component metadata fixes the layer as runtime-core tool-governance preflight and records `callerSuppliedOwner: false`.
- The low-level evaluator is not exported as a second runtime entrypoint.
- Hook integration goes through the component entrypoint.
- Flag omitted/false preserves legacy allow behavior.
- Flag-on positive control blocks only with all accepted trigger signals.
- Holdout corpus remains non-blocking.
- Config schema remains strict and does not synthesize enabled defaults.
- Boundary scan rejects denied-root consumers.

## Result Log

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md`: passed.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md`: failed on unrelated dirty/untracked files outside this spec's touched areas.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-componentization.md --no-diff`: passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts tests/unit/runtime-feature-config-schema.test.ts`: passed, 4 files and 34 tests.
- `pnpm run typecheck`: passed.
