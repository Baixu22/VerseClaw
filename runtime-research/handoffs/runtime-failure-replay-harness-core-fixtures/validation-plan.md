# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-replay-harness-core-fixtures.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-replay-harness-core-fixtures.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-replay-harness-core-fixtures.test.ts
```

If dirty worktree state unrelated to this slice blocks full harness validation, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-replay-harness-core-fixtures.md --no-diff
```

## Unit Coverage

- Five fixture-backed scenarios run successfully: `success`, `tool_error`, `test_failure`, `provider_timeout`, and `dirty_workspace`.
- Every fixture input passes `validateReplayCase`.
- Repeated runs of each fixture produce the same report.
- Generated or loaded `FailureEvent` values pass `validateFailureEvent`.
- Generated or loaded `EvidenceEnvelope` values pass `validateEvidenceEnvelope`.
- Missing provider/tool/workspace fixtures fail closed.
- Live provider defaults fail closed.
- Invalid scenario and invalid/missing budgets fail closed.
- Oversized reports fail closed.
- Raw prompt, provider payload, tool args/results, secret, env dump, and unredacted workspace content do not survive the report.
- Reports are JSON-serializable and bounded.
- No active runtime consumer or checkpoint/lifecycle write is introduced.

## Boundary Scan

The focused unit test scans active runtime roots for imports or references to `failure-replay-harness-core` and `runFailureReplayHarnessCore`. Allowed references are the harness core file, additive barrel export, docs, fixtures, and tests.

The focused unit test also scans checkpoint and lifecycle authority files for replay harness references so this phase cannot silently write replay reports or evidence into state authority paths.

## Promotion Criteria

Promote this phase to `ready_for_scorecard_design` only when required commands pass and no active consumer exists. Any desire to consume replay reports for scorecards, prompt slots, TaskLoop summaries, or runtime decisions requires a new follow-up spec.
