# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-task-outcome-scorecard-replay-reports.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-task-outcome-scorecard-replay-reports.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-task-outcome-scorecard-replay-reports.test.ts
```

If dirty worktree state unrelated to this slice blocks full harness validation, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-task-outcome-scorecard-replay-reports.md --no-diff
```

## Unit Coverage

- Phase 3 five replay fixture reports produce scorecards.
- Repeated scorecard generation is deterministic.
- Scorecards are JSON-serializable and bounded.
- Every nontrivial metric and aggregate decision has provenance refs.
- Aggregate decisions are limited to `improved`, `regressed`, `neutral`, and `inconclusive`.
- `diagnosticsOnly: false` is rejected.
- `completionProof: true` is rejected.
- Missing replay metadata is rejected.
- Missing replay/failure/evidence/touched-path provenance is rejected.
- Oversized replay reports and oversized scorecards are rejected.
- Non-JSON payloads are rejected.
- Raw prompt, provider payload, tool args/results, secrets, env dumps, and workspace content do not survive scorecard output.
- No active runtime consumer or checkpoint/lifecycle write is introduced.

## Boundary Scan

The focused unit test scans active runtime roots for imports or references to `failure-task-outcome-scorecard` and `createRuntimeFailureTaskOutcomeScorecardFromReplayReport`. Allowed references are the scorecard core file, additive barrel export, docs, and tests.

The focused unit test also scans checkpoint and lifecycle authority files for scorecard references so this phase cannot silently write scorecards or replay reports into state authority paths.

## Promotion Criteria

Promote this phase to `ready_for_governance_advisory_design` only when required commands pass and no active consumer exists. Any desire to consume scorecards for active gates, prompt slots, TaskLoop summaries, runtime decisions, or tool blocking requires a new follow-up spec.
