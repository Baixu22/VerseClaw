# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-advisory-rules.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-advisory-rules.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-advisory-rules.test.ts
```

If dirty worktree state unrelated to this slice blocks full harness validation, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-advisory-rules.md --no-diff
```

## Unit Coverage

- Phase 3 five replay fixture reports plus Phase 4 scorecards produce advisory governance reports.
- Repeated governance generation is deterministic.
- Governance reports are JSON-serializable and bounded.
- Every governance finding and aggregate recommendation has provenance refs.
- Aggregate recommendations are limited to `advisory_pass`, `advisory_warn`, `advisory_backoff`, `advisory_ask_user`, and `inconclusive`.
- `diagnosticsOnly: false` is rejected.
- `completionProof: true` is rejected.
- `activeBlocking: true` is rejected.
- Missing replay metadata is rejected.
- Missing scorecard metadata is rejected.
- Missing governance finding provenance is rejected.
- Oversized replay reports and oversized governance reports are rejected.
- Non-JSON payloads are rejected.
- Raw prompt, provider payload, tool args/results, secrets, env dumps, and workspace content do not survive governance output.
- No active runtime consumer or checkpoint/lifecycle write is introduced.
- Focused advisory cases prove every first-wave rule has a replay/scorecard-backed diagnostic path.
- Slow completed test-repair metadata remains `advisory_pass` for long-running process detection so normal test loops are not treated as stuck commands by default.

## Boundary Scan

The focused unit test scans active runtime roots for imports or references to `failure-tool-invocation-governance-advisory` and `createRuntimeFailureToolInvocationGovernanceAdvisoryReport`. Allowed references are the governance core file, additive barrel export, docs, and tests.

The focused unit test also scans checkpoint and lifecycle authority files for governance references so this phase cannot silently write governance reports, scorecards, or replay reports into state authority paths.

## Promotion Criteria

Promote this phase to `ready_for_limited_active_guard_design` only when required commands pass and no active consumer exists. Any desire to consume governance diagnostics for active gates, prompt slots, TaskLoop summaries, runtime decisions, or tool blocking requires a new follow-up spec with replay/scorecard-backed validation and rollback.
