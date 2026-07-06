# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts tests/unit/runtime-feature-config-schema.test.ts
```

If full harness validation is blocked by unrelated dirty worktree state, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression-expansion.md --no-diff
```

## Expected Test Evidence

The holdout test must prove:

- flag-off holdout candidates allow with `legacyBehavior: true`
- flag-on holdout candidates do not block
- expected deletion remains non-blocking even with deleted touched-path metadata plus Phase 5 future block metadata
- slow test and known dev-server-like metadata remain non-blocking
- a positive control still blocks when every accepted trigger signal is present
- preflight hook integration still preserves default-off legacy allow behavior
- preflight hook integration still allows holdout candidates when flag-on

## Docs Sync

README translation updates are not required for Phase E because this is internal tests/docs-only holdout expansion with no user-visible UI, command, API route, setup flow, or documented user workflow change.

## Stop Conditions

Stop and write a follow-up instead of continuing if validation shows any need to:

- read live providers
- execute real tool mutation
- mutate the real workspace for proof
- broaden blocking to shell command patterns
- use deleted touched-path metadata alone as a trigger
- change TaskLoop, provider, Gateway, prompt, retry, approval, rollback, completion, checkpoint, lifecycle, Electron, renderer, or script behavior
- approve production/default-on behavior
- enter Phase F readiness review in this phase
