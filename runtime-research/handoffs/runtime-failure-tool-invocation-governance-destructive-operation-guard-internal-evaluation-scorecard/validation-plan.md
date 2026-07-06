# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts tests/unit/runtime-feature-config-schema.test.ts
pnpm run typecheck
```

If full harness validation is blocked by unrelated dirty worktree state, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.md --no-diff
```

## Coverage

Focused tests cover:

- 0-100 scoring aggregation and thresholds
- hard veto behavior
- false-block and trigger evidence inputs
- local transcript JSONL metadata parsing
- transcript-root scanning with hashed refs
- raw/secret/path leak detection
- active-consumer boundary scan

## Actual Results

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.md`: passed.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.md`: failed because the broader worktree contains many unrelated changed files outside this spec's `touchedAreas`.
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.md --no-diff`: passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-holdout-regression.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-preflight-pilot.test.ts tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts tests/unit/runtime-feature-config-schema.test.ts`: passed, 5 files and 32 tests.
- `pnpm run typecheck`: passed.
- Current local scorecard rerun: 93/100, `continue_with_separate_accepted_spec`, no hard vetoes, real-data feedback quality 8/15 warning.

## Stop Line

Validation must not require live providers, real tool mutation, real workspace mutation, UI wiring, active runtime wiring, checkpoint/lifecycle writes, services, daemons, listeners, databases, exporters, schedulers, or production/default-on approval.
