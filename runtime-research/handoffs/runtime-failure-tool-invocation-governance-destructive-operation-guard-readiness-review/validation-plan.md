# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts tests/unit/runtime-feature-config-schema.test.ts
```

If full harness validation is blocked by unrelated dirty worktree state, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-readiness-review.md --no-diff
```

## Evidence Checks

The focused Vitest command must remain green because it covers:

- Phase D flag-off legacy behavior
- Phase D flag-on preflight behavior
- boundary scans
- Phase E holdout false-block coverage
- positive-control trigger preservation
- config schema strictness

## Docs Sync

README translation updates are not required for Phase F because this is internal docs/spec-only readiness material with no user-visible UI, command, API route, setup flow, or documented user workflow change.

## Stop Conditions

Stop and do not mark the line ready if the review requires:

- production/default-on approval
- runtime implementation
- TaskLoop, provider, Gateway, prompt, retry, approval, rollback, completion, checkpoint, lifecycle, Electron, renderer, or script behavior changes
- live provider reads
- real workspace mutation proof
- broad shell command pattern blocking
- deleted touched-path metadata alone as a trigger
- service, daemon, listener, database, exporter, scheduler, second Gateway, or second runtime work
